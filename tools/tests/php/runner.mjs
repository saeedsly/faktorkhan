import { PhpNode } from "php-wasm/PhpNode.mjs";
import fs from "fs";
const SRC = new URL("../../../deploy/php", import.meta.url).pathname;
const B = s => Buffer.from(s, "utf8").toString("base64");
const UB = s => Buffer.from(s, "base64").toString("utf8");

// exit → استثنا، فقط برای اینکه بتوانیم وضعیت را در پایان درخواست ذخیره کنیم
const patch = (s) => s
  .replace("declare(strict_types=1);", "")
  .replace(/\bexit;/g, "throw new \\FkExit();")
  .replace(/(?<![\w$>:])header\(/g, "fk_hdr(");
const lib = patch(fs.readFileSync(`${SRC}/lib.php`, "utf8"));
/* رابط قدیمی تک‌صفحه‌ای — index.php حالا یک پوستهٔ SPA است */
const idx = patch(fs.readFileSync(`${SRC}/legacy.php`, "utf8"));
const eng = fs.readFileSync(`${SRC}/engine.php`, "utf8").replace(/\?>`$/, "");

const library = fs.readFileSync(`${SRC}/library.php`, "utf8");
/* legacy.php برای دادهٔ برند و قابلیت‌ها به data.php وابسته است */
const data = fs.readFileSync(`${SRC}/data.php`, "utf8").replace("declare(strict_types=1);", "");

const STUBS = `<?php
if (!class_exists('FkExit')) { class FkExit extends Exception {} }
$names = array('URL','POST','POSTFIELDS','RETURNTRANSFER','TIMEOUT','CONNECTTIMEOUT','SSL_VERIFYPEER',
 'SSL_VERIFYHOST','FOLLOWLOCATION','USERAGENT','MAXREDIRS','FRESH_CONNECT','FORBID_REUSE','HTTPHEADER',
 'DNS_CACHE_TIMEOUT','TCP_FASTOPEN','SAFE_UPLOAD');
$i = 100;
foreach ($names as $n) { if (!defined('CURLOPT_' . $n)) { define('CURLOPT_' . $n, $i++); } }
if (!defined('CURLINFO_HTTP_CODE')) define('CURLINFO_HTTP_CODE', 500);
if (!class_exists('CURLFile')) { class CURLFile { public $path,$mime,$name;
  function __construct($p,$m='',$n=''){$this->path=$p;$this->mime=$m;$this->name=$n;} } }
function curl_init($u=null){return 'H';}
function curl_setopt_array($h,$o){
  if (isset($o[CURLOPT_POSTFIELDS])) { $GLOBALS['__pf'] = $o[CURLOPT_POSTFIELDS]; }
  if (isset($o[CURLOPT_TIMEOUT])) { $GLOBALS['__to'] = (int)$o[CURLOPT_TIMEOUT]; }
  if (isset($o[CURLOPT_URL])) { $GLOBALS['__url'] = (string)$o[CURLOPT_URL]; }
  return true; }
function curl_setopt($h,$k,$v){
  if ($k === CURLOPT_POSTFIELDS) { $GLOBALS['__pf'] = $v; }
  if ($k === CURLOPT_TIMEOUT) { $GLOBALS['__to'] = (int)$v; }
  if ($k === CURLOPT_URL) { $GLOBALS['__url'] = (string)$v; }
  return true; }
function curl_exec($h){
  $pf = $GLOBALS['__pf'] ?? array();
  $cmd = is_array($pf) && isset($pf['command']) ? $pf['command'] : 'GET';
  file_put_contents('/tmp/calls.log', $cmd . "/" . (int)($GLOBALS['__to'] ?? 0) . "\n", FILE_APPEND);
  $q=is_file('/tmp/q.json')?json_decode(file_get_contents('/tmp/q.json'),true):array();
  if(!$q) return json_encode(array('Status'=>'Done'));
  $it=array_shift($q); file_put_contents('/tmp/q.json',json_encode($q));
  if(!empty($it['err'])){ $GLOBALS['__errno']=28; return false; }
  if(isset($it['dlb64'])) return base64_decode($it['dlb64']);
  if(isset($it['dl'])) return $it['dl'];
  return $it['body']; }
function curl_error($h){return 'Operation timed out';}
function curl_errno($h){return $GLOBALS['__errno'] ?? 0;}
function curl_getinfo($h,$k=null){ $v=$GLOBALS['__info'] ?? 200; $GLOBALS['__info']=200; return $v; }
function curl_close($h){}
/* header() و readfile() توابع داخلی PHP هستند و بازتعریف نمی‌شوند؛
   در ابزار آزمون، فراخوانی‌های header( در سورس به fk_hdr( تبدیل می‌شوند. */
function fk_hdr($s, $replace = true, $code = 0) {
  if (!isset($GLOBALS['__hdr'])) { $GLOBALS['__hdr'] = array(); }
  $GLOBALS['__hdr'][] = $s . ($code ? ' ~~' . $code : '');
  return true; }
$_SERVER['REMOTE_ADDR']='127.0.0.1'; $_SERVER['HTTPS']='off';
`;

/**
 * یک درخواست HTTP مستقل.
 * @param {object} state  { "fk-config.json": "...", "fk-jobs/x.json": "..." }
 */
export async function request(state, opts) {
  const php = new PhpNode();
  await new Promise(r => php.addEventListener("ready", r));
  let out = "";
  php.addEventListener("output", e => { out += e.detail.join(""); });

  const seed = Object.entries(state || {}).map(([p, c]) =>
    `@mkdir('/tmp/fk/' . dirname('${p}'), 0777, true); file_put_contents('/tmp/fk/${p}', base64_decode('${B(c)}'));`
  ).join("\n");

  await php.run(`<?php
ini_set('display_errors','0'); error_reporting(E_ALL & ~E_DEPRECATED);
@mkdir('/tmp/fk/fk-sessions',0777,true); @mkdir('/tmp/fk/fk-jobs',0777,true); @mkdir('/tmp/fk/fk-uploads',0777,true);
file_put_contents('/tmp/fk/lib.php', base64_decode('${B(lib)}'));
file_put_contents('/tmp/fk/index.php', base64_decode('${B(idx)}'));
file_put_contents('/tmp/fk/engine.php', base64_decode('${B(eng)}'));
file_put_contents('/tmp/fk/library.php', base64_decode('${B(library)}'));
file_put_contents('/tmp/fk/data.php', base64_decode('${B(data)}'));
file_put_contents('/tmp/fk/stubs.php', base64_decode('${B(STUBS)}'));
${seed}
@unlink('/tmp/calls.log');
file_put_contents('/tmp/q.json', base64_decode('${B(JSON.stringify(opts.queue || []))}'));
file_put_contents('/tmp/in.bin', base64_decode('${B(opts.upload || "J".repeat(800))}'));
$_COOKIE = ${opts.cookie ? `array('fksid' => '${opts.cookie}')` : "array()"};
require_once '/tmp/fk/stubs.php';
$_SERVER['REQUEST_METHOD'] = '${opts.method || "GET"}';
$_GET = json_decode(base64_decode('${B(JSON.stringify(opts.get || {}))}'), true) ?: array();
$_SERVER['REQUEST_URI'] = '/faktorkhan/index.php' . ($_GET ? '?' . http_build_query($_GET) : '');
$_POST = json_decode(base64_decode('${B(JSON.stringify(opts.post || {}))}'), true) ?: array();
foreach (json_decode(base64_decode('${B(JSON.stringify(opts.files || {}))}'), true) ?: array() as $k => $v) { $_FILES[$k] = $v; }
ob_start();
require_once '/tmp/fk/lib.php';
try { include '/tmp/fk/index.php'; } catch (FkExit $e) {} catch (Throwable $e) { echo "\\n[[EXC:" . $e->getMessage() . "@" . $e->getLine() . "]]"; }
$body = ob_get_clean();
$files = array();
foreach (array('/tmp/fk/fk-sessions','/tmp/fk/fk-jobs','/tmp/fk/fk-uploads','/tmp/fk') as $d) {
  foreach (glob($d . '/*') ?: array() as $f) {
    if (is_file($f) && !in_array(basename($f), array('lib.php','index.php','stubs.php','library.php','engine.php','data.php'), true)) {
      $files[substr($f, 8)] = base64_encode((string) file_get_contents($f));
    }
  }
}
echo "\\n@@R=" . base64_encode(json_encode(array(
  'body' => $body,
  'headers' => $GLOBALS['__hdr'] ?? array(),
  'code' => $GLOBALS['__code'] ?? 200,
  'calls' => trim((string) @file_get_contents('/tmp/calls.log')),
  'files' => $files,
))) . "@@";
`);
  await new Promise(r => setTimeout(r, 500));
  const m = out.match(/@@R=([A-Za-z0-9+/=]+)@@/);
  if (!m) return { body: out, calls: "", state: {}, raw: out };
  const d = JSON.parse(UB(m[1]));
  const files = {};
  for (const [k, v] of Object.entries(d.files)) files[k] = UB(v);
  return { body: d.body, calls: d.calls, state: files, raw: out, headers: d.headers || [], code: d.code || 200 };
}
