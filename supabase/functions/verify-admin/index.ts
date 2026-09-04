// supabase/functions/verify-admin/index.ts
//
// Called immediately after an owner signs in — confirms the account
// actually has a row in admin_users before letting them past the
// login screen at all. There is no signup path that creates that row
// (see owner-01-schema.sql); a real Supabase Auth account with no
// matching admin_users row is correctly rejected here, same as anyone
// else who isn't an owner.
//
// Deploy: supabase functions deploy verify-admin
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

    const { data: admin } = await supabase.from("admin_users").select("name, email").eq("id", authResult.adminId).single();

    return new Response(JSON.stringify({ authorized: true, name: admin?.name, email: admin?.email }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("verify-admin error:", err);
    return jsonError(err instanceof Error ? err.message : "Unexpected error", 500);
  }
});

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
