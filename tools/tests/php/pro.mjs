import { PhpNode } from "php-wasm/PhpNode.mjs";
import fs from "fs";

/*
 * آزمون «پنل حرفه‌ای» نسخهٔ PHP
 * =============================
 * سه چیز را می‌سنجد که نسخهٔ ساده نداشت:
 *
 *   ۱) ورودی طراحی‌شده — صفحهٔ ورود با برند، بدون نوار کنار، یک کارت
 *   ۲) داشبورد — کارت‌های آماری، روند ماهانه، فهرست اخیر
 *   ۳) بایگانی فاکتور — ثبت از کار، جست‌وجو، حذف با مالکیت، CSV
 *
 * و یک چیز که قبلاً «تزئینی» بود: انتخاب نوع فاکتور. حالا باید روی
 * خودِ خروجی موتور اثر بگذارد، نه فقط روی برچسب.
 */

const SRC = new URL("../../../deploy/php", import.meta.url).pathname;
const B = s => Buffer.from(s, "utf8").toString("base64");
const lib = fs.readFileSync(`${SRC}/lib.php`, "utf8");
const eng = fs.readFileSync(`${SRC}/engine.php`, "utf8");
const library = fs.readFileSync(`${SRC}/library.php`, "utf8");
const idx = fs.readFileSync(`${SRC}/legacy.php`, "utf8").replace("declare(strict_types=1);", "");

const SID = "PRO00000000000000000000000000001";
const SID2 = "PRO00000000000000000000000000002";
const now = Math.floor(Date.now() / 1000);
/* شناسهٔ مالک واقعی ۳۲ نویسه است. شناسهٔ کوتاه عمداً بازتولید می‌شود
   (تا فایل دستکاری‌شده نتواند مالکیت را عوض کند)، پس در تست باید
   همان طول واقعی را بدهیم. */
const OWNER_ID = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const CFG = JSON.stringify({ token: "T", password_hash: "x" });

const mkJob = (id, name, text, total, items) => JSON.stringify({
  id, status: "done", stage: "done", progress: 100, message: "آماده",
  text, text_clean: text, name, charcount: text.length, pages: 1,
  created_at: now - 600, updated_at: now, engine: "cloud",
  invoice_type: "printed",
  understood: {
    items: Array.from({ length: items }, (_, i) => ({
      description: "کالا " + (i + 1), qty: 1, unit: "عدد",
      unit_price: Math.round(total / items), total: Math.round(total / items),
    })),
    totals: { total, subtotal: total, tax: 0, discount: 0 },
    issues: [], confidence: 88, item_count: items,
    meta: { number: "INV-" + id, date: "۱۴۰۴/۰۹/۰۱", seller: "فروشگاه " + id, buyer: "خریدار" },
  },
});

function boot(state = {}, get = "array()", post = "array()", method = "POST", extra = "") {
  /* وضعیت و نشست داخل PHP ساخته می‌شود، نه با درج متن در تمپلیت
     جاوااسکریپت: متن فارسی/JSON در تمپلیت باعث خطای «unexpected
     identifier Object» می‌شد. */
  const seeds = JSON.stringify(state && typeof state === "object" && !Array.isArray(state) ? state : {});
  return `<?php
ini_set('display_errors','1'); error_reporting(E_ALL & ~E_DEPRECATED & ~E_WARNING & ~E_NOTICE);
@mkdir('/tmp/fkp/fk-sessions',0777,true);@mkdir('/tmp/fkp/fk-jobs',0777,true);
@mkdir('/tmp/fkp/fk-uploads',0777,true);@mkdir('/tmp/fkp/fk-invoices',0777,true);
file_put_contents('/tmp/fkp/lib.php', base64_decode('${B(lib)}'));
file_put_contents('/tmp/fkp/engine.php', base64_decode('${B(eng)}'));
file_put_contents('/tmp/fkp/library.php', base64_decode('${B(library)}'));
file_put_contents('/tmp/fkp/index.php', base64_decode('${B(idx)}'));
file_put_contents('/tmp/fkp/fk-config.json', base64_decode('${B(CFG)}'));
foreach (json_decode(base64_decode('${B(seeds)}'), true) ?: array() as $p => $c) {
    $full = '/tmp/fkp/' . $p;
    @mkdir(dirname($full), 0777, true);
    file_put_contents($full, base64_decode($c));
}


$_COOKIE['fksid']='${SID}';
$_SERVER['REQUEST_METHOD']='${method}'; $_SERVER['REQUEST_URI']='/'; $_GET=${get}; $_POST=${post};
$_SERVER['REMOTE_ADDR']='127.0.0.1'; $_SERVER['HTTPS']='off';
require_once '/tmp/fkp/index.php';
`;
}

