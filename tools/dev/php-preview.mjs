/**
 * پیش‌نمایش زندهٔ نسخهٔ PHP — فقط برای توسعه
 * =========================================
 * روی ویندوز PHP دارید و همین پوشه را با `php -S` اجرا می‌کنید. ولی
 * روی ماشینی که PHP نصب نیست (مثل محیط توسعهٔ ما) نمی‌شود صفحه را دید.
 * این فایل همان `index.php` و `api.php` واقعی را با php-wasm اجرا می‌کند
 * و خروجی را روی HTTP می‌دهد؛ چیزی که در مرورگر می‌بینید همان چیزی
 * است که Apache کاربر تولید می‌کند.
 *
 * اجرا:
 *     node tools/dev/php-preview.mjs 8075
 *
 * چرا برای هر درخواست یک نمونهٔ تازه؟ چون فایل‌های PHP در سطح فایل تابع
 * تعریف می‌کنند و در یک نمونهٔ پایدار، include دوباره خطای
 * «Cannot redeclare» می‌دهد. نمونهٔ تازه هم رفتار Apache را دقیق‌تر
 * شبیه‌سازی می‌کند (هر درخواست = یک اجرای مستقل).
 *
 * وضعیت (نشست، کاربران، فاکتورها، کارها) بین درخواست‌ها با
 * خواندن/نوشتن پوشهٔ داده رد و بدل می‌شود — همان کاری که دیسک واقعی
 * می‌کند.
 *
 * مسیرها:
 *     /                 → index.php (پوستهٔ SPA)
 *     /web/app.js|css   → مستقیم از دیسک
 *     /api.php?action=… → api.php (JSON)
 *     /legacy.php       → رابط قدیمی تک‌صفحه‌ای
 *
 * این فایل هرگز داخل بستهٔ htdocs نمی‌رود.
 */

import { PhpNode } from "php-wasm/PhpNode.mjs";
import fs from "fs";
import http from "http";
import path from "path";

const SRC = new URL("../../deploy/php", import.meta.url).pathname;
const PORT = Number(process.argv[2] || 8075);
const B = s => Buffer.from(s, "utf8").toString("base64");
const UB = s => Buffer.from(s, "base64").toString("utf8");
const ROOT = "/tmp/fkpv";

const patch = s => s
  .replace("declare(strict_types=1);", "")
  .replace(/\bexit;/g, "throw new FkExit();");

/** فایل‌های PHP که هر درخواست به داخل ماشین کپی می‌شوند */
const PHP_FILES = [
  "lib.php", "engine.php", "library.php", "store.php", "data.php",
  "api_helpers.php", "api.php", "index.php", "legacy.php",
];

/**
 * فایل‌های PHP را در هر درخواست از دیسک می‌خوانیم، نه یک بار در
 * شروع. دلیلش تجربهٔ همین امروز است: بعد از اصلاح api.php، پیش‌نمایش
 * هنوز رفتار قدیمی داشت (دکمهٔ ثبت فاکتور فهرست برمی‌گرداند) و
 * به‌نظر می‌رسید کد درست نیست. کش‌کردن منبع در حافظه فقط وقت توسعه
 * را تلف می‌کند؛ خواندن ۹ فایل کوچک هزینه‌ای ندارد.
 */
function loadSources() {
  const out = {};
  for (const n of PHP_FILES) {
    out[n] = patch(fs.readFileSync(`${SRC}/${n}`, "utf8"));
  }
  /* php-wasm بدنهٔ درخواست را در php://input نمی‌گذارد */
  out["api.php"] = out["api.php"].replace(
    /@file_get_contents\('php:\/\/input'\)/g,
    "@file_get_contents('/tmp/fkpv/body.json')"
  );
  return out;
}

let state = {};

/**
 * فایل‌های پوشهٔ web/ که باید داخل ماشین php-wasm هم موجود باشند.
 * index.php وجود web/index.html را بررسی می‌کند و اگر نبود به
 * legacy.php می‌افتد؛ بدون این کار پیش‌نمایش رابط قدیمی را نشان
 * می‌داد در حالی که روی هاست واقعی رابط تازه سرو می‌شود.
 */
const webDir = path.join(SRC, "web");
function loadWebIndex() {
  const out = {};
  if (!fs.existsSync(webDir)) return out;
  /* فقط index.html داخل ماشین لازم است (index.php وجودش را بررسی
     می‌کند). JS/CSS/فونت از دیسک و از طریق serveStatic سرو می‌شوند؛
     کپی کردن ۵۴۰ کیلوبایت باینری در هر درخواست، هم کند است و هم
     فونت را خراب می‌کند. */
  const idx = path.join(webDir, "index.html");
  if (fs.existsSync(idx)) out["web/index.html"] = fs.readFileSync(idx, "utf8");
  return out;
}

