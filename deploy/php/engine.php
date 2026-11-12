<?php
/**
 * موتور پاکسازی و ساختاردهی متن فاکتور — سمت PHP، بدون هیچ وابستگی.
 *
 * این فایل «مغز» است: متن خامی که از سرویس ابری (یا هوش مصنوعی) می‌آید
 * را تمیز، یکدست و ستون‌بندی می‌کند تا خروجی قابل استفاده باشد.
 *
 * همهٔ توابع خالص‌اند (بدون I/O) تا در php-wasm هم تست شوند.
 */

if (!function_exists('fk_engine_version')) {

    function fk_engine_version(): string
    {
        return '2.0';
    }

    /* ═══════════════ ۰. سازگاری: اگر mbstring نصب نباشد ═══════════════
       ویندوز/ WAMP اغلب mbstring ندارد؛ php-wasm هم ندارد.
       پس همهٔ کارهای چندبایتی از مسیر preg (که UTF-8 را می‌فهمد) انجام می‌شود. */

    function fk_len(string $s): int
    {
        if (function_exists('mb_strlen')) return (int) mb_strlen($s, 'UTF-8');
        return (int) preg_match_all('/./us', $s, $m);
    }

    function fk_sub(string $s, int $start, ?int $len = null): string
    {
        if (function_exists('mb_substr')) return (string) mb_substr($s, $start, $len, 'UTF-8');
        preg_match_all('/./us', $s, $m);
        $chars = $m[0];
        return implode('', array_slice($chars, $start, $len));
    }

    function fk_lower(string $s): string
    {
        if (function_exists('mb_strtolower')) return (string) mb_strtolower($s, 'UTF-8');
        // حروف لاتین
        $s = strtolower($s);
        // حروف بزرگ عربی/فارسی
        return strtr($s, array('أ' => 'ا', 'إ' => 'ا', 'آ' => 'ا'));
    }

    function fk_pos(string $haystack, string $needle)
    {
        if (function_exists('mb_strpos')) {
            $r = mb_strpos($haystack, $needle, 0, 'UTF-8');
            return $r === false ? false : (int) $r;
        }
        // جست‌وجوی بایت‌محور امن است چون UTF-8 خودترمیم است
        $r = strpos($haystack, $needle);
        return $r;
    }

    /* ═══════════════ ۱. یکدست‌سازی نویسه‌ها ═══════════════ */

    /** جدول نویسه‌های عربی → فارسی (ک/ی/ه و همزه‌ها). */
    function fk_char_map(): array
    {
        return array(
            "\xD9\x8A" => "\xDB\x8C",  // ي → ی
            "\xD9\x89" => "\xDB\x8C",  // ى → ی
            "\xD9\x83" => "\xDA\xA9",  // ك → ک
            "\xD8\xA9" => "\xD9\x87",  // ة → ه
            "\xD9\x93" => "\xD9\x87",  // ۀ → ه
            "\xD8\xA3" => "\xD8\xA7",  // أ → ا
            "\xD8\xA5" => "\xD8\xA7",  // إ → ا
            "\xD8\xA4" => "\xD9\x88",  // ؤ → و
            "\xD9\x91" => "",          // ّ
            "\xD9\x8E" => "",          // َ
            "\xD9\x8F" => "",          // ُ
            "\xD9\x90" => "",          // ِ
            "\xD9\x92" => "",          // ْ
            "\xD9\x94" => "",          // ٔ
            "\xD9\x95" => "",          // ٕ
        );
    }

    /** ارقام عربی/فارسی → لاتین، با حفظ ساختار متن. */
    function fk_digits_latin(string $s): string
    {
        $map = array(
            '۰' => '0', '۱' => '1', '۲' => '2', '۳' => '3', '۴' => '4',
            '۵' => '5', '۶' => '6', '۷' => '7', '۸' => '8', '۹' => '9',
            '٠' => '0', '١' => '1', '٢' => '2', '٣' => '3', '٤' => '4',
            '٥' => '5', '٦' => '6', '٧' => '7', '٨' => '8', '٩' => '9',
        );
        return strtr($s, $map);
    }

    /** نویسه‌های کنترلی و نامرئی (ZWJ، RLM، BOM، NUL…) را حذف می‌کند. */
    function fk_strip_invisible(string $s): string
    {
        $bad = array(
            "\xEF\xBB\xBF" => "",      // BOM
            "\xE2\x80\x8F" => "",      // RLM
            "\xE2\x80\x8E" => "",      // LRM
            "\xE2\x80\x8C" => "",      // ZWNJ — عمداً نگه داشته می‌شود؟ نه، موقتاً حذف
            "\xE2\x80\x8B" => "",      // ZWSP
            "\x00" => "",
            "\x0B" => "\n",
            "\x0C" => "\n",
            "\r\n" => "\n",
            "\r" => "\n",
        );
        return strtr($s, $bad);
    }

    /**
     * یکدست‌سازی کامل نویسه‌ای.
     * ZWNJ داخل کلمه (مثل «می‌شود») حفظ می‌شود چون معنی را عوض می‌کند.
     */
    function fk_norm_chars(string $s): string
    {
        if ($s === '') return '';
        $s = fk_strip_invisible($s);
        $s = strtr($s, fk_char_map());
        $s = fk_digits_latin($s);
        // نیم‌فاصله‌های تکراری و فاصله‌های عجیب
        $s = str_replace("\xC2\xA0", ' ', $s);   // NBSP
        $s = str_replace("\xE2\x80\x89", ' ', $s); // thin space
        $s = preg_replace('/[ \t]{2,}/', "\t", $s);
        return $s;
    }

    /* ═══════════════ ۲. یکسان‌سازی قالب اعداد ═══════════════ */

    /**
     * «۱٬۲۵۰٬۰۰۰ ریال» → 1250000
     * جداکننده‌های فارسی/عربی/کاما/نقطه/فاصله همه پشتیبانی می‌شوند.
     */
    function fk_parse_amount(string $raw): int
    {
        $s = fk_digits_latin(trim($raw));
        if ($s === '') return 0;
        // جداکننده هزارگان فارسی و عربی
        $s = str_replace(array('٬', '،', ' ', "\t", "\xC2\xA0"), '', $s);
        $s = str_replace('٫', '.', $s);
        // پرانتز = منفی حسابداری
        $neg = false;
        if (preg_match('/^\((.*)\)$/', $s, $m)) { $neg = true; $s = $m[1]; }
        if (preg_match('/^-/', $s)) { $neg = true; $s = ltrim($s, '-'); }
        $s = preg_replace('/[^\d.]/', '', $s);
        if ($s === '') return 0;
        // «1.250.000» → نقطه جداکننده است
        if (substr_count($s, '.') > 1) $s = str_replace('.', '', $s);
        $f = (float) $s;
        return $neg ? -(int) round($f) : (int) round($f);
    }

    /** عدد را با جداکنندهٔ فارسی و ایمن برمی‌گرداند. */
    function fk_fmt_amount($n, bool $withSep = true): string
    {
        $n = (int) $n;
        $s = number_format(abs($n), 0, '.', $withSep ? ',' : '');
        return ($n < 0 ? '-' : '') . $s;
    }

    /** عدد را با ارقام فارسی برمی‌گرداند (برای شمارنده‌های رابط) */
    function fk_fa_num($n): string
    {
        $fa = array('۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹');
        return str_replace(range(0, 9), $fa, (string) $n);
    }

    /**
     * تاریخ شمسی خوانا از زمان یونیکس — بدون هیچ کتابخانهٔ خارجی.
     *
     * چرا دستی؟ چون افزونهٔ intl روی WAMP معمولاً نصب نیست و کاربر هم
     * نمی‌تواند نصب کند. الگوریتم تبدیل میلادی به شمسی استاندارد و
     * کوتاه است و برای سال‌های ۱۹۰۰ تا ۲۱۰۰ دقیق.
     *
     * خروجی: «۱۴۰۴/۰۹/۱۶ ساعت ۱۴:۳۰» یا رشتهٔ خالی اگر ورودی نامعتبر
     * باشد. ارقام فارسی‌اند تا با بقیهٔ رابط هم‌خوان باشند.
     */
    function fk_fa_date($ts, bool $withTime = true): string
    {
        $ts = (int) $ts;
        if ($ts <= 0) {
            return '';
        }
        list($gy, $gm, $gd) = array_map('intval', explode('-', date('Y-n-j', $ts)));
        $hh = date('H', $ts);
        $ii = date('i', $ts);

        /* میلادی → شمسی (الگوریتم khayyam) */
        $gDaysInMonth = array(31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31);
        $jDaysInMonth = array(31, 31, 31, 31, 31, 31, 30, 30, 30, 30, 30, 29);
        /* روزِ سالِ میلادی (۱ ژانویه = ۱) */
        $gyDay = 0;
        for ($i = 0; $i < $gm - 1; $i++) {
            $gyDay += $gDaysInMonth[$i];
        }
        $gyDay += $gd;                       /* ۱ تا ۳۶۵/۳۶۶ */

        /* فرمول استاندارد: روزهای گذشته از مبدأ شمسی */
        $gy2 = ($gm > 2) ? ($gy + 1) : $gy;
        $days = 355666 + (365 * $gy) + (int) (($gy2 + 3) / 4)
            - (int) (($gy2 + 99) / 100) + (int) (($gy2 + 399) / 400) + $gyDay;
        $jy = -1595 + (33 * (int) ($days / 12053));
        $days %= 12053;
        $jy += 4 * (int) ($days / 1461);
        $days %= 1461;
        if ($days > 365) {
            $jy += (int) (($days - 1) / 365);
            $days = ($days - 1) % 365;
        }
        $jm = 1;
        for ($i = 0; $i < 12 && $days >= $jDaysInMonth[$i]; $i++) {
            $days -= $jDaysInMonth[$i];
            $jm = $i + 2;
        }
        if ($jm > 12) {
            $jm = 12;
            $days = 29;
        }
        $jd = $days + 1;

        $out = sprintf('%04d/%02d/%02d', $jy, $jm, $jd);
        if ($withTime) {
            $out .= sprintf(' ساعت %02d:%02d', (int) $hh, (int) $ii);
        }
        /* ارقام فارسی */
        $fa = array('۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹');
        return str_replace(range(0, 9), $fa, $out);
    }

    /**
     * ستون‌های قیمتی را در سراسر متن یکدست می‌کند:
     * «4,500,000» و «۴٬۵۰۰٬۰۰۰» و «4500000» همه به یک شکل درمی‌آیند.
     */
    function fk_canonical_numbers(string $text): string
    {
        return preg_replace_callback('/[\d۰-۹٠-٩][\d۰-۹٠-٩,٬٫،.\s]{2,}\d|[\d۰-۹٠-٩]{4,}/', function ($m) {
            $digits = fk_digits_latin($m[0]);
            $clean = preg_replace('/[^\d]/', '', $digits);
            if ($clean === '' || strlen($clean) < 4) return $m[0];
            return fk_fmt_amount((int) substr($clean, 0, 15));
        }, $text);
    }
}

