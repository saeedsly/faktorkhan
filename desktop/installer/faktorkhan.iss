; ──────────────────────────────────────────────────────────────────────
;  نصب‌کننده فاکتورخوان برای ویندوز (Inno Setup 6)
;  ساخت: ISCC.exe faktorkhan.iss
;  اثر: سعید سالاری — تمامی حقوق محفوظ است.
; ──────────────────────────────────────────────────────────────────────

#define MyAppName "فاکتورخوان"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "سعید سالاری"
#define MyAppURL "https://localhost/"
#define MyAppExeName "FactorKhan.exe"
#define MyAppTagline "سامانه هوشمند خوانش و مدیریت فاکتور"

[Setup]
AppId={{7A1F5B42-9C3D-4E17-8A5B-F4C2D91E6B10}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion} — {#MyAppTagline}
AppPublisher={#MyAppPublisher}
AppCopyright=© ۱۴۰۴ {#MyAppPublisher} — تمامی حقوق محفوظ است.
VersionInfoCompany={#MyAppPublisher}
VersionInfoDescription={#MyAppName} — {#MyAppTagline}
VersionInfoCopyright=© ۱۴۰۴ {#MyAppPublisher}
VersionInfoVersion=1.0.0.0
DefaultDirName={autopf}\FactorKhan
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
UninstallDisplayName={#MyAppName}
UninstallDisplayIcon={app}\{#MyAppExeName}
OutputDir=..\dist-installer
OutputBaseFilename=FactorKhan-Setup-{#MyAppVersion}
SetupIconFile=faktorkhan.ico
WizardStyle=modern
Compression=lzma2/max
SolidCompression=yes
ArchitecturesInstallIn64BitMode=x64compatible
ArchitecturesAllowed=x64compatible
MinVersion=10.0
PrivilegesRequired=admin
LicenseFile=license_fa.txt
InfoBeforeFile=copyright_fa.txt
WizardImageFile=wizard.bmp
WizardSmallImageFile=wizard-small.bmp
AppPublisherURL={#MyAppPublisher}

[Languages]
Name: "farsi"; MessagesFile: "compiler:Default.isl"

[Messages]
farsi.WelcomeLabel2=این برنامه {#MyAppName} نسخه {#MyAppVersion} را روی رایانه شما نصب می‌کند.%n%n{#MyAppTagline}%n%nپدیدآورنده و دارنده حقوق معنوی: {#MyAppPublisher}
farsi.LicenseLabel1=شرایط استفاده و حق معنوی
farsi.LicenseLabel2=برای ادامه نصب، متن حق معنوی و شرایط استفاده را مطالعه و بپذیرید.
farsi.FinishedHeadingLabel=نصب {#MyAppName} به پایان رسید
farsi.FinishedLabel=فاکتورخوان آماده است. از منوی شروع یا آیکن روی دسکتاپ اجرا کنید.%n%nپدیدآورنده: {#MyAppPublisher}
farsi.ClickFinish=برای بستن نصب‌کننده کلیک کنید.

[Tasks]
Name: "desktopicon"; Description: "ایجاد آیکن روی دسکتاپ"; GroupDescription: "میان‌بر اجرا:"
Name: "quicklaunchicon"; Description: "ایجاد آیکن در نوار وظیفه"; GroupDescription: "میان‌بر اجرا:"; Flags: unchecked
Name: "autostart"; Description: "اجرای خودکار فاکتورخوان هنگام ورود به ویندوز"; GroupDescription: "تنظیمات اجرا:"; Flags: unchecked

[Files]
Source: "..\dist\FactorKhan\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Comment: "{#MyAppTagline}"
Name: "{group}\پوشه داده فاکتورخوان"; Filename: "{userappdata}\FactorKhan"
Name: "{group}\حذف {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon
Name: "{userappdata}\Microsoft\Internet Explorer\Quick Launch\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: quicklaunchicon

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; \
  ValueName: "FactorKhan"; ValueData: """{app}\{#MyAppExeName}"""; Flags: uninsdeletevalue; Tasks: autostart

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "اجرای فاکتورخوان"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{app}\storage"
