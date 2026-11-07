# ──────────────────────────────────────────────────────────────
#  فاکتورخوان — تصویر داکر
#  اثر: سعید سالاری
# ──────────────────────────────────────────────────────────────
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    TZ=Asia/Tehran \
    DATA_DIR=/data

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
        curl tzdata fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt gunicorn

COPY backend /app/backend
COPY frontend /app/frontend

RUN mkdir -p /data && useradd -m -u 10001 faktor && chown -R faktor:faktor /data /app
USER faktor

ENV HOST=0.0.0.0 PORT=8000
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8000/api/system/health || exit 1

WORKDIR /app/backend
CMD ["gunicorn", "app.main:app", "-k", "uvicorn.workers.UvicornWorker", \
     "-w", "2", "-b", "0.0.0.0:8000", "--timeout", "300", "--access-logfile", "-"]
