const axios = require('axios');
const pool = require('../config/db');

const RETRY_DELAYS = [1, 5, 30]; // minutes

const fireWebhook = async (userId, transactionId, payload) => {
    const [webhooks] = await pool.query(
        'SELECT * FROM webhooks WHERE user_id = ? AND is_active = TRUE',
        [userId]
    );

    for (const webhook of webhooks) {
        const [existing] = await pool.query(
            'SELECT id FROM webhook_deliveries WHERE webhook_id = ? AND transaction_id = ?',
            [webhook.id, transactionId]
        );
        if (existing.length > 0) continue;

        await pool.query(
            `INSERT INTO webhook_deliveries (webhook_id, transaction_id, payload, status, next_retry_at)
             VALUES (?, ?, ?, 'PENDING', NOW())`,
            [webhook.id, transactionId, JSON.stringify(payload)]
        );
    }

    await processWebhookDeliveries(userId);
};

const processWebhookDeliveries = async (userId = null) => {
    const query = userId
        ? `SELECT wd.*, w.url, w.secret FROM webhook_deliveries wd
           JOIN webhooks w ON wd.webhook_id = w.id
           WHERE wd.status IN ('PENDING','FAILED') AND wd.attempts < 3
           AND wd.next_retry_at <= NOW() AND w.user_id = ?`
        : `SELECT wd.*, w.url, w.secret FROM webhook_deliveries wd
           JOIN webhooks w ON wd.webhook_id = w.id
           WHERE wd.status IN ('PENDING','FAILED') AND wd.attempts < 3
           AND wd.next_retry_at <= NOW()`;

    const [deliveries] = await pool.query(query, userId ? [userId] : []);

    for (const delivery of deliveries) {
        try {
            await axios.post(delivery.url, JSON.parse(delivery.payload), {
                timeout: 5000,
                headers: {
                    'Content-Type': 'application/json',
                    'X-Webhook-Secret': delivery.secret || ''
                }
            });

            await pool.query(
                "UPDATE webhook_deliveries SET status = 'SUCCESS', attempts = attempts + 1, last_attempt_at = NOW() WHERE id = ?",
                [delivery.id]
            );
            console.log(`[WEBHOOK] Delivered to ${delivery.url}`);
        } catch (err) {
            const newAttempts = delivery.attempts + 1;
            const delayMinutes = RETRY_DELAYS[newAttempts - 1] || null;
            const nextRetry = delayMinutes
                ? new Date(Date.now() + delayMinutes * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ')
                : null;

            const newStatus = newAttempts >= 3 ? 'FAILED' : 'FAILED';

            await pool.query(
                `UPDATE webhook_deliveries 
                 SET status = ?, attempts = ?, last_attempt_at = NOW(), next_retry_at = ?
                 WHERE id = ?`,
                [newStatus, newAttempts, nextRetry, delivery.id]
            );
            console.log(`[WEBHOOK] Failed delivery to ${delivery.url} — attempt ${newAttempts}/3`);
        }
    }
};

module.exports = { fireWebhook, processWebhookDeliveries };
