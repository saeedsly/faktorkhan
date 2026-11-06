"""دیلاگ فعال‌سازی لایسنس و نسخه آزمایشی."""

from __future__ import annotations

from pathlib import Path

from PyQt6.QtWidgets import (
    QDialog,
    QDialogButtonBox,
    QFileDialog,
    QHBoxLayout,
    QLabel,
    QPushButton,
    QVBoxLayout,
    QWidget,
)

from faktorkhan.license.core import LicenseManager


class LicenseDialog(QDialog):
    def __init__(self, manager: LicenseManager, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.manager = manager
        self.setWindowTitle("فعال‌سازی لایسنس فاکتورخوان")
        self.setMinimumWidth(520)
        self._build_ui()
        self._refresh()

    def _build_ui(self) -> None:
        layout = QVBoxLayout(self)

        self.lbl_status = QLabel("لایسنس فعال نیست")
        self.lbl_status.setObjectName("statusBad")
        layout.addWidget(self.lbl_status)

        self.lbl_detail = QLabel("")
        self.lbl_detail.setStyleSheet("color: #94a3b8;")
        layout.addWidget(self.lbl_detail)

        btn_load = QPushButton("بارگذاری فایل لایسنس (.json)")
        btn_load.clicked.connect(self._load_license)
        layout.addWidget(btn_load)

        btn_trial = QPushButton("شروع نسخه آزمایشی ۷ روزه")
        btn_trial.setObjectName("ghost")
        btn_trial.clicked.connect(self._start_trial)
        layout.addWidget(btn_trial)

        self.buttons = QDialogButtonBox(QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel)
        self.buttons.accepted.connect(self.accept)
        self.buttons.rejected.connect(self.reject)
        self.buttons.button(QDialogButtonBox.StandardButton.Ok).setEnabled(False)
        layout.addWidget(self.buttons)

    def _load_license(self) -> None:
        path, _ = QFileDialog.getOpenFileName(
            self, "انتخاب فایل لایسنس", str(Path.home()), "License Files (*.json);;All Files (*)"
        )
        if not path:
            return
        status = self.manager.activate(path)
        self._refresh(status)
        if status.valid:
            self.buttons.button(QDialogButtonBox.StandardButton.Ok).setEnabled(True)

    def _start_trial(self) -> None:
        from faktorkhan.config import LICENSE_DIR
        import json

        envelope = self.manager.generate_trial_license(
            customer="کاربر عزیز",
            plan="trial",
            days=7,
            features=["basic", "ocr", "excel", "history"],
        )
        path = LICENSE_DIR / "trial_license.json"
        path.write_text(json.dumps(envelope, indent=2), encoding="utf-8")
        status = self.manager.activate(path)
        self._refresh(status)
        if status.valid:
            self.buttons.button(QDialogButtonBox.StandardButton.Ok).setEnabled(True)

    def _refresh(self, status=None) -> None:
        if status is None:
            status = self.manager.validate()
        if status.valid:
            self.lbl_status.setText("لایسنس فعال است")
            self.lbl_status.setObjectName("statusOk")
            self.lbl_detail.setText(
                f"برنامه: {status.plan} | مشتری: {status.customer} | "
                f"مابقی: {status.days_remaining} روز"
            )
        elif status.grace:
            self.lbl_status.setText("در مهلت أنقضا (گرس)")
            self.lbl_status.setObjectName("statusWarn")
            self.lbl_detail.setText(f"اشتراک منقضی شده است — مهلت {7} روزه باقی است.")
        else:
            self.lbl_status.setText("لایسنس فعال نیست")
            self.lbl_status.setObjectName("statusBad")
            self.lbl_detail.setText(status.message)
        self.style().unpolish(self.lbl_status)
        self.style().polish(self.lbl_status)
