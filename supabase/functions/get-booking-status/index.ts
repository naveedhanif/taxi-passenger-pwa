// supabase/functions/get-booking-status/index.ts
//
// Powers the passenger app's live tracking screen with REAL data —
// replaces the fully-mocked passenger-booking-status.jsx that used
// hardcoded coordinates, a fake driver name, and a demo stage switcher.
//
// This function is READ-ONLY. Cancelling (and the Stripe refund that
// needs to happen alongside it) lives in cancel-booking/index.ts —
// keeping that logic in one place since the driver dashboard also
// needs to trigger the exact same refund handling when a driver
// cancels, not just a passenger's self-cancel.
//
// AUTHORIZATION — mirrors create-booking's guest-vs-customer split:
//   - Guest: the client proves ownership of the booking by sending back
//     the `access_token` that create-booking returned when the booking
//     was made. This value was never displayed to the passenger and
//     isn't guessable, so knowing it is treated as proof of ownership —
//     same trust model as a password-reset link.
//   - Signed-in customer: the client sends their real Supabase session
//     as a Bearer token. We resolve customer_id from it and check it
//     matches the booking's customer_id.
// Either path must succeed or the request is rejected. This function
// uses the service role key specifically so it can look these up and
// enforce that check itself, rather than depending on an RLS policy on
// `bookings` that permits guest reads — bookings is intentionally
// locked down to the owning driver at the table level, so a guest
// passenger has no other legitimate way to read their own booking.
//
// Deploy: supabase functions deploy get-booking-status
// Required secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-provided)

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Mirrors cancel-booking/index.ts's PASSENGER_SELF_CANCELABLE_STATUSES
// — used here only to tell the client whether to show a Cancel button
// at all, not to actually authorize a cancel (that check happens for
// real, server-side, in cancel-booking).
const SELF_CANCELABLE_STATUSES = ["pending", "confirmed"];

interface RequestBody {
  booking_id: string;
  access_token?: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: RequestBody = await req.json();
    if (!body.booking_id) {
      return jsonError("Missing required field: booking_id", 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select(
        "id, driver_id, customer_id, access_token, passenger_name, pickup_address, pickup_lat, pickup_lng, dropoff_address, dropoff_lat, dropoff_lng, stops, scheduled_time, status, estimated_fare, final_fare, payment_timing, deposit_amount, balance_due, payment_status, deposit_payment_status"
      )
      .eq("id", body.booking_id)
      .single();

    if (bookingError || !booking) {
      return jsonError("Booking not found", 404);
    }

    // ---- Authorize: guest access_token match OR signed-in customer match ----
    let authorized = false;

    if (body.access_token && booking.access_token && body.access_token === booking.access_token) {
      authorized = true;
    }

    if (!authorized) {
      const authHeader = req.headers.get("Authorization");
      if (authHeader) {
        const { data: userData } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
        if (userData?.user && booking.customer_id) {
          const { data: customerRow } = await supabase
            .from("customers")
            .select("id")
            .eq("id", booking.customer_id)
            .eq("user_id", userData.user.id)
            .single();
          if (customerRow) authorized = true;
        }
      }
    }

    if (!authorized) {
      return jsonError("Not authorized to view this booking", 403);
    }

    // ---- Driver + vehicle (public, safe fields only — same views the
    // booking form uses) ----
    const [driverRes, vehicleRes, driverPhotoRes, vehiclePhotoRes] = await Promise.all([
      supabase
        .from("public_driver_profiles")
        .select("business_name, phone_number")
        .eq("id", booking.driver_id)
        .maybeSingle(),
      supabase
        .from("public_vehicle_profiles")
        .select("make, model, color, seats")
        .eq("driver_id", booking.driver_id)
        .maybeSingle(),
      // photo_url isn't exposed by the shared views above — queried
      // directly from the underlying tables instead of risking a
      // blind redefinition of those views (see get-driver-availability
      // for the fuller reasoning on why that's avoided throughout this
      // codebase).
      supabase.from("drivers").select("photo_url").eq("id", booking.driver_id).maybeSingle(),
      supabase.from("vehicles").select("photo_url").eq("driver_id", booking.driver_id).maybeSingle(),
    ]);

    // ---- Live position, only meaningful once the driver is actually en route ----
    let position: { lat: number; lng: number } | null = null;
    if (["en_route", "arrived"].includes(booking.status)) {
      const { data: trackingRow } = await supabase
        .from("live_tracking")
        .select("lat, lng")
        .eq("driver_id", booking.driver_id)
        .maybeSingle();
      if (trackingRow) position = { lat: trackingRow.lat, lng: trackingRow.lng };
    }

    const relevantPaymentStatus = booking.payment_timing === "later" ? booking.deposit_payment_status : booking.payment_status;

    return new Response(
      JSON.stringify({
        booking: {
          id: booking.id,
          passengerName: booking.passenger_name,
          pickup: { address: booking.pickup_address, lat: booking.pickup_lat, lng: booking.pickup_lng },
          dropoff: { address: booking.dropoff_address, lat: booking.dropoff_lat, lng: booking.dropoff_lng },
          stops: booking.stops ?? [],
          scheduledTime: booking.scheduled_time,
          status: booking.status,
          fare: booking.final_fare ?? booking.estimated_fare,
          isFinalFare: booking.final_fare != null,
          paymentTiming: booking.payment_timing,
          depositAmount: booking.deposit_amount,
          balanceDue: booking.balance_due,
          selfCancelable: SELF_CANCELABLE_STATUSES.includes(booking.status),
          refunded: relevantPaymentStatus === "refunded",
        },
        driver: {
          businessName: driverRes.data?.business_name ?? null,
          phoneNumber: driverRes.data?.phone_number ?? null,
          photoUrl: driverPhotoRes.data?.photo_url ?? null,
        },
        vehicle: vehicleRes.data ? { ...vehicleRes.data, photoUrl: vehiclePhotoRes.data?.photo_url ?? null } : null,
        position,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("get-booking-status error:", err);
    return jsonError(err instanceof Error ? err.message : "Unexpected error", 500);
  }
});

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
