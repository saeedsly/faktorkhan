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
        toast(`خوش آمدید ${res.user.full_name || ""}`, { type: "success" });
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

    /* نسخه آفلاین */
    if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }

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
