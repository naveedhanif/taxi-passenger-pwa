// supabase/functions/create-tip-payment/index.ts
//
// Creates a fresh Stripe PaymentIntent for a post-trip tip — a separate
// charge from the original fare, not a modification of it (the
// original PaymentIntent is already captured/completed by this point).
//
// Same Connect destination-charge pattern as create-booking's fare
// charge (passenger pays, money transfers to the driver's connected
// account), but with application_fee_amount deliberately set to 0 —
// a tip should go 100% to the driver, not have the platform take a
// cut. reverse_transfer/refund_application_fee (used by cancel-booking
// for the fare) don't apply here since a tip is never refunded through
// that flow.
//
// NOTE ON UX: this asks the passenger to enter card details again via
// a fresh PaymentElement, the same as the original fare payment — it
// does NOT reuse/save the original card. Charging a previously-used
// card automatically would need create-booking's PaymentIntent to be
// created with setup_future_usage in the first place, which it isn't
// currently, and changing that touches the already-verified core
// booking payment flow — deliberately left alone rather than risking
// it for a smaller feature.
//
// Deploy: supabase functions deploy create-tip-payment
// Required secrets: STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RequestBody {
  booking_id: string;
  access_token?: string | null;
  amount: number; // euros
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: RequestBody = await req.json();
    if (!body.booking_id) return jsonError("Missing required field: booking_id", 400);
    if (!body.amount || body.amount <= 0) return jsonError("Tip amount must be greater than zero", 400);
    if (body.amount > 500) return jsonError("That tip amount looks too large — please double-check it", 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select("id, driver_id, customer_id, access_token, status")
      .eq("id", body.booking_id)
      .single();
    if (bookingError || !booking) return jsonError("Booking not found", 404);

    if (booking.status !== "completed") {
      return jsonError("Tips can only be added once the trip is completed", 400);
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
            .maybeSingle();
          if (customerRow) authorized = true;
        }
      }
    }
    if (!authorized) return jsonError("Not authorized for this booking", 403);

    const { data: driver, error: driverError } = await supabase
      .from("drivers")
      .select("stripe_connect_account_id, stripe_connect_onboarded")
      .eq("id", booking.driver_id)
      .single();
    if (driverError || !driver?.stripe_connect_onboarded || !driver.stripe_connect_account_id) {
      return jsonError("This driver isn't set up to receive tips yet", 400);
    }

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { apiVersion: "2024-06-20" });
    const amountCents = Math.round(body.amount * 100);

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: "eur",
      application_fee_amount: 0, // 100% of a tip goes to the driver
      transfer_data: { destination: driver.stripe_connect_account_id },
      metadata: { booking_id: booking.id, type: "tip" },
      automatic_payment_methods: { enabled: true },
    });

    return new Response(
      JSON.stringify({ clientSecret: paymentIntent.client_secret }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("create-tip-payment error:", err);
    return jsonError(err instanceof Error ? err.message : "Unexpected error", 500);
  }
});

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
