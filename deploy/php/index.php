<?php
/**
 * فاکتورخوان — نسخهٔ PHP برای WAMP / XAMPP
 * =========================================
 * یک برنامه، بدون پایگاه داده. توکن هرگز نمایش داده نمی‌شود.
 *
 * معماری درخواست‌های کوتاه:
 *   index.php                 صفحه (بدون عملیات طولانی)
 *   index.php?api=start       آپلود + ثبت فایل + شروع تبدیل  (چند ثانیه)
 *   index.php?api=job&id=…    وضعیت یک کار  (سریع، هر ۳ ثانیه از مرورگر)
 *   index.php?api=cancel&id=… لغو کار
 *
 * هیچ درخواستی منتظر پایان OCR نمی‌ماند؛ بنابراین صفحه قفل نمی‌شود و
 * «صفحهٔ سفید» رخ نمی‌دهد.
 */

declare(strict_types=1);

require_once __DIR__ . '/lib.php';

@ini_set('display_errors', '1');
error_reporting(E_ALL & ~E_DEPRECATED & ~E_NOTICE);
@date_default_timezone_set('Asia/Tehran');
@set_time_limit(120);

const APP_TITLE = 'فاکتورخوان — خوانش فاکتور با سرویس ابری';

/* ═══════════════════════════ API ═══════════════════════════ */

