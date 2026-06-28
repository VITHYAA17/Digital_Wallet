const { validationResult } = require('express-validator');
const pool = require('../config/db');

const createSchedule = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        const { name, amount, is_variable_amount, schedule_type, schedule_value, next_due_date, auto_pay } = req.body;

        const [result] = await pool.query(
            `INSERT INTO scheduled_payments 
             (user_id, name, amount, is_variable_amount, schedule_type, schedule_value, next_due_date, auto_pay)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [req.userId, name, amount || null, is_variable_amount || false, schedule_type, schedule_value, next_due_date, auto_pay || false]
        );

        res.status(201).json({ message: 'Schedule created', id: result.insertId });
    } catch (error) { next(error); }
};

const getSchedules = async (req, res, next) => {
    try {
        const [rows] = await pool.query(
            `SELECT * FROM scheduled_payments WHERE user_id = ? AND is_active = TRUE ORDER BY next_due_date ASC`,
            [req.userId]
        );

        const today = new Date();
        const schedules = rows.map(s => {
            const due = new Date(s.next_due_date);
            const daysUntil = Math.ceil((due - today) / (1000 * 60 * 60 * 24));
            return {
                ...s,
                days_until_due: daysUntil,
                urgency: daysUntil <= 0 ? 'OVERDUE' : daysUntil <= 3 ? 'URGENT' : daysUntil <= 7 ? 'SOON' : 'UPCOMING'
            };
        });

        res.json({ schedules });
    } catch (error) { next(error); }
};

const updateSchedule = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { name, amount, next_due_date, auto_pay, is_active } = req.body;

        const [existing] = await pool.query(
            'SELECT id FROM scheduled_payments WHERE id = ? AND user_id = ?',
            [id, req.userId]
        );
        if (existing.length === 0) return res.status(404).json({ error: 'Schedule not found' });

        await pool.query(
            `UPDATE scheduled_payments SET name = COALESCE(?, name), amount = COALESCE(?, amount),
             next_due_date = COALESCE(?, next_due_date), auto_pay = COALESCE(?, auto_pay),
             is_active = COALESCE(?, is_active) WHERE id = ?`,
            [name, amount, next_due_date, auto_pay, is_active, id]
        );

        res.json({ message: 'Schedule updated' });
    } catch (error) { next(error); }
};

const deleteSchedule = async (req, res, next) => {
    try {
        const { id } = req.params;
        await pool.query(
            'UPDATE scheduled_payments SET is_active = FALSE WHERE id = ? AND user_id = ?',
            [id, req.userId]
        );
        res.json({ message: 'Schedule deleted' });
    } catch (error) { next(error); }
};

const payNow = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { amount } = req.body;

        const [schedules] = await pool.query(
            'SELECT * FROM scheduled_payments WHERE id = ? AND user_id = ? AND is_active = TRUE',
            [id, req.userId]
        );
        if (schedules.length === 0) return res.status(404).json({ error: 'Schedule not found' });

        const schedule = schedules[0];
        const payAmount = amount || schedule.amount;

        if (!payAmount) return res.status(400).json({ error: 'Amount required for variable amount schedules' });

        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            const [wallet] = await connection.query(
                'SELECT balance FROM wallets WHERE user_id = ? FOR UPDATE',
                [req.userId]
            );
            if (wallet[0].balance < payAmount) return res.status(400).json({ error: 'Insufficient balance' });

            await connection.query('UPDATE wallets SET balance = balance - ? WHERE user_id = ?', [payAmount, req.userId]);

            const [txResult] = await connection.query(
                `INSERT INTO transactions (sender_id, receiver_id, amount, type, status, note)
                 VALUES (?, ?, ?, 'WITHDRAWAL', 'SUCCESS', ?)`,
                [req.userId, req.userId, payAmount, `Scheduled: ${schedule.name}`]
            );

            await connection.query(
                `INSERT INTO scheduled_payment_history (scheduled_payment_id, transaction_id, amount_paid, due_date, paid_at, status)
                 VALUES (?, ?, ?, ?, NOW(), 'PAID')`,
                [id, txResult.insertId, payAmount, schedule.next_due_date]
            );

            const nextDate = calculateNextDueDate(schedule);
            await connection.query(
                'UPDATE scheduled_payments SET next_due_date = ? WHERE id = ?',
                [nextDate, id]
            );

            await connection.commit();
            res.json({ message: `${schedule.name} paid successfully`, next_due_date: nextDate });
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
    } catch (error) { next(error); }
};

const getScheduleHistory = async (req, res, next) => {
    try {
        const { id } = req.params;
        const [rows] = await pool.query(
            `SELECT sph.*, t.amount as transaction_amount
             FROM scheduled_payment_history sph
             LEFT JOIN transactions t ON sph.transaction_id = t.id
             WHERE sph.scheduled_payment_id = ?
             ORDER BY sph.due_date DESC`,
            [id]
        );
        res.json({ history: rows });
    } catch (error) { next(error); }
};

const getUpcoming = async (req, res, next) => {
    try {
        const [rows] = await pool.query(
            `SELECT * FROM scheduled_payments 
             WHERE user_id = ? AND is_active = TRUE 
             AND next_due_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)
             ORDER BY next_due_date ASC`,
            [req.userId]
        );
        res.json({ upcoming: rows });
    } catch (error) { next(error); }
};

const calculateNextDueDate = (schedule) => {
    const today = new Date();
    if (schedule.schedule_type === 'FIXED_DATE') {
        const next = new Date(today.getFullYear(), today.getMonth() + 1, schedule.schedule_value);
        return next.toISOString().split('T')[0];
    }
    if (schedule.schedule_type === 'FIXED_INTERVAL' || schedule.schedule_type === 'APPROXIMATE_DATE') {
        const next = new Date(today);
        next.setDate(next.getDate() + schedule.schedule_value);
        return next.toISOString().split('T')[0];
    }
    return today.toISOString().split('T')[0];
};

module.exports = { createSchedule, getSchedules, updateSchedule, deleteSchedule, payNow, getScheduleHistory, getUpcoming };
