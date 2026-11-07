// سیستم تست دقت OCR: روی نمونه‌های ساختگی اجرا می‌شود و گزارش دقت می‌دهد.
//
// اجرا (از پوشه‌ی ocr/):
//   node eval/run_eval.mjs                                   # Tesseract (fas 4.0.0_best_int)
//   node eval/run_eval.mjs --tess-model 4.0.0                # Tesseract با مدل float
//   node eval/run_eval.mjs --server http://127.0.0.1:8000 --decode paddle   # سرور PP-OCRv5 محلی
//   node eval/run_eval.mjs --server http://127.0.0.1:8000 --decode raw
//   node eval/run_eval.mjs --server http://127.0.0.1:8000 --engine vlm     # Qwen3-VL (اگر --vlm-url داده شده)
//   node eval/run_eval.mjs --from-cache tesseract            # بدون OCR دوباره؛ از متن‌های ذخیره‌شده
// متن خام OCR هر نمونه در eval/out/<موتور>/ ذخیره می‌شود (گیت‌ایگنور).
// آرگومان اختیاری آخر: تعداد نمونه‌ها (مثلاً 10).
// گزارش در eval/report-<موتور>.json ذخیره می‌شود.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractFields, runChecks, numbersIn, normalizeDigits, fuzzyContains, repairFields } from "../public/extract.js";

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
const tessModel = opt("--tess-model", "4.0.0_best_int");
const fromCache = opt("--from-cache", null); // برچسب موتور که متن‌هایش ذخیره شده
const positional = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
if (!["rapid", "vlm"].includes(engine)) {
  console.error(`--engine باید rapid یا vlm باشد، نه ${engine}`);
  process.exit(1);
}
const cases = truth.slice(0, Number(positional[0] || truth.length));

// تابع OCR: یا سرور محلی (PP-OCRv5) یا Tesseract؛ یا خواندن از کش
let recognize;
let engineLabel;
if (fromCache) {
  engineLabel = fromCache;
  recognize = async (file) => {
    const p = path.join(here, "out", fromCache, `${file}.txt`);
    if (!fs.existsSync(p)) throw new Error(`متن ذخیره‌شده نیست: ${p}`);
    return fs.readFileSync(p, "utf8");
  };
} else if (serverUrl) {
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
  engineLabel = tessModel === "4.0.0_best_int" ? "tesseract" : `tesseract-${tessModel}`;
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("fas", 1, {
    langPath: path.resolve(here, "..", "node_modules", "@tesseract.js-data", "fas", tessModel),
    gzip: true,
    cachePath: "/tmp/tess-cache",
    logger: () => {},
  });
  recognize = async (file) => (await worker.recognize(path.join(samples, file))).data.text;
}

const outDir = path.join(here, "out", engineLabel);
if (!fromCache) fs.mkdirSync(outDir, { recursive: true });

