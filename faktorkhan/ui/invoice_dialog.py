"""پنجره‌ی ایجاد/ویرایش/مشاهده‌ی فاکتور (دستی و سیستمی)."""

from __future__ import annotations

import sqlite3

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QAbstractItemView,
    QComboBox,
    QDialog,
    QGridLayout,
    QHBoxLayout,
    QHeaderView,
    QLabel,
    QLineEdit,
    QPushButton,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
)

from ..clock import today
from ..db import Database
from ..errors import ValidationError
from ..jalali import format_jalali, parse_jalali
from ..models import DRAFT, KIND_LABELS, MANUAL, SYSTEM, Invoice, LineItem, Product
from ..money import amount_in_words, calc_line, format_amount, parse_decimal, sum_totals
from ..service import InvoiceService
from .common import confirm, show_error, show_info

COL_DESC, COL_UNIT, COL_QTY, COL_PRICE, COL_DISC, COL_VAT, COL_TOTAL = range(7)
HEADERS = [
    "شرح کالا/خدمت", "واحد", "تعداد", "قیمت واحد (ریال)",
    "تخفیف (ریال)", "مالیات %", "جمع ردیف (ریال)",
]
DEFAULT_VAT = "9"


class InvoiceDialog(QDialog):
    def __init__(
        self,
        db: Database,
        service: InvoiceService,
        kind: str,
        invoice: Invoice | None = None,
        parent=None,
    ):
        super().__init__(parent)
        self._db = db
        self._service = service
        self._kind = kind
        self._invoice = invoice
        self.read_only = invoice is not None and invoice.status != DRAFT
        self.saved_invoice: Invoice | None = None
        self._customers = db.list_customers()
        self._products: dict[int, Product] = {p.id: p for p in db.list_products() if p.id is not None}

        if invoice is not None and invoice.number:
            title = f"فاکتور {KIND_LABELS[kind]} — {invoice.number}"
        else:
            title = f"فاکتور {KIND_LABELS[kind]} ({'پیش‌نویس' if kind == MANUAL else 'صدور فوری'})"
        self.setWindowTitle(title)
        self.setMinimumSize(1000, 620)
        self._build()
        self._populate()
        self._update_read_only()
        self._recalc()

    # ----- ساخت رابط -----
    def _build(self) -> None:
        root = QVBoxLayout(self)

        grid = QGridLayout()
        self.customer_combo = QComboBox()
        self.customer_combo.addItem("— انتخاب از مشتریان —", None)
        for c in self._customers:
            self.customer_combo.addItem(c.name, c.id)
        self.customer_name = QLineEdit()
        self.national_id = QLineEdit()
        self.date_edit = QLineEdit()
        self.date_edit.setPlaceholderText("مثلاً ۱۴۰۵/۰۸/۱۶")
        self.date_label = QLabel()
        self.notes = QLineEdit()

        grid.addWidget(QLabel("مشتری ثبت‌شده:"), 0, 0)
        grid.addWidget(self.customer_combo, 0, 1)
        grid.addWidget(QLabel("نام خریدار:"), 0, 2)
        grid.addWidget(self.customer_name, 0, 3)
        grid.addWidget(QLabel("شناسه ملی:"), 1, 0)
        grid.addWidget(self.national_id, 1, 1)
        if self._kind == MANUAL:
            grid.addWidget(QLabel("تاریخ صدور (شمسی):"), 1, 2)
            grid.addWidget(self.date_edit, 1, 3)
        else:
            grid.addWidget(QLabel("تاریخ صدور:"), 1, 2)
            grid.addWidget(self.date_label, 1, 3)
        grid.addWidget(QLabel("توضیحات:"), 2, 0)
        grid.addWidget(self.notes, 2, 1, 1, 3)
        root.addLayout(grid)

        bar = QHBoxLayout()
        self.product_combo = QComboBox()
        self.product_combo.addItem("— انتخاب کالا/خدمت —", None)
        for p in sorted(self._products.values(), key=lambda x: x.name):
            self.product_combo.addItem(f"{p.name} ({format_amount(p.unit_price)} ریال)", p.id)
        self.btn_add_product = QPushButton("افزودن از فهرست کالاها")
        self.btn_add_product.clicked.connect(self._add_from_product)
        self.btn_add_row = QPushButton("افزودن ردیف خالی")
        self.btn_add_row.clicked.connect(lambda: self._add_row())
        self.btn_remove_row = QPushButton("حذف ردیف انتخاب‌شده")
        self.btn_remove_row.clicked.connect(self._remove_selected_row)
        bar.addWidget(self.product_combo, 1)
        bar.addWidget(self.btn_add_product)
        bar.addWidget(self.btn_add_row)
        bar.addWidget(self.btn_remove_row)
        root.addLayout(bar)

        self.table = QTableWidget(0, len(HEADERS))
        self.table.setHorizontalHeaderLabels(HEADERS)
        self.table.verticalHeader().setVisible(False)
        self.table.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
        self.table.setSelectionMode(QAbstractItemView.SelectionMode.SingleSelection)
        header = self.table.horizontalHeader()
        header.setSectionResizeMode(COL_DESC, QHeaderView.ResizeMode.Stretch)
        self.table.itemChanged.connect(lambda _item: self._recalc())
        root.addWidget(self.table, 1)

        self.totals_label = QLabel()
        self.totals_label.setTextFormat(Qt.TextFormat.PlainText)
        self.words_label = QLabel()
        self.words_label.setWordWrap(True)
        root.addWidget(self.totals_label)
        root.addWidget(self.words_label)

        buttons = QHBoxLayout()
        buttons.addStretch(1)
        self.btn_save_draft = QPushButton("ذخیره پیش‌نویس")
        self.btn_issue = QPushButton(
            "صدور فاکتور" if self._kind == MANUAL else "صدور فوری فاکتور سیستمی"
        )
        self.btn_close = QPushButton("بستن")
        self.btn_save_draft.clicked.connect(self._on_save_draft)
        self.btn_issue.clicked.connect(self._on_issue)
        self.btn_close.clicked.connect(self.reject)
        buttons.addWidget(self.btn_save_draft)
        buttons.addWidget(self.btn_issue)
        buttons.addWidget(self.btn_close)
        root.addLayout(buttons)

        self.customer_combo.currentIndexChanged.connect(self._on_customer_selected)

    def _update_read_only(self) -> None:
        editable = not self.read_only
        for widget in (
            self.customer_combo, self.customer_name, self.national_id, self.date_edit,
            self.notes, self.product_combo, self.btn_add_product, self.btn_add_row,
            self.btn_remove_row, self.btn_save_draft, self.btn_issue,
        ):
            widget.setEnabled(editable)
        self.table.setEditTriggers(
            QAbstractItemView.EditTrigger.AllEditTriggers if editable
            else QAbstractItemView.EditTrigger.NoEditTriggers
        )
        if self.read_only:
            self.btn_close.setText("بستن")
        elif self._kind == SYSTEM:
            self.btn_save_draft.hide()

    def _populate(self) -> None:
        inv = self._invoice
        if self._kind == MANUAL:
            self.date_edit.setText(format_jalali(inv.issue_date) if inv and inv.issue_date else format_jalali(today()))
        else:
            issue = inv.issue_date if inv and inv.issue_date else today()
            self.date_label.setText(format_jalali(issue))

        if inv is None:
            self._add_row()
            return
        index = self.customer_combo.findData(inv.customer_id)
        self.customer_combo.blockSignals(True)
        self.customer_combo.setCurrentIndex(max(index, 0))
        self.customer_combo.blockSignals(False)
        self.customer_name.setText(inv.customer_name)
        self.national_id.setText(inv.customer_national_id)
        self.notes.setText(inv.notes)
        for item in inv.items:
            self._add_row(item)

    # ----- رفتار مشتری و کالا -----
    def _on_customer_selected(self, _index: int) -> None:
        customer_id = self.customer_combo.currentData()
        for c in self._customers:
            if c.id == customer_id:
                self.customer_name.setText(c.name)
                self.national_id.setText(c.national_id)
                return

    def _add_from_product(self) -> None:
        product_id = self.product_combo.currentData()
        if product_id is None:
            show_error(self, "ابتدا یک کالا/خدمت از فهرست انتخاب کنید.")
            return
        self._add_row(product=self._products[product_id])

    # ----- ردیف‌ها -----
    def _set_cell(self, row: int, col: int, text: str, editable: bool = True) -> None:
        cell = self.table.item(row, col)
        if cell is None:
            cell = QTableWidgetItem()
            self.table.setItem(row, col, cell)
        cell.setText(text)
        flags = Qt.ItemFlag.ItemIsEnabled | Qt.ItemFlag.ItemIsSelectable
        if editable:
            flags |= Qt.ItemFlag.ItemIsEditable
        cell.setFlags(flags)
        if col >= COL_QTY and col != COL_DESC:
            cell.setTextAlignment(Qt.AlignmentFlag.AlignCenter)

    def _add_row(self, item: LineItem | None = None, product: Product | None = None) -> None:
        self.table.blockSignals(True)
        try:
            row = self.table.rowCount()
            self.table.insertRow(row)
            if item is not None:
                description, unit = item.description, item.unit
                qty, price = str(item.quantity), str(item.unit_price)
                disc, vat = str(item.discount), str(item.vat_rate)
                product_id = item.product_id
            elif product is not None:
                description, unit = product.name, product.unit
                qty, price = "1", str(product.unit_price)
                disc, vat = "0", str(product.vat_rate)
                product_id = product.id
            else:
                description, unit = "", ""
                qty, price, disc, vat = "1", "0", "0", DEFAULT_VAT
                product_id = None
            self._set_cell(row, COL_DESC, description)
            self.table.item(row, COL_DESC).setData(Qt.ItemDataRole.UserRole, product_id)
            self._set_cell(row, COL_UNIT, unit)
            self._set_cell(row, COL_QTY, qty)
            self._set_cell(row, COL_PRICE, price)
            self._set_cell(row, COL_DISC, disc)
            self._set_cell(row, COL_VAT, vat)
            self._set_cell(row, COL_TOTAL, "", editable=False)
        finally:
            self.table.blockSignals(False)
        self._recalc()

    def _remove_selected_row(self) -> None:
        row = self.table.currentRow()
        if row >= 0:
            self.table.removeRow(row)
            self._recalc()

    def _cell_text(self, row: int, col: int) -> str:
        cell = self.table.item(row, col)
        return cell.text().strip() if cell is not None else ""

    def _read_row(self, row: int) -> LineItem:
        """خواندن و تبدیل یک ردیف جدول به LineItem (با خطای قابل فهم برای همان ردیف)."""
        label = f"ردیف {row + 1}"
        try:
            description = self._cell_text(row, COL_DESC)
            if not description:
                raise ValidationError("شرح کالا/خدمت خالی است.")
            disc_text = self._cell_text(row, COL_DISC) or "0"
            return LineItem(
                description=description,
                unit=self._cell_text(row, COL_UNIT),
                quantity=parse_decimal(self._cell_text(row, COL_QTY), "تعداد"),
                unit_price=parse_decimal(self._cell_text(row, COL_PRICE), "قیمت واحد"),
                discount=parse_decimal(disc_text, "تخفیف"),
                vat_rate=parse_decimal(self._cell_text(row, COL_VAT), "درصد مالیات"),
                product_id=self.table.item(row, COL_DESC).data(Qt.ItemDataRole.UserRole),
            )
        except ValidationError as exc:
            raise ValidationError(f"{label}: {exc}") from exc

    def _parse_rows(self) -> list[LineItem]:
        return [self._read_row(r) for r in range(self.table.rowCount())]

    def _recalc(self) -> None:
        """بازمحاسبه‌ی زنده‌ی ردیف‌ها و جمع کل؛ خطاها را همان‌جا نشان می‌دهد."""
        if not hasattr(self, "totals_label"):
            return
        line_totals = []
        errors: list[str] = []
        self.table.blockSignals(True)
        try:
            for row in range(self.table.rowCount()):
                try:
                    item = self._read_row(row)
                    lt = calc_line(item.quantity, item.unit_price, item.discount, item.vat_rate)
                    line_totals.append(lt)
                    self._set_cell(row, COL_TOTAL, format_amount(lt.total), editable=False)
                except ValidationError as exc:
                    errors.append(str(exc))
                    self._set_cell(row, COL_TOTAL, "—", editable=False)
        finally:
            self.table.blockSignals(False)

        if errors:
            self.totals_label.setText(f"⚠ {errors[0]}" + (f" (و {len(errors) - 1} خطای دیگر)" if len(errors) > 1 else ""))
            self.words_label.setText("")
            return
        if not line_totals:
            self.totals_label.setText("فاکتور هنوز ردیفی ندارد.")
            self.words_label.setText("")
            return
        t = sum_totals(line_totals)
        self.totals_label.setText(
            f"جمع اقلام: {format_amount(t.subtotal)} ریال    |    "
            f"جمع تخفیف: {format_amount(t.discount)} ریال    |    "
            f"جمع مشمول مالیات: {format_amount(t.taxable)} ریال    |    "
            f"جمع مالیات: {format_amount(t.vat)} ریال    |    "
            f"مبلغ قابل پرداخت: {format_amount(t.total)} ریال"
        )
        self.words_label.setText(amount_in_words(t.total))

    # ----- ذخیره و صدور -----
    def _collect(self) -> Invoice:
        items = self._parse_rows()
        issue_date = None
        if self._kind == MANUAL and self.date_edit.text().strip():
            issue_date = parse_jalali(self.date_edit.text())
        customer_id = self.customer_combo.currentData()
        return Invoice(
            id=self._invoice.id if self._invoice else None,
            kind=self._kind,
            customer_name=self.customer_name.text(),
            customer_id=customer_id,
            customer_national_id=self.national_id.text().strip(),
            notes=self.notes.text().strip(),
            items=items,
            issue_date=issue_date,
        )

    def _on_save_draft(self) -> None:
        try:
            inv = self._collect()
            self.saved_invoice = self._service.save_manual_draft(inv)
        except (ValidationError, sqlite3.Error) as exc:
            show_error(self, str(exc))
            return
        show_info(self, "پیش‌نویس فاکتور ذخیره شد. شماره فاکتور هنگام صدور داده می‌شود.")
        self.accept()

    def _on_issue(self) -> None:
        if not confirm(self, "پس از صدور، فاکتور قابل ویرایش نیست. ادامه می‌دهید؟"):
            return
        try:
            inv = self._collect()
            if self._kind == MANUAL:
                draft = self._service.save_manual_draft(inv)
                try:
                    issued = self._service.issue_manual(draft.id, inv.issue_date)
                except (ValidationError, sqlite3.Error) as exc:
                    show_error(self, f"پیش‌نویس ذخیره شد ولی صدور انجام نشد:\n{exc}")
                    self.saved_invoice = draft
                    self._invoice = draft
                    return
            else:
                issued = self._service.issue_system(
                    inv.customer_name,
                    inv.items,
                    customer_id=inv.customer_id,
                    customer_national_id=inv.customer_national_id,
                    notes=inv.notes,
                )
        except (ValidationError, sqlite3.Error) as exc:
            show_error(self, str(exc))
            return
        self.saved_invoice = issued
        show_info(self, f"فاکتور با شماره {issued.number} صادر شد.")
        self.accept()
