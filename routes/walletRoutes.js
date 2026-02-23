const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const authMiddleware = require('../middleware/authMiddleware');

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
    const connection = await pool.getConnection();

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
        // 2️⃣ Prevent self transfer
        if (senderId === receiverId) {
            return res.status(400).json({ error: "Cannot transfer to yourself" });
        }

        // 3️⃣ Validate receiver exists BEFORE transaction
        const [receiver] = await connection.query(
            'SELECT id FROM users WHERE id = ?',
            [receiverId]
        );

        if (receiver.length === 0) {
            return res.status(400).json({ error: "Receiver does not exist" });
        }


        //itempotency 
        const [existingTransaction] = await connection.query(
            'SELECT * FROM transactions WHERE idempotency_key = ?',
            [idempotencyKey]
        );

if (existingTransaction.length > 0) {
    return res.json({ message: "Transfer already processed" });
}


        await connection.beginTransaction();

        // Lock sender wallet row
        const [senderWallet] = await connection.query(
            'SELECT balance FROM wallets WHERE user_id = ? FOR UPDATE',
            [senderId]
        );

        if (senderWallet.length === 0) {
            throw new Error("Sender wallet not found");
        }

        if (senderWallet[0].balance < amount) {
            throw new Error("Insufficient balance");
        }

        // Deduct from sender
        await connection.query(
            'UPDATE wallets SET balance = balance - ? WHERE user_id = ?',
            [amount, senderId]
        );

        // Add to receiver
        await connection.query(
            'UPDATE wallets SET balance = balance + ? WHERE user_id = ?',
            [amount, receiverId]
        );

        // Insert transaction record
        await connection.query(
            'INSERT INTO transactions (sender_id, receiver_id, amount, status, idempotency_key) VALUES (?, ?, ?, ?, ?)',
            [senderId, receiverId, amount, 'SUCCESS', idempotencyKey]
        );

        await connection.commit();

        res.json({ message: "Transfer successful" });

    } catch (error) {
        await connection.rollback();
        res.status(400).json({ error: error.message });
    } finally {
        connection.release();
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

