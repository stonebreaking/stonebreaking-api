// ═══════════════════════════════════════════════════════════
// StoneBreaking — OpenAI Compatible Provider (RUNTIME)
// ═══════════════════════════════════════════════════════════
// Uses the official OpenAI SDK. Compatible with any
// OpenAI-compatible API (DeepSeek, Together, Groq, etc.)
// via the baseURL override.
// ═══════════════════════════════════════════════════════════

const OpenAI = require('openai');
const logger = require('../utils/logger');

// ═══════════════════════════════════════════════════════════
// PROVIDER REGISTRY — One OpenAI client per base URL
// ═══════════════════════════════════════════════════════════

const clients = new Map();

function getClient(config = {}) {
  const {
    apiKey = process.env.OPENAI_API_KEY,
    baseURL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
  } = config;

  const cacheKey = `${baseURL}::${apiKey?.slice(-8)}`;

  if (!clients.has(cacheKey)) {
    if (!apiKey || apiKey === 'sk-your-openai-key') {
      logger.error('❌ OPENAI_API_KEY is not configured! AI requests will fail.');
      throw new Error('OPENAI_API_KEY is not configured. Set it in .env');
    }

    const client = new OpenAI({
      apiKey,
      baseURL,
      timeout: 60_000,       // 60s timeout
      maxRetries: 2,         // Auto-retry on 429/500
    });

    clients.set(cacheKey, client);
    logger.info(`✅ OpenAI client initialized: ${baseURL}`);
  }

  return clients.get(cacheKey);
}

// ═══════════════════════════════════════════════════════════
// CHAT COMPLETION (non-streaming)
// ═══════════════════════════════════════════════════════════

async function chat({ model, messages, maxTokens = 1000, temperature = 0.7, systemPrompt = null }) {
  const startTime = Date.now();
  const client = getClient();

  // Build message array — inject system prompt if provided
  const apiMessages = buildMessages(messages, systemPrompt);

  try {
    const response = await client.chat.completions.create({
      model: model || process.env.DEFAULT_MODEL || 'gpt-4o-mini',
      messages: apiMessages,
      max_tokens: maxTokens,
      temperature,
      stream: false,
    });

    const latencyMs = Date.now() - startTime;

    logger.debug(`OpenAI chat completed: model=${model} latency=${latencyMs}ms ` +
      `tokens=${response.usage?.total_tokens}`);

    return {
      content: response.choices?.[0]?.message?.content || '',
      usage: {
        prompt_tokens: response.usage?.prompt_tokens || 0,
        completion_tokens: response.usage?.completion_tokens || 0,
        total_tokens: response.usage?.total_tokens || 0,
      },
      latencyMs,
      finishReason: response.choices?.[0]?.finish_reason || 'stop',
      modelUsed: response.model || model,
    };
  } catch (err) {
    const latencyMs = Date.now() - startTime;
    logger.error(`OpenAI chat error [${latencyMs}ms]: ${err.message}`);

    // Classify error for better handling upstream
    if (err.status === 401) {
      throw new ProviderError('API anahtarı geçersiz', 'auth_error', 401);
    }
    if (err.status === 429) {
      throw new ProviderError('Rate limit aşıldı, biraz bekleyin', 'rate_limit', 429);
    }
    if (err.status === 400) {
      throw new ProviderError(`Geçersiz istek: ${err.message}`, 'bad_request', 400);
    }
    if (err.status === 404) {
      throw new ProviderError(`Model bulunamadı: ${model}`, 'model_not_found', 404);
    }
    if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
      throw new ProviderError('AI servisi zaman aşımına uğradı', 'timeout', 504);
    }

    throw new ProviderError(
      `AI servisi geçici olarak kullanılamıyor: ${err.message}`,
      'provider_error',
      err.status || 500
    );
  }
}

// ═══════════════════════════════════════════════════════════
// CHAT COMPLETION (streaming)
// ═══════════════════════════════════════════════════════════

