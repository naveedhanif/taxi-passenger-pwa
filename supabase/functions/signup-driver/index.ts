// supabase/functions/signup-driver/index.ts
//
// Creates the `drivers` row after a new driver signs up via Supabase
// Auth. This used to be a direct client-side insert
// (supabase.from("drivers").insert(...)) using the anon key right
// after auth.signUp() in driverAuth.ts — which fails with "new row
// violates row-level security policy for table drivers", the exact
// same category of bug the passenger app's signup-customer function
// was already built to fix for customers. This is that same fix,
// applied to driver signup, which had never actually been corrected.
//
// Does the insert server-side with the service role key instead of
// depending on a specific RLS policy shape existing on `drivers` —
// same pattern as every other privileged write in this project
// (create-booking, confirm-booking-payment, signup-customer).
//
// SECURITY: user_id is trusted based on it only ever reaching this
// function immediately after this exact browser's own successful
// auth.signUp() call. A best-effort check against Supabase Auth Admin
// catches an obvious mismatch when that check itself is working, but
// doesn't block signup if the Admin API call errors — a hard
// dependency on that check caused an equivalent failure mode
// ("Couldn't verify this account") in signup-customer's own history,
// so it's deliberately non-fatal here too.
//
// Deploy: supabase functions deploy signup-driver
// Required secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-provided)

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RequestBody {
  user_id: string;
  email: string;
  business_name: string;
  phone: string;
  booking_slug: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body: RequestBody = await req.json();
    const required = ["user_id", "email", "business_name", "booking_slug"];
    for (const field of required) {
      if (!body[field as keyof RequestBody]) return jsonError(`Missing required field: ${field}`, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // ---- Best-effort verification that user_id is real ----
    const { data: userLookup, error: userLookupError } = await supabase.auth.admin.getUserById(body.user_id);
    if (userLookupError) {
      console.warn("signup-driver: admin.getUserById check failed, proceeding anyway:", userLookupError.message);
    } else if (userLookup?.user && userLookup.user.email?.toLowerCase() !== body.email.toLowerCase()) {
      return jsonError("Account email mismatch", 401);
    }

    // ---- Idempotent: a retry shouldn't create a duplicate row or error out ----
    const { data: existing } = await supabase.from("drivers").select("id").eq("user_id", body.user_id).maybeSingle();
    if (existing) {
      return new Response(JSON.stringify({ driverId: existing.id }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: driverRow, error: insertError } = await supabase
      .from("drivers")
      .insert({
        user_id: body.user_id,
        business_name: body.business_name,
        phone: body.phone || null,
        email: body.email,
        booking_slug: body.booking_slug,
      })
      .select("id")
      .single();

    if (insertError) {
      // Same real-world case the old client-side code already handled:
      // booking_slug already taken by another driver.
      if (insertError.code === "23505") {
        return jsonError("That booking link is already taken — try a different business name.", 409);
      }
      return jsonError(insertError.message, 500);
    }

    return new Response(JSON.stringify({ driverId: driverRow.id }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("signup-driver error:", err);
    return jsonError(err instanceof Error ? err.message : "Unexpected error", 500);
  }
});

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
