import { PhpNode } from "php-wasm/PhpNode.mjs";
import fs from "fs";

export const SRC = new URL("../../../deploy/php", import.meta.url).pathname;
const B = s => Buffer.from(s, "utf8").toString("base64");
const UB = s => Buffer.from(s, "base64").toString("utf8");

const lib = fs.readFileSync(`${SRC}/lib.php`, "utf8");
const engine = fs.readFileSync(`${SRC}/engine.php`, "utf8");
const library = fs.readFileSync(`${SRC}/library.php`, "utf8");
const idx = fs.readFileSync(`${SRC}/index.php`, "utf8").replace("declare(strict_types=1);", "");

const STUBS = `<?php
foreach (array('CURLOPT_URL'=>1,'CURLOPT_POST'=>2,'CURLOPT_POSTFIELDS'=>3,'CURLOPT_RETURNTRANSFER'=>4,'CURLOPT_TIMEOUT'=>5,
 'CURLOPT_CONNECTTIMEOUT'=>6,'CURLOPT_SSL_VERIFYPEER'=>7,'CURLOPT_SSL_VERIFYHOST'=>8,'CURLOPT_FOLLOWLOCATION'=>9,
 'CURLOPT_USERAGENT'=>10,'CURLINFO_HTTP_CODE'=>11,'CURLOPT_MAXREDIRS'=>12) as $k=>$v) if(!defined($k)) define($k,$v);
if (!class_exists('CURLFile')) { class CURLFile { public $path,$mime,$name; function __construct($p,$m='',$n=''){$this->path=$p;$this->mime=$m;$this->name=$n;} } }
if (!function_exists('curl_init')) {
  function curl_init($u=null){return 'H';}
  function curl_setopt_array($h,$o){
    $c = $o[CURLOPT_POSTFIELDS]['command'] ?? 'GET';
    file_put_contents('/tmp/calls.log', $c . "|" . (int)($o[CURLOPT_TIMEOUT] ?? 0) . "\\n", FILE_APPEND);
    $GLOBALS['__url'] = $o[CURLOPT_URL] ?? '';
    return true;
  }
  function curl_setopt($h,$k,$v){return true;}
  function curl_exec($h){
    $q = is_file('/tmp/q.json') ? json_decode(file_get_contents('/tmp/q.json'), true) : array();
    if (!$q) { return json_encode(array('Status'=>'Done')); }
    $it = array_shift($q); file_put_contents('/tmp/q.json', json_encode($q));
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
`;

/**
 * یک درخواست HTTP کامل. state = { "fk-jobs/x.json": "…" , … } (مسیر نسبی به /tmp/fk)
 */
