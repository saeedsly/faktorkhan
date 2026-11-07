-- ════════════════════════════════════════════════════════════════
--  فاکتورخوان — ساختار پایگاه داده MySQL / MariaDB
--  اثر: سعید سالاری
--  این فایل اختیاری است؛ برنامه جداول را در اولین اجرا خودکار می‌سازد.
-- ════════════════════════════════════════════════════════════════

SET NAMES utf8mb4;
CREATE DATABASE IF NOT EXISTS `faktorkhan` CHARACTER SET utf8mb4 COLLATE utf8mb4_persian_ci;
USE `faktorkhan`;

DROP TABLE IF EXISTS `app_settings`;
CREATE TABLE app_settings (
	id INTEGER NOT NULL AUTO_INCREMENT, 
	`key` VARCHAR(80) NOT NULL, 
	value TEXT NOT NULL, 
	is_secret BOOL NOT NULL, 
	updated_at DATETIME NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_settings_key UNIQUE (`key`)
);

DROP TABLE IF EXISTS `plans`;
CREATE TABLE plans (
	id INTEGER NOT NULL AUTO_INCREMENT, 
	code VARCHAR(40) NOT NULL, 
	name VARCHAR(120) NOT NULL, 
	tagline VARCHAR(200) NOT NULL, 
	price INTEGER NOT NULL, 
	duration_days INTEGER NOT NULL, 
	support_days INTEGER NOT NULL, 
	page_quota INTEGER NOT NULL, 
	max_devices INTEGER NOT NULL, 
	features JSON, 
	is_active BOOL NOT NULL, 
	is_featured BOOL NOT NULL, 
	sort_order INTEGER NOT NULL, 
	created_at DATETIME NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (code)
);

DROP TABLE IF EXISTS `users`;
CREATE TABLE users (
	id INTEGER NOT NULL AUTO_INCREMENT, 
	full_name VARCHAR(120) NOT NULL, 
	company VARCHAR(160) NOT NULL, 
	email VARCHAR(190) NOT NULL, 
	phone VARCHAR(32) NOT NULL, 
	password_hash VARCHAR(255) NOT NULL, 
	`role` VARCHAR(20) NOT NULL, 
	is_active BOOL NOT NULL, 
	must_change_password BOOL NOT NULL, 
	avatar_color VARCHAR(12) NOT NULL, 
	theme VARCHAR(12) NOT NULL, 
	failed_attempts INTEGER NOT NULL, 
	locked_until DATETIME, 
	last_login_at DATETIME, 
	last_ip VARCHAR(64) NOT NULL, 
	created_at DATETIME NOT NULL, 
	updated_at DATETIME NOT NULL, 
	PRIMARY KEY (id)
);

DROP TABLE IF EXISTS `audit_logs`;
CREATE TABLE audit_logs (
	id INTEGER NOT NULL AUTO_INCREMENT, 
	user_id INTEGER, 
	actor VARCHAR(190) NOT NULL, 
	action VARCHAR(60) NOT NULL, 
	entity VARCHAR(60) NOT NULL, 
	entity_id VARCHAR(60) NOT NULL, 
	detail VARCHAR(500) NOT NULL, 
	ip VARCHAR(64) NOT NULL, 
	user_agent VARCHAR(300) NOT NULL, 
	created_at DATETIME NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE SET NULL
);

