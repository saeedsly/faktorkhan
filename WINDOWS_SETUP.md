# راهنمای نصب و اجرا فاکتورخوان روی ویندوز

من روی لینوکس هستم و نمی‌توانم مستقیماً فایل `.exe` بسازم، اما تمام چیزی که نیاز داری آماده است.

## روش ساده (توصیه شده)

1. کد را از گیت‌هاب دانلود و استخراج کنید:
   `https://github.com/saeedsly/faktorkhan/archive/refs/heads/arena/38926976-faktorkhan.zip`

2. فایل **`install_and_run.bat`** را راست‌کلیک کرده و **«Run as administrator»** بزنید.

3. script خودش:
   - پایتون را چک می‌کند
   - کتابخانه‌های لازم را نصب می‌کند (PyQt6 و...)
   - برنامه را اجرا می‌کند

## اگر نصب کتابخانه با خطا مواجه شد (تایم‌اوت PyPI)

در PowerShell باز کنید و به پوشه برنامه بروید، سپس به ترتیب این دستورات را بزنید:

```powershell
# روش ۱: تلاش مجدد با زمان انتظار بیشتر
pip install --timeout 120 --retries 10 -r requirements.txt

# روش ۲: از_SOURCE جایگزین (چین)
pip install --timeout 120 --retries 10 --index-url https://pypi.tuna.tsinghua.edu.cn/simple -r requirements.txt

# روش ۳: یک‌یک نصب PyQt6 (بسیار مهم)
pip install PyQt6

# سپس اجرا:
python main.py
```

## اگر همچنان نصب نشد

ممکن است اینترنت شما به PyPI دسترسی نداشته باشد. در این صورت:
1. به [pypi.org/project/PyQt6/#files](https://pypi.org/project/PyQt6/#files) بروید
2. فایل `.whl` مناسب ویندوز خود را دانلود کنید (مثلاً `PyQt6-6.6.0-cp311-cp311-win_amd64.whl`)
3. نصب کنید: `pip install مسیر_فایل_whl`
4. همین کار را برای `Pillow`, `opencv-python-headless`, `pandas`, `openpyxl`, `cryptography`, `pytesseract`, `python-dateutil` تکرار کنید.

## اجرای مستقیم (بدون اسکریپت)

اگر فقط می‌خواهید بدون نصب Swe thủ công اجرا کنید:

```powershell
pip install -r requirements.txt
python main.py
```

## فایل‌های اصلی
- `main.py` — نقطه اجرا
- `faktorkhan/` — کد کامل برنامه
- `tests/` — ۱۴ تست اتوماتیک (پاس شده)
- `docs/FEATURES.md` — ۵۰ ویژگی

---

**اگر هر خطایی داد، تصویر خطا را بفرست تا دقیقاً برطرفش کنم.**