if (!function_exists('fk_split_columns')) {

    /* ═══════════════ ۳. بازسازی ستون‌ها ═══════════════ */

    /**
     * یک سطر را به سلول می‌شکند. سه روش، به ترتیب اولویت:
     *   ۱) Tab (سرویس‌های OCR معمولاً Tab می‌دهند)
     *   ۲) دو فاصله یا بیشتر (فاکتور چاپی یکدست‌شده)
     *   ۳) | و ؛ و ، به‌عنوان جداکننده دستی
     */
    function fk_split_columns(string $line): array
    {
        $line = rtrim($line);
        if ($line === '') return array();
        if (strpos($line, "\t") !== false) {
            return array_map('trim', explode("\t", $line));
        }
        /*
         * جداکننده‌ها: تب، دو فاصله یا بیشتر، «|»، «؛» و — مهم‌تر از همه
         * برای فاکتور فارسی — خط تیره‌های جداکنندهٔ ستون:
         *     «کاغذ A4 — ۱۰ بسته — ۲۵۰,۰۰۰»
         * نسخهٔ قبلی خط تیره را جداکننده نمی‌دانست، پس کل سطر یک سلول
         * می‌شد و موتور هیچ عددی پیدا نمی‌کرد: فاکتور «آماده» می‌شد ولی
         * جدول اقلام خالی بود. این همان «اقلام را تشخیص نمی‌دهد» است.
         *
         * نکته: خط تیره فقط وقتی جداکننده است که «فاصله‌دار» باشد،
         * وگرنه «A4-2024» را هم می‌شکند.
         */
        $parts = preg_split('/\s{2,}|\s*\|\s*|\s*;\s*|\s+[—–-]+\s+|\s*[│¦]\s*/u', $line);
        $parts = array_map('trim', $parts ?: array());
        $parts = array_values(array_filter($parts, function ($p) { return $p !== ''; }));
        return $parts ?: array($line);
    }

    /** آیا سلول فقط عدد است (با جداکننده، درصد، یا واحد پول)؟ */
    function fk_is_number(string $cell): bool
    {
        $c = trim(fk_digits_latin($cell));
        if ($c === '') return false;
        $c = preg_replace('/\s*(ریال|تومان|درصد|%|ت)?\s*$/u', '', $c);
        return (bool) preg_match('/^[\-\(]?[\d,٬٫.]+\)?$/', $c);
    }

    /**
     * آیا سلول «عدد + واحد» است؟ مثل «۱۰ بسته» یا «2 عدد».
     *
     * چرا جدا از fk_is_number: در فاکتور فارسی ستون تعداد معمولاً واحد
     * دارد («۱۰ بسته»، «۲ عدد»، «۵ کارتن»). fk_is_number این را عدد
     * نمی‌داند، پس تعداد ۱ فرض می‌شد و قیمت واحد اشتباه محاسبه می‌شد —
     * «کاغذ A4 × ۱ = ۲۵۰,۰۰۰» به‌جای «× ۱۰».
     */
    function fk_number_and_unit(string $cell): array
    {
        $c = trim(fk_digits_latin($cell));
        if ($c === '') return array(0, '');
        if (!preg_match('/^([\-+]?[\d,٬٫.]+)\s*([^\d]{0,12})$/u', $c, $m)) {
            return array(0, '');
        }
        $amount = fk_parse_amount($m[1]);
        $unit = trim($m[2]);
        $unit = (string) preg_replace('/\s*(ریال|تومان|درصد|%)$/u', '', $unit);
        return array($amount, $unit);
    }

    /** آیا سلول شبیه تاریخ است؟ (۱۳۹۹/۰۵/۲۱ یا 2021-05-12) */
    function fk_is_date(string $cell): bool
    {
        $c = fk_digits_latin(trim($cell));
        return (bool) preg_match('/^(\d{2,4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/', $c);
    }

    /** آیا سلول شبیه واحد است؟ */
    function fk_is_unit(string $cell): bool
    {
        $c = trim($cell);
        $units = array('عدد', 'کیلو', 'کیلوگرم', 'گرم', 'متر', 'مترمربع', 'مترمکعب',
            'لیتر', 'بسته', 'کارتن', 'دستگاه', 'حلقه', 'برگ', 'ورق', 'شیت', 'جلد',
            'قلم', 'سری', 'جعبه', 'کیسه', 'تن', 'گرم', 'pcs', 'kg', 'g', 'm', 'm2',
            'l', 'box', 'set', 'pc');
        return in_array(fk_lower($c), $units, true);
    }

    /**
     * نوع هر ستون را از روی چند سطر نمونه حدس می‌زند.
     * خروجی: آرایه‌ای به طول تعداد ستون‌ها با مقادیر text|number|date|unit|unknown
     */
    function fk_guess_column_types(array $rows): array
    {
        $count = 0;
        foreach ($rows as $r) {
            $count = max($count, count($r));
        }
        if ($count === 0) return array();
        $types = array_fill(0, $count, array('text' => 0, 'number' => 0, 'date' => 0, 'unit' => 0, 'n' => 0));
        foreach ($rows as $r) {
            foreach ($r as $i => $cell) {
                if (!isset($types[$i])) continue;
                $types[$i]['n']++;
                if (fk_is_date($cell)) $types[$i]['date']++;
                elseif (fk_is_unit($cell)) $types[$i]['unit']++;
                elseif (fk_is_number($cell)) $types[$i]['number']++;
                else $types[$i]['text']++;
            }
        }
        $out = array();
        foreach ($types as $i => $t) {
            if ($t['n'] === 0) { $out[$i] = 'unknown'; continue; }
            $max = 0; $label = 'unknown';
            foreach (array('date', 'number', 'unit', 'text') as $k) {
                if ($t[$k] > $max) { $max = $t[$k]; $label = $k; }
            }
            $out[$i] = $label;
        }
        return $out;
    }

    /**
     * سطرهای سرستون را تشخیص می‌دهد و نقشهٔ «نام ستون → شمارهٔ ستون» می‌سازد.
     * خروجی: array('map' => array('desc'=>1,'qty'=>2,...), 'header'=>array(...))
     */
    function fk_header_map(array $rows): array
    {
        $labels = array(
            'qty'      => array('تعداد', 'مقدار', 'تعداد کل', 'qty', 'quantity', 'count'),
            'price'    => array('قیمت واحد', 'مبلغ واحد', 'قیمت', 'نرخ', 'unit price', 'price', 'rate'),
            'total'    => array('مبلغ کل', 'مبلغ', 'جمع', 'بهای کل', 'total', 'amount', 'sum'),
            'discount' => array('تخفیف', 'تخفيف', 'discount', 'off'),
            'tax'      => array('مالیات', 'عوارض', 'ارزش افزوده', 'vat', 'tax'),
            'unit'     => array('واحد', 'unit', 'uom'),
            'code'     => array('کد کالا', 'کد', 'شناسه', 'بارکد', 'code', 'sku', 'barcode'),
            'desc'     => array('شرح کالا', 'شرح', 'نام کالا', 'تشریح', 'کالا/خدمت', 'عنوان',
                                'description', 'item', 'product', 'particulars'),
            'row'      => array('ردیف', 'شماره', 'row', 'no', '#'),
        );
        $map = array();
        $headerRow = array();
        $headerIndex = -1;

        foreach ($rows as $ri => $cells) {
            $hits = array();
            foreach ($cells as $ci => $cell) {
                $low = fk_lower(trim($cell));
                if ($low === '') continue;
                foreach ($labels as $key => $words) {
                    if (isset($map[$key])) continue;
                    foreach ($words as $w) {
                        if ($low === $w || fk_pos($low, $w) === 0) {
                            if (!isset($hits[$key])) { $hits[$key] = $ci; }
                            break;
                        }
                    }
                }
            }
            if (count($hits) >= 2) {
                $map = $hits;
                $headerRow = $cells;
                $headerIndex = $ri;
                break;
            }
        }
        return array('map' => $map, 'header' => $headerRow, 'index' => $headerIndex);
    }

    /**
     * سطرهای جمع/مالیات/امضا را از سطرهای کالا جدا می‌کند.
     * خروجی: array('items' => [...], 'totals' => [...])
     */
    function fk_split_totals(array $rows): array
    {
        /*
         * ترتیب مهم است: برچسب‌های بلندتر و دقیق‌تر اول می‌آیند تا
         * «جمع کل» با «جمع» و «مبلغ کل» با «مبلغ» قاطی نشود.
         * قرارداد فارسی: «جمع کل» = جمع اقلام (بدون مالیات)،
         * «مبلغ نهایی / قابل پرداخت» = مبلغ نهایی فاکتور.
         */
        $totalKeys = array(
            // نهایی
            'قابل پرداخت' => 'total', 'مبلغ قابل پرداخت' => 'total',
            'مبلغ نهایی' => 'total', 'بهای نهایی' => 'total', 'جمع نهایی' => 'total',
            'grand total' => 'total', 'amount due' => 'total', 'net payable' => 'total',
            // مالیات و تخفیف
            'مالیات بر ارزش افزوده' => 'tax', 'ارزش افزوده' => 'tax',
            'مالیات' => 'tax', 'عوارض' => 'tax', 'vat' => 'tax', 'tax' => 'tax',
            'تخفیف' => 'discount', 'discount' => 'discount',
            // جمع اقلام
            'جمع اقلام' => 'subtotal', 'جمع مبلغ کالا' => 'subtotal',
            'جمع کل کالا' => 'subtotal', 'جمع کل' => 'subtotal',
            'جمع مبلغ' => 'subtotal', 'subtotal' => 'subtotal', 'sub total' => 'subtotal',
            'جمع' => 'subtotal',
            // پرداخت
            'پرداخت شده' => 'paid', 'پیش‌پرداخت' => 'paid', 'paid' => 'paid',
            // «total» لاتین معمولاً مبلغ نهایی است — آخر از همه
            'total' => 'total',
        );
        $items = array();
        $totals = array();
        foreach ($rows as $cells) {
            $joined = trim(implode(' ', $cells));
            if ($joined === '') continue;
            $low = fk_lower($joined);
            $matched = false;
            // طولانی‌ترین برچسب اول، تا «جمع کل» با «جمع» قاطی نشود
            $keys = array_keys($totalKeys);
            usort($keys, function ($a, $b) { return fk_len($b) <=> fk_len($a); });
            foreach ($keys as $label) {
                if (fk_pos($low, $label) !== false) {
                    // فقط اگر سطر کوتاه است (سطر کالا می‌تواند کلمه «جمع» داشته باشد)
                    if (fk_len($joined) > 70) continue;
                    $nums = array();
                    foreach ($cells as $c) {
                        if (fk_is_number($c)) $nums[] = fk_parse_amount($c);
                    }
                    if (!$nums) {
                        $bare = preg_replace('/[^\d,٬٫.]+/u', ' ', fk_digits_latin($joined));
                        foreach (preg_split('/\s+/', trim($bare)) as $n) {
                            if ($n !== '') $nums[] = fk_parse_amount($n);
                        }
                    }
                    if ($nums) {
                        $key = $totalKeys[$label];
                        $totals[$key] = max($nums);
                        $matched = true;
                        break;
                    }
                }
            }
            if (!$matched) $items[] = $cells;
        }
        return array('items' => $items, 'totals' => $totals);
    }
}

