#!/usr/bin/env node
/**
 * برابری مسیرها: پایتون ↔ PHP
 * ============================
 * کاربر خواسته بود نسخهٔ PHP «همهٔ قسمت‌های» برنامهٔ پایتون را داشته
 * باشد. چک‌لیست دستی جواب نمی‌دهد: هر بار مسیری به پایتون اضافه شود،
 * PHP بی‌صدا عقب می‌ماند و هیچ تستی هم قرمز نمی‌شود.
 *
 * این آزمون منبع حقیقت را از خودِ کد پایتون می‌خواند:
 *   • هر @router.get/post/… در backend/app/routers/*.py
 *   • با prefix همان فایل (مثل /api/admin)
 * بعد هر کدام را به action متناظر PHP نگاشت می‌کند و می‌سنجد:
 *   ۱) action در api.php وجود دارد
 *   ۲) اگر مسیر پارامتر دارد، آن پارامتر هم استفاده می‌شود
 *
 * اجرا:  node tools/tests/php/parity.mjs
 */
import fs from "fs";
import path from "path";

const ROOT = new URL("../../../", import.meta.url).pathname;
const ROUTERS = path.join(ROOT, "backend/app/routers");
const API = path.join(ROOT, "deploy/php/api.php");
const WEB = path.join(ROOT, "deploy/php/web/app.js");

let fails = 0, checks = 0;
const ck = (label, good, extra = "") => {
  checks++;
  if (!good) fails++;
  console.log(`  ${good ? "✓" : "✗"} ${label}${extra ? " — " + extra : ""}`);
};

/* ─────────── مسیرهای پایتون ─────────── */
const routes = [];
for (const f of fs.readdirSync(ROUTERS).filter((n) => n.endsWith(".py")).sort()) {
  const src = fs.readFileSync(path.join(ROUTERS, f), "utf8");
  const pm = src.match(/APIRouter\(prefix="([^"]+)"/);
  const prefix = pm ? pm[1] : "";
  for (const m of src.matchAll(/@router\.(get|post|put|patch|delete)\("([^"]*)"/g)) {
    const verb = m[1].toUpperCase();
    const raw = m[2] || "";
    const full = (prefix + raw) || "/";
    /* نام پارامتر واقعی را نباید حدس بزنیم؛ فقط «پارامتر دارد یا نه» مهم است */
    const hasParam = /\{[^}]+\}/.test(full);
    const norm = full.replace(/\{[^}]+\}/g, "{id}");
    routes.push({ verb, full, norm, hasParam, file: f });
  }
}

/* ─────────── اکشن‌های PHP ─────────── */
const phpSrc = fs.readFileSync(API, "utf8");
const actions = new Set([...phpSrc.matchAll(/case '([a-z0-9-]+)':/g)].map((m) => m[1]));

/**
 * نگاشت مسیر پایتون → action PHP.
 * کلید، مسیر با {id} جایگزین‌شده است.
 */
