#!/usr/bin/env bash
# اجرای فاکتورخوان روی لینوکس/مک
# اثر: سعید سالاری
set -e
cd "$(dirname "$0")"

if [ ! -d "venv" ]; then
    echo "ساخت محیط مجازی…"
    python3 -m venv venv
    ./venv/bin/pip install --upgrade pip
    ./venv/bin/pip install -r backend/requirements.txt
fi

[ -f ".env" ] || { cp backend/.env.example .env; echo "فایل .env ساخته شد؛ مقادیر آن را تکمیل کنید."; }

echo "فاکتورخوان روی http://127.0.0.1:${PORT:-8000} اجرا می‌شود"
cd backend
exec ../venv/bin/python run.py "$@"
