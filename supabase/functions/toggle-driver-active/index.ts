// supabase/functions/toggle-driver-active/index.ts
//
// Suspend / reactivate a driver — reuses drivers.is_active, which
// already existed and was already checked by create-booking (a driver
// with is_active=false can't receive new bookings). This is the first
// real UI that ever sets it; before now it could only be changed
// directly in the Supabase table editor.
//
// AUTHORIZATION: caller must be a real row in admin_users.
//
// Deploy: supabase functions deploy toggle-driver-active
// Required secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-provided)

import { createClient } from "npm:@supabase/supabase-js@2";
import { requireAdmin } from "../_shared/requireAdmin.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RequestBody {
  driver_id: string;
  active: boolean;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body: RequestBody = await req.json();
    if (!body.driver_id || typeof body.active !== "boolean") {
      return jsonError("Missing required field: driver_id, active", 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const authResult = await requireAdmin(supabase, req.headers.get("Authorization"));
    if ("error" in authResult) return jsonError(authResult.error, authResult.status);

    const { error } = await supabase.from("drivers").update({ is_active: body.active }).eq("id", body.driver_id);
    if (error) return jsonError(error.message, 500);

    return new Response(JSON.stringify({ updated: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("toggle-driver-active error:", err);
    return jsonError(err instanceof Error ? err.message : "Unexpected error", 500);
  }
});

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