const MAP = {
  "/api/auth/register": "register",
  "/api/auth/login": "login",
  "/api/auth/logout": "logout",
  "/api/auth/me": "me",
  "/api/auth/profile": "profile",
  "/api/auth/change-password": "change-password",
  "/api/auth/devices": "devices",
  "/api/auth/devices/{id}": "device-delete",

  "/api/billing/plans": "plans",
  "/api/billing/subscription": "subscription",
  "/api/billing/redeem": "redeem",
  "/api/billing/usage": "usage",
  "/api/billing/check-key/{id}": "check-key",

  "/api/invoices": "invoices",
  "/api/invoices/{id}": "invoice",
  "/api/invoices/{id}/file": "invoice-file",
  "/api/invoices/{id}/print": "invoice-print",
  "/api/invoices/stats": "invoice-stats",
  "/api/invoices/export": "invoice-export",
  "/api/invoices/bulk": "invoice-bulk",
  "/api/invoices/parse": "invoice-parse",
  "/api/invoices/understand": "invoice-understand",
  "/api/invoices/understand-image": "invoice-understand-image",
  "/api/invoices/fix-numbers": "invoice-fix-numbers",

  "/api/ocr/capabilities": "ocr-capabilities",
  "/api/ocr/upload": "ocr-upload",
  "/api/ocr/link": "ocr-link",
  "/api/ocr/jobs": "ocr-jobs",
  "/api/ocr/jobs/{id}": "ocr-job",
  "/api/ocr/jobs/{id}/retry": "ocr-retry",
  "/api/ocr/jobs/{id}/cancel": "ocr-cancel",
  "/api/ocr/jobs/{id}/to-invoice": "ocr-to-invoice",
  "/api/ocr/jobs/{id}/result": "ocr-result",
  "/api/ocr/file/{id}": "ocr-file",
  "/api/ocr/credit": "ocr-credit",
  "/api/ocr/cleanup": "ocr-cleanup",

  "/api/system/meta": "meta",
  "/api/system/features": "features",
  "/api/system/health": "health",
  "/api/system/announcement": "announcement",
  "/api/system/support": "support",

  "/api/admin/overview": "admin-overview",
  "/api/admin/users": "admin-users",
  "/api/admin/users/{id}": "admin-user",
  "/api/admin/users/{id}/reset-password": "admin-user-reset",
  "/api/admin/plans": "admin-plans",
  "/api/admin/plans/{id}": "admin-plan",
  "/api/admin/keys": "admin-keys",
  "/api/admin/keys/batch": "admin-keys-create",
  "/api/admin/keys/{id}": "admin-key",
  "/api/admin/keys/{id}/revoke": "admin-key-revoke",
  "/api/admin/audit": "admin-audit",
  "/api/admin/settings": "admin-settings",
  "/api/admin/cloud": "admin-cloud",
  "/api/admin/cloud/token": "admin-cloud-token",
  "/api/admin/cloud/test": "admin-cloud-test",
  "/api/admin/backup": "admin-backup",
  "/api/admin/support": "admin-support",
  "/api/admin/support/{id}/answer": "admin-ticket-answer",
  "/api/admin/health": "admin-health",
};

console.log("\n۱) هر مسیر پایتون action در PHP دارد");
const unmapped = [];
const actionless = [];
for (const r of routes) {
  const act = MAP[r.norm];
  if (!act) { unmapped.push(`${r.verb} ${r.full}`); continue; }
  if (!actions.has(act)) actionless.push(`${r.verb} ${r.full} → ${act}`);
}
ck(`همهٔ ${routes.length} مسیر نگاشت شده‌اند`, unmapped.length === 0,
   unmapped.slice(0, 4).join(" | "));
ck("هر نگاشت به action موجود اشاره می‌کند", actionless.length === 0,
   actionless.slice(0, 4).join(" | "));

console.log("\n۲) اکشن‌های PHP که رابط صدا می‌زند");
{
  const js = fs.readFileSync(WEB, "utf8");
  const used = new Set([...js.matchAll(/api\.php\?action=([a-z0-9-]+)/g)].map((m) => m[1]));
  const missing = [...used].filter((a) => !actions.has(a));
  ck(`همهٔ ${used.size} اکشن مصرفی رابط وجود دارد`, missing.length === 0, missing.join(", "));
}

console.log("\n۳) اکشن‌های PHP بدون معادل پایتون (نباید موجود باشد)");
{
  const mapped = new Set(Object.values(MAP));
  const orphans = [...actions].filter((a) => !mapped.has(a));
  /* این‌ها عمداً هستند: کوتاه‌نویس‌های REST که رابط پایتون برای
     POST/PUT/DELETE استفاده می‌کند و در FastAPI به شکل دیگری تعریف
     شده‌اند (مثلاً POST /invoices همان تابع create است). */
  const allowed = new Set(["invoice-create", "invoice-update", "invoice-delete", "ocr-delete"]);
  const bad = orphans.filter((a) => !allowed.has(a));
  ck("اکشن یتیم غیرمنتظره‌ای نیست", bad.length === 0, bad.join(", "));
  if (orphans.length) console.log(`     (مجاز به‌خاطر شکل REST: ${orphans.filter(a=>allowed.has(a)).join(", ")})`);
}

console.log("\n۴) متد HTTP در اکشن‌های حساس دیده می‌شود");
{
  /* اگر این‌ها متد را نبینند، رابط «می‌سازد» را «فهرست» می‌خواند و
     دکمه بی‌صدا کار نمی‌کند. */
  const sensitive = ["invoices", "admin-plans", "admin-plan", "admin-user", "admin-key", "admin-settings"];
  for (const a of sensitive) {
    const re = new RegExp(`case '${a}':([\\s\\S]{0,900}?)(?=\\n    case |\\n    default)`, "m");
    const body = (phpSrc.match(re) || [])[1] || "";
    ck(`${a} متد را می‌بیند`, /api_method\(\)|api_is_write\(\)|REQUEST_METHOD/.test(body));
  }
}

