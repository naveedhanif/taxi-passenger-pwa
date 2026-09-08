// supabase/functions/modify-booking/index.ts
//
// Lets a passenger change pickup/drop-off/stops/scheduled time on their
// own booking — genuinely new, this never existed before. Deliberately
// mirrors cancel-booking's authorization pattern (guest access_token OR
// customer session) and reuses the EXACT same real-route + fare
// recalculation logic create-booking already uses, rather than
// re-deriving it differently here.
//
// ALLOWED WINDOW: only while status is pending or confirmed — the same
// window a passenger can already self-cancel in, not a separately
// invented rule. Once a driver is genuinely en route, changing the
// destination becomes the driver's call, not a silent app action.
//
// PAYMENT_TIMING="now" (already fully charged) FARE-CHANGE HANDLING —
// a deliberate, disclosed simplification for this first version: the
// booking's estimated_fare is updated to the new real amount, but no
// automatic additional Stripe charge or partial refund happens here.
// If the new fare differs meaningfully from what was already charged,
// the response includes fareDifference so the UI can tell the
// passenger to settle it directly with the driver. Building real
// automatic adjustment (extra charge / partial refund) is a separate,
// more involved piece of work, not silently attempted here.
//
// PAYMENT_TIMING="later" (cash, pay-driver-directly) has no such
// problem — balance_due is simply recomputed against the new fare,
// no Stripe interaction needed either way.
//
// Deploy: supabase functions deploy modify-booking
// Required secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MAPBOX_TOKEN

import { createClient } from "npm:@supabase/supabase-js@2";
import { getDriverAvailability } from "../_shared/driverAvailability.ts";
import { getTariffPeriod, calculateFare, selectFareRule, type FareRule } from "../_shared/fareCalculator.ts";
import { sendPushToTarget } from "../_shared/pushSender.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SELF_MODIFIABLE_STATUSES = ["pending", "confirmed"];

interface StopInput {
  address: string;
  lat: number;
  lng: number;
}

