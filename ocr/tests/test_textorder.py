from server.textorder import Detection, apply_decode, assemble_text, group_rows, paddle_reverse


def box(x0, y0, w=50, h=20):
    return [[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h]]


def test_paddle_reverse_keeps_latin_runs_and_reverses_pieces():
    assert paddle_reverse("سلام") == "مالس"
    assert paddle_reverse("ابC12 تست") == "تستC12 با"


def test_paddle_reverse_reverses_persian_digits_one_by_one():
    # قطعه‌های ارقام فارسی در regex نیستند؛ همین رفتار PaddleOCR است و باید دیده شود.
    assert paddle_reverse("۱۲۳") == "۳۲۱"
    assert paddle_reverse("M-1405-0001") == "M-1405-0001"


def test_apply_decode_modes():
    assert apply_decode("ابc", "raw") == "ابc"
    assert apply_decode("ابc", "paddle") == "cبا"


def test_group_rows_orders_rtl_within_row_and_top_to_bottom():
    dets = [
        Detection("چپ", 1, box(10, 100)),
        Detection("راست", 1, box(200, 102)),
        Detection("پایین", 1, box(10, 300)),
    ]
    rows = group_rows(dets, rtl=True)
    assert [[d.text for d in r] for r in rows] == [["راست", "چپ"], ["پایین"]]


def test_assemble_text_one_line_per_row():
    dets = [Detection("a", 1, box(0, 0)), Detection("b", 1, box(100, 0)), Detection("c", 1, box(0, 80))]
    assert assemble_text(group_rows(dets)) == "b   a\nc"


def test_empty_input():
    assert group_rows([]) == []
    assert assemble_text([]) == ""
