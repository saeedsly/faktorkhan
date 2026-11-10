import { PhpNode } from "php-wasm/PhpNode.mjs";
import fs from "fs";

/*
 * آزمون محدودیت تلاش ورود.
 *
 * قبل از این: هر کسی می‌توانست روی اینترنت گذرواژه را بی‌نهایت امتحان کند.
 * usleep(700ms) فقط حجم حمله را کم می‌کرد، جلویش را نمی‌گرفت (۵۰ درخواست
 * موازی = ۵۰ هسته که با هم می‌خوابند).
 *
 * انتظار: بعد از ۸ تلاش ناموفق، دستگاه مسدود شود؛ ولی کاربری که گذرواژهٔ
 * درست را می‌زند در اولین تلاش موفق، شمارنده‌اش صفر شود.
 */

const SRC = new URL("../../../deploy/php", import.meta.url).pathname;
const B = s => Buffer.from(s, "utf8").toString("base64");

const lib = fs.readFileSync(`${SRC}/lib.php`, "utf8");
const engine = fs.readFileSync(`${SRC}/engine.php`, "utf8");

const STUBS = `<?php
foreach (array('CURLOPT_URL'=>1,'CURLOPT_POST'=>2,'CURLOPT_POSTFIELDS'=>3,'CURLOPT_RETURNTRANSFER'=>4,
 'CURLOPT_TIMEOUT'=>5,'CURLOPT_CONNECTTIMEOUT'=>6,'CURLOPT_SSL_VERIFYPEER'=>7,'CURLOPT_SSL_VERIFYHOST'=>8,
 'CURLOPT_FOLLOWLOCATION'=>9,'CURLOPT_USERAGENT'=>10,'CURLINFO_HTTP_CODE'=>11,'CURLOPT_MAXREDIRS'=>12) as $k=>$v) if(!defined($k)) define($k,$v);
if (!class_exists('CURLFile')) { class CURLFile { public $path,$mime,$name; function __construct($p,$m='',$n=''){$this->path=$p;$this->mime=$m;$this->name=$n;} } }
if (!function_exists('curl_init')) {
  function curl_init($u=null){return 'H';}
  function curl_setopt_array($h,$o){return true;}
  function curl_setopt($h,$k,$v){return true;}
  function curl_exec($h){ return json_encode(array('Status'=>'Done')); }
  function curl_error($h){return '';} function curl_errno($h){return 0;}
  function curl_getinfo($h,$k=null){ return 200; } function curl_close($h){}
}
$_SERVER['REMOTE_ADDR'] = '203.0.113.9';
$_SERVER['HTTP_USER_AGENT'] = 'TestUA/1.0';
$_SERVER['HTTP_ACCEPT_LANGUAGE'] = 'fa-IR';
$_SERVER['HTTPS'] = 'off';
`;

function mk() {
  const php = new PhpNode();
  return new Promise(async (resolve) => {
    const p = new PhpNode();
    await new Promise(r => p.addEventListener("ready", r));
    let out = "";
    p.addEventListener("output", e => { out += e.detail.join(""); });
    resolve({ p, get: () => out });
  });
}

const base = `@mkdir('/tmp/fk3/fk-sessions',0777,true); @mkdir('/tmp/fk3/fk-jobs',0777,true);
if(!defined('FK_ROOT')) define('FK_ROOT','/tmp/fk3');
file_put_contents('/tmp/fk3/lib.php', base64_decode('${B(lib)}'));
file_put_contents('/tmp/fk3/engine.php', base64_decode('${B(engine)}'));
file_put_contents('/tmp/fk3/stubs.php', base64_decode('${B(STUBS)}'));
require_once '/tmp/fk3/stubs.php';
require_once '/tmp/fk3/lib.php';
`;

let fails = 0;
const ck = (l, c, e = "") => { if (!c) fails++; console.log(`  ${c ? "✓" : "✗"} ${l}${e ? " — " + e : ""}`); };

console.log("═".repeat(62));
console.log("محدودیت تلاش ورود در PHP");
console.log("═".repeat(62));

