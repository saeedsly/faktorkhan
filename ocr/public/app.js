import { extractFields, runChecks, repairFields } from "./extract.js";

const $ = (id) => document.getElementById(id);
const fmt = (v) => (v === null || v === undefined ? "—" : v.toLocaleString("fa-IR"));
const LABELS = {
  invoice_number: "شماره فاکتور",
  issue_date: "تاریخ صدور",
  subtotal: "جمع اقلام",
  discount: "جمع تخفیف",
  taxable: "جمع مشمول مالیات",
  vat: "جمع مالیات",
  total: "مبلغ قابل پرداخت",
};

let serverOk = false;
let tesseractWorker = null;

/* ---------- سرور محلی ---------- */
async function checkServer() {
  try {
    const res = await fetch("api/health", { cache: "no-store" });
    const body = await res.json();
    serverOk = Boolean(body.ok);
    const vlmOk = Boolean(body.engines?.vlm?.ok);
    if (vlmOk && !document.querySelector('#engine option[value="vlm"]')) {
      const option = new Option("Qwen3-VL — دست‌نویس (کندتر، اختیاری)", "vlm");
      $("engine").insertBefore(option, $("engine").querySelector('option[value="browser"]'));
    }
    $("engineInfo").textContent = serverOk
      ? `سرور محلی آماده است: ${body.engine}.${vlmOk ? " Qwen3-VL هم در دسترس است." : ""}`
      : `سرور محلی آماده نیست (${body.error}). از موتور داخل مرورگر استفاده می‌شود.`;
  } catch {
    serverOk = false;
    $("engineInfo").textContent = "سرور محلی در دسترس نیست؛ از موتور داخل مرورگر استفاده می‌شود.";
  }
  $("engine").value = serverOk ? "server" : "browser";
}

async function recognizeOnServer(file, engineKey) {
  const form = new FormData();
  form.append("file", file);
  $("status").textContent = engineKey === "vlm"
    ? "در حال خواندن با Qwen3-VL (روی CPU ممکن است چند دقیقه طول بکشد)…"
    : "در حال خواندن با سرور محلی…";
  const res = await fetch(`api/ocr?engine=${engineKey}`, { method: "POST", body: form });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.detail || `خطای سرور (${res.status})`);
  const alt = body.variants
    ? Object.entries(body.variants).find(([mode]) => mode !== body.decode)
    : null;
  return {
    text: body.text,
    alt: alt ? alt[1] : null,
    seconds: body.seconds,
    info: body.decode === "vlm" ? `${body.engine}` : `${body.engine}، حالت ترتیب: ${body.decode}`,
  };
}

/* ---------- موتور داخل مرورگر (پشتیبان) ---------- */
async function recognizeInBrowser(file) {
  if (!tesseractWorker) {
    $("status").textContent = "در حال بارگذاری موتور مرورگر و داده‌ی فارسی (فقط بار اول)…";
    tesseractWorker = await Tesseract.createWorker("fas", 1, {
      workerPath: "vendor/tesseract/worker.min.js",
      corePath: "vendor/core/",
      langPath: "vendor/lang/",
      gzip: true,
      logger: (m) => {
        if (m.status === "recognizing text") {
          $("progress").value = m.progress;
          $("status").textContent = `در حال خواندن متن… ${Math.round(m.progress * 100)}٪`;
        }
      },
    });
  }
  const started = performance.now();
  const { data } = await tesseractWorker.recognize(file);
  return {
    text: data.text,
    alt: null,
    seconds: ((performance.now() - started) / 1000).toFixed(1),
    info: "Tesseract (مرورگر)",
  };
}

/* ---------- رابط کاربری ---------- */
$("file").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  $("preview").src = URL.createObjectURL(file);
  $("preview").style.display = "block";
  $("run").disabled = false;
});

$("run").addEventListener("click", async () => {
  const file = $("file").files[0];
  if (!file) return;
  $("run").disabled = true;
  $("progress").style.display = "block";
  $("progress").value = 0;
  try {
    const choice = $("engine").value;
    const useServer = choice !== "browser" && serverOk;
    const result = useServer ? await recognizeOnServer(file, choice) : await recognizeInBrowser(file);
    const repaired = repairFields(extractFields(result.text));
    renderResults(result, repaired);
  } catch (err) {
    $("status").textContent = "خطا: " + err.message;
  } finally {
    $("run").disabled = false;
    $("progress").style.display = "none";
  }
});

function renderResults(result, repaired) {
  const fields = repaired.fields;
  const changed = new Set(repaired.corrections.map((c) => c.field));
  const derived = new Set(repaired.derived.map((d) => d.field));
  $("status").textContent = `خواندن تمام شد (${result.seconds} ثانیه) — ${result.info}.`;
  $("fields").innerHTML =
    "<tbody>" +
    Object.entries(LABELS)
      .map(([k, label]) => {
        const v = fields[k];
        const shown = typeof v === "number" ? fmt(v) : v ?? "—";
        const mark = changed.has(k) ? " (اصلاح‌شده)" : derived.has(k) ? " (محاسبه‌شده)" : "";
        const style = changed.has(k) ? ' style="background:#fff3cd"' : derived.has(k) ? ' style="background:#e7f1ff"' : "";
        return `<tr><th>${label}</th><td${style}>${shown}${mark}</td></tr>`;
      })
      .join("") +
    "</tbody>";

  // افشای کامل تغییرات: هیچ عددی بی‌اطلاع عوض نمی‌شود
  const notes = [];
  for (const c of repaired.corrections) {
    notes.push(`<li class="bad">اصلاح خودکار: ${LABELS[c.field]} از ${fmt(c.from)} به ${fmt(c.to)} (تغییر یک رقم بر اساس معادله‌ی فاکتور؛ اگر درست نیست، عدد اصلی را در فاکتور بررسی کنید)</li>`);
  }
  for (const d of repaired.derived) {
    notes.push(`<li>${LABELS[d.field]} محاسبه شد: ${fmt(d.value)} (${d.reason})</li>`);
  }
  if (repaired.ambiguous) {
    notes.push(`<li class="bad">چند تصحیح هم‌هزینه ممکن است؛ هیچ عددی تغییر نکرد. لطفاً ارقام را از روی فاکتور کنترل کنید.</li>`);
  }
  $("repairs").innerHTML = notes.join("");

  const checks = runChecks(fields);
  $("checks").innerHTML = checks.length
    ? checks
        .map((c) => `<li class="${c.ok ? "ok" : "bad"}">${c.ok ? "✔" : "✘"} ${c.name}<br><small>${c.detail}</small></li>`)
        .join("")
    : "<li>بررسی حسابی قابل انجام نیست (فیلدهای لازم خوانده نشد).</li>";
  $("text").textContent = result.text;
  $("altBlock").style.display = result.alt !== null ? "block" : "none";
  $("altText").textContent = result.alt ?? "";
}

checkServer();
