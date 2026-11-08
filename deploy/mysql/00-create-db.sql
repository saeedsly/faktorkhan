-- ════════════════════════════════════════════════════════════════
--  فاکتورخوان — ساخت پایگاه داده و کاربر (MySQL / MariaDB)
--  اثر: سعید سالاری
--
--  روش ۱ (پیشنهادی): فایل SETUP-MYSQL-WINDOWS.bat را اجرا کنید.
--  روش ۲ (دستی): این متن را در phpMyAdmin → زبانه SQL بچسبانید
--          و گذرواژه واقعی را جای MyStrongPass! بگذارید.
-- ════════════════════════════════════════════════════════════════

SET NAMES utf8mb4;

-- ۱) پایگاه داده با کدگذاری چهاربایتی و ترتیب فارسی
CREATE DATABASE IF NOT EXISTS `faktorkhan`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_persian_ci;

-- ۲) کاربر اختصاصی برنامه (فقط به همین پایگاه داده دسترسی دارد)
CREATE USER IF NOT EXISTS 'faktorkhan'@'localhost' IDENTIFIED BY 'MyStrongPass!';
CREATE USER IF NOT EXISTS 'faktorkhan'@'127.0.0.1' IDENTIFIED BY 'MyStrongPass!';

-- اگر نسخه MySQL قدیمی است و خطای syntax داد، این دو خط را جدا اجرا کنید:
-- GRANT ALL PRIVILEGES ON `faktorkhan`.* TO 'faktorkhan'@'localhost' IDENTIFIED BY 'MyStrongPass!';
-- GRANT ALL PRIVILEGES ON `faktorkhan`.* TO 'faktorkhan'@'127.0.0.1' IDENTIFIED BY 'MyStrongPass!';

GRANT ALL PRIVILEGES ON `faktorkhan`.* TO 'faktorkhan'@'localhost';
GRANT ALL PRIVILEGES ON `faktorkhan`.* TO 'faktorkhan'@'127.0.0.1';
FLUSH PRIVILEGES;

-- ۳) بررسی
SELECT VERSION() AS mysql_version;
SHOW CREATE DATABASE `faktorkhan`;

-- نکته: جداول را خود برنامه در اولین اجرا می‌سازد.
-- اگر می‌خواهید از قبل بسازید، فایل schema.sql را در همین پایگاه اجرا کنید.
