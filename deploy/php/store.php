<?php
/**
 * لایهٔ دادهٔ پنل — کاربر، طرح، کد اشتراک، اشتراک، پیام، گزارش رویداد
 * =====================================================================
 * نسخهٔ پایتون این‌ها را در MySQL نگه می‌دارد. نسخهٔ PHP باید همان
 * قابلیت‌ها را داشته باشد (چند کاربر، اشتراک، کد فعال‌سازی، پنل مدیریت،
 * گزارش رویداد) ولی روی WAMP/XAMPP کاربر نباید دیتابیس بسازد و import
 * کند. پس:
 *
 *   • هر جدول یک فایل JSON است (fk-data/<table>.json)
 *   • نوشتن اتمیک است: فایل موقت + rename (توسط fk_db_save)
 *   • شمارندهٔ id در همان فایل نگه داشته می‌شود تا پس از حذف، شناسه
 *     دوباره استفاده نشود (حذف فاکتور ۳ و ساخت فاکتور جدیدی با id=3
 *     یعنی لینک‌های قدیمی به فاکتور اشتباه اشاره کنند)
 *
 * چرا JSON و نه SQLite؟ چون SQLite روی بسیاری از نصب‌های WAMP ویندوز
 * افزونهٔ pdo_sqlite فعال نیست، و کاربری که فقط می‌خواهد فاکتورش را
 * بخواند نباید درگیر php.ini شود. حجم داده‌های این برنامه (چند هزار
 * رکورد) خیلی کمتر از آن است که JSON کند شود.
 *
 * قیدهای امنیتی که رعایت می‌شوند:
 *   • رمز با password_hash (bcrypt/argon) — نه md5، نه sha1
 *   • توکن سرویس ابری هرگز در خروجی JSON نمی‌آید (mask_token)
 *   • هر فاکتور/کار به user_id خودش گره می‌خورد
 *   • پوشهٔ داده با .htaccess و چک داخلی محافظت می‌شود
 */

declare(strict_types=1);

const FK_DATA = __DIR__ . '/fk-data';

/** فهرست جدول‌ها و کلیدهای پیش‌فرضشان */
function fk_db_tables(): array
{
    return array(
        'users', 'plans', 'keys', 'subscriptions', 'invoices',
        'jobs', 'audit', 'tickets', 'settings', 'devices', 'meta',
    );
}

function fk_db_dir(): string
{
    if (!is_dir(FK_DATA)) {
        @mkdir(FK_DATA, 0700, true);
    }
    return FK_DATA;
}

function fk_db_file(string $table): string
{
    $table = (string) preg_replace('/[^a-z_]/', '', strtolower($table));
    if (!in_array($table, fk_db_tables(), true)) {
        $table = 'meta';
    }
    return fk_db_dir() . '/' . $table . '.json';
}

/**
 * خواندن یک جدول.
 *
 * ساختار فایل:
 *   {"next_id": 4, "rows": [ {"id":1,...}, ... ]}
 *
 * `next_id` جدا از rows نگه داشته می‌شود تا حذف رکورد، شناسه را آزاد
 * نکند. این همان قاعده‌ای است که در نسخهٔ پایتون AUTO_INCREMENT تضمین
 * می‌کرد.
 */
function fk_db_load(string $table): array
{
    /* کش در $GLOBALS نگه داشته می‌شود، نه در static محلی.
       چرا؟ چون fk_db_save هم static جدا داشت و نوشتن، کش خواندن را
       به‌روز نمی‌کرد. نتیجه این باگ: در همان درخواست اول، سه طرح از
       چهار طرح با شناسهٔ ۱ نوشته می‌شد و «insert» دومی/سومی را به
       بهانهٔ شناسهٔ تکراری رد می‌کرد — بعد از آن هم هیچ‌وقت دوباره
       ساخته نمی‌شدند چون users پر شده بود. حالا هر دو تابع یک کش
       مشترک دارند و نوشتن، خواندن بعدی را تازه می‌کند. */
    if (!isset($GLOBALS['__fk_db_cache']) || !is_array($GLOBALS['__fk_db_cache'])) {
        $GLOBALS['__fk_db_cache'] = array();
    }
    if (array_key_exists($table, $GLOBALS['__fk_db_cache'])) {
        return $GLOBALS['__fk_db_cache'][$table];
    }
    $file = fk_db_file($table);
    $raw = is_file($file) ? @file_get_contents($file) : false;
    $data = $raw === false ? null : json_decode($raw, true);
    if (!is_array($data) || !isset($data['rows']) || !is_array($data['rows'])) {
        $data = array('next_id' => 1, 'rows' => array());
    }
    if (!isset($data['next_id']) || (int) $data['next_id'] < 1) {
        $data['next_id'] = 1;
        foreach ($data['rows'] as $r) {
            $data['next_id'] = max($data['next_id'], (int) ($r['id'] ?? 0) + 1);
        }
    }
    $GLOBALS['__fk_db_cache'][$table] = $data;
    return $data;
}

