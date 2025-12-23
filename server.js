const express = require('express');
const mysql = require('mysql2/promise');
const session = require('express-session');
const path = require('path');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

app.use(cors({
    origin: true,
    credentials: true
}));

app.use(session({
    name: 'justques-session',
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    proxy: true,
    cookie: {
        maxAge: 3600000,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
        httpOnly: true
    }
}));

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 4000,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    ssl: {
        minVersion: 'TLSv1.2',
        rejectUnauthorized: true
    }
});

/* =======================
   SIGNUP (NEW)
======================= */
app.post('/api/signup', async (req, res) => {
    const { username, email, password } = req.body;

    try {
        // Check if email already exists
        const [existingUsers] = await pool.query(
            'SELECT * FROM users WHERE email = ?',
            [email]
        );

        if (existingUsers.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Email already registered'
            });
        }

        // Check if username already exists
        const [existingUsername] = await pool.query(
            'SELECT * FROM users WHERE username = ?',
            [username]
        );

        if (existingUsername.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Username already taken'
            });
        }

        // Create new user
        await pool.query(
            'INSERT INTO users (username, email, password, wallet_balance, welcome_bonus_claimed) VALUES (?, ?, ?, 0, FALSE)',
            [username, email, password]
        );

        res.json({
            success: true,
            message: 'Account created successfully! Please login.'
        });

    } catch (error) {
        console.error('Signup error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

/* =======================
   LOGIN (RACE CONDITION)
======================= */
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        const [users] = await pool.query(
            'SELECT * FROM users WHERE email = ?',
            [email]
        );

        if (users.length === 0) {
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials'
            });
        }

        const user = users[0];

        if (password !== user.password) {
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials'
            });
        }

        req.session.userId = user.id;
        req.session.username = user.username;

        // ⚠️ INTENTIONALLY VULNERABLE RACE CONDITION
        if (!user.welcome_bonus_claimed) {
            await new Promise(resolve => setTimeout(resolve, 100));

            await pool.query(
                'UPDATE users SET wallet_balance = wallet_balance + 100 WHERE id = ?',
                [user.id]
            );

            await pool.query(
                'UPDATE users SET welcome_bonus_claimed = TRUE WHERE id = ?',
                [user.id]
            );

            await pool.query(
                'INSERT INTO bonus_transactions (user_id, amount, bonus_type) VALUES (?, 100, ?)',
                [user.id, 'WELCOME_BONUS']
            );

            const [updatedUser] = await pool.query(
                'SELECT wallet_balance FROM users WHERE id = ?',
                [user.id]
            );

            return res.json({
                success: true,
                message: 'Login successful! Welcome bonus of ₹100 credited!',
                username: user.username,
                walletBalance: updatedUser[0].wallet_balance,
                bonusReceived: true
            });
        }

        res.json({
            success: true,
            message: 'Login successful!',
            username: user.username,
            walletBalance: user.wallet_balance,
            bonusReceived: false
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

/* =======================
   WALLET
======================= */
app.get('/api/wallet', async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({
            success: false,
            message: 'Not authenticated'
        });
    }

    try {
        const [users] = await pool.query(
            'SELECT wallet_balance, welcome_bonus_claimed FROM users WHERE id = ?',
            [req.session.userId]
        );

        if (users.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        const [bonusCount] = await pool.query(
            'SELECT COUNT(*) as count FROM bonus_transactions WHERE user_id = ? AND bonus_type = ?',
            [req.session.userId, 'WELCOME_BONUS']
        );

        res.json({
            success: true,
            walletBalance: Number(users[0].wallet_balance),
            bonusClaimed: users[0].welcome_bonus_claimed,
            bonusClaimCount: bonusCount[0].count
        });

    } catch (error) {
        console.error('Wallet error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

/* =======================
   LOGOUT
======================= */
app.post('/api/logout', (req, res) => {
    req.session.destroy(() => {
        res.json({ success: true, message: 'Logged out successfully' });
    });
});

/* =======================
   RESET USER (UPDATED)
======================= */
app.post('/api/reset-user', async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({
            success: false,
            message: 'Not authenticated'
        });
    }

    try {
        // Reset current logged-in user
        await pool.query(
            'UPDATE users SET wallet_balance = 0, welcome_bonus_claimed = FALSE WHERE id = ?',
            [req.session.userId]
        );

        await pool.query(
            'DELETE FROM bonus_transactions WHERE user_id = ?',
            [req.session.userId]
        );

        res.json({
            success: true,
            message: 'User reset successfully'
        });

    } catch (error) {
        console.error('Reset error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

/* =======================
   STATIC PAGES
======================= */
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/dashboard', (req, res) => {
    if (!req.session.userId) {
        return res.redirect('/');
    }
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});