"""تست‌های تجزیه‌گر فاکتور."""

from __future__ import annotations

from faktorkhan.ocr.parser import InvoiceParser


SAMPLE = """
فاکتور شماره: 1403-00123
تاریخ: 1403/05/21
فروشنده: magazin x
خریدار: cliente y
مبلغ کل: 250,000
مالیات: 25,000
غره educators 2 x 100,000
کتاب wissenschaft 1 x 50,000
"""


def test_parse_fields():
    parser = InvoiceParser()
    inv = parser.parse(SAMPLE, confidence=90.0)
    assert inv.invoice_no == "1403-00123"
    assert inv.invoice_date == "1403/05/21"
    assert inv.vendor == "magazin x"
    assert inv.customer == "cliente y"
    assert inv.total == 250000.0
    assert inv.tax == 25000.0


def test_parse_items():
    parser = InvoiceParser()
    inv = parser.parse(SAMPLE, confidence=0.0)
    assert len(inv.items) >= 2
    assert any("کتاب" in it.description for it in inv.items)


def test_persian_digits():
    parser = InvoiceParser()
    text = "جمع: ۱۲۳۴۵۶۷۸۹"
    inv = parser.parse(text, confidence=0.0)
    assert inv.total == 123456789.0
