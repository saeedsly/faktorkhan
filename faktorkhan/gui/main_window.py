"""پنجره اصلی برنامه فاکتورخوان."""

from __future__ import annotations

import sqlite3
from pathlib import Path

from PyQt6.QtCore import QSize, Qt, QThread, pyqtSignal
from PyQt6.QtGui import QPixmap
from PyQt6.QtWidgets import (
    QComboBox,
    QApplication,
    QDialog,
    QFileDialog,
    QFrame,
    QGridLayout,
    QHBoxLayout,
    QHeaderView,
    QLabel,
    QListWidget,
    QListWidgetItem,
    QMainWindow,
    QMessageBox,
    QProgressBar,
    QPushButton,
    QScrollArea,
    QStackedWidget,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from faktorkhan.config import APP_NAME, APP_VERSION, EXPORT_DIR
from faktorkhan.database import InvoiceRepository
from faktorkhan.export.excel import ExcelExporter
from faktorkhan.gui.license_dialog import LicenseDialog
from faktorkhan.gui.widgets import DropZone, FieldCard, ItemTable
from faktorkhan.license.core import LicenseManager
from faktorkhan.ocr.engine import OCREngine
from faktorkhan.ocr.models import Invoice, InvoiceItem
from faktorkhan.ocr.parser import InvoiceParser


class ScanWorker(QThread):
    """پرج OCR در رشته پس‌زمینه تا رابط مسدود نشود."""

    finished = pyqtSignal(object)
    error = pyqtSignal(str)

    def __init__(
        self, engine: OCREngine, parser: InvoiceParser, image_path: str
    ) -> None:
        super().__init__()
        self.engine = engine
        self.parser = parser
        self.image_path = image_path

    def run(self) -> None:  # noqa: D401
        try:
            result = self.engine.run(self.image_path)
            invoice = self.parser.parse(result.text, result.confidence)
            invoice.source_image = self.image_path
            self.finished.emit(invoice)
        except Exception as exc:  # noqa: BLE001
            self.error.emit(str(exc))


class MainWindow(QMainWindow):
    def __init__(self, license_manager: LicenseManager) -> None:
        super().__init__()
        self.license_manager = license_manager
        self.repository = InvoiceRepository()
        self.exporter = ExcelExporter()
        self.engine = OCREngine()
        self.parser = InvoiceParser()
        self.current_invoice: Invoice | None = None
        self._worker: ScanWorker | None = None

        self.setWindowTitle(f"{APP_NAME} — نسخه {APP_VERSION}")
        self.resize(1300, 850)
        self._build_ui()
        self._apply_stylesheet()
        self._refresh_license_label()

    # ------------------------------------------------------------------ #
    # ساخت رابط
    # ------------------------------------------------------------------ #
    def _build_ui(self) -> None:
        central = QWidget()
        self.setCentralWidget(central)
        root = QHBoxLayout(central)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(0)

        # سایدبار
        self.sidebar = QListWidget()
        self.sidebar.setFixedWidth(210)
        for title in [
            "داشبورد",
            "اسکن فاکتور",
            "تاریخچه فاکتور",
            "خروجی اکسل",
            "لایسنس و اشتراک",
            "تنظیمات",
            "درباره ما",
        ]:
            item = QListWidgetItem(title)
            item.setSizeHint(QSize(200, 44))
            self.sidebar.addItem(item)
        self.sidebar.setCurrentRow(0)
        self.sidebar.currentRowChanged.connect(self._switch_page)
        root.addWidget(self.sidebar)

        self.stack = QStackedWidget()
        root.addWidget(self.stack)

        self.stack.addWidget(self._page_dashboard())
        self.stack.addWidget(self._page_scan())
        self.stack.addWidget(self._page_history())
        self.stack.addWidget(self._page_export())
        self.stack.addWidget(self._page_license())
        self.stack.addWidget(self._page_settings())
        self.stack.addWidget(self._page_about())

    def _page_dashboard(self) -> QWidget:
        page = QWidget()
        layout = QVBoxLayout(page)
        title = QLabel("داشبورد فاکتورخوان")
        title.setObjectName("brand")
        layout.addWidget(title)

        self.lbl_license = QLabel("وضعیت لایسنس: در حال بررسی...")
        layout.addWidget(self.lbl_license)

        stats = QGridLayout()
        self.lbl_total = QLabel("۰")
        self.lbl_total.setStyleSheet("font-size: 32px; font-weight: bold; color: #38bdf8;")
        self.lbl_total.setAlignment(Qt.AlignmentFlag.AlignCenter)
        card = QFrame()
        card.setObjectName("card")
        card_layout = QVBoxLayout(card)
        card_layout.addWidget(QLabel("تعداد فاکتورهای ذخیره شده"))
        card_layout.addWidget(self.lbl_total)
        stats.addWidget(card, 0, 0)

        self.lbl_ocr = QLabel("۰")
        self.lbl_ocr.setStyleSheet("font-size: 32px; font-weight: bold; color: #22c55e;")
        self.lbl_ocr.setAlignment(Qt.AlignmentFlag.AlignCenter)
        card2 = QFrame()
        card2.setObjectName("card")
        card2_layout = QVBoxLayout(card2)
        card2_layout.addWidget(QLabel("فاکتورهای پردازش‌شده با OCR"))
        card2_layout.addWidget(self.lbl_ocr)
        stats.addWidget(card2, 0, 1)

        layout.addLayout(stats)
        layout.addStretch()
        return page

    def _page_scan(self) -> QWidget:
        page = QWidget()
        layout = QHBoxLayout(page)

        left = QVBoxLayout()
        self.drop_zone = DropZone()
        self.drop_zone.filesDropped.connect(self._on_files_dropped)
        left.addWidget(self.drop_zone)

        btn_select = QPushButton("انتخاب تصویر فاکتور")
        btn_select.clicked.connect(self._select_image)
        left.addWidget(btn_select)

        self.btn_ocr = QPushButton("اجرا OCR و استخراج فاکتور")
        self.btn_ocr.clicked.connect(self._run_ocr)
        self.btn_ocr.setEnabled(False)
        left.addWidget(self.btn_ocr)

        self.progress = QProgressBar()
        self.progress.setRange(0, 0)
        self.progress.hide()
        left.addWidget(self.progress)

        self.lbl_preview = QLabel("پیش نمایش تصویر")
        self.lbl_preview.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.lbl_preview.setMinimumHeight(220)
        self.lbl_preview.setStyleSheet(
            "QLabel { background-color: #111827; border: 1px dashed #334155; border-radius: 6px; color: #64748b; }"
        )
        left.addWidget(self.lbl_preview)
        left.addStretch()

        right = QVBoxLayout()
        fields = QGridLayout()
        self.field_invoice_no = FieldCard("شماره فاکتور")
        self.field_date = FieldCard("تاریخ")
        self.field_vendor = FieldCard("فروشنده")
        self.field_customer = FieldCard("خریدار")
        self.field_total = FieldCard("مبلغ کل")
        self.field_tax = FieldCard("مالیات")
        fields.addWidget(self.field_invoice_no, 0, 0)
        fields.addWidget(self.field_date, 0, 1)
        fields.addWidget(self.field_vendor, 1, 0)
        fields.addWidget(self.field_customer, 1, 1)
        fields.addWidget(self.field_total, 2, 0)
        fields.addWidget(self.field_tax, 2, 1)
        right.addLayout(fields)

        right.addWidget(QLabel("اقلام فاکتور (قابل ویرایش)"))
        self.item_table = ItemTable()
        right.addWidget(self.item_table, stretch=1)

        btns = QHBoxLayout()
        self.btn_save = QPushButton("ذخیره در تاریخچه")
        self.btn_save.clicked.connect(self._save_invoice)
        self.btn_export = QPushButton("خروجی اکسل این فاکتور")
        self.btn_export.clicked.connect(self._export_current)
        self.btn_export.setEnabled(False)
        btns.addWidget(self.btn_save)
        btns.addWidget(self.btn_export)
        right.addLayout(btns)

        self.lbl_scan_msg = QLabel("")
        self.lbl_scan_msg.setStyleSheet("color: #94a3b8;")
        right.addWidget(self.lbl_scan_msg)

        layout.addLayout(left, stretch=0)
        layout.addLayout(right, stretch=1)
        return page

    def _page_history(self) -> QWidget:
        page = QWidget()
        layout = QVBoxLayout(page)
        layout.addWidget(QLabel("تاریخچه فاکتورهای پردازش‌شده"))
        self.table_history = QTableWidget(0, 8)
        self.table_history.setHorizontalHeaderLabels(
            ["شناسه", "شماره فاکتور", "تاریخ", "فروشنده", "مجموع", "ارز", "اطمینان OCR", "تصویر مبدا"]
        )
        self.table_history.horizontalHeader().setSectionResizeMode(QHeaderView.ResizeMode.Stretch)
        self.table_history.setSelectionBehavior(QTableWidget.SelectionBehavior.SelectRows)
        self.table_history.itemDoubleClicked.connect(self._load_history_row)
        layout.addWidget(self.table_history)
        btns = QHBoxLayout()
        btn_refresh = QPushButton("بازخوانی لیست")
        btn_refresh.clicked.connect(self._load_history)
        btn_delete = QPushButton("حذف انتخاب‌شده")
        btn_delete.setObjectName("danger")
        btn_delete.clicked.connect(self._delete_history_row)
        btns.addWidget(btn_refresh)
        btns.addWidget(btn_delete)
        btns.addStretch()
        layout.addLayout(btns)
        self._load_history()
        return page

    def _page_export(self) -> QWidget:
        page = QWidget()
        layout = QVBoxLayout(page)
        layout.addWidget(QLabel("خروجی کل تاریخچه به اکسل"))
        self.btn_export_all = QPushButton("استخراج اکسل همه فاکتورهای ذخیره شده")
        self.btn_export_all.clicked.connect(self._export_all)
        layout.addWidget(self.btn_export_all)
        self.lbl_export_msg = QLabel("")
        self.lbl_export_msg.setStyleSheet("color: #94a3b8;")
        layout.addWidget(self.lbl_export_msg)
        layout.addStretch()
        return page

    def _page_license(self) -> QWidget:
        page = QWidget()
        layout = QVBoxLayout(page)
        layout.addWidget(QLabel("مدیریت لایسنس و اشتراک"))
        self.lbl_lic_info = QLabel("")
        layout.addWidget(self.lbl_lic_info)
        btn_check = QPushButton("بررسی وضعیت لایسنس")
        btn_check.clicked.connect(self._refresh_license_label)
        layout.addWidget(btn_check)
        btn_activate = QPushButton("فعال‌سازی لایسنس جدید")
        btn_activate.clicked.connect(self._open_license_dialog)
        layout.addWidget(btn_activate)
        layout.addStretch()
        return page

    def _page_settings(self) -> QWidget:
        page = QWidget()
        layout = QVBoxLayout(page)
        layout.addWidget(QLabel("تنظیمات برنامه"))
        layout.addWidget(QLabel("پیش‌فرض ارز:"))
        self.cmb_currency = QComboBox()
        self.cmb_currency.addItems(["تومان", "ریال", "USD", "EUR"])
        layout.addWidget(self.cmb_currency)
        layout.addStretch()
        return page

    def _page_about(self) -> QWidget:
        page = QWidget()
        layout = QVBoxLayout(page)
        layout.addWidget(QLabel(f"{APP_NAME} نسخه {APP_VERSION}"))
        layout.addWidget(QLabel("نرم‌افزار حرفه‌ای 디지털 کردن فاکتور دستی و حرارتی با خروجی اکسل"))
        layout.addWidget(QLabel("توسعه‌یافته توسط تیم فاکتورخوان"))
        layout.addStretch()
        return page

    def _switch_page(self, index: int) -> None:
        self.stack.setCurrentIndex(index)
        if index == 2:
            self._load_history()

    # ------------------------------------------------------------------ #
    # اسکن و OCR
    # ------------------------------------------------------------------ #
    def _apply_stylesheet(self) -> None:
        qss_path = Path(__file__).with_name("styles.qss")
        if qss_path.exists():
            self.setStyleSheet(qss_path.read_text(encoding="utf-8"))

    def _select_image(self) -> None:
        path, _ = QFileDialog.getOpenFileName(
            self, "انتخاب تصویر فاکتور", str(Path.home()), "تصاویر (*.png *.jpg *.jpeg *.tif *.tiff *.bmp *.webp)"
        )
        if path:
            self._on_files_dropped([path])

    def _on_files_dropped(self, paths: list[str]) -> None:
        path = paths[0]
        pixmap = QPixmap(path)
        if not pixmap.isNull():
            self.lbl_preview.setPixmap(
                pixmap.scaled(340, 240, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation)
            )
        self.lbl_preview.setToolTip(path)
        self.btn_ocr.setEnabled(True)
        self.lbl_scan_msg.setText(f"فایل بارگذاری شد: {Path(path).name}")
        self._current_image_path = path

    def _run_ocr(self) -> None:
        if self._worker and self._worker.isRunning():
            return
        path = getattr(self, "_current_image_path", None)
        if not path:
            return
        self.progress.show()
        self.btn_ocr.setEnabled(False)
        self.lbl_scan_msg.setText("در حال پردازش تصویر...")
        self._worker = ScanWorker(self.engine, self.parser, path)
        self._worker.finished.connect(self._on_ocr_finished)
        self._worker.error.connect(self._on_ocr_error)
        self._worker.start()

    def _on_ocr_finished(self, invoice: Invoice) -> None:
        self.progress.hide()
        self.btn_ocr.setEnabled(True)
        self.current_invoice = invoice
        self.field_invoice_no.set_value(invoice.invoice_no)
        self.field_date.set_value(invoice.invoice_date)
        self.field_vendor.set_value(invoice.vendor)
        self.field_customer.set_value(invoice.customer)
        self.field_total.set_value(str(invoice.total) if invoice.total is not None else "")
        self.field_tax.set_value(str(invoice.tax) if invoice.tax is not None else "")
        self.item_table.load_items([it.to_dict() for it in invoice.items])
        self.btn_export.setEnabled(True)
        self.lbl_scan_msg.setText(
            f"OCR با بک‌اند {invoice.backend} انجام شد — اطمینان: {invoice.confidence:.1f}٪ — {len(invoice.items)} ردیف استخراج شد."
        )

    def _on_ocr_error(self, message: str) -> None:
        self.progress.hide()
        self.btn_ocr.setEnabled(True)
        self.lbl_scan_msg.setText(f"خطا: {message}")
        QMessageBox.warning(self, "خطای OCR", message)

    # ------------------------------------------------------------------ #
    # ذخیره / خروجی
    # ------------------------------------------------------------------ #
    def _save_invoice(self) -> None:
        if self.current_invoice is None:
            QMessageBox.information(self, "هشدار", "ابتدا یک فاکتور اسکن کنید.")
            return
        inv = self.current_invoice
        inv.invoice_no = self.field_invoice_no.value() or inv.invoice_no
        inv.invoice_date = self.field_date.value() or inv.invoice_date
        inv.vendor = self.field_vendor.value() or inv.vendor
        inv.customer = self.field_customer.value() or inv.customer
        try:
            inv.total = float(self.field_total.value().replace(",", "")) if self.field_total.value() else None
        except ValueError:
            inv.total = None
        items = []
        for it in self.item_table.items():
            items.append(
                {
                    "row_no": it["row_no"],
                    "description": it["description"],
                    "quantity": float(it["quantity"]) if it["quantity"] else None,
                    "unit_price": float(it["unit_price"]) if it["unit_price"] else None,
                    "total_price": float(it["total_price"]) if it["total_price"] else None,
                }
            )
        from faktorkhan.ocr.models import InvoiceItem

        inv.items = [
            InvoiceItem(
                row_no=it["row_no"],
                description=it["description"],
                quantity=it["quantity"],
                unit_price=it["unit_price"],
                total_price=it["total_price"],
            )
            for it in items
        ]
        inv_id = self.repository.save_invoice(inv, inv.source_image)
        QMessageBox.information(self, "ذخیره شد", f"فاکتور با شناسه {inv_id} ذخیره شد.")
        self.btn_save.setEnabled(False)

    def _export_current(self) -> None:
        if self.current_invoice is None:
            return
        path, _ = QFileDialog.getSaveFileName(
            self, "ذخیره اکسل", str(EXPORT_DIR / f"invoice_{self.current_invoice.invoice_no or 'x'}.xlsx"),
            "Excel (*.xlsx)",
        )
        if path:
            self.exporter.export([self.current_invoice], path)
            QMessageBox.information(self, "خروجی انجام شد", f"فایل اکسل در {path} ذخیره شد.")

    def _export_all(self) -> None:
        invoices = self.repository.list_invoices()
        if not invoices:
            QMessageBox.information(self, "هشدار", "فاکتوری برای خروجی وجود ندارد.")
            return
        path, _ = QFileDialog.getSaveFileName(
            self, "ذخیره اکسل", str(EXPORT_DIR / "all_invoices.xlsx"), "Excel (*.xlsx)"
        )
        if path:
            # convert stored rows back to Invoice objects (simplified)
            from faktorkhan.ocr.models import Invoice, InvoiceItem

            inv_objs = []
            for row in invoices:
                items = self.repository.get_invoice_with_items(row["id"]).get("items", [])
                inv_objs.append(
                    Invoice(
                        invoice_no=row["invoice_no"],
                        invoice_date=row["invoice_date"],
                        vendor=row["vendor"],
                        customer=row["customer"],
                        total=row["total"],
                        tax=row["tax"],
                        currency=row["currency"],
                        confidence=row["ocr_confidence"] or 0.0,
                        items=[
                            InvoiceItem(
                                row_no=it["row_no"],
                                description=it["description"],
                                quantity=it["quantity"],
                                unit_price=it["unit_price"],
                                total_price=it["total_price"],
                            )
                            for it in items
                        ],
                    )
                )
            self.exporter.export(inv_objs, path)
            self.lbl_export_msg.setText(f"خروجی در {path} ذخیره شد.")
            QMessageBox.information(self, "خروجی انجام شد", f"فایل اکسل در {path} ذخیره شد.")

    # ------------------------------------------------------------------ #
    # تاریخچه
    # ------------------------------------------------------------------ #
    def _load_history(self) -> None:
        rows = self.repository.list_invoices()
        self.table_history.setRowCount(0)
        for row in rows:
            r = self.table_history.rowCount()
            self.table_history.insertRow(r)
            for col, key in enumerate(
                ["id", "invoice_no", "invoice_date", "vendor", "total", "currency", "ocr_confidence", "source_image"]
            ):
                val = row[key]
                if key == "ocr_confidence" and val is not None:
                    val = f"{val:.1f}٪"
                self.table_history.setItem(r, col, QTableWidgetItem(str(val)))

    def _load_history_row(self, item: QTableWidgetItem) -> None:
        row = item.row()
        inv_id = int(self.table_history.item(row, 0).text())
        data = self.repository.get_invoice_with_items(inv_id)
        if not data:
            return
        self.current_invoice = Invoice(
            invoice_no=data["invoice_no"],
            invoice_date=data["invoice_date"],
            vendor=data["vendor"],
            customer=data["customer"],
            total=data["total"],
            tax=data["tax"],
            currency=data["currency"],
            confidence=data["ocr_confidence"] or 0.0,
            source_image=data["source_image"],
            items=[
                InvoiceItem(
                    row_no=it["row_no"],
                    description=it["description"],
                    quantity=it["quantity"],
                    unit_price=it["unit_price"],
                    total_price=it["total_price"],
                )
                for it in data.get("items", [])
            ],
        )
        self.field_invoice_no.set_value(data["invoice_no"])
        self.field_date.set_value(data["invoice_date"])
        self.field_vendor.set_value(data["vendor"])
        self.field_customer.set_value(data["customer"])
        self.field_total.set_value(str(data["total"]) if data["total"] is not None else "")
        self.field_tax.set_value(str(data["tax"]) if data["tax"] is not None else "")
        self.item_table.load_items(
            [
                {
                    "row_no": it["row_no"],
                    "description": it["description"],
                    "quantity": it["quantity"] or "",
                    "unit_price": it["unit_price"] or "",
                    "total_price": it["total_price"] or "",
                }
                for it in data.get("items", [])
            ]
        )
        self.btn_export.setEnabled(True)
        self.lbl_scan_msg.setText(f"فاکتور شناسه {inv_id} بارگذاری شد.")
        self.sidebar.setCurrentRow(1)
        self.stack.setCurrentIndex(1)

    def _delete_history_row(self) -> None:
        row = self.table_history.currentRow()
        if row < 0:
            return
        inv_id = int(self.table_history.item(row, 0).text())
        import sqlite3

        conn = sqlite3.connect(self.repository.db_path)
        conn.execute("DELETE FROM invoices WHERE id = ?", (inv_id,))
        conn.commit()
        conn.close()
        self._load_history()

    # ------------------------------------------------------------------ #
    # لایسنس
    # ------------------------------------------------------------------ #
    def _refresh_license_label(self) -> None:
        status = self.license_manager.validate()
        if status.valid:
            self.lbl_license.setText(
                f"لایسنس فعال: {status.plan} — مابقی {status.days_remaining} روز — {status.customer}"
            )
            self.lbl_license.setObjectName("statusOk")
        elif status.grace:
            self.lbl_license.setText(f"مهلت أنقضا فعال است ({status.days_remaining} روز)")
            self.lbl_license.setObjectName("statusWarn")
        else:
            self.lbl_license.setText("لایسنس فعال نیست — برنامه قفل شده است")
            self.lbl_license.setObjectName("statusBad")
        self.style().unpolish(self.lbl_license)
        self.style().polish(self.lbl_license)
        self.lbl_lic_info.setText(
            f"وضعیت: {status.message}\nبرنامه: {status.plan} | مشتری: {status.customer}"
        )

    def _open_license_dialog(self) -> None:
        dlg = LicenseDialog(self.license_manager, self)
        if dlg.exec():
            self._refresh_license_label()

    def check_license_before_start(self) -> bool:
        """اعتبار سنجی لایسنس قبل از نمایش پنجره اصلی."""
        status = self.license_manager.validate()
        if not status.valid and not status.grace:
            QMessageBox.critical(
                self,
                "اشتراک منقضی شده",
                f"لایسنس معتبر نیست: {status.message}\nبرنامه اجرا نمی‌شود.",
            )
            return False
        return True


def run_app() -> int:
    app = QApplication.instance() or QApplication([])
    app.setStyle("Fusion")

    from faktorkhan.utils.logging import setup_logging

    setup_logging("faktorkhan")

    manager = LicenseManager()
    status = manager.validate()
    if not status.valid and not status.grace:
        dlg = LicenseDialog(manager)
        if dlg.exec() != QDialog.DialogCode.Accepted:
            return 0
        status = manager.validate()
        if not status.valid and not status.grace:
            QMessageBox.critical(None, "اشتراک منقضی شده", status.message)
            return 0

    window = MainWindow(manager)
    if not window.check_license_before_start():
        return 0
    window.show()
    return app.exec()
