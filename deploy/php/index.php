<?php
/**
 * فاکتورخوان — نسخهٔ آزمایشی PHP برای WAMP / XAMPP
 * ==================================================
 * یک فایل، بدون وابستگی بیرونی. در htdocs بگذارید و باز کنید.
 *
 * کارها:
 *   • ثبت توکن سرویس ابری (در فایل config.json کنار همین فایل، بیرون از web root نیست ولی
 *     با .htaccess مسدود می‌شود) و هرگز نمایش ندادن آن
 *   • ورود با گذرواژهٔ محلی
 *   • آپلود عکس/PDF و ارسال به سرویس ابری و نمایش متن استخراج‌شده
 *   • نمایش اعتبار سرویس
 *
 * نکته: این نسخه برای «تست سرویس ابری» است. نسخهٔ کامل (فاکتورها، اشتراک، گزارش‌ها)
 * همان برنامهٔ پایتون است.
 *
 * نیازمندی: PHP 7.4+ (روی WAMP ویندوز ۷ معمولاً 7.4 یا 8.0 هست) با افزونه‌های curl/json.
 */

declare(strict_types=1);

/* جانشین توابع mbstring برای سرورهایی که این افزونه را فعال نکرده‌اند. */
if (!function_exists('mb_substr')) {
    function mb_substr($str, $start, $length = null, $encoding = null)
    {
        return $length === null ? substr((string) $str, (int) $start)
            : substr((string) $str, (int) $start, (int) $length);
    }
}
if (!function_exists('mb_strlen')) {
    function mb_strlen($str, $encoding = null)
    {
        return strlen((string) $str);
    }
}

@ini_set('display_errors', '0');
error_reporting(E_ALL);
@date_default_timezone_set('Asia/Tehran');

const APP_TITLE = 'فاکتورخوان — آزمون سرویس ابری';
const CONFIG_FILE = __DIR__ . '/fk-config.json';
const UPLOAD_DIR = __DIR__ . '/fk-uploads';

/* آدرس درگاه: مبهم‌سازی‌شده (XOR + Base64) تا در سورس و صفحه دیده نشود. */
function gateway_url(): string
{
    $cfg = load_config();
    if (!empty($cfg['gateway'])) {
        return (string) $cfg['gateway'];
    }
    $b64 = 'Mi4uKilgdXUtLS10Pzg1' . 'NXQzKHU7KjN1NTkodT0/' . 'Li07Iw==';
    $raw = base64_decode($b64, true);
    if ($raw === false) {
        return '';
    }
    $out = '';
    for ($i = 0, $n = strlen($raw); $i < $n; $i++) {
        $out .= chr(ord($raw[$i]) ^ 0x5A);
    }
    return $out;
}

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
    session_set_cookie_params(array(
        'lifetime' => 0,
        'path' => '/',
        'httponly' => true,
        'samesite' => 'Strict',
        'secure' => is_https(),
    ));
    session_name('fksid');
    session_start();
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

function load_config(): array
{
    if (!is_file(CONFIG_FILE)) {
        return array();
    }
    $raw = @file_get_contents(CONFIG_FILE);
    if ($raw === false) {
        return array();
    }
    $data = json_decode($raw, true);
    return is_array($data) ? $data : array();
}

