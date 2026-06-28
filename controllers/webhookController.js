const pool = require('../config/db');

const registerWebhook = async (req, res, next) => {
    try {
        const { url, secret } = req.body;
        if (!url) return res.status(400).json({ error: 'URL is required' });

        const [existing] = await pool.query(
            'SELECT id FROM webhooks WHERE user_id = ? AND url = ?',
            [req.userId, url]
        );
        if (existing.length > 0) return res.status(409).json({ error: 'Webhook URL already registered' });

        const [result] = await pool.query(
            'INSERT INTO webhooks (user_id, url, secret) VALUES (?, ?, ?)',
            [req.userId, url, secret || null]
        );

        res.status(201).json({ message: 'Webhook registered', id: result.insertId });
    } catch (error) { next(error); }
};

const getWebhooks = async (req, res, next) => {
    try {
        const [rows] = await pool.query(
            'SELECT id, url, is_active, created_at FROM webhooks WHERE user_id = ?',
            [req.userId]
        );
        res.json({ webhooks: rows });
    } catch (error) { next(error); }
};

const deleteWebhook = async (req, res, next) => {
    try {
        await pool.query(
            'UPDATE webhooks SET is_active = FALSE WHERE id = ? AND user_id = ?',
            [req.params.id, req.userId]
        );
        res.json({ message: 'Webhook removed' });
    } catch (error) { next(error); }
};

const getDeliveries = async (req, res, next) => {
    try {
        const [rows] = await pool.query(
            `SELECT wd.id, wd.transaction_id, wd.status, wd.attempts, wd.last_attempt_at, w.url
             FROM webhook_deliveries wd
             JOIN webhooks w ON wd.webhook_id = w.id
             WHERE w.user_id = ?
             ORDER BY wd.created_at DESC LIMIT 20`,
            [req.userId]
        );
        res.json({ deliveries: rows });
    } catch (error) { next(error); }
};

const getFraudFlags = async (req, res, next) => {
    try {
        const [rows] = await pool.query(
            `SELECT ff.id, ff.rule_triggered, ff.action_taken, ff.resolved, ff.created_at,
                    t.amount, t.type, t.status
             FROM fraud_flags ff
             LEFT JOIN transactions t ON ff.transaction_id = t.id
             WHERE ff.user_id = ?
             ORDER BY ff.created_at DESC`,
            [req.userId]
        );
        res.json({ flags: rows });
    } catch (error) { next(error); }
};

module.exports = { registerWebhook, getWebhooks, deleteWebhook, getDeliveries, getFraudFlags };
