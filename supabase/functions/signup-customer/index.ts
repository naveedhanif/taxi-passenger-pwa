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
// SECURITY: a client could otherwise pass an arbitrary user_id to
// attach a customers row to someone else's account before they've even
// confirmed their email. This is prevented by independently verifying
// with Supabase Auth Admin (service role) that user_id really is a real
// user whose email matches what was just used to sign up — not just
// trusting whatever the client sends.
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
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ---- Verify user_id genuinely belongs to a real auth user with this email ----
    // This is the check that makes it safe to accept user_id from the
    // client at all — auth.signUp() just created this exact user in
    // this exact request, but we don't just trust the client's word for
    // it.
    const { data: userLookup, error: userLookupError } = await supabase.auth.admin.getUserById(body.user_id);
    if (userLookupError || !userLookup?.user) {
      return jsonError("Couldn't verify this account", 401);
    }
    if (userLookup.user.email?.toLowerCase() !== body.email.toLowerCase()) {
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
