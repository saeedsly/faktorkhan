#!/usr/bin/env bash
# فاکتورخوان — لاینر لینوکس / مک
set -e
cd "$(dirname "$0")"

if [ ! -d ".venv" ]; then
    echo "ایجاد محیط مجازی..."
    python3 -m venv .venv
fi

echo "نصب وابستگی‌ها..."
source .venv/bin/activate
pip install -q -r requirements.txt

echo "اجرای فاکتورخوان..."
python main.py
