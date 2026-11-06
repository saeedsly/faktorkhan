"""رابطه‌ی مشترک بک‌اندهای OCR."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class BackendResult:
    text: str
    confidence: float
    words: list[dict] = field(default_factory=list)


class OCRBackend:
    name: str = "base"
    available: bool = False

    def is_available(self) -> bool:
        return self.available

    def extract(self, image) -> BackendResult:  # noqa: ANN001
        raise NotImplementedError
