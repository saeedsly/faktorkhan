# فاکتورخوان روی ویندوز + WAMP/MySQL (چند کاربر، شبکه، اینترنت)

این سند سه سناریو را پوشش می‌دهد:

| سناریو | پایگاه داده | آدرس | چه کسی استفاده می‌کند |
|---|---|---|---|
| **الف) تک‌کاربره** | SQLite | `http://127.0.0.1:8000` | فقط خودِ شما روی همان سیستم |
| **ب) شبکهٔ محلی** | MySQL | `http://192.168.1.5:8000` | چند نفر در دفتر/کارگاه |
| **ج) اینترنت** | MySQL + Apache + HTTPS | `https://faktorkhan.ir` | مشتریان از هر جا |

> **سازگاری ویندوز:** ویندوز ۱۰ و ۱۱، ویندوز سرور ۲۰۱۶ به بالا.
> پایتون ۳.۱۳ حداقل ویندوز ۸.۱ است؛ روی ویندوز ۷ از نسخهٔ رومیزی (`FactorKhan.exe`) استفاده کنید.

---

# سناریو الف — تک‌کاربره (ساده‌ترین)

1. `START-WINDOWS.bat` را اجرا کنید.
2. تمام. پایگاه داده در `storage\faktorkhan.db` است.

برای پشتیبان‌گیری: کل پوشهٔ `storage` را کپی کنید.

---

# سناریو ب — شبکهٔ محلی با MySQL

## گام ۱: WAMP/XAMPP را نصب و روشن کنید
آیکن WAMP باید **سبز** باشد (Apache و MySQL هر دو روشن).

## گام ۲: یک دستور، همه‌چیز را آماده می‌کند

روی **`SETUP-MYSQL-WINDOWS.bat`** دوبار کلیک کنید (کلیک راست → Run as administrator
برای باز کردن پورت فایروال). این اسکریپت به‌ترتیب می‌پرسد:

```
آدرس سرور MySQL [127.0.0.1]:
پورت MySQL [3306]:
کاربر root [root]:
گذرواژه root (در WAMP معمولاً خالی است):        ← فقط Enter
نام پایگاه داده [faktorkhan]:
کاربر اختصاصی برنامه [faktorkhan]:
گذرواژه کاربر «faktorkhan» [خودکار]:             ← فقط Enter (تولید می‌شود)
دامنه سایت (خالی = فقط شبکهٔ محلی):               ← فعلاً Enter
اجازه ثبت‌نام آزاد باشد؟ (توصیه: خیر) (y/n) [n]:  ← Enter
```

خروجی موفق:

```
  ✓ اتصال به MySQL برقرار شد — نسخه 8.0.36
  ✓ پایگاه داده `faktorkhan` آماده است
  ✓ فایل تنظیمات به‌روزرسانی شد: ...\.env
  ✓ تست اتصال موفق — MySQL 8.0.36 — تعداد جداول فعلی: 0
```

جداول در اولین اجرای برنامه خودکار ساخته می‌شوند (۱۱ جدول).

## گام ۳: اجرای برنامه در حالت سرور

روی **`START-SERVER-WINDOWS.bat`** دوبار کلیک کنید. آدرس‌ها چاپ می‌شوند:

```
حالت سرور: برنامه برای شبکه باز است.
  همین سیستم:   http://127.0.0.1:8000
  شبکهٔ محلی:   http://192.168.1.5:8000
```

همکاران شما از همان آدرس شبکهٔ محلی وارد می‌شوند. برای هر کاربر یک حساب بسازید:
**پنل مدیریت → کاربران → کاربر جدید** (یا ثبت‌نام، اگر باز باشد).

## گام ۴: اجرای خودکار به‌عنوان سرویس ویندوز (اختیاری)

پنجرهٔ سیاه نباید بسته شود؛ اگر می‌خواهید برنامه با روشن شدن ویندوز خودش بالا بیاید:

```
nssm install FactorKhan "C:\faktorkhan\python\python.exe" "backend\run.py --host 0.0.0.0 --port 8000 --no-browser"
nssm set FactorKhan AppDirectory "C:\faktorkhan"
nssm set FactorKhan AppStdout "C:\faktorkhan\storage\service.log"
nssm set FactorKhan AppStderr "C:\faktorkhan\storage\service.log"
nssm start FactorKhan
```

