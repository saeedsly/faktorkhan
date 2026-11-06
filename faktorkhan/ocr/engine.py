"""موتور OCR فاکتورخوان: پیش‌پردازش + بکاندها + انتخاب بهترین نتیجه."""

from __future__ import annotations

import logging
from pathlib import Path

import cv2

from faktorkhan.config import DEFAULT_OCR_BACKEND, OCR_UPSCALE_FACTOR
from faktorkhan.ocr.backends.base import OCRBackend
from faktorkhan.ocr.backends.easyocr_backend import EasyOCRBackend
from faktorkhan.ocr.backends.tesseract import TesseractBackend
from faktorkhan.ocr.models import OCRResult
from faktorkhan.ocr.preprocess import PreprocessPipeline

logger = logging.getLogger("faktorkhan")


class OCREngine:
    """ورودی: مسیر تصویر — خروجی: بهترین OCRResult بین پیش‌پردازش‌ها و بک‌اندها."""

    def __init__(
        self,
        backend: str = DEFAULT_OCR_BACKEND,
        upscale: float = OCR_UPSCALE_FACTOR,
    ) -> None:
        self.backend_preference = backend
        self.pipeline = PreprocessPipeline(upscale=upscale)
        self.backends: list[OCRBackend] = []
        self._init_backends()

    def _init_backends(self) -> None:
        if self.backend_preference in ("auto", "tesseract"):
            self.backends.append(TesseractBackend())
        if self.backend_preference in ("auto", "easyocr"):
            self.backends.append(EasyOCRBackend())
        # همیشه بک‌اندادخلی factorial خالی داریم؛ اگر هیچ یک در دسترس نبودند نتیجه خالی برمی‌گردد.

    def run(self, image_path: str | Path) -> OCRResult:
        path = Path(image_path)
        if not path.exists():
            raise FileNotFoundError(f"تصویر یافت نشد: {path}")

        image = cv2.imread(str(path))
        if image is None:
            raise FileNotFoundError(f"تصویر قابل خواندن نیست: {path}")

        best: OCRResult | None = None
        for variant in self.pipeline.variants(image):
            for backend in self.backends:
                if not backend.is_available():
                    continue
                try:
                    br = backend.extract(variant.image)
                except Exception as exc:  # pragma: no cover - بک‌اند पक्षی
                    logger.warning("backend %s failed on variant: %s", backend.name, exc)
                    continue
                result = OCRResult(
                    text=br.text,
                    confidence=br.confidence,
                    backend=backend.name,
                    words=br.words,
                    preprocessing_steps=variant.steps,
                    source_image=str(path),
                )
                if best is None or result.confidence > best.confidence:
                    best = result

        if best is None:
            logger.warning("هیچ بک‌اند OCR در دسترس نبود؛ 결과 خالی برمی‌گردد.")
            return OCRResult(
                text="",
                confidence=0.0,
                backend="none",
                preprocessing_steps=[],
                source_image=str(path),
            )
        logger.info(
            "OCR完成 شد با بک‌اند %s و اطمینان %.1f%% (مرحله‌ها: %s)",
            best.backend,
            best.confidence,
            ", ".join(best.preprocessing_steps),
        )
        return best
