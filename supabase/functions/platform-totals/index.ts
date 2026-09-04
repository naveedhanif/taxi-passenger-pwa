// supabase/functions/platform-totals/index.ts
//
// The Owner Dashboard's big-picture numbers — every real, computed
// from actual rows, nothing estimated. Deliberately simple aggregate
// counts/sums rather than anything time-windowed for v1; a real
// "revenue this month vs last" trend could be added the same way it
// was for the driver's own Earnings page, if wanted later.
//
// AUTHORIZATION: caller must be a real row in admin_users.
//
// Deploy: supabase functions deploy platform-totals
// Required secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-provided)

import { createClient } from "npm:@supabase/supabase-js@2";
import { requireAdmin } from "../_shared/requireAdmin.ts";

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

    const authResult = await requireAdmin(supabase, req.headers.get("Authorization"));
    if ("error" in authResult) return jsonError(authResult.error, authResult.status);

    const { count: totalDrivers } = await supabase.from("drivers").select("id", { count: "exact", head: true });
    const { count: activeDrivers } = await supabase.from("drivers").select("id", { count: "exact", head: true }).eq("is_active", true);
    const { count: verifiedDrivers } = await supabase.from("drivers").select("id", { count: "exact", head: true }).eq("licence_verified", true);
    const { count: totalBookings } = await supabase.from("bookings").select("id", { count: "exact", head: true });
    const { count: completedBookings } = await supabase.from("bookings").select("id", { count: "exact", head: true }).eq("status", "completed");

    const { data: completedFares } = await supabase.from("bookings").select("final_fare, estimated_fare, tip_amount").eq("status", "completed");
    const totalRevenue = (completedFares ?? []).reduce(
      (sum, b) => sum + Number(b.final_fare ?? b.estimated_fare ?? 0) + Number(b.tip_amount ?? 0),
      0
    );

    return new Response(
      JSON.stringify({
        totalDrivers: totalDrivers ?? 0,
        activeDrivers: activeDrivers ?? 0,
        verifiedDrivers: verifiedDrivers ?? 0,
        totalBookings: totalBookings ?? 0,
        completedBookings: completedBookings ?? 0,
        totalRevenue: Math.round(totalRevenue * 100) / 100,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("platform-totals error:", err);
    return jsonError(err instanceof Error ? err.message : "Unexpected error", 500);
  }
});

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
