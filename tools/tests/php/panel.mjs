#!/usr/bin/env node
/**
 * تست پنل کامل نسخهٔ PHP — همان قابلیت‌های نسخهٔ پایتون
 * ====================================================
 * چه چیزی سنجیده می‌شود؟ کاربر صریح گفت: «مثل برنامه‌ای که با پایتون
 * نوشتی — داشبورد، تنظیمات، همه‌چیز، اشتراک‌ها». پس این تست همان
 * قراردادهایی را می‌سنجد که رابط مشترک انتظار دارد:
 *
 *   ۱) متا و ۱۲۰ قابلیت و معرفی پدیدآورنده
 *   ۲) ثبت‌نام مالک، ورود، نشست، خروج
 *   ۳) ساخت کاربر دوم + جلوگیری از ثبت‌نام تکراری
 *   ۴) طرح‌ها و اشتراک و فعال‌سازی کد (فقط یک‌بار)
 *   ۵) فاکتور: ساخت، فهرست، آمار، ویرایش، حذف، گروهی، خروجی CSV
 *   ۶) پنل مدیریت: نمای کلی، کاربران، طرح‌ها، کدها، تنظیمات، رویدادها
 *   ۷) جداسازی دادهٔ کاربران (کاربر عادی نباید فاکتور دیگری را ببیند)
 *   ۸) فهم اقلام از متن و اصلاح اعداد
 *
 * اجرا:  node tools/tests/php/panel.mjs
 */
import { Server } from "./app-harness.mjs";

let fails = 0;
let checks = 0;
const ck = (label, good, extra = "") => {
  checks++;
  if (!good) fails++;
  console.log(`  ${good ? "✓" : "✗"} ${label}${extra ? " — " + extra : ""}`);
};

const SEC = (t) => console.log(`\n${t}`);

/* همهٔ کاربران روی یک «سرور» — مثل هاست واقعی که یک پوشهٔ داده دارد */
const srv = new Server();
const anon = (opts) => srv.request(opts);
import { readFileSync } from "node:fs";

/* ═════════════════ ۱) عمومی ═════════════════ */

SEC("۱) متا، قابلیت‌ها، پدیدآورنده");
{
  const r = await anon({ action: "meta" });
  const d = r.data || {};
  ck("پاسخ JSON معتبر", !!r.data, r.text.slice(0, 80));
  if (!r.data) { console.log("   RAW:", r.body.slice(0, 300)); }
  ck("نام برنامه", d.app && d.app.name === "فاکتورخوان");
  ck("موتور = php", d.app && d.app.engine === "php", d.app && d.app.engine);
  ck("۱۲۰ قابلیت", d.features_total === 120, String(d.features_total));
  ck("نام پدیدآورنده", d.owner && d.owner.name === "سعید سالاری");
  ck("متن حق معنوی", typeof d.copyright === "string" && d.copyright.includes("سعید سالاری"));
  ck("پرسش‌های متداول", Array.isArray(d.faq) && d.faq.length >= 4, String((d.faq || []).length));
  ck("تنظیمات عمومی", d.settings && "registration_open" in d.settings);

  const f = await anon({ action: "features" });
  ck("فهرست گروه‌ها", f.data && Array.isArray(f.data.groups) && f.data.groups.length === 9,
     String(f.data && f.data.groups.length));
  const items = (f.data.groups || []).reduce((n, g) => n + (g.items || []).length, 0);
  ck("جمع اقلام گروه‌ها = ۱۲۰", items === 120, String(items));

  const h = await anon({ action: "health" });
  ck("سلامت سامانه", h.data && h.data.ok === true);
  ck("سلامت با موتور فایلی", h.data && h.data.database.engine === "json-files");
  ck("بدون توکن، سرویس ابری خاموش", h.data && h.data.cloud.token_set === false);
}

/* ═════════════════ ۲) ثبت‌نام و ورود ═════════════════ */

