<?php
/**
 * فاکتورخوان — عیب‌یابی سرویس ابری (فقط برای تست)
 * =================================================
 * این فایل را کنار index.php بگذارید و باز کنید:
 *     http://localhost/faktorkhan/diag.php
 *
 * چه می‌کند:
 *   ۱) وضعیت PHP/curl/TLS را نشان می‌دهد
 *   ۲) «تست اعتبار» را می‌زند و پاسخ خام سرور را نشان می‌دهد
 *   ۳) یک عکس کوچک می‌سازد و «ثبت فایل» را تست می‌کند؛ پاسخ خام + نام کلیدها را نشان می‌دهد
 *   ۴) چهار روش مختلف ارسال فایل را امتحان می‌کند تا بفهمیم کدام جواب می‌دهد
 *
 * ⚠️ پس از عیب‌یابی این فایل را پاک کنید.
 * ⚠️ توکن در هیچ خروجی چاپ نمی‌شود.
 */

declare(strict_types=1);

@ini_set('display_errors', '1');
error_reporting(E_ALL);
@date_default_timezone_set('Asia/Tehran');

const CFG = __DIR__ . '/fk-config.json';

function cfg(): array
{
    if (!is_file(CFG)) {
        return array();
    }
    $d = json_decode((string) @file_get_contents(CFG), true);
    return is_array($d) ? $d : array();
}

function gateway(): string
{
    $c = cfg();
    if (!empty($c['gateway'])) {
        return (string) $c['gateway'];
    }
    $raw = base64_decode('Mi4uKilgdXUtLS10Pzg1' . 'NXQzKHU7KjN1NTkodT0/' . 'Li07Iw==', true);
    if ($raw === false) {
        return '';
    }
    $out = '';
    for ($i = 0, $n = strlen($raw); $i < $n; $i++) {
        $out .= chr(ord($raw[$i]) ^ 0x5A);
    }
    return $out;
}

function scrub(string $s): string
{
    $t = (string) (cfg()['token'] ?? '');
    if ($t !== '') {
        $s = str_replace($t, '«TOKEN-HIDDEN»', $s);
        if (strlen($t) > 8) {
            $s = str_replace(substr($t, 0, 8), '«TOKEN-HIDDEN»', $s);
        }
    }
    return $s;
}

