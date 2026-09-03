// supabase/functions/get-my-referral-code/index.ts
//
// Returns the signed-in customer's own referral code, generating and
// saving one on first request if they don't have one yet (older
// accounts created before this feature existed, and brand-new ones
// alike — both just get one lazily here rather than needing a bulk
// backfill migration).
//
// Also returns the driver's current referral_reward_percent, so the
// UI can honestly say "give X%, get X%" using the real configured
// value instead of a hardcoded guess.
//
// AUTHORIZATION: the signed-in customer's own session, scoped to one
// specific driver (customers are per-driver in this app) — same
// pattern as get-active-promo.
//
// Deploy: supabase functions deploy get-my-referral-code
// Required secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-provided)

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RequestBody {
  driver_id: string;
}

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I — avoids confusable characters when read aloud or copied by hand

function randomCode(length = 6): string {
  let code = "";
  for (let i = 0; i < length; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return code;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body: RequestBody = await req.json();
    if (!body.driver_id) return jsonError("Missing required field: driver_id", 400);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonError("Not signed in", 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { data: userData, error: userError } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (userError || !userData?.user) return jsonError("Not signed in", 401);

    const { data: driver } = await supabase.from("drivers").select("referral_reward_percent").eq("id", body.driver_id).single();
    const rewardPercent = driver?.referral_reward_percent ?? 10;

    const { data: customer, error: customerError } = await supabase
      .from("customers")
      .select("id, referral_code")
      .eq("driver_id", body.driver_id)
      .eq("user_id", userData.user.id)
      .maybeSingle();
    if (customerError || !customer) return jsonError("No customer account found for this session", 404);

    if (customer.referral_code) {
      return new Response(
        JSON.stringify({ referralCode: customer.referral_code, rewardPercent }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Generate + save, retrying on the rare collision (the UNIQUE
    // constraint on customers.referral_code is the real guard; this
    // just avoids surfacing that as an error to the customer).
    let code = "";
    let saved = false;
    for (let attempt = 0; attempt < 5 && !saved; attempt++) {
      code = randomCode();
      const { error: updateError } = await supabase.from("customers").update({ referral_code: code }).eq("id", customer.id);
      if (!updateError) saved = true;
    }
    if (!saved) return jsonError("Couldn't generate a referral code — try again", 500);

    return new Response(
      JSON.stringify({ referralCode: code, rewardPercent }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("get-my-referral-code error:", err);
    return jsonError(err instanceof Error ? err.message : "Unexpected error", 500);
  }
});

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
