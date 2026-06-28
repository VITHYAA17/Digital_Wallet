const { body, query } = require('express-validator');

const amountValidation = [
    body('amount').isFloat({ gt: 0 }).withMessage('Amount must be a positive number')
];

const transferValidation = [
    body('receiver').trim().notEmpty().withMessage('Receiver email or username is required'),
    body('amount').isFloat({ gt: 0 }).withMessage('Amount must be a positive number'),
    body('note').optional().trim().isLength({ max: 255 })
];

const paginationValidation = [
    query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Limit must be between 1 and 50')
];

const budgetValidation = [
    body('category_id').isInt({ gt: 0 }).withMessage('Valid category is required'),
    body('amount').isFloat({ gt: 0 }).withMessage('Budget amount must be positive'),
    body('month').isInt({ min: 1, max: 12 }).withMessage('Valid month required'),
    body('year').isInt({ min: 2024 }).withMessage('Valid year required')
];

const scheduleValidation = [
    body('name').trim().notEmpty().withMessage('Schedule name is required'),
    body('schedule_type').isIn(['FIXED_DATE', 'FIXED_INTERVAL', 'APPROXIMATE_DATE']).withMessage('Invalid schedule type'),
    body('schedule_value').isInt({ gt: 0 }).withMessage('Schedule value must be positive'),
    body('next_due_date').isDate().withMessage('Valid due date required'),
    body('amount').optional().isFloat({ gt: 0 }).withMessage('Amount must be positive'),
    body('auto_pay').optional().isBoolean()
];

module.exports = { amountValidation, transferValidation, paginationValidation, budgetValidation, scheduleValidation };