اگر بستهٔ PORTABLE را دارید، `python\python.exe` را بدهید؛ وگرنه مسیر پایتون سیستم یا
`venv\Scripts\python.exe`.

> `nssm` را از `nssm.cc` بگیرید (یک فایل ۳۰۰ کیلوبایتی، بدون نصب).

---

# سناریو ج — انتشار روی اینترنت (دامنه + HTTPS)

## پیش‌نیاز
- یک دامنه (مثلاً `faktorkhan.ir`) که A Record آن به IP سرور/ویندوز شما اشاره کند
- پورت‌های ۸۰ و ۴۴۳ در مودم/فایروال به این سیستم Forward شده باشند

## گام ۱: راه‌اندازی با دامنه

`SETUP-MYSQL-WINDOWS.bat` را اجرا کنید و این بار:

```
دامنه سایت (خالی = فقط شبکهٔ محلی): faktorkhan.ir
سایت پشت HTTPS است؟ (y/n) [y]:
```

این کار در `.env` این‌ها را تنظیم می‌کند:

```
ALLOWED_HOSTS=faktorkhan.ir,www.faktorkhan.ir,localhost,127.0.0.1
FORCE_HTTPS=1
PROXY_HEADERS=1
ENABLE_API_DOCS=0
ALLOW_REGISTRATION=false
HOST=127.0.0.1          ← پورت ۸۰۰۰ از بیرون بسته می‌ماند (فقط Apache دسترسی دارد)
```

> ⚠️ `HOST=127.0.0.1` عمداً انتخاب می‌شود: هیچ‌کس نمی‌تواند مستقیم به پورت ۸۰۰۰ وصل شود؛
> همه از درِ Apache (۸۰/۴۴۳) وارد می‌شوند.

## گام ۲: گواهی SSL بگیرید (win-acme)

1. `win-acme` را از `win-acme.com` دانلود کنید.
2. اجرا → `N` (ساخت گواهی جدید) → دامنه را وارد کنید → روش **http-01** (نیاز به Apache روی پورت ۸۰)
3. مسیر ذخیره را `C:\ssl\faktorkhan.ir` بگذارید.
4. فایل‌های `certificate.crt` و `private.key` تولید می‌شوند.

> تمدید خودکار: win-acme یک Scheduled Task می‌سازد؛ نیازی به کار دستی نیست.

## گام ۳: پیکربندی Apache

فایل `deploy/apache/faktorkhan.conf` را در
`C:\wamp64\bin\apache\apache2.4.x\conf\extra\httpd-vhosts.conf` کپی کنید و:

1. مسیر `DocumentRoot`/`Alias` را درست کنید (`C:/wamp64/www/faktorkhan`)
2. `ServerName` و مسیر گواهی‌ها را با دامنهٔ خودتان عوض کنید
3. ماژول‌های `proxy`, `proxy_http`, `headers`, `rewrite`, `ssl`, `socache_shmcb` را
   در `httpd.conf` از حالت کامنت خارج کنید
4. Apache را ری‌استارت کنید (آیکن WAMP → Restart All Services)

## گام ۴: اجرا و تست

```
START-SERVER-WINDOWS.bat
```

سپس بررسی کنید:

| آدرس | نتیجهٔ درست |
|---|---|
| `http://faktorkhan.ir` | ریدایرکت به `https://` |
| `https://faktorkhan.ir` | صفحهٔ ورود فاکتورخوان |
| `http://203.0.113.7:8000` | **باید باز نشود** (پورت مستقیم بسته است) |
| `https://faktorkhan.ir/api/system/health` | `{"ok":true, ...}` |

> اگر پورت ۸۰۰۰ از بیرون باز بود، یعنی `HOST` در `.env` هنوز `0.0.0.0` است؛ آن را
> `127.0.0.1` کنید و برنامه را ری‌استارت کنید.

## گام ۵: کارهای امنیتی اجباری

فهرست کامل در [`docs/SECURITY-FA.md`](SECURITY-FA.md) — خلاصه:

