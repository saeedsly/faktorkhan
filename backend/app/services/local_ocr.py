"""موتور OCR لوکال (بدون اینترنت).

* PDF متنی: استخراج مستقیم متن با pypdf (سریع و دقیق)
* PDF تصویری / تصویر: در صورت نصب Tesseract (pytesseract + pdf2image) استفاده می‌شود
* همیشه یک خروجی متنی یا خطای شفاف برمی‌گرداند
"""
from __future__ import annotations

import logging
from pathlib import Path

log = logging.getLogger("faktorkhan.local")

TEXT_EXT = {".txt", ".csv", ".json", ".md"}


def capabilities() -> dict:
    info = {"pdf": True, "image": False, "engine": "pypdf", "error": ""}
    try:
        import pytesseract  # noqa: F401

        info["engine"] = "pypdf+tesseract"
        info["image"] = True
    except Exception:
        info["error"] = "برای OCR تصویر، موتور محلی نصب نشده است (اختیاری)."
    return info


def _pdf_text(path: Path) -> tuple[str, int]:
    try:
        from pypdf import PdfReader
    except Exception:  # pragma: no cover
        return "", 0
    try:
        reader = PdfReader(str(path))
        if reader.is_encrypted:
            try:
                reader.decrypt("")
            except Exception:
                return "", len(reader.pages)
        chunks = []
        for page in reader.pages[:60]:
            text = ""
            for mode in ("layout", ""):
                try:
                    text = page.extract_text(**({"extraction_mode": mode} if mode else {})) or ""
                except Exception:
                    text = ""
                if text.strip():
                    break
            if text.strip():
                chunks.append(text)
        return "\n".join(chunks).strip(), len(reader.pages)
    except Exception as exc:  # pragma: no cover
        log.warning("pdf extract failed: %s", type(exc).__name__)
        return "", 0


def _image_text(path: Path) -> str:
    try:
        import pytesseract
        from PIL import Image
    except Exception:
        return ""
    try:
        with Image.open(path) as img:
            if img.width < 1400:
                ratio = 1400 / float(img.width)
                img = img.resize((int(img.width * ratio), int(img.height * ratio)))
            return pytesseract.image_to_string(img, lang="fas+eng")
    except Exception as exc:  # pragma: no cover
        log.warning("local image ocr failed: %s", type(exc).__name__)
        return ""


def extract(path: Path) -> dict:
    """متن استخراج‌شده + اطلاعات تکمیلی."""
    suffix = path.suffix.lower()
    result = {"text": "", "pages": 0, "engine": "local", "ok": False, "message": ""}

    if suffix in TEXT_EXT:
        result.update(text=path.read_text(encoding="utf-8", errors="ignore"), ok=True, engine="text")
        return result

    if suffix == ".pdf":
        text, pages = _pdf_text(path)
        result["pages"] = pages
        result["engine"] = "pypdf"
        if text and len(text) > 40:
            result.update(text=text, ok=True)
            return result
        ocr_text = ""
        try:
            import pytesseract  # noqa: F401
            from pdf2image import convert_from_path  # type: ignore

            images = convert_from_path(str(path), dpi=220, first_page=1, last_page=20)
            ocr_text = "\n".join(pytesseract.image_to_string(img, lang="fas+eng") for img in images)
            result["engine"] = "pypdf+tesseract"
        except Exception:
            pass
        if ocr_text.strip():
            result.update(text=ocr_text, ok=True)
            return result
        result["message"] = "این PDF متن قابل استخراج ندارد (تصویری است). برای متن دقیق از سرویس ابری استفاده کنید."
        return result

    if suffix in {".jpg", ".jpeg", ".png", ".bmp", ".webp", ".tif", ".tiff"}:
        text = _image_text(path)
        if text.strip():
            result.update(text=text, ok=True, engine="tesseract", pages=1)
        else:
            result["message"] = "برای خوانش تصویر، موتور OCR محلی نصب نشده است. از سرویس ابری استفاده کنید."
        return result

    result["message"] = "این قالب فایل در حالت محلی پشتیبانی نمی‌شود."
    return result


def extract_audio_note() -> str:
    return "تبدیل فایل صوتی فقط با سرویس ابری امکان‌پذیر است."
