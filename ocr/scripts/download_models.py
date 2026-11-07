"""دانلود وزن‌های PP-OCRv5 از Hugging Face روی رایانه‌ی خودتان.

اجرا (از پوشه‌ی ocr/):
    python scripts/download_models.py            # دانلود در ocr/models/det و ocr/models/rec
    python -m server --models models --check    # بررسی اینکه موتور بارگذاری می‌شود

مدل‌ها:
    PaddlePaddle/PP-OCRv5_mobile_det_onnx          تشخیص محل خطوط متن
    PaddlePaddle/arabic_PP-OCRv5_mobile_rec_onnx   بازشناسی متن عربی/فارسی (شامل پ چ ژ ک گ و ارقام فارسی)
دیکشنری کاراکترها همراه برنامه است (server/dict/ppocrv5_arabic_dict.txt).
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
REPOS = {
    "det": "PaddlePaddle/PP-OCRv5_mobile_det_onnx",
    "rec": "PaddlePaddle/arabic_PP-OCRv5_mobile_rec_onnx",
}


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="دانلود مدل‌های PP-OCRv5 از Hugging Face")
    p.add_argument("--dest", default=str(HERE / "models"))
    args = p.parse_args(argv)
    try:
        from huggingface_hub import snapshot_download
    except ImportError:
        print("ابتدا وابستگی‌ها را نصب کنید: pip install -r requirements-server.txt", file=sys.stderr)
        return 1

    dest = Path(args.dest)
    for part, repo in REPOS.items():
        target = dest / part
        print(f"دانلود {repo} -> {target}", flush=True)
        snapshot_download(repo_id=repo, local_dir=str(target))
        files = sorted(target.glob("*.onnx"))
        if not files:
            print(f"خطا: فایل .onnx در {target} پیدا نشد.", file=sys.stderr)
            return 1
        if len(files) > 1:
            print(f"توجه: چند فایل .onnx در {target} است: {[f.name for f in files]}.")
            print("فقط یکی را نگه دارید؛ بقیه را پاک کنید تا موتور دقیقاً یک مدل را بخواند.")
            return 1
        print(f"  ok: {files[0].name} ({files[0].stat().st_size / 1e6:.1f} MB)")
    print("\nتمام. حالا: python -m server --models models --check")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