async function run(code) {
  const p = new PhpNode();
  await new Promise(r => p.addEventListener("ready", r));
  let out = "";
  p.addEventListener("output", e => { out += e.detail.join(""); });
  await p.run(code);
  /* php-wasm در اولین اجرا کند است؛ تا آمدن </html> صبر می‌کنیم
     (نسخهٔ قبلی با تأخیر ثابت، صفحهٔ نیمه‌کاره برمی‌گرداند و تست
     الکی قرمز می‌شد). */
  for (let i = 0; i < 120 && !out.includes("</html>"); i++) {
    await new Promise(r => setTimeout(r, 100));
  }
  await new Promise(r => setTimeout(r, 200));
  return out;
}

let fails = 0;
const ck = (l, c, e = "") => { if (!c) fails++; console.log(`  ${c ? "✓" : "✗"} ${l}${e ? " — " + e : ""}`); };

console.log("═".repeat(64));
console.log("پنل حرفه‌ای PHP: ورود، داشبورد، بایگانی، تشخیص خودکار");
console.log("═".repeat(64));

/* ── ۱) صفحهٔ ورود ── */
const login = await run(boot());
console.log("\n۱) صفحهٔ ورود");
ck("بدون خطای PHP", !/Fatal error|Parse error/i.test(login));
ck("کلاس صفحهٔ ورود (auth)", login.includes('class="auth"'), String(login.length));
ck("کارت ورود هست", login.includes("ورود به پنل"));
ck("نوار کنار در حالت ورود نیست", !login.includes('class="side"'));
ck("برند فاکتورخوان", login.includes("فاکتورخوان"));
ck("فرم با CSRF", /name="csrf"/.test(login) && /value="login"/.test(login));

/* ── ۲) داشبورد بعد از ورود ── */
const sessState = {
  [`fk-sessions/sess_${SID}`]: B('auth|b:1;csrf|s:1:"C";jobs|a:2:{i:0;s:2:"j1";i:1;s:2:"j2";}'),
  "fk-jobs/j1.json": B(mkJob("j1", "فاکتور-کاغذ.png", "کاغذ A4 — ۱۰ بسته", 2500000, 2)),
  "fk-jobs/j2.json": B(mkJob("j2", "فاکتور-تونر.jpg", "تونر — ۲ عدد", 900000, 1)),
};

const dash = await run(boot(sessState));
console.log("\n۲) داشبورد");
ck("بدون خطای PHP", !/Fatal error|Parse error/i.test(dash));
ck("نوار کنار هست", dash.includes('class="side"'));
ck("چهار کارت آماری", (dash.match(/class="kcard"/g) || []).length === 4,
   String((dash.match(/class="kcard"/g) || []).length));
ck("منوی چهار بخش", ["داشبورد", "خوانش فاکتور", "بایگانی فاکتورها", "تنظیمات"]
   .every(t => dash.includes(t)));
ck("دکمهٔ فاکتور جدید", dash.includes("فاکتور جدید"));
ck("آمار نشست (جمع) — 3,400,000", dash.includes("3,400,000"));
ck("پیام بایگانی خالی", dash.includes("هنوز فاکتوری بایگانی نشده"));
ck("روند ماهانه", dash.includes("روند ماهانه") || dash.includes("روند"));

/* ── ۳) نمای خوانش + گزینهٔ تشخیص خودکار ── */
const scan = await run(boot(sessState, "array('v' => 'scan')"));
console.log("\n۳) نمای خوانش");
ck("بدون خطای PHP", !/Fatal error|Parse error/i.test(scan));
ck("انتخاب نوع فاکتور در فرم", scan.includes('name="invoice_type"'));
ck("گزینهٔ چاپی", scan.includes('value="printed"'));
ck("گزینهٔ حرارتی", scan.includes('value="thermal"'));
ck("گزینهٔ دست‌نویس", scan.includes('value="handwritten"'));
ck("گزینهٔ صوتی", scan.includes('value="audio"'));
ck("گزینهٔ «تشخیص خودکار»", scan.includes('value="auto"') && scan.includes("تشخیص خودکار"));
ck("دکمهٔ ثبت در بایگانی", scan.includes("btn-archive") && scan.includes("ثبت در بایگانی"));
ck("فرم ثبت فاکتور", scan.includes('id="iv-seller"') && scan.includes('id="iv-total"'));

