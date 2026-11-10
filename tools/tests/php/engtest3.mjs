import { PhpNode } from "php-wasm/PhpNode.mjs";
import fs from "fs";
const eng = fs.readFileSync("/home/user/faktorkhan/deploy/php/engine.php","utf8").replace(/^<\?php/,"");
let pass=0, fail=0;
const ck=(n,c,e="")=>{ if(c){pass++;console.log("  ✓ "+n);} else {fail++;console.log("  ✗ "+n+(e?" — "+e:""));} };
const B=s=>Buffer.from(s,"utf8").toString("base64");

const php = new PhpNode();
await new Promise(r=>php.addEventListener("ready",r));
let out=""; php.addEventListener("output",e=>{out+=e.detail.join("")});

const SAMPLE = `شرکت نمونه — صفحه 1 از 3
فاکتور خرید
فاکتور خرید
ردیف	شرح کالا	تعداد	قیمت واحد	مبلغ کل
1	کاغذ A4 بسته 500 برگ که برای چاپ
دفترچه راهنما استفاده می‌شود	10	450,000	4,500,000
2	تونر	2	1,200,000	2,400,000
X
3	کالای خیلی طولانی که در یک سطر جا نمی‌شود و باید شکسته شود الف ب ج د ه و ز ح ط ی ک ل م ن س ش ص ض  12	1,000	12,000
شرکت نمونه — صفحه 1 از 3
شرکت نمونه — صفحه 1 از 3
شرکت نمونه — صفحه 1 از 3
جمع کل: 6,912,000`;

await php.run(`<?php
ini_set('display_errors','0');
${eng}
$raw = base64_decode('${B(SAMPLE)}');
echo "@@" . base64_encode(json_encode(array(
  "invisible" => fk_strip_invisible("a\\xEF\\xBB\\xBFb"),
  "arabic" => fk_norm_chars("كتاب"),
  "clean" => fk_clean_for_reading($raw),
  "heads" => fk_drop_running_heads($raw),
  "dedupe" => fk_dedupe_lines("a\\nb\\nb\\nb\\nc"),
  "join" => fk_join_wrapped("1 کاغذ 10 5000\\nبرای چاپ\\n2 تونر 1 2000"),
  "punct" => fk_tidy_punctuation("جمع ، کل ( 1,000 )"),
), JSON_UNESCAPED_UNICODE)) . "@@";
`);
await new Promise(r=>setTimeout(r,700));
const m=out.match(/@@([A-Za-z0-9+/=]+)@@/);
if(!m){console.log("RAW:",out.slice(0,600));process.exit(1);}
const R=JSON.parse(Buffer.from(m[1],"base64").toString("utf8"));

console.log("\n[۵] پاکسازی پیشرفته");
ck("BOM حذف شد", R.invisible==="ab", JSON.stringify(R.invisible));
ck("ك → ک", R.arabic==="کتاب", R.arabic);
ck("سطر تکراری حذف شد", (R.dedupe.match(/\nb/g)||[]).length===1, JSON.stringify(R.dedupe));
ck("شرح شکسته‌شده چسبید", R.join.includes("برای چاپ"), JSON.stringify(R.join));
ck("نقطه‌گذاری مرتب شد", !R.punct.includes(" ،") && !R.punct.includes("( "), JSON.stringify(R.punct));

const clean = R.clean;
ck("سرصفحه «صفحه 1 از 3» حذف شد", !clean.includes("صفحه 1 از 3"), clean.slice(0,80));
ck("سطر نویز «X» حذف شد", !clean.split("\n").some(l=>l.trim()==="X"));
ck("متن پاک طولانی است", clean.length > 100, String(clean.length));
ck("جدول سالم ماند", clean.includes("450,000") && clean.includes("2,400,000"));
console.log("\n--- متن پاک‌شده ---");
console.log(clean.slice(0,420));
console.log(`\nنتیجه: ${pass} از ${pass+fail}`);
process.exit(fail?1:0);