export async function request(state = {}, opts = {}) {
  const php = new PhpNode();
  await new Promise(r => php.addEventListener("ready", r));
  let out = "";
  php.addEventListener("output", e => { out += e.detail.join(""); });

  const seed = Object.entries(state).map(([p, c]) =>
    `@mkdir('/tmp/fk/' . dirname('${p}'), 0777, true); file_put_contents('/tmp/fk/${p}', base64_decode('${B(c)}'));`
  ).join("\n");

  const code = `<?php
ini_set('display_errors','1'); error_reporting(E_ALL & ~E_DEPRECATED & ~E_WARNING & ~E_NOTICE);
@mkdir('/tmp/fk/fk-sessions', 0777, true); @mkdir('/tmp/fk/fk-jobs', 0777, true); @mkdir('/tmp/fk/fk-uploads', 0777, true);
file_put_contents('/tmp/fk/lib.php', base64_decode('${B(lib)}'));
file_put_contents('/tmp/fk/engine.php', base64_decode('${B(engine)}'));
file_put_contents('/tmp/fk/library.php', base64_decode('${B(library)}'));
/* php-wasm هنگام exit تابع shutdown را اجرا نمی‌کند؛ پس exit را عوض می‌کنیم */
$__idx = base64_decode('${B(idx)}');
$__idx = str_replace('echo json_encode($data, JSON_UNESCAPED_UNICODE);\n    exit;',
                     'echo json_encode($data, JSON_UNESCAPED_UNICODE);\n    __fk_dump(); exit;', $__idx);
$__idx = str_replace('    exit;\n}\n\n/* ═', '    __fk_dump(); exit;\n}\n\n/* ═', $__idx);
file_put_contents('/tmp/fk/index.php', $__idx);
file_put_contents('/tmp/fk/stubs.php', base64_decode('${B(STUBS)}'));
${seed}
@unlink('/tmp/calls.log');
file_put_contents('/tmp/q.json', base64_decode('${B(JSON.stringify(opts.queue || []))}'));
file_put_contents('/tmp/in.json', base64_decode('${B(opts.upload || "J".repeat(800))}'));
@copy('/tmp/in.json', '/tmp/in.bin');
@copy('/tmp/in.json', '/tmp/upload.bin');

register_shutdown_function(function () {
    $files = array();
    foreach (array('/tmp/fk/fk-sessions', '/tmp/fk/fk-jobs', '/tmp/fk/fk-uploads', '/tmp/fk') as $dir) {
        foreach (glob($dir . '/*') ?: array() as $f) {
            if (is_file($f) && !in_array(basename($f), array('lib.php','index.php','stubs.php','library.php','engine.php'), true)) {
                $files[substr($f, 8)] = base64_encode((string) file_get_contents($f));
            }
        }
    }
    $files['__calls'] = base64_encode((string) @file_get_contents('/tmp/calls.log'));
    echo "\\n@@DUMP:" . base64_encode(json_encode($files)) . ":DUMP@@\\n";
});

function __fk_dump() {
  $files = array();
  foreach (array('/tmp/fk/fk-sessions', '/tmp/fk/fk-jobs', '/tmp/fk/fk-uploads', '/tmp/fk') as $dir) {
    foreach (glob($dir . '/*') ?: array() as $f) {
      if (is_file($f) && !in_array(basename($f), array('lib.php','index.php','stubs.php','engine.php'), true)) {
        $files[substr($f, 8)] = base64_encode((string) file_get_contents($f));
      }
    }
  }
  $files['__calls'] = base64_encode((string) @file_get_contents('/tmp/calls.log'));
  echo "\\n@@DUMP:" . base64_encode(json_encode($files)) . ":DUMP@@\\n";
}
$_COOKIE = ${opts.cookie ? `array('fksid' => '${opts.cookie}')` : "array()"};
require_once '/tmp/fk/stubs.php';
$_SERVER['REQUEST_METHOD'] = '${opts.method || "GET"}';
$_GET = json_decode(base64_decode('${B(JSON.stringify(opts.get || {}))}'), true) ?: array();
$_SERVER['REQUEST_URI'] = '/faktorkhan/index.php' . ($_GET ? '?' . http_build_query($_GET) : '');
$_POST = json_decode(base64_decode('${B(JSON.stringify(opts.post || {}))}'), true) ?: array();
foreach (json_decode(base64_decode('${B(JSON.stringify(opts.files || {}))}'), true) ?: array() as $k => $v) { $_FILES[$k] = $v; }
$_SERVER['HTTP_X_FORWARDED_PROTO'] = 'http';
include '/tmp/fk/index.php';
`;
  await php.run(code);
  await new Promise(r => setTimeout(r, 700));

  /* php-wasm هنگام exit، register_shutdown_function را اجرا نمی‌کند.
     پس اگر DUMP نیامد، با یک اجرای دوم فایل‌ها را از دیسک بخوان. */
  let m = out.match(/@@DUMP:([A-Za-z0-9+/=]+):DUMP@@/);
  if (!m) {
    const dumpCode = `<?php
$files = array();
foreach (array('/tmp/fk/fk-sessions', '/tmp/fk/fk-jobs', '/tmp/fk/fk-uploads', '/tmp/fk') as $dir) {
  foreach (glob($dir . '/*') ?: array() as $f) {
    if (is_file($f) && !in_array(basename($f), array('lib.php','index.php','stubs.php','engine.php'), true)) {
      $files[substr($f, 8)] = base64_encode((string) file_get_contents($f));
    }
  }
}
$files['__calls'] = base64_encode((string) @file_get_contents('/tmp/calls.log'));
echo "\n@@DUMP:" . base64_encode(json_encode($files)) . ":DUMP@@\n";
`;
    const p2 = new PhpNode();
    await new Promise(r => p2.addEventListener("ready", r));
    let out2 = "";
    p2.addEventListener("output", e => { out2 += e.detail.join(""); });
    await p2.run(dumpCode);
    await new Promise(r => setTimeout(r, 400));
    m = out2.match(/@@DUMP:([A-Za-z0-9+/=]+):DUMP@@/);
  }
  const dump = m ? JSON.parse(UB(m[1])) : {};
  /* بدنه ممکن است چند بخش DUMP داشته باشد؛ همه را جدا کن */
  const body = out.split("@@DUMP:")[0].replace(/\n@@DUMP:[\s\S]*?:DUMP@@\n?/g, "").trim();
  const calls = (dump["__calls"] ? UB(dump["__calls"]) : "").trim().split("\n").filter(Boolean);
  delete dump["__calls"];
  const files = {};
  for (const [k, v] of Object.entries(dump)) files[k] = UB(v);
  return { body, calls, state: files, raw: out };
}

/** ساخت نشست واقعی با PHP و برگرداندن شناسه */
export async function makeSession(state = {}, user = { auth: true, csrf: "CSRF-T" }) {
  const r = await request(state, {
    get: {}, method: "GET",
  });
  return r;
}

export const CFG = (token = "TOK-SECRET-1") => JSON.stringify({ token });
export const SESS = 'auth|b:1;csrf|s:6:"CSRF-T";';
