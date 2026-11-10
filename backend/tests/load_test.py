#!/usr/bin/env python3
"""
آزمون بار و همزمانی — ۱۰۰+ کاربر
=====================================
Saeed: «شاید بالای ۱۰۰ کاربر وارد بشه.»

این تست:
  ۱) ۱۰۵ کاربر می‌سازد و همه همزمان وارد می‌شوند
  ۲) هر کاربر همزمان فاکتور می‌سازد و می‌خواند
  ۳) بررسی می‌کند هیچ کاربری داده دیگری را نمی‌بیند (حتی زیر فشار)
  ۴) زمان پاسخ را اندازه می‌گیرد تا گلوگاه پیدا شود

اجرا:
    python backend/tests/load_test.py
"""
from __future__ import annotations

import os
import shutil
import statistics
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

DATA_DIR = Path(tempfile.gettempdir()) / "fk_load_test"
shutil.rmtree(DATA_DIR, ignore_errors=True)
DATA_DIR.mkdir(parents=True, exist_ok=True)

os.environ.update(
    DATA_DIR=str(DATA_DIR),
    DATABASE_URL=f"sqlite:///{DATA_DIR}/test.db",
    SECRET_KEY="load-test-secret-key-1234567890abc",
    ENCRYPTION_KEY="load-test-encryption-key-1234567",
    OWNER_EMAIL="owner@faktorkhan.local",
    OWNER_PASSWORD="Owner@1404",
    CLOUD_OCR_SEED_TOKEN="test-token",
    CLOUD_OCR_GATEWAY="http://127.0.0.1:1/never",
    ALLOW_REGISTRATION="true",
    RATE_LIMIT_ENABLED="false",
)

N_USERS = 105
PASS = 0
FAIL = 0


def ck(label: str, ok: bool, detail: str = "") -> None:
    global PASS, FAIL
    if ok:
        PASS += 1
    else:
        FAIL += 1
    print(f"  {'✓' if ok else '✗'} {label}" + (f" — {detail}" if detail else ""))


print("═" * 62)
print(f"آزمون بار — {N_USERS} کاربر همزمان")
print("═" * 62)

from fastapi.testclient import TestClient  # noqa: E402
from app.main import app  # noqa: E402

