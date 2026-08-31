// supabase/functions/confirm-tip-payment/index.ts
//
// Mirrors confirm-booking-payment's pattern exactly: the client calls
// stripe.confirmPayment() for the tip, but this function independently
// re-verifies the PaymentIntent with Stripe before recording anything
// — never trust the client's own claim that a charge succeeded.
//
// Requires one new column, run once in the Supabase SQL editor before
// deploying:
//
//   ALTER TABLE bookings ADD COLUMN tip_amount numeric DEFAULT 0;
//
// Deploy: supabase functions deploy confirm-tip-payment
// Required secrets: STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RequestBody {
  booking_id: string;
  payment_intent_id: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: RequestBody = await req.json();
    if (!body.booking_id || !body.payment_intent_id) {
      return jsonError("Missing required field: booking_id, payment_intent_id", 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { apiVersion: "2024-06-20" });
    const paymentIntent = await stripe.paymentIntents.retrieve(body.payment_intent_id);

    if (paymentIntent.status !== "succeeded") {
      return new Response(
        JSON.stringify({ confirmed: false, stripeStatus: paymentIntent.status }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    // Extra safety: make sure this PaymentIntent was actually created
    // for THIS booking, not some other one the client tried to pass in.
    if (paymentIntent.metadata?.booking_id !== body.booking_id) {
      return jsonError("Payment intent doesn't match this booking", 400);
    }

    const tipAmount = paymentIntent.amount / 100;
    const { error: updateError } = await supabase
      .from("bookings")
      .update({ tip_amount: tipAmount })
      .eq("id", body.booking_id);
    if (updateError) return jsonError(`Tip charged but failed to record: ${updateError.message}`, 500);

    return new Response(JSON.stringify({ confirmed: true, tipAmount }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("confirm-tip-payment error:", err);
    return jsonError(err instanceof Error ? err.message : "Unexpected error", 500);
  }
});

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
