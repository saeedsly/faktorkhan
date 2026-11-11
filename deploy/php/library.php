<?php
/**
 * بایگانی فاکتور — سمت PHP
 * =========================
 * نسخهٔ پایتون یک جدول واقعی «فاکتورها» با گزارش، جست‌وجو و آمار داشت.
 * نسخهٔ PHP فقط «کارهای خوانش» را نگه می‌داشت: کاربر متن را می‌دید و
 * تمام. هیچ راهی نبود که فاکتوری را «ثبت» کند و بعداً در داشبورد
 * ببیند، جست‌وجو کند یا خروجی اکسل بگیرد.
 *
 * این فایل همان لایه را می‌سازد، بدون دیتابیس: هر فاکتور یک فایل JSON
 * در fk-invoices/ است. چرا فایل و نه MySQL؟
 *   • روی WAMP/XAMPP کاربر نباید دیتابیس بسازد و import کند
 *   • پشتیبان‌گیری = کپی یک پوشه
 *   • ۵۰۰۰ فاکتور هم برای این حجم کار کافی است و سریع می‌ماند
 *
 * قواعد امنیتی (همان استاندارد نسخهٔ پایتون):
 *   • هر فاکتور owner دارد؛ خواندن/حذف فقط برای صاحبش
 *   • شناسه تصادفی است، نه شمارنده، تا حدس زدن ممکن نباشد
 *   • هیچ ورودی کاربر بدون پاک‌سازی در نام فایل نمی‌رود
 */

declare(strict_types=1);

const FK_INVOICES = __DIR__ . '/fk-invoices';

/**
 * مسیر فایل مالکیت نصب.
 *
 * عمداً از `__DIR__` همین فایل استفاده می‌شود، نه ریشهٔ وب‌سرور: هر
 * کپی از برنامه (مثلاً دو نصب روی یک هاست) مالک خودش را دارد و
 * فاکتورهایشان قاطی نمی‌شود.
 */
function fk_owner_file(): string
{
    return __DIR__ . '/fk-owner';
}

/** پوشهٔ بایگانی، ساخته‌شده با دسترسی محدود */
function inv_dir(): string
{
    if (!is_dir(FK_INVOICES)) {
        @mkdir(FK_INVOICES, 0700, true);
    }
    return FK_INVOICES;
}

/** شناسهٔ تصادفی امن (۲۴ نویسهٔ هگزادسیمال) */
function inv_new_id(): string
{
    try {
        return bin2hex(random_bytes(12));
    } catch (Exception $e) {
        return substr(hash('sha256', uniqid((string) mt_rand(), true)), 0, 24);
    }
}

/** مسیر امن فایل فاکتور — شناسه هرگز خام به مسیر نمی‌رود */
function inv_path(string $id): string
{
    $id = (string) preg_replace('/[^a-f0-9]/', '', strtolower($id));
    if (strlen($id) !== 24) {
        $id = substr(str_pad($id, 24, '0'), 0, 24);
    }
    return inv_dir() . '/' . $id . '.json';
}

/**
 * شناسهٔ مالک این نصب.
 *
 * چون نسخهٔ PHP یک نصب تک‌کاربره است (یک گذرواژه برای کل ابزار)، مالک
 * یک مقدار ثابت و تصادفی است که در فایل `fk-owner` نگه داشته می‌شود.
 * این ستون مالکیت را از روز اول دارد تا اگر بعداً چند کاربر اضافه شد،
 * فاکتورهای قدیمی هم مالک داشته باشند و مهاجرت بدون بازنویسی انجام شود.
 */
function inv_owner(): string
{
    /* مسیر را از fk_owner_file() بگیر — نه خام از __DIR__.
       نسخهٔ اول مستقیم به __DIR__ تکیه می‌کرد و در محیط‌هایی که
       __DIR__ ریشه است (و مسیر نصب جای دیگری است) فایل مالک گم
       می‌شد و هیچ فاکتوری «مال من» شناخته نمی‌شد. */
    $file = function_exists('fk_owner_file') ? fk_owner_file() : (__DIR__ . '/fk-owner');
    $val = is_file($file) ? @file_get_contents($file) : false;
    if (is_string($val) && strlen(trim($val)) >= 16) {
        return trim($val);
    }
    try {
        $val = bin2hex(random_bytes(16));
    } catch (Exception $e) {
        $val = substr(hash('sha256', __DIR__ . PHP_VERSION), 0, 32);
    }
    @file_put_contents($file, $val, LOCK_EX);
    @chmod($file, 0600);
    return $val;
}

/** خواندن یک فاکتور؛ null یعنی نیست یا خراب است */
function inv_load(string $id): ?array
{
    $path = inv_path($id);
    if (!is_file($path)) {
        return null;
    }
    $raw = @file_get_contents($path);
    $data = $raw === false ? null : json_decode($raw, true);
    return is_array($data) ? $data : null;
}

