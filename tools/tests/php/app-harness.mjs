/**
 * هارنس تست API پنل کامل — نسخهٔ PHP
 * ===================================
 * همان کاری که Apache می‌کند: یک درخواست، یک نمونهٔ تازهٔ PHP، وضعیت روی
 * دیسک. چرا نمونهٔ تازه برای هر درخواست؟ چون هر فایل در سطح خودش تابع
 * تعریف می‌کند و include دوباره در یک نمونهٔ پایدار خطای
 * «Cannot redeclare function» می‌دهد — دقیقاً مثل Apache.
 *
 * قالب پاسخ:
 *   { body, status, state, cookies }
 * `state` همهٔ فایل‌های پوشهٔ داده و نشست است تا بشود درخواست بعدی
 * همان دنیا را دید.
 */
import { PhpNode } from "php-wasm/PhpNode.mjs";
import fs from "fs";

export const SRC = new URL("../../../deploy/php", import.meta.url).pathname;
const B = (s) => Buffer.from(s, "utf8").toString("base64");
const UB = (s) => Buffer.from(s, "base64").toString("utf8");

/** فایل‌های PHP که در هر درخواست باید موجود باشند */
const NEEDED = ["lib.php", "engine.php", "library.php", "store.php", "data.php",
                "api_helpers.php", "api.php", "index.php", "legacy.php"];

/**
 * php-wasm بعد از `exit` کد بعد از آن را اجرا نمی‌کند و ترِیلر وضعیت را
 * از دست می‌دهیم. در هارنس، `exit;` را به پرتاب یک استثنا تبدیل می‌کنیم و
 * بعد از include می‌گیریمش — همان ترفندی که tools/dev/php-preview.mjs
 * استفاده می‌کند.
 */
const patchExit = (src) => src.replace(/\bexit;/g, "throw new FkExit();");

const SOURCES = {};
for (const name of NEEDED) {
  const path = `${SRC}/${name}`;
  SOURCES[name] = fs.existsSync(path)
    ? patchExit(fs.readFileSync(path, "utf8").replace(/declare\s*\(\s*strict_types\s*=\s*1\s*\)\s*;/, ""))
    : "";
}

/** همان قالب/شکل داده‌ای که tests/php/harness.mjs استفاده می‌کند */
const STUBS = `<?php
if (!class_exists('FkExit')) { class FkExit extends Exception {} }
foreach (array('CURLOPT_URL'=>1,'CURLOPT_POST'=>2,'CURLOPT_POSTFIELDS'=>3,'CURLOPT_RETURNTRANSFER'=>4,'CURLOPT_TIMEOUT'=>5,
 'CURLOPT_CONNECTTIMEOUT'=>6,'CURLOPT_SSL_VERIFYPEER'=>7,'CURLOPT_SSL_VERIFYHOST'=>8,'CURLOPT_FOLLOWLOCATION'=>9,
 'CURLOPT_USERAGENT'=>10,'CURLINFO_HTTP_CODE'=>11,'CURLOPT_MAXREDIRS'=>12) as $k=>$v) if(!defined($k)) define($k,$v);
if (!class_exists('CURLFile')) { class CURLFile { public $path,$mime,$name; function __construct($p,$m='',$n=''){$this->path=$p;$this->mime=$m;$this->name=$n;} } }
if (!function_exists('curl_init')) {
  function curl_init($u=null){return 'H';}
  function curl_setopt_array($h,$o){
    $GLOBALS['__req'] = $o;
    return true;
  }
  function curl_setopt($h,$k,$v){return true;}
  function curl_exec($h){
    $q = is_file('/tmp/fka/q.json') ? json_decode(file_get_contents('/tmp/fka/q.json'), true) : array();
    if (!$q) { return json_encode(array('Status'=>'Done','OCRCredit'=>100,'AudioTranscribeCredit'=>50)); }
    $it = array_shift($q); file_put_contents('/tmp/fka/q.json', json_encode($q));
    if (!empty($it['err'])) { $GLOBALS['__errno'] = 28; return false; }
    if (isset($it['dl'])) { return $it['dl']; }
    return $it['body'];
  }
  function curl_error($h){return 'Operation timed out';}
  function curl_errno($h){return $GLOBALS['__errno'] ?? 0;}
  function curl_getinfo($h,$k=null){ $v = $GLOBALS['__info'] ?? 200; $GLOBALS['__info']=200; return $v; }
  function curl_close($h){}
}
$_SERVER['REMOTE_ADDR'] = getenv('FK_IP') ?: '127.0.0.1';
$_SERVER['HTTPS'] = 'off';
$_SERVER['HTTP_USER_AGENT'] = 'FK test';
`;

/**
 * یک درخواست.
 * @param {object} opts
 *   method   - GET|POST|PUT|DELETE
 *   action   - مقدار `action` در api.php
 *   query    - پارامترهای اضافهٔ URL
 *   json     - بدنهٔ JSON (برای POST/PUT)
 *   post     - بدنهٔ فرم
 *   files    - { file: { name, content } } برای آپلود
 *   cookie   - شناسهٔ نشست از پاسخ قبلی
 *   state    - { path: content } که باید روی دیسک باشد
 */
