const { logger } = require('../utils/logger');

const verifyApiKey = (req, res, next) => {
  try {
    const apiKey = req.headers['x-api-key'] || req.headers['api-key'];
    const configuredKey = process.env.API_KEY;

    if (!configuredKey) {
      logger.error('API_KEY environment variable is not configured on the server.');
      return res.status(500).json({ success: false, message: 'Server configuration error' });
    }

    if (apiKey && apiKey === configuredKey) {
      return next();
    }

    logger.warn(`Unauthorized API access attempt from IP: ${req.ip}`);
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  } catch (error) {
    logger.error('Error in auth middleware:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

module.exports = verifyApiKey;
