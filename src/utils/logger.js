const winston = require('winston');
const https = require('https');

// Helper to send messages to Telegram safely
function sendTelegramAlert(message) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  
  if (!token || !chatId) return; // Skip if credentials are not configured

  const formattedMessage = `🤖 <b>TRON Relayer Alert</b>\n\n${message}`;
  const data = JSON.stringify({
    chat_id: chatId,
    text: formattedMessage,
    parse_mode: 'HTML'
  });

  const options = {
    hostname: 'api.telegram.org',
    port: 443,
    path: `/bot${token}/sendMessage`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': data.length
    }
  };

  const req = https.request(options, (res) => {
    res.on('data', () => {}); // Consume stream to avoid leaks
  });

  req.on('error', (e) => {
    console.error('Failed to send Telegram log:', e.message);
  });

  req.write(data);
  req.end();
}

let logger;
try {
  logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      winston.format.json()
    ),
    transports: [
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.simple()
        )
      })
    ]
  });
} catch (e) {
  logger = {
    info: (...args) => console.log('[INFO]', ...args),
    error: (...args) => console.error('[ERROR]', ...args),
    warn: (...args) => console.warn('[WARN]', ...args),
    debug: (...args) => console.log('[DEBUG]', ...args)
  };
}

// Wrap logger to intercept and pipe important notifications to Telegram
const wrappedLogger = {
  info: (msg, ...meta) => {
    logger.info(msg, ...meta);
    // Send major state transitions (like server starting or successfully processed approvals)
    if (msg.includes('Relayed transaction') || msg.includes('TRON Relayer running')) {
      sendTelegramAlert(`✅ <b>INFO:</b> ${msg}`);
    }
  },
  warn: (msg, ...meta) => {
    logger.warn(msg, ...meta);
    // Warn on resource threshold notifications (such as low relayer wallet funds)
    sendTelegramAlert(`⚠️ <b>WARN:</b> ${msg}`);
  },
  error: (msg, ...meta) => {
    logger.error(msg, ...meta);
    const errorDetails = meta[0] && meta[0].message ? `\n<i>Details: ${meta[0].message}</i>` : '';
    sendTelegramAlert(`🚨 <b>ERROR:</b> ${msg}${errorDetails}`);
  },
  debug: (msg, ...meta) => {
    logger.debug(msg, ...meta);
  }
};

module.exports = { logger: wrappedLogger };
