#!/usr/bin/env node
/**
 * آزمون پوستهٔ SPA و دارایی‌های رابط
 * =================================
 * نسخهٔ PHP حالا «یک رابط، دو بک‌اند» است: همان app.js/app.css نسخهٔ
 * پایتون، با PHP در نقش سرور. این آزمون همان چیزی را می‌سنجد که اگر
 * خراب شود کاربر فقط «صفحهٔ سفید» می‌بیند و هیچ سرنخی ندارد:
 *
 *   ۱) index.php واقعاً web/index.html را سرو می‌کند (نه رابط قدیمی)
 *   ۲) دارایی‌های CSS/JS/فونت موجودند و آدرسشان نسبی است
 *   ۳) همهٔ فراخوانی‌های اینترفیس به api.php?action=… اشاره می‌کنند
 *   ۴) هیچ نشانی /api/ باقی نمانده (که روی PHP ۴۰۴ می‌شد)
 *   ۵) تگ‌های meta موتور/نسخه اضافه می‌شوند
 *   ۶) کش‌شکن (?v=) روی CSS و JS هست
 *
 * اجرا:  node tools/tests/php/shell.mjs
 */
import { PhpNode } from "php-wasm/PhpNode.mjs";
import fs from "fs";
import path from "path";

const SRC = new URL("../../../deploy/php", import.meta.url).pathname;
const WEB = path.join(SRC, "web");
const B = (s) => Buffer.from(s, "utf8").toString("base64");

let fails = 0;
let checks = 0;
const ck = (label, good, extra = "") => {
  checks++;
  if (!good) fails++;
  console.log(`  ${good ? "✓" : "✗"} ${label}${extra ? " — " + extra : ""}`);
};

console.log("\n۱) فایل‌های ساخته‌شدهٔ رابط");
const required = ["index.html", "app.js", "app.css"];
for (const n of required) {
  const f = path.join(WEB, n);
  ck(`وجود ${n}`, fs.existsSync(f),
     fs.existsSync(f) ? `${Math.round(fs.statSync(f).size / 1024)} KB` : "نیست");
}
const fontsDir = path.join(WEB, "assets", "fonts");
const fonts = fs.existsSync(fontsDir) ? fs.readdirSync(fontsDir) : [];
ck("فونت‌های وزیرمتن", fonts.length >= 4, `${fonts.length} فایل`);
ck("فاوآیکون", fs.existsSync(path.join(WEB, "assets", "favicon.svg")));
ck("سرویس‌ورکر نساخته شده (باگ کش قدیمی)",
   !fs.existsSync(path.join(WEB, "sw.js")));

