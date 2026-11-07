# مرجع API — فاکتورخوان

- پایه: `/api`
- احراز هویت: هدر `Authorization: Bearer <token>` (یا کوکی `fk_token`)
- قالب: JSON با کدگذاری UTF-8
- مستندات تعاملی: `/api/docs`

## کدهای خطای رایج

| کد | معنا |
|---|---|
| 401 | نشست نامعتبر یا منقضی |
| 402 | اشتراک منقضی یا سهمیه تمام‌شده |
| 403 | دسترسی نقش کافی نیست |
| 404 | منبع یافت نشد |
| 409 | تعارض (ایمیل تکراری، کد مصرف‌شده، پردازش ناتمام) |
| 413 | حجم فایل بیش از حد |
| 429 | محدودیت نرخ یا حساب قفل‌شده |

---

## احراز هویت و حساب

| متد | مسیر | توضیح |
|---|---|---|
| POST | `/auth/register` | ثبت‌نام + دوره آزمایشی (+ کد اشتراک اختیاری) |
| POST | `/auth/login` | ورود؛ خروجی: `access_token`, `user`, `subscription` |
| GET | `/auth/me` | کاربر جاری، اشتراک و مجوزها |
| PATCH | `/auth/profile` | ویرایش نام، شرکت، موبایل، تم |
| POST | `/auth/change-password` | تغییر گذرواژه |
| POST | `/auth/logout` | ثبت رویداد خروج |
| GET | `/auth/devices` | فهرست دستگاه‌های فعال |
| DELETE | `/auth/devices/{device_id}` | حذف دستگاه |

نمونه ورود:

```bash
curl -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"owner@example.com","password":"******","device_id":"DV-LAPTOP"}'
```

---

## فاکتورها

| متد | مسیر | توضیح |
|---|---|---|
| GET | `/invoices` | فهرست با فیلتر: `q`, `status`, `type`, `direction`, `source`, `date_from`, `date_to`, `tag`, `page`, `per_page`, `sort`, `order` |
| GET | `/invoices/stats` | آمار داشبورد و گزارش‌ها |
| POST | `/invoices` | ثبت فاکتور (با اقلام) |
| GET | `/invoices/{id}` | جزئیات + اقلام + متن OCR |
| PUT | `/invoices/{id}` | ویرایش |
| DELETE | `/invoices/{id}` | حذف |
| POST | `/invoices/bulk` | عملیات گروهی: `delete`, `draft`, `review`, `confirmed`, `archived`, `tag` |
| GET | `/invoices/export?format=xlsx\|csv\|json` | خروجی (با `ids` یا `status`) |
| POST | `/invoices/parse` | تحلیل متن دلخواه (`{"text": "..."}`) |
| GET | `/invoices/{id}/file` | فایل اصلی |
| GET | `/invoices/{id}/print` | داده نسخه چاپی |

نمونه ثبت:

```json
POST /api/invoices
{
  "number": "1404-042",
  "issue_date": "1404/08/12",
  "invoice_type": "printed",
  "direction": "purchase",
  "seller_name": "فروشگاه آفتاب",
  "buyer_name": "شرکت پارس",
  "subtotal": 34800000,
  "tax": 3480000,
  "discount": 300000,
  "total": 37980000,
  "status": "confirmed",
  "items": [
    {"description": "کاغذ A4", "qty": 12, "unit_price": 1850000, "total": 22200000}
  ]
}
```

---

## خوانش (OCR)

| متد | مسیر | توضیح |
|---|---|---|
| GET | `/ocr/capabilities` | وضعیت موتورها، زبان‌ها، روش‌ها، محدودیت حجم |
| POST | `/ocr/upload` | `multipart/form-data`: `file`, `provider` (`cloud`/`local`), `method` ۱..۴, `output`, `language`, `invoice_type`, `delete_after` |
| POST | `/ocr/link` | خوانش از لینک مستقیم (فقط ابری) |
| GET | `/ocr/jobs?limit=15` | فهرست کارهای پردازش |
| GET | `/ocr/jobs/{id}?with_text=true` | وضعیت، پیشرفت، متن و `parsed` |
| POST | `/ocr/jobs/{id}/retry` | تلاش مجدد |
| POST | `/ocr/jobs/{id}/cancel` | لغو |
| DELETE | `/ocr/jobs/{id}` | حذف کار و فایل‌ها |
| GET | `/ocr/jobs/{id}/result` | فایل خروجی تبدیل |
| POST | `/ocr/jobs/{id}/to-invoice` | تبدیل خروجی به فاکتور (بدنه اختیاری برای بازنویسی فیلدها) |
| GET | `/ocr/credit` | اعتبار سرویس ابری |

پاسخ `parsed`:

