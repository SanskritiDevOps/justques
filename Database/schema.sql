CREATE DATABASE IF NOT EXISTS shopping_db;
USE shopping_db;

-- Drop old tables so the schema works every time
DROP TABLE IF EXISTS bonus_transactions;
DROP TABLE IF EXISTS users;

-- Users Table
CREATE TABLE users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,  -- storing plain text now
    wallet_balance DECIMAL(10, 2) DEFAULT 0.00,
    welcome_bonus_claimed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Bonus Transactions Table (for tracking)
CREATE TABLE bonus_transactions (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    bonus_type VARCHAR(50) NOT NULL,
    claimed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Insert test user with plain password
INSERT INTO users (username, email, password, wallet_balance, welcome_bonus_claimed)
VALUES ('testuser', 'test@example.com', 'password123', 0, FALSE);
