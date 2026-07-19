// StoneBreaking — Usage Guard Middleware
// Checks daily limits BEFORE processing AI requests

const { pool } = require('../db/connection');
const logger = require('../utils/logger');

const TIER_LIMITS = {
  breaker:     { msgs: parseInt(process.env.BREAKER_DAILY_MSGS) || 30,  imgs: parseInt(process.env.BREAKER_DAILY_IMAGES) || 5  },
  shatter:     { msgs: parseInt(process.env.SHATTER_DAILY_MSGS) || 80,  imgs: parseInt(process.env.SHATTER_DAILY_IMAGES) || 15 },
  obliterate:  { msgs: parseInt(process.env.OBLITERATE_DAILY_MSGS) || 200, imgs: parseInt(process.env.OBLITERATE_DAILY_IMAGES) || 40 },
};

async function usageGuard(req, res, next) {
  const userId = req.user.id;
  const tier = req.user.tier;
  const limits = TIER_LIMITS[tier] || TIER_LIMITS.breaker;

  try {
    // Get or create today's usage record
    const result = await pool.query(
      `INSERT INTO daily_usage (user_id, date, messages_used, images_used)
       VALUES ($1, CURRENT_DATE, 0, 0)
       ON CONFLICT (user_id, date) DO UPDATE SET user_id = $1
       RETURNING *`,
      [userId]
    );

    const usage = result.rows[0];

    // Check message limit
    if (usage.messages_used >= limits.msgs) {
      return res.status(429).json({
        error: 'Günlük mesaj limitine ulaştınız',
        used: usage.messages_used,
        limit: limits.msgs,
        resetsAt: 'tomorrow',
      });
    }

    // Attach usage info to request
    req.usage = {
      messagesUsed: usage.messages_used,
      imagesUsed: usage.images_used,
      messageLimit: limits.msgs,
      imageLimit: limits.imgs,
    };

    next();
  } catch (err) {
    logger.error('Usage guard error:', err);
    // Allow request on DB error (fail open, not closed)
    next();
  }
}

async function incrementMessageUsage(userId, tokensIn, tokensOut, costUsd) {
  try {
    await pool.query(
      `UPDATE daily_usage
       SET messages_used = messages_used + 1,
           tokens_in = tokens_in + $2,
           tokens_out = tokens_out + $3,
           cost_usd = cost_usd + $4
       WHERE user_id = $1 AND date = CURRENT_DATE`,
      [userId, tokensIn || 0, tokensOut || 0, costUsd || 0]
    );
  } catch (err) {
    logger.error('Failed to increment usage:', err);
  }
}

async function incrementImageUsage(userId) {
  try {
    await pool.query(
      `UPDATE daily_usage SET images_used = images_used + 1
       WHERE user_id = $1 AND date = CURRENT_DATE`,
      [userId]
    );
  } catch (err) {
    logger.error('Failed to increment image usage:', err);
  }
}

module.exports = { usageGuard, incrementMessageUsage, incrementImageUsage, TIER_LIMITS };
