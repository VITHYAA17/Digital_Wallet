CREATE DATABASE IF NOT EXISTS digital_wallet;
USE digital_wallet;

CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) NOT NULL UNIQUE,
    username VARCHAR(50) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS wallets (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL UNIQUE,
    balance DECIMAL(15,2) DEFAULT 0.00,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS transactions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    sender_id INT NOT NULL,
    receiver_id INT NOT NULL,
    amount DECIMAL(15,2) NOT NULL,
    type ENUM('DEPOSIT','WITHDRAWAL','TRANSFER') NOT NULL,
    status ENUM('INITIATED','PROCESSING','SUCCESS','FAILED','REVERSED') DEFAULT 'INITIATED',
    note VARCHAR(255),
    idempotency_key VARCHAR(255) UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (sender_id) REFERENCES users(id),
    FOREIGN KEY (receiver_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT,
    action VARCHAR(100) NOT NULL,
    entity VARCHAR(50),
    entity_id INT,
    meta JSON,
    ip_address VARCHAR(45),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS categories (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    icon VARCHAR(10),
    color VARCHAR(10)
);

INSERT IGNORE INTO categories (id, name, icon, color) VALUES
(1, 'Food & Dining', '🍔', '#FF6B6B'),
(2, 'Transport', '🚗', '#4ECDC4'),
(3, 'Shopping', '🛍️', '#45B7D1'),
(4, 'Entertainment', '🎬', '#96CEB4'),
(5, 'Bills & Utilities', '💡', '#FFEAA7'),
(6, 'Transfer', '💸', '#DDA0DD'),
(7, 'Withdrawal', '🏧', '#98D8C8'),
(8, 'Other', '📦', '#B0B0B0');

CREATE TABLE IF NOT EXISTS transaction_categories (
    id INT AUTO_INCREMENT PRIMARY KEY,
    transaction_id INT NOT NULL,
    category_id INT NOT NULL,
    FOREIGN KEY (transaction_id) REFERENCES transactions(id),
    FOREIGN KEY (category_id) REFERENCES categories(id)
);

CREATE TABLE IF NOT EXISTS budgets (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    category_id INT NOT NULL,
    amount DECIMAL(15,2) NOT NULL,
    month TINYINT NOT NULL,
    year SMALLINT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_budget (user_id, category_id, month, year),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (category_id) REFERENCES categories(id)
);

CREATE TABLE IF NOT EXISTS scheduled_payments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    name VARCHAR(100) NOT NULL,
    amount DECIMAL(15,2),
    is_variable_amount BOOLEAN DEFAULT FALSE,
    schedule_type ENUM('FIXED_DATE','FIXED_INTERVAL','APPROXIMATE_DATE') NOT NULL,
    schedule_value INT NOT NULL,
    next_due_date DATE NOT NULL,
    auto_pay BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS payment_reminders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    scheduled_payment_id INT NOT NULL,
    reminder_date DATE NOT NULL,
    type ENUM('3_DAYS','1_DAY','DUE_DAY','3_DAYS_OVERDUE','1_WEEK_OVERDUE') NOT NULL,
    sent_at TIMESTAMP NULL,
    status ENUM('PENDING','SENT','FAILED') DEFAULT 'PENDING',
    FOREIGN KEY (scheduled_payment_id) REFERENCES scheduled_payments(id)
);

CREATE TABLE IF NOT EXISTS scheduled_payment_history (
    id INT AUTO_INCREMENT PRIMARY KEY,
    scheduled_payment_id INT NOT NULL,
    transaction_id INT,
    amount_paid DECIMAL(15,2),
    due_date DATE NOT NULL,
    paid_at TIMESTAMP NULL,
    status ENUM('PAID','MISSED','PENDING') DEFAULT 'PENDING',
    FOREIGN KEY (scheduled_payment_id) REFERENCES scheduled_payments(id),
    FOREIGN KEY (transaction_id) REFERENCES transactions(id)
);

CREATE TABLE IF NOT EXISTS fraud_flags (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    transaction_id INT,
    rule_triggered VARCHAR(100) NOT NULL,
    action_taken ENUM('FLAGGED','BLOCKED','ALERTED') NOT NULL,
    resolved BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (transaction_id) REFERENCES transactions(id)
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    token VARCHAR(500) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS webhooks (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    url VARCHAR(500) NOT NULL,
    secret VARCHAR(255),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id INT AUTO_INCREMENT PRIMARY KEY,
    webhook_id INT NOT NULL,
    transaction_id INT NOT NULL,
    payload JSON NOT NULL,
    status ENUM('PENDING','SUCCESS','FAILED') DEFAULT 'PENDING',
    attempts INT DEFAULT 0,
    last_attempt_at TIMESTAMP NULL,
    next_retry_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (webhook_id) REFERENCES webhooks(id),
    FOREIGN KEY (transaction_id) REFERENCES transactions(id)
);
