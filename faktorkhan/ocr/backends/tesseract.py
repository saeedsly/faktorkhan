"""بک‌اند Tesseract OCR (نیازمند باینری tesseract در سیستم)."""

from __future__ import annotations

import shutil
from typing import Any

import cv2
import numpy as np
import pytesseract

from faktorkhan.ocr.backends.base import OCRBackend, BackendResult


class TesseractBackend(OCRBackend):
    name = "tesseract"

    def __init__(self) -> None:
        self.available = shutil.which("tesseract") is not None

    def extract(self, image: np.ndarray) -> BackendResult:
        if not self.available:
            raise RuntimeError("tesseract binary not installed on this system")

        data: dict[str, Any] = pytesseract.image_to_data(
            image, lang="fas+eng", output_type=pytesseract.Output.DICT
        )
        words: list[dict] = []
        confs: list[float] = []
        for i, text in enumerate(data["text"]):
            text = text.strip()
            if not text:
                continue
            try:
                conf = float(data["conf"][i])
            except (ValueError, TypeError):
                conf = 0.0
            words.append(
                {
                    "text": text,
                    "confidence": conf,
                    "box": [
                        int(data["left"][i]),
                        int(data["top"][i]),
                        int(data["width"][i]),
                        int(data["height"][i]),
                    ],
                }
            )
            confs.append(conf)

        joined = "\n".join(w["text"] for w in words)
        confidence = sum(confs) / len(confs) if confs else 0.0
        return BackendResult(text=joined, confidence=confidence, words=words)
