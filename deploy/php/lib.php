<?php
/**
 * فاکتورخوان — هستهٔ مشترک نسخهٔ PHP
 * ====================================
 * توابع پیکربندی، امنیت، ارتباط با سرویس ابری و کارهای پس‌زمینه.
 *
 * نکتهٔ مهم دربارهٔ کارهای پس‌زمینه:
 *   تبدیل OCR ممکن است دقیقه‌ها طول بکشد. اگر همهٔ این کار در یک درخواست
 *   HTTP انجام شود:
 *     • سرور داخلی PHP تک‌رشته‌ای است و تا پایان کار، کل سایت قفل می‌شود،
 *     • مرورگر/پروکسی تایم‌اوت می‌کند و «صفحهٔ سفید» می‌شود،
 *     • هر تلاش دوباره، یک فایل جدید روی سرور ابری ثبت می‌کند (مصرف بی‌مورد توکن).
 *   راه‌حل: هر فایل یک «کار» (job) می‌شود؛ ثبت فایل و شروع تبدیل در همان
 *   درخواست انجام می‌شود (کمتر از چند ثانیه) و پیگیری وضعیت در درخواست‌های
 *   کوتاه بعدی. مرورگر با AJAX هر ۳ ثانیه وضعیت را می‌پرسد.
 */
declare(strict_types=1);

/*
 * نکتهٔ حیاتی: declare(strict_types=1) باید اولین «دستور» فایل باشد.
 * اگر require_once یا هر دستور دیگری قبل از آن بیاید، PHP با خطای
 * «strict_types declaration must be the very first statement» متوقف می‌شود.
 * (کامنت مجاز است؛ دستور نه. ترتیب این دو خط را عوض نکنید.)
 */
require_once __DIR__ . '/engine.php';   // موتور پاک‌سازی و فهم متن فاکتور

const FK_CONFIG = __DIR__ . '/fk-config.json';
const FK_JOBS = __DIR__ . '/fk-jobs';
const FK_UPLOADS = __DIR__ . '/fk-uploads';
const FK_LOCK = __DIR__ . '/fk-lock.json';

/* ══════════════════════ محدودیت تلاش ورود ══════════════════════
 *
 * بدون این، هر کسی می‌تواند روی اینترنت گذرواژه را بی‌نهایت امتحان کند.
 * sleep داخل کد جلوی حملهٔ موازی را نمی‌گیرد (مهاجم ۵۰ درخواست هم‌زمان
 * می‌فرستد و ۵۰ هسته‌ی PHP همه با هم می‌خوابند؛ یا اصلاً بی‌خواب).
 *
 * راهکار: شمارندهٔ شکست به ازای «اثر انگشت دستگاه» در فایل، با پنجرهٔ
 * زمانی. کاربر واقعی که گذرواژه را اشتباه می‌زند جریمه نمی‌شود؛ فقط
 * تلاش‌های پی‌درپی بلوکه می‌شوند.
 *
 * IP تنها کافی نیست: چند کاربر پشت یک NAT دفتر کار می‌کنند. اما برای
 * ورود، IP هم مهم است — چون حدس گذرواژه معمولاً از یک منبع می‌آید.
 * پس هر دو کلید نگه داشته می‌شوند.
 */

const FK_LOGIN_WINDOW = 900;      // ۱۵ دقیقه
const FK_LOGIN_MAX    = 8;        // حداکثر تلاش ناموفق در پنجره

/** مسیر فایل شمارندهٔ تلاش‌های ناموفق */
function login_attempts_file(): string
{
    return __DIR__ . '/fk-login-attempts.json';
}

