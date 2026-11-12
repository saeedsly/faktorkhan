<?php
/**
 * فاکتورخوان — سرور داخلی PHP (بدون Apache / بدون WAMP)
 * ======================================================
 * اگر WAMP بالا نمی‌آید یا صفحهٔ سفید/چرخان می‌بینید، این روش از همه ساده‌تر است:
 *
 *  ۱) در پوشهٔ همین فایل، یک پنجرهٔ CMD باز کنید (Shift + کلیک راست → Open command window here)
 *  ۲) این دستور را بزنید:
 *
 *         "C:\wamp64\bin\php\php8.0.30\php.exe" -S 127.0.0.1:8080 -t .
 *
 *     (مسیر php.exe را از پوشهٔ wamp بردارید؛ یا اگر PHP در PATH است فقط بنویسید php)
 *  ۳) مرورگر را باز کنید:  http://127.0.0.1:8080/
 *
 * برخلاف Apache، اینجا نه .htaccess لازم است، نه تنظیمات، نه سرویس ویندوز.
 * برنامه فایل‌های حساس را خودش محافظت می‌کند.
 *
 * ⚠️ فقط برای استفادهٔ محلی. پورت را روی اینترنت باز نکنید.
 */

declare(strict_types=1);

$root = __DIR__;
$uri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$path = realpath($root . $uri) ?: '';

/* ── فایل‌های ممنوع ─────────────────────────────────────────── */
$name = basename($uri);
$ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));

/* ── پوشهٔ web/: فقط دارایی‌های رابط ───────────────────────── */
if (strpos($uri, '/web/') === 0) {
    $ok = preg_match('#^/web/(index\.html|app\.js|app\.css|assets/[A-Za-z0-9._/-]+\.(css|js|woff2?|ttf|svg|png|jpe?g|webp|ico))$#', $uri);
    if (!$ok) {
        http_response_code(403);
        header('Content-Type: text/plain; charset=utf-8');
        echo 'دسترسی به این فایل مجاز نیست.';
        return true;
    }
    return false;   /* بگذارید سرور داخلی خودش سرو کند */
}

if ($name === 'fk-config.json'
    || in_array($ext, array('log', 'ini', 'sql', 'md', 'bak', 'json', 'lock', 'txt'), true)
    || strpos($uri, '/fk-uploads/') === 0
    || strpos($uri, '/fk-sessions/') === 0
    || strpos($uri, '/fk-jobs/') === 0
    || strpos($uri, '/.') === 0) {
    http_response_code(403);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'دسترسی به این فایل مجاز نیست.';
    return true;
}

/* ── فایل واقعی (CSS/عکس/...) ─────────────────────────────── */
if ($path !== '' && is_file($path) && strpos($path, $root) === 0 && $ext !== 'php') {
    return false;   // بگذارید سرور داخلی خودش سرو کند
}

/* ── ورودی اصلی ────────────────────────────────────────────── */
if ($uri === '/' || $uri === '/index.php') {
    require $root . '/index.php';
    return true;
}

/* ── صفحهٔ عیب‌یابی (فقط از localhost) ─────────────────────── */
if (($uri === '/diag.php' || $uri === '/check.php') && is_file($root . $uri)) {
    $ip = $_SERVER['REMOTE_ADDR'] ?? '';
    if ($ip !== '127.0.0.1' && $ip !== '::1') {
        http_response_code(403);
        echo 'این صفحه فقط از همین کامپیوتر باز می‌شود.';
        return true;
    }
    require $root . $uri;
    return true;
}

http_response_code(404);
header('Content-Type: text/html; charset=utf-8');
echo '<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8">'
    . '<body style="font-family:Tahoma;background:#0b0d12;color:#eee;padding:40px;text-align:center">'
    . '<h2>صفحه پیدا نشد</h2>'
    . '<p style="color:#98a2b8">آدرس درست: <a style="color:#d4af37" href="/">http://127.0.0.1:8080/</a></p>'
    . '</body></html>';
return true;
