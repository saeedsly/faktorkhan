<?php
/**
 * توابع کمکی API — منطق مشترک بین مسیرها
 * ======================================
 * از api.php جدا شد تا خواندنِ هر دو ممکن بماند: api.php فقط نقشهٔ
 * مسیرهاست و این فایل «چطور» را نگه می‌دارد.
 *
 * هر تابع این فایل یا پاسخ JSON نمی‌دهد (فقط داده برمی‌گرداند) یا اگر
 * کارش تمام‌کردن پاسخ است (مثل ارسال فایل) با صراحت `exit` می‌کند.
 */

declare(strict_types=1);

require_once __DIR__ . '/store.php';

/** پوشهٔ وضعیت موقت (شمارندهٔ نرخ، فایل‌های موقت) */
function fk_state_dir(): string
{
    $dir = FK_DATA . '/tmp';
    if (!is_dir($dir)) {
        @mkdir($dir, 0700, true);
    }
    return $dir;
}

/** زبان‌های پشتیبانی‌شده — همان فهرست نسخهٔ پایتون */
function fk_languages(): array
{
    return array(
        array('code' => 'fa', 'name' => 'فارسی'),
        array('code' => 'en', 'name' => 'انگلیسی'),
        array('code' => 'ar', 'name' => 'عربی'),
        array('code' => 'tr', 'name' => 'ترکی'),
        array('code' => 'de', 'name' => 'آلمانی'),
        array('code' => 'fr', 'name' => 'فرانسوی'),
        array('code' => 'ru', 'name' => 'روسی'),
        array('code' => 'es', 'name' => 'اسپانیایی'),
        array('code' => 'it', 'name' => 'ایتالیایی'),
        array('code' => 'hi', 'name' => 'هندی'),
        array('code' => 'ko', 'name' => 'کره‌ای'),
        array('code' => 'ja', 'name' => 'ژاپنی'),
        array('code' => 'ch', 'name' => 'چینی'),
    );
}

/* ══════════════════════ سهمیه ══════════════════════ */

/**
 * بررسی سهمیهٔ اشتراک پیش از هر پردازش.
 *
 * چرا این‌جا و نه فقط در ثبت فاکتور؟ چون هزینهٔ واقعی (اعتبار سرویس
 * ابری) همان لحظهٔ خوانش خرج می‌شود، نه لحظهٔ ذخیره. اگر فقط ثبت را
 * محدود می‌کردیم، کاربر می‌توانست بی‌نهایت فایل بفرستد و ثبت نکند.
 *
 * مدیرها از سهمیه معاف‌اند (همان قاعدهٔ نسخهٔ پایتون: require_active_subscription).
 */
function api_quota_guard(array $user): void
{
    if (fk_is_admin($user)) {
        return;
    }
    if (!fk_cfg_bool('license_required', false)) {
        return;
    }
    $sub = fk_ensure_subscription((int) $user['id']);
    if (!fk_sub_valid($sub)) {
        api_fail('اشتراک شما منقضی شده است. برای ادامه، کد اشتراک را فعال کنید.', 402);
    }
    $quota = (int) ($sub['pages_quota'] ?? 0);
    $used = (int) ($sub['pages_used'] ?? 0);
    if ($quota > 0 && $used >= $quota) {
        api_fail('سهمیهٔ صفحات اشتراک شما تمام شده است. برای افزایش، اشتراک را تمدید کنید.', 402);
    }
}

/** یک صفحه مصرف شد */
function api_consume_page(int $userId): void
{
    $sub = fk_subscription($userId);
    if (!$sub) {
        return;
    }
    fk_update('subscriptions', (int) $sub['id'], array(
        'pages_used' => (int) ($sub['pages_used'] ?? 0) + 1,
    ));
}

/* ══════════════════════ کارها (OCR) ══════════════════════ */

/**
 * ساخت کار جدید.
 *
 * فایل روی دیسک همین نصب ذخیره می‌شود و کار با شناسه‌اش در نشست کاربر
 * ثبت می‌شود. کارهای نسخهٔ تک‌کاربرهٔ PHP (که در fk-jobs هستند) هم
 * پشتیبانی می‌شوند تا داده‌های قبلی از دست نرود.
 */
function api_job_start(array $user, ?array $file, array $meta): array
{
    $job = array(
        'id' => job_id(),
        'user_id' => (int) $user['id'],
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
        'engine' => $meta['provider'] ?? 'cloud',
        'invoice_type' => $meta['invoice_type'] ?? 'printed',
        'ai_tried' => false,
        'error' => '',
        'attempts' => 0,
        'deadline' => time() + 1800,
        'method' => (int) ($meta['method'] ?? 4),
        'output' => (string) ($meta['output'] ?? 'txtrawjson'),
        'language' => (string) ($meta['language'] ?? 'fa'),
        'name' => (string) ($meta['file_name'] ?? ''),
        'delete_after' => !empty($meta['delete_after']),
        'source_link' => (string) ($meta['source_link'] ?? ''),
    );

    if ($file !== null) {
        $ext = strtolower((string) pathinfo((string) ($file['name'] ?? ''), PATHINFO_EXTENSION));
        $ext = preg_replace('/[^a-z0-9]/', '', $ext) ?: 'bin';
        $stash = stash_upload((string) $file['tmp_name'], $ext);
        if ($stash === '') {
            return array('error' => 'ذخیرهٔ فایل روی سرور ممکن نشد (دسترسی نوشتن پوشهٔ fk-uploads را بررسی کنید).');
        }
        $job['local'] = $stash;
        $job['name'] = (string) ($file['name'] ?? basename($stash));
        $job['mime'] = mime_for_ext($ext);
        $job['bytes'] = (int) ($file['size'] ?? 0);
    } elseif (!empty($job['source_link'])) {
        $job['local'] = '';
        $job['mime'] = '';
        $job['bytes'] = 0;
    } else {
        return array('error' => 'فایلی ارسال نشد.');
    }

    job_save($job);
    job_claim((string) $job['id']);
    fk_audit($user, 'ocr_start', 'job', $job['id'], ($job['engine'] ?? 'cloud') . ' / ' . $job['name']);
    api_consume_page((int) $user['id']);
    return $job;
}

/** کارهای این کاربر (جدید و قدیمی) */
function api_user_jobs(array $user): array
{
    $uid = (int) $user['id'];
    $out = array();
    $seen = array();

    $dir = jobs_dir();
    foreach (@glob($dir . '/*.json') ?: array() as $file) {
        $raw = @file_get_contents($file);
        $job = $raw ? json_decode($raw, true) : null;
        if (!is_array($job) || empty($job['id'])) {
            continue;
        }
        $ownerId = isset($job['user_id']) ? (int) $job['user_id'] : 0;
        $legacyOwned = in_array((string) $job['id'], array_map('strval', (array) ($_SESSION['jobs'] ?? array())), true);
        if ($ownerId !== $uid && !($ownerId === 0 && $legacyOwned)) {
            continue;
        }
        $out[] = $job;
        $seen[(string) $job['id']] = true;
    }
    return $out;
}

/** یک کار، فقط اگر مال این کاربر باشد */
function api_owned_job(array $user, string $id): ?array
{
    $id = (string) preg_replace('/[^A-Za-z0-9\-]/', '', $id);
    if ($id === '') {
        return null;
    }
    $path = job_path($id);
    if (!is_file($path)) {
        return null;
    }
    $raw = @file_get_contents($path);
    $job = $raw ? json_decode($raw, true) : null;
    if (!is_array($job)) {
        return null;
    }
    $ownerId = isset($job['user_id']) ? (int) $job['user_id'] : 0;
    if ($ownerId === (int) $user['id']) {
        return $job;
    }
    if ($ownerId === 0 && in_array($id, array_map('strval', (array) ($_SESSION['jobs'] ?? array())), true)) {
        return $job;                      /* کارِ نصب قدیمی، همان نشست */
    }
    return null;
}

