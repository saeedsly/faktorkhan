"""نقطه ورودی برنامه فاکتورخوان."""

from __future__ import annotations

import sys

from faktorkhan.utils.logging import setup_logging
from faktorkhan.gui.main_window import run_app

logger = setup_logging("faktorkhan")


def main() -> int:
    logger.info("شروع برنامه فاکتورخوان نسخه %s", "1.0.0")
    try:
        return run_app()
    except Exception as exc:  # noqa: BLE001 - سطح بالای برنامه
        logger.exception("خطای فاضح در اجرای برنامه: %s", exc)
        return 1


if __name__ == "__main__":
    sys.exit(main())
