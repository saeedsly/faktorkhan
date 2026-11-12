#!/usr/bin/env node
/**
 * ساخت بسته‌های دانلود نسخهٔ PHP
 * ==============================
 * پیش از این، زیپ‌ها با دستورهای یک‌بارمصرف ساخته می‌شدند و بعد از
 * هر تغییر کد، بستهٔ دانلود از قلم می‌افتاد. یک کاربر می‌توانست فایل
 * قدیمی بگیرد و بگوید «هنوز خراب است». حالا یک دستور:
 *
 *     node tools/build-php-zips.mjs
 *
 * دو بسته می‌سازد:
 *   ۱) downloads/faktorkhan-php-htdocs.zip  — فقط فایل‌های لازم برای
 *      کپی در www/ (پوشهٔ faktorkhan/). بدون داده، بدون تست، بدون ابزار.
 *   ۲) downloads/faktorkhan-v1.0.0.zip      — کد منبع کامل از فایل‌های
 *      ردیابی‌شدهٔ git (بدون زیپ‌های دانلود و بدون پوشهٔ داده).
 *
 * تست‌ها و پوشهٔ داده عمداً بیرون می‌مانند: کاربر نباید ۳۰۰ کیلوبایت
 * تست php-wasm را در www خودش ببیند، و بایگانی کاربران هم نباید منتشر شود.
 */
import fs from "fs";
import path from "path";
import { execSync } from "node:child_process";

const ROOT = new URL("../", import.meta.url).pathname;
const SRC = path.join(ROOT, "deploy/php");

/* ستون‌های zip: نام فایل، حجم فشرده */
async function writeZip(outFile, entries) {
  /* zip بدون کتابخانهٔ بیرونی: از دستور zip استفاده نمی‌کنیم (روی
     ویندوز نیست)، پس فرمت ZIP را با deflate می‌سازیم. */
  const zlib = await import("node:zlib");
  const chunks = [];
  const central = [];
  let offset = 0;

  const dosTime = () => {
    const d = new Date();
    return {
      time: ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff,
      date: (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff,
      stamp: Date.now(),
    };
  };
  void dosTime;

  for (const { name, data } of entries) {
    const raw = Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8");
    const deflated = zlib.deflateRawSync(raw, { level: 9 });
    const useDeflate = deflated.length < raw.length;
    const body = useDeflate ? deflated : raw;
    const method = useDeflate ? 8 : 0;
    const crc = zlib.crc32 ? zlib.crc32(raw) >>> 0 : crc32(raw);

    const now = new Date();
    const time = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff;
    const date = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);          /* version needed */
    local.writeUInt16LE(0x0800, 6);      /* UTF-8 flag */
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(Buffer.byteLength(name, "utf8"), 26);
    local.writeUInt16LE(0, 28);

    const nameBuf = Buffer.from(name, "utf8");
    chunks.push(local, nameBuf, body);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(time, 12);
    cd.writeUInt16LE(date, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(body.length, 20);
    cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);

    offset += local.length + nameBuf.length + body.length;
  }

  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cdBuf.length, 12);
  end.writeUInt32LE(offset, 16);

  fs.writeFileSync(outFile, Buffer.concat([...chunks, cdBuf, end]));
  return fs.statSync(outFile).size;
}

/* CRC32 بدون zlib.crc32 (Node قدیمی‌تر) */
let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[i] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

/* ─────────── بستهٔ htdocs ─────────── */
const SKIP_DIRS = new Set(["fk-data", "fk-sessions", "fk-jobs", "fk-uploads", "fk-invoices"]);
const SKIP_FILES = new Set(["fk-config.json", "fk-owner", "fk-lock.json", ".htaccess.bak"]);

function collectHtdocs() {
  const out = [];
  const walk = (dir, rel) => {
    for (const name of fs.readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      const relPath = rel ? `${rel}/${name}` : name;
      const st = fs.statSync(full);
      if (st.isDirectory()) {
        if (SKIP_DIRS.has(name)) continue;
        walk(full, relPath);
      } else {
        if (SKIP_FILES.has(name) || /\.(log|tmp|bak)$/.test(name)) continue;
        out.push({ name: `faktorkhan/${relPath}`, data: fs.readFileSync(full) });
      }
    }
  };
  walk(SRC, "");
  return out;
}

/* ─────────── بستهٔ منبع ─────────── */
function collectSource() {
  const tracked = execSync("git ls-files -z", { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 })
    .toString("utf8").split("\0").filter(Boolean);
  const skipDirs = new Set(["__pycache__", ".pytest_cache", "fk-data", "fk-sessions",
                            "fk-jobs", "fk-uploads", "fk-invoices", "node_modules"]);
  const skipFiles = new Set(["fk-config.json", "fk-owner", "fk-lock.json", ".env",
                             "thumbs.db", ".DS_Store"]);
  const entries = [{ name: "faktorkhan/", data: "" }];
  for (const t of tracked.sort()) {
    if (t.startsWith("downloads/") || t.startsWith(".git/")) continue;
    const parts = t.split("/");
    if (parts.some((p) => skipDirs.has(p))) continue;
    if (skipFiles.has(parts[parts.length - 1])) continue;
    const full = path.join(ROOT, t);
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) continue;
    entries.push({ name: `faktorkhan/${t}`, data: fs.readFileSync(full) });
  }
  return entries;
}

const htdocs = collectHtdocs();
const size1 = await writeZip(path.join(ROOT, "downloads/faktorkhan-php-htdocs.zip"), htdocs);
const source = collectSource();
const size2 = await writeZip(path.join(ROOT, "downloads/faktorkhan-v1.0.0.zip"), source);

console.log("═".repeat(60));
console.log("بسته‌های دانلود ساخته شد");
console.log("═".repeat(60));
console.log(`  htdocs  ${String(htdocs.length).padStart(3)} فایل  ${(size1 / 1024).toFixed(0)} KB`);
console.log(`  source  ${String(source.length).padStart(3)} فایل  ${(size2 / 1024).toFixed(0)} KB`);
