// StoneBreaking — Auth Routes
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../db/connection');
const logger = require('../utils/logger');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this';
const JWT_EXPIRY = process.env.JWT_EXPIRY || '7d';

// ============================================
// REGISTER
// ============================================
router.post('/register', async (req, res) => {
  const { email, password, display_name } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  try {
    // Check if user exists
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'This email is already registered' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Create user (default tier: breaker with free trial limits)
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, display_name, tier, daily_msg_limit, daily_image_limit)
       VALUES ($1, $2, $3, 'breaker', 5, 1) RETURNING id, email, tier, display_name`,
      [email.toLowerCase(), passwordHash, display_name || email.split('@')[0]]
    );

    const user = result.rows[0];

    // Generate JWT
    const token = jwt.sign(
      { id: user.id, email: user.email, tier: user.tier },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRY }
    );

    logger.info(`New user registered: ${user.email} (tier: ${user.tier})`);

    res.status(201).json({
      token,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        tier: user.tier,
        isFreeTrial: true,
        dailyMsgLimit: 5,
        dailyImageLimit: 1,
      },
    });
  } catch (err) {
    logger.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// ============================================
// LOGIN
// ============================================
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const result = await pool.query(
      'SELECT id, email, password_hash, display_name, tier, is_banned, daily_msg_limit, daily_image_limit FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = result.rows[0];

    if (user.is_banned) {
      return res.status(403).json({ error: 'Account suspended' });
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, tier: user.tier },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRY }
    );

    // Update last login
    await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        tier: user.tier,
        dailyMsgLimit: user.daily_msg_limit,
        dailyImageLimit: user.daily_image_limit,
      },
    });
  } catch (err) {
    logger.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ============================================
// ACTIVATE LICENSE KEY
// ============================================
router.post('/activate', async (req, res) => {
  const { license_key } = req.body;
  const userId = req.user?.id; // Optional: can be used without auth for initial activation

  if (!license_key) {
    return res.status(400).json({ error: 'License key is required' });
  }

  try {
    // Find the license key
    const keyResult = await pool.query(
      'SELECT id, tier, is_active, claimed_by FROM license_keys WHERE key = $1',
      [license_key.toUpperCase()]
    );

    if (keyResult.rows.length === 0) {
      return res.status(404).json({ error: 'Invalid license key' });
    }

    const key = keyResult.rows[0];

    if (!key.is_active) {
      return res.status(400).json({ error: 'This license key has been deactivated' });
    }

    if (key.claimed_by) {
      return res.status(400).json({ error: 'This license key has already been used' });
    }

    // Determine which user to activate for
    let targetUserId = userId;
    if (!targetUserId) {
      return res.status(401).json({ error: 'Please log in first' });
    }

    // Tier-specific limits
    const tierLimits = {
      breaker:    { msgs: parseInt(process.env.BREAKER_DAILY_MSGS) || 30,  imgs: parseInt(process.env.BREAKER_DAILY_IMAGES) || 5  },
      shatter:    { msgs: parseInt(process.env.SHATTER_DAILY_MSGS) || 80,  imgs: parseInt(process.env.SHATTER_DAILY_IMAGES) || 15 },
      obliterate: { msgs: parseInt(process.env.OBLITERATE_DAILY_MSGS) || 200, imgs: parseInt(process.env.OBLITERATE_DAILY_IMAGES) || 40 },
    };

    const limits = tierLimits[key.tier] || tierLimits.breaker;

    // Update user tier
    await pool.query(
      `UPDATE users SET tier = $1, license_key = $2, activated_at = NOW(),
       daily_msg_limit = $3, daily_image_limit = $4 WHERE id = $5`,
      [key.tier, license_key.toUpperCase(), limits.msgs, limits.imgs, targetUserId]
    );

    // Mark license as claimed
    await pool.query(
      'UPDATE license_keys SET claimed_by = $1, claimed_at = NOW() WHERE id = $2',
      [targetUserId, key.id]
    );

    // Generate new JWT with updated tier
    const userResult = await pool.query('SELECT email, display_name FROM users WHERE id = $1', [targetUserId]);
    const user = userResult.rows[0];

    const token = jwt.sign(
      { id: targetUserId, email: user.email, tier: key.tier },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRY }
    );

    logger.info(`License activated: ${key.tier} for user ${targetUserId}`);

    res.json({
      success: true,
      message: `${key.tier.charAt(0).toUpperCase() + key.tier.slice(1)} plan activated!`,
      token,
      user: {
        id: targetUserId,
        email: user.email,
        displayName: user.display_name,
        tier: key.tier,
        dailyMsgLimit: limits.msgs,
        dailyImageLimit: limits.imgs,
      },
    });
  } catch (err) {
    logger.error('Activation error:', err);
    res.status(500).json({ error: 'Activation failed' });
  }
});

module.exports = router;
