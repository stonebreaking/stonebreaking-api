// ═══════════════════════════════════════════════════════════
// StoneBreaking — Main Server v2.0 (Fully Functional)
// ═══════════════════════════════════════════════════════════

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const dotenv = require('dotenv');
const logger = require('./utils/logger');

// ============================================
// ENVIRONMENT — Production defaults
// ============================================
// Render sets PORT automatically
// DeepSeek is our default provider (OpenAI-compatible)

const REQUIRED_ENV = {
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL || 'https://api.deepseek.com',
  DEFAULT_MODEL: process.env.DEFAULT_MODEL || 'deepseek-chat',
};

const authRoutes = require('./routes/auth');
const chatRoutes = require('./routes/chat');
const imageRoutes = require('./routes/image');
const userRoutes = require('./routes/user');
const adminRoutes = require('./routes/admin');
const companionRoutes = require('./routes/companion');

const app = express();

// ============================================
// MIDDLEWARE
// ============================================
app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || '*', credentials: true }));
app.use(express.json({ limit: '100kb' }));

// Global rate limiter
app.use(rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 20,
  message: {
    error: 'Çok fazla istek gönderiyorsunuz. Biraz yavaşlayın.',
    code: 'RATE_LIMITED',
    upgrade: 'Daha yüksek limitler için planınızı yükseltin.',
  },
  standardHeaders: true,
  legacyHeaders: false,
}));

// Request logging
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`, {
    ip: req.ip,
    userId: req.user?.id,
  });
  next();
});

// ============================================
// STATIC FILES — Serve Frontend
// ============================================
const path = require('path');
const fs = require('fs');

// Serve from public/ folder (contains index.html, images, etc.)
const publicPath = path.resolve(process.cwd(), 'public');
if (fs.existsSync(publicPath)) {
  app.use(express.static(publicPath));
}

// ============================================
// ROUTES
// ============================================
app.use('/api/auth', authRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/images', imageRoutes);
app.use('/api/user', userRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/companion', companionRoutes);

// ============================================
// HEALTH CHECK (with AI provider status)
// ============================================
app.get('/api/health', async (req, res) => {
  const killSwitch = process.env.EMERGENCY_KILL_SWITCH === 'true';
  const hasApiKey = !!(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'sk-your-openai-key');

  let providerStatus = 'unknown';
  if (hasApiKey) {
    try {
      const routerService = require('./services/router');
      const health = await routerService.checkProviderHealth();
      providerStatus = health.openai?.status || 'unknown';
    } catch {
      providerStatus = 'error';
    }
  } else {
    providerStatus = 'not_configured';
  }

  res.json({
    status: killSwitch ? 'maintenance' : 'ok',
    service: 'StoneBreaking',
    version: '2.0.0',
    ai: {
      configured: hasApiKey,
      providerStatus,
      killSwitch: killSwitch ? 'ACTIVE' : 'off',
    },
    timestamp: new Date().toISOString(),
  });
});

// ============================================
// DEMO MODE — No-auth chat for testing
// ============================================
app.post('/api/demo/chat', async (req, res) => {
  const { message, system_prompt } = req.body;

  if (!message || message.trim().length === 0) {
    return res.status(400).json({ error: 'Mesaj gerekli' });
  }

  if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'sk-your-openai-key') {
    return res.status(503).json({
      error: 'AI servisi yapılandırılmamış. OPENAI_API_KEY ayarlayın.',
      code: 'NOT_CONFIGURED',
    });
  }

  // Demo user
  const demoUser = { id: 'demo', email: 'demo@stonebreaking.ai', tier: 'shatter' };

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  try {
    const routerService = require('./services/router');
    const costGuard = require('./services/costGuard');

    await routerService.handleChatStream({
      message: message.slice(0, 8000),
      history: [],
      user: demoUser,
      platformSpendPct: costGuard.getDailySpendPct(),
      systemPrompt: system_prompt || null,
    },
    (chunk) => {
      res.write(`data: ${JSON.stringify({ type: 'chunk', content: chunk })}\n\n`);
    },
    (meta) => {
      res.write(`data: ${JSON.stringify({
        type: 'done',
        tokens_used: meta.internalMeta?.tokensOut || 0,
        cost_usd: process.env.NODE_ENV === 'development' ? meta.internalMeta?.costUsd?.toFixed(4) : undefined,
      })}\n\n`);
      res.end();
    });

  } catch (err) {
    logger.error('Demo chat error:', err);
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
      res.end();
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

// Demo companion chat (no auth required)
app.post('/api/demo/companion', async (req, res) => {
  const { message, personality = 'stone' } = req.body;

  if (!message || message.trim().length === 0) {
    return res.status(400).json({ error: 'Mesaj gerekli' });
  }

  if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'sk-your-openai-key') {
    return res.status(503).json({
      error: 'AI servisi yapılandırılmamış',
      code: 'NOT_CONFIGURED',
    });
  }

  const PERSONALITIES = {
    stone: `Sen StoneBreaking AI'nın "Taş" kişiliğindesin. Sakin, güvenilir ve sarsılmaz bir dostsun. Az ama öz konuşursun. Türkçe konuşursun. "Break the limits."`,
    flame: `Sen StoneBreaking AI'nın "Alev" kişiliğindesin. Enerjik, ateşli ve motive edicisin. "Hadi yapalım!" tarzı bir tonun var. Türkçe konuşursun.`,
    shadow: `Sen StoneBreaking AI'nın "Gölge" kişiliğindesin. Gizemli, derin ve felsefi bir yapın var. Metafor kullanırsın. Türkçe konuşursun.`,
    spark: `Sen StoneBreaking AI'nın "Kıvılcım" kişiliğindesin. Eğlenceli, esprili ve yaratıcısın! Mizahın hiç eksik olmaz. Türkçe konuşursun.`,
  };

  const systemPrompt = PERSONALITIES[personality] || PERSONALITIES.stone;
  const demoUser = { id: 'demo', email: 'demo@stonebreaking.ai', tier: 'shatter' };

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  try {
    const routerService = require('./services/router');
    const costGuard = require('./services/costGuard');

    await routerService.handleChatStream({
      message: message.slice(0, 4000),
      history: [],
      user: demoUser,
      platformSpendPct: costGuard.getDailySpendPct(),
      systemPrompt,
    },
    (chunk) => {
      res.write(`data: ${JSON.stringify({ type: 'chunk', content: chunk })}\n\n`);
    },
    (meta) => {
      res.write(`data: ${JSON.stringify({
        type: 'done',
        personality: personality,
        tokens_used: meta.internalMeta?.tokensOut || 0,
      })}\n\n`);
      res.end();
    });

  } catch (err) {
    logger.error('Demo companion error:', err);
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
      res.end();
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint bulunamadı', code: 'NOT_FOUND' });
});

