"""بک‌اند EasyOCR (دقت بسیار بالا برای خط‌دستی و فاکتورهای حرارتی).

نیازمند پکیج easyocr وtorch است (وزنه‌ی سنگین، نصب اختیاری).
"""

from __future__ import annotations

from typing import Any

import cv2
import numpy as np

from faktorkhan.ocr.backends.base import OCRBackend, BackendResult


class EasyOCRBackend(OCRBackend):
    name = "easyocr"

    def __init__(self) -> None:
        self._reader: Any = None
        self.available = False
        try:
            import easyocr  # type: ignore

            self._reader = easyocr.Reader(["fa", "en"], gpu=False)
            self.available = True
        except Exception:  # pragma: no cover - محیط بدون easyocr
            self.available = False

    def extract(self, image: np.ndarray) -> BackendResult:
        if not self.available:
            raise RuntimeError("easyocr is not installed")

        result = self._reader.readtext(image, detail=1)
        words: list[dict] = []
        confs: list[float] = []
        texts: list[str] = []
        for bbox, text, conf in result:
            words.append(
                {"text": text, "confidence": float(conf), "box": [float(v) for p in bbox for v in p]}
            )
            confs.append(float(conf))
            texts.append(text)

        joined = "\n".join(texts)
        confidence = sum(confs) / len(confs) if confs else 0.0
        return BackendResult(text=joined, confidence=confidence, words=words)
