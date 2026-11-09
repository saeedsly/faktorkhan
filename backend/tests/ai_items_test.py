#!/usr/bin/env python3
"""تست موتور فهم اقلام — قاعده‌محور + هوش مصنوعی (با سرور جعلی).

    python tests/ai_items_test.py

هیچ درخواست واقعی به اینترنت نمی‌رود: یک ترابری جعلی جایگزین httpx می‌شود.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

TMP = Path(tempfile.mkdtemp(prefix="fk-ai-"))
os.environ["DATA_DIR"] = str(TMP)
os.environ["DATABASE_URL"] = f"sqlite:///{(TMP / 'test.db').as_posix()}"
os.environ["OWNER_EMAIL"] = "owner@test.local"
os.environ["OWNER_PASSWORD"] = "Owner12345"
os.environ["SECRET_KEY"] = "test-secret-key-for-ai-items-test"
os.environ["ENCRYPTION_KEY"] = "test-encryption-key-for-ai-items"
os.environ["CLOUD_OCR_GATEWAY"] = ""
os.environ["ALLOW_REGISTRATION"] = "true"

PASSED: list[str] = []
FAILED: list[str] = []


def check(name: str, cond: bool, detail: str = "") -> None:
    if cond:
        PASSED.append(name)
        print(f"  ✓ {name}")
    else:
        FAILED.append(f"{name} {detail}")
        print(f"  ✗ {name} {detail}")


from app.services import ai_parser  # noqa: E402
from app.services.ai_parser import (  # noqa: E402
    extract_items_ai, extract_items_rules, fix_numbers,
)

PRINTED = """فاکتور خرید
شماره: 1404/1234
تاریخ: 1404/08/16
فروشنده: شرکت نمونه

کد	شرح کالا	تعداد	قیمت واحد	مبلغ کل
1	کاغذ A4 بسته 500 برگ	10	450,000	4,500,000
2	تونر پرینتر HP	2	1,200,000	2,400,000
3	خودکار آبی	50	15,000	700,000