/** پاک‌کردن کش یک جدول — پس از نوشتن اتمیک از بیرون */
function fk_db_forget(?string $table = null): void
{
    if ($table === null) {
        $GLOBALS['__fk_db_cache'] = array();
        return;
    }
    unset($GLOBALS['__fk_db_cache'][$table]);
}

/** ذخیرهٔ اتمیک؛ در صورت خطای نوشتن false برمی‌گرداند */
function fk_db_save(string $table, array $data): bool
{
    $file = fk_db_file($table);
    $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($json === false) {
        return false;
    }
    $tmp = $file . '.' . bin2hex(random_bytes(4)) . '.tmp';
    if (@file_put_contents($tmp, $json, LOCK_EX) === false) {
        return false;
    }
    @chmod($tmp, 0600);
    if (!@rename($tmp, $file)) {
        @unlink($tmp);
        return false;
    }
    $GLOBALS['__fk_db_cache'][$table] = $data;
    return true;
}

/* ══════════════════════ عملیات عمومی ══════════════════════ */

/** فهرست همهٔ رکوردهای یک جدول */
function fk_rows(string $table): array
{
    $d = fk_db_load($table);
    return is_array($d['rows']) ? $d['rows'] : array();
}

/** یک رکورد با شناسه؛ null یعنی نیست */
function fk_row(string $table, $id): ?array
{
    $id = (int) $id;
    foreach (fk_rows($table) as $row) {
        if ((int) ($row['id'] ?? 0) === $id) {
            return $row;
        }
    }
    return null;
}

/** اولین رکوردی که $field == $value */
function fk_find(string $table, string $field, $value): ?array
{
    foreach (fk_rows($table) as $row) {
        if ((string) ($row[$field] ?? '') === (string) $value) {
            return $row;
        }
    }
    return null;
}

/** چند رکوردی که شرط را دارند */
function fk_where(string $table, callable $fn): array
{
    $out = array();
    foreach (fk_rows($table) as $row) {
        if ($fn($row)) {
            $out[] = $row;
        }
    }
    return $out;
}

function fk_count(string $table, ?callable $fn = null): int
{
    if ($fn === null) {
        return count(fk_rows($table));
    }
    return count(fk_where($table, $fn));
}

/**
 * افزودن رکورد. اگر id نداشته باشد از next_id گرفته می‌شود.
 * برمی‌گرداند: رکورد ذخیره‌شده (با id) یا null در خطا.
 */
function fk_insert(string $table, array $row): ?array
{
    $data = fk_db_load($table);
    $rows = is_array($data['rows']) ? $data['rows'] : array();
    $next = max(1, (int) ($data['next_id'] ?? 1));
    if (empty($row['id'])) {
        $row['id'] = $next;
        $next++;
    } else {
        $next = max($next, (int) $row['id'] + 1);
        foreach ($rows as $r) {
            if ((int) ($r['id'] ?? 0) === (int) $row['id']) {
                return null;              /* شناسه تکراری */
            }
        }
    }
    $now = fk_now();
    $row += array('created_at' => $now, 'updated_at' => $now);
    $rows[] = $row;
    if (!fk_db_save($table, array('next_id' => $next, 'rows' => $rows))) {
        return null;
    }
    return $row;
}

/** به‌روزرسانی یک رکورد با شناسه؛ برمی‌گرداند رکورد تازه یا null */
function fk_update(string $table, $id, array $patch): ?array
{
    $data = fk_db_load($table);
    $rows = is_array($data['rows']) ? $data['rows'] : array();
    $found = null;
    foreach ($rows as $i => $row) {
        if ((int) ($row['id'] ?? 0) === (int) $id) {
            $rows[$i] = array_merge($row, $patch, array('updated_at' => fk_now()));
            $found = $rows[$i];
            break;
        }
    }
    if ($found === null) {
        return null;
    }
    if (!fk_db_save($table, array('next_id' => (int) ($data['next_id'] ?? 1), 'rows' => $rows))) {
        return null;
    }
    return $found;
}

/** حذف یک رکورد؛ true اگر حذف شد */
function fk_delete(string $table, $id): bool
{
    $data = fk_db_load($table);
    $rows = array();
    $removed = false;
    foreach ((array) $data['rows'] as $row) {
        if ((int) ($row['id'] ?? 0) === (int) $id) {
            $removed = true;
            continue;
        }
        $rows[] = $row;
    }
    if (!$removed) {
        return false;
    }
    return fk_db_save($table, array('next_id' => (int) ($data['next_id'] ?? 1), 'rows' => $rows));
}

