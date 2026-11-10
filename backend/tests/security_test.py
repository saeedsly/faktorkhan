#!/usr/bin/env python3
"""
آزمون امنیت چندکاربره — نشت داده بین کاربران
================================================
Saeed: «شاید بالای ۱۰۰ کاربر وارد بشه، دسترسی‌ها رو چک کن که نتونه کسی
اطلاعات کسی دیگه رو ببینه.»

این تست دقیقاً همان سناریو را می‌سازد:
  ۱) دو کاربر کاملاً مستقل ساخته می‌شود (A و B)
  ۲) هر کدام فاکتور و کار OCR خودش را دارد
  ۳) با توکن A تلاش می‌کنیم داده‌های B را بخوانیم/تغییر/حذف کنیم
  ۴) هر نفوذ موفق = شکست

اجرا:
    python backend/tests/security_test.py
"""
from __future__ import annotations

import os
import shutil
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
BACKEND = HERE.parent
sys.path.insert(0, str(BACKEND))

DATA_DIR = Path(tempfile.gettempdir()) / "fk_security_test"
shutil.rmtree(DATA_DIR, ignore_errors=True)
DATA_DIR.mkdir(parents=True, exist_ok=True)

os.environ.update(
    DATA_DIR=str(DATA_DIR),
    DATABASE_URL=f"sqlite:///{DATA_DIR}/test.db",
    SECRET_KEY="security-test-secret-key-1234567890ab",
    ENCRYPTION_KEY="security-test-encryption-key-123456",
    OWNER_EMAIL="owner@faktorkhan.local",
    OWNER_PASSWORD="Owner@1404",
    CLOUD_OCR_SEED_TOKEN="test-token",
    CLOUD_OCR_GATEWAY="http://127.0.0.1:1/never",
)

PASS = 0
FAIL = 0
LEAKS: list[str] = []


def ck(label: str, ok: bool, detail: str = "") -> None:
    global PASS, FAIL
    if ok:
        PASS += 1
        print(f"  ✓ {label}")
    else:
        FAIL += 1
        LEAKS.append(label)
        print(f"  ✗ {label}" + (f" — {detail}" if detail else ""))


def ck_denied(label: str, response, detail: str = "") -> None:
    """هر پاسخ 2xx یعنی نفوذ موفق — باید 401/403/404 باشد."""
    ok = response.status_code in (401, 403, 404)
    ck(label, ok, f"کد {response.status_code}" + (f" — {detail}" if detail else "") if not ok else "")


print("═" * 60)
print("آزمون امنیت چندکاربره")
print("═" * 60)

from fastapi.testclient import TestClient  # noqa: E402
from app.main import app  # noqa: E402

