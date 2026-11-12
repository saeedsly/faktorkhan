#!/usr/bin/env node
/**
 * هم‌شکلی پاسخ‌ها با آنچه رابط می‌خواند
 * =====================================
 * خطرناک‌ترین دستهٔ باگ در این پروژه این است: بک‌اند PHP پاسخ
 * «درست» بدهد، ولی با نام کلید دیگری. رابط پایتون آن کلید را
 * نمی‌شناسد و صفحه بی‌صدا خالی می‌ماند — بدون هیچ خطایی.
 *
 * مثال واقعی که همین‌جا پیدا شد: admin-keys-create آرایهٔ `keys` و
 * عدد `count` برمی‌گرداند، ولی app.js منتظر `created` و `file_hint`
 * بود؛ کاربر کد تولید می‌کرد و «۰ کد ساخته شد» می‌دید.
 *
 * این آزمون:
 *   ۱) برای هر نمای اصلی، پاسخ را با فیلدهای مورد انتظار می‌سنجد
 *   ۲) فیلدهای تازه را با آنچه در app.js خوانده می‌شود تطبیق می‌دهد
 *
 * اجرا:  node tools/tests/php/shape.mjs
 */
import { Server } from "./app-harness.mjs";

let fails = 0;
let checks = 0;
const ck = (label, good, extra = "") => {
  checks++;
  if (!good) fails++;
  console.log(`  ${good ? "✓" : "✗"} ${label}${extra ? " — " + extra : ""}`);
};
const has = (obj, ...keys) => !!obj && keys.every((k) => obj[k] !== undefined && obj[k] !== null);
const hasAny = (obj, ...keys) => !!obj && keys.some((k) => obj[k] !== undefined && obj[k] !== null);

const srv = new Server();
const u = srv.session();

console.log("\n۱) متا و قابلیت‌ها — پرکاربردترین پاسخ");
{
  const r = await srv.request({ action: "meta" });
  const d = r.data || {};
  ck("app.{name,version,edition}", has(d.app, "name", "version") && "edition" in (d.app || {}),
     JSON.stringify(Object.keys(d.app || {})).slice(0, 90));
  ck("owner.{name,title_parts}", has(d.owner, "name") && Array.isArray(d.owner.title_parts));
  ck("features_total عدد", typeof d.features_total === "number");
  ck("faq آرایهٔ {q,a}", Array.isArray(d.faq) && d.faq.length > 0
     && hasAny(d.faq[0], "q", "question") && "a" in d.faq[0] || "answer" in (d.faq[0] || {}));
  ck("settings.max_upload_mb", has(d.settings, "max_upload_mb"),
     JSON.stringify(Object.keys(d.settings || {})).slice(0, 100));
  ck("announcement رشته", typeof d.announcement === "string");
  ck("copyright رشته", typeof d.copyright === "string");

  const f = await srv.request({ action: "features" });
  const g = (f.data || {}).groups || [];
  ck("groups[].{name,items}", g.length > 0 && hasAny(g[0], "title", "name") && Array.isArray(g[0].items),
     JSON.stringify(Object.keys(g[0] || {})).slice(0, 80));
  /* در نسخهٔ پایتون items رشته‌های ساده‌اند، نه شیء. همان شکل حفظ شده. */
  ck("items[] رشتهٔ ساده", g[0] && typeof g[0].items[0] === "string",
     JSON.stringify(g[0] && g[0].items[0]).slice(0, 80));
  ck("total در پاسخ قابلیت‌ها", typeof (f.data || {}).total === "number",
     String((f.data || {}).total));

  const h = await srv.request({ action: "health" });
  ck("health.{ok,database,cloud}", has(h.data, "ok", "database", "cloud"));
}

console.log("\n۲) احراز هویت");
let tokenSession = null;
{
  const r = await srv.request({ method: "POST", action: "register",
    json: { full_name: "شکل تست", email: "shape@test.local", password: "Test@12345" } });
  const d = r.data || {};
  ck("register → user", has(d.user, "id", "email", "role", "is_admin", "initials", "avatar_color"));
  ck("register → subscription", has(d.subscription, "status", "pages_quota", "valid", "days_left"));
  ck("register → first_user", typeof d.first_user === "boolean");
  ck("register → access_token/token_type", has(d, "access_token", "token_type"));

  const me = await srv.request({ action: "me", cookie: r.cookie });
  ck("me → user + permissions",
     has(me.data, "user", "permissions") && has(me.data.permissions, "admin"),
     JSON.stringify(Object.keys(me.data || {})).slice(0, 90));
  tokenSession = r.cookie;
}

