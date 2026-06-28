const pool = require('../config/db');

const FRAUD_RULES = [
    {
        name: 'LARGE_TRANSFER',
        description: 'Transfer exceeds ₹50,000',
        check: async (senderId, amount) => amount > 50000,
        action: 'FLAGGED'
    },
    {
        name: 'HIGH_FREQUENCY',
        description: 'More than 10 transfers in 1 hour',
        check: async (senderId, amount, connection) => {
            const [rows] = await connection.query(
                `SELECT COUNT(*) as count FROM transactions
                 WHERE sender_id = ? AND type = 'TRANSFER'
                 AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)`,
                [senderId]
            );
            return rows[0].count >= 10;
        },
        action: 'BLOCKED'
    },
    {
        name: 'RAPID_LARGE_SPEND',
        description: 'Spent more than ₹1,00,000 in last 24 hours',
        check: async (senderId, amount, connection) => {
            const [rows] = await connection.query(
                `SELECT COALESCE(SUM(amount), 0) as total FROM transactions
                 WHERE sender_id = ? AND type = 'TRANSFER' AND status = 'SUCCESS'
                 AND created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)`,
                [senderId]
            );
            return (parseFloat(rows[0].total) + parseFloat(amount)) > 100000;
        },
        action: 'FLAGGED'
    },
    {
        name: 'NEW_RECEIVER_LARGE_AMOUNT',
        description: 'Large transfer to someone never paid before',
        check: async (senderId, amount, connection, receiverId) => {
            if (amount < 10000) return false;
            const [rows] = await connection.query(
                `SELECT COUNT(*) as count FROM transactions
                 WHERE sender_id = ? AND receiver_id = ? AND status = 'SUCCESS'`,
                [senderId, receiverId]
            );
            return rows[0].count === 0;
        },
        action: 'FLAGGED'
    }
];

const runFraudChecks = async (senderId, receiverId, amount, transactionId, connection) => {
    for (const rule of FRAUD_RULES) {
        let triggered = false;

        if (rule.name === 'LARGE_TRANSFER') triggered = await rule.check(senderId, amount);
        else if (rule.name === 'HIGH_FREQUENCY') triggered = await rule.check(senderId, amount, connection);
        else if (rule.name === 'RAPID_LARGE_SPEND') triggered = await rule.check(senderId, amount, connection);
        else if (rule.name === 'NEW_RECEIVER_LARGE_AMOUNT') triggered = await rule.check(senderId, amount, connection, receiverId);

        if (triggered) {
            await connection.query(
                'INSERT INTO fraud_flags (user_id, transaction_id, rule_triggered, action_taken) VALUES (?, ?, ?, ?)',
                [senderId, transactionId, rule.name, rule.action]
            );
            console.log(`[FRAUD] Rule triggered: ${rule.name} | Action: ${rule.action} | User: ${senderId}`);
            if (rule.action === 'BLOCKED') {
                throw new Error(`Transaction blocked: ${rule.description}`);
            }
        }
    }
};

module.exports = { runFraudChecks };
