"""ابزار manipulate مسیر فایل و دایرکتوری."""

from __future__ import annotations

from pathlib import Path

from faktorkhan.config import EXPORT_DIR, LICENSE_DIR, LOGS_DIR, DATA_DIR


def ensure_dir(path: str | Path) -> Path:
    p = Path(path)
    p.mkdir(parents=True, exist_ok=True)
    return p


def unique_filename(prefix: str, suffix: str, directory: str | Path = EXPORT_DIR) -> Path:
    """نام فایل یکتای 기반 بر برچسب زمانی."""
    from datetime import datetime

    directory = ensure_dir(directory)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    return directory / f"{prefix}_{stamp}{suffix}"


def is_image_file(path: str | Path) -> bool:
    from faktorkhan.config import SUPPORTED_IMAGE_EXTENSIONS

    return Path(path).suffix.lower() in SUPPORTED_IMAGE_EXTENSIONS


APP_DIRS = {
    "data": DATA_DIR,
    "logs": LOGS_DIR,
    "exports": EXPORT_DIR,
    "licenses": LICENSE_DIR,
}
