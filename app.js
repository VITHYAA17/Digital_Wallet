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

app.use(helmet());
app.use(express.json());
app.use(globalLimiter);

app.use('/api/auth', authRoutes);
app.use('/api/wallet', walletRoutes);

app.get('/health', (req, res) => res.json({ status: 'ok', part: 'Part 1 - Core Wallet' }));

app.use(errorHandler);

app.listen(process.env.PORT, () => {
    console.log(`Server running on port ${process.env.PORT}`);
});
