<?php
/**
 * API نسخهٔ PHP — همان قرارداد نسخهٔ پایتون
 * =========================================
 * رابط کاربری (`web/app.js`) همان رابط نسخهٔ پایتون است و انتظار دارد
 * مسیرها و پاسخ‌ها شکل مشخصی داشته باشند. این فایل آن قرارداد را با
 * ذخیره‌سازی فایلی (store.php) و موتور موجود (engine.php/lib.php) پیاده
 * می‌کند.
 *
 * قاعده‌ها:
 *   • هر پاسخ JSON است: موفق {"…"} و خطا {"detail": "پیام فارسی"}
 *     — همان کلیدی که frontend می‌خواند (api.js: data.detail || data.message)
 *   • هیچ توکنی هرگز در پاسخ نمی‌آید
 *   • هر فاکتور/کار به کاربر جاری گره می‌خورد؛ شناسهٔ حدسی کار نمی‌کند
 *   • درخواست‌های طولانی (OCR) با موتور پس‌زمینهٔ همین نسخه انجام
 *     می‌شوند و API فقط کار را می‌سازد و برمی‌گردد
 */

declare(strict_types=1);

require_once __DIR__ . '/lib.php';
require_once __DIR__ . '/engine.php';
require_once __DIR__ . '/store.php';
require_once __DIR__ . '/data.php';
require_once __DIR__ . '/api_helpers.php';

$action = (string) ($_GET['action'] ?? '');

/* ══════════════════════ پاسخ‌ها ══════════════════════ */

