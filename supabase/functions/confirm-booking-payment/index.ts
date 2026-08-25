// supabase/functions/confirm-booking-payment/index.ts
//
// Called by the passenger app right after Stripe's client-side
// confirmPayment() reports success — but this function does NOT trust
// that report. It independently re-fetches the PaymentIntent from
// Stripe's API and only flips the booking from "awaiting_payment" to
// "pending" if Stripe itself confirms the charge succeeded.
//
// WHY THIS EXISTS: create-booking creates a Stripe PaymentIntent but
// does not charge the card — the passenger's browser confirms the
// actual charge on the payment screen. Before this function existed,
// the booking was inserted as visible/active ("pending") at creation
// time, which meant a driver could see and "receive" a booking before
// the passenger had paid anything, and the driver's availability
// locked immediately even if the passenger abandoned payment. This
// function is the missing step that makes a booking real only once
// money has actually moved.
//
// NEVER trust the client's claim that payment succeeded — a
// browser-side "success" can be spoofed, intercepted, or simply wrong
// (e.g. a race with a later async failure). Re-checking directly with
// Stripe via server-to-server API call is the only trustworthy source.
//
// NOT LIVE-TESTED — this sandbox has no network path to api.stripe.com.
// Written to match Stripe's documented PaymentIntents retrieve
// behavior exactly.
//
// Deploy: supabase functions deploy confirm-booking-payment
// Required secrets: STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ConfirmRequest {
  booking_id: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: ConfirmRequest = await req.json();
    if (!body.booking_id) {
      return jsonError("Missing required field: booking_id", 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select("id, status, payment_timing, stripe_payment_intent_id, deposit_stripe_payment_intent_id")
      .eq("id", body.booking_id)
      .single();

    if (bookingError || !booking) {
      return jsonError("Booking not found", 404);
    }

    // Idempotent — if this booking already moved past awaiting_payment
    // (e.g. the passenger's browser called this twice, or refreshed),
    // just report success without re-doing the work.
    if (booking.status !== "awaiting_payment") {
      return new Response(
        JSON.stringify({ confirmed: true, status: booking.status, alreadyConfirmed: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    const payLater = booking.payment_timing === "later";
    const paymentIntentId = payLater ? booking.deposit_stripe_payment_intent_id : booking.stripe_payment_intent_id;

    if (!paymentIntentId) {
      return jsonError("This booking has no associated payment to verify", 400);
    }

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { apiVersion: "2024-06-20" });
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (paymentIntent.status !== "succeeded") {
      // Payment genuinely didn't go through — leave the booking in
      // awaiting_payment. The passenger sees Stripe's own error on the
      // payment screen and can retry; nothing here marks it as failed
      // permanently, since a retry with a new payment method reuses the
      // same PaymentIntent.
      return new Response(
        JSON.stringify({ confirmed: false, stripeStatus: paymentIntent.status }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    // Payment confirmed by Stripe itself — now the booking becomes real:
    // visible to the driver, and counted in the availability check.
    const { error: updateError } = await supabase
      .from("bookings")
      .update({
        status: "pending",
        payment_status: payLater ? "unpaid" : "paid", // full balance still unpaid for pay-later; only the deposit succeeded
        deposit_payment_status: payLater ? "paid" : "unpaid",
      })
      .eq("id", booking.id);

    if (updateError) {
      return jsonError(`Payment succeeded but failed to update booking: ${updateError.message}`, 500);
    }

    return new Response(
      JSON.stringify({ confirmed: true, status: "pending" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (err) {
    console.error("confirm-booking-payment error:", err);
    return jsonError(err instanceof Error ? err.message : "Unexpected error", 500);
  }
});

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" },
    status,
  });
}
