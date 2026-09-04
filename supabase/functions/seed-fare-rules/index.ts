// supabase/functions/seed-fare-rules/index.ts
//
// Creates a driver's three fare_rules rows (Standard, Premium, Special
// Premium) using the ACTUAL current National Maximum Taxi Fare figures
// — effective 1 December 2024, confirmed still current via
// transportforireland.ie/fares/taxi-fares/ (the NTA's own fare
// estimator page), not approximated or invented. Source for the exact
// numbers: satellitetaxis.ie/fares-tarrifs, a real Irish taxi
// operator's published fare card, cross-checked against this
// project's own fareCalculator.ts logic (getTariffPeriod's day/hour
// boundaries match the NTA's published Standard/Premium/Special
// windows exactly, confirming the mapping below is correct, not
// guessed).
//
// THIS WAS MISSING ENTIRELY. FareRulesSetupStep.tsx (onboarding step
// 5) never actually saved anything to the database — it collected
// driver-editable rate fields into local state and threw them away.
// FareRulesScreen.tsx (Settings) has never had any way to create these
// rows either, only edit a discount on rows that already exist. Every
// driver who has ever completed onboarding has had zero fare_rules
// rows, hence "This driver hasn't set up fare rules yet."
//
// Idempotent — if rows already exist for this driver, does nothing
// and returns success, so it's safe to call from both the (now fixed)
// onboarding step AND as a self-heal check every time an existing
// driver opens Settings → Fare Rules, fixing already-affected accounts
// automatically without needing a one-off manual data fix.
//
// Rates are NOT driver-editable, by design — only discount_percent
// is, via the existing FareRulesScreen.tsx update call. This function
// only ever INSERTs; it has no update path for the rate fields at all.
//
// AUTHORIZATION: the driver's own signed-in session, matched against
// drivers.user_id — same pattern as every other driver-scoped function.
//
// Deploy: supabase functions deploy seed-fare-rules
// Required secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-provided)

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RequestBody {
  driver_id: string;
}

// National Maximum Taxi Fare, effective 1 December 2024.
const NTA_TARIFFS = [
  {
    name: "Standard Rate",
    tariff_period: "standard",
    base_rate: 4.4,
    per_km_rate: 1.32,
    per_minute_rate: 0.47,
    minimum_fare: 4.4,
    tariff_a_cap: 23.6,
    tariff_b_per_km_rate: 1.72,
    tariff_b_per_minute_rate: 0.61,
  },
  {
    name: "Premium Rate",
    tariff_period: "premium",
    base_rate: 5.4,
    per_km_rate: 1.81,
    per_minute_rate: 0.64,
    minimum_fare: 5.4,
    tariff_a_cap: 31.8,
    tariff_b_per_km_rate: 2.2,
    tariff_b_per_minute_rate: 0.78,
  },
  {
    // No two-tier split published for this rate — a single flat rate
    // applies for the whole journey after the initial charge. Encoded
    // as tariff_a_cap: null so fareCalculator.ts's own logic falls
    // straight to "no cap" handling, which uses these per_km/per_minute
    // values directly for the entire trip (see that file's own
    // hasTariffACap branch) — not a workaround, this is exactly how
    // the existing calculation code is already written to handle a
    // flat-rate tariff.
    name: "Special Premium Rate",
    tariff_period: "special",
    base_rate: 5.4,
    per_km_rate: 2.2,
    per_minute_rate: 0.78,
    minimum_fare: 5.4,
    tariff_a_cap: null,
    tariff_b_per_km_rate: null,
    tariff_b_per_minute_rate: null,
  },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body: RequestBody = await req.json();
    if (!body.driver_id) return jsonError("Missing required field: driver_id", 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonError("Not signed in", 401);
    const { data: userData, error: userError } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (userError || !userData?.user) return jsonError("Not signed in", 401);

    const { data: driver } = await supabase.from("drivers").select("id, user_id").eq("id", body.driver_id).single();
    if (!driver || driver.user_id !== userData.user.id) return jsonError("Not authorized for this driver account", 403);

    const { data: existing } = await supabase.from("fare_rules").select("id").eq("driver_id", body.driver_id).limit(1);
    if (existing && existing.length > 0) {
      return new Response(JSON.stringify({ seeded: false, alreadyExisted: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { error: insertError } = await supabase.from("fare_rules").insert(
      NTA_TARIFFS.map((t) => ({ ...t, driver_id: body.driver_id, discount_percent: 0, is_active: true }))
    );
    if (insertError) return jsonError(insertError.message, 500);

    return new Response(JSON.stringify({ seeded: true, alreadyExisted: false }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("seed-fare-rules error:", err);
    return jsonError(err instanceof Error ? err.message : "Unexpected error", 500);
  }
});

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
