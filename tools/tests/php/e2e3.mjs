import { request } from "./runner.mjs";

const CFG = JSON.stringify({ token: "TOK-SECRET-9F8E7D6C" });
const SID = "ABCD0000000000000000000000000002";
const SK = `fk-sessions/sess_${SID}`;
const SESSC = 'auth|b:1;csrf|s:6:"CSRF-T";';
let fails = 0;
const check = (l, c, e = "") => { if (!c) fails++; console.log(`   ${c ? "✓" : "✗"} ${l}${e ? " — " + e : ""}`); };

const base = () => ({ "fk-config.json": CFG });  /* نشست از state می‌آید */
async function start(state, name = "inv.jpg") {
  return request(state, { method: "POST", cookie: SID, get: { api: "start" },
    post: { csrf: "CSRF-T", method: "4", output: "txtrawjson", delete_after: "1" },
    files: { document: { name, type: "image/jpeg", tmp_name: "/tmp/in.bin", error: 0, size: 800 } } });
}

// ══ ۱) قطعی شبکه در addfile → تلاش دوباره، کار نمی‌میرد
console.log("\n۱) قطعی شبکه هنگام ارسال فایل");
let r = await start({ ...base(), [SK]: SESSC });
const id1 = JSON.parse(r.body).job.id;
let st = { ...r.state, ...base() };  /* jobs داخل r.state حفظ می‌شود */
r = await request(st, { method: "GET", cookie: SID, get: { api: "job", id: id1 }, queue: [{ err: true }] });
let j = JSON.parse(r.body);
check("کار زنده ماند (queued/addfile)", j.job.status === "queued" && j.job.stage === "addfile", `${j.job.status}/${j.job.stage}`);
check("پیام تلاش دوباره", j.job.message.includes("تلاش دوباره") || j.job.message.includes("ناموفق"), j.job.message);
st = { ...r.state, ...base() };
r = await request(st, { method: "GET", cookie: SID, get: { api: "job", id: id1 },
  queue: [{ body: JSON.stringify({ Status: "Done", PageCount: "1", FileToken: "FT-A", ConvertMethods: "1,2,3,4" }) }] });
j = JSON.parse(r.body);
// پس از موفقیت addfile، convert هم همان‌جا انجام می‌شود → stage=wait
check("تلاش دوم موفق → از addfile گذشت", j.job.stage === "convert" || j.job.stage === "wait", j.job.stage);

// ══ ۲) خطای قطعی (اعتبار ناکافی) → توقف با پیام روشن
console.log("\n۲) خطای قطعی سرویس ابری");
r = await start({ ...base(), [SK]: SESSC });
const id2 = JSON.parse(r.body).job.id;
st = { ...r.state, ...base() };
r = await request(st, { method: "GET", cookie: SID, get: { api: "job", id: id2 },
  queue: [{ body: JSON.stringify({ Status: "NoEnoughCredit" }) }] });
j = JSON.parse(r.body);
check("کار متوقف شد", j.job.status === "failed", j.job.status);
check("پیام فارسی اعتبار", j.job.message.includes("اعتبار"), j.job.message);