/**
 * حروف کوچک برای جست‌وجوی فارسی — بدون نیاز به mbstring.
 *
 * چرا این تابع؟ روی ویندوز/WAMP افزونهٔ mbstring گاهی خاموش است و
 * `mb_strtolower` در آن حالت خطای مهلک می‌دهد (نه هشدار). جست‌وجو هم
 * نباید به همین دلیل از کار بیفتد. برای الفبای فارسی/عربی «کوچک» و
 * «بزرگ» معنا ندارد، پس strtolower کافی است و برای لاتین هم درست کار
 * می‌کند. اگر mbstring بود، از همان استفاده می‌کنیم (بهتر برای ترکی).
 */
function fk_text_lower(string $text): string
{
    if (function_exists('mb_strtolower')) {
        return mb_strtolower($text, 'UTF-8');
    }
    return strtolower($text);
}

/** طول رشته به نویسه (نه بایت) — با پشتیبان بدون mbstring */
function fk_text_len(string $text): int
{
    if (function_exists('mb_strlen')) {
        return mb_strlen($text, 'UTF-8');
    }
    return (int) preg_match_all('/./us', $text);
}

/** بریدن از ابتدای رشته به نویسه — بدون نصفه‌کردن حروف UTF-8 */
function fk_text_slice(string $text, int $start, ?int $length = null): string
{
    if (function_exists('mb_substr')) {
        return $length === null ? mb_substr($text, $start, null, 'UTF-8')
            : mb_substr($text, $start, $length, 'UTF-8');
    }
    preg_match_all('/./us', $text, $m);
    $chars = $m[0] ?? array();
    $slice = $length === null ? array_slice($chars, $start) : array_slice($chars, $start, $length);
    return implode('', $slice);
}

/** زمان فعلی — همان قالب ISO که نسخهٔ پایتون می‌نویسد */
function fk_now(): string
{
    return gmdate('Y-m-d H:i:s');
}

function fk_ts(?string $at): int
{
    if (!$at) {
        return 0;
    }
    $t = strtotime($at . ' UTC');
    return $t === false ? 0 : $t;
}

function fk_today(): string
{
    return gmdate('Y-m-d');
}

function fk_days_between(?string $from, ?string $to): int
{
    if (!$from || !$to) {
        return 0;
    }
    return (int) floor((fk_ts($to) - fk_ts($from)) / 86400);
}

/* ══════════════════════ کاربران ══════════════════════ */

/**
 * هش رمز. از password_hash استاندارد PHP استفاده می‌شود (bcrypt پیش‌فرض).
 * چرا bcrypt و نه sha256؟ چون sha256 بدون «نمک» و «کندی عمدی» با یک کارت
 * گرافیک در چند دقیقه شکسته می‌شود؛ bcrypt دقیقاً برای همین کند است.
 */
function fk_hash_password(string $password): string
{
    $algo = defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_BCRYPT;
    $hash = @password_hash($password, $algo);
    if (is_string($hash) && $hash !== '') {
        return $hash;
    }
    return (string) password_hash($password, PASSWORD_BCRYPT);
}

function fk_verify_password(string $password, string $hash): bool
{
    if ($password === '' || $hash === '') {
        return false;
    }
    /* سازگاری با هش‌های نسخهٔ پایتون ($pbkdf2-sha256$…) تا اگر کاربر
       فایل دادهٔ نسخهٔ پایتون را آورد، نتواند وارد شود — صریح خطا
       می‌دهیم، نه اینکه «رمز اشتباه» بگوید و کاربر گیج شود. */
    if (strpos($hash, '$pbkdf2-sha256$') === 0) {
        return fk_verify_pbkdf2($password, $hash);
    }
    return @password_verify($password, $hash);
}

/**
 * بررسی هش pbkdf2-sha256 نسخهٔ پایتون (قالب passlib).
 * برای مهاجرت کاربران نسخهٔ پایتون به همین نسخه لازم است.
 */
function fk_verify_pbkdf2(string $password, string $hash): bool
{
    $parts = explode('$', $hash);
    /* ['', 'pbkdf2-sha256', '29000', salt, digest] */
    if (count($parts) !== 5) {
        return false;
    }
    $rounds = (int) $parts[2];
    $salt = base64_decode(strtr($parts[3], '.', '+') . str_repeat('=', (4 - strlen($parts[3]) % 4) % 4), true);
    $digest = base64_decode(strtr($parts[4], '.', '+') . str_repeat('=', (4 - strlen($parts[4]) % 4) % 4), true);
    if ($salt === false || $digest === false || $rounds < 1) {
        return false;
    }
    $calc = hash_pbkdf2('sha256', $password, $salt, $rounds, strlen($digest), true);
    return hash_equals($digest, $calc);
}

