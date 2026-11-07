"""سرور HTTP: /api/health، /api/ocr و فایل‌های رابط کاربری (public/) روی همان پورت.

موتورها با کلید نام داده می‌شوند:
    rapid  PP-OCRv5 (پیش‌فرض، چاپی و دیجیتال)
    vlm    Qwen3-VL از طریق llama-server (اختیاری، دست‌نویس)
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Protocol

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

PUBLIC_DIR = Path(__file__).resolve().parent.parent / "public"
MAX_UPLOAD_BYTES = 25 * 1024 * 1024
DEFAULT_ENGINE = "rapid"


class OcrEngine(Protocol):
    name: str

    def recognize_bytes(self, data: bytes) -> dict[str, Any]: ...


def create_app(engines: dict[str, OcrEngine | None] | None = None,
               errors: dict[str, str] | None = None,
               health_info: dict[str, dict[str, Any]] | None = None,
               serve_ui: bool = True) -> FastAPI:
    """engines: نگاشت نام موتور به شیء موتور (یا None اگر بارگذاری نشده)."""
    engines = engines or {}
    errors = errors or {}
    health_info = health_info or {}
    app = FastAPI(title="faktorkhan-ocr", docs_url="/api/docs", redoc_url=None)

    def engine_status(key: str) -> dict[str, Any]:
        engine = engines.get(key)
        if engine is None:
            return {"ok": False, "engine": None, "error": errors.get(key, "بارگذاری نشده است.")}
        return {"ok": True, "engine": engine.name, "error": None}

    @app.get("/api/health")
    def health() -> dict[str, Any]:
        statuses = {key: engine_status(key) for key in set(engines) | set(errors)}
        for key, info in health_info.items():
            statuses[key] = info
        rapid = statuses.get(DEFAULT_ENGINE, {"ok": False, "engine": None, "error": "موتور اصلی ثبت نشده."})
        return {
            "ok": rapid["ok"],
            "engine": rapid["engine"],
            "error": rapid["error"],
            "engines": {k: {"ok": v["ok"], "engine": v["engine"], "error": v["error"]} for k, v in statuses.items()},
        }

    @app.post("/api/ocr")
    async def ocr(file: UploadFile = File(...), engine: str = Query(DEFAULT_ENGINE)) -> Any:
        if engine not in engines and engine not in errors:
            raise HTTPException(status_code=400, detail=f"موتور ناشناخته: {engine}")
        target = engines.get(engine)
        if target is None:
            raise HTTPException(status_code=503, detail=errors.get(engine, "موتور OCR بارگذاری نشده است."))
        data = await file.read(MAX_UPLOAD_BYTES + 1)
        if len(data) > MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=413, detail="حجم فایل بیشتر از ۲۵ مگابایت است.")
        try:
            result = await run_in_threadpool(target.recognize_bytes, data)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:  # خطای مدل یا llama-server؛ پیام روشن به رابط داده شود
            raise HTTPException(status_code=502, detail=f"خطا در موتور {engine}: {exc}") from exc
        return JSONResponse(result)

    if serve_ui and PUBLIC_DIR.is_dir():
        app.mount("/", StaticFiles(directory=PUBLIC_DIR, html=True), name="ui")
    return app