// ══ ۳) خروجی Word → فایل ذخیره‌شده
console.log("\n۳) خروجی Word (بدون متن)");
r = await start({ ...base(), [SK]: SESSC }, "scan.png");
const id3 = JSON.parse(r.body).job.id;
let state3 = { ...r.state, ...base() };
const seq3 = [
  // تیک ۱: addfile + convert با هم
  { body: JSON.stringify({ Status: "Done", PageCount: "1", FileToken: "FT-B", ConvertMethods: "4" }) },
  { body: JSON.stringify({ Status: "Done", FileToDownload: "https://ex.com/out.docx" }) },
  // تیک ۲: دانلود فایل (چون convert خودش لینک داد، checkconvert لازم نیست)
  { dlb64: "UEsDBBQAAAAIAFpUaF3uR1hmHwAAAB0AAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbLOxr8jNUShLLSrOzM+zVTLUM1Cyt7MJqSxILda3AwBQSwMEFAAAAAgAWlRoXXb93Oc7AQAAeQIAABEAAAB3b3JkL2RvY3VtZW50LnhtbJWS0U7CMBSG73mKptdKp0FjFjbijU+gDzC6CiRb27QV5NIEEy98jwkxCAmJypOcsZfhrOoNYoi7OOtZ83//39O1O/d5RobC2IGSET1pBpQIyVU6kL2I3lxfHV9QYl0i0yRTUkR0LCztxI32KEwVv8uFdAQJ0oajiPad0yFjlvdFntim0kLi3q0yeeKwNT02UibVRnFhLRrkGTsNgnOWJwNJY0R2VTr2bF13pi4uLh+g2ExhVj7BksAcltUzvLVZvVVX46veldWpQqsTjpm1EVaYoaAxzKDwgHlIqmW1qhbVimH5YNi974e6buaJX1we78TDaEU5geK32H/h+1XlI7ygav23innLxgFnWMOCXLb+Z946C/A5ZO1fePbd+4BXDP9JNtNyEhJEHSGL+KHiHPaNkH1fbL34+WniLVBLAwQUAAAACABaVGhdYXJaniYAAAAlAAAACwAAAF9yZWxzLy5yZWxzs7GvyM1RKEstKs7Mz7NVMtQzULK3swlKzUksAQoUZ2QWFOvbAQBQSwECFAMUAAAACABaVGhd7kdYZh8AAAAdAAAAEwAAAAAAAAAAAAAAgAEAAAAAW0NvbnRlbnRfVHlwZXNdLnhtbFBLAQIUAxQAAAAIAFpUaF12/dznOwEAAHkCAAARAAAAAAAAAAAAAACAAVAAAAB3b3JkL2RvY3VtZW50LnhtbFBLAQIUAxQAAAAIAFpUaF1hclqeJgAAACUAAAALAAAAAAAAAAAAAACAAboBAABfcmVscy8ucmVsc1BLBQYAAAAAAwADALkAAAAJAgAAAAA=" },
];
for (let i = 0; i < 3; i++) {
  if (i > 0 && j && j.job.status !== "processing") break;
  const slice = i === 0 ? seq3.slice(0, 2) : [seq3[i + 1]];
  r = await request(state3, { method: "GET", cookie: SID, get: { api: "job", id: id3 }, queue: slice });
  j = JSON.parse(r.body);
  state3 = { ...r.state, ...base() };
  console.log(`   مرحله ${i + 1}: stage=${j.job.stage} status=${j.job.status} درگاه=${r.calls.replace(/\n/g, ",")}`);
  if (j.job.status === "done") break;
}
check("کار تمام شد", j.job.status === "done", j.job.status);
check("فایل Word/متنی ذخیره شد", !!j.job.saved && j.job.saved.endsWith(".docx"), j.job.saved);
check("فایل روی دیسک است", Object.keys(state3).some(k => k.includes(j.job.saved || "___")));

// ══ ۴) روش نامعتبر → انتخاب خودکار ۴ برای عکس
console.log("\n۴) روش تبدیل نامعتبر برای فایل");
r = await request({ ...base(), [SK]: SESSC }, { method: "POST", cookie: SID, get: { api: "start" },
  post: { csrf: "CSRF-T", method: "2", output: "txt" },
  files: { document: { name: "p.jpg", type: "image/jpeg", tmp_name: "/tmp/in.bin", error: 0, size: 800 } } });
const id4 = JSON.parse(r.body).job.id;
st = { ...r.state, ...base() };
r = await request(st, { method: "GET", cookie: SID, get: { api: "job", id: id4 },
  queue: [{ body: JSON.stringify({ Status: "Done", PageCount: "1", FileToken: "FT-C", ConvertMethods: "1,3,4" }) }] });
j = JSON.parse(r.body);
check("روش ۴ انتخاب شد (تصویر)", j.job.method === 4, String(j.job.method));

// ══ ۵) نشتی توکن
console.log("\n۵) بررسی نشتی توکن");
const sensitive = Object.entries({ ...state3, ...r.state })
  .filter(([k]) => k !== "fk-config.json")
  .map(([k, v]) => k + "=" + v).join("\n") + r.body + JSON.stringify(j);
check("توکن در فایل‌های کار، نشست و پاسخ‌ها نیست", !sensitive.includes("TOK-SECRET-9F8E7D6C"));
check("توکن فقط در fk-config.json است", (state3["fk-config.json"] || "").includes("TOK-SECRET"));
const page = (await request(base(), { method: "GET", cookie: SID })).body;
check("توکن در HTML صفحه نیست", !page.includes("TOK-SECRET-9F8E7D6C"));
check("صفحه سالم رندر شد", page.includes("<!DOCTYPE html>") && page.length > 3000, String(page.length));

// ══ ۶) وضعیت را از دست داده (فایل کار حذف شده)
console.log("\n۶) کارِ حذف‌شده");
r = await request(base(), { method: "GET", cookie: SID, get: { api: "job", id: id4 } });
check("پاسخ تمیز JSON بدون خطای PHP (auth یا notfound — هر دو امن‌اند)",
  (() => { try { const x = JSON.parse(r.body); return x.ok === false && ["notfound", "auth"].includes(x.error); } catch { return false; } })(), r.body.slice(0, 80));

console.log(fails === 0 ? "\n════ همهٔ بررسی‌ها موفق ✓ ════" : `\n════ ${fails} ناموفق ✗ ════`);
process.exit(fails === 0 ? 0 : 1);
