import { extractFields, runChecks } from "./extract.js";

const $ = (id) => document.getElementById(id);
const fmt = (v) => (v === null || v === undefined ? "—" : v.toLocaleString("fa-IR"));
let worker = null;

async function getWorker() {
  if (worker) return worker;
  $("status").textContent = "در حال بارگذاری موتور OCR و داده‌ی فارسی (فقط بار اول)…";
  worker = await Tesseract.createWorker("fas", 1, {
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
  return worker;
}

$("file").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  $("preview").src = url;
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
    const w = await getWorker();
    const started = performance.now();
    const { data } = await w.recognize(file);
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    const fields = extractFields(data.text);
    renderResults(data.text, fields, seconds);
  } catch (err) {
    $("status").textContent = "خطا: " + err.message;
  } finally {
    $("run").disabled = false;
    $("progress").style.display = "none";
  }
});

function renderResults(text, fields, seconds) {
  $("status").textContent = `خواندن تمام شد (${seconds} ثانیه).`;
  const labels = {
    invoice_number: "شماره فاکتور",
    issue_date: "تاریخ صدور",
    subtotal: "جمع اقلام",
    discount: "جمع تخفیف",
    taxable: "جمع مشمول مالیات",
    vat: "جمع مالیات",
    total: "مبلغ قابل پرداخت",
  };
  $("fields").innerHTML =
    "<tbody>" +
    Object.entries(labels)
      .map(([k, label]) => {
        const v = fields[k];
        const shown = typeof v === "number" ? fmt(v) : v ?? "—";
        return `<tr><th>${label}</th><td>${shown}</td></tr>`;
      })
      .join("") +
    "</tbody>";
  const checks = runChecks(fields);
  $("checks").innerHTML = checks.length
    ? checks
        .map((c) => `<li class="${c.ok ? "ok" : "bad"}">${c.ok ? "✔" : "✘"} ${c.name}<br><small>${c.detail}</small></li>`)
        .join("")
    : "<li>بررسی حسابی قابل انجام نیست (فیلدهای لازم خوانده نشد).</li>";
  $("text").textContent = text;
}