/** ذخیرهٔ اتمیک: نوشتن در فایل موقت، بعد جابه‌جایی */
function inv_save(array $inv): bool
{
    $path = inv_path((string) ($inv['id'] ?? ''));
    if (!is_file($path) && strlen((string) ($inv['id'] ?? '')) !== 24) {
        return false;                       /* شناسهٔ نامعتبر */
    }
    $inv['updated_at'] = time();
    $json = json_encode($inv, JSON_UNESCAPED_UNICODE);
    if ($json === false) {
        return false;
    }
    $tmp = $path . '.' . bin2hex(random_bytes(4)) . '.tmp';
    if (@file_put_contents($tmp, $json, LOCK_EX) === false) {
        return false;
    }
    @chmod($tmp, 0600);
    if (!@rename($tmp, $path)) {
        @unlink($tmp);
        return false;
    }
    return true;
}

/**
 * ساخت فاکتور از خروجی یک کار خوانش.
 *
 * اقلام و جمع‌ها از موتور فهم می‌آید (fk_understand)؛ اگر نبود، از متن
 * استخراج می‌شود. هیچ‌وقت فاکتور خالی ثبت نمی‌شود.
 */
function inv_from_job(array $job, array $overrides = array()): array
{
    $understood = is_array($job['understood'] ?? null) ? $job['understood'] : array();
    $meta = is_array($understood['meta'] ?? null) ? $understood['meta'] : array();
    $totals = is_array($understood['totals'] ?? null) ? $understood['totals'] : array();
    $items = is_array($understood['items'] ?? null) ? $understood['items'] : array();

    $pick = static function (string $key, $fallback = '') use ($overrides, $meta) {
        if (array_key_exists($key, $overrides) && $overrides[$key] !== '' && $overrides[$key] !== null) {
            return $overrides[$key];
        }
        return $meta[$key] ?? $fallback;
    };

    $clean_items = array();
    foreach ($items as $it) {
        $desc = trim((string) ($it['description'] ?? ''));
        if ($desc === '') {
            continue;
        }
        $qty = max(0, (int) ($it['qty'] ?? 0));
        $price = max(0, (int) ($it['unit_price'] ?? 0));
        $total = max(0, (int) ($it['total'] ?? 0));
        $clean_items[] = array(
            'description' => substr($desc, 0, 300),
            'qty' => $qty,
            'unit' => substr((string) ($it['unit'] ?? ''), 0, 20),
            'unit_price' => $price,
            'discount' => max(0, (int) ($it['discount'] ?? 0)),
            'total' => $total ?: $qty * $price,
        );
    }
    $items_sum = 0;
    foreach ($clean_items as $it) {
        $items_sum += (int) $it['total'];
    }

    $now = time();
    return array(
        'id' => inv_new_id(),
        'owner' => inv_owner(),
        'job_id' => (string) ($job['id'] ?? ''),
        'file_name' => (string) ($job['name'] ?? ''),
        'number' => trim((string) $pick('number')),
        'issue_date' => trim((string) $pick('date')),
        'seller_name' => trim((string) $pick('seller')),
        'buyer_name' => trim((string) $pick('buyer')),
        'invoice_type' => (string) ($job['invoice_type'] ?? 'printed'),
        'items' => $clean_items,
        'items_sum' => $items_sum,
        'subtotal' => (int) ($totals['subtotal'] ?? $items_sum),
        'discount' => (int) ($totals['discount'] ?? 0),
        'tax' => (int) ($totals['tax'] ?? 0),
        'total' => (int) ($totals['total'] ?? $items_sum),
        'confidence' => (int) ($understood['confidence'] ?? 0),
        'issues' => is_array($understood['issues'] ?? null) ? count($understood['issues']) : 0,
        'text' => substr((string) ($job['text'] ?? ''), 0, 400000),
        'created_at' => $now,
        'updated_at' => $now,
    );
}

/** فهرست فاکتورهای این مالک، با جست‌وجو و مرتب‌سازی */
function inv_list(string $query = '', string $sort = 'new', int $limit = 500): array
{
    $owner = inv_owner();
    $q = trim($query);
    if ($q !== '' && function_exists('mb_strtolower')) {
        $q = mb_strtolower($q, 'UTF-8');
    } else {
        $q = strtolower($q);
    }

    $out = array();
    foreach (@glob(inv_dir() . '/*.json') ?: array() as $file) {
        $raw = @file_get_contents($file);
        $inv = $raw === false ? null : json_decode($raw, true);
        if (!is_array($inv) || ($inv['owner'] ?? '') !== $owner) {
            continue;                       /* فاکتور دیگران هرگز دیده نمی‌شود */
        }
        if ($q !== '') {
            $hay = (string) ($inv['number'] ?? '') . "\n"
                . (string) ($inv['seller_name'] ?? '') . "\n"
                . (string) ($inv['buyer_name'] ?? '') . "\n"
                . (string) ($inv['file_name'] ?? '') . "\n"
                . (string) ($inv['text'] ?? '');
            foreach (($inv['items'] ?? array()) as $it) {
                $hay .= "\n" . (string) ($it['description'] ?? '');
            }
            if (function_exists('mb_strtolower')) {
                $hay = mb_strtolower($hay, 'UTF-8');
            } else {
                $hay = strtolower($hay);
            }
            if (strpos($hay, $q) === false) {
                continue;
            }
        }
        $out[] = $inv;
    }

    usort($out, static function (array $a, array $b) use ($sort): int {
        if ($sort === 'old') {
            return ((int) ($a['created_at'] ?? 0)) <=> ((int) ($b['created_at'] ?? 0));
        }
        if ($sort === 'amount') {
            return ((int) ($b['total'] ?? 0)) <=> ((int) ($a['total'] ?? 0));
        }
        return ((int) ($b['created_at'] ?? 0)) <=> ((int) ($a['created_at'] ?? 0));
    });

    return array_slice($out, 0, max(1, $limit));
}

