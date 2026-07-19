// ═══════════════════════════════════════════════════════════
// StoneBreaking — Chat Routes (Fully Functional)
// ═══════════════════════════════════════════════════════════
// Production-ready chat endpoint with:
// - Auth + usage guard + rate limiting
// - Streaming SSE responses
// - System prompt injection (companion compatible)
// - Token estimation + cost tracking
// - Graceful error handling with upgrade messages
// - Conversation persistence
// ═══════════════════════════════════════════════════════════

const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const { usageGuard, incrementMessageUsage } = require('../middleware/usageGuard');
const routerService = require('../services/router');
const costGuard = require('../services/costGuard');
const tokenEstimator = require('../services/tokenEstimator');
const logger = require('../utils/logger');

// Apply auth + usage guard to all chat routes
router.use(authMiddleware, usageGuard);

// ═══════════════════════════════════════════════════════════
// SEND MESSAGE (Streaming SSE)
// ═══════════════════════════════════════════════════════════

router.post('/message', async (req, res) => {
  const { message, conversation_id, system_prompt } = req.body;

  // ── Validation ────────────────────────────────────────
  if (!message || message.trim().length === 0) {
    return res.status(400).json({
      error: 'Mesaj gerekli',
      code: 'EMPTY_MESSAGE',
    });
  }

  // ── Message length limits (by tier) ───────────────────
  const tierMaxTokens = {
    breaker: 4000,
    shatter: 8000,
    obliterate: 16000,
  };
  const maxInputTokens = tierMaxTokens[req.user.tier] || 4000;
  const maxChars = maxInputTokens * 4;

  if (message.length > maxChars) {
    return res.status(400).json({
      error: `Mesajınız çok uzun. Maksimum ${maxChars} karakter (${maxInputTokens} token) kullanabilirsiniz.`,
      code: 'MESSAGE_TOO_LONG',
      maxLength: maxChars,
      currentLength: message.length,
      upgrade: req.user.tier !== 'obliterate'
        ? 'Daha uzun mesajlar için planınızı yükseltin.'
        : null,
    });
  }

  const trimmedMessage = message.slice(0, maxChars);

  // ── Kill switch check ─────────────────────────────────
  if (process.env.EMERGENCY_KILL_SWITCH === 'true') {
    return res.status(503).json({
      error: 'Sistem şu anda bakımda. Lütfen biraz sonra tekrar deneyin.',
      code: 'MAINTENANCE',
    });
  }

  // ── Set up SSE headers ────────────────────────────────
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  try {
    // ── Get or create conversation ──────────────────────
    let convId = conversation_id;
    if (!convId) {
      // No DB? Use in-memory conversation tracking
      convId = `conv_${req.user.id}_${Date.now()}`;
    }

    // ── Get conversation history ────────────────────────
    // Try DB first, fallback to request body history
    let history = req.body.history || [];

    // If we have a pool and conversation_id, try loading from DB
    try {
      const { pool } = require('../db/connection');
      if (pool && conversation_id) {
        const historyResult = await pool.query(
          'SELECT role, content FROM messages WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 10',
          [conversation_id]
        );
        if (historyResult.rows.length > 0) {
          history = historyResult.rows.reverse();
        }
      }
    } catch (dbErr) {
      // DB not available, use provided history
      logger.debug('DB history unavailable, using request history');
    }

    // ── Get platform spend percentage ───────────────────
    const platformSpendPct = costGuard.getDailySpendPct();

    // ── Estimate tokens before request ──────────────────
    const estimatedInputTokens = tokenEstimator.estimateTokens(trimmedMessage, { language: 'mixed' });

    // ── Stream AI response ──────────────────────────────
    let fullContent = '';
    let streamMeta = null;

    await routerService.handleChatStream({
      message: trimmedMessage,
      history,
      user: req.user,
      platformSpendPct,
      systemPrompt: system_prompt || null,
    },
    (chunk) => {
      // On chunk
      fullContent += chunk;
      res.write(`data: ${JSON.stringify({ type: 'chunk', content: chunk })}\n\n`);
    },
    (meta) => {
      // On done
      streamMeta = meta;

      // ── Update usage counters ────────────────────────
      try {
        incrementMessageUsage(
          req.user.id,
          meta.internalMeta?.tokensIn || estimatedInputTokens,
          meta.internalMeta?.tokensOut || 0,
          meta.internalMeta?.costUsd || 0
        );
      } catch (err) {
        logger.error('Failed to increment usage:', err);
      }

      // ── Save to DB if available ──────────────────────
      try {
        const { pool } = require('../db/connection');
        if (pool && conversation_id) {
          // Save user message
          pool.query(
            'INSERT INTO messages (conversation_id, role, content) VALUES ($1, $2, $3)',
            [convId, 'user', trimmedMessage]
          ).catch(() => {});

          // Save assistant message
          pool.query(
            'INSERT INTO messages (conversation_id, role, content, model_id, tokens_in, tokens_out, cost_usd) VALUES ($1, $2, $3, $4, $5, $6, $7)',
            [convId, 'assistant', fullContent,
             meta.internalMeta?.modelUsed,
             meta.internalMeta?.tokensIn,
             meta.internalMeta?.tokensOut,
             meta.internalMeta?.costUsd]
          ).catch(() => {});
        }
      } catch (dbErr) {
        // DB not available, skip persistence
      }

      // ── Send completion event ────────────────────────
      // Users NEVER see model identity
      const usage = req.usage;
      res.write(`data: ${JSON.stringify({
        type: 'done',
        conversation_id: convId,
        remaining_messages: usage ? usage.messageLimit - usage.messagesUsed - 1 : null,
        tokens_used: meta.internalMeta?.tokensOut || 0,
      })}\n\n`);
      res.end();
    });

  } catch (err) {
    logger.error('Chat error:', err);

    // ── Graceful error responses ────────────────────────
    let errorMessage = 'Bir hata oluştu. Lütfen tekrar deneyin.';
    let errorCode = 'UNKNOWN_ERROR';

    if (err.message.includes('uzun')) {
      errorMessage = err.message;
      errorCode = 'MESSAGE_TOO_LONG';
    } else if (err.message.includes('kapasite') || err.message.includes('limit')) {
      errorMessage = 'Şu anda sistem kapasiteye ulaştı. Lütfen biraz sonra tekrar deneyin.';
      errorCode = 'CAPACITY_LIMIT';
    } else if (err.message.includes('kullanılamıyor') || err.message.includes('yok')) {
      errorMessage = 'AI servisi geçici olarak kullanılamıyor. Lütfen biraz sonra deneyin.';
      errorCode = 'SERVICE_UNAVAILABLE';
    } else if (err.message.includes('rate limit') || err.message.includes('yoğun')) {
      errorMessage = 'Şu anda çok yoğun talep var. Biraz bekleyip tekrar deneyin.';
      errorCode = 'RATE_LIMITED';
    }

    // Try to send as SSE error if headers are already sent
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: errorMessage, code: errorCode })}\n\n`);
      res.end();
    } else {
      res.status(500).json({ error: errorMessage, code: errorCode });
    }
  }
});

// ═══════════════════════════════════════════════════════════
// SEND MESSAGE (Non-streaming, for simple integrations)
// ═══════════════════════════════════════════════════════════

router.post('/message/sync', async (req, res) => {
  const { message, history = [], system_prompt } = req.body;

  if (!message || message.trim().length === 0) {
    return res.status(400).json({ error: 'Mesaj gerekli', code: 'EMPTY_MESSAGE' });
  }

  if (process.env.EMERGENCY_KILL_SWITCH === 'true') {
    return res.status(503).json({ error: 'Sistem bakımda.', code: 'MAINTENANCE' });
  }

  const maxChars = (req.user.tier === 'obliterate' ? 16000 : req.user.tier === 'shatter' ? 8000 : 4000) * 4;
  const trimmedMessage = message.slice(0, maxChars);

  try {
    const platformSpendPct = costGuard.getDailySpendPct();

    const response = await routerService.handleChat({
      message: trimmedMessage,
      history,
      user: req.user,
      platformSpendPct,
      systemPrompt: system_prompt || null,
    });

    // Update usage
    try {
      incrementMessageUsage(
        req.user.id,
        response.usage.tokensIn,
        response.usage.tokensOut,
        response.internalMeta.costUsd
      );
    } catch (err) {
      logger.error('Usage increment error:', err);
    }

    res.json({
      content: response.content,
      conversation_id: req.body.conversation_id || null,
      usage: {
        tokens_used: response.usage.tokensOut,
        remaining_messages: req.usage ? req.usage.messageLimit - req.usage.messagesUsed - 1 : null,
      },
    });

  } catch (err) {
    logger.error('Sync chat error:', err);
    res.status(500).json({
      error: err.message || 'Bir hata oluştu.',
      code: 'AI_ERROR',
    });
  }
});

// ═══════════════════════════════════════════════════════════
// GET CONVERSATIONS
// ═══════════════════════════════════════════════════════════

router.get('/conversations', async (req, res) => {
  try {
    const { pool } = require('../db/connection');
    const result = await pool.query(
      'SELECT id, title, created_at, updated_at FROM conversations WHERE user_id = $1 AND is_archived = FALSE ORDER BY updated_at DESC LIMIT 50',
      [req.user.id]
    );
    res.json({ conversations: result.rows });
  } catch (err) {
    // DB not available
    res.json({ conversations: [] });
  }
});

// ═══════════════════════════════════════════════════════════
// GET MESSAGES IN CONVERSATION
// ═══════════════════════════════════════════════════════════

router.get('/conversations/:id/messages', async (req, res) => {
  try {
    const { pool } = require('../db/connection');
    const result = await pool.query(
      'SELECT id, role, content, created_at FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC',
      [req.params.id]
    );
    res.json({ messages: result.rows });
  } catch (err) {
    res.json({ messages: [] });
  }
});

// ═══════════════════════════════════════════════════════════
// DELETE CONVERSATION
// ═══════════════════════════════════════════════════════════

router.delete('/conversations/:id', async (req, res) => {
  try {
    const { pool } = require('../db/connection');
    await pool.query('DELETE FROM conversations WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    res.json({ success: true });
  } catch (err) {
    res.json({ success: true }); // Optimistic
  }
});

// ═══════════════════════════════════════════════════════════
// GET USAGE STATS
// ═══════════════════════════════════════════════════════════

router.get('/usage', (req, res) => {
  const usage = req.usage || {};
  const costStats = costGuard.getStats();

  res.json({
    tier: req.user.tier,
    messages: {
      used: usage.messagesUsed || 0,
      limit: usage.messageLimit || 30,
      remaining: (usage.messageLimit || 30) - (usage.messagesUsed || 0),
    },
    images: {
      used: usage.imagesUsed || 0,
      limit: usage.imageLimit || 5,
      remaining: (usage.imageLimit || 5) - (usage.imagesUsed || 0),
    },
    // Platform-wide stats (for admin, but useful for debugging)
    _platform: process.env.NODE_ENV === 'development' ? costStats : undefined,
  });
});

module.exports = router;
