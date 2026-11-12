#!/usr/bin/env node
/**
 * آزمون رندر واقعی رابط با دادهٔ واقعی PHP
 * =========================================
 * بقیهٔ تست‌ها فقط JSON را می‌سنجند. ولی باگ واقعی که کاربر می‌بیند
 * معمولاً آن‌جاست که JSON درست است و *رندر* می‌شکند: کلیدی با نام
 * دیگر، عددی که رشته است، آرایه‌ای که شیء است. نتیجه‌اش «صفحهٔ خالی
 * بدون هیچ خطایی» است.
 *
 * این آزمون خودِ app.js را (نه یک بازنویسی از آن) در Node اجرا می‌کند،
 * با یک DOM و fetch ساختگی که به api.php واقعی وصل است. بعد HTML
 * خروجی هر نُه نما را می‌گیرد و می‌سنجد:
 *   ۱) خطا نداد
 *   ۲) رشتهٔ «undefined» یا «NaN» یا «[object Object]» در خروجی نیست
 *   ۳) محتوای واقعی (نام کاربر، مبلغ، شمارهٔ فاکتور) در HTML هست
 *
 * اجرا:  node tools/tests/php/ui.mjs
 */
import { Server } from "./app-harness.mjs";
import fs from "fs";
import path from "path";

const SRC = new URL("../../../deploy/php", import.meta.url).pathname;
const webJs = fs.readFileSync(path.join(SRC, "web/app.js"), "utf8");
const webHtml = fs.readFileSync(path.join(SRC, "web/index.html"), "utf8");

let fails = 0, checks = 0;
const ck = (label, good, extra = "") => {
  checks++;
  if (!good) fails++;
  console.log(`  ${good ? "✓" : "✗"} ${label}${extra ? " — " + extra : ""}`);
};

/* ─────────── سرور واقعی PHP ─────────── */
const srv = new Server();
const ses = srv.session();
await ses.register("ui@test.local");
await ses.call({ method: "POST", action: "invoices", json: {
  number: "UI-1001", seller_name: "فروشگاه رابط", issue_date: "1404/09/20",
  status: "confirmed", items: [
    { description: "کاغذ A4", qty: 3, unit_price: 250000, total: 750000 },
    { description: "تونر", qty: 1, unit_price: 450000, total: 450000 },
  ] } });

/* ─────────── DOM و fetch ساختگی ─────────── */
class FakeEl {
  constructor(tag = "div") { this._html = ""; this.tagName = tag; this.textContent = "";
    this.style = {}; this.dataset = {}; this.children = []; this.classList = { add(){}, remove(){}, toggle(){}, contains(){return false;} }; }
  get innerHTML() { return this._html; }
  set innerHTML(v) {
    this._html = String(v ?? "");
    if (globalThis.__HTML_LOG) globalThis.__HTML_LOG.push([this.id || this.tagName, this._html.length]);
  }
  setAttribute() {} getAttribute() { return null; } removeAttribute() {}
  appendChild(c) { this.children.push(c); return c; }
  removeChild() {} insertBefore() {} addEventListener() {} removeEventListener() {}
  querySelector() { return new FakeEl(); } querySelectorAll() { return []; }
  closest() { return null; } focus() {} blur() {} click() {} remove() {}
  getBoundingClientRect() { return { top: 0, left: 0, width: 1200, height: 800 }; }
  scrollTo() {} animate() { return { finished: Promise.resolve() }; }
  matches() { return false; }
  get firstChild() { return null; }
  get lastChild() { return null; }
}
const doc = {
  documentElement: new FakeEl("html"),
  body: new FakeEl("body"),
  head: new FakeEl("head"),
  createElement: (t) => new FakeEl(t),
  createElementNS: (_, t) => new FakeEl(t),
  createTextNode: (t) => { const e = new FakeEl("#text"); e.textContent = t; return e; },
  /* عناصر باید پایدار باشند، وگرنه رندر داخل یک شیء می‌رود و ما
     شیء دیگری را می‌خوانیم (همین باعث شد هر نُه نما «۰ بایت» شود). */
  __els: {},
  getElementById(id) {
    if (!this.__els[id]) { const e = new FakeEl(); e.id = id; this.__els[id] = e; }
    return this.__els[id];
  },
  querySelector(sel) {
    if (!this.__els["q:" + sel]) { const e = new FakeEl(); e.id = sel; this.__els["q:" + sel] = e; }
    return this.__els["q:" + sel];
  },
  querySelectorAll: () => [],
  addEventListener() {}, removeEventListener() {},
  cookie: "",
  readyState: "complete",
  title: "",
  hidden: false,
};
const win = {
  document: doc,
  location: { hash: "#/dashboard", pathname: "/", search: "", href: "http://x/", origin: "http://x" },
  history: { pushState() {}, replaceState() {} },
  navigator: { userAgent: "node", clipboard: { writeText: async () => {} }, onLine: true, language: "fa-IR" },
  localStorage: { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } },
  sessionStorage: { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } },
  matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
  setTimeout, clearTimeout, setInterval, clearInterval,
  requestAnimationFrame: (fn) => setTimeout(fn, 0),
  cancelAnimationFrame: clearTimeout,
  __listeners: {},
  addEventListener(type, fn) { (this.__listeners[type] = this.__listeners[type] || []).push(fn); },
  removeEventListener() {},
  alert() {}, confirm: () => true, prompt: () => "",
  scrollTo() {},
  innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1,
  fetch: null,
  URL, URLSearchParams, FormData, Blob: class { constructor(){} }, File: class {},
  crypto: { randomUUID: () => "00000000-0000-0000-0000-000000000000" },
  performance: { now: () => Date.now() },
  Intl, console,
  getComputedStyle: () => ({ getPropertyValue: () => "" }),
};

