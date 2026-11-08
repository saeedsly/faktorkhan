"""داده‌های اولیه: حساب مالک و طرح‌های اشتراک."""
from __future__ import annotations

import logging
import secrets
from datetime import timedelta

from sqlalchemy.orm import Session

from .config import settings
from .database import SessionLocal, init_db
from .models import Invoice, InvoiceItem, Plan, Subscription, User, utcnow
from .security import hash_password

log = logging.getLogger("faktorkhan.seed")

PLAN_SEEDS = [
    {
        "code": "trial",
        "name": "دوره آزمایشی",
        "tagline": "برای شروع و آشنایی با سامانه",
        "price": 0,
        "duration_days": 14,
        "support_days": 14,
        "page_quota": 50,
        "max_devices": 1,
        "sort_order": 1,
        "features": ["۵۰ صفحه پردازش", "خوانش ابری و لوکال", "خروجی اکسل و CSV", "پشتیبانی پایه"],
    },
    {
        "code": "pro-month",
        "name": "حرفه‌ای یک‌ماهه",
        "tagline": "مناسب استفاده ماهانه در دفتر",
        "price": 3_500_000,
        "duration_days": 30,
        "support_days": 30,
        "page_quota": 1500,
        "max_devices": 1,
        "sort_order": 2,
        "features": ["۱٫۵۰۰ صفحه پردازش", "همه روش‌های خوانش", "خروجی اکسل، CSV و JSON", "یک دستگاه", "پشتیبانی یک‌ماهه"],
    },
    {
        "code": "pro-year",
        "name": "حرفه‌ای یک‌ساله",
        "tagline": "محبوب‌ترین انتخاب کسب‌وکارها",
        "price": 29_000_000,
        "duration_days": 365,
        "support_days": 365,
        "page_quota": 20_000,
        "max_devices": 2,
        "sort_order": 3,
        "is_featured": True,
        "features": [
            "۲۰٫۰۰۰ صفحه پردازش", "همه روش‌های خوانش", "همه قالب‌های خروجی",
            "دو دستگاه", "پشتیبانی اختصاصی یک‌ساله", "به‌روزرسانی رایگان نسخه",
        ],
    },
    {
        "code": "enterprise-year",
        "name": "سازمانی یک‌ساله",
        "tagline": "برای تیم‌های مالی و شرکت‌ها",
        "price": 89_000_000,
        "duration_days": 365,
        "support_days": 365,
        "page_quota": 100_000,
        "max_devices": 10,
        "sort_order": 4,
        "features": [
            "۱۰۰٫۰۰۰ صفحه پردازش", "ده دستگاه", "نصب روی سرور اختصاصی",
            "پشتیبانی و آموزش تیم", "تنظیم الگوی خوانش اختصاصی",
        ],
    },
]


def seed_plans(db: Session) -> None:
    for data in PLAN_SEEDS:
        existing = db.query(Plan).filter(Plan.code == data["code"]).first()
        if existing:
            continue
        db.add(Plan(**data))
    db.commit()


def seed_owner(db: Session) -> dict | None:
    """حساب مالک ساخته می‌شود؛ رمز یک‌بار در فایل راهنما و کنسول چاپ می‌شود."""
    if db.query(User).count() > 0:
        return None
    email = (settings.OWNER_EMAIL or "owner@localhost").strip().lower()
    password = settings.OWNER_PASSWORD.strip()
    generated = False
    if len(password) < 8:
        password = "Fk-" + secrets.token_urlsafe(9)
        generated = True
    owner = User(
        full_name=settings.OWNER_NAME,
        email=email,
        password_hash=hash_password(password),
        role="owner",
        is_active=True,
        company="فاکتورخوان",
        must_change_password=generated,
        last_login_at=utcnow(),
    )
    db.add(owner)
    db.commit()
    db.refresh(owner)
    pro = db.query(Plan).filter(Plan.code == "enterprise-year").first()
    db.add(Subscription(
        user_id=owner.id, status="active", starts_at=utcnow(),
        plan_id=pro.id if pro else None,
        ends_at=utcnow() + timedelta(days=3650), support_until=utcnow() + timedelta(days=3650),
        pages_quota=10_000_000, pages_used=0, notes="حساب مالک سامانه",
    ))
    db.commit()

    info = {"email": email, "password": password, "generated": generated}
    try:
        path = settings.DATA_DIR / "OWNER-CREDENTIALS.txt"
        path.write_text(
            "فاکتورخوان — اطلاعات ورود مالک سامانه\n"
            "====================================\n"
            f"ایمیل: {email}\n"
            f"گذرواژه: {password}\n"
            "پس از اولین ورود، رمز را از بخش تنظیمات تغییر دهید و این فایل را حذف کنید.\n",
            encoding="utf-8",
        )
    except OSError:
        pass
    log.warning("owner account created: %s / %s", email, password)
    return info


def seed_demo(db: Session, user: User) -> None:
    """داده نمایشی برای آشنایی سریع با محیط."""
    samples = [
        ("۱۴۰۴۰۸۱۲-۰۴۲", "1404/08/12", "printed", "فروشگاه لوازم اداری آفتاب", "شرکت پارس تجارت",
         [("کاغذ A4 بسته ۵۰۰ برگ", 12, 1_850_000), ("تونر کارتریج HP 85A", 3, 4_200_000)]),
        ("۹۸۷۶۵۴", "1404/08/09", "thermal", "رستوران باغ ایرانی", "خرید نقدی",
         [("چلوکباب کوبیده", 4, 1_250_000), ("نوشابه قوطی", 4, 180_000)]),
        ("INV-2291", "1404/08/03", "handwritten", "شرکت پخش البرز", "سوپرمارکت یاس",
         [("روغن سرخ‌کردنی ۵ لیتری", 8, 2_450_000)]),
    ]
    for number, date, kind, seller, buyer, items in samples:
        invoice = Invoice(
            user_id=user.id, number=number, issue_date=date, invoice_type=kind,
            seller_name=seller, buyer_name=buyer, status="confirmed",
            source="cloud" if kind != "handwritten" else "local",
            confidence=94 if kind != "handwritten" else 78,
            tags="نمونه,آزمایشی",
            notes="داده نمایشی برای آشنایی با محیط",
        )
        invoice.tax = int(sum(q * p for _, q, p in items) * 0.1)
        invoice.subtotal = sum(q * p for _, q, p in items)
        invoice.total = invoice.subtotal + invoice.tax
        db.add(invoice)
        db.commit()
        db.refresh(invoice)
        for idx, (desc, qty, price) in enumerate(items, start=1):
            db.add(InvoiceItem(
                invoice_id=invoice.id, row_no=idx, description=desc, qty=qty,
                unit_price=price, total=qty * price,
            ))
        db.commit()


def bootstrap(demo: bool = False) -> dict:
    init_db()
    db = SessionLocal()
    try:
        seed_plans(db)
        owner_info = seed_owner(db)
        if demo:
            owner = db.query(User).filter(User.role == "owner").first()
            if owner and not db.query(Invoice).filter(Invoice.user_id == owner.id).count():
                seed_demo(db, owner)
        return {"owner": owner_info}
    finally:
        db.close()


if __name__ == "__main__":  # pragma: no cover
    import sys

    logging.basicConfig(level=logging.INFO)
    result = bootstrap(demo="--demo" in sys.argv)
    info = result.get("owner")
    if info:
        print("\n=== حساب مالک ساخته شد ===")
        print(f"ایمیل: {info['email']}")
        print(f"گذرواژه: {info['password']}")
        print("==========================\n")
    else:
        print("حساب مالک از قبل وجود دارد.")
