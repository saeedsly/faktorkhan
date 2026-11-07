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
                    <span class="e-badge">${cloudReady ? "آماده" : "تنظیم نشده"}</span></div>
                  <small>دقت بالا برای دست‌نویس، حرارتی و اسناد تصویری. متن از درگاه امن سرور عبور می‌کند.</small>
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
        const { parsed } = await API.parseText(text, draft.invoiceType);
        UI.setBusy(btn, false);
        renderReview({ parsed, text, jobId: null });
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
    function renderReview({ parsed, text, jobId, job }) {
      const p = parsed || {};
      const conf = Number(p.confidence || 0);
      const body = $("#scan-status-body", el);
      const items = (p.items || []).map((it) => ({ ...it }));
      body.innerHTML = `
        <div class="confidence">
          ${ring(conf, { color: conf >= 75 ? "#34d399" : conf >= 50 ? "#fbbf24" : "#f87171" })}
          <div class="c-meta"><strong>امتیاز اعتماد خوانش</strong>
            <span>${conf >= 75 ? "استخراج دقیق — بازبینی سریع کافی است" : conf >= 50 ? "بازبینی چند فیلد لازم است" : "کیفیت متن پایین؛ فیلدها را دستی کنترل کنید"}</span></div>
        </div>
        ${(p.warnings || []).length ? `<div class="warn-list">${p.warnings.map((w) =>
          `<div class="warn-item"><svg class="ic"><use href="#i-info"/></svg><span>${esc(w)}</span></div>`).join("")}</div>` : ""}
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
            <span class="i-idx">${num(i + 1)}</span>
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
          items: items.map((it, i) => ({ ...it, row_no: i + 1 })),
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
        localStorage.setItem("fk_user", JSON.stringify(me.user));
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
          <button class="btn sm ghost" onclick="history.back?history.back():null" style="margin-bottom:6px">
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

    $("#d-print", el).onclick = () => printInvoice(inv.id);
    $("#d-download", el).onclick = () => {
      if (!inv.has_file) return toast("فایل اصلی برای این فاکتور ذخیره نشده است", { type: "warn" });
      downloadAuth(`/api/invoices/${inv.id}/file`, inv.file_name || `invoice-${inv.id}`);
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
          @font-face{font-family:V;src:url('/assets/fonts/Vazirmatn-Regular.woff2') format('woff2');font-weight:400}
          @font-face{font-family:V;src:url('/assets/fonts/Vazirmatn-Bold.woff2') format('woff2');font-weight:700}
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
