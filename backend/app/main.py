"""نقطه ورود برنامه فاکتورخوان (FastAPI)."""
from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware

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
    if settings.is_prod:
        if not os.getenv("SECRET_KEY"):
            log.warning("SECRET_KEY در .env تنظیم نشده است؛ برای استقرار روی اینترنت آن را تعیین کنید.")
        if "*" in [o.strip() for o in settings.CORS_ORIGINS.split(",")]:
            log.warning("CORS_ORIGINS=* در محیط عملیاتی نادیده گرفته می‌شود (همان‌مبدأ).")
        if not settings.ALLOWED_HOSTS:
            log.warning("ALLOWED_HOSTS خالی است؛ دامنه‌های مجاز را تعیین کنید تا هدر Host جعلی رد شود.")
        if not settings.FORCE_HTTPS:
            log.warning("FORCE_HTTPS خاموش است؛ اگر پشت HTTPS هستید آن را 1 کنید.")
        from .services import gateway as cloud_gateway
        if not cloud_gateway.gateway_configured():
            log.warning("آدرس درگاه سرویس ابری نامعتبر است؛ فقط موتور لوکال فعال است.")
        elif (settings.CLOUD_OCR_GATEWAY or "").strip():
            log.info("سرویس ابری آماده است (درگاه سفارشی از .env).")
        else:
            log.info("سرویس ابری آماده است (درگاه پیش‌فرض درون‌برنامه).")
    yield


# مستندات API در محیط عملیاتی بسته است (مگر با ENABLE_API_DOCS=1 باز شود)
_docs_on = settings.ENABLE_API_DOCS or not settings.is_prod

app = FastAPI(
    title=f"{settings.APP_NAME} API",
    description="سامانه هوشمند خوانش و مدیریت فاکتور",
    version=settings.APP_VERSION,
    docs_url="/api/docs" if _docs_on else None,
    redoc_url=None,
    openapi_url="/api/openapi.json" if _docs_on else None,
    lifespan=lifespan,
)

# بررسی هدر Host در برابر دامنه‌های مجاز (جلوگیری از حملات Host header)
if settings.allowed_hosts_list:
    hosts = list(settings.allowed_hosts_list)
    for extra in ("127.0.0.1", "localhost"):
        if extra not in hosts:
            hosts.append(extra)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=hosts, www_redirect=False)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept", "X-Requested-With"],
    max_age=3600,
)
app.add_middleware(GZipMiddleware, minimum_size=1024)


CSP = (
    "default-src 'self'; "
    "script-src 'self'; "
    "style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data: blob:; "
    "font-src 'self' data:; "
    "connect-src 'self'; "
    "worker-src 'self' blob:; "
    "manifest-src 'self'; "
    "object-src 'none'; "
    "base-uri 'self'; "
    "form-action 'self'; "
    "frame-ancestors 'none'"
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    response.headers.setdefault("Permissions-Policy",
                                "geolocation=(), microphone=(), camera=(), payment=()")
    response.headers.setdefault("Cross-Origin-Opener-Policy", "same-origin")
    response.headers.setdefault("Content-Security-Policy", CSP)
    # امضای سرور افشا نشود
    if "server" in response.headers:
        del response.headers["server"]
    if settings.FORCE_HTTPS:
        response.headers.setdefault("Strict-Transport-Security",
                                    f"max-age={settings.HSTS_SECONDS}; includeSubDomains")
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
    return {"app": app_meta(), "docs": "/api/docs" if _docs_on else None}


# ------------------------------------------------------------ رابط کاربری
if FRONTEND_DIR.is_dir():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIR / "assets"), name="assets")

    @app.middleware("http")
    async def asset_cache_control(request: Request, call_next):
        """دارایی‌های ثابت هرگز از کش قدیمی سرو نشوند (بعد از آپدیت نسخه)."""
        response = await call_next(request)
        path = request.url.path
        if path.startswith("/assets/") or path in {"/", "/sw.js"}:
            response.headers["Cache-Control"] = "no-cache, must-revalidate"
        return response

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
        # مسیرهای API هرگز نباید صفحهٔ HTML برگردانند
        if full_path == "api" or full_path.startswith("api/"):
            return JSONResponse({"detail": "مسیر مورد نظر یافت نشد."}, status_code=404)
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
