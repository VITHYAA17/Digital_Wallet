const express = require('express');
const router = express.Router();
const { daily, monthly, categories, healthScore, personality, anomalies, whatIf, setBudget, getBudgets } = require('../controllers/analyticsController');
const { budgetValidation } = require('../validations/walletValidation');
const authMiddleware = require('../middleware/authMiddleware');

router.use(authMiddleware);

router.get('/daily', daily);
router.get('/monthly', monthly);
router.get('/categories', categories);
router.get('/health-score', healthScore);
router.get('/personality', personality);
router.get('/anomalies', anomalies);
router.get('/what-if', whatIf);
router.post('/budgets', budgetValidation, setBudget);
router.get('/budgets', getBudgets);

module.exports = router;
