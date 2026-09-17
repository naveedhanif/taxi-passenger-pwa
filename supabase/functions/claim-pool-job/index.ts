// supabase/functions/claim-pool-job/index.ts
//
// The one piece that has to be genuinely race-proof: if two drivers
// tap "Accept" on the same job within the same second, exactly one of
// them wins it. Enforced by claim_pool_job(), a single atomic SQL
// UPDATE ... WHERE driver_id IS NULL — see pool-01-schema.sql. This
// function is just the auth + response wrapper around that.
//
// Deploy: supabase functions deploy claim-pool-job

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RequestBody {
  booking_id: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body: RequestBody = await req.json();
    if (!body.booking_id) return jsonError("Missing booking_id", 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // ---- Authorize: a real, signed-in, verified, opted-in driver — never trust a client-supplied driver_id ----
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonError("Not authorized", 401);
    const { data: userData } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (!userData?.user) return jsonError("Not authorized", 401);

    const { data: driver } = await supabase
      .from("drivers")
      .select("id, pool_jobs_enabled, licence_verified, is_active")
      .eq("user_id", userData.user.id)
      .maybeSingle();

    if (!driver) return jsonError("Not authorized", 401);
    if (!driver.is_active) return jsonError("Your account is currently suspended", 403);
    if (!driver.licence_verified) return jsonError("Your SPSV licence must be verified before claiming pool jobs", 403);
    if (!driver.pool_jobs_enabled) return jsonError("Airport jobs aren't enabled for your account — turn this on in Settings first", 403);

    const { data: result, error } = await supabase.rpc("claim_pool_job", {
      p_booking_id: body.booking_id,
      p_driver_id: driver.id,
    });

    if (error) return jsonError(error.message, 500);
    const row = result?.[0];

    if (!row?.claimed) {
      return jsonError("This job was just claimed by another driver", 409);
    }

    return new Response(
      JSON.stringify({ claimed: true, bookingId: body.booking_id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("claim-pool-job error:", err);
    return jsonError(err instanceof Error ? err.message : "Unexpected error", 500);
  }
});

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