const STUBS = `<?php
if (!class_exists('FkExit')) { class FkExit extends Exception {} }
foreach (array('URL'=>1,'POST'=>2,'POSTFIELDS'=>3,'RETURNTRANSFER'=>4,'TIMEOUT'=>5,
  'CONNECTTIMEOUT'=>6,'SSL_VERIFYPEER'=>7,'SSL_VERIFYHOST'=>8,'FOLLOWLOCATION'=>9,
  'USERAGENT'=>10,'MAXREDIRS'=>11,'HTTPHEADER'=>12,'FRESH_CONNECT'=>13) as $k=>$v) {
  if (!defined('CURLOPT_'.$k)) define('CURLOPT_'.$k, $v);
}
if (!defined('CURLINFO_HTTP_CODE')) define('CURLINFO_HTTP_CODE', 99);
if (!class_exists('CURLFile')) { class CURLFile { public $path,$mime,$name;
  function __construct($p,$m='',$n=''){$this->path=$p;$this->mime=$m;$this->name=$n;} } }
function curl_init($u=null){ return 'H'; }
function curl_setopt_array($h,$o){ return true; }
function curl_setopt($h,$k,$v){ return true; }
function curl_exec($h){ return json_encode(array('Status'=>'Done')); }
function curl_error($h){ return ''; }
function curl_errno($h){ return 0; }
function curl_getinfo($h,$k=null){ return 200; }
function curl_close($h){}
$_SERVER['REMOTE_ADDR'] = '127.0.0.1';
$_SERVER['HTTPS'] = 'off';
`;

/** آدرس‌هایی که سرو می‌شوند؛ بقیه ۴۰۴ */
const STATIC_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

async function runPhp({ entry, method, get, post, body, cookie, files = null }) {
  const src = loadSources();
  const php = new PhpNode();
  await new Promise(r => php.addEventListener("ready", r));
  let out = "";
  php.addEventListener("output", e => { out += e.detail.join(""); });

  const seed = Object.entries(state).map(([p, c]) =>
    `@mkdir('${ROOT}/' . dirname(${JSON.stringify(p)}), 0777, true);` +
    ` @file_put_contents('${ROOT}/' . ${JSON.stringify(p)}, base64_decode('${B(c)}'));`
  ).join("\n");

  const getSeed = Object.entries(get || {}).map(([k, v]) =>
    `$_GET[${JSON.stringify(k)}] = ${JSON.stringify(String(v))};`).join("\n");
  const postSeed = Object.entries(post || {}).map(([k, v]) =>
    `$_POST[${JSON.stringify(k)}] = ${JSON.stringify(String(v))};`).join("\n");

  const code = `<?php
ini_set('display_errors','1'); error_reporting(E_ALL & ~E_DEPRECATED & ~E_WARNING & ~E_NOTICE);
@mkdir('${ROOT}/fk-sessions',0777,true);@mkdir('${ROOT}/fk-jobs',0777,true);
@mkdir('${ROOT}/fk-uploads',0777,true);@mkdir('${ROOT}/fk-invoices',0777,true);
@mkdir('${ROOT}/fk-data',0777,true);
${Object.entries(src).map(([n, c]) =>
  `@file_put_contents('${ROOT}/${n}', base64_decode('${B(c)}'));`).join("\n")}
@file_put_contents('${ROOT}/stubs.php', base64_decode('${B(STUBS)}'));
${Object.entries(loadWebIndex()).map(([n, c]) =>
  `@mkdir('${ROOT}/' . dirname(${JSON.stringify(n)}), 0777, true); @file_put_contents('${ROOT}/${n}', base64_decode('${B(c)}'));`).join("\n")}
${seed}
@file_put_contents('${ROOT}/body.json', base64_decode('${B(body || "")}'));
if (!is_file('${ROOT}/fk-config.json')) { @file_put_contents('${ROOT}/fk-config.json', '{}'); }
$_COOKIE = ${cookie ? `array('fksid' => ${JSON.stringify(cookie)})` : "array()"};
$_SERVER['REQUEST_METHOD'] = ${JSON.stringify(method)};
$_SERVER['REQUEST_URI'] = ${JSON.stringify("/" + entry + (get && Object.keys(get).length
  ? "?" + new URLSearchParams(get).toString() : ""))};
$_GET = array(); ${getSeed}
$_POST = array(); ${postSeed}
require_once '${ROOT}/stubs.php';
try { include '${ROOT}/${entry}'; }
catch (FkExit $e) {}
catch (Throwable $e) { echo "\\n[[PHP-ERR:" . $e->getMessage() . "@" . $e->getLine() . "]]"; }
/* نشست را همین‌جا بنویس تا فایل روی دیسک قطعی باشد */
if (session_status() === PHP_SESSION_ACTIVE) { @session_write_close(); }
$__sid = session_id() ?: ($_COOKIE['fksid'] ?? '');
echo "\\n@@SID:" . $__sid . ":@@";
clearstatcache(true);
/* وضعیت را بعد از بستن نشست جمع کن تا فایل تازهٔ نشست هم در آن باشد */
$__dump = array();
foreach (array('fk-sessions','fk-jobs','fk-uploads','fk-invoices','fk-data') as $__d) {
  foreach (glob('${ROOT}/' . $__d . '/*') ?: array() as $__f) {
    if (is_file($__f)) { $__dump[substr($__f, strlen('${ROOT}/'))] = base64_encode((string) file_get_contents($__f)); }
  }
}
foreach (array('fk-config.json','fk-owner') as $__f) {
  if (is_file('${ROOT}/' . $__f)) { $__dump[$__f] = base64_encode((string) file_get_contents('${ROOT}/' . $__f)); }
}
echo "\\n@@STATE:" . base64_encode(json_encode($__dump)) . ":@@";
`;

  await php.run(code);
  const started = Date.now();
  while (Date.now() - started < 60000 && !out.includes(":@@")) {
    await new Promise(r => setTimeout(r, 50));
  }
  await new Promise(r => setTimeout(r, 150));

  const sidM = out.match(/@@SID:([^:]*):@@/);
  const sid = sidM ? sidM[1] : "";
  const m = out.match(/@@STATE:([A-Za-z0-9+/=]+):@@/);
  if (m) {
    const dump = JSON.parse(UB(m[1]));
    const next = {};
    for (const [k, v] of Object.entries(dump)) next[k] = UB(v);
    state = next;
  }
  const text = out.replace(/@@STATE:[\s\S]*$/, "").replace(/\n@@SID:[^:]*:@@/, "");
  return { body: text, cookie: sid };
}

