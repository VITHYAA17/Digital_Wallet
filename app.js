require('dotenv').config();
const validateEnv = require('./config/validateEnv');
validateEnv();

const express = require('express');
const helmet = require('helmet');
const app = express();

const { globalLimiter } = require('./middleware/rateLimiter');
const errorHandler = require('./middleware/errorHandler');

const authRoutes = require('./routes/authRoutes');
const walletRoutes = require('./routes/walletRoutes');
const webhookRoutes = require('./routes/webhookRoutes');
const analyticsRoutes = require('./routes/analyticsRoutes');

app.use(helmet());
app.use(express.json());
app.use(globalLimiter);

// Part 1 — Core Wallet
app.use('/api/auth', authRoutes);
app.use('/api/wallet', walletRoutes);

// Part 2 — Fraud & Webhooks
app.use('/api/webhooks', webhookRoutes);

// Part 3 — Analytics
app.use('/api/analytics', analyticsRoutes);

app.get('/health', (req, res) => res.json({ status: 'ok', part: 'Part 3 - Analytics' }));

app.use(errorHandler);

// Background jobs
require('./jobs/reliabilityJobs');

app.listen(process.env.PORT, () => {
    console.log(`Server running on port ${process.env.PORT}`);
});
