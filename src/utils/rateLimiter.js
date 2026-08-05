const { RateLimiterMemory } = require('rate-limiter-flexible');
const { logger } = require('./logger');

// Memory-based rate limiter (safely avoids ioredis import issues)
const rateLimiter = new RateLimiterMemory({
  points: 10, // 10 requests
  duration: 60, // per 60 seconds
});

const rateLimitMiddleware = async (req, res, next) => {
  try {
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    await rateLimiter.consume(ip);
    next();
  } catch (rejRes) {
    logger.warn(`Rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({ 
      success: false, 
      message: 'Too many requests. Please try again later.' 
    });
  }
};

module.exports = rateLimitMiddleware;
