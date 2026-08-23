#!/bin/bash
set -e

echo 'Applying the atomicity fix to create-booking...'

cat > supabase/functions/create-booking/index.ts << 'FILE_EOF_0'
// supabase/functions/create-booking/index.ts
//
// SECURITY PRINCIPLE: the fare amount is NEVER trusted from the client.
// A passenger's browser sends pickup/dropoff/time; this function always
// independently recalculates distance, duration, and fare server-side
// before creating a Stripe PaymentIntent. If a malicious client sent a
// fake low fare, it's simply ignored — this function computes its own.
//
// Deploy: supabase functions deploy create-booking
// Required secrets (supabase secrets set):
//   MAPBOX_TOKEN            - server-side Mapbox token
//   STRIPE_SECRET_KEY       - Stripe secret key (never the publishable one)
//   PLATFORM_FEE_PERCENT    - e.g. "10" for a 10% platform cut (see note below)
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY - auto-provided by Supabase

import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";
import {
  getTariffPeriod,
  calculateFare,
  selectFareRule,
  eurosToStripeCents,
  type FareRule,
} from "../_shared/fareCalculator.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface BookingRequest {
  driver_id: string;
  passenger_name: string;
  passenger_phone: string;
  pickup_address: string;
  pickup_lat: number;
  pickup_lng: number;
  dropoff_address: string;
  dropoff_lat: number;
  dropoff_lng: number;
  scheduled_time: string; // ISO string
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: BookingRequest = await req.json();

    // ---- Basic input validation ----
    const required = [
      "driver_id", "passenger_name", "passenger_phone",
      "pickup_address", "pickup_lat", "pickup_lng",
      "dropoff_address", "dropoff_lat", "dropoff_lng", "scheduled_time",
    ];
    for (const field of required) {
      if (body[field as keyof BookingRequest] === undefined || body[field as keyof BookingRequest] === null) {
        return jsonError(`Missing required field: ${field}`, 400);
      }
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ---- Look up the driver (must exist and be active) ----
    const { data: driver, error: driverError } = await supabase
      .from("drivers")
      .select("id, is_active, stripe_connect_account_id, stripe_connect_onboarded, pre_booking_fee")
      .eq("id", body.driver_id)
      .single();

    if (driverError || !driver) {
      return jsonError("Driver not found", 404);
    }
    if (!driver.is_active) {
      return jsonError("This driver isn't currently accepting bookings", 400);
    }
    if (!driver.stripe_connect_onboarded || !driver.stripe_connect_account_id) {
      return jsonError("This driver hasn't finished payment setup yet", 400);
    }

    // ---- Resolve customer_id if the request is authenticated ----
    // Per the platform's design, a customer row is created at SIGNUP time
    // within a specific driver's app, not lazily here. If an authenticated
    // user somehow has no matching row yet, fall back to guest behavior
    // rather than hard-failing the booking.
    let customerId: string | null = null;
    const authHeader = req.headers.get("Authorization");
    if (authHeader) {
      const { data: userData } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
      if (userData?.user) {
        const { data: customerRow } = await supabase
          .from("customers")
          .select("id")
          .eq("driver_id", body.driver_id)
          .eq("user_id", userData.user.id)
          .single();
        customerId = customerRow?.id ?? null;
      }
    }

    // ---- Get a REAL route from Mapbox (server-side, never trust client distance/time) ----
    const mapboxToken = Deno.env.get("MAPBOX_TOKEN")!;
    const coords = `${body.pickup_lng},${body.pickup_lat};${body.dropoff_lng},${body.dropoff_lat}`;
    const directionsRes = await fetch(
      `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${coords}` +
      `?access_token=${mapboxToken}&geometries=geojson&overview=full`
    );
    if (!directionsRes.ok) {
      const mapboxErrorBody = await directionsRes.text();
      console.error("Mapbox directions call failed:", directionsRes.status, mapboxErrorBody);
      return jsonError(
        `Mapbox request failed (${directionsRes.status}): ${mapboxErrorBody}`,
        502
      );
    }
    const directionsJson = await directionsRes.json();
    if (!directionsJson.routes || directionsJson.routes.length === 0) {
      return jsonError("No route found between these two locations", 400);
    }
    const route = directionsJson.routes[0];
    const distanceKm = Math.round((route.distance / 1000) * 100) / 100;
    const durationMinutes = Math.round((route.duration / 60) * 10) / 10;

    // ---- Determine tariff period + fare rule ----
    const scheduledTime = new Date(body.scheduled_time);
    const tariffPeriod = getTariffPeriod(scheduledTime);

    const { data: fareRules } = await supabase
      .from("fare_rules")
      .select("id, name, tariff_period, base_rate, per_km_rate, per_minute_rate, minimum_fare, is_active")
      .eq("driver_id", body.driver_id);

    const fareRule = selectFareRule((fareRules as FareRule[]) || [], tariffPeriod);
    if (!fareRule) {
      return jsonError("This driver hasn't set up pricing yet", 400);
    }

    const fare = calculateFare({
      distanceKm,
      durationMinutes,
      fareRule,
      preBookingFee: driver.pre_booking_fee,
    });

    // ---- Create the Stripe PaymentIntent FIRST, before touching the database ----
    // ATOMICITY NOTE: this order matters. If we inserted the booking first
    // and Stripe failed afterward, we'd have an orphaned booking with no
    // payment path — a real customer-facing problem requiring a retry
    // that could create a duplicate. Creating the PaymentIntent first
    // means the worst failure case is an unused, unconfirmed
    // PaymentIntent if the booking insert fails afterward — and that
    // costs nothing and charges nobody, since Stripe PaymentIntents
    // don't move money until the customer confirms payment. This is
    // still two separate calls, not a single database transaction, but
    // it meaningfully reduces the blast radius of a partial failure.
    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { apiVersion: "2024-06-20" });

    const platformFeePercent = Number(Deno.env.get("PLATFORM_FEE_PERCENT") ?? "10");
    const totalCents = eurosToStripeCents(fare.total);
    const applicationFeeCents = Math.round(totalCents * (platformFeePercent / 100));

    const paymentIntent = await stripe.paymentIntents.create({
      amount: totalCents,
      currency: "eur",
      application_fee_amount: applicationFeeCents,
      transfer_data: { destination: driver.stripe_connect_account_id },
    });

    // ---- Now insert the booking ONCE, with the PaymentIntent id already attached ----
    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .insert({
        driver_id: body.driver_id,
        customer_id: customerId,
        passenger_name: body.passenger_name,
        passenger_phone: body.passenger_phone,
        pickup_address: body.pickup_address,
        pickup_lat: body.pickup_lat,
        pickup_lng: body.pickup_lng,
        dropoff_address: body.dropoff_address,
        dropoff_lat: body.dropoff_lat,
        dropoff_lng: body.dropoff_lng,
        scheduled_time: body.scheduled_time,
        distance_km: distanceKm,
        estimated_fare: fare.total,
        status: "pending",
        payment_status: "unpaid",
        stripe_payment_intent_id: paymentIntent.id,
      })
      .select("id, access_token")
      .single();

    if (bookingError || !booking) {
      // Booking insert failed AFTER Stripe succeeded — cancel the
      // now-orphaned PaymentIntent rather than leaving it dangling
      // indefinitely in the Stripe dashboard.
      await stripe.paymentIntents.cancel(paymentIntent.id).catch((cancelErr) => {
        console.error("Failed to cancel orphaned PaymentIntent:", cancelErr);
      });
      return jsonError("Couldn't create the booking", 500);
    }

    // Attach the booking id back onto the PaymentIntent's metadata, now
    // that we know it — a nice-to-have for reconciliation in the
    // Stripe dashboard, not required for the booking flow to work.
    await stripe.paymentIntents.update(paymentIntent.id, {
      metadata: { booking_id: booking.id },
    });

    return new Response(
      JSON.stringify({
        bookingId: booking.id,
        accessToken: booking.access_token,
        clientSecret: paymentIntent.client_secret,
        fare,
        distanceKm,
        durationMinutes,
        tariffPeriod,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error(err);
    return jsonError(
      `Unexpected error: ${err instanceof Error ? err.message : String(err)}`,
      500
    );
  }
});

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

FILE_EOF_0

echo 'Staging and committing...'
git add -A
git commit -m 'Fix atomicity: create Stripe PaymentIntent before booking insert, cancel on failure'

echo 'Pushing to GitHub...'
git push origin main

echo 'Done.'