SEC("۲) ثبت‌نام مالک، ورود، نشست");
const owner = srv.session();
{
  const r = await owner.register("owner@test.local", "Test@12345", { full_name: "سعید تست" });
  const d = r.data || {};
  ck("ثبت‌نام موفق", r.error === false && d.user && d.user.id === 1, r.text.slice(0, 80));
  ck("اولین کاربر = مالک", d.user && d.user.role === "owner");
  ck("مدیر است", d.user && d.user.is_admin === true);
  ck("اشتراک ساخته شد", d.subscription && d.subscription.status === "active");
  ck("سهمیهٔ مالک بزرگ", d.subscription && d.subscription.pages_quota >= 1000000);
  ck("first_user = true", d.first_user === true);

  const me = await owner.call({ action: "me" });
  ck("نشست ماندگار است", me.data && me.data.user && me.data.user.email === "owner@test.local",
     me.text.slice(0, 80));
  ck("دسترسی مدیر در me", me.data.permissions && me.data.permissions.admin === true);

  const dup = await anon({ method: "POST", action: "register",
    json: { full_name: "دوباره", email: "owner@test.local", password: "Test@12345" } });
  ck("ایمیل تکراری رد می‌شود", dup.data && dup.data.detail && dup.data.detail.includes("قبلاً"), dup.text.slice(0,90));

  const bad = await anon({ method: "POST", action: "login",
    json: { email: "owner@test.local", password: "wrong-pass" } });
  ck("رمز اشتباه رد می‌شود", bad.data && bad.data.detail && bad.data.detail.includes("اشتباه"));

  const badEmail = await anon({ method: "POST", action: "register",
    json: { full_name: "x", email: "not-an-email", password: "Test@12345" } });
  ck("ایمیل نامعتبر رد می‌شود", badEmail.data && String(badEmail.data.detail).includes("ایمیل"));
}

/* ═════════════════ ۳) کاربر دوم ═════════════════ */

SEC("۳) کاربر دوم و جداسازی داده");
const second = srv.session();
{
  const r = await second.register("user2@test.local", "Test@12345", { full_name: "کاربر دوم" });
  ck("کاربر دوم ساخته شد", r.data && r.data.user && r.data.user.id === 2, r.text.slice(0, 80));
  ck("نقش = user", r.data.user && r.data.user.role === "user");
  ck("مدیر نیست", r.data.user && r.data.user.is_admin === false);
  ck("دورهٔ آزمایشی", r.data.subscription && r.data.subscription.status === "trialing");
  ck("سهمیهٔ آزمایشی ۵۰", r.data.subscription && r.data.subscription.pages_quota === 50);

  const admin = await second.call({ action: "admin-overview" });
  ck("کاربر عادی به پنل مدیریت نمی‌رسد", admin.data && admin.data.detail && String(admin.data.detail).includes("مدیر"));
}

/* ═════════════════ ۴) طرح‌ها و اشتراک ═════════════════ */