if (!function_exists('fk_detect_invoice_type')) {

    /* ═══════════════ ۳.۵ تشخیص نوع فاکتور ═══════════════

       «تشخیص خودکار» تا امروز فقط یک برچسب در رابط بود: هر چه کاربر
       انتخاب می‌کرد، موتور همان خط لولهٔ چاپی را اجرا می‌کرد. این بخش
       انتخاب را واقعی می‌کند — برای هر نوع، پارامترهای خوانش عوض می‌شوند:

         چاپی      جدول ستون‌دار، سرستون دارد
         حرارتی    فیش بلند و باریک؛ سطرها کوتاه‌اند، سرستون ندارد
         دست‌نویس  OCR خطا دارد؛ فاصله‌ها نامنظم، ارقام شکسته
         صوتی      متن گفتاری است، نه جدول؛ بدون سرستون و ستون
         خودکار    از روی نشانه‌های متن خودش تشخیص می‌دهد
    */

    /**
     * تشخیص نوع فاکتور از متن.
     *
     * نشانه‌ها به ترتیب قدرت: کلیدواژه‌های فیش/کارتخوان، طول متن و
     * چگالی سطرها برای حرارتی، نشانه‌های دست‌نویس/اسکن، و در نهایت
     * وجود سرستون برای چاپی.
     *
     * @return array{type:string, confidence:int, reason:string}
     */
    function fk_detect_invoice_type(string $text): array
    {
        $low = fk_lower($text);
        $len = fk_len(trim($text));
        $lines = preg_split('/\r\n|\r|\n/', trim($text)) ?: array();
        $lines = array_values(array_filter(array_map('trim', $lines), 'strlen'));
        $n = count($lines);
        $avgLen = 0;
        foreach ($lines as $ln) $avgLen += fk_len($ln);
        $avgLen = $n > 0 ? (int) round($avgLen / $n) : 0;

        /* ۱) صوتی: نشانه‌های گفتار یا پسوند صوتی در متن */
        if (preg_match('/(فایل صوتی|ویس|ضبط شده|گفتاری|transcri|صداگذاری)/u', $low)) {
            return array('type' => 'audio', 'confidence' => 78, 'reason' => 'نشانهٔ متن گفتاری/صوتی');
        }

        /* ۲) حرارتی: فیش صندوق، کارتخوان، رسید */
        $thermalHits = 0;
        foreach (array('کارتخوان', 'فیش', 'رسید', 'تراکنش', 'pos', 'شماره پیگیری',
                       'شماره مرجع', 'پایانه', 'خرید موفق', 'موجودی') as $w) {
            if (fk_pos($low, $w) !== false) $thermalHits++;
        }
        if ($thermalHits >= 1 && $n >= 4 && $avgLen <= 46) {
            return array('type' => 'thermal', 'confidence' => min(95, 62 + $thermalHits * 8),
                'reason' => 'نشانهٔ فیش صندوق/کارتخوان (سطرهای کوتاه: ' . $avgLen . ' نویسه)');
        }
        if ($thermalHits >= 2) {
            return array('type' => 'thermal', 'confidence' => 60 + $thermalHits * 5,
                'reason' => 'چند نشانهٔ فیش/رسید');
        }

        /* ۳) دست‌نویس: متن کوتاه، بدون سرستون، پر از نویز و رقم‌های تک‌رقمی */
        $header = fk_header_map(array_map('fk_split_columns', $lines));
        $hasHeader = !empty($header['map']);
        if (!$hasHeader && $n > 0) {
            $noise = preg_match_all('/([^\p{L}\p{N}\s,٬.]{1,2}\s){2,}/u', $text) ?: 0;
            $single = preg_match_all('/(?<![\d])[\d](?![\d])/u', fk_digits_latin($text)) ?: 0;
            $density = max(1, $n);
            if ($noise / $density > 0.5 || $single / max(1, $len) > 0.06) {
                return array('type' => 'handwritten', 'confidence' => 58,
                    'reason' => 'نویز زیاد و نبود جدول ← احتمال دست‌نویس');
            }
        }

        if ($hasHeader) {
            return array('type' => 'printed', 'confidence' => 84,
                'reason' => 'سرستون جدول شناسایی شد');
        }
        return array('type' => 'printed', 'confidence' => 55,
            'reason' => 'پیش‌فرض: فاکتور چاپی');
    }

    /**
     * پارامترهای خوانش هر نوع فاکتور.
     *
     * همین آرایه تفاوت واقعی می‌سازد: برای حرارتی خطوط بلند را نمی‌شکنیم
     * (فیش خودش باریک است)، برای دست‌نویس بازسازی سطرها را فعال می‌کنیم،
     * و برای صوتی ستون‌سازی را خاموش می‌کنیم.
     */
    function fk_type_options(string $type): array
    {
        switch ($type) {
            case 'thermal':
                return array(
                    'type' => 'thermal',
                    'label' => 'حرارتی',
                    'break_lines' => false,   /* فیش باریک است؛ شکستن سطر لازم نیست */
                    'join_wrapped' => false,  /* هر سطر فیش مستقل است */
                    'merge_columns' => false,
                    'autofix' => true,
                    'max_line' => 0,
                );
            case 'handwritten':
                return array(
                    'type' => 'handwritten',
                    'label' => 'دست‌نویس',
                    'break_lines' => true,
                    'join_wrapped' => true,   /* سطرهای شکستهٔ دست‌نویس باید به‌هم بچسبند */
                    'merge_columns' => false,
                    'autofix' => true,
                    'max_line' => 140,
                );
            case 'audio':
                return array(
                    'type' => 'audio',
                    'label' => 'صوتی',
                    'break_lines' => false,
                    'join_wrapped' => false,
                    'merge_columns' => true,  /* گفتار ستون ندارد؛ ستون‌ها یکی می‌شوند */
                    'autofix' => false,
                    'max_line' => 0,
                );
            case 'auto':
            case '':
                return array(
                    'type' => 'auto',
                    'label' => 'تشخیص خودکار',
                    'break_lines' => true,
                    'join_wrapped' => true,
                    'merge_columns' => false,
                    'autofix' => true,
                    'max_line' => 140,
                );
            default:  /* printed */
                return array(
                    'type' => 'printed',
                    'label' => 'چاپی',
                    'break_lines' => true,
                    'join_wrapped' => true,
                    'merge_columns' => false,
                    'autofix' => true,
                    'max_line' => 140,
                );
        }
    }
}

