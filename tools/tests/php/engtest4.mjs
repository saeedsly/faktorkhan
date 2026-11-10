import { PhpNode } from "php-wasm/PhpNode.mjs";
import fs from "fs";
const eng = fs.readFileSync("/home/user/faktorkhan/deploy/php/engine.php","utf8").replace(/^<\?php/,"");
let pass=0, fail=0;
const ck=(n,c,e="")=>{ if(c){pass++;console.log("  ✓ "+n);} else {fail++;console.log("  ✗ "+n+(e?" — "+e:""));} };
const B=s=>Buffer.from(s,"utf8").toString("base64");
const php = new PhpNode();
await new Promise(r=>php.addEventListener("ready",r));
let out=""; php.addEventListener("output",e=>{out+=e.detail.join("")});

const T = `فاکتور فروش
شماره فاکتور: 1404/5566
تاریخ: ۱۶ آبان ۱۴۰۴
مبلغ به تومان

ردیف	شرح	تعداد	قیمت واحد	مبلغ کل
1	لپ‌تاپ	2	45,000,000	90,000,000
2	ماوس	5	1,200,000	6,000,000
جمع کل: 96,000,000
مالیات ۹٪: 8,640,000
قابل پرداخت: 104,640,000`;

await php.run(`<?php
ini_set('display_errors','0');
${eng}
$t = base64_decode('${B(T)}');
$u = fk_understand($t);
$meta = fk_detect_meta($t, $u['totals']);
$q = fk_quality_report($t, $u);
$sug = fk_suggestions('jpg', 40000, 2, array('slow'=>true));
echo "@@" . base64_encode(json_encode(array(
  "u" => $u, "meta" => $meta, "q" => $q, "sug" => $sug,
  "dates" => fk_find_dates($t),
  "dates2" => fk_find_dates("تاریخ 1404/08/16 و 2024-05-12"),
  "num" => fk_find_invoice_number($t),
  "cur" => fk_detect_currency($t),
  "cur2" => fk_detect_currency("مبلغ به ریال"),
  "taxrate" => fk_detect_tax_rate($t, $u['totals']),
), JSON_UNESCAPED_UNICODE)) . "@@";
`);
await new Promise(r=>setTimeout(r,700));
const m=out.match(/@@([A-Za-z0-9+/=]+)@@/);
if(!m){console.log("RAW:",out.slice(0,900));process.exit(1);}
const R=JSON.parse(Buffer.from(m[1],"base64").toString("utf8"));

console.log("\n[۶] فراداده");
ck("تاریخ شمسی از نام ماه", (R.dates.find(d=>d.value==="1404/08/16")||{}).value==="1404/08/16", JSON.stringify(R.dates));
ck("تاریخ شمسی از عدد", R.dates2.length>=1 && R.dates2.some(d=>d.type==="jalali"), JSON.stringify(R.dates2));
ck("تاریخ میلادی", R.dates2.some(d=>d.type==="gregorian"), JSON.stringify(R.dates2));
ck("شمارهٔ فاکتور", R.num==="1404/5566", R.num);
ck("واحد پول تومان", R.cur.code==="IRT", JSON.stringify(R.cur));
ck("واحد پول ریال", R.cur2.code==="IRR", JSON.stringify(R.cur2));
ck("نرخ مالیات ۹٪", R.taxrate===9, String(R.taxrate));
ck("meta.date", R.meta.date==="1404/08/16", R.meta.date);

console.log("\n[۷] کیفیت و پیشنهاد");
ck("نمرهٔ کیفیت", R.q.score>=70, String(R.q.score));
ck("درجه", ["A","B"].includes(R.q.grade), R.q.grade);
ck("چک‌ها ساخته شدند", R.q.checks.length===5, String(R.q.checks.length));
ck("پیشنهاد عکس کوچک", R.sug.some(s=>s.includes("کیفیت بالاتر")));
ck("پیشنهاد کندی", R.sug.some(s=>s.includes("کند")));

console.log("\n[۸] فهم کامل");
ck("سه قلم؟", R.u.item_count===2, String(R.u.item_count));
ck("مالیات خوانده شد", (R.u.totals.tax||0)===8640000, String(R.u.totals.tax));
ck("قابل پرداخت", (R.u.totals.total||0)===104640000, String(R.u.totals.total));
ck("جمع اقلام", (R.u.totals.items_sum||0)===96000000, String(R.u.totals.items_sum));
console.log(`\nنتیجه: ${pass} از ${pass+fail}`);
process.exit(fail?1:0);
