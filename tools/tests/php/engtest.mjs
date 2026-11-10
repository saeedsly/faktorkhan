import { PhpNode } from "php-wasm/PhpNode.mjs";
import fs from "fs";
const SRC = new URL("../../../deploy/php", import.meta.url).pathname;
const eng = fs.readFileSync(`${SRC}/engine.php`, "utf8").replace(/^<\?php/, "").replace("declare(strict_types=1);", "");

let pass = 0, fail = 0;
const check = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? " — " + extra : "")); }
};

async function runPhp(code) {
  const php = new PhpNode();
  await new Promise(r => php.addEventListener("ready", r));
  let out = "";
  php.addEventListener("output", e => { out += e.detail.join(""); });
  await php.run(`<?php
ini_set('display_errors','0'); error_reporting(E_ALL & ~E_DEPRECATED);
${eng}
${code}`);
  await new Promise(r => setTimeout(r, 300));
  return out;
}

const t1 = await runPhp(`
$r = array(
 "chars" => fk_norm_chars("كتاب"),
 "digits" => fk_digits_latin("۱۲۳۴۵۶۷۸۹۰"),
 "amount1" => fk_parse_amount("۱٬۲۵۰٬۰۰۰"),
 "amount2" => fk_parse_amount("4,500,000"),
 "amount3" => fk_parse_amount("4500000"),
 "amount4" => fk_parse_amount("(1,200)"),
 "amount5" => fk_parse_amount("1.250.000"),
 "amount6" => fk_parse_amount("12٫5"),
 "amount7" => fk_parse_amount(""),
 "fmt1" => fk_fmt_amount(1250000),
 "fmt2" => fk_fmt_amount(-500),
 "canon" => fk_canonical_numbers("جمع ۱۲٬۵۰۰٬۰۰۰ و 4500000"),
);
echo "@@J" . base64_encode(json_encode($r, JSON_UNESCAPED_UNICODE)) . "J@@";
`);

console.log("\n[۱] نویسه‌ها و اعداد");
const m1 = t1.match(/@@J([A-Za-z0-9+/=]+)J@@/);
if (!m1) { console.log("RAW:", t1.slice(0, 500)); process.exit(1); }
const r = JSON.parse(Buffer.from(m1[1], "base64").toString("utf8"));
check("ك عربی → ک فارسی", r.chars.includes("ک"), JSON.stringify(r.chars));
check("ارقام فارسی → لاتین", r.digits === "1234567890", r.digits);
check("۱٬۲۵۰٬۰۰۰ → 1250000", r.amount1 === 1250000, String(r.amount1));
check("4,500,000 → 4500000", r.amount2 === 4500000, String(r.amount2));
check("4500000 → 4500000", r.amount3 === 4500000, String(r.amount3));
check("(1,200) → -1200", r.amount4 === -1200, String(r.amount4));
check("1.250.000 → 1250000", r.amount5 === 1250000, String(r.amount5));
check("12٫5 → 13", r.amount6 === 13, String(r.amount6));
check("خالی → 0", r.amount7 === 0, String(r.amount7));
check("قالب 1,250,000", r.fmt1 === "1,250,000", r.fmt1);
check("قالب منفی", r.fmt2 === "-500", r.fmt2);
check("یکدست‌سازی اعداد در متن", r.canon.includes("12,500,000"), r.canon);

console.log(`\nنتیجه: ${pass} از ${pass+fail}`);
process.exit(fail ? 1 : 0);
