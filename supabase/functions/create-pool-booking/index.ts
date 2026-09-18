// supabase/functions/create-pool-booking/index.ts
//
// Creates a booking with NO driver assigned — source="pool",
// driver_id=NULL. Any opted-in, verified, online driver can see and
// claim it (see claim-pool-job). This is the entry point the new
// customer-facing website uses; it has nothing to do with any
// individual driver's own booking page, which is completely
// unaffected by this.
//
// PAYMENT: cash only, by design, for this first version — nothing is
// charged here at all. The passenger pays whichever driver actually
// shows up, same as flagging down a taxi. No Stripe interaction in
// this function. Revisit only once/if a real accountant-reviewed
// payment model for the pool specifically is settled.
//
// FARE: since there's no specific driver yet, this uses the real,
// standard NTA tariff structure directly (the exact same numbers
// every driver's fare_rules gets seeded from in seed-fare-rules) —
// not a fabricated or arbitrary rate, and not tied to any one
// driver's own configured discount.
//
// Deploy: supabase functions deploy create-pool-booking
// Required secrets: MAPBOX_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "npm:@supabase/supabase-js@2";
import { sendPushToTarget } from "../_shared/pushSender.ts";
import { getTariffPeriod, calculateFare, type FareRule } from "../_shared/fareCalculator.ts";
import { lookupFlightStatus } from "../_shared/flightStatus.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// National Maximum Taxi Fare, effective 1 December 2024 — identical
// values to seed-fare-rules/index.ts's NTA_TARIFFS. Kept as a
// separate literal here deliberately (not imported from that file,
// since it's a one-time driver-seeding script, not a shared library)
// but must be kept in sync if the NTA rates are ever officially updated.
const STANDARD_NTA_TARIFFS: Record<string, FareRule> = {
  standard: {
    id: "nta-standard", name: "Standard Rate", tariff_period: "standard",
    base_rate: 4.4, per_km_rate: 1.32, per_minute_rate: 0.47, minimum_fare: 4.4,
    tariff_a_cap: 23.6, tariff_b_per_km_rate: 1.72, tariff_b_per_minute_rate: 0.61,
    discount_percent: 0, is_active: true,
  },
  premium: {
    id: "nta-premium", name: "Premium Rate", tariff_period: "premium",
    base_rate: 5.4, per_km_rate: 1.81, per_minute_rate: 0.64, minimum_fare: 5.4,
    tariff_a_cap: 31.8, tariff_b_per_km_rate: 2.2, tariff_b_per_minute_rate: 0.78,
    discount_percent: 0, is_active: true,
  },
  special: {
    id: "nta-special", name: "Special Premium Rate", tariff_period: "special",
    base_rate: 5.4, per_km_rate: 2.2, per_minute_rate: 0.78, minimum_fare: 5.4,
    tariff_a_cap: null, tariff_b_per_km_rate: null, tariff_b_per_minute_rate: null,
    discount_percent: 0, is_active: true,
  },
};

interface StopInput { address: string; lat: number; lng: number; }

interface RequestBody {
  passenger_name: string;
  passenger_phone: string;
  passenger_email?: string | null;
  pickup_address: string;
  pickup_lat: number;
  pickup_lng: number;
  dropoff_address: string;
  dropoff_lat: number;
  dropoff_lng: number;
  stops?: StopInput[];
  scheduled_time: string;
  flight_number?: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body: RequestBody = await req.json();
    const required = ["passenger_name", "passenger_phone", "pickup_address", "pickup_lat", "pickup_lng", "dropoff_address", "dropoff_lat", "dropoff_lng", "scheduled_time"];
    for (const field of required) {
      if (body[field as keyof RequestBody] === undefined || body[field as keyof RequestBody] === null) {
        return jsonError(`Missing required field: ${field}`, 400);
      }
    }

