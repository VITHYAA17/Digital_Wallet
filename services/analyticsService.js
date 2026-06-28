const pool = require('../config/db');

const getDailySpending = async (userId) => {
    const [rows] = await pool.query(
        `SELECT DATE(t.created_at) as date, SUM(t.amount) as total
         FROM transactions t
         WHERE t.sender_id = ? AND t.type IN ('TRANSFER','WITHDRAWAL') 
         AND t.status = 'SUCCESS'
         AND t.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
         GROUP BY DATE(t.created_at)
         ORDER BY date ASC`,
        [userId]
    );
    return rows;
};

const getMonthlySummary = async (userId, month, year) => {
    const [spent] = await pool.query(
        `SELECT COALESCE(SUM(amount), 0) as total
         FROM transactions
         WHERE sender_id = ? AND type IN ('TRANSFER','WITHDRAWAL')
         AND status = 'SUCCESS'
         AND MONTH(created_at) = ? AND YEAR(created_at) = ?`,
        [userId, month, year]
    );

    const [received] = await pool.query(
        `SELECT COALESCE(SUM(amount), 0) as total
         FROM transactions
         WHERE receiver_id = ? AND type IN ('TRANSFER','DEPOSIT')
         AND status = 'SUCCESS'
         AND MONTH(created_at) = ? AND YEAR(created_at) = ?`,
        [userId, month, year]
    );

    const [topCategory] = await pool.query(
        `SELECT c.name, SUM(t.amount) as total
         FROM transactions t
         JOIN transaction_categories tc ON t.id = tc.transaction_id
         JOIN categories c ON tc.category_id = c.id
         WHERE t.sender_id = ? AND t.status = 'SUCCESS'
         AND MONTH(t.created_at) = ? AND YEAR(t.created_at) = ?
         GROUP BY c.name ORDER BY total DESC LIMIT 1`,
        [userId, month, year]
    );

    return {
        total_spent: spent[0].total,
        total_received: received[0].total,
        net_saved: received[0].total - spent[0].total,
        top_category: topCategory[0] || null
    };
};

const getCategoryBreakdown = async (userId, month, year) => {
    const [rows] = await pool.query(
        `SELECT c.name, c.icon, c.color, SUM(t.amount) as total
         FROM transactions t
         JOIN transaction_categories tc ON t.id = tc.transaction_id
         JOIN categories c ON tc.category_id = c.id
         WHERE t.sender_id = ? AND t.status = 'SUCCESS'
         AND MONTH(t.created_at) = ? AND YEAR(t.created_at) = ?
         GROUP BY c.id ORDER BY total DESC`,
        [userId, month, year]
    );
    return rows;
};

const getFinancialHealthScore = async (userId) => {
    const [income] = await pool.query(
        `SELECT COALESCE(SUM(amount), 0) as total FROM transactions
         WHERE receiver_id = ? AND status = 'SUCCESS'
         AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`,
        [userId]
    );
    const [expenses] = await pool.query(
        `SELECT COALESCE(SUM(amount), 0) as total FROM transactions
         WHERE sender_id = ? AND type IN ('TRANSFER','WITHDRAWAL') AND status = 'SUCCESS'
         AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`,
        [userId]
    );

    const totalIncome = parseFloat(income[0].total);
    const totalExpenses = parseFloat(expenses[0].total);

    const savingsRate = totalIncome > 0 ? Math.min(((totalIncome - totalExpenses) / totalIncome) * 100, 100) : 0;
    const incomeVsExpense = totalIncome > 0 ? Math.min((totalIncome / (totalExpenses || 1)) * 50, 100) : 50;

    const [budgetRows] = await pool.query(
        `SELECT b.amount as budget, COALESCE(SUM(t.amount), 0) as spent
         FROM budgets b
         LEFT JOIN transaction_categories tc ON tc.category_id = b.category_id
         LEFT JOIN transactions t ON t.id = tc.transaction_id 
             AND t.sender_id = b.user_id AND t.status = 'SUCCESS'
             AND MONTH(t.created_at) = b.month AND YEAR(t.created_at) = b.year
         WHERE b.user_id = ? AND b.month = MONTH(NOW()) AND b.year = YEAR(NOW())
         GROUP BY b.id`,
        [userId]
    );

    const budgetAdherence = budgetRows.length > 0
        ? budgetRows.reduce((acc, b) => acc + (b.spent <= b.budget ? 100 : Math.max(0, 100 - ((b.spent - b.budget) / b.budget) * 100)), 0) / budgetRows.length
        : 50;

    const score = Math.round((savingsRate * 0.4) + (budgetAdherence * 0.3) + (incomeVsExpense * 0.3));

    return {
        score: Math.min(score, 100),
        breakdown: {
            savings_rate: Math.round(savingsRate),
            budget_adherence: Math.round(budgetAdherence),
            income_vs_expense: Math.round(incomeVsExpense)
        }
    };
};

