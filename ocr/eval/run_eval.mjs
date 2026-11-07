// سیستم تست دقت OCR: روی نمونه‌های ساختگی اجرا می‌شود و گزارش دقت می‌دهد.
//
// اجرا (از پوشه‌ی ocr/):
//   node eval/run_eval.mjs                                   # موتور Tesseract داخل Node
//   node eval/run_eval.mjs --server http://127.0.0.1:8000 --decode paddle   # سرور PP-OCRv5 محلی
//   node eval/run_eval.mjs --server http://127.0.0.1:8000 --decode raw
//   node eval/run_eval.mjs --server http://127.0.0.1:8000 --engine vlm     # Qwen3-VL (اگر --vlm-url داده شده)
// آرگومان اختیاری آخر: تعداد نمونه‌ها (مثلاً 10).
// گزارش در eval/report-<موتور>.json ذخیره می‌شود.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractFields, runChecks, numbersIn, normalizeDigits, fuzzyContains } from "../public/extract.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const samples = path.join(here, "samples");
const truth = JSON.parse(fs.readFileSync(path.join(samples, "truth.json"), "utf8"));

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const serverUrl = opt("--server", null);
const decode = opt("--decode", "paddle");
const engine = opt("--engine", "rapid"); // rapid = PP-OCRv5؛ vlm = Qwen3-VL
const positional = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
if (!["rapid", "vlm"].includes(engine)) {
  console.error(`--engine باید rapid یا vlm باشد، نه ${engine}`);
  process.exit(1);
}
const cases = truth.slice(0, Number(positional[0] || truth.length));

// تابع OCR: یا سرور محلی (PP-OCRv5) یا Tesseract
let recognize;
let engineLabel;
if (serverUrl) {
  const variant = engine === "vlm" ? "vlm" : decode;
  engineLabel = `server-${variant}`;
  recognize = async (file) => {
    const form = new FormData();
    form.append("file", new Blob([fs.readFileSync(path.join(samples, file))], { type: "image/png" }), file);
    const url = `${serverUrl.replace(/\/$/, "")}/api/ocr?engine=${engine}`;
    const res = await fetch(url, { method: "POST", body: form });
    const body = await res.json();
    if (!res.ok) throw new Error(`سرور خطا داد (${res.status}): ${body.detail}`);
    return body.variants?.[variant] ?? body.text;
  };
} else {
  engineLabel = "tesseract";
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("fas", 1, {
    langPath: path.resolve(here, "..", "node_modules", "@tesseract.js-data", "fas", "4.0.0_best_int"),
    gzip: true,
    cachePath: "/tmp/tess-cache",
    logger: () => {},
  });
  recognize = async (file) => (await worker.recognize(path.join(samples, file))).data.text;
}

const FIELDS = ["invoice_number", "issue_date", "subtotal", "discount", "taxable", "vat", "total"];
const fieldHits = Object.fromEntries(FIELDS.map((f) => [f, 0]));
let numberTotal = 0, numberFound = 0, itemTotal = 0, itemFound = 0;
let samplesAllCorrect = 0, samplesWithError = 0, errorsFlagged = 0, falseAlarms = 0;
const started = Date.now();
const perSample = [];
const missingCount = new Map();

for (const c of cases) {
  let text;
  try {
    text = await recognize(c.file);
  } catch (err) {
    console.error(`\n${c.file}: ${err.message}`);
    process.exit(1);
  }
  const got = extractFields(text);
  const ok = {};
  for (const f of FIELDS) {
    ok[f] = String(got[f]) === String(c[f]);
    if (ok[f]) fieldHits[f]++;
  }
  const seen = new Set(numbersIn(text));
  const missing = [];
  for (const n of c.numbers) {
    numberTotal++;
    if (seen.has(n)) numberFound++;
    else missing.push(n);
  }
  for (const n of missing) missingCount.set(n, (missingCount.get(n) || 0) + 1);
  const norm = normalizeDigits(text);
  for (const name of c.items) { itemTotal++; if (fuzzyContains(norm, name, 0.8)) itemFound++; }

  const allOk = FIELDS.every((f) => ok[f]);
  const checks = runChecks(got);
  const flagged = checks.some((ch) => !ch.ok);
  if (allOk) samplesAllCorrect++;
  else {
    samplesWithError++;
    if (flagged) errorsFlagged++;
  }
  if (allOk && flagged) falseAlarms++;
  perSample.push({
    file: c.file,
    all_fields_correct: allOk,
    checks_flagged_error: flagged,
    wrong: FIELDS.filter((f) => !ok[f]),
    missing_numbers: missing,
  });
  process.stdout.write(allOk ? "." : "x");
}

const pct = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : 0);
const report = {
  engine: engineLabel,
  samples: cases.length,
  seconds_total: (Date.now() - started) / 1000,
  field_accuracy_percent: Object.fromEntries(FIELDS.map((f) => [f, pct(fieldHits[f], cases.length)])),
  all_fields_correct_percent: pct(samplesAllCorrect, cases.length),
  number_recall_percent: pct(numberFound, numberTotal),
  item_name_recall_percent: pct(itemFound, itemTotal),
  error_detection_rate_percent: pct(errorsFlagged, samplesWithError),
  check_false_alarm_count: falseAlarms,
  most_missed_numbers: [...missingCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)
    .map(([n, k]) => ({ number: n, missed_in_samples: k })),
  per_sample: perSample,
};
const outFile = path.join(here, `report-${engineLabel}.json`);
fs.writeFileSync(outFile, JSON.stringify(report, null, 2), "utf8");
console.log("\n");
console.log(JSON.stringify({ ...report, per_sample: undefined }, null, 2));
console.log(`\nگزارش کامل: ${path.relative(process.cwd(), outFile)}`);