/** شکل عمومی کار — همان job_public پایتون */
function api_job_public(array $job, bool $withText = false): array
{
    $understood = is_array($job['understood'] ?? null) ? $job['understood'] : null;
    $parsed = null;
    if ($understood) {
        $parsed = fk_parsed_for_ui($understood, (string) ($job['text'] ?? ''));
    }
    $status = (string) ($job['status'] ?? 'queued');
    $data = array(
        'id' => (string) $job['id'],
        'provider' => (string) ($job['engine'] ?? 'cloud'),
        'method' => (int) ($job['method'] ?? 4),
        'output' => (string) ($job['output'] ?? 'txtrawjson'),
        'file_name' => (string) ($job['name'] ?? ''),
        'pages' => (int) ($job['pages'] ?? 0),
        'status' => $status,
        'progress' => (int) ($job['progress'] ?? 0),
        'message' => (string) ($job['message'] ?? ''),
        'language' => (string) ($job['language'] ?? 'fa'),
        'invoice_id' => $job['invoice_id'] ?? null,
        'created_at' => (string) ($job['created_at'] ?? ''),
        'updated_at' => (string) ($job['updated_at'] ?? ''),
        'engine' => (string) ($job['engine'] ?? ''),
        'has_result_file' => !empty($job['saved']) || !empty($job['txt_file']),
        'remote_active' => !empty($job['file_token']),
        'invoice_type' => (string) ($job['invoice_type'] ?? 'printed'),
    );
    if ($parsed) {
        $data['parsed'] = $parsed;
    }
    if ($withText || in_array($status, array('done', 'failed', 'cancelled'), true)) {
        $data['text'] = (string) ($job['text'] ?? '');
    }
    if (!empty($job['understood'])) {
        $data['understood'] = $job['understood'];
    }
    return $data;
}

/**
 * تبدیل خروجی موتور فهم به شکل `parsed` که frontend می‌شناسد.
 *
 * چرا لازم است: رابط نسخهٔ پایتون فیلدهایی مثل `seller_name` و `issue_date`
 * می‌خواهد، ولی موتور PHP با `meta.seller` و `meta.date` کار می‌کند. اگر
 * این نگاشت نباشد، فرم بازبینی خالی می‌ماند و کاربر فکر می‌کند خوانش
 * شکست خورده — در حالی که متن و اقلام آماده‌اند.
 */
function fk_parsed_for_ui(array $understood, string $text): array
{
    $meta = is_array($understood['meta'] ?? null) ? $understood['meta'] : array();
    $totals = is_array($understood['totals'] ?? null) ? $understood['totals'] : array();
    $items = array();
    foreach ((array) ($understood['items'] ?? array()) as $i => $it) {
        $items[] = array(
            'row_no' => $i + 1,
            'code' => (string) ($it['code'] ?? ''),
            'description' => (string) ($it['description'] ?? ''),
            'qty' => $it['qty'] ?? 1,
            'unit' => (string) ($it['unit'] ?? 'عدد'),
            'unit_price' => (int) ($it['unit_price'] ?? 0),
            'discount' => (int) ($it['discount'] ?? 0),
            'tax_rate' => (int) ($it['tax_rate'] ?? 0),
            'total' => (int) ($it['total'] ?? 0),
            'engine' => (string) ($it['engine'] ?? 'rules'),
            'ai_confidence' => (int) ($it['ai_confidence'] ?? 0),
            'note' => (string) ($it['note'] ?? ''),
        );
    }
    $issues = array();
    foreach ((array) ($understood['issues'] ?? array()) as $issue) {
        $issues[] = is_array($issue) ? (string) ($issue['message'] ?? '') : (string) $issue;
    }
    return array(
        'number' => (string) ($meta['number'] ?? ''),
        'issue_date' => (string) ($meta['date'] ?? ''),
        'due_date' => (string) ($meta['due'] ?? ''),
        'invoice_type' => (string) ($meta['type'] ?? 'printed'),
        'seller_name' => (string) ($meta['seller'] ?? ''),
        'seller_tax_id' => (string) ($meta['seller_tax_id'] ?? ''),
        'buyer_name' => (string) ($meta['buyer'] ?? ''),
        'buyer_tax_id' => (string) ($meta['buyer_tax_id'] ?? ''),
        'subtotal' => (int) ($totals['subtotal'] ?? ($understood['items_sum'] ?? 0)),
        'discount' => (int) ($totals['discount'] ?? 0),
        'tax' => (int) ($totals['tax'] ?? 0),
        'total' => (int) ($totals['total'] ?? 0),
        'paid' => (int) ($totals['paid'] ?? 0),
        'items' => $items,
        'confidence' => (int) ($understood['confidence'] ?? 0),
        'fields_found' => count($items) > 0 ? count($items) + 4 : 0,
        'warnings' => $issues,
    );
}

/** بارِ فاکتور از یک کار تمام‌شده — همان چیزی که to-invoice می‌خواهد */
function api_job_to_invoice_payload(array $job): array
{
    $understood = is_array($job['understood'] ?? null) ? $job['understood'] : array();
    $parsed = fk_parsed_for_ui($understood, (string) ($job['text'] ?? ''));
    return array(
        'number' => $parsed['number'],
        'issue_date' => $parsed['issue_date'],
        'invoice_type' => (string) ($job['invoice_type'] ?? 'printed'),
        'seller_name' => $parsed['seller_name'],
        'buyer_name' => $parsed['buyer_name'],
        'subtotal' => $parsed['subtotal'],
        'discount' => $parsed['discount'],
        'tax' => $parsed['tax'],
        'total' => $parsed['total'],
        'status' => 'review',
        'source' => 'cloud',
        'confidence' => $parsed['confidence'],
        'items' => $parsed['items'],
        'ocr_text' => (string) ($job['text'] ?? ''),
        'file_name' => (string) ($job['name'] ?? ''),
        'job_id' => (string) ($job['id'] ?? ''),
        'items_engine' => 'rules',
        'items_confidence' => $parsed['confidence'],
        'items_issues' => $parsed['warnings'],
    );
}

/* ══════════════════════ ابر ══════════════════════ */

/** اعتبار سرویس ابری — بدون افشای توکن */
function api_cloud_credit(): array
{
    if (!token_is_set() || gateway_url() === '') {
        return array(
            'ok' => false,
            'message' => 'توکن سرویس ابری تنظیم نشده است.',
            'ocr_credit' => null,
            'audio_credit' => null,
        );
    }
    $res = call_gateway(array('command' => 'checkcredit'), null, null, '', 20);
    if (empty($res['ok'])) {
        return array(
            'ok' => false,
            'message' => (string) ($res['message'] ?? 'ارتباط با سرویس ابری برقرار نشد.'),
            'ocr_credit' => null,
            'audio_credit' => null,
        );
    }
    $data = is_array($res['data'] ?? null) ? $res['data'] : array();
    return array(
        'ok' => true,
        'ocr_credit' => (int) pick_key($data, array('OCRCredit', 'OcrCredit', 'Credit')),
        'audio_credit' => (int) pick_key($data, array('AudioTranscribeCredit', 'AudioCredit')),
        'status' => (string) pick_key($data, array('Status')),
    );
}

/* ══════════════════════ فاکتورها ══════════════════════ */

/** فاکتور تنها برای صاحبش */
function api_owned_invoice(array $user, int $id): ?array
{
    $inv = fk_row('invoices', $id);
    if (!$inv || (int) ($inv['user_id'] ?? 0) !== (int) $user['id']) {
        return null;
    }
    return $inv;
}