if (!function_exists('fk_understand')) {

    /* ═══════════════ ۴. خط لولهٔ فهم فاکتور ═══════════════ */

    /**
     * متن خام → ساختار فاکتور.
     *
     * @return array{
     *   ok: bool, items: array, totals: array, issues: array,
     *   confidence: int, warnings: array, header: array, column_types: array,
     *   item_count: int, items_sum: int, engine: string
     * }
     */
    function fk_understand(string $rawText, array $opts = array()): array
    {
        /*
         * نوع فاکتور پارامتر واقعی است، نه تزئینی.
         *
         * «تشخیص خودکار» اول از روی متن نوع را می‌فهمد؛ نوع دستی همان را
         * مستقیم به مرحلهٔ خوانش می‌دهد. سپس پارامترهای هر نوع (شکستن
         * سطر، پیوند سطرهای شکسته، ادغام ستون) روی پاک‌سازی اعمال می‌شود.
         */
        $requested = (string) ($opts['invoice_type'] ?? $opts['type'] ?? 'printed');
        if (!in_array($requested, array('printed', 'thermal', 'handwritten', 'audio', 'auto'), true)) {
            $requested = 'printed';
        }
        $detected = null;
        $type = $requested;
        if ($requested === 'auto') {
            $detected = fk_detect_invoice_type($rawText);
            $type = (string) $detected['type'];
        }
        $typeOpts = fk_type_options($type);
        if (array_key_exists('autofix', $opts)) {
            $autofix = (bool) $opts['autofix'];
        } else {
            $autofix = (bool) $typeOpts['autofix'];
        }
        // پاکسازی کامل پیش از هر چیز: نویز، سرصفحه، سطر شکسته، تکرار
        $text = fk_clean_for_reading($rawText);
        /* اثر نوع فاکتور بر متن: دست‌نویس و فیش حرارتی سطرهای شکسته
           دارند که باید به هم بچسبند تا یک قلم کامل شود. */
        if ($type === 'handwritten' || $type === 'thermal') {
            $text = fk_join_wrapped($text);
        }
        if (!empty($typeOpts['merge_columns'])) {
            $text = preg_replace('/\t+/u', ' ', $text) ?? $text;
        }

        // ۱) سطرهای خالی و حاشیه‌ای
        $warnings = array();
        $lines = array();
        foreach (explode("\n", $text) as $ln) {
            $t = trim($ln);
            if ($t === '') continue;
            if (preg_match('/^[-=_*.·•\s]{3,}$/u', $t)) continue;   // خط جداکننده
            $lines[] = $t;
        }
        if (!$lines) {
            return fk_understand_result(array(), array(), array('متن خالی است.'), 0, $text);
        }

        // ۲) ستون‌سازی
        $rows = array();
        foreach ($lines as $ln) {
            /* فاکتور صوتی ستون ندارد: کل سطر یک سلول است. */
            $cells = !empty($typeOpts['merge_columns']) ? array($ln) : fk_split_columns($ln);
            if ($cells) $rows[] = $cells;
        }

        // ۳) سرستون
        $hdr = fk_header_map($rows);
        $map = $hdr['map'];
        $bodyRows = $rows;
        if ($hdr['index'] >= 0) {
            $bodyRows = array_slice($rows, $hdr['index'] + 1);
        }
        $columnTypes = fk_guess_column_types($bodyRows);

        // ۴) جداکردن جمع‌ها
        $split = fk_split_totals($bodyRows);
        $itemRows = $split['items'];
        $totals = $split['totals'];

        // ۵) ساختن اقلام
        $items = array();
        foreach ($itemRows as $cells) {
            $item = fk_build_item($cells, $map, $columnTypes);
            if ($item !== null) $items[] = $item;
        }

        // ۶) جمع‌های گمشده را از اقلام بساز
        $itemsSum = 0;
        foreach ($items as $it) $itemsSum += (int) $it['total'];
        if (empty($totals['subtotal'])) $totals['subtotal'] = $itemsSum;
        $calc = (int) $totals['subtotal']
            - (int) ($totals['discount'] ?? 0)
            + (int) ($totals['tax'] ?? 0);
        if (empty($totals['total'])) $totals['total'] = $calc;

        // ۷) بررسی سازگاری + اصلاح
        $issues = fk_check_items($items, $totals);
        $autofixed = array();
        if ($autofix && $issues) {
            list($items, $totals, $autofixed) = fk_autofix_items($items, $totals);
            $issues = fk_check_items($items, $totals);
        }

        $confidence = fk_confidence($items, $issues, $map, $text);
        $res = fk_understand_result($items, $totals, $issues, $confidence, $text);

        /* سرصفحه: شماره، تاریخ، فروشنده/خریدار.
           این بخش قبلاً کلاً غایب بود و رابط برای هر فاکتور تازه،
           «شماره» و «فروشنده» خالی نشان می‌داد. حالا با همان
           fk_detect_meta (که وجود داشت ولی صدا زده نمی‌شد) پر می‌شود. */
        $meta = fk_detect_meta($text, $totals);
        list($sellerName, $sellerTax) = fk_find_party($text, 'seller');
        if ($sellerName === '') {
            $sellerName = fk_guess_seller_first_line($text);
        }
        list($buyerName, $buyerTax) = fk_find_party($text, 'buyer');
        $res['meta'] = array(
            'number' => (string) ($meta['number'] ?? ''),
            'date' => (string) ($meta['date'] ?? ''),
            'date_type' => (string) ($meta['date_type'] ?? ''),
            'dates' => (array) ($meta['dates'] ?? array()),
            'due' => isset($meta['dates'][1]['value']) ? (string) $meta['dates'][1]['value'] : '',
            'seller' => $sellerName,
            'seller_tax_id' => $sellerTax,
            'buyer' => $buyerName,
            'buyer_tax_id' => $buyerTax,
            'type' => $type,
            'type_label' => (string) $typeOpts['label'],
            'currency' => $meta['currency'] ?? array(),
            'tax_rate' => (int) ($meta['tax_rate'] ?? 0),
        );
        $res['header'] = $hdr['header'];
        $res['column_types'] = $columnTypes;
        $res['mapping'] = $map;
        $res['autofixed'] = $autofixed;
        $res['invoice_type'] = $type;
        $res['type_label'] = (string) $typeOpts['label'];
        $res['type_source'] = $requested === 'auto' ? 'auto' : 'manual';
        if ($detected !== null) {
            $res['detection'] = $detected;
        }
        return $res;
    }

    /** یک سطر را با نقشهٔ ستون‌ها به قلم تبدیل می‌کند؛ اگر قلم نبود null. */
    function fk_build_item(array $cells, array $map, array $types)
    {
        $n = count($cells);
        if ($n === 0) return null;

        $get = function ($key) use ($cells, $map) {
            $i = $map[$key] ?? null;
            return ($i !== null && isset($cells[$i])) ? $cells[$i] : '';
        };

        // توضیح: از نقشه، وگرنه طولانی‌ترین سلول غیرعددی
        $desc = trim($get('desc'));
        if ($desc === '') {
            $best = '';
            foreach ($cells as $i => $c) {
                $t = trim($c);
                if ($t === '' || fk_is_number($t) || fk_is_date($t)) continue;
                if (($types[$i] ?? '') === 'number') continue;
                if (fk_len($t) > fk_len($best)) $best = $t;
            }
            $desc = $best;
        }
        $desc = preg_replace('/\s{2,}/u', ' ', trim($desc));
        if ($desc === '' || fk_len($desc) < 2) return null;
        if (fk_is_date($desc) || fk_is_unit($desc)) return null;

        $qty = trim($get('qty'));
        $price = trim($get('price'));
        $total = trim($get('total'));
        $disc = trim($get('discount'));
        $unit = trim($get('unit'));

        // اگر نقشه نداریم: از راست اعداد را جمع کن
        if ($qty === '' && $price === '' && $total === '') {
            $nums = array();
            foreach (array_reverse($cells, true) as $i => $c) {
                /* ستون «text» رد می‌شود، ولی «۱۰ بسته» هم text طبقه‌بندی
                   شده چون عدد خالص نیست. در فاکتور فارسی همان ستون تعداد
                   است؛ اگر فوراً ردش کنیم، تعداد همیشه ۱ می‌شود. پس
                   «عدد + واحد» را حتی در ستون text هم می‌پذیریم. */
                if (($types[$i] ?? '') === 'text' && !fk_is_number(fk_number_and_unit($c)[0] ? (string) fk_number_and_unit($c)[0] : '')) {
                    if ((int) (fk_number_and_unit($c)[0]) <= 0) continue;
                }
                if (fk_is_number($c)) {
                    $nums[] = fk_parse_amount($c);
                } elseif (fk_len(trim($c)) > 0) {
                    /* «۱۰ بسته» / «۲ عدد» — عدد + واحد. در فاکتور فارسی
                       این رایج‌ترین شکل ستون تعداد است. */
                    list($amt, $u) = fk_number_and_unit($c);
                    if ($amt > 0 && fk_len($u) <= 12) {
                        $nums[] = $amt;
                    } elseif ($nums) {
                        break;
                    }
                } elseif ($nums) {
                    break;
                }
            }
            $nums = array_reverse($nums);
            $cnt = count($nums);
            /*
             * اگر جدول ناقص است، «مبلغ» را از روی «تعداد» حدس نزن.
             * در «کالا  2» عدد ۲ تعداد است، نه مبلغ؛ بهتر است مبلغ خالی بماند
             * تا از قیمت × تعداد ساخته شود، تا اینکه عدد غلط ثبت شود.
             */
            if ($cnt >= 3) { $qty = $nums[0]; $price = $nums[1]; $total = $nums[2]; }
            elseif ($cnt === 2) {
                // دو عدد: اگر اولی کوچک است احتمالاً تعداد است
                if ($nums[0] <= 1000 && $nums[1] > $nums[0] * 10) {
                    $qty = $nums[0]; $price = $nums[1]; $total = 0;
                } else {
                    $qty = 1; $price = $nums[0]; $total = $nums[1];
                }
            }
            elseif ($cnt === 1) {
                // یک عدد تنها در سطر = مبلغ نهایی، نه قیمت واحد
                $qty = 1; $price = 0; $total = $nums[0];
            }
            else return null;
        }

        $q = fk_parse_amount((string) $qty);
        if ($q <= 0) $q = 1;
        $p = fk_parse_amount((string) $price);
        $t = fk_parse_amount((string) $total);
        $d = fk_parse_amount((string) $disc);
        if (!$t && $p) $t = $q * $p - $d;
        if (!$p && $t) $p = (int) round($t / max(1, $q));

        if ($unit === '' || !fk_is_unit($unit)) $unit = fk_find_unit(implode(' ', $cells));

        return array(
            'code' => trim($get('code')),
            'description' => fk_sub($desc, 0, 300),
            'qty' => $q,
            'unit' => $unit !== '' ? $unit : 'عدد',
            'unit_price' => $p,
            'discount' => $d,
            'tax_rate' => 0,
            'total' => $t,
            'engine' => 'rules',
            'source_line' => fk_sub(implode("\t", $cells), 0, 300),
        );
    }

    /** واحد را از داخل متن پیدا می‌کند. */
    function fk_find_unit(string $text): string
    {
        $low = fk_lower($text);
        $units = array('مترمربع', 'مترمکعب', 'کیلوگرم', 'کارتن', 'بسته', 'دستگاه',
            'کیلو', 'گرم', 'متر', 'لیتر', 'جلد', 'حلقه', 'برگ', 'ورق', 'شیت',
            'جعبه', 'کیسه', 'قلم', 'سری', 'عدد', 'تن');
        foreach ($units as $u) {
            if (fk_pos($low, $u) !== false) return $u;
        }
        return '';
    }

    /**
     * نام و شناسهٔ ملی «فروشنده» یا «خریدار» را از سرصفحهٔ فاکتور می‌خواند.
     *
     * همان الگوریتم parser.py: اول برچسب را پیدا کن، بعد مقداری که تا
     * تب/دو نقطه/لوله ادامه دارد. تمیزکاری لازم است چون روی فاکتورهای
     * واقعی بعد از نام، آدرس یا تلفن هم می‌آید.
     */
    function fk_find_party(string $text, string $kind): array
    {
        if ($kind === 'seller') {
            $nameLabels = array('فروشنده', 'فروشگاه', 'نام\s*شرکت', 'مؤسسه', 'عرضه\s*کننده', 'seller', 'vendor', 'from');
            $taxLabels = array('شناسه\s*ملی\s*(?:فروشنده)?', 'کد\s*اقتصادی\s*(?:فروشنده)?', 'شماره\s*ثبت');
        } else {
            $nameLabels = array('خریدار', 'مشتری', 'نام\s*خریدار', 'buyer', 'customer', 'bill\s*to', 'to');
            $taxLabels = array('شناسه\s*ملی\s*(?:خریدار)?', 'کد\s*اقتصادی\s*(?:خریدار)?', 'کد\s*ملی');
        }
        $name = '';
        $taxId = '';
        foreach ($nameLabels as $label) {
            if (!preg_match('/' . $label . '\s*[:：\-]?\s*([^\t\n:：|]{2,60})/iu', $text, $m)) {
                continue;
            }
            $candidate = str_replace("\t", ' ', $m[1]);
            $candidate = trim($candidate, " :-|");
            $candidate = preg_replace('/(شناسه|کد|تلفن|فکس|آدرس|شماره).*$/u', '', $candidate) ?? $candidate;
            $candidate = preg_replace('/^(نام|شرکت|آقای|خانم)\s+/u', '', $candidate) ?? $candidate;
            $candidate = trim($candidate, " :-|");
            if (fk_len($candidate) >= 2 && !preg_match('/^[\d\s,]+$/u', $candidate)) {
                $name = fk_sub($candidate, 0, 120);
                break;
            }
        }
        foreach ($taxLabels as $label) {
            if (preg_match('/' . $label . '\s*[:：\-]?\s*(\d[\d\-]{5,20})/u', $text, $m)) {
                $taxId = trim($m[1]);
                break;
            }
        }
        return array($name, $taxId);
    }

    /**
     * اگر هیچ برچسبی پیدا نشد، سطر اولی که «شبیه نام کسب‌وکار» است را
     * فروشنده بگیر — مثل «فروشگاه لوازم اداری آفتاب» در بالای فاکتور.
     */
    function fk_guess_seller_first_line(string $text): string
    {
        $skip = '/(فاکتور|invoice|شماره|تاریخ|خریدار|مشتری|تلفن|فکس|آدرس|جمع|مبلغ|شناسه|کد)/iu';
        $head = '/(شرح|تعداد|قیمت|مبلغ|ردیف|description|qty|price)/iu';
        $lines = preg_split('/\n/u', $text) ?: array();
        foreach (array_slice($lines, 0, 6) as $line) {
            $line = trim($line);
            $len = fk_len($line);
            if ($len < 3 || $len > 90) {
                continue;
            }
            if (preg_match($skip, $line) || preg_match('/^[\d\s,.\-\/]+$/u', $line) || preg_match($head, $line)) {
                continue;
            }
            return $line;
        }
        return '';
    }

    /** جمع‌بندی خروجی استاندارد. */
    function fk_understand_result(array $items, array $totals, array $issues, int $confidence, string $text): array
    {
        $sum = 0;
        foreach ($items as $it) $sum += (int) $it['total'];
        $totals['items_sum'] = $sum;
        return array(
            'ok' => count($items) > 0,
            'items' => array_values($items),
            'totals' => $totals,
            'issues' => $issues,
            'confidence' => $confidence,
            'warnings' => array(),
            'item_count' => count($items),
            'items_sum' => $sum,
            'engine' => 'rules',
            'text' => $text,
        );
    }

    /* ═══════════════ ۵. بررسی و اصلاح اعداد ═══════════════ */

    /** اشکال‌های عددی را برمی‌گرداند: array(array('row','field','message','expected','actual')) */
    function fk_check_items(array $items, array $totals): array
    {
        $issues = array();
        foreach ($items as $i => $it) {
            $q = (int) ($it['qty'] ?? 0);
            $p = (int) ($it['unit_price'] ?? 0);
            $t = (int) ($it['total'] ?? 0);
            $d = (int) ($it['discount'] ?? 0);
            if ($q > 0 && $p > 0 && $t > 0) {
                $expect = $q * $p - $d;
                $tol = max(1, (int) round(abs($expect) * 0.01));
                if (abs($expect - $t) > $tol) {
                    $issues[] = array(
                        'row' => $i + 1,
                        'field' => 'total',
                        'message' => 'ردیف ' . ($i + 1) . ': ' . fk_fmt_amount($q) . ' × '
                            . fk_fmt_amount($p) . ' باید ' . fk_fmt_amount($expect)
                            . ' باشد ولی ' . fk_fmt_amount($t) . ' نوشته شده.',
                        'expected' => (string) $expect,
                        'actual' => (string) $t,
                    );
                }
            }
        }
        $sum = (int) ($totals['items_sum'] ?? 0);
        foreach ($items as $it) { } // items_sum از بیرون می‌آید
        $sub = (int) ($totals['subtotal'] ?? 0);
        if ($sub > 0 && $sum > 0) {
            $tol = max(1, (int) round($sub * 0.01));
            if (abs($sub - $sum) > $tol) {
                $issues[] = array(
                    'row' => 0, 'field' => 'subtotal',
                    'message' => 'جمع اقلام ' . fk_fmt_amount($sum)
                        . ' با جمع اعلام‌شده ' . fk_fmt_amount($sub) . ' نمی‌خواند.',
                    'expected' => (string) $sum, 'actual' => (string) $sub,
                );
            }
        }
        $grand = (int) ($totals['total'] ?? 0);
        if ($grand > 0 && $sub > 0) {
            $calc = $sub - (int) ($totals['discount'] ?? 0) + (int) ($totals['tax'] ?? 0);
            $tol = max(1, (int) round(abs($calc) * 0.01));
            if (abs($grand - $calc) > $tol) {
                $issues[] = array(
                    'row' => 0, 'field' => 'total',
                    'message' => 'مبلغ کل ' . fk_fmt_amount($grand)
                        . ' با محاسبهٔ ' . fk_fmt_amount($calc) . ' نمی‌خواند.',
                    'expected' => (string) $calc, 'actual' => (string) $grand,
                );
            }
        }
        return $issues;
    }

    /**
     * اعداد ناسازگار را اصلاح می‌کند.
     * @return array{0: array, 1: array, 2: array} [items, totals, changes]
     */
    function fk_autofix_items(array $items, array $totals): array
    {
        $changes = array();
        foreach ($items as $i => $it) {
            $q = (int) $it['qty'];
            $p = (int) $it['unit_price'];
            $t = (int) $it['total'];
            $d = (int) $it['discount'];
            if ($q > 0 && $p > 0) {
                $expect = $q * $p - $d;
                $tol = max(1, (int) round(abs($expect) * 0.01));
                if ($t === 0 || abs($expect - $t) > $tol) {
                    if ($t > 0) {
                        $changes[] = 'ردیف ' . ($i + 1) . ': مبلغ از ' . fk_fmt_amount($t)
                            . ' به ' . fk_fmt_amount($expect) . ' اصلاح شد.';
                        $items[$i]['original_total'] = $t;
                    } else {
                        $changes[] = 'ردیف ' . ($i + 1) . ': مبلغ خالی بود؛ '
                            . fk_fmt_amount($expect) . ' گذاشته شد.';
                    }
                    $items[$i]['total'] = $expect;
                    $items[$i]['note'] = end($changes);
                }
            }
        }
        $sum = 0;
        foreach ($items as $it) $sum += (int) $it['total'];
        $totals['items_sum'] = $sum;
        $sub = (int) ($totals['subtotal'] ?? 0);
        if ($sum > 0 && ($sub === 0 || abs($sub - $sum) > max(1, (int) round($sum * 0.01)))) {
            if ($sub > 0) {
                $changes[] = 'جمع اقلام از ' . fk_fmt_amount($sub) . ' به ' . fk_fmt_amount($sum) . ' اصلاح شد.';
            }
            $totals['subtotal'] = $sum;
        }
        $calc = (int) $totals['subtotal'] - (int) ($totals['discount'] ?? 0) + (int) ($totals['tax'] ?? 0);
        if ((int) ($totals['total'] ?? 0) !== $calc) {
            if (!empty($totals['total'])) {
                $changes[] = 'مبلغ کل از ' . fk_fmt_amount((int) $totals['total'])
                    . ' به ' . fk_fmt_amount($calc) . ' اصلاح شد.';
            }
            $totals['total'] = $calc;
        }
        return array($items, $totals, $changes);
    }

    /** امتیاز اعتماد ۰..۱۰۰. */
    function fk_confidence(array $items, array $issues, array $map, string $text): int
    {
        if (!$items) return 0;
        $score = 55;
        $withPrice = 0; $withQty = 0;
        foreach ($items as $it) {
            if ((int) $it['unit_price'] > 0) $withPrice++;
            if ((int) $it['qty'] > 1) $withQty++;
        }
        if ($withPrice === count($items)) $score += 15;
        if ($withQty > 0) $score += 8;
        if ($map) $score += 7;                    // سرستون شناخته شد
        $score -= min(30, 7 * count($issues));
        if (count($items) >= 2) $score += 5;
        if (fk_len($text) < 60) $score -= 10;
        return max(0, min(100, (int) $score));
    }
}

