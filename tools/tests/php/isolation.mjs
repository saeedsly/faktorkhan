import { PhpNode } from "php-wasm/PhpNode.mjs";
import fs from "fs";

/*
 * آزمون جداسازی کاربران در نسخهٔ PHP
 * =====================================
 * سناریوی حمله:
 *   دو کاربر روی یک نصب. کاربر «ب» وارد می‌شود و شناسهٔ کار کاربر «الف»
 *   را حدس می‌زند (شناسه‌ها الگوی قابل حدس دارند). قبل از رفع، هر چهار
 *   مسیر زیر دادهٔ الف را به ب برمی‌گرداند:
 *     GET ?api=job&id=…          → متن کامل فاکتور
 *     GET ?api=file&id=…&f=doc   → فایل Word
 *     GET ?api=file&id=…&f=txt   → فایل متن
 *     GET ?api=cancel&id=…       → لغو کار
 *     GET ?api=deletefiles&id=…  → حذف فایل‌ها
 *     POST action=forget_job     → حذف از تاریخچه
 *
 * رفع: job_load_owned() — سیاست «انکار پیش‌فرض» بر اساس فهرست نشست.
 */

const SRC = new URL("../../../deploy/php", import.meta.url).pathname;
const B = s => Buffer.from(s, "utf8").toString("base64");
const lib = fs.readFileSync(`${SRC}/lib.php`, "utf8");
const eng = fs.readFileSync(`${SRC}/engine.php`, "utf8");

const STUBS = `<?php
foreach (array('CURLOPT_URL'=>1,'CURLOPT_POST'=>2,'CURLOPT_POSTFIELDS'=>3,'CURLOPT_RETURNTRANSFER'=>4,
 'CURLOPT_TIMEOUT'=>5,'CURLOPT_CONNECTTIMEOUT'=>6,'CURLOPT_SSL_VERIFYPEER'=>7,'CURLOPT_SSL_VERIFYHOST'=>8,
 'CURLOPT_FOLLOWLOCATION'=>9,'CURLOPT_USERAGENT'=>10,'CURLINFO_HTTP_CODE'=>11,'CURLOPT_MAXREDIRS'=>12) as $k=>$v) if(!defined($k)) define($k,$v);
if (!class_exists('CURLFile')) { class CURLFile { public $path,$mime,$name; function __construct($p,$m='',$n=''){$this->path=$p;$this->mime=$m;$this->name=$n;} } }
if (!function_exists('curl_init')) {
  function curl_init($u=null){return 'H';}
  function curl_setopt_array($h,$o){return true;} function curl_setopt($h,$k,$v){return true;}
  function curl_exec($h){ return json_encode(array('Status'=>'Done')); }
  function curl_error($h){return '';} function curl_errno($h){return 0;}
  function curl_getinfo($h,$k=null){ return 200; } function curl_close($h){}
}
$_SERVER['REMOTE_ADDR'] = '127.0.0.1'; $_SERVER['HTTPS'] = 'off';
`;

let fails = 0;
const ck = (l, c, e = "") => { if (!c) fails++; console.log(`  ${c ? "✓" : "✗"} ${l}${e ? " — " + e : ""}`); };

console.log("═".repeat(64));
console.log("جداسازی کاربران — نسخهٔ PHP");
console.log("═".repeat(64));

const p = new PhpNode();
await new Promise(r => p.addEventListener("ready", r));
let out = "";
p.addEventListener("output", e => { out += e.detail.join(""); });

const now = Math.floor(Date.now() / 1000);
const mkJob = (id, text) => JSON.stringify({
  id, status: "done", stage: "done", progress: 100, message: "آماده",
  text, text_clean: text, name: id + ".png", charcount: text.length,
  created_at: now, updated_at: now, engine: "cloud", saved: "", txt_file: "",
});