/** کلید دستگاه: IP + اثر انگشت مرورگر (بدون ذخیرهٔ چیز حساس) */
function login_key(): string
{
    $ip = (string) ($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0');
    $ua = (string) ($_SERVER['HTTP_USER_AGENT'] ?? '');
    $lang = (string) ($_SERVER['HTTP_ACCEPT_LANGUAGE'] ?? '');
    return substr(hash('sha256', $ip . '|' . $ua . '|' . $lang), 0, 20);
}

/** خواندن امن شمارنده‌ها (پاک‌سازی قدیمی‌ها) */
function login_attempts_load(): array
{
    $raw = @file_get_contents(login_attempts_file());
    $data = $raw ? json_decode($raw, true) : array();
    if (!is_array($data)) {
        return array();
    }
    $now = time();
    $clean = array();
    foreach ($data as $k => $row) {
        if (!is_array($row)) {
            continue;
        }
        if (($now - (int) ($row['first'] ?? 0)) < FK_LOGIN_WINDOW) {
            $clean[$k] = $row;
        }
    }
    return $clean;
}

/**
 * آیا این دستگاه باید فعلاً مسدود باشد؟
 * @return array [مسدود؟, ثانیهٔ باقی‌مانده]
 */
function login_blocked(): array
{
    $row = login_attempts_load()[login_key()] ?? null;
    if (!is_array($row)) {
        return array(false, 0);
    }
    if ((int) ($row['count'] ?? 0) < FK_LOGIN_MAX) {
        return array(false, 0);
    }
    $left = FK_LOGIN_WINDOW - (time() - (int) ($row['first'] ?? 0));
    return array($left > 0, max(0, $left));
}

/** ثبت یک تلاش ناموفق */
function login_fail(): void
{
    $key = login_key();
    $all = login_attempts_load();
    $row = $all[$key] ?? array('first' => time(), 'count' => 0);
    $row['count'] = (int) $row['count'] + 1;
    $row['last'] = time();
    $all[$key] = $row;
    @file_put_contents(login_attempts_file(),
        json_encode($all, JSON_UNESCAPED_UNICODE), LOCK_EX);
    @chmod(login_attempts_file(), 0600);
}

/** پاک‌کردن شمارنده بعد از ورود موفق */
function login_success(): void
{
    $key = login_key();
    $all = login_attempts_load();
    if (isset($all[$key])) {
        unset($all[$key]);
        @file_put_contents(login_attempts_file(),
            json_encode($all, JSON_UNESCAPED_UNICODE), LOCK_EX);
    }
}

/* ══════════════════════════ مبنا ══════════════════════════ */

function is_https(): bool
{
    return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
}

function start_session(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    $savePath = __DIR__ . '/fk-sessions';
    if (!is_dir($savePath)) {
        @mkdir($savePath, 0700, true);
    }
    /*
     * نکته‌ای که یک بار نشست را کامل از کار انداخت:
     *   session_save_path($path) در صورت موفقیت رشتهٔ خالی برمی‌گرداند،
     *   نه مسیر جدید. نسخهٔ قبلی نتیجهٔ همین تابع را دوباره
     *   session_save_path() می‌خواند و چون '' بود، نتیجه می‌گرفت مسیر
     *   عوض نشده و به پوشهٔ موقت سیستم سقوط می‌کرد؛ آن‌جا هم مرورگر
     *   کوکی نمی‌فرستاد و «تنظیم گذرواژه» بی‌اثر می‌شد.
     *
     * حالا مقدار بازگشتی را نادیده می‌گیریم و خودِ مسیر را می‌سنجیم.
     */
    $configured = false;
    if (is_dir($savePath) && is_writable($savePath)) {
        @session_save_path($savePath);
        $configured = (@session_save_path() === $savePath);
    }
    if (!$configured) {
        $tmp = sys_get_temp_dir();
        if ($tmp !== '' && @is_writable($tmp)) {
            @session_save_path($tmp);
        }
    }
    /*
     * نام نشست *قبل* از هر خروجی تنظیم شود.
     *
     * باگی که یک بار کل ورود را روی XAMPP از کار انداخت: اگر حتی یک
     * بایت خروجی (حتی یک خط خالی بعد از `?>` در یک فایل includeشده)
     * ارسال شده باشد، `session_name()` و `session_start()` با هشدار
     * «headers already sent» رد می‌شوند. نتیجه: کاربر وارد می‌شود،
     * صفحهٔ بعد او را ناشناس می‌بیند.
     *
     * راه‌حل: هر خروجیِ معلق را با ob_start بفشاریم و نام نشست را
     * پیش از باز کردن بافر تنظیم کنیم — این‌طور حتی اگر فایلی خط جدید
     * اضافه فرستاده باشد، نشست سالم بالا می‌آید.
     */
    if (ob_get_level() === 0 && (PHP_SAPI === 'apache2handler' || PHP_SAPI === 'fpm-fcgi' || PHP_SAPI === 'cli-server' || PHP_SAPI === 'litespeed')) {
        @ob_start();
    }
    if (session_name() !== 'fksid') {
        @session_name('fksid');
    }
    $cookieOk = false;
    if (PHP_VERSION_ID >= 70300 && session_status() === PHP_SESSION_NONE) {
        $cookieOk = @session_set_cookie_params(array(
            'lifetime' => 0, 'path' => '/', 'httponly' => true,
            'samesite' => 'Lax', 'secure' => is_https(),
        ));
    }
    if (!$cookieOk && session_status() === PHP_SESSION_NONE) {
        @session_set_cookie_params(0, '/; samesite=Lax', '', is_https(), true);
    }
    @session_start();
}

function csrf_token(): string
{
    start_session();
    if (empty($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(24));
    }
    return $_SESSION['csrf'];
}

function csrf_ok(?string $token): bool
{
    start_session();
    return is_string($token) && !empty($_SESSION['csrf']) && hash_equals($_SESSION['csrf'], $token);
}

function is_logged_in(): bool
{
    start_session();
    return !empty($_SESSION['auth']) && $_SESSION['auth'] === true;
}

function h(?string $v): string
{
    return htmlspecialchars((string) $v, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function mb_strlen_safe(?string $s): int
{
    if (function_exists('mb_strlen')) {
        return mb_strlen((string) $s, 'UTF-8');
    }
    return strlen((string) $s);
}

function mb_substr_safe(?string $s, int $start, ?int $len = null): string
{
    if (function_exists('mb_substr')) {
        return $len === null ? mb_substr((string) $s, $start) : mb_substr((string) $s, $start, $len);
    }
    return $len === null ? substr((string) $s, $start) : substr((string) $s, $start, $len);
}

/* ══════════════════════ پیکربندی ══════════════════════ */

function load_config(): array
{
    if (!is_file(FK_CONFIG)) {
        return array();
    }
    $raw = @file_get_contents(FK_CONFIG);
    if ($raw === false) {
        return array();
    }
    $d = json_decode($raw, true);
    return is_array($d) ? $d : array();
}

function save_config(array $cfg): bool
{
    $json = json_encode($cfg, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    if ($json === false) {
        return false;
    }
    $tmp = FK_CONFIG . '.tmp';
    if (@file_put_contents($tmp, $json, LOCK_EX) === false) {
        return false;
    }
    @chmod($tmp, 0600);
    if (!@rename($tmp, FK_CONFIG)) {
        @unlink($tmp);
        return false;
    }
    return true;
}

function password_is_set(): bool
{
    $c = load_config();
    return !empty($c['password_hash']);
}

function token_is_set(): bool
{
    $c = load_config();
    return !empty($c['token']);
}

function mask(?string $value): string
{
    $value = (string) $value;
    if ($value === '') {
        return '';
    }
    if (strlen($value) <= 12) {
        return str_repeat('•', 12);
    }
    return str_repeat('•', 12) . substr($value, -4);
}

/* ══════════════════════ درگاه ابری ══════════════════════ */

function gateway_url(): string
{
    $c = load_config();
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

/* ═══════════════ موتور دوم: خوانش با هوش مصنوعی بینایی-زبانی ═══════════════ */
/*
 * چرا؟
 *   موتور اول (سرویس ابری) روی فاکتور چاپی خوب است ولی روی دست‌نویس
 *   و عکس کج/تار ضعیف می‌شود. مدل‌های بینایی-زبانی روی همان
 *   تصویر، متن را تمیزتر و با فهم ساختار می‌خوانند.
 *
 * قاعده‌های محصول که این‌جا رعایت شده:
 *   • نام ارائه‌دهنده هرگز در صفحه دیده نمی‌شود؛ فقط «موتور هوش مصنوعی».
 *   • کلید فقط سمت سرور است و مثل توکن اصلی پوشانده می‌شود.
 *   • این موتور کاملاً اختیاری است: اگر کلید نباشد، همه‌چیز مثل قبل کار می‌کند.
 *
 * پروتکل: یک درخواست JSON ساده (نه مولتی‌پارت) با تصویر Base64.
 */

/** آدرس پیش‌فرض موتور دوم — مبهم‌سازی‌شده (XOR با 0x5A) */
function ai_engine_url(): string
{
    $c = load_config();
    if (!empty($c['ai_gateway'])) {
        return (string) $c['ai_gateway'];
    }
    $raw = base64_decode('Mi4uKilgdXU9PzQ/KDsuMyw/Njs0PS87PT90PTU1PTY/OyozKXQ5NTd1LGs4Py47dTc1Pj82KXU9PzczNDN3aHRqdzw2OykyYD0/ND8oOy4/GTU0Lj80Lg==', true);
    if ($raw === false) {
        return '';
    }
    $out = '';
    for ($i = 0, $n = strlen($raw); $i < $n; $i++) {
        $out .= chr(ord($raw[$i]) ^ 0x5A);
    }
    return $out;
}

/**
 * فراخوانی موتور هوش مصنوعی روی یک تصویر/PDF.
 * تصویر به Base64 می‌رود داخل JSON و متن خوانده‌شده برمی‌گردد.
 *
 * @return array{ok:bool,text:string,message:string,code:string}
 */
function ai_read_image(string $filePath, string $mime, string $kind = 'invoice'): array
{
    $cfg = load_config();
    $key = trim((string) ($cfg['ai_key'] ?? ''));
    if ($key === '') {
        return array('ok' => false, 'text' => '', 'code' => 'NoKey',
            'message' => 'کلید موتور هوش مصنوعی ثبت نشده است.');
    }
    $url = ai_engine_url();
    if ($url === '') {
        return array('ok' => false, 'text' => '', 'code' => 'NoGateway',
            'message' => 'آدرس موتور هوش مصنوعی تنظیم نشده است.');
    }
    if (!is_file($filePath)) {
        return array('ok' => false, 'text' => '', 'code' => 'ReadFile',
            'message' => 'فایل روی سرور پیدا نشد.');
    }
    $size = (int) @filesize($filePath);
    if ($size <= 0) {
        return array('ok' => false, 'text' => '', 'code' => 'EmptyFile',
            'message' => 'فایل خالی است.');
    }
    /* تصویرهای بزرگ را کوچک می‌کنیم تا درخواست سریع و ارزان بماند */
    $raw = @file_get_contents($filePath);
    if ($raw === false) {
        return array('ok' => false, 'text' => '', 'code' => 'ReadFile',
            'message' => 'خواندن فایل ممکن نشد.');
    }
    $mime = $mime !== '' ? $mime : 'image/jpeg';

    /*
     * دستور خوانش. مهم است که خروجی «فقط متن» باشد بدون حرف اضافه،
     * چون همین متن مستقیم در کادر صفحه و در فاکتور می‌نشیند.
     */
    if ($kind === 'invoice') {
        $prompt = "این تصویر یک فاکتور یا رسید است. متن آن را دقیق و کامل به فارسی بازنویسی کن.\n"
            . "قواعد:\n"
            . "۱) فقط متن تصویر را بنویس؛ هیچ توضیح، مقدمه یا جملهٔ اضافه‌ای اضافه نکن.\n"
            . "۲) ترتیب سطرها را همان‌طور که در تصویر است نگه دار.\n"
            . "۳) هر ردیف جدول را در یک خط بنویس و ستون‌ها را با نویسهٔ Tab از هم جدا کن.\n"
            . "۴) اعدادی که در تصویر هست عیناً همان‌طور بنویس (فارسی/لاتین را تغییر نده).\n"
            . "۵) اگر بخشی ناخوانا بود، همان‌جا «[ناخوانا]» بنویس و از خودت چیزی نساز.\n"
            . "۶) اگر در تصویر هیچ متنی نیست، فقط بنویس: خالی";
    } else {
        $prompt = "متن داخل این تصویر را دقیق و کامل بازنویسی کن. "
            . "فقط متن را بنویس، بدون هیچ توضیح اضافه. ترتیب سطرها را حفظ کن.";
    }

    $payload = array(
        'contents' => array(array(
            'parts' => array(
                array('text' => $prompt),
                array('inline_data' => array('mime_type' => $mime, 'data' => base64_encode($raw))),
            ),
        )),
        'generationConfig' => array('temperature' => 0.1, 'maxOutputTokens' => 8192),
    );
    $json = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($json === false) {
        return array('ok' => false, 'text' => '', 'code' => 'Encode',
            'message' => 'آماده‌سازی درخواست ناموفق بود.');
    }

    $ch = curl_init();
    $opts = array(
        'URL' => $url . '?key=' . urlencode($key),
        'POST' => true,
        'POSTFIELDS' => $json,
        'RETURNTRANSFER' => true,
        'TIMEOUT' => 120,
        'CONNECTTIMEOUT' => 10,
        'SSL_VERIFYPEER' => true,
        'SSL_VERIFYHOST' => 2,
        'HTTPHEADER' => array('Content-Type: application/json', 'Expect:'),
        'FOLLOWLOCATION' => false,
        'USERAGENT' => 'FactorKhan-PHP/1.3',
    );
    foreach ($opts as $name => $value) {
        $const = 'CURLOPT_' . $name;
        if (defined($const)) {
            @curl_setopt($ch, constant($const), $value);
        }
    }
    $body = curl_exec($ch);
    $errno = curl_errno($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($body === false) {
        return array('ok' => false, 'text' => '', 'code' => 'Network',
            'message' => $errno === 28
                ? 'موتور هوش مصنوعی در زمان مقرر پاسخ نداد.'
                : 'ارتباط با موتور هوش مصنوعی برقرار نشد (کد ' . $errno . ').');
    }
    $data = json_decode((string) $body, true);
    if (!is_array($data)) {
        return array('ok' => false, 'text' => '', 'code' => 'BadResponse',
            'message' => 'پاسخ موتور هوش مصنوعی قابل خواندن نبود (کد ' . $status . ').');
    }
    /* متن را از ساختار پاسخ بیرون بکش */
    $text = '';
    if (isset($data['candidates'][0]['content']['parts']) && is_array($data['candidates'][0]['content']['parts'])) {
        foreach ($data['candidates'][0]['content']['parts'] as $part) {
            if (isset($part['text']) && is_scalar($part['text'])) {
                $text .= (string) $part['text'];
            }
        }
    }
    $text = trim($text);
    if ($text === '') {
        /* کد خطا ممکن است در HTTP یا داخل بدنه باشد — هر دو را ببین */
        $errCode = (int) ($data['error']['code'] ?? ($data['error']['status'] ?? 0));
        $reason = (string) ($data['candidates'][0]['finishReason'] ?? ($data['error']['message'] ?? ''));
        $msg = 'موتور هوش مصنوعی متنی برنگرداند.';
        if ($status === 400 || $errCode === 400) {
            $msg = 'درخواست رد شد؛ کلید یا تنظیمات را بررسی کنید.';
        } elseif ($status === 401 || $status === 403 || in_array($errCode, array(401, 403), true)) {
            $msg = 'کلید موتور هوش مصنوعی معتبر نیست یا اجازهٔ دسترسی ندارد.';
        } elseif ($status === 429 || $errCode === 429 || preg_match('/quota|rate ?limit/i', $reason)) {
            $msg = 'سهمیهٔ رایگان موتور هوش مصنوعی تمام شده است؛ بعداً امتحان کنید یا کلید دیگری بگذارید.';
        } elseif ($reason !== '') {
            $msg .= ' (' . scrub($reason) . ')';
        }
        return array('ok' => false, 'text' => '', 'code' => 'NoText', 'message' => $msg);
    }
    if (preg_match('/^\s*خالی\s*$/u', $text)) {
        return array('ok' => false, 'text' => '', 'code' => 'Empty',
            'message' => 'موتور هوش مصنوعی در این تصویر متنی پیدا نکرد.');
    }
    return array('ok' => true, 'text' => $text, 'code' => 'Done', 'message' => '');
}

function scrub(string $text, string $token = ''): string
{
    if ($token === '') {
        $token = (string) (load_config()['token'] ?? '');
    }
    if ($token !== '') {
        $text = str_replace($token, '«مخفی»', $text);
        if (strlen($token) > 6) {
            $text = str_replace(substr($token, 0, 6), '«مخفی»', $text);
        }
    }
    return mb_substr_safe($text, 0, 500);
}

/**
 * فراخوانی درگاه سرویس ابری.
 * @return array{ok:bool,data:array,message:string,code:string}
 */
function call_gateway(array $fields, ?string $filePath = null, ?string $fileMime = null, string $fileName = '', ?int $timeoutOverride = null): array
{
    $cfg = load_config();
    $url = gateway_url();
    $token = (string) ($cfg['token'] ?? '');
    $timeout = $timeoutOverride !== null ? $timeoutOverride : (int) ($cfg['timeout'] ?? 180);
    $verify = array_key_exists('verify_tls', $cfg) ? (bool) $cfg['verify_tls'] : true;

    if ($url === '') {
        return array('ok' => false, 'data' => array(), 'message' => 'درگاه تنظیم نشده است.', 'code' => 'NoGateway');
    }
    if ($token === '') {
        return array('ok' => false, 'data' => array(), 'message' => 'ابتدا توکن را ثبت کنید.', 'code' => 'NoToken');
    }
    if (!function_exists('curl_init')) {
        return array('ok' => false, 'data' => array(), 'message' => 'افزونهٔ curl در PHP فعال نیست.', 'code' => 'NoCurl');
    }

    $payload = $fields;
    $payload['token'] = $token;
    if ($filePath !== null) {
        $uploadMethod = strtolower((string) ($cfg['upload_method'] ?? 'multipart'));
        $safeName = $fileName ?: basename($filePath);
        if (!empty($cfg['simple_filename'])) {
            $e2 = pathinfo($safeName, PATHINFO_EXTENSION);
            $safeName = 'document' . ($e2 ? '.' . $e2 : '');
        }
        if ($uploadMethod === 'base64') {
            $raw = @file_get_contents($filePath);
            if ($raw === false) {
                return array('ok' => false, 'data' => array(), 'message' => 'خواندن فایل ممکن نشد.', 'code' => 'ReadFile');
            }
            $payload['filehandle'] = base64_encode($raw);
            $payload['filename'] = $safeName;
            $payload['filemime'] = $fileMime ?: 'application/octet-stream';
        } elseif (class_exists('CURLFile')) {
            /*
             * نکتهٔ آزمون واقعی سرویس:
             *   نام/پسوند واقعی + MIME درست  → موفق
             *   نام temp (phpdiag2793.tmp) + application/octet-stream → خطای ۵۰۰ سرویس
             *   نام واقعی + بدون MIME        → موفق
             * پس MIME نامشخص را «حذف» می‌کنیم، نه اینکه octet-stream بفرستیم.
             */
            if ($fileMime !== '' && $fileMime !== 'application/octet-stream') {
                $payload['filehandle'] = new CURLFile($filePath, $fileMime, $safeName);
            } else {
                // سازندهٔ دوپارامتری: cURL نوع را خودش حدس می‌زند
                $payload['filehandle'] = new CURLFile($filePath, '', $safeName);
            }
        } else {
            $payload['filehandle'] = '@' . $filePath . ';filename=' . $safeName
                . ($fileMime !== '' && $fileMime !== 'application/octet-stream' ? ';type=' . $fileMime : '');
        }
    }

    $ch = curl_init();

    /*
     * همهٔ گزینه‌ها با نام رشته‌ای تنظیم می‌شوند تا روی نسخه‌های قدیمی
     * PHP/curl (ویندوز ۷) هیچ ثابتی تعریف‌نشده باعث خطای مرگبار نشود.
     */
    $opts = array(
        'URL' => $url,
        'POST' => true,
        'POSTFIELDS' => $payload,
        'RETURNTRANSFER' => true,
        'TIMEOUT' => $timeout,
        'CONNECTTIMEOUT' => 10,
        'SSL_VERIFYPEER' => $verify,
        'SSL_VERIFYHOST' => $verify ? 2 : 0,
        'FOLLOWLOCATION' => false,
        'USERAGENT' => 'FactorKhan-PHP/1.2',
        /* اتصال را بازاستفاده کن */
        'FRESH_CONNECT' => false,
        'FORBID_REUSE' => false,
        /* بدون انتظار «Expect: 100-continue» (تا ۱ ثانیه صرفه‌جویی در هر تماس) */
        'HTTPHEADER' => array('Expect:'),
        /* کش DNS تا هر تماس دوباره نام را resolve نکند */
        'DNS_CACHE_TIMEOUT' => 300,
    );
    foreach ($opts as $name => $value) {
        $const = 'CURLOPT_' . $name;
        if (defined($const)) {
            @curl_setopt($ch, constant($const), $value);
        }
    }
    /* فقط اگر curl واقعاً پشتیبانی کند */
    if (defined('CURLOPT_TCP_FASTOPEN')) {
        @curl_setopt($ch, CURLOPT_TCP_FASTOPEN, true);
    }
    if (!class_exists('CURLFile') && defined('CURLOPT_SAFE_UPLOAD')) {
        curl_setopt($ch, CURLOPT_SAFE_UPLOAD, false);
    }
    $body = curl_exec($ch);
    $err = curl_error($ch);
    $errno = curl_errno($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($body === false) {
        if ($errno === 28) {
            $msg = 'سرویس ابری در زمان مقرر پاسخ نداد (فایل بزرگ یا اینترنت کند).';
        } elseif ($errno === 60 || $errno === 51 || stripos($err, 'certificate') !== false) {
            /* خطای گواهی TLS — به‌جای خاموش‌کردن امنیت، راه درست را بگو */
            $msg = 'گواهی امنیتی سرویس ابری تأیید نشد (کد ' . $errno . '). '
                . 'ساعت ویندوز را درست کنید؛ اگر حل نشد، در php.ini مسیر curl.cainfo را '
                . 'به فایل cacert.pem معتبر بدهید. '
                . '(خاموش‌کردن بررسی گواهی توصیه نمی‌شود چون رمز و توکن روی شبکه لو می‌رود.)';
        } else {
            $msg = 'ارتباط با سرویس ابری برقرار نشد: ' . scrub($err, $token);
        }
        return array('ok' => false, 'data' => array(), 'message' => $msg, 'code' => 'Network');
    }
    $data = json_decode((string) $body, true);
    $isObjectShape = is_array($data) && ($data === array() || array_keys($data) !== range(0, count($data) - 1));
    if (!$isObjectShape) {
        $snippet = trim(scrub(mb_substr_safe((string) $body, 0, 200), $token));
        return array('ok' => false, 'data' => array(),
            'message' => 'پاسخ سرویس ابری قابل تفسیر نیست (کد ' . $status . ').'
                . ($snippet !== '' ? ' پاسخ: ' . $snippet : ' پاسخ خالی بود.'),
            'code' => 'BadResponse');
    }
    $st = (string) ($data['Status'] ?? '');
    $errors = array(
        'FileCorrupted' => 'فایل ارسالی خراب، غیرمجاز یا رمزدار است.',
        'NoEnoughCredit' => 'اعتبار سرویس ابری کافی نیست.',
        'UploadFailed' => 'خطا در بارگذاری فایل به سرویس ابری.',
        'TokenNotFound' => 'فایل یا توکن یافت نشد.',
        'MethodNotAllowed' => 'این روش تبدیل برای فایل انتخاب‌شده مجاز نیست.',
        'FileDeletedFromServer' => 'فایل از سرور ابری حذف شده است.',
        'ConvertError' => 'خطا در تبدیل فایل.',
        'IPError' => 'IP این سرور مجاز نیست.',
        'UnkwonURL' => 'لینک ارسالی معتبر نیست.',
        'UnknowURL' => 'لینک ارسالی معتبر نیست.',
        'UnknowMethod' => 'روش تبدیل نامعتبر است.',
        /* سرویس با این وضعیت می‌گوید «پارامتری را قبول نکردم» — پیام خودش
           (مثلاً «method is required») باید به کاربر برسد، وگرنه عیب‌یابی
           غیرممکن است. */
        'InvalidParams' => 'سرویس ابری پارامترهای درخواست را نپذیرفت.',
        'InvalidParameter' => 'سرویس ابری پارامترهای درخواست را نپذیرفت.',
        'BadRequest' => 'درخواست به سرویس ابری ناقص بود.',
        '404' => 'اطلاعات ارسالی سرویس ابری درست نبود (کد ۴۰۴).',
        '500' => 'خطای داخلی سرویس ابری (کد ۵۰۰) — گاهی با تلاش دوباره حل می‌شود.',
    );
    if (isset($errors[$st])) {
        $msg = $errors[$st];
        $serviceMsg = trim((string) ($data['Message'] ?? $data['message'] ?? $data['Error'] ?? ''));
        if ($serviceMsg !== '') {
            $msg .= ' (پاسخ سرویس: ' . scrub($serviceMsg, $token) . ')';
        }
        if (stripos($st, 'invalid') === 0 || strcasecmp($st, 'BadRequest') === 0) {
            /* بگو چه پارامترهایی فرستاده شد تا بشود فهمید کدام را نمی‌پذیرد */
            $sent = array();
            foreach (array_keys($fields) as $k) {
                $sent[] = $k;
            }
            $msg .= ' — پارامترهای ارسالی: ' . implode(', ', $sent);
        }
        return array('ok' => false, 'data' => $data, 'message' => $msg, 'code' => $st);
    }
    /*
     * «Data Not Found Yet» در مستندات جزو خطاها فهرست شده، ولی در عمل یعنی
     * «هنوز آماده نیست». اگر آن را خطای قطعی بگیریم، کارِ در حال پردازش
     * بی‌دلیل می‌میرد و توکن مصرف‌شده هدر می‌رود.
     */
    if (stripos($st, 'not found') !== false || stripos($st, 'notfound') !== false) {
        return array('ok' => true, 'data' => $data, 'message' => '', 'code' => 'NotReady');
    }
    if (strtolower($st) === 'error' || strtolower($st) === 'failed') {
        return array('ok' => false, 'data' => $data,
            'message' => scrub((string) ($data['Message'] ?? 'خطای نامشخص'), $token), 'code' => 'Error');
    }
    return array('ok' => true, 'data' => $data, 'message' => '', 'code' => $st);
}

/**
 * خواندن یک کلید از پاسخ JSON با تحمل نویسه‌های اضافی.
 * سرویس واقعی کلید را با فاصله برمی‌گرداند:  " FileToDownload "
 * (در مستندات هم با فاصله آمده) — تطبیق دقیق شکست می‌خورد.
 */
function pick_key(array $data, array $candidates): string
{
    /* ۱) تطبیق دقیق */
    foreach ($candidates as $k) {
        if (isset($data[$k]) && is_scalar($data[$k])) {
            $v = trim((string) $data[$k]);
            if ($v !== '') {
                return $v;
            }
        }
    }
    /* ۲) تطبیق نرم: فاصله/زیرخط/حروف بزرگ را نادیده بگیر */
    $norm = static function (string $s): string {
        return strtolower(preg_replace('/[\s_\-]/', '', $s));
    };
    $wanted = array_map($norm, $candidates);
    foreach ($data as $k => $v) {
        if (!is_scalar($v)) {
            continue;
        }
        if (in_array($norm((string) $k), $wanted, true)) {
            $s = trim((string) $v);
            if ($s !== '') {
                return $s;
            }
        }
    }
    return '';
}

function find_file_token(array $data): string
{
    $candidates = array('FileToken', 'Filetoken', 'filetoken', 'fileToken', 'File_Token');
    foreach ($candidates as $k) {
        if (!empty($data[$k]) && is_scalar($data[$k])) {
            return trim((string) $data[$k]);
        }
    }
    foreach ($data as $v) {
        if (is_array($v)) {
            $found = find_file_token($v);
            if ($found !== '') {
                return $found;
            }
        }
    }
    return '';
}

/** @return array{ok:bool,body:string,suffix:string,message:string} */
function download_output(string $url): array
{
    $cfg = load_config();
    $verify = array_key_exists('verify_tls', $cfg) ? (bool) $cfg['verify_tls'] : true;
    $parts = parse_url($url);
    $scheme = strtolower((string) ($parts['scheme'] ?? ''));
    if (!in_array($scheme, array('http', 'https'), true) || empty($parts['host'])) {
        return array('ok' => false, 'body' => '', 'suffix' => '', 'message' => 'لینک خروجی معتبر نیست.');
    }
    if (!function_exists('curl_init')) {
        return array('ok' => false, 'body' => '', 'suffix' => '', 'message' => 'افزونهٔ curl فعال نیست.');
    }
    $ch = curl_init();
    $opts = array(
        'URL' => $url,
        'RETURNTRANSFER' => true,
        'TIMEOUT' => (int) ($cfg['timeout'] ?? 180),
        'CONNECTTIMEOUT' => 15,
        'FOLLOWLOCATION' => true,
        'MAXREDIRS' => 3,
        'SSL_VERIFYPEER' => $verify,
        'SSL_VERIFYHOST' => $verify ? 2 : 0,
        'USERAGENT' => 'FactorKhan-PHP/1.2',
        'FRESH_CONNECT' => false,
        'HTTPHEADER' => array('Expect:'),
        'DNS_CACHE_TIMEOUT' => 300,
    );
    foreach ($opts as $name => $value) {
        $const = 'CURLOPT_' . $name;
        if (defined($const)) {
            @curl_setopt($ch, constant($const), $value);
        }
    }
    $body = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($body === false) {
        return array('ok' => false, 'body' => '', 'suffix' => '', 'message' => 'دانلود خروجی ناموفق بود.');
    }
    if ($status >= 400) {
        return array('ok' => false, 'body' => '', 'suffix' => '', 'message' => 'دانلود خروجی ناموفق بود (کد ' . $status . ').');
    }
    $suffix = strtolower((string) pathinfo((string) parse_url($url, PHP_URL_PATH), PATHINFO_EXTENSION));
    return array('ok' => true, 'body' => (string) $body, 'suffix' => $suffix, 'message' => '');
}

/* ═════════════ استخراج متن از فایل خروجی سرویس ابری ═════════════ */
/*
 * چرا لازم است؟
 *   سرویس ابری خروجی را «فایل Word» می‌دهد (docx) و متن درون
 *   word/document.xml قرار دارد. اگر همان فایل فقط ذخیره شود،
 *   کاربر متنی نمی‌بیند. این توابع متن را از داخل فایل بیرون می‌کشند
 *   تا مستقیم در باکس صفحه نمایش داده شود.
 *
 * نکتهٔ سازگاری: روی ویندوز ۷ / هاست‌های قدیمی افزونهٔ ZipArchive
 * معمولاً فعال نیست و zlib هم ممکن است نباشد؛ پس خواندن ZIP و
 * بازکردن deflate این‌جا دستی پیاده شده است.
 */

/** ساخت جدول هافمن استاندارد (RFC 1951) */
function fk_huff_build(array $lens): array
{
    $count = array_fill(0, 16, 0);
    foreach ($lens as $l) {
        $count[(int) $l]++;
    }
    $count[0] = 0;
    $offs = array_fill(0, 16, 0);
    for ($i = 1; $i < 16; $i++) {
        $offs[$i] = $offs[$i - 1] + $count[$i - 1];
    }
    $symbols = array();
    foreach ($lens as $sym => $l) {
        if ((int) $l > 0) {
            $symbols[$offs[(int) $l]++] = (int) $sym;
        }
    }
    return array('count' => $count, 'symbols' => $symbols);
}

/** جدول‌های ثابت بلاک نوع ۱ */
function fk_fixed_tables(): array
{
    static $t = null;
    if ($t === null) {
        $lit = array_merge(array_fill(0, 144, 8), array_fill(0, 112, 9),
            array_fill(0, 24, 7), array_fill(0, 8, 8));
        $t = array('lit' => fk_huff_build($lit), 'dist' => fk_huff_build(array_fill(0, 30, 5)));
    }
    return $t;
}

/**
 * باز کردن deflate خام (RFC 1951) بدون zlib.
 * در صورت هر خطا رشتهٔ خالی برمی‌گرداند (هیچ‌وقت استثنا بیرون نمی‌دهد).
 */
function fk_inflate_raw(string $d): string
{
    if (function_exists('gzinflate')) {
        $out = @gzinflate($d);
        if ($out !== false) {
            return $out;
        }
    }
    $n = strlen($d);
    $pos = 0;
    $bitBuf = 0;
    $bitCnt = 0;
    $out = '';

    $bits = static function (int $need) use (&$pos, &$bitBuf, &$bitCnt, $d, $n): int {
        while ($bitCnt < $need) {
            if ($pos >= $n) {
                throw new Exception('inflate eof');
            }
            $bitBuf |= ord($d[$pos++]) << $bitCnt;
            $bitCnt += 8;
        }
        $v = $bitBuf & ((1 << $need) - 1);
        $bitBuf = $bitBuf >> $need;
        $bitCnt -= $need;
        return $v;
    };

    $decode = static function (array $h) use ($bits): int {
        $code = 0;
        $first = 0;
        $index = 0;
        for ($len = 1; $len <= 15; $len++) {
            $code |= $bits(1);
            $cnt = $h['count'][$len];
            if (($code - $first) < $cnt) {
                return (int) $h['symbols'][$index + ($code - $first)];
            }
            $index += $cnt;
            $first = ($first + $cnt) << 1;
            $code = $code << 1;
        }
        throw new Exception('inflate code');
    };

    $lenBase = array(3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43,
        51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258);
    $lenExt = array(0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4,
        4, 4, 5, 5, 5, 5, 0);
    $distBase = array(1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257,
        385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577);
    $distExt = array(0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9,
        10, 10, 11, 11, 12, 12, 13, 13);
    $order = array(16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15);

    try {
        $final = 0;
        while ($final === 0) {
            $final = $bits(1);
            $type = $bits(2);

            if ($type === 0) {
                /* بلاک ذخیره‌شده: به مرز بایت برگرد */
                $bitBuf = 0;
                $bitCnt = 0;
                if ($pos + 4 > $n) {
                    throw new Exception('inflate stored');
                }
                $h = unpack('vlen/vnlen', substr($d, $pos, 4));
                $len = (int) $h['len'];
                $pos += 4;
                if ($pos + $len > $n) {
                    throw new Exception('inflate stored len');
                }
                $out .= substr($d, $pos, $len);
                $pos += $len;
                continue;
            }
            if ($type === 3) {
                throw new Exception('inflate type');
            }

            if ($type === 1) {
                $t = fk_fixed_tables();
                $lh = $t['lit'];
                $dh = $t['dist'];
            } else {
                $hlit = $bits(5) + 257;
                $hdist = $bits(5) + 1;
                $hclen = $bits(4) + 4;
                $clens = array_fill(0, 19, 0);
                for ($i = 0; $i < $hclen; $i++) {
                    $clens[$order[$i]] = $bits(3);
                }
                $clh = fk_huff_build($clens);
                $lens = array();
                while (count($lens) < $hlit + $hdist) {
                    $sym = $decode($clh);
                    if ($sym < 16) {
                        $lens[] = $sym;
                    } elseif ($sym === 16) {
                        $rep = 3 + $bits(2);
                        $prev = empty($lens) ? 0 : (int) $lens[count($lens) - 1];
                        for ($k = 0; $k < $rep; $k++) {
                            $lens[] = $prev;
                        }
                    } elseif ($sym === 17) {
                        $rep = 3 + $bits(3);
                        for ($k = 0; $k < $rep; $k++) {
                            $lens[] = 0;
                        }
                    } else {
                        $rep = 11 + $bits(7);
                        for ($k = 0; $k < $rep; $k++) {
                            $lens[] = 0;
                        }
                    }
                }
                $lh = fk_huff_build(array_slice($lens, 0, $hlit));
                $dh = fk_huff_build(array_slice($lens, $hlit, $hdist));
            }

            while (true) {
                $sym = $decode($lh);
                if ($sym < 256) {
                    $out .= chr($sym);
                    continue;
                }
                if ($sym === 256) {
                    break;
                }
                $i = $sym - 257;
                if ($i < 0 || $i > 28) {
                    throw new Exception('inflate len');
                }
                $len = $lenBase[$i] + $bits($lenExt[$i]);
                $ds = $decode($dh);
                if ($ds > 29) {
                    throw new Exception('inflate dist');
                }
                $dist = $distBase[$ds] + $bits($distExt[$ds]);
                $have = strlen($out);
                $start = $have - $dist;
                if ($start < 0) {
                    throw new Exception('inflate backref');
                }
                if ($dist >= $len) {
                    $out .= substr($out, $start, $len);
                } else {
                    for ($k = 0; $k < $len; $k++) {
                        $out .= $out[$start + $k];
                    }
                }
            }
        }
    } catch (Throwable $e) {
        return '';
    }
    return $out;
}

/**
 * خواندن یک عضو از فایل ZIP از راه «فهرست مرکزی»
 * (ZIP محلی ممکن است اندازهٔ فشرده را صفر بگذارد؛ فهرست مرکزی همیشه درست است).
 */
function fk_zip_entry(string $zip, string $want): string
{
    $zipLen = strlen($zip);
    if ($zipLen < 30) {
        return '';
    }
    $tail = substr($zip, max(0, $zipLen - 66000));
    $eocd = strrpos($tail, "PK\x05\x06");
    if ($eocd === false) {
        return '';
    }
    $e = unpack('vdisk/vcddisk/vcntdisk/vcount/Vcdsize/Vcdoff/vclen', substr($tail, $eocd + 4, 18));
    if (!is_array($e) || !isset($e['count'], $e['cdoff'])) {
        return '';
    }
    /* نام کلیدهای unpack با حرف بزرگ، پیش‌شمارهٔ عددی می‌گیرد؛ پس عددی می‌خوانیم */
    $count = min((int) $e['count'], 4000);
    $off = (int) $e['cdoff'];
    for ($i = 0; $i < $count; $i++) {
        if ($off < 0 || $off + 46 > $zipLen || substr($zip, $off, 4) !== "PK\x01\x02") {
            break;
        }
        $h = unpack(
            'vvermade/vverneed/vflag/vmethod/vtime/vdate/Vcrc/Vcsize/Vsize'
            . '/vnlen/vxlen/vclen/vdisk/viattr/Veattr/Vloff',
            substr($zip, $off + 4, 42)
        );
        if (!is_array($h) || !isset($h['nlen'], $h['csize'], $h['loff'])) {
            break;
        }
        /* همان نکته: کلیدهای V* به‌صورت عددی ذخیره می‌شوند */
        $name = substr($zip, $off + 46, (int) $h['nlen']);
        $off += 46 + (int) $h['nlen'] + (int) $h['xlen'] + (int) $h['clen'];
        if (strcasecmp($name, ltrim($want, '/')) !== 0) {
            continue;
        }
        $lo = (int) $h['loff'];
        if ($lo < 0 || $lo + 30 > $zipLen || substr($zip, $lo, 4) !== "PK\x03\x04") {
            return '';
        }
        $lh = unpack('vnlen/vxlen', substr($zip, $lo + 26, 4));
        if (!is_array($lh)) {
            return '';
        }
        $data = $lo + 30 + (int) $lh['nlen'] + (int) $lh['xlen'];
        $csize = (int) $h['csize'];
        if ($csize <= 0) {
            $csize = max(0, min($zipLen - $data, (int) $h['size'] + 4096));
        }
        $raw = substr($zip, $data, $csize);
        if ((int) $h['method'] === 0) {
            return $raw;
        }
        if ((int) $h['method'] === 8) {
            return fk_inflate_raw($raw);
        }
        return '';
    }
    return '';
}

/** متن را از XML فایل Word بیرون می‌کشد (پاراگراف‌ها با خط جدید) */
function fk_docx_text(string $xml): string
{
    if ($xml === '') {
        return '';
    }
    $xml = str_replace(array("\r\n", "\r"), "\n", $xml);
    /* مرزهای ساختاری را به نویسه‌های ساده تبدیل کن */
    $xml = preg_replace('#<w:tab[^>]*/>#', "\t", $xml);
    $xml = preg_replace('#<w:(br|cr)[^>]*/>#', "\n", $xml);
    $xml = preg_replace('#</w:p>#', "\n", $xml);
    $xml = preg_replace('#</w:tc>#', "\t", $xml);
    $xml = preg_replace('#</w:tr>#', "\n", $xml);
    /* متن‌های واقعی */
    $xml = preg_replace('#<w:t(?:\s[^>]*)?>#', '', $xml);
    $xml = preg_replace('#<[^>]{1,4000}>#', '', $xml);
    $text = html_entity_decode($xml, ENT_QUOTES | ENT_XML1, 'UTF-8');
    $text = str_replace(array("\xEF\xBF\xBD"), '', (string) $text);
    $text = str_replace("\xc2\xa0", ' ', (string) $text);
    /* سطرهای خالی حاصل از XML را حذف کن: هر پاراگراف = یک خط */
    $lines = array();
    foreach (explode("\n", (string) $text) as $line) {
        $line = rtrim($line);
        if (trim($line) === '') {
            continue;
        }
        $lines[] = $line;
    }
    return trim(implode("\n", $lines));
}

/** تبدیل HTML/RTF/متنی که بعضی سرویس‌ها به‌جای فایل می‌فرستند به متن ساده */
function fk_html_to_text(string $html): string
{
    $html = preg_replace('#<(script|style)[^>]*>.*?</\1>#is', '', $html);
    $html = preg_replace('#<br\s*/?>#i', "\n", (string) $html);
    $html = preg_replace('#</(p|div|tr|li|h[1-6])>#i', "\n", (string) $html);
    $html = preg_replace('#</t[dh]>#i', "\t", (string) $html);
    $text = strip_tags((string) $html);
    $text = html_entity_decode($text, ENT_QUOTES | ENT_HTML5, 'UTF-8');
    $text = str_replace("\xc2\xa0", ' ', $text);
    $text = preg_replace('/[ \t]+(\r?\n)/', '$1', $text);
    $text = preg_replace('/(\r?\n){3,}/', "\n\n", $text);
    return trim((string) $text);
}

/**
 * از بدنهٔ فایل دانلودشده تا جایی که می‌شود متن بیرون بکش.
 * @return array{text:string,kind:string,ok:bool}
 *   kind: docx | text | empty | binary
 */
function fk_body_text(string $body, string $suffix): array
{
    $len = strlen($body);
    if ($len === 0) {
        return array('text' => '', 'kind' => 'empty', 'ok' => false);
    }

    /* ۱) فایل Word/Odt (.docx/.odt/…) → از داخل بستهٔ ZIP بخوان */
    if (substr($body, 0, 2) === "PK") {
        foreach (array('word/document.xml', 'content.xml', 'word/document2.xml') as $entry) {
            $xml = fk_zip_entry($body, $entry);
            if ($xml !== '') {
                $t = fk_docx_text($xml);
                if ($t !== '') {
                    return array('text' => $t, 'kind' => 'docx', 'ok' => true);
                }
            }
        }
        /* ZIP باز شد ولی متن نداشت — شاید سند واقعاً خالی است */
        return array('text' => '', 'kind' => 'empty', 'ok' => false);
    }

    /* ۲) قالب‌های متنی */
    $head = strtolower(substr($body, 0, 600));
    $looksHtml = in_array($suffix, array('html', 'htm', 'xhtml'), true)
        || stripos($head, '<!doctype') !== false
        || stripos($head, '<html') !== false
        || (strpos($head, '<w:') !== false);
    $isText = $looksHtml
        || in_array($suffix, array('txt', 'json', 'csv', 'xml', 'rtf'), true)
        || !preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F]/', $body);

    if (!$isText) {
        return array('text' => '', 'kind' => 'binary', 'ok' => false);
    }

    $text = str_replace(array("\r\n", "\r"), "\n", $body);
    if (strpos($text, "\xEF\xBB\xBF") === 0) {
        $text = substr($text, 3);
    }
    if ($looksHtml || strpos($text, '<') !== false && preg_match('#</?[a-z][a-z0-9]*[\s>/]#i', $text)) {
        $text = fk_html_to_text($text);
    } elseif (stripos(substr($text, 0, 20), '{\rtf') !== false) {
        $text = preg_replace('/\\\\[a-z]+-?\d* ?/i', ' ', $text);
        $text = str_replace(array('{', '}', '\n', '\r'), array('', '', "\n", "\n"), (string) $text);
        $text = trim((string) preg_replace('/[ \t]{2,}/', ' ', (string) $text));
    } else {
        $text = trim($text);
    }

    /* گاهی بدنه خودش یک JSON است ({…}) — متن داخلش را بیرون بکش */
    if ($text !== '' && ($text[0] === '{' || $text[0] === '[')) {
        $j = json_decode($text, true);
        if (is_array($j)) {
            $inner = pick_key($j, array('Output', 'Text', 'Result', 'text', 'output'));
            if ($inner !== '' && $inner !== $text) {
                $dec = base64_decode($inner, true);
                $text = ($dec !== false && $dec !== '' && !preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F]/', $dec))
                    ? $dec : $inner;
            }
        }
    }

    $text = trim((string) preg_replace('/\n{3,}/', "\n\n", (string) $text));
    if ($text === '') {
        return array('text' => '', 'kind' => 'empty', 'ok' => false);
    }
    return array('text' => $text, 'kind' => 'text', 'ok' => true);
}

/**
 * ساخت یک فایل Word سالم و کمینه از متن (بدون zlib، بدون ZipArchive).
 * چرا؟ بعضی وقت‌ها فایلی که سرویس ابری می‌فرستد در Word باز نمی‌شود
 * («فایل خراب است»). متن که سالم استخراج شده، پس خودمان یک .docx
 * استاندارد می‌سازیم تا کاربر همیشه فایلی داشته باشد که باز می‌شود.
 */
function fk_zip_store(array $files): string
{
    $out = '';
    $central = '';
    $count = 0;
    foreach ($files as $name => $data) {
        $name = (string) $name;
        $data = (string) $data;
        $crc = crc32($data);
        $len = strlen($data);
        $offset = strlen($out);
        $common = pack('vvvvvVVVvv', 20, 0, 0, 0, 0, $crc, $len, $len,
            strlen($name), 0);
        $out .= "PK\x03\x04" . $common . $name . $data;
        $central .= "PK\x01\x02" . pack('vvvvvvVVVvvvvvVV',
            20, 20, 0, 0, 0, 0, $crc, $len, $len,
            strlen($name), 0, 0, 0, 0, 32, $offset) . $name;
        $count++;
    }
    $cd = strlen($central);
    $eocd = pack('vvvvVVv', 0, 0, $count, $count, $cd, strlen($out), 0);
    return $out . $central . "PK\x05\x06" . $eocd;
}

/** متن را به XML فایل Word تبدیل و بستهٔ .docx می‌سازد */
function fk_docx_build(string $text): string
{
    $text = str_replace(array("\r\n", "\r"), "\n", $text);
    $paras = '';
    foreach (explode("\n", $text) as $line) {
        $line = (string) preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F]/', '', $line);
        $run = '<w:r><w:t xml:space="preserve">'
            . htmlspecialchars($line, ENT_QUOTES | ENT_XML1, 'UTF-8')
            . '</w:t></w:r>';
        $paras .= '<w:p>' . ($line === '' ? '' : $run) . '</w:p>';
    }
    $doc = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        . '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        . '<w:body>' . $paras
        . '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'
        . '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr>'
        . '</w:body></w:document>';
    $types = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        . '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        . '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        . '<Default Extension="xml" ContentType="application/xml"/>'
        . '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
        . '</Types>';
    $rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        . '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        . '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
        . '</Relationships>';
    return fk_zip_store(array(
        '[Content_Types].xml' => $types,
        '_rels/.rels' => $rels,
        'word/document.xml' => $doc,
    ));
}

/** آیا این بدنه یک بستهٔ Word قابل خواندن است؟ */
function fk_is_valid_docx(string $body): bool
{
    return substr($body, 0, 2) === 'PK' && fk_zip_entry($body, 'word/document.xml') !== '';
}

/** ذخیرهٔ نسخهٔ متنی در کنار فایل اصلی (برای دانلود TXT) */
function save_text_file(string $text): string
{
    if ($text === '') {
        return '';
    }
    @mkdir(FK_UPLOADS, 0700, true);
    $name = 'fk-' . gmdate('Ymd-His') . '-' . bin2hex(random_bytes(3)) . '.txt';
    return @file_put_contents(FK_UPLOADS . '/' . $name, "\xEF\xBB\xBF" . $text) === false ? '' : $name;
}

/* ═══════════════════════ کارها (jobs) ═══════════════════════ */

function jobs_dir(): string
{
    if (!is_dir(FK_JOBS)) {
        @mkdir(FK_JOBS, 0700, true);
    }
    return FK_JOBS;
}

function job_id(): string
{
    return gmdate('Ymd-His') . '-' . bin2hex(random_bytes(4));
}

function job_path(string $id): string
{
    return jobs_dir() . '/' . preg_replace('/[^A-Za-z0-9\-]/', '', $id) . '.json';
}

function job_load(string $id): ?array
{
    $p = job_path($id);
    if (!is_file($p)) {
        return null;
    }
    $raw = @file_get_contents($p);
    $d = $raw === false ? null : json_decode($raw, true);
    return is_array($d) ? $d : null;
}

function job_save(array $job): void
{
    $job['updated_at'] = time();
    $json = json_encode($job, JSON_UNESCAPED_UNICODE);
    if ($json === false) {
        return;
    }
    $tmp = job_path((string) $job['id']) . '.tmp';
    if (@file_put_contents($tmp, $json, LOCK_EX) !== false) {
        @rename($tmp, job_path((string) $job['id']));
    }
}

function job_create(array $data): array
{
    $job = array_merge(array(
        'id' => job_id(),
        'status' => 'queued',
        'stage' => 'queued',
        'progress' => 0,
        'message' => 'در صف پردازش…',
        'text' => '',
        'pages' => 0,
        'file_token' => '',
        'created_at' => time(),
        'updated_at' => time(),
        'download' => '',
        'saved' => '',
        'saved_bytes' => 0,
        'txt_file' => '',
        'charcount' => 0,
        'out_kind' => '',
        'docx_rebuilt' => false,
        'engine' => 'cloud',
        'invoice_type' => 'printed',
        'ai_tried' => false,
        'error' => '',
    ), $data);
    job_save($job);
    return $job;
}

/**
 * حذف کارهای قدیمی‌تر از ۲ روز + فایل‌های آپلود یتیم.
 * (بدون این کار، فایل‌های نیمه‌کاره روی هاست انباشته می‌شوند.)
 */
function job_gc(): void
{
    /* کارهای نیمه‌کاره‌ای که بیش از ۲۰ دقیقه در وضعیت میانی مانده‌اند
       را ببند. بدون این کار، اگر هاست وسط پردازش قطع شود یا کاربر صفحه
       را ببندد، صفحه برای همیشه روی یک درصد گیر می‌کند و کاربر فکر
       می‌کند برنامه خراب است. اعتبار مصرف‌شده هم بی‌گناه تلف می‌شود. */
    job_reap_stale();

    $cut = time() - 172800;
    foreach (@glob(jobs_dir() . '/*.json') ?: array() as $f) {
        if (@filemtime($f) < $cut) {
            @unlink($f);
        }
    }
    foreach (@glob(FK_UPLOADS . '/*') ?: array() as $f) {
        if (is_file($f) && @filemtime($f) < $cut) {
            @unlink($f);
        }
    }
    foreach (@glob(FK_UPLOADS . '/*.tmp') ?: array() as $f) {
        @unlink($f);
    }
}

/**
 * بارگذاری کار با «بررسی مالکیت».
 *
 * چرا لازم است: کارها با شناسه در پوشهٔ مشترک ذخیره می‌شوند. بدون این
 * تابع، هر کاربر واردشده‌ای که شناسهٔ یک کار دیگر را حدس بزند (یا از
 * لاگ/تاریخچه ببیند) می‌توانست متن فاکتور، فایل Word یا حتی فایل
 * اصلی او را دانلود کند. این همان نشت اطلاعات بین کاربران است که
 * نباید هرگز رخ دهد.
 *
 * قاعده: کار فقط وقتی به کاربر داده می‌شود که شناسه‌اش در فهرست کارهای
 * همین نشست باشد. سیاست «انکار پیش‌فرض» — نه «شناسه تصادفی کافی است».
 *
 * @param string     $id      شناسهٔ کار
 * @param array|null $allowed فهرست شناسه‌های مجاز (پیش‌فرض: کارهای همین نشست)
 * @return array|null کار یا null
 */
function job_load_owned(string $id, ?array $allowed = null): ?array
{
    $id = (string) preg_replace('/[^A-Za-z0-9\-]/', '', $id);
    if ($id === '') {
        return null;
    }
    if ($allowed === null) {
        if (session_status() !== PHP_SESSION_ACTIVE) {
            start_session();
        }
        $allowed = (array) ($_SESSION['jobs'] ?? array());
    }
    $allowed = array_map('strval', $allowed);
    if (!in_array($id, $allowed, true)) {
        return null;                 /* مالک نیست، حتی اگر فایل باشد */
    }
    return job_load($id);
}

/**
 * ثبت کار در فهرست نشست (مالکیت) — بعد از ساخت موفق کار صدا زده می‌شود.
 */
function job_claim(string $id): void
{
    if (session_status() !== PHP_SESSION_ACTIVE) {
        start_session();
    }
    $ids = (array) ($_SESSION['jobs'] ?? array());
    $id = (string) preg_replace('/[^A-Za-z0-9\-]/', '', $id);
    if ($id !== '' && !in_array($id, $ids, true)) {
        $ids[] = $id;
        $_SESSION['jobs'] = $ids;
    }
}

/**
 * بارگذاری یک‌بارهٔ همهٔ کارهای یک نشست.
 *
 * صفحهٔ اصلی هم آمار می‌خواهد و هم فهرست؛ بدون این تابع هر فایل JSON
 * دو بار خوانده می‌شود. روی هاست اشتراکی با دیسک کند، تفاوتش محسوس است.
 *
 * @return array شناسه => کار
 */
function job_load_many(array $ids): array
{
    $out = array();
    foreach ($ids as $jid) {
        $jid = (string) $jid;
        if ($jid === '' || isset($out[$jid])) {
            continue;
        }
        $job = job_load($jid);
        if (is_array($job)) {
            $out[$jid] = $job;
        }
    }
    return $out;
}

/**
 * فهرست کارهای این نشست، برای «تاریخچهٔ فاکتورها».
 *
 * هر کار در یک فایل JSON است، پس فهرست‌کردن ساده و سریع است. فیلتر
 * جستجو روی نام فایل، متن فاکتور و شمارهٔ فاکتور انجام می‌شود تا کاربر
 * بتواند بین ده‌ها فاکتور قبلی فاکتور مورد نظرش را پیدا کند.
 *
 * @param array  $ids    شناسه‌های کارهای این نشست
 * @param string $query  عبارت جستجو (خالی = همه)
 * @param int    $limit  حداکثر تعداد
 * @return array فهرست خلاصهٔ کارها، تازه‌ترین اول
 */
function job_list(array $ids, string $query = '', int $limit = 50, ?array $loaded = null): array
{
    $out = array();
    $q = trim($query);
    $q = function_exists('mb_strtolower') ? mb_strtolower($q, 'UTF-8') : strtolower($q);

    foreach (array_reverse($ids) as $jid) {
        /* اگر فهرست کارها از قبل خوانده شده، دوباره از دیسک نخوان.
           خواندن دوبارهٔ هر فایل JSON برای صفحه‌ای با ۵۰ فاکتور،
           ۵۰ بار I/O اضافه است — روی هاست‌های اشتراکی محسوس است. */
        $job = $loaded !== null
            ? ($loaded[(string) $jid] ?? null)
            : job_load((string) $jid);
        if (!is_array($job)) {
            continue;
        }
        if ($q !== '') {
            $hay = (string) ($job['name'] ?? '') . "\n"
                . (string) ($job['text'] ?? '') . "\n"
                . (string) ($job['text_clean'] ?? '') . "\n"
                . (string) ($job['invoice_no'] ?? '');
            $hay = function_exists('mb_strtolower') ? mb_strtolower($hay, 'UTF-8') : strtolower($hay);
            if (strpos($hay, $q) === false) {
                continue;
            }
        }
        $u = is_array($job['understood'] ?? null) ? $job['understood'] : array();
        $totals = is_array($u['totals'] ?? null) ? $u['totals'] : array();
        $out[] = array(
            'id' => (string) $job['id'],
            'name' => (string) ($job['name'] ?? ''),
            'status' => (string) ($job['status'] ?? ''),
            'message' => (string) ($job['message'] ?? ''),
            'created' => (int) ($job['created_at'] ?? 0),
            'created_fa' => function_exists('fk_fa_date') ? fk_fa_date((int) ($job['created_at'] ?? 0)) : '',
            'chars' => (int) ($job['charcount'] ?? 0),
            'items' => (int) ($u['item_count'] ?? 0),
            'total' => (int) ($totals['total'] ?? 0),
            'has_text' => trim((string) ($job['text'] ?? '')) !== '',
            'docx' => (string) ($job['docx'] ?? '') !== '',
        );
        if (count($out) >= $limit) {
            break;
        }
    }
    return $out;
}

/**
 * جمع‌بندی همهٔ فاکتورهای یک نشست — داشبورد بالای صفحه.
 *
 * کاربری که روزی ۲۰ فاکتور می‌خواند می‌خواهد بداند چقدر کار کرده و
 * جمع مبالغ چقدر بوده. این عدد از همان کارهای ذخیره‌شده محاسبه می‌شود؛
 * هیچ درخواست شبکه‌ای لازم نیست.
 *
 * @return array {count, ok, failed, chars, total, items}
 */
function job_stats(array $ids, ?array $loaded = null): array
{
    $s = array('count' => 0, 'ok' => 0, 'failed' => 0, 'chars' => 0,
               'total' => 0, 'items' => 0);
    foreach ($ids as $jid) {
        $job = $loaded !== null
            ? ($loaded[(string) $jid] ?? null)
            : job_load((string) $jid);
        if (!is_array($job)) {
            continue;
        }
        $s['count']++;
        $st = (string) ($job['status'] ?? '');
        if ($st === 'done') {
            $s['ok']++;
        } elseif ($st === 'failed') {
            $s['failed']++;
        }
        $s['chars'] += (int) ($job['charcount'] ?? 0);
        $u = is_array($job['understood'] ?? null) ? $job['understood'] : array();
        $totals = is_array($u['totals'] ?? null) ? $u['totals'] : array();
        $s['total'] += (int) ($totals['total'] ?? 0);
        $s['items'] += (int) ($u['item_count'] ?? 0);
    }
    return $s;
}

/**
 * خروجی CSV از چند فاکتور — برای اکسل.
 *
 * چرا مهم است: کاربری که فاکتورهای ماه را خوانده باید بتواند همه را
 * یک‌جا در اکسل باز کند، نه اینکه ۲۰ بار کپی-پیست کند.
 * BOM اضافه می‌شود تا اکسل فارسی را درست نشان دهد (بدون BOM، اکسل
 * فایل UTF-8 را «عربی» می‌خواند و همه‌چیز به‌هم می‌ریزد).
 */
function job_csv(array $ids): string
{
    $rows = array();
    $rows[] = array('فایل', 'تاریخ', 'وضعیت', 'تعداد اقلام', 'جمع کل', 'تعداد نویسه', 'متن');
    foreach (array_reverse($ids) as $jid) {
        $job = job_load((string) $jid);
        if (!$job) {
            continue;
        }
        $u = is_array($job['understood'] ?? null) ? $job['understood'] : array();
        $totals = is_array($u['totals'] ?? null) ? $u['totals'] : array();
        $rows[] = array(
            (string) ($job['name'] ?? ''),
            function_exists('fk_fa_date') ? fk_fa_date((int) ($job['created_at'] ?? 0)) : '',
            (string) ($job['status'] ?? ''),
            (string) (int) ($u['item_count'] ?? 0),
            (string) (int) ($totals['total'] ?? 0),
            (string) (int) ($job['charcount'] ?? 0),
            str_replace(array("\r\n", "\r"), " / ", (string) ($job['text'] ?? '')),
        );
    }
    $fh = fopen('php://temp', 'r+');
    foreach ($rows as $r) {
        fputcsv($fh, $r, ',', '"', "\\");
    }
    rewind($fh);
    $csv = (string) stream_get_contents($fh);
    fclose($fh);
    return "\xEF\xBB\xBF" . $csv;
}

/**
 * بستن کارهای نیمه‌کارهٔ قدیمی.
 *
 * چرا لازم است: هر کار در فایل JSON خودش نگه داشته می‌شود و فقط وقتی
 * پیش می‌رود که چیزی job_tick را صدا بزند (مرورگر یا cron). اگر مرورگر
 * بسته شود و cron نصب نباشد، کار تا ابد در وضعیت «converting» می‌ماند.
 * کاربر بعداً صفحه را باز می‌کند، درصد ثابتی می‌بیند و هیچ پیامی نمی‌گیرد.
 *
 * این تابع چنین کاری را «شکست‌خورده با پیام روشن» می‌کند تا کاربر
 * بداند چه شد و بتواند دوباره بفرستد — به‌جای انتظار بی‌پایان.
 *
 * @param int $minutes حداکثر عمر مجاز برای یک کار در حال اجرا
 * @return int تعداد کارهایی که بسته شد
 */
function job_reap_stale(int $minutes = 20): int
{
    $reaped = 0;
    $budget = time() - $minutes * 60;
    foreach (@glob(jobs_dir() . '/*.json') ?: array() as $f) {
        $raw = @file_get_contents($f);
        if ($raw === false || $raw === '') {
            continue;
        }
        $job = json_decode($raw, true);
        if (!is_array($job)) {
            continue;
        }
        if (job_is_terminal($job)) {
            continue;
        }
        /* زمان آخرین فعالیت: هر مرحله job_save می‌کند، پس mtime دقیق است */
        $seen = (int) (@filemtime($f) ?: 0);
        if ($seen > $budget) {
            continue;                       /* تازه در حال کار است */
        }
        $stage = (string) ($job['stage'] ?? '');
        /* اگر در مرحلهٔ دریافت خروجی بود، ممکن است متن از سرویس آمده باشد */
        if (isset($job['saved']) && $job['saved'] !== '' && is_file((string) $job['saved'])) {
            $text = fk_body_text((string) @file_get_contents((string) $job['saved']),
                (string) ($job['suffix'] ?? ''));
            if (trim($text) !== '') {
                $job = job_finish_text($job, $text);
                job_save($job);
                $reaped++;
                continue;
            }
        }
        $job['status'] = 'failed';
        $job['stage'] = 'failed';
        $job['error'] = 'StaleJob';
        $job['message'] = 'پردازش این فایل نیمه‌کاره ماند (اتصال یا مرورگر قطع شد). '
            . 'اعتباری برای آن مصرف نشده است؛ لطفاً فایل را دوباره بفرستید.';
        $job['finished_at'] = time();
        job_save($job);
        $reaped++;
    }
    return $reaped;
}

/**
 * پاک‌کردن فایل‌های دانلودی قدیمی (فقط با درخواست خود کاربر، نه خودکار).
 * متن برای همیشه در کار می‌ماند؛ پس حذف فایل هیچ اطلاعاتی را از بین نمی‌برد.
 */
function job_delete_files(array $job): array
{
    foreach (array('saved', 'txt_file') as $k) {
        $n = (string) ($job[$k] ?? '');
        if ($n !== '' && preg_match('/^[A-Za-z0-9._-]+$/', $n)) {
            $p = FK_UPLOADS . '/' . $n;
            if (is_file($p)) {
                @unlink($p);
            }
        }
        $job[$k] = '';
    }
    job_save($job);
    return $job;
}

/** خروجی دادن یک فایل از پوشهٔ آپلود (با کنترل مالکیت کار) */
function send_upload_file(string $name, string $downloadAs): void
{
    $name = (string) preg_replace('/[^A-Za-z0-9._-]/', '', $name);
    $path = FK_UPLOADS . '/' . $name;
    if ($name === '' || !is_file($path)) {
        http_response_code(404);
        header('Content-Type: text/plain; charset=utf-8');
        echo 'فایل پیدا نشد.';
        exit;
    }
    $ext = strtolower((string) pathinfo($name, PATHINFO_EXTENSION));
    $types = array(
        'txt' => 'text/plain; charset=utf-8', 'docx' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'doc' => 'application/msword', 'pdf' => 'application/pdf', 'json' => 'application/json; charset=utf-8',
        'html' => 'text/html; charset=utf-8', 'htm' => 'text/html; charset=utf-8',
        'csv' => 'text/csv; charset=utf-8', 'xml' => 'application/xml; charset=utf-8',
        'rtf' => 'application/rtf', 'zip' => 'application/zip',
    );
    $type = $types[$ext] ?? 'application/octet-stream';
    clearstatcache(true, $path);
    $bytes = (int) @filesize($path);
    $safeAs = (string) preg_replace('/[^\p{L}\p{N}._-]+/u', '-', $downloadAs);
    $safeAs = trim($safeAs, '-_.');
    if ($safeAs === '') {
        $safeAs = $name;
    }
    $safeAs .= '.' . ($ext !== '' ? $ext : 'bin');
    header('Content-Type: ' . $type);
    header('Content-Length: ' . $bytes);
    header('Content-Disposition: attachment; filename="' . $safeAs . '"; '
        . "filename*=UTF-8''" . rawurlencode($safeAs));
    header('X-Content-Type-Options: nosniff');
    header('Cache-Control: private, no-store, max-age=0');
    @readfile($path);
    exit;
}

/**
 * انتخاب هوشمند روش تبدیل.
 * روش ۴ = استخراج متن (OCR) — تنها روشی که برای عکس/PDF تصویری کار می‌کند.
 * روش‌های ۱..۳ برای PDF متنی (Word/حفظ ساختار) هستند.
 */
function pick_method(int $requested, array $methods, string $ext): int
{
    $allowed = array_values(array_filter(array_map('intval', $methods), static function ($m) {
        return $m >= 1 && $m <= 4;
    }));
    if (!$allowed) {
        return $requested;
    }
    if ($requested === 4) {
        return in_array(4, $allowed, true) ? 4 : $allowed[0];
    }
    if (in_array($requested, $allowed, true)) {
        return $requested;
    }
    $imageLike = in_array($ext, array('jpg', 'jpeg', 'png', 'bmp', 'tif', 'tiff'), true);
    if ($imageLike && in_array(4, $allowed, true)) {
        return 4;
    }
    return $allowed[0];
}

/**
 * ثبت کار: فایل را در صف می‌گذارد و *هیچ* ارتباطی با سرویس ابری برقرار نمی‌کند.
 * آپلود به سرویس ابری در اولین tick انجام می‌شود؛ بنابراین حتی درخواستِ
 * آپلود هم طولانی نمی‌شود و صفحه هرگز قفل/سفید نمی‌شود.
 *
 * @param array  $job       خروجی job_create
 * @param string $localFile مسیر فایل موقتِ آپلودشده روی همین سرور
 */
function job_queue(array $job, string $localFile, string $sendName, string $mime,
                   int $method, string $output, bool $deleteAfter): array
{
    $job['local'] = $localFile;
    $job['send_name'] = $sendName;
    $job['mime'] = $mime;
    $job['ext'] = strtolower(pathinfo($sendName, PATHINFO_EXTENSION));
    $job['bytes'] = is_file($localFile) ? (int) @filesize($localFile) : 0;
    $job['output'] = $output;
    $job['delete_after'] = $deleteAfter;
    $job['status'] = 'queued';
    $job['stage'] = 'addfile';
    $job['progress'] = 3;
    $job['message'] = 'فایل روی سرور ذخیره شد؛ ارسال به سرویس ابری…';
    job_save($job);
    return $job;
}

/**
 * نگه‌داشتن فایل آپلودشده در پوشهٔ اختصاصی (چون فایل موقت PHP بعد از درخواست حذف می‌شود).
 * @return string مسیر فایل ذخیره‌شده یا '' در صورت خطا
 */
function stash_upload(string $tmpPath, string $ext): string
{
    if (!is_file($tmpPath)) {
        return '';
    }
    @mkdir(FK_UPLOADS, 0700, true);
    $name = 'in-' . gmdate('Ymd-His') . '-' . bin2hex(random_bytes(5)) . '.' . preg_replace('/[^a-z0-9]/', '', $ext);
    $dest = FK_UPLOADS . '/' . $name;
    if (@rename($tmpPath, $dest)) {
        return $dest;
    }
    if (@copy($tmpPath, $dest)) {
        @unlink($tmpPath);
        return $dest;
    }
    return '';
}

/** حذف فایل محلی یک کار (پس از ارسال موفق) */
function job_drop_local(array $job): void
{
    $local = (string) ($job['local'] ?? '');
    if ($local !== '' && is_file($local) && strpos($local, FK_UPLOADS) === 0) {
        @unlink($local);
    }
}

/**
 * نمایش کوتاه مدت زمان به فارسی: «۴۲ ثانیه» / «۲ دقیقه و ۵ ثانیه»
 */
function self_duration(int $seconds): string
{
    if ($seconds < 60) {
        return max(1, $seconds) . ' ثانیه';
    }
    $m = intdiv($seconds, 60);
    $s = $seconds % 60;
    return $s === 0 ? $m . ' دقیقه' : $m . ' دقیقه و ' . $s . ' ثانیه';
}

/**
 * یک قدم پیش بردن کار.
 *
 * قاعدهٔ زمان‌بندی (مهم برای سرعت):
 *   • مراحل کوتاه (addfile و convert) در *همان* درخواست پشت سر هم انجام
 *     می‌شوند؛ هر کدام ۱ تا ۵ ثانیه‌اند و مجموعشان صفحه را قفل نمی‌کند،
 *     ولی حذف رفت‌وبرگشت مرورگر ۲ تا ۳ ثانیه صرفه‌جویی می‌کند.
 *   • checkconvert (که ممکن است دقایق طول بکشد) هرگز تکرار نمی‌شود؛
 *     هر بار فقط یک بار پرسیده می‌شود تا پاسخ کوتاه بماند.
 *
 * @param array $job    پروندهٔ کار
 * @param int   $budget حداکثر ثانیهٔ مجاز برای این درخواست (پیش‌فرض ۲۵)
 */
function job_tick(array $job, int $budget = 25): array
{
    $deadline = microtime(true) + max(5, $budget);
    /* پاک‌سازی معوق روی سرویس ابری: یک درخواست جداگانه، تا هیچ درخواستی
       دو فراخوانی درگاه نداشته باشد. */
    if (!empty($job['cleanup_pending']) && empty($job['cleaned'])) {
        $job['message'] = 'در حال پاک‌کردن فایل از سرویس ابری…';
        $job['real_progress'] = false;
        job_save($job);
        if (!empty($job['file_token'])) {
            call_gateway(array('command' => 'deletefile', 'filetoken' => (string) $job['file_token']), null, null, '', 12);
        }
        $job['cleaned'] = true;
        $job['cleanup_pending'] = false;
        $job['message'] = 'تبدیل کامل شد.';
        job_save($job);
        return $job;
    }

    if (job_is_terminal($job)) {
        return $job;
    }

    $age = time() - (int) ($job['created_at'] ?? time());
    if ($age > 1200) {
        $job['status'] = 'failed';
        $job['message'] = 'زمان انتظار (۲۰ دقیقه) تمام شد. فایل را به بخش‌های کوچک‌تر تقسیم کنید.';
        job_save($job);
        return $job;
    }

    $stage = (string) ($job['stage'] ?? 'addfile');

    /* ── مرحلهٔ ۱: ارسال فایل به سرویس ابری ───────────────────── */
    if ($stage === 'addfile') {
        $local = (string) ($job['local'] ?? '');
        if ($local === '' || !is_file($local)) {
            $job['status'] = 'failed';
            $job['message'] = 'فایل موقت روی سرور پیدا نشد. دوباره آپلود کنید.';
            job_save($job);
            return $job;
        }
        $job['progress'] = 8;
        $job['message'] = 'در حال ارسال فایل به سرویس ابری…';
        job_save($job);

        $add = call_gateway(
            array('command' => 'addfile'),
            $local,
            (string) ($job['mime'] ?? ''),
            (string) ($job['send_name'] ?? basename($local)),
            90
        );
        if (!$add['ok']) {
            if ($add['code'] === 'Network' && $age < 900) {
                $job['message'] = 'ارسال فایل ناموفق بود؛ تلاش دوباره…';
                job_save($job);
                return $job;      // مرحله عوض نمی‌شود؛ next tick دوباره تلاش می‌کند
            }
            $job['status'] = 'failed';
            $job['message'] = $add['message'];
            $job['error'] = $add['code'];
            job_save($job);
            return $job;
        }

        $d = $add['data'];
        $fileToken = find_file_token($d);
        $job['pages'] = (int) ($d['PageCount'] ?? $d['Pagecount'] ?? 0);
        $job['file_token'] = $fileToken;
        $job['remote_methods'] = array();
        if (!empty($d['ConvertMethods'])) {
            $job['remote_methods'] = array_map('intval', array_filter(explode(',', (string) $d['ConvertMethods']), 'strlen'));
        }

        if ($fileToken === '') {
            $keys = $d ? implode(', ', array_keys($d)) : 'هیچ';
            $st = (string) ($d['Status'] ?? '');
            $job['status'] = 'failed';
            $job['message'] = 'سرویس ابری فایل را نپذیرفت. وضعیت: ' . ($st !== '' ? $st : 'خالی')
                . ' — کلیدهای پاسخ: ' . $keys . ' — برای دیدن جزئیات diag.php را باز کنید.';
            $job['error'] = 'NoFileToken';
            job_save($job);
            return $job;
        }

        /*
         * فایل محلی را نگه می‌داریم تا اگر خروجی سرویس ابری خالی بود،
         * موتور هوش مصنوعی بتواند همان عکس را بخواند (آپلود دوباره لازم نیست).
         * پاک‌سازی با job_gc در پایان انجام می‌شود.
         */
        $job['keep_local'] = true;
        $ext = strtolower(pathinfo((string) ($job['send_name'] ?? ''), PATHINFO_EXTENSION));
        $useMethod = pick_method((int) ($job['method'] ?? 4), $job['remote_methods'], $ext);
        $job['method'] = $useMethod;
        $job['stage'] = 'convert';
        $job['status'] = 'converting';
        $job['progress'] = 20;
        $job['message'] = 'فایل ثبت شد (' . $job['pages'] . ' صفحه) — شروع تبدیل با روش ' . $useMethod . '…';
        job_save($job);

        /* مرحلهٔ convert هم کوتاه است؛ همان‌جا انجامش بده تا رفت‌وبرگشت
           اضافی مرورگر حذف شود (۲ تا ۳ ثانیه صرفه‌جویی). */
        if (microtime(true) < $deadline) {
            $job = job_tick($job, max(5, (int) ($deadline - microtime(true))));
        }
        return $job;
    }

    /* ── مرحلهٔ ۳٫۵: خوانش با موتور هوش مصنوعی ─────────────────── */
    /*
     * در دو حالت به این‌جا می‌رسیم:
     *   الف) کاربر از اول این موتور را انتخاب کرده است
     *   ب) موتور اول خروجی خالی/ناخوانا داد و کلید هوش مصنوعی موجود است
     * در هر دو حالت عکس اصلی روی سرور خودمان است؛ دوباره به سرویس ابری
     * فرستاده نمی‌شود، پس اعتبار اضافه‌ای مصرف نمی‌شود.
     */
    if ($stage === 'ai') {
        $local = (string) ($job['local'] ?? '');
        if ($local === '' || !is_file($local)) {
            $job['status'] = 'failed';
            $job['message'] = 'فایل اصلی برای خوانش دوباره روی سرور نیست. دوباره آپلود کنید.';
            job_save($job);
            return $job;
        }
        $job['progress'] = 88;
        $job['message'] = 'خوانش دوباره با موتور هوش مصنوعی…';
        $job['real_progress'] = false;
        job_save($job);

        $ext = strtolower((string) pathinfo($local, PATHINFO_EXTENSION));
        $mime = mime_for_ext($ext);
        if ($mime === 'application/octet-stream') {
            $mime = 'image/jpeg';
        }
        $ai = ai_read_image($local, $mime);
        $job['ai_tried'] = true;

        if (!$ai['ok']) {
            job_drop_local($job);
            $job['status'] = 'failed';
            $job['message'] = 'موتور هوش مصنوعی هم متنی پیدا نکرد: ' . $ai['message'];
            $job['error'] = 'Ai' . $ai['code'];
            job_save($job);
            return $job;
        }

        $job['engine'] = 'ai';
        $job['txt_file'] = save_text_file($ai['text']);
        $job['charcount'] = function_exists('mb_strlen') ? mb_strlen($ai['text'], 'UTF-8') : 0;
        /* همیشه یک Word سالم از متن خوانده‌شده بساز (مستقل از موتور اول) */
        $body = fk_docx_build($ai['text']);
        $safe = 'fk-' . gmdate('Ymd-His') . '-' . bin2hex(random_bytes(3)) . '.docx';
        @mkdir(FK_UPLOADS, 0700, true);
        if (@file_put_contents(FK_UPLOADS . '/' . $safe, $body) !== false) {
            $job['saved'] = $safe;
            $job['saved_bytes'] = strlen($body);
            $job['docx_rebuilt'] = true;
        }
        return job_finish_text($job, $ai['text']);
    }

    $fileToken = (string) ($job['file_token'] ?? '');
    if ($fileToken === '') {
        $job['status'] = 'failed';
        $job['message'] = 'توکن فایل موجود نیست.';
        job_save($job);
        return $job;
    }

    /* ── مرحلهٔ ۲: درخواست تبدیل ──────────────────────────────── */
    if ($stage === 'convert') {
        $job['message'] = 'در حال شروع تبدیل…';
        $job['progress'] = 25;
        job_save($job);

        /*
         * «تلاش دوبارهٔ هوشمند» در برابر InvalidParams
         * -----------------------------------------------
         * سرویس ممکن است comboِ method+output را نپذیرد (مثلاً روش Word با
         * خروجی JSON). به‌جای شکست فوری، هر بار یک پارامتر «ریسک‌دار» کمتر
         * می‌فرستیم. اعتبار OCR مصرف نمی‌شود، چون درخواست از پایه رد شده.
         */
        $methodInt = (int) ($job['method'] ?? 4);
        $output = (string) ($job['output'] ?? '');
        $attempts = array();
        $conv = array('ok' => false, 'data' => array(), 'message' => '', 'code' => '');
        $steps = array(
            'full' => array('method' => true, 'output' => true),
            'no_output' => array('method' => true, 'output' => false),
            'method4_no_output' => array('method' => false, 'output' => false),
        );
        foreach ($steps as $stepName => $opt) {
            $payload = array('command' => 'convert', 'filetoken' => $fileToken);
            $payload['method'] = (string) ($opt['method'] ? $methodInt : 4);
            if ($opt['output'] && $output !== '') {
                $payload['output'] = $output;
            }
            $conv = call_gateway($payload, null, null, '', 45);
            if ($conv['ok']) {
                break;
            }
            $attempts[] = $stepName . '→' . $conv['code'];
            $isParamErr = stripos((string) $conv['code'], 'invalid') === 0
                || strcasecmp((string) $conv['code'], 'BadRequest') === 0
                || strcasecmp((string) $conv['code'], 'UnknowMethod') === 0
                || strcasecmp((string) $conv['code'], 'MethodNotAllowed') === 0;
            if (!$isParamErr) {
                break;   /* خطای اعتبار/شبکه با تلاش دوباره حل نمی‌شود */
            }
        }
        if ($attempts) {
            $job['convert_attempts'] = $attempts;
        }
        if (!$conv['ok'] && $attempts && count($attempts) === count($steps)) {
            $conv['message'] .= ' — هر سه حالت ارسال امتحان شد و هیچ‌کدام پذیرفته نشد؛'
                . ' مشکل از نسخهٔ برنامه یا تغییر سرویس است.';
        }

        if (!$conv['ok']) {
            if (in_array($conv['code'], array('Network', 'BadResponse'), true) && $age < 900) {
                $job['message'] = 'سرویس ابری پاسخ نداد؛ تلاش دوباره برای شروع تبدیل…';
                job_save($job);
                return $job;
            }
            $job['status'] = 'failed';
            $job['message'] = $conv['message'];
            $job['error'] = $conv['code'];
            if (!empty($job['delete_after'])) {
                $job['cleanup_pending'] = true;
            }
            job_save($job);
            return $job;
        }

        /*
         * طبق قرارداد سرویس:
         *   • عکس و PDF → خودِ convert لینک فایل خروجی را برمی‌گرداند
         *     (کلید در پاسخ با فاصله است: " FileToDownload ")
         *   • فقط فایل صوتی نیاز به checkconvert دارد
         * پس اگر لینک آمد، بی‌درنگ به مرحلهٔ دانلود برو؛ منتظر ماندن
         * روی checkconvert فقط وقت و اعتبار تلف می‌کند.
         */
        $download = pick_key($conv['data'], array('FileToDownload', 'FileToDownloadUrl', 'DownloadUrl', 'OutputFile'));
        $job['download'] = $download;

        if ($download !== '') {
            $job['stage'] = 'download';
            $job['status'] = 'processing';
            $job['progress'] = 90;
            $job['message'] = 'تبدیل انجام شد؛ دریافت فایل خروجی…';
            job_save($job);
            return $job;
        }

        /* لینکی نیامد → این فایل باید با checkconvert دنبال شود (صوتی یا صف) */
        $job['stage'] = 'wait';
        $job['status'] = 'converting';
        $job['progress'] = 32;
        $job['started_wait'] = time();
        $job['message'] = 'در حال پردازش روی سرور ابری…';
        job_save($job);

        /* عمداً checkconvert را همین‌جا صدا نمی‌زنیم:
           کاربر باید بلافاصله ببیند «تبدیل شروع شد» و درصد واقعی را ببیند.
           زنجیره فقط برای دو مرحلهٔ قطعاً کوتاه (addfile → convert) است. */
        return $job;
    }

    /* ── مرحلهٔ ۳: پرسیدن وضعیت ───────────────────────────────── */
    if ($stage === 'wait') {
        $chk = call_gateway(array('command' => 'checkconvert', 'filetoken' => $fileToken), null, null, '', 20);
        if (!$chk['ok']) {
            /*
             * خطاهای گذرا → صبر کن.
             * InvalidParams → این فایل مسیرش checkconvert نبوده (عکس/PDF
             *   با لینک دانلود). کار نباید با یک خطای بی‌ربط بمیرد؛
             *   کاربر فایل خروجی آماده دارد و فقط پیام گیج‌کننده می‌بیند.
             */
            $isParamErr = stripos((string) $chk['code'], 'invalid') === 0
                || strcasecmp((string) $chk['code'], 'BadRequest') === 0;
            if ($isParamErr) {
                $job['check_unsupported'] = true;
                $job['stage'] = 'wait';
                $job['message'] = 'این سرویس برای این فایل خروجی متنی نمی‌دهد؛'
                    . ' از قالب «حفظ ساختار» یا موتور هوش مصنوعی استفاده کنید.';
                $job['status'] = 'failed';
                $job['error'] = $chk['code'];
                job_save($job);
                return $job;
            }
            if (in_array($chk['code'], array('Network', 'BadResponse'), true) && $age < 900) {
                $job['message'] = 'در انتظار پاسخ سرویس ابری… (تلاش دوباره)';
                job_save($job);
                return $job;
            }
            $job['status'] = 'failed';
            $job['message'] = $chk['message'];
            $job['error'] = $chk['code'];
            job_save($job);
            return $job;
        }

        $d = $chk['data'];
        $st = strtolower(trim((string) ($d['Status'] ?? '')));

        $progress = 0;
        if (preg_match('/(\d+(?:\.\d+)?)/', (string) ($d['Progress'] ?? ''), $m)) {
            $progress = (int) round((float) $m[1]);
        }

        /* متن خروجی — کلید ممکن است «Output» یا با فاصله باشد */
        $candidate = pick_key($d, array('Output', 'Text', 'Result'));
        $text = '';

        if ($candidate !== '') {
            /* اگر پاسخ سرویس خودش یک JSON تودرتو بود، آن را به‌عنوان «متن» نگیر */
            $isJson = preg_match('/^\s*[\[{]/', $candidate)
                && json_decode($candidate, true) !== null;
            if (!$isJson) {
                $decoded = base64_decode($candidate, true);
                /* base64 معتبر فقط اگر خروجی، متن چاپ‌شدنی باشد */
                $looksBase64 = $decoded !== false
                    && $decoded !== ''
                    && preg_match('/^[\x20-\x7E\r\n\t\x{0600}-\x{06FF}]+$/u', $decoded);
                $text = $looksBase64 ? $decoded : $candidate;
            }
        }

        /*
         * «Data Not Found Yet» یک خطا نیست؛ یعنی هنوز خروجی آماده نشده.
         * در مستندات سرویس جزو فهرست خطاها آمده ولی رفتارش «در انتظار» است.
         */
        $notReady = stripos((string) ($d['Status'] ?? ''), 'not found') !== false
            || stripos((string) ($d['Status'] ?? ''), 'notfound') !== false;

        $done = in_array($st, array('done', 'success', 'finished', 'completed'), true);
        $failed = in_array($st, array('error', 'failed', 'convertterminated'), true);

        /* اگر متن آمده، حتی با وضعیت Converting هم قبولش کن:
           سرویس متن را تدریجی می‌فرستد و منتظر ماندن فقط وقت تلف می‌کند. */
        if ($text !== '') {
            return job_finish_text($job, $text);
        }

        if ($notReady) {
            $job['message'] = 'سرویس هنوز خروجی را آماده نکرده؛ ادامهٔ انتظار…';
            job_save($job);
            return $job;
        }

        if ($failed) {
            $job['status'] = 'failed';
            $job['message'] = 'تبدیل ناموفق بود (وضعیت: ' . ($st !== '' ? $st : 'نامشخص') . ').';
            $job['error'] = $st;
            job_save($job);
            return $job;
        }

        if ($done) {
            /* convert تمام شده ولی نه متن آمد نه لینک:
               یا خروجی فایل است (Word) یا سرویس لینک را در این پاسخ نداد.
               اگر لینک داریم برو دانلود، وگرنه صریح شکست بده —
               چرخیدن بی‌پایان روی «۹۲٪» بدترین حالت است. */
            if (trim((string) ($job['download'] ?? '')) !== '') {
                $job['stage'] = 'download';
                $job['status'] = 'processing';
                $job['progress'] = 92;
                $job['message'] = 'تبدیل تمام شد؛ آماده‌سازی خروجی…';
            } else {
                $job['status'] = 'failed';
                $job['stage'] = 'convert';
                $job['message'] = 'سرویس ابری «تمام شد» گفت ولی نه متنی فرستاد نه لینک فایلی. '
                    . 'یک بار دیگر امتحان کنید؛ اگر تکرار شد، در diag.php پاسخ خام را ببینید.';
            }
            job_save($job);
            return $job;
        }

        if ($progress > 0) {
            /* درصد واقعی سرویس را نشان بده؛ سقف مصنوعی لازم نیست */
            $job['progress'] = max(32, min($progress, 99));
            $job['real_progress'] = true;
            $job['message'] = 'در حال پردازش… ' . $job['progress'] . '٪';
        } else {
            /* سرویس درصد نمی‌دهد → عدد ساختگی نشان نده؛ زمان‌سنج واقعی بده */
            $elapsed = time() - (int) ($job['started_wait'] ?? time());
            $job['progress'] = max(32, (int) $job['progress']);
            /* این تیک درصد واقعی نداشت → نوار باید حالت «در جریان» بگیرد */
            $job['real_progress'] = false;
            $job['wait_seconds'] = $elapsed;
            if ($elapsed > 420) {
                /* بیش از ۷ دقیقه بدون هیچ درصدی: صریح بگو، نه اینکه بی‌صدا بچرخد */
                $job['message'] = 'سرویس ابری بیش از ' . self_duration($elapsed) . ' است پاسخ آماده نداده. '
                    . 'ممکن است صف سرویس شلوغ باشد. می‌توانید صبر کنید یا با «لغو پردازش» متوقف کنید.';
                $job['slow'] = true;
            } else {
                $job['message'] = 'در حال پردازش روی سرویس ابری… ' . self_duration($elapsed);
            }
        }
        job_save($job);
        return $job;
    }

    /* ── مرحلهٔ ۴: دانلود فایل خروجی (Word و…) ────────────────── */
    if ($stage === 'download') {
        $url = (string) ($job['download'] ?? '');
        if ($url === '') {
            $job['status'] = 'failed';
            $job['message'] = 'سرویس ابری خروجی متنی برنگرداند.';
            job_save($job);
            return $job;
        }
        $dl = download_output($url);
        if (!$dl['ok']) {
            $job['status'] = 'failed';
            $job['message'] = $dl['message'];
            job_save($job);
            return $job;
        }
        /*
         * مهم: کاربر «متن» می‌خواهد، نه فایل.
         * سرویس خروجی را در فایل Word می‌دهد؛ متن را از داخل همان فایل
         * بیرون می‌کشیم و مستقیم در باکس صفحه نشان می‌دهیم.
         * فایل اصلی هم (اگر سالم بود) برای دانلود نگه داشته می‌شود.
         */
        $parsed = fk_body_text($dl['body'], $dl['suffix']);
        $job['out_kind'] = $parsed['kind'];

        if ($parsed['ok']) {
            /*
             * پسوند فایل ذخیره‌شده باید با محتوای واقعی بخواند.
             * اگر سرویس به‌جای Word یک صفحهٔ HTML/متن بفرستد و ما آن را
             * با پسوند .docx ذخیره کنیم، Word می‌گوید «فایل خراب است».
             */
            $extOut = preg_replace('/[^a-z0-9]/', '', $dl['suffix'] ?: '');
            $isZip = substr($dl['body'], 0, 2) === 'PK';
            $body = $dl['body'];

            if (in_array($extOut, array('docx', 'doc', 'odt', 'zip'), true) || $isZip) {
                if (fk_is_valid_docx($body)) {
                    $extOut = 'docx';          // خودِ فایل سرویس سالم است → همان را بده
                } else {
                    /* فایل سرویس در Word باز نمی‌شود → از متنِ خوانده‌شده یک Word سالم بساز */
                    $body = fk_docx_build($parsed['text']);
                    $extOut = 'docx';
                    $job['docx_rebuilt'] = true;
                }
            } elseif ($extOut === '') {
                $extOut = 'txt';
            }

            $safe = 'fk-' . gmdate('Ymd-His') . '-' . bin2hex(random_bytes(3)) . '.' . $extOut;
            @mkdir(FK_UPLOADS, 0700, true);
            if (@file_put_contents(FK_UPLOADS . '/' . $safe, $body) !== false) {
                $job['saved'] = $safe;
                $job['saved_bytes'] = strlen($body);
            }
            $job['txt_file'] = save_text_file($parsed['text']);
            /* شمارش نویسه فقط وقتی mbstring هست معتبر است؛ وگرنه مرورگر خودش می‌شمارد */
            $job['charcount'] = function_exists('mb_strlen') ? mb_strlen($parsed['text'], 'UTF-8') : 0;
            return job_finish_text($job, $parsed['text']);
        }

        /*
         * فایل خالی یا ناخوانا آمد. اگر کلید هوش مصنوعی ثبت شده و قبلاً
         * امتحان نشده، همین‌جا موتور دوم را جلو می‌اندازیم — بی‌آنکه کاربر
         * کار را دوباره از اول شروع کند یا اعتبار تازه‌ای بسوزد.
         */
        if (empty($job['ai_tried']) && trim((string) (load_config()['ai_key'] ?? '')) !== ''
            && is_file((string) ($job['local'] ?? ''))) {
            $job['stage'] = 'ai';
            $job['status'] = 'processing';
            $job['progress'] = 85;
            $job['message'] = 'خروجی سرویس ابری خالی بود؛ خوانش با موتور هوش مصنوعی…';
            job_save($job);
            return $job;
        }
        /* فایل خالی یا ناخوانا آمد → فایل بی‌مصرف روی هاست ذخیره نکن */
        job_drop_local($job);
        $job['status'] = 'failed';
        $job['stage'] = 'download';
        $job['error'] = 'EmptyOutput';
        $job['message'] = $parsed['kind'] === 'binary'
            ? 'سرویس ابری فایلی فرستاد که خواندنش ممکن نشد. یک بار دیگر امتحان کنید.'
            : 'سرویس ابری برای این تصویر هیچ متنی پیدا نکرد (فایل خالی بود). '
              . 'عکس را واضح‌تر و روشن‌تر بگیرید — کل تصویر داخل کادر و بدون تاری باشد — '
              . 'و دوباره بفرستید. اگر تکرار شد، diag.php را ببینید.';
        job_save($job);
        return $job;
    }

    /* مرحلهٔ ناشناخته → از صفر تلاش کن */
    $job['stage'] = 'wait';
    job_save($job);
    return $job;
}

/**
 * آیا کار به پایان رسیده است؟
 * فقط بر اساس stage قضاوت می‌کنیم چون status در طول مسیر «converting»
 * می‌ماند و ممکن است با stage ناهمخوان باشد.
 */
function job_is_terminal(array $job): bool
{
    if (in_array((string) ($job['stage'] ?? ''), array('done', 'cancelled'), true)) {
        return true;
    }
    return in_array((string) ($job['status'] ?? ''), array('done', 'failed', 'cancelled'), true);
}

/** پایان موفق کار + پاک‌سازی فایل روی سرویس ابری */
function job_finish_text(array $job, string $text): array
{
    if ($text !== '') {
        $job['text'] = $text;
        /* موتور متن را می‌فهمد: نویسه‌ها یکدست، اقلام استخراج و اعداد بازبینی می‌شوند */
        if (function_exists('fk_understand')) {
            try {
                /* نوع فاکتور (چاپی/حرارتی/دست‌نویس/صوتی/خودکار) به موتور
                   فهم داده می‌شود: انتخاب کاربر واقعاً خط لولهٔ خوانش را
                   عوض می‌کند، نه اینکه فقط یک برچسب باشد. */
                $u = fk_understand($text, array(
                    'invoice_type' => (string) ($job['invoice_type'] ?? 'printed'),
                ));
                $meta = fk_detect_meta($u['text'], $u['totals']);
                $quality = fk_quality_report($u['text'], $u);
                $job['understood'] = array(
                    'items' => $u['items'],
                    'totals' => $u['totals'],
                    'issues' => $u['issues'],
                    'confidence' => $u['confidence'],
                    'item_count' => $u['item_count'],
                    'meta' => $meta,
                    'quality' => $quality,
                    'cleaned' => fk_canonical_numbers($u['text']),
                    'invoice_type' => $u['invoice_type'] ?? ((string) ($job['invoice_type'] ?? 'printed')),
                    'type_label' => $u['type_label'] ?? '',
                    'type_source' => $u['type_source'] ?? 'manual',
                    'detection' => $u['detection'] ?? null,
                );
                /* متن یکدست‌شده جای متن خام را می‌گیرد: خوانا و آمادهٔ کپی */
                $job['text_clean'] = $u['text'];
                $job['suggestions'] = fk_suggestions(
                    strtolower((string) ($job['ext'] ?? '')),
                    (int) ($job['bytes'] ?? 0),
                    (int) ($job['pages'] ?? 0),
                    $job
                );
            } catch (Throwable $e) {
                $job['understood'] = array('error' => 'engine: ' . $e->getMessage());
            }
        }
    }
    $job['status'] = 'done';
    $job['stage'] = 'done';
    $job['progress'] = 100;
    $job['message'] = 'تبدیل کامل شد.';
    /* حذف فایل از سرویس ابری در درخواست بعدی انجام می‌شود تا این پاسخ سریع بماند */
    if (!empty($job['delete_after']) && !empty($job['file_token']) && empty($job['cleaned'])) {
        $job['cleanup_pending'] = true;
    }
    /* کار تمام شد → فایل اصلی روی هاست لازم نیست (حریم خصوصی + فضا) */
    job_drop_local($job);
    $job['keep_local'] = false;
    job_save($job);
    return $job;
}

/* ═══════════════════════ فلش و ریدایرکت ═══════════════════════ */

function flash(string $type, string $message): void
{
    start_session();
    $_SESSION['flash'] = array('type' => $type, 'message' => $message);
}

function take_flash(): ?array
{
    start_session();
    if (empty($_SESSION['flash'])) {
        return null;
    }
    $f = $_SESSION['flash'];
    unset($_SESSION['flash']);
    return is_array($f) ? $f : null;
}

function redirect(string $where = ''): void
{
    $self = strtok($_SERVER['REQUEST_URI'] ?? '/', '?');
    header('Location: ' . $self . ($where ? '?' . $where : ''), true, 303);
    exit;
}

function upload_error_text(int $code): string
{
    $map = array(
        UPLOAD_ERR_INI_SIZE => 'حجم فایل از حد مجاز php.ini (upload_max_filesize) بیشتر است.',
        UPLOAD_ERR_FORM_SIZE => 'حجم فایل از حد مجاز فرم بیشتر است.',
        UPLOAD_ERR_PARTIAL => 'فایل ناقص آپلود شد. دوباره تلاش کنید.',
        UPLOAD_ERR_NO_FILE => 'فایلی انتخاب نشد.',
        UPLOAD_ERR_NO_TMP_DIR => 'پوشهٔ موقت روی سرور وجود ندارد.',
        UPLOAD_ERR_CANT_WRITE => 'نوشتن فایل روی دیسک ممکن نشد.',
        UPLOAD_ERR_EXTENSION => 'آپلود توسط یکی از افزونه‌های PHP متوقف شد.',
    );
    return $map[$code] ?? ('خطای آپلود (کد ' . $code . ')');
}

function mime_for_ext(string $ext): string
{
    $map = array(
        'pdf' => 'application/pdf', 'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg',
        'png' => 'image/png', 'bmp' => 'image/bmp', 'tif' => 'image/tiff', 'tiff' => 'image/tiff',
        'mp3' => 'audio/mpeg', 'wav' => 'audio/wav', 'm4a' => 'audio/mp4',
        'mp4' => 'video/mp4', 'ogg' => 'audio/ogg', 'flac' => 'audio/flac', '3gp' => 'video/3gpp',
    );
    return $map[$ext] ?? 'application/octet-stream';
}

/** قفل سبک برای جلوگیری از پردازش هم‌زمان (فقط برای عملیات کوتاه) */
function with_lock(callable $fn, int $waitMs = 300)
{
    $fh = @fopen(FK_LOCK, 'c');
    if ($fh) {
        $deadline = microtime(true) + $waitMs / 1000;
        while (!@flock($fh, LOCK_EX | LOCK_NB)) {
            if (microtime(true) > $deadline) {
                break;
            }
            usleep(20000);
        }
    }
    try {
        return $fn();
    } finally {
        if ($fh) {
            @flock($fh, LOCK_UN);
            @fclose($fh);
        }
    }
}