with TestClient(app) as client:
    # ── ورود مالک و ساخت دو کاربر مستقل
    print("\n[۱] آماده‌سازی: مالک + دو کاربر")
    r = client.post("/api/auth/login", json={"email": "owner@faktorkhan.local",
                                             "password": "Owner@1404"})
    ck("ورود مالک", r.status_code == 200, str(r.status_code))
    owner_h = {"Authorization": f"Bearer {r.json()['access_token']}"}

    users = {}
    # توجه: ثبت‌نام عمومی در این آزمون باز است (ALLOW_REGISTRATION پیش‌فرض True).
    # در نصب واقعی، آن را false کنید و کاربران را از پنل مدیریت بسازید.
    for name, email in (("A", "user-a@test.local"), ("B", "user-b@test.local")):
        r = client.post("/api/auth/register", json={
            "email": email, "full_name": f"کاربر {name}",
            "password": f"Pass-{name}-1404!", "phone": "", "company": "",
        })
        ck(f"ساخت کاربر {name}", r.status_code in (200, 201), r.text[:120])
        r = client.post("/api/auth/login", json={"email": email, "password": f"Pass-{name}-1404!"})
        ck(f"ورود کاربر {name}", r.status_code == 200, r.text[:120])
        if r.status_code != 200:
            continue
        users[name] = {"Authorization": f"Bearer {r.json()['access_token']}"}

    if len(users) != 2:
        print("\n✗ نتوانستم دو کاربر بسازم — بقیهٔ آزمون معنا ندارد.")
        sys.exit(1)

    # ── هر کاربر یک فاکتور می‌سازد
    print("\n[۲] هر کاربر یک فاکتور خودش می‌سازد")
    invoices = {}
    for name in ("A", "B"):
        r = client.post("/api/invoices", headers=users[name], json={
            "number": f"INV-{name}-001",
            "issue_date": "1404/09/15",
            "seller_name": f"فروشنده {name}",
            "buyer_name": f"خریدار {name}",
            "total": 1000000,
            "items": [{"description": f"کالای {name}", "quantity": 1, "unit_price": 1000000,
                       "line_total": 1000000}],
        })
        ck(f"ایجاد فاکتور {name}", r.status_code in (200, 201), r.text[:150])
        if r.status_code in (200, 201):
            body = r.json()
            invoices[name] = (body.get("invoice") or body).get("id")
        print(f"    فاکتور {name} = {invoices.get(name)}")

    # ── تلاش برای خواندن فاکتور دیگری
    print("\n[۳] کاربر A نباید فاکتور B را ببیند")
    if invoices.get("B"):
        r = client.get(f"/api/invoices/{invoices['B']}", headers=users["A"])
        ck_denied("خواندن فاکتور B با توکن A", r, r.text[:100])
        r = client.put(f"/api/invoices/{invoices['B']}", headers=users["A"],
                       json={"number": "HACKED", "total": 1})
        ck_denied("ویرایش فاکتور B با توکن A", r, r.text[:100])
        r = client.delete(f"/api/invoices/{invoices['B']}", headers=users["A"])
        ck_denied("حذف فاکتور B با توکن A", r, r.text[:100])

    # ── فهرست فاکتورها فقط داده خود کاربر را بدهد
    print("\n[۴] فهرست فاکتورها نباید داده کاربر دیگر را نشان دهد")
    for name in ("A", "B"):
        r = client.get("/api/invoices", headers=users[name])
        if r.status_code != 200:
            ck(f"فهرست فاکتورهای {name}", False, str(r.status_code))
            continue
        body = r.json()
        rows = body.get("items") or body.get("invoices") or []
        numbers = [str(x.get("number", "")) for x in rows]
        other = "B" if name == "A" else "A"
        leaked = [n for n in numbers if n.endswith(f"{other}-001")]
        ck(f"فهرست {name} فقط داده خودش را دارد", not leaked, f"نشت: {leaked}")

    # ── کار OCR
    print("\n[۵] کاربر A نباید کار OCR کاربر B را ببیند")
    png = bytes.fromhex(
        "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
        "0000000a49444154789c6300010000050001a5f645400000000049454e44ae426082"
    )
    jobs = {}
    for name in ("A", "B"):
        r = client.post("/api/ocr/upload", headers=users[name],
                        files={"file": ("inv.png", png, "image/png")},
                        data={"provider": "local", "method": "4"})
        ck(f"آپلود OCR کاربر {name}", r.status_code in (200, 201), r.text[:120])
        if r.status_code in (200, 201):
            jobs[name] = (r.json().get("job") or r.json()).get("id")

    if jobs.get("B"):
        for label, method, url, kwargs in [
            ("خواندن", "get", f"/api/ocr/jobs/{jobs['B']}", {}),
            ("خواندن با متن", "get", f"/api/ocr/jobs/{jobs['B']}?with_text=true", {}),
            ("دانلود فایل", "get", f"/api/ocr/jobs/{jobs['B']}/result", {}),
            ("تلاش دوباره", "post", f"/api/ocr/jobs/{jobs['B']}/retry", {}),
            ("لغو", "post", f"/api/ocr/jobs/{jobs['B']}/cancel", {}),
            ("حذف", "delete", f"/api/ocr/jobs/{jobs['B']}", {}),
            ("تبدیل به فاکتور", "post", f"/api/ocr/jobs/{jobs['B']}/to-invoice", {}),
        ]:
            fn = getattr(client, method)
            r = fn(url, headers=users["A"], **kwargs)
            ck_denied(f"{label} کار OCR کاربر B با توکن A", r, r.text[:100])

    # ── پنل مدیریت
    print("\n[۶] کاربر عادی نباید به پنل مدیریت دسترسی داشته باشد")
    for label, method, url in [
        ("فهرست کاربران", "get", "/api/admin/users"),
        ("آمار", "get", "/api/admin/stats"),
        ("تنظیمات", "get", "/api/admin/settings"),
        ("توکن ابری", "get", "/api/admin/cloud-token"),
        ("تیکت‌ها", "get", "/api/admin/tickets"),
        ("کلیدهای لایسنس", "get", "/api/admin/keys"),
        ("پشتیبان‌گیری", "get", "/api/admin/backup"),
    ]:
        fn = getattr(client, method)
        r = fn(url, headers=users["A"])
        ck_denied(f"{label} با توکن کاربر عادی", r, r.text[:80])

    # ── دستکاری توکن
    print("\n[۷] توکن جعلی/دستکاری‌شده نباید کار کند")
    bad_tokens = [
        ("بدون امضا", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIiwicm9sZSI6ImFkbWluIn0."),
        ("جعلی کامل", "eyJhbGciOiJub25lIn0.eyJzdWIiOiIxIiwicm9sZSI6ImFkbWluIn0."),
        ("خالی", ""),
        ("متن ساده", "admin"),
    ]
    for label, tok in bad_tokens:
        r = client.get("/api/invoices", headers={"Authorization": f"Bearer {tok}"})
        ck_denied(f"توکن {label}", r, r.text[:60])

    # ── دسترسی بدون توکن
    print("\n[۸] بدون توکن هیچ داده‌ای نباید داد")
    for url in ("/api/invoices", "/api/ocr/jobs", "/api/auth/me", "/api/admin/users"):
        r = client.get(url)
        ck_denied(f"{url} بدون توکن", r, r.text[:60])

    # ── کاربر A نباید بتواند خودش را ادمین کند
    print("\n[۹] کاربر عادی نباید بتواند نقش خودش را بالا ببرد")
    # اگر این مسیر اصلاً وجود نداشته باشد (405) هم امن است — بهتر از انتظار
    r = client.put("/api/auth/me", headers=users["A"], json={"role": "admin"})
    ck("نمی‌توان نقش را از این مسیر بالا برد", r.status_code != 200, f"کد {r.status_code}")
    r = client.patch("/api/auth/me", headers=users["A"], json={"role": "admin", "is_active": True})
    ck("PATCH هم کار نمی‌کند", r.status_code != 200, f"کد {r.status_code}")
    # حتی اگر پاسخ داده شد، نقش واقعی باید عوض نشده باشد
    r = client.get("/api/auth/me", headers=users["A"])
    if r.status_code == 200:
        role = (r.json().get("user") or {}).get("role", "")
        ck("نقش کاربر A هنوز user است", role != "admin", f"نقش: {role}")

    # ── شناسه‌های ترتیبی قابل حدس
    print("\n[۱۰] شناسه ترتیبی نباید داده دیگران را لو بدهد")
    mine = str(invoices.get("A"))
    theirs = str(invoices.get("B"))
    for guess in range(1, 10):
        if str(guess) in (mine,):
            continue                    # فاکتور خودش، مجاز است
        r = client.get(f"/api/invoices/{guess}", headers=users["A"])
        if r.status_code == 200:
            inv = r.json().get("invoice") or r.json()
            seller = inv.get("seller_name", "")
            # اگر فاکتور خودش نیست، هر پاسخ 200 یعنی نشت
            if str(guess) == theirs or "B" in seller:
                ck(f"فاکتور {guess} (متعلق به B) با توکن A داده شد", False, f"فروشنده: {seller}")
            else:
                ck(f"فاکتور {guess} داده شد و مال خودش نیست", False, f"فروشنده: {seller}")
        else:
            ck(f"فاکتور {guess} مسدود شد", True)

print("\n" + "═" * 60)
print(f"نتیجه: {PASS} از {PASS + FAIL} بررسی موفق")
if LEAKS:
    print(f"\n⚠ {len(LEAKS)} نشت امنیتی:")
    for item in LEAKS:
        print(f"   · {item}")
else:
    print("هیچ نشت داده‌ای بین کاربران پیدا نشد ✓")
print("═" * 60)
sys.exit(0 if FAIL == 0 else 1)
