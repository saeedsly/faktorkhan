"""دانلود وزن‌های OCR روی رایانه‌ی خودتان.

اجرا (از پوشه‌ی ocr/):
    python scripts/download_models.py                  # PP-OCRv5 (پیش‌فرض): models/det و models/rec
    python scripts/download_models.py --det-v6 small   # اضافه: تشخیص PP-OCRv6 در models/det_v6
    python -m server --models models --check          # بررسی اینکه موتور بارگذاری می‌شود

منابع:
    PaddlePaddle/PP-OCRv5_mobile_det_onnx          تشخیص متن (Hugging Face)
    PaddlePaddle/arabic_PP-OCRv5_mobile_rec_onnx   بازشناسی عربی/فارسی (Hugging Face)
    PP-OCRv6_det_small|medium.onnx                 تشخیص متن (ModelScope، همان فایل‌های RapidOCR 3.10.0 با SHA256 بررسی‌شده)
دیکشنری کاراکترها همراه برنامه است (server/dict/ppocrv5_arabic_dict.txt).
"""

from __future__ import annotations

import argparse
import hashlib
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
REPOS = {
    "det": "PaddlePaddle/PP-OCRv5_mobile_det_onnx",
    "rec": "PaddlePaddle/arabic_PP-OCRv5_mobile_rec_onnx",
}
# نشانی و SHA256 از default_models.yaml بسته‌ی rapidocr==3.10.0
V6_DET = {
    "small": (
        "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.10.0/onnx/PP-OCRv6/det/PP-OCRv6_det_small.onnx",
        "090f04abcd9d9a7498bc4ebf677e4cb9bdce1fe4197ddb7e529f1ef44e1ff94f",
    ),
    "medium": (
        "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.10.0/onnx/PP-OCRv6/det/PP-OCRv6_det_medium.onnx",
        "92078b7355007ccfffcd4c8cd441a3afd4538904d06881b29a155e1e679907c2",
    ),
}


def _download_v6(size: str, dest: Path) -> int:
    import requests

    url, expected = V6_DET[size]
    dest.mkdir(parents=True, exist_ok=True)
    target = dest / f"PP-OCRv6_det_{size}.onnx"
    print(f"دانلود PP-OCRv6 {size} -> {target}", flush=True)
    with requests.get(url, stream=True, timeout=120) as res:
        res.raise_for_status()
        digest = hashlib.sha256()
        with open(target, "wb") as fh:
            for chunk in res.iter_content(1 << 20):
                fh.write(chunk)
                digest.update(chunk)
    if digest.hexdigest() != expected:
        target.unlink(missing_ok=True)
        print("خطا: SHA256 فایل با مقدار مورد انتظار یکی نیست؛ فایل حذف شد.", file=sys.stderr)
        return 1
    print(f"  ok: SHA256 تأیید شد ({target.stat().st_size / 1e6:.1f} MB)")
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="دانلود مدل‌های OCR")
    p.add_argument("--dest", default=str(HERE / "models"))
    p.add_argument("--det-v6", choices=sorted(V6_DET), default=None,
                   help="تشخیص PP-OCRv6 را هم دانلود کن (small یا medium)")
    p.add_argument("--only-v6", action="store_true", help="فقط PP-OCRv6 را دانلود کن")
    args = p.parse_args(argv)
    dest = Path(args.dest)

    if args.det_v6:
        code = _download_v6(args.det_v6, dest / "det_v6")
        if code or args.only_v6:
            return code
    if args.only_v6:
        return 0

    try:
        from huggingface_hub import snapshot_download
    except ImportError:
        print("ابتدا وابستگی‌ها را نصب کنید: pip install -r requirements-server.txt", file=sys.stderr)
        return 1

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
