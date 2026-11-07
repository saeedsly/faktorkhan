"""نقطه ورود برنامه فاکتورخوان (FastAPI)."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import FRONTEND_DIR, app_meta, settings
from .database import init_db
from .routers import admin, auth, billing, invoices, ocr, system
from .seed import bootstrap

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-7s | %(name)s | %(message)s",
)
log = logging.getLogger("faktorkhan")

# لاگ درخواست‌های بیرونی خاموش می‌شود تا آدرس درگاه در هیچ لاگی درج نشود
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    info = bootstrap()
    if info.get("owner"):
        log.warning("حساب مالک ساخته شد — فایل storage/OWNER-CREDENTIALS.txt را بررسی کنید.")
    log.info("%s v%s آماده است", settings.APP_NAME, settings.APP_VERSION)
    yield


app = FastAPI(
    title=f"{settings.APP_NAME} API",
    description="سامانه هوشمند خوانش و مدیریت فاکتور",
    version=settings.APP_VERSION,
    docs_url="/api/docs",
    redoc_url=None,
    openapi_url="/api/openapi.json",
    lifespan=lifespan,
)

_origins = [o.strip() for o in settings.CORS_ORIGINS.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(GZipMiddleware, minimum_size=1024)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    response.headers.setdefault("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
    if request.url.path.startswith("/api/"):
        response.headers.setdefault("Cache-Control", "no-store")
    return response


@app.middleware("http")
async def limit_body(request: Request, call_next):
    length = request.headers.get("content-length")
    if length and request.url.path.startswith("/api/ocr"):
        try:
            if int(length) > (settings.MAX_UPLOAD_MB + 2) * 1024 * 1024:
                return JSONResponse({"detail": f"حجم درخواست بیش از حد مجاز است ({settings.MAX_UPLOAD_MB}MB)."},
                                    status_code=413)
        except ValueError:
            pass
    return await call_next(request)


for module in (auth, billing, invoices, ocr, admin, system):
    app.include_router(module.router)


@app.get("/api", include_in_schema=False)
def api_root():
    return {"app": app_meta(), "docs": "/api/docs"}


# ------------------------------------------------------------ رابط کاربری
if FRONTEND_DIR.is_dir():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIR / "assets"), name="assets")

    @app.get("/manifest.webmanifest", include_in_schema=False)
    def manifest():
        return FileResponse(FRONTEND_DIR / "manifest.webmanifest", media_type="application/manifest+json")

    @app.get("/sw.js", include_in_schema=False)
    def service_worker():
        return FileResponse(FRONTEND_DIR / "sw.js", media_type="application/javascript",
                            headers={"Service-Worker-Allowed": "/"})

    @app.get("/", include_in_schema=False)
    def index():
        return FileResponse(FRONTEND_DIR / "index.html")

    @app.get("/favicon.svg", include_in_schema=False)
    def favicon():
        return FileResponse(FRONTEND_DIR / "assets" / "favicon.svg", media_type="image/svg+xml")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa_fallback(full_path: str):
        candidate = (FRONTEND_DIR / full_path).resolve()
        try:
            candidate.relative_to(FRONTEND_DIR.resolve())
        except ValueError:
            return JSONResponse({"detail": "مسیر نامعتبر"}, status_code=404)
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(FRONTEND_DIR / "index.html")


@app.exception_handler(404)
async def not_found(request: Request, exc):  # pragma: no cover
    if request.url.path.startswith("/api/"):
        return JSONResponse({"detail": "مسیر مورد نظر یافت نشد."}, status_code=404)
    index_file = FRONTEND_DIR / "index.html"
    if index_file.is_file():
        return FileResponse(index_file)
    return JSONResponse({"detail": "not found"}, status_code=404)
