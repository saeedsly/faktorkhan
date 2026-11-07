"""پنجره‌ی اصلی، گزارش و تنظیمات شرکت."""

from __future__ import annotations

import sqlite3

from PySide6.QtWidgets import (
    QAbstractItemView,
    QFormLayout,
    QHBoxLayout,
    QHeaderView,
    QLabel,
    QLineEdit,
    QPushButton,
    QTableWidget,
    QTableWidgetItem,
    QTabWidget,
    QVBoxLayout,
    QWidget,
)

from ..clock import today
from ..db import Database
from ..errors import ValidationError
from ..jalali import format_jalali, jalali_month_bounds, parse_jalali
from ..models import KIND_LABELS
from ..money import add_invoice_totals, format_amount
from ..service import InvoiceService
from .common import APP_TITLE, show_error, show_info
from .invoices_tab import InvoicesTab
from .masters import CustomersTab, ProductsTab


class ReportTab(QWidget):
    HEADERS = ["نوع فاکتور", "تعداد", "جمع اقلام", "تخفیف", "مشمول مالیات", "مالیات", "قابل پرداخت"]

    def __init__(self, service: InvoiceService, parent=None):
        super().__init__(parent)
        self._service = service
        root = QVBoxLayout(self)

        bar = QHBoxLayout()
        start, end = jalali_month_bounds(today())
        self.start_edit = QLineEdit(format_jalali(start))
        self.end_edit = QLineEdit(format_jalali(end))
        self.start_edit.setPlaceholderText("شروع (شمسی)")
        self.end_edit.setPlaceholderText("پایان (شمسی)")
        show = QPushButton("نمایش گزارش")
        show.clicked.connect(self.show_report)
        bar.addWidget(QLabel("از:"))
        bar.addWidget(self.start_edit)
        bar.addWidget(QLabel("تا:"))
        bar.addWidget(self.end_edit)
        bar.addWidget(show)
        bar.addStretch(1)
        root.addLayout(bar)

        self.table = QTableWidget(0, len(self.HEADERS))
        self.table.setHorizontalHeaderLabels(self.HEADERS)
        self.table.verticalHeader().setVisible(False)
        self.table.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)
        self.table.horizontalHeader().setSectionResizeMode(QHeaderView.ResizeMode.Stretch)
        root.addWidget(self.table)
        root.addWidget(QLabel("گزارش فقط فاکتورهای صادرشده را در بازه‌ی انتخابی جمع می‌کند؛ فاکتورهای ابطال‌شده حذف می‌شوند."))
        self.show_report()

    def show_report(self) -> None:
        try:
            start = parse_jalali(self.start_edit.text())
            end = parse_jalali(self.end_edit.text())
            summaries = self._service.summary(start, end)
        except (ValidationError, sqlite3.Error) as exc:
            show_error(self, str(exc))
            return

        self.table.setRowCount(0)
        for s in summaries + [None]:
            row = self.table.rowCount()
            self.table.insertRow(row)
            if s is None:
                totals = add_invoice_totals(x.totals for x in summaries)
                count = sum(x.count for x in summaries)
                label = "جمع کل"
            else:
                totals = s.totals
                count = s.count
                label = KIND_LABELS[s.kind]
            values = [
                label, str(count), format_amount(totals.subtotal), format_amount(totals.discount),
                format_amount(totals.taxable), format_amount(totals.vat), format_amount(totals.total),
            ]
            for col, text in enumerate(values):
                self.table.setItem(row, col, QTableWidgetItem(text))


class SettingsTab(QWidget):
    FIELDS = [
        ("company_name", "نام شرکت / فروشنده"),
        ("company_national_id", "شناسه ملی"),
        ("company_economic_code", "کد اقتصادی"),
        ("company_phone", "تلفن"),
        ("company_address", "نشانی"),
    ]

    def __init__(self, db: Database, parent=None):
        super().__init__(parent)
        self._db = db
        form = QFormLayout(self)
        info = db.get_company_info()
        self._inputs: dict[str, QLineEdit] = {}
        for key, label in self.FIELDS:
            edit = QLineEdit(info.get(key, ""))
            self._inputs[key] = edit
            form.addRow(label, edit)
        save = QPushButton("ذخیره تنظیمات")
        save.clicked.connect(self._save)
        form.addRow(save)

    def _save(self) -> None:
        try:
            with self._db.transaction():
                self._db.save_company_info({k: e.text() for k, e in self._inputs.items()})
        except sqlite3.Error as exc:
            show_error(self, str(exc))
            return
        show_info(self, "تنظیمات ذخیره شد.")


class MainWindow(QTabWidget):
    def __init__(self, db: Database, service: InvoiceService):
        super().__init__()
        self.setWindowTitle(APP_TITLE)
        self.resize(1200, 720)
        self.addTab(InvoicesTab(db, service), "فاکتورها")
        self.addTab(CustomersTab(db), "مشتریان")
        self.addTab(ProductsTab(db), "کالا و خدمات")
        self.addTab(ReportTab(service), "گزارش فروش")
        self.addTab(SettingsTab(db), "تنظیمات شرکت")
