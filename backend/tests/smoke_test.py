#!/usr/bin/env python3
"""تست دودی فاکتورخوان — بدون نیاز به سرور یا MySQL.

    python tests/smoke_test.py

اثر: سعید سالاری
"""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

TMP = Path(tempfile.mkdtemp(prefix="fk-test-"))
os.environ["DATA_DIR"] = str(TMP)
os.environ["DATABASE_URL"] = f"sqlite:///{(TMP / 'test.db').as_posix()}"
os.environ["OWNER_EMAIL"] = "owner@test.local"
os.environ["OWNER_PASSWORD"] = "Owner12345"
os.environ["SECRET_KEY"] = "test-secret-key-for-smoke-test-only"
os.environ["ENCRYPTION_KEY"] = "test-encryption-key-for-smoke-test"
os.environ["CLOUD_OCR_GATEWAY"] = ""
os.environ["ALLOW_REGISTRATION"] = "true"

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

PASSED: list[str] = []
FAILED: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    if condition:
        PASSED.append(name)
        print(f"  ✓ {name}")
    else:
        FAILED.append(f"{name} — {detail}")
        print(f"  ✗ {name} — {detail}")


def main() -> int:
    print("\n══════ تست دودی فاکتورخوان ══════\n")
    with TestClient(app) as client:
        print("[۱] احراز هویت")
        r = client.post("/api/auth/login", json={"email": "owner@test.local", "password": "Owner12345"})
        check("ورود مالک", r.status_code == 200, r.text[:120])
        token = r.json()["access_token"]
        client.headers["Authorization"] = f"Bearer {token}"
        check("نقش مالک", r.json()["user"]["role"] == "owner")
        check("اشتراک مالک", r.json()["subscription"]["plan_name"] != "بدون طرح")

        print("\n[۲] محرمانگی و اطلاعات عمومی")
        meta = client.get("/api/system/meta").json()
        check("تعداد قابلیت‌ها ≥ ۹۰", meta["features_total"] >= 90, str(meta["features_total"]))
        check("نام پدیدآورنده", meta["owner"]["name"] == "سعید سالاری")
        check("متن حق معنوی", "سعید سالاری" in meta["copyright"])
        check("آدرس درگاه در پاسخ‌ها نیست", "http" not in str(meta.get("app", {}).get("cloud", "")))

        print("\n[۳] فاکتور: ثبت، جست‌وجو، خروجی")
        payload = {
            "number": "T-1001", "issue_date": "1404/08/20", "invoice_type": "printed",
            "seller_name": "فروشنده آزمون", "buyer_name": "خریدار آزمون",
            "subtotal": 5_000_000, "tax": 500_000, "total": 5_500_000, "status": "confirmed",
            "items": [{"description": "کالا", "qty": 2, "unit_price": 2_500_000, "total": 5_000_000}],
        }
        r = client.post("/api/invoices", json=payload)
        check("ثبت فاکتور", r.status_code == 201, r.text[:120])
        invoice_id = r.json()["invoice"]["id"]
        check("اقلام ذخیره شد", len(client.get(f"/api/invoices/{invoice_id}").json()["invoice"]["items"]) == 1)
        check("جست‌وجو", client.get("/api/invoices?q=T-1001").json()["total"] >= 1)
        check("آمار", client.get("/api/invoices/stats").json()["counts"]["total"] >= 1)
        check("خروجی اکسل", client.get("/api/invoices/export?format=xlsx").content[:2] == b"PK")
        check("خروجی CSV", client.get("/api/invoices/export?format=csv").content.startswith(b"\xef\xbb\xbf"))
        check("خروجی JSON", client.get("/api/invoices/export?format=json").status_code == 200)
        check("نسخه چاپی", client.get(f"/api/invoices/{invoice_id}/print").json()["invoice"]["id"] == invoice_id)
        check("حذف فاکتور", client.delete(f"/api/invoices/{invoice_id}").status_code == 200)

        print("\n[۴] تحلیل متن فاکتور")
        sample = """فروشگاه نمونه
شماره فاکتور: 4587
تاریخ: 1404/08/11
فروشنده: شرکت آلفا
کالا            تعداد     قیمت واحد     مبلغ
کاغذ A4          10        900,000       9,000,000
جمع کل: 9,000,000
مالیات: 900,000
قابل پرداخت: 9,900,000
"""
        parsed = client.post("/api/invoices/parse", json={"text": sample}).json()["parsed"]
        check("شماره از متن", parsed["number"] == "4587", str(parsed["number"]))
        check("تاریخ از متن", parsed["issue_date"] == "1404/08/11", str(parsed["issue_date"]))
        check("مبلغ نهایی", parsed["total"] == 9_900_000, str(parsed["total"]))
        check("مالیات", parsed["tax"] == 900_000, str(parsed["tax"]))
        check("اقلام", len(parsed["items"]) >= 1, str(len(parsed["items"])))
        check("امتیاز اعتماد", parsed["confidence"] > 50, str(parsed["confidence"]))

        print("\n[۵] اشتراک و کد فعال‌سازی")
        plans = client.get("/api/admin/plans").json()["items"]
        year = next(p for p in plans if p["code"] == "pro-year")
        r = client.post("/api/admin/keys/batch", json={"plan_id": year["id"], "count": 2, "note": "تست"})
        keys = r.json()["keys"]
        check("ساخت کد", r.json()["created"] == 2 and keys[0].startswith("FK-"))
        check("اعتبارسنجی کد", client.get(f"/api/billing/check-key/{keys[0]}").json()["valid"] is True)

        r = client.post("/api/auth/register", json={
            "full_name": "کاربر تست", "email": "u1@test.local", "password": "User12345678",
            "license_key": keys[0],
        })
        check("ثبت‌نام با کد", r.status_code == 201, r.text[:120])
        check("فعال‌سازی یک‌ساله", r.json()["subscription"]["days_left"] >= 360)
        user_token = r.json()["access_token"]
        user_headers = {"Authorization": f"Bearer {user_token}"}
        check("کد یک‌بارمصرف", client.post("/api/billing/redeem", json={"key": keys[0]},
                                           headers=user_headers).status_code == 409)

        print("\n[۶] کنترل دسترسی")
        check("کاربر عادی به پنل مدیر دسترسی ندارد",
              client.get("/api/admin/overview", headers=user_headers).status_code == 403)
        check("بدون توکن رد می‌شود", client.get("/api/invoices", headers={"Authorization": ""}).status_code == 401)
        check("رمز اشتباه رد می‌شود",
              client.post("/api/auth/login", json={"email": "owner@test.local", "password": "x"}).status_code == 401)

        print("\n[۷] توکن ابری — مخفی‌سازی")
        secret = "SMOKE-SECRET-TOKEN-123"
        check("ثبت توکن", client.post("/api/admin/cloud/token", json={"token": secret}).status_code == 200)
        state = client.get("/api/admin/cloud").json()
        check("توکن در پاسخ نیست", secret not in str(state) and state["visible"] is False)
        check("اثر انگشت مخفی", "•" in state["token_hint"], state["token_hint"])
        check("توکن در متادیتای عمومی نیست", secret not in client.get("/api/system/meta").text)
        check("توکن در گزارش رویداد نیست", secret not in client.get("/api/admin/audit").text)

        print("\n[۸] پشتیبانی و مدیریت")
        r = client.post("/api/system/support", json={"subject": "آزمون", "message": "پیام آزمایشی پشتیبانی"},
                        headers=user_headers)
        check("ثبت پیام پشتیبانی", r.status_code == 201)
        ticket_id = r.json()["id"]
        check("مشاهده در پنل", any(t["id"] == ticket_id for t in client.get("/api/admin/support").json()["items"]))
        check("پاسخ به پیام", client.post(f"/api/admin/support/{ticket_id}/answer",
                                          json={"answer": "پاسخ آزمایشی"}).json()["ok"] is True)
        check("سلامت سامانه", client.get("/api/admin/health").json()["database"]["ok"] is True)
        check("پشتیبان‌گیری", client.get("/api/admin/backup").status_code == 200)

    total = len(PASSED) + len(FAILED)
    print("\n══════════════════════════════════════════")
    print(f"نتیجه: {len(PASSED)} از {total} بررسی موفق")
    if FAILED:
        print("\nموارد ناموفق:")
        for item in FAILED:
            print(f"  - {item}")
        return 1
    print("همه بررسی‌ها موفق بود ✓")
    return 0


if __name__ == "__main__":
    sys.exit(main())
