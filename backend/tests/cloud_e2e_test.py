#!/usr/bin/env python3
"""
تست سرتاسری مسیر سرویس ابری — با سرور جعلی که مثل سرویس واقعی رفتار می‌کند
=========================================================================
داستان این تست (باگ واقعی گزارش‌شده):

    «سرویس ابری خروجی متنی برنگرداند.»

سه علت داشت و هر سه در نسخهٔ فعلی برطرف شده‌اند. این تست هر سه را بازسازی
می‌کند تا دیگر برنگردند:

  ۱. سرویس لینک خروجی را با **کلید دارای فاصله** برمی‌گرداند:
         { "Status": "Done", " FileToDownload ": "https://…/out.docx" }
     تطبیق دقیق شکست می‌خورد، لینک پیدا نمی‌شد، خروجی خالی می‌ماند.

  ۲. خروجی سرویس **docx** است (نه txt). کد قبلی فقط txt/json/csv/html را
     می‌خواند؛ اگر docx می‌آمد متن خالی می‌ماند ولی کار «موفق» اعلام می‌شد —
     بدترین حالت: کاربر فکر می‌کند متن نیست، در حالی که اعتبار کم شده.

  ۳. `checkconvert` برای عکس «Data Not Found Yet» می‌گوید. کد قبلی این را
     خطای مرگ‌آور می‌دانست و کار را می‌کشت.

اجرا:
    python backend/tests/cloud_e2e_test.py
"""
from __future__ import annotations

import io
import json
import os
import sys
import tempfile
import threading
import time
import zipfile
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
BACKEND = HERE.parent
sys.path.insert(0, str(BACKEND))

PASSED = 0
FAILED = 0


def check(label: str, ok: bool, detail: str = "") -> None:
    global PASSED, FAILED
    if ok:
        PASSED += 1
        print(f"  ✓ {label}")
    else:
        FAILED += 1
        print(f"  ✗ {label}" + (f" — {detail}" if detail else ""))


# ── فایل خروجی جعلی به شکل docx (همان چیزی که سرویس واقعی می‌دهد) ──
def _make_docx() -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as bundle:
        bundle.writestr(
            "word/document.xml",
            "<w:document><w:body>"
            "<w:p><w:r><w:t>فاکتور فروش</w:t></w:r></w:p>"
            "<w:p><w:r><w:t>شماره: ۱۴۰۴۰۹۱۵</w:t></w:r></w:p>"
            "<w:p><w:r><w:t>کاغذ A4 — ۱۰ بسته — ۲۵۰,۰۰۰</w:t></w:r></w:p>"
            "<w:p><w:r><w:t>جمع کل: ۲,۵۰۰,۰۰۰</w:t></w:r></w:p>"
            "</w:body></w:document>",
        )
    return buffer.getvalue()


DOCX = _make_docx()
CALLS: dict[str, int] = {}
MODE: dict[str, object] = {"invalid": False}