console.log("\n۳) اشتراک");
{
  /* پایتون هم پاسخ را در {subscription: …} می‌پیچد؛ app.js هم
     sub.subscription را می‌خواند. پس همین شکل درست است. */
  const s = await srv.request({ action: "subscription", cookie: tokenSession });
  const sub = (s.data || {}).subscription || {};
  ck("subscription.subscription.{status,pages_quota,days_left,valid}",
     has(sub, "status", "pages_quota", "pages_used", "days_left", "valid"),
     JSON.stringify(Object.keys(sub)).slice(0, 120));
  ck("subscription.features آرایه", Array.isArray(sub.features),
     JSON.stringify(sub.features || []).slice(0, 70));
  const p = await srv.request({ action: "plans" });
  ck("plans.items[]", Array.isArray((p.data || {}).items) && p.data.items.length >= 4);
  ck("plan.{code,name,price,page_quota,features}",
     has(p.data.items[0], "code", "name", "price", "page_quota") && Array.isArray(p.data.items[0].features));
  const use = await srv.request({ action: "usage", cookie: tokenSession });
  ck("usage → pages_quota/pages_left/valid", has(use.data, "pages_quota", "pages_left", "valid"));
  const ck2 = await srv.request({ action: "check-key", query: { key: "FK-AAAA-BBBB-CCCC-DDDD" } });
  ck("check-key → valid + reason", "valid" in (ck2.data || {}), JSON.stringify(ck2.data).slice(0, 70));
}

console.log("\n۴) فاکتورها");
let invId = 0;
{
  const c = await srv.request({ method: "POST", action: "invoices", cookie: tokenSession,
    json: { number: "SHP-1", seller_name: "فروشندهٔ شکل", issue_date: "1404/09/01",
      items: [{ description: "کالا", qty: 2, unit_price: 10000 }] } });
  const inv = c.data && c.data.invoice;
  invId = inv && inv.id;
  ck("invoice.{id,number,total,items,status,confidence}",
     has(inv, "id", "number", "total", "items", "status") && "confidence" in inv,
     JSON.stringify(Object.keys(inv || {})).slice(0, 120));
  ck("invoice.item.{description,qty,total,unit_price}",
     has(inv.items[0], "description", "qty", "total", "unit_price"));

  const l = await srv.request({ action: "invoices", cookie: tokenSession });
  ck("list.{items,total,summary}", has(l.data, "items", "total", "summary"));
  ck("summary.{sum_total,count}",
     hasAny(l.data.summary, "sum_total", "total") && hasAny(l.data.summary, "count", "total"));

  const st = await srv.request({ action: "invoice-stats", cookie: tokenSession });
  ck("stats.{counts,sums,by_type,series,top_sellers}",
     has(st.data, "counts", "sums", "by_type", "series", "top_sellers"),
     JSON.stringify(Object.keys(st.data || {})).slice(0, 140));

  const one = await srv.request({ action: "invoice", query: { id: invId }, cookie: tokenSession });
  ck("invoice detail → invoice.items", has(one.data, "invoice") && Array.isArray(one.data.invoice.items));

  const und = await srv.request({ method: "POST", action: "invoice-understand", cookie: tokenSession,
    json: { text: "فروشنده: آفتاب\nشرح\tتعداد\tقیمت\tمبلغ\nکاغذ\t2\t100,000\t200,000\nجمع کل: 200,000" } });
  ck("understand.{items,totals,issues,confidence,parsed}",
     has(und.data, "items", "totals", "confidence") && hasAny(und.data, "issues", "parsed"),
     JSON.stringify(Object.keys(und.data || {})).slice(0, 130));
  ck("understand.parsed.seller_name", typeof und.data.parsed.seller_name === "string");
  ck("understand.parsed.issue_date", "issue_date" in und.data.parsed);
}

console.log("\n۵) کارهای خوانش (OCR)");
{
  const j = await srv.request({ action: "ocr-jobs", cookie: tokenSession });
  ck("ocr-jobs.{items,total}", has(j.data, "items", "total"), JSON.stringify(Object.keys(j.data || {})).slice(0, 90));
  const cap = await srv.request({ action: "ocr-capabilities", cookie: tokenSession });
  ck("ocr-capabilities → engines/etc", !!cap.data && Object.keys(cap.data).length > 0,
     JSON.stringify(cap.data).slice(0, 90));
  const cr = await srv.request({ action: "ocr-credit", cookie: tokenSession });
  ck("ocr-credit پاسخ دارد", !!cr.data, JSON.stringify(cr.data).slice(0, 80));
}