/** آیا هش باید بازسازی شود؟ (الگوریتم قدیمی یا bcrypt به‌جای argon2) */
function fk_needs_rehash(string $hash): bool
{
    if (strpos($hash, '$pbkdf2-sha256$') === 0) {
        return true;
    }
    $algo = defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_BCRYPT;
    return (bool) @password_needs_rehash($hash, $algo);
}

/** کاربر جاری (از نشست) یا null */
function fk_user(): ?array
{
    static $cached = false;
    if ($cached !== false) {
        return $cached;
    }
    if (session_status() !== PHP_SESSION_ACTIVE) {
        start_session();
    }
    $id = (int) ($_SESSION['uid'] ?? 0);
    if ($id < 1) {
        $cached = null;
        return null;
    }
    $user = fk_row('users', $id);
    if (!$user || empty($user['is_active'])) {
        $cached = null;
        return null;
    }
    $cached = $user;
    return $user;
}

function fk_login_user(array $user): void
{
    if (session_status() !== PHP_SESSION_ACTIVE) {
        start_session();
    }
    /* شناسهٔ نشست را عوض کن: جلوگیری از session fixation (کهنهٔ حمله)
       — کاربری که قبل از ورود شناسه‌ای گرفته، نباید همان شناسه را بعد
       از ورود معتبر ببیند. */
    if (function_exists('session_regenerate_id')) {
        @session_regenerate_id(true);
    }
    $_SESSION['uid'] = (int) $user['id'];
    $_SESSION['role'] = (string) ($user['role'] ?? 'user');
    $_SESSION['login_at'] = time();
    fk_update('users', (int) $user['id'], array(
        'last_login_at' => fk_now(),
        'last_ip' => fk_ip(),
        'failed_attempts' => 0,
        'locked_until' => '',
    ));
}

function fk_logout_user(): void
{
    if (session_status() !== PHP_SESSION_ACTIVE) {
        start_session();
    }
    $_SESSION = array();
    @session_destroy();
}

/** آیا کاربر جاری مدیر است؟ */
function fk_is_admin(?array $user = null): bool
{
    $user = $user ?? fk_user();
    return $user !== null && in_array((string) ($user['role'] ?? ''), array('owner', 'admin'), true);
}

function fk_is_owner(?array $user = null): bool
{
    $user = $user ?? fk_user();
    return $user !== null && (string) ($user['role'] ?? '') === 'owner';
}

function fk_ip(): string
{
    return substr((string) ($_SERVER['REMOTE_ADDR'] ?? ''), 0, 64);
}

function fk_user_agent(): string
{
    return substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 300);
}

/**
 * حرف اول نام و نام خانوادگی — بدون وابستگی به mbstring.
 *
 * چرا این تابع کوچک دو بار بازنویسی شد؟ چون نسخهٔ اول `substr` را روی
 * UTF-8 به کار می‌برد و «کاربر» را نصفه برمی‌داشت؛ نسخهٔ دوم `mb_substr`
 * را فرض می‌کرد و روی سرورهایی که mbstring ندارند (و در php-wasm)
 * رشتهٔ خالی می‌داد — بعد json_encode روی دادهٔ خراب، پاسخ API را
 * کامل خالی می‌کرد و کاربر فقط «خطای نامشخص» می‌دید.
 *
 * راه‌حل درست: با preg_match/u یک نویسهٔ کامل UTF-8 بردار؛ pcre همیشه
 * هست و برای فارسی/عربی/لاتین یکسان کار می‌کند.
 */
function fk_first_char(string $text): string
{
    if ($text === '') {
        return '';
    }
    if (preg_match('/^./u', $text, $m)) {
        return $m[0];
    }
    return substr($text, 0, 1);
}

function fk_initials(array $user): string
{
    $name = trim((string) ($user['full_name'] ?? ''));
    if ($name === '') {
        $name = (string) ($user['email'] ?? '');
    }
    $parts = preg_split('/\s+/u', $name) ?: array();
    $parts = array_values(array_filter($parts, static function ($p): bool {
        return $p !== '';
    }));
    if (!$parts) {
        return '؟';
    }
    return fk_first_char($parts[0]) . (count($parts) > 1 ? fk_first_char($parts[1]) : '');
}

/* ══════════════════════ طرح‌ها و اشتراک ══════════════════════ */