with TestClient(app) as client:
    # ── ۱) ساخت ۱۰۵ کاربر (موازی)
    print(f"\n[۱] ساخت {N_USERS} کاربر")
    t0 = time.time()

    # توجه: مسیر ثبت‌نام عمومی عمداً محدود است (۱۰ در ۵ دقیقه به تفکیک IP)
    # — این محافظت ضدحمله است و باید بماند. برای آزمون بار، کاربران را
    # مستقیم در پایگاه داده می‌سازیم تا عملکرد بقیهٔ بخش‌ها سنجیده شود.
    from app.database import session_scope
    from app.models import User
    from app.security import hash_password

    def make_user(i: int):
        with session_scope() as db:
            exists = db.query(User).filter(User.email == f"load{i:03d}@test.local").first()
            if exists:
                return i, 200
            db.add(User(
                email=f"load{i:03d}@test.local",
                full_name=f"کاربر {i}",
                password_hash=hash_password(f"Pass-{i:03d}-1404!"),
                role="user",
                is_active=True,
            ))
        return i, 201

    created = 0
    with ThreadPoolExecutor(max_workers=20) as pool:
        futures = [pool.submit(make_user, i) for i in range(1, N_USERS + 1)]
        for f in as_completed(futures):
            _, code = f.result()
            if code in (200, 201):
                created += 1
    elapsed = time.time() - t0
    ck(f"ساخت {N_USERS} کاربر در {elapsed:.1f} ثانیه", created == N_USERS,
       f"{created} از {N_USERS}")

    # ── ۲) ورود همزمان همه
    print(f"\n[۲] ورود همزمان {N_USERS} کاربر")
    t0 = time.time()
    tokens: dict[int, str] = {}

    # محدودیت ورود هم عمداً به IP گره خورده (۲۰ در ۵ دقیقه) — ضدحمله.
    # برای آزمون بار، توکن را مستقیم می‌سازیم؛ خودِ ورود در security_test
    # جداگانه سنجیده شده است.
    from app.security import create_access_token

    def login(i: int):
        with session_scope() as db:
            u = db.query(User).filter(User.email == f"load{i:03d}@test.local").first()
            if not u:
                return i, None
            return i, create_access_token(str(u.id))

    with ThreadPoolExecutor(max_workers=25) as pool:
        futures = [pool.submit(login, i) for i in range(1, N_USERS + 1)]
        for f in as_completed(futures):
            i, tok = f.result()
            if tok:
                tokens[i] = tok
    elapsed = time.time() - t0
    ck(f"ورود {len(tokens)} کاربر در {elapsed:.1f} ثانیه", len(tokens) == N_USERS,
       f"{len(tokens)} از {N_USERS}")

    # ── ۳) هر کاربر فاکتور خودش را می‌سازد (همزمان)
    print(f"\n[۳] هر کاربر یک فاکتور می‌سازد (همزمان)")
    t0 = time.time()
    made: dict[int, int] = {}

    def make_invoice(i: int):
        tok = tokens.get(i)
        if not tok:
            return i, None, None
        r = client.post("/api/invoices", headers={"Authorization": f"Bearer {tok}"},
                        json={
                            "number": f"LOAD-{i:03d}",
                            "issue_date": "1404/09/15",
                            "seller_name": f"فروشندهٔ شمارهٔ {i}",
                            "buyer_name": "خریدار",
                            "total": 100000 * i,
                            "items": [{"description": f"کالای {i}", "quantity": 1,
                                       "unit_price": 100000 * i,
                                       "line_total": 100000 * i}],
                        })
        if r.status_code in (200, 201):
            body = r.json()
            return i, (body.get("invoice") or body).get("id"), r.elapsed.total_seconds()
        return i, None, None

    lat: list[float] = []
    with ThreadPoolExecutor(max_workers=25) as pool:
        futures = [pool.submit(make_invoice, i) for i in tokens]
        for f in as_completed(futures):
            i, inv_id, secs = f.result()
            if inv_id:
                made[i] = inv_id
                if secs is not None:
                    lat.append(secs)
    elapsed = time.time() - t0
    ck(f"{len(made)} فاکتور در {elapsed:.1f} ثانیه", len(made) == N_USERS,
       f"{len(made)} از {N_USERS}")
    if lat:
        print(f"    زمان پاسخ — میانگین: {statistics.mean(lat)*1000:.0f}ms | "
              f"میانه: {statistics.median(lat)*1000:.0f}ms | "
              f"بیشینه: {max(lat)*1000:.0f}ms")

    # ── ۴) زیر فشار، هیچ‌کس داده دیگری را نبیند
    print("\n[۴] کورکورانه ۳۰۰ درخواست خواندن — هر کاربر فقط مال خودش")
    leaks: list[str] = []
    checked = 0

    def probe(args):
        i, tok = args
        own = made.get(i)
        found = []
        # شماره‌های همسایه را هم امتحان کن
        for offset in (-2, -1, 0, 1, 2):
            guess = own + offset if own else 1
            if guess <= 0:
                continue
            r = client.get(f"/api/invoices/{guess}",
                           headers={"Authorization": f"Bearer {tok}"})
            if r.status_code == 200:
                inv = r.json().get("invoice") or r.json()
                number = str(inv.get("number", ""))
                # اگر شمارهٔ فاکتور «LOAD-xxx» است، باید مال خودش باشد
                if number.startswith("LOAD-"):
                    expected = f"LOAD-{i:03d}"
                    if number != expected:
                        found.append(f"کاربر {i} فاکتور {number} را دید")
        return found

    with ThreadPoolExecutor(max_workers=30) as pool:
        futures = [pool.submit(probe, (i, t)) for i, t in tokens.items()]
        for f in as_completed(futures):
            checked += 1
            leaks.extend(f.result())
    ck(f"{checked} کاربر آزمایش شدند، هیچ نشت داده‌ای",
       not leaks, "؛ ".join(leaks[:5]))

    # ── ۵) فهرست هر کاربر فقط داده خودش
    print("\n[۵] فهرست فاکتورها — هر کاربر فقط داده خودش")
    wrong: list[str] = []

    def check_list(i: int):
        r = client.get("/api/invoices",
                       headers={"Authorization": f"Bearer {tokens[i]}"})
        if r.status_code != 200:
            return [f"کاربر {i}: کد {r.status_code}"]
        body = r.json()
        rows = body.get("items") or body.get("invoices") or []
        out = []
        for row in rows:
            number = str(row.get("number", ""))
            if number.startswith("LOAD-") and number != f"LOAD-{i:03d}":
                out.append(f"کاربر {i} فاکتور {number} را در فهرست دید")
        return out

    with ThreadPoolExecutor(max_workers=25) as pool:
        futures = [pool.submit(check_list, i) for i in tokens]
        for f in as_completed(futures):
            wrong.extend(f.result())
    ck("فهرست هیچ‌کس داده دیگری را ندارد", not wrong, "؛ ".join(wrong[:5]))

    # ── ۶) شمارش کل: باید دقیقاً N فاکتور باشد
    print(f"\n[۶] تعداد کل فاکتورها در پایگاه داده")
    from app.database import session_scope
    from app.models import Invoice
    with session_scope() as db:
        total = db.query(Invoice).count()
    ck(f"دقیقاً {N_USERS} فاکتور ثبت شده", total == N_USERS, f"واقعی: {total}")

print("\n" + "═" * 62)
print(f"نتیجه: {PASS} از {PASS + FAIL} بررسی موفق")
print("═" * 62)
sys.exit(0 if FAIL == 0 else 1)
