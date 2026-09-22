// public/sw.js
//
// Minimal service worker whose only job is to display a real OS-level
// notification when a push event arrives — and to focus/open the app
// to a relevant screen when that notification is tapped. This is what
// makes a notification appear even if the app is fully closed or the
// phone is locked; nothing else in this app needs a service worker,
// so this deliberately doesn't do any caching/offline work.
//
// NOT LIVE-TESTED — this sandbox can't receive a real push event.
// Written to match the documented Push API / Notifications API exactly.

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Update", body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "Update";
  const options = {
    body: data.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { url: data.url || "/" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          // WindowClient.navigate() on an already-open tab is unreliable
          // specifically on iOS Safari PWAs and can fail silently — the
          // old code focused the window regardless, landing on whatever
          // screen was already open. postMessage instead: the already-
          // running app listens for this and navigates itself directly,
          // which doesn't depend on that browser API working at all.
          if ("postMessage" in client) {
            client.postMessage({ type: "NOTIFICATION_NAVIGATE", url: targetUrl });
          }
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});
