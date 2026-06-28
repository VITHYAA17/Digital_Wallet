const cron = require('node-cron');
const pool = require('../config/db');

const calculateNextDueDate = (schedule) => {
    const today = new Date();
    if (schedule.schedule_type === 'FIXED_DATE') {
        const next = new Date(today.getFullYear(), today.getMonth() + 1, schedule.schedule_value);
        return next.toISOString().split('T')[0];
    }
    const next = new Date(today);
    next.setDate(next.getDate() + schedule.schedule_value);
    return next.toISOString().split('T')[0];
};

// Every morning at 8am — check upcoming bills, send reminders, run auto pay
cron.schedule('0 8 * * *', async () => {
    console.log('[JOB] Running bill reminder and auto-pay check...');
    try {
        const [schedules] = await pool.query(
            `SELECT sp.*, u.name, u.email 
             FROM scheduled_payments sp
             JOIN users u ON sp.user_id = u.id
             WHERE sp.is_active = TRUE`
        );

        const today = new Date();

        for (const schedule of schedules) {
            const due = new Date(schedule.next_due_date);
            const daysUntil = Math.ceil((due - today) / (1000 * 60 * 60 * 24));

            // Determine reminder type
            let reminderType = null;
            if (daysUntil === 3)  reminderType = '3_DAYS';
            else if (daysUntil === 1)  reminderType = '1_DAY';
            else if (daysUntil === 0)  reminderType = 'DUE_DAY';
            else if (daysUntil === -3) reminderType = '3_DAYS_OVERDUE';
            else if (daysUntil === -7) reminderType = '1_WEEK_OVERDUE';

            // Insert reminder if not already sent today
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
                    console.log(`[REMINDER] ${schedule.name} — ${reminderType} → ${schedule.email}`);
                }
            }

            // Auto pay on due day
            if (daysUntil === 0 && schedule.auto_pay && schedule.amount) {
                const connection = await pool.getConnection();
                try {
                    await connection.beginTransaction();

                    const [wallet] = await connection.query(
                        'SELECT balance FROM wallets WHERE user_id = ? FOR UPDATE',
                        [schedule.user_id]
                    );

                    if (wallet[0].balance >= schedule.amount) {
                        await connection.query(
                            'UPDATE wallets SET balance = balance - ? WHERE user_id = ?',
                            [schedule.amount, schedule.user_id]
                        );

                        const [tx] = await connection.query(
                            `INSERT INTO transactions (sender_id, receiver_id, amount, type, status, note)
                             VALUES (?, ?, ?, 'WITHDRAWAL', 'SUCCESS', ?)`,
                            [schedule.user_id, schedule.user_id, schedule.amount, `Auto-pay: ${schedule.name}`]
                        );

                        await connection.query(
                            `INSERT INTO scheduled_payment_history (scheduled_payment_id, transaction_id, amount_paid, due_date, paid_at, status)
                             VALUES (?, ?, ?, ?, NOW(), 'PAID')`,
                            [schedule.id, tx.insertId, schedule.amount, schedule.next_due_date]
                        );

                        const nextDate = calculateNextDueDate(schedule);
                        await connection.query(
                            'UPDATE scheduled_payments SET next_due_date = ? WHERE id = ?',
                            [nextDate, schedule.id]
                        );

                        await connection.query(
                            `INSERT INTO audit_logs (user_id, action, entity, entity_id, meta)
                             VALUES (?, 'AUTO_PAY_SUCCESS', 'scheduled_payments', ?, ?)`,
                            [schedule.user_id, schedule.id, JSON.stringify({ amount: schedule.amount, name: schedule.name })]
                        );

                        await connection.commit();
                        console.log(`[AUTO-PAY] ${schedule.name} ₹${schedule.amount} → ${schedule.email}`);
                    } else {
                        await connection.rollback();
                        console.log(`[AUTO-PAY FAILED] Insufficient balance for ${schedule.name} → ${schedule.email}`);
                    }
                } catch (err) {
                    await connection.rollback();
                    console.error(`[AUTO-PAY ERROR] ${schedule.name}:`, err.message);
                } finally {
                    connection.release();
                }
            }
        }
    } catch (error) {
        console.error('[JOB ERROR] Bill reminder/auto-pay:', error.message);
    }
});

console.log('[JOBS] Part 4 scheduler jobs started');