/** شکل عمومی فاکتور — همان invoice_public پایتون */
function api_invoice_public(array $inv, bool $withItems = true, bool $withText = false): array
{
    $items = array_values((array) ($inv['items'] ?? array()));
    $tags = array_values(array_filter(array_map('trim', explode(',', (string) ($inv['tags'] ?? '')))));
    $data = array(
        'id' => (int) ($inv['id'] ?? 0),
        'number' => (string) ($inv['number'] ?? ''),
        'issue_date' => (string) ($inv['issue_date'] ?? ''),
        'due_date' => (string) ($inv['due_date'] ?? ''),
        'invoice_type' => (string) ($inv['invoice_type'] ?? 'printed'),
        'direction' => (string) ($inv['direction'] ?? 'purchase'),
        'seller_name' => (string) ($inv['seller_name'] ?? ''),
        'seller_tax_id' => (string) ($inv['seller_tax_id'] ?? ''),
        'buyer_name' => (string) ($inv['buyer_name'] ?? ''),
        'buyer_tax_id' => (string) ($inv['buyer_tax_id'] ?? ''),
        'subtotal' => (int) ($inv['subtotal'] ?? 0),
        'discount' => (int) ($inv['discount'] ?? 0),
        'tax' => (int) ($inv['tax'] ?? 0),
        'total' => (int) ($inv['total'] ?? 0),
        'paid' => (int) ($inv['paid'] ?? 0),
        'currency' => (string) ($inv['currency'] ?? 'IRR'),
        'status' => (string) ($inv['status'] ?? 'draft'),
        'source' => (string) ($inv['source'] ?? 'manual'),
        'confidence' => (int) ($inv['confidence'] ?? 0),
        'tags' => $tags,
        'notes' => (string) ($inv['notes'] ?? ''),
        'file_name' => (string) ($inv['file_name'] ?? ''),
        'has_file' => !empty($inv['file_path']),
        'thumb_color' => (string) ($inv['thumb_color'] ?? '#2b3a55'),
        'created_at' => (string) ($inv['created_at'] ?? ''),
        'updated_at' => (string) ($inv['updated_at'] ?? ''),
        'duplicate_of' => $inv['duplicate_of'] ?? null,
        'job_id' => $inv['job_id'] ?? null,
        'items_count' => count($items),
        'items_engine' => (string) ($inv['items_engine'] ?? ''),
        'items_confidence' => (int) ($inv['items_confidence'] ?? 0),
        'items_autofixed' => (int) ($inv['items_autofixed'] ?? 0),
        'items_issues' => array_values((array) ($inv['items_issues'] ?? array())),
    );
    if ($withItems) {
        $out = array();
        foreach ($items as $i => $it) {
            $out[] = array(
                'id' => (int) ($it['id'] ?? ($i + 1)),
                'row_no' => (int) ($it['row_no'] ?? ($i + 1)),
                'code' => (string) ($it['code'] ?? ''),
                'description' => (string) ($it['description'] ?? ''),
                'qty' => $it['qty'] ?? 1,
                'unit' => (string) ($it['unit'] ?? 'عدد'),
                'unit_price' => (int) ($it['unit_price'] ?? 0),
                'discount' => (int) ($it['discount'] ?? 0),
                'tax_rate' => (int) ($it['tax_rate'] ?? 0),
                'total' => (int) ($it['total'] ?? 0),
                'engine' => (string) ($it['engine'] ?? 'manual'),
                'ai_confidence' => (int) ($it['ai_confidence'] ?? 0),
                'verified' => (int) ($it['verified'] ?? 0),
                'note' => (string) ($it['note'] ?? ''),
            );
        }
        $data['items'] = $out;
    }
    if ($withText) {
        $data['ocr_text'] = (string) ($inv['ocr_text'] ?? '');
        $data['raw_json'] = (array) ($inv['raw_json'] ?? array());
    }
    return $data;
}

/** اقلام ورودی را پاک و نرمال می‌کند */
function api_clean_items($raw): array
{
    if (!is_array($raw)) {
        return array();
    }
    $out = array();
    $rowNo = 0;
    foreach (array_slice(array_values($raw), 0, 500) as $it) {
        if (!is_array($it)) {
            continue;
        }
        $desc = trim((string) ($it['description'] ?? ''));
        if ($desc === '') {
            continue;
        }
        $rowNo++;
        $qty = $it['qty'] ?? 1;
        if (!is_numeric($qty)) {
            $qty = 1;
        }
        $qty = max(0, (float) $qty);
        $price = (int) preg_replace('/[^\d-]/', '', (string) ($it['unit_price'] ?? 0));
        $total = (int) preg_replace('/[^\d-]/', '', (string) ($it['total'] ?? 0));
        $out[] = array(
            'row_no' => $rowNo,
            'code' => substr((string) ($it['code'] ?? ''), 0, 60),
            'description' => substr($desc, 0, 300),
            'qty' => $qty,
            'unit' => substr((string) ($it['unit'] ?? 'عدد'), 0, 20),
            'unit_price' => max(0, $price),
            'discount' => max(0, (int) ($it['discount'] ?? 0)),
            'tax_rate' => max(0, (int) ($it['tax_rate'] ?? 0)),
            'total' => max(0, $total ?: (int) round($qty * $price)),
            'engine' => substr((string) ($it['engine'] ?? 'manual'), 0, 24),
            'ai_confidence' => max(0, min(100, (int) ($it['ai_confidence'] ?? 0))),
            'verified' => (int) ($it['verified'] ?? 0),
            'note' => substr((string) ($it['note'] ?? ''), 0, 200),
        );
    }
    return $out;
}

/** جمع‌های فاکتور را از اقلام بازمحاسبه می‌کند (قاعدهٔ _recalc پایتون) */
function api_recalc(array $inv): array
{
    $items = array_values((array) ($inv['items'] ?? array()));
    if ($items) {
        $sum = 0;
        foreach ($items as $it) {
            $sum += (int) ($it['total'] ?? 0);
        }
        if (empty($inv['subtotal']) || (int) $inv['subtotal'] !== $sum) {
            $inv['subtotal'] = $sum;
        }
    }
    $subtotal = (int) ($inv['subtotal'] ?? 0);
    $discount = (int) ($inv['discount'] ?? 0);
    $tax = (int) ($inv['tax'] ?? 0);
    if (empty($inv['total']) || (int) $inv['total'] <= 0) {
        $inv['total'] = max(0, $subtotal - $discount + $tax);
    }
    return $inv;
}

/**
 * ساخت فاکتور از بدنهٔ درخواست.
 * @param array|null $job اگر از یک کار خوانش می‌آید، شناسه‌اش ثبت می‌شود
 */
function api_invoice_create(array $user, array $payload, ?array $job): array
{
    $number = trim((string) ($payload['number'] ?? ''));
    $seller = trim((string) ($payload['seller_name'] ?? ''));
    $items = api_clean_items($payload['items'] ?? array());

    $inv = array(
        'user_id' => (int) $user['id'],
        'number' => substr($number, 0, 80),
        'issue_date' => (string) ($payload['issue_date'] ?? '') ?: fk_today_jalali(),
        'due_date' => substr((string) ($payload['due_date'] ?? ''), 0, 20),
        'invoice_type' => in_array((string) ($payload['invoice_type'] ?? ''), array('printed', 'thermal', 'handwritten', 'audio', 'other'), true)
            ? (string) $payload['invoice_type'] : 'printed',
        'direction' => (string) ($payload['direction'] ?? 'purchase') === 'sale' ? 'sale' : 'purchase',
        'seller_name' => substr($seller, 0, 200),
        'seller_tax_id' => substr((string) ($payload['seller_tax_id'] ?? ''), 0, 40),
        'buyer_name' => substr((string) ($payload['buyer_name'] ?? ''), 0, 200),
        'buyer_tax_id' => substr((string) ($payload['buyer_tax_id'] ?? ''), 0, 40),
        'subtotal' => max(0, (int) ($payload['subtotal'] ?? 0)),
        'discount' => max(0, (int) ($payload['discount'] ?? 0)),
        'tax' => max(0, (int) ($payload['tax'] ?? 0)),
        'total' => max(0, (int) ($payload['total'] ?? 0)),
        'paid' => max(0, (int) ($payload['paid'] ?? 0)),
        'currency' => 'IRR',
        'status' => in_array((string) ($payload['status'] ?? ''), array('draft', 'review', 'confirmed', 'archived'), true)
            ? (string) $payload['status'] : 'draft',
        'source' => in_array((string) ($payload['source'] ?? ''), array('manual', 'cloud', 'local'), true)
            ? (string) $payload['source'] : ($job ? 'cloud' : 'manual'),
        'confidence' => max(0, min(100, (int) ($payload['confidence'] ?? 0))),
        'tags' => is_array($payload['tags'] ?? null) ? implode(',', array_slice(array_map('strval', $payload['tags']), 0, 8))
            : substr((string) ($payload['tags'] ?? ''), 0, 255),
        'notes' => substr((string) ($payload['notes'] ?? ''), 0, 2000),
        'ocr_text' => substr((string) ($payload['ocr_text'] ?? ($job['text'] ?? '')), 0, 400000),
        'raw_json' => array(),
        'file_name' => substr((string) ($payload['file_name'] ?? ($job['name'] ?? '')), 0, 255),
        'file_path' => (string) ($job['local'] ?? ''),
        'file_size' => (int) ($job['bytes'] ?? 0),
        'thumb_color' => '#2b3a55',
        'job_id' => $payload['job_id'] ?? ($job['id'] ?? null),
        'duplicate_of' => null,
        'items_engine' => (string) ($payload['items_engine'] ?? ''),
        'items_confidence' => max(0, min(100, (int) ($payload['items_confidence'] ?? 0))),
        'items_issues' => array_values((array) ($payload['items_issues'] ?? array())),
        'items_autofixed' => max(0, (int) ($payload['items_autofixed'] ?? 0)),
        'items' => $items,
    );

    /* جلوگیری از ثبت تکراری — همان قاعدهٔ پایتون */
    if ($inv['number'] !== '') {
        foreach (fk_rows('invoices') as $other) {
            if ((int) ($other['user_id'] ?? 0) === (int) $user['id']
                && (string) ($other['number'] ?? '') === $inv['number']
                && (string) ($other['seller_name'] ?? '') === $inv['seller_name']) {
                $inv['duplicate_of'] = (int) $other['id'];
                break;
            }
        }
    }

    if (empty($inv['subtotal']) && $items) {
        $sum = 0;
        foreach ($items as $it) {
            $sum += (int) $it['total'];
        }
        $inv['subtotal'] = $sum;
    }
    $inv = api_recalc($inv);
    $saved = fk_insert('invoices', $inv);
    if (!$saved) {
        api_fail('ثبت فاکتور ممکن نشد (دسترسی نوشتن پوشهٔ fk-data را بررسی کنید).', 500);
    }

    /* اگر از کار خوانش آمده، کار را به فاکتور وصل کن */
    if ($job && !empty($job['id'])) {
        $job['invoice_id'] = (int) $saved['id'];
        job_save($job);
    }
    fk_audit($user, 'invoice_create', 'invoice', (int) $saved['id'], 'ثبت فاکتور ' . $inv['number']);
    return api_invoice_public($saved);
}

