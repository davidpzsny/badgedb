/* Badge Database service worker: only shows "Remind me" notifications (no offline cache). */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { title: "Badge Database", body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "Badge Database", {
    body: d.body || "",
    icon: d.icon || "/icon-192.png",
    badge: "/favicon-32.png",
    tag: d.tag || undefined,
    data: { url: d.url || "/" }
  }));
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "/", self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    const tab = list.find(c => c.url.startsWith(self.location.origin));
    if (tab && "navigate" in tab) return tab.navigate(url).then(c => (c || tab).focus()).catch(() => self.clients.openWindow(url));
    return self.clients.openWindow(url);
  }));
});
