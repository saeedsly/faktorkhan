"""ساخت خروجی PDF فاکتور (با موتور Qt و پشتیبانی کامل از فارسی راست‌به‌چپ)."""

from __future__ import annotations

from html import escape
from pathlib import Path

from .jalali import format_jalali
from .models import KIND_LABELS, Invoice
from .money import amount_in_words, format_amount

COMPANY_FIELDS = (
    ("company_name", "نام شرکت / فروشنده"),
    ("company_national_id", "شناسه ملی"),
    ("company_economic_code", "کد اقتصادی"),
    ("company_phone", "تلفن"),
    ("company_address", "نشانی"),
)


def _pct(value) -> str:
    return format_amount(value)


def build_invoice_html(inv: Invoice, company: dict[str, str]) -> str:
    e = escape
    number = inv.number or "پیش‌نویس"
    date_text = format_jalali(inv.issue_date) if inv.issue_date else "—"
    totals = inv.totals
    assert totals is not None

    rows = []
    for index, item in enumerate(inv.items, start=1):
        lt = item.totals
        assert lt is not None
        rows.append(
            "<tr>"
            f"<td align=center>{format_amount(index)}</td>"
            f"<td>{e(item.description)}</td>"
            f"<td align=center>{e(item.unit)}</td>"
            f"<td align=center>{format_amount(item.quantity)}</td>"
            f"<td align=left>{format_amount(item.unit_price)}</td>"
            f"<td align=left>{format_amount(lt.discount)}</td>"
            f"<td align=left>{format_amount(lt.taxable)}</td>"
            f"<td align=center>{_pct(item.vat_rate)}٪</td>"
            f"<td align=left>{format_amount(lt.vat)}</td>"
            f"<td align=left><b>{format_amount(lt.total)}</b></td>"
            "</tr>"
        )

    company_lines = "".join(
        f"<div>{e(label)}: {e(company.get(key, ''))}</div>"
        for key, label in COMPANY_FIELDS
        if company.get(key)
    )
    customer_lines = f"<div>نام: {e(inv.customer_name)}</div>"
    if inv.customer_national_id:
        customer_lines += f"<div>شناسه ملی: {e(inv.customer_national_id)}</div>"
    notes = f"<p><b>توضیحات:</b> {e(inv.notes)}</p>" if inv.notes else ""
    cancelled = (
        f"<p style='color:#b00000'><b>این فاکتور ابطال شده است.</b> دلیل: {e(inv.cancel_reason)}</p>"
        if inv.status == "cancelled"
        else ""
    )

    return f"""<html dir="rtl"><head><meta charset="utf-8"></head>
<body dir="rtl" style="font-family: Tahoma, Arial, sans-serif; font-size: 10pt;">
<h2 align=center>فاکتور {e(KIND_LABELS[inv.kind])} — شماره {e(number)}</h2>
<table width="100%" cellspacing="0" cellpadding="4">
  <tr>
    <td width="50%" valign=top><b>فروشنده</b>{company_lines}</td>
    <td width="50%" valign=top>
      <div><b>شماره فاکتور:</b> {e(number)}</div>
      <div><b>تاریخ صدور:</b> {e(date_text)}</div>
      <div><b>خریدار</b></div>{customer_lines}
    </td>
  </tr>
</table>
<br>
<table width="100%" border="1" cellspacing="0" cellpadding="4">
  <tr style="background-color:#e8eef5">
    <th>ردیف</th><th>شرح کالا/خدمت</th><th>واحد</th><th>تعداد</th><th>قیمت واحد (ریال)</th>
    <th>تخفیف</th><th>مبلغ مشمول مالیات</th><th>مالیات</th><th>مبلغ مالیات</th><th>جمع ردیف</th>
  </tr>
  {''.join(rows)}
</table>
<br>
<table width="100%" cellspacing="0" cellpadding="4">
  <tr><td align=left>جمع اقلام: {format_amount(totals.subtotal)} ریال</td></tr>
  <tr><td align=left>جمع تخفیف: {format_amount(totals.discount)} ریال</td></tr>
  <tr><td align=left>جمع مشمول مالیات: {format_amount(totals.taxable)} ریال</td></tr>
  <tr><td align=left>جمع مالیات: {format_amount(totals.vat)} ریال</td></tr>
  <tr><td align=left><b>مبلغ قابل پرداخت: {format_amount(totals.total)} ریال</b></td></tr>
  <tr><td align=left>{e(amount_in_words(totals.total))}</td></tr>
</table>
{notes}
{cancelled}
</body></html>"""


def export_invoice_pdf(inv: Invoice, company: dict[str, str], path: str | Path) -> Path:
    """فاکتور را در فایل PDF ذخیره می‌کند. نیاز به QGuiApplication دارد."""
    from PySide6.QtCore import QMarginsF, Qt
    from PySide6.QtGui import QPageLayout, QPageSize, QTextDocument, QTextOption
    from PySide6.QtPrintSupport import QPrinter

    target = Path(path)
    doc = QTextDocument()
    option = QTextOption()
    option.setTextDirection(Qt.LayoutDirection.RightToLeft)
    doc.setDefaultTextOption(option)
    doc.setHtml(build_invoice_html(inv, company))

    printer = QPrinter(QPrinter.PrinterMode.HighResolution)
    printer.setOutputFormat(QPrinter.OutputFormat.PdfFormat)
    printer.setOutputFileName(str(target))
    printer.setPageSize(QPageSize(QPageSize.PageSizeId.A4))
    printer.setPageMargins(QMarginsF(12, 12, 12, 12), QPageLayout.Unit.Millimeter)
    doc.print_(printer)
    return target