async function chatStream(
  { model, messages, maxTokens = 1000, temperature = 0.7, systemPrompt = null },
  onChunk,
  onDone,
  onError
) {
  const startTime = Date.now();
  const client = getClient();

  const apiMessages = buildMessages(messages, systemPrompt);
  let fullContent = '';
  let tokensOut = 0;

  try {
    const stream = await client.chat.completions.create({
      model: model || process.env.DEFAULT_MODEL || 'gpt-4o-mini',
      messages: apiMessages,
      max_tokens: maxTokens,
      temperature,
      stream: true,
      stream_options: { include_usage: true },
    });

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta;

      if (delta?.content) {
        fullContent += delta.content;
        tokensOut += 1;  // Approximate — real count comes from usage
        onChunk(delta.content);
      }

      // Check for finish
      if (chunk.choices?.[0]?.finish_reason === 'stop') {
        const usage = chunk.usage || {
          prompt_tokens: estimateTokensFromMessages(apiMessages),
          completion_tokens: tokensOut * 4,
          total_tokens: 0,
        };

        const latencyMs = Date.now() - startTime;

        onDone({
          content: fullContent,
          usage: {
            prompt_tokens: usage.prompt_tokens || 0,
            completion_tokens: usage.completion_tokens || tokensOut * 4,
            total_tokens: (usage.prompt_tokens || 0) + (usage.completion_tokens || tokensOut * 4),
          },
          latencyMs,
          modelUsed: model,
          finishReason: 'stop',
        });
        return;
      }
    }

    // If we get here without finish_reason, stream ended naturally
    const latencyMs = Date.now() - startTime;
    onDone({
      content: fullContent,
      usage: {
        prompt_tokens: estimateTokensFromMessages(apiMessages),
        completion_tokens: tokensOut * 4,
        total_tokens: estimateTokensFromMessages(apiMessages) + tokensOut * 4,
      },
      latencyMs,
      modelUsed: model,
      finishReason: 'stop',
    });

  } catch (err) {
    const latencyMs = Date.now() - startTime;
    logger.error(`OpenAI stream error [${latencyMs}ms]: ${err.message}`);

    if (onError) {
      onError(err);
    } else {
      // Fallback: try to send error as chunk
      onChunk('\n\n[Bağlantı hatası. Lütfen tekrar deneyin.]');
      onDone({ content: fullContent, usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }, latencyMs, modelUsed: model, finishReason: 'error' });
    }
  }
}

// ═══════════════════════════════════════════════════════════
// HELPER — Build messages array with optional system prompt
// ═══════════════════════════════════════════════════════════

function buildMessages(messages, systemPrompt) {
  const result = [];

  // System prompt — always first, supports companion personality
  if (systemPrompt) {
    result.push({ role: 'system', content: systemPrompt });
  } else if (!messages.some(m => m.role === 'system')) {
    // Default StoneBreaking identity
    result.push({
      role: 'system',
      content: 'Sen StoneBreaking AI\'sın. Yaratıcı, yardımsever ve bilgili bir asistansın. Her zaman Türkçe ve samimi bir şekilde yanıt ver. "Break the limits." felsefesiyle sınırları aşmaya yardım et.',
    });
  }

  // Add conversation messages
  for (const m of messages) {
    if (m.role === 'system' && systemPrompt) continue;  // Skip if we already added system
    result.push({ role: m.role, content: m.content });
  }

  return result;
}

// ═══════════════════════════════════════════════════════════
// HELPER — Token estimation from messages
// ═══════════════════════════════════════════════════════════

function estimateTokensFromMessages(messages) {
  let total = 0;
  for (const m of messages) {
    // ~4 chars per token for English, ~2.5 for Turkish (more tokens per char)
    total += Math.ceil(m.content.length / 3.5) + 4;  // +4 for message overhead
  }
  return total;
}

// ═══════════════════════════════════════════════════════════
// CUSTOM ERROR CLASS
// ═══════════════════════════════════════════════════════════

class ProviderError extends Error {
  constructor(message, code, statusCode) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

// ═══════════════════════════════════════════════════════════
// HEALTH CHECK
// ═══════════════════════════════════════════════════════════

async function checkHealth() {
  try {
    const startTime = Date.now();
    const client = getClient();
    await client.chat.completions.create({
      model: process.env.CHEAP_MODEL || 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 5,
    });
    return {
      status: 'healthy',
      latencyMs: Date.now() - startTime,
      lastChecked: new Date(),
    };
  } catch (err) {
    return {
      status: 'down',
      error: err.message,
      lastChecked: new Date(),
    };
  }
}

// ═══════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════

module.exports = {
  chat,
  chatStream,
  checkHealth,
  getClient,
  buildMessages,
  estimateTokensFromMessages,
  ProviderError,
};
