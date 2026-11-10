#!/usr/bin/env node
/*
 * تست ایستای PHP — نظم فایل و قواعدی که php-wasm نمی‌بیند
 * ==========================================================
 * داستان این تست (باگ واقعی روی XAMPP):

     Fatal error: strict_types declaration must be the very first statement
     in the script in C:\xampp\htdocs\faktorkhan\lib.php on line 20

 * علت: در یک کامیت، `require_once` بالای `declare(strict_types=1)` اضافه شد.
 * PHP اجازه می‌دهد فقط کامنت قبل از declare باشد، نه دستور. تمام تست‌های
 * ما فایل‌ها را با php-wasm اجرا می‌کردند و php-wasm این قاعده را اعمال
 * نمی‌کند — پس همه سبز بودند و برنامه روی Apache واقعی می‌مرد.
 *
 * اجرا:
 *     node tools/tests/php-static.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PHP_DIR = path.resolve(__dirname, "../../deploy/php");

let pass = 0, fail = 0;
const ok = (label, good, detail = "") => {
  good ? pass++ : fail++;
  console.log(`  ${good ? "✓" : "✗"} ${label}${detail ? " — " + detail : ""}`);
};

/** حذف کامنت‌ها و تگ بازکننده تا اولین «دستور» واقعی بماند. */
function firstStatement(src) {
  let body = src;
  if (body.charCodeAt(0) === 0xfeff) body = body.slice(1);   // BOM
  body = body.replace(/^<\?php/, "");
  body = body.replace(/^<\?=/, "");
  body = body.replace(/<\?php/g, "");                        // تگ‌های میانی
  body = body.replace(/\/\*[\s\S]*?\*\//g, "");              // /* */
  body = body.replace(/\/\/[^\n]*/g, "");                    // //
  body = body.replace(/#[^\n]*/g, "");                       // #
  body = body.trim();
  if (!body) return "";
  // اولین دستور = تا اولین «;» یا «{»
  const match = body.match(/^[\s\S]*?(?:;|\{)/);
  return (match ? match[0] : body.split("\n")[0]).trim();
}

console.log("═".repeat(58));
console.log("بررسی ایستای فایل‌های PHP");
console.log("═".repeat(58));

const files = fs.readdirSync(PHP_DIR).filter((f) => f.endsWith(".php")).sort();

console.log("\n[۱] declare(strict_types) باید اولین دستور باشد");
for (const file of files) {
  const src = fs.readFileSync(path.join(PHP_DIR, file), "utf8");
  if (!/declare\s*\(\s*strict_types\s*=/.test(src)) {
    ok(`${file} — declare ندارد (اختیاری)`, true);
    continue;
  }
  const stmt = firstStatement(src);
  ok(`${file} — اولین دستور declare است`, /^declare\s*\(\s*strict_types/.test(stmt),
     `اولین دستور: ${stmt.slice(0, 60)}`);
}

console.log("\n[۲] هیچ فایلی قبل از <?php خروجی ندارد (BOM/فاصله/خط خالی)");
for (const file of files) {
  const bytes = fs.readFileSync(path.join(PHP_DIR, file));
  const head = bytes.subarray(0, 5);
  const clean = head[0] === 0x3c && head[1] === 0x3f;   // "<?"
  ok(`${file} — بدون BOM و بدون خروجی قبل از تگ`, clean,
     clean ? "" : "بایت اول: 0x" + head[0].toString(16));
}

console.log("\n[۳] هر فایل با ?> تمام می‌شود یا اصلاً ندارد (خروجی اضافی ندهد)");
for (const file of files) {
  const src = fs.readFileSync(path.join(PHP_DIR, file), "utf8");
  const trimmed = src.replace(/\s+$/, "");
  // ?> در انتها خطای رایج «headers already sent» است
  ok(`${file} — بدون ?> پایانی`, !trimmed.endsWith("?>"),
     trimmed.endsWith("?>") ? "خط خالی بعد از ?> هدرها را می‌شکند" : "");
}

console.log("\n[۴] هر فایل PHP با php-wasm قابل تجزیه است (نحو)");
console.log("  (در تست php-wasm جداگانه بررسی می‌شود)");

console.log("\n" + "═".repeat(58));
console.log(`نتیجه: ${pass} از ${pass + fail} بررسی موفق`);
console.log(fail === 0 ? "همه بررسی‌ها موفق بود ✓" : `${fail} بررسی ناموفق ✗`);
console.log("═".repeat(58));
process.exit(fail === 0 ? 0 : 1);
