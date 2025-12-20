const express = require('express');
const mysql = require('mysql2/promise');
const session = require('express-session');
const path = require('path');
const cors = require('cors');
const mysql = require("mysql2");
require('dotenv').config();

const app = express();

/* =======================
   MIDDLEWARE
======================= */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// CORS (Frontend on Vercel)
app.use(cors({
    origin: 'https://justques.vercel.app',
    credentials: true
}));

/* =======================
   SESSION CONFIG (RENDER SAFE)
======================= */
app.use(session({
    name: 'justques-session',
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 3600000,     // 1 hour
        secure: true,        // HTTPS (Render)
        sameSite: 'none'     // Cross-origin (Vercel frontend)
    }
}));

/* =======================
   DATABASE (CLOUD MYSQL)
======================= */
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    port: process.env.DB_PORT,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
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
   RESET USER (CHALLENGE)
======================= */
app.post('/api/reset-user', async (req, res) => {
    const { email } = req.body;

    try {
        await pool.query(
            'UPDATE users SET wallet_balance = 0, welcome_bonus_claimed = FALSE WHERE email = ?',
            [email]
        );

        await pool.query(
            'DELETE FROM bonus_transactions WHERE user_id IN (SELECT id FROM users WHERE email = ?)',
            [email]
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

/* =======================
   SERVER START (RENDER)
======================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
