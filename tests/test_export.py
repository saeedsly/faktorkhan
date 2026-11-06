"""تست خروجی اکسل."""

from __future__ import annotations

import pandas as pd

from faktorkhan.export.excel import ExcelExporter
from faktorkhan.ocr.models import Invoice, InvoiceItem


def test_export_roundtrip(tmp_path):
    inv = Invoice(
        invoice_no="X-1",
        invoice_date="1403/01/01",
        vendor="ven",
        customer="cus",
        total=100000.0,
        tax=9000.0,
        currency="تومان",
        confidence=95.5,
        items=[
            InvoiceItem(row_no=1, description="کالم A", quantity=2, unit_price=50000.0, total_price=100000.0)
        ],
    )
    out = tmp_path / "out.xlsx"
    ExcelExporter().export([inv], out)
    assert out.exists()

    df = pd.read_excel(out)
    assert len(df) == 1
    assert df.iloc[0]["شرح کالا/خدمت"] == "کالم A"
    assert df.iloc[0]["مبلغ ردیف"] == 100000.0