class FakeService(BaseHTTPRequestHandler):
    """سرویس جعلی با همان رفتارهای عجیبِ سرویس واقعی."""

    def log_message(self, *args) -> None:  # ساکت
        pass

    def _send(self, payload: dict, code: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get("Content-Length") or 0)
        text = self.rfile.read(length).decode("utf-8", "ignore")
        command = ""
        for candidate in ("addfile", "checkconvert", "convert", "checkcredit", "deletefile"):
            if candidate in text:
                command = candidate
                break
        CALLS[command] = CALLS.get(command, 0) + 1

        if command == "addfile":
            self._send({"Status": "Done", "FileToken": "TOKEN-ABC-123",
                        "PageCount": "1", "ConvertMethods": "4"})
        elif command == "convert":
            if MODE.get("invalid") == "always":
                self._send({"Status": "InvalidParams", "Message": "method is required"})
                return
            if MODE.get("invalid") == "output":
                # سرویس output را با این روش نمی‌پذیرد — پایهٔ باگ واقعی
                if "output=" in text or "output" in text:
                    CALLS["rejected_output"] = CALLS.get("rejected_output", 0) + 1
                    self._send({"Status": "InvalidParams", "Message": "output is not valid for this method"})
                    return
            if MODE.get("invalid") == "method1":
                if "method=1" in text:
                    CALLS["rejected_method1"] = CALLS.get("rejected_method1", 0) + 1
                    self._send({"Status": "InvalidParams", "Message": "method 1 not allowed"})
                    return
            # حالت عادی: کلید با فاصله در دو طرف
            self._send({"Status": "Done", " FileToDownload ": f"http://127.0.0.1:{PORT}/out.docx"})
        elif command == "checkconvert":
            if MODE.get("check_invalid"):
                # باگ واقعی: سرویس به checkconvert (که فقط command و
                # filetoken دارد) با InvalidParams جواب می‌دهد. کار نباید بمیرد.
                self._send({"Status": "InvalidParams"})
                return
            # علت ۳: «هنوز آماده نیست» — نباید کار را بکشد
            self._send({"Status": "Data Not Found Yet"})
        elif command == "checkcredit":
            self._send({"Status": "Done", "OCRCredit": "1500", "AudioTranscribeCredit": "0"})
        else:
            self._send({"Status": "Done"})

    def do_GET(self) -> None:  # noqa: N802
        if self.path.startswith("/out.docx"):
            self.send_response(200)
            self.send_header("Content-Type",
                             "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
            self.send_header("Content-Length", str(len(DOCX)))
            self.end_headers()
            self.wfile.write(DOCX)
        else:
            self.send_response(404)
            self.end_headers()


PORT = 8877
DATA_DIR = Path(tempfile.gettempdir()) / "fk_cloud_e2e"
os.environ.update(
    DATA_DIR=str(DATA_DIR),
    DATABASE_URL=f"sqlite:///{DATA_DIR}/test.db",
    CLOUD_OCR_GATEWAY=f"http://127.0.0.1:{PORT}/gateway",
    CLOUD_OCR_SEED_TOKEN="fake-token-for-test",
    CLOUD_OCR_TIMEOUT="20",
    SECRET_KEY="test-secret-key-1234567890abcdef",
    ENCRYPTION_KEY="test-encryption-key-1234567890",
)
import shutil  # noqa: E402

shutil.rmtree(DATA_DIR, ignore_errors=True)
DATA_DIR.mkdir(parents=True, exist_ok=True)

server = HTTPServer(("127.0.0.1", PORT), FakeService)
threading.Thread(target=server.serve_forever, daemon=True).start()
time.sleep(0.3)

from app.database import Base, engine, session_scope  # noqa: E402
from app.models import OcrJob, User  # noqa: E402
from app.services import cloud_ocr, jobs  # noqa: E402

Base.metadata.create_all(bind=engine)

print("═" * 58)
print("آزمون سرویس ابری — بازسازی سه علت «خروجی متنی برنگشت»")
print("═" * 58)

print("\n[۱] خواندن کلید با فاصله و اشکال مختلف")
for payload, label, expected in [
    ({" FileToDownload ": "http://x/a"}, "کلید با فاصله", "http://x/a"),
    ({"FileToDownload": "http://x/b"}, "کلید عادی", "http://x/b"),
    ({"file_to_download": "http://x/c"}, "زیرخط", "http://x/c"),
    ({"FileToDownloadURL": "http://x/d"}, "حروف بزرگ", "http://x/d"),
    ({"Data": {" FileToDownload ": "http://x/e"}}, "تودرتو", "http://x/e"),
    ({"Status": "Done"}, "بدون لینک", ""),
]:
    got = cloud_ocr.pick_key(payload, cloud_ocr.DOWNLOAD_KEYS)
    check(label, got == expected, f"گرفت: {got!r}")

print("\n[۲] اعتبار — مقدار نامعتبر نباید خطا بدهد")
check("اعتبار درست خوانده می‌شود", cloud_ocr.check_credit()["ocr_credit"] == 1500)
check("عدد خالی صفر می‌شود", cloud_ocr._as_int("") == 0)
check("عدد متنی صفر می‌شود", cloud_ocr._as_int("abc") == 0)

print("\n[۳] checkconvert که «Data Not Found Yet» می‌گوید")
checked = cloud_ocr.check_convert("TOKEN-ABC-123")
check("به NotReady تبدیل شد (نه خطای مرگ‌آور)", checked["status"] == "NotReady", str(checked))

print("\n[۴] استخراج متن از قالب‌های مختلف خروجی")
exports = DATA_DIR / "exports"
exports.mkdir(parents=True, exist_ok=True)
samples = {
    "s.txt": ("فاکتور\nجمع ۵۰۰", "فاکتور"),
    "s.json": (json.dumps({"Output": "فاکتور آزمون"}, ensure_ascii=False), "فاکتور آزمون"),
    "s.docx": (None, "فاکتور فروش"),
    "s.html": ("<p>فاکتور</p>", "فاکتور"),
}
for name, (content, needle) in samples.items():
    path = exports / name
    if content is None:
        path.write_bytes(DOCX)
    else:
        path.write_text(content, encoding="utf-8")
    text = jobs._text_from_file(path)
    check(f"{name} → متن استخراج شد", needle in text, repr(text[:40]))

corrupt = exports / "bad.docx"
corrupt.write_bytes(b"notazip")
check("فایل خراب، کار را نمی‌کشد", jobs._text_from_file(corrupt) == "")

print("\n[۵] زنجیرهٔ کامل: addfile → convert → دانلود → متن")
with session_scope() as db:
    user = User(email="t@t.t", full_name="آزمون", password_hash="x", is_active=True)
    db.add(user)
    db.flush()
    job = OcrJob(user_id=user.id, provider="cloud", method=4, output="txtrawjson",
                 file_name="invoice.png", file_path="/tmp/x.png",
                 status="queued", progress=0, meta={})
    db.add(job)
    db.flush()
    job_id = job.id

fetched = jobs._get(job_id)
meta = dict(fetched.meta or {})
meta["methods"] = [4]
jobs._run_document(fetched, "TOKEN-ABC-123", meta)

done = jobs._get(job_id)
print(f"    وضعیت: {done.status} | پیشرفت: {done.progress}")
print(f"    پیام : {done.message}")
print(f"    منبع : {(done.meta or {}).get('text_source')}")
check("کار موفق شد", done.status == "done", done.message)
check("متن خالی نیست", bool((done.text or "").strip()))
check("نام فاکتور در متن است", "فاکتور فروش" in (done.text or ""))
check("مبلغ در متن است", "۲,۵۰۰,۰۰۰" in (done.text or ""))
check("خطوط docx به هم نچسبیده‌اند", "فاکتور فروش\n" in (done.text or ""))
check("منبع متن، فایل دانلودی است", (done.meta or {}).get("text_source") == "download")

print("\n[۶] سرویس InvalidParams می‌دهد — برنامه باید خودش نجات پیدا کند")

# ── ۶الف: output مشکل دارد. تلاش دوباره بدون output باید موفق شود.
MODE["invalid"] = "output"
CALLS.clear()
res6 = cloud_ocr.convert("TOKEN-X", method=4, output="txtrawjson")
print(f"    لینک: {res6['download']}")
print(f"    تلاش‌ها: {[a['step'] + '→' + a['code'] for a in res6.get('attempts', [])]}")
check("output رد شد ولی convert در نهایت موفق شد", bool(res6["download"]), str(res6))
check("سرویس واقعاً output را رد کرده بود", CALLS.get("rejected_output", 0) >= 1, str(CALLS))
check("تلاش دوباره ثبت شده", len(res6.get("attempts") or []) >= 1)

# ── ۶ب: method=1 مجاز نیست. تلاش دوباره با روش ۴ باید موفق شود.
MODE["invalid"] = "method1"
CALLS.clear()
res6b = cloud_ocr.convert("TOKEN-Y", method=1, output="txtrawjson")
print(f"    لینک: {res6b['download']}")
check("روش ۱ رد شد ولی روش ۴ جواب داد", bool(res6b["download"]), str(res6b))
check("سرویس واقعاً روش ۱ را رد کرده بود", CALLS.get("rejected_method1", 0) >= 1, str(CALLS))

# ── ۶ج: همهٔ حالت‌ها رد می‌شوند → باید خطای گویا بدهد، نه گیر کند.
MODE["invalid"] = "always"
CALLS.clear()
try:
    cloud_ocr.convert("TOKEN-Z", method=4, output="txtrawjson")
    check("همهٔ حالت‌ها رد شد → باید خطا بدهد", False, "بدون خطا برگشت")
except cloud_ocr.CloudError as exc:
    print(f"    خطا: {exc.message[:110]}")
    check("پیام خطا گویاست", "پارامترهای درخواست را نپذیرفت" in exc.message, exc.message[:80])
    check("گفته شد هر سه حالت امتحان شد", "هر سه حالت" in exc.message, exc.message[:120])
    check("تعداد تلاش‌ها ذکر شده", "تلاش" in exc.message)

# ── ۶د: کل زنجیره با InvalidParams — کار باید بسته شود، نه رها
MODE["invalid"] = "output"     # با نجات حل می‌شود
with session_scope() as db:
    user2 = User(email="t2@t.t", full_name="آزمون۲", password_hash="x", is_active=True)
    db.add(user2)
    db.flush()
    job2 = OcrJob(user_id=user2.id, provider="cloud", method=4, output="txtrawjson",
                  file_name="invoice2.png", file_path="/tmp/y.png",
                  status="queued", progress=0, meta={})
    db.add(job2)
    db.flush()
    job2_id = job2.id

fetched2 = jobs._get(job2_id)
meta2 = dict(fetched2.meta or {})
meta2["methods"] = [4]
jobs._run_document(fetched2, "TOKEN-RESCUE", meta2)
done2 = jobs._get(job2_id)
print(f"    وضعیت: {done2.status} | نویسه: {len(done2.text or '')}")
check("با output ردشده، کار باز هم متن آورد", done2.status == "done", done2.status + " " + (done2.message or ""))
check("متن واقعاً استخراج شد", "فاکتور فروش" in (done2.text or ""))

# ── ۶ه: شکست کامل — پیام باید صادق باشد
MODE["invalid"] = "always"
with session_scope() as db:
    user3 = User(email="t3@t.t", full_name="آزمون۳", password_hash="x", is_active=True)
    db.add(user3)
    db.flush()
    job3 = OcrJob(user_id=user3.id, provider="cloud", method=4, output="txtrawjson",
                  file_name="invoice3.png", file_path="/tmp/z.png",
                  status="queued", progress=0, meta={})
    db.add(job3)
    db.flush()
    job3_id = job3.id

fetched3 = jobs._get(job3_id)
meta3 = dict(fetched3.meta or {})
meta3["methods"] = [4]
jobs._run_document(fetched3, "TOKEN-FAIL", meta3)
done3 = jobs._get(job3_id)
msg = done3.message or ""
print(f"    وضعیت: {done3.status}")
print(f"    پیام : {msg[:120]}")
check("کار بسته شد (گیر نکرد)", done3.status == "failed", done3.status)
check("پیام دروغ «فایل ذخیره شد» نیست", "ذخیره شد" not in msg, msg)
check("result_path خالی است", not (done3.result_path or ""), done3.result_path or "")
check("راهنمای بی‌ربط «کیفیت عکس» نرفته", "کیفیت عکس" not in msg, msg)

print("\n[۷] checkconvert با InvalidParams جواب می‌دهد (باگ واقعی گزارش‌شده)")
print("    پیام کاربر: «پارامترهای ارسالی: command, filetoken»")
MODE["invalid"] = False          # convert مثل همیشه کار کند
MODE["check_invalid"] = True
with session_scope() as db:
    user4 = User(email="t4@t.t", full_name="آزمون۴", password_hash="x", is_active=True)
    db.add(user4)
    db.flush()
    job4 = OcrJob(user_id=user4.id, provider="cloud", method=4, output="txtrawjson",
                  file_name="invoice4.png", file_path="/tmp/w.png",
                  status="queued", progress=0, meta={})
    db.add(job4)
    db.flush()
    job4_id = job4.id

fetched4 = jobs._get(job4_id)
meta4 = dict(fetched4.meta or {})
meta4["methods"] = [4]
jobs._run_document(fetched4, "TOKEN-CHECKINV", meta4)
done4 = jobs._get(job4_id)
print(f"    وضعیت: {done4.status} | پیام: {(done4.message or '')[:80]}")
check("کار نمرد (checkconvert مهم نیست وقتی لینک آمده)", done4.status == "done", done4.status)
check("متن استخراج شد", "فاکتور فروش" in (done4.text or ""), repr((done4.text or "")[:40]))
check("checkconvert اصلاً صدا زده نشد", CALLS.get("checkconvert", 0) == 0,
      f"تعداد: {CALLS.get('checkconvert', 0)}")
MODE["check_invalid"] = False

print("\n[۸] لینک نیامد و checkconvert هم InvalidParams → پیام گویا، نه سکوت")
MODE["invalid"] = "always"        # convert رد می‌شود → لینک نمی‌آید
MODE["check_invalid"] = True      # checkconvert هم رد می‌شود
with session_scope() as db:
    user5 = User(email="t5@t.t", full_name="آزمون۵", password_hash="x", is_active=True)
    db.add(user5)
    db.flush()
    job5 = OcrJob(user_id=user5.id, provider="cloud", method=4, output="txtrawjson",
                  file_name="invoice5.png", file_path="/tmp/v.png",
                  status="queued", progress=0, meta={})
    db.add(job5)
    db.flush()
    job5_id = job5.id

fetched5 = jobs._get(job5_id)
meta5 = dict(fetched5.meta or {})
meta5["methods"] = [4]
jobs._run_document(fetched5, "TOKEN-BOTH", meta5)
done5 = jobs._get(job5_id)
msg5 = done5.message or ""
print(f"    وضعیت: {done5.status}")
print(f"    پیام : {msg5[:140]}")
check("کار بسته شد (گیر نکرد)", done5.status == "failed", done5.status)
check("پیام گویاست", bool(msg5.strip()) and len(msg5) > 20, msg5[:60])
check("پیام دروغ «ذخیره شد» نیست", "ذخیره شد" not in msg5, msg5[:60])
MODE["invalid"] = False
MODE["check_invalid"] = False

print("\n[۹] Path(\"\") هرگز به‌عنوان فایل ذخیره‌شده تلقی نشود")
from pathlib import Path as _Path
fake = _Path("")
check("Path('') وجود دارد (تله)", fake.exists())
check("is_file() آن False است", not fake.is_file())

MODE["invalid"] = False
server.shutdown()

print("\n" + "═" * 58)
print(f"نتیجه: {PASSED} از {PASSED + FAILED} بررسی موفق")
if FAILED == 0:
    print("همه بررسی‌ها موفق بود ✓")
else:
    print(f"{FAILED} بررسی ناموفق ✗")
print("═" * 58)
sys.exit(0 if FAILED == 0 else 1)
