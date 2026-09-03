// src/pushNotifications.js
//
// Handles the browser-side half of real push notifications — asking
// permission, registering the service worker, subscribing, and saving
// that subscription server-side via save-push-subscription. Only
// meaningful for a SIGNED-IN customer: guests have no persistent
// identity for a subscription to attach to, so the UI that calls
// enablePushNotifications should only ever show this to a signed-in
// customer (see AccountHistoryScreen.jsx).

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

/**
 * @returns {"default"|"granted"|"denied"|"unsupported"}
 */
export function getPushPermissionState() {
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission;
}

export function isPushSupported() {
  return "serviceWorker" in navigator && "PushManager" in window && typeof Notification !== "undefined";
}

/**
 * @param {object} params
 * @param {string} params.driverId
 * @param {string} params.customerSessionToken - required; this is customer-only, guests can't call this meaningfully
 * @returns {Promise<{enabled: true} | {error: string}>}
 */
export async function enablePushNotifications({ driverId, customerSessionToken }) {
  if (!isPushSupported()) {
    return { error: "Push notifications aren't supported on this browser or device." };
  }
  if (!customerSessionToken) {
    return { error: "Sign in to enable notifications." };
  }
  const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
  if (!vapidPublicKey) {
    return { error: "Push notifications aren't configured yet." };
  }

  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      return { error: permission === "denied" ? "Notifications are blocked for this site in your browser settings." : "Notification permission wasn't granted." };
    }

    const registration = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;

    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });
    }

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
    const res = await fetch(`${supabaseUrl}/functions/v1/save-push-subscription`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${customerSessionToken}`,
        apikey: anonKey,
      },
      body: JSON.stringify({
        subscriber_type: "customer",
        driver_id: driverId,
        subscription: subscription.toJSON(),
      }),
    });
    const data = await res.json();
    if (!res.ok) return { error: data.error || "Something went wrong" };
    return { enabled: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Something went wrong enabling notifications" };
  }
}
