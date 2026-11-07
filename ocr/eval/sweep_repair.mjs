// مقایسه‌ی پیکربندی‌های تصحیح حسابی روی متن‌های OCR ذخیره‌شده (بدون اجرای دوباره‌ی OCR).
// اجرا: node eval/sweep_repair.mjs tesseract [tesseract-4.0.0 ...]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractFields, repairFields } from "../public/extract.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const truth = JSON.parse(fs.readFileSync(path.join(here, "samples", "truth.json"), "utf8"));
const FIELDS = ["invoice_number", "issue_date", "subtotal", "discount", "taxable", "vat", "total"];
const CONFIGS = [
  { name: "بدون تصحیح", none: true },
  { name: "جایگزینی، هزینه≤2", ops: ["sub"], maxCost: 2 },
  { name: "جایگزینی/درج/حذف، هزینه≤1", ops: ["sub", "ins", "del"], maxCost: 1 },
  { name: "جایگزینی/درج/حذف، هزینه≤2", ops: ["sub", "ins", "del"], maxCost: 2 },
];
const same = (a, b) => String(a) === String(b);

for (const label of process.argv.slice(2)) {
  console.log(`\n=== ${label} (${truth.length} نمونه)`);
  console.log("پیکربندی".padEnd(34), "همه‌ی فیلدها درست", "اصلاح درست", "اصلاح غلط", "ابهام", "محاسبه‌شده(درست/کل)");
  const texts = truth.map((c) => fs.readFileSync(path.join(here, "out", label, `${c.file}.txt`), "utf8"));
  for (const cfg of CONFIGS) {
    let allOk = 0, good = 0, bad = 0, amb = 0, der = 0, derOk = 0;
    truth.forEach((c, i) => {
      const got = extractFields(texts[i]);
      const r = cfg.none ? { fields: got, corrections: [], derived: [], ambiguous: false }
        : repairFields(got, { ops: cfg.ops, maxCost: cfg.maxCost });
      if (FIELDS.every((f) => same(r.fields[f], c[f]))) allOk++;
      for (const k of r.corrections) (same(k.to, c[k.field]) ? good++ : bad++);
      if (r.ambiguous) amb++;
      for (const d of r.derived) { der++; if (same(d.value, c[d.field])) derOk++; }
    });
    console.log(cfg.name.padEnd(34), `${allOk}/${truth.length}`.padEnd(18), String(good).padEnd(11), String(bad).padEnd(10), String(amb).padEnd(5), `${derOk}/${der}`);
  }
}
