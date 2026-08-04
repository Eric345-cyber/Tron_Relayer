const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
require('dotenv').config();

const { logger } = require('./utils/logger');

// ─── EARLY VALIDATION ─────────────────────────────────────────────────
const requiredEnv = ['RELAYER_PRIVATE_KEY', 'API_KEY'];
const missing = requiredEnv.filter(key => !process.env[key]);

if (missing.length > 0) {
  logger.error(`Missing required environment variables: ${missing.join(', ')}`);
  logger.error('Set them in Railway dashboard → Variables tab');
  process.exit(1);
}

const pk = process.env.RELAYER_PRIVATE_KEY;
if (!/^[a-fA-F0-9]{64}$/.test(pk)) {
  logger.error('RELAYER_PRIVATE_KEY must be 64 hex characters (without 0x prefix)');
  process.exit(1);
}

const relayerRoutes = require('./routes/relayer');
const healthRoutes = require('./routes/health');

const app = express();
const PORT = process.env.PORT || 3000;

let isShuttingDown = false;
let server = null;

app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'X-API-Key']
}));

app.use(express.json({ limit: '1mb' }));

app.use((req, res, next) => {
  if (isShuttingDown) {
    res.status(503).json({ success: false, message: 'Server is shutting down' });
    return;
  }
  logger.info(`${req.method} ${req.path} - ${req.ip}`);
  next();
});

app.use('/api/relayer', relayerRoutes);
app.use('/', healthRoutes);

app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Not found' });
});

app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({ success: false, message: 'Internal server error' });
});

server = app.listen(PORT, '0.0.0.0', () => {
  logger.info(`🚀 TRON Relayer running on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

const KEEP_ALIVE_INTERVAL = 5 * 60 * 1000;

function keepAlivePing() {
  if (isShuttingDown) return;
  const selfUrl = process.env.RAILWAY_STATIC_URL 
    || process.env.RAILWAY_PUBLIC_DOMAIN 
    || `http://localhost:${PORT}`;
  if (selfUrl.includes('railway')) {
    const url = selfUrl.startsWith('http') ? selfUrl : `https://${selfUrl}`;
    fetch(`${url}/health`)
      .then(res => res.ok ? res.json() : Promise.reject(new Error(res.status)))
      .then(data => logger.debug(`Keep-alive OK: ${data.status}`))
      .catch(err => logger.warn(`Keep-alive failed: ${err.message}`));
  }
}

const keepAliveTimer = setInterval(keepAlivePing, KEEP_ALIVE_INTERVAL);

function gracefulShutdown(signal) {
  logger.info(`${signal} received. Shutting down gracefully...`);
  isShuttingDown = true;
  clearInterval(keepAliveTimer);
  server.close(() => {
    logger.info('HTTP server closed');
    setTimeout(() => {
      logger.info('Shutdown complete');
      process.exit(0);
    }, 3000);
  });
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 8000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception:', err);
  process.exit(1);
});
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection at:', promise, 'reason:', reason);
});
    
