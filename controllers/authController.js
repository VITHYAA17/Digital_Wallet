const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { validationResult } = require('express-validator');
const pool = require('../config/db');
const { logAudit } = require('../services/transferService');

const register = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        const { name, username, email, password } = req.body;

        const [existing] = await pool.query('SELECT id FROM users WHERE email = ? OR username = ?', [email, username]);
        if (existing.length > 0) return res.status(409).json({ error: 'Email or username already exists' });

        const hashedPassword = await bcrypt.hash(password, 10);

        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            const [result] = await connection.query(
                'INSERT INTO users (name, username, email, password_hash) VALUES (?, ?, ?, ?)',
                [name, username, email, hashedPassword]
            );
            const userId = result.insertId;
            await connection.query('INSERT INTO wallets (user_id, balance) VALUES (?, 0.00)', [userId]);
            await connection.commit();
            res.status(201).json({ message: 'User registered successfully' });
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
    } catch (error) {
        next(error);
    }
};

const login = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        const { email, password } = req.body;
        const [users] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);

        if (users.length === 0 || !(await bcrypt.compare(password, users[0].password_hash))) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const user = users[0];
        if (!user.is_active) return res.status(403).json({ error: 'Account is suspended' });

        const accessToken = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '1h' });
        const refreshToken = jwt.sign({ userId: user.id }, process.env.JWT_REFRESH_SECRET, { expiresIn: '7d' });

        await pool.query(
            'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 7 DAY))',
            [user.id, refreshToken]
        );

        res.json({ message: 'Login successful', accessToken, refreshToken, user: { id: user.id, name: user.name, email: user.email, username: user.username } });
    } catch (error) {
        next(error);
    }
};

const refreshToken = async (req, res, next) => {
    try {
        const { token } = req.body;
        if (!token) return res.status(401).json({ error: 'Refresh token required' });

        const [rows] = await pool.query(
            'SELECT * FROM refresh_tokens WHERE token = ? AND expires_at > NOW()',
            [token]
        );
        if (rows.length === 0) return res.status(403).json({ error: 'Invalid or expired refresh token' });

        const decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
        const accessToken = jwt.sign({ userId: decoded.userId }, process.env.JWT_SECRET, { expiresIn: '1h' });

        res.json({ accessToken });
    } catch (error) {
        next(error);
    }
};

const logout = async (req, res, next) => {
    try {
        const { token } = req.body;
        if (token) await pool.query('DELETE FROM refresh_tokens WHERE token = ?', [token]);
        res.json({ message: 'Logged out successfully' });
    } catch (error) {
        next(error);
    }
};

const getProfile = async (req, res, next) => {
    try {
        const [users] = await pool.query(
            'SELECT id, name, username, email, created_at FROM users WHERE id = ?',
            [req.userId]
        );
        if (users.length === 0) return res.status(404).json({ error: 'User not found' });
        res.json({ user: users[0] });
    } catch (error) {
        next(error);
    }
};

module.exports = { register, login, refreshToken, logout, getProfile };
