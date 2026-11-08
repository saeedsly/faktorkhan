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
            <span>درگاه سرویس ابری هنوز روی سرور تنظیم نشده است. مقدار <b class="mono">CLOUD_OCR_GATEWAY</b> را در
            فایل <b class="mono">.env</b> بگذارید، برنامه را یک‌بار ببندید و دوباره اجرا کنید؛ سپس توکن را اینجا ثبت کنید.</span></div>`}
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
