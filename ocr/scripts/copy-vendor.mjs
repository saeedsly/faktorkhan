// کپی فایل‌های مرورگری tesseract.js و داده‌ی زبان فارسی/انگلیسی از node_modules به public/vendor
import { cpSync, mkdirSync, readdirSync, copyFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const out = path.join(root, "public", "vendor");
const nm = (...p) => path.join(root, "node_modules", ...p);

mkdirSync(path.join(out, "tesseract"), { recursive: true });
mkdirSync(path.join(out, "core"), { recursive: true });
mkdirSync(path.join(out, "lang"), { recursive: true });

copyFileSync(nm("tesseract.js", "dist", "tesseract.min.js"), path.join(out, "tesseract", "tesseract.min.js"));
copyFileSync(nm("tesseract.js", "dist", "worker.min.js"), path.join(out, "tesseract", "worker.min.js"));
for (const f of readdirSync(nm("tesseract.js-core"))) {
  if (f.startsWith("tesseract-core")) copyFileSync(nm("tesseract.js-core", f), path.join(out, "core", f));
}
copyFileSync(nm("@tesseract.js-data", "fas", "4.0.0_best_int", "fas.traineddata.gz"), path.join(out, "lang", "fas.traineddata.gz"));
copyFileSync(nm("@tesseract.js-data", "eng", "4.0.0_best_int", "eng.traineddata.gz"), path.join(out, "lang", "eng.traineddata.gz"));
console.log("vendor files copied to", out);
