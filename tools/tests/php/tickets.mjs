#!/usr/bin/env node
/**
 * آزمون چرخهٔ کامل پشتیبانی
 * ==========================
 * باگ اصلی: کاربر پیام می‌فرستاد و تأییدیه می‌گرفت که «پاسخ از همین
 * بخش پیگیری می‌شود» — ولی هیچ بخشی برای دیدن پاسخ نبود. پاسخ در پنل
 * مدیریت نوشته می‌شد و همان‌جا می‌ماند؛ کاربر فکر می‌کرد پشتیبانی جواب
 * نداده.
 *
 * این آزمون چرخهٔ کامل را می‌سنجد، نه فقط هر اکشن را جدا:
 *   ۱) کاربر پیام می‌فرستد
 *   ۲) مالک آن را در پنل مدیریت می‌بیند
 *   ۳) مالک پاسخ می‌دهد
 *   ۴) کاربر پاسخ را در «پیام‌های من» می‌بیند
 *   ۵) کاربر A پیام‌های کاربر B را نمی‌بیند
 *
 * اجرا:  node tools/tests/php/tickets.mjs
 */
import { Server } from "./app-harness.mjs";

let fails = 0, checks = 0;
const ck = (label, good, extra = "") => {
  checks++; if (!good) fails++;
  console.log(`  ${good ? "✓" : "✗"} ${label}${extra ? " — " + extra : ""}`);
};

const srv = new Server();
const owner = srv.session();
await owner.register("owner@tk.local", "Test@12345", { full_name: "مالک" });
const alice = srv.session();
await alice.register("alice@tk.local", "Test@12345", { full_name: "آلیس" });
const bob = srv.session();
await bob.register("bob@tk.local", "Test@12345", { full_name: "باب" });

console.log("\n۱) ارسال پیام");
const t1 = await alice.call({ method: "POST", action: "support",
  json: { subject: "فاکتور خوانده نمی‌شود", message: "عکس حرارتی را می‌فرستم ولی متن نمی‌آید." } });
ck("پیام آلیس ثبت شد", t1.data && t1.data.ok === true, JSON.stringify(t1.data).slice(0, 60));
ck("شناسه برگشت", Number(t1.data.id) > 0, String(t1.data.id));
const aliceTicketId = Number(t1.data.id);

const t2 = await bob.call({ method: "POST", action: "support",
  json: { subject: "درخواست افزایش سهمیه", message: "به ۵۰۰۰ صفحه نیاز دارم." } });
const bobTicketId = Number(t2.data.id);
ck("پیام باب هم ثبت شد", bobTicketId > 0, String(bobTicketId));

console.log("\n۲) مالک هر دو را در پنل مدیریت می‌بیند");
const adminList = await owner.call({ action: "admin-support" });
const ids = (adminList.data.items || []).map((t) => Number(t.id));
ck("پنل مدیریت هر دو پیام را دارد", ids.includes(aliceTicketId) && ids.includes(bobTicketId),
   ids.join(","));
const one = (adminList.data.items || []).find((t) => Number(t.id) === aliceTicketId) || {};
ck("موضوع درست", one.subject === "فاکتور خوانده نمی‌شود", one.subject);
ck("وضعیت اولیه new", one.status === "new", one.status);

console.log("\n۳) مالک پاسخ می‌دهد");
const a1 = await owner.call({ method: "POST", action: "admin-ticket-answer",
  json: { id: aliceTicketId, answer: "فایل را در بخش خوانش با موتور ابری امتحان کنید." } });
ck("پاسخ ثبت شد", a1.data && a1.data.ok === true);
ck("وضعیت answered شد", (a1.data.ticket || {}).status === "answered",
   (a1.data.ticket || {}).status);

console.log("\n۴) کاربر پاسخ را می‌بیند (باگ اصلی)");
const mine = await alice.call({ action: "my-tickets" });
ck("مسیر my-tickets پاسخ می‌دهد", Array.isArray(mine.data.items),
   mine.data.items ? `${mine.data.items.length} مورد` : JSON.stringify(mine.data).slice(0, 60));
const found = (mine.data.items || []).find((t) => Number(t.id) === aliceTicketId) || {};
ck("پیام آلیس در فهرست خودش هست", Number(found.id) === aliceTicketId);
ck("پاسخ پشتیبانی دیده می‌شود", /موتور ابری/.test(found.answer || ""), (found.answer || "").slice(0, 50));
ck("وضعیت فارسی", found.status_fa === "پاسخ داده شد", found.status_fa);
ck("زمان پاسخ ثبت شده", (found.answered_at || "") !== "", found.answered_at);

console.log("\n۵) جداسازی بین کاربران");
const bobMine = await bob.call({ action: "my-tickets" });
const bobIds = (bobMine.data.items || []).map((t) => Number(t.id));
ck("باب فقط پیام خودش را می‌بیند", bobIds.includes(bobTicketId) && !bobIds.includes(aliceTicketId),
   bobIds.join(","));
const ownerMine = await owner.call({ action: "my-tickets" });
ck("مالک پیام کاربران را در my-tickets نمی‌بیند",
   !(ownerMine.data.items || []).some((t) => [aliceTicketId, bobTicketId].includes(Number(t.id))),
   `${ownerMine.data.total} مورد`);

console.log("\n۶) پاسخ‌نداده‌ها");
const bobTicket = (bobMine.data.items || []).find((t) => Number(t.id) === bobTicketId) || {};
ck("پیام بی‌پاسخ «در انتظار پاسخ» است", bobTicket.status_fa === "در انتظار پاسخ", bobTicket.status_fa);
ck("پاسخش خالی است", (bobTicket.answer || "") === "");

console.log("\n۷) نگهبان ساختاری");
{
  const api = (await import("fs")).readFileSync(
    new URL("../../../deploy/php/api.php", import.meta.url).pathname, "utf8");
  ck("اکشن my-tickets در api.php هست", /case 'my-tickets':/.test(api));
  ck("فقط پیام‌های خودِ کاربر را فیلتر می‌کند",
     /fk_where\('tickets'[\s\S]{0,200}\$uid/.test(api));
  const js = (await import("fs")).readFileSync(
    new URL("../../../deploy/php/web/app.js", import.meta.url).pathname, "utf8");
  ck("رابط آن را صدا می‌زند", js.includes("action=my-tickets"));
  ck("نمای پشتیبانی فهرست پیام‌ها را می‌سازد", js.includes("پیام‌های من"));
}

console.log("\n" + "═".repeat(64));
console.log(fails === 0 ? `✓ همهٔ ${checks} بررسی پشتیبانی موفق` : `✗ ${fails} از ${checks} بررسی ناموفق`);
console.log("═".repeat(64));
process.exit(fails === 0 ? 0 : 1);
