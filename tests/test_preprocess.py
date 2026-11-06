"""تست‌های پیش‌پردازش تصویر."""

from __future__ import annotations

import numpy as np

from faktorkhan.ocr.preprocess import PreprocessPipeline


def test_pipeline_runs():
    img = np.random.randint(0, 255, (100, 100, 3), dtype=np.uint8)
    pipe = PreprocessPipeline()
    res = pipe.run(img)
    assert res.image.shape == (200, 200)  # upscale 2x
    assert "grayscale" in res.steps


def test_variants():
    img = np.random.randint(0, 255, (50, 50), dtype=np.uint8)
    pipe = PreprocessPipeline()
    variants = pipe.variants(img)
    assert len(variants) == 3
