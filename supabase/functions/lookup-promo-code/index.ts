// supabase/functions/lookup-promo-code/index.ts
//
// Backs the manual "Have a promo code?" field on the fare estimate
// screen — a passenger who copied a code from the new Promo Codes
// screen (or was told one by their driver directly) can paste it in
// and see immediately whether it's valid and what it's worth.
//
// DISPLAY-ONLY, same as get-active-promo: this does not redeem or
// reserve anything. create-booking is the sole real authority and
// re-validates the promo id this returns completely independently
// before it ever affects a charge.
//
// Deploy: supabase functions deploy lookup-promo-code
// Required secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-provided)

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RequestBody {
  driver_id: string;
  code: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: RequestBody = await req.json();
    if (!body.driver_id || !body.code) return jsonError("Missing required field: driver_id, code", 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

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

    const { data: promoRow } = await supabase
      .from("promo_codes")
      .select("id, code, discount_value, customer_id, active, max_uses, uses_count, expires_at")
      .eq("driver_id", body.driver_id)
      .eq("code", body.code.trim().toUpperCase())
      .maybeSingle();

    if (!promoRow) return jsonError("That code doesn't exist for this driver", 404);

    // Specific reasons, so a real passenger typing a real code they
    // already used isn't told the unhelpful generic "invalid code".
    if (promoRow.customer_id != null && promoRow.customer_id !== customerId) {
      return jsonError("This code isn't valid for your account", 403);
    }
    if (!promoRow.active) return jsonError("This code isn't available anymore", 409);
    if (promoRow.expires_at && promoRow.expires_at < new Date().toISOString()) {
      return jsonError("This code has expired", 409);
    }
    if (promoRow.max_uses != null && promoRow.uses_count >= promoRow.max_uses) {
      return jsonError("This code has reached its usage limit", 409);
    }
    if (customerId) {
      const { data: alreadyUsed } = await supabase
        .from("bookings")
        .select("id")
        .eq("customer_id", customerId)
        .eq("promo_code_id", promoRow.id)
        .limit(1)
        .maybeSingle();
      if (alreadyUsed) return jsonError("You've already used this code", 409);
    }

    return new Response(
      JSON.stringify({ promo: { id: promoRow.id, code: promoRow.code, discountValue: promoRow.discount_value } }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("lookup-promo-code error:", err);
    return jsonError(err instanceof Error ? err.message : "Unexpected error", 500);
  }
});

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
