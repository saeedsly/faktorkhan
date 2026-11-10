import { PhpNode } from "php-wasm/PhpNode.mjs";
import fs from "fs";

/*
 * آزمون بستن کارهای نیمه‌کاره در PHP.
 *
 * باگ: اگر مرورگر بسته شود و cron نصب نباشد، کار تا ابد در stage=converting
 * می‌ماند. کاربر صفحه را باز می‌کند و درصد ثابتی می‌بیند — بدون هیچ پیامی.
 * این آزمون ثابت می‌کند job_reap_stale چنین کاری را می‌بندد، و کار تازهٔ
 * در حال اجرا را دست نمی‌زند.
 */

const SRC = new URL("../../../deploy/php", import.meta.url).pathname;
const B = s => Buffer.from(s, "utf8").toString("base64");
const UB = s => Buffer.from(s, "base64").toString("utf8");
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
  function curl_error($h){return '';}
  function curl_errno($h){return 0;}
  function curl_getinfo($h,$k=null){ return 200; }
  function curl_close($h){}
}
$_SERVER['REMOTE_ADDR'] = '127.0.0.1';
$_SERVER['HTTPS'] = 'off';
`;

const php = new PhpNode();
await new Promise(r => php.addEventListener("ready", r));
let out = "";
php.addEventListener("output", e => { out += e.detail.join(""); });

const jobOld = {
  id: "old1", status: "converting", stage: "convert", progress: 55,
  message: "تبدیل در حال انجام است…", created_at: 1700000000, user: "u1",
};
const jobNew = {
  id: "new1", status: "converting", stage: "convert", progress: 55,
  message: "تبدیل در حال انجام است…", created_at: Math.floor(Date.now() / 1000), user: "u1",
};
const jobDone = {
  id: "done1", status: "done", stage: "done", progress: 100, text: "متن", user: "u1",
};

const code = `<?php
ini_set('display_errors','1'); error_reporting(E_ALL);
@mkdir('/tmp/fk2/fk-sessions', 0777, true); @mkdir('/tmp/fk2/fk-jobs', 0777, true); @mkdir('/tmp/fk2/fk-uploads', 0777, true);
if (!defined('FK_ROOT')) define('FK_ROOT', '/tmp/fk2');
file_put_contents('/tmp/fk2/lib.php', base64_decode('${B(lib)}'));
file_put_contents('/tmp/fk2/engine.php', base64_decode('${B(engine)}'));
file_put_contents('/tmp/fk2/stubs.php', base64_decode('${B(STUBS)}'));
require_once '/tmp/fk2/stubs.php';
require_once '/tmp/fk2/lib.php';

file_put_contents(jobs_dir() . '/old1.json', base64_decode('${B(JSON.stringify(jobOld))}'));
file_put_contents(jobs_dir() . '/new1.json', base64_decode('${B(JSON.stringify(jobNew))}'));
file_put_contents(jobs_dir() . '/done1.json', base64_decode('${B(JSON.stringify(jobDone))}'));
// کار قدیمی را ۴۵ دقیقه در گذشته دستکاری کن
touch(jobs_dir() . '/old1.json', time() - 2700);
touch(jobs_dir() . '/done1.json', time() - 2700);

if (!function_exists('job_reap_stale')) { echo "NO_FUNCTION"; exit; }
$n = job_reap_stale();
$old = json_decode(file_get_contents(jobs_dir() . '/old1.json'), true);
$new = json_decode(file_get_contents(jobs_dir() . '/new1.json'), true);
$done = json_decode(file_get_contents(jobs_dir() . '/done1.json'), true);

echo json_encode(array(
  'reaped' => $n,
  'old_status' => $old['status'] ?? '?',
  'old_message' => substr((string)($old['message'] ?? ''), 0, 400),
  'new_status' => $new['status'] ?? '?',
  'done_status' => $done['status'] ?? '?',
), JSON_UNESCAPED_UNICODE);
`;

await php.run(code);
await new Promise(r => setTimeout(r, 500));
if (!out.trim().startsWith("{")) { console.log("=== RAW OUTPUT ==="); console.log(out.slice(0, 2500)); }

let fails = 0;
const ck = (l, c, e = "") => { if (!c) fails++; console.log(`  ${c ? "✓" : "✗"} ${l}${e ? " — " + e : ""}`); };

console.log("═".repeat(60));
console.log("بستن کارهای نیمه‌کاره در PHP");
console.log("═".repeat(60));

let r = {};
try { r = JSON.parse(out.trim().split("\n").filter(l => l.trim().startsWith("{")).pop() || "{}"); } catch { }
if (out.includes("NO_FUNCTION")) console.log("  ✗ تابع job_reap_stale وجود ندارد");
console.log("  خروجی:", JSON.stringify(r, null, 0));

ck("تابع وجود دارد", !out.includes("NO_FUNCTION"));
ck("کار قدیمی بسته شد", r.old_status === "failed", r.old_status);
ck("پیام روشن دارد", /نیمه‌کاره|دوباره/.test(r.old_message || ""), r.old_message);
ck("دقیقاً یک کار بسته شد", r.reaped === 1, String(r.reaped));
ck("کار تازه دست‌نخورده ماند", r.new_status === "converting", r.new_status);
ck("کار تمام‌شده تغییر نکرد", r.done_status === "done", r.done_status);

console.log(fails === 0 ? "\n✓ همه بررسی‌ها موفق" : `\n✗ ${fails} بررسی ناموفق`);
process.exit(fails === 0 ? 0 : 1);
