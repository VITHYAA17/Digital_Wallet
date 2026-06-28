const cron = require('node-cron');
const pool = require('../config/db');

// Every morning at 8am — check upcoming bills and send reminders
cron.schedule('0 8 * * *', async () => {
    console.log('[JOB] Running bill reminder check...');
    try {
        const [schedules] = await pool.query(
            `SELECT sp.*, u.name, u.email FROM scheduled_payments sp
             JOIN users u ON sp.user_id = u.id
             WHERE sp.is_active = TRUE`
        );

        const today = new Date();

        for (const schedule of schedules) {
            const due = new Date(schedule.next_due_date);
            const daysUntil = Math.ceil((due - today) / (1000 * 60 * 60 * 24));

            let reminderType = null;
            if (daysUntil === 3) reminderType = '3_DAYS';
            else if (daysUntil === 1) reminderType = '1_DAY';
            else if (daysUntil === 0) reminderType = 'DUE_DAY';
            else if (daysUntil === -3) reminderType = '3_DAYS_OVERDUE';
            else if (daysUntil === -7) reminderType = '1_WEEK_OVERDUE';

            if (reminderType) {
                const [existing] = await pool.query(
                    `SELECT id FROM payment_reminders 
                     WHERE scheduled_payment_id = ? AND type = ? AND reminder_date = CURDATE()`,
                    [schedule.id, reminderType]
                );

                if (existing.length === 0) {
                    await pool.query(
                        `INSERT INTO payment_reminders (scheduled_payment_id, reminder_date, type, status)
                         VALUES (?, CURDATE(), ?, 'SENT')`,
                        [schedule.id, reminderType]
                    );
                    console.log(`[REMINDER] ${schedule.name} — ${reminderType} for user ${schedule.email}`);
                }
            }

            // Auto pay
            if (daysUntil === 0 && schedule.auto_pay && schedule.amount) {
                try {
                    const connection = await pool.getConnection();
                    await connection.beginTransaction();

                    const [wallet] = await connection.query(
                        'SELECT balance FROM wallets WHERE user_id = ? FOR UPDATE',
                        [schedule.user_id]
                    );

                    if (wallet[0].balance >= schedule.amount) {
                        await connection.query('UPDATE wallets SET balance = balance - ? WHERE user_id = ?', [schedule.amount, schedule.user_id]);
                        const [tx] = await connection.query(
                            `INSERT INTO transactions (sender_id, receiver_id, amount, type, status, note)
                             VALUES (?, ?, ?, 'WITHDRAWAL', 'SUCCESS', ?)`,
                            [schedule.user_id, schedule.user_id, schedule.amount, `Auto-pay: ${schedule.name}`]
                        );
                        await connection.query(
                            `INSERT INTO scheduled_payment_history (scheduled_payment_id, transaction_id, amount_paid, due_date, paid_at, status)
                             VALUES (?, ?, ?, ?, NOW(), 'PAID')`,
                            [schedule.id, tx[0].insertId, schedule.amount, schedule.next_due_date]
                        );

                        const next = new Date(today);
                        next.setDate(next.getDate() + schedule.schedule_value);
                        await connection.query(
                            'UPDATE scheduled_payments SET next_due_date = ? WHERE id = ?',
                            [next.toISOString().split('T')[0], schedule.id]
                        );

                        await connection.commit();
                        console.log(`[AUTO-PAY] ${schedule.name} paid ₹${schedule.amount} for user ${schedule.email}`);
                    } else {
                        await connection.rollback();
                        console.log(`[AUTO-PAY FAILED] Insufficient balance for ${schedule.name}`);
                    }
                    connection.release();
                } catch (err) {
                    console.error(`[AUTO-PAY ERROR] ${schedule.name}:`, err.message);
                }
            }
        }
    } catch (error) {
        console.error('[JOB ERROR] Bill reminder:', error.message);
    }
});

// Every 10 minutes — resolve stuck PROCESSING transactions
cron.schedule('*/10 * * * *', async () => {
    try {
        const [stuck] = await pool.query(
            `SELECT * FROM transactions 
             WHERE status = 'PROCESSING' 
             AND updated_at < DATE_SUB(NOW(), INTERVAL 10 MINUTE)`
        );

        for (const tx of stuck) {
            await pool.query(
                "UPDATE transactions SET status = 'FAILED' WHERE id = ?",
                [tx.id]
            );

            if (tx.type === 'TRANSFER') {
                await pool.query(
                    'UPDATE wallets SET balance = balance + ? WHERE user_id = ?',
                    [tx.amount, tx.sender_id]
                );
            }
            console.log(`[RETRY JOB] Resolved stuck transaction #${tx.id} → FAILED + reversed`);
        }
    } catch (error) {
        console.error('[JOB ERROR] Retry job:', error.message);
    }
});

// Daily at midnight — cleanup expired refresh tokens
cron.schedule('0 0 * * *', async () => {
    try {
        await pool.query('DELETE FROM refresh_tokens WHERE expires_at < NOW()');
        console.log('[CLEANUP] Expired refresh tokens removed');
    } catch (error) {
        console.error('[JOB ERROR] Cleanup:', error.message);
    }
});

console.log('[JOBS] Background jobs started');