- [ ] گذرواژهٔ مالک را عوض کنید و `storage\OWNER-CREDENTIALS.txt` را پاک کنید
- [ ] `ALLOW_REGISTRATION=false` (فروش لایسنس با کد)
- [ ] `ENABLE_API_DOCS=0`
- [ ] HTTPS و HSTS فعال
- [ ] فایروال: فقط ۸۰ و ۴۴۳ باز باشد، نه ۳۳۰۶ و نه ۸۰۰۰
- [ ] پشتیبان‌گیری روزانهٔ MySQL

---

## مسیر دستی (بدون اسکریپت) — برای کسانی که phpMyAdmin را ترجیح می‌دهند

1. phpMyAdmin → زبانهٔ **SQL** → محتوای `deploy/mysql/00-create-db.sql` را بچسبانید و
   گذرواژهٔ `MyStrongPass!` را عوض کنید → **Go**
2. فایل `.env` را از `backend/.env.example` بسازید و این خط‌ها را پر کنید:

```
APP_ENV=production
SECRET_KEY=<python -c "import secrets;print(secrets.token_urlsafe(48))">
ENCRYPTION_KEY=<python -c "import secrets;print(secrets.token_urlsafe(48))">
DATABASE_URL=mysql+pymysql://faktorkhan:MyStrongPass!@127.0.0.1:3306/faktorkhan?charset=utf8mb4
ALLOWED_HOSTS=faktorkhan.ir,www.faktorkhan.ir,localhost,127.0.0.1
FORCE_HTTPS=1
PROXY_HEADERS=1
ALLOW_REGISTRATION=false
HOST=127.0.0.1
```

> اگر گذرواژه کاراکترهایی مثل `@` یا `:` دارد، آن‌ها را URL-encode کنید:
> `@` → `%40` و `:` → `%3A`.

3. تست اتصال:

```
python tools\setup_mysql.py --test
```

---

## پشتیبان‌گیری و بازیابی MySQL

**پشتیبان (فایل .sql):**

```bat
"C:\wamp64\bin\mysql\mysql8.0.36\bin\mysqldump.exe" -u faktorkhan -p --single-transaction --default-character-set=utf8mb4 faktorkhan > C:\backup\faktorkhan-%date%.sql
```

**بازیابی:**

```bat
"C:\wamp64\bin\mysql\mysql8.0.36\bin\mysql.exe" -u faktorkhan -p faktorkhan < C:\backup\faktorkhan-2026-11-07.sql
```

**پشتیبان فایل‌ها:** پوشهٔ `storage\uploads` و `storage\exports` را هم کپی کنید.
یک Scheduled Task روزانه برای این دو کار بگذارید.

---

## عیب‌یابی

| نشانه | علت | راه‌حل |
|---|---|---|
| `Can't connect to MySQL server` | MySQL خاموش است | آیکن WAMP → MySQL → Start |
| `Access denied for user 'faktorkhan'` | گذرواژهٔ `.env` با MySQL نمی‌خواند | `SETUP-MYSQL-WINDOWS.bat` را دوباره اجرا کنید |
| `Unknown collation: utf8mb4_persian_ci` | MySQL خیلی قدیمی (۵.۵) | به MySQL 8 / MariaDB 10.4 مهاجرت کنید |
| متن فارسی `????` می‌شود | پایگاه با کدگذاری اشتباه ساخته شده | پایگاه را پاک و با `00-create-db.sql` بسازید |
| `403 Invalid host header` | دامنه در `ALLOWED_HOSTS` نیست | دامنه را اضافه و برنامه را ری‌استارت کنید |
| `502 Proxy Error` | برنامهٔ پایتون بالا نیست | `START-SERVER-WINDOWS.bat` را اجرا کنید |
| خطای `pymysql` | کتابخانه نصب نیست | `python -m pip install -r backend\requirements.txt` |
| کندی بعد از چند روز | اتصال‌های باز MySQL | `DB_POOL_SIZE=10` و `pool_recycle` (پیش‌فرض) کافی است؛ MySQL را ری‌استارت کنید |

---

## ساختار داده در MySQL

- پایگاه: `faktorkhan` با `utf8mb4` و `utf8mb4_persian_ci`
- ۱۱ جدول: کاربران، فاکتورها، اقلام، کارهای OCR، پلن‌ها، اشتراک‌ها، کدهای لایسنس،
  پیام‌های پشتیبانی، تنظیمات، گزارش‌ها، دستگاه‌ها
- ساختار کامل از پیش: `deploy/mysql/schema.sql` (اختیاری)
