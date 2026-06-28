const required = ['PORT', 'DB_HOST', 'DB_USER', 'DB_PASS', 'DB_NAME', 'JWT_SECRET', 'JWT_REFRESH_SECRET'];

const validateEnv = () => {
    const missing = required.filter(key => !process.env[key]);
    if (missing.length > 0) {
        console.error(`Missing environment variables: ${missing.join(', ')}`);
        process.exit(1);
    }
};

module.exports = validateEnv;