/** حذف فاکتور — فقط صاحبش */
function inv_delete(string $id): bool
{
    $inv = inv_load($id);
    if (!$inv || ($inv['owner'] ?? '') !== inv_owner()) {
        return false;
    }
    return @unlink(inv_path($id));
}

/**
 * آمار داشبورد.
 *
 * همین اعداد در نسخهٔ پایتون در چهار کارت بالای صفحه دیده می‌شود.
 * محاسبه از همان فایل‌هاست؛ هیچ درخواست شبکه‌ای لازم نیست.
 */
function inv_stats(): array
{
    $all = inv_list('', 'new', 5000);
    $count = count($all);
    $sum = 0;
    $tax = 0;
    $items = 0;
    $conf = 0;
    $confirmed = 0;
    $sellers = array();
    $months = array();

    foreach ($all as $inv) {
        $sum += (int) ($inv['total'] ?? 0);
        $tax += (int) ($inv['tax'] ?? 0);
        $items += count((array) ($inv['items'] ?? array()));
        $conf += (int) ($inv['confidence'] ?? 0);
        if ((int) ($inv['confidence'] ?? 0) >= 80) {
            $confirmed++;
        }
        $seller = trim((string) ($inv['seller_name'] ?? ''));
        if ($seller !== '') {
            $sellers[$seller] = ($sellers[$seller] ?? 0) + (int) ($inv['total'] ?? 0);
        }
        $month = function_exists('fk_fa_date') ? substr(fk_fa_date((int) ($inv['created_at'] ?? 0)), 0, 7) : '';
        if ($month !== '') {
            $months[$month] = ($months[$month] ?? 0) + (int) ($inv['total'] ?? 0);
        }
    }
    arsort($sellers);
    ksort($months);

    return array(
        'count' => $count,
        'confirmed' => $confirmed,
        'sum' => $sum,
        'tax' => $tax,
        'items' => $items,
        'avg_confidence' => $count > 0 ? (int) round($conf / $count) : 0,
        'avg_invoice' => $count > 0 ? (int) round($sum / $count) : 0,
        'sellers' => array_slice($sellers, 0, 6, true),
        'months' => $months,
    );
}

/** خروجی CSV همهٔ فاکتورها — برای اکسل، با BOM تا فارسی درست دیده شود */
function inv_csv(): string
{
    $rows = array(array('تاریخ', 'شماره', 'فروشنده', 'خریدار', 'تعداد اقلام', 'جمع اقلام', 'مالیات', 'مبلغ کل', 'اعتماد', 'فایل'));
    foreach (inv_list('', 'old', 5000) as $inv) {
        $rows[] = array(
            function_exists('fk_fa_date') ? fk_fa_date((int) ($inv['created_at'] ?? 0), false) : '',
            (string) ($inv['number'] ?? ''),
            (string) ($inv['seller_name'] ?? ''),
            (string) ($inv['buyer_name'] ?? ''),
            (string) count((array) ($inv['items'] ?? array())),
            (string) (int) ($inv['subtotal'] ?? 0),
            (string) (int) ($inv['tax'] ?? 0),
            (string) (int) ($inv['total'] ?? 0),
            (string) (int) ($inv['confidence'] ?? 0),
            (string) ($inv['file_name'] ?? ''),
        );
    }
    $fh = fopen('php://temp', 'r+');
    foreach ($rows as $r) {
        fputcsv($fh, $r, ',', '"', '\\');
    }
    rewind($fh);
    $csv = (string) stream_get_contents($fh);
    fclose($fh);
    /* BOM با chr() ساخته می‌شود، نه رشتهٔ «\xEF\xBB\xBF»: در PHP
       داخل نقل‌قول دوگانه escape هگز سه‌رقمی پذیرفته و درست است، ولی
       اگر فایل با ویرایشگری باز و ذخیره شود، همان رشته ممکن است
       به نویسه‌های یونیکد تبدیل شود و اکسل فایل را خراب ببیند. */
    return chr(0xEF) . chr(0xBB) . chr(0xBF) . $csv;
}