if (!function_exists('fk_clean_for_reading')) {

    /* ═══════════════ ۶. افزایش کیفیت خوانش ═══════════════ */

    /**
     * (۱) شکستن سطرهای به‌هم‌چسبیده.
     * OCR گاهی چند قلم را در یک سطر می‌ریزد؛ اینجا هرجا الگوی
     * «عدد + فاصله + متن فارسی» تکرار شود سطر شکسته می‌شود.
     */
    function fk_break_long_lines(string $text): string
    {
        $out = array();
        foreach (explode("\n", $text) as $line) {
            if (fk_len($line) < 90) { $out[] = $line; continue; }
            // نقطهٔ برش: قبل از «عدد، سپس یک نام کالای تازه»
            $parts = preg_split('/(?<=[\d,٬])\s{2,}(?=[\x{0600}-\x{06FF}A-Za-z])/u', $line);
            if ($parts && count($parts) > 1) {
                foreach ($parts as $p) { $out[] = trim($p); }
            } else {
                $out[] = $line;
            }
        }
        return implode("\n", $out);
    }

    /** (۲) حذف سرصفحه/پاصفحهٔ تکراری هر صفحه (شماره صفحه، نام نرم‌افزار، تاریخ چاپ). */
    function fk_drop_running_heads(string $text): string
    {
        $lines = explode("\n", $text);
        if (count($lines) < 3) return $text;   // آستانه بر اساس محتوا، نه تعداد سطر
        $counts = array();
        foreach ($lines as $l) {
            $k = trim($l);
            if ($k === '') continue;
            $counts[$k] = ($counts[$k] ?? 0) + 1;
        }
        $out = array();
        foreach ($lines as $l) {
            $k = trim($l);
            // سطری که دو بار یا بیشتر عیناً تکرار شده و کوتاه است = سرصفحه
            if ($k !== '' && fk_len($k) < 70 && ($counts[$k] ?? 0) >= 2) continue;
            // «صفحه ۲ از ۵» — حتی وقتی در میان متن دیگر آمده باشد
            if (preg_match('/صفحه\s*\d+\s*(?:از|\/)\s*\d+/u', $k)) continue;
            if (preg_match('/\bpage\s*\d+\s*(?:of|\/)\s*\d+/iu', $k)) continue;
            // «تاریخ چاپ: ...» در سرصفحه
            if (preg_match('/^\s*(?:تاریخ چاپ|چاپ شده در|printed on)\b/iu', $k)) continue;
            $out[] = $l;
        }
        return implode("\n", $out);
    }

    /** (۳) چسباندن سطری که ادامهٔ شرح کالای قبلی است (بدون عدد). */
    function fk_join_wrapped(string $text): string
    {
        $lines = explode("\n", $text);
        $out = array();
        foreach ($lines as $l) {
            $t = trim($l);
            if ($t === '') { $out[] = ''; continue; }
            $prev = count($out) ? end($out) : '';
            $prevHasNumbers = (bool) preg_match('/\d/', $prev);
            $thisHasNumbers = (bool) preg_match('/\d/', $t);
            // سطر کوتاه، بدون عدد، و قبلی عدد داشت → ادامهٔ شرح است
            if ($prev !== '' && $prevHasNumbers && !$thisHasNumbers
                && fk_len($t) < 60 && !preg_match('/[:：]$/u', $prev)) {
                $out[count($out) - 1] = rtrim($prev) . ' ' . $t;
            } else {
                $out[] = $t;
            }
        }
        return implode("\n", $out);
    }

    /** (۴) حذف تکرار پشت‌سرهم سطرها (OCR تکراری). */
    function fk_dedupe_lines(string $text): string
    {
        $out = array();
        $prev = null;
        foreach (explode("\n", $text) as $l) {
            $t = trim($l);
            if ($t !== '' && $t === $prev) continue;
            $out[] = $t;
            $prev = $t;
        }
        return implode("\n", $out);
    }

    /** (۵) یکدست‌سازی فاصله‌های اطراف نقطه/ویرگول و پرانتز. */
    function fk_tidy_punctuation(string $text): string
    {
        $text = preg_replace('/\s+([،,؛;:.!؟?])/u', '$1', $text);
        $text = preg_replace('/\(\s+/u', '(', $text);
        $text = preg_replace('/\s+\)/u', ')', $text);
        return $text;
    }

    /** (۶) حذف کاراکترهای OCR-زباله که در فاکتور معنا ندارند. */
    function fk_drop_noise(string $text): string
    {
        // تک‌کاراکترهای تنها در سطر (نویز اسکن)
        $lines = explode("\n", $text);
        $out = array();
        foreach ($lines as $l) {
            $t = trim($l);
            if ($t !== '' && fk_len($t) === 1 && !preg_match('/[\d]/', $t)) continue;
            $out[] = $l;
        }
        $clean = implode("\n", $out);
        return preg_replace('/[|¦]{2,}/u', '|', $clean);
    }

    /**
     * زنجیرهٔ کامل پاکسازی برای نمایش و برای موتور.
     * ترتیب مهم است: نویز → نویسه → سرصفحه → شکستن → چسباندن → نقطه‌گذاری.
     */
    function fk_clean_for_reading(string $raw): string
    {
        $t = fk_norm_chars($raw);
        $t = fk_drop_noise($t);
        $t = fk_drop_running_heads($t);
        $t = fk_break_long_lines($t);
        /* fk_join_wrapped این‌جا عمداً صدا زده نمی‌شود.
           باگ واقعی: این تابع سطر «شرح تعداد قیمت مبلغ» را که هیچ عددی
           ندارد، به سطر قبلی («تاریخ: ...») می‌چسباند و در نتیجه سرستون
           از بین می‌رفت و ستون‌ها بی‌نام می‌شدند؛ بعد هم هیچ قلمی خوانده
           نمی‌شد. همان‌طور که نسخهٔ پایتون هم فقط برای فاکتور دست‌نویس و
           فیش حرارتی این کار را می‌کند، پیوند سطرهای شکسته در
           fk_understand و بعد از تعیین نوع فاکتور انجام می‌شود. */
        $t = fk_dedupe_lines($t);
        $t = fk_tidy_punctuation($t);
        // سطرهای خالی پشت‌سرهم → یکی
        $t = preg_replace("/\n{3,}/u", "\n\n", $t);
        return trim($t);
    }
}

