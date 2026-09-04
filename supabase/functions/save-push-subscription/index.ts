// supabase/functions/save-push-subscription/index.ts
//
// Called once by each app right after the browser grants notification
// permission and creates a PushSubscription — stores it (or refreshes
// it, if this exact device already has a row) so sendPushToTarget /
// sendPushToAllAdmins (see _shared/pushSender.ts) can reach it later.
//
// AUTHORIZATION: whoever is asking must actually be the driver,
// customer, or owner they're registering a subscription for.
// Customers are scoped per-driver in this app (a signed-in customer's
// account is tied to one specific driver, created at signup), so
// driver_id is required for driver/customer subscriptions, to look up
// the right row — same pattern as get-active-promo. An admin
// subscription needs no driver_id at all — an owner isn't scoped to
// any one driver.
//
// Guests can't register a push subscription at all — there's no
// persistent identity to attach it to, same reasoning as every other
// guest-can't-persist-things limitation in this app. The UI should
// only offer "enable notifications" to a signed-in customer.
//
// Deploy: supabase functions deploy save-push-subscription
// Required secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-provided)

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RequestBody {
  subscriber_type: "driver" | "customer" | "admin";
  driver_id?: string;
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body: RequestBody = await req.json();
    if (
      !body.subscriber_type ||
      !body.subscription?.endpoint ||
      !body.subscription?.keys?.p256dh ||
      !body.subscription?.keys?.auth
    ) {
      return jsonError("Missing required field: subscriber_type, subscription", 400);
    }
    if (body.subscriber_type !== "admin" && !body.driver_id) {
      return jsonError("Missing required field: driver_id", 400);
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonError("Not signed in", 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { data: userData, error: userError } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (userError || !userData?.user) return jsonError("Not signed in", 401);

    let driverId: string | null = null;
    let customerId: string | null = null;
    let adminId: string | null = null;

    if (body.subscriber_type === "driver") {
      const { data: driver } = await supabase.from("drivers").select("id, user_id").eq("id", body.driver_id).single();
      if (!driver || driver.user_id !== userData.user.id) return jsonError("Not authorized for this driver account", 403);
      driverId = body.driver_id!;
    } else if (body.subscriber_type === "customer") {
      const { data: customer } = await supabase
        .from("customers")
        .select("id")
        .eq("driver_id", body.driver_id)
        .eq("user_id", userData.user.id)
        .maybeSingle();
      if (!customer) return jsonError("No customer account found for this session", 404);
      customerId = customer.id;
    } else {
      const { data: admin } = await supabase.from("admin_users").select("id").eq("user_id", userData.user.id).maybeSingle();
      if (!admin) return jsonError("Not authorized — no owner account found for this session", 403);
      adminId = admin.id;
    }

    const { error: upsertError } = await supabase.from("push_subscriptions").upsert(
      {
        subscriber_type: body.subscriber_type,
        driver_id: driverId,
        customer_id: customerId,
        admin_id: adminId,
        endpoint: body.subscription.endpoint,
        p256dh: body.subscription.keys.p256dh,
        auth: body.subscription.keys.auth,
      },
      { onConflict: "endpoint" }
    );
    if (upsertError) return jsonError(upsertError.message, 500);

    return new Response(JSON.stringify({ saved: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("save-push-subscription error:", err);
    return jsonError(err instanceof Error ? err.message : "Unexpected error", 500);
  }
});

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
