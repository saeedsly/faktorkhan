# استقرار روی سرور لینوکس (Ubuntu / Debian)

هدف: اجرای پایدار فاکتورخوان روی یک سرور، با دسترسی HTTPS و پایگاه داده MySQL/MariaDB.

---

## ۱. آماده‌سازی سرور

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y python3 python3-venv python3-pip nginx mariadb-server git curl
```

ساخت دیتابیس:

```bash
sudo mysql -e "CREATE DATABASE faktorkhan CHARACTER SET utf8mb4 COLLATE utf8mb4_persian_ci;
CREATE USER 'faktor'@'localhost' IDENTIFIED BY 'یک-رمز-قوی';
GRANT ALL PRIVILEGES ON faktorkhan.* TO 'faktor'@'localhost'; FLUSH PRIVILEGES;"
```

---

## ۲. نصب برنامه

```bash
sudo useradd -m -s /bin/bash faktor
sudo mkdir -p /opt/faktorkhan && sudo chown faktor:faktor /opt/faktorkhan
sudo -u faktor git clone <آدرس-مخزن> /opt/faktorkhan   # یا انتقال فایل‌ها با scp

cd /opt/faktorkhan
sudo -u faktor python3 -m venv venv
sudo -u faktor ./venv/bin/pip install -r backend/requirements.txt gunicorn
```

### فایل `.env`

```bash
sudo -u faktor cp backend/.env.example .env
sudo -u faktor nano .env
```

حداقل مقادیر لازم:

```env
SECRET_KEY=<python -c "import secrets;print(secrets.token_urlsafe(48))">
ENCRYPTION_KEY=<مقدار تصادفی دیگر>
DATABASE_URL=mysql+pymysql://faktor:رمز@127.0.0.1:3306/faktorkhan?charset=utf8mb4
CLOUD_OCR_GATEWAY=<آدرس درگاه ابری>
OWNER_NAME=سعید سالاری
OWNER_EMAIL=you@example.com
OWNER_PASSWORD=<رمز قوی>
DATA_DIR=/opt/faktorkhan/storage
HOST=127.0.0.1
PORT=8000
```

```bash
sudo chmod 600 .env
```

> `SECRET_KEY` و `ENCRYPTION_KEY` را **یک بار** بسازید و در جای امن نگه دارید.
> تغییر `ENCRYPTION_KEY` باعث از دست رفتن توکن ابری ذخیره‌شده می‌شود (فقط نیاز به ثبت دوباره دارد).

---

## ۳. سرویس systemd

```bash
sudo cp deploy/faktorkhan.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now faktorkhan
sudo systemctl status faktorkhan
```

لاگ زنده:

```bash
sudo journalctl -u faktorkhan -f
```

---

## ۴. Nginx و HTTPS

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/faktorkhan
sudo ln -s /etc/nginx/sites-available/faktorkhan /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

نکته: در `deploy/nginx.conf` مقدار `server app:8000;` مربوط به داکر است. برای نصب مستقیم،
آن را به `server 127.0.0.1:8000;` تغییر دهید.

### گواهی SSL رایگان

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d faktorkhan.example.com
```

پس از دریافت گواهی، بلوک HTTPS را در Nginx فعال کنید و درخواست‌های HTTP را به HTTPS هدایت کنید.

---

## ۵. تنظیمات پس از نصب

1. وارد شوید و **گذرواژه مالک** را تغییر دهید.
2. پنل مدیریت → سرویس ابری → **ثبت توکن** (توکن دیگر نمایش داده نمی‌شود).
3. دکمه «تست اتصال و اعتبار» را بزنید تا اعتبار سرویس ابری تأیید شود.
4. طرح‌ها را بازبینی کنید (قیمت، مدت، سهمیه) و کدهای اشتراک بسازید.
5. ثبت‌نام عمومی را در «تنظیمات» کنترل کنید (`ALLOW_REGISTRATION`).
6. یک برنامه زمان‌بندی برای پشتیبان‌گیری MySQL بگذارید:

```bash
sudo crontab -e
# هر شب ۲ بامداد
0 2 * * * mysqldump -u faktor -p'رمز' faktorkhan | gzip > /var/backups/faktorkhan-$(date +\%F).sql.gz
```

---

## ۶. به‌روزرسانی نسخه

```bash
cd /opt/faktorkhan
sudo -u faktor git pull
sudo -u faktor ./venv/bin/pip install -r backend/requirements.txt
sudo systemctl restart faktorkhan
```

جداول جدید در اولین اجرا خودکار ساخته می‌شوند (بدون حذف داده‌های قبلی).

---

## ۷. چک‌لیست امنیتی

- [ ] `.env` فقط با دسترسی ۶۰۰ و خارج از مسیر وب
- [ ] HTTPS فعال و ریدایرکت HTTP → HTTPS
- [ ] رمز مالک تغییر داده شده و فایل `OWNER-CREDENTIALS.txt` حذف شده
- [ ] `ALLOW_REGISTRATION` بر اساس سیاست شما تنظیم شده
- [ ] توکن ابری ثبت شده و در هیچ فایلی ذخیره نشده است
- [ ] پشتیبان‌گیری خودکار فعال است
- [ ] `MAX_UPLOAD_MB` و `client_max_body_size` هماهنگ هستند
- [ ] پورت ۸۰۰۰ از بیرون بسته است (فقط Nginx به آن دسترسی دارد)
