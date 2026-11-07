"""تب‌های مدیریت مشتریان و کالا/خدمات."""

from __future__ import annotations

import sqlite3
from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QAbstractItemView,
    QDialog,
    QDialogButtonBox,
    QFormLayout,
    QHBoxLayout,
    QHeaderView,
    QLineEdit,
    QPushButton,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from ..db import Database
from ..errors import ValidationError
from ..models import Customer, Product
from ..money import ZERO, format_amount, parse_decimal
from .common import confirm, show_error

FieldSpec = tuple[str, str, bool]  # (key, label, required)


class RecordDialog(QDialog):
    def __init__(self, title: str, fields: list[FieldSpec], values: dict[str, str], parent=None):
        super().__init__(parent)
        self.setWindowTitle(title)
        self.setMinimumWidth(420)
        self._fields = fields
        self._inputs: dict[str, QLineEdit] = {}
        form = QFormLayout(self)
        for key, label, required in fields:
            edit = QLineEdit(values.get(key, ""))
            label_text = f"{label} *" if required else label
            form.addRow(label_text, edit)
            self._inputs[key] = edit
        buttons = QDialogButtonBox(
            QDialogButtonBox.StandardButton.Save | QDialogButtonBox.StandardButton.Cancel
        )
        buttons.accepted.connect(self._on_accept)
        buttons.rejected.connect(self.reject)
        form.addRow(buttons)

    def _on_accept(self) -> None:
        for key, label, required in self._fields:
            if required and not self._inputs[key].text().strip():
                show_error(self, f"«{label}» الزامی است.")
                return
        self.accept()

    def values(self) -> dict[str, str]:
        return {key: edit.text().strip() for key, edit in self._inputs.items()}


class MasterTab(QWidget):
    """قالب مشترک برای فهرست‌های CRUD ساده."""

    headers: list[str] = []
    fields: list[FieldSpec] = []
    title: str = ""

    def __init__(self, db: Database, parent=None):
        super().__init__(parent)
        self._db = db
        root = QVBoxLayout(self)
        bar = QHBoxLayout()
        for label, handler in (
            ("افزودن", self._add),
            ("ویرایش", self._edit),
            ("حذف", self._delete),
        ):
            btn = QPushButton(label)
            btn.clicked.connect(handler)
            bar.addWidget(btn)
        bar.addStretch(1)
        root.addLayout(bar)

        self.table = QTableWidget(0, len(self.headers))
        self.table.setHorizontalHeaderLabels(self.headers)
        self.table.verticalHeader().setVisible(False)
        self.table.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)
        self.table.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
        self.table.setSelectionMode(QAbstractItemView.SelectionMode.SingleSelection)
        self.table.horizontalHeader().setSectionResizeMode(QHeaderView.ResizeMode.Stretch)
        self.table.doubleClicked.connect(lambda _i: self._edit())
        root.addWidget(self.table)
        self.refresh()

    # قرارداد زیرکلاس‌ها
    def _label(self, record) -> str: ...
    def _load_records(self) -> list: ...
    def _to_row(self, record) -> list[str]: ...
    def _to_values(self, record) -> dict[str, str]: ...
    def _from_values(self, values: dict[str, str], record_id: int | None): ...
    def _save(self, record) -> None: ...
    def _remove(self, record_id: int) -> None: ...

    def refresh(self) -> None:
        records = self._load_records()
        self.table.setRowCount(0)
        for record in records:
            row = self.table.rowCount()
            self.table.insertRow(row)
            for col, text in enumerate(self._to_row(record)):
                cell = QTableWidgetItem(text)
                if col == 0:
                    cell.setData(Qt.ItemDataRole.UserRole, record.id)
                self.table.setItem(row, col, cell)
        self._records = records

    def _selected_record(self):
        row = self.table.currentRow()
        if row < 0:
            show_error(self, "ابتدا یک مورد را انتخاب کنید.")
            return None
        record_id = self.table.item(row, 0).data(Qt.ItemDataRole.UserRole)
        return next((r for r in self._records if r.id == record_id), None)

    def _add(self) -> None:
        dlg = RecordDialog(f"افزودن {self.title}", self.fields, {}, self)
        if dlg.exec():
            self._commit(dlg.values(), None)

    def _edit(self) -> None:
        record = self._selected_record()
        if record is None:
            return
        dlg = RecordDialog(f"ویرایش {self.title}", self.fields, self._to_values(record), self)
        if dlg.exec():
            self._commit(dlg.values(), record.id)

    def _commit(self, values: dict[str, str], record_id: int | None) -> None:
        try:
            record = self._from_values(values, record_id)
            self._save(record)
        except (ValidationError, sqlite3.Error) as exc:
            show_error(self, str(exc))
            return
        self.refresh()

    def _delete(self) -> None:
        record = self._selected_record()
        if record is None:
            return
        if not confirm(self, f"«{self._label(record)}» حذف شود؟"):
            return
        self._remove(record.id)
        self.refresh()


