"""نقطه‌ی ورود برای اجرای مستقیم و ساخت فایل exe با PyInstaller."""

import sys

from faktorkhan.app import main

if __name__ == "__main__":
    sys.exit(main())