جمع کل: 7,600,000
مالیات: 760,000
مبلغ نهایی: 8,360,000
"""

THERMAL = """فروشگاه رفاه
نان سنگک  2  15,000  30,000
شیر 1 لیتری  3  32,000  96,000
پنیر  1  120,000  120,000
جمع: 246,000
"""

PERSIAN = """فاکتور
کاغذ ۱۰ ۴۵۰٬۰۰۰ ۴٬۵۰۰٬۰۰۰
تونر ۲ ۱٬۲۰۰٬۰۰۰ ۲٬۴۰۰٬۰۰۰
جمع ۶٬۹۰۰٬۰۰۰
"""


print("\n[۱] استخراج قاعده‌محور")
r = extract_items_rules(PRINTED)
check("فاکتور چاپی: سه قلم", len(r["items"]) == 3, f"({len(r['items'])})")
check("فاکتور چاپی: شرح درست", "کاغذ" in r["items"][0]["description"])
check("فاکتور چاپی: تعداد درست", r["items"][0]["qty"] == 10)
check("فاکتور چاپی: قیمت درست", r["items"][0]["unit_price"] == 450000)
check("فاکتور چاپی: جمع اقلام", r["totals"]["items_sum"] == 7600000)
check("فاکتور چاپی: خطای ردیف ۳ کشف شد",
      any("750,000" in i["message"] for i in r["issues"]))

r = extract_items_rules(THERMAL)
check("حرارتی بدون سرستون: سه قلم", len(r["items"]) == 3, f"({len(r['items'])})")
check("حرارتی: اعداد جدا شدند", r["totals"]["items_sum"] == 246000)
check("حرارتی: اعتماد بالا", r["confidence"] >= 90)

r = extract_items_rules(PERSIAN)
check("ارقام فارسی: دو قلم", len(r["items"]) == 2)
check("ارقام فارسی: تبدیل رقم", r["items"][0]["unit_price"] == 450000)
check("ارقام فارسی: جمع", r["totals"]["items_sum"] == 6900000)

r = extract_items_rules("سلام خوبی")
check("متن بی‌ربط: هیچ قلمی", r["items"] == [])
check("متن بی‌ربط: اعتماد صفر", r["confidence"] == 0)


print("\n[۲] اصلاح خودکار اعداد")
items = [
    {"description": "کاغذ", "qty": 10, "unit_price": 450000, "total": 4500000, "discount": 0},
    {"description": "خودکار", "qty": 50, "unit_price": 15000, "total": 700000, "discount": 0},
    {"description": "پاک‌کن", "qty": 3, "unit_price": 8000, "total": 0, "discount": 0},
]
totals = {"subtotal": 8250000, "discount": 0, "tax": 0, "total": 8250000, "items_sum": 8250000}
fixed, out, changes = fix_numbers(items, totals)
check("اصلاح: مبلغ کل غلط", fixed[1]["total"] == 750000)
check("اصلاح: مبلغ خالی پر شد", fixed[2]["total"] == 24000)
check("اصلاح: subtotal هماهنگ", out["subtotal"] == 5274000, str(out["subtotal"]))
check("اصلاح: total = جمع", out["total"] == 5274000)
check("اصلاح: تعداد تغییرات", len(changes) >= 3, str(len(changes)))

fixed, out, changes = fix_numbers(
    [{"description": "الف", "qty": 2, "unit_price": 1000, "total": 2000, "discount": 0}],
    {"subtotal": 2000, "discount": 0, "tax": 0, "total": 2000, "items_sum": 2000},
)
check("اصلاح: سند سالم دست‌نخورده", changes == [] and fixed[0]["total"] == 2000)


print("\n[۳] موتور هوش مصنوعی — پاسخ سالم")
img = TMP / "invoice.jpg"
img.write_bytes(b"\xff\xd8\xff\xe0" + b"fakejpeg" * 100)

AI_GOOD = {
    "items": [
        {"code": "A1", "description": "لپ‌تاپ ایسوس", "qty": 2, "unit": "دستگاه",
         "unit_price": 45000000, "discount": 0, "total": 90000000},
        {"code": "A2", "description": "ماوس بی‌سیم لاجیتک", "qty": 5, "unit": "عدد",
         "unit_price": 1200000, "discount": 0, "total": 6000000},
    ],
    "subtotal": 96000000, "discount": 0, "tax": 9600000, "total": 105600000,
    "seller": "فروشگاه رایانه", "buyer": "شرکت خریدار",
    "number": "1404/5566", "date": "1404/08/16", "currency": "IRR",
}


class FakeResp:
    def __init__(self, status=200, payload=None, text=""):
        self.status_code = status
        self._payload = payload
        self.text = text

    def json(self):
        if self._payload is None:
            raise ValueError("no json")
        return self._payload


def make_client(status=200, payload=None, text=""):
    class FakeClient:
        def __init__(self, *a, **kw):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def post(self, url, params=None, json=None):  # noqa: A002
            FakeClient.last_url = url
            FakeClient.last_body = json
            FakeClient.last_params = params
            return FakeResp(status, payload, text)

    return FakeClient


import httpx  # noqa: E402

real_client = httpx.Client


def ai_gemini_body(text: str) -> dict:
    return {"candidates": [{"content": {"parts": [{"text": text}]}}]}


httpx.Client = make_client(200, ai_gemini_body(json.dumps(AI_GOOD, ensure_ascii=False)))
res = extract_items_ai(img, api_key="FAKE-KEY", model="gemini-2.0-flash")
check("AI: ok", res.get("ok") is True, str(res.get("error")))
check("AI: دو قلم", len(res["items"]) == 2)
check("AI: شرح فارسی", res["items"][0]["description"] == "لپ‌تاپ ایسوس")
check("AI: تعداد", res["items"][0]["qty"] == 2)
check("AI: مبلغ کل", res["items"][0]["total"] == 90000000)
check("AI: جمع اقلام", res["totals"]["items_sum"] == 96000000)
check("AI: مالیات", res["totals"]["tax"] == 9600000)
check("AI: کل", res["totals"]["total"] == 105600000)
check("AI: متادیتای فروشنده", res["meta"]["seller"] == "فروشگاه رایانه")
check("AI: شماره فاکتور", res["meta"]["number"] == "1404/5566")
check("AI: آدرس درست", "generateContent" in str(httpx.Client.last_url))
check("AI: کلید در query", httpx.Client.last_params == {"key": "FAKE-KEY"})
check("AI: inline_data فرستاده شد",
      any("inline_data" in p for p in httpx.Client.last_body["contents"][0]["parts"]))
check("AI: base64 معتبر",
      httpx.Client.last_body["contents"][0]["parts"][1]["inline_data"]["data"][:4] != "")


print("\n[۴] موتور هوش مصنوعی — خطاها")
res = extract_items_ai(img, api_key="")
check("بدون کلید: no_key", res.get("error") == "no_key")

httpx.Client = make_client(429, {"error": {"code": 429}}, "")
res = extract_items_ai(img, api_key="K")
check("۴۲۹: پیام سهمیه", res.get("error") == "quota" and "سهمیه" in res["message"])

httpx.Client = make_client(403, {"error": {"code": 403}}, "")
res = extract_items_ai(img, api_key="K")
check("۴۰۳: پیام کلید", res.get("error") == "auth")

httpx.Client = make_client(200, {"error": {"code": 400, "message": "bad"}}, "")
res = extract_items_ai(img, api_key="K")
check("۲۰۰ با بدنهٔ خطا: رد می‌شود", res.get("ok") is not True)

httpx.Client = make_client(200, ai_gemini_body("این JSON نیست"))
res = extract_items_ai(img, api_key="K")
check("خروجی غیر-JSON: رد می‌شود", res.get("error") == "json")

httpx.Client = make_client(200, ai_gemini_body('```json\n{"items":[]}\n```'))
res = extract_items_ai(img, api_key="K")
check("آرایهٔ خالی: empty", res.get("error") == "empty")

httpx.Client = make_client(200, ai_gemini_body(
    '```json\n' + json.dumps(AI_GOOD, ensure_ascii=False) + '\n```'))
res = extract_items_ai(img, api_key="K")
check("بلوک ```json پاک شد", res.get("ok") is True and len(res["items"]) == 2)

res = extract_items_ai(TMP / "nope.jpg", api_key="K")
check("فایل ناموجود: no_file", res.get("error") == "no_file")

httpx.Client = real_client


print("\n[۵] نرمال‌سازی اعداد هوش مصنوعی")
weird = {"items": [
    {"description": "کالا با عدد فارسی", "qty": "۳", "unit_price": "۱٬۲۰۰٬۰۰۰",
     "total": "۳,۶۰۰,۰۰۰"},
    {"description": "کالای بدون مبلغ کل", "qty": 2, "unit_price": 50000, "total": ""},
    {"description": "", "qty": 1, "unit_price": 10, "total": 10},
]}
httpx.Client = make_client(200, ai_gemini_body(json.dumps(weird, ensure_ascii=False)))
res = extract_items_ai(img, api_key="K")
check("اعداد فارسی تبدیل شدند", res["items"][0]["unit_price"] == 1200000)
check("qty فارسی تبدیل شد", res["items"][0]["qty"] == 3)
check("مبلغ خالی محاسبه شد", res["items"][1]["total"] == 100000)
check("شرح خالی حذف شد", len(res["items"]) == 2)
httpx.Client = real_client


print("\n[۶] API — از متن تا فاکتور")
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

with TestClient(app) as client:   # with-block → lifespan اجرا می‌شود (ساخت جدول‌ها)
    login = client.post("/api/auth/login", json={"email": "owner@test.local", "password": "Owner12345"})
    check("ورود مالک", login.status_code == 200, str(login.status_code))
    token = login.json().get("token") or login.json().get("access_token")
    if not token:
        token = (login.json().get("tokens") or {}).get("access") or ""
    H = {"Authorization": f"Bearer {token}"}
    check("توکن گرفته شد", bool(token))

    resp = client.post("/api/invoices/understand", json={"text": PRINTED}, headers=H)
    check("POST /understand: ۲۰۰", resp.status_code == 200, str(resp.status_code) + resp.text[:200])
    data = resp.json() if resp.status_code == 200 else {}
    check("understand: سه قلم", data.get("item_count") == 3, str(data.get("item_count")))
    check("understand: موتور rules", data.get("engine") == "rules")
    check("understand: ردیف‌ها شماره خوردند", [i["row_no"] for i in data.get("items", [])] == [1, 2, 3])
    check("understand: جمع بعد از اصلاح", data.get("items_sum") == 7650000, str(data.get("items_sum")))
    check("understand: اصلاح ثبت شد", len(data.get("autofix") or []) == 1, str(data.get("autofix")))

    resp = client.post("/api/invoices/understand", json={"text": "x"}, headers=H)
    check("متن کوتاه: ۴۰۰", resp.status_code == 400)

    resp = client.post("/api/invoices/understand", json={"text": "سلام دوستان این یک متن است"}, headers=H)
    check("متن بی‌قلم: ۴۲۲", resp.status_code == 422, str(resp.status_code))

    resp = client.post("/api/invoices/understand", json={"text": THERMAL, "autofix": False}, headers=H)
    check("understand بدون autofix", resp.status_code == 200 and resp.json()["autofix"] == [])

    resp = client.post("/api/invoices/fix-numbers", json={"items": items, "totals": totals}, headers=H)
    check("POST /fix-numbers: ۲۰۰", resp.status_code == 200, str(resp.status_code))
    fd = resp.json()
    check("fix-numbers: سه تغییر", len(fd["changes"]) >= 3)
    check("fix-numbers: total اصلاح شد", fd["items"][1]["total"] == 750000)
    check("fix-numbers: جمع نهایی", fd["totals"]["total"] == 5274000)

    resp = client.post("/api/invoices/fix-numbers", json={"items": []}, headers=H)
    check("fix-numbers خالی: ۴۰۰", resp.status_code == 400)

    resp = client.post("/api/invoices/understand-image", json={"path": str(img)}, headers=H)
    check("understand-image بدون کلید: ۴۰۰ با پیام روشن",
          resp.status_code == 400 and "هوش مصنوعی" in resp.json().get("detail", ""),
          str(resp.status_code))


    print("\n[۷] ذخیره در فاکتور با متادیتای موتور")
    created = client.post("/api/invoices", json={
        "number": "TEST-AI-1", "issue_date": "1404/08/16", "seller_name": "فروشنده تست",
        "items": [
            {"row_no": 1, "description": "کاغذ", "qty": 10, "unit_price": 450000,
             "total": 4500000, "engine": "ai", "ai_confidence": 92},
            {"row_no": 2, "description": "تونر", "qty": 2, "unit_price": 1200000,
             "total": 2400000, "engine": "rules", "ai_confidence": 70},
        ],
    }, headers=H)
    check("ثبت فاکتور با اقلام: ۲۰۱", created.status_code == 201, str(created.status_code))
    inv = created.json().get("invoice", {})
    inv_id = inv.get("id")
    check("شناسه برگشت", bool(inv_id))

    detail = client.get(f"/api/invoices/{inv_id}", headers=H)
    check("دریافت جزئیات: ۲۰۰", detail.status_code == 200, str(detail.status_code))
    body = detail.json()
    invoice_obj = body.get("invoice", body)
    rows = invoice_obj.get("items", [])
    check("اقلام در جزئیات هستند", len(rows) == 2, str(len(rows)))
    if len(rows) == 2:
        check("موتور قلم اول = ai", rows[0].get("engine") == "ai", str(rows[0].get("engine")))
        check("اعتماد قلم اول", rows[0].get("ai_confidence") == 92, str(rows[0].get("ai_confidence")))
        check("موتور قلم دوم = rules", rows[1].get("engine") == "rules")
        check("جمع فاکتور محاسبه شد", invoice_obj.get("total") == 6900000,
              str(invoice_obj.get("total")))


print("\n[۸] پر کردن فاکتور موجود از متن (apply_to)")
created2 = client.post("/api/invoices", json={"number": "EMPTY-1"}, headers=H)
empty_id = created2.json()["invoice"]["id"]
applied = client.post("/api/invoices/understand",
                      json={"text": PRINTED, "apply_to": empty_id}, headers=H)
check("apply_to: ۲۰۰", applied.status_code == 200, str(applied.status_code))
ad = applied.json()
check("apply_to: شناسه برگشت", ad.get("applied_to") == empty_id)
check("apply_to: سه قلم نوشته شد", ad["invoice"]["items_count"] == 3,
      str(ad["invoice"]["items_count"]))
check("apply_to: مبلغ کل", ad["invoice"]["total"] == 8360000, str(ad["invoice"]["total"]))
check("apply_to: موتور ثبت شد", ad["invoice"]["items_engine"] == "rules")

fresh = client.get(f"/api/invoices/{empty_id}", headers=H).json()
fresh_inv = fresh.get("invoice", fresh)
check("apply_to: در پایگاه‌داده ماند", fresh_inv.get("items_count") == 3)
check("apply_to: جمع اصلاح‌شده", fresh_inv.get("total") == 8360000,
      str(fresh_inv.get("total")))
row3 = (fresh_inv.get("items") or [{}, {}, {}])[2]
check("apply_to: ردیف ۳ اصلاح شد", row3.get("total") == 750000, str(row3.get("total")))
check("apply_to: توضیح اصلاح ذخیره شد", bool(row3.get("note")))

bad = client.post("/api/invoices/understand",
                  json={"text": PRINTED, "apply_to": 999999}, headers=H)
check("apply_to فاکتور ناموجود: ۴۰۴", bad.status_code == 404, str(bad.status_code))


print("\n" + "═" * 46)
print(f"نتیجه: {len(PASSED)} از {len(PASSED) + len(FAILED)} بررسی موفق")
if FAILED:
    print("ناموفق‌ها:")
    for f in FAILED:
        print("  •", f)
    sys.exit(1)
print("همه بررسی‌ها موفق بود ✓")
