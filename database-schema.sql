-- Schengen Calc D1 Database Schema
-- Enhanced schema with Square subscription integration

-- Users table for authentication and profile management
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    password_hash TEXT, -- For future password authentication
    square_customer_id TEXT UNIQUE, -- Square customer ID
    subscription_active BOOLEAN DEFAULT false,
    email_verified BOOLEAN DEFAULT false,
    created_at TEXT NOT NULL,
    updated_at TEXT DEFAULT NULL,
    last_login_at TEXT DEFAULT NULL
);

-- Subscriptions table for managing Square subscriptions
CREATE TABLE IF NOT EXISTS subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    square_subscription_id TEXT UNIQUE,
    plan_type TEXT NOT NULL, -- 'pro-monthly', 'pro-annual', 'business-monthly', 'business-annual'
    status TEXT NOT NULL, -- 'ACTIVE', 'CANCELED', 'PAUSED', 'PENDING'
    price_amount INTEGER NOT NULL, -- Price in pence (299 for £2.99)
    currency TEXT DEFAULT 'GBP',
    frequency TEXT NOT NULL, -- 'MONTHLY', 'ANNUALLY'
    started_at TEXT,
    ended_at TEXT DEFAULT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT DEFAULT NULL,
    FOREIGN KEY (user_id) REFERENCES users (id)
);

-- Payments table for tracking payment history
CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    subscription_id TEXT, -- Square subscription ID
    amount INTEGER NOT NULL, -- Amount in pence
    currency TEXT DEFAULT 'GBP',
    status TEXT NOT NULL, -- 'SUCCESS', 'FAILED', 'PENDING', 'REFUNDED'
    square_payment_id TEXT,
    failure_reason TEXT DEFAULT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users (id)
);

-- Travel calculations table for saving user calculations
CREATE TABLE IF NOT EXISTS travel_calculations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    calculation_name TEXT,
    passport_country TEXT NOT NULL,
    entry_date TEXT NOT NULL,
    exit_date TEXT DEFAULT NULL,
    total_days INTEGER,
    schengen_days INTEGER,
    is_compliant BOOLEAN,
    calculation_data TEXT, -- JSON data of the full calculation
    created_at TEXT NOT NULL,
    updated_at TEXT DEFAULT NULL,
    FOREIGN KEY (user_id) REFERENCES users (id)
);

-- User sessions table for authentication management
CREATE TABLE IF NOT EXISTS user_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    session_token TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_used_at TEXT DEFAULT NULL,
    ip_address TEXT,
    user_agent TEXT,
    FOREIGN KEY (user_id) REFERENCES users (id)
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_square_customer ON users(square_customer_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_square_id ON subscriptions(square_subscription_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_subscription ON payments(subscription_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_travel_calculations_user ON travel_calculations(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id);

-- Insert default admin users
INSERT OR IGNORE INTO users (id, email, first_name, last_name, square_customer_id, subscription_active, email_verified, created_at) 
VALUES 
(1, 'john@shengencalc.com', 'John', 'Admin', NULL, true, true, datetime('now')),
(2, 'christine@shengencalc.com', 'Christine', 'Admin', NULL, true, true, datetime('now'));
