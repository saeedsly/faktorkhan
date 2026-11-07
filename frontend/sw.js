/* سرویس‌ورکر فاکتورخوان — فقط دارایی‌های ثابت کش می‌شوند */
const CACHE = "faktorkhan-v1";
const ASSETS = [
  "/", "/assets/css/app.css",
  "/assets/js/api.js", "/assets/js/ui.js", "/assets/js/views.js",
  "/assets/js/views2.js", "/assets/js/admin.js", "/assets/js/app.js",
  "/assets/fonts/Vazirmatn-Regular.woff2", "/assets/fonts/Vazirmatn-Bold.woff2",
  "/assets/favicon.svg", "/manifest.webmanifest",
];
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.pathname.startsWith("/api/")) return;
  event.respondWith(
    caches.match(event.request).then((hit) => hit || fetch(event.request).then((res) => {
      if (res.ok && (url.pathname.startsWith("/assets/") || url.pathname === "/")) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(event.request, copy));
      }
      return res;
    }).catch(() => caches.match("/")))
  );
});
