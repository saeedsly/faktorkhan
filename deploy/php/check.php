<?php
/**
 * فاکتورخوان — بررسی سریع سرور (بدون توکن، بدون تغییر چیزی)
 * ==========================================================
 * اگر index.php صفحهٔ سفید یا خطای عجیب داد، این فایل را باز کنید:
 *     http://localhost/faktorkhan/check.php
 *
 * هیچ توکنی لازم نیست و هیچ فایلی تغییر نمی‌کند.
 */

declare(strict_types=1);

@ini_set('display_errors', '1');
error_reporting(E_ALL);

$checks = array();

function row(string $label, bool $ok, string $detail, bool $warnOnly = false): array
{
    return array('label' => $label, 'ok' => $ok, 'detail' => $detail, 'warn' => $warnOnly);
}

$checks[] = row('نسخهٔ PHP', version_compare(PHP_VERSION, '7.4', '>='), PHP_VERSION,
    version_compare(PHP_VERSION, '7.4', '<'));

$ext = array(
    'curl' => 'ارتباط با سرویس ابری',
    'json' => 'خواندن پاسخ سرویس',
    'mbstring' => 'متن فارسی (اختیاری)',
    'openssl' => 'اتصال HTTPS',
    'fileinfo' => 'تشخیص نوع فایل',
);
foreach ($ext as $name => $why) {
    $loaded = extension_loaded($name);
    $optional = in_array($name, array('mbstring', 'fileinfo'), true);
    $checks[] = row("افزونهٔ $name", $loaded, $loaded ? 'فعال' : 'غیرفعال — ' . $why, $optional);
}

$checks[] = row('آپلود فایل در PHP', (bool) ini_get('file_uploads'), (string) ini_get('file_uploads'));
$checks[] = row('حداکثر حجم آپلود', true, (string) ini_get('upload_max_filesize'), true);
$checks[] = row('حداکثر POST', true, (string) ini_get('post_max_size'), true);
$checks[] = row('حداکثر زمان اجرا', true, (string) ini_get('max_execution_time') . ' ثانیه', true);

/* دسترسی نوشتن */
$dir = __DIR__;
$checks[] = row('دسترسی نوشتن در پوشهٔ برنامه', is_writable($dir), $dir, false);

/* پوشه‌های کاری — برنامه خودش می‌سازد، ولی بهتر است از قبل بررسی شوند */
foreach (array('fk-jobs' => 'کارهای در جریان', 'fk-uploads' => 'فایل‌های موقت آپلود',
               'fk-sessions' => 'نشست‌ها', 'fk-invoices' => 'بایگانی فاکتورها') as $folder => $label) {
    $path = __DIR__ . '/' . $folder;
    $ready = is_dir($path) ? is_writable($path) : is_writable(__DIR__);
    $checks[] = row('پوشهٔ ' . $label . ' (' . $folder . ')',
        $ready,
        is_dir($path) ? (is_writable($path) ? 'آماده' : 'قابل نوشتن نیست') : 'خودکار ساخته می‌شود',
        true);
}
$tmpDir = (string) session_save_path();
$checks[] = row('مسیر ذخیرهٔ نشست', $tmpDir !== '', $tmpDir !== '' ? $tmpDir : 'پیش‌فرض PHP');

$cfgFile = __DIR__ . '/fk-config.json';
if (is_file($cfgFile)) {
    $cfg = json_decode((string) @file_get_contents($cfgFile), true);
    $hasToken = is_array($cfg) && !empty($cfg['token']);
    $hasPass = is_array($cfg) && !empty($cfg['password_hash']);
    $checks[] = row('فایل تنظیمات', true, 'موجود (مجوز ' . substr(sprintf('%o', fileperms($cfgFile)), -4) . ')');
    $checks[] = row('گذرواژه تنظیم شده', $hasPass, $hasPass ? 'بله' : 'خیر — در index.php بسازید');
    $checks[] = row('توکن ثبت شده', $hasToken, $hasToken ? 'بله (' . strlen((string) $cfg['token']) . ' کاراکتر)' : 'خیر');
} else {
    $checks[] = row('فایل تنظیمات', false, 'هنوز ساخته نشده — طبیعی است اگر اولین بار است', true);
}