/** همان چهار طرح نسخهٔ پایتون (backend/app/seed.py) */
function fk_plan_seeds(): array
{
    return array(
        array(
            'code' => 'trial', 'name' => 'دوره آزمایشی',
            'tagline' => 'برای شروع و آشنایی با سامانه',
            'price' => 0, 'duration_days' => 14, 'support_days' => 14,
            'page_quota' => 50, 'max_devices' => 1, 'sort_order' => 1,
            'is_active' => true, 'is_featured' => false,
            'features' => array('۵۰ صفحه پردازش', 'خوانش ابری و لوکال', 'خروجی اکسل و CSV', 'پشتیبانی پایه'),
        ),
        array(
            'code' => 'pro-month', 'name' => 'حرفه‌ای یک‌ماهه',
            'tagline' => 'مناسب استفاده ماهانه در دفتر',
            'price' => 3500000, 'duration_days' => 30, 'support_days' => 30,
            'page_quota' => 1500, 'max_devices' => 1, 'sort_order' => 2,
            'is_active' => true, 'is_featured' => false,
            'features' => array('۱٫۵۰۰ صفحه پردازش', 'همه روش‌های خوانش', 'خروجی اکسل، CSV و JSON', 'یک دستگاه', 'پشتیبانی یک‌ماهه'),
        ),
        array(
            'code' => 'pro-year', 'name' => 'حرفه‌ای یک‌ساله',
            'tagline' => 'محبوب‌ترین انتخاب کسب‌وکارها',
            'price' => 29000000, 'duration_days' => 365, 'support_days' => 365,
            'page_quota' => 20000, 'max_devices' => 2, 'sort_order' => 3,
            'is_active' => true, 'is_featured' => true,
            'features' => array(
                '۲۰٫۰۰۰ صفحه پردازش', 'همه روش‌های خوانش', 'همه قالب‌های خروجی',
                'دو دستگاه', 'پشتیبانی اختصاصی یک‌ساله', 'به‌روزرسانی رایگان نسخه',
            ),
        ),
        array(
            'code' => 'enterprise-year', 'name' => 'سازمانی یک‌ساله',
            'tagline' => 'برای تیم‌های مالی و شرکت‌ها',
            'price' => 89000000, 'duration_days' => 365, 'support_days' => 365,
            'page_quota' => 100000, 'max_devices' => 10, 'sort_order' => 4,
            'is_active' => true, 'is_featured' => false,
            'features' => array(
                '۱۰۰٫۰۰۰ صفحه پردازش', 'ده دستگاه', 'نصب روی سرور اختصاصی',
                'پشتیبانی و آموزش تیم', 'تنظیم الگوی خوانش اختصاصی',
            ),
        ),
    );
}

function fk_seed_plans(): void
{
    foreach (fk_plan_seeds() as $seed) {
        if (!fk_find('plans', 'code', $seed['code'])) {
            fk_insert('plans', $seed);
        }
    }
}

/** اشتراک یک کاربر (یا null) */
function fk_subscription(int $userId): ?array
{
    foreach (fk_rows('subscriptions') as $s) {
        if ((int) ($s['user_id'] ?? 0) === $userId) {
            return $s;
        }
    }
    return null;
}

/** اشتراک کاربر، و اگر نداشت دورهٔ آزمایشی بساز */
function fk_ensure_subscription(int $userId): array
{
    $sub = fk_subscription($userId);
    if ($sub) {
        return $sub;
    }
    $trialDays = (int) fk_cfg_get('trial_days', 14);
    $trialPages = (int) fk_cfg_get('trial_pages', 50);
    $now = time();
    $created = fk_insert('subscriptions', array(
        'user_id' => $userId,
        'plan_id' => null,
        'license_key_id' => null,
        'status' => 'trialing',
        'starts_at' => gmdate('Y-m-d H:i:s', $now),
        'ends_at' => gmdate('Y-m-d H:i:s', $now + $trialDays * 86400),
        'support_until' => gmdate('Y-m-d H:i:s', $now + $trialDays * 86400),
        'pages_used' => 0,
        'pages_quota' => $trialPages,
        'devices' => '',
        'notes' => 'دوره آزمایشی',
    ));
    return $created ?? array();
}

/** آیا این اشتراک معتبر است؟ (منطق Subscription.is_valid پایتون) */
function fk_sub_valid(array $sub): bool
{
    $status = (string) ($sub['status'] ?? '');
    if ($status === 'blocked' || $status === 'expired') {
        return false;
    }
    $ends = (string) ($sub['ends_at'] ?? '');
    if ($ends !== '' && fk_ts($ends) < time()) {
        return false;
    }
    return in_array($status, array('active', 'trialing'), true);
}

function fk_sub_days_left(array $sub): int
{
    $ends = (string) ($sub['ends_at'] ?? '');
    if ($ends === '') {
        return 0;
    }
    return max((int) floor((fk_ts($ends) - time()) / 86400), 0);
}

/* ══════════════════════ تنظیمات سامانه ══════════════════════ */

/** پیش‌فرض‌های تنظیمات — همان کلیدهای نسخهٔ پایتون */
function fk_cfg_defaults(): array
{
    return array(
        'app_name' => 'فاکتورخوان',
        'announcement' => '',
        'registration_open' => '1',
        'license_required' => '0',
        'trial_days' => '14',
        'trial_pages' => '50',
        'support_phone' => '',
        'support_email' => '',
        'support_telegram' => '',
        'max_upload_mb' => '25',
    );
}