const getSpendingPersonality = async (userId) => {
    const [rows] = await pool.query(
        `SELECT HOUR(created_at) as hour, DAYOFWEEK(created_at) as day, amount
         FROM transactions
         WHERE sender_id = ? AND type IN ('TRANSFER','WITHDRAWAL') AND status = 'SUCCESS'
         AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`,
        [userId]
    );

    if (rows.length === 0) return { personality: 'New User', description: 'Not enough data yet' };

    const nightSpend = rows.filter(r => r.hour >= 20 || r.hour < 6).length;
    const weekendSpend = rows.filter(r => r.day === 1 || r.day === 7).length;
    const nightRatio = nightSpend / rows.length;
    const weekendRatio = weekendSpend / rows.length;

    if (nightRatio > 0.6) return { personality: 'Night Spender 🌙', description: 'Most of your spending happens after 8pm' };
    if (weekendRatio > 0.6) return { personality: 'Weekend Splurger 🎉', description: 'You spend significantly more on weekends' };

    const amounts = rows.map(r => parseFloat(r.amount));
    const avg = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const variance = amounts.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / amounts.length;

    if (Math.sqrt(variance) < avg * 0.3) return { personality: 'Consistent Saver 📊', description: 'Your spending is stable and predictable' };

    return { personality: 'Balanced Spender ⚖️', description: 'You have a healthy mix of spending patterns' };
};

const detectAnomalies = async (userId) => {
    const [avgRows] = await pool.query(
        `SELECT tc.category_id, AVG(t.amount) as avg_amount
         FROM transactions t
         JOIN transaction_categories tc ON t.id = tc.transaction_id
         WHERE t.sender_id = ? AND t.status = 'SUCCESS'
         AND t.created_at BETWEEN DATE_SUB(NOW(), INTERVAL 30 DAY) AND DATE_SUB(NOW(), INTERVAL 1 DAY)
         GROUP BY tc.category_id`,
        [userId]
    );

    const [todayRows] = await pool.query(
        `SELECT tc.category_id, c.name, SUM(t.amount) as total
         FROM transactions t
         JOIN transaction_categories tc ON t.id = tc.transaction_id
         JOIN categories c ON tc.category_id = c.id
         WHERE t.sender_id = ? AND t.status = 'SUCCESS'
         AND DATE(t.created_at) = CURDATE()
         GROUP BY tc.category_id`,
        [userId]
    );

    const anomalies = [];
    for (const today of todayRows) {
        const avg = avgRows.find(a => a.category_id === today.category_id);
        if (avg && today.total > avg.avg_amount * 3) {
            anomalies.push({
                category: today.name,
                today_spend: today.total,
                avg_spend: Math.round(avg.avg_amount),
                message: `You spent ₹${today.total} on ${today.name} today — your usual is ₹${Math.round(avg.avg_amount)}`
            });
        }
    }
    return anomalies;
};

module.exports = {
    getDailySpending,
    getMonthlySummary,
    getCategoryBreakdown,
    getFinancialHealthScore,
    getSpendingPersonality,
    detectAnomalies
};