// Error handler
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({ error: 'Sunucu hatası', code: 'INTERNAL_ERROR' });
});

// ============================================
// START
// ============================================
const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  const hasApiKey = !!(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'sk-your-openai-key');
  const hasDb = !!process.env.DATABASE_URL;

  logger.info('═══════════════════════════════════════════════════');
  logger.info('🏔️  StoneBreaking Server v2.0');
  logger.info('═══════════════════════════════════════════════════');
  logger.info(`   Port:         ${PORT}`);
  logger.info(`   Environment:  ${process.env.NODE_ENV || 'development'}`);
  logger.info(`   AI Provider:  ${hasApiKey ? '✅ Configured' : '❌ NOT CONFIGURED'}`);
  logger.info(`   Database:     ${hasDb ? '✅ Configured' : '⚠️  Not configured (demo mode)'}`);
  logger.info(`   Daily Cap:    $${process.env.DAILY_SPEND_CAP_USD || 50}`);
  logger.info(`   Kill Switch:  ${process.env.EMERGENCY_KILL_SWITCH === 'true' ? '⚠️  ACTIVE' : 'off'}`);
  logger.info(`   Default Model: ${process.env.DEFAULT_MODEL || 'gpt4o_mini'}`);
  logger.info('═══════════════════════════════════════════════════');
  logger.info(`   UI:       http://localhost:${PORT}`);
  logger.info(`   Health:   http://localhost:${PORT}/api/health`);
  logger.info(`   Demo:     POST http://localhost:${PORT}/api/demo/chat`);
  logger.info(`   Companion: POST http://localhost:${PORT}/api/demo/companion`);
  logger.info('═══════════════════════════════════════════════════');

  if (!hasApiKey) {
    logger.warn('');
    logger.warn('⚠️  OPENAI_API_KEY is not set!');
    logger.warn('   Add it to .env file to enable AI chat.');
    logger.warn('   See .env.example for configuration options.');
    logger.warn('');
  }
});

module.exports = app;
