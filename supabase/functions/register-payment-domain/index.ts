// supabase/functions/register-payment-domain/index.ts
//
// ONE-TIME SETUP — not called by the app, run manually once after
// deploying the passenger app to its real domain.
//
// Registers the passenger app's domain with Stripe so Apple Pay and
// Google Pay are allowed to render inside PaymentElement on that domain.
// Without this, PaymentElement silently shows only card entry — no
// error, the wallet buttons just never appear. This is a one-time
// Stripe-account-level setting, not something PaymentElement can
// self-register at runtime.
//
// See https://docs.stripe.com/payments/payment-methods/pmd-registration
//
// USAGE (run once, from your terminal, after deploying this function):
//   curl -X POST https://<your-project>.supabase.co/functions/v1/register-payment-domain \
//     -H "Authorization: Bearer <SUPABASE_ANON_KEY>" \
//     -H "Content-Type: application/json" \
//     -d '{"domain": "taxi-passenger-pwa.vercel.app"}'
//
// Apple Pay additionally requires domain OWNERSHIP verification — Stripe
// handles the merchant validation automatically, but you must confirm
// in the Stripe Dashboard (Settings > Payment methods > Apple Pay) that
// the domain shows as verified after running this. If it doesn't
// automatically verify, Stripe's dashboard will show the exact next
// step (usually just waiting a few minutes, or re-running validate).
//
// Deploy: supabase functions deploy register-payment-domain
// Required secrets: STRIPE_SECRET_KEY

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const domain = body?.domain;
    if (!domain || typeof domain !== "string") {
      return jsonError("Missing required field: domain (e.g. 'taxi-passenger-pwa.vercel.app', no https://)", 400);
    }

    const res = await fetch("https://api.stripe.com/v1/payment_method_domains", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${Deno.env.get("STRIPE_SECRET_KEY")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ domain_name: domain }).toString(),
    });

    const data = await res.json();
    if (!res.ok) {
      // Stripe returns a clear error if the domain is already registered
      // or can't be reached — surface it as-is rather than wrapping it.
      throw new Error(data?.error?.message || `Stripe API error (${res.status})`);
    }

    return new Response(
      JSON.stringify({
        registered: true,
        domain: data.domain_name,
        apple_pay_status: data.apple_pay?.status,
        google_pay_status: data.google_pay?.status,
        note: "Check Settings > Payment methods > Apple Pay in the Stripe Dashboard to confirm Apple Pay finishes verifying.",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (err) {
    console.error("register-payment-domain error:", err);
    return jsonError(err instanceof Error ? err.message : "Unexpected error", 500);
  }
});

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" },
    status,
  });
}
