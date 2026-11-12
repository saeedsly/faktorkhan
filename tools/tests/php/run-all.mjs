#!/usr/bin/env node
/*
 * اجرای همهٔ تست‌های PHP
 * =======================
 * این تست‌ها با php-wasm اجرا می‌شوند — یک PHP کامپایل‌شده به WebAssembly
 * که بدون نصب PHP روی هر سیستمی کار می‌کند. دلیلش:
 *
 *   • روی ماشین توسعه‌دهنده PHP نصب نیست
 *   • Apache/XAMPP رفتار واقعی دارد ولی نصبش روی CI سنگین است
 *   • php-wasm همهٔ توابع و ساختار PHP ۸ را دارد
 *
 * محدودیت مهم (که یک بار ما را گول زد):
 *   php-wasm هنگام `exit` تابع register_shutdown_function را اجرا نمی‌کند.
 *   بنابراین هر تستی که وضعیت را «بعد از پاسخ» می‌خواند باید dump را
 *   صریح انجام دهد — tools/tests/php/harness.mjs این کار را می‌کند.
 *
 * نصب پیش‌نیاز:
 *     npm install php-wasm
 *
 * اجرا:
 *     node tools/tests/php/run-all.mjs
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

const ORDER = [
  ["lint.mjs",      "نحو همهٔ فایل‌های PHP"],
  ["panel.mjs",     "پنل کامل: کاربران، اشتراک، پنل مدیریت"],
  ["shell.mjs",     "پوستهٔ SPA و دارایی‌های رابط"],
  ["reap.mjs",      "بستن کارهای نیمه‌کاره"],
  ["loginlim.mjs",  "محدودیت تلاش ورود"],
  ["isolation.mjs", "جداسازی کاربران (امنیت)"],
  ["hist5.mjs",     "تاریخچه، آمار، جستجو، CSV"],
  ["pro.mjs",       "پنل حرفه‌ای: ورود، داشبورد، بایگانی، تشخیص نوع"],
  ["render.mjs",    "سالم بودن ساختار صفحه و اسکریپت"],
  ["checkinv.mjs",  "checkconvert روی تصویر صدا زده نمی‌شود"],
  ["invtest.mjs",   "نجات InvalidParams"],
  ["e2e2.mjs",      "چرخهٔ کامل کار"],
  ["e2e3.mjs",      "پایداری در خطا"],
  ["e2e5.mjs",      "خروجی خالی و پاک‌سازی"],
  ["facols.mjs",    "فاکتور فارسی — جداکننده و واحد"],
];

// آزمون‌های موتور (فایل‌های engtest*)
for (const f of readdirSync(HERE)) {
  if (/^engtest\d*\.mjs$/.test(f)) {
    ORDER.push([f, "موتور پردازش متن"]);
  }
}

let pass = 0;
let fail = 0;
const broken = [];

console.log("═".repeat(66));
console.log("تست‌های PHP (php-wasm)");
console.log("═".repeat(66));

for (const [file, label] of ORDER) {
  const res = spawnSync(process.execPath, [join(HERE, file)], {
    encoding: "utf8",
    timeout: 300_000,
  });
  const out = (res.stdout || "") + (res.stderr || "");
  const ok = res.status === 0;
  const ticks = (out.match(/✓/g) || []).length;

  if (ok) {
    pass++;
    console.log(`  ✓ ${label.padEnd(44)} ${String(ticks).padStart(3)} بررسی`);
  } else {
    fail++;
    broken.push(file);
    const err = out.split("\n").filter((l) => l.includes("✗") || /Error/.test(l))[0] || "";
    console.log(`  ✗ ${label.padEnd(44)} ${err.slice(0, 60)}`);
  }
}

console.log("═".repeat(66));
console.log(`نتیجه: ${pass} از ${pass + fail} فایل تست موفق`);
if (broken.length) {
  console.log("فایل‌های ناموفق: " + broken.join(", "));
}
console.log("═".repeat(66));
process.exit(fail === 0 ? 0 : 1);