    if (new Date(body.scheduled_time).getTime() < Date.now()) {
      return jsonError("Pickup time can't be in the past", 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // ---- Real route from Mapbox — same as create-booking, never trust client distance/time ----
    const stops = Array.isArray(body.stops) ? body.stops : [];
    if (stops.length > 3) return jsonError("A trip can have at most 3 stops", 400);
    for (const stop of stops) {
      if (typeof stop.address !== "string" || !stop.address.trim() || typeof stop.lat !== "number" || typeof stop.lng !== "number") {
        return jsonError("Each stop needs a valid address and coordinates", 400);
      }
    }

    const mapboxToken = Deno.env.get("MAPBOX_TOKEN")!;
    const allPoints = [
      { lat: body.pickup_lat, lng: body.pickup_lng },
      ...stops.map((s) => ({ lat: s.lat, lng: s.lng })),
      { lat: body.dropoff_lat, lng: body.dropoff_lng },
    ];
    const coords = allPoints.map((p) => `${p.lng},${p.lat}`).join(";");
    const directionsRes = await fetch(
      `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${coords}?access_token=${mapboxToken}&geometries=geojson&overview=full`
    );
    if (!directionsRes.ok) {
      const errBody = await directionsRes.text();
      console.error("Mapbox directions call failed:", directionsRes.status, errBody);
      return jsonError(`Mapbox request failed (${directionsRes.status})`, 502);
    }
    const directionsJson = await directionsRes.json();
    if (!directionsJson.routes || directionsJson.routes.length === 0) {
      return jsonError("No route found for this trip", 400);
    }
    const route = directionsJson.routes[0];
    const distanceKm = Math.round((route.distance / 1000) * 100) / 100;
    const durationMinutes = Math.round((route.duration / 60) * 10) / 10;

    // ---- Fare, using the real standard NTA tariff — no specific driver yet ----
    const tariffPeriod = getTariffPeriod(new Date(body.scheduled_time));
    const fareRule = STANDARD_NTA_TARIFFS[tariffPeriod];
    const fare = calculateFare({ distanceKm, durationMinutes, fareRule, preBookingFee: 0 });

    // ---- One-time real flight lookup, same as create-booking — non-fatal if it fails ----
    let flightLookup: Awaited<ReturnType<typeof lookupFlightStatus>> | null = null;
    if (body.flight_number && body.flight_number.trim()) {
      const dateLocal = new Date(body.scheduled_time).toISOString().slice(0, 10);
      flightLookup = await lookupFlightStatus(body.flight_number.trim(), dateLocal);
    }

    const { data: booking, error: insertError } = await supabase
      .from("bookings")
      .insert({
        driver_id: null,
        source: "pool",
        // Generated explicitly here rather than assumed from a
        // database default that hasn't been confirmed either way —
        // safe regardless: if a DB default also exists, this value
        // simply takes precedence; if not, this is what makes
        // tracking-by-link possible at all.
        access_token: crypto.randomUUID(),
        passenger_name: body.passenger_name.trim(),
        passenger_phone: body.passenger_phone.trim(),
        passenger_email: body.passenger_email?.trim() || null,
        pickup_address: body.pickup_address,
        pickup_lat: body.pickup_lat,
        pickup_lng: body.pickup_lng,
        dropoff_address: body.dropoff_address,
        dropoff_lat: body.dropoff_lat,
        dropoff_lng: body.dropoff_lng,
        stops: stops.length > 0 ? stops : null,
        scheduled_time: body.scheduled_time,
        distance_km: distanceKm,
        estimated_duration_minutes: durationMinutes,
        estimated_fare: fare.total,
        // Visible immediately — no payment gate at all for a cash-only
        // pool job, unlike create-booking's awaiting_payment step.
        status: "pending",
        payment_timing: "later",
        payment_status: "unpaid",
        deposit_amount: 0,
        deposit_payment_status: "not_required",
        flight_number: body.flight_number?.trim() || null,
        flight_status: flightLookup?.status ?? null,
        flight_scheduled_arrival: flightLookup?.scheduledArrivalUtc ?? null,
        flight_revised_arrival: flightLookup?.revisedArrivalUtc ?? null,
        flight_checked_at: flightLookup ? new Date().toISOString() : null,
      })
      .select("id, access_token")
      .single();

    if (insertError || !booking) {
      console.error("create-pool-booking insert failed:", insertError);
      return jsonError(`Couldn't create the booking: ${insertError?.message || "unknown error"}`, 500);
    }

    // ---- Notify every opted-in, online, verified driver — fire-and-forget ----
    const { data: eligibleDrivers } = await supabase
      .from("drivers")
      .select("id")
      .eq("pool_jobs_enabled", true)
      .eq("is_online", true)
      .eq("licence_verified", true)
      .eq("is_active", true);

    for (const driver of eligibleDrivers ?? []) {
      sendPushToTarget(
        supabase,
        { type: "driver", driverId: driver.id },
        { title: "New airport job available", body: `Pickup: ${body.pickup_address}`, url: `/pool-jobs?job=${booking.id}` }
      );
    }

    return new Response(
      JSON.stringify({ bookingId: booking.id, accessToken: booking.access_token, fare: fare.total }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("create-pool-booking error:", err);
    return jsonError(err instanceof Error ? err.message : "Unexpected error", 500);
  }
});

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