function fk_cfg_all(): array
{
    $out = fk_cfg_defaults();
    foreach (fk_rows('settings') as $row) {
        $key = (string) ($row['key'] ?? '');
        if ($key !== '') {
            $out[$key] = (string) ($row['value'] ?? '');
        }
    }
    return $out;
}

function fk_cfg_get(string $key, $default = '')
{
    static $cache = null;
    if ($cache === null) {
        $cache = fk_cfg_all();
    }
    if (array_key_exists($key, $cache)) {
        return $cache[$key];
    }
    $defaults = fk_cfg_defaults();
    return $defaults[$key] ?? $default;
}

function fk_cfg_set(string $key, string $value): void
{
    foreach (fk_rows('settings') as $row) {
        if ((string) ($row['key'] ?? '') === $key) {
            fk_update('settings', (int) $row['id'], array('value' => $value));
            return;
        }
    }
    fk_insert('settings', array('key' => $key, 'value' => $value, 'is_secret' => false));
}

function fk_cfg_bool(string $key, bool $default = false): bool
{
    $v = fk_cfg_get($key, $default ? '1' : '0');
    return in_array((string) $v, array('1', 'true', 'yes', 'on'), true);
}

/* ══════════════════════ گزارش رویداد ══════════════════════ */

/**
 * ثبت رویداد. همان جدول audit_logs نسخهٔ پایتون.
 * هیچ‌وقت رمز یا توکن در detail نمی‌نشیند — فراخوان باید مراقب باشد.
 */
function fk_audit(?array $user, string $action, string $entity = '', $entityId = '', string $detail = ''): void
{
    fk_insert('audit', array(
        'user_id' => $user['id'] ?? null,
        'actor' => (string) ($user['email'] ?? ($user['full_name'] ?? 'سیستم')),
        'action' => substr($action, 0, 60),
        'entity' => substr($entity, 0, 60),
        'entity_id' => substr((string) $entityId, 0, 60),
        'detail' => substr($detail, 0, 500),
        'ip' => fk_ip(),
        'user_agent' => fk_user_agent(),
    ));
}

/* ══════════════════════ کد اشتراک ══════════════════════ */

function fk_license_wellformed(string $key): bool
{
    return (bool) preg_match('/^FK-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/', $key);
}

function fk_license_normalize(string $key): string
{
    $key = strtoupper(trim(str_replace(' ', '', $key)));
    if ($key !== '' && strpos($key, 'FK-') !== 0) {
        $key = 'FK-' . $key;
    }
    return $key;
}

function fk_license_generate(): string
{
    $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   /* بدون I/O/0/1 برای خوانایی */
    $parts = array();
    for ($i = 0; $i < 4; $i++) {
        $chunk = '';
        for ($j = 0; $j < 4; $j++) {
            $chunk .= $alphabet[random_int(0, strlen($alphabet) - 1)];
        }
        $parts[] = $chunk;
    }
    return 'FK-' . implode('-', $parts);
}

/**
 * فعال‌سازی کد اشتراک برای یک کاربر — همان منطق _apply_license پایتون.
 *
 * @return array{ok:bool,message:string,plan?:string,ends_at?:string,pages?:int}
 */
function fk_license_redeem(int $userId, string $rawKey): array
{
    $value = fk_license_normalize($rawKey);
    if (!fk_license_wellformed($value)) {
        return array('ok' => false, 'message' => 'قالب کد اشتراک درست نیست. نمونه: FK-ABCD-2345-WXYZ-6789');
    }
    $key = fk_find('keys', 'key', $value);
    if (!$key) {
        return array('ok' => false, 'message' => 'کد اشتراک یافت نشد.');
    }
    if ((string) ($key['status'] ?? '') !== 'unused') {
        return array('ok' => false, 'message' => 'این کد اشتراک قبلاً استفاده یا لغو شده است.');
    }
    $expires = (string) ($key['expires_at'] ?? '');
    if ($expires !== '' && fk_ts($expires) < time()) {
        return array('ok' => false, 'message' => 'این کد اشتراک منقضی شده است.');
    }
    $plan = fk_row('plans', (int) ($key['plan_id'] ?? 0));
    if (!$plan) {
        return array('ok' => false, 'message' => 'طرح مربوط به این کد در دسترس نیست.');
    }

    $sub = fk_ensure_subscription($userId);
    $base = time();
    $endsAt = (string) ($sub['ends_at'] ?? '');
    if ($endsAt !== '' && fk_ts($endsAt) > $base) {
        $base = fk_ts($endsAt);           /* تمدید روی پایان فعلی سوار می‌شود */
    }
    $days = (int) ($plan['duration_days'] ?? 365);
    $supportDays = (int) ($plan['support_days'] ?? $days);
    $quota = (int) ($sub['pages_quota'] ?? 0) + (int) ($plan['page_quota'] ?? 0);

    fk_update('subscriptions', (int) $sub['id'], array(
        'plan_id' => (int) $plan['id'],
        'license_key_id' => (int) $key['id'],
        'status' => 'active',
        'ends_at' => gmdate('Y-m-d H:i:s', $base + $days * 86400),
        'support_until' => gmdate('Y-m-d H:i:s', $base + $supportDays * 86400),
        'pages_quota' => $quota,
        'pages_used' => 0,
        'notes' => 'فعال‌سازی با کد ' . (string) $plan['name'],
    ));
    fk_update('keys', (int) $key['id'], array(
        'status' => 'used',
        'redeemed_at' => fk_now(),
        'redeemed_by' => $userId,
    ));

    return array(
        'ok' => true,
        'message' => 'اشتراک «' . (string) $plan['name'] . '» فعال شد.',
        'plan' => (string) $plan['name'],
        'ends_at' => gmdate('Y-m-d H:i:s', $base + $days * 86400),
        'pages' => (int) ($plan['page_quota'] ?? 0),
    );
}

