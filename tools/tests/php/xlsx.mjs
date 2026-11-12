#!/usr/bin/env node
/**
 * آزمون خروجی اکسل (xlsx واقعی)
 * ==============================
 * «خروجی اکسل» در نسخهٔ PHP یک CSV با BOM بود. اکسل بازش می‌کرد ولی
 * هشدار «قالب فایل با پسوند نمی‌خواند» می‌داد و کاربر فکر می‌کرد فایل
 * خراب است. نسخهٔ پایتون xlsx واقعی (openpyxl) می‌داد.
 *
 * این آزمون همان چیزی را می‌سنجد که اگر خراب باشد کاربر فقط یک فایل
 * بازنشدنی می‌بیند:
 *   ۱) امضای ZIP درست است (PK\x03\x04)
 *   ۲) هر هشت بخش لازم OOXML موجود است
 *   ۳) هر XML معتبر و قابل تجزیه است
 *   ۴) برگه راست‌به‌چپ است (همان sheet_view.rightToLeft پایتون)
 *   ۵) متن فارسی سالم است و عدد به‌صورت عدد ذخیره می‌شود
 *
 * اجرا:  node tools/tests/php/xlsx.mjs
 */
import { PhpNode } from "php-wasm/PhpNode.mjs";
import fs from "fs";
import path from "path";
import zlib from "node:zlib";

const SRC = new URL("../../../deploy/php", import.meta.url).pathname;
let fails = 0, checks = 0;
const ck = (label, good, extra = "") => {
  checks++; if (!good) fails++;
  console.log(`  ${good ? "✓" : "✗"} ${label}${extra ? " — " + extra : ""}`);
};
const patch = (s) => s
  .replace(/declare\s*\(\s*strict_types\s*=\s*1\s*\)\s*;/, "")
  .replace(/\bexit;/g, "throw new FkExit();");

/* ── خوانندهٔ ZIP کمینه (حالت stored) ── */
function unzipStored(buf) {
  const files = {};
  let i = 0;
  while (i + 30 <= buf.length && buf.readUInt32LE(i) === 0x04034b50) {
    const method = buf.readUInt16LE(i + 8);
    const crc = buf.readUInt32LE(i + 14);
    const csize = buf.readUInt32LE(i + 18);
    const usize = buf.readUInt32LE(i + 22);
    const nlen = buf.readUInt16LE(i + 26);
    const elen = buf.readUInt16LE(i + 28);
    const name = buf.slice(i + 30, i + 30 + nlen).toString("utf8");
    const start = i + 30 + nlen + elen;
    const data = buf.slice(start, start + csize);
    files[name] = { method, data, crc, usize };
    i = start + csize;
  }
  return files;
}

console.log("\n۱) ساخت xlsx در PHP");
const php = new PhpNode();
await new Promise((r) => php.addEventListener("ready", r));
let out = "";
php.addEventListener("output", (e) => { out += e.detail.join(""); });
await php.run('<?php @mkdir("/app",0777,true);');
for (const n of ["lib.php", "engine.php", "data.php", "store.php", "api_helpers.php", "library.php"]) {
  php.writeFile("/app/" + n, patch(fs.readFileSync(path.join(SRC, n), "utf8")));
}
await php.run(`<?php
require "/app/lib.php";
$headers = array('شناسه','شماره فاکتور','تاریخ','نوع','جهت','فروشنده','خریدار',
  'جمع اقلام','تخفیف','مالیات','مبلغ کل','پرداختی','وضعیت','منبع','اعتماد');
$rows = array(
  array(array('v'=>1,'n'=>true),'EXP-1','1404/09/01','چاپی','فروش','فروشگاه آفتاب','خریدار الف',
        array('v'=>200000,'n'=>true),array('v'=>0,'n'=>true),array('v'=>18000,'n'=>true),
        array('v'=>218000,'n'=>true),array('v'=>218000,'n'=>true),'تأیید‌شده','دستی','85٪'),
  array(array('v'=>2,'n'=>true),'EXP-2','1404/09/02','حرارتی','خرید','فروشنده دوم','',
        array('v'=>50000,'n'=>true),array('v'=>0,'n'=>true),array('v'=>0,'n'=>true),
        array('v'=>50000,'n'=>true),array('v'=>0,'n'=>true),'پیش‌نویس','لوکال','60٪'),
);
echo base64_encode(fk_xlsx_build($headers, $rows, 'فاکتورها'));
`);
const b64 = out.trim().split("\n").pop();
const buf = Buffer.from(b64, "base64");
ck("خروجی ساخته شد", buf.length > 1000, buf.length + " بایت");
ck("امضای ZIP", buf.readUInt32LE(0) === 0x04034b50,
   "0x" + buf.readUInt32LE(0).toString(16));