const FIELDS = ["invoice_number", "issue_date", "subtotal", "discount", "taxable", "vat", "total"];
const MONEY = ["subtotal", "discount", "taxable", "vat", "total"];
const same = (a, b) => String(a) === String(b);
const fieldHits = Object.fromEntries(FIELDS.map((f) => [f, 0]));
const fixedHits = Object.fromEntries(FIELDS.map((f) => [f, 0]));
let numberTotal = 0, numberFound = 0, itemTotal = 0, itemFound = 0;
let samplesAllCorrect = 0, samplesWithError = 0, errorsFlagged = 0, falseAlarms = 0;
let samplesAllCorrectFixed = 0, samplesWithErrorFixed = 0, errorsFlaggedFixed = 0, falseAlarmsFixed = 0;
const rep = { samples_with_correction: 0, corrections: 0, corrections_correct: 0, corrections_wrong: 0,
  samples_ambiguous: 0, derived: 0, derived_correct: 0, samples_with_wrong_before_and_fixed: 0 };
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
  if (!fromCache) fs.writeFileSync(path.join(outDir, `${c.file}.txt`), text, "utf8");

  const got = extractFields(text);
  const repaired = repairFields(got);
  const fixed = repaired.fields;

  const ok = {}, okFixed = {};
  for (const f of FIELDS) {
    ok[f] = same(got[f], c[f]);
    okFixed[f] = same(fixed[f], c[f]);
    if (ok[f]) fieldHits[f]++;
    if (okFixed[f]) fixedHits[f]++;
  }

  // تصحیح‌ها و مقادیر محاسبه‌شده
  const corrections = repaired.corrections.map((k) => ({ ...k, correct: same(k.to, c[k.field]) }));
  rep.corrections += corrections.length;
  rep.corrections_correct += corrections.filter((k) => k.correct).length;
  rep.corrections_wrong += corrections.filter((k) => !k.correct).length;
  if (corrections.length) rep.samples_with_correction++;
  if (repaired.ambiguous) rep.samples_ambiguous++;
  const derived = repaired.derived.map((d) => ({ ...d, correct: same(d.value, c[d.field]) }));
  rep.derived += derived.length;
  rep.derived_correct += derived.filter((d) => d.correct).length;
  if (!FIELDS.every((f) => ok[f]) && FIELDS.every((f) => okFixed[f])) rep.samples_with_wrong_before_and_fixed++;

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
  const allOkFixed = FIELDS.every((f) => okFixed[f]);
  const flagged = runChecks(got).some((ch) => !ch.ok);
  const flaggedFixed = runChecks(fixed).some((ch) => !ch.ok);
  if (allOk) samplesAllCorrect++;
  else { samplesWithError++; if (flagged) errorsFlagged++; }
  if (allOk && flagged) falseAlarms++;
  if (allOkFixed) samplesAllCorrectFixed++;
  else { samplesWithErrorFixed++; if (flaggedFixed) errorsFlaggedFixed++; }
  if (allOkFixed && flaggedFixed) falseAlarmsFixed++;

  perSample.push({
    file: c.file,
    all_fields_correct: allOk,
    checks_flagged_error: flagged,
    wrong: FIELDS.filter((f) => !ok[f]),
    missing_numbers: missing,
    repair: {
      ambiguous: repaired.ambiguous,
      corrections,
      derived,
      wrong_after_repair: FIELDS.filter((f) => !okFixed[f]),
      all_fields_correct_after_repair: allOkFixed,
      checks_flagged_after_repair: flaggedFixed,
    },
  });
  process.stdout.write(allOkFixed ? "." : "x");
}

const pct = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : 0);
const report = {
  engine: engineLabel,
  tess_model: serverUrl ? null : tessModel,
  samples: cases.length,
  seconds_total: (Date.now() - started) / 1000,
  field_accuracy_percent: Object.fromEntries(FIELDS.map((f) => [f, pct(fieldHits[f], cases.length)])),
  all_fields_correct_percent: pct(samplesAllCorrect, cases.length),
  number_recall_percent: pct(numberFound, numberTotal),
  item_name_recall_percent: pct(itemFound, itemTotal),
  error_detection_rate_percent: pct(errorsFlagged, samplesWithError),
  check_false_alarm_count: falseAlarms,
  after_repair: {
    field_accuracy_percent: Object.fromEntries(FIELDS.map((f) => [f, pct(fixedHits[f], cases.length)])),
    all_fields_correct_percent: pct(samplesAllCorrectFixed, cases.length),
    error_detection_rate_percent: pct(errorsFlaggedFixed, samplesWithErrorFixed),
    check_false_alarm_count: falseAlarmsFixed,
    corrections_applied: rep.corrections,
    corrections_correct: rep.corrections_correct,
    corrections_wrong: rep.corrections_wrong,
    samples_with_correction: rep.samples_with_correction,
    samples_ambiguous_not_applied: rep.samples_ambiguous,
    derived_fields: rep.derived,
    derived_fields_correct: rep.derived_correct,
    samples_fixed_to_all_correct: rep.samples_with_wrong_before_and_fixed,
  },
  most_missed_numbers: [...missingCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)
    .map(([n, k]) => ({ number: n, missed_in_samples: k })),
  per_sample: perSample,
};
const outFile = path.join(here, `report-${engineLabel}.json`);
fs.writeFileSync(outFile, JSON.stringify(report, null, 2), "utf8");
console.log("\n");
console.log(JSON.stringify({ ...report, per_sample: undefined }, null, 2));
console.log(`\nگزارش کامل: ${path.relative(process.cwd(), outFile)}`);
