<?php
/**
 * فاکتورخوان — نسخهٔ PHP: نقطهٔ ورود
 * ===================================
 * همان پنل حرفه‌ای نسخهٔ پایتون، با بک‌اند PHP:
 * داشبورد، خوانش، فاکتورها، گزارش‌ها، اشتراک، قابلیت‌ها، پشتیبانی،
 * تنظیمات و پنل مدیریت (کاربران، طرح‌ها، کدهای اشتراک، سرویس ابری).
 *
 * ساختار درخواست‌ها:
 *   index.php          → پوستهٔ برنامه (SPA)
 *   api.php?action=…   → JSON API (همان قرارداد نسخهٔ پایتون)
 *   web/app.js|app.css → رابط، ساخته‌شده از همان `frontend/` نسخهٔ پایتون
 *
 * چرا SPA و نه صفحه‌های جدا؟ چون کاربر صریح گفت می‌خواهد «همان برنامهٔ
 * پایتون» باشد؛ و یک رابط برای دو بک‌اند یعنی هر اصلاح بصری یک بار
 * انجام می‌شود، نه دو بار (که قطعاً از هم دور می‌افتادند).
 *
 * مسیر فایل‌ها عمداً نسبی است تا در `C:\wamp64\www\faktorkhan\`
 * (زیرپوشه) هم کار کند، نه فقط ریشهٔ دامنه.
 */

declare(strict_types=1);

require_once __DIR__ . '/lib.php';
require_once __DIR__ . '/data.php';

@ini_set('display_errors', '0');      /* خطا به HTML نشت نکند؛ لاگ شود */
@date_default_timezone_set('Asia/Tehran');

/* ── اگر پوشهٔ رابط ساخته نشده، نسخهٔ ساده را نشان بده ──
   این حالت وقتی رخ می‌دهد که کاربر فقط چند فایل را کپی کرده باشد.
   «صفحهٔ سفید» بدترین پاسخ ممکن است؛ رابط ساده بهتر از هیچ. */
$webIndex = __DIR__ . '/web/index.html';
if (!is_file($webIndex)) {
    require __DIR__ . '/legacy.php';
    exit;
}

/* ── هدرهای امنیتی ── */
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: SAMEORIGIN');       /* در iframe پیش‌نمایش هم باز شود */
header('Referrer-Policy: no-referrer');
header('Cache-Control: no-store, must-revalidate');

/* نسخهٔ فایل‌ها را در نام می‌آوریم تا مرورگر پس از آپدیت، نسخهٔ
   قدیمیِ کش‌شده را نشان ندهد. این همان باگ «بعد از آپدیت صفحه سفید/قدیمی
   است» است که یک‌بار خیلی وقت گرفت. */
/* ── نسخهٔ دارایی ──
   اگر فایل را عوض کنید اما ?v همان بماند، مرورگر نسخهٔ کش‌شده را
   نشان می‌دهد و کاربر می‌گوید «هنوز خراب است». پس نسخه باید با تغییر
   محتوا عوض شود.

   ترتیب انتخاب:
     ۱) زمان تغییر فایل‌ها — سریع و دقیق. اگر app.js و app.css هر دو
        filemtime بدهند، همین کافی است.
     ۲) اثرانگشت محتوا — برای هاست‌هایی (و شبیه‌ساز php-wasm) که
        filemtime عدد نمی‌دهد. گران است، پس یک بار محاسبه و در
        fk-data/.asset-version ذخیره می‌شود؛ کلید کش شامل حجم
        فایل‌هاست تا بازسازی فایل، کلید را عوض کند. */
$assetVersion = '';
$jsFile = __DIR__ . '/web/app.js';
$cssFile = __DIR__ . '/web/app.css';
$jsTime = @filemtime($jsFile);
$cssTime = @filemtime($cssFile);

if ($jsTime && $cssTime) {
    $assetVersion = substr(md5($jsTime . '|' . $cssTime), 0, 8);
} else {
    /* کلید کش: حجم فایل‌ها؛ اگر فایل بازسازی شود حجم عوض می‌شود و
       اثرانگشت تازه محاسبه می‌شود. */
    $key = (int) @filesize($jsFile) . 'x' . (int) @filesize($cssFile);
    $stampFile = __DIR__ . '/fk-data/.asset-version';
    $cached = array();
    if (is_file($stampFile)) {
        $cached = (array) @json_decode((string) @file_get_contents($stampFile), true);
    }
    if (isset($cached['key'], $cached['v']) && $cached['key'] === $key && is_string($cached['v'])) {
        $assetVersion = $cached['v'];
    } else {
        $assetVersion = substr(md5($key . '|' . (string) @hash_file('md5', $jsFile) . '|' . (string) @hash_file('md5', $cssFile)), 0, 8);
        if (is_dir(__DIR__ . '/fk-data') || @mkdir(__DIR__ . '/fk-data', 0775, true)) {
            @file_put_contents($stampFile, json_encode(array('key' => $key, 'v' => $assetVersion)), LOCK_EX);
        }
    }
}
if ($assetVersion === '') {
    $assetVersion = '1';
}

$html = (string) file_get_contents($webIndex);
$html = str_replace('href="./app.css"', 'href="./web/app.css?v=' . $assetVersion . '"', $html);
$html = str_replace('src="./app.js"', 'src="./web/app.js?v=' . $assetVersion . '"', $html);
$html = str_replace('href="./assets/', 'href="./web/assets/', $html);

/* شناسهٔ نصب در تگ‌های meta: برای پشتیبانی و «کدام نسخه روی سرور است» */
$html = str_replace(
    '</head>',
    '<meta name="fk-engine" content="php">' . "\n"
    . '<meta name="fk-version" content="' . htmlspecialchars(FK_APP_VERSION ?? '1.0.0', ENT_QUOTES, 'UTF-8') . '">' . "\n"
    . '</head>',
    $html
);

echo $html;
