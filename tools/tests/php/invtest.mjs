import { request } from "./runner.mjs";

/* آزمون: سرویس InvalidParams می‌دهد (مثلاً output با روش نمی‌سازد)
   برنامه باید خودش با پارامترهای محافظه‌کارانه‌تر دوباره تلاش کند. */

const CFG = JSON.stringify({ token: "T" });
const SID = "INVP00000000000000000000000000001";
const SK = `fk-sessions/sess_${SID}`;
const base = () => ({ "fk-config.json": CFG });  /* نشست از state می‌آید تا jobs حفظ شود */
let fails = 0;
const ck = (l, c, e = "") => { if (!c) fails++; console.log(`  ${c ? "✓" : "✗"} ${l}${e ? " — " + e : ""}`); };

console.log("════ آزمون InvalidParams در PHP ════");

// ── ۱) آپلود
let r = await request({ ...base(), [SK]: 'auth|b:1;csrf|s:1:"C";' }, { method: "POST", cookie: SID, get: { api: "start" },
  post: { csrf: "C", method: "1", output: "txtrawjson", delete_after: "1" },
  files: { document: { name: "فاکتور.png", type: "image/png", tmp_name: "/tmp/in.bin", error: 0, size: 800 } } });
const start = JSON.parse(r.body);
ck("آپلود پذیرفته شد", start.ok === true, r.body.slice(0, 100));
const id = start.job.id;
let st = { ...r.state, ...base() };

// ── ۲) addfile موفق، convert اول InvalidParams، بعد موفق
r = await request(st, { method: "GET", cookie: SID, get: { api: "job", id }, queue: [
  /* addfile */
  { body: JSON.stringify({ Status: "Done", PageCount: "1", FileToken: "FT1", ConvertMethods: "4" }) },
  /* convert اول (method=1 + output) → InvalidParams */
  { body: JSON.stringify({ Status: "InvalidParams", Message: "output is not valid for this method" }) },
  /* convert دوم (بدون output) → موفق با لینک */
  { body: JSON.stringify({ Status: "Done", " FileToDownload ": "https://ex.com/OutputFile.Docx" }) },
]});
let j = JSON.parse(r.body).job;
console.log(`    stage=${j.stage} | status=${j.status} | msg=${(j.message || "").slice(0, 70)}`);
ck("برنامه با InvalidParams نمرد", j.status !== "failed", j.status);
ck("به مرحلهٔ دانلود رسید (نجات خودکار)", j.stage === "download" || j.status === "done" || j.status === "processing",
   j.stage + " / " + j.status);

// ── ۳) همهٔ حالت‌ها رد شوند → پیام گویا، نه گیر
const SID2 = "INVP00000000000000000000000000002";
const SK2 = `fk-sessions/sess_${SID2}`;
let st2 = { "fk-config.json": CFG, [SK2]: 'auth|b:1;csrf|s:1:"C";' };
r = await request(st2, { method: "POST", cookie: SID2, get: { api: "start" },
  post: { csrf: "C", method: "1", output: "txtrawjson", delete_after: "1" },
  files: { document: { name: "فاکتور۲.png", type: "image/png", tmp_name: "/tmp/in.bin", error: 0, size: 800 } } });
const start2 = JSON.parse(r.body);
const id2 = start2.job.id;
let st3 = { ...r.state, "fk-config.json": CFG };  /* نشستِ خودش که jobs دارد */

const bad = { body: JSON.stringify({ Status: "InvalidParams", Message: "nope" }) };
r = await request(st3, { method: "GET", cookie: SID2, get: { api: "job", id: id2 }, queue: [
  { body: JSON.stringify({ Status: "Done", PageCount: "1", FileToken: "FT2", ConvertMethods: "4" }) },
  bad, bad, bad,
]});
let j2 = JSON.parse(r.body).job;
console.log(`    stage=${j2.stage} | status=${j2.status} | msg=${(j2.message || "").slice(0, 90)}`);
ck("کار بسته شد (گیر نکرد)", ["failed", "processing", "converting"].includes(j2.status) === false || j2.status === "failed",
   j2.status);
ck("پیام، InvalidParams را نشان می‌دهد", /InvalidParams|نپذیرفت|پارامتر/.test(j2.message || ""), j2.error || "");

console.log(fails === 0 ? "\n════ همهٔ بررسی‌ها موفق ✓ ════" : `\n════ ${fails} ناموفق ✗ ════`);
process.exit(fails ? 1 : 0);
