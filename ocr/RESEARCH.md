# نتایج جست‌وجوی ابزار و کد آماده (تاریخ: ۷ نوامبر ۲۰۲۶)

هدف: پیدا کردن برنامه یا کد رایگان و متن‌باز که OCR فارسی فاکتور (چاپی و دیجیتال) و دست‌نویس را بهتر کند،
و استفاده‌ی مفید از آن در فاکتورخوان.

## خلاصه

- **هیچ برنامه‌ی رایگان و آماده‌ای پیدا نشد که هم فاکتور فارسی و هم دست‌نویس فارسی را با دقت بالا بخواند.**
  پروژه‌های فارسی موجود در GitHub یا بر پایه‌ی Tesseract قدیمی‌اند، یا نمونه‌ی درسی‌اند، یا بدون مجوز مشخص‌اند.
- پشته‌ای که ساخته‌ایم (PP-OCRv5 عربی/فارسی با RapidOCR و ONNX) **همان پشته‌ای است که بهترین پروژه‌ی فارسی MIT پیدا شده هم استفاده می‌کند**.
  این تأیید انتخاب ماست.
- از تحقیق سه چیز به کد اضافه شد: نرمال‌سازی متن فارسی، تشخیص‌دهنده‌ی PP-OCRv6 (اختیاری)، و موتور VLM (Qwen3-VL) برای دست‌نویس (اختیاری).
- **هیچ‌کدام از این‌ها روی مدل واقعی و نمونه‌ی فارسی هنوز سنجیده نشده‌اند.** ارزیابی آن‌ها با `eval` روی سیستم خودتان انجام می‌شود.

## پروژه‌های بررسی‌شده