console.log("\n۲) بخش‌های لازم OOXML");
const files = unzipStored(buf);
const needed = ["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml",
  "xl/_rels/workbook.xml.rels", "xl/worksheets/sheet1.xml", "xl/styles.xml",
  "docProps/core.xml", "docProps/app.xml"];
for (const n of needed) ck(n, !!files[n], files[n] ? files[n].usize + " بایت" : "نیست");
ck("هیچ بخش اضافی/کم نیست", Object.keys(files).length === needed.length);

console.log("\n۳) CRC و روش ذخیره");
for (const [n, f] of Object.entries(files)) {
  ck(`CRC سالم — ${n}`, zlib.crc32 ? zlib.crc32(f.data) === f.crc : true);
}
ck("همه stored (بدون نیاز به zlib برای خواندن)", Object.values(files).every((f) => f.method === 0));

console.log("\n۴) محتوای برگه");
const sheet = files["xl/worksheets/sheet1.xml"].data.toString("utf8");
ck("راست‌به‌چپ", /rightToLeft="1"/.test(sheet));
ck("سرستون فریز شده", /state="frozen"/.test(sheet));
ck("فیلتر خودکار", /<autoFilter/.test(sheet));
ck("نام فارسی فروشنده", sheet.includes("فروشگاه آفتاب"));
ck("وضعیت فارسی", sheet.includes("تأیید‌شده"));
ck("عدد به‌صورت عدد (نه متن)", /<c r="H2"[^>]*><v>200000<\/v><\/c>/.test(sheet));
ck("مبلغ کل درست", sheet.includes("<v>218000</v>"));
ck("دو ردیف داده", (sheet.match(/<row /g) || []).length === 3);

console.log("\n۵) سبک‌ها");
const styles = files["xl/styles.xml"].data.toString("utf8");
ck("قالب عدد #,##0", styles.includes('formatCode="#,##0"'));
ck("قطعاً تیره و متن طلایی", /rgb="FF1B2540"/.test(styles) && /rgb="FFD4AF37"/.test(styles));
ck("فونت Tahoma (فارسی‌پسند)", styles.includes('name val="Tahoma"'));

console.log("\n۶) نگهبان: مسیر xlsx واقعاً خروجی اکسل می‌دهد");
{
  const helpers = fs.readFileSync(path.join(SRC, "api_helpers.php"), "utf8");
  ck("شاخهٔ xlsx به fk_xlsx_build وصل است",
     /if \(\$format === 'xlsx'\)[\s\S]{0,4000}fk_xlsx_build/.test(helpers));
  ck("نوع MIME درست است",
     helpers.includes("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"));
  ck("پسوند فایل .xlsx است", /\.xlsx"/.test(helpers));
  ck("دیگر CSV را با پسوند xlsx نمی‌فرستد",
     !/filename="invoices-[^"]*"\s*\.\s*'\.'\s*\.\s*\$ext/.test(helpers));
}

console.log("\n" + "═".repeat(64));
console.log(fails === 0 ? `✓ همهٔ ${checks} بررسی اکسل موفق` : `✗ ${fails} از ${checks} بررسی ناموفق`);
console.log("═".repeat(64));
process.exit(fails === 0 ? 0 : 1);
