"""سرور HTTP: /api/health، /api/ocr و فایل‌های رابط کاربری (public/) روی همان پورت."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Protocol

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse

PUBLIC_DIR = Path(__file__).resolve().parent.parent / "public"
MAX_UPLOAD_BYTES = 25 * 1024 * 1024


class OcrEngine(Protocol):
    name: str

    def recognize_bytes(self, data: bytes) -> dict[str, Any]: ...


def create_app(engine: OcrEngine | None, engine_error: str | None = None,
               serve_ui: bool = True) -> FastAPI:
    app = FastAPI(title="faktorkhan-ocr", docs_url="/api/docs", redoc_url=None)

    @app.get("/api/health")
    def health() -> dict[str, Any]:
        if engine is None:
            return {"ok": False, "engine": None, "error": engine_error or "موتور بارگذاری نشده است."}
        return {"ok": True, "engine": engine.name, "error": None}

    @app.post("/api/ocr")
    async def ocr(file: UploadFile = File(...)) -> Any:
        if engine is None:
            raise HTTPException(status_code=503, detail=engine_error or "موتور OCR بارگذاری نشده است.")
        data = await file.read(MAX_UPLOAD_BYTES + 1)
        if len(data) > MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=413, detail="حجم فایل بیشتر از ۲۵ مگابایت است.")
        try:
            result = await run_in_threadpool(engine.recognize_bytes, data)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return JSONResponse(result)

    if serve_ui and PUBLIC_DIR.is_dir():
        app.mount("/", StaticFiles(directory=PUBLIC_DIR, html=True), name="ui")
    return app
