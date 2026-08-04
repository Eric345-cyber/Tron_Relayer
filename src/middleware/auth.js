const { logger } = require('../utils/logger');

function apiKeyAuth(req, res, next) {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    return res.status(401).json({ success: false, message: 'API key required' });
  }

  if (apiKey !== process.env.API_KEY) {
    logger.warn(`Invalid API key attempt from ${req.ip}`);
    return res.status(403).json({ success: false, message: 'Invalid API key' });
  }

  next();
}

module.exports = { apiKeyAuth };
                      
