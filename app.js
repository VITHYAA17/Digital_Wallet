require('dotenv').config();
const express = require('express');
const pool = require('./config/db');
const authRoutes = require('./routes/authRoutes');
const walletRoutes = require('./routes/walletRoutes');


const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/wallet', walletRoutes);

// Test database connection
app.get('/test-db', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT 1');
        res.json({ message: "Database connected successfully" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Database connection failed" });
    }
});

app.listen(process.env.PORT, () => {
    console.log(`Server running on port ${process.env.PORT}`);
});