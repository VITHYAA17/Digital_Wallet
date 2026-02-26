const pool = require('../config/db');

const transferMoney = async (senderId, receiverId, amount, idempotencyKey) => {
    const connection = await pool.getConnection();

    try {
        // Check idempotency first
        const [existingTransaction] = await connection.query(
            'SELECT * FROM transactions WHERE idempotency_key = ?',
            [idempotencyKey]
        );

        if (existingTransaction.length > 0) {
            return { message: "Transfer already processed" };
        }

        await connection.beginTransaction();

        // Lock sender row
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

        // Deduct sender
        await connection.query(
            'UPDATE wallets SET balance = balance - ? WHERE user_id = ?',
            [amount, senderId]
        );

        // Credit receiver
        await connection.query(
            'UPDATE wallets SET balance = balance + ? WHERE user_id = ?',
            [amount, receiverId]
        );

        // Insert transaction
        await connection.query(
            'INSERT INTO transactions (sender_id, receiver_id, amount, status, idempotency_key) VALUES (?, ?, ?, ?, ?)',
            [senderId, receiverId, amount, 'SUCCESS', idempotencyKey]
        );

        await connection.commit();

        return { message: "Transfer successful" };

    } catch (error) {
        await connection.rollback();
        console.error("TRANSFER ERROR:", error.message);
        throw error;
    } finally {
        connection.release();
    }
};

module.exports = { transferMoney };