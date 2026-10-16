// supabase/functions/notify-customers/index.ts
//
// Driver-initiated push notifications to that driver's own customers.
// Two actions, both with FIXED message text (a driver can't type free text
// to blast to every customer) and a cool-down so customers aren't spammed:
//
//   { action: "promo",    driver_id, promo_id }  -> "Offer from <business>" ... taps open ?screen=promos
//   { action: "referral", driver_id }            -> "Refer a friend and earn X%" ... taps open ?screen=account
//
// A promo targeted at one customer goes to that customer only; a broadcast
// promo goes to every customer of this driver who has notifications on.
// Cool-downs: a promo can be pushed once per 24h; the referral announcement
// once per 7 days. Both are enforced server-side via columns added in
// migrations/20261016_notify_customers.sql.
//
// Deploy: supabase functions deploy notify-customers
// Required secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto), VAPID_* (shared)

import { createClient } from "npm:@supabase/supabase-js@2";
import { sendPushToTarget } from "../_shared/pushSender.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PROMO_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const REFERRAL_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const { action, driver_id } = body ?? {};
    if (!driver_id || (action !== "promo" && action !== "referral")) return jsonError("Missing or invalid action/driver_id", 400);

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // ---- Authorize: the signed-in user must own this driver row ----
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonError("Not signed in", 401);
    const { data: userData } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (!userData?.user) return jsonError("Not signed in", 401);

    const { data: driver, error: driverError } = await supabase
      .from("drivers")
      .select("id, user_id, business_name, booking_slug, referral_enabled, referral_reward_percent, referral_notified_at")
      .eq("id", driver_id)
      .maybeSingle();
    if (driverError) {
      console.error("notify-customers: driver lookup failed:", driverError);
      return jsonError(driverError.message, 500);
    }
    if (!driver || driver.user_id !== userData.user.id) return jsonError("Not authorized for this driver", 403);

    const slug = driver.booking_slug || "";
    const business = driver.business_name || "Your driver";

    let message: { title: string; body: string; url: string };
    let customerIds: string[];
    let markCooldown: () => Promise<unknown>;

    if (action === "promo") {
      if (!body.promo_id) return jsonError("Missing promo_id", 400);
      const { data: promo, error: promoError } = await supabase
        .from("promo_codes")
        .select("id, driver_id, code, discount_type, discount_value, customer_id, active, expires_at, max_uses, uses_count, last_notified_at")
        .eq("id", body.promo_id)
        .eq("driver_id", driver.id)
        .maybeSingle();
      if (promoError) {
        console.error("notify-customers: promo lookup failed:", promoError);
        return jsonError(promoError.message, 500);
      }
      if (!promo) return jsonError("Promo not found", 404);
      if (!promo.active) return jsonError("This promo is paused — resume it first.", 400);
      if (promo.expires_at && new Date(promo.expires_at) < new Date()) return jsonError("This promo has expired.", 400);
      if (promo.max_uses != null && promo.uses_count >= promo.max_uses) return jsonError("This promo has been fully used.", 400);
      if (promo.last_notified_at && Date.now() - new Date(promo.last_notified_at).getTime() < PROMO_COOLDOWN_MS) {
        return jsonError("You already sent this promo in the last 24 hours.", 429);
      }

      const off = promo.discount_type === "percent" ? `${Number(promo.discount_value)}% off` : `€${Number(promo.discount_value)} off`;
      message = {
        title: `Offer from ${business}`,
        body: `${off} your next ride — use code ${promo.code}.`,
        url: `/${slug}?screen=promos`,
      };

      if (promo.customer_id) {
        customerIds = [promo.customer_id];
      } else {
        const { data: customers, error } = await supabase.from("customers").select("id").eq("driver_id", driver.id);
        if (error) return jsonError(error.message, 500);
        customerIds = (customers ?? []).map((c: { id: string }) => c.id);
      }
      markCooldown = async () => {
        const { error } = await supabase.from("promo_codes").update({ last_notified_at: new Date().toISOString() }).eq("id", promo.id);
        if (error) console.error("notify-customers: couldn't record promo cool-down:", error);
      };
    } else {
      if (!driver.referral_enabled) return jsonError("Refer & Earn is off.", 400);
      if (driver.referral_notified_at && Date.now() - new Date(driver.referral_notified_at).getTime() < REFERRAL_COOLDOWN_MS) {
        return jsonError("The referral announcement was already sent in the last 7 days.", 429);
      }
      message = {
        title: `Refer a friend with ${business}`,
        body: `Share your code — you and your friend each get ${Number(driver.referral_reward_percent ?? 10)}% off a ride.`,
        url: `/${slug}?screen=account`,
      };
      const { data: customers, error } = await supabase.from("customers").select("id").eq("driver_id", driver.id);
      if (error) return jsonError(error.message, 500);
      customerIds = (customers ?? []).map((c: { id: string }) => c.id);
      markCooldown = async () => {
        const { error } = await supabase.from("drivers").update({ referral_notified_at: new Date().toISOString() }).eq("id", driver.id);
        if (error) console.error("notify-customers: couldn't record referral cool-down:", error);
      };
    }

    // Only customers with a device subscribed (the shared sender logs a
    // noisy error per customer with none).
    let subscribed: string[] = [];
    if (customerIds.length > 0) {
      const { data: subs, error } = await supabase.from("push_subscriptions").select("customer_id").in("customer_id", customerIds);
      if (error) {
        console.error("notify-customers: subscription lookup failed:", error);
        return jsonError(error.message, 500);
      }
      subscribed = [...new Set((subs ?? []).map((s: { customer_id: string }) => s.customer_id))];
    }

    if (subscribed.length === 0) {
      return json({ sent_to: 0, total_customers: customerIds.length, note: "No customers have notifications turned on yet." });
    }

    await Promise.all(subscribed.map((customerId) => sendPushToTarget(supabase, { type: "customer", customerId }, message)));
    await markCooldown();

    return json({ sent_to: subscribed.length, total_customers: customerIds.length });
  } catch (err) {
    console.error("notify-customers error:", err);
    return jsonError(err instanceof Error ? err.message : "Unexpected error", 500);
  }
});

function json(payload: unknown) {
  return new Response(JSON.stringify(payload), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
