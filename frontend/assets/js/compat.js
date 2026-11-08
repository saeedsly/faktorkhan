/* ══════════════════════════════════════════════════════════════
   بررسی سازگاری مرورگر — فاکتورخوان
   باید پیش از همهٔ اسکریپت‌ها بارگذاری شود و فقط از ES5 استفاده کند،
   چون هدفش مرورگرهایی است که بقیهٔ کد را نمی‌توانند اجرا کنند
   (IE11 در ویندوز ۷، کروم/فایرفاکس قدیمی).
   ══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  function supportsModernJs() {
    try {
      // template literal + arrow + const + default param
      // eslint-disable-next-line no-new-func
      new Function("const f = (a = 1) => `x${a}`; return f(2);");
      return true;
    } catch (e) {
      return false;
    }
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

  window.FKCompat = {
    ok: problems.length === 0,
    problems: problems,
    isOldIE: !!document.documentMode,
    isIE11: /Trident\/7/.test(navigator.userAgent || ""),
  };

  if (problems.length === 0) return;

  function uaName() {
    var ua = navigator.userAgent || "";
    if (/MSIE|Trident/.test(ua)) return "Internet Explorer " + (document.documentMode || 11);
    if (/Firefox/.test(ua)) return "Firefox (نسخهٔ قدیمی)";
    if (/Chrome/.test(ua)) return "Chrome (نسخهٔ قدیمی)";
    if (/Safari/.test(ua)) return "Safari (نسخهٔ قدیمی)";
    return "مرورگر شما";
  }

  function show() {
    var box = document.createElement("div");
    box.setAttribute("id", "fk-compat-warning");
    box.setAttribute("role", "alert");
    box.style.cssText = [
      "position:fixed", "top:0", "right:0", "bottom:0", "left:0",
      "width:100%", "height:100%", "overflow:auto", "z-index:99999",
      "background:#0b0d12", "color:#f2f4f8",
      "font-family:Tahoma,Vazirmatn,sans-serif", "direction:rtl",
      "display:flex", "align-items:center", "justify-content:center",
      "padding:24px", "text-align:right", "line-height:2",
    ].join(";");
    box.innerHTML =
      '<div style="max-width:640px;background:#141824;border:1px solid #2a3142;border-radius:16px;padding:28px">' +
      '<div style="font-size:34px;margin-bottom:8px">⚠️</div>' +
      '<h1 style="font-size:20px;margin:0 0 10px;color:#e7c873">این مرورگر پشتیبانی نمی‌شود</h1>' +
      '<p style="margin:0 0 12px;color:#c9d1e0">' +
      "شما با <strong>" + uaName() + "</strong> باز کرده‌اید. فاکتورخوان برای امنیت و سرعت به " +
      "مرورگرهای امروزی نیاز دارد و در این مرورگر دکمهٔ ورود کار نمی‌کند." +
      "</p>" +
      '<p style="margin:0 0 14px;color:#9aa4b8;font-size:13px">ویژگی‌های ناموجود: ' +
      problems.join("، ") + "</p>" +
      '<div style="background:#1b2130;border-radius:12px;padding:14px;color:#c9d1e0;font-size:14px">' +
      "<strong>راه‌حل (یکی را انتخاب کنید):</strong><br>" +
      "۱) <strong>Firefox ESR 115</strong> یا <strong>Chrome 109</strong> را نصب کنید — آخرین نسخه‌هایی که روی ویندوز ۷ کار می‌کنند.<br>" +
      "۲) اگر روی ویندوز ۱۰/۱۱ هستید، همان مرورگر را به‌روزرسانی کنید.<br>" +
      "۳) برنامه را از همان کامپیوتر با <code style=\"direction:ltr\">http://127.0.0.1:8000</code> باز کنید." +
      "</div>" +
      '<p style="margin:14px 0 0;color:#6f7a8f;font-size:12px">فاکتورخوان — نسخهٔ وب</p>' +
      "</div>";
    (document.body || document.documentElement).appendChild(box);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", show);
  } else {
    show();
  }
  // سایر اسکریپت‌ها را متوقف نکن؛ فقط هشدار را نشان بده و از اجرای برنامه جلوگیری کن.
  window.FKBlocksApp = true;
})();
