// supabase/functions/review-driver-licence/index.ts
//
// Approve or reject a driver's submitted SPSV licence — this is now a
// REAL gate (see _shared/driverAvailability.ts), not just a status
// badge: an unverified driver cannot go online or accept bookings at
// all. Replaces what used to require manually editing the row in the
// Supabase table editor.
//
// Rejecting clears licence_verified back to false explicitly (in case
// it was ever somehow true) and stamps who reviewed it and when either
// way, using licence_verified_by — a column that already existed,
// unused, anticipating exactly this.
//
// AUTHORIZATION: caller must be a real row in admin_users.
//
// Deploy: supabase functions deploy review-driver-licence
// Required secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-provided)

import { createClient } from "npm:@supabase/supabase-js@2";
import { requireAdmin } from "../_shared/requireAdmin.ts";
import { sendPushToTarget } from "../_shared/pushSender.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RequestBody {
  driver_id: string;
  approved: boolean;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body: RequestBody = await req.json();
    if (!body.driver_id || typeof body.approved !== "boolean") {
      return jsonError("Missing required field: driver_id, approved", 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const authResult = await requireAdmin(supabase, req.headers.get("Authorization"));
    if ("error" in authResult) return jsonError(authResult.error, authResult.status);

    const { error } = await supabase
      .from("drivers")
      .update({
        licence_verified: body.approved,
        licence_verified_at: body.approved ? new Date().toISOString() : null,
        // licence_verified_by references auth.users(id) directly (confirmed
        // via pg_constraint, not guessed) — authResult.userId, not
        // authResult.adminId (a different table's own primary key).
        licence_verified_by: authResult.userId,
      })
      .eq("id", body.driver_id);
    if (error) return jsonError(error.message, 500);

    // Let the driver know either way — they've been sitting blocked
    // from going online while waiting on exactly this.
    sendPushToTarget(
      supabase,
      { type: "driver", driverId: body.driver_id },
      body.approved
        ? { title: "Licence verified", body: "Your SPSV licence has been verified — you can now go online.", url: "/" }
        : { title: "Licence not verified", body: "Your submitted licence couldn't be verified — check your Settings for details.", url: "/settings" }
    );

    return new Response(JSON.stringify({ updated: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("review-driver-licence error:", err);
    return jsonError(err instanceof Error ? err.message : "Unexpected error", 500);
  }
});

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
