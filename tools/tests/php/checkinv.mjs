import { request } from "./runner.mjs";

/*
 * باگ واقعی گزارش‌شده:
 *   «سرویس ابری پارامترهای درخواست را نپذیرفت.
 *    — پارامترهای ارسالی: command, filetoken»
 *
 * فقط command و filetoken در پیام بودند → یعنی درخواست checkconvert بود،
 * نه convert (که method و output هم دارد). سرویس به checkconvert با
 * InvalidParams جواب می‌داد و برنامه کار را می‌کشت — در حالی که فایل
 * خروجی آماده و قابل دانلود بود.
 *
 * قرارداد درست سرویس:
 *   عکس/PDF → addfile → convert (لینک همان‌جا) → دانلود   [بدون checkconvert]
 *   صوتی    → addfile → convert → checkconvert (تکرار) → متن
 */

const CFG = JSON.stringify({ token: "T" });
let fails = 0;
const ck = (l, c, e = "") => { if (!c) fails++; console.log(`  ${c ? "✓" : "✗"} ${l}${e ? " — " + e : ""}`); };

console.log("════ آزمون: checkconvert با InvalidParams پاسخ می‌دهد ════");

const SID = "CHKI00000000000000000000000000001";
const auth = `auth|b:1;csrf|s:1:"C";`;

/* ── الف) عکس: convert لینک می‌دهد → هرگز نباید checkconvert صدا زده شود */
let r = await request({ "fk-config.json": CFG, [`fk-sessions/sess_${SID}`]: auth },
  { method: "POST", cookie: SID, get: { api: "start" },
    post: { csrf: "C", method: "4", output: "txtrawjson", delete_after: "1" },
    files: { document: { name: "inv.png", type: "image/png", tmp_name: "/tmp/in.bin", error: 0, size: 800 } } });
const id = JSON.parse(r.body).job.id;
let st = { ...r.state, "fk-config.json": CFG };  /* نشست از r.state می‌آید (jobs هم داخلش) */

r = await request(st, { method: "GET", cookie: SID, get: { api: "job", id }, queue: [
  { body: JSON.stringify({ Status: "Done", PageCount: "1", FileToken: "FT1", ConvertMethods: "4" }) },
  { body: JSON.stringify({ Status: "Done", " FileToDownload ": "https://ex.com/out.txt" }) },
]});
let j = JSON.parse(r.body).job;
ck("به مرحلهٔ دانلود رفت (بدون checkconvert)", j.stage === "download", j.stage + " / " + (j.message || "").slice(0, 50));

const calls = (r.calls || "").trim();
console.log("    درخواست‌های سرویس:", calls.replace(/\n/g, " | "));
ck("checkconvert صدا زده نشد", !calls.includes("checkconvert"), calls.replace(/\n/g, ","));

/* ── ب) لینک نیامد (فایل صوتی/صف) و checkconvert هم InvalidParams */
const SID2 = "CHKI00000000000000000000000000002";
const auth2 = `auth|b:1;csrf|s:1:"C";`;
r = await request({ "fk-config.json": CFG, [`fk-sessions/sess_${SID2}`]: auth2 },
  { method: "POST", cookie: SID2, get: { api: "start" },
    post: { csrf: "C", method: "4", output: "txtrawjson", delete_after: "1" },
    files: { document: { name: "inv2.png", type: "image/png", tmp_name: "/tmp/in.bin", error: 0, size: 800 } } });
const id2 = JSON.parse(r.body).job.id;
let st2 = { ...r.state, "fk-config.json": CFG };

r = await request(st2, { method: "GET", cookie: SID2, get: { api: "job", id: id2 }, queue: [
  { body: JSON.stringify({ Status: "Done", PageCount: "1", FileToken: "FT2", ConvertMethods: "4" }) },
  { body: JSON.stringify({ Status: "Done" }) },                              /* بدون لینک */
]});
let j2 = JSON.parse(r.body).job;
/* تیک بعدی: checkconvert صدا زده می‌شود و InvalidParams می‌دهد */
let st2b = { ...r.state, "fk-config.json": CFG };
r = await request(st2b, { method: "GET", cookie: SID2, get: { api: "job", id: id2 }, queue: [
  { body: JSON.stringify({ Status: "InvalidParams" }) },
]});
j2 = JSON.parse(r.body).job;
console.log(`    stage=${j2.stage} | status=${j2.status}`);
console.log(`    msg=${(j2.message || "").slice(0, 100)}`);
ck("کار بسته شد (گیر نکرد)", j2.status === "failed", j2.status);
ck("پیام گویاست (نه خالی)", (j2.message || "").length > 10, j2.message || "");
ck("کار در waiting گیر نکرد", j2.stage !== "wait" || j2.status === "failed", j2.stage);

/*
 * صوتی در این نسخه پشتیبانی نمی‌شود (فقط عکس/PDF) — عمداً.
 * مسیر checkconvert برای عکس هرگز صدا زده نمی‌شود و برای صف هم
 * InvalidParams به پیام روشن تبدیل می‌شود، که آزمون بالا تأیید کرد.
 */

console.log(fails === 0 ? "\n════ همهٔ بررسی‌ها موفق ✓ ════" : `\n════ ${fails} ناموفق ✗ ════`);
process.exit(fails ? 1 : 0);
