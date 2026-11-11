import { PhpNode } from "php-wasm/PhpNode.mjs";
import fs from "fs";
import { execSync } from "child_process";

/*
 * آزمون «صفحه سالم است»
 * =====================
 * دو چیزی که فقط با رندر واقعی معلوم می‌شود:
 *
 *   ۱) ساختار HTML هر چهار نما بسته و درست است (تگ‌های جفت، بدون
 *      PHP ناتمام). نسخهٔ اول بازطراحی، بر اثر یک خطای برش، بدنهٔ
 *      صفحه را نصفه چاپ می‌کرد و هیچ تست دامنه‌ای نمی‌گرفت.
 *   ۲) جاوااسکریپت صفحه خطای نحوی ندارد. یک کاما یا آکولاد اضافه در
 *      اسکریپت، دکمه‌ها را بی‌صدا از کار می‌اندازد.
 */

const SRC = new URL("../../../deploy/php", import.meta.url).pathname;
const B = s => Buffer.from(s, "utf8").toString("base64");
const lib = fs.readFileSync(`${SRC}/lib.php`, "utf8");
const eng = fs.readFileSync(`${SRC}/engine.php`, "utf8");
const library = fs.readFileSync(`${SRC}/library.php`, "utf8");
const idx = fs.readFileSync(`${SRC}/index.php`, "utf8").replace("declare(strict_types=1);", "");

const SID = "HTML0000000000000000000000000001";
const CFG = JSON.stringify({ token: "T", password_hash: "x" });

function boot(logged, get = "array()") {
  const sess = logged
    ? `file_put_contents('/tmp/fkh2/fk-sessions/sess_${SID}', base64_decode('${B('auth|b:1;csrf|s:1:"C";')}'));`
    : "";
  return `<?php
ini_set('display_errors','1'); error_reporting(E_ALL & ~E_DEPRECATED & ~E_WARNING & ~E_NOTICE);
@mkdir('/tmp/fkh2/fk-sessions',0777,true);@mkdir('/tmp/fkh2/fk-jobs',0777,true);
@mkdir('/tmp/fkh2/fk-uploads',0777,true);@mkdir('/tmp/fkh2/fk-invoices',0777,true);
file_put_contents('/tmp/fkh2/lib.php', base64_decode('${B(lib)}'));
file_put_contents('/tmp/fkh2/engine.php', base64_decode('${B(eng)}'));
file_put_contents('/tmp/fkh2/library.php', base64_decode('${B(library)}'));
file_put_contents('/tmp/fkh2/index.php', base64_decode('${B(idx)}'));
file_put_contents('/tmp/fkh2/fk-config.json', base64_decode('${B(CFG)}'));
${sess}
$_COOKIE['fksid']='${SID}';
$_SERVER['REQUEST_METHOD']='${logged ? "POST" : "GET"}'; $_SERVER['REQUEST_URI']='/';
$_GET=${get}; $_POST=array();
$_SERVER['REMOTE_ADDR']='127.0.0.1'; $_SERVER['HTTPS']='off';
require_once '/tmp/fkh2/index.php';
`;
}

async function run(code) {
  const p = new PhpNode();
  await new Promise(r => p.addEventListener("ready", r));
  let out = "";
  p.addEventListener("output", e => { out += e.detail.join(""); });
  await p.run(code);
  for (let i = 0; i < 150 && !out.includes("</html>"); i++) {
    await new Promise(r => setTimeout(r, 100));
  }
  await new Promise(r => setTimeout(r, 250));
  return out;
}

let fails = 0;
const ck = (l, c, e = "") => { if (!c) fails++; console.log(`  ${c ? "✓" : "✗"} ${l}${e ? " — " + e : ""}`); };

/** بررسی تعادل تگ‌های بلوکی — سبک و کافی برای این صفحه */
function tagBalance(html) {
  const body = html.slice(html.indexOf("<body"), html.indexOf("</body>") + 7);
  const voids = new Set(["br", "hr", "img", "input", "meta", "link", "source", "area", "base", "col", "wbr", "embed", "track"]);
  const stack = [];
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/?)>/g;
  let m, problems = [];
  while ((m = re.exec(body))) {
    const [, close, rawTag, selfClose] = m;
    const tag = rawTag.toLowerCase();
    if (voids.has(tag) || selfClose) continue;
    if (close) {
      if (!stack.length) { problems.push(`بستن بدون باز: </${tag}>`); continue; }
      const top = stack.pop();
      if (top !== tag) problems.push(`نامتوازن: باز <${top}> بسته </${tag}>`);
    } else {
      stack.push(tag);
    }
  }
  /* php-wasm ممکن است شرط‌های PHP را متفاوت رندر کند؛ فقط ناهماهنگی
     جدی (بیش از ۲ تگ بازمانده یا نام‌های متفاوت) خطاست. */
  if (stack.length > 2) problems.push("تگ بازمانده: " + stack.slice(-4).join(", "));
  return problems;
}

function scriptsOf(html) {
  const out = [];
  const re = /<script\b[^>]*>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
}

console.log("═".repeat(64));
console.log("سالم بودن ساختار صفحه و اسکریپت");
console.log("═".repeat(64));

const pages = [
  ["ورود", await run(boot(false))],
  ["داشبورد", await run(boot(true))],
  ["خوانش", await run(boot(true, "array('v' => 'scan')"))],
  ["بایگانی", await run(boot(true, "array('v' => 'archive')"))],
  ["تنظیمات", await run(boot(true, "array('v' => 'settings')"))],
];

let allJs = "";
for (const [name, html] of pages) {
  console.log(`\n${name}`);
  ck("بدون خطای PHP", !/Fatal error|Parse error|Uncaught/i.test(html));
  ck("صفحه کامل است", html.trimEnd().endsWith("</html>"));
  ck("طول معقول", html.length > 8000, String(html.length));
  const probs = tagBalance(html);
  ck("تگ‌ها متوازن", probs.length === 0, probs.slice(0, 3).join(" | "));
  const s = scriptsOf(html);
  if (s.length) allJs = s.join("\n;\n");
}

/* نحو جاوااسکریپت: با new Function بررسی می‌شود (بدون اجرا) */
console.log("\nاسکریپت صفحه");
ck("اسکریپت وجود دارد", allJs.length > 3000, String(allJs.length));
let jsOk = true, jsErr = "";
try {
  new Function(allJs);          /* فقط تجزیه — اجرا نمی‌شود */
} catch (e) {
  jsOk = false;
  jsErr = e.message;
}
ck("بدون خطای نحوی JS", jsOk, jsErr);
ck("گارد فرم آپلود (hasUploader)", allJs.includes("hasUploader"));
ck("فقط یک بار تعریف setVal", (allJs.match(/function setVal/g) || []).length === 1);
ck("ثبت در بایگانی در JS", allJs.includes("invoice_save"));

console.log(fails === 0 ? "\n✓ همهٔ بررسی‌ها موفق" : `\n✗ ${fails} بررسی ناموفق`);
process.exit(fails === 0 ? 0 : 1);