// ——— همه در یک اجرا: ۹ بار ثبت شکست، بعد بررسی مسدود بودن
{
  const { p, get } = await mk();
  await p.run(`<?php
${base}
if (!function_exists('login_fail')) { echo "NO_FN"; exit; }
// پاکسازی از اجرای قبلی
@unlink(login_attempts_file());

$results = array();
$results['before'] = login_blocked();
for ($i = 1; $i <= 8; $i++) {
    login_fail();
    $b = login_blocked();
    $results['after_' . $i] = $b;
}
echo json_encode($results);
`);
  await new Promise(r => setTimeout(r, 500));
  const out = get();
  let r = {};
  try { r = JSON.parse(out.trim().split("\n").filter(l => l.trim().startsWith("{")).pop()); } catch { }
  if (out.includes("NO_FN")) console.log("  ✗ توابع محدودیت وجود ندارند");
  console.log("  خروجی:", JSON.stringify(r));

  ck("تابع وجود دارد", !out.includes("NO_FN"));
  ck("قبل از تلاش: مسدود نیست", Array.isArray(r.before) && r.before[0] === false, JSON.stringify(r.before));
  ck("بعد از ۷ تلاش: هنوز آزاد", Array.isArray(r.after_7) && r.after_7[0] === false, JSON.stringify(r.after_7));
  ck("بعد از ۸ تلاش: مسدود شد", Array.isArray(r.after_8) && r.after_8[0] === true, JSON.stringify(r.after_8));
  ck("زمان انتظار معقول است", Array.isArray(r.after_8) && r.after_8[1] > 800 && r.after_8[1] <= 900, String(r.after_8 && r.after_8[1]));
}

// ——— ورود موفق باید شمارنده را صفر کند
{
  const { p, get } = await mk();
  await p.run(`<?php
${base}
@unlink(login_attempts_file());
login_fail(); login_fail(); login_fail();
$three = login_blocked();
login_success();
$after = login_blocked();
echo json_encode(array('three' => $three, 'after' => $after,
  'file' => @file_get_contents(login_attempts_file())));
`);
  await new Promise(r => setTimeout(r, 500));
  const out = get();
  let r = {};
  try { r = JSON.parse(out.trim().split("\n").filter(l => l.trim().startsWith("{")).pop()); } catch { }
  console.log("  خروجی ۲:", JSON.stringify(r));
  ck("۳ تلاش: هنوز مسدود نیست", Array.isArray(r.three) && r.three[0] === false);
  ck("بعد از ورود موفق: شمارنده صفر", Array.isArray(r.after) && r.after[0] === false);
  ck("فایل شمارنده پاک شد", !r.file || r.file === "{}" || JSON.parse(r.file || "{}") && Object.keys(JSON.parse(r.file || "{}")).length === 0, String(r.file).slice(0, 40));
}

// ——— دستگاه دیگر با همان IP (NAT) نباید قربانی شود؟ (UA متفاوت → کلید متفاوت)
{
  const { p, get } = await mk();
  await p.run(`<?php
${base}
@unlink(login_attempts_file());
for ($i = 0; $i < 8; $i++) { login_fail(); }
$me = login_blocked();
// دستگاه دیگر: همان IP، مرورگر دیگر
$_SERVER['HTTP_USER_AGENT'] = 'OtherBrowser/9.9';
$other = login_blocked();
echo json_encode(array('me' => $me, 'other' => $other));
`);
  await new Promise(r => setTimeout(r, 500));
  const out = get();
  let r = {};
  try { r = JSON.parse(out.trim().split("\n").filter(l => l.trim().startsWith("{")).pop()); } catch { }
  console.log("  خروجی ۳:", JSON.stringify(r));
  ck("دستگاه مهاجم مسدود است", Array.isArray(r.me) && r.me[0] === true);
  ck("مرورگر دیگر همان IP آزاد است", Array.isArray(r.other) && r.other[0] === false, JSON.stringify(r.other));
}

console.log(fails === 0 ? "\n✓ همه بررسی‌ها موفق" : `\n✗ ${fails} بررسی ناموفق`);
process.exit(fails === 0 ? 0 : 1);
