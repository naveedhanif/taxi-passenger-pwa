// supabase/functions/cancel-booking/index.ts
//
// The single place a booking actually gets cancelled from — used by
// BOTH apps (the driver dashboard's "Cancel" button and the passenger
// app's self-cancel). Before this function existed, cancelling from
// either side was just `bookings.update({ status: "canceled" })` with
// NO Stripe refund at all — the passenger's money (full fare or
// deposit) just stayed captured with nothing ever paying it back.
//
// REFUND MECHANICS: this platform uses Stripe Connect destination
// charges (see create-booking) — the passenger's charge splits
// automatically to the driver's connected account minus a platform
// fee. A plain refund does NOT undo that split by default. Getting the
// money fully back requires:
//   reverse_transfer: true       - pulls the transferred amount back
//                                   from the driver's connected account
//   refund_application_fee: true - also refunds the platform's cut
// Both are set below so a cancellation refund is genuinely complete,
// not just a partial refund that leaves money sitting in the driver's
// account or with the platform.
//
// AUTHORIZATION: either the DRIVER who owns this booking (verified via
// their Supabase session -> drivers.user_id), or the PASSENGER who
// made it (guest access_token match, or their customer session) — same
// two-path pattern used throughout this codebase. A passenger can only
// self-cancel while still pending/confirmed; once a driver is
// genuinely en route the passenger must contact them directly instead
// (enforced here, not just hidden in the UI). A driver can cancel from
// any active state — that's their call to make.
//
// Deploy: supabase functions deploy cancel-booking
// Required secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY

import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";
import { sendPushToTarget } from "../_shared/pushSender.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PASSENGER_SELF_CANCELABLE_STATUSES = ["pending", "confirmed"];
const DRIVER_CANCELABLE_STATUSES = ["pending", "confirmed", "en_route", "arrived", "in_progress"];

interface RequestBody {
  booking_id: string;
  access_token?: string | null; // guest passenger only
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
        "id, driver_id, customer_id, access_token, status, payment_timing, payment_status, deposit_payment_status, stripe_payment_intent_id, deposit_stripe_payment_intent_id"
      )
      .eq("id", body.booking_id)
      .single();

    if (bookingError || !booking) {
      return jsonError("Booking not found", 404);
    }

    if (booking.status === "canceled") {
      return new Response(JSON.stringify({ canceled: true, alreadyCanceled: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (booking.status === "completed") {
      return jsonError("This trip already completed — it can't be cancelled.", 400);
    }

    // ---- Authorize: driver OR passenger (guest token / customer session) ----
    let authorizedAs: "driver" | "passenger" | null = null;
    const authHeader = req.headers.get("Authorization");

    if (authHeader) {
      const { data: userData } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
      if (userData?.user) {
        const { data: driverRow } = await supabase
          .from("drivers")
          .select("id")
          .eq("id", booking.driver_id)
          .eq("user_id", userData.user.id)
          .maybeSingle();
        if (driverRow) authorizedAs = "driver";

        if (!authorizedAs && booking.customer_id) {
          const { data: customerRow } = await supabase
            .from("customers")
            .select("id")
            .eq("id", booking.customer_id)
            .eq("user_id", userData.user.id)
            .maybeSingle();
          if (customerRow) authorizedAs = "passenger";
        }
      }
    }

    if (!authorizedAs && body.access_token && booking.access_token && body.access_token === booking.access_token) {
      authorizedAs = "passenger";
    }

    if (!authorizedAs) {
      return jsonError("Not authorized to cancel this booking", 403);
    }

    const allowedStatuses = authorizedAs === "driver" ? DRIVER_CANCELABLE_STATUSES : PASSENGER_SELF_CANCELABLE_STATUSES;
    if (!allowedStatuses.includes(booking.status)) {
      return jsonError(
        authorizedAs === "passenger"
          ? "This booking can no longer be self-cancelled — please contact your driver directly."
          : "This booking can't be cancelled from its current status.",
        400
      );
    }

    // ---- Refund whatever was actually charged ----
    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { apiVersion: "2024-06-20" });
    let refunded = false;
    let refundError: string | null = null;

    const payLater = booking.payment_timing === "later";
    const chargedPaymentIntentId = payLater ? booking.deposit_stripe_payment_intent_id : booking.stripe_payment_intent_id;
    const wasPaid = payLater ? booking.deposit_payment_status === "paid" : booking.payment_status === "paid";

    if (chargedPaymentIntentId && wasPaid) {
      try {
        await stripe.refunds.create({
          payment_intent: chargedPaymentIntentId,
          reverse_transfer: true,
          refund_application_fee: true,
        });
        refunded = true;
      } catch (err) {
        // Don't let a Stripe-side failure block the cancellation itself
        // — the trip is being cancelled either way. Surface the refund
        // failure separately so it doesn't get silently lost; the
        // booking's payment_status stays "paid" (not "refunded") if
        // this happens, so it's still visible/traceable afterward.
        refundError = err instanceof Error ? err.message : "Refund failed";
        console.error("cancel-booking: Stripe refund failed:", refundError);
      }
    }

    const updatePayload: Record<string, unknown> = { status: "canceled" };
    if (refunded) {
      if (payLater) updatePayload.deposit_payment_status = "refunded";
      else updatePayload.payment_status = "refunded";
    }

    const { error: updateError } = await supabase.from("bookings").update(updatePayload).eq("id", booking.id);
    if (updateError) {
      return jsonError(`Cancelled but failed to update booking record: ${updateError.message}`, 500);
    }

    // Push whoever DIDN'T cancel — the party that cancelled already
    // knows, obviously. Fire-and-forget, never blocks this response.
    if (authorizedAs === "driver") {
      if (booking.customer_id) {
        sendPushToTarget(
          supabase,
          { type: "customer", customerId: booking.customer_id },
          { title: "Your ride was cancelled", body: "Your driver had to cancel this trip.", url: "/?screen=account" }
        );
      }
      // Guests have no persistent subscription to push to — the
      // existing in-app status polling on the tracking screen is what
      // surfaces this for them if the app happens to be open.
    } else {
      sendPushToTarget(
        supabase,
        { type: "driver", driverId: booking.driver_id },
        { title: "Booking cancelled", body: "A passenger cancelled their booking.", url: "/?screen=bookings" }
      );
    }

    return new Response(
      JSON.stringify({ canceled: true, refunded, refundError }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("cancel-booking error:", err);
    return jsonError(err instanceof Error ? err.message : "Unexpected error", 500);
  }
});

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
