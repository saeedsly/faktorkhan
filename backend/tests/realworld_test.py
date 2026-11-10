#!/usr/bin/env python3
"""
آزمون «دنیای واقعی» سرویس ابری
==================================
گزارش کاربر: «وارد می‌شوم، همه‌چیز اوکی است، ولی فاکتور را که می‌گذارم
همش ارور می‌دهد، از توکن کم می‌کند ولی متن تولید نمی‌کند.»

این آزمون همان شرایط واقعی را با تنوع زیادی از پاسخ‌های ممکن سرویس
بازسازی می‌کند، چون نمی‌دانیم سرویس دقیقاً چه می‌فرستد:

  ۱) لینک با پسوند ناشناخته یا بدون پسوند
  ۲) لینک با پارامترهای اضافی (?token=…&x=1)
  ۳) لینک با پسوند بزرگ (.DOCX)
  ۴) فایل خروجی docx ولی نامش .txt
  ۵) لینک نامعتبر/۴۰۴ ولی متن در checkconvert موجود
  ۶) متن فقط در checkconvert (لینک وجود ندارد)
  ۷) لینک با redirect
  ۸) خروجی به شکل ZIP حاوی txt

هدف: در هر حالت، اگر سرور متنی دارد، کاربر باید آن را ببیند.

اجرا:
    python backend/tests/realworld_test.py
"""
from __future__ import annotations

import io
import json
import os
import shutil
import sys
import tempfile
import threading
import time
import zipfile
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

PASS = 0
FAIL = 0


def ck(label: str, ok: bool, detail: str = "") -> None:
    global PASS, FAIL
    PASS, FAIL = (PASS + 1, FAIL) if ok else (PASS, FAIL + 1)
    print(f"  {'✓' if ok else '✗'} {label}" + (f" — {detail}" if detail else ""))


