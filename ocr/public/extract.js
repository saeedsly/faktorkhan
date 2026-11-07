// منطق مشترک استخراج فیلدها و بررسی‌های حسابی (برای مرورگر و تست Node).

const PERSIAN = "۰۱۲۳۴۵۶۷۸۹";
const ARABIC = "٠١٢٣٤٥٦٧٨٩";

export function normalizeDigits(text) {
  let out = "";
  for (const ch of text) {
    let i = PERSIAN.indexOf(ch);
    if (i < 0) i = ARABIC.indexOf(ch);
    out += i >= 0 ? String(i) : ch;
  }
  return out;
}

function levenshtein(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

export function similarity(a, b) {
  const max = Math.max(a.length, b.length, 1);
  return 1 - levenshtein(a, b) / max;
}

/** آیا عبارت (با تحمل خطای OCR) در خط وجود دارد؟ */
export function fuzzyContains(text, phrase, threshold = 0.8) {
  const L = phrase.length;
  for (let len = Math.max(1, L - 2); len <= L + 2; len++) {
    for (let i = 0; i + len <= text.length; i++) {
      if (similarity(text.substr(i, len), phrase) >= threshold) return true;
    }
  }
  return false;
}

/**
 * Tesseract جداکننده‌ی هزارگان (٬) را اغلب به‌صورت ’ / * | ` ´ ‘ می‌خواند یا به‌جای آن رقم می‌گذارد.
 * جداکننده‌ای که بین دو رقم است و سمت راستش دقیقاً ۳ رقم است، حذف می‌شود.
 * تاریخ (۱۴۰۵/۰۲/۱۶) تغییر نمی‌کند چون گروه‌هایش ۲ یا ۴ رقمی‌اند.
 */
export function stripThousandsNoise(text) {
  return normalizeDigits(text).replace(/(?<=\d)[’‘'`´\/*|](?=\d{3}(?!\d))/g, "");
}

const NUMBER_RE = /\d{1,3}(?:[,٬]\d{3})+(?!\d)|\d+/g;

/** همه‌ی عددهای یک متن (با حذف جداکننده‌ی هزارگان) */
export function numbersIn(text) {
  return [...stripThousandsNoise(text).matchAll(NUMBER_RE)].map((m) =>
    Number(m[0].replace(/[,٬]/g, ""))
  );
}

const LABELS = {
  subtotal: "جمع اقلام",
  discount: "جمع تخفیف",
  taxable: "جمع مشمول مالیات",
  vat: "جمع مالیات",
  total: "مبلغ قابل پرداخت",
};

/** مقدار هر برچسب را از خطی که برچسب در آن است می‌خواند */
function amountAfterLabel(lines, label) {
  for (const line of lines) {
    if (fuzzyContains(line, label, 0.75)) {
      const nums = numbersIn(line);
      if (nums.length) return nums[nums.length - 1];
    }
  }
  return null;
}

/** استخراج فیلدهای اصلی فاکتور از متن OCR */
export function extractFields(rawText) {
  const text = stripThousandsNoise(rawText);
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const number = text.match(/[MS]-\d{4}-\d{4}/);
  const date = text.match(/\d{4}\/\d{2}\/\d{2}/);
  const fields = {
    invoice_number: number ? number[0] : null,
    issue_date: date ? date[0] : null,
  };
  for (const [key, label] of Object.entries(LABELS)) {
    fields[key] = amountAfterLabel(lines, label);
  }
  return fields;
}

/** بررسی‌های حسابی فاکتور: اگر OCR عددی را غلط خوانده باشد، معمولاً این بررسی‌ها شکست می‌خورند. */
export function runChecks(f) {
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });
  if ([f.subtotal, f.discount, f.taxable].every((v) => v !== null)) {
    add("جمع اقلام − تخفیف = مشمول مالیات", f.subtotal - f.discount === f.taxable,
      `${f.subtotal} − ${f.discount} = ${f.subtotal - f.discount} (خوانده‌شده: ${f.taxable})`);
  }
  if ([f.taxable, f.vat, f.total].every((v) => v !== null)) {
    add("مشمول مالیات + مالیات = مبلغ قابل پرداخت", f.taxable + f.vat === f.total,
      `${f.taxable} + ${f.vat} = ${f.taxable + f.vat} (خوانده‌شده: ${f.total})`);
  }
  if (f.taxable !== null && f.vat !== null) {
    const expected = Math.round(f.taxable * 0.09);
    add("مالیات حدوداً ۹٪ مشمول مالیات است", Math.abs(f.vat - expected) <= 10,
      `۹٪ ≈ ${expected} (خوانده‌شده: ${f.vat})`);
  }
  return checks;
}

/* ---------- تصحیح حسابی: یافتن کم‌هزینه‌ترین ویرایش ارقام که معادلات فاکتور را درست می‌کند ---------- */

const MONEY_FIELDS = ["subtotal", "discount", "taxable", "vat", "total"];
export const REPAIR_MAX_COST = 2; // حداکثر تعداد ویرایش یک‌رقمی در کل فاکتور
const VAT_TOLERANCE = 5; // برای تصحیح: خطای گردکردن مالیات خطوط (runChecks جداگانه ۱۰ دارد)

/** معادلات فاکتور؛ فقط معادله‌هایی که همه‌ی متغیرهایشان معلوم است بررسی می‌شوند. */
export function violatesEquations(f) {
  const known = (...keys) => keys.every((k) => f[k] !== null && f[k] !== undefined);
  if (known("subtotal", "discount", "taxable") && f.subtotal - f.discount !== f.taxable) return true;
  if (known("taxable", "vat", "total") && f.taxable + f.vat !== f.total) return true;
  if (known("taxable", "vat") && Math.abs(f.vat - Math.round(f.taxable * 0.09)) > VAT_TOLERANCE) return true;
  return false;
}

/**
 * همه‌ی عددهای «یک ویرایش دور» از مقدار: جایگزینی، درج یا حذف یک رقم (هزینه‌ی ۱ برای هرکدام).
 * ops مشخص می‌کند کدام نوع ویرایش مجاز است. خروجی: Map(مقدار → هزینه).
 */
function editCandidates(value, ops) {
  const s = String(value);
  const out = new Map();
  const add = (alt) => {
    if (alt === "" || (alt[0] === "0" && alt.length > 1)) return;
    const n = Number(alt);
    if (n !== value && !out.has(n)) out.set(n, 1);
  };
  for (let i = 0; i < s.length; i++) {
    if (ops.includes("sub")) for (let d = 0; d <= 9; d++) if (String(d) !== s[i]) add(s.slice(0, i) + d + s.slice(i + 1));
    if (ops.includes("del")) add(s.slice(0, i) + s.slice(i + 1));
  }
  if (ops.includes("ins")) {
    for (let i = 0; i <= s.length; i++) for (let d = 0; d <= 9; d++) add(s.slice(0, i) + d + s.slice(i));
  }
  return out;
}

/**
 * تصحیح حسابی. اگر معادلات نقض شوند، کم‌هزینه‌ترین مجموعه‌ی ویرایش (تا maxCost) جست‌وجو می‌شود.
 * فقط وقتی تصحیح می‌شود که راه‌حلِ کمینه‌هزینه یکتا باشد؛ در غیر این صورت هیچ عددی تغییر نمی‌کند
 * و ambiguous=true می‌شود. مقدار گمشده فقط وقتی از یک معادله‌ی قطعی معلوم شود «محاسبه‌شده» می‌شود.
 */
export function repairFields(fields, { maxCost = REPAIR_MAX_COST, ops = ["sub", "ins", "del"] } = {}) {
  const result = { fields: { ...fields }, corrections: [], derived: [], ambiguous: false };
  const present = MONEY_FIELDS.filter((k) => fields[k] !== null && fields[k] !== undefined);

  if (present.length >= 2 && violatesEquations(fields)) {
    const options = {};
    for (const k of present) {
      const m = editCandidates(fields[k], ops);
      m.set(fields[k], 0);
      options[k] = [...m.entries()].map(([value, cost]) => ({ value, cost }));
    }
    const solutions = [];
    const assignment = {};
    const choose = (idx, cost) => {
      if (cost > maxCost) return;
      if (idx === present.length) {
        if (!violatesEquations({ ...fields, ...assignment })) solutions.push({ cost, assignment: { ...assignment } });
        return;
      }
      const key = present[idx];
      for (const opt of options[key]) {
        if (cost + opt.cost > maxCost) continue;
        assignment[key] = opt.value;
        choose(idx + 1, cost + opt.cost);
      }
      delete assignment[key];
    };
    choose(0, 0);
    if (solutions.length) {
      const best = Math.min(...solutions.map((s) => s.cost));
      const top = solutions.filter((s) => s.cost === best);
      const distinct = new Map(top.map((s) => [JSON.stringify(s.assignment), s]));
      if (distinct.size === 1) {
        const [only] = distinct.values();
        for (const key of present) {
          if (only.assignment[key] !== fields[key]) {
            result.corrections.push({ field: key, from: fields[key], to: only.assignment[key] });
            result.fields[key] = only.assignment[key];
          }
        }
      } else {
        result.ambiguous = true;
      }
    }
  }

  // مقدار گمشده: فقط وقتی یک معادله‌ی قطعی آن را معلوم کند
  const f = result.fields;
  const fill = (key, value, reason) => {
    if (value === null || value === undefined) return;
    f[key] = value;
    result.derived.push({ field: key, value, reason });
  };
  if (f.subtotal == null && f.discount != null && f.taxable != null) fill("subtotal", f.taxable + f.discount, "جمع اقلام = مشمول مالیات + تخفیف");
  if (f.discount == null && f.subtotal != null && f.taxable != null) fill("discount", f.subtotal - f.taxable, "تخفیف = جمع اقلام − مشمول مالیات");
  if (f.taxable == null && f.subtotal != null && f.discount != null) fill("taxable", f.subtotal - f.discount, "مشمول مالیات = جمع اقلام − تخفیف");
  if (f.taxable == null && f.total != null && f.vat != null) fill("taxable", f.total - f.vat, "مشمول مالیات = قابل پرداخت − مالیات");
  if (f.total == null && f.taxable != null && f.vat != null) fill("total", f.taxable + f.vat, "قابل پرداخت = مشمول مالیات + مالیات");
  if (f.vat == null && f.taxable != null && f.total != null) fill("vat", f.total - f.taxable, "مالیات = قابل پرداخت − مشمول مالیات");
  return result;
}