if (!function_exists('fk_detect_meta')) {

    /* ═══════════════ ۷. فهم فرادادهٔ سند ═══════════════ */

    /**
     * تاریخ شمسی/میلادی را پیدا و نرمال می‌کند.
     * خروجی: آرایه‌ای از تاریخ‌های یافت‌شده با نوعشان.
     */
    function fk_find_dates(string $text): array
    {
        $found = array();
        $t = fk_digits_latin($text);

        // شمسی: 1404/08/16 یا ۱۴۰۴-۸-۱۶
        if (preg_match_all('/(1[34]\d{2})\s*[\/\-.]\s*(\d{1,2})\s*[\/\-.]\s*(\d{1,2})/u', $t, $m, PREG_SET_ORDER)) {
            foreach ($m as $g) {
                $found[] = array('type' => 'jalali', 'value' => sprintf('%04d/%02d/%02d', $g[1], $g[2], $g[3]),
                    'raw' => $g[0]);
            }
        }
        // میلادی: 2024/05/12 یا 12-05-2024
        if (preg_match_all('/(20\d{2})\s*[\/\-.]\s*(\d{1,2})\s*[\/\-.]\s*(\d{1,2})/', $t, $m, PREG_SET_ORDER)) {
            foreach ($m as $g) {
                $found[] = array('type' => 'gregorian', 'value' => sprintf('%04d/%02d/%02d', $g[1], $g[2], $g[3]),
                    'raw' => $g[0]);
            }
        }
        // نام ماه فارسی: «۱۶ آبان ۱۴۰۴»
        $months = array('فروردین' => 1, 'اردیبهشت' => 2, 'خرداد' => 3, 'تیر' => 4, 'مرداد' => 5,
            'شهریور' => 6, 'مهر' => 7, 'آبان' => 8, 'آذر' => 9, 'دی' => 10, 'بهمن' => 11, 'اسفند' => 12);
        foreach ($months as $name => $num) {
            if (preg_match('/(\d{1,2})\s*' . $name . '\s*(1[34]\d{2})/u', $t, $g)) {
                $found[] = array('type' => 'jalali',
                    'value' => sprintf('%04d/%02d/%02d', $g[2], $num, $g[1]), 'raw' => $g[0]);
            }
        }
        return $found;
    }

    /** شمارهٔ فاکتور را از الگوهای رایج بیرون می‌کشد. */
    function fk_find_invoice_number(string $text): string
    {
        $t = fk_digits_latin($text);
        $patterns = array(
            '/(?:شماره\s*(?:فاکتور|صورتحساب|سند)|فاکتور\s*شماره|invoice\s*(?:no|number|#)|فاکتور\s*no)\s*[:：#]?\s*([A-Za-z0-9\-\/\.]{3,30})/iu',
            '/\b(?:NO|No|#)\s*[:.]?\s*([A-Za-z0-9\-\/\.]{3,30})/u',
            '/(?:شماره)\s*[:：]\s*([0-9\-\/]{3,25})/u',
        );
        foreach ($patterns as $p) {
            if (preg_match($p, $t, $m)) {
                $v = trim($m[1], " .:-#");
                if ($v !== '' && !preg_match('/^\d{4}\/\d{2}\/\d{2}$/', $v)) return $v;
            }
        }
        return '';
    }

    /** واحد پول و ضریب آن را حدس می‌زند (ریال یا تومان). */
    function fk_detect_currency(string $text): array
    {
        $t = fk_lower($text);
        if (preg_match('/\b(تومان|toman|irt)\b/u', $t)) {
            return array('code' => 'IRT', 'label' => 'تومان', 'ratio' => 10); // ۱ تومان = ۱۰ ریال
        }
        if (preg_match('/\b(ریال|rial|irr)\b/u', $t)) {
            return array('code' => 'IRR', 'label' => 'ریال', 'ratio' => 1);
        }
        if (preg_match('/\b(دلار|usd|\$)\b/u', $t)) return array('code' => 'USD', 'label' => 'دلار', 'ratio' => 1);
        if (preg_match('/\b(یورو|eur|€)\b/u', $t)) return array('code' => 'EUR', 'label' => 'یورو', 'ratio' => 1);
        // پیش‌فرض ایران
        return array('code' => 'IRR', 'label' => 'ریال', 'ratio' => 1);
    }

    /** نرخ مالیات اعلام‌شده را پیدا می‌کند (۶٪، ۹٪، ۱۰٪). */
    function fk_detect_tax_rate(string $text, array $totals): int
    {
        if (preg_match_all('/(\d{1,2})\s*(?:درصد|٪|%)/u', fk_digits_latin($text), $m)) {
            foreach ($m[1] as $pct) {
                $p = (int) $pct;
                if ($p > 0 && $p <= 30) return $p;
            }
        }
        $sub = (int) ($totals['subtotal'] ?? 0);
        $tax = (int) ($totals['tax'] ?? 0);
        if ($sub > 0 && $tax > 0) {
            $rate = (int) round($tax / $sub * 100);
            if ($rate >= 1 && $rate <= 30) return $rate;
        }
        return 0;
    }

    /** جمع‌بندی فراداده در یک آرایه. */
    function fk_detect_meta(string $text, array $totals = array()): array
    {
        $dates = fk_find_dates($text);
        return array(
            'dates' => $dates,
            'date' => $dates ? $dates[0]['value'] : '',
            'date_type' => $dates ? $dates[0]['type'] : '',
            'number' => fk_find_invoice_number($text),
            'currency' => fk_detect_currency($text),
            'tax_rate' => fk_detect_tax_rate($text, $totals),
        );
    }
}

