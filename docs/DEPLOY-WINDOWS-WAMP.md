# نصب روی ویندوز و WAMP — گام‌به‌گام

این سند دو سناریو را پوشش می‌دهد:

- **الف)** اجرای فاکتورخوان کنار WAMP با پایگاه داده MySQL
- **ب)** ساخت نسخه نصبی دسکتاپ (بدون نیاز به WAMP)

---

## پیش‌نیازها

| مورد | نسخه | توضیح |
|---|---|---|
| ویندوز | ۱۰ یا ۱۱ (۶۴ بیتی) | ویندوز سرور ۲۰۱۹ به بالا هم پشتیبانی می‌شود |
| Python | 3.11 یا بالاتر | در نصب، گزینه **Add python.exe to PATH** را فعال کنید |
| WAMP / XAMPP | آخرین نسخه | MySQL/MariaDB کافی است؛ Apache برای پروکسی |
| مرورگر | Chrome / Edge / Firefox | — |

---

## الف) اجرا کنار WAMP

### ۱) ساخت پایگاه داده

از phpMyAdmin (آیکن WAMP) یا خط فرمان:

```sql
CREATE DATABASE faktorkhan CHARACTER SET utf8mb4 COLLATE utf8mb4_persian_ci;
```

> کدگذاری `utf8mb4` الزامی است؛ در غیر این صورت متن فارسی و اموجی خراب می‌شود.

اختیاری: اگر می‌خواهید ساختار جداول را از قبل بسازید، فایل `deploy/mysql/schema.sql`
را در phpMyAdmin اجرا کنید. در غیر این صورت برنامه خودش جداول را می‌سازد.

### ۲) دریافت کد و نصب وابستگی‌ها

```bat
cd C:\wamp64\www\faktorkhan
python -m venv venv
venv\Scripts\activate
pip install -r backend\requirements.txt
```

### ۳) تنظیم فایل محیطی

فایل `backend\.env.example` را به `.env` در **ریشه پروژه** کپی کنید و مقادیر را پر کنید:

```env
SECRET_KEY=...            ← python -c "import secrets;print(secrets.token_urlsafe(48))"
ENCRYPTION_KEY=...        ← یک مقدار تصادفی دیگر با همان دستور
DATABASE_URL=mysql+pymysql://root:@127.0.0.1:3306/faktorkhan?charset=utf8mb4
CLOUD_OCR_GATEWAY=<آدرس درگاه سرویس ابری>
OWNER_NAME=سعید سالاری
OWNER_EMAIL=you@example.com
OWNER_PASSWORD=یک-رمز-قوی
```

> اگر رمز روت MySQL دارید، آن را بین `root:` و `@` قرار دهید.
> `CLOUD_OCR_GATEWAY` فقط همین‌جا نوشته می‌شود و در هیچ صفحه‌ای دیده نمی‌شود.

### ۴) اجرا

```bat
cd backend
python run.py --host 127.0.0.1 --port 8000
```

آدرس: `http://127.0.0.1:8000`
اطلاعات ورود اولیه در `storage\OWNER-CREDENTIALS.txt` است (اگر رمز مالک را در `.env` تنظیم
کرده باشید، همان رمز معتبر است).

### ۵) پروکسی Apache (اختیاری اما توصیه‌شده)

برای دسترسی از شبکه با آدرس تمیز (مثلاً `http://faktorkhan.local`):

1. در `httpd.conf` این ماژول‌ها را فعال کنید:

   ```apache
   LoadModule proxy_module        modules/mod_proxy.so
   LoadModule proxy_http_module   modules/mod_proxy_http.so
   LoadModule headers_module      modules/mod_headers.so
   ```

2. فایل `deploy\apache\faktorkhan.conf` را در `conf\extra\httpd-vhosts.conf` کپی و مسیرها را اصلاح کنید.
3. در `C:\Windows\System32\drivers\etc\hosts` اضافه کنید:

   ```
   127.0.0.1   faktorkhan.local
   ```

4. Apache را ری‌استارت کنید.

### ۶) اجرای خودکار با ویندوز (اختیاری)

یک فایل `start-faktorkhan.bat` در Startup ویندوز (`shell:startup`) قرار دهید:

```bat
@echo off
cd /d C:\wamp64\www\faktorkhan\backend
call ..\venv\Scripts\activate
python run.py --host 127.0.0.1 --port 8000 --no-browser
```

برای اجرای پایدار در سرور ویندوز، از [NSSM](https://nssm.cc/) استفاده کنید:

```bat
nssm install FactorKhan "C:\wamp64\www\faktorkhan\venv\Scripts\python.exe" "C:\wamp64\www\faktorkhan\backend\run.py --no-browser"
nssm start FactorKhan
```

---

## ب) نسخه نصبی دسکتاپ

```bat
cd desktop
build_windows.bat
```

سپس برای ساخت فایل Setup:

```bat
ISCC installer\faktorkhan.iss
```

خروجی: `desktop\dist-installer\FactorKhan-Setup-1.0.0.exe`

این نصب‌کننده:

- پیش از نصب، **متن حق معنوی** را نشان می‌دهد و شرایط استفاده را می‌پرسد؛
- پایگاه داده SQLite را در `%APPDATA%\FactorKhan` می‌سازد؛
- آیکن دسکتاپ و منوی استارت را اضافه می‌کند؛
- به «افزودن یا حذف برنامه‌ها» اضافه می‌شود و حذف تمیزی دارد.

---

## عیب‌یابی رایج

| مشکل | علت | راه‌حل |
|---|---|---|
| `Access denied for user 'root'@'localhost'` | رمز MySQL اشتباه | رمز را در `DATABASE_URL` اصلاح کنید |
| متن فارسی به‌صورت `????` | کدگذاری پایگاه داده | دیتابیس را با `utf8mb4` بسازید |
| `ModuleNotFoundError: pymysql` | نصب ناقص وابستگی‌ها | `pip install -r backend\requirements.txt` |
| خطای ۴۱۳ در بارگذاری | حجم فایل بیش از حد | `MAX_UPLOAD_MB` و `LimitRequestBody` را بالا ببرید |
| «سرویس ابری آماده نیست» | توکن ثبت نشده | پنل مدیریت → سرویس ابری → ثبت توکن |
| پورت ۸۰۰۰ اشغال است | سرویس دیگر | `python run.py --port 8010` |

---

## پشتیبان‌گیری

- **داده‌ها:** از پنل مدیریت → نمای کلی → «دریافت پشتیبان» (فایل JSON)
- **MySQL:** `mysqldump -u root -p faktorkhan > backup.sql`
- **فایل‌های بارگذاری‌شده:** پوشه `storage\uploads`
