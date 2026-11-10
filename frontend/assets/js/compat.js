/* ══════════════════════════════════════════════════════════════
   بررسی سازگاری مرورگر — فاکتورخوان
   باید پیش از همهٔ اسکریپت‌ها بارگذاری شود و فقط از ES5 استفاده کند،
   چون هدفش مرورگرهایی است که بقیهٔ کد را نمی‌توانند اجرا کنند
   (IE11 در ویندوز ۷، کروم/فایرفاکس قدیمی).
   ══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  function supportsModernJs() {
    /*
     * هیچ کدی از رشته اجرا نمی‌کنیم (نه new Function، نه eval).
     * نسخهٔ قبلی برای «آزمودن» پشتیبانی جاوااسکریپت یک تابع با new Function
     * می‌ساخت؛ CSP پیش‌فرض برنامه 'unsafe-eval' را ممنوع می‌کند، پس آن فراخوانی
     * با EvalError رد می‌شد و نتیجهٔ دروغ «مرورگر قدیمی» می‌داد — روی کروم
     * تازه‌به‌روزرسانی‌شده.
     *
     * بررسی واقعی: وجود سازنده‌های استاندارد ES2015+ که فاکتورخوان
     * استفاده می‌کند. اگر همه باشند، مرورگر به‌اندازهٔ کافی مدرن است.
     * خودِ این فایل هم با ES5 نوشته شده، پس در مرورگر بسیار قدیمی هم
     * بی‌خطا اجرا می‌شود و به این تابع می‌رسد.
     */
    return typeof Symbol === "function"
      && typeof Map === "function"
      && typeof Set === "function"
      && typeof Promise === "function"
      && typeof Object.assign === "function"
      && typeof Array.prototype.includes === "function"
      && typeof String.prototype.startsWith === "function";
  }

  var problems = [];
  if (!supportsModernJs()) problems.push("نحو جاوااسکریپت مدرن");
  if (typeof window.fetch !== "function") problems.push("fetch");
  if (typeof window.Promise !== "function") problems.push("Promise");
  if (!window.JSON) problems.push("JSON");
  if (typeof window.WeakMap !== "function") problems.push("WeakMap");
  try {
    var probe = "__fk_probe__";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
  } catch (e) {
    problems.push("حافظهٔ محلی (localStorage)");
  }

  /*
   * فقط نبودِ قابلیت‌های بنیادی، برنامه را متوقف می‌کند.
   * نبودِ localStorage کشنده نیست (لایهٔ ذخیره‌سازی سه‌سطحی داریم)، پس
   * نباید کل برنامه را بلاک کند — قبلاً همین کار باعث می‌شد کاربر در حالت
   * حریم خصوصی، صفحهٔ هشدار تمام‌صفحه ببیند.
   */
  var HARD = ["نحو جاوااسکریپت مدرن", "fetch", "Promise", "JSON"];
  var hardFatal = problems.some(function (p) { return HARD.indexOf(p) !== -1; });

  window.FKCompat = {
    ok: problems.length === 0,
    problems: problems,
    hardFatal: hardFatal,
    isOldIE: !!document.documentMode,
    isIE11: /Trident\/7/.test(navigator.userAgent || ""),
  };

  /*
   * متغیر قدیمی: در نسخه‌های پیشین برنامه با آن بررسی می‌کرد که آیا باید
   * متوقف شود. هیچ‌جای کد آن را نمی‌خواند؛ برای سازگاری نگه داشته شده و
   * همیشه false است — یعنی این فایل هرگز جلوی اجرای برنامه را نمی‌گیرد.
   */
  window.FKBlocksApp = false;

  if (problems.length === 0) return;

  /* مشکل نرم (مثل localStorage) → فقط لاگ کن و بگذار برنامه کار کند */
  if (!hardFatal) {
    try {
      if (window.console && console.warn) {
        console.warn("[فاکتورخوان] محدودیت مرورگر:", problems.join("، "),
          "— برنامه با حافظهٔ موقت ادامه می‌دهد.");
      }
    } catch (e) { /* ignore */ }
    return;
  }

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function show() {
    /*
     * این یک «نوار هشدار» است، نه صفحهٔ مسدودکننده.
     *
     * درس گرفته‌شده: نسخهٔ قبلی یک لایهٔ تمام‌صفحه با z-index بسیار بالا می‌کشید و
     * هم‌زمان هیچ‌جای برنامه FKBlocksApp را نمی‌خواند؛ نتیجه این بود که کاربر
     * پیام «مرورگر پشتیبانی نمی‌شود» می‌دید، در حالی که برنامه هم زیرش کار می‌کرد —
     * بدترین حالت. حالا فقط یک نوار باریک بالای صفحه نشان می‌دهیم که با یک
     * کلیک بسته می‌شود و هرگز جلوی دکمهٔ ورود را نمی‌گیرد.
     */
    var bar = document.createElement("div");
    bar.setAttribute("id", "fk-compat-warning");
    bar.setAttribute("role", "status");
    bar.style.cssText = [
      "position:sticky", "top:0", "left:0", "right:0", "z-index:9998",
      "background:#2a2416", "color:#e7d9a8", "border-bottom:1px solid #4a3f24",
      "font-family:Tahoma,Vazirmatn,sans-serif", "direction:rtl",
      "padding:9px 14px", "font-size:12.5px", "line-height:1.9",
      "display:flex", "align-items:center", "gap:10px", "flex-wrap:wrap",
    ].join(";");

    var txt = document.createElement("span");
    txt.style.cssText = "flex:1;min-width:200px";
    txt.innerHTML = (hardFatal
      ? "⚠️ <strong>مرورگر شما بخشی از قابلیت‌های لازم را ندارد.</strong> "
      : "ℹ️ یک محدودیت جزئی مرورگر دیده شد. ")
      + "مورد: " + esc(problems.join("، "))
      + (hardFatal
        ? " — اگر دکمه‌ای کار نکرد، مرورگر را به‌روز کنید یا با Firefox/Chrome تازه باز کنید."
        : " — برنامه با حافظهٔ موقت ادامه می‌دهد.");
    bar.appendChild(txt);

    var close = document.createElement("button");
    close.type = "button";
    close.textContent = "بستن ×";
    close.style.cssText = "background:none;border:1px solid #4a3f24;color:#e7d9a8;" +
      "border-radius:6px;padding:3px 10px;font-family:inherit;font-size:12px;cursor:pointer";
    close.onclick = function () {
      try { bar.parentNode.removeChild(bar); } catch (e) { /* ignore */ }
    };
    bar.appendChild(close);

    var host = document.body || document.documentElement;
    if (host.firstChild) { host.insertBefore(bar, host.firstChild); }
    else { host.appendChild(bar); }
  }

  /*
   * readyState در اسکریپت‌های defer/async می‌تواند "interactive" باشد، یعنی
   * DOMContentLoaded قبلاً رخ داده — پس فقط به رویداد تکیه نمی‌کنیم، وگرنه
   * هشدار هرگز نمایش داده نمی‌شود.
   */
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", show);
  } else {
    show();
  }

})();
