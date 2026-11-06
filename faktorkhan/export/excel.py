"""خروجی اکسل حرفه‌ای برای فاکتورهای پردازش‌شده."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pandas as pd
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

from faktorkhan.ocr.models import Invoice, InvoiceItem


class ExcelExporter:
    """ساخت فایل اکسل قالب‌بندی‌شده از لیست فاکتورها."""

    def __init__(self, currency: str = "تومان") -> None:
        self.currency = currency

    def export(self, invoices: list[Invoice], path: str | Path) -> Path:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)

        rows: list[dict[str, Any]] = []
        for invoice in invoices:
            items = invoice.items or [InvoiceItem()]
            for item in items:
                rows.append(
                    {
                        "شماره فاکتور": invoice.invoice_no,
                        "تاریخ": invoice.invoice_date,
                        "فروشنده": invoice.vendor,
                        "خریدار": invoice.customer,
                        "ردیف": item.row_no,
                        "شرح کالا/خدمت": item.description,
                        "تعداد": item.quantity,
                        "قیمت واحد": item.unit_price,
                        "مبلغ ردیف": item.total_price,
                        "جمع فاکتور": invoice.total,
                        "مالیات": invoice.tax,
                        "ارز": invoice.currency,
                        "اطمینان OCR": round(invoice.confidence, 2),
                        "تصویر مبدا": invoice.source_image,
                    }
                )

        df = pd.DataFrame(rows)
        with pd.ExcelWriter(path, engine="openpyxl") as writer:
            df.to_excel(writer, index=False, sheet_name="فاکتورها")
            self._style_sheet(writer.sheets["فاکتورها"], len(df.columns))
        return path

    def _style_sheet(self, sheet, ncols: int) -> None:
        header_fill = PatternFill("solid", fgColor="1F3864")
        header_font = Font(bold=True, color="FFFFFF")
        thin = Side(style="thin", color="9AA5B1")
        border = Border(left=thin, right=thin, top=thin, bottom=thin)

        for col in range(1, ncols + 1):
            cell = sheet.cell(row=1, column=col)
            cell.fill = header_fill
            cell.font = header_font
            cell.alignment = Alignment(
                horizontal="center", vertical="center", wrap_text=True
            )
            cell.border = border

        for row in sheet.iter_rows(min_row=2):
            for cell in row:
                cell.border = border
                cell.alignment = Alignment(
                    horizontal="right", vertical="center", wrap_text=True
                )

        for col in range(1, ncols + 1):
            sheet.column_dimensions[get_column_letter(col)].width = 24

        sheet.freeze_panes = "A2"
        sheet.sheet_view.showGridLines = False