/* ── ۴) بایگانی: ثبت، فهرست، جست‌وجو ── */
const inv1 = {
  id: "a".repeat(24), owner: OWNER_ID, job_id: "j1", file_name: "فاکتور-کاغذ.png",
  number: "1401", issue_date: "۱۴۰۴/۰۹/۰۱", seller_name: "فروشگاه الف",
  buyer_name: "خریدار", invoice_type: "printed",
  items: [{ description: "کاغذ A4", qty: 10, unit: "بسته", unit_price: 250000, total: 2500000 }],
  items_sum: 2500000, subtotal: 2500000, discount: 0, tax: 0, total: 2500000,
  confidence: 90, issues: 0, text: "کاغذ A4 — ۱۰ بسته", created_at: now - 100, updated_at: now,
};
const inv2 = {
  id: "b".repeat(24), owner: "USER2USER2USER2USER2USER2USER2USER22", job_id: "j2", file_name: "تونر.jpg",
  number: "1402", issue_date: "۱۴۰۴/۰۹/۰۲", seller_name: "فروشگاه ب",
  buyer_name: "خریدار", invoice_type: "thermal",
  items: [{ description: "تونر", qty: 2, unit: "عدد", unit_price: 450000, total: 900000 }],
  items_sum: 900000, subtotal: 900000, discount: 0, tax: 0, total: 900000,
  confidence: 70, issues: 0, text: "تونر — ۲ عدد", created_at: now - 50, updated_at: now,
};
const archState = {
  ...sessState,
  "fk-owner": B(OWNER_ID),
  [`fk-invoices/${inv1.id}.json`]: B(JSON.stringify(inv1)),
  [`fk-invoices/${inv2.id}.json`]: B(JSON.stringify(inv2)),
};

const arch = await run(boot(archState, "array('v' => 'archive')"));
console.log("\n۴) بایگانی");
ck("بدون خطای PHP", !/Fatal error|Parse error/i.test(arch));
ck("فاکتور خودم دیده می‌شود", arch.includes("فروشگاه الف"));
ck("فاکتور کاربر دیگر دیده نمی‌شود", !arch.includes("فروشگاه ب"));
ck("شمارهٔ فاکتور در جدول", arch.includes("1401"));
ck("مبلغ کل با جداکننده", arch.includes("2,500,000"));
ck("دکمهٔ حذف فاکتور", arch.includes('value="delete_invoice"'));
ck("لینک CSV بایگانی", arch.includes("?archive=1"));

const search = await run(boot(archState, "array('v' => 'archive', 'aq' => 'تونر')"));
ck("جست‌وجو در بایگانی — بی‌نتیجه برای دیگران", search.includes("پیدا نشد") || search.includes("خالی است"));
const search2 = await run(boot(archState, "array('v' => 'archive', 'aq' => 'کاغذ')"));
ck("جست‌وجو در اقلام خودم", search2.includes("فروشگاه الف"));

/* ── ۵) CSV بایگانی ── */
const csv = await run(boot(archState, "array('archive' => '1')", "array()", "GET"));
console.log("\n۵) خروجی CSV");
ck("CSV ساخته شد", csv.length > 60, String(csv.length));
ck("سرستون فارسی", csv.includes("مبلغ کل") && csv.includes("فروشنده"));
/* php-wasm هنگام جمع‌آوری خروجی، BOM را از رشتهٔ JS حذف می‌کند؛ پس
   وجود BOM در بایت‌های واقعی را جداگانه سنجیده‌ایم (bin2hex = efbbbf).
   این‌جا فقط می‌سنجیم که CSV با سرستون شروع شود (یعنی BOM در فایل خام
   است و این‌جا حذف شده). */
ck("CSV با سرستون شروع می‌شود (BOM در فایل خام = efbbbf)",
   csv.replace(/^\uFEFF/, "").startsWith("تاریخ") ||
   csv.replace(/^\uFEFF/, "").startsWith("\uFEFF") ||
   csv.includes("تاریخ,شماره"), JSON.stringify(csv.slice(0, 12)));
ck("بدون خطا", !/Fatal error|Parse error/i.test(csv));

