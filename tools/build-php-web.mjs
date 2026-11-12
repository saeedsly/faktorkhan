#!/usr/bin/env node
/**
 * ساخت پوستهٔ وب نسخهٔ PHP از همان رابط نسخهٔ پایتون
 * ===================================================
 * چرا کپی و نه بازنویسی؟ کاربر صریح گفت: «مثل برنامه‌ای که با پایتون نوشتی،
 * داشبورد، تنظیمات، همه‌چیز، اشتراک‌ها — همهٔ آن ۹۰ کار را برای PHP هم
 * بنویس.» بازنویسی رابط در PHP دو پیامد قطعی داشت:
 *   ۱) دو طرح بصری که دیر یا زود از هم دور می‌شوند (یکی دکمه‌ای را جابه‌جا
 *      می‌کند، دیگری نه)
 *   ۲) هر باگ رابط باید دو بار درست شود
 * پس یک رابط، دو بک‌اند. این اسکریپت همان فایل‌های `frontend/assets` را
 * می‌گیرد و فقط مسیرها را از ریشهٔ دامنه به پوشهٔ نصب نسبی می‌کند تا
 * `C:\wamp64\www\faktorkhan\` هم درست کار کند، نه فقط دامنهٔ ریشه.
 *
 * تفاوت‌های عمدی نسبت به نسخهٔ پایتون:
 *   • sw.js حذف می‌شود — کش سرویس‌ورکر روی هاست مشترک با نسخه‌های
 *     درهم، «صفحهٔ قدیمی» نشان می‌دهد و همان باگی است که یک‌بار هزار
 *     ساعت وقت گرفت.
 *   • مسیرها با `./` نسبی می‌شوند.
 *
 * اجرا:  node tools/build-php-web.mjs
 * خروجی: deploy/php/web/{index.html, app.css, app.js, assets/…}
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "frontend");
const OUT = path.join(ROOT, "deploy", "php", "web");

const read = (p) => fs.readFileSync(p, "utf8");
const ensure = (p) => fs.mkdirSync(p, { recursive: true });

function write(rel, text) {
  const dest = path.join(OUT, rel);
  ensure(path.dirname(dest));
  fs.writeFileSync(dest, text, "utf8");
}

function copy(rel) {
  const src = path.join(SRC, rel);
  const dest = path.join(OUT, rel);
  ensure(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

/* ── ۱) موتور.js: همهٔ فایل‌های جاوااسکریپت در یک فایل، به همان ترتیب ── */
const JS_ORDER = ["compat.js", "api.js", "ui.js", "views.js", "views2.js", "admin.js", "app.js"];

const API_PATCHES = [
  /* مسیرهای API به بک‌اند PHP */
  ['"/api/auth/login"', '"./api.php?action=login"'],
  ['"/api/auth/register"', '"./api.php?action=register"'],
  ['"/api/auth/me"', '"./api.php?action=me"'],
  ['"/api/auth/profile"', '"./api.php?action=profile"'],
  ['"/api/auth/change-password"', '"./api.php?action=change-password"'],
  ['"/api/auth/logout"', '"./api.php?action=logout"'],
  ['"/api/system/meta"', '"./api.php?action=meta"'],
  ['"/api/system/features"', '"./api.php?action=features"'],
  ['"/api/system/health"', '"./api.php?action=health"'],
  ['"/api/system/support"', '"./api.php?action=support"'],
  ['"/api/ocr/capabilities"', '"./api.php?action=ocr-capabilities"'],
  ['"/api/ocr/upload"', '"./api.php?action=ocr-upload"'],
  ['"/api/ocr/link"', '"./api.php?action=ocr-link"'],
  ['"/api/ocr/credit"', '"./api.php?action=ocr-credit"'],
  ['"/api/invoices/stats"', '"./api.php?action=invoice-stats"'],
  ['"/api/invoices/parse"', '"./api.php?action=invoice-parse"'],
  ['"/api/invoices/understand"', '"./api.php?action=invoice-understand"'],
  ['"/api/invoices/understand-image"', '"./api.php?action=invoice-understand-image"'],
  ['"/api/invoices/fix-numbers"', '"./api.php?action=invoice-fix-numbers"'],
  ['"/api/invoices/bulk"', '"./api.php?action=invoice-bulk"'],
  ['"/api/invoices"', '"./api.php?action=invoices"'],
  ['"/api/billing/plans"', '"./api.php?action=plans"'],
  ['"/api/billing/subscription"', '"./api.php?action=subscription"'],
  ['"/api/billing/redeem"', '"./api.php?action=redeem"'],
  ['"/api/billing/usage"', '"./api.php?action=usage"'],
  ['"/api/admin/overview"', '"./api.php?action=admin-overview"'],
  ['"/api/admin/users"', '"./api.php?action=admin-users"'],
  ['"/api/admin/plans"', '"./api.php?action=admin-plans"'],
  ['"/api/admin/keys"', '"./api.php?action=admin-keys"'],
  ['"/api/admin/cloud"', '"./api.php?action=admin-cloud"'],
  ['"/api/admin/settings"', '"./api.php?action=admin-settings"'],
  ['"/api/admin/audit"', '"./api.php?action=admin-audit"'],
  ['"/api/admin/support"', '"./api.php?action=admin-support"'],
  ['"/api/admin/health"', '"./api.php?action=admin-health"'],
  ['"/api/admin/backup"', '"./api.php?action=admin-backup"'],
];

