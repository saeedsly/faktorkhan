"""موتور OCR: تشخیص متن + بازشناسی عربی/فارسی (PP-OCRv5) از طریق RapidOCR و ONNX Runtime روی CPU.

وزن‌ها از Hugging Face / ModelScope دانلود می‌شوند (scripts/download_models.py) و در models/
قرار می‌گیرند. این ماژول هیچ چیز را از اینترنت نمی‌گیرد.

ساختار پوشه‌ی models:
    models/det/*.onnx        تشخیص متن PP-OCRv5 (PaddlePaddle/PP-OCRv5_mobile_det_onnx)  [پیش‌فرض]
    models/det_v6/*.onnx     تشخیص متن PP-OCRv6 (اختیاری، --det-version v6)
    models/rec/*.onnx        بازشناسی عربی/فارسی (PaddlePaddle/arabic_PP-OCRv5_mobile_rec_onnx)
    server/dict/ppocrv5_arabic_dict.txt  دیکشنری کاراکترها (همراه برنامه، از مخزن PaddleOCR)
"""

from __future__ import annotations

import time
from pathlib import Path
from typing import Any

import numpy as np

from .textnorm import normalize_persian
from .textorder import DECODE_MODES, Detection, apply_decode, assemble_text, group_rows

HERE = Path(__file__).resolve().parent
DEFAULT_DICT = HERE / "dict" / "ppocrv5_arabic_dict.txt"
DET_VERSIONS = ("v5", "v6")

# مقادیر پیش‌پردازش از configs/det/PP-OCRv5/PP-OCRv5_mobile_det.yml مخزن PaddleOCR
DET_V5_MEAN = [0.485, 0.456, 0.406]
DET_V5_STD = [0.229, 0.224, 0.225]
REC_SHAPE = [3, 48, 320]  # configs/rec/PP-OCRv5/multi_language/arabic_PP-OCRv5_mobile_rec.yml


class EngineNotReady(RuntimeError):
    pass


def _single_onnx(folder: Path) -> Path:
    if not folder.is_dir():
        raise EngineNotReady(f"پوشه‌ی مدل پیدا نشد: {folder}")
    files = sorted(folder.glob("*.onnx"))
    if not files:
        raise EngineNotReady(f"فایل .onnx در {folder} نیست. اسکریپت دانلود را اجرا کنید.")
    if len(files) > 1:
        raise EngineNotReady(f"چند فایل .onnx در {folder} است؛ فقط یکی باید بماند: {[f.name for f in files]}")
    return files[0]


class PPOCRv5Engine:
    name = "PP-OCRv5 (ONNX, CPU)"

    def __init__(self, models_dir: Path, decode: str = "paddle", det_version: str = "v5",
                 dict_path: Path = DEFAULT_DICT, text_score: float = 0.3):
        if decode not in DECODE_MODES:
            raise ValueError(f"decode باید یکی از {DECODE_MODES} باشد")
        if det_version not in DET_VERSIONS:
            raise ValueError(f"det_version باید یکی از {DET_VERSIONS} باشد")
        self.decode = decode
        self.det_version = det_version
        det_dir = "det" if det_version == "v5" else "det_v6"
        det = _single_onnx(Path(models_dir) / det_dir)
        rec = _single_onnx(Path(models_dir) / "rec")
        if not dict_path.is_file():
            raise EngineNotReady(f"دیکشنری پیدا نشد: {dict_path}")
        from rapidocr import RapidOCR  # import دیرهنگام تا سرور بدون وزن هم بالا بیاید

        params: dict[str, Any] = {
            "Global.text_score": text_score,
            "Global.use_cls": False,  # جهت‌یابی متن را نداریم؛ فاکتورها معمولاً صاف‌اند
            "Det.model_path": str(det),
            "Rec.model_path": str(rec),
            "Rec.rec_keys_path": str(dict_path),
            "Rec.rec_img_shape": REC_SHAPE,
        }
        if det_version == "v5":
            # PP-OCRv5 با میانگین/انحراف معیار ImageNet و اندازه‌ی بیشینه آموزش دیده است.
            params.update({"Det.mean": DET_V5_MEAN, "Det.std": DET_V5_STD, "Det.limit_type": "max"})
        # برای v6 از پیش‌فرض‌های خود RapidOCR (میانگین/انحراف 0.5، limit_type=min) استفاده می‌شود.
        self.model_files = {"det": det.name, "rec": rec.name, "dict": dict_path.name}
        self.ocr = RapidOCR(params=params)

    def recognize_bgr(self, image: np.ndarray) -> dict[str, Any]:
        started = time.perf_counter()
        out = self.ocr(image)
        boxes = out.boxes if out.boxes is not None else []
        txts = out.txts or ()
        scores = out.scores or ()
        dets = [
            Detection(text=str(t), score=float(s), box=np.asarray(b, dtype=float).tolist())
            for b, t, s in zip(boxes, txts, scores)
            if str(t).strip()
        ]
        variants: dict[str, str] = {}
        for mode in DECODE_MODES:
            mode_dets = [Detection(apply_decode(d.text, mode), d.score, d.box) for d in dets]
            variants[mode] = normalize_persian(assemble_text(group_rows(mode_dets, rtl=True)))
        rows = group_rows(
            [Detection(apply_decode(d.text, self.decode), d.score, d.box) for d in dets], rtl=True
        )
        return {
            "engine": self.name,
            "model_files": self.model_files,
            "decode": self.decode,
            "text": variants[self.decode],
            "variants": variants,
            "lines": [
                {"text": normalize_persian(" ".join(d.text for d in row)),
                 "score": round(min(d.score for d in row), 4)}
                for row in rows
            ],
            "seconds": round(time.perf_counter() - started, 3),
        }

    def recognize_bytes(self, data: bytes) -> dict[str, Any]:
        import cv2

        image = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
        if image is None:
            raise ValueError("فایل تصویر معتبر نیست (JPG/PNG/WebP پشتیبانی می‌شود).")
        return self.recognize_bgr(image)
