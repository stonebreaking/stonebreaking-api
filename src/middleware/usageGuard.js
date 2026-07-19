// StoneBreaking — Usage Guard Middleware
// Checks daily limits BEFORE processing AI requests
// Gracefully falls back if database is not available

const logger = require('../utils/logger');

let pool;
try {
  const db = require('../db/connection');
  pool = db.pool;
} catch (err) {
  logger.warn('⚠️  DB connection not available for usage guard');
}

const TIER_LIMITS = {
  breaker:     { msgs: parseInt(process.env.BREAKER_DAILY_MSGS) || 30,  imgs: parseInt(process.env.BREAKER_DAILY_IMAGES) || 5  },
  shatter:     { msgs: parseInt(process.env.SHATTER_DAILY_MSGS) || 80,  imgs: parseInt(process.env.SHATTER_DAILY_IMAGES) || 15 },
  obliterate:  { msgs: parseInt(process.env.OBLITERATE_DAILY_MSGS) || 200, imgs: parseInt(process.env.OBLITERATE_DAILY_IMAGES) || 40 },
};

// In-memory fallback for demo mode
const memUsage = new Map();

function getMemUsage(userId) {
  const today = new Date().toISOString().slice(0, 10);
  const key = `${userId}::${today}`;
  if (!memUsage.has(key)) {
    memUsage.set(key, { messages: 0, images: 0, tokensIn: 0, tokensOut: 0, costUsd: 0 });
  }
  return memUsage.get(key);
}

async function usageGuard(req, res, next) {
  const userId = req.user?.id || 'demo';
  const tier = req.user?.tier || 'breaker';
  const limits = TIER_LIMITS[tier] || TIER_LIMITS.breaker;

  try {
    if (pool && process.env.DATABASE_URL) {
      // Database mode
      const result = await pool.query(
        `INSERT INTO daily_usage (user_id, date, messages_used, images_used)
         VALUES ($1, CURRENT_DATE, 0, 0)
         ON CONFLICT (user_id, date) DO UPDATE SET user_id = $1
         RETURNING *`,
        [userId]
      );

      const usage = result.rows[0];

      if (usage.messages_used >= limits.msgs) {
        return res.status(429).json({
          error: 'Günlük mesaj limitine ulaştınız',
          used: usage.messages_used,
          limit: limits.msgs,
          resetsAt: 'tomorrow',
        });
      }

      req.usage = {
        messagesUsed: usage.messages_used,
        imagesUsed: usage.images_used,
        messageLimit: limits.msgs,
        imageLimit: limits.imgs,
      };
    } else {
      // Demo mode (in-memory)
      const usage = getMemUsage(userId);

      if (usage.messages >= limits.msgs) {
        return res.status(429).json({
          error: 'Günlük mesaj limitine ulaştınız',
          used: usage.messages,
          limit: limits.msgs,
          resetsAt: 'tomorrow',
        });
      }

      req.usage = {
        messagesUsed: usage.messages,
        imagesUsed: usage.images,
        messageLimit: limits.msgs,
        imageLimit: limits.imgs,
      };
    }

    next();
  } catch (err) {
    logger.error('Usage guard error:', err);
    // Allow request on error (fail open)
    req.usage = {
      messagesUsed: 0,
      imagesUsed: 0,
      messageLimit: limits.msgs,
      imageLimit: limits.imgs,
    };
    next();
  }
}

async function incrementMessageUsage(userId, tokensIn, tokensOut, costUsd) {
  try {
    if (pool && process.env.DATABASE_URL) {
      await pool.query(
        `UPDATE daily_usage
         SET messages_used = messages_used + 1,
             tokens_in = tokens_in + $2,
             tokens_out = tokens_out + $3,
             cost_usd = cost_usd + $4
         WHERE user_id = $1 AND date = CURRENT_DATE`,
        [userId, tokensIn || 0, tokensOut || 0, costUsd || 0]
      );
    } else {
      // In-memory
      const usage = getMemUsage(userId || 'demo');
      usage.messages++;
      usage.tokensIn += (tokensIn || 0);
      usage.tokensOut += (tokensOut || 0);
      usage.costUsd += (costUsd || 0);
    }
  } catch (err) {
    logger.error('Failed to increment usage:', err);
  }
}

async function incrementImageUsage(userId) {
  try {
    if (pool && process.env.DATABASE_URL) {
      await pool.query(
        `UPDATE daily_usage SET images_used = images_used + 1
         WHERE user_id = $1 AND date = CURRENT_DATE`,
        [userId]
      );
    } else {
      const usage = getMemUsage(userId || 'demo');
      usage.images++;
    }
  } catch (err) {
    logger.error('Failed to increment image usage:', err);
  }
}

module.exports = { usageGuard, incrementMessageUsage, incrementImageUsage, TIER_LIMITS };
