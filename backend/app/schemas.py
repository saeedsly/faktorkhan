"""شِماهای ورودی/خروجی API."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

import re

from pydantic import BaseModel, Field, field_validator


# ------------------------------------------------------------ احراز هویت
class RegisterIn(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)
    email: str = Field(min_length=5, max_length=190)
    password: str = Field(min_length=8, max_length=128)
    phone: str = Field(default="", max_length=32)
    company: str = Field(default="", max_length=160)
    license_key: str = Field(default="", max_length=64)

    @field_validator("email")
    @classmethod
    def _valid_email(cls, value: str) -> str:
        value = (value or "").strip().lower()
        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", value):
            raise ValueError("ایمیل معتبر نیست.")
        return value


class LoginIn(BaseModel):
    email: str = Field(min_length=3, max_length=190)
    password: str = Field(min_length=1, max_length=128)
    device_id: str = Field(default="", max_length=64)


class ChangePasswordIn(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=128)


class ProfileIn(BaseModel):
    full_name: str | None = Field(default=None, max_length=120)
    company: str | None = Field(default=None, max_length=160)
    phone: str | None = Field(default=None, max_length=32)
    theme: Literal["dark", "light", "auto"] | None = None


# ------------------------------------------------------------ فاکتور
class InvoiceItemIn(BaseModel):
    row_no: int = 1
    code: str = ""
    description: str = ""
    qty: float = 1
    unit: str = "عدد"
    unit_price: int = 0
    discount: int = 0
    tax_rate: int = 0
    total: int = 0


class InvoiceIn(BaseModel):
    number: str = ""
    issue_date: str = ""
    due_date: str = ""
    invoice_type: Literal["printed", "thermal", "handwritten", "audio", "other"] = "printed"
    direction: Literal["purchase", "sale"] = "purchase"
    seller_name: str = ""
    seller_tax_id: str = ""
    buyer_name: str = ""
    buyer_tax_id: str = ""
    subtotal: int = 0
    discount: int = 0
    tax: int = 0
    total: int = 0
    paid: int = 0
    status: Literal["draft", "review", "confirmed", "archived"] = "draft"
    tags: str = ""
    notes: str = ""
    ocr_text: str = ""
    source: Literal["manual", "cloud", "local"] = "manual"
    job_id: int | None = None
    items: list[InvoiceItemIn] = []

    @field_validator("issue_date", "due_date")
    @classmethod
    def _normalize_date(cls, v: str) -> str:
        digits = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")
        return (v or "").translate(digits).replace("-", "/").replace(".", "/").strip()


# ------------------------------------------------------------ ابری
class CloudLinkIn(BaseModel):
    filelink: str = Field(min_length=8, max_length=800)
    method: int = 4
    output: str = "txtrawjson"
    invoice_type: str = "printed"


class CloudConvertIn(BaseModel):
    job_id: int
    method: int = Field(default=4, ge=1, le=4)
    output: Literal["", "keeplayout", "txt", "txtraw", "txtrawjson", "jsoncoordinates"] = "txtrawjson"


class AudioConvertIn(BaseModel):
    job_id: int
    language: str = "fa"


# ------------------------------------------------------------ اشتراک
class RedeemIn(BaseModel):
    key: str = Field(min_length=6, max_length=64)


class PlanIn(BaseModel):
    code: str = Field(min_length=2, max_length=40)
    name: str = Field(min_length=2, max_length=120)
    tagline: str = ""
    price: int = 0
    duration_days: int = 365
    support_days: int = 365
    page_quota: int = 5000
    max_devices: int = 1
    features: list[str] = []
    is_active: bool = True
    is_featured: bool = False
    sort_order: int = 0


class KeyBatchIn(BaseModel):
    plan_id: int
    count: int = Field(default=10, ge=1, le=500)
    note: str = ""
    prefix: str = "FK"


class AdminUserIn(BaseModel):
    is_active: bool | None = None
    role: Literal["owner", "admin", "user"] | None = None
    plan_id: int | None = None
    extend_days: int | None = None
    pages_delta: int | None = None
    notes: str | None = None


# ------------------------------------------------------------ سیستم
class CloudTokenIn(BaseModel):
    token: str = Field(min_length=8, max_length=200)
    verify: bool = True


class SupportTicketIn(BaseModel):
    subject: str = Field(min_length=3, max_length=160)
    message: str = Field(min_length=5, max_length=4000)
    contact: str = ""


class SettingsIn(BaseModel):
    registration_open: bool | None = None
    license_required: bool | None = None
    trial_days: int | None = None
    trial_pages: int | None = None
    support_phone: str | None = None
    support_email: str | None = None
    support_telegram: str | None = None
    announcement: str | None = None


class InvoiceOut(BaseModel):
    id: int
    number: str
    issue_date: str
    invoice_type: str
    direction: str
    seller_name: str
    buyer_name: str
    total: int
    status: str
    source: str
    confidence: int
    created_at: datetime

    class Config:
        from_attributes = True