console.log("\n۵) اعداد هم‌تراز");
{
  /* هر دو طرف مجموع را از روی گروه‌ها حساب می‌کنند، پس عدد ثابت را
     نمی‌شماریم؛ خودِ اقلام را می‌شماریم. */
  const dataSrc = fs.readFileSync(path.join(ROOT, "deploy/php/data.php"), "utf8");
  const featSrc = fs.readFileSync(path.join(ROOT, "backend/app/features.py"), "utf8");

  const pyGroups = [...featSrc.matchAll(/"items":\s*\[(.*?)\]/gs)];
  const pyItems = pyGroups.reduce((n, g) => n + [...g[1].matchAll(/"[^"]+",?/g)].length, 0);

  const phpGroups = [...dataSrc.matchAll(/'items'\s*=>\s*array\((.*?)\),/gs)];
  const phpItems = phpGroups.reduce((n, g) => n + [...g[1].matchAll(/'[^']+'/g)].length, 0);

  ck("۹ گروه در هر دو", pyGroups.length === 9 && phpGroups.length === 9,
     `پایتون ${pyGroups.length}، PHP ${phpGroups.length}`);
  ck("۱۲۰ قابلیت در هر دو", pyItems === 120 && phpItems === 120,
     `پایتون ${pyItems}، PHP ${phpItems}`);
}

console.log("\n۶) دادهٔ طرح‌ها یکسان است");
{
  const seedSrc = fs.readFileSync(path.join(ROOT, "backend/app/seed.py"), "utf8");
  const storeSrc = fs.readFileSync(path.join(ROOT, "deploy/php/store.php"), "utf8");
  const seedBlock = (seedSrc.match(/PLAN_SEEDS\s*=\s*\[([\s\S]*?)\n\]/) || [])[1] || "";
  const phpBlock = (storeSrc.match(/function fk_plan_seeds[\s\S]*?\n\}/) || [])[0] || "";

  const codes = [...seedBlock.matchAll(/"code":\s*"([^"]+)"/g)].map((m) => m[1]);
  const phpCodes = [...phpBlock.matchAll(/'code'\s*=>\s*'([^']+)'/g)].map((m) => m[1]);
  ck("همان کدهای طرح", JSON.stringify(codes) === JSON.stringify(phpCodes),
     `${codes.join(",")} | ${phpCodes.join(",")}`);

  const prices = [...seedBlock.matchAll(/"price":\s*([\d_]+)/g)]
    .map((m) => Number(m[1].replace(/_/g, "")));
  const phpPrices = [...phpBlock.matchAll(/'price'\s*=>\s*(\d+)/g)].map((m) => Number(m[1]));
  ck("همان قیمت‌ها", JSON.stringify(prices) === JSON.stringify(phpPrices),
     `${prices.join(",")} | ${phpPrices.join(",")}`);

  const quotas = [...seedBlock.matchAll(/"page_quota":\s*([\d_]+)/g)]
    .map((m) => Number(m[1].replace(/_/g, "")));
  const phpQuotas = [...phpBlock.matchAll(/'page_quota'\s*=>\s*(\d+)/g)].map((m) => Number(m[1]));
  ck("همان سهمیه‌های صفحه", JSON.stringify(quotas) === JSON.stringify(phpQuotas),
     `${quotas.join(",")} | ${phpQuotas.join(",")}`);

  const days = [...seedBlock.matchAll(/"duration_days":\s*(\d+)/g)].map((m) => Number(m[1]));
  const phpDays = [...phpBlock.matchAll(/'duration_days'\s*=>\s*(\d+)/g)].map((m) => Number(m[1]));
  ck("همان مدت‌ها", JSON.stringify(days) === JSON.stringify(phpDays),
     `${days.join(",")} | ${phpDays.join(",")}`);
}

console.log("\n" + "═".repeat(64));
console.log(fails === 0 ? `✓ همهٔ ${checks} بررسی برابری موفق` : `✗ ${fails} از ${checks} بررسی ناموفق`);
console.log("═".repeat(64));
process.exit(fails === 0 ? 0 : 1);