function parseCookies(header) {
  return Object.fromEntries((header || "").split(/;\s*/).filter(Boolean)
    .map(c => c.split("=").map(x => x.trim())).filter(p => p.length === 2));
}

/** فایل ایستای داخل web/ را از دیسک بخوان */
function serveStatic(uri, res) {
  const rel = uri.replace(/^\/+/, "");
  if (!rel.startsWith("web/") && rel !== "web") return false;
  const full = path.join(SRC, rel);
  if (!full.startsWith(path.join(SRC, "web"))) return false;
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return false;
  const ext = path.extname(full).toLowerCase();
  const type = STATIC_TYPES[ext];
  if (!type) return false;
  res.writeHead(200, {
    "Content-Type": type,
    "Cache-Control": ext === ".html" ? "no-store" : "public, max-age=3600",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
  });
  res.end(fs.readFileSync(full));
  return true;
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const uri = u.pathname;
  const get = {};
  for (const [k, v] of u.searchParams) get[k] = v;

  if (get.reset === "1") {
    state = {};
    res.writeHead(302, { Location: "/", "Cache-Control": "no-store" });
    res.end();
    return;
  }

  /* فایل‌های ایستای رابط */
  if (req.method === "GET" && serveStatic(uri, res)) return;

  const chunks = [];
  req.on("data", c => chunks.push(c));
  req.on("end", async () => {
    const raw = Buffer.concat(chunks).toString("utf8");
    const post = {};
    if ((req.method || "GET").toUpperCase() === "POST") {
      for (const [k, v] of new URLSearchParams(raw)) post[k] = v;
    }
    const cookie = parseCookies(req.headers.cookie).fksid || "";

    /* انتخاب نقطهٔ ورود: api.php، legacy.php یا پوستهٔ index.php */
    let entry = "index.php";
    if (uri.endsWith("/api.php")) entry = "api.php";
    else if (uri.endsWith("/legacy.php")) entry = "legacy.php";
    else if (uri !== "/" && uri !== "/index.php") {
      res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
      res.end('<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8">'
        + '<body style="font-family:Tahoma;background:#0b0d12;color:#eee;padding:40px;text-align:center">'
        + '<h2>صفحه پیدا نشد</h2><p><a style="color:#d4af37" href="/">بازگشت به برنامه</a></p></body></html>');
      return;
    }

    let result;
    try {
      result = await runPhp({
        entry, method: (req.method || "GET").toUpperCase(),
        get, post, body: raw, cookie,
      });
    } catch (e) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("خطای پیش‌نمایش: " + e.message);
      return;
    }

    const body = result.body;
    const isJson = entry === "api.php" || body.trimStart().startsWith("{");
    const headers = {
      "Content-Type": isJson ? "application/json; charset=utf-8" : "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Frame-Options": "SAMEORIGIN",
    };
    if (result.cookie) headers["Set-Cookie"] = `fksid=${result.cookie}; Path=/; SameSite=Lax`;
    res.writeHead(200, headers);
    res.end(body);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`پیش‌نمایش PHP روی http://0.0.0.0:${PORT}`);
  console.log(`منبع: ${path.relative(process.cwd(), SRC)}`);
});
