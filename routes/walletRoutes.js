const express = require('express');
const router = express.Router();
const { deposit, withdraw, transfer, getBalance, getTransactions, getRecentRecipients } = require('../controllers/walletController');
const { amountValidation, transferValidation, paginationValidation } = require('../validations/walletValidation');
const authMiddleware = require('../middleware/authMiddleware');

router.use(authMiddleware);

router.post('/deposit', amountValidation, deposit);
router.post('/withdraw', amountValidation, withdraw);
router.post('/transfer', transferValidation, transfer);
router.get('/balance', getBalance);
router.get('/transactions', paginationValidation, getTransactions);
router.get('/recipients', getRecentRecipients);

module.exports = router;