function json_out(array $data, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

$api = (string) ($_GET['api'] ?? '');

if ($api !== '') {
    start_session();
    if (!is_logged_in()) {
        json_out(array('ok' => false, 'error' => 'auth', 'message' => 'نشست شما منقضی شده است؛ صفحه را دوباره باز کنید.'), 401);
    }

    /* نشست را همین‌جا می‌بندیم: فایل نشست قفل می‌ماند اگر بسته نشود و
       درخواست‌های موازی مرورگر (poll، لغو، تب دیگر) پشت هم صف می‌کشند. */
    $freeSession = static function (): void {
        if (session_status() === PHP_SESSION_ACTIVE) {
            @session_write_close();
        }
    };

    /* ── وضعیت کار ─────────────────────────────────────────── */
    if ($api === 'job') {
        $id = (string) ($_GET['id'] ?? '');
        $job = job_load($id);
        if ($job === null) {
            json_out(array('ok' => false, 'error' => 'notfound', 'message' => 'این کار پیدا نشد.'), 404);
        }
        $freeSession();
        $terminal = job_is_terminal($job);
        if (!$terminal || !empty($job['cleanup_pending'])) {
            $job = job_tick($job);   // یک قدم کوتاه (حداکثر یک فراخوانی درگاه)
        }
        json_out(array(
            'ok' => true,
            'job' => array(
                'id' => $job['id'],
                'status' => $job['status'],
                'stage' => $job['stage'],
                'progress' => (int) $job['progress'],
                'message' => $job['message'],
                'text' => (string) ($job['text'] ?? ''),
                'pages' => (int) ($job['pages'] ?? 0),
                'saved' => (string) ($job['saved'] ?? ''),
                'cleanup' => !empty($job['cleanup_pending']),
                'real_progress' => !empty($job['real_progress']),
                'slow' => !empty($job['slow']),
                'wait_seconds' => (int) ($job['wait_seconds'] ?? 0),
                'method' => (int) ($job['method'] ?? 0),
                'name' => (string) ($job['name'] ?? ''),
                'age' => time() - (int) ($job['created_at'] ?? time()),
            ),
        ));
    }

    /* ── لغو کار ───────────────────────────────────────────── */
    if ($api === 'cancel') {
        $id = (string) ($_GET['id'] ?? '');
        $job = job_load($id);
        if ($job === null) {
            json_out(array('ok' => false, 'message' => 'کار پیدا نشد.'), 404);
        }
        $freeSession();
        /* اگر کار هنوز به سرویس ابری نرفته، فقط فایل محلی پاک می‌شود؛
           وگرنه هم تبدیل و هم فایل روی سرویس ابری حذف می‌شوند
           (تا اعتبار/توکن شما بی‌دلیل مصرف نشود). */
        if (!empty($job['file_token'])) {
            call_gateway(array('command' => 'cancelconvert', 'filetoken' => $job['file_token']), null, null, '', 12);
            call_gateway(array('command' => 'deletefile', 'filetoken' => $job['file_token']), null, null, '', 12);
        }
        job_drop_local($job);
        $job['status'] = 'cancelled';
        $job['stage'] = 'cancelled';
        $job['message'] = 'کار توسط شما لغو شد.';
        job_save($job);
        json_out(array('ok' => true));
    }

    /* ── شروع کار (آپلود) ──────────────────────────────────── */
    if ($api === 'start') {
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
            json_out(array('ok' => false, 'message' => 'روش نامعتبر.'), 405);
        }
        if (!csrf_ok($_POST['csrf'] ?? null)) {
            json_out(array('ok' => false, 'message' => 'درخواست نامعتبر است؛ صفحه را دوباره باز کنید.'), 400);
        }
        if (!token_is_set()) {
            json_out(array('ok' => false, 'message' => 'ابتدا توکن سرویس ابری را ثبت کنید.'), 400);
        }
        $file = $_FILES['document'] ?? null;
        if (!$file || ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
            json_out(array('ok' => false,
                'message' => $file ? upload_error_text((int) $file['error']) : 'فایلی انتخاب نشد.'), 400);
        }
        $cfg = load_config();
        $maxMb = (int) ($cfg['max_upload_mb'] ?? 25);
        if ((int) $file['size'] > $maxMb * 1024 * 1024) {
            json_out(array('ok' => false, 'message' => 'حجم فایل بیشتر از ' . $maxMb . ' مگابایت است.'), 400);
        }
        if ((int) $file['size'] === 0) {
            json_out(array('ok' => false, 'message' => 'فایل خالی است. فایل دیگری انتخاب کنید.'), 400);
        }
        $origName = (string) ($file['name'] ?? 'document');
        $ext = strtolower(pathinfo($origName, PATHINFO_EXTENSION));
        $allowed = (array) ($cfg['allowed_ext'] ?? array('pdf', 'jpg', 'jpeg', 'png', 'bmp'));
        if (!in_array($ext, $allowed, true)) {
            json_out(array('ok' => false, 'message' => 'این قالب پشتیبانی نمی‌شود: ' . h($ext)), 400);
        }

        $sendName = preg_replace('/[^\w.\-]/u', '_', basename($origName)) ?: ('document.' . $ext);
        $mime = (string) ($file['type'] ?? '');
        if ($mime === '' || $mime === 'application/octet-stream') {
            $mime = mime_for_ext($ext);
        }

        $method = max(1, min(4, (int) ($_POST['method'] ?? 4)));
        $output = (string) ($_POST['output'] ?? 'txt');
        $deleteAfter = !empty($_POST['delete_after']);

        /* فایل را روی همین سرور نگه می‌داریم؛ ارسال به سرویس ابری در
           درخواست‌های کوتاه بعدی (poll) انجام می‌شود. */
        $stashed = stash_upload((string) $file['tmp_name'], $ext);
        if ($stashed === '') {
            json_out(array('ok' => false,
                'message' => 'ذخیرهٔ فایل روی سرور ممکن نشد. دسترسی نوشتن پوشهٔ fk-uploads را بررسی کنید.'), 500);
        }

        $job = job_create(array(
            'name' => $sendName,
            'ext' => $ext,
            'method' => $method,
            'output' => $output,
            'size' => (int) $file['size'],
        ));
        $job = job_queue($job, $stashed, $sendName, $mime, $method, $output, $deleteAfter);

        /* شناسهٔ کار را در نشست نگه می‌داریم تا بعد از رفرش هم قابل بازیابی باشد */
        $ids = (array) ($_SESSION['jobs'] ?? array());
        $ids[] = $job['id'];
        $_SESSION['jobs'] = array_slice($ids, -20);
        $freeSession();

        json_out(array(
            'ok' => true,
            'job' => array(
                'id' => $job['id'],
                'status' => $job['status'],
                'stage' => $job['stage'],
                'progress' => (int) $job['progress'],
                'message' => $job['message'],
                'pages' => (int) $job['pages'],
                'method' => (int) $job['method'],
                'name' => $job['name'],
            ),
        ));
    }

    json_out(array('ok' => false, 'message' => 'درخواست ناشناخته.'), 400);
}

/* ═══════════════════ عملیات فرم (POST کوتاه) ═══════════════════ */

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$action = (string) ($_POST['action'] ?? '');

if ($method === 'POST' && $action === 'logout') {
    if (csrf_ok($_POST['csrf'] ?? null)) {
        $_SESSION = array();
        @session_destroy();
    }
    header('Location: ' . strtok($_SERVER['REQUEST_URI'], '?'), true, 303);
    exit;
}

