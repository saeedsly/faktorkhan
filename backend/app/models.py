"""مدل‌های داده فاکتورخوان."""
from __future__ import annotations

import secrets
from datetime import datetime, timezone

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    full_name: Mapped[str] = mapped_column(String(120), default="")
    company: Mapped[str] = mapped_column(String(160), default="")
    email: Mapped[str] = mapped_column(String(190), unique=True, index=True)
    phone: Mapped[str] = mapped_column(String(32), default="", index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(20), default="user")          # owner | admin | user
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=False)

    avatar_color: Mapped[str] = mapped_column(String(12), default="#d4af37")
    theme: Mapped[str] = mapped_column(String(12), default="dark")

    failed_attempts: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_ip: Mapped[str] = mapped_column(String(64), default="")

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    subscription: Mapped["Subscription | None"] = relationship(
        "Subscription", back_populates="user", uselist=False, cascade="all, delete-orphan"
    )
    invoices: Mapped[list["Invoice"]] = relationship("Invoice", back_populates="user")

    @property
    def is_admin(self) -> bool:
        return self.role in {"owner", "admin"}

    @property
    def initials(self) -> str:
        parts = [p for p in (self.full_name or self.email).split() if p]
        return (parts[0][:1] + (parts[1][:1] if len(parts) > 1 else "")) if parts else "؟"