export async function request(opts = {}) {
  const {
    method = "GET", action = "", query = {}, json = null, post = null,
    files = null, cookie = "", state = {}, config = null, queue = [],
  } = opts;

  const php = new PhpNode();
  await new Promise((r) => php.addEventListener("ready", r));
  let out = "";
  php.addEventListener("output", (e) => { out += e.detail.join(""); });

  const seed = Object.entries(state)
    .map(([p, c]) => `@mkdir(dirname('/tmp/fka/${p}'), 0777, true); file_put_contents('/tmp/fka/${p}', base64_decode('${B(c)}'));`)
    .join("\n");

  const get = { ...query };
  if (action) get.action = action;
  const getSeeds = Object.entries(get)
    .map(([k, v]) => `$_GET[${JSON.stringify(k)}] = ${JSON.stringify(String(v))};`).join("\n");
  const postSeeds = Object.entries(post || {})
    .map(([k, v]) => `$_POST[${JSON.stringify(k)}] = ${JSON.stringify(String(v))};`).join("\n");

  const fileSetup = files
    ? Object.entries(files).map(([field, f]) => `
      @mkdir('/tmp/fka/tmp', 0777, true);
      file_put_contents('/tmp/fka/tmp/${field}', base64_decode('${B(f.content ?? "fake-bytes")}'));
      $_FILES[${JSON.stringify(field)}] = array(
        'name' => ${JSON.stringify(f.name)},
        'type' => 'application/octet-stream',
        'tmp_name' => '/tmp/fka/tmp/${field}',
        'error' => 0,
        'size' => ${Buffer.byteLength(f.content ?? "fake-bytes")},
      );`).join("\n")
    : "";

  const body = json ? `file_put_contents('/tmp/fka/body.json', base64_decode('${B(JSON.stringify(json))}'));` : "";

  const cfg = config !== null ? `file_put_contents('/tmp/fka/fk-config.json', base64_decode('${B(config)}'));` : "";

  const code = `<?php
/* در php-wasm، هر خروجیِ قبلی «هدرها ارسال شده» می‌سازد و
   session_name()/session_start() را رد می‌کند. با بافر خروجی، این
   مشکل حل می‌شود — و Apache واقعی هم همین کار را با ob_start می‌کند. */
ob_start();
ini_set('display_errors','1');
error_reporting(E_ALL & ~E_DEPRECATED & ~E_WARNING & ~E_NOTICE);
@mkdir('/tmp/fka/fk-sessions', 0777, true);
@mkdir('/tmp/fka/fk-jobs', 0777, true);
@mkdir('/tmp/fka/fk-uploads', 0777, true);
@mkdir('/tmp/fka/fk-invoices', 0777, true);
@mkdir('/tmp/fka/fk-data', 0777, true);
${Object.entries(SOURCES).map(([n, c]) => `file_put_contents('/tmp/fka/${n}', base64_decode('${B(
    n === "api.php"
      /* php-wasm بدنهٔ درخواست را در php://input نمی‌گذارد؛ در هارنس
         همان بدنه را از فایل می‌خوانیم تا رفتار Apache شبیه شود. */
      ? c.replace(/@file_get_contents\('php:\/\/input'\)/g, "@file_get_contents('/tmp/fka/body.json')")
      : c
  )}'));`).join("\n")}
file_put_contents('/tmp/fka/stubs.php', base64_decode('${B(STUBS)}'));
${seed}
${cfg}
${fileSetup}
file_put_contents('/tmp/fka/q.json', base64_decode('${B(JSON.stringify(queue || []))}'));
${body}
$_COOKIE = ${cookie ? `array('fksid' => ${JSON.stringify(cookie)})` : "array()"};
$_SERVER['REQUEST_METHOD'] = ${JSON.stringify(method)};
$_SERVER['REQUEST_URI'] = ${JSON.stringify("/api.php" + (Object.keys(get).length ? "?" + new URLSearchParams(get).toString() : ""))};
$_GET = array(); ${getSeeds}
$_POST = array(); ${postSeeds}
require_once '/tmp/fka/stubs.php';
$__prev = session_id();
if ($__prev === '' || $__prev === false) {
  if (!empty($_COOKIE['fksid'])) { @session_id($_COOKIE['fksid']); }
}
$__sid_before = session_id();
try { include '/tmp/fka/api.php'; }
catch (FkExit $e) {}
catch (Throwable $e) { echo "\n[[PHP-ERR:" . $e->getMessage() . "@" . $e->getLine() . "]]"; }
/* php-wasm هدر Set-Cookie را به بیرون نمی‌دهد؛ شناسهٔ نشست را مستقیم
   از خود PHP می‌گیریم تا مرورگرِ تست، همان کوکی واقعی را ببیند. */
if (session_status() === PHP_SESSION_ACTIVE) {
  $GLOBALS['__fk_sid'] = session_id();
}
/* هر بافر تودرتویی که خود برنامه باز کرده باشد هم تخلیه شود */
while (ob_get_level() > 0) { ob_end_flush(); }
if (session_status() === PHP_SESSION_ACTIVE) { @session_write_close(); }
$__sid = $GLOBALS['__fk_sid'] ?? (session_id() ?: ($__prev ?: ($_COOKIE['fksid'] ?? '')));
echo "\\n@@SID:" . $__sid . ":@@";
clearstatcache(true);
$__dump = array();
foreach (array('/tmp/fka/fk-sessions','/tmp/fka/fk-jobs','/tmp/fka/fk-uploads','/tmp/fka/fk-invoices','/tmp/fka/fk-data') as $__d) {
  foreach (glob($__d . '/*') ?: array() as $__f) {
    if (is_file($__f)) { $__dump[substr($__f, strlen('/tmp/fka/'))] = base64_encode((string) file_get_contents($__f)); }
  }
}
foreach (array('/tmp/fka/fk-config.json','/tmp/fka/fk-owner') as $__f) {
  if (is_file($__f)) { $__dump[substr($__f, strlen('/tmp/fka/'))] = base64_encode((string) file_get_contents($__f)); }
}
echo "\\n@@STATE:" . base64_encode(json_encode($__dump)) . ":@@";
`;

  await php.run(code);
  const started = Date.now();
  while (Date.now() - started < 40000 && !out.includes(":@@")) {
    await new Promise((r) => setTimeout(r, 40));
  }
  await new Promise((r) => setTimeout(r, 120));

  const sidM = out.match(/@@SID:([^:]*):@@/);
  const sid = sidM ? sidM[1] : "";
  let nextState = state;
  const stateM = out.match(/@@STATE:([A-Za-z0-9+/=]+):@@/);
  if (stateM) {
    const dump = JSON.parse(UB(stateM[1]));
    nextState = {};
    for (const [k, v] of Object.entries(dump)) nextState[k] = UB(v);
  }
  const clean = out
    .replace(/\n@@STATE:[\s\S]*?:@@/, "")
    .replace(/\n@@SID:[^:]*:@@/, "");

  let data = null;
  const text = clean.trim();
  if (text.startsWith("{") || text.startsWith("[")) {
    try { data = JSON.parse(text); } catch { data = null; }
  }
  return { body: clean, data, text, cookie: sid || cookie, state: nextState, error: /\[\[PHP-ERR:/.test(clean) };
}

/**
 * یک «سرور» مشترک — شبیه‌سازی دقیق‌تر هاست واقعی.
 *
 * هر درخواست در php-wasm یک نمونهٔ تازه است، ولی در دنیای واقعی همهٔ
 * درخواست‌ها به یک پوشهٔ fk-data نگاه می‌کنند. اگر هر Session حالت
 * خودش را نگه دارد، تست «ایمیل تکراری» یا «کد ساخته‌شده توسط مدیر را
 * کاربر مصرف می‌کند» بی‌معنا می‌شود چون دو کاربر اصلاً همدیگر را
 * نمی‌بینند. پس یک شیء مشترک داریم که همهٔ Session‌ها از آن می‌خوانند
 * و در آن می‌نویسند.
 */
export class Server {
  constructor(state = {}, config = null) {
    this.state = { ...state };
    this.config = config;
  }

  /** یک نشست (کاربر) روی همین سرور */
  session() {
    return new Session(this);
  }

  async request(opts = {}) {
    const res = await request({ ...opts, state: this.state, config: this.config });
    this.state = res.state;
    return res;
  }
}

/** یک نشست (کاربر) روی سرور مشترک */
export class Session {
  constructor(server = null, config = null) {
    /* سازگاری با فراخوانی قدیمی Session(stateObj) */
    this.server = server instanceof Server ? server : new Server(server || {}, config);
    this.cookie = "";
    this.queue = undefined;
    this.config = null;
  }

  get state() { return this.server.state; }

  async call(opts = {}) {
    const res = await this.server.request({ ...opts, cookie: this.cookie, queue: this.queue });
    this.queue = undefined;
    /* شناسهٔ نشست را نگه دار — کوکی در php-wasm به بیرون نمی‌رود */
    if (res.cookie) this.cookie = res.cookie;
    this.last = res;
    return res;
  }

  /** ثبت‌نام/ورود با ایمیل مشخص و نگه‌داشتن نشست */
  async register(email, password = "Test@12345", extra = {}) {
    return this.call({
      method: "POST", action: "register",
      json: {
        full_name: extra.full_name || "کاربر تست",
        email, password,
        company: extra.company || "",
        phone: extra.phone || "",
        license_key: extra.license_key || "",
      },
    });
  }

  async login(email, password = "Test@12345") {
    return this.call({ method: "POST", action: "login", json: { email, password } });
  }
}
