"""نقطه‌ی ورود برنامه."""

from __future__ import annotations

import os
import sys
from pathlib import Path

from PySide6.QtCore import Qt
from PySide6.QtWidgets import QApplication

from .db import Database
from .service import InvoiceService
from .ui.common import APP_TITLE
from .ui.main_window import MainWindow


def default_db_path() -> Path:
    """داده‌ها در پوشه‌ی کاربر ذخیره می‌شوند (در ویندوز: %APPDATA%\\faktorkhan)."""
    base = os.environ.get("APPDATA") or str(Path.home())
    folder = Path(base) / "faktorkhan"
    folder.mkdir(parents=True, exist_ok=True)
    return folder / "faktorkhan.db"


def main(argv: list[str] | None = None) -> int:
    app = QApplication.instance() or QApplication(argv if argv is not None else sys.argv)
    app.setApplicationName(APP_TITLE)
    app.setLayoutDirection(Qt.LayoutDirection.RightToLeft)

    db = Database(os.environ.get("FAKTORKHAN_DB") or default_db_path())
    service = InvoiceService(db)
    window = MainWindow(db, service)
    window.show()
    try:
        return app.exec()
    finally:
        db.close()
