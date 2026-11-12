/* ساخته‌شده با tools/build-php-web.mjs — دستی ویرایش نکنید */
const FK_ASSET_BASE = (() => {
  try {
    const dir = document.baseURI.replace(/[^/]*$/, "");
    return /\/web\/$/.test(dir) ? dir : dir + "web/";
  } catch { return "./web/"; }
})();
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


/* ══════════════════════════════════════════════════════════════
   لایه ارتباط با سرور — فاکتورخوان
   ══════════════════════════════════════════════════════════════ */
const API = (() => {
  /* ذخیره‌سازی امن — سه سطح:
       ۱) localStorage (ماندگار)
       ۲) sessionStorage (اگر localStorage مسدود باشد — مثلاً iframe پیش‌نمایش)
       ۳) حافظهٔ موقت (اگر هر دو مسدود باشند؛ با رفرش پاک می‌شود)
     بدون این لایه، در برخی مرورگرها/iframeها ورود انجام می‌شود ولی نشست ذخیره
     نمی‌شود و کاربر «در صفحهٔ ورود گیر می‌کند». */
  const store = (() => {
    const memory = Object.create(null);
    const memStore = {
      getItem: (k) => (k in memory ? memory[k] : null),
      setItem: (k, v) => { memory[k] = String(v); },
      removeItem: (k) => { delete memory[k]; },
    };
    const usable = (area) => {
      try {
        if (!area) return false;
        const probe = "__fk_probe__";
        area.setItem(probe, "1");
        area.removeItem(probe);
        return true;
      } catch (err) { return false; }
    };
    try { if (usable(window.localStorage)) return { area: window.localStorage, mode: "local" }; } catch (e) { /* ignore */ }
    try { if (usable(window.sessionStorage)) return { area: window.sessionStorage, mode: "session" }; } catch (e) { /* ignore */ }
    return { area: memStore, mode: "memory" };
  })();
  const storageMode = () => store.mode;

  const TOKEN_KEY = "fk_token";
  const USER_KEY = "fk_user";
  const DEVICE_KEY = "fk_device";
  const THEME_KEY = "fk_theme";

  function deviceId() {
    let id = store.area.getItem(DEVICE_KEY);
    if (!id) {
      id = "DV-" + Array.from(crypto.getRandomValues(new Uint8Array(8)))
        .map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
      store.area.setItem(DEVICE_KEY, id);
    }
    return id;
  }

  const getToken = () => store.area.getItem(TOKEN_KEY) || "";
  const setToken = (t) => store.area.setItem(TOKEN_KEY, t || "");
  const clearToken = () => {
    store.area.removeItem(TOKEN_KEY);
    store.area.removeItem(USER_KEY);
  };

  const cachedUser = () => {
    try { return JSON.parse(store.area.getItem(USER_KEY) || "null"); } catch { return null; }
  };
  const setCachedUser = (u) => store.area.setItem(USER_KEY, JSON.stringify(u || null));

  let onUnauthorized = () => {};
  const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };
  /**
   * اگر token نتواند ذخیره شود، ورود ظاهراً موفق است ولی با رفرش بیرون می‌ماند.
   * علت‌های رایج و راه‌حل هرکدام را صریح می‌گوییم — پیام مبهم «مرورگر مشکل دارد»
   * به کاربر کمکی نمی‌کند.
   */
  const storageWarning = () => {
    if (store.mode !== "memory") return "";
    const inFrame = (() => { try { return window.self !== window.top; } catch (e) { return true; } })();
    if (inFrame) {
      return "این صفحه داخل یک قاب (iframe) باز شده و مرورگر اجازهٔ ذخیرهٔ نشست نمی‌دهد. "
        + "آن را در یک تب مستقیم باز کنید تا ورود ماندگار شود.";
    }
    return "مرورگر ذخیرهٔ نشست را مسدود کرده (حالت ناشناس یا مسدودکردن کوکی‌ها). "
      + "اکنون می‌توانید کار کنید، ولی با بستن تب باید دوباره وارد شوید.";
  };

  async function request(path, { method = "GET", body, headers = {}, raw = false, form = false } = {}) {
    const opts = { method, headers: { ...headers } };
    const token = getToken();
    /* بک‌اند PHP نشست را از کوکی می‌شناسد؛ Bearer لازم نیست */
    opts.headers["X-Device-Id"] = deviceId();
    if (body !== undefined && !form) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    } else if (form) {
      opts.body = body;
    }

    let response;
    try {
      response = await fetch(path, opts);
    } catch (err) {
      throw Object.assign(new Error("ارتباط با سرور برقرار نشد. اتصال شبکه یا وضعیت سرور را بررسی کنید."), { status: 0 });
    }

    if (response.status === 401) {
      clearToken();
      onUnauthorized();
      throw Object.assign(new Error("نشست شما منقضی شده است؛ دوباره وارد شوید."), { status: 401 });
    }
    if (raw) {
      if (!response.ok) throw Object.assign(new Error("دریافت فایل ناموفق بود."), { status: response.status });
      return response;
    }

    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { detail: text }; }
    if (!response.ok) {
      let message = data && (data.detail || data.message);
      if (Array.isArray(message)) message = message.map((m) => m.msg || m).join("، ");
      if (!message) message = `خطا (${response.status})`;
      throw Object.assign(new Error(message), { status: response.status, data });
    }
    return data;
  }

  const qs = (obj) => {
    const params = new URLSearchParams();
    Object.entries(obj || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") params.set(k, v);
    });
    const s = params.toString();
    return s ? `&${s}` : "";
  };

  return {
    deviceId, getToken, setToken, clearToken, cachedUser, setCachedUser, setUnauthorizedHandler,
    storageWarning, storageMode,
    get: (p) => request(p),
    post: (p, body) => request(p, { method: "POST", body }),
    put: (p, body) => request(p, { method: "PUT", body }),
    patch: (p, body) => request(p, { method: "PATCH", body }),
    del: (p) => request(p, { method: "DELETE" }),
    upload: (p, formData) => request(p, { method: "POST", body: formData, form: true }),
    raw: (p) => request(p, { raw: true }),

    /* --- احراز هویت --- */
    login: (payload) => request("./api.php?action=login", { method: "POST", body: payload }),
    register: (payload) => request("./api.php?action=register", { method: "POST", body: payload }),
    me: () => request("./api.php?action=me"),
    updateProfile: (payload) => request("./api.php?action=profile", { method: "PATCH", body: payload }),
    changePassword: (payload) => request("./api.php?action=change-password", { method: "POST", body: payload }),
    logout: () => request("./api.php?action=logout", { method: "POST" }),
    devices: () => request("./api.php?action=devices"),
    removeDevice: (id) => request(`./api.php?action=device-delete&id=${encodeURIComponent(id)}`, { method: "DELETE" }),

    /* --- فاکتورها --- */
    invoices: (params) => request(`./api.php?action=invoices${qs(params)}`),
    invoice: (id) => request(`./api.php?action=invoice&id=${id}`),
    createInvoice: (payload) => request("./api.php?action=invoices", { method: "POST", body: payload }),
    updateInvoice: (id, payload) => request(`./api.php?action=invoice-update&id=${id}`, { method: "POST", body: payload }),
    deleteInvoice: (id) => request(`./api.php?action=invoice-delete&id=${id}`, { method: "POST" }),
    bulkInvoices: (payload) => request("./api.php?action=invoice-bulk", { method: "POST", body: payload }),
    invoiceStats: () => request("./api.php?action=invoice-stats"),
    invoicePrint: (id) => request(`./api.php?action=invoice-print&id=${id}`),
    parseText: (text, invoice_type) => request("./api.php?action=invoice-parse", { method: "POST", body: { text, invoice_type } }),
    understand: (text, invoice_type, autofix = true) =>
      request("./api.php?action=invoice-understand", { method: "POST", body: { text, invoice_type, autofix } }),
    understandImage: (payload) => request("./api.php?action=invoice-understand-image", { method: "POST", body: payload || {} }),
    fixNumbers: (items, totals, apply_to) =>
      request("./api.php?action=invoice-fix-numbers", { method: "POST", body: { items, totals, apply_to } }),
    exportUrl: (format, params) => `./api.php?action=invoice-export${qs({ format, ...(params || {}) })}`,

    /* --- OCR --- */
    ocrCapabilities: () => request("./api.php?action=ocr-capabilities"),
    ocrUpload: (formData) => request("./api.php?action=ocr-upload", { method: "POST", body: formData, form: true }),
    ocrLink: (payload) => request("./api.php?action=ocr-link", { method: "POST", body: payload }),
    ocrJobs: (limit = 12) => request(`./api.php?action=ocr-jobs&limit=${limit}`),
    ocrJob: (id, withText = false) => request(`./api.php?action=ocr-job&id=${id}${withText ? "&with_text=1" : ""}`),
    ocrRetry: (id) => request(`./api.php?action=ocr-retry&id=${id}`, { method: "POST" }),
    ocrCancel: (id) => request(`./api.php?action=ocr-cancel&id=${id}`, { method: "POST" }),
    ocrDelete: (id) => request(`./api.php?action=ocr-delete&id=${id}`, { method: "DELETE" }),
    ocrToInvoice: (id, payload) => request(`./api.php?action=ocr-to-invoice&id=${id}`, { method: "POST", body: payload || {} }),
    ocrCredit: () => request("./api.php?action=ocr-credit"),
    ocrResultUrl: (id) => `./api.php?action=ocr-result&id=${id}`,

    /* --- اشتراک --- */
    plans: () => request("./api.php?action=plans"),
    subscription: () => request("./api.php?action=subscription"),
    redeem: (key) => request("./api.php?action=redeem", { method: "POST", body: { key } }),
    usage: () => request("./api.php?action=usage"),
    checkKey: (key) => request(`./api.php?action=check-key&key=${encodeURIComponent(key)}`),

    /* --- سامانه --- */
    meta: () => request("./api.php?action=meta"),
    features: () => request("./api.php?action=features"),
    health: () => request("./api.php?action=health"),
    support: (payload) => request("./api.php?action=support", { method: "POST", body: payload }),
    /* پیام‌های خودِ کاربر — تا پاسخ پشتیبانی را ببیند، نه فقط بفرستد */
    myTickets: () => request("./api.php?action=my-tickets"),

    /* --- مدیر --- */
    admin: {
      overview: () => request("./api.php?action=admin-overview"),
      users: (params) => request(`./api.php?action=admin-users${qs(params)}`),
      updateUser: (id, payload) => request(`./api.php?action=admin-user&id=${id}`, { method: "PATCH", body: payload }),
      resetPassword: (id) => request(`./api.php?action=admin-user-reset&id=${id}`, { method: "POST" }),
      deleteUser: (id) => request(`./api.php?action=admin-user&id=${id}`, { method: "POST", body: { delete: true } }),
      plans: () => request("./api.php?action=admin-plans"),
      createPlan: (payload) => request("./api.php?action=admin-plans", { method: "POST", body: payload }),
      updatePlan: (id, payload) => request(`./api.php?action=admin-plan&id=${id}`, { method: "PUT", body: payload }),
      deletePlan: (id) => request(`./api.php?action=admin-plan&id=${id}`, { method: "POST", body: { delete: true } }),
      keys: (params) => request(`./api.php?action=admin-keys${qs(params)}`),
      createKeys: (payload) => request("./api.php?action=admin-keys-create", { method: "POST", body: payload }),
      revokeKey: (id) => request(`./api.php?action=admin-key-revoke&id=${id}`, { method: "POST" }),
      deleteKey: (id) => request(`./api.php?action=admin-key&id=${id}`, { method: "DELETE" }),
      cloud: () => request("./api.php?action=admin-cloud"),
      setCloudToken: (token) => request("./api.php?action=admin-cloud-token", { method: "POST", body: { token } }),
      clearCloudToken: () => request("./api.php?action=admin-cloud-token", { method: "POST", body: { clear: true } }),
      testCloud: () => request("./api.php?action=admin-cloud-test", { method: "POST" }),
      settings: () => request("./api.php?action=admin-settings"),
      saveSettings: (payload) => request("./api.php?action=admin-settings", { method: "PUT", body: payload }),
      audit: (params) => request(`./api.php?action=admin-audit${qs(params)}`),
      support: (params) => request(`./api.php?action=admin-support${qs(params)}`),
      answerTicket: (id, answer) => request(`./api.php?action=admin-ticket-answer&id=${id}`, { method: "POST", body: { answer } }),
      health: () => request("./api.php?action=admin-health"),
      backupUrl: () => "./api.php?action=admin-backup",
    },
  };
})();


/* ══════════════════════════════════════════════════════════════
   ابزارهای رابط کاربری — فاکتورخوان
   ══════════════════════════════════════════════════════════════ */