if (!function_exists('fk_quality_report')) {

    /* ═══════════════ ۸. گزارش کیفیت خوانش ═══════════════ */

    /**
     * به کاربر می‌گوید این خوانش چقدر سالم است و چه کاری باید بکند.
     * خروجی: array('grade' => A..D, 'score' => 0..100, 'checks' => [...], 'advice' => '...')
     */
    function fk_quality_report(string $text, array $understood): array
    {
        $checks = array();
        $items = $understood['items'] ?? array();
        $totals = $understood['totals'] ?? array();
        $issues = $understood['issues'] ?? array();

        $add = function ($name, $ok, $why) use (&$checks) {
            $checks[] = array('name' => $name, 'ok' => (bool) $ok, 'detail' => $why);
        };

        $len = fk_len($text);
        $add('طول متن', $len >= 80, fk_len($text) < 80 ? 'متن خیلی کوتاه است' : 'متن کافی است');
        $add('اقلام شناسایی‌شده', count($items) >= 1, count($items) . ' قلم');
        $add('قیمت واحد', count($items) > 0 && count(array_filter($items, function ($i) {
            return (int) $i['unit_price'] > 0;
        })) === count($items), 'همهٔ اقلام قیمت دارند');
        $add('سازگاری عددی', count($issues) === 0, count($issues) . ' اشکال');
        $add('جمع اعلام‌شده', !empty($totals['subtotal']), 'جمع در سند پیدا شد');

        $passed = 0;
        foreach ($checks as $c) if ($c['ok']) $passed++;
        $score = (int) round($passed / max(1, count($checks)) * 100);

        $grade = $score >= 90 ? 'A' : ($score >= 70 ? 'B' : ($score >= 50 ? 'C' : 'D'));
        $advice = 'همه‌چیز سالم است؛ فقط یک نگاه سریع بیندازید.';
        if ($grade === 'C') $advice = 'چند فیلد را دستی کنترل کنید؛ متن خوانش‌شده در پایین صفحه است.';
        if ($grade === 'D') $advice = 'کیفیت خوانش پایین است. عکس واضح‌تری بگیرید یا فیلدها را دستی پر کنید.';

        return array('grade' => $grade, 'score' => $score, 'checks' => $checks, 'advice' => $advice);
    }
}