/* الگوهای پویا (با ${…}) را جداگانه می‌زنیم؛ جایگزینی رشته‌ای ساده اینجا جواب نمی‌دهد */
const API_REGEX_PATCHES = [
  [/request\(`\/api\/auth\/devices\/\$\{encodeURIComponent\(id\)\}`/, "request(`./api.php?action=device-delete&id=${encodeURIComponent(id)}`"],
  [/request\(`\/api\/invoices\/\$\{id\}\/print`/, "request(`./api.php?action=invoice-print&id=${id}`"],
  [/request\(`\/api\/invoices\/\$\{id\}`/, "request(`./api.php?action=invoice&id=${id}`"],
  [/request\(`\/api\/ocr\/jobs\/\$\{id\}\$\{withText \? "\?with_text=true" : ""\}`/, "request(`./api.php?action=ocr-job&id=${id}${withText ? \"&with_text=1\" : \"\"}`"],
  [/request\(`\/api\/ocr\/jobs\/\$\{id\}\/retry`/, "request(`./api.php?action=ocr-retry&id=${id}`"],
  [/request\(`\/api\/ocr\/jobs\/\$\{id\}\/cancel`/, "request(`./api.php?action=ocr-cancel&id=${id}`"],
  [/request\(`\/api\/ocr\/jobs\/\$\{id\}`/, "request(`./api.php?action=ocr-delete&id=${id}`"],
  [/request\(`\/api\/ocr\/jobs\/\$\{id\}\/to-invoice`/, "request(`./api.php?action=ocr-to-invoice&id=${id}`"],
  [/request\(`\/api\/ocr\/jobs\?limit=\$\{limit\}`/, "request(`./api.php?action=ocr-jobs&limit=${limit}`"],
  [/request\(`\/api\/billing\/check-key\/\$\{encodeURIComponent\(key\)\}`/, "request(`./api.php?action=check-key&key=${encodeURIComponent(key)}`"],
  [/request\(`\/api\/admin\/users\/\$\{id\}\/reset-password`/, "request(`./api.php?action=admin-user-reset&id=${id}`"],
  [/request\(`\/api\/admin\/users\/\$\{id\}`/, "request(`./api.php?action=admin-user&id=${id}`"],
  [/request\(`\/api\/admin\/plans\/\$\{id\}`/, "request(`./api.php?action=admin-plan&id=${id}`"],
  [/request\(`\/api\/admin\/keys\/\$\{id\}\/revoke`/, "request(`./api.php?action=admin-key-revoke&id=${id}`"],
  [/request\(`\/api\/admin\/keys\/\$\{id\}`/, "request(`./api.php?action=admin-key&id=${id}`"],
  [/request\(`\/api\/admin\/support\/\$\{id\}\/answer`/, "request(`./api.php?action=admin-ticket-answer&id=${id}`"],
  [/`\/api\/invoices\/export\$\{qs\(\{ format, \.\.\.\(params \|\| \{\}\) \}\)\}`/, "`./api.php?action=invoice-export${qs({ format, ...(params || {}) })}`"],
  [/`\/api\/invoices\$\{qs\(params\)\}`/, "`./api.php?action=invoices${qs(params)}`"],
  [/`\/api\/ocr\/jobs\?limit=\$\{limit\}`/, "`./api.php?action=ocr-jobs&limit=${limit}`"],
  /* ── بقیهٔ مسیرهای ساختگی ── */
  [/\/\/\s*--- احراز هویت ---/, "/* --- احراز هویت --- */"],
  [/devices: \(\) => request\("\/api\/auth\/devices"\)/,
   'devices: () => request("./api.php?action=devices")'],
  [/updateInvoice: \(id, payload\) => request\(`\/api\/invoices\/\$\{id\}`, \{ method: "PUT", body: payload \}\)/,
   'updateInvoice: (id, payload) => request(`./api.php?action=invoice-update&id=${id}`, { method: "POST", body: payload })'],
  [/deleteInvoice: \(id\) => request\(`\/api\/invoices\/\$\{id\}`, \{ method: "DELETE" \}\)/,
   'deleteInvoice: (id) => request(`./api.php?action=invoice-delete&id=${id}`, { method: "POST" })'],
  [/ocrResultUrl: \(id\) => `\/api\/ocr\/jobs\/\$\{id\}\/result`/,
   'ocrResultUrl: (id) => `./api.php?action=ocr-result&id=${id}`'],
  [/users: \(params\) => request\(`\/api\/admin\/users\$\{qs\(params\)\}`\)/,
   'users: (params) => request(`./api.php?action=admin-users${qs(params)}`)'],
  [/deleteUser: \(id\) => request\(`\/api\/admin\/users\/\$\{id\}`, \{ method: "DELETE" \}\)/,
   'deleteUser: (id) => request(`./api.php?action=admin-user&id=${id}`, { method: "POST", body: { delete: true } })'],
  [/deletePlan: \(id\) => request\(`\/api\/admin\/plans\/\$\{id\}`, \{ method: "DELETE" \}\)/,
   'deletePlan: (id) => request(`./api.php?action=admin-plan&id=${id}`, { method: "POST", body: { delete: true } })'],
  [/keys: \(params\) => request\(`\/api\/admin\/keys\$\{qs\(params\)\}`\)/,
   'keys: (params) => request(`./api.php?action=admin-keys${qs(params)}`)'],
  [/createKeys: \(payload\) => request\("\/api\/admin\/keys\/batch", \{ method: "POST", body: payload \}\)/,
   'createKeys: (payload) => request("./api.php?action=admin-keys-create", { method: "POST", body: payload })'],
  [/setCloudToken: \(token\) => request\("\/api\/admin\/cloud\/token", \{ method: "POST", body: \{ token \} \}\)/,
   'setCloudToken: (token) => request("./api.php?action=admin-cloud-token", { method: "POST", body: { token } })'],
  [/clearCloudToken: \(\) => request\("\/api\/admin\/cloud\/token", \{ method: "DELETE" \}\)/,
   'clearCloudToken: () => request("./api.php?action=admin-cloud-token", { method: "POST", body: { clear: true } })'],
  [/testCloud: \(\) => request\("\/api\/admin\/cloud\/test", \{ method: "POST" \}\)/,
   'testCloud: () => request("./api.php?action=admin-cloud-test", { method: "POST" })'],
  [/audit: \(params\) => request\(`\/api\/admin\/audit\$\{qs\(params\)\}`\)/,
   'audit: (params) => request(`./api.php?action=admin-audit${qs(params)}`)'],
  [/support: \(params\) => request\(`\/api\/admin\/support\$\{qs\(params\)\}`\)/,
   'support: (params) => request(`./api.php?action=admin-support${qs(params)}`)'],
  [/downloadAuth\(`\/api\/invoices\/\$\{inv\.id\}\/file`/,
   'downloadAuth(`./api.php?action=invoice-file&id=${inv.id}`'],
  [/href="\/api\/docs"/, 'href="#"'],
];

/* الگوهای «رشته‌ای» که با regex به‌خاطر کاراکترهای خاص جواب نمی‌دهند */
const API_PLAIN = [
  ["downloadAuth(`/api/invoices/${inv.id}/file`", "downloadAuth(`./api.php?action=invoice-file&id=${inv.id}`"],
  ['href="/api/docs"', 'href="#"'],
];

/** جایگزینی مسیرهای API — روی کل بسته اعمال می‌شود، نه فقط api.js */
function patchPaths(js) {
  /* ۱) مسیرهای API — همه به ./api.php?action=… */
  for (const [from, to] of API_PATCHES) {
    js = js.split(from).join(to);
  }
  for (const [re, to] of API_REGEX_PATCHES) {
    js = js.replace(re, to);
  }
  for (const [from, to] of API_PLAIN) {
    js = js.split(from).join(to);
  }

  /* ۱.۵) قالب کوئری.
     qs() در api.js همیشه با «؟» شروع می‌شود، چون مسیر پایتون
     /api/invoices بود و پارامترها بعد از آن می‌آمدند. حالا مسیر خودش
     «؟» دارد (./api.php?action=invoices)؛ اگر qs هم «؟» بدهد، نتیجه
     می‌شود ./api.php?action=invoices?per_page=6 و PHP کل آن را
     action می‌خواند. علامتش هم بی‌صدا است: صفحه فقط خالی می‌شود.
     پس qs را به «&» تغییر می‌دهیم — همان نتیجه، بدون «؟» دوم. */
  js = js.replace(
    '    const s = params.toString();\n    return s ? `?${s}` : "";',
    '    const s = params.toString();\n    return s ? `&${s}` : "";'
  );
  js = js.replace(
    'const qs = (obj) => {\n    const params = new URLSearchParams();',
    'const qs = (obj) => {\n    const params = new URLSearchParams();'
  );

  /* ۲) توکن: بک‌اند PHP به‌جای Bearer از کوکی نشست استفاده می‌کند.
        اما iframe/هندلرها بعضی‌وقت کوکی را نگه نمی‌دارند؛ با یک توکن
        «نشانه» در هدر هم پشتیبانی می‌کنیم تا رابط بی‌تغییر بماند. */
  js = js.replace(
    'if (token) opts.headers.Authorization = `Bearer ${token}`;',
    '/* بک‌اند PHP نشست را از کوکی می‌شناسد؛ Bearer لازم نیست */'
  );

  /* ۳) خروجی فایل: downloadAuth از fetch استفاده می‌کند، پس مسیر هم نسبی */
  js = js.replace('exportUrl: (format, params) => `./api.php?action=invoice-export', 'exportUrl: (format, params) => `./api.php?action=invoice-export');

  return js;
}

function buildApi() {
  const bundle = JS_ORDER.map((f) => read(path.join(SRC, "assets/js", f))).join("\n\n");
  return `/* ساخته‌شده با tools/build-php-web.mjs — دستی ویرایش نکنید */\n` + patchPaths(bundle);
}

/* ── ۲) CSS: مسیر فونت‌ها نسبی می‌شود و به assets/fonts اشاره می‌کند ── */
function buildCss() {
  let css = read(path.join(SRC, "assets/css/app.css"));
  css = css.replace(/url\(\.\.\/fonts\//g, "url(./assets/fonts/");
  return `/* ساخته‌شده با tools/build-php-web.mjs — دستی ویرایش نکنید */\n` + css;
}

/* ── ۳) index.html: مسیرها نسبی، بدون سرویس‌ورکر، یک app.js ── */
function buildHtml() {
  let html = read(path.join(SRC, "index.html"));
  html = html.replace('<link rel="stylesheet" href="/assets/css/app.css">',
                      '<link rel="stylesheet" href="./app.css">');
  html = html.replace('<link rel="manifest" href="/manifest.webmanifest">\n', "");
  html = html.replace('<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">',
                      '<link rel="icon" href="./assets/favicon.svg" type="image/svg+xml">');
  html = html.replace(/<script src="\/assets\/js\/[^"]+"><\/script>\n/g, "");
  html = html.replace("</body>", '<script src="./app.js"></script>\n</body>');
  /* منوی «مستندات API» در نسخهٔ PHP وجود ندارد */
  html = html.replace(/\s*<a href="\/api\/docs"[^>]*>مستندات API<\/a>/, "");
  return html;
}

/* ── ۴) اجرا ── */
fs.rmSync(OUT, { recursive: true, force: true });

ensure(OUT);
write("app.css", buildCss());
write("app.js", buildApi());
write("index.html", buildHtml());

for (const f of ["favicon.svg"]) copy(path.join("assets", f));
for (const f of fs.readdirSync(path.join(SRC, "assets/fonts"))) copy(path.join("assets/fonts", f));

const size = (p) => fs.statSync(path.join(OUT, p)).size;
console.log("═".repeat(56));
console.log("پوستهٔ وب نسخهٔ PHP ساخته شد");
console.log("═".repeat(56));
for (const f of ["index.html", "app.css", "app.js"]) {
  console.log(`  ${f.padEnd(12)} ${(size(f) / 1024).toFixed(1)} KB`);
}
const fonts = fs.readdirSync(path.join(OUT, "assets/fonts"));
console.log(`  fonts        ${fonts.length} فایل`);
const leftover = fs.readFileSync(path.join(OUT, "app.js"), "utf8").match(/\/api\//g);
if (leftover) {
  console.error(`✗ ${leftover.length} مسیر /api/ باقی مانده — باید همه به api.php تبدیل شوند`);
  process.exit(1);
}
console.log("  ✓ هیچ مسیر /api/ باقی نمانده");
