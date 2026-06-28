const { validationResult } = require('express-validator');
const pool = require('../config/db');
const { transferMoney, logAudit } = require('../services/transferService');

const deposit = async (req, res, next) => {
    const connection = await pool.getConnection();
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        const { amount, category_id = 8 } = req.body;
        const userId = req.userId;

        await connection.beginTransaction();

        await connection.query(
            'UPDATE wallets SET balance = balance + ? WHERE user_id = ?',
            [amount, userId]
        );

        const [txResult] = await connection.query(
            `INSERT INTO transactions (sender_id, receiver_id, amount, type, status) VALUES (?, ?, ?, 'DEPOSIT', 'SUCCESS')`,
            [userId, userId, amount]
        );

        await connection.query(
            'INSERT INTO transaction_categories (transaction_id, category_id) VALUES (?, ?)',
            [txResult.insertId, category_id]
        );

        await logAudit(userId, 'DEPOSIT', 'transactions', txResult.insertId, { amount }, connection);
        await connection.commit();

        res.json({ message: 'Deposit successful' });
    } catch (error) {
        await connection.rollback();
        next(error);
    } finally {
        connection.release();
    }
};

const withdraw = async (req, res, next) => {
    const connection = await pool.getConnection();
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        const { amount } = req.body;
        const userId = req.userId;

        await connection.beginTransaction();

        const [wallet] = await connection.query(
            'SELECT balance FROM wallets WHERE user_id = ? FOR UPDATE',
            [userId]
        );

        if (wallet.length === 0) return res.status(404).json({ error: 'Wallet not found' });
        if (wallet[0].balance < amount) return res.status(400).json({ error: 'Insufficient balance' });

        await connection.query(
            'UPDATE wallets SET balance = balance - ? WHERE user_id = ?',
            [amount, userId]
        );

        const [txResult] = await connection.query(
            `INSERT INTO transactions (sender_id, receiver_id, amount, type, status) VALUES (?, ?, ?, 'WITHDRAWAL', 'SUCCESS')`,
            [userId, userId, amount]
        );

        await connection.query(
            'INSERT INTO transaction_categories (transaction_id, category_id) VALUES (?, 7)',
            [txResult.insertId]
        );

        await logAudit(userId, 'WITHDRAWAL', 'transactions', txResult.insertId, { amount }, connection);
        await connection.commit();

        res.json({ message: 'Withdrawal successful' });
    } catch (error) {
        await connection.rollback();
        next(error);
    } finally {
        connection.release();
    }
};

const transfer = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        const { receiver, amount, note } = req.body;
        const senderId = req.userId;
        const idempotencyKey = req.headers['idempotency-key'];

        if (!idempotencyKey) return res.status(400).json({ error: 'Idempotency key required' });

        const [receiverUser] = await pool.query(
            'SELECT id FROM users WHERE email = ? OR username = ?',
            [receiver, receiver]
        );
        if (receiverUser.length === 0) return res.status(404).json({ error: 'Receiver not found' });

        const receiverId = receiverUser[0].id;
        if (senderId === receiverId) return res.status(400).json({ error: 'Cannot transfer to yourself' });

        const result = await transferMoney(senderId, receiverId, amount, idempotencyKey, note);
        res.json(result);
    } catch (error) {
        next(error);
    }
};

const getBalance = async (req, res, next) => {
    try {
        const [wallet] = await pool.query(
            'SELECT balance FROM wallets WHERE user_id = ?',
            [req.userId]
        );
        if (wallet.length === 0) return res.status(404).json({ error: 'Wallet not found' });
        res.json({ balance: wallet[0].balance });
    } catch (error) {
        next(error);
    }
};

const getTransactions = async (req, res, next) => {
    try {
        const userId = req.userId;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const offset = (page - 1) * limit;

        const [transactions] = await pool.query(
            `SELECT t.id, t.sender_id, t.receiver_id, t.amount, t.type, t.status, t.note, t.created_at,
                    s.name as sender_name, s.username as sender_username,
                    r.name as receiver_name, r.username as receiver_username,
                    c.name as category, c.icon as category_icon
             FROM transactions t
             LEFT JOIN users s ON t.sender_id = s.id
             LEFT JOIN users r ON t.receiver_id = r.id
             LEFT JOIN transaction_categories tc ON t.id = tc.transaction_id
             LEFT JOIN categories c ON tc.category_id = c.id
             WHERE t.sender_id = ? OR t.receiver_id = ?
             ORDER BY t.created_at DESC
             LIMIT ? OFFSET ?`,
            [userId, userId, limit, offset]
        );

        const [[{ total }]] = await pool.query(
            'SELECT COUNT(*) as total FROM transactions WHERE sender_id = ? OR receiver_id = ?',
            [userId, userId]
        );

        res.json({ transactions, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
    } catch (error) {
        next(error);
    }
};

const getRecentRecipients = async (req, res, next) => {
    try {
        const [rows] = await pool.query(
            `SELECT DISTINCT u.id, u.name, u.username, u.email
             FROM transactions t
             JOIN users u ON t.receiver_id = u.id
             WHERE t.sender_id = ? AND t.type = 'TRANSFER' AND t.status = 'SUCCESS'
             ORDER BY t.created_at DESC LIMIT 5`,
            [req.userId]
        );
        res.json({ recipients: rows });
    } catch (error) {
        next(error);
    }
};

module.exports = { deposit, withdraw, transfer, getBalance, getTransactions, getRecentRecipients };