function api_invoice_update(array $user, array $inv, array $payload): array
{
    $patch = array();
    foreach (array('number', 'issue_date', 'due_date', 'seller_name', 'seller_tax_id',
                   'buyer_name', 'buyer_tax_id', 'notes') as $field) {
        if (array_key_exists($field, $payload)) {
            $patch[$field] = substr(trim((string) $payload[$field]), 0, 2000);
        }
    }
    foreach (array('subtotal', 'discount', 'tax', 'total', 'paid') as $field) {
        if (array_key_exists($field, $payload)) {
            $patch[$field] = max(0, (int) $payload[$field]);
        }
    }
    if (array_key_exists('status', $payload) && in_array((string) $payload['status'], array('draft', 'review', 'confirmed', 'archived'), true)) {
        $patch['status'] = (string) $payload['status'];
    }
    if (array_key_exists('invoice_type', $payload) && in_array((string) $payload['invoice_type'], array('printed', 'thermal', 'handwritten', 'audio', 'other'), true)) {
        $patch['invoice_type'] = (string) $payload['invoice_type'];
    }
    if (array_key_exists('tags', $payload)) {
        $patch['tags'] = is_array($payload['tags'])
            ? implode(',', array_slice(array_map('strval', $payload['tags']), 0, 8))
            : substr((string) $payload['tags'], 0, 255);
    }
    if (array_key_exists('items', $payload)) {
        $patch['items'] = api_clean_items($payload['items']);
        $patch = api_recalc(array_merge($inv, $patch));
        $patch = array_intersect_key($patch, array_flip(array('items', 'subtotal', 'total')));
    }
    if (array_key_exists('ocr_text', $payload) && (string) $payload['ocr_text'] !== '') {
        $patch['ocr_text'] = substr((string) $payload['ocr_text'], 0, 400000);
    }
    $updated = fk_update('invoices', (int) $inv['id'], $patch);
    if (!$updated) {
        api_fail('ویرایش فاکتور ممکن نشد.', 500);
    }
    fk_audit($user, 'invoice_update', 'invoice', (int) $inv['id'], 'ویرایش فاکتور ' . (string) ($updated['number'] ?? ''));
    return api_invoice_public($updated);
}

/** فهرست فاکتورها با همان فیلترها و ساختار پایتون */
function api_invoice_list(array $user): array
{
    $uid = (int) $user['id'];
    $q = trim((string) ($_GET['q'] ?? ''));
    $status = (string) ($_GET['status'] ?? '');
    $type = (string) ($_GET['type'] ?? '');
    $direction = (string) ($_GET['direction'] ?? '');
    $source = (string) ($_GET['source'] ?? '');
    $tag = trim((string) ($_GET['tag'] ?? ''));
    $dateFrom = (string) ($_GET['date_from'] ?? '');
    $dateTo = (string) ($_GET['date_to'] ?? '');
    $page = max(1, (int) ($_GET['page'] ?? 1));
    $perPage = max(1, min((int) ($_GET['per_page'] ?? 20), 200));
    $sort = (string) ($_GET['sort'] ?? 'created_at');
    $order = (string) ($_GET['order'] ?? 'desc') === 'asc' ? 'asc' : 'desc';

    $rows = fk_where('invoices', static function (array $inv) use ($uid): bool {
        return (int) ($inv['user_id'] ?? 0) === $uid;
    });

    $needle = $q !== '' ? fk_text_lower($q) : '';
    $statuses = $status !== '' ? explode(',', $status) : array();
    $types = $type !== '' ? explode(',', $type) : array();

    $filtered = array();
    foreach ($rows as $inv) {
        if ($statuses && !in_array((string) ($inv['status'] ?? ''), $statuses, true)) {
            continue;
        }
        if ($types && !in_array((string) ($inv['invoice_type'] ?? ''), $types, true)) {
            continue;
        }
        if ($direction !== '' && (string) ($inv['direction'] ?? '') !== $direction) {
            continue;
        }
        if ($source !== '' && (string) ($inv['source'] ?? '') !== $source) {
            continue;
        }
        if ($tag !== '') {
            $hayTag = (string) ($inv['tags'] ?? '');
            $hayTag = fk_text_lower($hayTag);
            $needleTag = fk_text_lower($tag);
            if (strpos($hayTag, strtolower($needleTag)) === false) {
                continue;
            }
        }
        if ($dateFrom !== '' && (string) ($inv['issue_date'] ?? '') < $dateFrom) {
            continue;
        }
        if ($dateTo !== '' && (string) ($inv['issue_date'] ?? '') > $dateTo) {
            continue;
        }
        if ($needle !== '') {
            $hay = (string) ($inv['number'] ?? '') . ' ' . (string) ($inv['seller_name'] ?? '')
                . ' ' . (string) ($inv['buyer_name'] ?? '') . ' ' . (string) ($inv['tags'] ?? '')
                . ' ' . (string) ($inv['notes'] ?? '');
            foreach ((array) ($inv['items'] ?? array()) as $it) {
                $hay .= ' ' . (string) ($it['description'] ?? '');
            }
            $hay = fk_text_lower($hay);
            if (strpos($hay, $needle) === false) {
                continue;
            }
        }
        $filtered[] = $inv;
    }

    $sortable = array('created_at', 'issue_date', 'total', 'number', 'confidence', 'status');
    $key = in_array($sort, $sortable, true) ? $sort : 'created_at';
    usort($filtered, static function (array $a, array $b) use ($key, $order): int {
        $va = $a[$key] ?? '';
        $vb = $b[$key] ?? '';
        if (in_array($key, array('total', 'confidence'), true)) {
            $cmp = (int) $va <=> (int) $vb;
        } else {
            $cmp = strcmp((string) $va, (string) $vb);
        }
        return $order === 'asc' ? $cmp : -$cmp;
    });

    $total = count($filtered);
    $slice = array_slice($filtered, ($page - 1) * $perPage, $perPage);
    $items = array();
    foreach ($slice as $inv) {
        $items[] = api_invoice_public($inv, false, false);
    }

    /* جمع کل همهٔ فاکتورهای کاربر (نه فقط این صفحه) */
    $sumTotal = 0;
    $sumTax = 0;
    foreach ($rows as $inv) {
        $sumTotal += (int) ($inv['total'] ?? 0);
        $sumTax += (int) ($inv['tax'] ?? 0);
    }

    return array(
        'items' => $items,
        'total' => $total,
        'page' => $page,
        'per_page' => $perPage,
        'pages' => max(1, (int) ceil($total / $perPage)),
        'summary' => array('count' => count($rows), 'sum_total' => $sumTotal, 'sum_tax' => $sumTax),
    );
}

