import { request } from "./runner.mjs";
import fs from "fs";
const CFG = JSON.stringify({ token: "T" });
const SID = "DOCX00000000000000000000000000001";
const SK = `fk-sessions/sess_${SID}`;
const base = () => ({ "fk-config.json": CFG });
const baseSeed = () => ({ ...base(), [SK]: 'auth|b:1;csrf|s:1:"C";' });
const DOCX_B64 = fs.readFileSync("/tmp/test.docx").toString("base64");
let fails = 0;
const ck = (l, c, e = "") => { if (!c) fails++; console.log(`  ${c ? "✓" : "✗"} ${l}${e ? " — " + e : ""}`); };

// ۱) آپلود
let r = await request(baseSeed(), { method: "POST", cookie: SID, get: { api: "start" },
  post: { csrf: "C", method: "4", output: "keeplayout", delete_after: "1" },
  files: { document: { name: "فاکتور.png", type: "image/png", tmp_name: "/tmp/in.bin", error: 0, size: 800 } } });
const start = JSON.parse(r.body);
ck("آپلود پذیرفته شد", start.ok === true, r.body.slice(0, 80));
const id = start.job.id;
let st = { ...r.state, ...base() };

// ۲) addfile + convert → لینک
r = await request(st, { method: "GET", cookie: SID, get: { api: "job", id }, queue: [
  { body: JSON.stringify({ Status: "Done", PageCount: "1", FileToken: "FT1", ConvertMethods: "4" }) },
  { body: JSON.stringify({ Status: "Done", " FileToDownload ": "https://ex.com/OutputFile.Docx" }) },
]});
let j = JSON.parse(r.body).job;
ck("به مرحلهٔ دانلود رفت", j.stage === "download", j.stage + " | " + j.message);
st = { ...r.state, ...base() };

// ۳) دانلود بدنهٔ docx واقعی
r = await request(st, { method: "GET", cookie: SID, get: { api: "job", id },
  queue: [{ dlb64: DOCX_B64 }] });
j = JSON.parse(r.body).job;
console.log("   متن:", JSON.stringify((j.text || "").slice(0, 60)));
ck("کار done شد", j.status === "done", j.status);
ck("متن از داخل Word خوانده شد", (j.text || "").includes("فاکتور خرید"), (j.text || "").slice(0, 40));
ck("جمع کل در متن هست", (j.text || "").includes("450,000"));
ck("جدول با تب جدا شد", (j.text || "").includes("\t"), JSON.stringify(j.text || ""));
ck("طول متن گزارش شد", (j.text || "").length > 60, "chars=" + (j.text || "").length + " server=" + j.charcount + " (mbstring نیست)");
ck("فایل Word ذخیره شد", j.saved.endsWith(".docx") && j.saved_bytes > 100, j.saved + " " + j.saved_bytes);
ck("فایل TXT ذخیره شد", j.txt_file.endsWith(".txt"), j.txt_file);
ck("نوع خروجی docx", j.out_kind === "docx", j.out_kind);
const docName = j.saved, txtName = j.txt_file;
st = { ...r.state, ...base() };

// ۴) دانلود TXT از API
r = await request(st, { method: "GET", cookie: SID, get: { api: "file", f: "txt", id } });
ck("دانلود TXT کار می‌کند", r.body.includes("فاکتور خرید"), r.body.slice(0, 40).replace(/\n/g, " "));
console.log("   سرآیند پاسخ:", (r.raw || "").split("@@R=")[0].slice(0, 100) || "(خالی)");

// ۵) دانلود Word از API
r = await request(st, { method: "GET", cookie: SID, get: { api: "file", f: "doc", id } });
ck("دانلود Word کار می‌کند", r.body.slice(0, 2) === "PK", JSON.stringify(r.body.slice(0, 2)));

// ۶) حذف فایل‌ها
r = await request(st, { method: "GET", cookie: SID, get: { api: "deletefiles", id } });
const delRes = JSON.parse(r.body);
ck("حذف فایل‌ها موفق", delRes.ok === true);
st = { ...r.state, ...base() };
ck("فایل از پوشه پاک شد", !st[`fk-uploads/${docName}`] && !st[`fk-uploads/${txtName}`]);
r = await request(st, { method: "GET", cookie: SID, get: { api: "file", f: "doc", id } });
ck("دانلود بعد از حذف ۴۰۴ می‌دهد", r.body.includes("پیدا نشد") || r.body.includes("ذخیره نشده"), r.body.slice(0, 60));

// ۷) فایل خالی از سرویس → نباید فایل بی‌مصرف ذخیره شود
r = await request(baseSeed(), { method: "POST", cookie: SID, get: { api: "start" },
  post: { csrf: "C", method: "4", output: "keeplayout" },
  files: { document: { name: "b.png", type: "image/png", tmp_name: "/tmp/in.bin", error: 0, size: 800 } } });
const id2 = JSON.parse(r.body).job.id;
st = { ...r.state, ...base() };
r = await request(st, { method: "GET", cookie: SID, get: { api: "job", id: id2 }, queue: [
  { body: JSON.stringify({ Status: "Done", PageCount: "1", FileToken: "FT2", ConvertMethods: "4" }) },
  { body: JSON.stringify({ Status: "Done", " FileToDownload ": "https://ex.com/x.docx" }) },
]});
st = { ...r.state, ...base() };
r = await request(st, { method: "GET", cookie: SID, get: { api: "job", id: id2 }, queue: [{ dl: "PK\u0003\u0004" }] });
j = JSON.parse(r.body).job;
ck("خروجی خالی → شکست صریح", j.status === "failed", j.status);
ck("پیام راهنما دارد", (j.message || "").includes("عکس"), j.message.slice(0, 60));
const leftover = Object.keys(st).filter(k => k.startsWith("fk-uploads/fk-") && !k.endsWith(".txt"));
ck("هیچ فایل خرابی ذخیره نشد", leftover.length === 0, leftover.join(","));

console.log(fails === 0 ? "\nهمهٔ آزمون‌ها موفق ✓" : `\n${fails} خطا ✗`);
process.exit(fails ? 1 : 0);