/* fetch → api.php واقعی */
let fetchCount = 0;
const seenUrls = [];
const fetchImpl = async (url, opts = {}) => {
  fetchCount++;
  seenUrls.push(String(url));
  const u = new URL(url, "http://x/");
  const action = u.searchParams.get("action") || "";
  const query = {};
  for (const [k, v] of u.searchParams) if (k !== "action") query[k] = v;
  let json = null;
  if (opts.body && !(opts.body instanceof win.FormData)) {
    try { json = JSON.parse(opts.body); } catch { json = null; }
  }
  const res = await ses.call({
    method: (opts.method || "GET"), action, query, json,
    cookie: ses.cookie,
  });
  return {
    ok: true, status: 200,
    headers: { get: () => "application/json" },
    async json() { return res.data ?? {}; },
    async text() { return res.text || ""; },
    async blob() { return new win.Blob(); },
  };
};
win.fetch = fetchImpl;

/* توکن نشست را از قبل در localStorage بگذار تا برنامه وارد پنل شود.
   در php-wasm کوکی واقعی سرو نمی‌شود؛ app.js هم کوکی‌محور نیست و
   برای «آماده بودن» فقط می‌خواهد getToken() رشتهٔ غیرخالی بدهد. */
win.localStorage.setItem("fk_token", "session");

/* ─────────── اجرای app.js ─────────── */
console.log("\n۱) بارگذاری رابط");
let UIerror = null;
const sandbox = { ...win };
try {
  const fn = new Function(
    "window", "document", "globalThis", "self", "fetch", "navigator", "location",
    "localStorage", "sessionStorage", "history", "matchMedia", "requestAnimationFrame",
    "setTimeout", "clearTimeout", "setInterval", "clearInterval", "console",
    webJs
  );
  fn(win, doc, win, win, fetchImpl, win.navigator, win.location,
     win.localStorage, win.sessionStorage, win.history, win.matchMedia,
     win.requestAnimationFrame, setTimeout, clearTimeout, setInterval, clearInterval, console);
} catch (e) {
  UIerror = e;
}
ck("app.js بدون خطا اجرا شد", !UIerror, UIerror && (UIerror.message + " @ " + (UIerror.stack || "").split("\n")[1]));

/* app.js منتظر DOMContentLoaded می‌ماند؛ همان را دستی اجرا کن */
const boots = (win.__listeners.DOMContentLoaded || []);
ck("به DOMContentLoaded گوش می‌دهد", boots.length > 0, `${boots.length} شنونده`);
let bootErr = null;
try {
  for (const fn of boots) await fn({ type: "DOMContentLoaded" });
} catch (e) { bootErr = e; }
ck("راه‌اندازی بدون خطا", !bootErr, bootErr && (bootErr.message + " @ " + (bootErr.stack || "").split("\n")[1]));
await new Promise((r) => setTimeout(r, 1800));
ck("رابط به api.php وصل شد", fetchCount > 0, `${fetchCount} درخواست`);

