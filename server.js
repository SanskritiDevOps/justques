const express = require('express');
const mysql = require('mysql2/promise');
const session = require('express-session');
const path = require('path');

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Session configuration
app.use(session({
    secret: 'vulnerable-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 3600000 } // 1 hour
}));

// Database connection pool
const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: 'suvidha@05',
    database: 'shopping_db',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// ============================================
// VULNERABLE LOGIN ENDPOINT - Race Condition
// ============================================
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    
    try {
        // Step 1: Find user
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
        
        // Step 2: Verify password
       
        const passwordMatch = password === user.password;
        if (!passwordMatch) {
            return res.status(401).json({ 
                success: false, 
                message: 'Invalid credentials' 
            });
        }
        
        // Step 3: Set session
        req.session.userId = user.id;
        req.session.username = user.username;
        
        // ⚠️ VULNERABLE PART - Race Condition Here ⚠️
        // Step 4: Check if welcome bonus already claimed
        if (!user.welcome_bonus_claimed) {
            
            // Simulate processing delay (network/database latency)
            // This creates the race condition window
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // Step 5: Add welcome bonus to wallet
            await pool.query(
                'UPDATE users SET wallet_balance = wallet_balance + 100 WHERE id = ?',
                [user.id]
            );
            
            // Step 6: Mark welcome bonus as claimed
            await pool.query(
                'UPDATE users SET welcome_bonus_claimed = TRUE WHERE id = ?',
                [user.id]
            );
            
            // Step 7: Record bonus transaction
            await pool.query(
                'INSERT INTO bonus_transactions (user_id, amount, bonus_type) VALUES (?, 100, ?)',
                [user.id, 'WELCOME_BONUS']
            );
            
            // Step 8: Get updated balance
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
        
        // If bonus already claimed
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

// Get user wallet balance
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
        
        // Get bonus transaction count
        const [bonusCount] = await pool.query(
            'SELECT COUNT(*) as count FROM bonus_transactions WHERE user_id = ? AND bonus_type = ?',
            [req.session.userId, 'WELCOME_BONUS']
        );
        
        res.json({ 
            success: true,
            walletBalance: parseFloat(users[0].wallet_balance) || 0,
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

// Logout endpoint
app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true, message: 'Logged out successfully' });
});

// Reset user for testing (admin only - for challenge purposes)
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

// Serve HTML pages
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/dashboard', (req, res) => {
    if (!req.session.userId) {
        return res.redirect('/');
    }
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Start server
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Vulnerable server running on http://localhost:${PORT}`);
    console.log(`Test credentials: email: test@example.com, password: password123`);
});