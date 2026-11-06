import os
from datetime import date
from decimal import Decimal

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

import pytest  # noqa: E402
from PySide6.QtWidgets import QApplication, QMessageBox  # noqa: E402

from faktorkhan.db import Database  # noqa: E402
from faktorkhan.models import DRAFT, MANUAL, SYSTEM, Customer, Invoice, LineItem  # noqa: E402
from faktorkhan.pdf import build_invoice_html, export_invoice_pdf  # noqa: E402
from faktorkhan.service import InvoiceService  # noqa: E402
from faktorkhan.ui.invoice_dialog import COL_DISC, COL_PRICE, COL_QTY, COL_VAT, InvoiceDialog  # noqa: E402
from faktorkhan.ui.main_window import MainWindow  # noqa: E402


@pytest.fixture(scope="session")
def qapp():
    return QApplication.instance() or QApplication([])


@pytest.fixture(autouse=True)
def no_modal_boxes(monkeypatch):
    """پیام‌های مودال نباید تست را متوقف کنند."""
    monkeypatch.setattr(QMessageBox, "information", lambda *a, **k: QMessageBox.StandardButton.Ok)
    monkeypatch.setattr(QMessageBox, "warning", lambda *a, **k: QMessageBox.StandardButton.Ok)
    monkeypatch.setattr(QMessageBox, "question", lambda *a, **k: QMessageBox.StandardButton.Yes)


@pytest.fixture
def db(tmp_path):
    database = Database(tmp_path / "ui.db")
    yield database
    database.close()


@pytest.fixture
def service(db):
    return InvoiceService(db, today=lambda: date(2026, 11, 7))


def _issued_manual(service):
    draft = service.save_manual_draft(Invoice(
        kind=MANUAL, customer_name="علی", items=[LineItem(
            description="برنج ایرانی", unit="کیلو", quantity=Decimal("10"),
            unit_price=Decimal("250000"), discount=Decimal("0"), vat_rate=Decimal("9"))],
    ))
    return service.issue_manual(draft.id, date(2026, 11, 6))


def test_pdf_export_creates_pdf(qapp, service, tmp_path):
    inv = _issued_manual(service)
    out = export_invoice_pdf(inv, {"company_name": "شرکت نمونه"}, tmp_path / "inv.pdf")
    data = out.read_bytes()
    assert data.startswith(b"%PDF")
    assert len(data) > 1000


def test_pdf_html_escapes_user_text_and_shows_totals(service):
    inv = _issued_manual(service)
    inv.customer_name = "<script>x</script>"
    html = build_invoice_html(inv, {})
    assert "&lt;script&gt;" in html and "<script>x" not in html
    assert "۲٬۷۲۵٬۰۰۰" in html  # 10 × 250,000 = 2,500,000 + ۹٪ = 2,725,000


def test_main_window_has_all_tabs(qapp, db, service):
    window = MainWindow(db, service)
    titles = [window.tabText(i) for i in range(window.count())]
    assert titles == ["فاکتورها", "مشتریان", "کالا و خدمات", "گزارش فروش", "تنظیمات شرکت"]


def test_manual_dialog_flow(qapp, db, service):
    cid = db.save_customer(Customer(name="مشتری آزمایشی", national_id="1111"))
    dlg = InvoiceDialog(db, service, MANUAL)
    dlg.customer_combo.setCurrentIndex(dlg.customer_combo.findData(cid))
    assert dlg.customer_name.text() == "مشتری آزمایشی"
    dlg.date_edit.setText("۱۴۰۵/۰۸/۱۶")
    dlg.table.item(0, 0).setText("قند")
    dlg.table.item(0, COL_QTY).setText("3")
    dlg.table.item(0, COL_PRICE).setText("۱۰۰۰۰")
    dlg.table.item(0, COL_DISC).setText("0")
    dlg.table.item(0, COL_VAT).setText("9")
    dlg._recalc()
    assert "۳۲٬۷۰۰" in dlg.totals_label.text()  # 30,000 + ۹٪ = 32,700

    # ردیف ناقص باید خطای مشخص بدهد و ذخیره را نپذیرد
    dlg._add_row()
    dlg._recalc()
    assert dlg.totals_label.text().startswith("⚠")
    assert "ردیف 2" in dlg.totals_label.text()
    dlg._on_save_draft()
    assert dlg.saved_invoice is None

    dlg.table.removeRow(1)
    dlg._recalc()
    dlg._on_save_draft()
    saved = dlg.saved_invoice
    assert saved is not None and saved.status == DRAFT and saved.number is None
    assert saved.totals.total == Decimal("32700")
    assert saved.issue_date == date(2026, 11, 7)


def test_manual_dialog_issue_assigns_number(qapp, db, service):
    dlg = InvoiceDialog(db, service, MANUAL)
    dlg.customer_name.setText("مشتری")
    dlg.date_edit.setText("1405/08/15")  # = 2026-11-06
    dlg.table.item(0, 0).setText("روغن")
    dlg.table.item(0, COL_PRICE).setText("100000")
    dlg._on_issue()
    assert dlg.saved_invoice is not None
    assert dlg.saved_invoice.number == "M-1405-0001"
    assert dlg.saved_invoice.issue_date == date(2026, 11, 6)


def test_system_dialog_issues_immediately(qapp, db, service):
    dlg = InvoiceDialog(db, service, SYSTEM)
    dlg.customer_name.setText("مشتری نقدی")
    dlg.table.item(0, 0).setText("خدمات نگهداری")
    dlg.table.item(0, COL_QTY).setText("1")
    dlg.table.item(0, COL_PRICE).setText("500000")
    dlg._on_issue()
    assert dlg.saved_invoice is not None
    assert dlg.saved_invoice.number == "S-1405-0001"
    assert dlg.saved_invoice.totals.total == Decimal("545000")


def test_issued_invoice_dialog_is_read_only(qapp, db, service):
    inv = _issued_manual(service)
    dlg = InvoiceDialog(db, service, MANUAL, invoice=inv)
    assert dlg.read_only
    assert not dlg.btn_issue.isEnabled()
    assert not dlg.btn_save_draft.isEnabled()
