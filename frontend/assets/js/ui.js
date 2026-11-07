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
