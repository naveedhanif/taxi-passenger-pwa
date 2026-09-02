// supabase/functions/list-my-promos/index.ts
//
// Powers the passenger's new "Promo Codes" screen — every promo
// currently or previously relevant to this caller (broadcast codes
// for the driver, plus any targeted specifically at this signed-in
// customer), each with a real status computed here rather than left
// for the client to guess at:
//
//   "used"     — this exact customer already has a booking that used it
//   "paused"   — the driver has turned the code off
//   "expired"  — past its expires_at
//   "used_up"  — hit its driver-set max_uses (by anyone, not just you)
//   "active"   — none of the above; usable right now
//
// Guests (no signed-in session) only ever see broadcast codes, and
// never a "used" status — there's no persistent identity to check a
// booking history against, same reasoning as get-customer-bookings.
//
// `promo_codes` has no public RLS policies, so this goes through the
// service role rather than a direct client-side query.
//
// Deploy: supabase functions deploy list-my-promos
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

    // Best-effort, same as get-active-promo: a guest simply gets
    // customerId = null rather than an error.
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

    const SELECT_COLS = "id, code, discount_type, discount_value, customer_id, active, max_uses, uses_count, expires_at, created_at";

    // Broadcast codes + (if signed in) codes targeted at this customer.
    let query = supabase.from("promo_codes").select(SELECT_COLS).eq("driver_id", body.driver_id);
    query = customerId ? query.or(`customer_id.is.null,customer_id.eq.${customerId}`) : query.is("customer_id", null);
    const { data: promos, error: promosError } = await query.order("created_at", { ascending: false });
    if (promosError) return jsonError(promosError.message, 500);

    // Which of these has this exact customer already redeemed? One
    // query for all of them rather than N — matches which booking
    // used which promo, regardless of that booking's final payment
    // outcome (uses_count is bumped at the same point, see
    // create-booking's comment on that).
    let usedPromoIds = new Set<string>();
    if (customerId && promos && promos.length > 0) {
      const { data: usedBookings } = await supabase
        .from("bookings")
        .select("promo_code_id")
        .eq("customer_id", customerId)
        .in("promo_code_id", promos.map((p) => p.id));
      usedPromoIds = new Set((usedBookings ?? []).map((b) => b.promo_code_id).filter(Boolean));
    }

    const nowIso = new Date().toISOString();
    const result = (promos ?? []).map((p) => {
      let status: "used" | "paused" | "expired" | "used_up" | "active";
      if (usedPromoIds.has(p.id)) status = "used";
      else if (!p.active) status = "paused";
      else if (p.expires_at && p.expires_at < nowIso) status = "expired";
      else if (p.max_uses != null && p.uses_count >= p.max_uses) status = "used_up";
      else status = "active";

      return {
        id: p.id,
        code: p.code,
        discountType: p.discount_type,
        discountValue: p.discount_value,
        targeted: p.customer_id != null,
        status,
      };
    });

    return new Response(JSON.stringify({ promos: result }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("list-my-promos error:", err);
    return jsonError(err instanceof Error ? err.message : "Unexpected error", 500);
  }
});

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
