// supabase/functions/_shared/pushSender.ts
//
// Sends a real OS-level push notification — one that arrives even if
// the app is fully closed or the phone is locked — to every device a
// driver or customer has subscribed from. This complements, not
// replaces, the existing Supabase Realtime-based in-app alerts (sound
// + toast), which only work while the app tab is actually open and
// connected to the websocket.
//
// Uses the npm:web-push library via Deno's npm: import support — the
// same pattern already used for npm:stripe and npm:@supabase/supabase-js
// elsewhere in this project.
//
// NOT LIVE-TESTED — this sandbox has no network path to any browser
// push service (FCM, Mozilla's, etc). Written to match the Web Push
// protocol and the web-push library's documented API exactly. The
// first real test needs an actual browser subscribing on a real
// device and a real event firing.
//
// Required secrets (set once — shared by every function that imports
// this module): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT

import webpush from "npm:web-push@3";
// deno-lint-ignore no-explicit-any
type AnySupabaseClient = any; // avoids pulling in the full supabase-js type surface just for this

let configured = false;
function ensureConfigured() {
  if (configured) return;
  webpush.setVapidDetails(
    Deno.env.get("VAPID_SUBJECT") || "mailto:support@example.com",
    Deno.env.get("VAPID_PUBLIC_KEY")!,
    Deno.env.get("VAPID_PRIVATE_KEY")!
  );
  configured = true;
}

export interface PushPayload {
  title: string;
  body: string;
  // Which in-app screen to focus/open on tap — interpreted by each
  // app's own sw.js and App entry point, not by this shared sender.
  url?: string;
}

export type PushTarget = { type: "driver"; driverId: string } | { type: "customer"; customerId: string };

/**
 * Sends to every device on file for one driver or one customer.
 * Deliberately fire-and-forget from every call site — a push failing
 * (missing keys, a dead subscription, the push service being down)
 * never blocks or fails the actual booking/status/message action that
 * triggered it. Same "non-fatal side effect" reasoning as the promo
 * uses_count increment in create-booking.
 */
export async function sendPushToTarget(supabase: AnySupabaseClient, target: PushTarget, payload: PushPayload): Promise<void> {
  try {
    if (!Deno.env.get("VAPID_PUBLIC_KEY") || !Deno.env.get("VAPID_PRIVATE_KEY")) {
      // Not configured yet — quietly no-op rather than error every
      // caller out. Lets this be deployed ahead of the VAPID secrets
      // being set without breaking bookings/chat/cancellations.
      return;
    }
    ensureConfigured();

    const column = target.type === "driver" ? "driver_id" : "customer_id";
    const id = target.type === "driver" ? target.driverId : target.customerId;

    const { data: subs, error } = await supabase.from("push_subscriptions").select("id, endpoint, p256dh, auth").eq(column, id);
    if (error || !subs || subs.length === 0) return;

    await Promise.all(
      subs.map(async (sub: { id: string; endpoint: string; p256dh: string; auth: string }) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            JSON.stringify(payload)
          );
        } catch (err) {
          // 404/410 = the browser itself dropped the subscription
          // (unsubscribed, site data cleared, etc.) — standard Web Push
          // cleanup signal, not a real error. Anything else just logs;
          // one bad subscription shouldn't block sends to the rest.
          // deno-lint-ignore no-explicit-any
          const statusCode = (err as any)?.statusCode;
          if (statusCode === 404 || statusCode === 410) {
            await supabase.from("push_subscriptions").delete().eq("id", sub.id);
          } else {
            console.error("push send failed for one subscription:", err);
          }
        }
      })
    );
  } catch (err) {
    console.error("sendPushToTarget error (non-fatal):", err);
  }
}