def make_docx(lines: list[str]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        body = "".join(f"<w:p><w:r><w:t>{ln}</w:t></w:r></w:p>" for ln in lines)
        z.writestr("word/document.xml", f"<w:document><w:body>{body}</w:body></w:document>")
    return buf.getvalue()


def make_zip_txt(text: str) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("output.txt", text)
    return buf.getvalue()


DOCX = make_docx([
    "فاکتور فروش شرکت نمونه",
    "شماره: ۱۴۰۴۰۹۱۵",
    "کاغذ A4 — ۱۰ بسته — ۲۵۰,۰۰۰",
    "جمع کل: ۲,۵۰۰,۰۰۰",
])
ZIPTXT = make_zip_txt("فاکتور داخل زیپ\nجمع کل: ۱,۰۰۰,۰۰۰")

# محتوایی که هر سناریو برمی‌گرداند
SCENARIO: dict = {"name": ""}


class Fake(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _json(self, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _file(self, body: bytes, ctype: str = "application/octet-stream") -> None:
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:  # noqa: N802
        n = int(self.headers.get("Content-Length") or 0)
        text = self.rfile.read(n).decode("utf-8", "ignore")
        name = SCENARIO["name"]

        if "addfile" in text:
            self._json({"Status": "Done", "FileToken": "FT", "PageCount": "1",
                        "ConvertMethods": "4"})
            return

        if "checkconvert" in text:
            if name == "check_only":
                self._json({"Status": "Done", "Progress": "100",
                            "Output": "متن از checkconvert\nجمع کل: ۹۹۹,۰۰۰"})
            elif name == "dead_link":
                self._json({"Status": "Done", "Progress": "100",
                            "Output": "متن نجات‌یافته\nجمع کل: ۷۷۷,۰۰۰"})
            else:
                self._json({"Status": "Data Not Found Yet"})
            return

        if "convert" in text:
            url = {
                "no_ext":   f"http://127.0.0.1:{PORT}/download/file",
                "query":    f"http://127.0.0.1:{PORT}/dl?token=abc&x=1",
                "upper":    f"http://127.0.0.1:{PORT}/OUT.DOCX",
                "mislabel": f"http://127.0.0.1:{PORT}/file.txt",     # ولی docx است
                "dead_link": f"http://127.0.0.1:{PORT}/missing.docx",
                "check_only": f"http://127.0.0.1:{PORT}/dl?x=y",
                "zip":      f"http://127.0.0.1:{PORT}/out.zip",
                "redirect": f"http://127.0.0.1:{PORT}/go",
            }.get(name, f"http://127.0.0.1:{PORT}/file.docx")
            self._json({"Status": "Done", " FileToDownload ": url})
            return

        self._json({"Status": "Done", "OCRCredit": "500"})

    def do_GET(self) -> None:  # noqa: N802
        name = SCENARIO["name"]
        path = self.path.split("?")[0]

        if path == "/go":
            self.send_response(302)
            self.send_header("Location", f"http://127.0.0.1:{PORT}/file.docx")
            self.end_headers()
            return

        if name == "dead_link" or path == "/missing.docx":
            self.send_response(404)
            self.end_headers()
            return

        if name == "zip" or path.endswith(".zip"):
            self._file(ZIPTXT, "application/zip")
            return

        # بقیه: بدنهٔ docx (حتی اگر نام فایل .txt باشد)
        self._file(DOCX, "application/vnd.openxmlformats-officedocument"
                         ".wordprocessingml.document")


PORT = 8891
DATA = Path(tempfile.gettempdir()) / "fk_realworld"
shutil.rmtree(DATA, ignore_errors=True)
DATA.mkdir(parents=True, exist_ok=True)

os.environ.update(
    DATA_DIR=str(DATA),
    DATABASE_URL=f"sqlite:///{DATA}/t.db",
    CLOUD_OCR_GATEWAY=f"http://127.0.0.1:{PORT}/gw",
    CLOUD_OCR_SEED_TOKEN="tok",
    CLOUD_OCR_TIMEOUT="15",
    SECRET_KEY="realworld-secret-key-1234567890abcd",
    ENCRYPTION_KEY="realworld-encryption-key-1234567",
)

server = HTTPServer(("127.0.0.1", PORT), Fake)
threading.Thread(target=server.serve_forever, daemon=True).start()
time.sleep(0.3)

from app.database import Base, engine, session_scope  # noqa: E402
from app.models import OcrJob, User  # noqa: E402
from app.services import jobs  # noqa: E402

Base.metadata.create_all(bind=engine)

print("═" * 64)
print("آزمون دنیای واقعی — هر شکلی که سرویس پاسخ بدهد")
print("═" * 64)

CASES = [
    ("no_ext",     "لینک بدون پسوند",                 "فاکتور فروش"),
    ("query",      "لینک با پارامترهای اضافی",        "فاکتور فروش"),
    ("upper",      "پسوند بزرگ .DOCX",                "فاکتور فروش"),
    ("mislabel",   "نام .txt ولی محتوا docx",         "فاکتور فروش"),
    ("redirect",   "لینک با redirect",                "فاکتور فروش"),
    ("zip",        "خروجی ZIP حاوی txt",              "فاکتور داخل زیپ"),
    ("dead_link",  "لینک ۴۰۴ ولی checkconvert متن دارد", "متن نجات‌یافته"),
    ("check_only", "لینک بی‌محتوا، متن در checkconvert", "متن از checkconvert"),
]

with session_scope() as db:
    u = db.query(User).filter(User.email == "rw@t.local").first()
    if not u:
        u = User(email="rw@t.local", full_name="آزمون", password_hash="x", is_active=True)
        db.add(u)
        db.flush()
    USER_ID = u.id

for key, label, needle in CASES:
    SCENARIO["name"] = key
    with session_scope() as db:
        job = OcrJob(user_id=USER_ID, provider="cloud", method=4, output="txtrawjson",
                     file_name="inv.png", file_path="/tmp/x.png",
                     status="queued", progress=0, meta={})
        db.add(job)
        db.flush()
        jid = job.id

    fetched = jobs._get(jid)
    meta = dict(fetched.meta or {})
    meta["methods"] = [4]
    try:
        jobs._run_document(fetched, "FT", meta)
    except Exception as exc:                     # noqa: BLE001
        ck(label, False, f"استثنا: {type(exc).__name__}")

    done = jobs._get(jid)
    text = done.text or ""
    src = (done.meta or {}).get("text_source", "?")
    ck(label, needle in text,
       f"وضعیت={done.status} منبع={src} متن={text[:40]!r}")

server.shutdown()
print("\n" + "═" * 64)
print(f"نتیجه: {PASS} از {PASS + FAIL} بررسی موفق")
print("═" * 64)
sys.exit(0 if FAIL == 0 else 1)
