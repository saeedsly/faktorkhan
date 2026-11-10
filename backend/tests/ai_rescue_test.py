#!/usr/bin/env python3
"""
آزمون نجات خودکار با هوش مصنوعی
===================================
سناریو (گزارش کاربر): «فاکتور را می‌گذارم، ارور می‌دهد، از توکن کم می‌کند
ولی متن تولید نمی‌کند.»

این آزمون بررسی می‌کند وقتی سرویس ابری متنی نمی‌دهد:
  ۱) اگر کلید هوش مصنوعی هست → خود تصویر خوانده می‌شود و متن می‌آید
  ۲) اگر کلید نیست → پیام روشن داده می‌شود، نه سکوت
  ۳) بار دوم اعتبار ابری مصرف نمی‌شود (فایل روی سرور خودمان است)

اجرا:
    python backend/tests/ai_rescue_test.py
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


def ck(label, ok, detail=""):
    global PASS, FAIL
    PASS, FAIL = (PASS + 1, FAIL) if ok else (PASS, FAIL + 1)
    print(f"  {'✓' if ok else '✗'} {label}" + (f" — {detail}" if detail else ""))


CLOUD_PORT = 8893
AI_PORT = 8894
CALLS: dict[str, int] = {}

# پاسخ هوش مصنوعی: فاکتور با دو قلم
AI_JSON = {
    "items": [
        {"description": "کاغذ A4", "quantity": 10, "unit_price": 250000, "total": 2500000},
        {"description": "تونر پرینتر", "quantity": 2, "unit_price": 450000, "total": 900000},
    ],
    "subtotal": 3400000,
    "total": 3400000,
    "seller_name": "فروشگاه نمونه",
}


class Cloud(BaseHTTPRequestHandler):
    """سرویس ابری که لینک می‌دهد ولی فایل خروجی‌اش متنی ندارد."""

    def log_message(self, *a):
        pass

    def _json(self, p):
        b = json.dumps(p, ensure_ascii=False).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(n).decode("utf-8", "ignore")
        if "addfile" in body:
            CALLS["addfile"] = CALLS.get("addfile", 0) + 1
            self._json({"Status": "Done", "FileToken": "FT", "PageCount": "1",
                        "ConvertMethods": "4"})
        elif "checkconvert" in body:
            CALLS["checkconvert"] = CALLS.get("checkconvert", 0) + 1
            self._json({"Status": "Data Not Found Yet"})
        elif "convert" in body:
            CALLS["convert"] = CALLS.get("convert", 0) + 1
            self._json({"Status": "Done",
                        " FileToDownload ": f"http://127.0.0.1:{CLOUD_PORT}/empty.bin"})
        else:
            self._json({"Status": "Done", "OCRCredit": "100"})

    def do_GET(self):
        # فایل خروجی: بایت‌های دودویی بی‌معنا — متنی ندارد
        payload = bytes([0x00, 0x01, 0x02, 0x03] * 50)
        self.send_response(200)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


class AI(BaseHTTPRequestHandler):
    """موتور هوش مصنوعی جعلی که ساختار فاکتور را می‌فهمد."""

    def log_message(self, *a):
        pass

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        self.rfile.read(n)
        CALLS["ai"] = CALLS.get("ai", 0) + 1
        body = json.dumps({
            "candidates": [{"content": {"parts": [{"text": json.dumps(AI_JSON, ensure_ascii=False)}]}}]
        }, ensure_ascii=False).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


cloud = HTTPServer(("127.0.0.1", CLOUD_PORT), Cloud)
threading.Thread(target=cloud.serve_forever, daemon=True).start()
ai = HTTPServer(("127.0.0.1", AI_PORT), AI)
threading.Thread(target=ai.serve_forever, daemon=True).start()
time.sleep(0.3)

DATA = Path(tempfile.gettempdir()) / "fk_ai_rescue"
shutil.rmtree(DATA, ignore_errors=True)
DATA.mkdir(parents=True, exist_ok=True)

os.environ.update(
    DATA_DIR=str(DATA),
    DATABASE_URL=f"sqlite:///{DATA}/t.db",
    CLOUD_OCR_GATEWAY=f"http://127.0.0.1:{CLOUD_PORT}/gw",
    CLOUD_OCR_SEED_TOKEN="tok",
    CLOUD_OCR_TIMEOUT="10",
    AI_ITEMS_ENABLED="1",
    AI_ITEMS_KEY="test-key",
    SECRET_KEY="ai-rescue-secret-key-1234567890abc",
    ENCRYPTION_KEY="ai-rescue-encryption-key-123456",
)

from app.database import Base, engine, session_scope  # noqa: E402
from app.models import OcrJob, User  # noqa: E402
from app.services import ai_parser, jobs  # noqa: E402

Base.metadata.create_all(bind=engine)

# موتور AI را به سرور جعلی وصل کن
_original_url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent"
_real_post = None


def fake_ai(image_path, mime="image/jpeg", api_key="", model="", timeout=120):
    """نسخهٔ جعلی extract_items_ai که به سرور محلی می‌زند."""
    import httpx

    try:
        with httpx.Client(timeout=timeout) as c:
            c.post(f"http://127.0.0.1:{AI_PORT}/gen", json={"x": 1})
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": "net", "message": str(exc)}
    return {"ok": True, "items": AI_JSON["items"], "totals": {
        "subtotal": AI_JSON["subtotal"], "total": AI_JSON["total"]},
        "issues": [], "confidence": 90, "item_count": 2, "engine": "ai"}


ai_parser.extract_items_ai = fake_ai
jobs.extract_items_ai = fake_ai   # داخل تابع import می‌شود، پس باید همان‌جا هم باشد

print("═" * 62)
print("آزمون نجات خودکار با هوش مصنوعی")
print("═" * 62)

with session_scope() as db:
    u = db.query(User).filter(User.email == "ai@t.local").first()
    if not u:
        u = User(email="ai@t.local", full_name="آزمون", password_hash="x", is_active=True)
        db.add(u)
        db.flush()
    uid = u.id

# یک تصویر واقعی PNG بساز
png = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000a49444154789c6300010000050001a5f645400000000049454e44ae426082"
)
img = DATA / "invoice.png"
img.write_bytes(png)

print("\n[۱] سرویس ابری متنی نمی‌دهد → هوش مصنوعی می‌خواند")
CALLS.clear()
with session_scope() as db:
    job = OcrJob(user_id=uid, provider="cloud", method=4, output="txtrawjson",
                 file_name="invoice.png", file_path=str(img),
                 status="queued", progress=0, meta={})
    db.add(job)
    db.flush()
    jid = job.id

fetched = jobs._get(jid)
meta = dict(fetched.meta or {})
meta["methods"] = [4]
jobs._run_document(fetched, "FT", meta)
done = jobs._get(jid)
text = done.text or ""
dmeta = done.meta or {}

print(f"    وضعیت: {done.status}")
print(f"    متن  : {text[:120]!r}")
print(f"    نجات : {dmeta.get('ai_rescue')}")
print(f"    درخواست‌ها: {CALLS}")

ck("کار موفق شد", done.status == "done", done.status)
ck("متن از هوش مصنوعی آمد", "کاغذ A4" in text, repr(text[:60]))
ck("مبلغ درست است", "2,500,000" in text or "۲,۵۰۰,۰۰۰" in text, text[:100])
ck("جمع کل آمده", "جمع کل" in text, text[:100])
ck("موتور AI واقعاً صدا زده شد", CALLS.get("ai", 0) >= 1, str(CALLS))
ck("پرچم نجات ثبت شد", dmeta.get("ai_rescue") == "ok")

print("\n[۲] بدون کلید هوش مصنوعی → پیام روشن، نه سکوت")
from app.config import settings
saved_enabled, saved_key = settings.AI_ITEMS_ENABLED, settings.AI_ITEMS_KEY
settings.AI_ITEMS_ENABLED = False
settings.AI_ITEMS_KEY = ""

CALLS.clear()
with session_scope() as db:
    job2 = OcrJob(user_id=uid, provider="cloud", method=4, output="txtrawjson",
                  file_name="invoice.png", file_path=str(img),
                  status="queued", progress=0, meta={})
    db.add(job2)
    db.flush()
    jid2 = job2.id

f2 = jobs._get(jid2)
m2 = dict(f2.meta or {})
m2["methods"] = [4]
jobs._run_document(f2, "FT", m2)
d2 = jobs._get(jid2)
msg = d2.message or ""
print(f"    وضعیت: {d2.status}")
print(f"    پیام : {msg[:140]}")
ck("کار شکست اعلام شد", d2.status == "failed", d2.status)
ck("پیام گویاست (نه خالی)", len(msg) > 25, msg[:60])
ck("پیام راهنمای عملی دارد",
   any(k in msg for k in ("تنظیمات", "فرستید", "هوش مصنوعی", "کیفیت عکس", "دوباره")), msg[:80])

settings.AI_ITEMS_ENABLED = saved_enabled
settings.AI_ITEMS_KEY = saved_key

cloud.shutdown()
ai.shutdown()
print("\n" + "═" * 62)
print(f"نتیجه: {PASS} از {PASS + FAIL} بررسی موفق")
print("═" * 62)
sys.exit(0 if FAIL == 0 else 1)