function h(?string $v): string
{
    return htmlspecialchars((string) $v, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

/**
 * یک درخواست خام به درگاه؛ همهٔ جزئیات را برمی‌گرداند (برای عیب‌یابی).
 */
function raw_call(array $fields, ?string $fileField = null, ?string $filePath = null, string $fileName = '', string $mime = ''): array
{
    $c = cfg();
    $url = gateway();
    $token = (string) ($c['token'] ?? '');
    $verify = array_key_exists('verify_tls', $c) ? (bool) $c['verify_tls'] : true;

    $payload = $fields;
    $payload['token'] = $token;
    if ($fileField !== null && $filePath !== null) {
        if (class_exists('CURLFile')) {
            $payload[$fileField] = new CURLFile($filePath, $mime ?: 'application/octet-stream', $fileName ?: 'upload.jpg');
        } else {
            $payload[$fileField] = '@' . $filePath . ';filename=' . ($fileName ?: 'upload.jpg') . ';type=' . ($mime ?: 'image/jpeg');
            if (!empty($c['legacy_curl'])) {
                // حالت قدیمی PHP 5.4: نیاز به این دو تنظیم
                $legacy = true;
            }
        }
    }

    $info = array(
        'url_len' => strlen($url),
        'field_names' => array_keys($payload),
        'file_field' => $fileField,
        'file_size' => $filePath && is_file($filePath) ? filesize($filePath) : 0,
        'file_name_sent' => $fileName,
        'mime_sent' => $mime,
        'verify_tls' => $verify,
    );

    $ch = curl_init();
    $opts = array(
        CURLOPT_URL => $url,
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $payload,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 30,   // کوتاه تا صفحهٔ عیب‌یابی سرور را قفل نکند
        CURLOPT_CONNECTTIMEOUT => 20,
        CURLOPT_SSL_VERIFYPEER => $verify,
        CURLOPT_SSL_VERIFYHOST => $verify ? 2 : 0,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_USERAGENT => 'FactorKhan-Diag/1.0',
    );
    if (!empty($legacy)) {
        $opts[CURLOPT_SAFE_UPLOAD] = false;
    }
    curl_setopt_array($ch, $opts);
    $body = curl_exec($ch);
    $info['curl_errno'] = curl_errno($ch);
    $info['curl_error'] = curl_error($ch);
    $info['http_status'] = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $info['content_type'] = (string) curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
    $info['sent_bytes'] = (int) curl_getinfo($ch, CURLINFO_SIZE_UPLOAD);
    curl_close($ch);

    $info['body_raw'] = $body === false ? '(false)' : scrub((string) $body);
    $info['body_len'] = $body === false ? 0 : strlen((string) $body);
    $json = $body === false ? null : json_decode((string) $body, true);
    $info['json_ok'] = is_array($json);
    if (is_array($json)) {
        $info['json_keys'] = array_keys($json);
        $info['json_scrubbed'] = scrub((string) json_encode($json, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
    }
    return $info;
}

/** ساخت یک عکس PNG کوچک و معتبر (۱۶×۱۶) بدون نیاز به GD */
function make_png(): string
{
    $path = __DIR__ . '/fk-diag-sample.png';
    if (is_file($path)) {
        return $path;
    }
    // PNG 16×16 سفید، ساخته‌شده با دست (zlib لازم نیست: از تصویر base64 آماده استفاده می‌کنیم)
    $b64 = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAHUlEQVR4nGP8//8/A+aAiYGBgYGBgYGB'
         . 'gYGBgQEAH0oD/wK1sB0AAAAASUVORK5CYII=';
    $data = base64_decode($b64, true);
    if ($data === false) {
        return '';
    }
    @file_put_contents($path, $data);
    return $path;
}

$c = cfg();
$url = gateway();
$token = (string) ($c['token'] ?? '');
$run = isset($_GET['run']);
$results = array();

if ($run && $token !== '' && $url !== '') {
    // ۱) اعتبار
    $results['credit'] = raw_call(array('command' => 'checkcredit'));

    // ۲) چهار روش ارسال فایل
    $png = make_png();
    $sampleName = 'invoice-sample.png';

    // ۲-الف: filehandle با نام واقعی + MIME درست (روش اصلی برنامه)
    $results['add_realname'] = raw_call(array('command' => 'addfile'), 'filehandle', $png, $sampleName, 'image/png');

    // ۲-ب: filehandle با نام temp (روش قبلی — برای مقایسه)
    if ($png !== '') {
        $tmpCopy = sys_get_temp_dir() . '/phpdiag' . mt_rand(1000, 9999) . '.tmp';
        @copy($png, $tmpCopy);
        $results['add_tempname'] = raw_call(array('command' => 'addfile'), 'filehandle', $tmpCopy,
            basename($tmpCopy), 'application/octet-stream');
        @unlink($tmpCopy);
    }

    // ۲-ج: با کلید FileHandle (حروف بزرگ) — برخی سرورها حساس‌اند
    $results['add_uppercase'] = raw_call(array('command' => 'addfile'), 'FileHandle', $png, $sampleName, 'image/png');

    // ۲-د: بدون MIME (نوع خودکار)
    $results['add_nomime'] = raw_call(array('command' => 'addfile'), 'filehandle', $png, $sampleName, '');
}
?>
<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>عیب‌یابی سرویس ابری — فاکتورخوان</title>
<style>
  body{margin:0;background:#0b0d12;color:#eef1f7;font-family:Tahoma,Vazirmatn,sans-serif;line-height:1.9;padding:18px}
  .wrap{max-width:1000px;margin:0 auto}
  h1{font-size:19px;margin:8px 0 18px}
  .card{background:#141824;border:1px solid #252c3b;border-radius:14px;padding:16px;margin-bottom:14px}
  .card h2{font-size:14px;margin:0 0 10px;color:#d4af37}
  table{width:100%;border-collapse:collapse;font-size:12.5px}
  td{padding:6px 4px;border-bottom:1px solid #222937;vertical-align:top}
  td:first-child{color:#98a2b8;width:38%}
  td:last-child{word-break:break-all}
  pre{background:#0a0d14;border:1px solid #252c3b;border-radius:10px;padding:12px;overflow:auto;
      white-space:pre-wrap;direction:ltr;text-align:left;font-size:12px;max-height:320px;margin:8px 0 0}
  .ok{color:#3ecf8e;font-weight:700}
  .bad{color:#f0616d;font-weight:700}
  .warn{color:#e8b64c;font-weight:700}
  .btn{display:inline-block;padding:11px 20px;border-radius:10px;background:linear-gradient(135deg,#e8d99a,#d4af37);
       color:#231c07;text-decoration:none;font-weight:700;font-size:14px}
  .hint{color:#98a2b8;font-size:12px}
  code{background:#0e121b;padding:1px 5px;border-radius:4px;direction:ltr;display:inline-block}
</style>
</head>
<body>
<div class="wrap">
  <h1>🔧 عیب‌یابی سرویس ابری — فاکتورخوان</h1>

  <div class="card">
    <h2>وضعیت</h2>
    <table>
      <tr><td>PHP</td><td class="<?= version_compare(PHP_VERSION, '7.4', '>=') ? 'ok' : 'bad' ?>"><?= h(PHP_VERSION) ?></td></tr>
      <tr><td>افزونهٔ curl</td><td class="<?= function_exists('curl_init') ? 'ok' : 'bad' ?>"><?= function_exists('curl_init') ? 'فعال' : 'غیرفعال' ?></td></tr>
      <tr><td>نسخهٔ curl</td><td><?= function_exists('curl_version') ? h((string) (curl_version()['version'] ?? '?')) : '—' ?></td></tr>
      <tr><td>CURLFile (آپلود فایل)</td><td class="<?= class_exists('CURLFile') ? 'ok' : 'warn' ?>"><?= class_exists('CURLFile') ? 'موجود' : 'موجود نیست — حالت قدیمی' ?></td></tr>
      <tr><td>توکن ثبت‌شده</td><td class="<?= $token !== '' ? 'ok' : 'bad' ?>"><?= $token !== '' ? 'بله (' . strlen($token) . ' کاراکتر)' : 'خیر — اول در index.php ثبت کنید' ?></td></tr>
      <tr><td>درگاه</td><td class="<?= $url !== '' ? 'ok' : 'bad' ?>"><?= $url !== '' ? 'معتبر (طول ' . strlen($url) . ')' : 'نامعتبر' ?></td></tr>
      <tr><td>بررسی گواهی TLS</td><td><?= (array_key_exists('verify_tls', $c) && !$c['verify_tls']) ? 'خاموش' : 'روشن' ?></td></tr>
    </table>
  </div>

  <?php if ($token === '' || $url === ''): ?>
    <div class="card"><p class="bad">ابتدا در index.php توکن را ثبت کنید، بعد به این صفحه برگردید.</p></div>
  <?php elseif (!$run): ?>
    <div class="card">
      <h2>شروع آزمون</h2>
      <p class="hint">چهار روش ارسال فایل امتحان می‌شود و پاسخ خام سرور نمایش داده می‌شود.
        توکن در هیچ خروجی چاپ نمی‌شود.</p>
      <p><a class="btn" href="?run=1">▶ اجرای آزمون</a></p>
    </div>
  <?php else: ?>

    <?php
    $labels = array(
        'credit' => '۱) تست اعتبار (checkcredit)',
        'add_realname' => '۲) ثبت فایل — نام واقعی + MIME درست (روش اصلی)',
        'add_tempname' => '۳) ثبت فایل — نام temp + MIME عمومی (روش قبلی)',
        'add_uppercase' => '۴) ثبت فایل — کلید FileHandle با حرف بزرگ',
        'add_nomime' => '۵) ثبت فایل — بدون تعیین MIME',
    );
    foreach ($labels as $key => $label):
        if (!isset($results[$key])) { continue; }
        $r = $results[$key];
        $hasToken = $r['json_ok'] && (
            isset($r['json_scrubbed']) && preg_match('/"FileToken"\s*:\s*"[^"]+"/i', $r['json_scrubbed'])
            || preg_match('/"Filetoken"\s*:\s*"[^"]+"/i', (string) ($r['body_raw'] ?? ''))
        );
        $status = $r['json_ok'] ? ($hasToken ? 'ok' : 'warn') : 'bad';
    ?>
      <div class="card">
        <h2><?= h($label) ?> — <span class="<?= $status ?>"><?=
          !$r['json_ok'] ? 'پاسخ JSON نبود' : ($hasToken ? 'توکن فایل دریافت شد ✓' : 'توکن فایل برنگشت') ?></span></h2>
        <table>
          <tr><td>کد HTTP</td><td class="<?= $r['http_status'] === 200 ? 'ok' : 'bad' ?>"><?= (int) $r['http_status'] ?></td></tr>
          <tr><td>curl خطا</td><td class="<?= $r['curl_errno'] ? 'bad' : 'ok' ?>"><?= (int) $r['curl_errno'] ?> <?= h((string) $r['curl_error']) ?></td></tr>
          <?php if (($r['file_size'] ?? 0) > 0): ?>
            <tr><td>فایل ارسالی</td><td><?= (int) $r['file_size'] ?> بایت — نام: <code><?= h((string) $r['file_name_sent']) ?></code> — MIME: <code><?= h((string) ($r['mime_sent'] ?: '(خودکار)')) ?></code></td></tr>
            <tr><td>حجم ارسال‌شده</td><td><?= (int) ($r['sent_bytes'] ?? 0) ?> بایت</td></tr>
          <?php endif; ?>
          <tr><td>پارامترهای ارسالی</td><td><code><?= h(implode(', ', (array) $r['field_names'])) ?></code></td></tr>
          <tr><td>طول پاسخ</td><td><?= (int) $r['body_len'] ?> بایت</td></tr>
        </table>
        <?php if (!empty($r['json_keys'])): ?>
          <p class="hint">کلیدهای پاسخ: <code><?= h(implode(', ', (array) $r['json_keys'])) ?></code></p>
        <?php endif; ?>
        <pre><?= h((string) ($r['json_scrubbed'] ?? $r['body_raw'])) ?></pre>
      </div>
    <?php endforeach; ?>

    <div class="card">
      <h2>نتیجه را برای پشتیبانی بفرستید</h2>
      <p class="hint">توکن در این صفحه پوشانده شده («TOKEN-HIDDEN»). می‌توانید کل این صفحه را
        (Ctrl+S) ذخیره کنید یا از همان کارتی که توکن فایل گرفته، اسکرین‌شات بفرستید.</p>
      <p class="hint">⚠️ پس از عیب‌یابی این فایل (<code>diag.php</code>) را حذف کنید.</p>
    </div>
  <?php endif; ?>
</div>
</body>
</html>
