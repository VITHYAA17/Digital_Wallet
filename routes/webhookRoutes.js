const express = require('express');
const router = express.Router();
const { registerWebhook, getWebhooks, deleteWebhook, getDeliveries, getFraudFlags } = require('../controllers/webhookController');
const authMiddleware = require('../middleware/authMiddleware');

router.use(authMiddleware);

router.post('/', registerWebhook);
router.get('/', getWebhooks);
router.delete('/:id', deleteWebhook);
router.get('/deliveries', getDeliveries);
router.get('/fraud-flags', getFraudFlags);

module.exports = router;
