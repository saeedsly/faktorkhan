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

const NUMBER_RE = /\d{1,3}(?:[,٬]\d{3})+(?!\d)|\d+/g;

/** همه‌ی عددهای یک متن (با حذف جداکننده‌ی هزارگان) */
export function numbersIn(text) {
  return [...normalizeDigits(text).matchAll(NUMBER_RE)].map((m) =>
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
  const text = normalizeDigits(rawText);
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