function api_out($data, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function api_fail(string $message, int $status = 400, array $extra = array()): void
{
    api_out(array_merge(array('detail' => $message, 'message' => $message), $extra), $status);
}

/** بدنهٔ JSON درخواست (PUT/PATCH/POST با content-type: application/json) */
function api_json(): array
{
    static $cache = null;
    if ($cache !== null) {
        return $cache;
    }
    $raw = @file_get_contents('php://input');
    $data = $raw ? json_decode($raw, true) : null;
    if (!is_array($data)) {
        $data = array();
    }
    /* فرم‌های معمولی هم پذیرفته شوند (Postman/اکسل/فرم HTML) */
    if (!$data && $_POST) {
        $data = $_POST;
    }
    $cache = $data;
    return $data;
}

/** ورودی یکتای درخواست: JSON، فرم یا query */
function api_input(string $key, $default = '')
{
    $data = api_json();
    if (array_key_exists($key, $data)) {
        return $data[$key];
    }
    if (array_key_exists($key, $_POST)) {
        return $_POST[$key];
    }
    if (array_key_exists($key, $_GET)) {
        return $_GET[$key];
    }
    return $default;
}

function api_int(string $key, int $default = 0): int
{
    $v = api_input($key, $default);
    if (is_array($v)) {
        return $default;
    }
    return (int) preg_replace('/[^\d-]/', '', (string) $v);
}

function api_str(string $key, string $default = ''): string
{
    $v = api_input($key, $default);
    return is_array($v) ? $default : trim((string) $v);
}

function api_bool(string $key, bool $default = false): bool
{
    $v = api_input($key, $default ? '1' : '0');
    if (is_bool($v)) {
        return $v;
    }
    return in_array(strtolower((string) $v), array('1', 'true', 'yes', 'on'), true);
}

/* ══════════════════════ احراز هویت ══════════════════════ */

/** کاربر جاری یا پاسخ ۴۰۱ */
function api_require_user(): array
{
    $user = fk_user();
    if (!$user) {
        api_fail('نشست شما معتبر نیست؛ دوباره وارد شوید.', 401);
    }
    return $user;
}

function api_require_admin(): array
{
    $user = api_require_user();
    if (!fk_is_admin($user)) {
        api_fail('دسترسی به این بخش فقط برای مدیران مجاز است.', 403);
    }
    return $user;
}

/* ══════════════════════ مسیریابی ══════════════════════ */

/* شمارندهٔ سادهٔ تلاش — بدون آن، یک اسکریپت می‌تواند هزار گذرواژه را
   در یک دقیقه امتحان کند. */
function api_rate_guard(string $bucket, int $limit, int $window): void
{
    $file = fk_state_dir() . '/rate-' . preg_replace('/[^a-z0-9_-]/', '', $bucket) . '-' . md5(fk_ip()) . '.json';
    $now = time();
    $hits = array();
    $raw = @file_get_contents($file);
    $old = $raw ? json_decode($raw, true) : null;
    if (is_array($old)) {
        foreach ($old as $t) {
            if ((int) $t > $now - $window) {
                $hits[] = (int) $t;
            }
        }
    }
    if (count($hits) >= $limit) {
        $wait = max(1, (int) (($hits[0] + $window) - $now));
        api_fail('تعداد تلاش زیاد است. ' . $wait . ' ثانیه دیگر دوباره امتحان کنید.', 429);
    }
    $hits[] = $now;
    @file_put_contents($file, json_encode($hits), LOCK_EX);
}

/** پاک کردن شمارندهٔ تلاش (پس از ورود موفق) */
function api_rate_clear(string $bucket): void
{
    @unlink(fk_state_dir() . '/rate-' . preg_replace('/[^a-z0-9_-]/', '', $bucket) . '-' . md5(fk_ip()) . '.json');
}

/**
 * متد HTTP جاری.
 *
 * چرا این تابع لازم شد؟ چون رابط، همان قرارداد REST نسخهٔ پایتون را
 * صدا می‌زند: `POST /api/invoices` برای ساخت، `GET /api/invoices` برای
 * فهرست. api.php قبلاً فقط به action نگاه می‌کرد؛ نتیجه این بود که
 * «دکمهٔ ثبت فاکتور» تازه، به‌جای ساختن، فهرست را برمی‌گرداند و صفحه
 * بی‌صدا چیزی نشان نمی‌داد. همین برای طرح‌ها و کاربران هم بود.
 */
function api_method(): string
{
    return strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
}

/** آیا درخواست از نوع نوشتن است؟ */
function api_is_write(): bool
{
    return in_array(api_method(), array('POST', 'PUT', 'PATCH', 'DELETE'), true);
}

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

start_session();
fk_bootstrap();

switch ($action) {
    /* ════════════════ عمومی ════════════════ */

    case 'meta':
        $owner = fk_owner();
        $contact = (array) ($owner['contact'] ?? array());
        foreach (array('phone' => 'support_phone', 'email' => 'support_email', 'telegram' => 'support_telegram') as $key => $cfgKey) {
            $v = fk_cfg_get($cfgKey, '');
            if ($v !== '') {
                $contact[$key] = $v;
            }
        }
        $owner['contact'] = $contact;
        api_out(array(
            'app' => array(
                'name' => FK_APP_TITLE,
                'title' => FK_APP_TITLE,
                'subtitle' => FK_APP_SUBTITLE,
                'version' => FK_APP_VERSION,
                'edition' => FK_APP_EDITION,
                'engine' => 'php',
            ),
            'owner' => $owner,
            'copyright' => fk_copyright_text(),
            'support_intro' => fk_support_intro(),
            'faq' => fk_faq(),
            'announcement' => (string) fk_cfg_get('announcement', ''),
            'settings' => array(
                'registration_open' => fk_cfg_bool('registration_open', true),
                'license_required' => fk_cfg_bool('license_required', false),
                'trial_days' => fk_cfg_get('trial_days', '14'),
                'trial_pages' => fk_cfg_get('trial_pages', '50'),
                'max_upload_mb' => (int) fk_cfg_get('max_upload_mb', 25),
            ),
            'features_total' => fk_features_total(),
        ));

    case 'features':
        api_out(array('total' => fk_features_total(), 'groups' => fk_feature_groups()));

    case 'health':
        $token = token_is_set();
        api_out(array(
            'ok' => true,
            'database' => array('ok' => is_dir(fk_db_dir()) && is_writable(fk_db_dir()), 'engine' => 'json-files'),
            'cloud' => array('gateway_ready' => gateway_url() !== '', 'token_set' => $token),
            'version' => FK_APP_VERSION,
            'features' => fk_features_total(),
        ));

    case 'announcement':
        api_out(array('text' => (string) fk_cfg_get('announcement', '')));

    case 'support':
        api_rate_guard('support', 8, 600);
        $payload = api_json();
        $user = fk_user();
        $ticket = fk_insert('tickets', array(
            'user_id' => $user['id'] ?? null,
            'name' => substr((string) ($user['full_name'] ?? ($payload['contact'] ?? 'مهمان')), 0, 120),
            'contact' => substr((string) ($payload['contact'] ?? ($user['email'] ?? '')), 0, 120),
            'subject' => substr((string) ($payload['subject'] ?? 'بدون موضوع'), 0, 160),
            'message' => substr((string) ($payload['message'] ?? ''), 0, 4000),
            'status' => 'new',
            'answer' => '',
            'answered_at' => '',
        ));
        if (!$ticket) {
            api_fail('ثبت پیام ممکن نشد. دوباره تلاش کنید.', 500);
        }
        fk_audit($user, 'support_ticket', 'ticket', $ticket['id'], (string) $ticket['subject']);
        api_out(array(
            'ok' => true,
            'id' => (int) $ticket['id'],
            'message' => 'پیام شما ثبت شد. پاسخ از همین بخش پیگیری می‌شود.',
        ), 201);

    /* ════════════════ ثبت‌نام و ورود ════════════════ */

    case 'register':
        api_rate_guard('register', 10, 300);
        $payload = api_json();
        if (!fk_cfg_bool('registration_open', true)) {
            api_fail('ثبت‌نام در این نسخه بسته است. با پشتیبانی تماس بگیرید.', 403);
        }
        $email = strtolower(trim((string) ($payload['email'] ?? '')));
        $password = (string) ($payload['password'] ?? '');
        $fullName = trim((string) ($payload['full_name'] ?? ''));
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            api_fail('ایمیل معتبر نیست.', 422);
        }
        if (strlen($password) < 8) {
            api_fail('گذرواژه باید حداقل ۸ کاراکتر باشد.', 422);
        }
        if ($fullName === '') {
            api_fail('نام و نام خانوادگی را وارد کنید.', 422);
        }
        if (fk_find('users', 'email', $email)) {
            api_fail('این ایمیل قبلاً ثبت شده است.', 409);
        }
        if (fk_count('users') >= 1 && !fk_cfg_bool('registration_open', true)) {
            api_fail('ثبت‌نام بسته است.', 403);
        }

        $isFirst = fk_count('users') === 0;
        $user = fk_insert('users', array(
            'full_name' => substr($fullName, 0, 120),
            'company' => substr(trim((string) ($payload['company'] ?? '')), 0, 160),
            'email' => $email,
            'phone' => substr(trim((string) ($payload['phone'] ?? '')), 0, 32),
            'password_hash' => fk_hash_password($password),
            'role' => $isFirst ? 'owner' : 'user',
            'is_active' => true,
            'must_change_password' => false,
            'avatar_color' => '#d4af37',
            'theme' => 'dark',
            'failed_attempts' => 0,
            'locked_until' => '',
            'last_login_at' => fk_now(),
            'last_ip' => fk_ip(),
        ));
        if (!$user) {
            api_fail('ساخت حساب ممکن نشد.', 500);
        }

        if ($isFirst) {
            /* مالک: طرح سازمانی برای همیشه، مثل نسخهٔ پایتون */
            $pro = fk_find('plans', 'code', 'enterprise-year');
            fk_insert('subscriptions', array(
                'user_id' => (int) $user['id'],
                'plan_id' => $pro ? (int) $pro['id'] : null,
                'status' => 'active',
                'starts_at' => fk_now(),
                'ends_at' => gmdate('Y-m-d H:i:s', time() + 3650 * 86400),
                'support_until' => gmdate('Y-m-d H:i:s', time() + 3650 * 86400),
                'pages_quota' => 10000000,
                'pages_used' => 0,
                'devices' => '',
                'notes' => 'حساب مالک سامانه',
            ));
        } else {
            fk_ensure_subscription((int) $user['id']);
        }

        $license = null;
        $rawKey = trim((string) ($payload['license_key'] ?? ''));
        if ($rawKey !== '') {
            $res = fk_license_redeem((int) $user['id'], $rawKey);
            $license = $res['ok'] ? $res : array('error' => $res['message']);
        }

        fk_login_user($user);
        fk_audit($user, 'register', 'user', (int) $user['id'], 'ثبت‌نام کاربر جدید');
        $user = fk_row('users', (int) $user['id']) ?? $user;
        api_out(array(
            'access_token' => 'session',
            'token_type' => 'session',
            'user' => fk_user_public($user),
            'subscription' => fk_sub_public(fk_subscription((int) $user['id'])),
            'license' => $license,
            'first_user' => $isFirst,
        ), 201);

    case 'login':
        api_rate_guard('login', 8, 900);
        $payload = api_json();
        $email = strtolower(trim((string) ($payload['email'] ?? '')));
        $password = (string) ($payload['password'] ?? '');
        $user = fk_find('users', 'email', $email);

        if ($user) {
            $locked = (string) ($user['locked_until'] ?? '');
            if ($locked !== '' && fk_ts($locked) > time()) {
                $minutes = (int) ceil((fk_ts($locked) - time()) / 60);
                api_fail('حساب موقتاً قفل است. ' . $minutes . ' دقیقه دیگر تلاش کنید.', 429);
            }
        }

        if (!$user || !fk_verify_password($password, (string) ($user['password_hash'] ?? ''))) {
            if ($user) {
                $attempts = (int) ($user['failed_attempts'] ?? 0) + 1;
                $patch = array('failed_attempts' => $attempts);
                if ($attempts >= 6) {
                    $patch['locked_until'] = gmdate('Y-m-d H:i:s', time() + 900);
                    $patch['failed_attempts'] = 0;
                }
                fk_update('users', (int) $user['id'], $patch);
            }
            fk_audit($user, 'login_failed', 'user', $user['id'] ?? '', 'تلاش ناموفق ورود');
            api_fail('ایمیل یا رمز عبور اشتباه است.', 401);
        }
        if (empty($user['is_active'])) {
            api_fail('این حساب غیرفعال شده است. با پشتیبانی تماس بگیرید.', 403);
        }
        if (fk_needs_rehash((string) $user['password_hash'])) {
            fk_update('users', (int) $user['id'], array('password_hash' => fk_hash_password($password)));
        }
        fk_login_user($user);
        api_rate_clear('login');
        fk_ensure_subscription((int) $user['id']);
        fk_audit($user, 'login', 'user', (int) $user['id'], 'ورود موفق');
        $user = fk_row('users', (int) $user['id']) ?? $user;
        api_out(array(
            'access_token' => 'session',
            'token_type' => 'session',
            'user' => fk_user_public($user),
            'subscription' => fk_sub_public(fk_subscription((int) $user['id'])),
        ));

    case 'logout':
        $user = fk_user();
        if ($user) {
            fk_audit($user, 'logout', 'user', (int) $user['id'], 'خروج از حساب');
        }
        fk_logout_user();
        api_out(array('ok' => true));

    case 'me':
        $user = api_require_user();
        fk_ensure_subscription((int) $user['id']);
        api_out(array(
            'user' => fk_user_public($user),
            'subscription' => fk_sub_public(fk_subscription((int) $user['id'])),
            'permissions' => array(
                'admin' => fk_is_admin($user),
                'owner' => fk_is_owner($user),
                'invoices' => true,
                'cloud' => true,
            ),
        ));

    case 'profile':
        $user = api_require_user();
        $payload = api_json();
        $patch = array();
        foreach (array('full_name', 'company', 'phone', 'theme') as $field) {
            if (isset($payload[$field]) && is_string($payload[$field])) {
                $patch[$field] = trim($payload[$field]);
            }
        }
        if ($patch) {
            fk_update('users', (int) $user['id'], $patch);
        }
        fk_audit($user, 'profile_update', 'user', (int) $user['id'], 'ویرایش پروفایل');
        api_out(array('user' => fk_user_public(fk_row('users', (int) $user['id']) ?? $user)));

    case 'change-password':
        $user = api_require_user();
        $payload = api_json();
        $current = (string) ($payload['current_password'] ?? '');
        $new = (string) ($payload['new_password'] ?? '');
        if (!fk_verify_password($current, (string) $user['password_hash'])) {
            api_fail('رمز عبور فعلی درست نیست.', 400);
        }
        if (strlen($new) < 8) {
            api_fail('گذرواژهٔ جدید باید حداقل ۸ کاراکتر باشد.', 422);
        }
        fk_update('users', (int) $user['id'], array(
            'password_hash' => fk_hash_password($new),
            'must_change_password' => false,
        ));
        fk_audit($user, 'password_change', 'user', (int) $user['id'], 'تغییر رمز عبور');
        api_out(array('ok' => true, 'message' => 'رمز عبور با موفقیت تغییر کرد.'));

    case 'devices':
        $user = api_require_user();
        $sub = fk_subscription((int) $user['id']);
        $plan = $sub && !empty($sub['plan_id']) ? fk_row('plans', (int) $sub['plan_id']) : null;
        $items = array();
        foreach (fk_where('devices', static function (array $d) use ($user): bool {
            return (int) ($d['user_id'] ?? 0) === (int) $user['id'];
        }) as $d) {
            $items[] = array(
                'id' => (int) $d['id'],
                'device_id' => (string) ($d['device_id'] ?? ''),
                'label' => (string) ($d['label'] ?? ''),
                'platform' => (string) ($d['platform'] ?? ''),
                'last_seen' => (string) ($d['last_seen'] ?? ''),
            );
        }
        api_out(array('items' => $items, 'limit' => $plan ? (int) ($plan['max_devices'] ?? 1) : 1));

    case 'device-delete':
        $user = api_require_user();
        $id = api_str('id');
        $row = null;
        foreach (fk_where('devices', static function (array $d) use ($user): bool {
            return (int) ($d['user_id'] ?? 0) === (int) $user['id'];
        }) as $d) {
            if ((string) ($d['device_id'] ?? '') === $id) {
                $row = $d;
                break;
            }
        }
        if (!$row) {
            api_fail('دستگاه یافت نشد.', 404);
        }
        fk_delete('devices', (int) $row['id']);
        fk_audit($user, 'device_remove', 'device', $id, 'حذف دستگاه');
        api_out(array('ok' => true));

    /* ════════════════ اشتراک ════════════════ */

    case 'plans':
        $items = array();
        foreach (fk_rows('plans') as $p) {
            if (!empty($p['is_active'])) {
                $items[] = fk_plan_public($p);
            }
        }
        usort($items, static function (array $a, array $b): int {
            return array((int) $a['sort_order'], (int) $a['price']) <=> array((int) $b['sort_order'], (int) $b['price']);
        });
        api_out(array('items' => $items));

    case 'subscription':
        $user = api_require_user();
        $sub = fk_ensure_subscription((int) $user['id']);
        $data = fk_sub_public($sub);
        $plan = !empty($sub['plan_id']) ? fk_row('plans', (int) $sub['plan_id']) : null;
        if ($data && $plan) {
            $data['features'] = array_values((array) ($plan['features'] ?? array()));
        }
        api_out(array('subscription' => $data));

    case 'redeem':
        $user = api_require_user();
        api_rate_guard('redeem', 15, 600);
        $payload = api_json();
        $res = fk_license_redeem((int) $user['id'], (string) ($payload['key'] ?? ''));
        if (!$res['ok']) {
            api_fail($res['message'], 409);
        }
        fk_audit($user, 'license_redeem', 'license', '', 'فعال‌سازی ' . $res['plan']);
        api_out(array(
            'ok' => true,
            'message' => $res['message'],
            'subscription' => fk_sub_public(fk_subscription((int) $user['id'])),
        ));

    case 'usage':
        $user = api_require_user();
        $sub = fk_ensure_subscription((int) $user['id']);
        $pub = fk_sub_public($sub) ?: array();
        api_out(array(
            'pages_used' => (int) ($pub['pages_used'] ?? 0),
            'pages_quota' => (int) ($pub['pages_quota'] ?? 0),
            'pages_left' => (int) ($pub['pages_left'] ?? 0),
            'days_left' => (int) ($pub['days_left'] ?? 0),
            'status' => (string) ($pub['status'] ?? ''),
            'valid' => (bool) ($pub['valid'] ?? false),
            'support_active' => (bool) ($pub['support_active'] ?? false),
            'support_until' => (string) ($pub['support_until'] ?? ''),
        ));

    case 'check-key':
        $key = fk_license_normalize(api_str('key'));
        if (!fk_license_wellformed($key)) {
            api_out(array('valid' => false, 'reason' => 'قالب کد درست نیست.'));
        }
        $row = fk_find('keys', 'key', $key);
        if (!$row) {
            api_out(array('valid' => false, 'reason' => 'کد یافت نشد.'));
        }
        if ((string) ($row['status'] ?? '') !== 'unused') {
            api_out(array('valid' => false, 'reason' => 'این کد قبلاً استفاده شده است.'));
        }
        $plan = fk_row('plans', (int) ($row['plan_id'] ?? 0));
        api_out(array(
            'valid' => true,
            'plan' => $plan ? (string) $plan['name'] : '',
            'duration_days' => $plan ? (int) ($plan['duration_days'] ?? 0) : 0,
            'page_quota' => $plan ? (int) ($plan['page_quota'] ?? 0) : 0,
        ));

    /* ════════════════ خوانش (OCR) ════════════════ */

    case 'ocr-capabilities':
        api_require_user();
        $tokenSet = token_is_set();
        $gateway = gateway_url();
        $aiSet = !empty(load_config()['ai_key'] ?? '');
        api_out(array(
            'cloud' => array(
                'configured' => $tokenSet && $gateway !== '',
                'token_set' => $tokenSet,
                'gateway_ready' => $gateway !== '',
                'methods' => array(1, 2, 3, 4),
                'outputs' => array('txtrawjson', 'txtraw', 'txt', 'jsoncoordinates', 'keeplayout', ''),
                'languages' => fk_languages(),
            ),
            'local' => array(
                'pdf' => true,      /* PDF متنی با استخراج خودِ PHP */
                'image' => false,   /* تصویر بدون موتور ابری خوانده نمی‌شود */
                'audio' => false,
                'ai' => $aiSet,
            ),
            'max_upload_mb' => (int) fk_cfg_get('max_upload_mb', 25),
        ));

    case 'ocr-upload':
        $user = api_require_user();
        api_quota_guard($user);
        api_rate_guard('ocr_upload', 40, 60);
        if (empty($_FILES['file']) || !is_array($_FILES['file'])) {
            api_fail('فایلی ارسال نشد.', 400);
        }
        $file = $_FILES['file'];
        if ((int) ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
            api_fail(upload_error_text((int) ($file['error'] ?? 0)), 400);
        }
        $provider = (string) (api_input('provider', 'cloud') ?: 'cloud');
        $name = (string) ($file['name'] ?? 'document');
        $ext = strtolower((string) pathinfo($name, PATHINFO_EXTENSION));
        $allowed = array('pdf', 'jpg', 'jpeg', 'png', 'bmp', 'tif', 'tiff', 'webp',
                         'mp3', 'wav', 'm4a', 'mp4', 'ogg', 'flac', '3gp', 'mpeg');
        if (!in_array($ext, $allowed, true)) {
            api_fail('قالب فایل مجاز نیست (PDF، تصویر یا فایل صوتی/تصویری).', 400);
        }
        $maxMb = (int) fk_cfg_get('max_upload_mb', 25);
        if ((int) ($file['size'] ?? 0) > $maxMb * 1024 * 1024) {
            api_fail('حجم فایل بیشتر از حد مجاز (' . $maxMb . ' مگابایت) است.', 413);
        }
        if ($provider === 'cloud' && (!token_is_set() || gateway_url() === '')) {
            api_fail('سرویس ابری آماده نیست. توکن را در «پنل مدیریت → سرویس ابری» ثبت کنید.', 409);
        }
        $job = api_job_start($user, $file, array(
            'provider' => $provider,
            'method' => (int) (api_input('method', 4) ?: 4),
            'output' => (string) (api_input('output', 'txtrawjson') ?: 'txtrawjson'),
            'language' => (string) (api_input('language', 'fa') ?: 'fa'),
            'invoice_type' => (string) (api_input('invoice_type', 'printed') ?: 'printed'),
            'delete_after' => api_bool('delete_after', true),
            'file_name' => $name,
        ));
        if (isset($job['error'])) {
            api_fail((string) $job['error'], 400);
        }
        api_out(array('job' => $job), 201);

    case 'ocr-link':
        $user = api_require_user();
        api_quota_guard($user);
        api_rate_guard('ocr_link', 20, 60);
        if (!token_is_set() || gateway_url() === '') {
            api_fail('سرویس ابری آماده نیست.', 409);
        }
        $payload = api_json();
        $link = trim((string) ($payload['filelink'] ?? ''));
        if (!preg_match('#^https?://#i', $link)) {
            api_fail('نشانی فایل معتبر نیست.', 400);
        }
        $job = api_job_start($user, null, array(
            'provider' => 'cloud',
            'method' => max(1, min((int) ($payload['method'] ?? 4), 4)),
            'output' => (string) ($payload['output'] ?? 'txtrawjson'),
            'language' => (string) ($payload['language'] ?? 'fa'),
            'invoice_type' => (string) ($payload['invoice_type'] ?? 'printed'),
            'delete_after' => true,
            'file_name' => substr((string) basename(parse_url($link, PHP_URL_PATH) ?: 'link'), 0, 255),
            'source_link' => $link,
        ));
        if (isset($job['error'])) {
            api_fail((string) $job['error'], 400);
        }
        api_out(array('job' => $job), 201);

    case 'ocr-jobs':
        $user = api_require_user();
        $limit = max(1, min(api_int('limit', 15), 100));
        $withText = api_bool('with_text', false);
        $rows = api_user_jobs($user);
        usort($rows, static function (array $a, array $b): int {
            return strcmp((string) ($b['created_at'] ?? ''), (string) ($a['created_at'] ?? ''));
        });
        $items = array();
        foreach (array_slice($rows, 0, $limit) as $job) {
            $items[] = api_job_public($job, $withText);
        }
        api_out(array('items' => $items, 'total' => count($rows)));

    case 'ocr-job':
        $user = api_require_user();
        $job = api_owned_job($user, api_str('id'));
        if (!$job) {
            api_fail('کار پردازش یافت نشد.', 404);
        }
        /* هر بار که کسی وضعیت را می‌پرسد، اگر کار در جریان است یک قدم
           جلو ببر. این همان کاری است که worker پس‌زمینهٔ پایتون می‌کند،
           ولی بدون نیاز به cron/daemon — روی هاست اشتراکی هم کار می‌کند. */
        if (!job_is_terminal($job)) {
            require_once __DIR__ . '/library.php';
            $job = job_tick($job, 20);
            if (isset($job['deadline']) && (int) $job['deadline'] < time() && !job_is_terminal($job)) {
                $job['status'] = 'failed';
                $job['stage'] = 'failed';
                $job['message'] = 'زمان پردازش به پایان رسید؛ دوباره تلاش کنید.';
                $job['error'] = 'timeout';
            }
            job_save($job);
        }
        api_out(array('job' => api_job_public($job, api_bool('with_text', true))));

    case 'ocr-retry':
        $user = api_require_user();
        $job = api_owned_job($user, api_str('id'));
        if (!$job) {
            api_fail('کار پردازش یافت نشد.', 404);
        }
        $job['status'] = 'queued';
        $job['stage'] = 'queued';
        $job['progress'] = 0;
        $job['error'] = '';
        $job['message'] = 'در صف پردازش…';
        $job['attempts'] = 0;
        $job['deadline'] = time() + 1800;
        job_save($job);
        api_out(array('ok' => true, 'job' => api_job_public($job)));

    case 'ocr-cancel':
        $user = api_require_user();
        $job = api_owned_job($user, api_str('id'));
        if (!$job) {
            api_fail('کار پردازش یافت نشد.', 404);
        }
        $job['status'] = 'cancelled';
        $job['stage'] = 'cancelled';
        $job['message'] = 'پردازش لغو شد.';
        job_save($job);
        api_out(array('ok' => true));

    case 'ocr-delete':
        $user = api_require_user();
        $job = api_owned_job($user, api_str('id'));
        if (!$job) {
            api_fail('کار پردازش یافت نشد.', 404);
        }
        job_delete_files($job);
        @unlink(job_path((string) $job['id']));
        $ids = array_values(array_filter((array) ($_SESSION['jobs'] ?? array()), static function ($x) use ($job): bool {
            return (string) $x !== (string) $job['id'];
        }));
        $_SESSION['jobs'] = $ids;
        api_out(array('ok' => true));

    case 'ocr-result':
        $user = api_require_user();
        $job = api_owned_job($user, api_str('id'));
        if (!$job) {
            api_fail('کار پردازش یافت نشد.', 404);
        }
        $text = (string) ($job['text'] ?? '');
        if ($text === '') {
            api_fail('متنی برای این کار ثبت نشده است.', 404);
        }
        header('Content-Type: text/plain; charset=utf-8');
        header('Content-Disposition: attachment; filename="result-' . (int) $job['id'] . '.txt"');
        echo $text;
        exit;

    case 'ocr-credit':
        api_require_user();
        $credit = api_cloud_credit();
        api_out($credit);

    case 'ocr-cleanup':
        /* همان /api/ocr/cleanup پایتون: فایل‌های آپلودشدهٔ کاربر پاک
           می‌شوند ولی خودِ کار و متن خوانده‌شده می‌ماند. رابط فعلی این
           مسیر را صدا نمی‌زند، ولی برای هم‌ترازی با پایتون هست. */
        $user = api_require_user();
        $removed = 0;
        $mine = fk_where('jobs', static function (array $j) use ($user): bool {
            return (int) ($j['user_id'] ?? 0) === (int) $user['id'];
        });
        foreach ($mine as $j) {
            /* اگر فایلی داشت، پاک شد — بشمار */
            if ((string) ($j['saved'] ?? '') !== '' || (string) ($j['txt_file'] ?? '') !== '') {
                $removed++;
            }
            job_delete_files($j);
        }
        api_out(array('ok' => true, 'removed' => $removed));

    case 'ocr-file':
        $user = api_require_user();
        $job = api_owned_job($user, api_str('id'));
        if (!$job) {
            api_fail('کار پردازش یافت نشد.', 404);
        }
        api_send_job_file($job);

    case 'ocr-to-invoice':
        $user = api_require_user();
        api_quota_guard($user);
        $job = api_owned_job($user, api_str('id'));
        if (!$job) {
            api_fail('کار پردازش یافت نشد.', 404);
        }
        if ((string) ($job['status'] ?? '') !== 'done') {
            api_fail('پردازش این فایل کامل نشده است.', 409);
        }
        $payload = api_json();
        if (!$payload) {
            $payload = api_job_to_invoice_payload($job);
        }
        $invoice = api_invoice_create($user, $payload, $job);
        api_out(array('invoice' => $invoice, 'duplicate_of' => $invoice['duplicate_of'] ?? null), 201);

    /* ════════════════ فاکتورها ════════════════ */

    case 'invoices':
        $user = api_require_user();
        if (api_method() === 'POST') {
            /* همان POST /api/invoices نسخهٔ پایتون */
            api_quota_guard($user);
            $created = api_invoice_create($user, api_json(), null);
            $dupOf = $created['duplicate_of'] ?? null;
            unset($created['duplicate_of']);
            api_out(array('invoice' => $created, 'duplicate_of' => $dupOf), 201);
        }
        api_out(api_invoice_list($user));

    case 'invoice':
        $user = api_require_user();
        $inv = api_owned_invoice($user, api_int('id'));
        if (!$inv) {
            api_fail('فاکتور یافت نشد.', 404);
        }
        api_out(array('invoice' => api_invoice_public($inv, true, true)));

    case 'invoice-create':
        $user = api_require_user();
        api_quota_guard($user);
        $inv = api_invoice_create($user, api_json(), null);
        api_out(array('invoice' => $inv, 'duplicate_of' => $inv['duplicate_of'] ?? null), 201);

    case 'invoice-update':
        $user = api_require_user();
        $inv = api_owned_invoice($user, api_int('id'));
        if (!$inv) {
            api_fail('فاکتور یافت نشد.', 404);
        }
        $upd = api_invoice_update($user, $inv, api_json());
        api_out(array('invoice' => $upd));

    case 'invoice-delete':
        $user = api_require_user();
        $inv = api_owned_invoice($user, api_int('id'));
        if (!$inv) {
            api_fail('فاکتور یافت نشد.', 404);
        }
        fk_delete('invoices', (int) $inv['id']);
        fk_audit($user, 'invoice_delete', 'invoice', (int) $inv['id'], 'حذف فاکتور');
        api_out(array('ok' => true));

    case 'invoice-bulk':
        $user = api_require_user();
        api_out(api_invoice_bulk($user, api_json()));

    case 'invoice-stats':
        $user = api_require_user();
        api_out(api_invoice_stats($user));

    case 'invoice-print':
        $user = api_require_user();
        $inv = api_owned_invoice($user, api_int('id'));
        if (!$inv) {
            api_fail('فاکتور یافت نشد.', 404);
        }
        api_out(array(
            'invoice' => api_invoice_public($inv, true, false),
            'company' => array(
                'name' => (string) ($user['company'] ?? '') ?: (string) ($user['full_name'] ?? ''),
                'phone' => (string) ($user['phone'] ?? ''),
                'email' => (string) ($user['email'] ?? ''),
            ),
            'issued_by' => (string) ($user['full_name'] ?? ''),
        ));

    case 'invoice-file':
        $user = api_require_user();
        $inv = api_owned_invoice($user, api_int('id'));
        if (!$inv) {
            api_fail('فاکتور یافت نشد.', 404);
        }
        api_send_invoice_file($inv);

    case 'invoice-export':
        $user = api_require_user();
        api_invoice_export($user);

    case 'invoice-parse':
        api_require_user();
        $text = substr((string) api_input('text', ''), 0, 200000);
        if (strlen(trim($text)) < 5) {
            api_fail('متنی برای تحلیل ارسال نشده است.', 400);
        }
        api_out(array('parsed' => fk_parsed_for_ui(
            fk_understand($text, array('type' => (string) api_input('invoice_type', 'printed'))),
            $text
        )));

    case 'invoice-understand':
        api_require_user();
        api_out(api_understand(api_str_or_json('text'), api_str_or_json('invoice_type'), api_bool('autofix', true)));

    case 'invoice-understand-image':
        api_require_user();
        api_fail('پر کردن خودکار از روی عکس در این نسخه فقط با موتور ابری انجام می‌شود؛ فایل را در «خوانش» بفرستید.', 409);

    case 'invoice-fix-numbers':
        api_require_user();
        api_out(api_fix_numbers(api_json()));

    /* ════════════════ پنل مدیریت ════════════════ */

    case 'admin-overview':
        $admin = api_require_admin();
        api_out(api_admin_overview($admin));

    case 'admin-users':
        api_require_admin();
        api_out(api_admin_users());

    case 'admin-user':
        $admin = api_require_admin();
        $userId = api_int('id');
        $payload = api_json();
        if (api_method() === 'DELETE') {
            $payload['delete'] = true;
        }
        api_out(api_admin_user($admin, $userId, $payload));

    case 'admin-user-reset':
        $admin = api_require_admin();
        api_out(api_admin_reset_password($admin, api_int('id')));

    case 'admin-plans':
        $admin = api_require_admin();
        if (api_method() === 'POST') {
            api_out(api_admin_plan($admin, 0, api_json()), 201);
        }
        api_out(api_admin_plans());

    case 'admin-plan':
        $admin = api_require_admin();
        $planId = api_int('id');
        $payload = api_json();
        /* DELETE یا {"delete":true} → حذف؛ بقیه → ساخت/ویرایش */
        if (api_method() === 'DELETE') {
            $payload['delete'] = true;
        }
        api_out(api_admin_plan($admin, $planId, $payload));

    case 'admin-keys':
        api_require_admin();
        api_out(api_admin_keys());

    case 'admin-keys-create':
        $admin = api_require_admin();
        api_out(api_admin_keys_create($admin, api_json()));

    case 'admin-key-revoke':
        $admin = api_require_admin();
        api_out(api_admin_key_action($admin, api_int('id'), 'revoke'));

    case 'admin-key':
        $admin = api_require_admin();
        $payload = api_json();
        /* DELETE /api/admin/keys/{id} نسخهٔ پایتون یعنی «حذف»، نه «لغو» */
        $hard = api_method() === 'DELETE' || !empty($payload['delete']);
        api_out(api_admin_key_action($admin, api_int('id'), $hard ? 'delete' : 'revoke'));

    case 'admin-cloud':
        api_require_admin();
        api_out(array(
            'gateway_ready' => gateway_url() !== '',
            'token_set' => token_is_set(),
            'token_length' => (int) (load_config()['token_len'] ?? (token_is_set() ? 32 : 0)),
            'token_hint' => mask((string) (load_config()['token'] ?? '')),
            'visible' => false,
            'note' => 'توکن فقط روی سرور نگهداری می‌شود و در هیچ خروجی نمایش داده نمی‌شود.',
            'ai_set' => !empty(load_config()['ai_key'] ?? ''),
        ));

    case 'admin-cloud-token':
        $admin = api_require_admin();
        $payload = api_json();
        $cfg = load_config();
        if (!empty($payload['clear'])) {
            unset($cfg['token'], $cfg['token_len']);
            save_config($cfg);
            fk_audit($admin, 'cloud_token_clear', 'settings', '', 'حذف توکن ابری');
            api_out(array('ok' => true, 'message' => 'توکن حذف شد.'));
        }
        $token = trim((string) ($payload['token'] ?? ''));
        if (strlen($token) < 8) {
            api_fail('توکن معتبر نیست.', 400);
        }
        $cfg['token'] = $token;
        $cfg['token_len'] = strlen($token);
        save_config($cfg);
        fk_audit($admin, 'cloud_token_set', 'settings', '', 'به‌روزرسانی توکن ابری');
        api_out(array('ok' => true, 'message' => 'توکن ذخیره شد. مقدار آن دیگر قابل مشاهده نیست.'));

    case 'admin-cloud-test':
        api_require_admin();
        $res = api_cloud_credit();
        if (!empty($res['ok'])) {
            api_out(array('ok' => true, 'credit' => $res, 'message' => 'ارتباط با سرویس ابری برقرار است.'));
        }
        api_out(array('ok' => false, 'message' => (string) ($res['message'] ?? 'ارتباط برقرار نشد.')));

    case 'admin-settings':
        $admin = api_require_admin();
        if (api_is_write()) {
            $payload = api_json();
            $defaults = fk_cfg_defaults();
            $changed = array();
            foreach ($payload as $key => $value) {
                if (!array_key_exists((string) $key, $defaults)) {
                    continue;
                }
                if (is_bool($value)) {
                    $value = $value ? '1' : '0';
                }
                fk_cfg_set((string) $key, (string) $value);
                $changed[] = (string) $key;
            }
            fk_audit($admin, 'settings_update', 'settings', '', implode(', ', $changed));
            api_out(array('ok' => true, 'settings' => fk_cfg_all(), 'changed' => $changed));
        }
        api_out(array('settings' => fk_cfg_all()));

    case 'admin-audit':
        api_require_admin();
        $q = api_str('q');
        $page = max(1, api_int('page', 1));
        $perPage = max(1, min(api_int('per_page', 30), 100));
        $rows = fk_rows('audit');
        if ($q !== '') {
            $needle = fk_text_lower($q);
            $rows = array_values(array_filter($rows, static function (array $r) use ($needle): bool {
                $hay = ($r['actor'] ?? '') . ' ' . ($r['action'] ?? '') . ' ' . ($r['detail'] ?? '');
                $hay = fk_text_lower((string) $hay);
                return strpos($hay, $needle) !== false;
            }));
        }
        usort($rows, static function (array $a, array $b): int {
            return strcmp((string) ($b['created_at'] ?? ''), (string) ($a['created_at'] ?? ''));
        });
        $total = count($rows);
        $items = array();
        foreach (array_slice($rows, ($page - 1) * $perPage, $perPage) as $r) {
            $items[] = array(
                'id' => (int) $r['id'],
                'actor' => (string) ($r['actor'] ?? ''),
                'action' => (string) ($r['action'] ?? ''),
                'entity' => (string) ($r['entity'] ?? ''),
                'entity_id' => (string) ($r['entity_id'] ?? ''),
                'detail' => (string) ($r['detail'] ?? ''),
                'ip' => (string) ($r['ip'] ?? ''),
                'at' => (string) ($r['created_at'] ?? ''),
            );
        }
        api_out(array(
            'items' => $items, 'total' => $total, 'page' => $page, 'per_page' => $perPage,
            'pages' => max(1, (int) ceil($total / $perPage)),
        ));

    case 'admin-support':
        api_require_admin();
        $status = api_str('status');
        $rows = fk_rows('tickets');
        if ($status !== '') {
            $rows = array_values(array_filter($rows, static function (array $r) use ($status): bool {
                return (string) ($r['status'] ?? '') === $status;
            }));
        }
        usort($rows, static function (array $a, array $b): int {
            return strcmp((string) ($b['created_at'] ?? ''), (string) ($a['created_at'] ?? ''));
        });
        api_out(array('items' => array_map('fk_ticket_public', array_slice($rows, 0, 100))));

    case 'admin-ticket-answer':
        $admin = api_require_admin();
        $ticket = fk_row('tickets', api_int('id'));
        if (!$ticket) {
            api_fail('پیام یافت نشد.', 404);
        }
        $payload = api_json();
        $ticket = fk_update('tickets', (int) $ticket['id'], array(
            'answer' => substr((string) ($payload['answer'] ?? ''), 0, 4000),
            'status' => 'answered',
            'answered_at' => fk_now(),
        ));
        fk_audit($admin, 'support_answer', 'ticket', (int) $ticket['id'], (string) ($ticket['subject'] ?? ''));
        api_out(array('ok' => true, 'ticket' => fk_ticket_public($ticket ?? array())));

    case 'admin-health':
        api_require_admin();
        api_out(array(
            'database' => array('ok' => is_dir(fk_db_dir()) && is_writable(fk_db_dir()), 'engine' => 'json-files'),
            'cloud' => array('gateway_ready' => gateway_url() !== '', 'token_set' => token_is_set()),
            'version' => FK_APP_VERSION,
            'features' => fk_features_total(),
            'uptime_ok' => true,
            'php' => PHP_VERSION,
        ));

    case 'admin-backup':
        $admin = api_require_admin();
        if (!fk_is_owner($admin)) {
            api_fail('این عملیات فقط برای مالک سامانه مجاز است.', 403);
        }
        api_backup($admin);

    default:
        api_fail('درخواست ناشناخته است: ' . $action, 404);
}