/** آمار داشبورد — همان ساختار stats پایتون */
function api_invoice_stats(array $user): array
{
    $uid = (int) $user['id'];
    $rows = fk_where('invoices', static function (array $inv) use ($uid): bool {
        return (int) ($inv['user_id'] ?? 0) === $uid;
    });

    $counts = array('total' => count($rows), 'confirmed' => 0, 'draft' => 0, 'review' => 0, 'archived' => 0);
    $sums = array('total' => 0, 'tax' => 0, 'discount' => 0);
    $byType = array();
    $bySource = array();
    $byDate = array();
    $sellers = array();
    $confSum = 0;

    foreach ($rows as $inv) {
        $status = (string) ($inv['status'] ?? 'draft');
        if (isset($counts[$status])) {
            $counts[$status]++;
        }
        $sums['total'] += (int) ($inv['total'] ?? 0);
        $sums['tax'] += (int) ($inv['tax'] ?? 0);
        $sums['discount'] += (int) ($inv['discount'] ?? 0);
        $confSum += (int) ($inv['confidence'] ?? 0);

        $t = (string) ($inv['invoice_type'] ?? 'printed');
        $byType[$t] = ($byType[$t] ?? 0) + 1;
        $s = (string) ($inv['source'] ?? 'manual');
        $bySource[$s] = ($bySource[$s] ?? 0) + 1;

        $date = (string) ($inv['issue_date'] ?? '');
        if ($date === '') {
            $date = '—';
        }
        if (!isset($byDate[$date])) {
            $byDate[$date] = array('total' => 0, 'count' => 0);
        }
        $byDate[$date]['total'] += (int) ($inv['total'] ?? 0);
        $byDate[$date]['count']++;

        $seller = trim((string) ($inv['seller_name'] ?? ''));
        if ($seller !== '') {
            if (!isset($sellers[$seller])) {
                $sellers[$seller] = array('total' => 0, 'count' => 0);
            }
            $sellers[$seller]['total'] += (int) ($inv['total'] ?? 0);
            $sellers[$seller]['count']++;
        }
    }

    ksort($byDate);
    /* آخرین ۴۰ نقطه (همان limit پایتون) */
    $series = array();
    foreach (array_slice($byDate, -40, 40, true) as $date => $agg) {
        $series[] = array('date' => (string) $date, 'total' => (int) $agg['total'], 'count' => (int) $agg['count']);
    }

    uasort($sellers, static function (array $a, array $b): int {
        return (int) $b['total'] <=> (int) $a['total'];
    });
    $topSellers = array();
    foreach (array_slice($sellers, 0, 6, true) as $name => $agg) {
        $topSellers[] = array('name' => (string) $name, 'total' => (int) $agg['total'], 'count' => (int) $agg['count']);
    }

    return array(
        'counts' => $counts,
        'sums' => $sums,
        'by_type' => (object) $byType,
        'by_source' => (object) $bySource,
        'series' => $series,
        'top_sellers' => $topSellers,
        'avg_confidence' => count($rows) > 0 ? (int) round($confSum / count($rows)) : 0,
    );
}

/** عملیات گروهی — حذف، تغییر وضعیت، برچسب */
function api_invoice_bulk(array $user, array $payload): array
{
    $ids = array_values(array_filter(array_map('intval', (array) ($payload['ids'] ?? array()))));
    $action = (string) ($payload['action'] ?? '');
    if (!$ids) {
        api_fail('فاکتوری انتخاب نشده است.', 400);
    }
    $affected = 0;
    foreach ($ids as $id) {
        $inv = api_owned_invoice($user, $id);
        if (!$inv) {
            continue;
        }
        if ($action === 'delete') {
            fk_delete('invoices', $id);
            $affected++;
        } elseif (in_array($action, array('draft', 'review', 'confirmed', 'archived'), true)) {
            fk_update('invoices', $id, array('status' => $action));
            $affected++;
        } elseif ($action === 'tag' && !empty($payload['tag'])) {
            $tags = array_values(array_filter(array_map('trim', explode(',', (string) ($inv['tags'] ?? '')))));
            $tag = substr((string) $payload['tag'], 0, 60);
            if (!in_array($tag, $tags, true)) {
                $tags[] = $tag;
            }
            fk_update('invoices', $id, array('tags' => implode(',', array_slice($tags, 0, 8))));
            $affected++;
        } else {
            api_fail('عملیات درخواستی معتبر نیست.', 400);
        }
    }
    fk_audit($user, 'invoice_bulk', 'invoice', (string) count($ids), $action . ' روی ' . $affected . ' فاکتور');
    return array('ok' => true, 'affected' => $affected);
}

