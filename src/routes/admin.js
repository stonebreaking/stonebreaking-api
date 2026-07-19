// StoneBreaking — Admin Routes (INTERNAL ONLY)
// These endpoints should be protected by admin auth in production
// For MVP, use a simple admin API key

const express = require('express');
const router = express.Router();
const costGuard = require('../services/costGuard');
const { pool } = require('../db/connection');
const logger = require('../utils/logger');

// Simple admin auth
const ADMIN_KEY = process.env.ADMIN_API_KEY || 'stonebreaking-admin-secret';

router.use((req, res, next) => {
  const key = req.headers['x-admin-key'];
  if (key !== ADMIN_KEY) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
});

// ============================================
// COST DASHBOARD
// ============================================
router.get('/costs', (req, res) => {
  res.json(costGuard.getStats());
});

// ============================================
// GENERATE LICENSE KEYS
// ============================================
router.post('/licenses/generate', async (req, res) => {
  const { count, tier, batch_id } = req.body;

  if (!count || !tier || !['breaker', 'shatter', 'obliterate'].includes(tier)) {
    return res.status(400).json({ error: 'count and valid tier required' });
  }

  if (count > 100) {
    return res.status(400).json({ error: 'Max 100 keys per batch' });
  }

  try {
    const result = await pool.query('SELECT * FROM generate_license_keys($1, $2, $3)', [
      count, tier, batch_id || null
    ]);
    const keys = result.rows.map(r => r.generate_license_keys);
    logger.info(`Generated ${count} ${tier} license keys`);
    res.json({ keys, count, tier });
  } catch (err) {
    res.status(500).json({ error: 'Key generation failed' });
  }
});

// ============================================
// USER LIST
// ============================================
router.get('/users', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.email, u.display_name, u.tier, u.activated_at, u.created_at, u.last_login_at, u.is_banned,
              COALESCE(du.messages_used, 0) as today_msgs,
              COALESCE(du.images_used, 0) as today_imgs,
              COALESCE(du.cost_usd, 0) as today_cost
       FROM users u
       LEFT JOIN daily_usage du ON u.id = du.user_id AND du.date = CURRENT_DATE
       ORDER BY u.created_at DESC LIMIT 100`
    );
    res.json({ users: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load users' });
  }
});

// ============================================
// EMERGENCY KILL SWITCH
// ============================================
router.post('/emergency', (req, res) => {
  const { activate } = req.body;

  if (activate) {
    process.env.EMERGENCY_KILL_SWITCH = 'true';
    logger.error('🚨 EMERGENCY KILL SWITCH ACTIVATED');
    res.json({ status: 'KILL_SWITCH_ACTIVE', message: 'All AI requests are now blocked' });
  } else {
    process.env.EMERGENCY_KILL_SWITCH = 'false';
    logger.info('✅ Kill switch deactivated');
    res.json({ status: 'KILL_SWITCH_OFF', message: 'AI requests are now allowed' });
  }
});

// ============================================
// BAN/UNBAN USER
// ============================================
router.post('/users/:id/ban', async (req, res) => {
  try {
    await pool.query('UPDATE users SET is_banned = TRUE, ban_reason = $1 WHERE id = $2', [req.body.reason, req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to ban user' });
  }
});

module.exports = router;
