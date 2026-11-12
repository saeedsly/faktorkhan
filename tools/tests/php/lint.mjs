#!/usr/bin/env node
/**
 * بررسی نحو (syntax) همهٔ فایل‌های PHP — بدون نیاز به PHP نصب‌شده
 * ==============================================================
 * روی ویندوز دستور `php -l file.php` این کار را می‌کند. در محیط
 * توسعهٔ ما PHP نصبی نیست، ولی php-wasm هست. این‌جا هر فایل را
 * عیناً (با `declare(strict_types=1)` و بدون هیچ تغییری) به
 * `token_get_all($code, TOKEN_PARSE)` می‌دهیم؛ این تابع یک تجزیه‌کنندهٔ
 * واقعی است و روی کد ناسالم ParseError می‌دهد. یعنی همان نتیجهٔ `php -l`.
 *
 * چرا این مهم است؟ چون یک ویرگول جاافتاده در یک فایل ۲٬۵۰۰ خطی،
 * در مرورگر فقط «خطای ۵۰۰» نشان می‌دهد و هیچ سرنخی نمی‌دهد.
 *
 * اجرا:  node tools/tests/php/lint.mjs
 */
import { PhpNode } from "php-wasm/PhpNode.mjs";
import fs from "fs";
import path from "path";

const SRC = new URL("../../../deploy/php", import.meta.url).pathname;
const files = fs.readdirSync(SRC)
  .filter((n) => n.endsWith(".php"))
  .sort();

const php = new PhpNode();
await new Promise((r) => php.addEventListener("ready", r));
let out = "";
php.addEventListener("output", (e) => { out += e.detail.join(""); });

await php.run('<?php @mkdir("/tmp/fkl", 0777, true);');
for (const n of files) {
  php.writeFile(`/tmp/fkl/${n}`, fs.readFileSync(path.join(SRC, n), "utf8"));
}

php.writeFile("/tmp/fkl/run.php", `<?php
ob_start();
$files = glob('/tmp/fkl/*.php') ?: array();
$bad = 0;
foreach ($files as $f) {
    if (basename($f) === 'run.php') continue;
    $code = (string) file_get_contents($f);
    try {
        token_get_all($code, TOKEN_PARSE);
        echo "OK   " . basename($f) . "\\n";
    } catch (ParseError $e) {
        $bad++;
        echo "FAIL " . basename($f) . " — " . $e->getMessage()
            . " (خط " . $e->getLine() . ")\\n";
    }
}
echo $bad === 0 ? "ALL-OK\\n" : ("BAD:" . $bad . "\\n");
while (ob_get_level()) ob_end_flush();
`);
await php.run('<?php require "/tmp/fkl/run.php";');

/* فقط خطوط گزارش را نگه دار */
const lines = out.split("\n").filter((l) => /^(OK|FAIL|BAD:)/.test(l.trim()));
for (const l of lines) {
  const ok = l.trim().startsWith("OK");
  console.log(`  ${ok ? "✓" : "✗"} ${l.trim()}`);
}
const failed = lines.filter((l) => l.trim().startsWith("FAIL")).length;
console.log("");
console.log(failed === 0 ? `✓ نحو همهٔ ${lines.length - 1} فایل سالم است` : `✗ ${failed} فایل خطای نحو دارد`);
process.exit(failed === 0 ? 0 : 1);
