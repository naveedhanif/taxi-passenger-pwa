// supabase/functions/get-active-promo/index.ts
//
// Returns the best active promo code available to whoever is asking,
// for a given driver — used to show a discount banner on the booking
// form and fare estimate. This is a DISPLAY-ONLY convenience lookup;
// it is never trusted for the actual charge. create-booking
// independently re-validates and re-applies any promo server-side
// before touching Stripe, exactly like every fare number in this app.
//
// A signed-in customer can see both a promo targeted specifically at
// them (customer_id match) and any broadcast promo (customer_id
// null) for this driver — if both exist, the targeted one wins since
// it's presumably the more deliberate offer. A guest (no session, or
// a session with no matching customer row yet) can only see broadcast
// promos, since a targeted promo requires a real customer_id to check
// against.
//
// `promo_codes` has no public RLS policies — same reasoning as
// promo_codes' own table comment — so this goes through the service
// role.
//
// Deploy: supabase functions deploy get-active-promo
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

    // Best-effort: resolve a customer_id if a real signed-in session
    // was sent. A guest calls this with just the anon key, which
    // getUser() will reject — that's fine, just means no targeted
    // promo lookup, not an error for the caller.
    let customerId: string | null = null;
    const authHeader = req.headers.get("Authorization");
    if (authHeader) {
      const { data: userData } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
      if (userData?.user) {
        const { data: customer } = await supabase
          .from("customers")
          .select("id")
          .eq("driver_id", body.driver_id)
          .eq("user_id", userData.user.id)
          .maybeSingle();
        customerId = customer?.id ?? null;
      }
    }

    const nowIso = new Date().toISOString();
    const SELECT_COLS = "id, code, discount_type, discount_value, customer_id, max_uses, uses_count, expires_at";

    let targeted = null;
    if (customerId) {
      const { data } = await supabase
        .from("promo_codes")
        .select(SELECT_COLS)
        .eq("driver_id", body.driver_id)
        .eq("customer_id", customerId)
        .eq("active", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      targeted = data;
    }

    let chosen = isUsable(targeted, nowIso) ? targeted : null;

    if (!chosen) {
      const { data: broadcast } = await supabase
        .from("promo_codes")
        .select(SELECT_COLS)
        .eq("driver_id", body.driver_id)
        .is("customer_id", null)
        .eq("active", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      chosen = isUsable(broadcast, nowIso) ? broadcast : null;
    }

    return new Response(
      JSON.stringify({
        promo: chosen
          ? { id: chosen.id, code: chosen.code, discountType: chosen.discount_type, discountValue: chosen.discount_value }
          : null,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("get-active-promo error:", err);
    return jsonError(err instanceof Error ? err.message : "Unexpected error", 500);
  }
});

// deno-lint-ignore no-explicit-any
function isUsable(promo: any, nowIso: string): boolean {
  if (!promo) return false;
  if (promo.expires_at && promo.expires_at < nowIso) return false;
  if (promo.max_uses != null && promo.uses_count >= promo.max_uses) return false;
  return true;
}

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
