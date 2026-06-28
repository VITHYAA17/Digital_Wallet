const cron = require('node-cron');
const pool = require('../config/db');
const { processWebhookDeliveries } = require('../services/webhookService');

// Every 10 minutes — resolve stuck PROCESSING transactions
cron.schedule('*/10 * * * *', async () => {
    try {
        const [stuck] = await pool.query(
            `SELECT * FROM transactions
             WHERE status = 'PROCESSING'
             AND updated_at < DATE_SUB(NOW(), INTERVAL 10 MINUTE)`
        );

        for (const tx of stuck) {
            const connection = await pool.getConnection();
            try {
                await connection.beginTransaction();

                await connection.query(
                    "UPDATE transactions SET status = 'FAILED' WHERE id = ?",
                    [tx.id]
                );

                // Reverse deducted amount if transfer was mid-way
                if (tx.type === 'TRANSFER') {
                    await connection.query(
                        'UPDATE wallets SET balance = balance + ? WHERE user_id = ?',
                        [tx.amount, tx.sender_id]
                    );
                }

                await connection.query(
                    `INSERT INTO audit_logs (user_id, action, entity, entity_id, meta)
                     VALUES (?, 'TRANSACTION_AUTO_FAILED', 'transactions', ?, ?)`,
                    [tx.sender_id, tx.id, JSON.stringify({ reason: 'Stuck in PROCESSING > 10 min', amount: tx.amount })]
                );

                await connection.commit();
                console.log(`[STUCK TX] Transaction #${tx.id} → FAILED + reversed ₹${tx.amount}`);
            } catch (err) {
                await connection.rollback();
                console.error(`[STUCK TX ERROR] #${tx.id}:`, err.message);
            } finally {
                connection.release();
            }
        }
    } catch (error) {
        console.error('[JOB ERROR] Stuck transaction resolver:', error.message);
    }
});

// Every 5 minutes — retry failed webhook deliveries
cron.schedule('*/5 * * * *', async () => {
    try {
        await processWebhookDeliveries();
    } catch (error) {
        console.error('[JOB ERROR] Webhook retry:', error.message);
    }
});

// Daily at midnight — cleanup expired refresh tokens
cron.schedule('0 0 * * *', async () => {
    try {
        const [result] = await pool.query('DELETE FROM refresh_tokens WHERE expires_at < NOW()');
        console.log(`[CLEANUP] Removed ${result.affectedRows} expired refresh tokens`);
    } catch (error) {
        console.error('[JOB ERROR] Cleanup:', error.message);
    }
});

console.log('[JOBS] Part 2 background jobs started');
