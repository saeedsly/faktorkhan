/**
 * پیش‌نمایش زندهٔ نسخهٔ PHP — فقط برای توسعه
 * =========================================
 * روی ویندوز PHP دارید و همین پوشه را با `php -S` اجرا می‌کنید. ولی
 * روی ماشینی که PHP نصب نیست (مثل محیط توسعهٔ ما) نمی‌شود صفحه را دید.
 * این فایل همان `index.php` واقعی را با php-wasm اجرا می‌کند و خروجی
 * HTML/JSON را روی HTTP می‌دهد؛ چیزی که در مرورگر می‌بینید همان چیزی
 * است که Apache کاربر تولید می‌کند.
 *
 * اجرا:
 *     node tools/dev/php-preview.mjs 8075
 *
 * چرا برای هر درخواست یک نمونهٔ تازه؟ چون index.php در سطح فایل تابع
 * تعریف می‌کند و در یک نمونهٔ پایدار، include دوباره خطای
 * «Cannot redeclare» می‌دهد. نمونهٔ تازه هم رفتار Apache را دقیق‌تر
 * شبیه‌سازی می‌کند (هر درخواست = یک اجرای مستقل).
 *
 * وضعیت (نشست، کارها، بایگانی) بین درخواست‌ها با خواندن/نوشتن پوشهٔ
 * داده رد و بدل می‌شود — همان کاری که دیسک واقعی می‌کند.
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

const patch = s => s
  .replace("declare(strict_types=1);", "")
  .replace(/\bexit;/g, "throw new FkExit();");

const src = {
  "lib.php": patch(fs.readFileSync(`${SRC}/lib.php`, "utf8")),
  "engine.php": patch(fs.readFileSync(`${SRC}/engine.php`, "utf8")),
  "library.php": patch(fs.readFileSync(`${SRC}/library.php`, "utf8")),
  "index.php": patch(fs.readFileSync(`${SRC}/index.php`, "utf8")),
};

/* پیش‌فرض نصب: گذرواژه تعیین نشده. با ?reset=1 می‌توان پاک کرد. */
const DEFAULT_STATE = {};

let state = { ...DEFAULT_STATE };

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

