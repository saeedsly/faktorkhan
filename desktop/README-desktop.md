# نسخه رومیزی ویندوز — فاکتورخوان

این نسخه برای نصب روی رایانه شخصی ویندوز طراحی شده و هیچ نیازی به MySQL،
Apache، اینترنت یا سرور ندارد. پایگاه داده SQLite در پوشه داده کاربر ساخته می‌شود.

## ساخت فایل اجرایی

```bat
cd desktop
build_windows.bat
```

خروجی: `desktop\dist\FactorKhan\FactorKhan.exe`

## ساخت نصب‌کننده (Setup.exe)

1. Inno Setup 6 را از `jrsoftware.org` نصب کنید.
2. در پوشه `desktop` اجرا کنید:

```bat
ISCC installer\faktorkhan.iss
```

خروجی: `desktop\dist-installer\FactorKhan-Setup-1.0.0.exe`

نصب‌کننده شامل این موارد است:

- صفحه **حق معنوی** پیش از نصب (`installer/copyright_fa.txt`)
- صفحه **پذیرش شرایط استفاده** (`installer/license_fa.txt`)
- آیکن اختصاصی، تصاویر جادوگر نصب، ثبت در «افزودن یا حذف برنامه‌ها»
- گزینه‌های میان‌بر دسکتاپ، نوار وظیفه و اجرای خودکار با ویندوز

## محل داده‌ها

| مورد | مسیر |
|---|---|
| پایگاه داده | `%APPDATA%\FactorKhan\faktorkhan.db` |
| فایل‌های بارگذاری‌شده | `%APPDATA%\FactorKhan\storage\uploads` |
| لاگ برنامه | `%APPDATA%\FactorKhan\desktop.log` |
| اطلاعات ورود اولیه | `%APPDATA%\FactorKhan\storage\OWNER-CREDENTIALS.txt` |

> پس از اولین ورود، گذرواژه مالک را تغییر دهید و فایل اطلاعات ورود را حذف کنید.

## اجرای بدون ساخت نصب‌کننده (حالت توسعه)

```bat
cd backend
..\desktop\.venv\Scripts\python ..\desktop\desktop_app.py
```

## فعال‌سازی خوانش تصویر به‌صورت لوکال (اختیاری)

1. Tesseract OCR را برای ویندوز نصب کنید (نسخه 5 با بسته زبان `fas`).
2. در پوشه `.venv` اجرا کنید: `pip install pytesseract pillow`
3. مسیر `tesseract.exe` را به متغیر محیطی `PATH` اضافه کنید.

بدون این مرحله، حالت لوکال برای PDF متنی کار می‌کند و برای تصویر از حالت ابری استفاده می‌شود.