console.log("\n۲) رندر هر نُه نمای برنامه با دادهٔ واقعی");
ck("پوسته ۹ مسیر دارد", (webHtml.match(/data-route="/g) || []).length === 9,
   String((webHtml.match(/data-route="/g) || []).length));

/* ناوبری با hash — همان کاری که کلیک کاربر می‌کند */
const hashFns = win.__listeners.hashchange || [];
/* همان روشی که خود app.js استفاده می‌کند: $('#view') → querySelector. */
const viewEl = doc.querySelector("#view");
async function goto(route) {
  win.location.hash = "#/" + route;
  for (const fn of hashFns) await fn({ type: "hashchange" });
  /* صبر کن تا HTML دیگر عوض نشود — هر درخواست به php-wasm صدها
     میلی‌ثانیه طول می‌کشد و نمای داشبورد سه درخواست پشت‌سرهم دارد. */
  let last = "", stable = 0;
  for (let i = 0; i < 90 && stable < 3; i++) {
    await new Promise((r) => setTimeout(r, 120));
    const now = viewEl.innerHTML || "";
    const stillSkeleton = now.includes('class="skel"') && now.length < 1500;
    if (now === last && !stillSkeleton) stable++; else { stable = 0; last = now; }
  }
  await new Promise((r) => setTimeout(r, 120));
}

/* عنصر #view را باید خودمان نگه داریم تا خروجی را بخوانیم */

globalThis.__HTML_LOG = [];
const ROUTES = ["dashboard", "scan", "invoices", "reports",
                "subscription", "features", "support", "settings", "admin"];

const BAD = /undefined|NaN|\[object Object\]|Infinity|null/;
for (const r of ROUTES) {
  const before = { fetch: fetchCount, html: viewEl.innerHTML };
  let err = null;
  try { await goto(r); } catch (e) { err = e; }
  const html = viewEl.innerHTML || "";
  const changed = html !== before.html;
  ck(`نمای ${r} رندر شد`, !err && changed && html.length > 200,
     err ? err.message.slice(0, 70) : `${html.length} بایت، ${fetchCount - before.fetch} درخواست`);
  if (!err && html.length <= 1200) console.log(`     ↳ ${r} (${html.length}): ${html.replace(/\s+/g," ").slice(0, 300)}`);
  if (!err && html.length > 200) {
    const bad = html.match(BAD);
    ck(`  ← بدون «undefined»/«NaN»/«[object Object]»`, !bad,
       bad ? `«${bad[0]}» یافت شد` : "");
  }
}

console.log("\n۳) محتوای واقعی در خروجی رندر");
{
  await goto("invoices");
  const inv = viewEl.innerHTML || "";
  ck("شمارهٔ فاکتور در فهرست", inv.includes("UI-1001"));
  ck("فروشنده در فهرست", inv.includes("فروشگاه رابط"));

  await goto("dashboard");
  const dash = viewEl.innerHTML || "";
  /* مبلغ کل ۱٬۲۰۰٬۰۰۰ است؛ moneyShort آن را کوتاه می‌کند (۱٫۲ میلیون) */
  ck("داشبورد کارت «جمع مبالغ» دارد", dash.includes("جمع مبالغ"), `${dash.length} بایت`);
  ck("داشبورد مبلغ را غیرصفر نشان می‌دهد",
     /۱[.,٫]?۲|1[.,]2|۱[\.٫]۲۰۰|1[.,]200/.test(dash) || dash.includes("میلیون"),
     (dash.match(/[^>]*میلیون[^<]*/) || [""])[0].slice(0, 60));

  await goto("features");
  const feat = viewEl.innerHTML || "";
  ck("صفحهٔ قابلیت‌ها ۱۲۰ را می‌گوید", feat.includes("۱۲۰") || feat.includes("120"));

  await goto("admin");
  const admin = viewEl.innerHTML || "";
  ck("پنل مدیریت برای مالک باز می‌شود", admin.length > 300 && !admin.includes("مجاز نیست"));

  /* نمای فاکتور تک با پارامتر */
  const invList = await srv.request({ action: "invoices", cookie: ses.cookie });
  const invId = invList.data.items[0].id;
  win.location.hash = "#/invoices/" + invId;
  for (const fn of hashFns) await fn({ type: "hashchange" });
  await new Promise((r) => setTimeout(r, 700));
  const det = viewEl.innerHTML || "";
  ck("جزئیات فاکتور باز شد", det.includes("UI-1001") || det.includes("فروشگاه رابط"),
     `${det.length} بایت`);
}

console.log("\n۴) متا");
const meta = await srv.request({ action: "meta" });
ck("نام برنامه در متا", meta.data.app.name === "فاکتورخوان");
ck("۱۲۰ قابلیت", meta.data.features_total === 120);

console.log("\n۵) قرارداد نشانی‌ها");
{
  const bad = seenUrls.filter((u) => /\?(?![^?]*=)/.test(u.slice(u.indexOf("?") + 1)) && u.includes("?action=") && (u.match(/\?/g) || []).length > 1);
  ck("هیچ نشانی‌ای «؟» دوم ندارد", bad.length === 0, bad.slice(0, 2).join(" | "));
  ck("همهٔ نشانی‌ها نسبی‌اند (بدون /api/)", seenUrls.every((u) => !u.startsWith("/api/")),
     seenUrls.find((u) => u.startsWith("/api/")) || "");
  ck("همه action دارند", seenUrls.every((u) => u.includes("action=")));
}

console.log("\n" + "═".repeat(64));
console.log(fails === 0 ? `✓ همهٔ ${checks} بررسی رندر موفق` : `✗ ${fails} از ${checks} بررسی ناموفق`);
console.log("═".repeat(64));
process.exit(fails === 0 ? 0 : 1);
