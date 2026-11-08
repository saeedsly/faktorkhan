# دانلود مستقیم فاکتورخوان

همهٔ لینک‌ها مستقیم و بدون ورود به حساب کار می‌کنند.

## ۱) نسخهٔ PHP برای WAMP/htdocs — سریع‌ترین راه (۳۴ کیلوبایت)

**دانلود:**
https://github.com/saeedsly/faktorkhan/raw/arena/9e0e2486-faktorkhan/downloads/faktorkhan-php-htdocs.zip

**نصب (۳۰ ثانیه):**

1. فایل زیپ را باز کنید → یک پوشهٔ `faktorkhan` با ۹ فایل
2. کل پوشه را در `C:\wamp64\www\` بگذارید (یعنی `C:\wamp64\www\faktorkhan\`)
3. `http://localhost/faktorkhan/` را در مرورگر باز کنید
4. گذرواژهٔ محلی بسازید → توکن را بچسبانید → **تست اعتبار** → فایل را آپلود کنید

اگر Apache/WAMP اذیت می‌کند: `START-PHP-SERVER.bat` را دوبار کلیک کنید؛
بدون Apache و بدون تنظیمات، سرور داخلی PHP را روی `127.0.0.1:8080` بالا می‌آورد.

> پردازش در پس‌زمینه انجام می‌شود: صفحه قفل نمی‌شود، «صفحهٔ سفید» نداریم و
> تلاش دوباره، فایل را از نو روی سرویس ابری ثبت نمی‌کند (اعتبار هدر نمی‌رود).
>
> **متن مستقیم در باکس صفحه می‌آید** — قابل ویرایش و کپی، کنارش دکمه‌های
> «دانلود متن (TXT)» و «دانلود Word». اگر فایل Word سرویس خراب باشد، برنامه
> از همان متن یک Word سالم می‌سازد.
>
> روی ویندوز ۷ هم کار می‌کند (فقط PHP 7.4+ با افزونهٔ curl).
> راهنمای کامل: [`docs/PHP-HTTPDOCKS-FA.md`](../docs/PHP-HTTPDOCKS-FA.md)

---

## ۲) نسخهٔ کامل ویندوز ۱۰/۱۱ — پایتون همراه (۳۵ مگابایت)

**دانلود:**
https://github.com/saeedsly/faktorkhan/raw/arena/9e0e2486-faktorkhan/downloads/faktorkhan-1.0.0-WINDOWS-PORTABLE.zip

**نصب:**

1. زیپ را در `C:\faktorkhan` باز کنید
2. `START-WINDOWS.bat` را دوبار کلیک کنید
3. مرورگر خودش باز می‌شود؛ ایمیل و گذرواژه در `storage\OWNER-CREDENTIALS.txt` است

---

## ۳) کد منبع کامل (۵۳۷ کیلوبایت)

**دانلود:**
https://github.com/saeedsly/faktorkhan/raw/arena/9e0e2486-faktorkhan/downloads/faktorkhan-v1.0.0.zip

**برای ویندوز ۷:** پایتون ۳.۸.۱۰ را از python.org نصب کنید (تیک *Add Python to PATH*)،
بعد این زیپ را باز کنید و `START-WINDOWS.bat` را اجرا کنید.
راهنما: [`docs/WINDOWS-7-FA.md`](../docs/WINDOWS-7-FA.md)

---

## ۴) دانلود کل مخزن (همهچیز، همیشه آخرین نسخه)

https://codeload.github.com/saeedsly/faktorkhan/zip/refs/heads/arena/9e0e2486-faktorkhan

یا از صفحهٔ مخزن: **Code → Download ZIP**
https://github.com/saeedsly/faktorkhan/tree/arena/9e0e2486-faktorkhan

---

## اگر لینک باز نشد

| مشکل | راه‌حل |
|---|---|
| لینک ۴۰۴ می‌دهد | شاخه/فایل جابه‌جا شده؛ از لینک ۴ (دانلود کل مخزن) استفاده کنید و فایل را در پوشهٔ `downloads` ببینید |
| دانلود در مرورگر ویندوز ۷ شروع نمی‌شود | کلیک راست → Save link as…، یا از Chrome/Firefox استفاده کنید |
| فایل ناقص دانلود شد | حجم `faktorkhan-1.0.0-WINDOWS-PORTABLE.zip` باید ۳۴٫۵ مگابایت باشد؛ دوباره بگیرید |
| سرعت کم | از `codeload` (لینک ۴) استفاده کنید که معمولاً سریع‌تر است |

---

## فهرست فایل‌ها

| فایل | حجم | برای |
|---|---|---|
| `faktorkhan-php-htdocs.zip` | ۵۰ KB | WAMP / XAMPP — ۱۰ فایل (ویندوز ۷ ✅) |
| `faktorkhan-1.0.0-WINDOWS-PORTABLE.zip` | ۳۴٫۵ MB | ویندوز ۱۰/۱۱ (پایتون همراه) |
| `faktorkhan-v1.0.0.zip` | ۵۵۰ KB | کد منبع (با پایتون ۳.۸ روی ویندوز ۷) |
