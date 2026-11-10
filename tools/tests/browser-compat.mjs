#!/usr/bin/env node
/*
 * تست رگرسیون سازگاری مرورگر — فاکتورخوان
 *
 * داستان این تست: کاربری با کروم تازه‌به‌روزرسانی‌شده پیام «مرورگر شما
 * به‌روز نیست» می‌دید. علت این بود که compat.js برای آزمودن جاوااسکریپت از
 * new Function استفاده می‌کرد و CSP خودِ برنامه (script-src 'self') آن را
 * مسدود می‌کرد. این تست همان سناریو را بازسازی می‌کند.
 *
 * اجرا:
 *     npm i jsdom
 *     node tools/tests/browser-compat.mjs
 */
import { JSDOM } from "jsdom";
import fs from "fs";
import path from "path";
import vm from "vm";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, "../../frontend/assets/js/compat.js");
const code = fs.readFileSync(SRC, "utf8");
let pass = 0, fail = 0;
const ck = (n, c, e = "") => { c ? pass++ : fail++; console.log(`  ${c ? "✓" : "✗"} ${n}${e ? " — " + e : ""}`); };

function run({ csp = false, noLS = false, oldBrowser = false } = {}) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body><div id="app"></div></body></html>`,
    { runScripts: "outside-only", url: "https://example.com/" });
  const w = dom.window;
  if (typeof w.fetch !== "function") {
    Object.defineProperty(w, "fetch", { value: async () => ({}), configurable: true });
  }
  if (noLS) {
    Object.defineProperty(w, "localStorage", { get() { throw new Error("SecurityError"); }, configurable: true });
    Object.defineProperty(w, "sessionStorage", { get() { throw new Error("SecurityError"); }, configurable: true });
  }
  if (oldBrowser) {
    ["Symbol", "Map", "Set", "Promise", "WeakMap"].forEach(k => {
      try { Object.defineProperty(w, k, { value: undefined, configurable: true }); } catch (e) {}
    });
    try { delete w.fetch; } catch (e) {}
    try { delete w.Object.assign; } catch (e) {}
    try { delete w.Array.prototype.includes; } catch (e) {}
  }
  if (csp) {
    // CSP: eval و new Function ممنوع
    Object.defineProperty(w, "eval", { value: () => { const e = new Error("EvalError"); e.name = "EvalError"; throw e; }, configurable: true });
    Object.defineProperty(w, "Function", { value: function (...a) {
      if (a.some(x => typeof x === "string")) { const e = new Error("EvalError"); e.name = "EvalError"; throw e; }
    }, configurable: true });
  }
  // اجرا از بیرون (مثل اینکه مرورگر اسکریپت را اجرا کند)
  return { w, dom };
}

function exec(w, dom) {
  const ctx = dom.getInternalVMContext ? dom.getInternalVMContext() : vm.createContext(w);
  vm.runInContext(code, ctx);
}

console.log("\n[۱] صفحه با CSP سخت‌گیرانه (حالت واقعی برنامه)");
{
  const { w, dom } = run({ csp: true });
  exec(w, dom);
  ck("بدون خطا اجرا شد", !!w.FKCompat);
  ck("problems خالی", w.FKCompat.problems.length === 0, JSON.stringify(w.FKCompat.problems));
  ck("هیچ نوار هشداری", !w.document.getElementById("fk-compat-warning"));
  ck("FKBlocksApp=false", w.FKBlocksApp === false);
}

console.log("\n[۲] کروم سالم، بدون CSP");
{
  const { w, dom } = run({});
  exec(w, dom);
  ck("problems خالی", w.FKCompat.problems.length === 0);
  ck("هیچ هشداری", !w.document.getElementById("fk-compat-warning"));
}

console.log("\n[۳] حالت ناشناس: localStorage مسدود");
{
  const { w, dom } = run({ noLS: true });
  const origWarn = console.warn; console.warn = () => {};
  exec(w, dom);
  console.warn = origWarn;
  ck("برنامه بلاک نمی‌شود", w.FKBlocksApp === false);
  ck("hardFatal=false", w.FKCompat.hardFatal === false);
  ck("هیچ نوار هشداری (فقط لاگ)", !w.document.getElementById("fk-compat-warning"));
}

console.log("\n[۴] مرورگر واقعاً قدیمی");
{
  const { w, dom } = run({ oldBrowser: true });
  exec(w, dom);
  ck("hardFatal=true", w.FKCompat.hardFatal === true);
  const bar = w.document.getElementById("fk-compat-warning");
  ck("نوار هشدار نمایش داده شد", !!bar);
  ck("نوار بسته‌شدنی است", !!(bar && bar.querySelector("button")));
  ck("پیام ادعای «صفحهٔ مسدود» ندارد", bar ? !bar.textContent.includes("پشتیبانی نمی‌شود") : true);
}

console.log("\n[۵] بررسی ایستا (بدون اجرا)");
{
  const stripped = code.replace(/\/\*[\s\S]*?\*\//g, "");
  ck("new Function در کد نیست", !/new Function\s*\(/.test(stripped));
  ck("eval( در کد نیست", !/\beval\s*\(/.test(stripped));
  ck("FKBlocksApp هرگز true نمی‌شود", !/FKBlocksApp\s*=\s*true/.test(stripped));
  ck("لایهٔ تمام‌صفحه ندارد", !code.includes("z-index:99999"));
}

console.log(`\nنتیجه: ${pass} از ${pass + fail}`);
process.exit(fail ? 1 : 0);