console.log("\n۲) قرارداد مسیرها در بستهٔ app.js");
const js = fs.readFileSync(path.join(WEB, "app.js"), "utf8");
const actions = (js.match(/api\.php\?action=/g) || []).length;
ck("فراخوانی‌های api.php", actions >= 50, `${actions} مورد`);
ck("هیچ /api/ باقی نمانده", !/["'`]\/api\//.test(js));
ck("بدون هدر Authorization (نشست کوکی است)", !/Authorization/.test(js));
ck("نشانی کوکی نسبی است", !/["'`]\/api\.php/.test(js));
ck("فونت‌ها از assets محلی", js.includes("./assets") || js.includes("assets/"));

console.log("\n۳) قرارداد CSS");
const css = fs.readFileSync(path.join(WEB, "app.css"), "utf8");
ck("اندازهٔ معقول", css.length > 20000, `${Math.round(css.length / 1024)} KB`);
ck("بدون آدرس ../fonts (که در web/ می‌شکست)", !css.includes("url(../fonts/"));
ck("فونت از assets", css.includes("assets/fonts/"));

console.log("\n۴) پوستهٔ HTML");
const html = fs.readFileSync(path.join(WEB, "index.html"), "utf8");
ck("زبان فارسی و RTL", /<html[^>]*lang="fa"/.test(html) && /dir="rtl"/.test(html));
ck("بدون اسکریپت per-file (همه در app.js)", !/<script src="(?:js|views)\//.test(html));
ck("اسکریپت اصلی", /<script src="\.\/app\.js"/.test(html));
ck("استایل اصلی", /<link[^>]+href="\.\/app\.css"/.test(html));
ck("بدون manifest (در PHP سرویس‌ورکر نداریم)", !html.includes("manifest.webmanifest"));

console.log("\n۵) index.php واقعاً پوسته را سرو می‌کند");
{
  const php = new PhpNode();
  await new Promise((r) => php.addEventListener("ready", r));
  let out = "";
  php.addEventListener("output", (e) => { out += e.detail.join(""); });

  const indexSrc = fs.readFileSync(path.join(SRC, "index.php"), "utf8")
    .replace("declare(strict_types=1);", "");
  const libSrc = "";
  await php.run('<?php @mkdir("/tmp/fkshell/web", 0777, true);'
    + '@mkdir("/tmp/fkshell/fk-sessions", 0777, true);');
  php.writeFile("/tmp/fkshell/web/index.html", html);
  /* lib.php و data.php را هم لازم دارد */
  for (const n of ["lib.php", "engine.php", "data.php"]) {
    const c = fs.readFileSync(path.join(SRC, n), "utf8")
      .replace("declare(strict_types=1);", "");
    php.writeFile("/tmp/fkshell/" + n, c);
  }
  php.writeFile("/tmp/fkshell/index.php", indexSrc.replace(
    /require_once __DIR__ \. '\/(lib|data)\.php';/g,
    "require_once '/tmp/fkshell/$1.php';"
  ));
  php.writeFile("/tmp/fkshell/run.php", `<?php
ob_start();
$_SERVER['REQUEST_METHOD'] = 'GET';
$_SERVER['REQUEST_URI'] = '/';
try { include '/tmp/fkshell/index.php'; } catch (Throwable $e) {
  echo "[[ERR:" . $e->getMessage() . "]]";
}
echo ob_get_clean();
`);
  await php.run('<?php require "/tmp/fkshell/run.php";');
  ck("بدون خطای PHP", !out.includes("[[ERR:"),
     (out.match(/\[\[ERR:[^\]]*\]\]/) || [""])[0].slice(0, 90));
  ck("HTML برگشت (نه رابط قدیمی)", out.includes("<!DOCTYPE html") || out.includes("<!doctype html"));
  ck("بدون <form action=\"?action=login\" (نشانهٔ legacy)", !out.includes('action="?action=login'));
  ck("متای موتور PHP", /<meta name="fk-engine" content="php">/.test(out));
  ck("متای نسخه", /<meta name="fk-version" content="[^"]+">/.test(out));
  ck("کش‌شکن روی app.js", /app\.js\?v=[0-9a-f]+/.test(out));
  ck("کش‌شکن روی app.css", /app\.css\?v=[0-9a-f]+/.test(out));
  ck("متای موتور قبل از </head>",
     out.indexOf('name="fk-engine"') < out.indexOf("</head>"));

  /* ── رگرسیون: هر داراییِ HTML باید واقعاً سرو شود ──
     باگی که کاربر دید: پوسته از / سرو می‌شد ولی به «./app.css» اشاره
     می‌کرد، در حالی که فایل در web/ بود. نتیجه: ۴۰۴، صفحهٔ بی‌استایل،
     و هیچ خطای جاوااسکریپتی. هیچ آزمونی این را نمی‌گرفت چون همه فقط
     وجود فایل را می‌سنجیدند، نه آدرسِ داخل HTML را. */
  const refs = [...out.matchAll(/(?:href|src)="(\.\/[^"?#]+)/g)].map((m) => m[1]);
  const cssJsRefs = refs.filter((r) => /\.(css|js|svg)$/.test(r));
  ck("HTML حداقل یک ارجاع دارایی دارد", cssJsRefs.length >= 2, `${cssJsRefs.length} مورد`);
  ck("ارجاع CSS/JS به web/ اشاره می‌کند",
     cssJsRefs.every((r) => r.startsWith("./web/")),
     cssJsRefs.filter((r) => !r.startsWith("./web/")).join(", ") || "همه درست");

  /* بازسازی مسیر واقعی: /  →  <ref>  →  فایل روی دیسک */
  for (const r of cssJsRefs) {
    const rel = r.replace(/^\.\//, "");
    const onDisk = path.join(SRC, rel);
    ck(`«${r}» به فایل موجود اشاره می‌کند`, fs.existsSync(onDisk),
       fs.existsSync(onDisk) ? `${Math.round(fs.statSync(onDisk).size / 1024)} KB` : "فایل نیست!");
  }

  /* فونت‌ها: نسبت به محل CSS حل می‌شوند، نه نسبت به ریشه */
  const cssRef = cssJsRefs.find((r) => r.endsWith(".css"));
  if (cssRef) {
    const cssDir = path.dirname(path.join(SRC, cssRef.replace(/^\.\//, "")));
    const cssText = fs.readFileSync(path.join(SRC, cssRef.replace(/^\.\//, "")), "utf8");
    const fontUrls = [...cssText.matchAll(/url\((\.[^)]+)\)/g)].map((m) => m[1]);
    const missing = fontUrls.filter((u) => !fs.existsSync(path.join(cssDir, u)));
    ck("همهٔ فونت‌های CSS در کنار CSS پیدا می‌شوند", missing.length === 0,
       missing.length ? missing.join(", ") : `${fontUrls.length} مورد`);
  }
}

console.log("\n۶) مسیر بازگشت به رابط قدیمی");
{
  const php = new PhpNode();
  await new Promise((r) => php.addEventListener("ready", r));
  let out = "";
  php.addEventListener("output", (e) => { out += e.detail.join(""); });
  await php.run('<?php @mkdir("/tmp/fkshell2", 0777, true);');
  for (const n of ["lib.php", "engine.php", "library.php", "data.php", "legacy.php"]) {
    const c = fs.readFileSync(path.join(SRC, n), "utf8")
      .replace("declare(strict_types=1);", "").replace(/\bexit;/g, "throw new FkExit();");
    php.writeFile("/tmp/fkshell2/" + n, c);
  }
  const indexSrc = fs.readFileSync(path.join(SRC, "index.php"), "utf8")
    .replace("declare(strict_types=1);", "");
  php.writeFile("/tmp/fkshell2/index.php", indexSrc.replace(
    /require_once __DIR__ \. '\/(lib|data|legacy)\.php';/g,
    "require_once '/tmp/fkshell2/$1.php';"
  ));
  php.writeFile("/tmp/fkshell2/stubs.php", "<?php class FkExit extends Exception {}");
  php.writeFile("/tmp/fkshell2/run.php", `<?php
ob_start();
require_once '/tmp/fkshell2/stubs.php';
$_SERVER['REQUEST_METHOD'] = 'GET';
$_SERVER['REQUEST_URI'] = '/';
try { include '/tmp/fkshell2/index.php'; } catch (FkExit $e) {} catch (Throwable $e) {
  echo "[[ERR:" . $e->getMessage() . "]]";
}
echo ob_get_clean();
`);
  await php.run('<?php require "/tmp/fkshell2/run.php";');
  ck("بدون web/ → رابط قدیمی می‌آید", out.includes("<!DOCTYPE") || out.includes("<!doctype"),
     `${out.length} بایت`);
  ck("رابط قدیمی هم خطا ندارد", !out.includes("[[ERR:"));
}

console.log("\n" + "═".repeat(64));
console.log(fails === 0 ? `✓ همهٔ ${checks} بررسی موفق` : `✗ ${fails} از ${checks} بررسی ناموفق`);
console.log("═".repeat(64));
process.exit(fails === 0 ? 0 : 1);
