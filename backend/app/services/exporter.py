"""خروجی‌گیری: اکسل، CSV، JSON و نسخه چاپی."""
from __future__ import annotations

import csv
import io
import json
from datetime import datetime

from ..jalali import jalali_pretty
from ..models import Invoice

HEADERS = [
    "شناسه", "شماره فاکتور", "تاریخ", "نوع", "جهت", "فروشنده", "خریدار",
    "جمع اقلام", "تخفیف", "مالیات", "مبلغ کل", "پرداختی", "وضعیت", "منبع", "اعتماد",
]


def _rows(invoices: list[Invoice]) -> list[list]:
    type_fa = {"printed": "چاپی", "thermal": "حرارتی", "handwritten": "دستی", "audio": "صوتی", "other": "سایر"}
    status_fa = {"draft": "پیش‌نویس", "review": "بازبینی", "confirmed": "تأیید‌شده", "archived": "بایگانی"}
    source_fa = {"manual": "دستی", "cloud": "ابر", "local": "لوکال"}
    return [
        [
            inv.id, inv.number, inv.issue_date, type_fa.get(inv.invoice_type, inv.invoice_type),
            "خرید" if inv.direction == "purchase" else "فروش",
            inv.seller_name, inv.buyer_name, inv.subtotal, inv.discount, inv.tax, inv.total,
            inv.paid, status_fa.get(inv.status, inv.status), source_fa.get(inv.source, inv.source),
            f"{inv.confidence}%",
        ]
        for inv in invoices
    ]


def to_csv(invoices: list[Invoice]) -> bytes:
    buf = io.StringIO()
    buf.write("\ufeff")  # BOM برای اکسل فارسی
    writer = csv.writer(buf, delimiter=",", quoting=csv.QUOTE_MINIMAL)
    writer.writerow(HEADERS)
    writer.writerows(_rows(invoices))
    return buf.getvalue().encode("utf-8")


def to_xlsx(invoices: list[Invoice]) -> bytes:
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    from openpyxl.utils import get_column_letter

    wb = Workbook()
    ws = wb.active
    ws.title = "فاکتورها"
    ws.sheet_view.rightToLeft = True

    gold = "D4AF37"
    header_fill = PatternFill("solid", fgColor="1B2540")
    header_font = Font(color=gold, bold=True, size=11)
    thin = Side(style="thin", color="D9D9D9")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)

    ws.append(HEADERS)
    for cell in ws[1]:
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center", vertical="center")
        cell.border = border
    ws.row_dimensions[1].height = 26

    for row in _rows(invoices):
        ws.append(row)
    for row in ws.iter_rows(min_row=2, max_row=ws.max_row):
        for cell in row:
            cell.alignment = Alignment(horizontal="center", vertical="center")
            cell.border = border
            if isinstance(cell.value, int) and cell.column >= 8 and cell.column <= 12:
                cell.number_format = "#,##0"

    widths = [8, 16, 12, 10, 8, 26, 26, 16, 12, 14, 16, 14, 12, 10, 10]
    for idx, width in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(idx)].width = width
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = ws.dimensions

    # برگه اقلام
    items_ws = wb.create_sheet("اقلام")
    items_ws.sheet_view.rightToLeft = True
    item_headers = ["شماره فاکتور", "ردیف", "کد", "شرح", "تعداد", "واحد", "قیمت واحد", "تخفیف", "مبلغ"]
    items_ws.append(item_headers)
    for cell in items_ws[1]:
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center")
    for inv in invoices:
        for item in inv.items:
            items_ws.append([
                inv.number, item.row_no, item.code, item.description, item.qty,
                item.unit, item.unit_price, item.discount, item.total,
            ])
    for idx, width in enumerate([16, 8, 10, 40, 10, 8, 16, 12, 16], start=1):
        items_ws.column_dimensions[get_column_letter(idx)].width = width
    items_ws.freeze_panes = "A2"

    # برگه خلاصه
    summary = wb.create_sheet("خلاصه", 0)
    summary.sheet_view.rightToLeft = True
    total_sum = sum(i.total for i in invoices)
    tax_sum = sum(i.tax for i in invoices)
    summary["A1"] = "گزارش فاکتورها"
    summary["A1"].font = Font(bold=True, size=14, color="1B2540")
    summary["A3"] = "تعداد فاکتور"
    summary["B3"] = len(invoices)
    summary["A4"] = "جمع مبالغ (ریال)"
    summary["B4"] = total_sum
    summary["B4"].number_format = "#,##0"
    summary["A5"] = "جمع مالیات (ریال)"
    summary["B5"] = tax_sum
    summary["B5"].number_format = "#,##0"
    summary["A6"] = "تاریخ گزارش"
    summary["B6"] = jalali_pretty(datetime.now().strftime("%Y/%m/%d"))
    for r in range(3, 7):
        summary[f"A{r}"].font = Font(bold=True)
    summary.column_dimensions["A"].width = 24
    summary.column_dimensions["B"].width = 22

    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


def to_json(invoices: list[Invoice]) -> bytes:
    data = [
        {
            "id": inv.id,
            "number": inv.number,
            "issue_date": inv.issue_date,
            "invoice_type": inv.invoice_type,
            "direction": inv.direction,
            "seller": {"name": inv.seller_name, "tax_id": inv.seller_tax_id},
            "buyer": {"name": inv.buyer_name, "tax_id": inv.buyer_tax_id},
            "subtotal": inv.subtotal,
            "discount": inv.discount,
            "tax": inv.tax,
            "total": inv.total,
            "paid": inv.paid,
            "status": inv.status,
            "source": inv.source,
            "confidence": inv.confidence,
            "tags": [t for t in inv.tags.split(",") if t],
            "items": [
                {
                    "row_no": i.row_no, "code": i.code, "description": i.description,
                    "qty": i.qty, "unit": i.unit, "unit_price": i.unit_price,
                    "discount": i.discount, "tax_rate": i.tax_rate, "total": i.total,
                }
                for i in inv.items
            ],
        }
        for inv in invoices
    ]
    return json.dumps({"generated_at": datetime.utcnow().isoformat(), "count": len(data), "invoices": data},
                      ensure_ascii=False, indent=2).encode("utf-8")