/* توابع لازم */
$checks[] = row('تابع CURLFile', class_exists('CURLFile'), class_exists('CURLFile') ? 'موجود' : 'نیست (PHP قدیمی)');
$checks[] = row('تابع password_hash', function_exists('password_hash'), function_exists('password_hash') ? 'موجود' : 'نیست');
$checks[] = row('تابع session', function_exists('session_start'), function_exists('session_start') ? 'موجود' : 'نیست');

/* تست واقعی curl به یک آدرس عمومی (اگر مجاز باشد) */
$curlTest = array('ok' => false, 'detail' => 'اجرا نشد');
if (function_exists('curl_init')) {
    $ch = curl_init('https://www.google.com/generate_204');
    curl_setopt_array($ch, array(
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 8,
        CURLOPT_CONNECTTIMEOUT => 8,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => 0,
        CURLOPT_NOBODY => true,
    ));
    $r = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    $curlTest = array(
        'ok' => $r !== false && $code > 0,
        'detail' => $r === false ? ('خطا: ' . $err) : ('کد HTTP ' . $code),
    );
}
$checks[] = row('اتصال خروجی به اینترنت (curl)', $curlTest['ok'], $curlTest['detail'], true);

$fail = 0;
$warn = 0;
foreach ($checks as $c) {
    if (!$c['ok']) {
        if ($c['warn']) {
            $warn++;
        } else {
            $fail++;
        }
    }
}
?>
<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>بررسی سرور — فاکتورخوان</title>
<style>
  body{margin:0;background:#0b0d12;color:#eef1f7;font-family:Tahoma,Vazirmatn,sans-serif;line-height:1.9;padding:18px}
  .wrap{max-width:760px;margin:0 auto}
  h1{font-size:19px;margin:8px 0 16px}
  .card{background:#141824;border:1px solid #252c3b;border-radius:14px;padding:16px;margin-bottom:14px}
  table{width:100%;border-collapse:collapse;font-size:13px}
  td{padding:8px 4px;border-bottom:1px solid #222937}
  td:last-child{text-align:left;direction:ltr}
  .ok{color:#3ecf8e}.bad{color:#f0616d}.warn{color:#e8b64c}
  .sum{padding:12px 16px;border-radius:12px;font-weight:700;margin-bottom:14px}
  .sum.ok{background:rgba(62,207,142,.12);border:1px solid rgba(62,207,142,.4);color:#b8f2d6}
  .sum.bad{background:rgba(240,97,109,.12);border:1px solid rgba(240,97,109,.4);color:#ffc4ca}
  a{color:#d4af37}
</style>
</head>
<body>
<div class="wrap">
  <h1>🩺 بررسی سرور — فاکتورخوان</h1>

  <?php if ($fail === 0): ?>
    <div class="sum ok">همه‌چیز آماده است<?= $warn > 0 ? " (با $warn هشدار اختیاری)" : '' ?> — برو به <a href="index.php">صفحهٔ اصلی</a></div>
  <?php else: ?>
    <div class="sum bad"><?= $fail ?> مورد نیاز به اصلاح دارد<?= $warn > 0 ? " ($warn هشدار اختیاری)" : '' ?></div>
  <?php endif; ?>

  <div class="card">
    <table>
      <?php foreach ($checks as $c): ?>
        <tr>
          <td><?= htmlspecialchars($c['label'], ENT_QUOTES, 'UTF-8') ?></td>
          <td class="<?= $c['ok'] ? 'ok' : ($c['warn'] ? 'warn' : 'bad') ?>">
            <?= $c['ok'] ? '✓' : ($c['warn'] ? '!' : '✗') ?>
            <?= htmlspecialchars($c['detail'], ENT_QUOTES, 'UTF-8') ?>
          </td>
        </tr>
      <?php endforeach; ?>
    </table>
  </div>

  <div class="card" style="font-size:12.5px;color:#98a2b8">
    <p>اگر مرورگر پیام «پشتیبانی نمی‌شود» داد: <a href="browser-check.php">browser-check.php</a> — می‌گوید کدام قابلیت کم است.</p>
    <p>برای دیدن پاسخ کامل سرویس ابری: <a href="diag.php">diag.php</a></p>
    <p>برای بازگشت: <a href="index.php">index.php</a></p>
    <p class="warn">پس از پایان کار، فایل‌های check.php و diag.php را پاک کنید.</p>
  </div>
</div>
</body>
</html>