function save_config(array $cfg): bool
{
    $json = json_encode($cfg, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    if ($json === false) {
        return false;
    }
    $ok = @file_put_contents(CONFIG_FILE, $json, LOCK_EX);
    if ($ok !== false) {
        @chmod(CONFIG_FILE, 0600);
    }
    return $ok !== false;
}

function h(?string $v): string
{
    return htmlspecialchars((string) $v, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function is_logged_in(): bool
{
    start_session();
    return !empty($_SESSION['auth']) && $_SESSION['auth'] === true;
}

function password_is_set(): bool
{
    $cfg = load_config();
    return !empty($cfg['password_hash']);
}

function token_is_set(): bool
{
    $cfg = load_config();
    return !empty($cfg['token']);
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

/**
 * فراخوانی درگاه سرویس ابری. توکن فقط اینجا استفاده می‌شود و در هیچ خروجی نمی‌آید.
 * @return array{ok:bool,data:array,message:string,code:string}
 */
function call_gateway(array $fields, ?string $filePath = null, ?string $fileMime = null, string $fileName = ''): array
{
    $cfg = load_config();
    $uploadMethod = '';
    if ($filePath !== null) {
        $uploadMethod = strtolower((string) ($cfg['upload_method'] ?? 'multipart'));
    }
    $url = gateway_url();
    $token = (string) ($cfg['token'] ?? '');
    $timeout = (int) ($cfg['timeout'] ?? 180);
    $verify = array_key_exists('verify_tls', $cfg) ? (bool) $cfg['verify_tls'] : true;

    if ($url === '') {
        return array('ok' => false, 'data' => array(), 'message' => 'درگاه تنظیم نشده است.', 'code' => 'NoGateway');
    }
    if ($token === '') {
        return array('ok' => false, 'data' => array(), 'message' => 'ابتدا توکن را ثبت کنید.', 'code' => 'NoToken');
    }
    if (!function_exists('curl_init')) {
        return array('ok' => false, 'data' => array(),
            'message' => 'افزونهٔ curl در PHP فعال نیست. در php.ini خط extension=curl را از کامنت خارج کنید.',
            'code' => 'NoCurl');
    }

    $payload = $fields;
    $payload['token'] = $token;
    if ($filePath !== null) {
        /* مهم: نام فایل باید نام اصلی باشد (مثلاً invoice.jpg)، نه نام پوشهٔ موقت
           (php3F2A.tmp). بعضی سرویس‌ها از پسوند نام، نوع فایل را تشخیص می‌دهند و
           با پسوند .tmp فایل را قبول نمی‌کنند و توکن برنمی‌گردانند. */
        $safeName = $fileName ?: basename($filePath);
        if (!empty($cfg['simple_filename'])) {
            $safeName = 'document' . (pathinfo($safeName, PATHINFO_EXTENSION) ? '.' . pathinfo($safeName, PATHINFO_EXTENSION) : '');
        }
        if ($uploadMethod === 'base64') {
            /* روش جایگزین: برابر مستندات، «محتویات» فایل را در همان فیلد می‌فرستیم.
               برای فایل‌های کوچک مناسب است (حجم ~۱.۳۳ برابر می‌شود). */
            $raw = @file_get_contents($filePath);
            if ($raw === false) {
                return array('ok' => false, 'data' => array(),
                    'message' => 'خواندن فایل برای ارسال ممکن نشد.', 'code' => 'ReadFile');
            }
            $payload['filehandle'] = base64_encode($raw);
            $payload['filename'] = $safeName;
            $payload['filemime'] = $fileMime ?: 'application/octet-stream';
        } elseif (class_exists('CURLFile')) {
            $payload['filehandle'] = new CURLFile($filePath, $fileMime ?: 'application/octet-stream', $safeName);
        } else {
            // PHP 5.4 و قدیمی‌تر: نحو @ نیاز به تنظیم اضافی دارد
            $payload['filehandle'] = '@' . $filePath . ';filename=' . $safeName
                . ';type=' . ($fileMime ?: 'application/octet-stream');
        }
    }

    $ch = curl_init();
    curl_setopt_array($ch, array(
        CURLOPT_URL => $url,
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $payload,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => $timeout,
        CURLOPT_CONNECTTIMEOUT => 20,
        CURLOPT_SSL_VERIFYPEER => $verify,
        CURLOPT_SSL_VERIFYHOST => $verify ? 2 : 0,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_USERAGENT => 'FactorKhan-PHP/1.0',
    ));
    if (!class_exists('CURLFile') && defined('CURLOPT_SAFE_UPLOAD')) {
        /* PHP 5.4: بدون این تنظیم، رشتهٔ @... به‌عنوان متن ارسال می‌شود نه فایل */
        curl_setopt($ch, CURLOPT_SAFE_UPLOAD, false);
    }
    $body = curl_exec($ch);
    $err = curl_error($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($body === false) {
        return array('ok' => false, 'data' => array(),
            'message' => 'ارتباط با سرویس ابری برقرار نشد: ' . scrub($err, $token), 'code' => 'Network');
    }
    $data = json_decode((string) $body, true);
    /* باید یک «شیء» JSON باشد، نه آرایه یا متن ساده */
    $is_object_shape = is_array($data) && ($data === array() || array_keys($data) !== range(0, count($data) - 1));
    if (!$is_object_shape) {
        $snippet = trim(scrub(mb_substr((string) $body, 0, 200), $token));
        return array('ok' => false, 'data' => array(),
            'message' => 'پاسخ سرویس ابری قابل تفسیر نیست (کد ' . $status . '). '
                . ($snippet !== '' ? 'پاسخ: ' . $snippet : 'پاسخ خالی بود.'),
            'code' => 'BadResponse');
    }
    $st = (string) ($data['Status'] ?? '');
    $errors = array(
        'FileCorrupted' => 'فایل ارسالی خراب، غیرمجاز یا رمزدار است.',
        'NoEnoughCredit' => 'اعتبار سرویس ابری کافی نیست.',
        'UploadFailed' => 'خطا در بارگذاری فایل به سرویس ابری.',
        'TokenNotFound' => 'فایل یا توکن یافت نشد. توکن را بررسی کنید.',
        'MethodNotAllowed' => 'این روش تبدیل برای فایل انتخاب‌شده مجاز نیست.',
        'FileDeletedFromServer' => 'فایل از سرور ابری حذف شده است.',
        'ConvertError' => 'خطا در تبدیل فایل.',
        'IPError' => 'IP این سرور مجاز نیست.',
        'UnkwonURL' => 'لینک ارسالی معتبر نیست.',
        'UnknowURL' => 'لینک ارسالی معتبر نیست.',
        'UnknowMethod' => 'روش تبدیل نامعتبر است.',
    );
    if (isset($errors[$st])) {
        return array('ok' => false, 'data' => $data, 'message' => $errors[$st], 'code' => $st);
    }
    if (strtolower($st) === 'error' || strtolower($st) === 'failed') {
        return array('ok' => false, 'data' => $data,
            'message' => scrub((string) ($data['Message'] ?? 'خطای نامشخص'), $token), 'code' => 'Error');
    }
    return array('ok' => true, 'data' => $data, 'message' => '', 'code' => $st);
}

/**
 * یافتن اولین مقدار «توکن فایل» در پاسخ، حتی اگر کلید نام دیگری داشته باشد
 * یا داخل یک شیء تودرتو باشد.
 */
function find_file_token(array $data): string
{
    $candidates = array('FileToken', 'Filetoken', 'filetoken', 'fileToken', 'File_Token', 'Token', 'token');
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

function scrub(string $text, string $token): string
{
    if ($token !== '') {
        $text = str_replace($token, '«مخفی»', $text);
        if (strlen($token) > 6) {
            $text = str_replace(substr($token, 0, 6), '«مخفی»', $text);
        }
    }
    return mb_substr($text, 0, 500);
}

/**
 * دانلود فایل خروجی از لینکی که سرویس ابری داده است.
 * لینک فقط از پاسخ JSON خوانده می‌شود (نه از ورودی کاربر) تا SSRF رخ ندهد.
 * @return array{ok:bool,body:string,suffix:string,message:string}
 */
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
    curl_setopt_array($ch, array(
        CURLOPT_URL => $url,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => (int) ($cfg['timeout'] ?? 180),
        CURLOPT_CONNECTTIMEOUT => 20,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS => 3,
        CURLOPT_SSL_VERIFYPEER => $verify,
        CURLOPT_SSL_VERIFYHOST => $verify ? 2 : 0,
        CURLOPT_USERAGENT => 'FactorKhan-PHP/1.0',
    ));
    $body = curl_exec($ch);
    $err = curl_error($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($body === false) {
        return array('ok' => false, 'body' => '', 'suffix' => '', 'message' => 'دانلود خروجی ناموفق بود: ' . scrub($err, ''));
    }
    if ($status >= 400) {
        return array('ok' => false, 'body' => '', 'suffix' => '', 'message' => 'دانلود خروجی ناموفق بود (کد ' . $status . ').');
    }
    $suffix = strtolower((string) pathinfo((string) parse_url($url, PHP_URL_PATH), PATHINFO_EXTENSION));
    return array('ok' => true, 'body' => (string) $body, 'suffix' => $suffix, 'message' => '');
}

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
    return $f;
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

/* ══════════════════════════ مسیرها ══════════════════════════ */

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$cfg = load_config();
$needs_setup = !password_is_set() || !token_is_set();

start_session();

/* --- خروج --- */
if ($method === 'POST' && ($_POST['action'] ?? '') === 'logout') {
    if (csrf_ok($_POST['csrf'] ?? null)) {
        $_SESSION = array();
        session_destroy();
    }
    header('Location: ' . strtok($_SERVER['REQUEST_URI'], '?'), true, 303);
    exit;
}

/* --- ورود --- */
if ($method === 'POST' && ($_POST['action'] ?? '') === 'login') {
    if (!csrf_ok($_POST['csrf'] ?? null)) {
        flash('error', 'درخواست نامعتبر است. صفحه را دوباره باز کنید.');
        redirect();
    }
    $hash = (string) (load_config()['password_hash'] ?? '');
    $given = (string) ($_POST['password'] ?? '');
    if ($hash === '' || !password_verify($given, $hash)) {
        sleep(1);
        flash('error', 'گذرواژه اشتباه است.');
        redirect();
    }
    session_regenerate_id(true);
    $_SESSION['auth'] = true;
    redirect();
}

/* --- راه‌اندازی اولیه: تعیین گذرواژه --- */
if ($method === 'POST' && ($_POST['action'] ?? '') === 'setup_password') {
    if (!csrf_ok($_POST['csrf'] ?? null)) {
        flash('error', 'درخواست نامعتبر است.');
        redirect();
    }
    $pass = (string) ($_POST['new_password'] ?? '');
    $confirm = (string) ($_POST['confirm_password'] ?? '');
    if (strlen($pass) < 8) {
        flash('error', 'گذرواژه باید حداقل ۸ کاراکتر باشد.');
        redirect();
    }
    if ($pass !== $confirm) {
        flash('error', 'دو گذرواژه یکسان نیستند.');
        redirect();
    }
    $cfg = load_config();
    $cfg['password_hash'] = password_hash($pass, PASSWORD_DEFAULT);
    save_config($cfg);
    $_SESSION['auth'] = true;
    flash('ok', 'گذرواژه تنظیم شد. حالا توکن سرویس ابری را ثبت کنید.');
    redirect();
}

/* --- ثبت توکن --- */
if ($method === 'POST' && ($_POST['action'] ?? '') === 'save_token') {
    if (!is_logged_in() || !csrf_ok($_POST['csrf'] ?? null)) {
        flash('error', 'دسترسی غیرمجاز.');
        redirect();
    }
    $token = trim((string) ($_POST['token'] ?? ''));
    if (strlen($token) < 8) {
        flash('error', 'توکن معتبر نیست (حداقل ۸ کاراکتر).');
        redirect();
    }
    $cfg = load_config();
    $cfg['token'] = $token;
    save_config($cfg);
    flash('ok', 'توکن ذخیره شد و دیگر نمایش داده نمی‌شود.');
    redirect();
}

/* --- حذف توکن --- */
if ($method === 'POST' && ($_POST['action'] ?? '') === 'clear_token') {
    if (!is_logged_in() || !csrf_ok($_POST['csrf'] ?? null)) {
        flash('error', 'دسترسی غیرمجاز.');
        redirect();
    }
    $cfg = load_config();
    unset($cfg['token']);
    save_config($cfg);
    flash('ok', 'توکن حذف شد.');
    redirect();
}

/* --- تست اعتبار --- */
if ($method === 'POST' && ($_POST['action'] ?? '') === 'test_credit') {
    if (!is_logged_in() || !csrf_ok($_POST['csrf'] ?? null)) {
        flash('error', 'دسترسی غیرمجاز.');
        redirect();
    }
    $res = call_gateway(array('command' => 'checkcredit'));
    if ($res['ok']) {
        $ocr = (int) ($res['data']['OCRCredit'] ?? 0);
        $audio = (int) ($res['data']['AudioTranscribeCredit'] ?? 0);
        flash('ok', 'ارتباط برقرار است — اعتبار OCR: ' . number_format($ocr) . ' صفحه، صوت: ' . number_format($audio) . ' ثانیه');
    } else {
        flash('error', $res['message']);
    }
    redirect();
}

/* --- پردازش فایل --- */
$result = null;
$busy = false;
if ($method === 'POST' && ($_POST['action'] ?? '') === 'process') {
    if (!is_logged_in() || !csrf_ok($_POST['csrf'] ?? null)) {
        flash('error', 'دسترسی غیرمجاز.');
        redirect();
    }
    $busy = true;
    $file = $_FILES['document'] ?? null;
    if (!$file || ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        flash('error', $file ? upload_error_text((int) $file['error']) : 'فایلی انتخاب نشد.');
        redirect();
    }
    $maxMb = (int) ($cfg['max_upload_mb'] ?? 25);
    if ((int) $file['size'] > $maxMb * 1024 * 1024) {
        flash('error', 'حجم فایل بیشتر از ' . $maxMb . ' مگابایت است.');
        redirect();
    }
    $ext = strtolower(pathinfo((string) $file['name'], PATHINFO_EXTENSION));
    $allowed = (array) ($cfg['allowed_ext'] ?? array('pdf', 'jpg', 'jpeg', 'png', 'bmp'));
    if (!in_array($ext, $allowed, true)) {
        flash('error', 'این قالب پشتیبانی نمی‌شود: ' . $ext);
        redirect();
    }
    if (!is_dir(UPLOAD_DIR) && !@mkdir(UPLOAD_DIR, 0700, true)) {
        flash('error', 'ساخت پوشهٔ آپلود ممکن نشد. دسترسی نوشتن را بررسی کنید.');
        redirect();
    }

    $method_no = max(1, min(4, (int) ($_POST['method'] ?? 4)));
    $output = (string) ($_POST['output'] ?? 'txtrawjson');
    $delete_after = !empty($_POST['delete_after']);

    $tmpName = (string) $file['tmp_name'];
    $originalName = (string) ($file['name'] ?? 'document.' . $ext);
    /* نام فایل اصلی را به سرویس می‌فرستیم (نه phpXXXX.tmp). */
    $sendName = preg_replace('/[^\w.\-]/u', '_', basename($originalName)) ?: ('document.' . $ext);
    $mime = (string) ($file['type'] ?? '');
    if ($mime === '' || $mime === 'application/octet-stream') {
        $mimeMap = array(
            'pdf' => 'application/pdf', 'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg',
            'png' => 'image/png', 'bmp' => 'image/bmp', 'tif' => 'image/tiff', 'tiff' => 'image/tiff',
            'mp3' => 'audio/mpeg', 'wav' => 'audio/wav', 'm4a' => 'audio/mp4',
            'mp4' => 'video/mp4', 'ogg' => 'audio/ogg', 'flac' => 'audio/flac', '3gp' => 'video/3gpp',
        );
        $mime = $mimeMap[$ext] ?? 'application/octet-stream';
    }
    $add = call_gateway(array('command' => 'addfile'), $tmpName, $mime, $sendName);
    if (!$add['ok']) {
        $result = array('ok' => false, 'stage' => 'addfile', 'message' => $add['message']);
    } else {
        $d = $add['data'];
        $fileToken = find_file_token($d);
        $pages = (int) ($d['PageCount'] ?? $d['Pagecount'] ?? 0);
        $st = (string) ($d['Status'] ?? '');
        if ($fileToken === '') {
            /* پیام دقیق: چه وضعیتی برگشت و چه کلیدهایی داشت؟ (بدون افشای توکن) */
            $keys = $d ? implode(', ', array_keys($d)) : 'هیچ';
            $detail = 'وضعیت: ' . ($st !== '' ? $st : '(خالی)') . ' — کلیدهای پاسخ: ' . $keys;
            $result = array(
                'ok' => false,
                'stage' => 'addfile',
                'message' => 'سرور توکن فایل برنگرداند. ' . $detail,
                'hint' => 'این صفحه را باز کنید تا پاسخ کامل سرور را ببینید: diag.php',
            );
        } else {
            $conv = call_gateway(array(
                'command' => 'convert',
                'filetoken' => $fileToken,
                'method' => $method_no,
                'output' => $output,
            ));
            $downloadUrl = '';
            if (!$conv['ok']) {
                $result = array('ok' => false, 'stage' => 'convert', 'message' => $conv['message']);
                // بعضی فایل‌ها فقط از طریق checkconvert خروجی می‌دهند؛ ادامه می‌دهیم اگر خطای قطعی نبود.
            } else {
                $downloadUrl = (string) ($conv['data']['FileToDownload'] ?? $conv['data'][' FileToDownload '] ?? '');
                $downloadUrl = trim($downloadUrl);
            }

            $text = null;
            $progress = 0;
            $savedName = '';
            if ($result === null || ($result['ok'] === false && $downloadUrl !== '')) {
                for ($i = 0; $i < 60; $i++) {
                    $chk = call_gateway(array('command' => 'checkconvert', 'filetoken' => $fileToken));
                    if (!$chk['ok']) {
                        if ($result === null) {
                            $result = array('ok' => false, 'stage' => 'checkconvert', 'message' => $chk['message']);
                        }
                        break;
                    }
                    $st = strtolower((string) ($chk['data']['Status'] ?? ''));
                    $progress = (int) preg_replace('/\D/', '', (string) ($chk['data']['Progress'] ?? '0'));
                    $candidate = (string) ($chk['data']['Output'] ?? '');
                    if ($candidate !== '' && !preg_match('/^\s*\{/', $candidate)) {
                        $decoded = base64_decode($candidate, true);
                        if ($decoded !== false && $decoded !== '') {
                            $text = $decoded;
                        } elseif ($candidate !== '') {
                            $text = $candidate;
                        }
                    }
                    if ($st === 'done' || $st === 'success' || $st === 'finished') {
                        break;
                    }
                    if ($st === 'error' || $st === 'failed' || $st === 'convertterminated') {
                        $result = array('ok' => false, 'stage' => 'convert', 'message' => 'تبدیل ناموفق بود.');
                        break;
                    }
                    if ($text !== null) {
                        break;   // متن آماده است؛ نیازی به انتظار بیشتر نیست
                    }
                    sleep(2);
                }
                if ($result === null || $result['ok'] === false) {
                    // اگر متن از checkconvert نیامد، فایل خروجی را دانلود می‌کنیم
                    if ($text === null && $downloadUrl !== '') {
                        $dl = download_output($downloadUrl);
                        if ($dl['ok']) {
                            $body = $dl['body'];
                            if (in_array($dl['suffix'], array('txt', 'json', 'csv', 'xml', 'html', 'htm'), true)) {
                                $text = $body;
                            } else {
                                $extOut = preg_replace('/[^a-z0-9]/', '', $dl['suffix'] ?: 'docx');
                                $safeName = 'fk-' . date('Ymd-His') . '-' . bin2hex(random_bytes(4)) . '.' . $extOut;
                                @mkdir(UPLOAD_DIR, 0700, true);
                                if (@file_put_contents(UPLOAD_DIR . '/' . $safeName, $body) !== false) {
                                    $savedName = $safeName;
                                }
                            }
                        } elseif ($text === null) {
                            $result = array('ok' => false, 'stage' => 'download', 'message' => $dl['message']);
                        }
                    }
                }
                if ($text !== null || $savedName !== '') {
                    $result = array('ok' => true, 'text' => (string) $text, 'pages' => $pages,
                        'file_token' => $fileToken, 'progress' => 100, 'saved' => $savedName);
                } elseif ($result === null) {
                    $result = array('ok' => false, 'stage' => 'timeout', 'progress' => $progress,
                        'message' => 'زمان انتظار تمام شد. فایل بزرگ است؛ دوباره تلاش کنید.');
                }
                if ($delete_after) {
                    call_gateway(array('command' => 'deletefile', 'filetoken' => $fileToken));
                }
            }
        }
    }
    $busy = false;
}

/* ══════════════════════════ نمایش ══════════════════════════ */

$flash = take_flash();
$logged = is_logged_in();
$tokenSet = token_is_set();
$tokenMasked = mask((string) (load_config()['token'] ?? ''));
$hasCurl = function_exists('curl_init');
$hasFileinfo = function_exists('finfo_open');
$phpOk = version_compare(PHP_VERSION, '7.4', '>=');
$uploadMax = ini_get('upload_max_filesize');
$postMax = ini_get('post_max_size');
?>
<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title><?= h(APP_TITLE) ?></title>
<style>
  :root{--bg:#0b0d12;--card:#141824;--line:#252c3b;--txt:#eef1f7;--dim:#98a2b8;--gold:#d4af37;--teal:#2dd4bf;--red:#f0616d;--green:#3ecf8e}
  *{box-sizing:border-box}
  body{margin:0;background:radial-gradient(1200px 600px at 80% -10%,#1a2233 0%,#0b0d12 55%) fixed;color:var(--txt);
       font-family:Vazirmatn,Tahoma,system-ui,sans-serif;line-height:1.9;padding:16px}
  .wrap{max-width:900px;margin:0 auto}
  .brand{display:flex;align-items:center;gap:12px;margin:18px 0 22px}
  .mark{width:44px;height:44px;border-radius:12px;background:linear-gradient(135deg,#f5e6a8,#d4af37);
        display:grid;place-items:center;color:#1a1508;font-weight:800;font-size:18px}
  h1{font-size:20px;margin:0}
  .sub{color:var(--dim);font-size:12px}
  .card{background:linear-gradient(180deg,#151a26,#12161f);border:1px solid var(--line);border-radius:16px;padding:18px;margin-bottom:14px}
  .card h2{font-size:15px;margin:0 0 12px;display:flex;align-items:center;gap:8px}
  label{display:block;margin:10px 0 6px;font-size:12px;color:var(--dim)}
  input[type=password],input[type=text],input[type=file],select{width:100%;padding:11px 12px;border-radius:10px;
       border:1px solid var(--line);background:#0e121b;color:var(--txt);font-family:inherit;font-size:14px}
  input[type=file]{padding:9px}
  .row{display:flex;gap:10px;flex-wrap:wrap}
  .row>*{flex:1;min-width:160px}
  button{padding:11px 18px;border-radius:10px;border:1px solid var(--line);background:#1b2130;color:var(--txt);
         font-family:inherit;font-size:14px;cursor:pointer;font-weight:600}
  button.primary{background:linear-gradient(135deg,#e8d99a,#d4af37);border-color:#d4af37;color:#231c07}
  button.danger{background:#2a1620;border-color:#5c2433;color:#ffb3bd}
  button.ghost{background:transparent}
  button:hover{filter:brightness(1.1)}
  .muted{color:var(--dim);font-size:12px;margin:6px 0 0}
  .pill{display:inline-block;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700}
  .pill.ok{background:rgba(62,207,142,.14);color:var(--green);border:1px solid rgba(62,207,142,.3)}
  .pill.bad{background:rgba(240,97,109,.13);color:var(--red);border:1px solid rgba(240,97,109,.3)}
  .flash{padding:12px 14px;border-radius:12px;margin-bottom:12px;font-size:13px;border:1px solid}
  .flash.ok{background:rgba(62,207,142,.1);border-color:rgba(62,207,142,.35);color:#b8f2d6}
  .flash.error{background:rgba(240,97,109,.1);border-color:rgba(240,97,109,.35);color:#ffc4ca}
  table{width:100%;border-collapse:collapse;font-size:12px}
  td{padding:7px 4px;border-bottom:1px solid var(--line);color:var(--dim)}
  td:last-child{color:var(--txt);text-align:left}
  pre{background:#0a0d14;border:1px solid var(--line);border-radius:12px;padding:14px;overflow:auto;white-space:pre-wrap;
      direction:rtl;font-size:13px;max-height:420px;font-family:Vazirmatn,Tahoma,monospace}
  .kpi{display:flex;gap:14px;flex-wrap:wrap;margin-top:8px}
  .kpi div{background:#0e121b;border:1px solid var(--line);border-radius:12px;padding:10px 14px;font-size:12px;color:var(--dim)}
  .kpi b{display:block;font-size:18px;color:var(--txt)}
  .foot{color:#5d6779;font-size:11px;text-align:center;margin:22px 0 10px}
  .ltr{direction:ltr;text-align:left;font-family:ui-monospace,monospace}
  form.inline{display:inline}
</style>
</head>
<body>
<div class="wrap">
  <div class="brand">
    <div class="mark">ف</div>
    <div>
      <h1><?= h(APP_TITLE) ?></h1>
      <div class="sub">نسخهٔ آزمایشی PHP — WAMP / XAMPP</div>
    </div>
  </div>

  <?php if ($flash): ?>
    <div class="flash <?= $flash['type'] === 'ok' ? 'ok' : 'error' ?>"><?= h($flash['message']) ?></div>
  <?php endif; ?>

  <?php if (!$phpOk || !$hasCurl): ?>
    <div class="card">
      <h2>⚠️ پیش‌نیاز</h2>
      <?php if (!$phpOk): ?><p class="muted">نسخهٔ PHP این سرور <?= h(PHP_VERSION) ?> است؛ حداقل 7.4 لازم است.</p><?php endif; ?>
      <?php if (!$hasCurl): ?>
        <p class="muted">افزونهٔ <b class="ltr">curl</b> در PHP فعال نیست. در WAMP: آیکن سبز → PHP → php.ini →
          خط <b class="ltr">;extension=curl</b> را به <b class="ltr">extension=curl</b> تغییر دهید و Apache را ری‌استارت کنید.</p>
      <?php endif; ?>
    </div>
  <?php endif; ?>

  <?php if (!$logged && !password_is_set()): ?>
    <div class="card">
      <h2>🔐 گام ۱ — گذرواژهٔ این ابزار را تعیین کنید</h2>
      <p class="muted">این گذرواژه فقط برای ورود به همین صفحه است تا دیگران از اعتبار شما استفاده نکنند.</p>
      <form method="post" autocomplete="off">
        <input type="hidden" name="action" value="setup_password">
        <input type="hidden" name="csrf" value="<?= h(csrf_token()) ?>">
        <label>گذرواژه (حداقل ۸ کاراکتر)</label>
        <input type="password" name="new_password" required minlength="8" dir="ltr">
        <label>تکرار گذرواژه</label>
        <input type="password" name="confirm_password" required minlength="8" dir="ltr">
        <div class="row" style="margin-top:14px"><button class="primary" type="submit">ذخیره و ادامه</button></div>
      </form>
    </div>

  <?php elseif (!$logged): ?>
    <div class="card">
      <h2>🔑 ورود</h2>
      <form method="post" autocomplete="off">
        <input type="hidden" name="action" value="login">
        <input type="hidden" name="csrf" value="<?= h(csrf_token()) ?>">
        <label>گذرواژه</label>
        <input type="password" name="password" required dir="ltr" autofocus>
        <div class="row" style="margin-top:14px"><button class="primary" type="submit">ورود</button></div>
      </form>
    </div>

  <?php else: ?>

    <div class="card">
      <h2>☁️ توکن سرویس ابری
        <span class="pill <?= $tokenSet ? 'ok' : 'bad' ?>"><?= $tokenSet ? 'ثبت‌شده' : 'ثبت نشده' ?></span>
      </h2>
      <table>
        <tr><td>آدرس درگاه</td><td><?= gateway_url() !== '' ? 'آماده (درون برنامه)' : 'نامعتبر' ?></td></tr>
        <tr><td>اثر انگشت مخفی</td><td class="ltr"><?= $tokenSet ? h($tokenMasked) : '—' ?></td></tr>
        <tr><td>رمزنگاری فایل تنظیمات</td><td>خارج از web root نیست — با .htaccess مسدود شده</td></tr>
      </table>
      <form method="post" autocomplete="off" style="margin-top:12px">
        <input type="hidden" name="action" value="save_token">
        <input type="hidden" name="csrf" value="<?= h(csrf_token()) ?>">
        <label><?= $tokenSet ? 'جایگزینی توکن' : 'توکن را بچسبانید' ?></label>
        <input type="text" name="token" dir="ltr" placeholder="توکن ۲۰ یا ۲۴ کاراکتری" required>
        <div class="row" style="margin-top:12px">
          <button class="primary" type="submit">ذخیره توکن</button>
          <button type="submit" name="action" value="test_credit" formnovalidate>تست اعتبار</button>
          <?php if ($tokenSet): ?>
            <button class="danger" type="submit" name="action" value="clear_token" formnovalidate>حذف توکن</button>
          <?php endif; ?>
        </div>
      </form>
      <p class="muted">پس از ذخیره، مقدار توکن قابل بازیابی نیست؛ فقط می‌توانید جایگزین کنید.</p>
    </div>

    <div class="card">
      <h2>📄 پردازش فایل</h2>
      <form method="post" enctype="multipart/form-data" autocomplete="off" id="process-form">
        <input type="hidden" name="action" value="process">
        <input type="hidden" name="csrf" value="<?= h(csrf_token()) ?>">
        <label>فایل (عکس، PDF یا صوتی)</label>
        <input type="file" name="document" required accept=".pdf,.jpg,.jpeg,.png,.bmp,.tif,.tiff,.mp3,.wav,.m4a,.mp4,.ogg,.flac,.3gp">
        <div class="row" style="margin-top:10px">
          <div>
            <label>روش تبدیل</label>
            <select name="method">
              <option value="4" selected>۴ — استخراج متن (OCR)</option>
              <option value="1">۱ — حالت اول</option>
              <option value="2">۲ — حالت دوم</option>
              <option value="3">۳ — حالت سوم</option>
            </select>
          </div>
          <div>
            <label>قالب خروجی</label>
            <select name="output">
              <option value="txtrawjson">متن + مختصات (JSON)</option>
              <option value="txtraw">متن خام</option>
              <option value="txt">فقط متن</option>
              <option value="keeplayout">حفظ چیدمان</option>
            </select>
          </div>
        </div>
        <label style="display:flex;align-items:center;gap:8px;margin-top:12px">
          <input type="checkbox" name="delete_after" value="1" checked style="width:auto">
          حذف فایل از سرور ابری پس از پردازش
        </label>
        <div class="row" style="margin-top:12px">
          <button class="primary" type="submit">ارسال و خوانش</button>
        </div>
      </form>
      <p class="muted">حداکثر حجم در این سرور: <b class="ltr"><?= h((string) $uploadMax) ?></b> —
        حداکثر POST: <b class="ltr"><?= h((string) $postMax) ?></b></p>
      <p class="muted">اگر خطای «توکن فایل برنگشت» گرفتید، صفحهٔ
        <a href="diag.php" style="color:#d4af37">عیب‌یابی (diag.php)</a> پاسخ کامل سرور را نشان می‌دهد.</p>
    </div>

    <?php if ($result !== null): ?>
      <div class="card">
        <h2><?= $result['ok'] ? '✅ نتیجه' : '❌ خطا' ?></h2>
        <?php if ($result['ok']): ?>
          <div class="kpi">
            <div>تعداد صفحه<b><?= (int) ($result['pages'] ?? 0) ?></b></div>
            <div>توکن فایل<b class="ltr" style="font-size:12px"><?= h((string) ($result['file_token'] ?? '')) ?></b></div>
          </div>
          <?php if (!empty($result['saved'])): ?>
            <p class="muted">فایل خروجی ذخیره شد:
              <b class="ltr"><?= h((string) $result['saved']) ?></b> —
              از پوشهٔ <b class="ltr">fk-uploads</b> بردارید.</p>
          <?php endif; ?>
          <pre style="margin-top:12px"><?= h((string) ($result['text'] ?? '')) ?></pre>
        <?php else: ?>
          <p class="muted">مرحله: <b class="ltr"><?= h((string) ($result['stage'] ?? '')) ?></b></p>
          <div class="flash error" style="margin:0"><?= h((string) ($result['message'] ?? '')) ?></div>
          <?php if (!empty($result['hint'])): ?>
            <p class="muted" style="margin-top:10px">
              🔧 <b>عیب‌یابی:</b> <?= h((string) $result['hint']) ?>
              (<a href="diag.php" style="color:#d4af37">diag.php</a>)
            </p>
          <?php endif; ?>
        <?php endif; ?>
      </div>
    <?php endif; ?>

    <div class="card">
      <h2>🖥 اطلاعات سرور</h2>
      <table>
        <tr><td>PHP</td><td class="ltr"><?= h(PHP_VERSION) ?></td></tr>
        <tr><td>curl</td><td><?= $hasCurl ? 'فعال' : 'غیرفعال' ?></td></tr>
        <tr><td>fileinfo</td><td><?= $hasFileinfo ? 'فعال' : 'غیرفعال' ?></td></tr>
        <tr><td>mbstring</td><td><?= function_exists('mb_substr') ? 'فعال' : 'غیرفعال' ?></td></tr>
        <tr><td>حداکثر آپلود</td><td class="ltr"><?= h((string) $uploadMax) ?></td></tr>
        <tr><td>حداکثر POST</td><td class="ltr"><?= h((string) $postMax) ?></td></tr>
      </table>
    </div>

    <form method="post" class="inline">
      <input type="hidden" name="action" value="logout">
      <input type="hidden" name="csrf" value="<?= h(csrf_token()) ?>">
      <button class="ghost" type="submit">خروج</button>
    </form>
  <?php endif; ?>

  <div class="foot">
    فاکتورخوان — نسخهٔ آزمایشی PHP · توکن هرگز در صفحه نمایش داده نمی‌شود ·
    <span class="ltr"><?= h(date('Y-m-d H:i')) ?></span>
  </div>
</div>
</body>
</html>
