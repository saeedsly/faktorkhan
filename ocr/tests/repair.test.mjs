// تست‌های تصحیح حسابی: node --test tests/repair.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { repairFields, violatesEquations, stripThousandsNoise, numbersIn, extractFields } from "../public/extract.js";

const truth = { subtotal: 2808640, discount: 50000, taxable: 2758640, vat: 248278, total: 3006918 };

test("فاکتور سازگار دست‌نخورده می‌ماند", () => {
  const r = repairFields({ ...truth });
  assert.deepEqual(r.fields, truth);
  assert.equal(r.corrections.length, 0);
  assert.equal(r.ambiguous, false);
});

test("یک رقم غلط در قابل پرداخت یکتا تصحیح می‌شود", () => {
  const r = repairFields({ ...truth, total: 3006928 }); // ۱ → ۲ در رقم دهگان
  assert.equal(r.fields.total, 3006918);
  assert.deepEqual(r.corrections, [{ field: "total", from: 3006928, to: 3006918 }]);
});

test("ابهام واقعی: جمع اقلام ۸ یا تخفیف ۸ هر دو معادله را درست می‌کنند؛ تصحیح نمی‌شود", () => {
  const r = repairFields({ ...truth, subtotal: 2808648 });
  assert.equal(r.corrections.length, 0);
  assert.equal(r.ambiguous, true);
  assert.equal(r.fields.subtotal, 2808648);
});

test("یک رقم غلط در تخفیف با کمترین هزینه یکتا تصحیح می‌شود", () => {
  const r = repairFields({ ...truth, discount: 58000 });
  assert.equal(r.fields.discount, 50000);
  assert.deepEqual(r.corrections, [{ field: "discount", from: 58000, to: 50000 }]);
  assert.equal(r.ambiguous, false);
});

test("دو خطا با یک راه‌حل کمینه؛ تحمل ۵ ریالی مالیات گاهی ابهام می‌سازد و تصحیح نمی‌شود", () => {
  // تخفیف ۸ و قابل پرداخت ۹: راه‌حل {تخفیف، قابل پرداخت} و راه‌حل {تخفیف، مالیات+۱} هر دو هزینه‌ی ۲ دارند
  const r = repairFields({ ...truth, discount: 58000, total: 3006919 });
  assert.equal(r.corrections.length, 0);
  assert.equal(r.ambiguous, true);
  assert.equal(r.fields.discount, 58000);
});

test("سه رقم غلط بیشتر از سقف هزینه است و تصحیح نمی‌شود", () => {
  const bad = { ...truth, subtotal: 2808641, discount: 50001, total: 3006919 };
  const r = repairFields(bad);
  assert.equal(r.corrections.length, 0);
});

test("وقتی راه‌حل یکتا نیست، تصحیح انجام نمی‌شود و ابهام گزارش می‌شود", () => {
  // taxable+vat≠total؛ جابه‌جایی ارقام در هر دو طرف جواب‌های متعدد می‌دهد
  const r = repairFields({ subtotal: 1000000, discount: 0, taxable: 1000000, vat: 90000, total: 1090001 });
  assert.equal(r.corrections.length, 0);
  assert.equal(r.ambiguous, true);
  assert.equal(r.fields.total, 1090001);
});

test("مقدار گمشده فقط از معادله‌ی قطعی محاسبه و علامت‌گذاری می‌شود", () => {
  const r = repairFields({ subtotal: 2808640, discount: 50000, taxable: null, vat: 248278, total: 3006918 });
  assert.equal(r.fields.taxable, 2758640);
  assert.equal(r.derived[0].field, "taxable");
});

test("مالیات با ۹٪ اختلاف زیاد نقض معادله است", () => {
  assert.equal(violatesEquations({ ...truth, vat: 300000 }), true);
  assert.equal(violatesEquations({ ...truth }), false);
});

test("جداکننده‌ی هزارگان که OCR به‌جای ٬ می‌خواند حذف می‌شود", () => {
  assert.equal(stripThousandsNoise("۱۷/۵۸۹/۰۰۰"), "17589000");
  assert.equal(stripThousandsNoise("۱۱*۹۷۰"), "11970");
  assert.equal(stripThousandsNoise("۱۲’۵۲۶’۰۰۰"), "12526000");
});

test("تاریخ شمسی با / خراب نمی‌شود", () => {
  assert.equal(stripThousandsNoise("۱۴۰۵/۰۲/۱۶"), "1405/02/16");
  assert.equal(extractFields("تاریخ صدور: ۱۴۰۵/۰۲/۱۶").issue_date, "1405/02/16");
});

test("numbersIn جداکننده‌ی خراب را هم می‌فهمد", () => {
  assert.deepEqual(numbersIn("۱۷/۵۸۹/۰۰۰ و ۱۲’۵۲۶’۰۰۰"), [17589000, 12526000]);
});
