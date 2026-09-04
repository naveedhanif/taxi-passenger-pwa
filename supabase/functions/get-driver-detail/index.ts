// supabase/functions/get-driver-detail/index.ts
//
// One driver's full read-only picture for the Owner Dashboard's detail
// view — real aggregated stats (all-time, computed from actual
// bookings, not stored counters) plus their most recent bookings.
// Deliberately does NOT expose or allow editing Stripe Connect setup,
// fare rules, or promo codes — this is oversight, not a way to remote-
// control a driver's own business settings. It's also read-only:
// nothing in this function writes anything.
//
// AUTHORIZATION: caller must be a real row in admin_users.
//
// Deploy: supabase functions deploy get-driver-detail
// Required secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-provided)

import { createClient } from "npm:@supabase/supabase-js@2";
import { requireAdmin } from "../_shared/requireAdmin.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RequestBody {
  driver_id: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body: RequestBody = await req.json();
    if (!body.driver_id) return jsonError("Missing required field: driver_id", 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const authResult = await requireAdmin(supabase, req.headers.get("Authorization"));
    if ("error" in authResult) return jsonError(authResult.error, authResult.status);

    const { data: driver, error: driverError } = await supabase
      .from("drivers")
      .select(
        "id, business_name, email, phone, phone_number, is_online, is_active, break_until, working_hours, licence_verified, spsv_licence_number, licence_verified_at, avg_rating, review_count, created_at, photo_url"
      )
      .eq("id", body.driver_id)
      .single();
    if (driverError || !driver) return jsonError("Driver not found", 404);

    const { data: bookings } = await supabase
      .from("bookings")
      .select("id, passenger_name, status, scheduled_time, final_fare, estimated_fare, tip_amount")
      .eq("driver_id", body.driver_id)
      .order("scheduled_time", { ascending: false })
      .limit(20);

    const { data: completedForStats } = await supabase
      .from("bookings")
      .select("final_fare, estimated_fare, tip_amount")
      .eq("driver_id", body.driver_id)
      .eq("status", "completed");

    const totalCompleted = completedForStats?.length ?? 0;
    const totalEarnings = (completedForStats ?? []).reduce(
      (sum, b) => sum + Number(b.final_fare ?? b.estimated_fare ?? 0) + Number(b.tip_amount ?? 0),
      0
    );

    const { count: totalBookingsCount } = await supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("driver_id", body.driver_id);

    return new Response(
      JSON.stringify({
        driver,
        stats: {
          totalBookings: totalBookingsCount ?? 0,
          totalCompleted,
          totalEarnings: Math.round(totalEarnings * 100) / 100,
        },
        recentBookings: bookings ?? [],
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("get-driver-detail error:", err);
    return jsonError(err instanceof Error ? err.message : "Unexpected error", 500);
  }
});

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
