#!/usr/bin/env node
/**
 * آزمون موتور محلی (بدون سرویس ابری)
 * ==================================
 * نسخهٔ پایتون local_ocr.py دارد: PDF متنی را بدون اینترنت می‌خواند.
 * نسخهٔ PHP تا پیش از این شاخهٔ «local» در job_tick نداشت — کار تا ابد
 * در صف می‌ماند و بعد «زمان انتظار تمام شد» می‌داد، بی‌آنکه هیچ
 * درخواستی به بیرون رفته باشد.
 *
 * این آزمون قرارداد پایتون را می‌سنجد: متن درست، یا پیام روشن.
 *
 * اجرا:  node tools/tests/php/localocr.mjs
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

/**
 * ساخت PDF کمینه. اگر utf16 باشد، رشته‌ها با /ToUnicode نیستند ولی
 * خودِ استخراج‌کننده UTF-16BE را از روی الگوی بایت‌ها تشخیص می‌دهد.
 */
function makePdf(lines, { utf16 = true, textLayer = true } = {}) {
  let content;
  if (!textLayer) {
    content = Buffer.from("q 100 0 0 100 50 600 cm /Im1 Do Q", "latin1");
  } else if (utf16 && lines.length) {
    let parts = [Buffer.from("BT /F1 12 Tf 50 750 Td ", "latin1")];
    lines.forEach((l, i) => {
      if (i) parts.push(Buffer.from("0 -22 Td ", "latin1"));
      const hex = Buffer.from(l, "utf16le").swap16().toString("hex").toUpperCase();
      parts.push(Buffer.from(`<${hex}> Tj `, "latin1"));
    });
    parts.push(Buffer.from("ET", "latin1"));
    content = Buffer.concat(parts);
  } else {
    const esc = (s) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
    let c = "BT /F1 12 Tf 50 750 Td ";
    lines.forEach((l, i) => { if (i) c += "0 -22 Td "; c += `(${esc(l)}) Tj `; });
    content = Buffer.from(c + "ET", "latin1");
  }

  const comp = zlib.deflateSync(content);
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
      + "/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${comp.length} /Filter /FlateDecode >>\nstream\n${comp.toString("latin1")}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  offs.forEach((o) => { out += String(o).padStart(10, "0") + " 00000 n \n"; });
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

/**
 * اجرای یک کار محلی. فایل با writeFile داخل ماشین php گذاشته می‌شود
 * (نه از راه JSON) تا بایت‌ها سالم برسند.
 */
async function runLocal(fileName, bytes, displayName) {
  const php = new PhpNode();
  await new Promise((r) => php.addEventListener("ready", r));
  let out = "";
  php.addEventListener("output", (e) => { out += e.detail.join(""); });
  await php.run('<?php @mkdir("/app",0777,true);'
    + ' @mkdir("/app/fk-uploads",0777,true); @mkdir("/app/fk-jobs",0777,true);'
    + ' @mkdir("/app/fk-sessions",0777,true); @mkdir("/app/fk-data",0777,true);');
  for (const n of ["lib.php", "engine.php", "data.php", "store.php", "api_helpers.php", "library.php"]) {
    php.writeFile("/app/" + n, patch(fs.readFileSync(path.join(SRC, n), "utf8")));
  }
  php.writeFile("/app/fk-uploads/" + fileName, bytes);
  const name = JSON.stringify(displayName);
  await php.run(`<?php
class FkExit extends Exception {}
require "/app/lib.php"; require "/app/data.php"; require "/app/store.php";
require "/app/api_helpers.php"; require "/app/library.php";
$job = array(
  'id'=>job_id(), 'user_id'=>1, 'status'=>'queued', 'stage'=>'queued', 'progress'=>0,
  'message'=>'در صف', 'text'=>'', 'pages'=>0, 'file_token'=>'', 'created_at'=>time(),
  'updated_at'=>time(), 'download'=>'', 'saved'=>'', 'saved_bytes'=>0, 'txt_file'=>'',
  'charcount'=>0, 'out_kind'=>'', 'docx_rebuilt'=>false, 'engine'=>'local',
  'invoice_type'=>'printed', 'ai_tried'=>false, 'error'=>'', 'attempts'=>0,
  'deadline'=>time()+1800, 'method'=>4, 'output'=>'txtrawjson', 'language'=>'fa',
  'name'=>${name}, 'delete_after'=>false, 'source_link'=>'',
  'local'=>'/app/fk-uploads/${fileName}', 'mime'=>'application/octet-stream', 'bytes'=>0,
);
job_save($job);
$job = job_tick($job, 20);
echo "@@J@@";
echo json_encode(array(
  'status' => $job['status'], 'progress' => $job['progress'],
  'message' => $job['message'], 'pages' => (int) $job['pages'],
  'text' => (string) $job['text'], 'error' => (string) $job['error'],
), JSON_UNESCAPED_UNICODE);
`);
  const i = out.lastIndexOf("@@J@@");
  const raw = i >= 0 ? out.slice(i + 5) : "";
  return raw ? JSON.parse(raw.trim()) : { status: "?parse", raw: out.slice(0, 200) };
}

console.log("\n۱) PDF متنی فارسی — همان چیزی که Word/چاپگر می‌سازد");
{
  const pdf = makePdf(["فروشگاه آفتاب", "شماره فاکتور: 88", "جمع کل: 600,000"]);
  const j = await runLocal("fa.pdf", pdf, "فاکتور فارسی.pdf");
  ck("وضعیت done", j.status === "done", j.status);
  ck("پیشرفت ۱۰۰٪", Number(j.progress) === 100, String(j.progress));
  ck("شمارهٔ ۸۸ استخراج شد", /88/.test(j.text || ""), JSON.stringify((j.text || "").slice(0, 60)));
  ck("نام فروشنده استخراج شد", /آفتاب/.test(j.text || ""));
  ck("جمع کل استخراج شد", /600,000/.test(j.text || ""));
  ck("پیام موفقیت", /کامل شد/.test(j.message || ""), j.message);
}

console.log("\n۲) PDF لاتین بدون فشرده‌سازی");
{
  const pdf = makePdf(["ACME STORE", "Invoice: 4021", "Total: 1,250,000"], { utf16: false });
  const j = await runLocal("en.pdf", pdf, "invoice.pdf");
  ck("وضعیت done", j.status === "done", j.status);
  ck("متن لاتین برگشت", /ACME STORE/.test(j.text || ""), JSON.stringify((j.text || "").slice(0, 60)));
  ck("مبلغ برگشت", /1,250,000/.test(j.text || ""));
}

console.log("\n۳) PDF بدون لایهٔ متنی → پیام روشن (نه متن خالی)");
{
  const pdf = makePdf([], { textLayer: false });
  const j = await runLocal("scan.pdf", pdf, "اسکن.pdf");
  ck("وضعیت failed", j.status === "failed", j.status);
  ck("پیام می‌گوید چرا", /لایهٔ متنی|اسکن|تصویری/.test(j.message || ""), (j.message || "").slice(0, 70));
  ck("کد خطای مشخص", j.error === "LocalNoText", j.error);
  ck("متن خالی است (نه آشغال)", !j.text || j.text.trim() === "");
}

console.log("\n۴) فایل متنی ساده");
{
  const j = await runLocal("note.txt", Buffer.from("فروشگاه نمونه\nجمع کل: 150,000\n", "utf8"), "note.txt");
  ck("وضعیت done", j.status === "done", j.status);
  ck("متن برگشت", /150,000/.test(j.text || ""), (j.text || "").slice(0, 40));
}

console.log("\n۵) قالب پشتیبانی‌نشده (صدا) → پیام روشن");
{
  const j = await runLocal("s.mp3", Buffer.from("ID3fakeaudio"), "song.mp3");
  ck("وضعیت failed", j.status === "failed", j.status);
  ck("پیام دربارهٔ موتور ابری", /ابری|صدا/.test(j.message || ""), (j.message || "").slice(0, 70));
}

console.log("\n۶) نگهبان ساختاری");
{
  const lib = fs.readFileSync(path.join(SRC, "lib.php"), "utf8");
  const api = fs.readFileSync(path.join(SRC, "api.php"), "utf8");
  ck("job_tick شاخهٔ local دارد", /\$job\['engine'\]\s*\?\?\s*'cloud'\)\s*===\s*'local'/.test(lib));
  ck("تابع استخراج PDF", /function fk_pdf_extract_text/.test(lib));
  ck("بازکنندهٔ zlib جدا از deflate خام", /function fk_pdf_inflate/.test(lib));
  ck("api_fail با پیام خالی صدا زده نمی‌شود",
     /\$job\['error'\][^\n]*!==\s*''/.test(api), "isset به‌تنهایی کافی نبود");
  /* خودِ فراخوانی هست، ولی همیشه با پیام غیرخالی */
  /* الگو: if (isset(...) && ... !== '') { api_fail(...) }
     پرانتز بستهٔ isset قبل از && است، پس [\s\S] تا آکولاد استفاده می‌شود. */
  const calls = [...api.matchAll(
    /if \(isset\(\$job\['error'\]\)([\s\S]{0,120}?)\)\s*\{\s*api_fail\(/g)];
  ck("هر دو فراخوانی api_fail گارد مقدار دارند", calls.length === 2, calls.length + " مورد");
  ck("گارد مقدار خالی دارد", calls.every((m) => m[1].includes("!== ''")),
     calls.map((c) => c[1].trim()).join(" | "));
}

console.log("\n۷) زنجیرهٔ کامل: PDF → متن → فاکتور فهمیده‌شده");
{
  const pdf = makePdf([
    "فروشگاه آفتاب", "شماره فاکتور: 88",
    "کاغذ\t3\t200,000\t600,000", "جمع کل: 600,000",
  ]);
  const php = new PhpNode();
  await new Promise((r) => php.addEventListener("ready", r));
  let out = "";
  php.addEventListener("output", (e) => { out += e.detail.join(""); });
  await php.run('<?php @mkdir("/app",0777,true); @mkdir("/app/fk-uploads",0777,true);'
    + ' @mkdir("/app/fk-jobs",0777,true); @mkdir("/app/fk-sessions",0777,true);'
    + ' @mkdir("/app/fk-data",0777,true);');
  for (const n of ["lib.php", "engine.php", "data.php", "store.php", "api_helpers.php", "library.php"]) {
    php.writeFile("/app/" + n, patch(fs.readFileSync(path.join(SRC, n), "utf8")));
  }
  php.writeFile("/app/fk-uploads/inv.pdf", pdf);
  await php.run(`<?php
class FkExit extends Exception {}
require "/app/lib.php"; require "/app/data.php"; require "/app/store.php";
require "/app/api_helpers.php"; require "/app/library.php";
$job = array('id'=>job_id(),'user_id'=>1,'status'=>'queued','stage'=>'queued','progress'=>0,
 'message'=>'','text'=>'','pages'=>0,'file_token'=>'','created_at'=>time(),'updated_at'=>time(),
 'download'=>'','saved'=>'','saved_bytes'=>0,'txt_file'=>'','charcount'=>0,'out_kind'=>'',
 'docx_rebuilt'=>false,'engine'=>'local','invoice_type'=>'printed','ai_tried'=>false,
 'error'=>'','attempts'=>0,'deadline'=>time()+1800,'method'=>4,'output'=>'txtrawjson',
 'language'=>'fa','name'=>'inv.pdf','delete_after'=>false,'source_link'=>'',
 'local'=>'/app/fk-uploads/inv.pdf','mime'=>'application/pdf','bytes'=>0);
job_save($job);
$job = job_tick($job, 20);
$u = api_understand((string) $job['text'], 'printed', true);
echo "@@J@@";
echo json_encode(array(
  'status' => $job['status'],
  'number' => $u['parsed']['number'] ?? '',
  'seller' => $u['parsed']['seller_name'] ?? '',
  'items'  => (int) ($u['item_count'] ?? 0),
  'sum'    => (int) ($u['items_sum'] ?? 0),
  'total'  => (int) ($u['parsed']['total'] ?? 0),
), JSON_UNESCAPED_UNICODE);
`);
  const i = out.lastIndexOf("@@J@@");
  const j = JSON.parse(out.slice(i + 5).trim());
  ck("کار done شد", j.status === "done", j.status);
  ck("شمارهٔ فاکتور ۸۸", String(j.number) === "88", String(j.number));
  ck("فروشنده «آفتاب»", j.seller === "آفتاب", j.seller);
  ck("یک قلم", j.items === 1, String(j.items));
  ck("جمع اقلام ۶۰۰٬۰۰۰", j.sum === 600000, String(j.sum));
  ck("مبلغ کل ۶۰۰٬۰۰۰", j.total === 600000, String(j.total));
}

console.log("\n" + "═".repeat(64));
console.log(fails === 0 ? `✓ همهٔ ${checks} بررسی موتور محلی موفق` : `✗ ${fails} از ${checks} بررسی ناموفق`);
console.log("═".repeat(64));
process.exit(fails === 0 ? 0 : 1);
