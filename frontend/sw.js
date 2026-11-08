/* سرویس‌ورکر فاکتورخوان — استراتژی: شبکه اول، کش فقط برای آفلاین
   هدف: بعد از هر به‌روزرسانی، مرورگر هرگز نسخهٔ قدیمیِ جاافتاده را اجرا نکند
   (این عامل «گیر کردن صفحهٔ ورود» بعد از آپدیت است). */
const CACHE = "faktorkhan-v2";
const SHELL = ["/", "/assets/css/app.css", "/assets/favicon.svg", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET") return;
  if (url.origin !== self.location.origin) return;
  /* API هرگز کش نمی‌شود */
  if (url.pathname.startsWith("/api/")) return;

  /* CSS/JS: شبکه اول، کش فقط در خطا (با هدر no-cache برای بررسی تازه بودن) */
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      fetch(req, { cache: "no-cache" })
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || Response.error()))
    );
    return;
  }

  /* HTML/سایر: شبکه اول و در نبود شبکه، آخرین نسخهٔ ذخیره‌شده */
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match("/")))
  );
});
