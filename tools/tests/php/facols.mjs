import { PhpNode } from "php-wasm/PhpNode.mjs";
import fs from "fs";

/*
 * آزمون فاکتور فارسی در PHP — جداکنندهٔ خط تیره و واحد در ستون تعداد
 * ====================================================================
 * باگ واقعی: فاکتور چاپی فارسی ستون‌ها را با خط تیره جدا می‌کند:
 *
 *     کاغذ A4 — ۱۰ بسته — ۲۵۰,۰۰۰
 *
 * و ستون تعداد واحد دارد («۱۰ بسته»). موتور PHP:
 *   • خط تیره را جداکننده نمی‌دانست → کل سطر یک سلول
 *   • «۱۰ بسته» را عدد نمی‌دانست → تعداد ۱ فرض می‌شد
 * نتیجه: جدول اقلام خالی یا با تعداد غلط، در حالی که متن درست بود.
 * کاربر این را «فاکتور را نفهمید» تعبیر می‌کرد.
 *
 * نسخهٔ پایتون همان اصلاح را دارد (backend/tests/fa_columns_test.py).
 */

const SRC = new URL("../../../deploy/php", import.meta.url).pathname;
const B = (s) => Buffer.from(s, "utf8").toString("base64");
const engine = fs.readFileSync(`${SRC}/engine.php`, "utf8");

let fails = 0;
const ck = (l, c, e = "") => {
  if (!c) fails++;
  console.log(`  ${c ? "✓" : "✗"} ${l}${e ? " — " + e : ""}`);
};

const php = new PhpNode();
await new Promise((r) => php.addEventListener("ready", r));
let out = "";
php.addEventListener("output", (e) => {
  out += e.detail.join("");
});

const CASES = [
  {
    label: "خط تیرهٔ فارسی (—) با واحد",
    text: "فاکتور فروش\nشماره: ۱۴۰۴۰۹۱۵\nکاغذ A4 — ۱۰ بسته — ۲۵۰,۰۰۰\nتونر HP — ۲ عدد — ۴۵۰,۰۰۰\nجمع کل: ۳,۴۰۰,۰۰۰",
    want: [
      { name: "کاغذ", qty: 10, total: 2500000 },
      { name: "تونر", qty: 2, total: 900000 },
    ],
    sum: 3400000,
    total: 3400000,
  },
  {
    label: "خط تیرهٔ ساده (-)",
    text: "کاغذ A4 - ۵ بسته - ۱۰۰,۰۰۰\nجمع کل: ۵۰۰,۰۰۰",
    want: [{ name: "کاغذ", qty: 5, total: 500000 }],
    sum: 500000,
    total: 500000,
  },
  {
    label: "بدون واحد در ستون تعداد",
    text: "پرینتر لیزری — ۲ — ۸,۵۰۰,۰۰۰\nجمع کل: ۱۷,۰۰۰,۰۰۰",
    want: [{ name: "پرینتر", qty: 2, total: 17000000 }],
    sum: 17000000,
    total: 17000000,
  },
  {
    label: "ستون‌بندی با تب (فاکتور حرارتی)",
    text: "کاغذ A4\t۱۰ بسته\t۲۵۰,۰۰۰\nجمع کل: ۲,۵۰۰,۰۰۰",
    want: [{ name: "کاغذ", qty: 10, total: 2500000 }],
    sum: 2500000,
    total: 2500000,
  },
  {
    label: "ممیز عمودی (|)",
    text: "کابل شبکه | ۳ عدد | ۱۲۰,۰۰۰\nجمع کل: ۳۶۰,۰۰۰",
    want: [{ name: "کابل", qty: 3, total: 360000 }],
    sum: 360000,
    total: 360000,
  },
  {
    label: "فقط شرح و مبلغ، بدون تعداد",
    text: "خدمات نصب — ۵۰۰,۰۰۰\nجمع کل: ۵۰۰,۰۰۰",
    want: [{ name: "خدمات", qty: 1, total: 500000 }],
    sum: 500000,
    total: 500000,
  },
];

console.log("═".repeat(64));
console.log("فاکتور فارسی — موتور PHP");
console.log("═".repeat(64));

for (const c of CASES) {
  console.log(`\n[${c.label}]`);
  await php.run(`<?php
ini_set('display_errors','1');
error_reporting(E_ALL & ~E_DEPRECATED & ~E_WARNING & ~E_NOTICE);
file_put_contents('/tmp/eng.php', base64_decode('${B(engine)}'));
require_once '/tmp/eng.php';
$u = fk_understand(base64_decode('${B(c.text)}'));
echo "RES:" . json_encode(array(
  'items' => $u['items'] ?? array(),
  'totals' => $u['totals'] ?? array(),
  'confidence' => $u['confidence'] ?? 0,
), JSON_UNESCAPED_UNICODE) . ":END";
`);
  await new Promise((r) => setTimeout(r, 400));

  const m = out.match(/RES:([\s\S]*?):END/);
  out = "";
  const r = m ? JSON.parse(m[1]) : { items: [], totals: {} };
  const items = r.items || [];

  ck(`${c.want.length} قلم`, items.length === c.want.length, `${items.length} قلم`);

  c.want.forEach((w, i) => {
    const it = items[i];
    if (!it) {
      ck(`قلم ${i + 1} («${w.name}»)`, false, "وجود ندارد");
      return;
    }
    ck(
      `قلم ${i + 1} نامش «${w.name}»`,
      String(it.description || "").includes(w.name),
      String(it.description || "")
    );
    ck(`قلم ${i + 1} تعداد ${w.qty}`, Number(it.qty) === w.qty, String(it.qty));
    ck(
      `قلم ${i + 1} مبلغ ${w.total.toLocaleString("en")}`,
      Number(it.total) === w.total,
      Number(it.total).toLocaleString("en")
    );
  });

  const sum = Number((r.totals || {}).items_sum || 0);
  ck(
    `جمع اقلام ${c.sum.toLocaleString("en")}`,
    sum === c.sum,
    sum.toLocaleString("en")
  );
  const total = Number((r.totals || {}).total || 0);
  ck(`جمع کل ${c.total.toLocaleString("en")}`, total === c.total, total.toLocaleString("en"));
}

console.log("\n" + "═".repeat(64));
console.log(fails === 0 ? "✓ همه بررسی‌ها موفق" : `✗ ${fails} بررسی ناموفق`);
process.exit(fails === 0 ? 0 : 1);
