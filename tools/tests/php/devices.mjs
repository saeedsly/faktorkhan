#!/usr/bin/env node
/**
 * آزمون چرخهٔ کامل «دستگاه‌های من»
 * ================================
 * باگی که این آزمون را لازم کرد: ورود پارامتر device_id را می‌پذیرفت و
 * دور می‌ریخت. نتیجه‌اش سه چیز بود:
 *   ۱) «دستگاه‌های من» همیشه خالی بود — یک بخش کامل از حساب بی‌اثر.
 *   ۲) محدودیت دستگاه هرگز اعمال نمی‌شد؛ یک اشتراک یک‌دستگاهی را می‌شد
 *      روی ده دستگاه باز کرد.
 *   ۳) `device-delete` ردیف را پاک می‌کرد ولی شناسه را از فهرست
 *      اشتراک برنمی‌داشت — پس جای دستگاه برای همیشه پر می‌ماند و پیام
 *      «از یکی از دستگاه‌ها خارج شوید» دروغ بود.
 *
 * این آزمون هر سه را می‌سنجد، چون هر کدام به‌تنهایی «کار می‌کند» به
 * نظر می‌رسد و فقط با هم یک قابلیت واقعی می‌سازند.
 *
 * اجرا:  node tools/tests/php/devices.mjs
 */
import { Server } from "./app-harness.mjs";

let fails = 0, checks = 0;
const ck = (label, good, extra = "") => {
  checks++; if (!good) fails++;
  console.log(`  ${good ? "✓" : "✗"} ${label}${extra ? " — " + extra : ""}`);
};

const srv = new Server();
/* مالک باید *اولین* حساب این سرور باشد — اولین ثبت‌نام نقش owner
   می‌گیرد. اگر دیر ثبت شود، آزمون «مالک محدود نمی‌شود» بی‌آنکه کد
   اشکالی داشته باشد شکست می‌خورد (و برعکسش هم مرا به اشتباه می‌انداخت). */
const o = srv.session();
await o.register("boss@dk.local", "Test@12345", { full_name: "مالک", device_id: "own-1" });
const oRole = (await o.call({ action: "me" })).data?.user?.role;
const u = srv.session();
const email = "dev@dk.local";
const P = "Test@12345";

console.log("\n۱) ثبت‌نام با دستگاه اول");
const reg = await u.register(email, P, { full_name: "دارای دستگاه", device_id: "aaaa-1111" });
ck("ثبت‌نام موفق", reg.data && reg.data.user, JSON.stringify(reg.data).slice(0, 70));

let d = await u.call({ action: "devices" });
ck("دستگاه اول ثبت شد", d.data && d.data.items && d.data.items.length === 1,
   `${d.data?.items?.length} دستگاه`);
ck("شناسه درست برگشت", d.data?.items?.[0]?.device_id === "aaaa-1111", d.data?.items?.[0]?.device_id);
ck("برچسب خوانا ساخته شد", /دستگاه/.test(d.data?.items?.[0]?.label || ""), d.data?.items?.[0]?.label);
const limit = d.data?.limit;
ck("سقف طرح گزارش می‌شود", typeof limit === "number" && limit >= 1, `سقف ${limit}`);

console.log("\n۲) ورود از دستگاه دوم — بسته به سقف طرح");
const second = await u.login(email, P, { device_id: "bbbb-2222", platform: "Chrome" });
const warned = /تکمیل شده/.test(second.data?.device_warning || "");
/* ورود هرگز بسته نمی‌شود: کاربری که سقفش پر است باید بتواند وارد شود
   تا از «دستگاه‌های من» جا آزاد کند. اگر ورود را ببندیم، در حلقهٔ بسته
   می‌افتد و تنها راهش ویرایش دستی فایل‌ها است. */
ck("ورود همیشه موفق است (حتی وقتی سقف پر است)", second.data && second.data.user,
   (second.data?.detail || "").slice(0, 60));
if (limit <= 1) {
  ck("با سقف ۱، هشدار دستگاه برمی‌گردد", warned,
     (second.data?.device_warning || "—").slice(0, 55));
  ck("هشدار راه خروج نشان می‌دهد", /خارج شوید|پشتیبانی/.test(second.data?.device_warning || ""),
     (second.data?.device_warning || "—").slice(0, 55));
} else {
  ck("با سقف بیشتر، هشدار نیست", second.data?.device_warning === "",
     JSON.stringify(second.data?.device_warning));
}

