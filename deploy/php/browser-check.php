<?php
/**
 * فاکتورخوان — بررسی مرورگر (بدون توکن، بدون تغییر چیزی)
 * ======================================================
 * اگر برنامه باز نمی‌شود و نمی‌دانید مشکل از مرورگر است یا سرور:
 *     http://localhost/faktorkhan/browser-check.php  (یا /browser-check)
 *
 * این صفحه هیچ وابستگی‌ای ندارد و با ES5 نوشته شده تا در هر مرورگری باز شود.
 * پس از رفع مشکل می‌توانید پاکش کنید.
 */

declare(strict_types=1);

@ini_set('display_errors', '1');
error_reporting(E_ALL);

$server = array(
    'نسخهٔ PHP'            => PHP_VERSION,
    'افزونهٔ curl'         => extension_loaded('curl') ? 'فعال' : 'غیرفعال',
    'افزونهٔ json'         => extension_loaded('json') ? 'فعال' : 'غیرفعال',
    'افزونهٔ openssl'      => extension_loaded('openssl') ? 'فعال' : 'غیرفعال',
    'آپلود فایل'           => ini_get('file_uploads') ? 'روشن' : 'خاموش',
    'حداکثر حجم آپلود'     => (string) ini_get('upload_max_filesize'),
    'مسیر سشن'             => (string) ini_get('session.save_path'),
    'سشن قابل نوشتن'       => is_writable((string) ini_get('session.save_path')) ? 'بله' : 'نمی‌دانم',
    'حالت آزمایش'          => (defined('FK_DEBUG') && FK_DEBUG) ? 'روشن' : 'خاموش',
);
?>
<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>بررسی مرورگر — فاکتورخوان</title>
<style>
  :root{color-scheme:dark}
  *{box-sizing:border-box}
  body{margin:0;padding:24px;background:#0b0d12;color:#f2f4f8;
       font-family:Tahoma,Vazirmatn,system-ui,sans-serif;line-height:1.9}
  .wrap{max-width:760px;margin:0 auto}
  h1{font-size:20px;margin:0 0 4px;color:#e7c873}
  .sub{color:#8a94a8;font-size:13px;margin:0 0 20px}
  .card{background:#141824;border:1px solid #2a3142;border-radius:14px;padding:18px;margin-bottom:14px}
  .row{display:flex;gap:10px;padding:7px 0;border-bottom:1px solid #1d2331;font-size:13.5px;align-items:flex-start}
  .row:last-child{border-bottom:0}
  .row .k{flex:0 0 190px;color:#9aa4b8}
  .row .v{flex:1;word-break:break-word;direction:ltr;text-align:left}
  .ok{color:#34d399;font-weight:700}
  .bad{color:#f87171;font-weight:700}
  .warn{color:#fbbf24;font-weight:700}
  .pill{display:inline-block;padding:2px 9px;border-radius:999px;font-size:11.5px;font-weight:700}
  .pill.ok{background:rgba(52,211,153,.15);color:#34d399}
  .pill.bad{background:rgba(248,113,113,.15);color:#f87171}
  .verdict{font-size:15px;font-weight:700;margin:0 0 10px}
  button{background:#e7c873;color:#12151d;border:0;border-radius:9px;padding:10px 20px;
         font-family:inherit;font-size:13.5px;font-weight:700;cursor:pointer;margin:6px 6px 0 0}
  button.ghost{background:#1b2130;color:#c9d1e0;border:1px solid #2a3142;font-weight:500}
  textarea{width:100%;min-height:150px;background:#0a0d14;color:#c9d1e0;border:1px solid #2a3142;
           border-radius:9px;padding:10px;font-family:monospace;font-size:11.5px;direction:ltr;
           text-align:left;margin-top:10px}
  code{background:#1b2130;padding:1px 6px;border-radius:5px;direction:ltr;display:inline-block}
  .hint{font-size:12.5px;color:#8a94a8;margin-top:8px}
</style>
</head>
<body>

<div class="wrap">
  <h1>🔍 بررسی مرورگر</h1>
  <p class="sub">این صفحه نشان می‌دهد مرورگر شما دقیقاً چه چیزی کم دارد — بدون حدس و گمان.</p>

  <div class="card">
    <p class="verdict" id="verdict">در حال بررسی…</p>
    <div id="rows"></div>
  </div>

  <div class="card">
    <strong style="font-size:14px">گزارش برای پشتیبانی</strong>
    <p class="hint">اگر گفتید «مرورگرم به‌روز است ولی برنامه باز نمی‌شود»، این متن را برای پشتیبانی بفرستید.</p>
    <textarea id="report" readonly></textarea>
    <button type="button" id="copy">کپی گزارش</button>
    <button type="button" class="ghost" id="again">بررسی دوباره</button>
  </div>
</div>
  <div class="card">
    <strong style="font-size:14px">سرور (PHP)</strong>
    <div style="margin-top:8px"><?php foreach ($server as $k => $v): ?>
      <div class="row"><span class="k"><?= htmlspecialchars($k, ENT_QUOTES, 'UTF-8') ?></span><span class="v"><?= htmlspecialchars((string)$v, ENT_QUOTES, 'UTF-8') ?></span></div>
<?php endforeach; ?>
    </div>
  </div>

<script>
/* این صفحه عمداً هیچ وابستگی‌ای ندارد و با ES5 نوشته شده تا در هر مرورگری باز شود. */
(function () {
  "use strict";

  var checks = [];
  function add(name, ok, value, fatal) {
    checks.push({ name: name, ok: ok, value: value, fatal: !!fatal });
  }

  function detect() {
    checks = [];

    // ۱) موتور جاوااسکریپت — بدون eval/new Function
    var modern = typeof Symbol === "function" && typeof Map === "function"
      && typeof Set === "function" && typeof Promise === "function"
      && typeof Object.assign === "function"
      && typeof Array.prototype.includes === "function";
    add("سازنده‌های ES2015", modern, modern ? "موجود" : "ناقص", true);

    // ۲) fetch
    var hasFetch = typeof window.fetch === "function";
    add("fetch", hasFetch, hasFetch ? "موجود" : "نیست", true);

    // ۳) Promise
    add("Promise", typeof Promise === "function", typeof Promise === "function" ? "موجود" : "نیست", true);

    // ۴) localStorage
    var lsOk = false, lsErr = "";
    try {
      var p = "__probe__";
      window.localStorage.setItem(p, "1");
      window.localStorage.removeItem(p);
      lsOk = true;
    } catch (e) { lsErr = e.name + ": " + e.message; }
    add("localStorage", lsOk, lsOk ? "قابل نوشتن" : "مسدود — " + lsErr, false);

    // ۵) sessionStorage
    var ssOk = false;
    try {
      var q = "__probe__";
      window.sessionStorage.setItem(q, "1");
      window.sessionStorage.removeItem(q);
      ssOk = true;
    } catch (e) { ssOk = false; }
    add("sessionStorage", ssOk, ssOk ? "قابل نوشتن" : "مسدود", false);

    // ۶) cookie
    var cOk = false;
    try {
      document.cookie = "__fk_probe__=1; path=/";
      cOk = document.cookie.indexOf("__fk_probe__") !== -1;
    } catch (e) { cOk = false; }
    add("کوکی", cOk, cOk ? "فعال" : "مسدود — کوکی‌های شخص ثالث/همه را چک کنید", false);

    // ۷) داخل iframe؟
    var inFrame = false;
    try { inFrame = window.self !== window.top; } catch (e) { inFrame = true; }
    add("داخل قاب (iframe)", !inFrame, inFrame ? "بله — ورود ماندگار نمی‌شود" : "نه", false);

    // ۸) service worker
    var sw = "serviceWorker" in navigator;
    add("Service Worker", sw, sw ? "پشتیبانی می‌شود" : "نیست (اختیاری)", false);

    // ۹) ذخیره‌سازی بدون کوکی (کروم ۱۲۱+)
    var thirdParty = !!(navigator.cookieEnabled === false);
    add("کوکی‌ها در تنظیمات", navigator.cookieEnabled,
        navigator.cookieEnabled ? "روشن" : "خاموش — تنظیمات کروم → Privacy", false);

    // ۱۰) پروتکل
    var proto = location.protocol;
    add("پروتکل صفحه", proto === "http:" || proto === "https:", proto, false);

    // ۱۱) حالت ناشناس (تشخیص تقریبی)
    var incognito = false;
    try {
      // در حالت ناشناس، سهمیهٔ ذخیره‌سازی معمولاً بسیار کوچک است
      incognito = typeof navigator.storage === "object" && navigator.storage.estimate
        ? false : false;
    } catch (e) { incognito = false; }
    add("مرورگر", true, navigator.userAgent, false);
  }

  function paint() {
    var rows = document.getElementById("rows");
    var html = "";
    var fatalCount = 0, softCount = 0;
    for (var i = 0; i < checks.length; i++) {
      var c = checks[i];
      var cls = c.ok ? "ok" : (c.fatal ? "bad" : "warn");
      var mark = c.ok ? "✓" : (c.fatal ? "✗" : "!");
      html += '<div class="row"><span class="k">' + c.name + '</span>'
        + '<span class="v ' + cls + '">' + mark + " " + String(c.value)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") + "</span></div>";
      if (!c.ok && c.fatal) fatalCount++;
      if (!c.ok && !c.fatal) softCount++;
    }
    rows.innerHTML = html;

    var v = document.getElementById("verdict");
    if (fatalCount > 0) {
      v.className = "verdict bad";
      v.textContent = "✗ این مرورگر واقعاً قابلیت لازم را ندارد — برنامه درست کار نخواهد کرد.";
    } else if (softCount > 0) {
      v.className = "verdict warn";
      v.textContent = "! مرورگر شما به‌روز است، ولی " + softCount
        + " تنظیم حریم خصوصی جلوی ماندگاری نشست را می‌گیرد.";
    } else {
      v.className = "verdict ok";
      v.textContent = "✓ مرورگر شما کاملاً سازگار است — اگر برنامه باز نشد، مشکل از سرور یا شبکه است.";
    }

    var lines = ["فاکتورخوان — گزارش مرورگر", "آدرس: " + location.href, ""];
    for (var j = 0; j < checks.length; j++) {
      lines.push((checks[j].ok ? "[OK]   " : "[FAIL] ") + checks[j].name + " → " + checks[j].value);
    }
    lines.push("", "زمان: " + new Date().toISOString());
    document.getElementById("report").value = lines.join("\n");
  }

  function run() {
    detect();
    paint();
  }

  document.getElementById("again").onclick = run;
  document.getElementById("copy").onclick = function () {
    var ta = document.getElementById("report");
    var btn = this;
    var done = false;
    ta.select();
    try { done = document.execCommand("copy"); } catch (e) { done = false; }
    if (!done && navigator.clipboard) {
      navigator.clipboard.writeText(ta.value);
      done = true;
    }
    btn.textContent = done ? "کپی شد ✓" : "کپی نشد — متن را دستی انتخاب کنید";
    setTimeout(function () { btn.textContent = "کپی گزارش"; }, 2500);
  };

  run();
})();
</script>
</body>
</html>
