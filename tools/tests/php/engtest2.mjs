import { PhpNode } from "php-wasm/PhpNode.mjs";
import fs from "fs";
const SRC = new URL("../../../deploy/php", import.meta.url).pathname;
const eng = fs.readFileSync(`${SRC}/engine.php`, "utf8").replace(/^<\?php/, "");

let pass = 0, fail = 0;
const check = (n, c, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? " — " + e : "")); } };

async function runPhp(code) {
  const php = new PhpNode();
  await new Promise(r => php.addEventListener("ready", r));
  let out = "";
  php.addEventListener("output", e => { out += e.detail.join(""); });
  await php.run(`<?php
ini_set('display_errors','0'); error_reporting(E_ALL & ~E_DEPRECATED);
${eng}
${code}`);
  await new Promise(r => setTimeout(r, 300));
  return out;
}
const enc = s => Buffer.from(s, "utf8").toString("base64");
const PHP_TEXT = (t) => `base64_decode('${enc(t)}')`;

const PRINTED = `فاکتور خرید
شماره: 1404/1234
فروشنده: شرکت نمونه

ردیف	شرح کالا	تعداد	قیمت واحد	مبلغ کل
1	کاغذ A4 بسته 500 برگ	10	450,000	4,500,000
2	تونر پرینتر HP	2	1,200,000	2,400,000
3	خودکار آبی	50	15,000	700,000

جمع کل: 7,600,000
مالیات: 760,000
مبلغ نهایی: 8,360,000`;

const THERMAL = `فروشگاه رفاه
نان سنگک  2  15,000  30,000
شیر 1 لیتری  3  32,000  96,000
پنیر  1  120,000  120,000
جمع: 246,000`;

const ARABIC = `فاتوره
كاغذ  2  450,000  900,000
تونر  1  1,200,000  1,200,000
الإجمالي: 2,100,000`;

const t = await runPhp(`
$printed = fk_understand(${PHP_TEXT(PRINTED)});
$thermal = fk_understand(${PHP_TEXT(THERMAL)});
$arabic  = fk_understand(${PHP_TEXT(ARABIC)});
echo "@@" . base64_encode(json_encode(array(
  "printed" => $printed, "thermal" => $thermal, "arabic" => $arabic,
), JSON_UNESCAPED_UNICODE)) . "@@";
`);
const m = t.match(/@@([A-Za-z0-9+/=]+)@@/);
if (!m) { console.log("RAW:", t.slice(0, 800)); process.exit(1); }
const R = JSON.parse(Buffer.from(m[1], "base64").toString("utf8"));

console.log("\n[۲] فاکتور چاپی با سرستون");
const p = R.printed;
check("سه قلم", p.item_count === 3, String(p.item_count));
check("توضیح اول", (p.items[0] || {}).description === "کاغذ A4 بسته 500 برگ", (p.items[0]||{}).description);
check("تعداد ۱۰", (p.items[0] || {}).qty === 10, String((p.items[0]||{}).qty));
check("قیمت ۴۵۰٬۰۰۰", (p.items[0] || {}).unit_price === 450000, String((p.items[0]||{}).unit_price));
check("مبلغ ۴٬۵۰۰٬۰۰۰", (p.items[0] || {}).total === 4500000, String((p.items[0]||{}).total));
check("سرستون شناخته شد", Object.keys(p.mapping || {}).length >= 3, JSON.stringify(p.mapping));
check("مالیات خوانده شد", (p.totals || {}).tax === 760000, String((p.totals||{}).tax));
check("مبلغ نهایی", (p.totals || {}).total === 8360000, String((p.totals||{}).total));
check("ردیف ۳ اصلاح شد", (p.items[2] || {}).total === 750000, String((p.items[2]||{}).total));
check("اصلاح گزارش شد", (p.autofixed || []).length >= 1, JSON.stringify(p.autofixed));
check("جمع اقلام بازمحاسبه", (p.totals || {}).items_sum === 7650000, String((p.totals||{}).items_sum));

console.log("\n[۳] فاکتور حرارتی بدون سرستون");
const th = R.thermal;
check("سه قلم", th.item_count === 3, String(th.item_count));
check("جمع درست", (th.totals || {}).items_sum === 246000, String((th.totals||{}).items_sum));
check("اعتماد بالا", th.confidence >= 70, String(th.confidence));
check("قیمت واحد پیدا شد", (th.items[1] || {}).unit_price === 32000, JSON.stringify(th.items[1] || {}));

console.log("\n[۴] فاکتور عربی (ك/ي)");
const ar = R.arabic;
check("دو قلم", ar.item_count === 2, String(ar.item_count));
check("ی فارسی شد", ((ar.items[0]||{}).description || "").includes("ی") || ((ar.items[0]||{}).description||"").includes("کاغذ"), (ar.items[0]||{}).description);
check("جمع", (ar.totals || {}).items_sum === 2100000, String((ar.totals||{}).items_sum));

console.log(`\nنتیجه: ${pass} از ${pass+fail}`);
process.exit(fail ? 1 : 0);
