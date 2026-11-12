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
   ?v روی CSS و JS می‌نشیند تا مرورگر بعد از آپدیت، نسخهٔ کش‌شده را
   نشان ندهد. اگر نسخه عوض نشود، کاربر «هنوز خراب است» می‌بیند — این
   دقیقاً همان چیزی است که یک‌بار کل استایل را از بین برد.

   ⚠️ سه تلاش برای این کار شکست خورد و همه یک درس داشتند:
     ۱) filemtime → در بعضی محیط‌ها (و شبیه‌ساز php-wasm) عدد درست
        نمی‌دهد.
     ۲) حجم فایل → ویرایشی که حجم را عوض نکند، همان نسخه را می‌دهد.
     ۳) کش‌کردن هش در fk-data → روی هاست واقعی خوب بود، ولی هر لایهٔ
        کش خودش می‌تواند کهنه بماند و همان باگ را برگرداند.

   پس: بدون کش. یک md5 روی دو فایل چند صد کیلوبایتی، روی هر درخواست،
   هزینه‌اش چند میلی‌ثانیه است و در عوض هرگز کهنه نمی‌ماند. */
$jsFile = __DIR__ . '/web/app.js';
$cssFile = __DIR__ . '/web/app.css';
$assetVersion = '';
/* hash_file روی بعضی فایل‌سیستم‌ها (از جمله شبیه‌ساز) رشتهٔ خالی
   می‌دهد؛ در آن حالت خودمان محتوا را می‌خوانیم و هش می‌کنیم. */
$jsHash = @hash_file('md5', $jsFile);
if (!is_string($jsHash) || $jsHash === '') {
    $jsRaw = @file_get_contents($jsFile);
    $jsHash = is_string($jsRaw) && $jsRaw !== '' ? md5($jsRaw) : '';
}
if (is_string($jsHash) && $jsHash !== '') {
    $assetVersion = substr($jsHash, 0, 8);
} else {
    /* اگر خواندن فایل ممکن نشد، حداکثر تلاش: زمان تغییر */
    $jsTime = @filemtime($jsFile);
    $cssTime = @filemtime($cssFile);
    $assetVersion = ($jsTime || $cssTime) ? substr(md5((string) $jsTime . '|' . (string) $cssTime), 0, 8) : '';
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