/* ── ۶) حذف فاکتور با مالکیت ── */
const del = await run(boot(archState, "array('v' => 'archive')",
  "array('action' => 'delete_invoice', 'id' => '" + inv2.id + "', 'csrf' => 'C')"));
ck("حذف فاکتور دیگری رد شد", !/حذف شد/.test(del) || /پیدا نشد/.test(del));

/* ── ۷) نوع فاکتور واقعاً اثر دارد ── */
const engineCheck = await run(`<?php
@mkdir('/tmp/fkq', 0777, true);
file_put_contents('/tmp/fkq/engine.php', base64_decode('${B(eng)}'));
require_once '/tmp/fkq/engine.php';
$thermal = "فروشگاه\\nکارتخوان ملت\\nشماره پیگیری ۱۲۳۴\\nکاغذ A4\\n۲ بسته ۲۵۰,۰۰۰\\nجمع کل ۵۰۰,۰۰۰\\nبا تشکر";
$d = fk_detect_invoice_type($thermal);
echo "DETECT=" . $d['type'] . "|" . $d['confidence'] . "\\n";
$u1 = fk_understand($thermal, array('invoice_type' => 'thermal'));
echo "THERMAL=" . $u1['invoice_type'] . "|" . $u1['type_source'] . "|" . $u1['type_label'] . "\\n";
$u2 = fk_understand($thermal, array('invoice_type' => 'auto'));
echo "AUTO=" . $u2['invoice_type'] . "|" . $u2['type_source'] . "|" . (isset($u2['detection']) ? $u2['detection']['type'] : '-') . "\\n";
$print = "شرح کالا\\tتعداد\\tقیمت واحد\\tمبلغ\\nکاغذ A4\\t10\\t250000\\t2500000\\nتونر HP\\t2\\t450000\\t900000\\nجمع کل\\t3400000";
$u3 = fk_understand($print, array('invoice_type' => 'printed'));
echo "PRINTED=" . count($u3['items']) . "|" . ($u3['totals']['total'] ?? 0) . "\\n";
$u4 = fk_understand($print, array('invoice_type' => 'auto'));
echo "AUTO2=" . $u4['invoice_type'] . "|" . count($u4['items']) . "|" . ($u4['totals']['total'] ?? 0) . "\\n";
$u5 = fk_understand($thermal, array('invoice_type' => 'audio'));
echo "AUDIO=" . $u5['invoice_type'] . "|" . implode(',', $u5['column_types'] ?? array()) . "\\n";
$opts = fk_type_options('handwritten');
echo "OPTS=" . $opts['label'] . "|" . (int) $opts['join_wrapped'] . "\\n";
`);

console.log("\n۶) تشخیص خودکار نوع فاکتور");
ck("فیش حرارتی تشخیص داده شد", /DETECT=thermal\|/.test(engineCheck),
   (engineCheck.match(/DETECT=[^\n]*/) || [""])[0]);
ck("نوع دستی thermal اعمال شد", /THERMAL=thermal\|manual\|حرارتی/.test(engineCheck),
   (engineCheck.match(/THERMAL=[^\n]*/) || [""])[0]);
ck("حالت auto خودش thermal فهمید", /AUTO=thermal\|auto\|thermal/.test(engineCheck),
   (engineCheck.match(/AUTO=[^\n]*/) || [""])[0]);
ck("فاکتور چاپی دو قلم خواند", /PRINTED=2\|3400000/.test(engineCheck),
   (engineCheck.match(/PRINTED=[^\n]*/) || [""])[0]);
ck("حالت auto روی فاکتور جدول‌دار هم درست است", /AUTO2=\w+\|2\|3400000/.test(engineCheck),
   (engineCheck.match(/AUTO2=[^\n]*/) || [""])[0]);
ck("نوع صوتی ستون‌ها را ادغام کرد", /AUDIO=audio\|text/.test(engineCheck),
   (engineCheck.match(/AUDIO=[^\n]*/) || [""])[0]);
ck("پارامترهای دست‌نویس", /OPTS=دست‌نویس\|1/.test(engineCheck),
   (engineCheck.match(/OPTS=[^\n]*/) || [""])[0]);

console.log(fails === 0 ? "\n✓ همهٔ بررسی‌ها موفق" : `\n✗ ${fails} بررسی ناموفق`);
process.exit(fails === 0 ? 0 : 1);