/* ══════════════════════ رکوردهای عمومی برای رابط ══════════════════════ */

/** همان ساختار user_public نسخهٔ پایتون */
function fk_user_public(array $user): array
{
    $sub = fk_subscription((int) ($user['id'] ?? 0));
    $devices = $sub ? array_filter(explode(',', (string) ($sub['devices'] ?? ''))) : array();
    return array(
        'id' => (int) ($user['id'] ?? 0),
        'full_name' => (string) ($user['full_name'] ?? ''),
        'email' => (string) ($user['email'] ?? ''),
        'phone' => (string) ($user['phone'] ?? ''),
        'company' => (string) ($user['company'] ?? ''),
        'role' => (string) ($user['role'] ?? 'user'),
        'is_active' => (bool) ($user['is_active'] ?? true),
        'is_admin' => fk_is_admin($user),
        'initials' => fk_initials($user),
        'avatar_color' => (string) ($user['avatar_color'] ?? '#d4af37'),
        'theme' => (string) ($user['theme'] ?? 'dark'),
        'created_at' => (string) ($user['created_at'] ?? ''),
        'last_login_at' => (string) ($user['last_login_at'] ?? ''),
        'device_count' => count($devices),
    );
}

/** همان ساختار plan_public پایتون */
function fk_plan_public(array $plan): array
{
    return array(
        'id' => (int) ($plan['id'] ?? 0),
        'code' => (string) ($plan['code'] ?? ''),
        'name' => (string) ($plan['name'] ?? ''),
        'tagline' => (string) ($plan['tagline'] ?? ''),
        'price' => (int) ($plan['price'] ?? 0),
        'duration_days' => (int) ($plan['duration_days'] ?? 0),
        'support_days' => (int) ($plan['support_days'] ?? 0),
        'page_quota' => (int) ($plan['page_quota'] ?? 0),
        'max_devices' => (int) ($plan['max_devices'] ?? 1),
        'features' => array_values((array) ($plan['features'] ?? array())),
        'is_active' => (bool) ($plan['is_active'] ?? true),
        'is_featured' => (bool) ($plan['is_featured'] ?? false),
        'sort_order' => (int) ($plan['sort_order'] ?? 0),
    );
}

/** همان ساختار subscription_public پایتون */
function fk_sub_public(?array $sub): ?array
{
    if (!$sub) {
        return null;
    }
    $plan = !empty($sub['plan_id']) ? fk_row('plans', (int) $sub['plan_id']) : null;
    $status = (string) ($sub['status'] ?? 'trialing');
    $quota = (int) ($sub['pages_quota'] ?? 0);
    $used = (int) ($sub['pages_used'] ?? 0);
    $devices = array_values(array_filter(explode(',', (string) ($sub['devices'] ?? ''))));
    $supportUntil = (string) ($sub['support_until'] ?? '');
    return array(
        'id' => (int) ($sub['id'] ?? 0),
        'status' => $status,
        'valid' => fk_sub_valid($sub),
        'plan_name' => $plan ? (string) $plan['name'] : ($status === 'trialing' ? 'دوره آزمایشی' : 'بدون طرح'),
        'plan_id' => $sub['plan_id'] ?? null,
        'starts_at' => (string) ($sub['starts_at'] ?? ''),
        'ends_at' => (string) ($sub['ends_at'] ?? ''),
        'support_until' => $supportUntil,
        'days_left' => fk_sub_days_left($sub),
        'pages_used' => $used,
        'pages_quota' => $quota,
        'pages_left' => max($quota - $used, 0),
        'usage_percent' => $quota > 0 ? (int) min(100, round($used / $quota * 100)) : 0,
        'max_devices' => $plan ? (int) ($plan['max_devices'] ?? 1) : 1,
        'device_count' => count($devices),
        'notes' => (string) ($sub['notes'] ?? ''),
        'support_active' => $supportUntil !== '' && fk_ts($supportUntil) >= time(),
    );
}

