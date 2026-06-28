const pool = require('../config/db');
const { runFraudChecks } = require('./fraudService');
const { fireWebhook } = require('./webhookService');

const logAudit = async (userId, action, entity, entityId, meta, connection) => {
    await connection.query(
        'INSERT INTO audit_logs (user_id, action, entity, entity_id, meta) VALUES (?, ?, ?, ?, ?)',
        [userId, action, entity, entityId, JSON.stringify(meta)]
    );
};

const transferMoney = async (senderId, receiverId, amount, idempotencyKey, note = null) => {
    const connection = await pool.getConnection();
    try {
        const [existing] = await connection.query(
            'SELECT * FROM transactions WHERE idempotency_key = ?',
            [idempotencyKey]
        );
        if (existing.length > 0) return { message: 'Transfer already processed' };

        await connection.beginTransaction();

        const [senderWallet] = await connection.query(
            'SELECT balance FROM wallets WHERE user_id = ? FOR UPDATE',
            [senderId]
        );
        if (senderWallet.length === 0) throw new Error('Sender wallet not found');
        if (senderWallet[0].balance < amount) throw new Error('Insufficient balance');

        // Create transaction in PROCESSING state
        const [txResult] = await connection.query(
            `INSERT INTO transactions (sender_id, receiver_id, amount, type, status, note, idempotency_key)
             VALUES (?, ?, ?, 'TRANSFER', 'PROCESSING', ?, ?)`,
            [senderId, receiverId, amount, note, idempotencyKey]
        );
        const transactionId = txResult.insertId;

        // Run fraud checks — may throw if BLOCKED
        await runFraudChecks(senderId, receiverId, amount, transactionId, connection);

        // Move money
        await connection.query('UPDATE wallets SET balance = balance - ? WHERE user_id = ?', [amount, senderId]);
        await connection.query('UPDATE wallets SET balance = balance + ? WHERE user_id = ?', [amount, receiverId]);

        // Mark SUCCESS
        await connection.query("UPDATE transactions SET status = 'SUCCESS' WHERE id = ?", [transactionId]);

        await logAudit(senderId, 'TRANSFER_SUCCESS', 'transactions', transactionId, { amount, receiverId }, connection);
        await connection.commit();

        // Fire webhook after commit (non-blocking)
        fireWebhook(senderId, transactionId, {
            event: 'transfer.success',
            transactionId,
            senderId,
            receiverId,
            amount,
            note,
            timestamp: new Date().toISOString()
        }).catch(err => console.error('[WEBHOOK FIRE ERROR]', err.message));

        return { message: 'Transfer successful', transactionId };
    } catch (error) {
        await connection.rollback();
        console.error('TRANSFER ERROR:', error.message);
        throw error;
    } finally {
        connection.release();
    }
};

module.exports = { transferMoney, logAudit };
