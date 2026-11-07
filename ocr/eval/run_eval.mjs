// سیستم تست دقت OCR: روی نمونه‌های ساختگی اجرا می‌شود و گزارش دقت می‌دهد.
import { createWorker } from "tesseract.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractFields, runChecks, numbersIn, normalizeDigits, fuzzyContains } from "../public/extract.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const samples = path.join(here, "samples");
const truth = JSON.parse(fs.readFileSync(path.join(samples, "truth.json"), "utf8"));
const limit = Number(process.argv[2] || truth.length);
const cases = truth.slice(0, limit);

const worker = await createWorker("fas", 1, {
  langPath: path.resolve(here, "..", "node_modules", "@tesseract.js-data", "fas", "4.0.0_best_int"),
  gzip: true,
  cachePath: "/tmp/tess-cache",
  logger: () => {},
});

const FIELDS = ["invoice_number", "issue_date", "subtotal", "discount", "taxable", "vat", "total"];
const fieldHits = Object.fromEntries(FIELDS.map((f) => [f, 0]));
let numberTotal = 0, numberFound = 0, itemTotal = 0, itemFound = 0;
let samplesAllCorrect = 0, samplesWithError = 0, errorsFlagged = 0;
const started = Date.now();
const perSample = [];

for (const c of cases) {
  const { data } = await worker.recognize(path.join(samples, c.file));
  const text = data.text;
  const got = extractFields(text);
  const ok = {};
  for (const f of FIELDS) {
    ok[f] = String(got[f]) === String(c[f]);
    if (ok[f]) fieldHits[f]++;
  }
  const seen = new Set(numbersIn(text));
  for (const n of c.numbers) { numberTotal++; if (seen.has(n)) numberFound++; }
  const norm = normalizeDigits(text);
  for (const name of c.items) { itemTotal++; if (fuzzyContains(norm, name, 0.8)) itemFound++; }

  const allOk = FIELDS.every((f) => ok[f]);
  const checks = runChecks(got);
  const flagged = checks.some((ch) => !ch.ok);
  if (allOk) samplesAllCorrect++;
  if (!allOk) {
    samplesWithError++;
    if (flagged) errorsFlagged++;
  }
  perSample.push({ file: c.file, all_fields_correct: allOk, checks_flagged_error: flagged, wrong: FIELDS.filter((f) => !ok[f]) });
  process.stdout.write(allOk ? "." : "x");
}
await worker.terminate();

const pct = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : 0);
const report = {
  samples: cases.length,
  seconds_total: (Date.now() - started) / 1000,
  field_accuracy_percent: Object.fromEntries(FIELDS.map((f) => [f, pct(fieldHits[f], cases.length)])),
  all_fields_correct_percent: pct(samplesAllCorrect, cases.length),
  number_recall_percent: pct(numberFound, numberTotal),
  item_name_recall_percent: pct(itemFound, itemTotal),
  error_detection_rate_percent: pct(errorsFlagged, samplesWithError),
  per_sample: perSample,
};
fs.writeFileSync(path.join(here, "report.json"), JSON.stringify(report, null, 2), "utf8");
console.log("\n");
console.log(JSON.stringify({ ...report, per_sample: undefined }, null, 2));