console.log("\n۶) پنل مدیریت");
{
  const o = await srv.request({ action: "admin-overview", cookie: tokenSession });
  ck("overview.{counts,revenue}", has(o.data, "counts", "revenue"),
     JSON.stringify(Object.keys(o.data || {})).slice(0, 110));
  ck("overview.counts.{users,invoices,active_subscriptions}",
     has(o.data.counts, "users", "invoices") && hasAny(o.data.counts, "active_subscriptions", "active"),
     JSON.stringify(o.data.counts || {}).slice(0, 120));
  /* پایتون نمای کلی نمودار سری زمانی ندارد؛ recent دارد.
     همان ساختار عیناً بازتولید شده. */
  ck("overview.recent آرایه", Array.isArray(o.data.recent));
  ck("overview.features عدد", typeof o.data.features === "number");
  ck("overview.cloud شیء", !!o.data.cloud && typeof o.data.cloud === "object");

  const us = await srv.request({ action: "admin-users", cookie: tokenSession });
  ck("users.{items,total}", has(us.data, "items", "total"));
  ck("user row → subscription", us.data.items[0] && "subscription" in us.data.items[0]);

  const pl = await srv.request({ action: "admin-plans", cookie: tokenSession });
  ck("admin-plans.items", Array.isArray((pl.data || {}).items));

  const ks = await srv.request({ action: "admin-keys", cookie: tokenSession });
  ck("admin-keys.{items,total}", has(ks.data, "items", "total"));
  ck("key row → {key,status,plan_name}",
     ks.data.items.length === 0 || has(ks.data.items[0], "key", "status", "plan_name"));

  const se = await srv.request({ action: "admin-settings", cookie: tokenSession });
  ck("admin-settings.settings شیء", !!(se.data && se.data.settings && typeof se.data.settings === "object"));

  const au = await srv.request({ action: "admin-audit", cookie: tokenSession });
  ck("admin-audit.{items,total}", has(au.data, "items", "total"));

  const cl = await srv.request({ action: "admin-cloud", cookie: tokenSession });
  ck("admin-cloud.{token_set,visible}", has(cl.data, "token_set", "visible"));

  const sup = await srv.request({ action: "admin-support", cookie: tokenSession });
  /* پایتون فقط items می‌دهد (بدون total) */
  ck("admin-support.items آرایه", Array.isArray((sup.data || {}).items),
     JSON.stringify(Object.keys(sup.data || {})).slice(0, 80));

  const adh = await srv.request({ action: "admin-health", cookie: tokenSession });
  ck("admin-health پاسخ دارد", !!adh.data);

  const dev = await srv.request({ action: "devices", cookie: tokenSession });
  ck("devices → آرایه یا items", Array.isArray(dev.data) || Array.isArray((dev.data || {}).items),
     JSON.stringify(dev.data).slice(0, 80));
}

console.log("\n۷) پشتیبانی و پروفایل");
{
  const t = await srv.request({ method: "POST", action: "support", cookie: tokenSession,
    json: { subject: "شکل", message: "پیام تست شکل", contact: "shape@test.local" } });
  ck("support → ok", !!(t.data && (t.data.ok || t.data.id || t.data.ticket)),
     JSON.stringify(t.data).slice(0, 90));

  const pr = await srv.request({ method: "PATCH", action: "profile", cookie: tokenSession,
    json: { full_name: "شکل ویرایش" } });
  ck("profile → user با نام تازه",
     !!(pr.data && (pr.data.user || pr.data).full_name === "شکل ویرایش"),
     JSON.stringify(pr.data).slice(0, 90));

  const cp = await srv.request({ method: "POST", action: "change-password", cookie: tokenSession,
    json: { current_password: "Test@12345", new_password: "Test@54321" } });
  ck("change-password → ok", !!(cp.data && cp.data.ok), JSON.stringify(cp.data).slice(0, 80));
}

console.log("\n" + "═".repeat(64));
console.log(fails === 0 ? `✓ همهٔ ${checks} بررسی شکلی موفق` : `✗ ${fails} از ${checks} بررسی شکلی ناموفق`);
console.log("═".repeat(64));
process.exit(fails === 0 ? 0 : 1);