await p.run(`<?php
ini_set('display_errors','1'); error_reporting(E_ALL & ~E_DEPRECATED & ~E_WARNING & ~E_NOTICE);
@mkdir('/tmp/fks/fk-sessions',0777,true);@mkdir('/tmp/fks/fk-jobs',0777,true);@mkdir('/tmp/fks/fk-uploads',0777,true);
file_put_contents('/tmp/fks/lib.php', base64_decode('${B(lib)}'));
file_put_contents('/tmp/fks/engine.php', base64_decode('${B(eng)}'));
file_put_contents('/tmp/fks/stubs.php', base64_decode('${B(STUBS)}'));
require_once '/tmp/fks/stubs.php';
require_once '/tmp/fks/lib.php';

/* کارهای کاربر الف — حاوی متن محرمانه */
job_save(array('id' => 'AAAA1111', 'status' => 'done', 'stage' => 'done', 'progress' => 100,
  'message' => 'آماده', 'text' => 'متن محرمانهٔ الف — جمع کل ۹۹۹,۹۹۹', 'charcount' => 40,
  'created_at' => ${now}, 'updated_at' => ${now}, 'name' => 'a.png', 'engine' => 'cloud',
  'saved' => '/tmp/fks/fk-uploads/secret.docx', 'txt_file' => '/tmp/fks/fk-uploads/secret.txt'));
job_save(array('id' => 'BBBB2222', 'status' => 'done', 'stage' => 'done', 'progress' => 100,
  'message' => 'آماده', 'text' => 'متن ب', 'charcount' => 6,
  'created_at' => ${now}, 'updated_at' => ${now}, 'name' => 'b.png', 'engine' => 'cloud'));

$r = array();

/* ── ۱) کاربر الف: مالک کار، باید ببیند */
$mine = job_load_owned('AAAA1111', array('AAAA1111', 'BBBB2222'));
$r['owner_sees'] = is_array($mine) && strpos((string) $mine['text'], 'محرمانه') !== false;

/* ── ۲) کاربر ب: نشستش فقط کار خودش را دارد */
$theirs = job_load_owned('AAAA1111', array('BBBB2222'));
$r['other_blocked'] = $theirs === null;

/* ── ۳) نشست خالی: نباید هیچ‌چیز ببیند */
$empty = job_load_owned('AAAA1111', array());
$r['empty_blocked'] = $empty === null;

/* ── ۴) شناسهٔ نامعتبر / تزریق */
$r['inj1'] = job_load_owned('../../fk-config.json', array('AAAA1111')) === null;
$r['inj2'] = job_load_owned("AAAA1111' OR 1=1 --", array('AAAA1111')) === null;
$r['inj3'] = job_load_owned('', array('AAAA1111')) === null;
$r['inj4'] = job_load_owned('aaa..%2f..%2f', array('AAAA1111')) === null;

/* ── ۵) job_claim: ثبت و بی‌تکرار */
$_SESSION = array();
job_claim('CCCC3333');
job_claim('CCCC3333');
job_claim('DDDD4444');
$r['claim'] = (array) ($_SESSION['jobs'] ?? array());
$r['claim_ok'] = count($r['claim']) === 2 && in_array('CCCC3333', $r['claim'], true);

/* ── ۶) بعد از claim، مالک می‌تواند بخواند (کار واقعی بساز) */
job_save(array('id' => 'CCCC3333', 'status' => 'done', 'stage' => 'done', 'progress' => 100,
  'message' => 'آماده', 'text' => 'متن ج', 'charcount' => 6,
  'created_at' => ${now}, 'updated_at' => ${now}, 'name' => 'c.png', 'engine' => 'cloud'));
$_SESSION['jobs'] = array('CCCC3333');
$r['after_claim'] = job_load_owned('CCCC3333') !== null;

/* ── ۶ب) کار موجود ولی مالکیت نداشتن: نباید داده بدهد */
$r['exists_but_not_owner'] = job_load_owned('DDDD4444', array('CCCC3333')) === null;

/* ── ۷) شناسهٔ کار ناموجود برای مالک: خطای تمیز، نه فایل */
$_SESSION['jobs'] = array('NOSUCH99');
$r['missing'] = job_load_owned('NOSUCH99');

echo "RESULT:" . json_encode($r, JSON_UNESCAPED_UNICODE) . ":END";
`);
await new Promise(r => setTimeout(r, 900));

const m = out.match(/RESULT:([\s\S]*?):END/);
const r = m ? JSON.parse(m[1]) : {};
if (!m) { console.log("خروجی:", out.slice(0, 800)); }

ck("مالک کار خودش را می‌بیند", r.owner_sees === true, String(r.owner_sees));
ck("کاربر دیگر متن محرمانه را نمی‌بیند", r.other_blocked === true, String(r.other_blocked));
ck("نشست خالی هیچ‌چیز نمی‌بیند", r.empty_blocked === true, String(r.empty_blocked));
ck("مسیر تزریق با ../ بسته است", r.inj1 === true, String(r.inj1));
ck("تزریق SQL/نویسه بسته است", r.inj2 === true, String(r.inj2));
ck("شناسهٔ خالی رد می‌شود", r.inj3 === true, String(r.inj3));
ck("شناسهٔ URL-encoded رد می‌شود", r.inj4 === true, String(r.inj4));
ck("job_claim بدون تکرار ثبت می‌کند", r.claim_ok === true, JSON.stringify(r.claim));
ck("بعد از claim مالک می‌خواند", r.after_claim === true, String(r.after_claim));
ck("کار موجود ولی مالکیت نداشتن → null", r.exists_but_not_owner === true, String(r.exists_but_not_owner));
ck("کار ناموجود → null (نه خطا)", r.missing === null, JSON.stringify(r.missing));

console.log(fails === 0 ? "\n✓ همه بررسی‌ها موفق" : `\n✗ ${fails} بررسی ناموفق`);
process.exit(fails === 0 ? 0 : 1);