const UI = (() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const FA_DIGITS = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];
  const toFa = (value) => String(value ?? "").replace(/\d/g, (d) => FA_DIGITS[+d]);
  const toEn = (value) => String(value ?? "").replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d));

  const num = (value) => {
    const n = Number(value || 0);
    if (!isFinite(n)) return "۰";
    return toFa(n.toLocaleString("en-US")).replace(/,/g, "٬");
  };

  const money = (value) => `${num(value)} <small>ریال</small>`;
  const moneyShort = (value) => {
    const n = Number(value || 0);
    if (n >= 1_000_000_000) return `${num(Math.round(n / 100_000_000) / 10)} میلیارد ریال`;
    if (n >= 1_000_000) return `${num(Math.round(n / 100_000) / 10)} میلیون ریال`;
    if (n >= 1_000) return `${num(Math.round(n / 1000))} هزار ریال`;
    return `${num(n)} ریال`;
  };
  const toman = (value) => `${num(Math.round(Number(value || 0) / 10))} تومان`;

  const numShort = (value) => {
    const n = Math.abs(Number(value || 0));
    if (n >= 1_000_000_000) return `${num((n / 1_000_000_000).toFixed(1))} میلیارد`;
    if (n >= 1_000_000) return `${num((n / 1_000_000).toFixed(1))} میلیون`;
    if (n >= 10_000) return `${num(Math.round(n / 1000))} هزار`;
    return num(n);
  };

  const esc = (str) => String(str ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));

  const statusFa = {
    draft: "پیش‌نویس", review: "بازبینی", confirmed: "تأیید‌شده", archived: "بایگانی",
    active: "فعال", trialing: "آزمایشی", expired: "منقضی", blocked: "مسدود",
    unused: "استفاده‌نشده", used: "استفاده‌شده", revoked: "ابطال‌شده",
    queued: "در صف", uploading: "ارسال", converting: "تبدیل", processing: "پردازش",
    done: "آماده", failed: "خطا", cancelled: "لغو‌شده", new: "جدید", answered: "پاسخ داده‌شده",
    closed: "بسته", purchase: "خرید", sale: "فروش",
  };
  const typeFa = { printed: "چاپی", thermal: "حرارتی", handwritten: "دست‌نویس", audio: "صوتی", other: "سایر" };
  const sourceFa = { manual: "دستی", cloud: "ابر", local: "لوکال" };

  const badge = (value, label) => `<span class="status ${esc(value)}">${esc(label || statusFa[value] || value)}</span>`;

  /* ---------- اعلان ---------- */
  function toast(message, { type = "success", title = "" } = {}) {
    const root = $("#toast-root");
    const icons = { success: "i-check", error: "i-close", info: "i-info", warn: "i-info" };
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.innerHTML = `<svg class="ic"><use href="#${icons[type] || "i-info"}"/></svg>
      <div><strong>${esc(title || { success: "انجام شد", error: "خطا", info: "اطلاع", warn: "توجه" }[type])}</strong>
      <span>${esc(message)}</span></div>`;
    root.appendChild(el);
    setTimeout(() => {
      el.classList.add("out");
      setTimeout(() => el.remove(), 280);
    }, type === "error" ? 6200 : 4200);
  }

  /* ---------- مودال ---------- */
  function modal({ title, body, footer = "", wide = false, onMount }) {
    const root = $("#modal-root");
    const wrap = document.createElement("div");
    wrap.className = "modal-backdrop";
    wrap.innerHTML = `<div class="modal ${wide ? "wide" : ""}" role="dialog" aria-modal="true">
        <div class="modal-h"><h3>${esc(title)}</h3>
          <button class="ghost-icon" data-close><svg class="ic"><use href="#i-close"/></svg></button></div>
        <div class="modal-b">${body}</div>
        ${footer ? `<div class="modal-f">${footer}</div>` : ""}
      </div>`;
    root.appendChild(wrap);
    const close = () => { wrap.remove(); document.removeEventListener("keydown", onKey); };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    wrap.addEventListener("click", (e) => { if (e.target === wrap) close(); });
    $$("[data-close]", wrap).forEach((b) => b.addEventListener("click", close));
    if (onMount) onMount(wrap, close);
    return { el: wrap, close, root: $(".modal", wrap) };
  }

  function confirmDialog({ title, message, confirmText = "تأیید", danger = false }) {
    return new Promise((resolve) => {
      const m = modal({
        title,
        body: `<p style="font-size:13px;color:var(--text-2);line-height:2">${esc(message)}</p>`,
        footer: `<button class="btn ghost" data-no>انصراف</button>
                 <button class="btn ${danger ? "danger" : "primary"}" data-yes>${esc(confirmText)}</button>`,
        onMount: (wrap, close) => {
          $("[data-no]", wrap).onclick = () => { close(); resolve(false); };
          $("[data-yes]", wrap).onclick = () => { close(); resolve(true); };
        },
      });
      m.el.querySelector("[data-yes]").focus();
    });
  }

  /* ---------- اسکلت ---------- */
  const skeleton = (rows = 4) => `<div class="card">${Array.from({ length: rows })
    .map((_, i) => `<div class="skel" style="margin-bottom:12px;width:${100 - i * 9}%"></div>`).join("")}</div>`;

  const emptyState = (title, text, icon = "i-folder") => `<div class="empty">
      <svg class="ic"><use href="#${icon}"/></svg>
      <h4>${esc(title)}</h4><p>${esc(text)}</p></div>`;

  /* ---------- نمودارها ---------- */
  function sparkline(values, color = "#d4af37", height = 34) {
    const data = values && values.length ? values : [0, 0];
    const max = Math.max(...data, 1);
    const min = Math.min(...data, 0);
    const width = 120;
    const step = data.length > 1 ? width / (data.length - 1) : width;
    const pts = data.map((v, i) => {
      const x = i * step;
      const y = height - ((v - min) / (max - min || 1)) * (height - 6) - 3;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    const id = "sp" + Math.random().toString(36).slice(2, 7);
    return `<svg class="spark" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${color}" stop-opacity=".42"/><stop offset="1" stop-color="${color}" stop-opacity="0"/>
      </linearGradient></defs>
      <polygon points="0,${height} ${pts.join(" ")} ${width},${height}" fill="url(#${id})"/>
      <polyline points="${pts.join(" ")}" fill="none" stroke="${color}" stroke-width="1.8"
        stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }

  function areaChart(series, { height = 200, color = "#d4af37" } = {}) {
    const data = (series || []).slice(-14);
    if (!data.length) return `<div class="empty" style="padding:24px"><p>داده‌ای برای نمایش نیست</p></div>`;
    const w = 640, h = height, padB = 26, padT = 12;
    const max = Math.max(...data.map((d) => d.total), 1);
    const step = data.length > 1 ? (w - 20) / (data.length - 1) : 0;
    const points = data.map((d, i) => {
      const x = w - 10 - i * step;   // راست‌به‌چپ
      const y = padT + (1 - d.total / max) * (h - padB - padT);
      return { x, y, d };
    });
    const line = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
    const area = `10,${h - padB} ${line} ${points[points.length - 1].x.toFixed(1)},${h - padB}`;
    const grid = [0.25, 0.5, 0.75, 1].map((r) => {
      const y = padT + (1 - r) * (h - padB - padT);
      return `<line x1="0" y1="${y}" x2="${w}" y2="${y}" stroke="rgba(255,255,255,.06)" stroke-dasharray="3 4"/>
              <text x="4" y="${y - 4}" fill="var(--text-3)" font-size="8.5">${num(Math.round(max * r / 1_000_000))}M</text>`;
    }).join("");
    const dots = points.map((p, i) => (i % 2 === 0
      ? `<circle cx="${p.x}" cy="${p.y}" r="2.6" fill="${color}"/>
         <text x="${p.x}" y="${h - 8}" fill="var(--text-3)" font-size="8" text-anchor="middle">${esc((p.d.date || "").slice(5))}</text>`
      : "")).join("");
    return `<svg class="chart-box" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
      <defs><linearGradient id="ag" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${color}" stop-opacity=".35"/><stop offset="1" stop-color="${color}" stop-opacity="0"/>
      </linearGradient></defs>
      ${grid}
      <polygon points="${area}" fill="url(#ag)"/>
      <polyline points="${line}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
      ${dots}</svg>`;
  }

  function donut(segments, { size = 132, thickness = 15 } = {}) {
    const total = segments.reduce((s, x) => s + x.value, 0) || 1;
    const r = (size - thickness) / 2;
    const c = 2 * Math.PI * r;
    let offset = 0;
    const arcs = segments.map((seg) => {
      const dash = (seg.value / total) * c;
      const el = `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${seg.color}"
        stroke-width="${thickness}" stroke-dasharray="${dash} ${c - dash}"
        stroke-dashoffset="${-offset}" stroke-linecap="round"
        transform="rotate(-90 ${size / 2} ${size / 2})"/>`;
      offset += dash;
      return el;
    }).join("");
    return `<svg class="donut" viewBox="0 0 ${size} ${size}">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="rgba(255,255,255,.06)" stroke-width="${thickness}"/>
      ${arcs}
      <text x="${size / 2}" y="${size / 2 - 1}" text-anchor="middle" fill="var(--text)" font-size="17" font-weight="700">${num(total)}</text>
      <text x="${size / 2}" y="${size / 2 + 14}" text-anchor="middle" fill="var(--text-3)" font-size="8.5">فاکتور</text></svg>`;
  }

  function ring(percent, { size = 54, color = "#2dd4bf" } = {}) {
    const r = (size - 8) / 2;
    const c = 2 * Math.PI * r;
    const dash = (Math.max(0, Math.min(100, percent)) / 100) * c;
    return `<svg class="ring" viewBox="0 0 ${size} ${size}">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="rgba(255,255,255,.1)" stroke-width="5"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="5"
        stroke-dasharray="${dash} ${c - dash}" stroke-linecap="round" transform="rotate(-90 ${size / 2} ${size / 2})"/>
      <text x="${size / 2}" y="${size / 2 + 4}" text-anchor="middle" fill="var(--text)" font-size="12" font-weight="700">${num(percent)}٪</text></svg>`;
  }

  /* ---------- کمکی ---------- */
  function debounce(fn, delay = 300) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
  }

  function copy(text, label = "کپی شد") {
    const done = () => toast(`${label}`, { type: "success", title: "در کلیپ‌بورد" });
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done).catch(() => fallback());
    } else fallback();
    function fallback() {
      const ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); done(); } catch { toast("کپی ناموفق بود", { type: "error" }); }
      ta.remove();
    }
  }

  const download = (url, filename) => {
    const a = document.createElement("a");
    a.href = url;
    if (filename) a.download = filename;
    a.target = "_blank";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  async function downloadAuth(url, filename) {
    try {
      const res = await API.raw(url);
      const blob = await res.blob();
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = filename || "download";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 4000);
    } catch (err) {
      toast(err.message, { type: "error" });
    }
  }

  function fileSize(bytes) {
    const b = Number(bytes || 0);
    if (b > 1024 * 1024) return `${num((b / 1024 / 1024).toFixed(1))} مگابایت`;
    if (b > 1024) return `${num(Math.round(b / 1024))} کیلوبایت`;
    return `${num(b)} بایت`;
  }

  function setBusy(button, busy, label) {
    if (!button) return;
    if (busy) {
      button.dataset.html = button.innerHTML;
      button.disabled = true;
      button.innerHTML = `<span class="skel" style="width:16px;height:16px;border-radius:50%"></span><span>${esc(label || "در حال انجام…")}</span>`;
    } else {
      button.disabled = false;
      if (button.dataset.html) button.innerHTML = button.dataset.html;
    }
  }

  return {
    $, $$, toFa, toEn, num, numShort, money, moneyShort, toman, esc, badge, statusFa, typeFa, sourceFa,
    toast, modal, confirmDialog, skeleton, emptyState,
    sparkline, areaChart, donut, ring, debounce, copy, download, downloadAuth, fileSize, setBusy,
  };
})();


/* ══════════════════════════════════════════════════════════════
   صفحه‌های اصلی — داشبورد، خوانش، فاکتورها
   ══════════════════════════════════════════════════════════════ */
const State = {
  user: null,
  sub: null,
  meta: null,
  caps: null,
  timers: [],
  setTimer(fn, ms) { const id = setInterval(fn, ms); this.timers.push(id); return id; },
  clearTimers() { this.timers.forEach((id) => clearInterval(id)); this.timers = []; },
};

const Views = (() => {
  const { $, $$, esc, num, money, moneyShort, toman, badge, toast, modal, confirmDialog, emptyState,
    skeleton, areaChart, donut, ring, sparkline, debounce, copy, download, downloadAuth, fileSize,
    statusFa, typeFa, sourceFa } = UI;

  const typeIcon = { printed: "i-print", thermal: "i-bolt", handwritten: "i-edit", audio: "i-mic", other: "i-folder" };
  const typeColor = { printed: "#5aa9f8", thermal: "#fbbf24", handwritten: "#8b7cf6", audio: "#f472a6", other: "#94a3b8" };

  /* ══════════════════════ داشبورد ══════════════════════ */
  async function dashboard(el) {
    el.innerHTML = `<div class="kpi-grid">${Array.from({ length: 4 }).map(() =>
      `<div class="card tight"><div class="skel" style="width:60%;margin-bottom:10px"></div>
       <div class="skel" style="width:40%;height:22px"></div></div>`).join("")}</div>
       ${skeleton(3)}`;
    let stats, jobs, invoices;
    try {
      [stats, jobs, invoices] = await Promise.all([API.invoiceStats(), API.ocrJobs(6), API.invoices({ per_page: 6 })]);
    } catch (err) {
      el.innerHTML = emptyState("داده‌ای در دسترس نیست", err.message, "i-info");
      return;
    }
    const sub = State.sub || {};
    const kpis = [
      { label: "کل فاکتورها", icon: "i-invoice", value: num(stats.counts.total), foot: `<b>${num(stats.counts.confirmed)}</b> تأیید‌شده`, color: "#d4af37", values: stats.series.map((s) => s.total) },
      { label: "جمع مبالغ", icon: "i-chart", value: moneyShort(stats.sums.total), foot: `مالیات ${moneyShort(stats.sums.tax)}`, color: "#2dd4bf", values: stats.series.map((s) => s.total) },
      { label: "میانگین اعتماد خوانش", icon: "i-sparkles", value: `${num(stats.avg_confidence)}٪`, foot: `پردازش‌های اخیر: ${num((jobs.items || []).length)}`, color: "#8b7cf6", values: [30, 50, 45, 70, 65, stats.avg_confidence] },
      { label: "اعتبار اشتراک", icon: "i-key", value: sub.days_left !== undefined ? `${num(sub.days_left)} روز` : "—", foot: `<span>${UI.numShort(sub.pages_left || 0)} صفحه باقی‌مانده • ${esc(sub.plan_name || "بدون طرح")}</span>`, color: "#5aa9f8", values: [70, 60, 55, 40, 30, Math.max(sub.days_left || 1, 1)] },
    ];

    const daysLeft = sub.days_left;
    const lowQuota = sub.pages_quota ? (sub.pages_left / sub.pages_quota) < 0.1 : false;
    const banner = (typeof daysLeft === "number" && daysLeft >= 0 && daysLeft <= 21 && sub.status === "active")
      ? `<div class="banner mb-12">
           <svg class="ic"><use href="#i-clock"/></svg>
           <div><strong>اشتراک شما در ${num(daysLeft)} روز منقضی می‌شود</strong>
             <span>برای جلوگیری از قطع دسترسی، کد اشتراک جدید را در صفحه «اشتراک من» فعال کنید.</span></div>
           <a class="btn sm primary" href="#/subscription">تمدید اشتراک</a>
         </div>`
      : (lowQuota ? `<div class="banner mb-12">
           <svg class="ic"><use href="#i-info"/></svg>
           <div><strong>سهمیه صفحات شما به پایان نزدیک است</strong>
             <span>${num(sub.pages_left)} صفحه از ${num(sub.pages_quota)} باقی مانده است.</span></div>
           <a class="btn sm primary" href="#/subscription">افزایش سهمیه</a>
         </div>` : "");

    el.innerHTML = `
      ${banner}
      <div class="kpi-grid">
        ${kpis.map((k) => `<div class="kpi" style="--k-color:${k.color}">
          <div class="k-label"><svg class="ic"><use href="#${k.icon}"/></svg>${k.label}</div>
          <div class="k-value">${k.value}</div>
          <div class="k-foot">${k.foot}</div>
          ${sparkline(k.values, k.color, 30)}
        </div>`).join("")}
      </div>

      <div class="dash-grid">
        <div class="dash-col">
          <div class="card card-glow">
            <div class="card-h">
              <div><h3><svg class="ic"><use href="#i-chart"/></svg>روند مبالغ فاکتورها</h3>
                <p>بر اساس تاریخ فاکتور — ${num(stats.series.length)} نقطه داده</p></div>
              <div class="seg" id="chart-range">
                <button class="active" data-range="14">۱۴ روز</button>
                <button data-range="30">۳۰ روز</button>
              </div>
            </div>
            <div id="chart-area">${areaChart(stats.series.slice(-14))}</div>
          </div>

          <div class="card">
            <div class="card-h"><div><h3><svg class="ic"><use href="#i-invoice"/></svg>آخرین فاکتورها</h3>
              <p>۶ فاکتور اخیر ثبت‌شده</p></div>
              <a class="btn sm ghost" href="#/invoices">همه فاکتورها<svg class="ic" style="width:14px;height:14px"><use href="#i-arrow"/></svg></a></div>
            ${invoices.items.length ? `<div class="table-wrap"><table>
              <thead><tr><th>فاکتور</th><th>فروشنده</th><th class="num">مبلغ کل</th><th>وضعیت</th><th></th></tr></thead>
              <tbody>${invoices.items.map((inv) => `<tr>
                <td><div class="cell-main"><span class="thumb" style="background:${typeColor[inv.invoice_type]}22;color:${typeColor[inv.invoice_type]}">
                  <svg class="ic"><use href="#${typeIcon[inv.invoice_type] || "i-invoice"}"/></svg></span>
                  <div><strong>${esc(inv.number || "بدون شماره")}</strong><br><span style="font-size:10.5px;color:var(--text-3)">${esc(inv.issue_date || "—")}</span></div></div></td>
                <td>${esc(inv.seller_name || "—")}</td>
                <td class="num"><strong>${num(inv.total)}</strong></td>
                <td>${badge(inv.status)}</td>
                <td class="num"><a class="ghost-icon" href="#/invoices/${inv.id}" title="مشاهده"><svg class="ic"><use href="#i-arrow"/></svg></a></td>
              </tr>`).join("")}</tbody></table></div>`
              : emptyState("هنوز فاکتوری ثبت نشده", "اولین فاکتور را با خوانش هوشمند بسازید", "i-invoice")}
          </div>
        </div>

        <div class="dash-col">
          <div class="card card-glow">
            <div class="card-h"><h3><svg class="ic"><use href="#i-layers"/></svg>ترکیب اسناد</h3></div>
            <div class="donut-wrap">
              ${donut(Object.entries(stats.by_type).map(([k, v]) => ({ label: typeFa[k] || k, value: v, color: typeColor[k] || "#94a3b8" })))}
              <div class="legend">
                ${Object.entries(stats.by_type).map(([k, v]) => `<div class="legend-row">
                  <i style="background:${typeColor[k] || "#94a3b8"}"></i>${typeFa[k] || k}<b>${num(v)}</b></div>`).join("") || `<div class="legend-row">داده‌ای نیست</div>`}
              </div>
            </div>
          </div>

          <div class="card">
            <div class="card-h"><h3><svg class="ic"><use href="#i-scan"/></svg>پردازش‌های اخیر</h3>
              <a class="link-btn" href="#/scan">خوانش جدید</a></div>
            ${(jobs.items || []).length ? `<div class="job-list">${jobs.items.slice(0, 5).map((job) => `
              <div class="job">
                <span class="thumb" style="background:${job.provider === "cloud" ? "rgba(45,212,191,.14)" : "rgba(139,124,246,.14)"};
                  color:${job.provider === "cloud" ? "var(--teal)" : "var(--violet)"}">
                  <svg class="ic"><use href="#${job.provider === "cloud" ? "i-cloud" : "i-cpu"}"/></svg></span>
                <div class="j-main"><strong>${esc(job.file_name || "فایل")}</strong>
                  <span>${esc(statusFa[job.status] || job.status)} • ${num(job.progress)}٪</span>
                  ${["queued", "uploading", "converting", "processing"].includes(job.status)
                    ? `<div class="mini-progress"><i style="width:${job.progress}%"></i></div>` : ""}</div>
                ${job.invoice_id ? `<a class="ghost-icon" href="#/invoices/${job.invoice_id}"><svg class="ic"><use href="#i-arrow"/></svg></a>` : ""}
              </div>`).join("")}</div>`
              : emptyState("پردازشی نیست", "یک فایل برای خوانش بارگذاری کنید", "i-scan")}
          </div>

          <div class="card">
            <div class="card-h"><h3><svg class="ic"><use href="#i-bolt"/></svg>دسترسی سریع</h3></div>
            <div style="display:grid;gap:8px">
              <button class="btn block" data-quick="scan"><svg class="ic"><use href="#i-upload"/></svg>بارگذاری فاکتور جدید</button>
              <button class="btn block" data-quick="manual"><svg class="ic"><use href="#i-edit"/></svg>ثبت دستی فاکتور</button>
              <button class="btn block" data-quick="export"><svg class="ic"><use href="#i-download"/></svg>خروجی اکسل فاکتورها</button>
              <button class="btn block" data-quick="renew"><svg class="ic"><use href="#i-key"/></svg>تمدید اشتراک</button>
            </div>
          </div>
        </div>
      </div>`;

    $$("#chart-range button", el).forEach((btn) => btn.addEventListener("click", () => {
      $$("#chart-range button", el).forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const n = Number(btn.dataset.range);
      $("#chart-area", el).innerHTML = areaChart(stats.series.slice(-n));
    }));
    $$("[data-quick]", el).forEach((btn) => btn.addEventListener("click", () => {
      const q = btn.dataset.quick;
      if (q === "scan") location.hash = "#/scan";
      else if (q === "manual") Invoices.openManual();
      else if (q === "export") downloadAuth(API.exportUrl("xlsx"), "invoices.xlsx");
      else if (q === "renew") location.hash = "#/subscription";
    }));
  }

  /* ══════════════════════ خوانش فاکتور ══════════════════════ */
  async function scan(el) {
    el.innerHTML = skeleton(4);
    let caps;
    try { caps = await API.ocrCapabilities(); State.caps = caps; }
    catch (err) { el.innerHTML = emptyState("سرویس در دسترس نیست", err.message); return; }

    const cloudReady = caps.cloud.configured;
    const localReady = caps.local.pdf || caps.local.image;
    const draft = {
      file: null,
      engine: cloudReady ? "cloud" : "local",
      method: 4,
      output: "txtrawjson",
      language: "fa",
      invoiceType: "printed",
      deleteAfter: true,
      job: null,
      mode: "file",
    };

    el.innerHTML = `
      <div class="review-grid">
        <div class="dash-col">
          <div class="card card-glow">
            <div class="card-h">
              <div><h3><svg class="ic"><use href="#i-scan"/></svg>خوانش فاکتور جدید</h3>
                <p>فاکتور چاپی، حرارتی، دست‌نویس یا فایل صوتی را اضافه کنید</p></div>
              <div class="seg" id="scan-mode">
                <button class="active" data-mode="file">فایل</button>
                <button data-mode="link">لینک</button>
                <button data-mode="text">متن</button>
              </div>
            </div>

            <div id="mode-file">
              <div class="dropzone" id="dropzone">
                <div class="dz-icon"><svg class="ic"><use href="#i-upload"/></svg></div>
                <h4>فایل را اینجا رها کنید یا کلیک کنید</h4>
                <p>حداکثر ${num(caps.max_upload_mb)} مگابایت • هر فایل، یک پردازش مستقل</p>
                <div class="dz-formats">
                  <span>PDF</span><span>JPG</span><span>PNG</span><span>BMP</span><span>TIFF</span>
                  <span>MP3</span><span>WAV</span><span>MP4</span>
                </div>
                <input type="file" id="file-input" class="hidden" accept=".pdf,.jpg,.jpeg,.png,.bmp,.tif,.tiff,.webp,.mp3,.wav,.m4a,.mp4,.ogg,.flac,.3gp">
              </div>
              <div id="file-chip"></div>
            </div>

            <div id="mode-link" class="hidden">
              <label class="field"><span>نشانی مستقیم فایل (فقط حالت ابری)</span>
                <input id="link-input" dir="ltr" placeholder="https://example.com/invoice.pdf"></label>
              <p class="hint">فایل باید بدون رمز و قابل دانلود مستقیم باشد.</p>
            </div>

            <div id="mode-text" class="hidden">
              <label class="field"><span>متن فاکتور را بچسبانید</span>
                <textarea id="text-input" rows="8" placeholder="شماره فاکتور: ۱۲۳۴&#10;تاریخ: 1404/08/12&#10;جمع کل: 12,500,000"></textarea></label>
              <button class="btn teal" id="parse-text-btn"><svg class="ic"><use href="#i-sparkles"/></svg>تحلیل متن</button>
            </div>

            <div class="mt-16">
              <div class="card-h" style="margin-bottom:8px"><h3 style="font-size:13px">موتور خوانش</h3></div>
              <div class="engine-grid">
                <button class="engine ${draft.engine === "cloud" ? "active" : ""}" data-engine="cloud" ${cloudReady ? "" : "disabled"}>
                  <div class="e-top"><svg class="ic"><use href="#i-cloud"/></svg>سرویس ابری
                    <span class="e-badge">${cloudReady ? "آماده" : "نیازمند توکن"}</span></div>
                  <small>${cloudReady ? "دقت بالا برای دست‌نویس، حرارتی و اسناد تصویری. متن از درگاه امن سرور عبور می‌کند."
                    : "دقت بالا برای دست‌نویس و حرارتی. برای فعال‌سازی، توکن را در «پنل مدیریت → سرویس ابری» ثبت کنید."}</small>
                </button>
                <button class="engine ${draft.engine === "local" ? "active" : ""}" data-engine="local" ${localReady ? "" : "disabled"}>
                  <div class="e-top"><svg class="ic"><use href="#i-cpu"/></svg>موتور لوکال
                    <span class="e-badge">${localReady ? "آماده" : "غیرفعال"}</span></div>
                  <small>بدون اینترنت و بدون ارسال فایل به بیرون. مناسب PDF متنی و اسناد حساس.</small>
                </button>
              </div>
            </div>

            <div class="grid-2 mt-16">
              <label class="field"><span>روش تبدیل</span>
                <select id="opt-method">
                  <option value="4">۴ — استخراج متن (پیشنهادی)</option>
                  <option value="1">۱ — حالت اول</option>
                  <option value="2">۲ — حالت دوم</option>
                  <option value="3">۳ — حالت سوم</option>
                </select></label>
              <label class="field"><span>قالب خروجی</span>
                <select id="opt-output">
                  <option value="txtrawjson">متن + ساختار JSON</option>
                  <option value="txtraw">متن خام</option>
                  <option value="txt">فایل متنی</option>
                  <option value="jsoncoordinates">مختصات کلمات</option>
                  <option value="keeplayout">حفظ ساختار (ورد)</option>
                </select></label>
              <label class="field"><span>نوع فاکتور</span>
                <select id="opt-type">
                  <option value="printed">چاپی</option>
                  <option value="thermal">حرارتی / فیش</option>
                  <option value="handwritten">دست‌نویس</option>
                  <option value="audio">صوتی</option>
                </select></label>
              <label class="field"><span>زبان سند / صوت</span>
                <select id="opt-language">
                  ${caps.cloud.languages.map((l) => `<option value="${l.code}">${esc(l.name)}</option>`).join("")}
                </select></label>
            </div>
            <label class="switch mt-12"><input type="checkbox" id="opt-delete" checked><i></i>
              حذف فایل از سرور ابری پس از پردازش</label>
            <button class="btn primary block lg mt-16" id="start-scan">
              <svg class="ic"><use href="#i-sparkles"/></svg>شروع خوانش فاکتور</button>
            <p class="hint">توکن سرویس ابری فقط روی سرور و رمزنگاری‌شده نگهداری می‌شود و در هیچ صفحه‌ای نمایش داده نمی‌شود.</p>
          </div>
        </div>

        <div class="dash-col">
          <div class="card" id="scan-status">
            <div class="card-h"><h3><svg class="ic"><use href="#i-clock"/></svg>وضعیت پردازش</h3></div>
            <div id="scan-status-body">${emptyState("در انتظار فایل", "فایل یا متن را اضافه کنید تا پردازش آغاز شود", "i-scan")}</div>
          </div>
          <div class="card">
            <div class="card-h"><h3><svg class="ic"><use href="#i-info"/></svg>راهنمای سریع</h3></div>
            <div class="steps">
              <div class="step done"><span class="s-dot">۱</span>فایل فاکتور را انتخاب کنید</div>
              <div class="step done"><span class="s-dot">۲</span>موتور ابری یا لوکال را برگزینید</div>
              <div class="step done"><span class="s-dot">۳</span>فیلدها را بازبینی و تأیید کنید</div>
              <div class="step done"><span class="s-dot">۴</span>فاکتور در بایگانی ثبت می‌شود</div>
            </div>
            <p class="hint mt-12">برای فاکتورهای تار یا دست‌نویس، روش «استخراج متن» با موتور ابری بهترین نتیجه را می‌دهد.</p>
          </div>
        </div>
      </div>`;

    /* --- حالت انتخاب فایل / لینک / متن --- */
    $$("#scan-mode button", el).forEach((btn) => btn.addEventListener("click", () => {
      $$("#scan-mode button", el).forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      draft.mode = btn.dataset.mode;
      ["file", "link", "text"].forEach((m) => $(`#mode-${m}`, el).classList.toggle("hidden", m !== draft.mode));
    }));

    const dropzone = $("#dropzone", el);
    const fileInput = $("#file-input", el);
    dropzone.addEventListener("click", () => fileInput.click());
    ["dragenter", "dragover"].forEach((ev) => dropzone.addEventListener(ev, (e) => {
      e.preventDefault(); dropzone.classList.add("drag");
    }));
    ["dragleave", "drop"].forEach((ev) => dropzone.addEventListener(ev, (e) => {
      e.preventDefault(); dropzone.classList.remove("drag");
    }));
    dropzone.addEventListener("drop", (e) => {
      const f = e.dataTransfer.files[0];
      if (f) pickFile(f);
    });
    fileInput.addEventListener("change", () => { if (fileInput.files[0]) pickFile(fileInput.files[0]); });

    function pickFile(file) {
      draft.file = file;
      $("#file-chip", el).innerHTML = `<div class="file-chip">
        <span class="thumb" style="background:rgba(212,175,55,.14);color:var(--gold)">
          <svg class="ic"><use href="#i-invoice"/></svg></span>
        <div class="fc-meta"><strong>${esc(file.name)}</strong>
          <span>${fileSize(file.size)} • ${esc(file.type || "فایل")}</span></div>
        <button class="ghost-icon" id="clear-file"><svg class="ic"><use href="#i-close"/></svg></button></div>`;
      $("#clear-file", el).onclick = () => {
        draft.file = null; fileInput.value = ""; $("#file-chip", el).innerHTML = "";
      };
    }

    $$("[data-engine]", el).forEach((btn) => btn.addEventListener("click", () => {
      if (btn.disabled) return;
      $$("[data-engine]", el).forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      draft.engine = btn.dataset.engine;
    }));

    const bind = (sel, key, cast = (v) => v) => {
      const node = $(sel, el);
      if (!node) return;
      node.addEventListener("change", () => { draft[key] = cast(node.value); });
      if (node.type === "checkbox") { draft[key] = node.checked; }
    };
    bind("#opt-method", "method", Number);
    bind("#opt-output", "output");
    bind("#opt-type", "invoiceType");
    bind("#opt-language", "language");

    $("#start-scan", el).addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      if (draft.mode === "text") return parsePasted();
      if (draft.mode === "link") return startLink();
      if (!draft.file) { toast("ابتدا یک فایل انتخاب کنید", { type: "warn" }); return; }
      const fd = new FormData();
      fd.append("file", draft.file);
      fd.append("provider", draft.engine);
      fd.append("method", draft.method);
      fd.append("output", draft.output);
      fd.append("language", draft.language);
      fd.append("invoice_type", draft.invoiceType);
      fd.append("delete_after", $("#opt-delete", el).checked ? "true" : "false");
      UI.setBusy(btn, true, "ارسال فایل…");
      try {
        const res = await API.ocrUpload(fd);
        draft.job = res.job;
        trackJob(res.job.id);
      } catch (err) {
        toast(err.message, { type: "error" });
        UI.setBusy(btn, false);
      }
    });

    async function startLink() {
      const url = $("#link-input", el).value.trim();
      if (!url) { toast("نشانی فایل را وارد کنید", { type: "warn" }); return; }
      try {
        const res = await API.ocrLink({ filelink: url, method: draft.method, output: draft.output, invoice_type: draft.invoiceType });
        draft.job = res.job;
        trackJob(res.job.id);
      } catch (err) { toast(err.message, { type: "error" }); }
    }

    async function parsePasted() {
      const text = $("#text-input", el).value.trim();
      if (text.length < 6) { toast("متن کافی نیست", { type: "warn" }); return; }
      const btn = $("#parse-text-btn", el);
      UI.setBusy(btn, true, "تحلیل…");
      try {
        const understood = await API.understand(text, draft.invoiceType, true);
        UI.setBusy(btn, false);
        renderReview({ parsed: understood.parsed, text, jobId: null, understood });
      } catch (err) {
        UI.setBusy(btn, false);
        toast(err.message, { type: "error" });
      }
    }

    /* --- پیگیری وضعیت پردازش --- */
    function trackJob(jobId) {
      const body = $("#scan-status-body", el);
      let ticks = 0;
      const paint = (job) => {
        const stages = [
          { key: "queued", label: "در صف پردازش" },
          { key: "uploading", label: "ارسال فایل به سرویس" },
          { key: "converting", label: "تبدیل و خوانش متن" },
          { key: "processing", label: "استخراج فیلدها" },
          { key: "done", label: "آماده بازبینی" },
        ];
        const idx = Math.max(0, stages.findIndex((s) => s.key === job.status));
        body.innerHTML = `
          <div class="flex items-center justify-between gap-8">
            <div style="min-width:0"><strong style="font-size:12.5px">${esc(job.file_name || "پردازش")}</strong>
              <div class="hint">${esc(job.message || statusFa[job.status] || "")}</div></div>
            ${badge(job.status)}
          </div>
          <div class="progress-lg"><i style="width:${job.progress || 3}%"></i></div>
          <div class="flex justify-between" style="font-size:11px;color:var(--text-3)">
            <span>${num(job.progress || 0)}٪</span><span>${job.provider === "cloud" ? "موتور ابری" : "موتور لوکال"}</span></div>
          <div class="steps mt-12">
            ${stages.map((s, i) => `<div class="step ${job.status === "failed" ? "" : (i < idx ? "done" : i === idx ? (job.status === "done" ? "done" : "current") : "")}">
              <span class="s-dot">${i < idx || job.status === "done" ? "✓" : num(i + 1)}</span>${s.label}</div>`).join("")}
          </div>
          ${job.status === "failed" ? `<div class="warn-item mt-12"><svg class="ic"><use href="#i-info"/></svg>
            <span>${esc(job.message || "پردازش ناموفق بود")}</span></div>
            <button class="btn sm mt-12" id="retry-job">تلاش مجدد</button>` : ""}
          ${["queued", "uploading", "converting", "processing"].includes(job.status)
            ? `<button class="btn sm danger mt-12" id="cancel-job">لغو پردازش</button>` : ""}`;
        const retry = $("#retry-job", body);
        if (retry) retry.onclick = async () => { await API.ocrRetry(job.id); toast("پردازش دوباره آغاز شد"); trackJob(job.id); };
        const cancel = $("#cancel-job", body);
        if (cancel) cancel.onclick = async () => { await API.ocrCancel(job.id); toast("پردازش لغو شد", { type: "warn" }); };
      };
      paint(draft.job || { status: "queued", progress: 0 });
      const timer = setInterval(async () => {
        ticks += 1;
        try {
          const { job } = await API.ocrJob(jobId, true);
          paint(job);
          if (job.status === "done") {
            clearInterval(timer);
            UI.setBusy($("#start-scan", el), false);
            renderReview({ parsed: job.parsed, text: job.text, jobId: job.id, job });
          }
          if (["failed", "cancelled"].includes(job.status) || ticks > 500) clearInterval(timer);
        } catch (err) { clearInterval(timer); }
      }, 1400);
      State.timers.push(timer);
    }

    /* --- فرم بازبینی و ثبت --- */
    function renderReview({ parsed, text, jobId, job, understood }) {
      const p = parsed || {};
      const conf = Number(p.confidence || 0);
      const body = $("#scan-status-body", el);
      // اگر موتور فهم اقلام جواب داده، اقلام و جمع‌هایش مرجع‌اند
      const u = understood || null;
      const items = ((u && u.items && u.items.length ? u.items : p.items) || []).map((it) => ({ ...it }));
      if (u) {
        if (u.parsed) {
          p.number = p.number || u.parsed.number;
          p.issue_date = p.issue_date || u.parsed.issue_date;
          p.seller_name = p.seller_name || u.parsed.seller_name;
          p.buyer_name = p.buyer_name || u.parsed.buyer_name;
        }
        if (u.meta) {
          p.seller_name = p.seller_name || u.meta.seller;
          p.buyer_name = p.buyer_name || u.meta.buyer;
          p.number = p.number || u.meta.number;
          p.issue_date = p.issue_date || u.meta.date;
        }
        const t = u.totals || {};
        if (t.subtotal) p.subtotal = t.subtotal;
        if (t.tax) p.tax = t.tax;
        if (t.discount) p.discount = t.discount;
        if (t.total) p.total = t.total;
      }
      body.innerHTML = `
        <div class="confidence">
          ${ring(conf, { color: conf >= 75 ? "#34d399" : conf >= 50 ? "#fbbf24" : "#f87171" })}
          <div class="c-meta"><strong>امتیاز اعتماد خوانش</strong>
            <span>${conf >= 75 ? "استخراج دقیق — بازبینی سریع کافی است" : conf >= 50 ? "بازبینی چند فیلد لازم است" : "کیفیت متن پایین؛ فیلدها را دستی کنترل کنید"}</span></div>
        </div>
        ${(p.warnings || []).length ? `<div class="warn-list">${p.warnings.map((w) =>
          `<div class="warn-item"><svg class="ic"><use href="#i-info"/></svg><span>${esc(w)}</span></div>`).join("")}</div>` : ""}
        ${u && u.items && u.items.length ? `<div class="card tight" style="display:flex;gap:10px;align-items:flex-start;border-right:3px solid #8b7cf6;background:rgba(139,124,246,.07)">
          <svg class="ic" style="flex:none;margin-top:2px"><use href="#i-sparkles"/></svg>
          <div style="flex:1">
            <strong style="font-size:12.5px">موتور فهم اقلام ${num(u.item_count || u.items.length)} قلم را خودش تشخیص داد</strong>
            <div style="font-size:11px;color:var(--text-3);margin-top:2px">
              ${u.engine && u.engine !== "rules" ? "خوانده‌شده از تصویر با هوش مصنوعی" : "از روی متن با قواعد هوشمند"}
              ${u.autofix && u.autofix.length ? ` • ${num(u.autofix.length)} رقم اصلاح شد` : ""}
              ${u.fallback ? ` • ${esc(u.fallback)}` : ""}
            </div>
          </div>
          <span class="pill" style="background:rgba(139,124,246,.15);color:#a78bfa;font-size:10.5px">${num(u.confidence)}٪</span>
        </div>` : ""}
        ${u && (u.issues || []).length ? `<div class="warn-list mt-12">${u.issues.map((w) =>
          `<div class="warn-item"><svg class="ic"><use href="#i-info"/></svg><span>${esc(w.message || w)}</span></div>`).join("")}
          <button class="btn sm ghost" id="fix-numbers" style="margin-top:6px">
            <svg class="ic"><use href="#i-check"/></svg>اصلاح خودکار اعداد</button></div>` : ""}
        <div class="grid-2 mt-12">
          <label class="field"><span>شماره فاکتور</span><input id="rv-number" value="${esc(p.number || "")}"></label>
          <label class="field"><span>تاریخ (شمسی)</span><input id="rv-date" value="${esc(p.issue_date || "")}" dir="ltr" placeholder="1404/08/12"></label>
          <label class="field"><span>فروشنده</span><input id="rv-seller" value="${esc(p.seller_name || "")}"></label>
          <label class="field"><span>خریدار</span><input id="rv-buyer" value="${esc(p.buyer_name || "")}"></label>
          <label class="field"><span>جمع اقلام (ریال)</span><input id="rv-subtotal" value="${p.subtotal || ""}" dir="ltr"></label>
          <label class="field"><span>مالیات (ریال)</span><input id="rv-tax" value="${p.tax || ""}" dir="ltr"></label>
          <label class="field"><span>تخفیف (ریال)</span><input id="rv-discount" value="${p.discount || ""}" dir="ltr"></label>
          <label class="field"><span>مبلغ کل (ریال)</span><input id="rv-total" value="${p.total || ""}" dir="ltr"></label>
        </div>
        <div class="card-h" style="margin:14px 0 8px"><h3 style="font-size:13px">اقلام شناسایی‌شده</h3>
          <button class="btn sm ghost" id="add-item"><svg class="ic"><use href="#i-plus"/></svg>ردیف</button></div>
        <div class="items-editor" id="items-editor"></div>
        <div class="grid-2 mt-12">
          <label class="field"><span>وضعیت</span><select id="rv-status">
            <option value="review">بازبینی</option><option value="confirmed">تأیید‌شده</option><option value="draft">پیش‌نویس</option>
          </select></label>
          <label class="field"><span>برچسب‌ها (با کاما)</span><input id="rv-tags" placeholder="خرید,مهر۱۴۰۴"></label>
        </div>
        <label class="field"><span>یادداشت</span><textarea id="rv-notes" rows="2"></textarea></label>
        <div class="flex gap-8 mt-12 wrap">
          <button class="btn primary" id="save-invoice"><svg class="ic"><use href="#i-check"/></svg>ثبت فاکتور</button>
          <button class="btn ghost" id="toggle-text"><svg class="ic"><use href="#i-edit"/></svg>متن خام</button>
          ${jobId ? `<button class="btn ghost" id="retry-ocr"><svg class="ic"><use href="#i-scan"/></svg>خوانش مجدد</button>` : ""}
        </div>
        <pre class="copyright mt-12 hidden" id="raw-text" style="max-height:220px;overflow:auto;font-size:11px;direction:rtl">${esc(text || "")}</pre>`;

      const editor = $("#items-editor", el);
      const paintItems = () => {
        editor.innerHTML = `<div class="item-row items-head"><span></span><span>شرح کالا / خدمت</span>
          <span class="i-qty">تعداد</span><span class="i-unit">واحد</span>
          <span class="i-unit-price">قیمت واحد</span><span>مبلغ</span><span></span></div>` +
          items.map((it, i) => `<div class="item-row" data-row="${i}">
            <span class="i-idx" title="${it.engine === "ai" ? "خوانده‌شده با هوش مصنوعی" : it.engine === "rules" ? "استخراج با قواعد" : "ورودی دستی"}">${num(i + 1)}${it.engine === "ai" ? `<b style="color:#a78bfa">✦</b>` : ""}</span>
            <input data-f="description" value="${esc(it.description || "")}">
            <input data-f="qty" class="i-qty" value="${it.qty || 1}" dir="ltr">
            <input data-f="unit" class="i-unit" value="${esc(it.unit || "عدد")}">
            <input data-f="unit_price" class="i-unit-price" value="${it.unit_price || 0}" dir="ltr">
            <input data-f="total" value="${it.total || 0}" dir="ltr">
            <button class="ghost-icon" data-del="${i}" title="حذف"><svg class="ic"><use href="#i-trash"/></svg></button>
          </div>`).join("");
        editor.querySelectorAll("input").forEach((inp) => {
          inp.addEventListener("change", () => {
            const row = Number(inp.closest("[data-row]").dataset.row);
            const field = inp.dataset.f;
            items[row][field] = field === "description" || field === "unit" ? inp.value : Number(inp.value || 0);
          });
        });
        editor.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => {
          items.splice(Number(b.dataset.del), 1);
          paintItems();
        }));
      };
      paintItems();

      const fixBtn = $("#fix-numbers", el);
      if (fixBtn) fixBtn.onclick = async () => {
        UI.setBusy(fixBtn, true, "اصلاح…");
        try {
          const res = await API.fixNumbers(
            items.map((it, i) => ({ ...it, row_no: i + 1 })),
            {
              subtotal: Number($("#rv-subtotal", el).value || 0),
              tax: Number($("#rv-tax", el).value || 0),
              discount: Number($("#rv-discount", el).value || 0),
              total: Number($("#rv-total", el).value || 0),
            },
          );
          items.length = 0;
          (res.items || []).forEach((it) => items.push(it));
          $("#rv-subtotal", el).value = res.totals.subtotal || 0;
          $("#rv-total", el).value = res.totals.total || 0;
          paintItems();
          UI.setBusy(fixBtn, false);
          toast(res.changes && res.changes.length
            ? `${num(res.changes.length)} رقم اصلاح شد`
            : "همهٔ اعداد درست بودند", { type: "success" });
          if (fixBtn.parentElement) {
            const box = fixBtn.parentElement;
            box.querySelectorAll(".warn-item").forEach((n) => n.remove());
            if (!res.issues || !res.issues.length) fixBtn.remove();
          }
        } catch (err) {
          UI.setBusy(fixBtn, false);
          toast(err.message, { type: "error" });
        }
      };
      $("#add-item", el).onclick = () => {
        items.push({ row_no: items.length + 1, description: "", qty: 1, unit: "عدد", unit_price: 0, total: 0 });
        paintItems();
      };
      $("#toggle-text", el).onclick = () => $("#raw-text", el).classList.toggle("hidden");
      if ($("#retry-ocr", el)) $("#retry-ocr", el).onclick = async () => {
        await API.ocrRetry(jobId);
        trackJob(jobId);
      };

      $("#save-invoice", el).onclick = async (e) => {
        const payload = {
          number: $("#rv-number", el).value.trim(),
          issue_date: $("#rv-date", el).value.trim(),
          seller_name: $("#rv-seller", el).value.trim(),
          buyer_name: $("#rv-buyer", el).value.trim(),
          subtotal: Number($("#rv-subtotal", el).value || 0),
          tax: Number($("#rv-tax", el).value || 0),
          discount: Number($("#rv-discount", el).value || 0),
          total: Number($("#rv-total", el).value || 0),
          status: $("#rv-status", el).value,
          tags: $("#rv-tags", el).value.trim(),
          notes: $("#rv-notes", el).value.trim(),
          invoice_type: (p.invoice_type || draft.invoiceType),
          source: jobId ? (job && job.provider) || draft.engine : "manual",
          ocr_text: text || "",
          items: items.map((it, i) => ({
            ...it,
            row_no: i + 1,
            engine: it.engine === "ai" || it.engine === "rules" ? it.engine : "manual",
            ai_confidence: Number(it.ai_confidence || 0),
          })),
          items_engine: u ? (u.engine === "rules" ? "rules" : "ai") : "",
          items_confidence: u ? Number(u.confidence || 0) : 0,
          items_autofixed: u && u.autofix ? u.autofix.length : 0,
        };
        UI.setBusy(e.currentTarget, true, "ثبت…");
        try {
          const res = jobId ? await API.ocrToInvoice(jobId, payload) : await API.createInvoice(payload);
          UI.setBusy(e.currentTarget, false);
          toast("فاکتور با موفقیت ثبت شد", { type: "success" });
          if (res.duplicate_of) toast("این فاکتور مشابه شماره‌ای است که قبلاً ثبت شده بود.", { type: "warn" });
          Invoices.refreshShell();
          location.hash = `#/invoices/${res.invoice.id}`;
        } catch (err) {
          UI.setBusy(e.currentTarget, false);
          toast(err.message, { type: "error" });
        }
      };
    }
  }

  /* ══════════════════════ فهرست فاکتورها ══════════════════════ */
  const Invoices = (() => {
    const filters = { q: "", status: "", type: "", direction: "", page: 1, per_page: 20, sort: "created_at", order: "desc" };
    let selected = new Set();
    let el = null;

    async function render(container, preset) {
      el = container;
      Object.assign(filters, preset || {});
      el.innerHTML = skeleton(5);
      let data;
      try { data = await API.invoices(filters); }
      catch (err) { el.innerHTML = emptyState("خطا در دریافت فاکتورها", err.message); return; }

      const statuses = [
        { key: "", label: "همه" }, { key: "draft", label: "پیش‌نویس" }, { key: "review", label: "بازبینی" },
        { key: "confirmed", label: "تأیید‌شده" }, { key: "archived", label: "بایگانی" },
      ];
      el.innerHTML = `
        <div class="toolbar">
          <div class="search-input grow">
            <svg class="ic"><use href="#i-search"/></svg>
            <input id="inv-search" placeholder="جست‌وجو در شماره، فروشنده، خریدار، برچسب…" value="${esc(filters.q)}">
          </div>
          <div class="seg" id="inv-status">
            ${statuses.map((s) => `<button class="${(filters.status || "") === s.key ? "active" : ""}" data-status="${s.key}">${s.label}</button>`).join("")}
          </div>
          <select id="inv-type" style="width:135px">
            <option value="">همه انواع</option>
            ${Object.entries(typeFa).map(([k, v]) => `<option value="${k}" ${filters.type === k ? "selected" : ""}>${v}</option>`).join("")}
          </select>
          <button class="btn" id="inv-export"><svg class="ic"><use href="#i-download"/></svg>خروجی</button>
          <button class="btn primary" id="inv-new"><svg class="ic"><use href="#i-plus"/></svg>فاکتور جدید</button>
        </div>

        <div class="stat-strip mb-12">
          <div>تعداد<b>${num(data.total)}</b></div>
          <div>جمع کل<b>${moneyShort(data.summary.sum_total)}</b></div>
          <div>مالیات<b>${moneyShort(data.summary.sum_tax)}</b></div>
        </div>

        <div id="bulk-bar"></div>

        <div class="card tight" style="padding:0;overflow:hidden">
          ${data.items.length ? `<div class="table-wrap" style="border:none">
            <table><thead><tr>
              <th style="width:34px"><input type="checkbox" id="check-all" style="width:auto"></th>
              <th>فاکتور</th><th>طرفین</th><th class="num">مبلغ کل</th><th>تاریخ</th>
              <th>منبع</th><th>وضعیت</th><th style="width:112px"></th>
            </tr></thead><tbody>
            ${data.items.map((inv) => `<tr data-id="${inv.id}">
              <td><input type="checkbox" class="row-check" value="${inv.id}" style="width:auto" ${selected.has(inv.id) ? "checked" : ""}></td>
              <td><div class="cell-main">
                <span class="thumb" style="background:${typeColor[inv.invoice_type]}22;color:${typeColor[inv.invoice_type]}">
                  <svg class="ic"><use href="#${typeIcon[inv.invoice_type] || "i-invoice"}"/></svg></span>
                <div><strong>${esc(inv.number || "بدون شماره")}</strong>
                  <div style="font-size:10.5px;color:var(--text-3)">${esc(typeFa[inv.invoice_type] || inv.invoice_type)} • ${num(inv.items_count)} قلم</div></div>
              </div></td>
              <td><div style="font-size:12px">${esc(inv.seller_name || "—")}</div>
                <div style="font-size:10.5px;color:var(--text-3)">${esc(inv.buyer_name || "—")}</div></td>
              <td class="num"><strong>${num(inv.total)}</strong>
                ${inv.confidence ? `<div style="font-size:10px;color:${inv.confidence >= 75 ? "var(--green)" : inv.confidence >= 50 ? "var(--amber)" : "var(--red)"}">اعتماد ${num(inv.confidence)}٪</div>` : ""}</td>
              <td class="num">${esc(inv.issue_date || "—")}</td>
              <td><span class="tag">${esc(sourceFa[inv.source] || inv.source)}</span></td>
              <td>${badge(inv.status)}</td>
              <td><div class="row-actions">
                <a class="ghost-icon" href="#/invoices/${inv.id}" title="جزئیات"><svg class="ic"><use href="#i-arrow"/></svg></a>
                <button class="ghost-icon" data-print="${inv.id}" title="چاپ"><svg class="ic"><use href="#i-print"/></svg></button>
                <button class="ghost-icon" data-del="${inv.id}" title="حذف"><svg class="ic"><use href="#i-trash"/></svg></button>
              </div></td>
            </tr>`).join("")}</tbody></table></div>
            <div class="pager" style="padding:12px 14px">
              <span>صفحه ${num(data.page)} از ${num(data.pages)} — ${num(data.total)} فاکتور</span>
              <div class="pager-btns">
                <button data-page="prev" ${data.page <= 1 ? "disabled" : ""}>قبلی</button>
                ${Array.from({ length: Math.min(data.pages, 6) }).map((_, i) => {
                  const p = i + 1;
                  return `<button data-page="${p}" class="${p === data.page ? "active" : ""}">${num(p)}</button>`;
                }).join("")}
                <button data-page="next" ${data.page >= data.pages ? "disabled" : ""}>بعدی</button>
              </div>
            </div>` : emptyState("فاکتوری یافت نشد", "با تغییر فیلترها جست‌وجو کنید یا فاکتور جدید بسازید", "i-invoice")}
        </div>`;

      const search = $("#inv-search", el);
      search.addEventListener("input", debounce(() => { filters.q = search.value; filters.page = 1; render(el); }, 420));
      $$("#inv-status button", el).forEach((b) => b.addEventListener("click", () => {
        filters.status = b.dataset.status; filters.page = 1; render(el);
      }));
      $("#inv-type", el).addEventListener("change", (e) => { filters.type = e.target.value; filters.page = 1; render(el); });
      $("#inv-new", el).onclick = () => openManual();
      $("#inv-export", el).onclick = () => exportMenu();
      $$("[data-page]", el).forEach((b) => b.addEventListener("click", () => {
        if (b.disabled) return;
        const v = b.dataset.page;
        if (v === "prev") filters.page = Math.max(1, data.page - 1);
        else if (v === "next") filters.page = Math.min(data.pages, data.page + 1);
        else filters.page = Number(v);
        render(el);
      }));
      const checkAll = $("#check-all", el);
      if (checkAll) checkAll.addEventListener("change", () => {
        $$(".row-check", el).forEach((c) => { c.checked = checkAll.checked; toggle(c); });
      });
      $$(".row-check", el).forEach((c) => c.addEventListener("change", () => toggle(c)));
      $$("[data-del]", el).forEach((b) => b.addEventListener("click", async () => {
        const ok = await confirmDialog({
          title: "حذف فاکتور", message: "این فاکتور برای همیشه حذف می‌شود. ادامه می‌دهید؟",
          confirmText: "حذف کن", danger: true,
        });
        if (!ok) return;
        try { await API.deleteInvoice(Number(b.dataset.del)); toast("فاکتور حذف شد"); render(el); }
        catch (err) { toast(err.message, { type: "error" }); }
      }));
      $$("[data-print]", el).forEach((b) => b.addEventListener("click", () => printInvoice(Number(b.dataset.print))));

      function toggle(checkbox) {
        const id = Number(checkbox.value);
        if (checkbox.checked) selected.add(id); else selected.delete(id);
        paintBulk();
      }
      function paintBulk() {
        const bar = $("#bulk-bar", el);
        if (!bar) return;
        bar.innerHTML = selected.size ? `<div class="card tight mb-12" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <strong style="font-size:12.5px">${num(selected.size)} فاکتور انتخاب شده</strong>
          <div class="flex gap-8 wrap" style="margin-inline-start:auto">
            <button class="btn sm" data-bulk="confirmed">تأیید</button>
            <button class="btn sm" data-bulk="archived">بایگانی</button>
            <button class="btn sm" data-bulk="tag">برچسب‌گذاری</button>
            <button class="btn sm danger" data-bulk="delete">حذف</button>
            <button class="btn sm ghost" data-bulk="clear">لغو انتخاب</button>
          </div></div>` : "";
        $$("[data-bulk]", bar).forEach((b) => b.addEventListener("click", async () => {
          const action = b.dataset.bulk;
          if (action === "clear") { selected.clear(); render(el); return; }
          if (action === "delete") {
            const ok = await confirmDialog({ title: "حذف گروهی", message: `${num(selected.size)} فاکتور حذف شود؟`, confirmText: "حذف", danger: true });
            if (!ok) return;
          }
          const payload = { ids: Array.from(selected), action };
          if (action === "tag") {
            const tag = prompt("نام برچسب را وارد کنید:");
            if (!tag) return;
            payload.tag = tag;
          }
          try {
            await API.bulkInvoices(payload);
            toast("عملیات گروهی انجام شد");
            selected.clear();
            render(el);
          } catch (err) { toast(err.message, { type: "error" }); }
        }));
      }

      function exportMenu() {
        modal({
          title: "خروجی فاکتورها",
          body: `<p class="hint" style="margin-bottom:14px">قالب خروجی را انتخاب کنید. ${selected.size ? `${num(selected.size)} فاکتور انتخاب‌شده` : "همه فاکتورها"} خروجی گرفته می‌شود.</p>
            <div style="display:grid;gap:8px">
              <button class="btn block" data-fmt="xlsx"><svg class="ic"><use href="#i-download"/></svg>اکسل (XLSX) — سه برگه خلاصه، فاکتورها، اقلام</button>
              <button class="btn block" data-fmt="csv"><svg class="ic"><use href="#i-download"/></svg>CSV — سازگار با اکسل فارسی</button>
              <button class="btn block" data-fmt="json"><svg class="ic"><use href="#i-download"/></svg>JSON — برای اتصال به سامانه دیگر</button>
            </div>`,
          onMount: (wrap) => {
            wrap.querySelectorAll("[data-fmt]").forEach((b) => b.addEventListener("click", () => {
              const params = selected.size ? { ids: Array.from(selected).join(",") } : (filters.status ? { status: filters.status } : {});
              downloadAuth(API.exportUrl(b.dataset.fmt, params), `invoices.${b.dataset.fmt}`);
              wrap.remove();
            }));
          },
        });
      }
    }

    function openManual() {
      const today = new Date();
      const draftItems = [{ description: "", qty: 1, unit: "عدد", unit_price: 0, total: 0 }];
      modal({
        title: "ثبت دستی فاکتور",
        wide: true,
        body: `<div class="grid-3">
            <label class="field"><span>شماره فاکتور</span><input id="m-number" placeholder="12345"></label>
            <label class="field"><span>تاریخ (شمسی)</span><input id="m-date" dir="ltr" placeholder="1404/08/12"></label>
            <label class="field"><span>نوع</span><select id="m-type">
              ${Object.entries(typeFa).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></label>
            <label class="field"><span>فروشنده</span><input id="m-seller"></label>
            <label class="field"><span>خریدار</span><input id="m-buyer"></label>
            <label class="field"><span>جهت</span><select id="m-direction">
              <option value="purchase">خرید</option><option value="sale">فروش</option></select></label>
          </div>
          <div class="card-h" style="margin:6px 0 8px"><h3 style="font-size:13px">اقلام</h3>
            <button class="btn sm ghost" id="m-add"><svg class="ic"><use href="#i-plus"/></svg>ردیف</button></div>
          <div class="items-editor" id="m-items"></div>
          <div class="grid-3 mt-12">
            <label class="field"><span>تخفیف</span><input id="m-discount" value="0" dir="ltr"></label>
            <label class="field"><span>مالیات</span><input id="m-tax" value="0" dir="ltr"></label>
            <label class="field"><span>مبلغ کل</span><input id="m-total" value="0" dir="ltr"></label>
          </div>
          <label class="field"><span>یادداشت</span><input id="m-notes"></label>`,
        footer: `<button class="btn ghost" data-close>انصراف</button>
                 <button class="btn primary" id="m-save"><svg class="ic"><use href="#i-check"/></svg>ثبت فاکتور</button>`,
        onMount: (wrap, close) => {
          const box = wrap.querySelector("#m-items");
          const paint = () => {
            box.innerHTML = draftItems.map((it, i) => `<div class="item-row" data-row="${i}">
              <span class="i-idx">${num(i + 1)}</span>
              <input data-f="description" placeholder="شرح کالا" value="${esc(it.description)}">
              <input data-f="qty" class="i-qty" value="${it.qty}" dir="ltr">
              <input data-f="unit" class="i-unit" value="${esc(it.unit)}">
              <input data-f="unit_price" class="i-unit-price" value="${it.unit_price}" dir="ltr">
              <input data-f="total" value="${it.total}" dir="ltr">
              <button class="ghost-icon" data-rm="${i}"><svg class="ic"><use href="#i-trash"/></svg></button></div>`).join("");
            box.querySelectorAll("input").forEach((inp) => inp.addEventListener("change", () => {
              const row = Number(inp.closest("[data-row]").dataset.row);
              const f = inp.dataset.f;
              draftItems[row][f] = ["description", "unit"].includes(f) ? inp.value : Number(inp.value || 0);
              if (f === "qty" || f === "unit_price") {
                draftItems[row].total = (draftItems[row].qty || 0) * (draftItems[row].unit_price || 0);
                paint();
                sum();
              }
              sum();
            }));
            box.querySelectorAll("[data-rm]").forEach((b) => b.addEventListener("click", () => {
              draftItems.splice(Number(b.dataset.rm), 1);
              if (!draftItems.length) draftItems.push({ description: "", qty: 1, unit: "عدد", unit_price: 0, total: 0 });
              paint(); sum();
            }));
          };
          const sum = () => {
            const subtotal = draftItems.reduce((s, i) => s + Number(i.total || 0), 0);
            const tax = Number(wrap.querySelector("#m-tax").value || 0);
            const discount = Number(wrap.querySelector("#m-discount").value || 0);
            wrap.querySelector("#m-total").value = subtotal - discount + tax;
          };
          wrap.querySelector("#m-add").onclick = () => {
            draftItems.push({ description: "", qty: 1, unit: "عدد", unit_price: 0, total: 0 }); paint();
          };
          wrap.querySelector("#m-tax").addEventListener("input", sum);
          wrap.querySelector("#m-discount").addEventListener("input", sum);
          paint();
          wrap.querySelector("#m-save").onclick = async (e) => {
            const payload = {
              number: wrap.querySelector("#m-number").value.trim(),
              issue_date: wrap.querySelector("#m-date").value.trim(),
              invoice_type: wrap.querySelector("#m-type").value,
              direction: wrap.querySelector("#m-direction").value,
              seller_name: wrap.querySelector("#m-seller").value.trim(),
              buyer_name: wrap.querySelector("#m-buyer").value.trim(),
              tax: Number(wrap.querySelector("#m-tax").value || 0),
              discount: Number(wrap.querySelector("#m-discount").value || 0),
              total: Number(wrap.querySelector("#m-total").value || 0),
              subtotal: draftItems.reduce((s, i) => s + Number(i.total || 0), 0),
              notes: wrap.querySelector("#m-notes").value.trim(),
              status: "confirmed", source: "manual",
              items: draftItems.filter((i) => i.description || i.total).map((i, idx) => ({ ...i, row_no: idx + 1 })),
            };
            UI.setBusy(e.currentTarget, true);
            try {
              const res = await API.createInvoice(payload);
              UI.setBusy(e.currentTarget, false);
              close();
              toast("فاکتور ثبت شد");
              location.hash = `#/invoices/${res.invoice.id}`;
            } catch (err) { UI.setBusy(e.currentTarget, false); toast(err.message, { type: "error" }); }
          };
        },
      });
    }

    const refreshShell = async () => {
      try {
        const me = await API.me();
        State.user = me.user; State.sub = me.subscription;
        try { localStorage.setItem("fk_user", JSON.stringify(me.user)); } catch (e) { /* بی‌صدا */ }
        window.dispatchEvent(new CustomEvent("fk:refresh"));
      } catch (err) { /* بی‌صدا */ }
    };

    return { render, openManual, refreshShell, filters };
  })();

  /* ══════════════════════ جزئیات فاکتور ══════════════════════ */
  async function invoiceDetail(el, id) {
    el.innerHTML = skeleton(5);
    let data;
    try { data = await API.invoice(id); }
    catch (err) { el.innerHTML = emptyState("فاکتور یافت نشد", err.message, "i-info"); return; }
    const inv = data.invoice;
    const items = inv.items || [];

    el.innerHTML = `
      <div class="section-title">
        <div>
          <button class="btn sm ghost" id="d-back" style="margin-bottom:6px">
            <svg class="ic" style="width:14px;height:14px"><use href="#i-arrow"/></svg>بازگشت</button>
          <h3>فاکتور ${esc(inv.number || "بدون شماره")} ${badge(inv.status)}</h3>
          <p>${esc(typeFa[inv.invoice_type] || "")} • ${esc(sourceFa[inv.source] || "")} • ثبت در ${esc(inv.created_at || "")}</p>
        </div>
        <div class="flex gap-8 wrap">
          <button class="btn" id="d-print"><svg class="ic"><use href="#i-print"/></svg>چاپ</button>
          <button class="btn" id="d-download"><svg class="ic"><use href="#i-download"/></svg>فایل اصلی</button>
          <button class="btn" id="d-edit"><svg class="ic"><use href="#i-edit"/></svg>ویرایش</button>
          <button class="btn danger" id="d-del"><svg class="ic"><use href="#i-trash"/></svg>حذف</button>
        </div>
      </div>

      <div class="detail-grid mb-12">
        <div class="detail-item"><span>فروشنده</span><strong>${esc(inv.seller_name || "—")}</strong></div>
        <div class="detail-item"><span>خریدار</span><strong>${esc(inv.buyer_name || "—")}</strong></div>
        <div class="detail-item"><span>تاریخ صدور</span><strong dir="ltr">${esc(inv.issue_date || "—")}</strong></div>
        <div class="detail-item"><span>اعتماد خوانش</span><strong>${num(inv.confidence)}٪</strong></div>
        <div class="detail-item"><span>مبلغ کل</span><strong>${num(inv.total)} ریال</strong></div>
        <div class="detail-item"><span>مالیات</span><strong>${num(inv.tax)} ریال</strong></div>
      </div>

      <div class="card mb-12" style="padding:0;overflow:hidden">
        <div class="card-h" style="padding:16px 18px 0"><h3><svg class="ic"><use href="#i-layers"/></svg>اقلام فاکتور</h3>
          <span class="tag">${num(items.length)} قلم</span></div>
        ${items.length ? `<div class="table-wrap" style="border:none;margin-top:12px"><table>
          <thead><tr><th>#</th><th>شرح</th><th class="num">تعداد</th><th>واحد</th>
            <th class="num">قیمت واحد</th><th class="num">مبلغ</th></tr></thead>
          <tbody>${items.map((it, i) => `<tr>
            <td>${num(i + 1)}</td><td><strong>${esc(it.description || "—")}</strong></td>
            <td class="num">${num(it.qty)}</td><td>${esc(it.unit || "")}</td>
            <td class="num">${num(it.unit_price)}</td><td class="num"><strong>${num(it.total)}</strong></td>
          </tr>`).join("")}</tbody></table></div>` : emptyState("قلمی ثبت نشده", "این فاکتور بدون ردیف اقلام ثبت شده است", "i-layers")}
        <div style="padding:14px 18px;border-top:1px solid var(--stroke);display:flex;flex-direction:column;gap:6px;align-items:flex-end;font-size:12.5px">
          <div>جمع اقلام: <strong>${num(inv.subtotal)} ریال</strong></div>
          <div>تخفیف: <strong>${num(inv.discount)} ریال</strong></div>
          <div>مالیات: <strong>${num(inv.tax)} ریال</strong></div>
          <div style="font-size:15px;color:var(--gold)">قابل پرداخت: <strong>${num(inv.total)} ریال</strong></div>
        </div>
      </div>

      <div class="dash-grid">
        <div class="card">
          <div class="card-h"><h3><svg class="ic"><use href="#i-edit"/></svg>متن استخراج‌شده (OCR)</h3>
            ${inv.ocr_text ? `<button class="btn sm ghost" id="copy-text">کپی متن</button>` : ""}</div>
          ${inv.ocr_text ? `<pre class="copyright" style="max-height:320px;overflow:auto">${esc(inv.ocr_text)}</pre>`
            : emptyState("متنی ثبت نشده", "این فاکتور به‌صورت دستی ایجاد شده است", "i-scan")}
        </div>
        <div class="card">
          <div class="card-h"><h3><svg class="ic"><use href="#i-info"/></svg>اطلاعات تکمیلی</h3></div>
          <div class="detail-grid">
            <div class="detail-item"><span>شناسه ملی فروشنده</span><strong dir="ltr">${esc(inv.seller_tax_id || "—")}</strong></div>
            <div class="detail-item"><span>شناسه ملی خریدار</span><strong dir="ltr">${esc(inv.buyer_tax_id || "—")}</strong></div>
            <div class="detail-item"><span>پرداختی</span><strong>${num(inv.paid)} ریال</strong></div>
            <div class="detail-item"><span>فایل</span><strong>${esc(inv.file_name || "—")}</strong></div>
          </div>
          ${inv.tags && inv.tags.length ? `<div class="chips mt-12">${inv.tags.map((t) => `<span class="chip">${esc(t)}</span>`).join("")}</div>` : ""}
          ${inv.notes ? `<p class="hint mt-12" style="font-size:12px">${esc(inv.notes)}</p>` : ""}
          ${inv.duplicate_of ? `<div class="warn-item mt-12"><svg class="ic"><use href="#i-info"/></svg>
            <span>این فاکتور احتمالاً تکرار فاکتور #${num(inv.duplicate_of)} است.</span></div>` : ""}
        </div>
      </div>`;

    $("#d-back", el).onclick = () => history.back();
    $("#d-print", el).onclick = () => printInvoice(inv.id);
    $("#d-download", el).onclick = () => {
      if (!inv.has_file) return toast("فایل اصلی برای این فاکتور ذخیره نشده است", { type: "warn" });
      downloadAuth(`./api.php?action=invoice-file&id=${inv.id}`, inv.file_name || `invoice-${inv.id}`);
    };
    $("#d-del", el).onclick = async () => {
      const ok = await confirmDialog({ title: "حذف فاکتور", message: "این فاکتور حذف شود؟", confirmText: "حذف", danger: true });
      if (!ok) return;
      try { await API.deleteInvoice(inv.id); toast("حذف شد"); location.hash = "#/invoices"; }
      catch (err) { toast(err.message, { type: "error" }); }
    };
    $("#d-edit", el).onclick = () => openEdit(inv);
    const copyBtn = $("#copy-text", el);
    if (copyBtn) copyBtn.onclick = () => copy(inv.ocr_text, "متن OCR کپی شد");

    function openEdit(invoice) {
      modal({
        title: `ویرایش فاکتور ${invoice.number || ""}`,
        wide: true,
        body: `<div class="grid-3">
            <label class="field"><span>شماره</span><input id="e-number" value="${esc(invoice.number)}"></label>
            <label class="field"><span>تاریخ</span><input id="e-date" value="${esc(invoice.issue_date)}" dir="ltr"></label>
            <label class="field"><span>وضعیت</span><select id="e-status">
              ${Object.entries({ draft: "پیش‌نویس", review: "بازبینی", confirmed: "تأیید‌شده", archived: "بایگانی" })
                .map(([k, v]) => `<option value="${k}" ${invoice.status === k ? "selected" : ""}>${v}</option>`).join("")}</select></label>
            <label class="field"><span>فروشنده</span><input id="e-seller" value="${esc(invoice.seller_name)}"></label>
            <label class="field"><span>خریدار</span><input id="e-buyer" value="${esc(invoice.buyer_name)}"></label>
            <label class="field"><span>نوع</span><select id="e-type">
              ${Object.entries(typeFa).map(([k, v]) => `<option value="${k}" ${invoice.invoice_type === k ? "selected" : ""}>${v}</option>`).join("")}</select></label>
          </div>
          <div class="grid-3">
            <label class="field"><span>جمع اقلام</span><input id="e-subtotal" value="${invoice.subtotal}" dir="ltr"></label>
            <label class="field"><span>تخفیف</span><input id="e-discount" value="${invoice.discount}" dir="ltr"></label>
            <label class="field"><span>مالیات</span><input id="e-tax" value="${invoice.tax}" dir="ltr"></label>
          </div>
          <div class="grid-2">
            <label class="field"><span>مبلغ کل</span><input id="e-total" value="${invoice.total}" dir="ltr"></label>
            <label class="field"><span>برچسب‌ها</span><input id="e-tags" value="${esc((invoice.tags || []).join(","))}"></label>
          </div>
          <label class="field"><span>یادداشت</span><textarea id="e-notes" rows="2">${esc(invoice.notes || "")}</textarea></label>`,
        footer: `<button class="btn ghost" data-close>انصراف</button>
                 <button class="btn primary" id="e-save">ذخیره تغییرات</button>`,
        onMount: (wrap, close) => {
          wrap.querySelector("#e-save").onclick = async (e) => {
            const payload = {
              number: wrap.querySelector("#e-number").value.trim(),
              issue_date: wrap.querySelector("#e-date").value.trim(),
              status: wrap.querySelector("#e-status").value,
              seller_name: wrap.querySelector("#e-seller").value.trim(),
              buyer_name: wrap.querySelector("#e-buyer").value.trim(),
              invoice_type: wrap.querySelector("#e-type").value,
              subtotal: Number(wrap.querySelector("#e-subtotal").value || 0),
              discount: Number(wrap.querySelector("#e-discount").value || 0),
              tax: Number(wrap.querySelector("#e-tax").value || 0),
              total: Number(wrap.querySelector("#e-total").value || 0),
              tags: wrap.querySelector("#e-tags").value.trim(),
              notes: wrap.querySelector("#e-notes").value.trim(),
              direction: invoice.direction,
              items: items.map((it) => ({
                row_no: it.row_no, code: it.code, description: it.description, qty: it.qty,
                unit: it.unit, unit_price: it.unit_price, discount: it.discount,
                tax_rate: it.tax_rate, total: it.total,
              })),
            };
            UI.setBusy(e.currentTarget, true);
            try {
              await API.updateInvoice(invoice.id, payload);
              UI.setBusy(e.currentTarget, false);
              close();
              toast("تغییرات ذخیره شد");
              invoiceDetail(el, invoice.id);
            } catch (err) { UI.setBusy(e.currentTarget, false); toast(err.message, { type: "error" }); }
          };
        },
      });
    }
  }

  /* ---------- نسخه چاپی ---------- */
  async function printInvoice(id) {
    try {
      const data = await API.invoicePrint(id);
      const inv = data.invoice;
      const win = window.open("", "_blank", "width=860,height=1000");
      if (!win) return toast("مرورگر پنجره چاپ را مسدود کرد", { type: "error" });
      win.document.write(`<!DOCTYPE html><html lang="fa" dir="rtl"><head><meta charset="utf-8">
        <title>چاپ فاکتور ${esc(inv.number)}</title>
        <style>
          @font-face{font-family:V;src:url('${FK_ASSET_BASE}assets/fonts/Vazirmatn-Regular.woff2') format('woff2');font-weight:400}
          @font-face{font-family:V;src:url('${FK_ASSET_BASE}assets/fonts/Vazirmatn-Bold.woff2') format('woff2');font-weight:700}
          *{box-sizing:border-box}
          body{font-family:V,Tahoma,sans-serif;padding:34px;color:#101828;line-height:1.9}
          .top{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #d4af37;padding-bottom:14px}
          h1{font-size:22px;margin:0}
          .meta{font-size:12px;color:#475467;line-height:2}
          table{width:100%;border-collapse:collapse;margin-top:18px;font-size:12px}
          th{background:#101828;color:#f1d98a;padding:8px;text-align:right}
          td{padding:8px;border-bottom:1px solid #e6e9f0}
          .totals{margin-top:16px;display:flex;flex-direction:column;gap:5px;align-items:flex-end;font-size:12.5px}
          .grand{font-size:16px;font-weight:700;color:#8d7325}
          .foot{margin-top:34px;border-top:1px solid #e6e9f0;padding-top:12px;font-size:10.5px;color:#7b89a2;display:flex;justify-content:space-between}
          @media print{body{padding:12px}}
        </style></head><body>
        <div class="top"><div><h1>${esc(data.company.name || "فاکتور")}</h1>
          <div class="meta">${esc(data.company.phone || "")} ${data.company.email ? "• " + esc(data.company.email) : ""}</div></div>
          <div class="meta" style="text-align:left">
            شماره: <b>${esc(inv.number || "—")}</b><br>تاریخ: <b>${esc(inv.issue_date || "—")}</b><br>
            وضعیت: ${esc(statusFa[inv.status] || inv.status)}</div></div>
        <div style="display:flex;gap:40px;margin-top:14px;font-size:12px">
          <div>فروشنده: <b>${esc(inv.seller_name || "—")}</b></div>
          <div>خریدار: <b>${esc(inv.buyer_name || "—")}</b></div></div>
        <table><thead><tr><th>#</th><th>شرح</th><th>تعداد</th><th>قیمت واحد</th><th>مبلغ</th></tr></thead>
        <tbody>${(inv.items || []).map((it, i) => `<tr><td>${num(i + 1)}</td><td>${esc(it.description)}</td>
          <td>${num(it.qty)}</td><td>${num(it.unit_price)}</td><td>${num(it.total)}</td></tr>`).join("")}</tbody></table>
        <div class="totals">
          <div>جمع اقلام: ${num(inv.subtotal)} ریال</div>
          <div>تخفیف: ${num(inv.discount)} ریال</div>
          <div>مالیات: ${num(inv.tax)} ریال</div>
          <div class="grand">قابل پرداخت: ${num(inv.total)} ریال</div></div>
        <div class="foot"><span>صادرشده توسط ${esc(data.issued_by)}</span>
          <span>فاکتورخوان — اثر سعید سالاری</span></div>
        <script>window.onload=()=>setTimeout(()=>window.print(),320)<\/script>
        </body></html>`);
      win.document.close();
    } catch (err) { toast(err.message, { type: "error" }); }
  }

  return { dashboard, scan, invoices: Invoices, invoiceDetail, printInvoice };
})();


/* ══════════════════════════════════════════════════════════════
   صفحه‌های گزارش، اشتراک، پشتیبانی، تنظیمات و قابلیت‌ها
   ══════════════════════════════════════════════════════════════ */
Object.assign(Views, (() => {
  const { $, $$, esc, num, moneyShort, badge, toast, modal, confirmDialog, emptyState, skeleton,
    areaChart, donut, ring, copy, downloadAuth, fileSize, statusFa, typeFa, sourceFa, debounce } = UI;

  const typeColor = { printed: "#5aa9f8", thermal: "#fbbf24", handwritten: "#8b7cf6", audio: "#f472a6", other: "#94a3b8" };

  /* ══════════════ گزارش‌ها ══════════════ */
  async function reports(el) {
    el.innerHTML = skeleton(4);
    let stats;
    try { stats = await API.invoiceStats(); }
    catch (err) { el.innerHTML = emptyState("گزارش در دسترس نیست", err.message); return; }

    const monthly = {};
    (stats.series || []).forEach((row) => {
      if (!row.date || row.date === "—") return;
      const key = row.date.slice(0, 7);
      monthly[key] = monthly[key] || { count: 0, total: 0 };
      monthly[key].count += row.count;
      monthly[key].total += row.total;
    });

    el.innerHTML = `
      <div class="section-title">
        <div><h3>گزارش‌ها و تحلیل</h3><p>تصویر کلی از فاکتورهای ثبت‌شده در سامانه</p></div>
        <div class="flex gap-8 wrap">
          <button class="btn" data-exp="xlsx"><svg class="ic"><use href="#i-download"/></svg>اکسل</button>
          <button class="btn" data-exp="csv"><svg class="ic"><use href="#i-download"/></svg>CSV</button>
          <button class="btn" data-exp="json"><svg class="ic"><use href="#i-download"/></svg>JSON</button>
        </div>
      </div>

      <div class="kpi-grid">
        <div class="kpi" style="--k-color:#d4af37"><div class="k-label"><svg class="ic"><use href="#i-invoice"/></svg>تعداد فاکتور</div>
          <div class="k-value">${num(stats.counts.total)}</div>
          <div class="k-foot">${num(stats.counts.confirmed)} تأیید‌شده • ${num(stats.counts.review)} بازبینی</div></div>
        <div class="kpi" style="--k-color:#2dd4bf"><div class="k-label"><svg class="ic"><use href="#i-chart"/></svg>جمع مبالغ</div>
          <div class="k-value">${moneyShort(stats.sums.total)}</div>
          <div class="k-foot">میانگین هر فاکتور ${moneyShort(stats.counts.total ? stats.sums.total / stats.counts.total : 0)}</div></div>
        <div class="kpi" style="--k-color:#8b7cf6"><div class="k-label"><svg class="ic"><use href="#i-layers"/></svg>جمع مالیات</div>
          <div class="k-value">${moneyShort(stats.sums.tax)}</div>
          <div class="k-foot">تخفیف کل ${moneyShort(stats.sums.discount)}</div></div>
        <div class="kpi" style="--k-color:#5aa9f8"><div class="k-label"><svg class="ic"><use href="#i-sparkles"/></svg>کیفیت خوانش</div>
          <div class="k-value">${num(stats.avg_confidence)}٪</div>
          <div class="k-foot">میانگین اعتماد فیلدهای استخراج‌شده</div></div>
      </div>

      <div class="dash-grid">
        <div class="dash-col">
          <div class="card card-glow">
            <div class="card-h"><div><h3><svg class="ic"><use href="#i-chart"/></svg>روند مبالغ</h3>
              <p>${num((stats.series || []).length)} تاریخ فاکتور</p></div></div>
            ${areaChart(stats.series || [])}
          </div>
          <div class="card">
            <div class="card-h"><h3><svg class="ic"><use href="#i-clock"/></svg>خلاصه ماهانه</h3></div>
            ${Object.keys(monthly).length ? `<div class="table-wrap"><table>
              <thead><tr><th>ماه</th><th class="num">تعداد</th><th class="num">جمع مبالغ (ریال)</th><th class="num">میانگین</th></tr></thead>
              <tbody>${Object.entries(monthly).sort().reverse().map(([m, v]) => `<tr>
                <td><strong>${esc(m)}</strong></td><td class="num">${num(v.count)}</td>
                <td class="num">${num(v.total)}</td><td class="num">${num(Math.round(v.total / (v.count || 1)))}</td></tr>`).join("")}
              </tbody></table></div>` : emptyState("داده ماهانه نیست", "پس از ثبت فاکتورها این جدول پر می‌شود", "i-chart")}
          </div>
        </div>
        <div class="dash-col">
          <div class="card">
            <div class="card-h"><h3><svg class="ic"><use href="#i-layers"/></svg>توزیع انواع</h3></div>
            <div class="donut-wrap">
              ${donut(Object.entries(stats.by_type).map(([k, v]) => ({ value: v, color: typeColor[k] || "#94a3b8" })))}
              <div class="legend">${Object.entries(stats.by_type).map(([k, v]) =>
                `<div class="legend-row"><i style="background:${typeColor[k] || "#94a3b8"}"></i>${esc(typeFa[k] || k)}<b>${num(v)}</b></div>`).join("")
                || `<div class="legend-row">داده‌ای نیست</div>`}</div>
            </div>
          </div>
          <div class="card">
            <div class="card-h"><h3><svg class="ic"><use href="#i-folder"/></svg>بیشترین مبالغ فروشنده</h3></div>
            ${(stats.top_sellers || []).length ? `<div class="legend">${stats.top_sellers.map((s, i) =>
              `<div class="legend-row"><i style="background:${["#d4af37", "#2dd4bf", "#8b7cf6", "#5aa9f8", "#f472a6", "#fbbf24"][i % 6]}"></i>
                ${esc(s.name)}<b>${moneyShort(s.total)}</b></div>`).join("")}</div>`
              : emptyState("فروشنده‌ای ثبت نشده", "نام فروشنده در فاکتورها خالی است", "i-users")}
          </div>
          <div class="card">
            <div class="card-h"><h3><svg class="ic"><use href="#i-cloud"/></svg>منبع خوانش</h3></div>
            <div class="legend">${Object.entries(stats.by_source).map(([k, v]) =>
              `<div class="legend-row"><i style="background:#2dd4bf"></i>${esc(sourceFa[k] || k)}<b>${num(v)}</b></div>`).join("")
              || `<div class="legend-row">داده‌ای نیست</div>`}</div>
          </div>
        </div>
      </div>`;

    $$("[data-exp]", el).forEach((b) => b.addEventListener("click", () => {
      downloadAuth(API.exportUrl(b.dataset.exp), `report.${b.dataset.exp}`);
    }));
  }

  /* ══════════════ اشتراک ══════════════ */
  async function subscription(el) {
    el.innerHTML = skeleton(4);
    let sub, plans;
    try { [sub, plans] = await Promise.all([API.subscription(), API.plans()]); }
    catch (err) { el.innerHTML = emptyState("اطلاعات اشتراک در دسترس نیست", err.message); return; }
    const s = sub.subscription || {};
    State.sub = s;

    el.innerHTML = `
      <div class="sub-hero mb-12">
        <div class="hero-card">
          <div class="h-eyebrow">اشتراک فعال شما</div>
          <h3>${esc(s.plan_name || "بدون طرح")}</h3>
          <p style="font-size:12.5px;color:var(--text-2)">${s.valid
            ? `اعتبار تا ${esc(s.ends_at)} — ${num(s.days_left)} روز باقی‌مانده`
            : "اشتراک شما فعال نیست. یکی از طرح‌ها را انتخاب یا کد اشتراک را وارد کنید."}</p>
          <div class="h-meta">
            <div><strong>${num(s.pages_left)}</strong>صفحه باقی‌مانده</div>
            <div><strong>${num(s.days_left)}</strong>روز اعتبار</div>
            <div><strong>${s.support_active ? "فعال" : "پایان‌یافته"}</strong>پشتیبانی تا ${esc(s.support_until || "—")}</div>
            <div><strong>${num(s.device_count || 0)}/${num(s.max_devices || 1)}</strong>دستگاه</div>
          </div>
          <div class="progress mt-16" style="max-width:340px"><i style="width:${s.usage_percent || 0}%"></i></div>
          <p class="hint" style="color:rgba(255,255,255,.55)">${num(s.pages_used)} صفحه از ${num(s.pages_quota)} صفحه مصرف شده — ${num(s.usage_percent || 0)}٪</p>
        </div>
        <div class="card">
          <div class="card-h"><h3><svg class="ic"><use href="#i-key"/></svg>فعال‌سازی کد اشتراک</h3></div>
          <p class="hint mb-12">کد اشتراکی که از پشتیبانی دریافت کرده‌اید را وارد کنید. کدها یک‌بارمصرف هستند.</p>
          <label class="field"><span>کد اشتراک</span>
            <input id="redeem-key" dir="ltr" placeholder="FK-XXXX-XXXX-XXXX-XXXX" style="letter-spacing:1px"></label>
          <button class="btn primary block" id="redeem-btn"><svg class="ic"><use href="#i-check"/></svg>فعال‌سازی اشتراک</button>
          <div class="hint mt-12" id="key-check"></div>
          <div class="switch-row mt-12" style="border:none;padding:0">
            <span>وضعیت اشتراک</span>${badge(s.status || "expired")}
          </div>
        </div>
      </div>

      <div class="section-title"><div><h3>طرح‌ها</h3><p>برای دریافت کد اشتراک با پشتیبانی تماس بگیرید</p></div></div>
      <div class="plan-grid mb-12">
        ${(plans.items || []).map((p) => `<div class="plan ${p.is_featured ? "featured" : ""}">
          ${p.is_featured ? `<span class="p-badge">پیشنهاد ما</span>` : ""}
          <h4>${esc(p.name)}</h4>
          <div class="p-tag">${esc(p.tagline || "")}</div>
          <div class="p-price">${p.price ? num(p.price) : "رایگان"} <small>${p.price ? "ریال" : ""}</small></div>
          <div class="hint">${num(p.duration_days)} روز • ${num(p.page_quota)} صفحه • ${num(p.max_devices)} دستگاه</div>
          <ul>${(p.features || []).map((f) => `<li><svg class="ic"><use href="#i-check"/></svg>${esc(f)}</li>`).join("")}</ul>
          <button class="btn block ${p.is_featured ? "primary" : ""}" data-plan="${p.id}">درخواست این طرح</button>
        </div>`).join("")}
      </div>

      <div class="dash-grid">
        <div class="card">
          <div class="card-h"><h3><svg class="ic"><use href="#i-cpu"/></svg>دستگاه‌های متصل</h3>
            <span class="tag">${num(s.device_count || 0)} از ${num(s.max_devices || 1)}</span></div>
          <div id="devices-box">${skeleton(2)}</div>
        </div>
        <div class="card">
          <div class="card-h"><h3><svg class="ic"><use href="#i-info"/></svg>راهنمای اشتراک</h3></div>
          <div class="steps">
            <div class="step done"><span class="s-dot">۱</span>کد اشتراک را از پشتیبانی دریافت کنید</div>
            <div class="step done"><span class="s-dot">۲</span>در همین صفحه آن را فعال کنید</div>
            <div class="step done"><span class="s-dot">۳</span>سهمیه صفحات و پشتیبانی بلافاصله فعال می‌شود</div>
            <div class="step done"><span class="s-dot">۴</span>برای تمدید، کد جدید را روی همان حساب فعال کنید</div>
          </div>
          <p class="hint mt-12">تمدید پیش از پایان اعتبار، به باقی‌مانده روزها اضافه می‌شود.</p>
        </div>
      </div>`;

    const redeemInput = $("#redeem-key", el);
    redeemInput.addEventListener("input", debounce(async () => {
      const key = redeemInput.value.trim();
      const box = $("#key-check", el);
      if (key.length < 10) { box.innerHTML = ""; return; }
      try {
        const res = await API.checkKey(key);
        box.innerHTML = res.valid
          ? `<span class="text-teal">✓ کد معتبر است — ${esc(res.plan)} • ${num(res.duration_days)} روز • ${num(res.page_quota)} صفحه</span>`
          : `<span class="text-red">✕ ${esc(res.reason || "کد معتبر نیست")}</span>`;
      } catch { box.innerHTML = ""; }
    }, 500));

    $("#redeem-btn", el).onclick = async (e) => {
      const key = redeemInput.value.trim();
      if (!key) return toast("کد اشتراک را وارد کنید", { type: "warn" });
      UI.setBusy(e.currentTarget, true, "فعال‌سازی…");
      try {
        const res = await API.redeem(key);
        UI.setBusy(e.currentTarget, false);
        toast(res.message, { type: "success" });
        window.dispatchEvent(new CustomEvent("fk:refresh"));
        subscription(el);
      } catch (err) { UI.setBusy(e.currentTarget, false); toast(err.message, { type: "error" }); }
    };

    $$("[data-plan]", el).forEach((b) => b.addEventListener("click", () => {
      const plan = (plans.items || []).find((p) => p.id === Number(b.dataset.plan));
      modal({
        title: `درخواست ${plan.name}`,
        body: `<div class="quote mb-12">برای دریافت کد اشتراک، شماره سفارش یا نام طرح را به پشتیبانی اعلام کنید.</div>
          <div class="detail-grid">
            <div class="detail-item"><span>مدت</span><strong>${num(plan.duration_days)} روز</strong></div>
            <div class="detail-item"><span>سهمیه</span><strong>${num(plan.page_quota)} صفحه</strong></div>
            <div class="detail-item"><span>پشتیبانی</span><strong>${num(plan.support_days)} روز</strong></div>
            <div class="detail-item"><span>قیمت</span><strong>${num(plan.price)} ریال</strong></div>
          </div>
          <p class="hint mt-12">پس از دریافت کد، آن را در صفحه «اشتراک من» فعال کنید.</p>`,
        footer: `<a class="btn primary" href="#/support" data-close>رفتن به پشتیبانی</a>`,
      });
    }));

    try {
      const devices = await API.devices();
      const box = $("#devices-box", el);
      box.innerHTML = devices.items.length
        ? devices.items.map((d) => `<div class="job">
            <span class="thumb" style="background:rgba(90,169,248,.14);color:var(--sky)">
              <svg class="ic"><use href="#i-server"/></svg></span>
            <div class="j-main"><strong>${esc(d.label || d.device_id)}</strong>
              <span>${esc(d.platform || "دستگاه")} • آخرین فعالیت ${esc(d.last_seen || "—")}</span></div>
            <button class="ghost-icon" data-device="${esc(d.device_id)}" title="حذف دستگاه">
              <svg class="ic"><use href="#i-trash"/></svg></button></div>`).join("")
        : emptyState("دستگاهی ثبت نشده", "با ورود از هر دستگاه، این فهرست پر می‌شود", "i-cpu");
      box.querySelectorAll("[data-device]").forEach((b) => b.addEventListener("click", async () => {
        const ok = await confirmDialog({ title: "حذف دستگاه", message: "این دستگاه از حساب شما جدا شود؟", danger: true, confirmText: "حذف" });
        if (!ok) return;
        try { await API.removeDevice(b.dataset.device); toast("دستگاه حذف شد"); subscription(el); }
        catch (err) { toast(err.message, { type: "error" }); }
      }));
    } catch { $("#devices-box", el).innerHTML = emptyState("فهرست دستگاه‌ها در دسترس نیست", ""); }
  }

  /* ══════════════ پشتیبانی و معرفی ══════════════ */
  async function support(el) {
    el.innerHTML = skeleton(3);
    const meta = State.meta || (State.meta = await API.meta());
    const owner = meta.owner || {};
    const contact = owner.contact || {};
    /* پیام‌های قبلی این کاربر: بدون این، پاسخ پشتیبانی هیچ‌جا دیده
       نمی‌شد و کاربر فکر می‌کرد جوابی نیامده. خطا هم بی‌صدا رد می‌شود
       تا نبودِ آن، کل صفحهٔ پشتیبانی را خراب نکند. */
    let tickets = { items: [], total: 0 };
    try { tickets = await API.myTickets(); } catch { /* بی‌صدا */ }

    el.innerHTML = `
      <div class="card card-glow mb-12">
        <div class="owner-card">
          <div class="owner-avatar">${esc((owner.name || "س").slice(0, 1))}</div>
          <div>
            <div class="h-eyebrow text-gold" style="font-size:11px;letter-spacing:1.4px">پدیدآورنده و پشتیبان</div>
            <h3 style="font-size:23px;margin:4px 0 2px">${esc(owner.name || "سعید سالاری")}</h3>
            <p style="font-size:12.5px;color:var(--text-2)">${(owner.title_parts || []).map((t) => esc(t)).join(" • ")}</p>
            <p class="quote mt-12">${esc(owner.bio || "")}</p>
            <div class="chips">${(owner.skills || []).map((s) => `<span class="chip">${esc(s)}</span>`).join("")}</div>
            <div class="flex gap-8 wrap mt-16">
              <a class="btn primary sm" href="tel:${esc(contact.phone || "")}"><svg class="ic" style="width:15px;height:15px"><use href="#i-support"/></svg>${esc(contact.phone || "تماس")}</a>
              <a class="btn sm" href="mailto:${esc(contact.email || "")}"><svg class="ic" style="width:15px;height:15px"><use href="#i-info"/></svg>${esc(contact.email || "ایمیل")}</a>
              <span class="btn sm ghost"><svg class="ic" style="width:15px;height:15px"><use href="#i-clock"/></svg>${esc(owner.response_time || "")}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="dash-grid">
        <div class="dash-col">
          ${(tickets.items || []).length ? `<div class="card">
            <div class="card-h"><h3><svg class="ic"><use href="#i-clock"/></svg>پیام‌های من</h3>
              <span class="hint">${num(tickets.total)} مورد</span></div>
            <div class="ticket-list">${tickets.items.map((t) => `
              <div class="ticket ${t.status === "answered" ? "answered" : ""}">
                <div class="tk-head">
                  <strong>${esc(t.subject)}</strong>
                  <span class="badge ${t.status === "answered" ? "ok" : "warn"}">${esc(t.status_fa)}</span>
                </div>
                <p class="tk-msg">${esc(t.message)}</p>
                ${t.answer ? `<div class="tk-answer"><span class="h-eyebrow">پاسخ پشتیبانی</span><p>${esc(t.answer)}</p></div>` : ""}
                <span class="tk-date">${esc(t.created_at || "")}</span>
              </div>`).join("")}</div>
          </div>` : ""}
          <div class="card">
            <div class="card-h"><h3><svg class="ic"><use href="#i-support"/></svg>ارسال پیام به پشتیبانی</h3></div>
            <p class="hint mb-12">${esc(owner.support_note || "")}</p>
            <label class="field"><span>موضوع</span><input id="t-subject" placeholder="مثلاً: فاکتور حرارتی درست خوانده نمی‌شود"></label>
            <label class="field"><span>راه ارتباطی (موبایل یا ایمیل)</span><input id="t-contact" dir="ltr" value="${esc((State.user && (State.user.phone || State.user.email)) || "")}"></label>
            <label class="field"><span>توضیح کامل</span><textarea id="t-message" rows="5" placeholder="شرح مشکل، نام فایل و آنچه انتظار داشتید را بنویسید…"></textarea></label>
            <button class="btn primary" id="t-send"><svg class="ic"><use href="#i-arrow"/></svg>ارسال پیام</button>
          </div>
          <div class="card">
            <div class="card-h"><h3><svg class="ic"><use href="#i-info"/></svg>پرسش‌های متداول</h3></div>
            ${(meta.faq || []).map((f, i) => `<div class="faq-item" data-faq="${i}">
              <button class="faq-q"><svg class="ic"><use href="#i-arrow"/></svg>${esc(f.q)}</button>
              <div class="faq-a">${esc(f.a)}</div></div>`).join("")}
          </div>
        </div>
        <div class="dash-col">
          <div class="card">
            <div class="card-h"><h3><svg class="ic"><use href="#i-star"/></svg>اصول کاری</h3></div>
            <div class="steps">${(owner.philosophy || []).map((p, i) =>
              `<div class="step done"><span class="s-dot">${num(i + 1)}</span>${esc(p)}</div>`).join("")}</div>
            <p class="quote mt-16">${esc(owner.tagline || "")}</p>
          </div>
          <div class="card">
            <div class="card-h"><h3><svg class="ic"><use href="#i-lock"/></svg>حق معنوی نرم‌افزار</h3></div>
            <div class="copyright">${esc(meta.copyright || "")}</div>
            <button class="btn sm ghost mt-12" id="copy-copyright"><svg class="ic" style="width:14px;height:14px"><use href="#i-edit"/></svg>کپی متن</button>
          </div>
        </div>
      </div>`;

    $$("[data-faq]", el).forEach((item) => {
      item.querySelector(".faq-q").addEventListener("click", () => item.classList.toggle("open"));
    });
    $("#t-send", el).onclick = async (e) => {
      const subject = $("#t-subject", el).value.trim();
      const message = $("#t-message", el).value.trim();
      if (subject.length < 3 || message.length < 5) return toast("موضوع و متن پیام را کامل کنید", { type: "warn" });
      UI.setBusy(e.currentTarget, true, "ارسال…");
      try {
        const res = await API.support({ subject, message, contact: $("#t-contact", el).value.trim() });
        UI.setBusy(e.currentTarget, false);
        toast(res.message, { type: "success" });
        $("#t-subject", el).value = ""; $("#t-message", el).value = "";
        /* پیام تازه بلافاصله در فهرست دیده شود */
        support(el);
      } catch (err) { UI.setBusy(e.currentTarget, false); toast(err.message, { type: "error" }); }
    };
    $("#copy-copyright", el).onclick = () => copy(meta.copyright || "", "متن حق معنوی کپی شد");
  }

  /* ══════════════ تنظیمات ══════════════ */
  async function settings(el) {
    const user = State.user || {};
    const meta = State.meta || {};
    el.innerHTML = `
      <div class="tabs" id="set-tabs">
        <button class="tab active" data-tab="profile">حساب کاربری</button>
        <button class="tab" data-tab="security">امنیت</button>
        <button class="tab" data-tab="appearance">ظاهر</button>
        <button class="tab" data-tab="system">سامانه</button>
      </div>
      <div id="set-body"></div>`;

    const panels = {
      profile: () => `
        <div class="settings-grid">
          <div class="card">
            <div class="card-h"><h3><svg class="ic"><use href="#i-users"/></svg>اطلاعات حساب</h3></div>
            <label class="field"><span>نام و نام خانوادگی</span><input id="p-name" value="${esc(user.full_name || "")}"></label>
            <label class="field"><span>شرکت / مجموعه</span><input id="p-company" value="${esc(user.company || "")}"></label>
            <div class="grid-2">
              <label class="field"><span>موبایل</span><input id="p-phone" dir="ltr" value="${esc(user.phone || "")}"></label>
              <label class="field"><span>ایمیل</span><input value="${esc(user.email || "")}" disabled dir="ltr"></label>
            </div>
            <button class="btn primary" id="save-profile"><svg class="ic"><use href="#i-check"/></svg>ذخیره اطلاعات</button>
          </div>
          <div class="card">
            <div class="card-h"><h3><svg class="ic"><use href="#i-key"/></svg>خلاصه اشتراک</h3></div>
            <div class="detail-grid">
              <div class="detail-item"><span>طرح</span><strong>${esc((State.sub && State.sub.plan_name) || "—")}</strong></div>
              <div class="detail-item"><span>وضعیت</span>${badge((State.sub && State.sub.status) || "expired")}</div>
              <div class="detail-item"><span>پایان اعتبار</span><strong dir="ltr">${esc((State.sub && State.sub.ends_at) || "—")}</strong></div>
              <div class="detail-item"><span>صفحات</span><strong>${num((State.sub && State.sub.pages_left) || 0)} باقی</strong></div>
            </div>
            <a class="btn block mt-12" href="#/subscription">مدیریت اشتراک</a>
            <div class="switch-row mt-12"><span>حساب مدیر سامانه</span>
              <strong>${user.is_admin ? "بله" : "خیر"}</strong></div>
          </div>
        </div>`,
      security: () => `
        <div class="settings-grid">
          <div class="card">
            <div class="card-h"><h3><svg class="ic"><use href="#i-lock"/></svg>تغییر گذرواژه</h3></div>
            <label class="field"><span>گذرواژه فعلی</span><input type="password" id="s-current" dir="ltr"></label>
            <label class="field"><span>گذرواژه جدید (حداقل ۸ کاراکتر)</span><input type="password" id="s-new" dir="ltr"></label>
            <label class="field"><span>تکرار گذرواژه جدید</span><input type="password" id="s-confirm" dir="ltr"></label>
            <button class="btn primary" id="save-password"><svg class="ic"><use href="#i-check"/></svg>تغییر گذرواژه</button>
          </div>
          <div class="card">
            <div class="card-h"><h3><svg class="ic"><use href="#i-shield"/></svg>وضعیت امنیتی</h3></div>
            <div class="health-row"><span class="dot"></span>ذخیره توکن ابری به‌صورت رمزنگاری‌شده<b class="text-teal">فعال</b></div>
            <div class="health-row"><span class="dot"></span>هش گذرواژه با الگوریتم استاندارد<b class="text-teal">PBKDF2</b></div>
            <div class="health-row"><span class="dot"></span>توکن دسترسی JWT<b class="text-teal">فعال</b></div>
            <div class="health-row"><span class="dot"></span>نمایش توکن سرویس ابری در رابط کاربری<b class="text-teal">هرگز</b></div>
            <p class="hint mt-12">توکن سرویس ابری فقط در پنل مدیریت و به‌صورت مخفی قابل جایگزینی است؛ مقدار آن حتی برای شما نمایش داده نمی‌شود.</p>
          </div>
        </div>`,
      appearance: () => `
        <div class="card">
          <div class="card-h"><h3><svg class="ic"><use href="#i-palette"/></svg>ظاهر برنامه</h3></div>
          <div class="engine-grid" style="max-width:520px">
            <button class="engine ${document.documentElement.dataset.theme === "dark" ? "active" : ""}" data-theme-pick="dark">
              <div class="e-top"><svg class="ic"><use href="#i-moon"/></svg>قالب تیره</div>
              <small>مناسب کار طولانی و محیط کم‌نور</small></button>
            <button class="engine ${document.documentElement.dataset.theme === "light" ? "active" : ""}" data-theme-pick="light">
              <div class="e-top"><svg class="ic"><use href="#i-sun"/></svg>قالب روشن</div>
              <small>مناسب چاپ و محیط پرنور</small></button>
          </div>
          <div class="switch-row mt-16"><span>فونت برنامه</span><strong>وزیرمتن (همراه برنامه)</strong></div>
          <div class="switch-row"><span>جهت چیدمان</span><strong>راست به چپ (RTL)</strong></div>
          <div class="switch-row"><span>پالت فرمان</span><strong>Ctrl + K</strong></div>
        </div>`,
      system: () => `
        <div class="settings-grid">
          <div class="card">
            <div class="card-h"><h3><svg class="ic"><use href="#i-info"/></svg>درباره برنامه</h3></div>
            <div class="detail-grid">
              <div class="detail-item"><span>نام</span><strong>${esc((meta.app && meta.app.name) || "فاکتورخوان")}</strong></div>
              <div class="detail-item"><span>نسخه</span><strong dir="ltr">v${esc((meta.app && meta.app.version) || "1.0.0")}</strong></div>
              <div class="detail-item"><span>قابلیت‌ها</span><strong>${num(meta.features_total || 120)} مورد</strong></div>
              <div class="detail-item"><span>پدیدآورنده</span><strong>${esc((meta.owner && meta.owner.name) || "سعید سالاری")}</strong></div>
            </div>
            <div class="health-row mt-12"><span class="dot"></span>موتور ابری
              <b class="${State.caps && State.caps.cloud.configured ? "text-teal" : "text-red"}">
                ${State.caps && State.caps.cloud.configured ? "متصل" : "تنظیم نشده"}</b></div>
            <div class="health-row"><span class="dot ${State.caps && State.caps.local.pdf ? "" : "bad"}"></span>موتور لوکال
              <b>${esc((State.caps && State.caps.local.engine) || "pypdf")}</b></div>
            <div class="health-row"><span class="dot"></span>حداکثر حجم فایل
              <b>${num((meta.settings && meta.settings.max_upload_mb) || 25)} مگابایت</b></div>
          </div>
          <div class="card">
            <div class="card-h"><h3><svg class="ic"><use href="#i-star"/></svg>حق معنوی</h3></div>
            <div class="copyright" style="max-height:280px;overflow:auto">${esc(meta.copyright || "")}</div>
            <div class="flex gap-8 mt-12 wrap">
              <a class="btn sm" href="#/features">فهرست قابلیت‌ها</a>
              <a class="btn sm" href="#" target="_blank">مستندات API</a>
              <button class="btn sm ghost" id="logout-all">خروج از حساب</button>
            </div>
          </div>
        </div>`,
    };

    const paint = (key) => {
      $("#set-body", el).innerHTML = panels[key]();
      if (key === "profile") {
        $("#save-profile", el).onclick = async (e) => {
          UI.setBusy(e.currentTarget, true);
          try {
            const res = await API.updateProfile({
              full_name: $("#p-name", el).value.trim(),
              company: $("#p-company", el).value.trim(),
              phone: $("#p-phone", el).value.trim(),
            });
            State.user = res.user;
            try { localStorage.setItem("fk_user", JSON.stringify(res.user)); } catch (e) { /* بی‌صدا */ }
            window.dispatchEvent(new CustomEvent("fk:refresh"));
            toast("اطلاعات به‌روزرسانی شد");
          } catch (err) { toast(err.message, { type: "error" }); }
          UI.setBusy(e.currentTarget, false);
        };
      }
      if (key === "security") {
        $("#save-password", el).onclick = async (e) => {
          const p1 = $("#s-new", el).value, p2 = $("#s-confirm", el).value;
          if (p1 !== p2) return toast("گذرواژه‌های جدید یکسان نیستند", { type: "warn" });
          UI.setBusy(e.currentTarget, true);
          try {
            await API.changePassword({ current_password: $("#s-current", el).value, new_password: p1 });
            toast("گذرواژه تغییر کرد");
            ["#s-current", "#s-new", "#s-confirm"].forEach((s) => { $(s, el).value = ""; });
          } catch (err) { toast(err.message, { type: "error" }); }
          UI.setBusy(e.currentTarget, false);
        };
      }
      if (key === "appearance") {
        $$("[data-theme-pick]", el).forEach((b) => b.addEventListener("click", () => {
          window.App.setTheme(b.dataset.themePick);
          $$("[data-theme-pick]", el).forEach((x) => x.classList.remove("active"));
          b.classList.add("active");
        }));
      }
      if (key === "system") {
        $("#logout-all", el).onclick = () => window.App.logout();
      }
    };
    paint("profile");
    $$("#set-tabs .tab", el).forEach((tab) => tab.addEventListener("click", () => {
      $$("#set-tabs .tab", el).forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      paint(tab.dataset.tab);
    }));
  }

  /* ══════════════ قابلیت‌ها ══════════════ */
  async function features(el) {
    el.innerHTML = skeleton(4);
    let data;
    try { data = await API.features(); }
    catch (err) { el.innerHTML = emptyState("فهرست قابلیت‌ها در دسترس نیست", err.message); return; }
    el.innerHTML = `
      <div class="hero-card mb-12">
        <div class="h-eyebrow">فهرست رسمی محصول</div>
        <h3>${num(data.total)} قابلیت در ${num(data.groups.length)} ماژول</h3>
        <p style="font-size:12.5px;color:var(--text-2)">هر قابلیت در همین نسخه پیاده‌سازی شده و در رابط کاربری یا سرویس API قابل استفاده است.</p>
        <div class="h-meta">
          ${data.groups.map((g) => `<div><strong>${num(g.items.length)}</strong>${esc(g.title)}</div>`).join("")}
        </div>
      </div>
      ${data.groups.map((g) => `<div class="feature-cat">
        <h4><svg class="ic"><use href="#i-${g.icon}"/></svg>${esc(g.title)}<span>${num(g.items.length)} قابلیت</span></h4>
        <ul class="feature-list">${g.items.map((item, i) => `<li>
          <span class="num">${num((data.groups.slice(0, data.groups.indexOf(g)).reduce((s, x) => s + x.items.length, 0)) + i + 1)}</span>
          <svg class="ic"><use href="#i-check"/></svg><span>${esc(item)}</span></li>`).join("")}</ul>
      </div>`).join("")}
      <p class="hint text-center mt-24">فاکتورخوان — اثر ${esc((State.meta && State.meta.owner && State.meta.owner.name) || "سعید سالاری")} — نسخه ${esc((State.meta && State.meta.app && State.meta.app.version) || "1.0.0")}</p>`;
  }

  return { reports, subscription, support, settings, features };
})());


/* ══════════════════════════════════════════════════════════════
   پنل مدیریت — کاربران، طرح‌ها، کدهای اشتراک، توکن ابری، گزارش رویداد
   ══════════════════════════════════════════════════════════════ */
const Admin = (() => {
  const { $, $$, esc, num, moneyShort, badge, toast, modal, confirmDialog, emptyState, skeleton,
    copy, downloadAuth, statusFa, debounce } = UI;
  let activeTab = "overview";
  let el = null;
  let cache = { plans: [] };

  const TABS = [
    { key: "overview", label: "نمای کلی" },
    { key: "users", label: "کاربران" },
    { key: "plans", label: "طرح‌ها" },
    { key: "keys", label: "کدهای اشتراک" },
    { key: "cloud", label: "سرویس ابری" },
    { key: "support", label: "پیام‌ها" },
    { key: "audit", label: "گزارش رویداد" },
    { key: "settings", label: "تنظیمات" },
  ];

  async function render(container) {
    el = container;
    el.innerHTML = `
      <div class="tabs" id="admin-tabs">
        ${TABS.map((t) => `<button class="tab ${t.key === activeTab ? "active" : ""}" data-tab="${t.key}">${t.label}</button>`).join("")}
      </div>
      <div id="admin-body">${skeleton(4)}</div>`;
    $$("#admin-tabs .tab", el).forEach((tab) => tab.addEventListener("click", () => {
      activeTab = tab.dataset.tab;
      $$("#admin-tabs .tab", el).forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      paint();
    }));
    paint();
  }

  function paint() {
    const body = $("#admin-body", el);
    const map = {
      overview: overviewTab, users: usersTab, plans: plansTab, keys: keysTab,
      cloud: cloudTab, support: supportTab, audit: auditTab, settings: settingsTab,
    };
    (map[activeTab] || overviewTab)(body);
  }

  /* ══════════════ نمای کلی ══════════════ */
  async function overviewTab(body) {
    body.innerHTML = skeleton(3);
    let data;
    try { data = await API.admin.overview(); }
    catch (err) { body.innerHTML = emptyState("دسترسی یا داده در دسترس نیست", err.message); return; }
    const c = data.counts;
    const kpis = [
      { label: "کاربران", value: num(c.users), icon: "i-users", color: "#d4af37", foot: `${num(c.trialing)} در دوره آزمایشی` },
      { label: "اشتراک فعال", value: num(c.active_subscriptions), icon: "i-key", color: "#34d399", foot: `درآمد ثبت‌شده ${moneyShort(data.revenue)}` },
      { label: "فاکتورهای سامانه", value: num(c.invoices), icon: "i-invoice", color: "#2dd4bf", foot: `${num(c.jobs)} پردازش OCR` },
      { label: "کدهای آماده", value: num(c.keys_unused), icon: "i-layers", color: "#8b7cf6", foot: `${num(c.keys_used)} کد مصرف‌شده` },
    ];
    body.innerHTML = `
      <div class="kpi-grid">
        ${kpis.map((k) => `<div class="kpi" style="--k-color:${k.color}">
          <div class="k-label"><svg class="ic"><use href="#${k.icon}"/></svg>${k.label}</div>
          <div class="k-value">${k.value}</div><div class="k-foot">${k.foot}</div></div>`).join("")}
      </div>
      <div class="dash-grid">
        <div class="dash-col">
          <div class="card">
            <div class="card-h"><h3><svg class="ic"><use href="#i-clock"/></svg>آخرین رویدادها</h3>
              <button class="link-btn" data-goto="audit">همه رویدادها</button></div>
            <div class="table-wrap"><table><thead><tr><th>کاربر</th><th>رویداد</th><th>جزئیات</th><th>زمان</th></tr></thead>
              <tbody>${(data.recent || []).map((r) => `<tr><td><strong>${esc(r.actor)}</strong></td>
                <td><span class="tag">${esc(r.action)}</span></td><td>${esc(r.detail || "—")}</td>
                <td class="num">${esc(r.at)}</td></tr>`).join("")}</tbody></table></div>
          </div>
          <div class="card">
            <div class="card-h"><h3><svg class="ic"><use href="#i-shield"/></svg>سلامت سامانه</h3></div>
            <div id="admin-health">${skeleton(2)}</div>
          </div>
        </div>
        <div class="dash-col">
          <div class="card card-glow">
            <div class="card-h"><h3><svg class="ic"><use href="#i-cloud"/></svg>سرویس ابری</h3></div>
            <div class="health-row"><span class="dot ${data.cloud.gateway_ready ? "" : "bad"}"></span>درگاه پیکربندی‌شده
              <b>${data.cloud.gateway_ready ? "بله" : "خیر"}</b></div>
            <div class="health-row"><span class="dot ${data.cloud.configured ? "" : "bad"}"></span>توکن ثبت‌شده
              <b>${data.cloud.configured ? "بله" : "خیر"}</b></div>
            <div class="health-row"><span class="dot"></span>نمایش توکن در رابط کاربری<b class="text-teal">غیرفعال</b></div>
            <p class="hint mt-12">مقدار توکن حتی برای مدیر نیز نمایش داده نمی‌شود؛ فقط امکان جایگزینی وجود دارد.</p>
            <button class="btn block mt-12" data-goto="cloud">مدیریت سرویس ابری</button>
          </div>
          <div class="card">
            <div class="card-h"><h3><svg class="ic"><use href="#i-support"/></svg>پشتیبانی</h3></div>
            <div class="health-row"><span class="dot ${c.open_tickets ? "bad" : ""}"></span>پیام‌های بی‌پاسخ<b>${num(c.open_tickets)}</b></div>
            <button class="btn block mt-12" data-goto="support">مشاهده پیام‌ها</button>
          </div>
          <div class="card">
            <div class="card-h"><h3><svg class="ic"><use href="#i-download"/></svg>پشتیبان‌گیری</h3></div>
            <p class="hint">خروجی JSON از کاربران، طرح‌ها، کدها، اشتراک‌ها و فاکتورها.</p>
            <button class="btn block mt-12" id="backup-btn">دریافت پشتیبان</button>
          </div>
        </div>
      </div>`;
    $$("[data-goto]", body).forEach((b) => b.addEventListener("click", () => {
      activeTab = b.dataset.goto;
      $$("#admin-tabs .tab", el).forEach((t) => t.classList.toggle("active", t.dataset.tab === activeTab));
      paint();
    }));
    $("#backup-btn", body).onclick = () => downloadAuth(API.admin.backupUrl(), "faktorkhan-backup.json");
    try {
      const health = await API.admin.health();
      $("#admin-health", body).innerHTML = `
        <div class="health-row"><span class="dot ${health.database.ok ? "" : "bad"}"></span>پایگاه داده
          <b>${health.database.ok ? esc(health.database.engine) : "خطا"}</b></div>
        <div class="health-row"><span class="dot ${health.cloud.token_set ? "" : "bad"}"></span>توکن ابری
          <b>${health.cloud.token_set ? "ثبت‌شده" : "ثبت‌نشده"}</b></div>
        <div class="health-row"><span class="dot"></span>نسخه<b dir="ltr">v${esc(health.version)}</b></div>
        <div class="health-row"><span class="dot"></span>قابلیت‌های فعال<b>${num(health.features)}</b></div>`;
    } catch { $("#admin-health", body).innerHTML = `<p class="hint">اطلاعات سلامت در دسترس نیست.</p>`; }
  }

  /* ══════════════ کاربران ══════════════ */
  async function usersTab(body) {
    body.innerHTML = `<div class="toolbar">
        <div class="search-input grow"><svg class="ic"><use href="#i-search"/></svg>
          <input id="u-search" placeholder="جست‌وجوی کاربر با نام، ایمیل یا موبایل…"></div>
        <div class="seg" id="u-status">
          <button class="active" data-s="">همه</button><button data-s="active">فعال</button><button data-s="inactive">غیرفعال</button>
        </div>
      </div><div id="u-list">${skeleton(4)}</div>`;
    let params = { page: 1, per_page: 20 };
    const load = async () => {
      const box = $("#u-list", body);
      box.innerHTML = skeleton(4);
      let data;
      try { data = await API.admin.users(params); }
      catch (err) { box.innerHTML = emptyState("خطا", err.message); return; }
      box.innerHTML = `<div class="table-wrap"><table>
        <thead><tr><th>کاربر</th><th>نقش</th><th>اشتراک</th><th class="num">فاکتور</th><th>آخرین ورود</th><th>وضعیت</th><th></th></tr></thead>
        <tbody>${data.items.map((u) => `<tr>
          <td><div class="cell-main"><span class="thumb" style="background:rgba(212,175,55,.14);color:var(--gold)">${esc(u.initials)}</span>
            <div><strong>${esc(u.full_name || "—")}</strong>
              <div style="font-size:10.5px;color:var(--text-3)" dir="ltr">${esc(u.email)}</div></div></div></td>
          <td><span class="tag">${u.role === "owner" ? "مالک" : u.role === "admin" ? "مدیر" : "کاربر"}</span></td>
          <td>${u.subscription ? `<strong style="font-size:11.5px">${esc(u.subscription.plan_name)}</strong>
            <div>${badge(u.subscription.status)}</div>` : "—"}</td>
          <td class="num">${num(u.invoice_count)}</td>
          <td class="num">${esc(u.last_login_at || "—")}</td>
          <td>${u.is_active ? `<span class="status active">فعال</span>` : `<span class="status expired">غیرفعال</span>`}</td>
          <td><div class="row-actions">
            <button class="ghost-icon" data-edit="${u.id}" title="مدیریت"><svg class="ic"><use href="#i-edit"/></svg></button>
            <button class="ghost-icon" data-reset="${u.id}" title="بازنشانی رمز"><svg class="ic"><use href="#i-key"/></svg></button>
          </div></td></tr>`).join("")}</tbody></table></div>
        <div class="pager"><span>${num(data.total)} کاربر</span><div class="pager-btns">
          <button data-page="${data.page - 1}" ${data.page <= 1 ? "disabled" : ""}>قبلی</button>
          <button data-page="${data.page + 1}" ${data.page >= data.pages ? "disabled" : ""}>بعدی</button>
        </div></div>`;

      const users = Object.fromEntries(data.items.map((u) => [u.id, u]));
      $$("[data-edit]", box).forEach((b) => b.addEventListener("click", () => editUser(users[b.dataset.edit], load)));
      $$("[data-reset]", box).forEach((b) => b.addEventListener("click", async () => {
        const ok = await confirmDialog({ title: "بازنشانی گذرواژه", message: "یک گذرواژه موقت ساخته می‌شود. ادامه؟", confirmText: "بساز" });
        if (!ok) return;
        try {
          const res = await API.admin.resetPassword(Number(b.dataset.reset));
          modal({
            title: "گذرواژه موقت",
            body: `<p class="hint mb-12">این گذرواژه فقط یک‌بار نمایش داده می‌شود؛ آن را به کاربر اعلام کنید.</p>
              <div class="copy-box"><span>${esc(res.temporary_password)}</span></div>`,
            footer: `<button class="btn primary" id="copy-temp">کپی</button>`,
            onMount: (wrap) => { wrap.querySelector("#copy-temp").onclick = () => copy(res.temporary_password, "گذرواژه کپی شد"); },
          });
        } catch (err) { toast(err.message, { type: "error" }); }
      }));
      $$("[data-page]", box).forEach((b) => b.addEventListener("click", () => {
        if (b.disabled) return;
        params.page = Number(b.dataset.page);
        load();
      }));
    };
    const search = $("#u-search", body);
    search.addEventListener("input", debounce(() => { params.q = search.value; params.page = 1; load(); }, 400));
    $$("#u-status button", body).forEach((b) => b.addEventListener("click", () => {
      $$("#u-status button", body).forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      params.status = b.dataset.s; params.page = 1; load();
    }));
    load();
  }

  async function editUser(user, reload) {
    if (!user) return;
    let plans = cache.plans;
    if (!plans.length) { try { plans = (await API.admin.plans()).items; cache.plans = plans; } catch { plans = []; } }
    modal({
      title: `مدیریت ${user.full_name || user.email}`,
      body: `<div class="detail-grid mb-12">
          <div class="detail-item"><span>ایمیل</span><strong dir="ltr" style="font-size:11.5px">${esc(user.email)}</strong></div>
          <div class="detail-item"><span>نقش</span><strong>${esc(user.role)}</strong></div>
          <div class="detail-item"><span>آخرین ورود</span><strong>${esc(user.last_login_at || "—")}</strong></div>
          <div class="detail-item"><span>آی‌پی</span><strong dir="ltr">${esc(user.last_ip || "—")}</strong></div>
        </div>
        <label class="switch mb-12"><input type="checkbox" id="au-active" ${user.is_active ? "checked" : ""}><i></i>حساب فعال باشد</label>
        <div class="grid-2">
          <label class="field"><span>نقش</span><select id="au-role">
            <option value="user" ${user.role === "user" ? "selected" : ""}>کاربر</option>
            <option value="admin" ${user.role === "admin" ? "selected" : ""}>مدیر</option>
            ${user.role === "owner" ? `<option value="owner" selected>مالک</option>` : ""}
          </select></label>
          <label class="field"><span>تخصیص طرح</span><select id="au-plan">
            <option value="">بدون تغییر</option>
            ${plans.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}
          </select></label>
          <label class="field"><span>تمدید (روز)</span><input id="au-days" value="0" dir="ltr"></label>
          <label class="field"><span>تغییر سهمیه صفحات</span><input id="au-pages" value="0" dir="ltr"></label>
        </div>
        <label class="field"><span>یادداشت مدیر</span><input id="au-notes" value="${esc((user.subscription && user.subscription.notes) || "")}"></label>`,
      footer: `<button class="btn ghost" data-close>انصراف</button>
               <button class="btn primary" id="au-save">ذخیره</button>`,
      onMount: (wrap, close) => {
        wrap.querySelector("#au-save").onclick = async (e) => {
          const payload = {
            is_active: wrap.querySelector("#au-active").checked,
            role: wrap.querySelector("#au-role").value,
          };
          const planId = wrap.querySelector("#au-plan").value;
          if (planId) payload.plan_id = Number(planId);
          const days = Number(wrap.querySelector("#au-days").value || 0);
          if (days) payload.extend_days = days;
          const pages = Number(wrap.querySelector("#au-pages").value || 0);
          if (pages) payload.pages_delta = pages;
          payload.notes = wrap.querySelector("#au-notes").value;
          UI.setBusy(e.currentTarget, true);
          try {
            await API.admin.updateUser(user.id, payload);
            UI.setBusy(e.currentTarget, false);
            close();
            toast("کاربر به‌روزرسانی شد");
            reload();
          } catch (err) { UI.setBusy(e.currentTarget, false); toast(err.message, { type: "error" }); }
        };
      },
    });
  }

  /* ══════════════ طرح‌ها ══════════════ */
  async function plansTab(body) {
    body.innerHTML = skeleton(3);
    let data;
    try { data = await API.admin.plans(); cache.plans = data.items; }
    catch (err) { body.innerHTML = emptyState("خطا", err.message); return; }
    body.innerHTML = `
      <div class="section-title"><div><h3>طرح‌های اشتراک</h3><p>قیمت، مدت، سهمیه و پشتیبانی هر طرح</p></div>
        <button class="btn primary" id="p-new"><svg class="ic"><use href="#i-plus"/></svg>طرح جدید</button></div>
      <div class="plan-grid">${data.items.map((p) => `<div class="plan ${p.is_featured ? "featured" : ""}">
        <h4>${esc(p.name)} ${p.is_active ? "" : `<span class="status expired">غیرفعال</span>`}</h4>
        <div class="p-tag">${esc(p.tagline || "")}</div>
        <div class="p-price">${num(p.price)} <small>ریال</small></div>
        <div class="hint">${num(p.duration_days)} روز • ${num(p.page_quota)} صفحه • ${num(p.max_devices)} دستگاه<br>
          ${num(p.keys_unused)} کد آماده • کد: <span class="mono">${esc(p.code)}</span></div>
        <div class="flex gap-8 mt-12">
          <button class="btn sm" data-edit-plan="${p.id}">ویرایش</button>
          <button class="btn sm danger" data-del-plan="${p.id}">حذف</button>
        </div></div>`).join("")}</div>`;
    $("#p-new", body).onclick = () => planForm(null, () => plansTab(body));
    $$("[data-edit-plan]", body).forEach((b) => b.addEventListener("click", () => {
      planForm(data.items.find((p) => p.id === Number(b.dataset.editPlan)), () => plansTab(body));
    }));
    $$("[data-del-plan]", body).forEach((b) => b.addEventListener("click", async () => {
      const ok = await confirmDialog({ title: "حذف طرح", message: "این طرح حذف شود؟", danger: true, confirmText: "حذف" });
      if (!ok) return;
      try { await API.admin.deletePlan(Number(b.dataset.delPlan)); toast("طرح حذف شد"); plansTab(body); }
      catch (err) { toast(err.message, { type: "error" }); }
    }));
  }

  function planForm(plan, done) {
    const p = plan || { code: "", name: "", tagline: "", price: 0, duration_days: 365, support_days: 365,
      page_quota: 5000, max_devices: 1, features: [], is_active: true, is_featured: false, sort_order: 9 };
    modal({
      title: plan ? `ویرایش ${plan.name}` : "طرح جدید",
      body: `<div class="grid-2">
          <label class="field"><span>کد یکتا</span><input id="f-code" dir="ltr" value="${esc(p.code)}"></label>
          <label class="field"><span>نام طرح</span><input id="f-name" value="${esc(p.name)}"></label>
        </div>
        <label class="field"><span>شعار</span><input id="f-tagline" value="${esc(p.tagline || "")}"></label>
        <div class="grid-3">
          <label class="field"><span>قیمت (ریال)</span><input id="f-price" dir="ltr" value="${p.price}"></label>
          <label class="field"><span>مدت (روز)</span><input id="f-duration" dir="ltr" value="${p.duration_days}"></label>
          <label class="field"><span>پشتیبانی (روز)</span><input id="f-support" dir="ltr" value="${p.support_days}"></label>
          <label class="field"><span>سهمیه صفحات</span><input id="f-pages" dir="ltr" value="${p.page_quota}"></label>
          <label class="field"><span>تعداد دستگاه</span><input id="f-devices" dir="ltr" value="${p.max_devices}"></label>
          <label class="field"><span>ترتیب نمایش</span><input id="f-sort" dir="ltr" value="${p.sort_order}"></label>
        </div>
        <label class="field"><span>ویژگی‌ها (هر خط یک مورد)</span>
          <textarea id="f-features" rows="4">${esc((p.features || []).join("\n"))}</textarea></label>
        <div class="flex gap-8">
          <label class="switch"><input type="checkbox" id="f-active" ${p.is_active ? "checked" : ""}><i></i>فعال</label>
          <label class="switch"><input type="checkbox" id="f-featured" ${p.is_featured ? "checked" : ""}><i></i>طرح پیشنهادی</label>
        </div>`,
      footer: `<button class="btn ghost" data-close>انصراف</button><button class="btn primary" id="f-save">ذخیره</button>`,
      onMount: (wrap, close) => {
        wrap.querySelector("#f-save").onclick = async (e) => {
          const payload = {
            code: wrap.querySelector("#f-code").value.trim(),
            name: wrap.querySelector("#f-name").value.trim(),
            tagline: wrap.querySelector("#f-tagline").value.trim(),
            price: Number(wrap.querySelector("#f-price").value || 0),
            duration_days: Number(wrap.querySelector("#f-duration").value || 30),
            support_days: Number(wrap.querySelector("#f-support").value || 30),
            page_quota: Number(wrap.querySelector("#f-pages").value || 0),
            max_devices: Number(wrap.querySelector("#f-devices").value || 1),
            sort_order: Number(wrap.querySelector("#f-sort").value || 9),
            features: wrap.querySelector("#f-features").value.split("\n").map((s) => s.trim()).filter(Boolean),
            is_active: wrap.querySelector("#f-active").checked,
            is_featured: wrap.querySelector("#f-featured").checked,
          };
          if (!payload.code || !payload.name) return toast("کد و نام طرح الزامی است", { type: "warn" });
          UI.setBusy(e.currentTarget, true);
          try {
            if (plan) await API.admin.updatePlan(plan.id, payload);
            else await API.admin.createPlan(payload);
            UI.setBusy(e.currentTarget, false);
            close(); toast("طرح ذخیره شد"); cache.plans = []; done();
          } catch (err) { UI.setBusy(e.currentTarget, false); toast(err.message, { type: "error" }); }
        };
      },
    });
  }

  /* ══════════════ کدهای اشتراک ══════════════ */
  async function keysTab(body) {
    body.innerHTML = skeleton(3);
    let plans, keys;
    try {
      plans = cache.plans.length ? cache.plans : (await API.admin.plans()).items;
      cache.plans = plans;
      keys = await API.admin.keys({ per_page: 30 });
    } catch (err) { body.innerHTML = emptyState("خطا", err.message); return; }

    body.innerHTML = `
      <div class="dash-grid">
        <div class="dash-col">
          <div class="card">
            <div class="card-h"><h3><svg class="ic"><use href="#i-key"/></svg>ساخت کد اشتراک</h3></div>
            <div class="grid-2">
              <label class="field"><span>طرح</span><select id="k-plan">
                ${plans.filter((p) => p.is_active).map((p) => `<option value="${p.id}">${esc(p.name)} — ${num(p.duration_days)} روز</option>`).join("")}
              </select></label>
              <label class="field"><span>تعداد</span><input id="k-count" value="10" dir="ltr"></label>
            </div>
            <label class="field"><span>یادداشت (نام مشتری، سفارش…)</span><input id="k-note" placeholder="مثلاً خرید شرکت پارس"></label>
            <button class="btn primary block" id="k-generate"><svg class="ic"><use href="#i-plus"/></svg>ساخت کدها</button>
            <p class="hint">کدها یک‌بارمصرف‌اند و فقط یک‌بار نمایش داده می‌شوند.</p>
            <div id="k-output"></div>
          </div>
        </div>
        <div class="dash-col">
          <div class="card">
            <div class="card-h"><h3><svg class="ic"><use href="#i-info"/></svg>راهنمای توزیع</h3></div>
            <div class="steps">
              <div class="step done"><span class="s-dot">۱</span>طرح یک‌ساله را انتخاب کنید</div>
              <div class="step done"><span class="s-dot">۲</span>تعداد کد لازم را بسازید و ذخیره کنید</div>
              <div class="step done"><span class="s-dot">۳</span>هر کد را به یک مشتری بدهید</div>
              <div class="step done"><span class="s-dot">۴</span>مشتری کد را در «اشتراک من» فعال می‌کند</div>
            </div>
            <p class="hint mt-12">با ابطال کد استفاده‌نشده، آن کد دیگر قابل فعال‌سازی نیست.</p>
          </div>
        </div>
      </div>
      <div class="card mt-12">
        <div class="card-h"><h3><svg class="ic"><use href="#i-layers"/></svg>کدهای ساخته‌شده</h3>
          <span class="tag">${num(keys.total)} کد</span></div>
        <div class="table-wrap"><table>
          <thead><tr><th>کد</th><th>طرح</th><th>وضعیت</th><th>یادداشت</th><th>تاریخ ساخت</th><th>مصرف</th><th></th></tr></thead>
          <tbody>${keys.items.map((k) => `<tr>
            <td><span class="mono">${esc(k.key)}</span></td><td>${esc(k.plan_name)}</td>
            <td>${badge(k.status)}</td><td>${esc(k.note || "—")}</td>
            <td class="num">${esc(k.created_at)}</td><td class="num">${esc(k.redeemed_at || "—")}</td>
            <td><div class="row-actions">
              <button class="ghost-icon" data-copy="${esc(k.key)}" title="کپی"><svg class="ic"><use href="#i-edit"/></svg></button>
              ${k.status === "unused" ? `<button class="ghost-icon" data-revoke="${k.id}" title="ابطال"><svg class="ic"><use href="#i-close"/></svg></button>` : ""}
              <button class="ghost-icon" data-delkey="${k.id}" title="حذف"><svg class="ic"><use href="#i-trash"/></svg></button>
            </div></td></tr>`).join("")}</tbody></table></div>
      </div>`;

    $("#k-generate", body).onclick = async (e) => {
      const planId = Number($("#k-plan", body).value);
      if (!planId) return toast("ابتدا یک طرح بسازید", { type: "warn" });
      UI.setBusy(e.currentTarget, true, "ساخت کدها…");
      try {
        const res = await API.admin.createKeys({
          plan_id: planId,
          count: Number($("#k-count", body).value || 1),
          note: $("#k-note", body).value.trim(),
        });
        UI.setBusy(e.currentTarget, false);
        $("#k-output", body).innerHTML = `
          <div class="warn-item mt-12"><svg class="ic"><use href="#i-info"/></svg><span>${esc(res.file_hint)}</span></div>
          <div class="keys-out">${res.keys.map((k) => `<div class="copy-box"><span>${esc(k)}</span>
            <button class="ghost-icon" data-copy="${esc(k)}" style="width:26px;height:26px"><svg class="ic" style="width:13px;height:13px"><use href="#i-edit"/></svg></button></div>`).join("")}</div>
          <button class="btn sm mt-12" id="copy-all">کپی همه کدها</button>`;
        bindCopy(body);
        $("#copy-all", body).onclick = () => copy(res.keys.join("\n"), "همه کدها کپی شد");
        toast(`${num(res.created)} کد ساخته شد`);
      } catch (err) { UI.setBusy(e.currentTarget, false); toast(err.message, { type: "error" }); }
    };

    bindCopy(body);
    $$("[data-revoke]", body).forEach((b) => b.addEventListener("click", async () => {
      const ok = await confirmDialog({ title: "ابطال کد", message: "این کد دیگر قابل استفاده نخواهد بود. ادامه؟", danger: true, confirmText: "ابطال" });
      if (!ok) return;
      try { await API.admin.revokeKey(Number(b.dataset.revoke)); toast("کد ابطال شد"); keysTab(body); }
      catch (err) { toast(err.message, { type: "error" }); }
    }));
    $$("[data-delkey]", body).forEach((b) => b.addEventListener("click", async () => {
      const ok = await confirmDialog({ title: "حذف کد", message: "کد حذف شود؟", danger: true, confirmText: "حذف" });
      if (!ok) return;
      try { await API.admin.deleteKey(Number(b.dataset.delkey)); toast("کد حذف شد"); keysTab(body); }
      catch (err) { toast(err.message, { type: "error" }); }
    }));
  }

  function bindCopy(root) {
    $$("[data-copy]", root).forEach((b) => b.addEventListener("click", () => copy(b.dataset.copy, "کد کپی شد")));
  }

  /* ══════════════ سرویس ابری ══════════════ */
  async function cloudTab(body) {
    body.innerHTML = skeleton(3);
    let cloud;
    try { cloud = await API.admin.cloud(); }
    catch (err) { body.innerHTML = emptyState("خطا", err.message); return; }
    body.innerHTML = `
      <div class="settings-grid">
        <div class="card card-glow">
          <div class="card-h"><h3><svg class="ic"><use href="#i-cloud"/></svg>توکن سرویس ابری</h3>
            ${cloud.token_set ? badge("active") : badge("expired")}</div>
          <div class="health-row"><span class="dot ${cloud.gateway_ready ? "" : "bad"}"></span>درگاه سمت سرور
            <b>${cloud.gateway_ready ? "پیکربندی‌شده" : "تنظیم‌نشده"}</b></div>
          <div class="health-row"><span class="dot ${cloud.token_set ? "" : "bad"}"></span>توکن ذخیره‌شده
            <b>${cloud.token_set ? "بله" : "خیر"}</b></div>
          <div class="health-row"><span class="dot"></span>طول توکن<b>${num(cloud.token_length)}</b></div>
          <div class="health-row"><span class="dot"></span>اثر انگشت مخفی<b class="mono">${esc(cloud.token_hint || "—")}</b></div>
          <div class="warn-item mt-12"><svg class="ic"><use href="#i-lock"/></svg>
            <span>${esc(cloud.note)}</span></div>
          <label class="field mt-16"><span>جایگزینی توکن (فقط نوشتن)</span>
            <input id="c-token" dir="ltr" placeholder="توکن جدید را اینجا وارد کنید" autocomplete="off"></label>
          <div class="flex gap-8 wrap">
            <button class="btn primary" id="c-save"><svg class="ic"><use href="#i-check"/></svg>ذخیره توکن</button>
            <button class="btn" id="c-test"><svg class="ic"><use href="#i-cloud"/></svg>تست اتصال و اعتبار</button>
            ${cloud.token_set ? `<button class="btn danger" id="c-clear">حذف توکن</button>` : ""}
          </div>
          <p class="hint mt-12">پس از ذخیره، مقدار توکن قابل بازیابی نیست؛ تنها امکان جایگزینی وجود دارد.</p>
          ${cloud.gateway_ready ? "" : `<div class="warn-item mt-12"><svg class="ic"><use href="#i-info"/></svg>
            <span>آدرس درگاه در تنظیمات سرور معتبر نیست. با پشتیبانی تماس بگیرید.</span></div>`}
          ${cloud.token_set ? "" : `<div class="warn-item mt-12"><svg class="ic"><use href="#i-info"/></svg>
            <span>فقط توکن را در کادر بالا بچسبانید و «ذخیره توکن» را بزنید؛ نیازی به تنظیم آدرس درگاه نیست.</span></div>`}
        </div>
        <div class="dash-col">
          <div class="card">
            <div class="card-h"><h3><svg class="ic"><use href="#i-shield"/></svg>سیاست محرمانگی</h3></div>
            <div class="steps">
              <div class="step done"><span class="s-dot">✓</span>ذخیره رمزنگاری‌شده با کلید سرور</div>
              <div class="step done"><span class="s-dot">✓</span>عدم ارسال توکن به مرورگر</div>
              <div class="step done"><span class="s-dot">✓</span>عدم درج توکن در لاگ و خطاها</div>
              <div class="step done"><span class="s-dot">✓</span>پروکسی کامل درخواست‌ها سمت سرور</div>
              <div class="step done"><span class="s-dot">✓</span>حذف فایل از سرور ابری بعد از پردازش</div>
            </div>
          </div>
          <div class="card">
            <div class="card-h"><h3><svg class="ic"><use href="#i-chart"/></svg>اعتبار سرویس</h3></div>
            <div id="credit-box">${skeleton(2)}</div>
            <button class="btn block mt-12" id="c-credit">به‌روزرسانی اعتبار</button>
          </div>
        </div>
      </div>`;

    $("#c-save", body).onclick = async (e) => {
      const token = $("#c-token", body).value.trim();
      if (token.length < 8) return toast("توکن معتبر نیست", { type: "warn" });
      UI.setBusy(e.currentTarget, true);
      try {
        await API.admin.setCloudToken(token);
        UI.setBusy(e.currentTarget, false);
        $("#c-token", body).value = "";
        toast("توکن ذخیره شد و دیگر قابل مشاهده نیست");
        cloudTab(body);
      } catch (err) { UI.setBusy(e.currentTarget, false); toast(err.message, { type: "error" }); }
    };
    $("#c-test", body).onclick = async (e) => {
      UI.setBusy(e.currentTarget, true, "در حال تست…");
      try {
        const res = await API.admin.testCloud();
        UI.setBusy(e.currentTarget, false);
        if (res.ok) {
          toast(`${res.message} — اعتبار OCR: ${num(res.credit.ocr_credit)} صفحه`, { type: "success" });
          paintCredit(res.credit);
        } else {
          toast(res.message, { type: "error" });
        }
      } catch (err) { UI.setBusy(e.currentTarget, false); toast(err.message, { type: "error" }); }
    };
    const clearBtn = $("#c-clear", body);
    if (clearBtn) clearBtn.onclick = async () => {
      const ok = await confirmDialog({ title: "حذف توکن", message: "توکن ابری حذف شود؟ سرویس ابری غیرفعال می‌شود.", danger: true, confirmText: "حذف" });
      if (!ok) return;
      try { await API.admin.clearCloudToken(); toast("توکن حذف شد", { type: "warn" }); cloudTab(body); }
      catch (err) { toast(err.message, { type: "error" }); }
    };
    const paintCredit = (credit) => {
      if (!credit) return;
      $("#credit-box", body).innerHTML = `
        <div class="health-row"><span class="dot"></span>اعتبار OCR<b>${num(credit.ocr_credit)} صفحه</b></div>
        <div class="health-row"><span class="dot"></span>اعتبار صوت<b>${num(credit.audio_credit)} ثانیه</b></div>`;
    };
    $("#c-credit", body).onclick = async () => {
      try {
        const res = await API.ocrCredit();
        if (res.ok) paintCredit(res); else $("#credit-box", body).innerHTML = `<p class="hint">${esc(res.message)}</p>`;
      } catch (err) { toast(err.message, { type: "error" }); }
    };
  }

  /* ══════════════ پیام‌های پشتیبانی ══════════════ */
  async function supportTab(body) {
    body.innerHTML = skeleton(3);
    let data;
    try { data = await API.admin.support({}); }
    catch (err) { body.innerHTML = emptyState("خطا", err.message); return; }
    body.innerHTML = `<div class="card">
      <div class="card-h"><h3><svg class="ic"><use href="#i-support"/></svg>پیام‌های کاربران</h3>
        <span class="tag">${num(data.items.length)} پیام</span></div>
      ${data.items.length ? data.items.map((t) => `<div class="card tight mb-12" style="background:var(--panel-2)">
        <div class="flex justify-between items-center wrap gap-8">
          <strong style="font-size:13px">${esc(t.subject)}</strong>${badge(t.status)}</div>
        <div class="hint">${esc(t.name)} • ${esc(t.contact || "—")} • ${esc(t.created_at)}</div>
        <p style="font-size:12.5px;color:var(--text-2);margin-top:8px;line-height:2">${esc(t.message)}</p>
        ${t.answer ? `<div class="quote mt-8"><strong>پاسخ:</strong> ${esc(t.answer)}</div>` : ""}
        ${t.status !== "answered" ? `<button class="btn sm primary mt-8" data-answer="${t.id}">پاسخ دادن</button>` : ""}
      </div>`).join("") : emptyState("پیامی نیست", "پیام‌های کاربران اینجا نمایش داده می‌شود", "i-support")}
    </div>`;
    $$("[data-answer]", body).forEach((b) => b.addEventListener("click", () => {
      const ticket = data.items.find((t) => t.id === Number(b.dataset.answer));
      modal({
        title: "پاسخ به پیام",
        body: `<p class="quote mb-12">${esc(ticket.message)}</p>
          <label class="field"><span>پاسخ شما</span><textarea id="ans" rows="5"></textarea></label>`,
        footer: `<button class="btn ghost" data-close>انصراف</button><button class="btn primary" id="ans-save">ثبت پاسخ</button>`,
        onMount: (wrap, close) => {
          wrap.querySelector("#ans-save").onclick = async (e) => {
            const answer = wrap.querySelector("#ans").value.trim();
            if (answer.length < 3) return toast("پاسخ را بنویسید", { type: "warn" });
            UI.setBusy(e.currentTarget, true);
            try {
              await API.admin.answerTicket(ticket.id, answer);
              UI.setBusy(e.currentTarget, false);
              close(); toast("پاسخ ثبت شد"); supportTab(body);
            } catch (err) { UI.setBusy(e.currentTarget, false); toast(err.message, { type: "error" }); }
          };
        },
      });
    }));
  }

  /* ══════════════ گزارش رویداد ══════════════ */
  async function auditTab(body) {
    body.innerHTML = `<div class="toolbar">
        <div class="search-input grow"><svg class="ic"><use href="#i-search"/></svg>
          <input id="a-search" placeholder="جست‌وجو در کاربر، رویداد یا جزئیات…"></div></div>
      <div id="a-list">${skeleton(4)}</div>`;
    let params = { page: 1, per_page: 30 };
    const load = async () => {
      const box = $("#a-list", body);
      box.innerHTML = skeleton(4);
      let data;
      try { data = await API.admin.audit(params); }
      catch (err) { box.innerHTML = emptyState("خطا", err.message); return; }
      box.innerHTML = `<div class="card tight" style="padding:0;overflow:hidden"><div class="table-wrap" style="border:none">
        <table><thead><tr><th>کاربر</th><th>رویداد</th><th>موجودیت</th><th>جزئیات</th><th>آی‌پی</th><th>زمان</th></tr></thead>
        <tbody>${data.items.map((r) => `<tr><td><strong>${esc(r.actor)}</strong></td>
          <td><span class="tag">${esc(r.action)}</span></td><td>${esc(r.entity || "—")}</td>
          <td style="font-size:11.5px">${esc(r.detail || "—")}</td>
          <td class="mono">${esc(r.ip || "—")}</td><td class="num">${esc(r.at)}</td></tr>`).join("")}</tbody></table></div>
        <div class="pager" style="padding:12px 14px"><span>${num(data.total)} رویداد ثبت‌شده</span>
          <div class="pager-btns">
            <button data-page="${data.page - 1}" ${data.page <= 1 ? "disabled" : ""}>قبلی</button>
            <button data-page="${data.page + 1}" ${data.page >= data.pages ? "disabled" : ""}>بعدی</button>
          </div></div></div>`;
      $$("[data-page]", box).forEach((b) => b.addEventListener("click", () => {
        if (b.disabled) return;
        params.page = Number(b.dataset.page); load();
      }));
    };
    const search = $("#a-search", body);
    search.addEventListener("input", debounce(() => { params.q = search.value; params.page = 1; load(); }, 400));
    load();
  }

  /* ══════════════ تنظیمات ══════════════ */
  async function settingsTab(body) {
    body.innerHTML = skeleton(3);
    let data;
    try { data = await API.admin.settings(); }
    catch (err) { body.innerHTML = emptyState("خطا", err.message); return; }
    const s = data.settings || {};
    body.innerHTML = `
      <div class="settings-grid">
        <div class="card">
          <div class="card-h"><h3><svg class="ic"><use href="#i-settings"/></svg>تنظیمات عمومی</h3></div>
          <div class="switch-row"><span>ثبت‌نام کاربران جدید باز باشد</span>
            <label class="switch"><input type="checkbox" id="s-register" ${s.registration_open === "1" ? "checked" : ""}><i></i></label></div>
          <div class="switch-row"><span>الزام اشتراک معتبر برای کار</span>
            <label class="switch"><input type="checkbox" id="s-license" ${s.license_required === "1" ? "checked" : ""}><i></i></label></div>
          <div class="grid-2 mt-12">
            <label class="field"><span>روزهای دوره آزمایشی</span><input id="s-trial-days" dir="ltr" value="${esc(s.trial_days || "14")}"></label>
            <label class="field"><span>سهمیه دوره آزمایشی</span><input id="s-trial-pages" dir="ltr" value="${esc(s.trial_pages || "50")}"></label>
          </div>
          <label class="field"><span>پیام اطلاعیه بالای صفحه</span>
            <input id="s-announce" value="${esc(s.announcement || "")}" placeholder="مثلاً: بروزرسانی نسخه ۱٫۱ تا پایان هفته"></label>
          <button class="btn primary" id="s-save"><svg class="ic"><use href="#i-check"/></svg>ذخیره تنظیمات</button>
        </div>
        <div class="card">
          <div class="card-h"><h3><svg class="ic"><use href="#i-support"/></svg>اطلاعات پشتیبانی نمایشی</h3></div>
          <label class="field"><span>تلفن پشتیبانی</span><input id="s-phone" dir="ltr" value="${esc(s.support_phone || "")}" placeholder="۰۹۱۲…"></label>
          <label class="field"><span>ایمیل پشتیبانی</span><input id="s-email" dir="ltr" value="${esc(s.support_email || "")}"></label>
          <label class="field"><span>تلگرام / پیام‌رسان</span><input id="s-telegram" dir="ltr" value="${esc(s.support_telegram || "")}"></label>
          <p class="hint">این اطلاعات در صفحه پشتیبانی به کاربران نمایش داده می‌شود.</p>
          <div class="warn-item mt-12"><svg class="ic"><use href="#i-lock"/></svg>
            <span>آدرس درگاه ابری فقط از متغیر محیطی سرور خوانده می‌شود و در این پنل قابل مشاهده یا تغییر نیست.</span></div>
        </div>
      </div>`;
    $("#s-save", body).onclick = async (e) => {
      UI.setBusy(e.currentTarget, true);
      try {
        await API.admin.saveSettings({
          registration_open: $("#s-register", body).checked,
          license_required: $("#s-license", body).checked,
          trial_days: Number($("#s-trial-days", body).value || 14),
          trial_pages: Number($("#s-trial-pages", body).value || 50),
          announcement: $("#s-announce", body).value.trim(),
          support_phone: $("#s-phone", body).value.trim(),
          support_email: $("#s-email", body).value.trim(),
          support_telegram: $("#s-telegram", body).value.trim(),
        });
        UI.setBusy(e.currentTarget, false);
        toast("تنظیمات ذخیره شد");
      } catch (err) { UI.setBusy(e.currentTarget, false); toast(err.message, { type: "error" }); }
    };
  }

  return { render };
})();


/* ══════════════════════════════════════════════════════════════
   هسته برنامه — مسیریابی، احراز هویت، پوسته
   ══════════════════════════════════════════════════════════════ */
const App = (() => {
  /* ذخیره‌سازی امن (مرورگر ممکن است localStorage را مسدود کند) */
  const ls = (() => {
    try {
      const probe = "__fk_probe__";
      window.localStorage.setItem(probe, "1");
      window.localStorage.removeItem(probe);
      return window.localStorage;
    } catch (err) {
      const mem = Object.create(null);
      return {
        getItem: (k) => (k in mem ? mem[k] : null),
        setItem: (k, v) => { mem[k] = String(v); },
        removeItem: (k) => { delete mem[k]; },
      };
    }
  })();
  const { $, $$, esc, num, toast, modal, badge } = UI;

  const ROUTES = {
    dashboard: { title: "داشبورد", subtitle: "نگاهی سریع به وضعیت فاکتورها", render: (el) => Views.dashboard(el) },
    scan: { title: "خوانش فاکتور", subtitle: "بارگذاری، خوانش هوشمند و بازبینی", render: (el) => Views.scan(el) },
    invoices: { title: "فاکتورها", subtitle: "بایگانی، جست‌وجو و مدیریت فاکتورها", render: (el) => Views.invoices.render(el) },
    reports: { title: "گزارش‌ها", subtitle: "تحلیل مبالغ، انواع و فروشندگان", render: (el) => Views.reports(el) },
    subscription: { title: "اشتراک من", subtitle: "وضعیت اشتراک، سهمیه و کد فعال‌سازی", render: (el) => Views.subscription(el) },
    features: { title: "قابلیت‌ها", subtitle: "فهرست کامل امکانات این نسخه", render: (el) => Views.features(el) },
    support: { title: "پشتیبانی", subtitle: "ارتباط مستقیم با پدیدآورنده", render: (el) => Views.support(el) },
    settings: { title: "تنظیمات", subtitle: "حساب، امنیت و ظاهر برنامه", render: (el) => Views.settings(el) },
    admin: { title: "پنل مدیریت", subtitle: "کاربران، طرح‌ها، کدها و تنظیمات سامانه", render: (el) => Admin.render(el), admin: true },
  };

  const COMMANDS = [
    { label: "داشبورد", route: "dashboard", icon: "i-dashboard", hint: "G D" },
    { label: "خوانش فاکتور جدید", route: "scan", icon: "i-scan", hint: "G S" },
    { label: "فهرست فاکتورها", route: "invoices", icon: "i-invoice", hint: "G I" },
    { label: "گزارش‌ها", route: "reports", icon: "i-chart", hint: "G R" },
    { label: "اشتراک من", route: "subscription", icon: "i-key" },
    { label: "قابلیت‌های برنامه", route: "features", icon: "i-sparkles" },
    { label: "پشتیبانی و معرفی پدیدآورنده", route: "support", icon: "i-support" },
    { label: "تنظیمات", route: "settings", icon: "i-settings" },
    { label: "پنل مدیریت", route: "admin", icon: "i-shield", admin: true },
    { label: "تغییر قالب تیره / روشن", action: "theme", icon: "i-moon" },
    { label: "خروجی اکسل همه فاکتورها", action: "export", icon: "i-download" },
    { label: "خروج از حساب", action: "logout", icon: "i-logout" },
  ];

  let booted = false;

  /* ---------- قالب ---------- */
  function setTheme(theme) {
    const value = theme === "light" ? "light" : "dark";
    document.documentElement.dataset.theme = value;
    ls.setItem("fk_theme", value);
    const btn = $("#theme-toggle");
    if (btn) {
      btn.querySelector("span").textContent = value === "dark" ? "قالب تیره" : "قالب روشن";
      btn.querySelector("use").setAttribute("href", value === "dark" ? "#i-moon" : "#i-sun");
    }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = value === "dark" ? "#080d1a" : "#f4f6fb";
  }

  /* ---------- پوسته ---------- */
  function paintShell() {
    const user = State.user || {};
    const sub = State.sub || {};
    $("#avatar-initials").textContent = user.initials || "؟";
    $("#menu-name").textContent = user.full_name || "کاربر";
    $("#menu-email").textContent = user.email || "";
    $$(".admin-only").forEach((n) => n.classList.toggle("hidden", !user.is_admin));

    const box = $("#side-sub");
    if (!sub.id && !sub.plan_name) { box.innerHTML = ""; return; }
    box.innerHTML = `
      <div class="ss-top"><span>اشتراک شما</span>${badge(sub.status || "expired")}</div>
      <div class="ss-plan">${esc(sub.plan_name || "بدون طرح")}</div>
      <div class="progress"><i style="width:${sub.usage_percent || 0}%"></i></div>
      <div class="ss-meta"><span>${UI.numShort(sub.pages_left || 0)} صفحه</span><span>${num(sub.days_left || 0)} روز</span></div>`;
    $("#side-sub").onclick = () => { location.hash = "#/subscription"; };
    $("#side-sub").style.cursor = "pointer";
  }

  async function paintCredit() {
    const pill = $("#credit-pill");
    try {
      if (!State.caps) State.caps = await API.ocrCapabilities();
      if (!State.caps.cloud.configured) {
        pill.innerHTML = `<svg class="ic"><use href="#i-cpu"/></svg><span>موتور لوکال</span>`;
        pill.title = "سرویس ابری فعال نیست؛ توکن را در پنل مدیریت → سرویس ابری ثبت کنید";
        return;
      }
      const res = await API.ocrCredit();
      pill.innerHTML = `<svg class="ic"><use href="#i-cloud"/></svg>
        <span>${res.ok ? `${num(res.ocr_credit)} صفحه` : "ابر"}</span>`;
      pill.title = res.ok ? `اعتبار سرویس ابری — صوت: ${num(res.audio_credit)} ثانیه` : (res.message || "");
    } catch {
      pill.innerHTML = `<svg class="ic"><use href="#i-cloud"/></svg><span>ابر</span>`;
    }
  }

  async function paintAnnouncement() {
    const text = (State.meta && State.meta.announcement) || "";
    const bar = $("#announcement-bar");
    if (!text || ls.getItem("fk_announce_hidden") === text) { bar.classList.add("hidden"); return; }
    $("#announcement-text").textContent = text;
    bar.classList.remove("hidden");
    $("#announcement-close").onclick = () => {
      ls.setItem("fk_announce_hidden", text);
      bar.classList.add("hidden");
    };
  }

  /* ---------- مسیریابی ---------- */
  function currentRoute() {
    const hash = location.hash.replace(/^#\/?/, "") || "dashboard";
    const [name, param] = hash.split("/");
    return { name: name || "dashboard", param };
  }

  async function router() {
    if (!State.user) return;
    const { name, param } = currentRoute();
    const view = $("#view");
    State.clearTimers();

    if (name === "invoices" && param) {
      $("#page-title").textContent = "جزئیات فاکتور";
      $("#page-subtitle").textContent = "مشاهده، ویرایش و چاپ";
      $$(".nav-item").forEach((n) => n.classList.toggle("active", n.dataset.route === "invoices"));
      await Views.invoiceDetail(view, Number(param));
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    const route = ROUTES[name] || ROUTES.dashboard;
    if (route.admin && !(State.user && State.user.is_admin)) {
      toast("دسترسی به پنل مدیریت مجاز نیست", { type: "error" });
      location.hash = "#/dashboard";
      return;
    }
    $("#page-title").textContent = route.title;
    $("#page-subtitle").textContent = route.subtitle;
    $$(".nav-item").forEach((n) => n.classList.toggle("active", n.dataset.route === name));
    document.title = `${route.title} | فاکتورخوان`;
    try {
      await route.render(view);
    } catch (err) {
      view.innerHTML = UI.emptyState("خطا در نمایش صفحه", err.message, "i-info");
    }
    $("#sidebar").classList.remove("open");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /* ---------- پالت فرمان ---------- */
  let cmdkIndex = 0;
  let cmdkItems = [];

  function openCmdk() {
    $("#cmdk").classList.remove("hidden");
    const input = $("#cmdk-input");
    input.value = "";
    input.focus();
    renderCmdk("");
  }
  function closeCmdk() { $("#cmdk").classList.add("hidden"); }

  function renderCmdk(query) {
    const q = query.trim().toLowerCase();
    cmdkItems = COMMANDS.filter((c) => (!c.admin || (State.user && State.user.is_admin))
      && (!q || c.label.toLowerCase().includes(q))).slice(0, 10);
    cmdkIndex = 0;
    $("#cmdk-list").innerHTML = cmdkItems.length
      ? cmdkItems.map((c, i) => `<div class="cmdk-item ${i === 0 ? "active" : ""}" data-i="${i}">
          <svg class="ic"><use href="#${c.icon}"/></svg>${esc(c.label)}
          ${c.hint ? `<span class="cmdk-hint">${esc(c.hint)}</span>` : ""}</div>`).join("")
      : `<div class="cmdk-item">نتیجه‌ای یافت نشد</div>`;
    $$("#cmdk-list .cmdk-item").forEach((node) => {
      node.addEventListener("click", () => run(cmdkItems[Number(node.dataset.i)]));
    });
  }

  function moveCmdk(delta) {
    if (!cmdkItems.length) return;
    cmdkIndex = (cmdkIndex + delta + cmdkItems.length) % cmdkItems.length;
    $$("#cmdk-list .cmdk-item").forEach((n, i) => n.classList.toggle("active", i === cmdkIndex));
    const active = $$("#cmdk-list .cmdk-item")[cmdkIndex];
    if (active) active.scrollIntoView({ block: "nearest" });
  }

  function run(command) {
    if (!command) return;
    closeCmdk();
    if (command.route) { location.hash = `#/${command.route}`; return; }
    if (command.action === "theme") setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
    if (command.action === "export") UI.downloadAuth(API.exportUrl("xlsx"), "invoices.xlsx");
    if (command.action === "logout") logout();
  }

  /* ---------- احراز هویت ---------- */
  function showAuth() {
    State.user = null;
    $("#app-shell").classList.add("hidden");
    $("#auth-screen").classList.remove("hidden");
    loadAuthPoints();
  }

  function showApp() {
    $("#auth-screen").classList.add("hidden");
    $("#app-shell").classList.remove("hidden");
  }

  async function loadAuthPoints() {
    const list = $("#auth-points");
    if (list.dataset.loaded) return;
    try {
      const meta = await API.meta();
      State.meta = meta;
      const points = [
        `خوانش فاکتورهای چاپی، حرارتی و دست‌نویس با ${num(meta.features_total)} قابلیت`,
        "دو موتور مستقل: سرویس ابری و پردازش لوکال بدون اینترنت",
        "اشتراک یک‌ساله با پشتیبانی مستقیم پدیدآورنده",
        "توکن سرویس ابری همیشه پنهان و رمزنگاری‌شده",
      ];
      list.innerHTML = points.map((p) => `<li><svg class="ic"><use href="#i-check"/></svg><span>${esc(p)}</span></li>`).join("");
      list.dataset.loaded = "1";
      $("#side-edition").textContent = `${meta.app.edition || "نسخه حرفه‌ای"} • v${meta.app.version}`;
      $("#nav-feature-count").textContent = num(meta.features_total);
    } catch {
      list.innerHTML = `<li><svg class="ic"><use href="#i-info"/></svg><span>اتصال به سرور برقرار نشد</span></li>`;
    }
  }

  function bindAuth() {
    $$("[data-auth-tab]").forEach((tab) => tab.addEventListener("click", () => {
      $$("[data-auth-tab]").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      $("#login-form").classList.toggle("hidden", tab.dataset.authTab !== "login");
      $("#register-form").classList.toggle("hidden", tab.dataset.authTab !== "register");
    }));
    $$("[data-toggle-password]").forEach((btn) => btn.addEventListener("click", () => {
      const input = btn.parentElement.querySelector("input");
      input.type = input.type === "password" ? "text" : "password";
      btn.textContent = input.type === "password" ? "نمایش" : "پنهان";
    }));

    $("#login-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const btn = form.querySelector("button[type=submit]");
      UI.setBusy(btn, true, "در حال ورود…");
      try {
        const emailEl = form.querySelector('[name="email"]');
        const passEl = form.querySelector('[name="password"]');
        const res = await API.login({
          email: (emailEl && emailEl.value ? emailEl.value : "").trim(),
          password: passEl && passEl.value ? passEl.value : "",
          device_id: API.deviceId(),
        });
        API.setToken(res.access_token);
        API.setCachedUser(res.user);
        State.user = res.user; State.sub = res.subscription;
        UI.setBusy(btn, false);
        await enterApp();
        const warn = API.storageWarning();
        if (warn) toast(warn, { type: "warn", title: "توجه" });
        else toast(`خوش آمدید ${res.user.full_name || ""}`, { type: "success" });
      } catch (err) {
        UI.setBusy(btn, false);
        toast(err.message, { type: "error" });
      }
    });

    $("#register-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const btn = form.querySelector("button[type=submit]");
      UI.setBusy(btn, true, "در حال ساخت حساب…");
      try {
        const val = (name) => {
          const el = form.querySelector(`[name="${name}"]`);
          return el && el.value ? el.value.trim() : "";
        };
        const res = await API.register({
          full_name: val("full_name"),
          company: val("company"),
          email: val("email"),
          phone: val("phone"),
          password: val("password"),
          license_key: val("license_key"),
        });
        API.setToken(res.access_token);
        API.setCachedUser(res.user);
        State.user = res.user; State.sub = res.subscription;
        UI.setBusy(btn, false);
        await enterApp();
        toast(res.first_user ? "حساب مالک سامانه ساخته شد" : "حساب شما ساخته شد", { type: "success" });
      } catch (err) {
        UI.setBusy(btn, false);
        toast(err.message, { type: "error" });
      }
    });

    $("#auth-about").addEventListener("click", async () => {
      try {
        const meta = State.meta || await API.meta();
        const owner = meta.owner || {};
        modal({
          title: "درباره پدیدآورنده",
          body: `<div class="owner-card">
              <div class="owner-avatar">${esc((owner.name || "س").slice(0, 1))}</div>
              <div><h3 style="font-size:20px">${esc(owner.name || "سعید سالاری")}</h3>
                <p style="font-size:12px;color:var(--text-3)">${(owner.title_parts || []).map(esc).join(" • ")}</p>
                <p class="quote mt-12">${esc(owner.bio || "")}</p>
                <div class="chips">${(owner.skills || []).map((s) => `<span class="chip">${esc(s)}</span>`).join("")}</div>
              </div></div>
            <div class="copyright mt-16" style="max-height:200px;overflow:auto">${esc(meta.copyright || "")}</div>`,
          wide: true,
          footer: `<button class="btn primary" data-close>بستن</button>`,
        });
      } catch (err) { toast(err.message, { type: "error" }); }
    });
  }

  async function enterApp() {
    showApp();
    if (!State.meta) { try { State.meta = await API.meta(); } catch { State.meta = {}; } }
    try { State.caps = await API.ocrCapabilities(); } catch { State.caps = null; }
    paintShell();
    paintAnnouncement();
    paintCredit();
    if (!location.hash) location.hash = "#/dashboard";
    await router();
  }

  async function logout() {
    try { await API.logout(); } catch { /* بی‌صدا */ }
    API.clearToken();
    State.user = null; State.sub = null;
    showAuth();
    history.replaceState(null, "", location.pathname);
    toast("از حساب خارج شدید", { type: "info" });
  }

  /* ---------- راه‌اندازی ---------- */
  async function init() {
    setTheme(ls.getItem("fk_theme") || "dark");
    bindAuth();
    if (navigator.onLine) {
      API.setUnauthorizedHandler(() => {
        if (State.user) { State.user = null; showAuth(); toast("نشست منقضی شد؛ دوباره وارد شوید.", { type: "warn" }); }
      });
    }

    API.setUnauthorizedHandler(() => {
      if (State.user) { State.user = null; showAuth(); toast("نشست منقضی شد؛ دوباره وارد شوید.", { type: "warn" }); }
    });

    /* پوسته */
    $("#topbar-scan").onclick = () => { location.hash = "#/scan"; };
    $("#menu-btn").onclick = () => $("#sidebar").classList.toggle("open");
    $("#theme-toggle").onclick = () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
    $("#avatar-btn").onclick = (e) => { e.stopPropagation(); $("#avatar-menu").classList.toggle("open"); };
    document.addEventListener("click", () => $("#avatar-menu").classList.remove("open"));
    $("#menu-logout").onclick = () => logout();
    $("#cmdk-trigger").onclick = openCmdk;
    $("#cmdk").addEventListener("click", (e) => { if (e.target.id === "cmdk") closeCmdk(); });
    $("#cmdk-input").addEventListener("input", (e) => renderCmdk(e.target.value));
    $("#cmdk-input").addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); moveCmdk(1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); moveCmdk(-1); }
      else if (e.key === "Enter") { e.preventDefault(); run(cmdkItems[cmdkIndex]); }
      else if (e.key === "Escape") closeCmdk();
    });

    let lastKey = "";
    let lastKeyAt = 0;
    document.addEventListener("keydown", (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openCmdk(); return; }
      if (e.key === "Escape") { closeCmdk(); $("#sidebar").classList.remove("open"); return; }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) { lastKey = ""; return; }

      const key = e.key.toLowerCase();
      const now = Date.now();
      if (lastKey === "g" && now - lastKeyAt < 1200) {
        const map = { d: "dashboard", s: "scan", i: "invoices", r: "reports",
                      p: "subscription", f: "features", a: "admin", t: "support", c: "settings" };
        if (map[key]) {
          e.preventDefault();
          if (map[key] === "admin" && !(State.user && State.user.is_admin)) {
            toast("دسترسی به پنل مدیریت مجاز نیست", { type: "error" });
          } else {
            location.hash = `#/${map[key]}`;
          }
          lastKey = "";
          return;
        }
      }
      lastKey = key;
      lastKeyAt = now;
    });

    window.addEventListener("hashchange", () => { if (State.user) router(); });
    window.addEventListener("fk:refresh", async () => {
      try {
        const me = await API.me();
        State.user = me.user; State.sub = me.subscription;
        paintShell();
        paintCredit();
      } catch { /* بی‌صدا */ }
    });

    /* سرویس‌ورکر در نسخهٔ PHP وجود ندارد: کش کهنه، کاربر را روی نسخهٔ قدیمی نگه می‌داشت */

    /* بازگردانی نشست */
    const token = API.getToken();
    if (token) {
      State.user = API.cachedUser();
      try {
        const me = await API.me();
        State.user = me.user; State.sub = me.subscription;
        API.setCachedUser(me.user);
        await enterApp();
      } catch {
        API.clearToken();
        showAuth();
      }
    } else {
      showAuth();
    }
    booted = true;
  }

  window.addEventListener("DOMContentLoaded", init);
  return { setTheme, logout, router, openCmdk, get booted() { return booted; } };
})();
