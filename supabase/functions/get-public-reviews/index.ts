// supabase/functions/get-public-reviews/index.ts
//
// Public, unauthenticated read of a driver's reviews — anyone visiting
// the booking page can read these before booking, same trust level as
// the avg_rating/review_count numbers already shown publicly since
// Phase 1. Only ever returns rating + comment + date — never the
// passenger's identity, since that was never meant to be public.
//
// The `reviews` table has RLS enabled with no public policies (see
// submit-review/index.ts), so this deliberately public read has to go
// through a service-role function rather than direct client access —
// same reasoning as every other "public but not directly queryable
// table" case in this codebase.
//
// Deploy: supabase functions deploy get-public-reviews
// Required secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-provided)

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RequestBody {
  driver_id: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: RequestBody = await req.json();
    if (!body.driver_id) return jsonError("Missing required field: driver_id", 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { data: reviews, error } = await supabase
      .from("reviews")
      .select("id, rating, comment, created_at")
      .eq("driver_id", body.driver_id)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) return jsonError(error.message, 500);

    return new Response(JSON.stringify({ reviews: reviews ?? [] }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("get-public-reviews error:", err);
    return jsonError(err instanceof Error ? err.message : "Unexpected error", 500);
  }
});

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
