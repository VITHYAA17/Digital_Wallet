const { transferMoney } = require('../services/transferService');
const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const authMiddleware = require('../middleware/authMiddleware');

router.post('/deposit', authMiddleware, async (req, res) => {
    const connection = await pool.getConnection();

    try {
        const { amount } = req.body;
        const userId = req.userId;

        if (!amount || amount <= 0) {
            return res.status(400).json({ error: "Invalid deposit amount" });
        }

        await connection.beginTransaction();

        await connection.query(
            'UPDATE wallets SET balance = balance + ? WHERE user_id = ?',
            [amount, userId]
        );

        await connection.query(
            'INSERT INTO transactions (sender_id, receiver_id, amount, status, idempotency_key) VALUES (?, ?, ?, ?,?)',
            [userId, userId, amount, 'DEPOSIT',null]
        );

        await connection.commit();

        res.json({ message: "Deposit successful" });

    } catch (error) {
        await connection.rollback();
        console.error("DEPOSIT ERROR:", error.message);
        res.status(500).json({ error: "Deposit failed" });
    } finally {
        connection.release();
    }
});

router.get('/balance', authMiddleware, async (req, res) => {
    try {
        const [wallet] = await pool.query(
            'SELECT balance FROM wallets WHERE user_id = ?',
            [req.userId]
        );

        res.json({ balance: wallet[0].balance });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to fetch balance" });
    }
});

router.post('/transfer', authMiddleware, async (req, res) => {
    try {
        const { receiverId, amount } = req.body;
        const senderId = req.userId;
        const idempotencyKey = req.headers['idempotency-key'];

        if (!idempotencyKey) {
            return res.status(400).json({ error: "Idempotency key required" });
        }

        if (!receiverId || !amount || amount <= 0) {
            return res.status(400).json({ error: "Invalid transfer data" });
        }

        if (senderId === receiverId) {
            return res.status(400).json({ error: "Cannot transfer to yourself" });
        }

        const result = await transferMoney(
            senderId,
            receiverId,
            amount,
            idempotencyKey
        );

        res.json(result);

    } catch (error) {
        res.status(400).json({ error: "Transfer failed" });
    }
});


router.get('/transactions', authMiddleware, async (req, res) => {
    try {
        const userId = req.userId;

        const [transactions] = await pool.query(
            `SELECT sender_id, receiver_id, amount, status, created_at
             FROM transactions
             WHERE sender_id = ? OR receiver_id = ?
             ORDER BY created_at DESC`,
            [userId, userId]
        );

        res.json({ transactions });

    } catch (error) {
        res.status(500).json({ error: "Failed to fetch transactions" });
    }
});

module.exports = router;

