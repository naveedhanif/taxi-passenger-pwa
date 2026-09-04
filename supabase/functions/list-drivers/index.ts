// supabase/functions/list-drivers/index.ts
//
// The Owner Dashboard's driver directory — every driver on the
// platform with the fields an owner actually needs to see at a
// glance: online status, active/suspended, licence verification
// state, and rating. Deliberately lean (no per-driver booking/earnings
// aggregation here) — that's what get-driver-detail is for, to avoid
// an expensive join across every driver just to render a list.
//
// AUTHORIZATION: caller must be a real row in admin_users — see
// _shared/requireAdmin.ts. No driver-facing or customer-facing
// session can ever pass this check.
//
// Deploy: supabase functions deploy list-drivers
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

    const { data: drivers, error } = await supabase
      .from("drivers")
      .select(
        "id, business_name, email, phone, is_online, is_active, licence_verified, spsv_licence_number, licence_verified_at, avg_rating, review_count, created_at"
      )
      .order("created_at", { ascending: false });

    if (error) return jsonError(error.message, 500);

    return new Response(JSON.stringify({ drivers: drivers ?? [] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("list-drivers error:", err);
    return jsonError(err instanceof Error ? err.message : "Unexpected error", 500);
  }
});

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
