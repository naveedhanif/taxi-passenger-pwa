// supabase/functions/list-pool-jobs/index.ts
//
// Returns currently unclaimed pool jobs — only to a real, signed-in,
// opted-in, verified driver. Same authorization checks as
// claim-pool-job, since seeing the list and claiming from it are two
// halves of the same real permission.
//
// Deploy: supabase functions deploy list-pool-jobs

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonError("Not authorized", 401);
    const { data: userData } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (!userData?.user) return jsonError("Not authorized", 401);

    const { data: driver } = await supabase
      .from("drivers")
      .select("id, pool_jobs_enabled, licence_verified, is_active")
      .eq("user_id", userData.user.id)
      .maybeSingle();

    if (!driver || !driver.is_active || !driver.licence_verified || !driver.pool_jobs_enabled) {
      // Same real reasons claim-pool-job would reject — an empty list
      // rather than an error, since "you can't see this yet" isn't
      // really a failure state for the screen that shows it.
      return new Response(JSON.stringify({ jobs: [] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: jobs, error } = await supabase
      .from("bookings")
      .select("id, pickup_address, dropoff_address, scheduled_time, estimated_fare, distance_km, estimated_duration_minutes, flight_number, flight_status, passenger_name")
      .eq("source", "pool")
      .is("driver_id", null)
      .eq("status", "pending")
      .gt("scheduled_time", new Date().toISOString())
      .order("scheduled_time", { ascending: true });

    if (error) return jsonError(error.message, 500);

    return new Response(JSON.stringify({ jobs: jobs ?? [] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("list-pool-jobs error:", err);
    return jsonError(err instanceof Error ? err.message : "Unexpected error", 500);
  }
});

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