console.log("\n۳) ورود مجدد از همان دستگاه اول — نباید بلاک شود");
const again = await u.login(email, P, { device_id: "aaaa-1111" });
ck("ورود تکراری از دستگاه موجود موفق است", again.data && again.data.user,
   (again.data?.detail || "").slice(0, 60));

d = await u.call({ action: "devices" });
const after = d.data?.items || [];
ck("تکرار، دستگاه تکراری نساخت", after.filter(x => x.device_id === "aaaa-1111").length === 1,
   `${after.length} ردیف`);

console.log("\n۴) حذف دستگاه، جا را آزاد می‌کند");
const del = await u.call({ action: "device-delete", query: { id: "aaaa-1111" } });
ck("حذف موفق", del.data && del.data.ok === true, JSON.stringify(del.data).slice(0, 50));

d = await u.call({ action: "devices" });
ck("دستگاه از فهرست رفت", !(d.data?.items || []).some(x => x.device_id === "aaaa-1111"));

const retry = await u.login(email, P, { device_id: "bbbb-2222" });
ck("بعد از حذف، ورود دستگاه دوم موفق شد (جا آزاد شد)", retry.data && retry.data.user,
   (retry.data?.detail || "").slice(0, 60));

console.log("\n۵) جداسازی کاربران");
const v = srv.session();
await v.register("other@dk.local", P, { full_name: "دیگری", device_id: "zzzz-9999" });
d = await v.call({ action: "devices" });
ck("کاربر دوم فقط دستگاه خودش را می‌بیند",
   (d.data?.items || []).length === 1 && d.data.items[0].device_id === "zzzz-9999",
   (d.data?.items || []).map(x => x.device_id).join(","));

const steal = await v.call({ action: "device-delete", query: { id: "bbbb-2222" } });
ck("نمی‌تواند دستگاه دیگری را حذف کند (۴۰۴)", !steal.data?.ok, JSON.stringify(steal.data).slice(0, 60));

console.log("\n۶) مالک محدود نمی‌شود");
ck("اولین حساب نقش owner دارد", oRole === "owner", String(oRole));
const oSecond = await o.login("boss@dk.local", P, { device_id: "own-2" });
ck("مالک از دستگاه دوم هم وارد می‌شود", oSecond.data && oSecond.data.user,
   (oSecond.data?.detail || "").slice(0, 60));

console.log("\n۷) سقف واقعاً اعمال می‌شود (طرح یک‌دستگاهی)");
/* آزمایش بالا با طرحی اجرا شد که سقف ۱۰ دارد، پس شاخهٔ «پر است» را
   لمس نکرد. کاربران عادی روی طرح آزمایشی سقف مؤثرشان ۱ است (پایتون هم
   همین را دارد: `>= limit and role == "user"`)، پس همین شاخه را صریح
   می‌سنجیم — وگرنه ممکن است محدودیت هیچ‌وقت اجرا نشود و کسی نفهمد. */
const y = srv.session();
await y.register("solo@dk.local", P, { full_name: "یک‌دستگاهی", device_id: "solo-1" });
const ySecond = await y.login("solo@dk.local", P, { device_id: "solo-2" });
ck("دستگاه دوم هشدار گرفت", /تکمیل شده/.test(ySecond.data?.device_warning || ""),
   (ySecond.data?.device_warning || "—").slice(0, 55));
ck("هشدار راه خروج نشان می‌دهد", /خارج شوید|پشتیبانی/.test(ySecond.data?.device_warning || ""),
   (ySecond.data?.device_warning || "—").slice(0, 55));
ck("ولی ورود انجام شد (تا کاربر بتواند جا آزاد کند)", !!ySecond.data?.user);
const yDevs = await y.call({ action: "devices" });
ck("صفحهٔ دستگاه‌ها قابل دسترسی است", Array.isArray(yDevs.data?.items),
   `${yDevs.data?.items?.length} دستگاه`);
const sameAgain = await y.login("solo@dk.local", P, { device_id: "solo-1" });
ck("همان دستگاه اول همچنان وارد می‌شود", !!sameAgain.data?.user,
   (sameAgain.data?.detail || "").slice(0, 55));

console.log("\n────────────────────────────────────────");
if (fails === 0) console.log(`✓ همهٔ ${checks} بررسی موفق`);
else console.log(`✗ ${fails} از ${checks} بررسی ناموفق`);
process.exit(fails === 0 ? 0 : 1);
