const pool = require('../config/db');
const {
    getDailySpending,
    getMonthlySummary,
    getCategoryBreakdown,
    getFinancialHealthScore,
    getSpendingPersonality,
    detectAnomalies
} = require('../services/analyticsService');

const daily = async (req, res, next) => {
    try {
        const data = await getDailySpending(req.userId);
        res.json({ daily: data });
    } catch (error) { next(error); }
};

const monthly = async (req, res, next) => {
    try {
        const month = parseInt(req.query.month) || new Date().getMonth() + 1;
        const year = parseInt(req.query.year) || new Date().getFullYear();
        const data = await getMonthlySummary(req.userId, month, year);
        res.json({ summary: data });
    } catch (error) { next(error); }
};

const categories = async (req, res, next) => {
    try {
        const month = parseInt(req.query.month) || new Date().getMonth() + 1;
        const year = parseInt(req.query.year) || new Date().getFullYear();
        const data = await getCategoryBreakdown(req.userId, month, year);
        res.json({ categories: data });
    } catch (error) { next(error); }
};

const healthScore = async (req, res, next) => {
    try {
        const data = await getFinancialHealthScore(req.userId);
        res.json(data);
    } catch (error) { next(error); }
};

const personality = async (req, res, next) => {
    try {
        const data = await getSpendingPersonality(req.userId);
        res.json(data);
    } catch (error) { next(error); }
};

const anomalies = async (req, res, next) => {
    try {
        const data = await detectAnomalies(req.userId);
        res.json({ anomalies: data });
    } catch (error) { next(error); }
};

const whatIf = async (req, res, next) => {
    try {
        const { save_extra = 0, cut_category_percent = 0, category_id } = req.query;
        const userId = req.userId;

        const [income] = await pool.query(
            `SELECT COALESCE(AVG(monthly_total), 0) as avg FROM (
                SELECT MONTH(created_at) as m, YEAR(created_at) as y, SUM(amount) as monthly_total
                FROM transactions WHERE receiver_id = ? AND status = 'SUCCESS'
                AND created_at >= DATE_SUB(NOW(), INTERVAL 3 MONTH)
                GROUP BY m, y
            ) as monthly`,
            [userId]
        );

        const [expense] = await pool.query(
            `SELECT COALESCE(AVG(monthly_total), 0) as avg FROM (
                SELECT MONTH(created_at) as m, YEAR(created_at) as y, SUM(amount) as monthly_total
                FROM transactions WHERE sender_id = ? AND type IN ('TRANSFER','WITHDRAWAL') AND status = 'SUCCESS'
                AND created_at >= DATE_SUB(NOW(), INTERVAL 3 MONTH)
                GROUP BY m, y
            ) as monthly`,
            [userId]
        );

        let categorySaving = 0;
        if (category_id && cut_category_percent > 0) {
            const [catSpend] = await pool.query(
                `SELECT COALESCE(AVG(monthly_total), 0) as avg FROM (
                    SELECT MONTH(t.created_at) as m, YEAR(t.created_at) as y, SUM(t.amount) as monthly_total
                    FROM transactions t
                    JOIN transaction_categories tc ON t.id = tc.transaction_id
                    WHERE t.sender_id = ? AND tc.category_id = ? AND t.status = 'SUCCESS'
                    AND t.created_at >= DATE_SUB(NOW(), INTERVAL 3 MONTH)
                    GROUP BY m, y
                ) as monthly`,
                [userId, category_id]
            );
            categorySaving = (catSpend[0].avg * cut_category_percent) / 100;
        }

        const monthlySaving = parseFloat(save_extra) + categorySaving;

        res.json({
            monthly_saving: monthlySaving,
            in_3_months: monthlySaving * 3,
            in_6_months: monthlySaving * 6,
            in_1_year: monthlySaving * 12,
            avg_monthly_income: income[0].avg,
            avg_monthly_expense: expense[0].avg
        });
    } catch (error) { next(error); }
};

const setBudget = async (req, res, next) => {
    try {
        const { category_id, amount, month, year } = req.body;
        await pool.query(
            `INSERT INTO budgets (user_id, category_id, amount, month, year)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE amount = ?`,
            [req.userId, category_id, amount, month, year, amount]
        );
        res.json({ message: 'Budget set successfully' });
    } catch (error) { next(error); }
};

const getBudgets = async (req, res, next) => {
    try {
        const month = parseInt(req.query.month) || new Date().getMonth() + 1;
        const year = parseInt(req.query.year) || new Date().getFullYear();

        const [rows] = await pool.query(
            `SELECT b.id, c.name, c.icon, c.color, b.amount as budget,
                    COALESCE(SUM(t.amount), 0) as spent
             FROM budgets b
             JOIN categories c ON b.category_id = c.id
             LEFT JOIN transaction_categories tc ON tc.category_id = b.category_id
             LEFT JOIN transactions t ON t.id = tc.transaction_id
                 AND t.sender_id = b.user_id AND t.status = 'SUCCESS'
                 AND MONTH(t.created_at) = b.month AND YEAR(t.created_at) = b.year
             WHERE b.user_id = ? AND b.month = ? AND b.year = ?
             GROUP BY b.id`,
            [req.userId, month, year]
        );

        const budgets = rows.map(b => ({
            ...b,
            remaining: b.budget - b.spent,
            percent_used: Math.round((b.spent / b.budget) * 100)
        }));

        res.json({ budgets });
    } catch (error) { next(error); }
};

module.exports = { daily, monthly, categories, healthScore, personality, anomalies, whatIf, setBudget, getBudgets };
