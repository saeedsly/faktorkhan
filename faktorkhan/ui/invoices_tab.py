"""تب فهرست فاکتورها و عملیات روی آن‌ها."""

from __future__ import annotations

import sqlite3
from pathlib import Path

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QAbstractItemView,
    QFileDialog,
    QHBoxLayout,
    QHeaderView,
    QPushButton,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from ..clock import today
from ..db import Database
from ..errors import ValidationError
from ..jalali import format_jalali, parse_jalali
from ..models import DRAFT, ISSUED, KIND_LABELS, MANUAL, SYSTEM, STATUS_LABELS, Invoice
from ..money import format_amount
from ..pdf import export_invoice_pdf
from ..service import InvoiceService
from .common import ask_text, confirm, show_error, show_info
from .invoice_dialog import InvoiceDialog

HEADERS = ["شماره", "نوع", "وضعیت", "تاریخ صدور", "مشتری", "جمع کل (ریال)"]


class InvoicesTab(QWidget):
    def __init__(self, db: Database, service: InvoiceService, parent=None):
        super().__init__(parent)
        self._db = db
        self._service = service
        self._build()
        self.refresh()

    def _build(self) -> None:
        root = QVBoxLayout(self)
        bar = QHBoxLayout()
        buttons = [
            ("فاکتور دستی جدید", self._new_manual),
            ("فاکتور سیستمی جدید", self._new_system),
            ("مشاهده / ویرایش", self._open_selected),
            ("صدور پیش‌نویس", self._issue_draft),
            ("ابطال فاکتور", self._cancel_selected),
            ("حذف پیش‌نویس", self._delete_draft),
            ("خروجی PDF", self._export_pdf),
            ("بروزرسانی", self.refresh),
        ]
        for label, handler in buttons:
            btn = QPushButton(label)
            btn.clicked.connect(handler)
            bar.addWidget(btn)
        bar.addStretch(1)
        root.addLayout(bar)

        self.table = QTableWidget(0, len(HEADERS))
        self.table.setHorizontalHeaderLabels(HEADERS)
        self.table.verticalHeader().setVisible(False)
        self.table.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)
        self.table.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
        self.table.setSelectionMode(QAbstractItemView.SelectionMode.SingleSelection)
        self.table.horizontalHeader().setSectionResizeMode(QHeaderView.ResizeMode.Stretch)
        self.table.doubleClicked.connect(lambda _idx: self._open_selected())
        root.addWidget(self.table)

    # ----- داده -----
    def refresh(self) -> None:
        invoices = self._db.list_invoices()
        self.table.setRowCount(0)
        for inv in invoices:
            row = self.table.rowCount()
            self.table.insertRow(row)
            total = format_amount(inv.totals.total) if inv.totals else ""
            values = [
                inv.number or "— (پیش‌نویس)",
                KIND_LABELS[inv.kind],
                STATUS_LABELS[inv.status],
                format_jalali(inv.issue_date) if inv.issue_date else "—",
                inv.customer_name,
                total,
            ]
            for col, text in enumerate(values):
                cell = QTableWidgetItem(text)
                if col == 0:
                    cell.setData(Qt.ItemDataRole.UserRole, inv.id)
                if col in (0, 3, 5):
                    cell.setTextAlignment(Qt.AlignmentFlag.AlignCenter)
                self.table.setItem(row, col, cell)

    def _selected_invoice(self) -> Invoice | None:
        row = self.table.currentRow()
        if row < 0:
            show_error(self, "ابتدا یک فاکتور را از فهرست انتخاب کنید.")
            return None
        invoice_id = self.table.item(row, 0).data(Qt.ItemDataRole.UserRole)
        return self._db.get_invoice(invoice_id)

    def _run(self, action, success: str | None = None) -> bool:
        try:
            action()
        except (ValidationError, sqlite3.Error) as exc:
            show_error(self, str(exc))
            return False
        if success:
            show_info(self, success)
        self.refresh()
        return True

    # ----- عملیات -----
    def _new_manual(self) -> None:
        dlg = InvoiceDialog(self._db, self._service, MANUAL, parent=self)
        if dlg.exec():
            self.refresh()

    def _new_system(self) -> None:
        dlg = InvoiceDialog(self._db, self._service, SYSTEM, parent=self)
        if dlg.exec():
            self.refresh()

    def _open_selected(self) -> None:
        inv = self._selected_invoice()
        if inv is None:
            return
        dlg = InvoiceDialog(self._db, self._service, inv.kind, invoice=inv, parent=self)
        dlg.exec()
        self.refresh()

    def _issue_draft(self) -> None:
        inv = self._selected_invoice()
        if inv is None:
            return
        if inv.kind != MANUAL or inv.status != DRAFT:
            show_error(self, "فقط پیش‌نویس فاکتور دستی قابل صدور است.")
            return
        default = format_jalali(inv.issue_date or today())
        text = ask_text(self, "صدور فاکتور", "تاریخ صدور (شمسی):", default)
        if text is None:
            return
        if not confirm(self, "پس از صدور، فاکتور قابل ویرایش نیست. ادامه می‌دهید؟"):
            return

        def action():
            issued = self._service.issue_manual(inv.id, parse_jalali(text))
            show_info(self, f"فاکتور با شماره {issued.number} صادر شد.")

        self._run(action)

    def _cancel_selected(self) -> None:
        inv = self._selected_invoice()
        if inv is None:
            return
        if inv.status != ISSUED:
            show_error(self, "فقط فاکتور صادرشده قابل ابطال است.")
            return
        reason = ask_text(self, "ابطال فاکتور", f"دلیل ابطال فاکتور {inv.number}:")
        if reason is None:
            return
        if not confirm(self, "فاکتور ابطال می‌شود؛ شماره آن دوباره استفاده نخواهد شد. ادامه؟"):
            return
        self._run(lambda: self._service.cancel(inv.id, reason), "فاکتور ابطال شد.")

    def _delete_draft(self) -> None:
        inv = self._selected_invoice()
        if inv is None:
            return
        if inv.status != DRAFT:
            show_error(self, "فقط پیش‌نویس قابل حذف است.")
            return
        if not confirm(self, "این پیش‌نویس حذف شود؟"):
            return
        self._run(lambda: self._service.delete_draft(inv.id))

    def _export_pdf(self) -> None:
        inv = self._selected_invoice()
        if inv is None:
            return
        name = (inv.number or f"پیش-نویس-{inv.id}") + ".pdf"
        default = str(Path.home() / "Documents" / name)
        path, _ = QFileDialog.getSaveFileName(self, "ذخیره PDF فاکتور", default, "PDF (*.pdf)")
        if not path:
            return
        if not path.lower().endswith(".pdf"):
            path += ".pdf"
        try:
            export_invoice_pdf(inv, self._db.get_company_info(), path)
        except OSError as exc:
            show_error(self, f"ذخیره فایل ناموفق بود:\n{exc}")
            return
        show_info(self, f"فایل PDF ذخیره شد:\n{path}")

