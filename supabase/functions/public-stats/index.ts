// supabase/functions/public-stats/index.ts
//
// A small, safe aggregate for the marketing website — a real count,
// not a fabricated one, but deliberately returns only a number, never
// individual driver rows (which the anon key shouldn't be able to
// read directly, by design — this function runs with the service
// role specifically so it can compute the count without needing to
// loosen that).
//
// Deploy: supabase functions deploy public-stats

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

    const { count, error } = await supabase
      .from("drivers")
      .select("id", { count: "exact", head: true })
      .eq("is_online", true)
      .eq("is_active", true)
      .eq("licence_verified", true);

    if (error) throw error;

    return new Response(
      JSON.stringify({ driversOnline: count ?? 0 }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("public-stats error:", err);
    // A real zero rather than an error surfaced to the visitor — this
    // is decorative, not critical; the site should never look broken
    // over it.
    return new Response(JSON.stringify({ driversOnline: 0 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
