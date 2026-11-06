"""پیش‌پردازش تصاویر فاکتور برای بالا بردن دقت OCR.

شامل: خاکستری‌سازی، حذف نïs، بهبود کنتراست (CLAHE)، آستانه‌ی 어깨응 도ختی (adaptive threshold) و بزرگنمایی.
"""

from __future__ import annotations

import cv2
import numpy as np
from dataclasses import dataclass, field


@dataclass
class PrepResult:
    image: np.ndarray
    steps: list[str] = field(default_factory=list)


class PreprocessPipeline:
    def __init__(
        self,
        upscale: float = 2.0,
        denoise: bool = True,
        threshold: bool = True,
    ) -> None:
        self.upscale = upscale
        self.denoise = denoise
        self.threshold = threshold

    def run(self, image: np.ndarray) -> PrepResult:
        steps: list[str] = []
        img = image

        if len(img.shape) == 3:
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            steps.append("grayscale")
        else:
            gray = img

        if self.denoise:
            gray = cv2.fastNlMeansDenoising(
                gray, None, h=10, templateWindowSize=7, searchWindowSize=21
            )
            steps.append("denoise")

        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        gray = clahe.apply(gray)
        steps.append("clahe")

        if self.threshold:
            gray = cv2.adaptiveThreshold(
                gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 15
            )
            steps.append("adaptive_threshold")

        if self.upscale and self.upscale != 1.0:
            gray = cv2.resize(
                gray, None, fx=self.upscale, fy=self.upscale, interpolation=cv2.INTER_CUBIC
            )
            steps.append(f"upscale_{self.upscale}")

        return PrepResult(image=gray, steps=steps)

    def variants(self, image: np.ndarray) -> list[PrepResult]:
        """چند پیش‌پردازش متفاوت؛ بهترین نتیجه از میان آنها انتخاب می‌شود."""
        results: list[PrepResult] = [self.run(image)]
        results.append(
            PreprocessPipeline(
                upscale=self.upscale, denoise=self.denoise, threshold=False
            ).run(image)
        )
        results.append(
            PreprocessPipeline(
                upscale=self.upscale, denoise=False, threshold=True
            ).run(image)
        )
        return results