/** همان ساختار key_public پایتون */
function fk_key_public(array $key): array
{
    $plan = !empty($key['plan_id']) ? fk_row('plans', (int) $key['plan_id']) : null;
    return array(
        'id' => (int) ($key['id'] ?? 0),
        'key' => (string) ($key['key'] ?? ''),
        'plan_id' => (int) ($key['plan_id'] ?? 0),
        'plan_name' => $plan ? (string) $plan['name'] : '',
        'status' => (string) ($key['status'] ?? 'unused'),
        'note' => (string) ($key['note'] ?? ''),
        'created_at' => (string) ($key['created_at'] ?? ''),
        'redeemed_at' => (string) ($key['redeemed_at'] ?? ''),
        'redeemed_by' => $key['redeemed_by'] ?? null,
        'expires_at' => (string) ($key['expires_at'] ?? ''),
    );
}

function fk_ticket_public(array $ticket): array
{
    return array(
        'id' => (int) ($ticket['id'] ?? 0),
        'user_id' => $ticket['user_id'] ?? null,
        'name' => (string) ($ticket['name'] ?? ''),
        'contact' => (string) ($ticket['contact'] ?? ''),
        'subject' => (string) ($ticket['subject'] ?? ''),
        'message' => (string) ($ticket['message'] ?? ''),
        'status' => (string) ($ticket['status'] ?? 'new'),
        'answer' => (string) ($ticket['answer'] ?? ''),
        'created_at' => (string) ($ticket['created_at'] ?? ''),
        'answered_at' => (string) ($ticket['answered_at'] ?? ''),
    );
}

/* ══════════════════════ بوت‌استرپ ══════════════════════ */

/**
 * آماده‌سازی اولیه: پوشه‌ها، طرح‌ها، حساب مالک.
 *
 * حساب مالک: اولین کاربری که ثبت‌نام می‌کند مالک می‌شود (همان قاعدهٔ
 * نسخهٔ پایتون). اگر نصب قبلاً گذرواژه داشته (نسخهٔ تک‌کاربرهٔ PHP)،
 * همان گذرواژه به حساب مالک تبدیل می‌شود تا کاربر مجبور به ثبت‌نام
 * دوباره نشود — مهاجرت باید بی‌درد باشد.
 */
function fk_bootstrap(): array
{
    fk_db_dir();
    fk_seed_plans();

    $info = array('owner' => null, 'migrated' => false);
    if (fk_count('users') > 0) {
        return $info;
    }

    /* مهاجرت از نصب تک‌کاربرهٔ قدیمی */
    $cfg = load_config();
    $legacyHash = (string) ($cfg['password_hash'] ?? '');
    if ($legacyHash !== '') {
        $owner = fk_insert('users', array(
            'full_name' => 'مدیر سامانه',
            'company' => 'فاکتورخوان',
            'email' => 'owner@localhost',
            'phone' => '',
            'password_hash' => $legacyHash,
            'role' => 'owner',
            'is_active' => true,
            'must_change_password' => true,
            'avatar_color' => '#d4af37',
            'theme' => 'dark',
            'failed_attempts' => 0,
            'locked_until' => '',
            'last_login_at' => '',
            'last_ip' => '',
        ));
        if ($owner) {
            $pro = fk_find('plans', 'code', 'enterprise-year');
            fk_insert('subscriptions', array(
                'user_id' => (int) $owner['id'],
                'plan_id' => $pro ? (int) $pro['id'] : null,
                'status' => 'active',
                'starts_at' => gmdate('Y-m-d H:i:s'),
                'ends_at' => gmdate('Y-m-d H:i:s', time() + 3650 * 86400),
                'support_until' => gmdate('Y-m-d H:i:s', time() + 3650 * 86400),
                'pages_quota' => 10000000,
                'pages_used' => 0,
                'devices' => '',
                'notes' => 'حساب مالک سامانه (مهاجرت از نصب تک‌کاربره)',
            ));
            $info['owner'] = array('email' => 'owner@localhost', 'password' => null);
            $info['migrated'] = true;
            fk_audit($owner, 'migrate', 'system', '', 'ساخت حساب مالک از گذرواژهٔ نصب قبلی');
        }
    }
    return $info;
}

/**
 * حذف پوشهٔ داده — فقط برای تست و «شروع از صفر».
 * عمداً هیچ‌جا از رابط کاربری صدا زده نمی‌شود.
 */
function fk_db_reset(): void
{
    foreach (fk_db_tables() as $t) {
        @unlink(fk_db_file($t));
    }
}
