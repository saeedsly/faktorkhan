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
        $parts = preg_split('/\s{2,}|\s*\|\s*|\s*;\s*/u', $line);
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
        $autofix = array_key_exists('autofix', $opts) ? (bool) $opts['autofix'] : true;
        $text = fk_norm_chars($rawText);

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
            $cells = fk_split_columns($ln);
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
        $res['header'] = $hdr['header'];
        $res['column_types'] = $columnTypes;
        $res['mapping'] = $map;
        $res['autofixed'] = $autofixed;
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
                if (fk_is_number($c) && ($types[$i] ?? '') !== 'text') {
                    $nums[] = fk_parse_amount($c);
                } elseif ($nums) break;
            }
            $nums = array_reverse($nums);
            $cnt = count($nums);
            if ($cnt >= 3) { $qty = $nums[0]; $price = $nums[1]; $total = $nums[2]; }
            elseif ($cnt === 2) { $qty = 1; $price = $nums[0]; $total = $nums[1]; }
            elseif ($cnt === 1) { $qty = 1; $price = 0; $total = $nums[0]; }
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
