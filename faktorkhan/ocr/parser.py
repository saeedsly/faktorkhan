"""تجزیه متن خام OCR به فیلدهای ساختاریافته فاکتور و اقلام."""

from __future__ import annotations

import re
from typing import Any

from faktorkhan.ocr.models import Invoice, InvoiceItem

PERSIAN_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹", "0123456789")
ARABIC_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")

NUMBER_RE = re.compile(r"(\d[\d,.\s]*\d|\d)")
DATE_RE = re.compile(r"(\d{1,4})[/\-](\d{1,2})[/\-](\d{1,4})")


class InvoiceParser:
    """استخراج فیلدهای سر فاکتور و لیست اقلام از متن OCR."""

    def __init__(self, currency: str = "تومان") -> None:
        self.currency = currency

    # ------------------------------------------------------------------ #
    # ابزارهای داخلی
    # ------------------------------------------------------------------ #
    @staticmethod
    def normalize(text: str) -> str:
        text = text.translate(PERSIAN_DIGITS).translate(ARABIC_DIGITS)
        text = re.sub(r"[ \t]+", " ", text)
        return text

    @staticmethod
    def _to_float(value: str) -> float | None:
        value = value.strip().replace(",", "").replace(" ", "")
        if not value:
            return None
        try:
            return float(value)
        except ValueError:
            return None

    # ------------------------------------------------------------------ #
    # فیلدهای سر فاکتور
    # ------------------------------------------------------------------ #
    def _extract_invoice_no(self, text: str) -> str | None:
        patterns = [
            r"فاکتور[^\d]{0,20}?[:：]?\s*([A-Za-z0-9][A-Za-z0-9\-_/]{2,30})",
            r"شماره[^\d]{0,20}?[:：]?\s*([A-Za-z0-9][A-Za-z0-9\-_/]{2,30})",
            r"(?:No|#|نمبر)[^\d]{0,10}[:：]?\s*([A-Za-z0-9\-_/]{3,30})",
            r"\b(\d{5,12})\b",
        ]
        for pattern in patterns:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                return match.group(1).strip()
        return None

    def _extract_date(self, text: str) -> str | None:
        match = re.search(r"تاریخ[^\d]{0,20}[:：]?\s*(\d{1,4}[/\-]\d{1,2}[/\-]\d{1,4})", text)
        if match:
            return match.group(1)
        match = DATE_RE.search(text)
        if match:
            return match.group(0)
        return None

    def _extract_total(self, text: str) -> float | None:
        patterns = [
            r"مبلغ[^\d]{0,30}[:：]?\s*(\d[\d,.\s]*)",
            r"جمع[^\d]{0,30}[:：]?\s*(\d[\d,.\s]*)",
            r"total[^\d]{0,20}[:：]?\s*(\d[\d,.\s]*)",
            r"amount[^\d]{0,20}[:：]?\s*(\d[\d,.\s]*)",
        ]
        for pattern in patterns:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                value = self._to_float(match.group(1))
                if value is not None:
                    return value
        candidates = [self._to_float(m.group(0)) for m in NUMBER_RE.finditer(text)]
        candidates = [c for c in candidates if c is not None and c > 1000]
        if candidates:
            return max(candidates)
        return None

    def _extract_tax(self, text: str) -> float | None:
        match = re.search(
            r"(مالیات|PVV|tax)[^\d]{0,30}[:：]?\s*(\d[\d,.\s]*)", text, re.IGNORECASE
        )
        if match:
            return self._to_float(match.group(2))
        return None

    def _extract_party(self, text: str, label: str) -> str | None:
        pattern = label + r"[^\n:]{0,40}[:：]?\s*([^\n\d]{3,60})"
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            return match.group(1).strip(" :\t-")
        return None

    # ------------------------------------------------------------------ #
    # اقلام
    # ------------------------------------------------------------------ #
    def _parse_items(self, text: str) -> list[InvoiceItem]:
        items: list[InvoiceItem] = []
        for idx, raw_line in enumerate(text.splitlines(), start=1):
            line = raw_line.strip()
            if len(line) < 3:
                continue
            numbers = [self._to_float(m) for m in NUMBER_RE.findall(line)]
            numbers = [n for n in numbers if n is not None]
            if not numbers:
                continue
            description = NUMBER_RE.sub(" ", line).strip(" :.-،،•")
            if len(description) < 2:
                description = line
            total_price = numbers[-1] if numbers else None
            unit_price = numbers[-2] if len(numbers) >= 2 else None
            quantity = None
            if len(numbers) >= 3:
                quantity = numbers[-3]
            items.append(
                InvoiceItem(
                    row_no=idx,
                    description=description[:100],
                    quantity=quantity,
                    unit_price=unit_price,
                    total_price=total_price,
                )
            )
        return items[:200]

    # ------------------------------------------------------------------ #
    # نقطه ورودی اصلی
    # ------------------------------------------------------------------ #
    def parse(self, text: str, confidence: float = 0.0) -> Invoice:
        normalized = self.normalize(text)
        invoice = Invoice(
            invoice_no=self._extract_invoice_no(normalized),
            invoice_date=self._extract_date(normalized),
            vendor=self._extract_party(normalized, "فروشنده"),
            customer=self._extract_party(normalized, "خریدار"),
            total=self._extract_total(normalized),
            tax=self._extract_tax(normalized),
            currency=self.currency,
            raw_text=text,
            confidence=confidence,
        )
        if invoice.total is not None:
            invoice.subtotal = invoice.total - (invoice.tax or 0)
        invoice.items = self._parse_items(normalized)
        return invoice
