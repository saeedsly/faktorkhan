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
  /** اگر token نتواند ذخیره شود، ورود ظاهراً موفق است ولی کاربر بیرون می‌ماند. */
  const storageWarning = () => (store.mode === "memory"
    ? "مرورگر اجازهٔ ذخیرهٔ نشست نمی‌دهد. این صفحه را در یک تب مستقیم (نه داخل iframe) باز کنید."
    : "");

  async function request(path, { method = "GET", body, headers = {}, raw = false, form = false } = {}) {
    const opts = { method, headers: { ...headers } };
    const token = getToken();
    if (token) opts.headers.Authorization = `Bearer ${token}`;
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
    return s ? `?${s}` : "";
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
    login: (payload) => request("/api/auth/login", { method: "POST", body: payload }),
    register: (payload) => request("/api/auth/register", { method: "POST", body: payload }),
    me: () => request("/api/auth/me"),
    updateProfile: (payload) => request("/api/auth/profile", { method: "PATCH", body: payload }),
    changePassword: (payload) => request("/api/auth/change-password", { method: "POST", body: payload }),
    logout: () => request("/api/auth/logout", { method: "POST" }),
    devices: () => request("/api/auth/devices"),
    removeDevice: (id) => request(`/api/auth/devices/${encodeURIComponent(id)}`, { method: "DELETE" }),

    /* --- فاکتورها --- */
    invoices: (params) => request(`/api/invoices${qs(params)}`),
    invoice: (id) => request(`/api/invoices/${id}`),
    createInvoice: (payload) => request("/api/invoices", { method: "POST", body: payload }),
    updateInvoice: (id, payload) => request(`/api/invoices/${id}`, { method: "PUT", body: payload }),
    deleteInvoice: (id) => request(`/api/invoices/${id}`, { method: "DELETE" }),
    bulkInvoices: (payload) => request("/api/invoices/bulk", { method: "POST", body: payload }),
    invoiceStats: () => request("/api/invoices/stats"),
    invoicePrint: (id) => request(`/api/invoices/${id}/print`),
    parseText: (text, invoice_type) => request("/api/invoices/parse", { method: "POST", body: { text, invoice_type } }),
    understand: (text, invoice_type, autofix = true) =>
      request("/api/invoices/understand", { method: "POST", body: { text, invoice_type, autofix } }),
    understandImage: (payload) => request("/api/invoices/understand-image", { method: "POST", body: payload || {} }),
    fixNumbers: (items, totals, apply_to) =>
      request("/api/invoices/fix-numbers", { method: "POST", body: { items, totals, apply_to } }),
    exportUrl: (format, params) => `/api/invoices/export${qs({ format, ...(params || {}) })}`,

    /* --- OCR --- */
    ocrCapabilities: () => request("/api/ocr/capabilities"),
    ocrUpload: (formData) => request("/api/ocr/upload", { method: "POST", body: formData, form: true }),
    ocrLink: (payload) => request("/api/ocr/link", { method: "POST", body: payload }),
    ocrJobs: (limit = 12) => request(`/api/ocr/jobs?limit=${limit}`),
    ocrJob: (id, withText = false) => request(`/api/ocr/jobs/${id}${withText ? "?with_text=true" : ""}`),
    ocrRetry: (id) => request(`/api/ocr/jobs/${id}/retry`, { method: "POST" }),
    ocrCancel: (id) => request(`/api/ocr/jobs/${id}/cancel`, { method: "POST" }),
    ocrDelete: (id) => request(`/api/ocr/jobs/${id}`, { method: "DELETE" }),
    ocrToInvoice: (id, payload) => request(`/api/ocr/jobs/${id}/to-invoice`, { method: "POST", body: payload || {} }),
    ocrCredit: () => request("/api/ocr/credit"),
    ocrResultUrl: (id) => `/api/ocr/jobs/${id}/result`,

    /* --- اشتراک --- */
    plans: () => request("/api/billing/plans"),
    subscription: () => request("/api/billing/subscription"),
    redeem: (key) => request("/api/billing/redeem", { method: "POST", body: { key } }),
    usage: () => request("/api/billing/usage"),
    checkKey: (key) => request(`/api/billing/check-key/${encodeURIComponent(key)}`),

    /* --- سامانه --- */
    meta: () => request("/api/system/meta"),
    features: () => request("/api/system/features"),
    health: () => request("/api/system/health"),
    support: (payload) => request("/api/system/support", { method: "POST", body: payload }),

    /* --- مدیر --- */
    admin: {
      overview: () => request("/api/admin/overview"),
      users: (params) => request(`/api/admin/users${qs(params)}`),
      updateUser: (id, payload) => request(`/api/admin/users/${id}`, { method: "PATCH", body: payload }),
      resetPassword: (id) => request(`/api/admin/users/${id}/reset-password`, { method: "POST" }),
      deleteUser: (id) => request(`/api/admin/users/${id}`, { method: "DELETE" }),
      plans: () => request("/api/admin/plans"),
      createPlan: (payload) => request("/api/admin/plans", { method: "POST", body: payload }),
      updatePlan: (id, payload) => request(`/api/admin/plans/${id}`, { method: "PUT", body: payload }),
      deletePlan: (id) => request(`/api/admin/plans/${id}`, { method: "DELETE" }),
      keys: (params) => request(`/api/admin/keys${qs(params)}`),
      createKeys: (payload) => request("/api/admin/keys/batch", { method: "POST", body: payload }),
      revokeKey: (id) => request(`/api/admin/keys/${id}/revoke`, { method: "POST" }),
      deleteKey: (id) => request(`/api/admin/keys/${id}`, { method: "DELETE" }),
      cloud: () => request("/api/admin/cloud"),
      setCloudToken: (token) => request("/api/admin/cloud/token", { method: "POST", body: { token } }),
      clearCloudToken: () => request("/api/admin/cloud/token", { method: "DELETE" }),
      testCloud: () => request("/api/admin/cloud/test", { method: "POST" }),
      settings: () => request("/api/admin/settings"),
      saveSettings: (payload) => request("/api/admin/settings", { method: "PUT", body: payload }),
      audit: (params) => request(`/api/admin/audit${qs(params)}`),
      support: (params) => request(`/api/admin/support${qs(params)}`),
      answerTicket: (id, answer) => request(`/api/admin/support/${id}/answer`, { method: "POST", body: { answer } }),
      health: () => request("/api/admin/health"),
      backupUrl: () => "/api/admin/backup",
    },
  };
})();