/** خروجی CSV/JSON/اکسل */
function api_invoice_export(array $user): void
{
    $uid = (int) $user['id'];
    $status = (string) ($_GET['status'] ?? '');
    $idsRaw = (string) ($_GET['ids'] ?? '');
    $format = (string) ($_GET['format'] ?? 'xlsx');

    $rows = fk_where('invoices', static function (array $inv) use ($uid): bool {
        return (int) ($inv['user_id'] ?? 0) === $uid;
    });
    if ($idsRaw !== '' && $idsRaw !== 'all') {
        $wanted = array_map('intval', explode(',', $idsRaw));
        $rows = array_values(array_filter($rows, static function (array $inv) use ($wanted): bool {
            return in_array((int) ($inv['id'] ?? 0), $wanted, true);
        }));
    } elseif ($status !== '') {
        $rows = array_values(array_filter($rows, static function (array $inv) use ($status): bool {
            return (string) ($inv['status'] ?? '') === $status;
        }));
    }
    usort($rows, static function (array $a, array $b): int {
        return strcmp((string) ($b['created_at'] ?? ''), (string) ($a['created_at'] ?? ''));
    });
    $rows = array_slice($rows, 0, 5000);
    $today = str_replace('/', '-', fk_today_jalali());

    if ($format === 'json') {
        $out = array();
        foreach ($rows as $inv) {
            $out[] = api_invoice_public($inv, true, false);
        }
        header('Content-Type: application/json; charset=utf-8');
        header('Content-Disposition: attachment; filename="invoices-' . $today . '.json"');
        echo json_encode($out, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
        exit;
    }

    /* اکسل و CSV هر دو CSV می‌گیرند: اکسل با BOM فارسی را درست می‌فهمد.
       (xlsx واقعی یک فایل ZIP با XML است؛ در نسخهٔ PHP نوشتنش ارزش
       دارد ولی CSV با BOM در همهٔ نسخه‌های اکسل بدون خطا باز می‌شود.) */
    $fh = fopen('php://temp', 'r+');
    fputcsv($fh, array('شماره', 'تاریخ', 'نوع', 'فروشنده', 'خریدار', 'جمع اقلام', 'تخفیف', 'مالیات', 'مبلغ کل', 'وضعیت', 'منبع', 'اعتماد', 'اقلام', 'برچسب‌ها'), ',', '"', '\\');
    foreach ($rows as $inv) {
        $itemText = array();
        foreach ((array) ($inv['items'] ?? array()) as $it) {
            $itemText[] = (string) ($it['description'] ?? '') . ' ×' . (string) ($it['qty'] ?? 1);
        }
        fputcsv($fh, array(
            (string) ($inv['number'] ?? ''),
            (string) ($inv['issue_date'] ?? ''),
            (string) ($inv['invoice_type'] ?? ''),
            (string) ($inv['seller_name'] ?? ''),
            (string) ($inv['buyer_name'] ?? ''),
            (string) (int) ($inv['subtotal'] ?? 0),
            (string) (int) ($inv['discount'] ?? 0),
            (string) (int) ($inv['tax'] ?? 0),
            (string) (int) ($inv['total'] ?? 0),
            (string) ($inv['status'] ?? ''),
            (string) ($inv['source'] ?? ''),
            (string) (int) ($inv['confidence'] ?? 0),
            implode(' | ', $itemText),
            (string) ($inv['tags'] ?? ''),
        ), ',', '"', '\\');
    }
    rewind($fh);
    $csv = (string) stream_get_contents($fh);
    fclose($fh);
    $ext = $format === 'xlsx' ? 'csv' : 'csv';
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="invoices-' . $today . '.' . $ext . '"');
    echo chr(0xEF) . chr(0xBB) . chr(0xBF) . $csv;
    exit;
}

/** ارسال فایل اصلی فاکتور */
function api_send_invoice_file(array $inv): void
{
    $path = (string) ($inv['file_path'] ?? '');
    if ($path === '' || !is_file($path)) {
        api_fail('فایل اصلی موجود نیست.', 404);
    }
    api_strean_file($path, (string) ($inv['file_name'] ?? basename($path)));
}

function api_send_job_file(array $job): void
{
    $path = (string) ($job['local'] ?? '');
    if ($path === '' || !is_file($path)) {
        api_fail('فایل اصلی این کار موجود نیست.', 404);
    }
    api_strean_file($path, (string) ($job['name'] ?? basename($path)));
}

function api_strean_file(string $path, string $name): void
{
    $size = @filesize($path) ?: 0;
    header('Content-Type: application/octet-stream');
    header('Content-Length: ' . $size);
    header('Content-Disposition: attachment; filename="' . rawurlencode($name) . '"');
    @readfile($path);
    exit;
}

/* ══════════════════════ فهم اقلام ══════════════════════ */

/** مقدار متنی از JSON یا query (برای understand) */
function api_str_or_json(string $key, string $default = ''): string
{
    $v = api_input($key, $default);
    return is_array($v) ? $default : (string) $v;
}

/**
 * همان `/api/invoices/understand` نسخهٔ پایتون.
 * اگر قلمی پیدا نشود، ۴۲۲ با پیام روشن برمی‌گرداند — نه صفحهٔ خالی.
 */
function api_understand(string $text, string $invoiceType, bool $autofix): array
{
    $text = substr($text, 0, 200000);
    if (strlen(trim($text)) < 5) {
        api_fail('متنی برای تحلیل ارسال نشده است.', 400);
    }
    $type = in_array($invoiceType, array('printed', 'thermal', 'handwritten', 'audio', 'auto'), true)
        ? $invoiceType : 'printed';

    $opts = array('type' => $type);
    if ($type === 'auto') {
        $detected = fk_detect_invoice_type($text);
        $opts['type'] = (string) ($detected['type'] ?? 'printed');
    }
    $understood = fk_understand($text, $opts);
    $items = (array) ($understood['items'] ?? array());
    if (!$items) {
        api_fail('هیچ قلمی در متن پیدا نشد. متن را واضح‌تر بفرستید یا از عکس استفاده کنید.', 422);
    }

    if ($autofix) {
        $fixed = fk_autofix_items($items, (array) ($understood['totals'] ?? array()));
        $understood['items'] = (array) ($fixed[0] ?? $items);
        $understood['totals'] = (array) ($fixed[1] ?? ($understood['totals'] ?? array()));
        $understood['autofix'] = (array) ($fixed[2] ?? array());
        $items = $understood['items'];
    }

    $parsed = fk_parsed_for_ui($understood, $text);
    $total = 0;
    foreach ($items as $it) {
        $total += (int) ($it['total'] ?? 0);
    }
    return array(
        'items' => $parsed['items'],
        'totals' => array_merge((array) ($understood['totals'] ?? array()), array('items_sum' => $total)),
        'issues' => $parsed['warnings'],
        'autofix' => (array) ($understood['autofix'] ?? array()),
        'confidence' => (int) ($understood['confidence'] ?? 0),
        'engine' => 'rules',
        'meta' => (array) ($understood['meta'] ?? array()),
        'parsed' => $parsed,
        'item_count' => count($items),
        'items_sum' => $total,
    );
}

/** همان `/api/invoices/fix-numbers` */
function api_fix_numbers(array $payload): array
{
    $items = api_clean_items($payload['items'] ?? array());
    if (!$items) {
        api_fail('فهرست اقلام خالی است.', 400);
    }
    $totalsIn = (array) ($payload['totals'] ?? array());
    $sum = 0;
    foreach ($items as $it) {
        $sum += (int) ($it['total'] ?? 0);
    }
    $totals = array(
        'subtotal' => (int) ($totalsIn['subtotal'] ?? 0),
        'discount' => (int) ($totalsIn['discount'] ?? 0),
        'tax' => (int) ($totalsIn['tax'] ?? 0),
        'total' => (int) ($totalsIn['total'] ?? 0),
        'items_sum' => $sum,
    );
    /* fk_autofix_items سه‌تایی برمی‌گرداند: [اقلام, جمع‌ها, تغییرات].
       قبلاً این‌جا مثل آرایهٔ انجمنی خوانده می‌شد و همیشه خالی می‌ماند. */
    $fixed = fk_autofix_items($items, $totals);
    $outItems = (array) ($fixed[0] ?? $items);
    $outTotals = (array) ($fixed[1] ?? $totals);
    $changes = (array) ($fixed[2] ?? array());

    /* اگر خواستند روی یک فاکتور موجود اعمال شود */
    $applyTo = (int) ($payload['apply_to'] ?? 0);
    if ($applyTo > 0) {
        $user = api_require_user();
        $inv = api_owned_invoice($user, $applyTo);
        if (!$inv) {
            api_fail('فاکتور پیدا نشد.', 404);
        }
        fk_update('invoices', $applyTo, array(
            'items' => $outItems,
            'subtotal' => (int) ($outTotals['subtotal'] ?? 0),
            'total' => (int) ($outTotals['total'] ?? 0),
            'items_autofixed' => count($changes),
        ));
    }

    $issues = array();
    foreach ((array) ($payload['issues'] ?? array()) as $issue) {
        $issues[] = is_array($issue) ? (string) ($issue['message'] ?? '') : (string) $issue;
    }
    return array(
        'items' => $outItems,
        'totals' => $outTotals,
        'changes' => $changes,
        'issues' => $issues,
        'confidence' => 100 - min(100, 8 * count($issues)),
    );
}

/* ══════════════════════ پنل مدیریت ══════════════════════ */

function api_admin_overview(array $admin): array
{
    $users = fk_rows('users');
    $subs = fk_rows('subscriptions');
    $activeSubs = 0;
    $trialing = 0;
    foreach ($subs as $s) {
        if ((string) ($s['status'] ?? '') === 'active' && fk_sub_valid($s)) {
            $activeSubs++;
        }
        if ((string) ($s['status'] ?? '') === 'trialing') {
            $trialing++;
        }
    }
    $keysUnused = fk_count('keys', static function (array $k): bool {
        return (string) ($k['status'] ?? '') === 'unused';
    });
    $keysUsed = fk_count('keys', static function (array $k): bool {
        return (string) ($k['status'] ?? '') === 'used';
    });
    $openTickets = fk_count('tickets', static function (array $t): bool {
        return (string) ($t['status'] ?? '') === 'new';
    });

    $revenue = 0;
    foreach (fk_rows('keys') as $k) {
        if ((string) ($k['status'] ?? '') !== 'used') {
            continue;
        }
        $plan = fk_row('plans', (int) ($k['plan_id'] ?? 0));
        $revenue += $plan ? (int) ($plan['price'] ?? 0) : 0;
    }

    $audit = fk_rows('audit');
    usort($audit, static function (array $a, array $b): int {
        return strcmp((string) ($b['created_at'] ?? ''), (string) ($a['created_at'] ?? ''));
    });
    $recent = array();
    foreach (array_slice($audit, 0, 12) as $r) {
        $recent[] = array(
            'id' => (int) $r['id'],
            'actor' => (string) ($r['actor'] ?? ''),
            'action' => (string) ($r['action'] ?? ''),
            'detail' => (string) ($r['detail'] ?? ''),
            'ip' => (string) ($r['ip'] ?? ''),
            'at' => (string) ($r['created_at'] ?? ''),
        );
    }

    $plugins = array();
    return array(
        'counts' => array(
            'users' => count($users),
            'active_subscriptions' => $activeSubs,
            'trialing' => $trialing,
            'invoices' => fk_count('invoices'),
            'jobs' => count(api_user_jobs($admin)),
            'keys_unused' => $keysUnused,
            'keys_used' => $keysUsed,
            'open_tickets' => $openTickets,
        ),
        'revenue' => $revenue,
        'features' => fk_features_total(),
        'cloud' => array(
            'configured' => token_is_set(),
            'gateway_ready' => gateway_url() !== '',
            'length' => (int) (load_config()['token_len'] ?? 0),
        ),
        'recent' => $recent,
    );
}

function api_admin_users(): array
{
    $q = trim((string) ($_GET['q'] ?? ''));
    $status = (string) ($_GET['status'] ?? '');
    $page = max(1, (int) ($_GET['page'] ?? 1));
    $perPage = max(1, min((int) ($_GET['per_page'] ?? 20), 100));

    $rows = fk_rows('users');
    if ($q !== '') {
        $needle = fk_text_lower($q);
        $rows = array_values(array_filter($rows, static function (array $u) use ($needle): bool {
            $hay = ($u['email'] ?? '') . ' ' . ($u['full_name'] ?? '') . ' ' . ($u['phone'] ?? '') . ' ' . ($u['company'] ?? '');
            $hay = fk_text_lower((string) $hay);
            return strpos($hay, $needle) !== false;
        }));
    }
    if ($status === 'active') {
        $rows = array_values(array_filter($rows, static function (array $u): bool {
            return !empty($u['is_active']);
        }));
    } elseif ($status === 'inactive') {
        $rows = array_values(array_filter($rows, static function (array $u): bool {
            return empty($u['is_active']);
        }));
    }
    usort($rows, static function (array $a, array $b): int {
        return strcmp((string) ($b['created_at'] ?? ''), (string) ($a['created_at'] ?? ''));
    });
    $total = count($rows);
    $items = array();
    foreach (array_slice($rows, ($page - 1) * $perPage, $perPage) as $u) {
        $data = fk_user_public($u);
        $data['subscription'] = fk_sub_public(fk_subscription((int) $u['id']));
        $data['invoice_count'] = fk_count('invoices', static function (array $inv) use ($u): bool {
            return (int) ($inv['user_id'] ?? 0) === (int) $u['id'];
        });
        $data['last_ip'] = (string) ($u['last_ip'] ?? '');
        $items[] = $data;
    }
    return array(
        'items' => $items, 'total' => $total, 'page' => $page, 'per_page' => $perPage,
        'pages' => max(1, (int) ceil($total / $perPage)),
    );
}

function api_admin_user(array $admin, int $id, array $payload): array
{
    $target = fk_row('users', $id);
    if (!$target) {
        api_fail('کاربر یافت نشد.', 404);
    }
    if ($id === (int) $admin['id'] && isset($payload['is_active']) && !$payload['is_active']) {
        api_fail('نمی‌توانید حساب خودتان را غیرفعال کنید.', 400);
    }
    if ((string) ($target['role'] ?? '') === 'owner' && !fk_is_owner($admin)) {
        api_fail('تغییر حساب مالک فقط توسط مالک مجاز است.', 403);
    }
    if (!empty($payload['delete'])) {
        if ((string) ($target['role'] ?? '') === 'owner') {
            api_fail('حساب مالک حذف نمی‌شود. اول نقش را تغییر دهید.', 400);
        }
        /* داده‌های کاربر هم پاک می‌شود — قاعدهٔ CASCADE نسخهٔ پایتون */
        foreach (fk_where('invoices', static function (array $inv) use ($id): bool {
            return (int) ($inv['user_id'] ?? 0) === $id;
        }) as $inv) {
            fk_delete('invoices', (int) $inv['id']);
        }
        $sub = fk_subscription($id);
        if ($sub) {
            fk_delete('subscriptions', (int) $sub['id']);
        }
        fk_delete('users', $id);
        fk_audit($admin, 'user_delete', 'user', $id, 'حذف کاربر ' . (string) $target['email']);
        return array('ok' => true);
    }

    $patch = array();
    if (isset($payload['is_active'])) {
        $patch['is_active'] = (bool) $payload['is_active'];
        if (!$patch['is_active']) {
            $_SESSION['revoked'] = true;
        }
    }
    if (!empty($payload['role']) && in_array((string) $payload['role'], array('admin', 'user', 'owner'), true)) {
        if ((string) $payload['role'] === 'owner' && !fk_is_owner($admin)) {
            api_fail('تعیین نقش مالک مجاز نیست.', 403);
        }
        $patch['role'] = (string) $payload['role'];
    }
    if ($patch) {
        fk_update('users', $id, $patch);
    }

    if (!empty($payload['plan_id'])) {
        $plan = fk_row('plans', (int) $payload['plan_id']);
        if ($plan) {
            $sub = fk_ensure_subscription($id);
            $days = (int) ($plan['duration_days'] ?? 365);
            fk_update('subscriptions', (int) $sub['id'], array(
                'plan_id' => (int) $plan['id'],
                'status' => 'active',
                'ends_at' => gmdate('Y-m-d H:i:s', time() + $days * 86400),
                'support_until' => gmdate('Y-m-d H:i:s', time() + $days * 86400),
                'pages_quota' => (int) ($plan['page_quota'] ?? 0),
                'notes' => 'تعیین دستی توسط مدیر',
            ));
        }
    }
    if (isset($payload['add_days']) && (int) $payload['add_days'] !== 0) {
        $sub = fk_ensure_subscription($id);
        $base = max(time(), fk_ts((string) ($sub['ends_at'] ?? '')));
        fk_update('subscriptions', (int) $sub['id'], array(
            'status' => 'active',
            'ends_at' => gmdate('Y-m-d H:i:s', $base + (int) $payload['add_days'] * 86400),
        ));
    }
    if (isset($payload['pages_delta']) && (int) $payload['pages_delta'] !== 0) {
        $sub = fk_ensure_subscription($id);
        fk_update('subscriptions', (int) $sub['id'], array(
            'pages_quota' => max(0, (int) ($sub['pages_quota'] ?? 0) + (int) $payload['pages_delta']),
        ));
    }
    if (isset($payload['sub_status']) && in_array((string) $payload['sub_status'], array('active', 'trialing', 'expired', 'blocked'), true)) {
        $sub = fk_ensure_subscription($id);
        fk_update('subscriptions', (int) $sub['id'], array('status' => (string) $payload['sub_status']));
    }

    fk_audit($admin, 'user_update', 'user', $id, 'ویرایش کاربر ' . (string) $target['email']);
    $fresh = fk_row('users', $id) ?? $target;
    $data = fk_user_public($fresh);
    $data['subscription'] = fk_sub_public(fk_subscription($id));
    return array('ok' => true, 'user' => $data);
}

/** بازنشانی گذرواژه به یک رمز موقت — یک‌بار نمایش داده می‌شود */
function api_admin_reset_password(array $admin, int $id): array
{
    $target = fk_row('users', $id);
    if (!$target) {
        api_fail('کاربر یافت نشد.', 404);
    }
    if ((string) ($target['role'] ?? '') === 'owner' && !fk_is_owner($admin)) {
        api_fail('بازنشانی رمز مالک فقط توسط مالک مجاز است.', 403);
    }
    $temp = 'Fk-' . bin2hex(random_bytes(4));
    fk_update('users', $id, array(
        'password_hash' => fk_hash_password($temp),
        'must_change_password' => true,
        'failed_attempts' => 0,
        'locked_until' => '',
    ));
    fk_audit($admin, 'user_reset_password', 'user', $id, 'بازنشانی رمز ' . (string) $target['email']);
    return array(
        'ok' => true,
        'password' => $temp,
        'message' => 'رمز موقت ساخته شد. آن را به کاربر بدهید؛ در اولین ورود باید عوض کند.',
    );
}

function api_admin_plans(): array
{
    $items = array();
    foreach (fk_rows('plans') as $p) {
        $items[] = fk_plan_public($p);
    }
    usort($items, static function (array $a, array $b): int {
        return (int) $a['sort_order'] <=> (int) $b['sort_order'];
    });
    return array('items' => $items);
}

function api_admin_plan(array $admin, int $id, array $payload): array
{
    if (!empty($payload['delete'])) {
        $plan = fk_row('plans', $id);
        if (!$plan) {
            api_fail('طرح یافت نشد.', 404);
        }
        fk_delete('plans', $id);
        fk_audit($admin, 'plan_delete', 'plan', $id, 'حذف طرح ' . (string) $plan['name']);
        return array('ok' => true);
    }

    $fields = array('code', 'name', 'tagline');
    $ints = array('price' => 0, 'duration_days' => 365, 'support_days' => 365,
                  'page_quota' => 1000, 'max_devices' => 1, 'sort_order' => 0);
    $patch = array();
    foreach ($fields as $f) {
        if (isset($payload[$f])) {
            $patch[$f] = substr(trim((string) $payload[$f]), 0, 200);
        }
    }
    foreach ($ints as $f => $def) {
        if (isset($payload[$f])) {
            $patch[$f] = max(0, (int) $payload[$f]);
        }
    }
    foreach (array('is_active', 'is_featured') as $f) {
        if (isset($payload[$f])) {
            $patch[$f] = (bool) $payload[$f];
        }
    }
    if (isset($payload['features'])) {
        $patch['features'] = is_array($payload['features'])
            ? array_values(array_map('strval', $payload['features']))
            : array_values(array_filter(array_map('trim', explode("\n", (string) $payload['features']))));
    }

    if ($id > 0) {
        $plan = fk_row('plans', $id);
        if (!$plan) {
            api_fail('طرح یافت نشد.', 404);
        }
        $updated = fk_update('plans', $id, $patch);
        fk_audit($admin, 'plan_update', 'plan', $id, 'ویرایش طرح ' . (string) ($updated['name'] ?? ''));
        return array('ok' => true, 'plan' => fk_plan_public($updated ?? $plan));
    }

    if (empty($patch['code']) || empty($patch['name'])) {
        api_fail('کد و نام طرح لازم است.', 422);
    }
    if (fk_find('plans', 'code', (string) $patch['code'])) {
        api_fail('این کد طرح قبلاً استفاده شده است.', 409);
    }
    $base = array(
        'code' => '', 'name' => '', 'tagline' => '', 'price' => 0,
        'duration_days' => 365, 'support_days' => 365, 'page_quota' => 1000,
        'max_devices' => 1, 'features' => array(), 'is_active' => true,
        'is_featured' => false, 'sort_order' => 9,
    );
    $created = fk_insert('plans', array_merge($base, $patch));
    if (!$created) {
        api_fail('ساخت طرح ممکن نشد.', 500);
    }
    fk_audit($admin, 'plan_create', 'plan', (int) $created['id'], 'ساخت طرح ' . (string) $created['name']);
    return array('ok' => true, 'plan' => fk_plan_public($created));
}

function api_admin_keys(): array
{
    $status = (string) ($_GET['status'] ?? '');
    $planId = (int) ($_GET['plan_id'] ?? 0);
    $page = max(1, (int) ($_GET['page'] ?? 1));
    $perPage = max(1, min((int) ($_GET['per_page'] ?? 30), 100));

    $rows = fk_rows('keys');
    if ($status !== '') {
        $rows = array_values(array_filter($rows, static function (array $k) use ($status): bool {
            return (string) ($k['status'] ?? '') === $status;
        }));
    }
    if ($planId > 0) {
        $rows = array_values(array_filter($rows, static function (array $k) use ($planId): bool {
            return (int) ($k['plan_id'] ?? 0) === $planId;
        }));
    }
    usort($rows, static function (array $a, array $b): int {
        return strcmp((string) ($b['created_at'] ?? ''), (string) ($a['created_at'] ?? ''));
    });
    $total = count($rows);
    $items = array();
    foreach (array_slice($rows, ($page - 1) * $perPage, $perPage) as $k) {
        $items[] = fk_key_public($k);
    }
    return array(
        'items' => $items, 'total' => $total, 'page' => $page,
        'per_page' => $perPage, 'pages' => max(1, (int) ceil($total / $perPage)),
    );
}

function api_admin_keys_create(array $admin, array $payload): array
{
    $planId = (int) ($payload['plan_id'] ?? 0);
    $count = max(1, min((int) ($payload['count'] ?? 1), 200));
    $plan = fk_row('plans', $planId);
    if (!$plan) {
        api_fail('طرح انتخاب‌شده معتبر نیست.', 422);
    }
    $note = substr((string) ($payload['note'] ?? ''), 0, 220);
    $expires = (string) ($payload['expires_at'] ?? '');
    $keys = array();
    for ($i = 0; $i < $count; $i++) {
        $value = fk_license_generate();
        $tries = 0;
        while (fk_find('keys', 'key', $value) && $tries < 20) {
            $value = fk_license_generate();
            $tries++;
        }
        $row = fk_insert('keys', array(
            'key' => $value,
            'plan_id' => $planId,
            'status' => 'unused',
            'note' => $note,
            'created_by' => (int) $admin['id'],
            'expires_at' => $expires,
            'redeemed_at' => '',
            'redeemed_by' => null,
        ));
        if ($row) {
            $keys[] = $value;
        }
    }
    fk_audit($admin, 'key_create', 'license', (string) count($keys), 'ساخت ' . count($keys) . ' کد برای ' . (string) $plan['name']);
    /* همان شکل نسخهٔ پایتون: رابط به created و file_hint تکیه می‌کند */
    return array(
        'ok' => true,
        'created' => count($keys),
        'count' => count($keys),
        'plan' => (string) $plan['name'],
        'keys' => $keys,
        'file_hint' => 'این کدها فقط یک‌بار نمایش داده می‌شوند؛ همین حالا ذخیره یا کپی کنید.',
    );
}

function api_admin_key_action(array $admin, int $id, string $action): array
{
    $key = fk_row('keys', $id);
    if (!$key) {
        api_fail('کد یافت نشد.', 404);
    }
    if ($action === 'delete') {
        fk_delete('keys', $id);
        fk_audit($admin, 'key_delete', 'license', $id, 'حذف کد');
        return array('ok' => true);
    }
    fk_update('keys', $id, array('status' => 'revoked'));
    fk_audit($admin, 'key_revoke', 'license', $id, (string) $key['key']);
    return array('ok' => true);
}

/** پشتیبان کامل به‌صورت JSON — همان ساختار backup پایتون */
function api_backup(array $admin): void
{
    $payload = array(
        'meta' => array(
            'app' => FK_APP_TITLE,
            'version' => FK_APP_VERSION,
            'engine' => 'php',
            'generated_at' => fk_now(),
            'date' => fk_today_jalali(),
        ),
        'users' => array_map(static function (array $u): array {
            unset($u['password_hash']);
            return $u;
        }, fk_rows('users')),
        'plans' => fk_rows('plans'),
        'license_keys' => fk_rows('keys'),
        'subscriptions' => fk_rows('subscriptions'),
        'invoices' => array_map(static function (array $inv): array {
            unset($inv['ocr_text']);
            return $inv;
        }, fk_rows('invoices')),
        'settings' => fk_cfg_all(),
        'tickets' => fk_rows('tickets'),
        'audit' => array_slice(fk_rows('audit'), -500),
    );
    fk_audit($admin, 'backup_export', 'system', '', 'دریافت پشتیبان');
    header('Content-Type: application/json; charset=utf-8');
    header('Content-Disposition: attachment; filename="faktorkhan-backup-' . str_replace('/', '-', fk_today_jalali()) . '.json"');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    exit;
}

/** تاریخ شمسی امروز — از موتور موجود */
function fk_today_jalali(): string
{
    $d = fk_fa_date(time(), false);
    return str_replace('-', '/', $d);
}
