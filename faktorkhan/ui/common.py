"""کمک‌های مشترک رابط کاربری."""

from __future__ import annotations

from PySide6.QtWidgets import QInputDialog, QMessageBox, QWidget

APP_TITLE = "فاکتورخان"


def show_error(parent: QWidget | None, message: str) -> None:
    QMessageBox.warning(parent, APP_TITLE, message)


def show_info(parent: QWidget | None, message: str) -> None:
    QMessageBox.information(parent, APP_TITLE, message)


def confirm(parent: QWidget | None, message: str) -> bool:
    answer = QMessageBox.question(
        parent,
        APP_TITLE,
        message,
        QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
        QMessageBox.StandardButton.No,
    )
    return answer == QMessageBox.StandardButton.Yes


def ask_text(parent: QWidget | None, title: str, label: str, default: str = "") -> str | None:
    """None برمی‌گرداند اگر کاربر انصراف دهد."""
    text, ok = QInputDialog.getText(parent, title, label, text=default)
    return text if ok else None
