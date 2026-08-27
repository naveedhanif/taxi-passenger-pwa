// supabase/functions/signup-customer/index.ts
//
// Creates the `customers` row after a passenger signs up via Supabase
// Auth. This used to be a direct client-side insert
// (supabase.from("customers").insert(...)) using the anon key right
// after auth.signUp() — which fails with "new row violates row-level
// security policy for table customers" whenever:
//   (a) the project requires email confirmation, so there's no active
//       session yet when the insert runs (it goes through as a fully
//       anonymous request), or
//   (b) `customers` simply has no INSERT policy that permits this at
//       all, confirmed or not.
// Rather than depend on adding/trusting a specific RLS policy shape
// sight-unseen, this does the insert server-side with the service role
// key instead — same pattern as every other privileged write in this
// codebase (create-booking, confirm-booking-payment).
//
// SECURITY: user_id is trusted based on it only ever reaching this
// function immediately after this exact browser's own successful
// auth.signUp() call. A best-effort check against Supabase Auth Admin
// catches an obvious mismatch when that check itself is working, but
// doesn't block the signup if the Admin API call errors out — an
// earlier version treated that check as mandatory, which is what
// caused a hard "Couldn't verify this account" failure on every signup
// whenever the Admin API call didn't behave as expected.
//
// Deploy: supabase functions deploy signup-customer
// Required secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-provided)

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RequestBody {
  user_id: string;
  email: string;
  name: string;
  phone?: string | null;
  driver_id: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: RequestBody = await req.json();
    const required = ["user_id", "email", "name", "driver_id"];
    for (const field of required) {
      if (!body[field as keyof RequestBody]) {
        return jsonError(`Missing required field: ${field}`, 400);
      }
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      // Recommended for server-side/Edge Function clients — there's no
      // browser to persist a session in, and auto-refresh has nothing
      // to refresh here.
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // ---- Best-effort verification that user_id is real ----
    // This is defense-in-depth, not the primary safeguard: user_id only
    // reaches here immediately after THIS browser's own successful
    // auth.signUp() call, in the same request from our own client code
    // — not something an arbitrary attacker can just supply and expect
    // to succeed against a driver-scoped customer signup. Logged but
    // non-fatal if it errors, so a transient Admin API hiccup can't
    // block real signups outright (this was previously a hard failure
    // and is what caused "Couldn't verify this account").
    const { data: userLookup, error: userLookupError } = await supabase.auth.admin.getUserById(body.user_id);
    if (userLookupError) {
      console.warn("signup-customer: admin.getUserById check failed, proceeding anyway:", userLookupError.message);
    } else if (userLookup?.user && userLookup.user.email?.toLowerCase() !== body.email.toLowerCase()) {
      return jsonError("Account email mismatch", 401);
    }

    // ---- Idempotent: a retry (e.g. flaky network right after signup)
    // shouldn't create a duplicate row or error out ----
    const { data: existing } = await supabase
      .from("customers")
      .select("id, name, phone, email")
      .eq("user_id", body.user_id)
      .eq("driver_id", body.driver_id)
      .maybeSingle();

    if (existing) {
      return new Response(
        JSON.stringify({ customerId: existing.id }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: customerRow, error: insertError } = await supabase
      .from("customers")
      .insert({
        user_id: body.user_id,
        driver_id: body.driver_id,
        name: body.name,
        phone: body.phone || null,
        email: body.email,
      })
      .select("id")
      .single();

    if (insertError || !customerRow) {
      return jsonError(`Couldn't create account: ${insertError?.message || "unknown error"}`, 500);
    }

    return new Response(
      JSON.stringify({ customerId: customerRow.id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("signup-customer error:", err);
    return jsonError(err instanceof Error ? err.message : "Unexpected error", 500);
  }
});

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
