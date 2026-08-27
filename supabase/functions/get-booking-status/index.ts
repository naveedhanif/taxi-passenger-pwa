// supabase/functions/get-booking-status/index.ts
//
// Powers the passenger app's live tracking screen with REAL data —
// replaces the fully-mocked passenger-booking-status.jsx that used
// hardcoded coordinates, a fake driver name, and a demo stage switcher.
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

// A passenger can only self-cancel before the driver is actively
// committed to the trip. Once en_route/arrived/in_progress, cancelling
// needs to go through the driver directly (call/WhatsApp) — not exposed
// here, to avoid a passenger silently cancelling a trip the driver is
// already mid-way through.
const SELF_CANCELABLE_STATUSES = ["pending", "confirmed"];

interface RequestBody {
  booking_id: string;
  access_token?: string | null;
  action?: "get" | "cancel";
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
    const action = body.action ?? "get";

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select(
        "id, driver_id, customer_id, access_token, passenger_name, pickup_address, pickup_lat, pickup_lng, dropoff_address, dropoff_lat, dropoff_lng, scheduled_time, status, estimated_fare, final_fare, payment_timing, deposit_amount, balance_due"
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

    if (action === "cancel") {
      if (!SELF_CANCELABLE_STATUSES.includes(booking.status)) {
        return jsonError(
          "This booking can no longer be self-cancelled — please contact your driver directly.",
          400
        );
      }
      const { error: cancelError } = await supabase
        .from("bookings")
        .update({ status: "canceled" })
        .eq("id", booking.id);
      if (cancelError) {
        return jsonError(`Couldn't cancel booking: ${cancelError.message}`, 500);
      }
      booking.status = "canceled";
    }

    // ---- Driver + vehicle (public, safe fields only — same views the
    // booking form uses) ----
    const [driverRes, vehicleRes] = await Promise.all([
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

    return new Response(
      JSON.stringify({
        booking: {
          id: booking.id,
          passengerName: booking.passenger_name,
          pickup: { address: booking.pickup_address, lat: booking.pickup_lat, lng: booking.pickup_lng },
          dropoff: { address: booking.dropoff_address, lat: booking.dropoff_lat, lng: booking.dropoff_lng },
          scheduledTime: booking.scheduled_time,
          status: booking.status,
          fare: booking.final_fare ?? booking.estimated_fare,
          isFinalFare: booking.final_fare != null,
          paymentTiming: booking.payment_timing,
          depositAmount: booking.deposit_amount,
          balanceDue: booking.balance_due,
          selfCancelable: SELF_CANCELABLE_STATUSES.includes(booking.status),
        },
        driver: {
          businessName: driverRes.data?.business_name ?? null,
          phoneNumber: driverRes.data?.phone_number ?? null,
        },
        vehicle: vehicleRes.data ?? null,
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
