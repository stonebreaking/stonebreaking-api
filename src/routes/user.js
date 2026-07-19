// StoneBreaking — User Routes
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const { pool } = require('../db/connection');

router.use(authMiddleware);

// Get profile + today's usage
router.get('/profile', async (req, res) => {
  try {
    const userResult = await pool.query(
      'SELECT id, email, display_name, tier, daily_msg_limit, daily_image_limit, activated_at, created_at FROM users WHERE id = $1',
      [req.user.id]
    );

    const usageResult = await pool.query(
      'SELECT messages_used, images_used, tokens_in, tokens_out, cost_usd FROM daily_usage WHERE user_id = $1 AND date = CURRENT_DATE',
      [req.user.id]
    );

    const user = userResult.rows[0];
    const usage = usageResult.rows[0] || { messages_used: 0, images_used: 0 };

    res.json({
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        tier: user.tier,
        isActivated: !!user.activated_at,
        createdAt: user.created_at,
      },
      usage: {
        messagesUsed: usage.messages_used,
        messagesLimit: user.daily_msg_limit,
        messagesRemaining: user.daily_msg_limit - usage.messages_used,
        imagesUsed: usage.images_used,
        imagesLimit: user.daily_image_limit,
        imagesRemaining: user.daily_image_limit - usage.images_used,
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load profile' });
  }
});

// Get 30-day usage history
router.get('/usage/history', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT date, messages_used, images_used, cost_usd
       FROM daily_usage
       WHERE user_id = $1 AND date >= CURRENT_DATE - INTERVAL '30 days'
       ORDER BY date ASC`,
      [req.user.id]
    );
    res.json({ history: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load history' });
  }
});

module.exports = router;
