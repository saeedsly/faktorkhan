"""مدل‌های داده OCR و فاکتور."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass
class InvoiceItem:
    """یک calm/ردیف از اقلام فاکتور."""

    row_no: int = 0
    description: str = ""
    quantity: float | None = None
    unit_price: float | None = None
    total_price: float | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class Invoice:
    """نمای ساختاریافته یک فاکتور از verdict OCR."""

    invoice_no: str | None = None
    invoice_date: str | None = None
    vendor: str | None = None
    customer: str | None = None
    subtotal: float | None = None
    tax: float | None = None
    total: float | None = None
    currency: str = "تومان"
    items: list[InvoiceItem] = field(default_factory=list)
    raw_text: str = ""
    confidence: float = 0.0
    source_image: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "invoice_no": self.invoice_no,
            "invoice_date": self.invoice_date,
            "vendor": self.vendor,
            "customer": self.customer,
            "subtotal": self.subtotal,
            "tax": self.tax,
            "total": self.total,
            "currency": self.currency,
            "items": [item.to_dict() for item in self.items],
            "raw_text": self.raw_text,
            "confidence": self.confidence,
            "source_image": self.source_image,
        }


@dataclass
class OCRResult:
    """خروجی موتور OCR."""

    text: str
    confidence: float
    backend: str
    words: list[dict[str, Any]] = field(default_factory=list)
    preprocessing_steps: list[str] = field(default_factory=list)
    source_image: str | None = None
