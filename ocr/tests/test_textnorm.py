from server.textnorm import normalize_persian


def test_arabic_letters_become_persian():
    assert normalize_persian("كتاب يك") == "کتاب یک"


def test_arabic_indic_digits_become_persian_digits():
    assert normalize_persian("مبلغ ٣٠٠٦٩١٨") == "مبلغ ۳۰۰۶۹۱۸"


def test_persian_digits_and_latin_digits_untouched():
    assert normalize_persian("M-1405-0001 و ۱۲۳") == "M-1405-0001 و ۱۲۳"


def test_whitespace_collapsed_and_empty_lines_dropped():
    assert normalize_persian("  الف   ب \n\n  ج  ") == "الف ب\nج"


def test_none_and_empty():
    assert normalize_persian("") == ""
    assert normalize_persian(None) is None
