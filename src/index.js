const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
require('dotenv').config();

const relayerRoutes = require('./routes/relayer');
const healthRoutes = require('./routes/health');
const { logger } = require('./utils/logger');

const app = express();
const PORT = process.env.PORT || 3000;

// Track server state for graceful shutdown
let isShuttingDown = false;
let server = null;

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'X-API-Key']
}));

app.use(express.json({ limit: '1mb' }));

// Request logging
app.use((req, res, next) => {
  if (isShuttingDown) {
    res.status(503).json({ success: false, message: 'Server is shutting down' });
    return;
  }
  logger.info(`${req.method} ${req.path} - ${req.ip}`);
  next();
});

// Routes
app.use('/api/relayer', relayerRoutes);
app.use('/', healthRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({ success: false, message: 'Internal server error' });
});

// ─── START SERVER ─────────────────────────────────────────────────────
server = app.listen(PORT, () => {
  logger.info(`🚀 TRON Relayer running on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`Relayer address: ${process.env.RELAYER_PRIVATE_KEY ? '[hidden]' : 'NOT SET'}`);
});

// ─── KEEP-ALIVE PING (prevents Railway idle sleep) ────────────────────
// Railway may stop idle containers. Ping ourselves every 5 minutes.
const KEEP_ALIVE_INTERVAL = 5 * 60 * 1000; // 5 minutes
const SELF_URL = process.env.RAILWAY_STATIC_URL || `http://localhost:${PORT}`;

function keepAlivePing() {
  if (isShuttingDown) return;

  // Only ping if we're on Railway (has external URL)
  if (process.env.RAILWAY_STATIC_URL || process.env.RAILWAY_PUBLIC_DOMAIN) {
    const url = `${SELF_URL}/health`;
    fetch(url)
      .then(res => res.json())
      .then(data => {
        logger.debug(`Keep-alive ping OK: ${data.status}`);
      })
      .catch(err => {
        logger.warn(`Keep-alive ping failed: ${err.message}`);
      });
  }
}

const keepAliveTimer = setInterval(keepAlivePing, KEEP_ALIVE_INTERVAL);

// ─── GRACEFUL SHUTDOWN ────────────────────────────────────────────────
function gracefulShutdown(signal) {
  logger.info(`${signal} received. Starting graceful shutdown...`);
  isShuttingDown = true;

  // Stop keep-alive pings
  clearInterval(keepAliveTimer);

  // Close server (stop accepting new connections)
  server.close(() => {
    logger.info('HTTP server closed');

    // Give in-flight requests 5 seconds to finish
    setTimeout(() => {
      logger.info('Shutdown complete');
      process.exit(0);
    }, 5000);
  });

  // Force exit after 10 seconds if graceful shutdown hangs
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception:', err);
  gracefulShutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection at:', promise, 'reason:', reason);
});