SEC("۴) طرح‌ها، کد اشتراک، فعال‌سازی");
{
  const plans = await second.call({ action: "plans" });
  ck("چهار طرح", plans.data && plans.data.items.length === 4, String(plans.data.items.length));
  ck("طرح یک‌ساله پرچم‌دار", plans.data.items.some((p) => p.is_featured && p.code === "pro-year"));

  /* مدیر کد می‌سازد */
  const planYear = plans.data.items.find((p) => p.code === "pro-year");
  const make = await owner.call({ method: "POST", action: "admin-keys-create",
    json: { plan_id: planYear.id, count: 2, note: "تست" } });
  ck("ساخت دو کد", make.data && make.data.count === 2, JSON.stringify(make.data).slice(0, 90));
  const firstKey = make.data.keys[0];
  ck("قالب کد درست", /^FK-[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$/.test(firstKey), firstKey);

  const check = await second.call({ action: "check-key", query: { key: firstKey } });
  ck("بررسی کد بدون مصرف", check.data && check.data.valid === true && check.data.plan === "حرفه‌ای یک‌ساله",
     JSON.stringify(check.data).slice(0, 90));

  const redeem = await second.call({ method: "POST", action: "redeem", json: { key: firstKey } });
  ck("فعال‌سازی موفق", redeem.data && redeem.data.ok === true, redeem.text.slice(0, 90));
  ck("اشتراک فعال شد", redeem.data && redeem.data.subscription.status === "active");
  /* پایتون: sub.pages_quota = max(sub.pages_quota, 0) + plan.page_quota
     یعنی سهمیهٔ آزمایشی ۵۰ با ۲۰٬۰۰۰ جمع می‌شود، نه اینکه جای آن را بگیرد. */
  ck("سهمیه ۲۰٬۰۵۰ (۵۰ آزمایشی + ۲۰٬۰۰۰)", redeem.data && redeem.data.subscription.pages_quota === 20050,
     String(redeem.data && redeem.data.subscription.pages_quota));

  const again = await second.call({ method: "POST", action: "redeem", json: { key: firstKey } });
  ck("کد دوباره مصرف نمی‌شود", again.data && again.data.detail && String(again.data.detail).includes("قبلاً"));

  const usage = await second.call({ action: "usage" });
  ck("مصرف برمی‌گردد", usage.data && usage.data.pages_quota === 20050 && usage.data.valid === true,
     String(usage.data && usage.data.pages_quota));
  ck("سهمیهٔ باقی‌مانده", usage.data && usage.data.pages_left === 20050, String(usage.data && usage.data.pages_left));

  const keys = await owner.call({ action: "admin-keys" });
  ck("فهرست کدها برای مدیر", keys.data && keys.data.items.length >= 2);
  const used = keys.data.items.find((k) => k.key === firstKey);
  ck("کد مصرف‌شده علامت خورد", used && used.status === "used");
  ck("طرح کد در فهرست", used && used.plan_name === "حرفه‌ای یک‌ساله");
}

/* ═════════════════ ۵) فاکتورها ═════════════════ */

SEC("۵) فاکتور: ساخت، آمار، ویرایش، حذف، خروجی");
let invoiceId = 0;
{
  const empty = await second.call({ action: "invoices" });
  ck("بایگانی خالی", empty.data && empty.data.total === 0);

  const created = await second.call({
    method: "POST", action: "invoice-create",
    json: {
      number: "۱۴۰۴۰۹-۱۱", issue_date: "1404/09/11",
      invoice_type: "printed", seller_name: "فروشگاه آفتاب", buyer_name: "شرکت پارس",
      status: "confirmed", confidence: 92, tags: ["خرید", "آبان"],
      items: [
        { description: "کاغذ A4", qty: 10, unit: "بسته", unit_price: 250000, total: 2500000 },
        { description: "تونر HP", qty: 2, unit: "عدد", unit_price: 450000, total: 900000 },
      ],
    },
  });
  const inv = created.data && created.data.invoice;
  invoiceId = inv && inv.id;
  ck("فاکتور ساخته شد", !!inv, created.text.slice(0, 90));
  ck("دو قلم", inv && inv.items_count === 2, String(inv && inv.items_count));
  ck("جمع اقلام ۳٬۴۰۰٬۰۰۰", inv && inv.subtotal === 3400000, String(inv && inv.subtotal));
  ck("مبلغ کل بازمحاسبه شد", inv && inv.total === 3400000, String(inv && inv.total));
  ck("برچسب ذخیره شد", inv && inv.tags.includes("خرید"));

  const list = await second.call({ action: "invoices" });
  ck("در فهرست آمد", list.data && list.data.total === 1);
  ck("جمع کل در خلاصه", list.data && list.data.summary.sum_total === 3400000);

  const stats = await second.call({ action: "invoice-stats" });
  ck("آمار: تعداد ۱", stats.data && stats.data.counts.total === 1);
  ck("آمار: جمع ۳٬۴۰۰٬۰۰۰", stats.data && stats.data.sums.total === 3400000);
  ck("آمار: یک تأییدشده", stats.data && stats.data.counts.confirmed === 1);
  ck("آمار: تفکیک نوع", stats.data && stats.data.by_type.printed === 1);
  ck("آمار: سری زمانی", stats.data && stats.data.series.length >= 1);
  ck("آمار: بیشترین فروشنده", stats.data && stats.data.top_sellers[0].name === "فروشگاه آفتاب");

  const one = await second.call({ action: "invoice", query: { id: invoiceId } });
  ck("جزئیات با اقلام", one.data && one.data.invoice.items.length === 2);
  ck("تاریخ شمسی فاکتور", one.data.invoice.issue_date === "1404/09/11");

  const updated = await second.call({
    method: "POST", action: "invoice-update", query: { id: invoiceId },
    json: { seller_name: "فروشگاه آفتاب (ویرایش)", status: "archived" },
  });
  ck("ویرایش شد", updated.data && updated.data.invoice.seller_name.includes("ویرایش"));
  ck("وضعیت عوض شد", updated.data && updated.data.invoice.status === "archived");

  const other = await owner.call({ action: "invoices" });
  ck("مالک این فاکتور را نمی‌بیند", other.data && other.data.total === 0,
     `نمایش ${other.data && other.data.total}`);

  const steal = await owner.call({ action: "invoice", query: { id: invoiceId } });
  ck("خواندن فاکتور دیگری ممنوع", steal.data && steal.data.detail && String(steal.data.detail).includes("یافت نشد"),
     steal.text.slice(0, 60));

  const csv = await second.call({ action: "invoice-export", query: { format: "csv" } });
  ck("خروجی CSV", csv.body.includes("شماره") && csv.body.includes("فروشگاه آفتاب"));
  /* php-wasm هنگام تبدیل بایت به رشته BOM را می‌خورد، پس در هارنس
     نمی‌توان وجودش را دید. همان بایت‌ها را مستقیم از سورس بررسی می‌کنیم
     تا مطمئن شویم اکسل فارسی را درست باز می‌کند. */
  {
    const src = readFileSync(new URL("../../../deploy/php/api_helpers.php", import.meta.url), "utf8");
    ck("CSV با BOM (اکسل فارسی)", src.includes("chr(0xEF) . chr(0xBB) . chr(0xBF)"));
  }
  ck("CSV اقلام را دارد", csv.body.includes("کاغذ A4"));

  const bulk = await second.call({ method: "POST", action: "invoice-bulk",
    json: { ids: [invoiceId], action: "confirmed" } });
  ck("عملیات گروهی", bulk.data && bulk.data.affected === 1);
}

/* ═════════════════ ۶) پنل مدیریت ═════════════════ */

SEC("۶) پنل مدیریت");
{
  const ov = await owner.call({ action: "admin-overview" });
  const c = (ov.data && ov.data.counts) || {};
  ck("نمای کلی: دو کاربر", c.users === 2, String(c.users));
  ck("نمای کلی: یک فاکتور", c.invoices === 1, String(c.invoices));
  ck("نمای کلی: اشتراک فعال", c.active_subscriptions >= 1, String(c.active_subscriptions));
  ck("نمای کلی: کدهای آماده", c.keys_unused === 1, String(c.keys_unused));
  ck("درآمد از کد مصرف‌شده", ov.data && ov.data.revenue === 29000000, String(ov.data && ov.data.revenue));

  const users = await owner.call({ action: "admin-users" });
  ck("فهرست کاربران", users.data && users.data.total === 2);
  const reset = await owner.call({ method: "POST", action: "admin-user-reset", query: { id: 2 } });
  const newPassword = reset.data?.password || "";
  ck("بازنشانی رمز", newPassword.startsWith("Fk-"), newPassword);
  ck("رمز جدید طول کافی دارد", newPassword.length >= 10, String(newPassword.length));

  const plans = await owner.call({ action: "admin-plans" });
  ck("طرح‌ها برای مدیر", plans.data && plans.data.items.length === 4);

  const newPlan = await owner.call({ method: "POST", action: "admin-plan",
    json: { code: "test-plan", name: "طرح تست", price: 1000000, duration_days: 30, page_quota: 500 } });
  ck("ساخت طرح", newPlan.data && newPlan.data.ok === true, newPlan.text.slice(0, 80));

  const settings = await owner.call({ action: "admin-settings" });
  ck("تنظیمات خوانده شد", settings.data && settings.data.settings.trial_days === "14");

  const saved = await owner.call({ method: "POST", action: "admin-settings",
    json: { announcement: "نسخهٔ PHP آماده است", trial_days: "21" } });
  ck("تنظیمات ذخیره شد", saved.data && saved.data.settings.trial_days === "21");
  ck("اعلان ذخیره شد", saved.data && saved.data.settings.announcement.includes("PHP"));
  const meta2 = await anon({ action: "meta", state: owner.state });
  ck("اعلان در متا دیده می‌شود", meta2.data && meta2.data.announcement.includes("PHP"));

  /* یک ورود واقعی تا رویداد login هم ثبت شود */
  const third = srv.session();
  await third.login("user2@test.local", newPassword);

  const audit = await owner.call({ action: "admin-audit" });
  ck("گزارش رویداد", audit.data && audit.data.total > 0, String(audit.data && audit.data.total));
  const actions = (audit.data.items || []).map((r) => r.action);
  ck("ورود در گزارش", actions.includes("login"));
  ck("ساخت فاکتور در گزارش", actions.includes("invoice_create"));
  ck("فعال‌سازی کد در گزارش", actions.includes("license_redeem"));

  const ticket = await second.call({ method: "POST", action: "support",
    json: { subject: "سؤال تست", message: "چطور فاکتور دست‌نویس را بخوانم؟", contact: "user2@test.local" } });
  ck("ثبت پیام پشتیبانی", ticket.data && ticket.data.ok === true);
  const tickets = await owner.call({ action: "admin-support" });
  ck("پیام در پنل مدیر", tickets.data && tickets.data.items.length === 1);
  const answered = await owner.call({ method: "POST", action: "admin-ticket-answer",
    query: { id: tickets.data.items[0].id }, json: { answer: "با انتخاب «دست‌نویس»" } });
  ck("پاسخ به پیام", answered.data && answered.data.ticket.status === "answered");

  const tok = await owner.call({ method: "POST", action: "admin-cloud-token", json: { token: "test-token-12345" } });
  ck("ذخیرهٔ توکن", tok.data && tok.data.ok === true);
  const cloud = await owner.call({ action: "admin-cloud" });
  ck("توکن تنظیم شد", cloud.data && cloud.data.token_set === true);
  ck("توکن نمایش داده نمی‌شود", cloud.data && cloud.data.visible === false);
  ck("توکن فقط ماسک", cloud.data && !String(cloud.data.token_hint).includes("test-token"),
     String(cloud.data && cloud.data.token_hint));
  const clr = await owner.call({ method: "POST", action: "admin-cloud-token", json: { clear: true } });
  ck("حذف توکن", clr.data && clr.data.ok === true);

  const backup = await owner.call({ action: "admin-backup" });
  ck("پشتیبان‌گیری", backup.body.includes("users") && backup.body.includes("license_keys"));
  ck("رمز در پشتیبان نیست", !backup.body.includes("password_hash"));
}

/* ═════════════════ ۷) فهم اقلام ═════════════════ */

SEC("۷) فهم اقلام و اصلاح اعداد");
{
  const text = [
    "فروشگاه لوازم اداری آفتاب",
    "شماره فاکتور: ۱۲۳۴",
    "تاریخ: 1404/08/12",
    "شرح\tتعداد\tقیمت\tمبلغ",
    "کاغذ A4\t10\t250,000\t2,500,000",
    "تونر HP\t2\t450,000\t900,000",
    "جمع کل: 3,400,000",
  ].join("\n");

  const u = await second.call({ method: "POST", action: "invoice-understand", json: { text, invoice_type: "printed" } });
  ck("فهم اقلام موفق", u.data && !u.data.detail, u.text.slice(0, 100));
  ck("دو قلم فهمید", u.data && u.data.item_count === 2, String(u.data && u.data.item_count));
  ck("جمع اقلام درست", u.data && u.data.items_sum === 3400000, String(u.data && u.data.items_sum));
  ck("شمارهٔ فاکتور", u.data && u.data.parsed.number.includes("1234"), u.data && u.data.parsed.number);
  ck("فروشنده", u.data && u.data.parsed.seller_name.includes("آفتاب"), u.data && u.data.parsed.seller_name);

  const fixed = await second.call({ method: "POST", action: "invoice-fix-numbers", json: {
    items: [{ description: "کالا", qty: 10, unit_price: 250000, total: 2000000 }],
    totals: { subtotal: 2000000, total: 2000000 },
  } });
  ck("اصلاح عدد غلط", fixed.data && fixed.data.items[0].total === 2500000,
     JSON.stringify(fixed.data && fixed.data.items[0]).slice(0, 100));
  ck("اصلاح گزارش می‌شود", fixed.data && fixed.data.changes.length >= 1);

  const empty = await second.call({ method: "POST", action: "invoice-understand", json: { text: "سلام" } });
  ck("متن بی‌قلم رد می‌شود", empty.data && empty.data.detail && String(empty.data.detail).includes("قلم"));
}

/* ═════════════════ ۸) حذف و خروج ═════════════════ */

SEC("۸) حذف فاکتور و خروج از حساب");
{
  const del = await second.call({ method: "POST", action: "invoice-delete", query: { id: invoiceId } });
  ck("حذف فاکتور", del.data && del.data.ok === true);
  const after = await second.call({ action: "invoices" });
  ck("پس از حذف خالی است", after.data && after.data.total === 0);

  const out = await second.call({ method: "POST", action: "logout" });
  ck("خروج موفق", out.data && out.data.ok === true);
  const me = await second.call({ action: "me" });
  ck("پس از خروج نشست بسته است", me.data && me.data.detail, me.text.slice(0, 60));
}

console.log("\n" + "═".repeat(64));
console.log(fails === 0 ? `✓ همهٔ ${checks} بررسی موفق` : `✗ ${fails} از ${checks} بررسی ناموفق`);
console.log("═".repeat(64));
process.exit(fails === 0 ? 0 : 1);