if ($method === 'POST' && $action === 'login') {
    if (!csrf_ok($_POST['csrf'] ?? null)) {
        flash('error', 'درخواست نامعتبر است. صفحه را دوباره باز کنید.');
        redirect();
    }
    $hash = (string) (load_config()['password_hash'] ?? '');
    if ($hash === '' || !password_verify((string) ($_POST['password'] ?? ''), $hash)) {
        usleep(700000);
        flash('error', 'گذرواژه اشتباه است.');
        redirect();
    }
    session_regenerate_id(true);
    $_SESSION['auth'] = true;
    redirect();
}

if ($method === 'POST' && $action === 'setup_password') {
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
    if (!save_config($cfg)) {
        flash('error', 'نوشتن فایل تنظیمات ممکن نشد. دسترسی پوشه را بررسی کنید.');
        redirect();
    }
    $_SESSION['auth'] = true;
    flash('ok', 'گذرواژه تنظیم شد. حالا توکن سرویس ابری را ثبت کنید.');
    redirect();
}

if ($method === 'POST' && $action === 'save_token') {
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
    if (!save_config($cfg)) {
        flash('error', 'ذخیرهٔ توکن ممکن نشد (دسترسی نوشتن).');
        redirect();
    }
    flash('ok', 'توکن ذخیره شد و دیگر نمایش داده نمی‌شود.');
    redirect();
}