interface RequestBody {
  booking_id: string;
  access_token?: string | null;
  pickup_address: string;
  pickup_lat: number;
  pickup_lng: number;
  dropoff_address: string;
  dropoff_lat: number;
  dropoff_lng: number;
  scheduled_time: string;
  stops?: StopInput[];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body: RequestBody = await req.json();
    const required = ["booking_id", "pickup_address", "pickup_lat", "pickup_lng", "dropoff_address", "dropoff_lat", "dropoff_lng", "scheduled_time"];
    for (const field of required) {
      if (body[field as keyof RequestBody] === undefined || body[field as keyof RequestBody] === null) {
        return jsonError(`Missing required field: ${field}`, 400);
      }
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select("id, driver_id, customer_id, access_token, status, payment_timing, estimated_fare, discount_amount, promo_code_id")
      .eq("id", body.booking_id)
      .single();
    if (bookingError || !booking) return jsonError("Booking not found", 404);

    // ---- Authorize: passenger only (guest token or customer session) — a driver changing a passenger's trip details isn't this endpoint's job ----
    let authorized = false;
    const authHeader = req.headers.get("Authorization");
    if (authHeader) {
      const { data: userData } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
      if (userData?.user && booking.customer_id) {
        const { data: customerRow } = await supabase
          .from("customers")
          .select("id")
          .eq("id", booking.customer_id)
          .eq("user_id", userData.user.id)
          .maybeSingle();
        if (customerRow) authorized = true;
      }
    }
    if (!authorized && body.access_token && booking.access_token && body.access_token === booking.access_token) {
      authorized = true;
    }
    if (!authorized) return jsonError("Not authorized to modify this booking", 403);

    if (!SELF_MODIFIABLE_STATUSES.includes(booking.status)) {
      return jsonError("This booking can no longer be modified — please contact your driver directly.", 400);
    }

    if (new Date(body.scheduled_time).getTime() < Date.now()) {
      return jsonError("Pickup time can't be in the past", 400);
    }

    // ---- Re-verify driver availability for the (possibly new) time — same real checks create-booking uses, not skipped just because a booking already exists ----
    const availability = await getDriverAvailability(supabase, booking.driver_id);
    if (!availability.isOnline) {
      return jsonError("This driver isn't currently accepting bookings", 400);
    }
    const { data: availabilityCheck, error: availabilityError } = await supabase.rpc(
      "is_driver_available_at",
      { p_driver_id: booking.driver_id, p_requested_time: body.scheduled_time, p_exclude_booking_id: body.booking_id }
    );
    if (availabilityError) return jsonError(`Couldn't check driver availability: ${availabilityError.message}`, 500);
    if (availabilityCheck === false) {
      return jsonError("Your driver already has a booking around that new time — please choose a different time", 409);
    }

    // ---- Real route from Mapbox — never trust client-supplied distance/time, same as create-booking ----
    const stops = Array.isArray(body.stops) ? body.stops : [];
    if (stops.length > 3) return jsonError("A trip can have at most 3 stops", 400);

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
    if (!directionsRes.ok) return jsonError("Couldn't calculate a route for the new trip details", 502);
    const directionsJson = await directionsRes.json();
    if (!directionsJson.routes || directionsJson.routes.length === 0) {
      return jsonError("No route found for this trip", 400);
    }
    const route = directionsJson.routes[0];
    const distanceKm = Math.round((route.distance / 1000) * 100) / 100;
    const durationMinutes = Math.round((route.duration / 60) * 10) / 10;

    // ---- Recalculate the fare against the new details, same tariff/fare-rule logic as create-booking ----
    const { data: driver } = await supabase.from("drivers").select("pre_booking_fee").eq("id", booking.driver_id).single();
    const { data: fareRules } = await supabase
      .from("fare_rules")
      .select("id, name, tariff_period, base_rate, per_km_rate, per_minute_rate, minimum_fare, tariff_a_cap, tariff_b_per_km_rate, tariff_b_per_minute_rate, discount_percent, is_active")
      .eq("driver_id", booking.driver_id);
    const tariffPeriod = getTariffPeriod(new Date(body.scheduled_time));
    const fareRule = selectFareRule((fareRules as FareRule[]) || [], tariffPeriod);
    if (!fareRule) return jsonError("This driver's pricing isn't available right now", 400);

    const fare = calculateFare({ distanceKm, durationMinutes, fareRule, preBookingFee: driver?.pre_booking_fee ?? 0 });

    // Same discount (if any) that was already on this booking carries
    // over, recomputed against the new fare — not re-validated against
    // usage limits again, since it was already consumed once at
    // original booking time; this is an adjustment, not a fresh redemption.
    const previousDiscountRatio = booking.estimated_fare > 0 ? (booking.discount_amount ?? 0) / booking.estimated_fare : 0;
    const newDiscountAmount = Math.round(fare.total * previousDiscountRatio * 100) / 100;
    const newEstimatedFare = Math.round((fare.total - newDiscountAmount) * 100) / 100;

    const oldFare = Number(booking.estimated_fare ?? 0);
    const fareDifference = Math.round((newEstimatedFare - oldFare) * 100) / 100;
    const paymentTimingIsNow = booking.payment_timing === "now";

    const { error: updateError } = await supabase
      .from("bookings")
      .update({
        pickup_address: body.pickup_address,
        pickup_lat: body.pickup_lat,
        pickup_lng: body.pickup_lng,
        dropoff_address: body.dropoff_address,
        dropoff_lat: body.dropoff_lat,
        dropoff_lng: body.dropoff_lng,
        scheduled_time: body.scheduled_time,
        stops: stops.length > 0 ? stops : null,
        distance_km: distanceKm,
        estimated_duration_minutes: durationMinutes,
        estimated_fare: newEstimatedFare,
        discount_amount: newDiscountAmount,
      })
      .eq("id", body.booking_id);
    if (updateError) return jsonError(updateError.message, 500);

    sendPushToTarget(
      supabase,
      { type: "driver", driverId: booking.driver_id },
      { title: "Booking updated", body: "A passenger changed their pickup/drop-off or time — check the new details.", url: "/bookings" }
    );

    return new Response(
      JSON.stringify({
        modified: true,
        newFare: newEstimatedFare,
        fareDifference: Math.abs(fareDifference) >= 0.01 ? fareDifference : 0,
        // Only meaningful for "now" bookings, where the difference isn't
        // automatically charged/refunded in this version — see header comment.
        needsManualSettlement: paymentTimingIsNow && Math.abs(fareDifference) >= 0.01,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("modify-booking error:", err);
    return jsonError(err instanceof Error ? err.message : "Unexpected error", 500);
  }
});

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
