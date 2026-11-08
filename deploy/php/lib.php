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

const FK_CONFIG = __DIR__ . '/fk-config.json';
const FK_JOBS = __DIR__ . '/fk-jobs';
const FK_UPLOADS = __DIR__ . '/fk-uploads';
const FK_LOCK = __DIR__ . '/fk-lock.json';

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
    if (is_dir($savePath) && is_writable($savePath)) {
        @session_save_path($savePath);
    }
    if (@session_save_path() === '' || !@is_writable(@session_save_path())) {
        @session_save_path(sys_get_temp_dir());
    }
    $cookieOk = false;
    if (PHP_VERSION_ID >= 70300) {
        $cookieOk = @session_set_cookie_params(array(
            'lifetime' => 0, 'path' => '/', 'httponly' => true,
            'samesite' => 'Lax', 'secure' => is_https(),
        ));
    }
    if (!$cookieOk) {
        @session_set_cookie_params(0, '/; samesite=Lax', '', is_https(), true);
    }
    session_name('fksid');
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
        '404' => 'اطلاعات ارسالی سرویس ابری درست نبود (کد ۴۰۴).',
        '500' => 'خطای داخلی سرویس ابری (کد ۵۰۰) — گاهی با تلاش دوباره حل می‌شود.',
    );
    if (isset($errors[$st])) {
        return array('ok' => false, 'data' => $data, 'message' => $errors[$st], 'code' => $st);
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

        job_drop_local($job);   // فایل محلی لازم نیست
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

        $payload = array('command' => 'convert', 'filetoken' => $fileToken,
                         'method' => (string) ((int) ($job['method'] ?? 4)));
        $output = (string) ($job['output'] ?? '');
        if ($output !== '') {
            $payload['output'] = $output;
        }
        $conv = call_gateway($payload, null, null, '', 45);

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
        if (in_array($dl['suffix'], array('txt', 'json', 'csv', 'xml', 'html', 'htm'), true)) {
            return job_finish_text($job, $dl['body']);
        }
        $extOut = preg_replace('/[^a-z0-9]/', '', $dl['suffix'] ?: 'docx');
        $safe = 'fk-' . gmdate('Ymd-His') . '-' . bin2hex(random_bytes(3)) . '.' . $extOut;
        @mkdir(FK_UPLOADS, 0700, true);
        if (@file_put_contents(FK_UPLOADS . '/' . $safe, $dl['body']) === false) {
            $job['status'] = 'failed';
            $job['message'] = 'ذخیرهٔ فایل خروجی روی سرور ممکن نشد (دسترسی پوشهٔ fk-uploads).';
            job_save($job);
            return $job;
        }
        $job['saved'] = $safe;
        return job_finish_text($job, '');
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
    }
    $job['status'] = 'done';
    $job['stage'] = 'done';
    $job['progress'] = 100;
    $job['message'] = 'تبدیل کامل شد.';
    /* حذف فایل از سرویس ابری در درخواست بعدی انجام می‌شود تا این پاسخ سریع بماند */
    if (!empty($job['delete_after']) && !empty($job['file_token']) && empty($job['cleaned'])) {
        $job['cleanup_pending'] = true;
    }
    job_drop_local($job);
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
