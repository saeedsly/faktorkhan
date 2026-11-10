import { request } from "./runner.mjs";

const CFG = JSON.stringify({ token: "TOK-SECRET-9F8E7D6C" });
const SESSC = 'auth|b:1;csrf|s:6:"CSRF-T";';
const SID = "ABCD0000000000000000000000000001";
const SESSKEY = `fk-sessions/sess_${SID}`;
const ok = v => (v ? "✓" : "✗");
let fails = 0;
const check = (label, cond, extra = "") => { if (!cond) fails++; console.log(`   ${ok(cond)} ${label}${extra ? " — " + extra : ""}`); };

let state = { "fk-config.json": CFG, [SESSKEY]: SESSC };

// ─── ۱) api=start : فقط آپلود، صفر فراخوانی درگاه
let r = await request(state, {
  method: "POST", cookie: SID, get: { api: "start" },
  post: { csrf: "CSRF-T", method: "4", output: "txt", delete_after: "1" },
  files: { document: { name: "فاکتور ۱۲۳.jpg", type: "image/jpeg", tmp_name: "/tmp/in.bin", error: 0, size: 800 } },
});
const j1 = JSON.parse(r.body);
console.log("\n۱) api=start →", j1.job.status, "| stage:", j1.job.stage, "| progress:", j1.job.progress);
check("صفر فراخوانی درگاه در درخواست آپلود", r.calls === "", r.calls);
check("فایل روی سرور ذخیره شد", Object.keys(r.state).some(k => k.startsWith("fk-uploads/in-")));
check("شناسهٔ کار در نشست ثبت شد", r.state[SESSKEY].includes(j1.job.id));
const id = j1.job.id;
state = { ...r.state, "fk-config.json": CFG };  /* نشست با jobs حفظ می‌شود */

// ─── ۲) مسیر واقعی عکس/PDF: addfile → convert(با لینک) → download
const steps = [
  { label: "addfile+convert", queue: [
      { body: JSON.stringify({ Status: "Done", PageCount: "3", FileToken: "FT-777", ConvertMethods: "1,2,3,4" }) },
      { body: JSON.stringify({ Status: "Done", " FileToDownload ": "https://ex.com/out.txt" }) }] },
  { label: "download", queue: [
      { dl: "فروشگاه نمونه\nجمع کل: ۴۵۰٫۰۰۰ ریال" }] },
];
console.log("\n۲) مراحل اجرا (هر خط = یک درخواست کوتاه):");
for (let i = 0; i < steps.length; i++) {
  const res = await request(state, { method: "GET", cookie: SID, get: { api: "job", id }, queue: steps[i].queue });
  let j; try { j = JSON.parse(res.body); } catch { console.log("   پاسخ:", res.body.slice(0, 200)); break; }
  if (!j.ok) { console.log("   خطا:", j.message); break; }
  const ncalls = res.calls ? res.calls.split("\n").filter(Boolean).length : 0;
  console.log(`   ${steps[i].label.padEnd(16)} → stage=${String(j.job.stage).padEnd(8)} progress=${String(j.job.progress).padStart(3)}%  درگاه=${ncalls}`);
  if (ncalls > 2) { fails++; console.log("   ✗ بیش از ۲ فراخوانی درگاه در یک درخواست!"); }
  state = { ...res.state, "fk-config.json": CFG };  /* نشست با jobs حفظ می‌شود */
  if (j.job.status === "done") {
    console.log("   متن:", JSON.stringify(j.job.text).slice(0, 70));
    check("متن استخراج شد", (j.job.text || "").includes("فروشگاه"));
    check("تعداد صفحات ۳", j.job.pages === 3);
    check("روش ۴", j.job.method === 4);
    break;
  }
}

