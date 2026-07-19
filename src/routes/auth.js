// StoneBreaking — Auth Routes
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

let pool;
try {
  const db = require('../db/connection');
  pool = db.pool;
} catch (err) {
  logger.warn('⚠️  DB connection not available for auth routes');
}

const JWT_SECRET = process.env.JWT_SECRET || 'stonebreaking-secret-2026';
const JWT_EXPIRY = process.env.JWT_EXPIRY || '7d';

// In-memory user store for demo mode
const memUsers = new Map();
// Pre-create a demo user
memUsers.set('demo@stonebreaking.ai', {
  id: 'demo',
  email: 'demo@stonebreaking.ai',
  password_hash: '$2a$12$demo', // Not checkable, but demo mode
  display_name: 'Demo User',
  tier: 'shatter',
  is_banned: false,
  daily_msg_limit: 80,
  daily_image_limit: 15,
});

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
    if (pool && process.env.DATABASE_URL) {
      // Database mode
      const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
      if (existing.rows.length > 0) {
        return res.status(409).json({ error: 'This email is already registered' });
      }

      const passwordHash = await bcrypt.hash(password, 12);
      const result = await pool.query(
        `INSERT INTO users (email, password_hash, display_name, tier, daily_msg_limit, daily_image_limit)
         VALUES ($1, $2, $3, 'breaker', 30, 5) RETURNING id, email, tier, display_name`,
        [email.toLowerCase(), passwordHash, display_name || email.split('@')[0]]
      );

      const user = result.rows[0];
      const token = jwt.sign(
        { id: user.id, email: user.email, tier: user.tier },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRY }
      );

      logger.info(`New user registered: ${user.email} (tier: ${user.tier})`);

      return res.status(201).json({
        token,
        user: {
          id: user.id,
          email: user.email,
          displayName: user.display_name,
          tier: user.tier,
          isFreeTrial: true,
          dailyMsgLimit: 30,
          dailyImageLimit: 5,
        },
      });
    }

    // Demo mode (in-memory)
    const e = email.toLowerCase();
    if (memUsers.has(e)) {
      return res.status(409).json({ error: 'This email is already registered' });
    }

    const userId = `user_${Date.now()}`;
    const passwordHash = await bcrypt.hash(password, 12);
    memUsers.set(e, {
      id: userId,
      email: e,
      password_hash: passwordHash,
      display_name: display_name || e.split('@')[0],
      tier: 'breaker',
      is_banned: false,
      daily_msg_limit: 30,
      daily_image_limit: 5,
    });

    const token = jwt.sign(
      { id: userId, email: e, tier: 'breaker' },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRY }
    );

    res.status(201).json({
      token,
      user: {
        id: userId,
        email: e,
        displayName: display_name || e.split('@')[0],
        tier: 'breaker',
        isFreeTrial: true,
        dailyMsgLimit: 30,
        dailyImageLimit: 5,
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
    if (pool && process.env.DATABASE_URL) {
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

      await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

      return res.json({
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
    }

    // Demo mode
    const e = email.toLowerCase();
    const user = memUsers.get(e);
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
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
// DEMO TOKEN — Get a token for testing without registration
// ============================================
router.post('/demo-token', (req, res) => {
  const token = jwt.sign(
    { id: 'demo', email: 'demo@stonebreaking.ai', tier: 'shatter' },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRY }
  );

  res.json({
    token,
    user: {
      id: 'demo',
      email: 'demo@stonebreaking.ai',
      displayName: 'Demo User',
      tier: 'shatter',
      dailyMsgLimit: 80,
      dailyImageLimit: 15,
    },
  });
});

module.exports = router;
