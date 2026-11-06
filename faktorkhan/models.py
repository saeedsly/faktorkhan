"""مدل‌های داده."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal

from .money import InvoiceTotals, LineTotals

MANUAL = "manual"
SYSTEM = "system"

DRAFT = "draft"
ISSUED = "issued"
CANCELLED = "cancelled"

KIND_LABELS = {MANUAL: "دستی", SYSTEM: "سیستمی"}
STATUS_LABELS = {DRAFT: "پیش‌نویس", ISSUED: "صادرشده", CANCELLED: "ابطال‌شده"}
NUMBER_PREFIX = {MANUAL: "M", SYSTEM: "S"}


@dataclass
class Customer:
    name: str
    phone: str = ""
    address: str = ""
    national_id: str = ""
    economic_code: str = ""
    id: int | None = None


@dataclass
class Product:
    name: str
    code: str = ""
    unit: str = ""
    unit_price: Decimal = Decimal(0)
    vat_rate: Decimal = Decimal(9)
    id: int | None = None


@dataclass
class LineItem:
    description: str
    quantity: Decimal
    unit_price: Decimal
    unit: str = ""
    discount: Decimal = Decimal(0)
    vat_rate: Decimal = Decimal(9)
    product_id: int | None = None
    position: int = 0
    id: int | None = None
    totals: LineTotals | None = None


@dataclass
class Invoice:
    kind: str
    customer_name: str
    customer_id: int | None = None
    customer_national_id: str = ""
    status: str = DRAFT
    number: str | None = None
    issue_date: date | None = None
    notes: str = ""
    items: list[LineItem] = field(default_factory=list)
    totals: InvoiceTotals | None = None
    created_at: str = ""
    issued_at: str = ""
    cancel_reason: str = ""
    id: int | None = None
