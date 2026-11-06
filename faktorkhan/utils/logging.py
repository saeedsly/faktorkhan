"""تنظیم لاگ‌گیری برنامه فاکتورخوان."""

from __future__ import annotations

import logging
from pathlib import Path

from faktorkhan.config import LOGS_DIR


def setup_logging(name: str = "faktorkhan", level: int = logging.INFO) -> logging.Logger:
    """یک لاگر با خروجی کنسول و فایل را configuring و برمی‌گرداند."""
    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    logger = logging.getLogger(name)
    if logger.handlers:
        return logger

    logger.setLevel(level)

    fmt = logging.Formatter(
        "%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    sh = logging.StreamHandler()
    sh.setFormatter(fmt)
    logger.addHandler(sh)

    fh = logging.FileHandler(LOGS_DIR / "faktorkhan.log", encoding="utf-8")
    fh.setFormatter(fmt)
    logger.addHandler(fh)

    return logger