class CustomersTab(MasterTab):
    title = "مشتری"
    headers = ["نام", "تلفن", "شناسه ملی", "کد اقتصادی", "نشانی"]
    fields = [
        ("name", "نام مشتری", True),
        ("phone", "تلفن", False),
        ("national_id", "شناسه ملی", False),
        ("economic_code", "کد اقتصادی", False),
        ("address", "نشانی", False),
    ]

    def _label(self, record: Customer) -> str:
        return record.name

    def _load_records(self) -> list[Customer]:
        return self._db.list_customers()

    def _to_row(self, c: Customer) -> list[str]:
        return [c.name, c.phone, c.national_id, c.economic_code, c.address]

    def _to_values(self, c: Customer) -> dict[str, str]:
        return {
            "name": c.name, "phone": c.phone, "national_id": c.national_id,
            "economic_code": c.economic_code, "address": c.address,
        }

    def _from_values(self, v: dict[str, str], record_id: int | None) -> Customer:
        return Customer(
            id=record_id, name=v["name"], phone=v["phone"], national_id=v["national_id"],
            economic_code=v["economic_code"], address=v["address"],
        )

    def _save(self, record: Customer) -> None:
        with self._db.transaction():
            self._db.save_customer(record)

    def _remove(self, record_id: int) -> None:
        with self._db.transaction():
            self._db.delete_customer(record_id)


class ProductsTab(MasterTab):
    title = "کالا/خدمت"
    headers = ["کد", "نام", "واحد", "قیمت واحد (ریال)", "مالیات %"]
    fields = [
        ("code", "کد", False),
        ("name", "نام کالا/خدمت", True),
        ("unit", "واحد", False),
        ("unit_price", "قیمت واحد (ریال)", True),
        ("vat_rate", "درصد مالیات", True),
    ]

    def _label(self, record: Product) -> str:
        return record.name

    def _load_records(self) -> list[Product]:
        return self._db.list_products()

    def _to_row(self, p: Product) -> list[str]:
        return [p.code, p.name, p.unit, format_amount(p.unit_price), format_amount(p.vat_rate)]

    def _to_values(self, p: Product) -> dict[str, str]:
        return {
            "code": p.code, "name": p.name, "unit": p.unit,
            "unit_price": str(p.unit_price), "vat_rate": str(p.vat_rate),
        }

    def _from_values(self, v: dict[str, str], record_id: int | None) -> Product:
        price = parse_decimal(v["unit_price"], "قیمت واحد")
        vat = parse_decimal(v["vat_rate"], "درصد مالیات")
        if price < ZERO:
            raise ValidationError("قیمت واحد نمی‌تواند منفی باشد.")
        if vat < ZERO or vat > 100:
            raise ValidationError("درصد مالیات باید بین ۰ و ۱۰۰ باشد.")
        return Product(
            id=record_id, code=v["code"], name=v["name"], unit=v["unit"],
            unit_price=price, vat_rate=vat,
        )

    def _save(self, record: Product) -> None:
        with self._db.transaction():
            self._db.save_product(record)

    def _remove(self, record_id: int) -> None:
        with self._db.transaction():
            self._db.delete_product(record_id)