// ─── ۳) پس از پایان: یک درخواست «تسویه» برای حذف فایل ابری، سپس سکوت کامل
r = await request(state, { method: "GET", cookie: SID, get: { api: "job", id } });
const jEnd = JSON.parse(r.body);
console.log("\n۳) تسویه پس از پایان →", jEnd.job.status, "| درگاه:", r.calls || "—");
check("تسویه: فقط پاک‌سازی، بدون تماس اضافی", r.calls.split("\n").filter(Boolean).length <= 1, r.calls || "—");
check("فایل موقت محلی پاک شد", !Object.keys(r.state).some(k => k.startsWith("fk-uploads/in-")));
state = { ...r.state, "fk-config.json": CFG };  /* نشست با jobs حفظ می‌شود */
r = await request(state, { method: "GET", cookie: SID, get: { api: "job", id } });
check("پس از تسویه: هیچ فراخوانی درگاهی", r.calls === "", r.calls);
const jj = JSON.parse(r.body);
check("پرچم cleanup خاموش شد", jj.job.cleanup === false);

// ─── ۴) امنیت: نشست نامعتبر، شناسهٔ ناموجود، CSRF غلط، پسوند غیرمجاز
r = await request({ "fk-config.json": CFG }, { get: { api: "job", id } });
check("\n۴) بدون نشست → خطای auth", (() => { try { return JSON.parse(r.body).error === "auth"; } catch { return false; } })());

r = await request(state, { method: "GET", cookie: SID, get: { api: "job", id: "2020-01-01-000000-deadbeef" } });
check("شناسهٔ ناموجود → notfound", (() => { try { return JSON.parse(r.body).error === "notfound"; } catch { return false; } })());

r = await request(state, { method: "POST", cookie: SID, get: { api: "start" }, post: { csrf: "WRONG" },
  files: { document: { name: "a.jpg", type: "image/jpeg", tmp_name: "/tmp/in.bin", error: 0, size: 800 } } });
check("CSRF اشتباه رد شد", (() => { try { const j = JSON.parse(r.body); return j.ok === false; } catch { return false; } })());

r = await request(state, { method: "POST", cookie: SID, get: { api: "start" }, post: { csrf: "CSRF-T", method: "4" },
  files: { document: { name: "evil.exe", type: "application/x-msdownload", tmp_name: "/tmp/in.bin", error: 0, size: 800 } } });
check("پسوند غیرمجاز رد شد", (() => { try { return JSON.parse(r.body).ok === false; } catch { return false; } })());

r = await request({ "fk-config.json": JSON.stringify({}), [SESSKEY]: SESSC }, {
  method: "POST", cookie: SID, get: { api: "start" }, post: { csrf: "CSRF-T", method: "4" },
  files: { document: { name: "a.jpg", type: "image/jpeg", tmp_name: "/tmp/in.bin", error: 0, size: 800 } } });
check("بدون توکن → پیام ثبت توکن", (() => { try { return JSON.parse(r.body).message.includes("توکن"); } catch { return false; } })());

// ─── ۵) لغو کار در میانه
state = { ...state, [SESSKEY]: SESSC };
r = await request(state, { method: "POST", cookie: SID, get: { api: "start" }, post: { csrf: "CSRF-T", method: "4" },
  files: { document: { name: "cancel-me.jpg", type: "image/jpeg", tmp_name: "/tmp/in.bin", error: 0, size: 800 } } });
const cid = JSON.parse(r.body).job.id;
state = { ...r.state, "fk-config.json": CFG };  /* نشست با jobs حفظ می‌شود */
r = await request(state, { method: "GET", cookie: SID, get: { api: "cancel", id: cid }, queue: [] });
check("\n۵) لغو کار موفق بود", (() => { try { return JSON.parse(r.body).ok === true; } catch { return false; } })());
state = { ...r.state, "fk-config.json": CFG };  /* نشست با jobs حفظ می‌شود */
r = await request(state, { method: "GET", cookie: SID, get: { api: "job", id: cid } });
const cj = JSON.parse(r.body);
check("وضعیت کار = cancelled", cj.job.status === "cancelled", cj.job.status);
check("پس از لغو، درگاه صدا زده نشد", r.calls === "", r.calls);

console.log(fails === 0 ? "\n════ همهٔ بررسی‌ها موفق ✓ ════" : `\n════ ${fails} مورد ناموفق ✗ ════`);
process.exit(fails === 0 ? 0 : 1);
