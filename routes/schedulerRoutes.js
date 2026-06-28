const express = require('express');
const router = express.Router();
const { createSchedule, getSchedules, updateSchedule, deleteSchedule, payNow, getScheduleHistory, getUpcoming } = require('../controllers/schedulerController');
const { scheduleValidation } = require('../validations/walletValidation');
const authMiddleware = require('../middleware/authMiddleware');

router.use(authMiddleware);

router.post('/', scheduleValidation, createSchedule);
router.get('/', getSchedules);
router.get('/upcoming', getUpcoming);
router.put('/:id', updateSchedule);
router.delete('/:id', deleteSchedule);
router.post('/:id/pay', payNow);
router.get('/:id/history', getScheduleHistory);

module.exports = router;