```json
{
  "number": "88214", "issue_date": "1404/08/05",
  "seller_name": "شرکت پخش البرز", "buyer_name": "سوپرمارکت یاس",
  "subtotal": 27000000, "tax": 2700000, "discount": 0, "total": 29700000,
  "items": [{"description": "روغن ۵ لیتری", "qty": 8, "unit_price": 2450000, "total": 19600000}],
  "confidence": 100, "fields_found": ["number","seller","total","tax","items"], "warnings": []
}
```

قالب‌های خروجی: `txtrawjson` (پیشنهادی)، `txtraw`، `txt`، `jsoncoordinates`، `keeplayout`.

---

## اشتراک

| متد | مسیر | توضیح |
|---|---|---|
| GET | `/billing/plans` | طرح‌های فعال |
| GET | `/billing/subscription` | اشتراک جاری با جزئیات |
| POST | `/billing/redeem` | فعال‌سازی `{"key":"FK-..."}` |
| GET | `/billing/usage` | مصرف صفحات، روزهای باقی‌مانده، وضعیت پشتیبانی |
| GET | `/billing/check-key/{key}` | اعتبارسنجی کد بدون مصرف |

---

## سامانه

| متد | مسیر | توضیح |
|---|---|---|
| GET | `/system/meta` | نام، نسخه، معرفی پدیدآورنده، متن حق معنوی، FAQ، اطلاعیه |
| GET | `/system/features` | فهرست کامل قابلیت‌ها (گروه‌بندی‌شده) |
| GET | `/system/health` | سلامت پایگاه داده و سرویس ابری |
| GET | `/system/announcement` | پیام اطلاعیه |
| POST | `/system/support` | ثبت پیام پشتیبانی |

---

## مدیریت (نقش `admin` / `owner`)

| متد | مسیر | توضیح |
|---|---|---|
| GET | `/admin/overview` | آمار کلان، درآمد ثبت‌شده، رویدادهای اخیر |
| GET | `/admin/users` | فهرست کاربران با اشتراک |
| PATCH | `/admin/users/{id}` | فعال/غیرفعال، نقش، طرح، تمدید روز، تغییر سهمیه |
| POST | `/admin/users/{id}/reset-password` | رمز موقت یک‌بارمصرف |
| DELETE | `/admin/users/{id}` | حذف کاربر (فقط مالک) |
| GET/POST/PUT/DELETE | `/admin/plans[/{id}]` | مدیریت طرح‌ها |
| GET | `/admin/keys` | فهرست کدها با فیلتر |
| POST | `/admin/keys/batch` | ساخت انبوه `{plan_id, count, note}` |
| POST | `/admin/keys/{id}/revoke` | ابطال کد |
| DELETE | `/admin/keys/{id}` | حذف کد |
| GET | `/admin/cloud` | وضعیت توکن (مخفی، بدون مقدار) |
| POST | `/admin/cloud/token` | ثبت/جایگزینی توکن (فقط نوشتن) |
| DELETE | `/admin/cloud/token` | حذف توکن |
| POST | `/admin/cloud/test` | تست اتصال و اعتبار |
| GET | `/admin/settings` | تنظیمات عمومی |
| PUT | `/admin/settings` | ذخیره تنظیمات |
| GET | `/admin/audit` | گزارش رویدادها |
| GET | `/admin/support` | پیام‌های پشتیبانی |
| POST | `/admin/support/{id}/answer` | پاسخ به پیام |
| GET | `/admin/health` | سلامت پایگاه داده، ابر، نسخه |
| GET | `/admin/backup` | پشتیبان JSON (فقط مالک) |

---

## نمونه اسکریپت پایتون

```python
import httpx

BASE = "http://localhost:8000/api"

with httpx.Client(base_url=BASE, timeout=120) as c:
    token = c.post("/auth/login", json={"email": "owner@example.com", "password": "******"}).json()["access_token"]
    c.headers["Authorization"] = f"Bearer {token}"

    # خوانش فاکتور با موتور ابری
    with open("invoice.pdf", "rb") as fh:
        job = c.post("/ocr/upload",
                     files={"file": ("invoice.pdf", fh, "application/pdf")},
                     data={"provider": "cloud", "method": "4",
                           "output": "txtrawjson", "invoice_type": "printed"}).json()["job"]

    import time
    while True:
        data = c.get(f"/ocr/jobs/{job['id']}").json()["job"]
        if data["status"] in ("done", "failed"):
            break
        time.sleep(2)

    print(data["parsed"]["number"], data["parsed"]["total"])

    # ثبت فاکتور
    invoice = c.post(f"/ocr/jobs/{job['id']}/to-invoice", json={}).json()["invoice"]
    print("ثبت شد:", invoice["id"])

    # خروجی اکسل
    with open("invoices.xlsx", "wb") as fh:
        fh.write(c.get("/invoices/export?format=xlsx").content)
```