async function handle({ method, get, post, cookie, files }) {
  const php = new PhpNode();
  await new Promise(r => php.addEventListener("ready", r));
  let out = "";
  php.addEventListener("output", e => { out += e.detail.join(""); });

  const seed = Object.entries(state).map(([p, c]) =>
    `@mkdir('/tmp/fkpv/' . dirname(${JSON.stringify(p)}), 0777, true);` +
    ` file_put_contents('/tmp/fkpv/' . ${JSON.stringify(p)}, base64_decode('${B(c)}'));`
  ).join("\n");

  const getSeed = Object.entries(get || {}).map(([k, v]) =>
    `$_GET[${JSON.stringify(k)}] = ${JSON.stringify(String(v))};`).join("\n");
  const postSeed = Object.entries(post || {}).map(([k, v]) =>
    `$_POST[${JSON.stringify(k)}] = ${JSON.stringify(String(v))};`).join("\n");

  const code = `<?php
ini_set('display_errors','1'); error_reporting(E_ALL & ~E_DEPRECATED & ~E_WARNING & ~E_NOTICE);
@mkdir('/tmp/fkpv/fk-sessions',0777,true);@mkdir('/tmp/fkpv/fk-jobs',0777,true);
@mkdir('/tmp/fkpv/fk-uploads',0777,true);@mkdir('/tmp/fkpv/fk-invoices',0777,true);
${Object.entries(src).map(([n, c]) =>
  `file_put_contents('/tmp/fkpv/${n}', base64_decode('${B(c)}'));`).join("\n")}
file_put_contents('/tmp/fkpv/stubs.php', base64_decode('${B(STUBS)}'));
${seed}
if (!is_file('/tmp/fkpv/fk-config.json')) { file_put_contents('/tmp/fkpv/fk-config.json', '{}'); }
$_COOKIE = ${cookie ? `array('fksid' => ${JSON.stringify(cookie)})` : "array()"};
$_SERVER['REQUEST_METHOD'] = ${JSON.stringify(method)};
$_SERVER['REQUEST_URI'] = ${JSON.stringify("/index.php" + (get && Object.keys(get).length
  ? "?" + new URLSearchParams(get).toString() : ""))};
$_GET = array(); ${getSeed}
$_POST = array(); ${postSeed}
require_once '/tmp/fkpv/stubs.php';
ob_start();
$__savedPrev = session_id();
if ($__savedPrev === '' || $__savedPrev === false) {
    /* نشست را با همان شناسهٔ کوکی ادامه بده */
    if (!empty($_COOKIE['fksid'])) { @session_id($_COOKIE['fksid']); }
}
try { include '/tmp/fkpv/index.php'; }
catch (FkExit $e) {}
catch (Throwable $e) { echo "\\n[[PHP-ERR:" . $e->getMessage() . "@" . $e->getLine() . "]]"; }
echo ob_get_clean();
/* نشست را همین‌جا بنویس تا فایل روی دیسک قطعی باشد */
if (session_status() === PHP_SESSION_ACTIVE) { @session_write_close(); }
$__sid = $__savedPrev ?: (session_id() ?: ($_COOKIE['fksid'] ?? ''));
echo "\\n@@SID:" . $__sid . ":@@";
clearstatcache(true);
/* وضعیت را بعد از بستن نشست جمع کن تا فایل تازهٔ نشست هم در آن باشد */
$__dump = array();
foreach (array('/tmp/fkpv/fk-sessions','/tmp/fkpv/fk-jobs','/tmp/fkpv/fk-uploads','/tmp/fkpv/fk-invoices') as $__d) {
  foreach (glob($__d . '/*') ?: array() as $__f) {
    if (is_file($__f)) { $__dump[substr($__f, 10)] = base64_encode((string) file_get_contents($__f)); }
  }
}
foreach (array('/tmp/fkpv/fk-config.json','/tmp/fkpv/fk-owner') as $__f) {
  if (is_file($__f)) { $__dump[substr($__f, 10)] = base64_encode((string) file_get_contents($__f)); }
}
echo "\\n@@STATE:" . base64_encode(json_encode($__dump)) . ":@@";
`;

  await php.run(code);
  const started = Date.now();
  while (Date.now() - started < 30000 && !out.includes(":@@")) {
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
  const body = out.replace(/\n@@STATE:[\s\S]*$/, "")
    .replace(/@@STATE:[\s\S]*?:@@/, "")
    .replace(/\n@@SID:[^:]*:@@/, "");
  return { body, cookie: sid || pickCookie(state) };
}

function pickCookie(st) {
  const keys = Object.keys(st).filter(k => k.startsWith("fk-sessions/sess_"));
  if (!keys.length) return "";
  return keys[0].replace("fk-sessions/sess_", "");
}

function parseCookies(header) {
  return Object.fromEntries((header || "").split(/;\s*/).filter(Boolean)
    .map(c => c.split("=").map(x => x.trim())).filter(p => p.length === 2));
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const get = {};
  for (const [k, v] of u.searchParams) get[k] = v;

  if (get.reset === "1") {
    state = { ...DEFAULT_STATE };
    res.writeHead(302, { Location: "/", "Cache-Control": "no-store" });
    res.end();
    return;
  }

  const chunks = [];
  req.on("data", c => chunks.push(c));
  req.on("end", async () => {
    const raw = Buffer.concat(chunks).toString("utf8");
    const post = {};
    if ((req.method || "GET").toUpperCase() === "POST") {
      for (const [k, v] of new URLSearchParams(raw)) post[k] = v;
    }
    const cookie = parseCookies(req.headers.cookie).fksid || "";

    let result;
    try {
      result = await handle({ method: (req.method || "GET").toUpperCase(), get, post, cookie });
      /* برنامه بعد از POST با ۳۰۳ به همان صفحه برمی‌گردد (الگوی
         POST/Redirect/GET). مرورگر این را خودکار دنبال می‌کند؛ این‌جا
         هم همان کار را می‌کنیم تا رفتار دیده‌شده مثل Apache باشد. */
      if ((req.method || "GET").toUpperCase() === "POST" && !result.body.trim()) {
        result = await handle({ method: "GET", get, post: {}, cookie: result.cookie || cookie });
      }
    } catch (e) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("خطای پیش‌نمایش: " + e.message);
      return;
    }

    const body = result.body;
    const isJson = body.trimStart().startsWith("{");
    const headers = {
      "Content-Type": isJson ? "application/json; charset=utf-8" : "text/html; charset=utf-8",
      "Cache-Control": "no-store",
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
