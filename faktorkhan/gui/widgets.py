"""جتاپیک‌های قابل استفاده دوباره برای رابط فاکتورخوان."""

from __future__ import annotations

from PyQt6.QtCore import Qt, pyqtSignal, QMimeData
from PyQt6.QtGui import QDragEnterEvent, QDropEvent
from pathlib import Path

from PyQt6.QtWidgets import (
    QFrame,
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from faktorkhan.config import SUPPORTED_IMAGE_EXTENSIONS


class DropZone(QFrame):
    """ناحیه kéo و رها کردن تصویر فاکتور."""

    filesDropped = pyqtSignal(list)

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setAcceptDrops(True)
        self.setFrameStyle(QFrame.Shape.StyledPanel | QFrame.Shadow.Raised)
        self.setMinimumHeight(260)
        layout = QVBoxLayout(self)
        self.label = QLabel("تصویر فاکتور را اینجا بکشید و رها کنید\nیا از دکمه انتخاب فایل استفاده کنید")
        self.label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.label.setStyleSheet("color: #64748b; font-size: 14px;")
        layout.addWidget(self.label)
        self.setStyleSheet(
            "QFrame { background-color: #111827; border: 2px dashed #334155; border-radius: 10px; }"
            "QFrame:hover { border-color: #2563eb; }"
        )

    def dragEnterEvent(self, event: QDragEnterEvent) -> None:  # noqa: N802
        if event.mimeData().hasUrls():
            event.acceptProposedAction()

    def dropEvent(self, event: QDropEvent) -> None:  # noqa: N802
        paths: list[str] = []
        for url in event.mimeData().urls():
            path = url.toLocalFile()
            if path and Path(path).suffix.lower() in SUPPORTED_IMAGE_EXTENSIONS:
                paths.append(path)
        if paths:
            self.filesDropped.emit(paths)
            event.acceptProposedAction()


class FieldCard(QGroupBox):
    """کارت ورودی یک فیلد فاکتور (قابل ویرایش توسط کاربر)."""

    def __init__(self, title: str, parent: QWidget | None = None) -> None:
        super().__init__(title, parent)
        self.edit = QLineEdit()
        self.edit.setPlaceholderText("...")
        layout = QVBoxLayout(self)
        layout.addWidget(self.edit)

    def value(self) -> str:
        return self.edit.text().strip()

    def set_value(self, text: str | None) -> None:
        self.edit.setText(text or "")


class ItemTable(QTableWidget):
    """جدول اقلام فاکتور (تمام سلول‌ها قابل ویرایش)."""

    COLUMNS = ["ردیف", "شرح کالا / خدمت", "تعداد", "قیمت واحد", "مبلغ ردیف"]

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(0, len(self.COLUMNS), parent)
        self.setHorizontalHeaderLabels(self.COLUMNS)
        self.horizontalHeader().setStretchLastSection(True)
        from PyQt6.QtWidgets import QHeaderView

        self.horizontalHeader().setSectionResizeMode(QHeaderView.ResizeMode.Stretch)

    def load_items(self, items: list[dict]) -> None:
        self.setRowCount(0)
        for item in items:
            row = self.rowCount()
            self.insertRow(row)
            values = [
                str(item.get("row_no", row + 1)),
                str(item.get("description", "")),
                str(item.get("quantity") or ""),
                str(item.get("unit_price") or ""),
                str(item.get("total_price") or ""),
            ]
            for col, val in enumerate(values):
                self.setItem(row, col, QTableWidgetItem(val))

    def items(self) -> list[dict]:
        result: list[dict] = []
        for row in range(self.rowCount()):
            result.append(
                {
                    "row_no": row + 1,
                    "description": self.item(row, 1).text() if self.item(row, 1) else "",
                    "quantity": self.item(row, 2).text() if self.item(row, 2) else "",
                    "unit_price": self.item(row, 3).text() if self.item(row, 3) else "",
                    "total_price": self.item(row, 4).text() if self.item(row, 4) else "",
                }
            )
        return result