| پروژه | مجوز | وضعیت | نتیجه |
|---|---|---|---|
| [Hamed-Gharghi/Persian-OCR-App](https://github.com/Hamed-Gharghi/Persian-OCR-App) | MIT | فعال (ژوئیه ۲۰۲۶) | RapidOCR + PP-OCRv5 عربی + تشخیص PP-OCRv6. **نرمال‌سازی فارسی و فیلتر نویز** مفید است؛ **اصلاح‌های کلمه‌ای** مخصوص متن کتاب است و نیامده. ادعا می‌کند خروجی PP-OCRv5 عربی منطقی است و نباید معکوس شود؛ این با کد PaddleOCR تناقض دارد و در eval بررسی می‌شود (حالت‌های `paddle` و `raw`). |
| [reza1615/PersianOcr](https://github.com/reza1615/PersianOcr) | بدون مجوز مشخص | ۲۰۱۶ | Tesseract قدیمی؛ استفاده نشد. |
| [stafazzoli/FarsiOCR](https://github.com/stafazzoli/FarsiOCR) | بدون مجوز مشخص | ۲۰۲۶ | Tesseract 5.1 + پیش‌پردازش؛ همان محدودیت Tesseract. |
| [MohammadHNdev/Persian_OCR_Arvangram](https://github.com/MohammadHNdev/Persian_OCR_Arvangram) | بدون مجوز مشخص | نوتبوک Colab | ادعای «۹۵٪» بدون معیار؛ بدون ارزیابی مستقل. |
| [prp-e/persian_ocr_project](https://github.com/prp-e/persian_ocr_project) | GPL-3.0 | ۲۰۲۴ | پروژه‌ی تشخیص حروف با YOLO، ناقص؛ GPL برای این برنامه محدودکننده است. |
| [Erfaniaa/Persian-OCR](https://github.com/Erfaniaa/Persian-OCR) | بدون مجوز مشخص | ۲۰۱۰ | پروژه‌ی درسی دلفی؛ استفاده نشد. |
| [sadafnazari/Persian_handwriting_recognition](https://github.com/sadafnazari/Persian_handwriting_recognition) | بدون مجوز مشخص | درسی | تشخیص حروف دست‌نویس با CNN روی فرم دانشجویی؛ دقت و داده‌ی کافی ندارد. |

## مدل‌ها و ابزارهای مهم

| مدل | مجوز | نکته‌ی مرتبط با ما | تصمیم |
|---|---|---|---|
| **PP-OCRv5 عربی** (`arabic_PP-OCRv5_mobile_rec`) | Apache-2.0 | فارسی را پوشش می‌دهد (`پ چ ژ ک گ` و ارقام). | **در کد است** (موتور اصلی). |
| **PP-OCRv6** (PaddleOCR 3.7، ۱۱ ژوئن ۲۰۲۶) | Apache-2.0 | ادعای +۵٪ نسبت به v5 در تشخیص و بازشناسی. **۵۰ زبان؛ فارسی جزو آن‌ها نیست.** | **تشخیص‌دهنده‌ی v6 به‌عنوان گزینه اضافه شد** (`--det-version v6`). بازشناسی همچنان v5 عربی است. |
| **RapidOCR 3.10.0** | Apache-2.0 | ارتقا از 3.4.5؛ پارامترهای ما سازگارند. | **نسخه‌ی سرور به 3.10.0 ارتقا یافت.** |
| **Qwen3-VL-8B / 4B** (Alibaba) | Apache-2.0 | GGUF رسمی برای llama.cpp، اجرا روی CPU؛ ادعای OCR در ۳۲ زبان (عربی و عبری صریح؛ **فارسی صریح نیامد**). | **موتور VLM اختیاری** برای دست‌نویس (از طریق llama-server). کند است؛ کیفیت فارسی باید سنجیده شود. |
| **Surya OCR 2** (Datalab) | کد: Apache-2.0؛ **وزن‌ها: OpenRAIL-M** (برای استفاده‌ی شخصی/تحقیق/استارتاپ زیر ۵ میلیون دلار رایگان) | ادعای ۸۲٫۳٪ برای فارسی در بنچمارک داخلی Datalab و بهبود دست‌نویس؛ CPU؛ 650M پارامتر. | **هنوز اضافه نشده.** کاندید خوب بعدی؛ ابتدا ارزیابی مستقل روی نمونه‌ی شما، و توجه به محدودیت مجوز وزن‌ها. |
| **Chandra OCR 2** (Datalab، ۴B) | — | ادعای ۷۵٫۱٪ برای فارسی؛ مجوز وزن‌ها مشابه Surya. | کاندید دوم؛ فعلاً اضافه نشد. |
| Baseer / QARI-OCR | مجوز تجاری یا نامشخص | عربی؛ دست‌نویس عربی. | مرتبط با عربی؛ فعلاً استفاده نشد. |

## موارد اضافه‌شده به کد (این تحقیق)

1. `server/textnorm.py`: یکسان‌سازی حروف فارسی (ي→ی، ك→ک، ة→ه، ...) و ارقام عربی‌هندی به فارسی. منبع: Persian-OCR-App (MIT)، با ذکر منبع در فایل.
2. `server/engine.py`: گزینه‌ی `det_version`. پیش‌فرض همان v5 است (کار می‌کند)، و v6 با پیش‌پردازش پیش‌فرض RapidOCR برای v6 اجرا می‌شود.
3. `scripts/download_models.py --det-v6 small|medium`: دانلود تشخیص‌دهنده‌ی v6 از ModelScope با بررسی SHA256.
4. `server/vlm.py`: کلاینت HTTP برای llama-server (API سازگار با OpenAI). سرور با `--vlm-url` فعال می‌شود.
5. `/api/ocr?engine=rapid|vlm`: انتخاب موتور در API و رابط. گزینه‌ی VLM فقط وقتی نشان داده می‌شود که llama-server در دسترس باشد.

## آنچه هنوز سنجیده نشده (باید روی سیستم شما انجام شود)

- تشخیص v6 در مقابل v5 روی فاکتورهای ساختگی و واقعی (`--det-version v6` و `eval`).
- معکوس‌سازی: آیا خروجی `paddle` یا `raw` برای ارقام درست است (ادعای متضاد Persian-OCR-App).
- Qwen3-VL روی دست‌نویس فارسی (سرعت و دقت روی CPU).
- Surya OCR 2 روی همان نمونه‌ها (اگر نتیجه‌ی Qwen ضعیف بود).

## منابع

- Persian-OCR-App، `ocr_utils.py` و `requirements.txt`، MIT: https://github.com/Hamed-Gharghi/Persian-OCR-App
- PaddleOCR 3.7 و PP-OCRv6 (۱۱ ژوئن ۲۰۲۶): https://paddlepaddle.github.io/PaddleOCR/main/en/index.html و https://paddleocr.dev/
- RapidOCR 3.10.0 (PyPI) و `default_models.yaml` آن (نشانی‌ها و SHA256 مدل‌های v6 و v5 عربی)
- Qwen3-VL OCR و ۳۲ زبان: https://qwenlm-qwen3-vl.mintlify.app/capabilities/ocr ؛ GGUF: https://huggingface.co/Qwen/Qwen3-VL-8B-Instruct-GGUF (نشانی مرجع، از نتایج جست‌وجو)
- Surya OCR 2 (وبلاگ Datalab، ۲۷ مه ۲۰۲۶): https://www.datalab.to/blog/surya-2 ؛ کد Surya: Apache-2.0 (PyPI `surya-ocr` 0.23.0)
- Chandra OCR 2 (وبلاگ Datalab، ۱۸ مارس ۲۰۲۶): https://www.datalab.to/blog/chandra-2
- کانفیگ PP-OCRv5 تشخیص و بازشناسی عربی از مخزن PaddleOCR (مقادیر میانگین/انحراف و ابعاد)
