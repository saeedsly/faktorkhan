import { PhpNode } from "php-wasm/PhpNode.mjs";
import fs from "fs";

/*
 * آزمون کامل تاریخچه/آمار/جستجو/CSV — با اجرای واقعی index.php
 * (هارنس request() در seed نشست مشکل داشت، پس مستقیم اجرا می‌کنیم.)
 */

const SRC = new URL("../../../deploy/php", import.meta.url).pathname;
const B = s => Buffer.from(s, "utf8").toString("base64");
const lib = fs.readFileSync(`${SRC}/lib.php`, "utf8");
const eng = fs.readFileSync(`${SRC}/engine.php`, "utf8");
const library = fs.readFileSync(`${SRC}/library.php`, `utf8`);
const idx = fs.readFileSync(`${SRC}/legacy.php`, "utf8").replace("declare(strict_types=1);", "");

const now = Math.floor(Date.now() / 1000);
const mkJob = (id, name, text, total, items) => JSON.stringify({
  id, status: "done", stage: "done", progress: 100, message: "آماده",
  text, text_clean: text, name, charcount: text.length, pages: 1,
  created_at: now - 3600, updated_at: now, engine: "cloud",
  understood: { items: Array.from({ length: items }, (_, i) => ({ desc: "کالا" + i, qty: 1, unit: 1000, total: 1000 })),
    totals: { total }, issues: [], confidence: 90, item_count: items },
});

const SID = "HIST00000000000000000000000000002";

function boot(extra = "", get = "array('v' => 'scan')") {
  return `<?php
ini_set('display_errors','1'); error_reporting(E_ALL & ~E_DEPRECATED & ~E_WARNING & ~E_NOTICE);
@mkdir('/tmp/fkh/fk-sessions',0777,true);@mkdir('/tmp/fkh/fk-jobs',0777,true);@mkdir('/tmp/fkh/fk-uploads',0777,true);
file_put_contents('/tmp/fkh/lib.php', base64_decode('${B(lib)}'));
file_put_contents('/tmp/fkh/engine.php', base64_decode('${B(eng)}'));
file_put_contents('/tmp/fkh/library.php', base64_decode('${B(library)}'));
file_put_contents('/tmp/fkh/index.php', base64_decode('${B(idx)}'));
file_put_contents('/tmp/fkh/fk-config.json', '{"token":"T","password_hash":"x"}');
${extra}
$_COOKIE['fksid']='${SID}';
$_SERVER['REQUEST_METHOD']='GET'; $_SERVER['REQUEST_URI']='/'; $_GET=${get};
$_SERVER['REMOTE_ADDR']='127.0.0.1'; $_SERVER['HTTPS']='off';
require_once '/tmp/fkh/index.php';
`;
}

async function run(code) {
  const p = new PhpNode();
  await new Promise(r => p.addEventListener("ready", r));
  let out = "";
  p.addEventListener("output", e => { out += e.detail.join(""); });
  await p.run(code);
  await new Promise(r => setTimeout(r, 1200));
  return out;
}

let fails = 0;
const ck = (l, c, e = "") => { if (!c) fails++; console.log(`  ${c ? "✓" : "✗"} ${l}${e ? " — " + e : ""}`); };

console.log("═".repeat(62));
console.log("تاریخچه، آمار، جستجو و CSV (اجرای واقعی صفحه)");
console.log("═".repeat(62));

const JOBS = `file_put_contents('/tmp/fkh/fk-jobs/j1.json', base64_decode('${B(mkJob("j1", "فاکتور-کاغذ.png", "کاغذ A4 — ۱۰ بسته", 2500000, 2))}'));
file_put_contents('/tmp/fkh/fk-jobs/j2.json', base64_decode('${B(mkJob("j2", "فاکتور-تونر.jpg", "تونر پرینتر — ۲ عدد", 900000, 1))}'));
file_put_contents('/tmp/fkh/fk-jobs/j3.json', base64_decode('${B(mkJob("j3", "receipt-سوپر.png", "خرید روزانه", 150000, 3))}'));
file_put_contents('/tmp/fkh/fk-sessions/sess_${SID}', base64_decode('${B('auth|b:1;csrf|s:1:"C";jobs|a:3:{i:0;s:2:"j1";i:1;s:2:"j2";i:2;s:2:"j3";}')}'));`;

// ۱) رندر عادی
const html = await run(boot(JOBS));
ck("صفحه رندر شد", html.length > 5000, String(html.length));
ck("بدون خطای PHP", !/Fatal error|Parse error/i.test(html));
ck("تاریخچه هست", html.includes("تاریخچهٔ خوانش"));
ck("۳ فاکتور نمایش داده شد", (html.match(/data-job="/g) || []).length === 3,
   String((html.match(/data-job="/g) || []).length));
const statsBlock = (html.match(/<div class="stats">[\s\S]{0,700}?<\/div>\s*<\/div>/) || [""])[0];
ck("آمار: جمع کل مبالغ", statsBlock.includes("3,550,000"),
   (statsBlock.match(/[\d,]{7,}/g) || []).join(" | "));
ck("آمار: ۶ قلم کالا", html.includes("۶</b><span>قلم کالا"),
   (html.match(/<b>([۰-۹]+)<\/b><span>قلم کالا/) || [""])[0]);
ck("تاریخ شمسی در فهرست", /۱۴[۰-۹]{2}\/[۰-۹]{2}\/[۰-۹]{2}/.test(html));
ck("لینک CSV هست", html.includes("?csv=1"));
ck("دکمهٔ حذف هست", html.includes('value="forget_job"'));

// ۲) جستجو در نام
const q1 = await run(boot(JOBS, "array('v' => 'scan', 'q' => 'تونر')"));
ck("جستجو در نام فیلتر کرد",
   q1.includes("فاکتور-تونر.jpg") && !q1.includes("فاکتور-کاغذ.png"),
   String((q1.match(/data-job="/g) || []).length));

// ۳) جستجوی بی‌نتیجه
const q2 = await run(boot(JOBS, "array('v' => 'scan', 'q' => 'کاملا-نامربوط')"));
ck("جستجوی بی‌نتیجه پیام دارد", q2.includes("پیدا نشد"));
ck("جستجوی بی‌نتیجه خطا ندارد", !/Fatal error/.test(q2));

// ۴) CSV
const csv = await run(boot(JOBS, "array('csv' => '1')"));
ck("CSV ساخته شد", csv.length > 60, String(csv.length));
ck("CSV سرستون فارسی", csv.includes("جمع کل"));
ck("CSV هر سه فاکتور", (csv.match(/فاکتور-|receipt-/g) || []).length === 3,
   String((csv.match(/فاکتور-|receipt-/g) || []).length));
ck("CSV بدون خطا", !/Fatal error|Parse error/i.test(csv));

console.log(fails === 0 ? "\n✓ همه بررسی‌ها موفق" : `\n✗ ${fails} بررسی ناموفق`);
process.exit(fails === 0 ? 0 : 1);