DROP TABLE IF EXISTS `devices`;
CREATE TABLE devices (
	id INTEGER NOT NULL AUTO_INCREMENT, 
	user_id INTEGER NOT NULL, 
	device_id VARCHAR(64) NOT NULL, 
	label VARCHAR(120) NOT NULL, 
	platform VARCHAR(60) NOT NULL, 
	last_seen DATETIME NOT NULL, 
	created_at DATETIME NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

DROP TABLE IF EXISTS `license_keys`;
CREATE TABLE license_keys (
	id INTEGER NOT NULL AUTO_INCREMENT, 
	`key` VARCHAR(48) NOT NULL, 
	plan_id INTEGER NOT NULL, 
	status VARCHAR(16) NOT NULL, 
	note VARCHAR(220) NOT NULL, 
	created_by INTEGER, 
	created_at DATETIME NOT NULL, 
	redeemed_at DATETIME, 
	redeemed_by INTEGER, 
	expires_at DATETIME, 
	PRIMARY KEY (id), 
	FOREIGN KEY(plan_id) REFERENCES plans (id) ON DELETE CASCADE, 
	FOREIGN KEY(created_by) REFERENCES users (id), 
	FOREIGN KEY(redeemed_by) REFERENCES users (id)
);

DROP TABLE IF EXISTS `ocr_jobs`;
CREATE TABLE ocr_jobs (
	id INTEGER NOT NULL AUTO_INCREMENT, 
	user_id INTEGER NOT NULL, 
	provider VARCHAR(16) NOT NULL, 
	method INTEGER NOT NULL, 
	output VARCHAR(20) NOT NULL, 
	language VARCHAR(8) NOT NULL, 
	file_name VARCHAR(255) NOT NULL, 
	file_path VARCHAR(500) NOT NULL, 
	file_token VARCHAR(120) NOT NULL, 
	pages INTEGER NOT NULL, 
	status VARCHAR(24) NOT NULL, 
	progress INTEGER NOT NULL, 
	message VARCHAR(300) NOT NULL, 
	text TEXT NOT NULL, 
	download_url VARCHAR(600) NOT NULL, 
	result_path VARCHAR(500) NOT NULL, 
	meta JSON, 
	invoice_id INTEGER, 
	created_at DATETIME NOT NULL, 
	updated_at DATETIME NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

DROP TABLE IF EXISTS `support_messages`;
CREATE TABLE support_messages (
	id INTEGER NOT NULL AUTO_INCREMENT, 
	user_id INTEGER, 
	name VARCHAR(120) NOT NULL, 
	contact VARCHAR(120) NOT NULL, 
	subject VARCHAR(160) NOT NULL, 
	message TEXT NOT NULL, 
	status VARCHAR(16) NOT NULL, 
	answer TEXT NOT NULL, 
	created_at DATETIME NOT NULL, 
	answered_at DATETIME, 
	PRIMARY KEY (id), 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE SET NULL
);

DROP TABLE IF EXISTS `invoices`;
CREATE TABLE invoices (
	id INTEGER NOT NULL AUTO_INCREMENT, 
	user_id INTEGER NOT NULL, 
	number VARCHAR(80) NOT NULL, 
	issue_date VARCHAR(20) NOT NULL, 
	due_date VARCHAR(20) NOT NULL, 
	invoice_type VARCHAR(20) NOT NULL, 
	direction VARCHAR(12) NOT NULL, 
	seller_name VARCHAR(200) NOT NULL, 
	seller_tax_id VARCHAR(40) NOT NULL, 
	buyer_name VARCHAR(200) NOT NULL, 
	buyer_tax_id VARCHAR(40) NOT NULL, 
	subtotal INTEGER NOT NULL, 
	discount INTEGER NOT NULL, 
	tax INTEGER NOT NULL, 
	total INTEGER NOT NULL, 
	paid INTEGER NOT NULL, 
	currency VARCHAR(8) NOT NULL, 
	status VARCHAR(20) NOT NULL, 
	source VARCHAR(20) NOT NULL, 
	confidence INTEGER NOT NULL, 
	tags VARCHAR(255) NOT NULL, 
	notes TEXT NOT NULL, 
	ocr_text TEXT NOT NULL, 
	raw_json JSON, 
	file_name VARCHAR(255) NOT NULL, 
	file_path VARCHAR(500) NOT NULL, 
	file_size INTEGER NOT NULL, 
	thumb_color VARCHAR(12) NOT NULL, 
	job_id INTEGER, 
	duplicate_of INTEGER, 
	created_at DATETIME NOT NULL, 
	updated_at DATETIME NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE, 
	FOREIGN KEY(job_id) REFERENCES ocr_jobs (id)
);

DROP TABLE IF EXISTS `subscriptions`;
CREATE TABLE subscriptions (
	id INTEGER NOT NULL AUTO_INCREMENT, 
	user_id INTEGER NOT NULL, 
	plan_id INTEGER, 
	license_key_id INTEGER, 
	status VARCHAR(20) NOT NULL, 
	starts_at DATETIME NOT NULL, 
	ends_at DATETIME, 
	support_until DATETIME, 
	pages_used INTEGER NOT NULL, 
	pages_quota INTEGER NOT NULL, 
	device_id VARCHAR(64) NOT NULL, 
	devices TEXT NOT NULL, 
	notes VARCHAR(255) NOT NULL, 
	created_at DATETIME NOT NULL, 
	updated_at DATETIME NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (user_id), 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE, 
	FOREIGN KEY(plan_id) REFERENCES plans (id), 
	FOREIGN KEY(license_key_id) REFERENCES license_keys (id)
);

DROP TABLE IF EXISTS `invoice_items`;
CREATE TABLE invoice_items (
	id INTEGER NOT NULL AUTO_INCREMENT, 
	invoice_id INTEGER NOT NULL, 
	row_no INTEGER NOT NULL, 
	code VARCHAR(60) NOT NULL, 
	description VARCHAR(300) NOT NULL, 
	qty INTEGER NOT NULL, 
	unit VARCHAR(20) NOT NULL, 
	unit_price INTEGER NOT NULL, 
	discount INTEGER NOT NULL, 
	tax_rate INTEGER NOT NULL, 
	total INTEGER NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(invoice_id) REFERENCES invoices (id) ON DELETE CASCADE
);