if (!function_exists('fk_suggestions')) {

    /* ═══════════════ ۹. پیشنهاد برای خوانش بهتر ═══════════════ */

    /** بر اساس کیفیت فایل/متن، پیشنهاد عملی می‌دهد (بدون افشای سرویس). */
    function fk_suggestions(string $ext, int $bytes, int $pages, array $job = array()): array
    {
        $out = array();
        if (in_array($ext, array('jpg', 'jpeg', 'png', 'bmp', 'webp'), true) && $bytes < 60000) {
            $out[] = 'عکس کوچک است؛ با کیفیت بالاتر (حداقل ۱ مگابایت) دقیق‌تر خوانده می‌شود.';
        }
        if ($pages > 5) {
            $out[] = $pages . ' صفحه است؛ برای سرعت بیشتر، صفحه‌به‌صفحه بفرستید.';
        }
        if (in_array($ext, array('doc', 'docx', 'txt', 'xls', 'xlsx'), true)) {
            $out[] = 'فایل متنی است؛ اگر متن اصلی دارید مستقیم بچسبانید تا سریع‌تر باشد.';
        }
        if (!empty($job['slow'])) {
            $out[] = 'این فایل کند پردازش شد؛ اگر تکرار شد فایل را به بخش‌های کوچک‌تر بشکنید.';
        }
        return $out;
    }
}