class Plan(Base):
    __tablename__ = "plans"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(40), unique=True)
    name: Mapped[str] = mapped_column(String(120))
    tagline: Mapped[str] = mapped_column(String(200), default="")
    price: Mapped[int] = mapped_column(Integer, default=0)                 # ریال
    duration_days: Mapped[int] = mapped_column(Integer, default=365)
    support_days: Mapped[int] = mapped_column(Integer, default=365)
    page_quota: Mapped[int] = mapped_column(Integer, default=5000)
    max_devices: Mapped[int] = mapped_column(Integer, default=1)
    features: Mapped[list | None] = mapped_column(JSON, default=list)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_featured: Mapped[bool] = mapped_column(Boolean, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    keys: Mapped[list["LicenseKey"]] = relationship("LicenseKey", back_populates="plan")


class LicenseKey(Base):
    __tablename__ = "license_keys"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    key: Mapped[str] = mapped_column(String(48), unique=True, index=True)
    plan_id: Mapped[int] = mapped_column(ForeignKey("plans.id", ondelete="CASCADE"))
    status: Mapped[str] = mapped_column(String(16), default="unused")      # unused | used | revoked
    note: Mapped[str] = mapped_column(String(220), default="")
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    redeemed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    redeemed_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    plan: Mapped[Plan] = relationship("Plan", back_populates="keys")


class Subscription(Base):
    __tablename__ = "subscriptions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True)
    plan_id: Mapped[int | None] = mapped_column(ForeignKey("plans.id"), nullable=True)
    license_key_id: Mapped[int | None] = mapped_column(ForeignKey("license_keys.id"), nullable=True)

    status: Mapped[str] = mapped_column(String(20), default="trialing")    # trialing|active|expired|blocked
    starts_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    ends_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    support_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    pages_used: Mapped[int] = mapped_column(Integer, default=0)
    pages_quota: Mapped[int] = mapped_column(Integer, default=0)
    device_id: Mapped[str] = mapped_column(String(64), default="")
    devices: Mapped[str] = mapped_column(Text, default="")                # شناسه دستگاه‌ها، جدا با ,
    notes: Mapped[str] = mapped_column(String(255), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    user: Mapped[User] = relationship("User", back_populates="subscription")
    plan: Mapped[Plan | None] = relationship("Plan")

    @property
    def is_valid(self) -> bool:
        if self.status in {"blocked"}:
            return False
        if self.ends_at and self.ends_at < utcnow():
            return False
        return self.status in {"active", "trialing"}

    @property
    def days_left(self) -> int:
        if not self.ends_at:
            return 0
        return max((self.ends_at - utcnow()).days, 0)

    @property
    def pages_left(self) -> int:
        return max(self.pages_quota - self.pages_used, 0)


class Invoice(Base):
    __tablename__ = "invoices"
    __table_args__ = (
        Index("ix_invoices_user_status", "user_id", "status"),
        Index("ix_invoices_issue_date", "issue_date"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)

    number: Mapped[str] = mapped_column(String(80), default="", index=True)
    issue_date: Mapped[str] = mapped_column(String(20), default="")        # شمسی: 1404/08/16
    due_date: Mapped[str] = mapped_column(String(20), default="")
    invoice_type: Mapped[str] = mapped_column(String(20), default="printed")  # printed|thermal|handwritten|audio|other
    direction: Mapped[str] = mapped_column(String(12), default="purchase")    # purchase|sale

    seller_name: Mapped[str] = mapped_column(String(200), default="")
    seller_tax_id: Mapped[str] = mapped_column(String(40), default="")
    buyer_name: Mapped[str] = mapped_column(String(200), default="")
    buyer_tax_id: Mapped[str] = mapped_column(String(40), default="")

    subtotal: Mapped[int] = mapped_column(Integer, default=0)
    discount: Mapped[int] = mapped_column(Integer, default=0)
    tax: Mapped[int] = mapped_column(Integer, default=0)
    total: Mapped[int] = mapped_column(Integer, default=0)
    paid: Mapped[int] = mapped_column(Integer, default=0)
    currency: Mapped[str] = mapped_column(String(8), default="IRR")

    status: Mapped[str] = mapped_column(String(20), default="draft")      # draft|review|confirmed|archived
    source: Mapped[str] = mapped_column(String(20), default="manual")     # manual|cloud|local
    confidence: Mapped[int] = mapped_column(Integer, default=0)           # 0..100
    tags: Mapped[str] = mapped_column(String(255), default="")
    notes: Mapped[str] = mapped_column(Text, default="")
    ocr_text: Mapped[str] = mapped_column(Text, default="")
    raw_json: Mapped[dict | None] = mapped_column(JSON, default=dict)

    file_name: Mapped[str] = mapped_column(String(255), default="")
    file_path: Mapped[str] = mapped_column(String(500), default="")
    file_size: Mapped[int] = mapped_column(Integer, default=0)
    thumb_color: Mapped[str] = mapped_column(String(12), default="#2b3a55")

    job_id: Mapped[int | None] = mapped_column(ForeignKey("ocr_jobs.id"), nullable=True)
    duplicate_of: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # نتیجهٔ موتور فهم اقلام
    items_engine: Mapped[str] = mapped_column(String(24), default="")     # rules|ai|mix
    items_confidence: Mapped[int] = mapped_column(Integer, default=0)     # 0..100
    items_issues: Mapped[list | None] = mapped_column(JSON, default=list) # اشکال‌های عددی یافت‌شده
    items_autofixed: Mapped[int] = mapped_column(Integer, default=0)      # چند رقم خودکار اصلاح شد

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    user: Mapped[User] = relationship("User", back_populates="invoices")
    items: Mapped[list["InvoiceItem"]] = relationship(
        "InvoiceItem", back_populates="invoice", cascade="all, delete-orphan", order_by="InvoiceItem.row_no"
    )


class InvoiceItem(Base):
    __tablename__ = "invoice_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    invoice_id: Mapped[int] = mapped_column(ForeignKey("invoices.id", ondelete="CASCADE"), index=True)
    row_no: Mapped[int] = mapped_column(Integer, default=1)
    code: Mapped[str] = mapped_column(String(60), default="")
    description: Mapped[str] = mapped_column(String(300), default="")
    qty: Mapped[float] = mapped_column(Integer, default=1)
    unit: Mapped[str] = mapped_column(String(20), default="عدد")
    unit_price: Mapped[int] = mapped_column(Integer, default=0)
    discount: Mapped[int] = mapped_column(Integer, default=0)
    tax_rate: Mapped[int] = mapped_column(Integer, default=0)
    total: Mapped[int] = mapped_column(Integer, default=0)

    # متادیتای فهم خودکار: کدام موتور این سطر را خواند و چقدر مطمئن بود
    engine: Mapped[str] = mapped_column(String(24), default="manual")     # manual|rules|ai
    ai_confidence: Mapped[int] = mapped_column(Integer, default=0)        # 0..100
    verified: Mapped[int] = mapped_column(Integer, default=0)            # 0|1 تأیید دستی کاربر
    note: Mapped[str] = mapped_column(String(200), default="")           # توضیح اصلاح خودکار

    invoice: Mapped[Invoice] = relationship("Invoice", back_populates="items")


class OcrJob(Base):
    __tablename__ = "ocr_jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    provider: Mapped[str] = mapped_column(String(16), default="cloud")     # cloud | local
    method: Mapped[int] = mapped_column(Integer, default=4)
    output: Mapped[str] = mapped_column(String(20), default="txtrawjson")
    language: Mapped[str] = mapped_column(String(8), default="fa")
    file_name: Mapped[str] = mapped_column(String(255), default="")
    file_path: Mapped[str] = mapped_column(String(500), default="")
    file_token: Mapped[str] = mapped_column(String(120), default="")       # توکن فایل سرویس ابری
    pages: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(24), default="queued")
    progress: Mapped[int] = mapped_column(Integer, default=0)
    message: Mapped[str] = mapped_column(String(300), default="")
    text: Mapped[str] = mapped_column(Text, default="")
    download_url: Mapped[str] = mapped_column(String(600), default="")
    result_path: Mapped[str] = mapped_column(String(500), default="")
    meta: Mapped[dict | None] = mapped_column(JSON, default=dict)
    invoice_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    actor: Mapped[str] = mapped_column(String(190), default="")
    action: Mapped[str] = mapped_column(String(60), default="")
    entity: Mapped[str] = mapped_column(String(60), default="")
    entity_id: Mapped[str] = mapped_column(String(60), default="")
    detail: Mapped[str] = mapped_column(String(500), default="")
    ip: Mapped[str] = mapped_column(String(64), default="")
    user_agent: Mapped[str] = mapped_column(String(300), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)


class AppSetting(Base):
    __tablename__ = "app_settings"
    __table_args__ = (UniqueConstraint("key", name="uq_settings_key"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    key: Mapped[str] = mapped_column(String(80), index=True)
    value: Mapped[str] = mapped_column(Text, default="")
    is_secret: Mapped[bool] = mapped_column(Boolean, default=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class Device(Base):
    __tablename__ = "devices"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    device_id: Mapped[str] = mapped_column(String(64), default="")
    label: Mapped[str] = mapped_column(String(120), default="")
    platform: Mapped[str] = mapped_column(String(60), default="")
    last_seen: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


def new_device_id() -> str:
    return "DV-" + secrets.token_hex(8).upper()


class SupportMessage(Base):
    __tablename__ = "support_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    name: Mapped[str] = mapped_column(String(120), default="")
    contact: Mapped[str] = mapped_column(String(120), default="")
    subject: Mapped[str] = mapped_column(String(160), default="")
    message: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(16), default="new")   # new | answered | closed
    answer: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    answered_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
