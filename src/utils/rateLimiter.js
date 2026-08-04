const { RateLimiterRedis, RateLimiterMemory } = require('rate-limiter-flexible');
const Redis = require('ioredis');
const { logger } = require('./logger');

let rateLimiter;

// Try Redis first, fallback to memory
if (process.env.REDIS_URL) {
  const redisClient = new Redis(process.env.REDIS_URL);
  rateLimiter = new RateLimiterRedis({
    storeClient: redisClient,
    keyPrefix: 'tron_relayer',
    points: parseInt(process.env.MAX_DAILY_RELAYS_PER_ADDRESS) || 10,
    duration: 24 * 60 * 60, // 24 hours
    blockDuration: 24 * 60 * 60
  });
  logger.info('Rate limiter: Redis mode');
} else {
  rateLimiter = new RateLimiterMemory({
    keyPrefix: 'tron_relayer',
    points: parseInt(process.env.MAX_DAILY_RELAYS_PER_ADDRESS) || 10,
    duration: 24 * 60 * 60,
    blockDuration: 24 * 60 * 60
  });
  logger.info('Rate limiter: Memory mode (Redis not configured)');
}

async function checkRateLimit(address) {
  try {
    await rateLimiter.consume(address, 1);
    return { allowed: true, remaining: rateLimiter.points };
  } catch (rejRes) {
    return { 
      allowed: false, 
      remaining: 0,
      retryAfter: Math.round(rejRes.msBeforeNext / 1000)
    };
  }
}

module.exports = { checkRateLimit };