if ($method === 'POST' && $action === 'clear_token') {
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

if ($method === 'POST' && $action === 'test_credit') {
    if (!is_logged_in() || !csrf_ok($_POST['csrf'] ?? null)) {
        flash('error', 'دسترسی غیرمجاز.');
        redirect();
    }
    $res = call_gateway(array('command' => 'checkcredit'), null, null, '', 25);
    if ($res['ok']) {
        $ocr = (int) ($res['data']['OCRCredit'] ?? 0);
        $audio = (int) ($res['data']['AudioTranscribeCredit'] ?? 0);
        flash('ok', 'ارتباط برقرار است — اعتبار OCR: ' . number_format($ocr)
            . ' صفحه · صوت: ' . number_format($audio) . ' ثانیه');
    } else {
        flash('error', $res['message']);
    }
    redirect();
}

if ($method === 'GET' && isset($_GET['cleanup'])) {
    job_gc();
    flash('ok', 'کارهای قدیمی پاک شدند.');
    redirect();
}

/* ═══════════════════════════ نمایش ═══════════════════════════ */

$flash = take_flash();
$logged = is_logged_in();
$cfg = load_config();
$tokenSet = !empty($cfg['token']);
$tokenMasked = mask((string) ($cfg['token'] ?? ''));
$hasCurl = function_exists('curl_init');
$phpOk = version_compare(PHP_VERSION, '7.4', '>=');
$uploadMax = (string) ini_get('upload_max_filesize');
$postMax = (string) ini_get('post_max_size');
$csrf = csrf_token();

/* کارهای اخیر این نشست (برای بازیابی بعد از رفرش) */
$recent = array();
if ($logged) {
    start_session();
    $ids = (array) ($_SESSION['jobs'] ?? array());
    foreach (array_slice(array_reverse($ids), 0, 5) as $jid) {
        $j = job_load((string) $jid);
        if ($j) {
            $recent[] = array(
                'id' => $j['id'],
                'name' => (string) ($j['name'] ?? ''),
                'status' => $j['status'],
                'message' => $j['message'],
                'updated' => (int) $j['updated_at'],
            );
        }
    }
}
?>
<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title><?= h(APP_TITLE) ?></title>
<style>
  :root{--bg:#0b0d12;--card:#141824;--line:#252c3b;--txt:#eef1f7;--dim:#98a2b8;
        --gold:#d4af37;--teal:#2dd4bf;--red:#f0616d;--green:#3ecf8e}
  *{box-sizing:border-box}
  body{margin:0;background:radial-gradient(1100px 560px at 82% -12%,#1a2233 0%,#0b0d12 58%) fixed;
       color:var(--txt);font-family:Vazirmatn,Tahoma,system-ui,sans-serif;line-height:1.9;padding:16px}
  .wrap{max-width:960px;margin:0 auto}
  .brand{display:flex;align-items:center;gap:12px;margin:16px 0 20px}
  .mark{width:44px;height:44px;border-radius:12px;background:linear-gradient(135deg,#f5e6a8,#d4af37);
        display:grid;place-items:center;color:#1a1508;font-weight:800;font-size:19px}
  h1{font-size:19px;margin:0}
  .sub{color:var(--dim);font-size:12px}
  .card{background:linear-gradient(180deg,#151a26,#12161f);border:1px solid var(--line);
        border-radius:16px;padding:18px;margin-bottom:14px}
  .card h2{font-size:15px;margin:0 0 12px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  label{display:block;margin:10px 0 6px;font-size:12px;color:var(--dim)}
  input[type=password],input[type=text],input[type=file],select{width:100%;padding:11px 12px;border-radius:10px;
       border:1px solid var(--line);background:#0e121b;color:var(--txt);font-family:inherit;font-size:14px}
  input[type=file]{padding:9px}
  .row{display:flex;gap:10px;flex-wrap:wrap}
  .row>*{flex:1;min-width:150px}
  button{padding:11px 18px;border-radius:10px;border:1px solid var(--line);background:#1b2130;color:var(--txt);
         font-family:inherit;font-size:14px;cursor:pointer;font-weight:600;transition:.15s}
  button.primary{background:linear-gradient(135deg,#e8d99a,#d4af37);border-color:#d4af37;color:#231c07}
  button.danger{background:#2a1620;border-color:#5c2433;color:#ffb3bd}
  button.ghost{background:transparent}
  button:hover:not(:disabled){filter:brightness(1.12)}
  button:disabled{opacity:.55;cursor:not-allowed}
  .muted{color:var(--dim);font-size:12px;margin:6px 0 0}
  .pill{display:inline-block;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700}
  .pill.ok{background:rgba(62,207,142,.14);color:var(--green);border:1px solid rgba(62,207,142,.3)}
  .pill.bad{background:rgba(240,97,109,.13);color:var(--red);border:1px solid rgba(240,97,109,.3)}
  .pill.wait{background:rgba(212,175,55,.14);color:var(--gold);border:1px solid rgba(212,175,55,.3)}
  .flash{padding:12px 14px;border-radius:12px;margin-bottom:12px;font-size:13px;border:1px solid}
  .flash.ok{background:rgba(62,207,142,.1);border-color:rgba(62,207,142,.35);color:#b8f2d6}
  .flash.error{background:rgba(240,97,109,.1);border-color:rgba(240,97,109,.35);color:#ffc4ca}
  table{width:100%;border-collapse:collapse;font-size:12.5px}
  td{padding:7px 4px;border-bottom:1px solid var(--line);color:var(--dim)}
  td:last-child{color:var(--txt);text-align:left}
  pre{background:#0a0d14;border:1px solid var(--line);border-radius:12px;padding:14px;overflow:auto;
      white-space:pre-wrap;direction:rtl;font-size:13px;max-height:440px;font-family:Vazirmatn,Tahoma,monospace}
  .ltr{direction:ltr;text-align:left;font-family:ui-monospace,monospace}
  .foot{color:#5d6779;font-size:11px;text-align:center;margin:20px 0 10px}
  a{color:var(--gold)}
  .progress{height:9px;background:#0e121b;border:1px solid var(--line);border-radius:999px;overflow:hidden;margin:12px 0 8px}
  .progress i{display:block;height:100%;width:0;background:linear-gradient(90deg,#2dd4bf,#3ecf8e);
              transition:width .5s ease}
  .progress.indet i{width:35%;animation:slide 1.4s infinite ease-in-out}
  @keyframes slide{0%{margin-right:-35%}100%{margin-right:100%}}
  .kpi{display:flex;gap:12px;flex-wrap:wrap;margin-top:10px}
  .kpi div{background:#0e121b;border:1px solid var(--line);border-radius:12px;padding:9px 14px;font-size:12px;color:var(--dim)}
  .kpi b{display:block;font-size:17px;color:var(--txt)}
  .job-row{display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid var(--line);font-size:12.5px}
</style>
</head>
<body>
<div class="wrap">
  <div class="brand">
    <div class="mark">ف</div>
    <div>
      <h1><?= h(APP_TITLE) ?></h1>
      <div class="sub">نسخهٔ PHP — <?= h(PHP_VERSION) ?> · پردازش پس‌زمینه (بدون قفل شدن صفحه)</div>
    </div>
  </div>

  <?php if ($flash): ?>
    <div class="flash <?= $flash['type'] === 'ok' ? 'ok' : 'error' ?>"><?= h($flash['message']) ?></div>
  <?php endif; ?>

  <?php if (!$phpOk || !$hasCurl): ?>
    <div class="card">
      <h2>⚠️ پیش‌نیاز</h2>
      <?php if (!$phpOk): ?>
        <p class="muted">نسخهٔ PHP این سرور <?= h(PHP_VERSION) ?> است؛ حداقل 7.4 لازم است.</p>
      <?php endif; ?>
      <?php if (!$hasCurl): ?>
        <p class="muted">افزونهٔ <b class="ltr">curl</b> فعال نیست. در WAMP: آیکن → PHP → php.ini →
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
        <input type="hidden" name="csrf" value="<?= h($csrf) ?>">
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
        <input type="hidden" name="csrf" value="<?= h($csrf) ?>">
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
        <tr><td>درگاه</td><td><?= gateway_url() !== '' ? 'آماده (درون برنامه)' : 'نامعتبر' ?></td></tr>
        <tr><td>اثر انگشت مخفی</td><td class="ltr"><?= $tokenSet ? h($tokenMasked) : '—' ?></td></tr>
      </table>
      <form method="post" autocomplete="off" style="margin-top:12px">
        <input type="hidden" name="action" value="save_token">
        <input type="hidden" name="csrf" value="<?= h($csrf) ?>">
        <label><?= $tokenSet ? 'جایگزینی توکن' : 'توکن را بچسبانید' ?></label>
        <input type="text" name="token" dir="ltr" placeholder="توکن API" required>
        <div class="row" style="margin-top:12px">
          <button class="primary" type="submit">ذخیره توکن</button>
          <button type="submit" name="action" value="test_credit" formnovalidate>تست اعتبار</button>
          <?php if ($tokenSet): ?>
            <button class="danger" type="submit" name="action" value="clear_token" formnovalidate>حذف توکن</button>
          <?php endif; ?>
        </div>
      </form>
    </div>

    <div class="card">
      <h2>📄 پردازش فایل</h2>
      <form id="upload-form" autocomplete="off">
        <input type="hidden" name="csrf" value="<?= h($csrf) ?>">
        <label>فایل (عکس، PDF یا صوتی)</label>
        <input type="file" name="document" id="doc" required
               accept=".pdf,.jpg,.jpeg,.png,.bmp,.tif,.tiff,.mp3,.wav,.m4a,.mp4,.ogg,.flac,.3gp">
        <div class="row" style="margin-top:10px">
          <div>
            <label>روش تبدیل</label>
            <select name="method" id="method">
              <option value="4" selected>۴ — استخراج متن (پیشنهادی برای عکس/دست‌نویس)</option>
              <option value="1">۱ — Word</option>
              <option value="2">۲ — Word با حفظ ساختار</option>
              <option value="3">۳ — Word (حالت سوم)</option>
            </select>
          </div>
          <div>
            <label>قالب خروجی</label>
            <select name="output" id="output">
              <option value="txt" selected>متن ساده — سریع‌ترین ⚡</option>
              <option value="txtraw">متن خام — سریع</option>
              <option value="keeplayout">Word با چیدمان — کندتر</option>
              <option value="txtrawjson">متن + مختصات (JSON) — کندترین</option>
            </select>
            <p class="muted" style="margin:6px 0 0;font-size:11px">
              «مختصات» موقعیت هر کلمه را هم می‌فرستد و چند برابر کندتر است؛
              برای فاکتور معمولی لازم نیست.
            </p>
          </div>
        </div>
        <label style="display:flex;align-items:center;gap:8px;margin-top:12px">
          <input type="checkbox" name="delete_after" value="1" checked style="width:auto">
          حذف فایل از سرور ابری پس از پردازش (توصیه می‌شود)
        </label>
        <div class="row" style="margin-top:12px">
          <button class="primary" type="submit" id="go">ارسال و خوانش</button>
          <button type="button" class="danger" id="stop" style="display:none">لغو پردازش</button>
        </div>
      </form>
      <p class="muted">حداکثر حجم: <b class="ltr"><?= h($uploadMax) ?></b> ·
        حداکثر POST: <b class="ltr"><?= h($postMax) ?></b> ·
        پردازش در پس‌زمینه انجام می‌شود و صفحه قفل نمی‌شود.</p>

      <div id="job" style="display:none;margin-top:16px">
        <div class="job-row">
          <span id="job-name" class="ltr" style="color:var(--dim)"></span>
          <span id="job-state" class="pill wait">در صف</span>
        </div>
        <div class="progress" id="bar-wrap"><i id="bar"></i></div>
        <p class="muted" id="job-msg" style="margin:0"></p>
        <p class="muted" id="job-meta"></p>
        <p class="muted" id="job-elapsed" style="margin:0;font-size:12px">
          زمان سپری‌شده: <b class="ltr" id="job-clock">۰</b>
        </p>
        <div id="result" style="display:none">
          <div class="kpi" id="kpi"></div>
          <pre id="text"></pre>
          <p class="muted" id="saved" style="display:none"></p>
        </div>
        <div id="job-err" class="flash error" style="display:none;margin:12px 0 0"></div>
      </div>
    </div>

    <?php if ($recent): ?>
      <div class="card">
        <h2>🕘 کارهای اخیر</h2>
        <?php foreach ($recent as $r): ?>
          <div class="job-row">
            <span class="ltr" style="color:var(--dim)"><?= h($r['name'] !== '' ? $r['name'] : $r['id']) ?></span>
            <span>
              <span class="pill <?= $r['status'] === 'done' ? 'ok' : ($r['status'] === 'failed' ? 'bad' : 'wait') ?>">
                <?= h($r['status'] === 'done' ? 'آماده' : ($r['status'] === 'failed' ? 'خطا' : 'در حال پردازش')) ?>
              </span>
              <button class="ghost" type="button" data-job="<?= h($r['id']) ?>">نمایش</button>
            </span>
          </div>
        <?php endforeach; ?>
        <p class="muted"><a href="?cleanup=1">پاک کردن کارهای قدیمی</a></p>
      </div>
    <?php endif; ?>

    <div class="card" style="font-size:12px;color:var(--dim)">
      <h2>🖥 سرور</h2>
      <table>
        <tr><td>PHP</td><td class="ltr"><?= h(PHP_VERSION) ?></td></tr>
        <tr><td>curl</td><td><?= $hasCurl ? 'فعال' : 'غیرفعال' ?></td></tr>
        <tr><td>حداکثر آپلود</td><td class="ltr"><?= h($uploadMax) ?></td></tr>
      </table>
      <p class="muted">
        <a href="check.php">بررسی سرور</a> ·
        <a href="diag.php">عیب‌یابی سرویس ابری</a>
      </p>
      <form method="post" style="margin-top:8px">
        <input type="hidden" name="action" value="logout">
        <input type="hidden" name="csrf" value="<?= h($csrf) ?>">
        <button class="ghost" type="submit">خروج</button>
      </form>
    </div>
  <?php endif; ?>

  <div class="foot">
    فاکتورخوان · توکن هرگز در صفحه نمایش داده نمی‌شود ·
    <span class="ltr"><?= h(date('Y-m-d H:i')) ?></span>
    <?php if (is_https()): ?>
      <br>⚠️ با <b class="ltr">https</b> باز کرده‌اید؛ WAMP معمولاً SSL ندارد — با <b class="ltr">http://</b> باز کنید.
    <?php endif; ?>
  </div>
</div>

<?php if ($logged): ?>
<script>
(function () {
  "use strict";
  var form = document.getElementById("upload-form");
  var go = document.getElementById("go");
  var stop = document.getElementById("stop");
  var box = document.getElementById("job");
  var bar = document.getElementById("bar");
  var barWrap = document.getElementById("bar-wrap");
  var state = document.getElementById("job-state");
  var msg = document.getElementById("job-msg");
  var meta = document.getElementById("job-meta");
  var nameEl = document.getElementById("job-name");
  var result = document.getElementById("result");
  var textEl = document.getElementById("text");
  var kpi = document.getElementById("kpi");
  var savedEl = document.getElementById("saved");
  var errBox = document.getElementById("job-err");
  var timer = null;
  var current = null;
  var polls = 0;
  var cleanedOnce = false;
  var lastStage = null;
  var tick = null;
  var startedAt = 0;

  function setState(label, cls) {
    state.textContent = label;
    state.className = "pill " + (cls || "wait");
  }
  function showError(text) {
    errBox.style.display = "block";
    errBox.textContent = text;
  }
  function hideError() {
    errBox.style.display = "none";
    errBox.textContent = "";
  }
  function clearTimer() {
    if (timer) { clearTimeout(timer); timer = null; }
    stopTicker();
  }
  function reset() {
    hideError();
    result.style.display = "none";
    textEl.textContent = "";
    kpi.innerHTML = "";
    savedEl.style.display = "none";
    bar.style.width = "0%";
    barWrap.className = "progress";
    meta.textContent = "";
  }

  function paint(job) {
    nameEl.textContent = job.name || "";
    msg.textContent = job.message || "";
    var p = Math.max(0, Math.min(100, job.progress || 0));
    bar.style.width = p + "%";
    var bits = [];
    if (job.pages) bits.push(job.pages + " صفحه");
    if (job.method) bits.push("روش " + job.method);
    bits.push(p + "٪");
    meta.textContent = bits.join(" · ");

    if (job.status === "done") {
      setState("آماده", "ok");
      barWrap.className = "progress";
      bar.style.width = "100%";
      result.style.display = "block";
      textEl.textContent = job.text || "(خروجی متنی خالی است)";
      kpi.innerHTML = '<div>تعداد صفحه<b>' + (job.pages || 0) + "</b></div>"
        + '<div>روش<b>' + (job.method || "-") + "</b></div>"
        + '<div>طول متن<b>' + ((job.text || "").length) + "</b></div>";
      if (job.saved) {
        savedEl.style.display = "block";
        savedEl.innerHTML = 'فایل خروجی ذخیره شد: <b class="ltr">' + job.saved + "</b> — از پوشهٔ fk-uploads بردارید.";
      }
      stop.style.display = "none";
      go.disabled = false;
      clearTimer();
      stopTicker();
      // یک درخواست بی‌صدا تا سرور فایل را از سرویس ابری حذف کند (بدون قفل شدن صفحه)
      if (job.cleanup && !cleanedOnce) {
        cleanedOnce = true;
        setTimeout(function () {
          fetch("?api=job&id=" + encodeURIComponent(job.id) + "&_=" + Date.now(),
                { headers: { "Accept": "application/json" }, cache: "no-store" }).catch(function () {});
        }, 1200);
      }
    } else if (job.status === "failed" || job.status === "cancelled") {
      var cancelled = job.status === "cancelled";
      setState(cancelled ? "لغو شد" : "خطا", "bad");
      barWrap.className = "progress";
      if (cancelled) {
        msg.textContent = job.message || "پردازش لغو شد.";
        hideError();
      } else {
        showError((job.message || "پردازش ناموفق بود.") + (job.stage ? " (مرحله: " + job.stage + ")" : ""));
      }
      stop.style.display = "none";
      go.disabled = false;
      clearTimer();
      stopTicker();
    } else {
      var labels = { queued: "در صف", addfile: "ارسال فایل", convert: "شروع تبدیل",
                     wait: "در حال پردازش", download: "دریافت خروجی" };
      setState(labels[job.stage] || "در حال پردازش", "wait");

      // فقط وقتی سرویس درصد واقعی می‌دهد نوار را پر کن؛
      // وگرنه نوار متحرک (indeterminate) + زمان‌سنج واقعی نشان بده
      // تا کاربر فکر نکند روی یک عدد ساختگی گیر کرده است.
      var waiting = job.stage === "wait" && !job.real_progress;
      if (waiting) {
        barWrap.className = "progress indet";
        bar.style.width = "35%";
      } else {
        barWrap.className = "progress";
        bar.style.width = p + "%";
      }
      if (job.slow) {
        setState("کندتر از معمول", "bad");
      }
      stop.style.display = "inline-block";
      go.disabled = true;
    }
  }

  function startTicker() {
    if (tick) { clearInterval(tick); }
    startedAt = Date.now();
    tick = setInterval(function () {
      var el = document.getElementById("job-clock");
      if (!el) { return; }
      var sec = Math.floor((Date.now() - startedAt) / 1000);
      el.textContent = sec < 60 ? (sec + " ثانیه") : (Math.floor(sec / 60) + ":" + ("0" + (sec % 60)).slice(-2));
    }, 1000);
  }
  function stopTicker() {
    if (tick) { clearInterval(tick); tick = null; }
  }

  function poll(id) {
    polls++;
    var url = "?api=job&id=" + encodeURIComponent(id) + "&_=" + Date.now();
    fetch(url, { headers: { "Accept": "application/json" }, cache: "no-store" })
      .then(function (r) {
        if (r.status === 401) { throw new Error("نشست شما منقضی شده است؛ صفحه را دوباره باز کنید."); }
        return r.json();
      })
      .then(function (data) {
        if (!data.ok) { throw new Error(data.message || "خطا در دریافت وضعیت"); }
        var elapsed = (data.job && data.job.age) || 0;
        var prevStage = lastStage;
        lastStage = data.job.stage;
        paint(data.job);
        if (data.job.status === "done" || data.job.status === "failed"
            || data.job.status === "cancelled") { return; }

        // مراحل «ارسال / تبدیل» فقط چند ثانیه‌اند: بی‌درنگ مرحلهٔ بعد را بفرست
        // تا هیچ ثانیه‌ای بین مراحل تلف نشود. برای «در حال پردازش» فاصله طبیعی است.
        var delay;
        var quick = data.job.stage === "addfile" || data.job.stage === "convert"
                 || data.job.stage === "download" || data.job.stage === "queued";
        if (prevStage !== data.job.stage && quick) {
          delay = 120;                          // تغییر مرحله → فوری (بدون ثانیهٔ مرده)
        } else if (quick) {
          delay = 800;                          // همان مرحلهٔ کوتاه → سریع دوباره
        } else if (data.job.stage === "wait" && !data.job.real_progress && elapsed < 120) {
          delay = 1500;                         // ۲ دقیقهٔ اول: هر ۱.۵ ثانیه بپرس
        } else if (data.job.progress > 0 && data.job.progress < 99 && data.job.real_progress) {
          delay = 2000;                         // سرویس درصد می‌دهد → هر ۲ ثانیه
        } else if (elapsed < 600) {
          delay = 3000;                         // انتظار متوسط
        } else {
          delay = 5000;                         // انتظار طولانی → کمتر مزاحم شو
        }
        timer = setTimeout(function () { poll(id); }, delay);
      })
      .catch(function (err) {
        showError(err.message || "ارتباط با سرور برقرار نشد.");
        setState("قطع ارتباط", "bad");
        go.disabled = false;
        stop.style.display = "none";
        clearTimer();
      });
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    hideError();
    var fileInput = document.getElementById("doc");
    if (!fileInput.files || !fileInput.files.length) {
      showError("اول یک فایل انتخاب کنید.");
      return;
    }
    var fd = new FormData();
    fd.append("csrf", form.querySelector('[name="csrf"]').value);
    fd.append("document", fileInput.files[0]);
    fd.append("method", document.getElementById("method").value);
    fd.append("output", document.getElementById("output").value);
    if (form.querySelector('[name="delete_after"]').checked) { fd.append("delete_after", "1"); }

    reset();
    box.style.display = "block";
    go.disabled = true;
    setState("در حال ارسال", "wait");
    msg.textContent = "در حال آپلود فایل…";
    barWrap.className = "progress indet";
    nameEl.textContent = fileInput.files[0].name;
    stop.style.display = "none";

    var xhr = new XMLHttpRequest();
    xhr.open("POST", "?api=start&_=" + Date.now(), true);
    xhr.setRequestHeader("Accept", "application/json");
    xhr.upload.onprogress = function (ev) {
      if (ev.lengthComputable) {
        var pct = Math.round(ev.loaded / ev.total * 100);
        msg.textContent = "در حال آپلود… " + pct + "٪";
      }
    };
    xhr.onload = function () {
      var data = null;
      try { data = JSON.parse(xhr.responseText); } catch (err) { data = null; }
      if (xhr.status === 401) {
        showError("نشست شما منقضی شده است؛ صفحه را دوباره باز کنید و وارد شوید.");
        go.disabled = false; return;
      }
      if (!data) {
        showError("پاسخ سرور قابل خواندن نبود (کد " + xhr.status + "). اگر تکرار شد، صفحهٔ check.php را ببینید.");
        setState("خطا", "bad"); go.disabled = false; return;
      }
      if (!data.ok) {
        setState("خطا", "bad");
        showError(data.message || "شروع پردازش ناموفق بود.");
        go.disabled = false;
        return;
      }
      current = data.job.id;
      polls = 0;
      startTicker();
      paint(data.job);
      poll(current);
    };
    xhr.onerror = function () {
      showError("ارتباط با سرور قطع شد. اینترنت/سرور را بررسی کنید.");
      setState("قطع ارتباط", "bad");
      go.disabled = false;
    };
    xhr.send(fd);
  });

  stop.addEventListener("click", function () {
    if (!current) { return; }
    clearTimer();
    stop.disabled = true;
    fetch("?api=cancel&id=" + encodeURIComponent(current), { cache: "no-store" })
      .catch(function () {})
      .then(function () {
        stop.disabled = false;
        setState("لغو شد", "bad");
        msg.textContent = "پردازش لغو شد و فایل از سرور ابری حذف شد.";
        go.disabled = false;
        stop.style.display = "none";
      });
  });

  // نمایش کارهای قبلی
  var buttons = document.querySelectorAll("[data-job]");
  for (var i = 0; i < buttons.length; i++) {
    buttons[i].addEventListener("click", function (e) {
      var id = e.currentTarget.getAttribute("data-job");
      current = id;
      polls = 0;
      box.style.display = "block";
      result.style.display = "none";
      hideError();
      setState("در حال بررسی", "wait");
      poll(id);
      window.scrollTo({ top: box.offsetTop - 20, behavior: "smooth" });
    });
  }

  // اگر صفحه بسته شد، تایمر پاک شود
  window.addEventListener("beforeunload", clearTimer);
})();
</script>
<?php endif; ?>
</body>
</html>
