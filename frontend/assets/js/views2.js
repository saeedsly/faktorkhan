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
              <a class="btn sm" href="/api/docs" target="_blank">مستندات API</a>
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
            localStorage.setItem("fk_user", JSON.stringify(res.user));
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
