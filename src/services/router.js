// ═══════════════════════════════════════════════════════════
// StoneBreaking — AI Model Router (THE CORE BRAIN) v2
// ═══════════════════════════════════════════════════════════
// Fully functional router that connects to real AI providers.
// - Smart model selection based on query type + tier + cost
// - Retry + failover logic
// - Personality system prompt injection (companion compatible)
// - Token estimation + cost tracking on every request
// - Users NEVER see which model is used. StoneBreaking IS the AI.
// ═══════════════════════════════════════════════════════════

const logger = require('../utils/logger');
const costGuard = require('./costGuard');
const tokenEstimator = require('./tokenEstimator');

// Provider instances (lazy-loaded)
let openaiProvider = null;
let deepseekProvider = null;
let kimiProvider = null;
let anthropicProvider = null;
let googleProvider = null;

// ═══════════════════════════════════════════════════════════
// MODEL REGISTRY — All models with cost + quality data
// ═══════════════════════════════════════════════════════════

const MODEL_REGISTRY = {
  // ── PRIMARY: OpenAI-compatible models ──────────────────
  gpt4o_mini: {
    id: 'gpt4o_mini',
    provider: 'openai',
    apiModel: 'gpt-4o-mini',
    costIn: 0.15,    // $/1M input tokens
    costOut: 0.60,   // $/1M output tokens
    quality: 85,
    maxContext: 128000,
    tierMin: 'breaker',
    supports: ['text', 'code', 'reasoning'],
    latencyMs: 1200,
    failover: 'gpt4o',
    isDefault: true,
  },
  gpt4o: {
    id: 'gpt4o',
    provider: 'openai',
    apiModel: 'gpt-4o',
    costIn: 2.50,
    costOut: 10.00,
    quality: 94,
    maxContext: 128000,
    tierMin: 'shatter',
    supports: ['text', 'code', 'reasoning', 'math', 'vision'],
    latencyMs: 2000,
    failover: 'gpt4o_mini',
  },
  gpt4o_pro: {
    id: 'gpt4o_pro',
    provider: 'openai',
    apiModel: 'gpt-4o-2024-11-20',
    costIn: 5.00,
    costOut: 20.00,
    quality: 97,
    maxContext: 128000,
    tierMin: 'obliterate',
    supports: ['text', 'code', 'reasoning', 'math', 'vision', 'agent'],
    latencyMs: 3000,
    failover: 'gpt4o',
  },

  // ── DEEPSEEK (cost-effective) ────────────────────────
  deepseek_v4_flash: {
    id: 'deepseek_v4_flash',
    provider: 'deepseek',
    apiModel: 'deepseek-chat',
    costIn: 0.10,
    costOut: 0.20,
    quality: 82,
    maxContext: 128000,
    tierMin: 'breaker',
    supports: ['text', 'code', 'reasoning'],
    latencyMs: 1500,
    failover: 'gpt4o_mini',
  },
  deepseek_v4: {
    id: 'deepseek_v4',
    provider: 'deepseek',
    apiModel: 'deepseek-chat',
    costIn: 0.27,
    costOut: 1.10,
    quality: 91,
    maxContext: 128000,
    tierMin: 'breaker',
    supports: ['text', 'code', 'reasoning', 'math'],
    latencyMs: 2500,
    failover: 'kimi_k26',
  },

  // ── FAILBACK: Other providers ─────────────────────────
  kimi_k26: {
    id: 'kimi_k26',
    provider: 'kimi',
    apiModel: 'moonshot-v1-128k',
    costIn: 0.73,
    costOut: 3.49,
    quality: 92,
    maxContext: 256000,
    tierMin: 'shatter',
    supports: ['text', 'code', 'reasoning', 'math', 'agent'],
    latencyMs: 3000,
    failover: 'deepseek_v4',
  },
  gemini_31_pro: {
    id: 'gemini_31_pro',
    provider: 'google',
    apiModel: 'gemini-2.5-pro',
    costIn: 2.00,
    costOut: 12.00,
    quality: 96,
    maxContext: 1000000,
    tierMin: 'obliterate',
    supports: ['text', 'code', 'reasoning', 'math', 'vision', 'agent'],
    latencyMs: 2000,
    failover: 'gpt4o',
  },
  claude_opus47: {
    id: 'claude_opus47',
    provider: 'anthropic',
    apiModel: 'claude-opus-4-7-20250410',
    costIn: 5.00,
    costOut: 25.00,
    quality: 97,
    maxContext: 1000000,
    tierMin: 'obliterate',
    supports: ['text', 'code', 'reasoning', 'math', 'vision', 'agent'],
    latencyMs: 4000,
    failover: 'gemini_31_pro',
  },
};

// ═══════════════════════════════════════════════════════════
// LAZY PROVIDER LOADER
// ═══════════════════════════════════════════════════════════

function loadProvider(providerName) {
  switch (providerName) {
    case 'openai':
      if (!openaiProvider) {
        try {
          openaiProvider = require('../providers/openaiProvider');
          logger.info('✅ OpenAI provider loaded');
        } catch (err) {
          logger.error(`❌ Failed to load OpenAI provider: ${err.message}`);
          return null;
        }
      }
      return openaiProvider;

    case 'deepseek':
      if (!deepseekProvider) {
        try {
          deepseekProvider = require('../providers/deepseek');
          logger.info('✅ DeepSeek provider loaded');
        } catch (err) {
          logger.error(`❌ Failed to load DeepSeek provider: ${err.message}`);
          return null;
        }
      }
      return deepseekProvider;

    case 'kimi':
      if (!kimiProvider) {
        try {
          kimiProvider = require('../providers/kimi');
          logger.info('✅ Kimi provider loaded');
        } catch (err) {
          logger.error(`❌ Failed to load Kimi provider: ${err.message}`);
          return null;
        }
      }
      return kimiProvider;

    case 'anthropic':
      if (!anthropicProvider) {
        try {
          anthropicProvider = require('../providers/anthropic');
          logger.info('✅ Anthropic provider loaded');
        } catch (err) {
          logger.error(`❌ Failed to load Anthropic provider: ${err.message}`);
          return null;
        }
      }
      return anthropicProvider;

    case 'google':
      if (!googleProvider) {
        try {
          googleProvider = require('../providers/google');
          logger.info('✅ Google provider loaded');
        } catch (err) {
          logger.error(`❌ Failed to load Google provider: ${err.message}`);
          return null;
        }
      }
      return googleProvider;

    default:
      logger.error(`Unknown provider: ${providerName}`);
      return null;
  }
}

// ═══════════════════════════════════════════════════════════
// QUERY CLASSIFICATION
// ═══════════════════════════════════════════════════════════

function classifyQuery(message, history = []) {
  const msg = message.toLowerCase();

  const codeScore = countMatches(msg, [
    /\b(kod|code|program|fonksiyon|function|python|javascript|typescript|react|sql|api|html|css|debug|hata|error|compile|deploy|git|docker|server|backend|frontend|rust|go|yaml|json)\b/,
    /\b(def |class |import |from |const |let |var |return |async |await |function |=>)\b/,
    /```/,
  ]);

  const mathScore = countMatches(msg, [
    /\b(matematik|hesapla|formül|denklem|istatistik|olasılık|integral|türev|math|equation|prove|ispat|calculate|algorithm)\b/,
    /\d+\s*[\+\-\*\/\^=]\s*\d+/,
  ]);

  const reasonScore = countMatches(msg, [
    /\b(neden|niçin|nasıl|açıkla|karşılaştır|analiz|nedeni|sonuç|mantık|explain|why|how|compare|analyze|reason|think|deeply|detaylı)\b/,
  ]);

  const simpleScore = countMatches(msg, [
    /\b(ne|nedir|kim|hangi|kaç|ne zaman|what|who|when|where|how many)\b/,
    /\?\s*$/,
  ]);

  const creativeScore = countMatches(msg, [
    /\b(yaz|şiir|hikaye|öykü|makale|blog|içerik|write|poem|story|article|creative|compose|tasarla|design)\b/,
  ]);

  const agentScore = countMatches(msg, [
    /\b(agent|otomasyon|iş akışı|workflow|otonom|task|görev|planla|organize|schedule)\b/,
  ]);

  const scores = { code: codeScore, math: mathScore, reasoning: reasonScore, simple: simpleScore, creative: creativeScore, agent: agentScore };
  // Priority boost: code > math > agent > reasoning > creative > simple
  const typePriority = { code: 6, math: 5, agent: 4, reasoning: 3, creative: 2, simple: 1 };
  const sorted = Object.entries(scores).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return (typePriority[b[0]] || 0) - (typePriority[a[0]] || 0);
  });
  const maxEntry = sorted[0];
  const maxScore = maxEntry[1];

  const type = maxScore > 0 ? maxEntry[0] : 'simple';
  const complexity = maxScore > 3 ? 'complex' : maxScore > 1 ? 'medium' : 'simple';

  return { type, complexity, confidence: maxScore > 0 ? maxScore / (Object.values(scores).reduce((a, b) => a + b, 0) || 1) : 0.5 };
}

function countMatches(text, patterns) {
  return patterns.reduce((sum, p) => sum + (text.match(p) || []).length, 0);
}

// ═══════════════════════════════════════════════════════════
// SMART MODEL SELECTION
// ═══════════════════════════════════════════════════════════

function selectModel(classification, userTier, platformSpendPct) {
  const { type, complexity } = classification;
  const tierOrder = { breaker: 0, shatter: 1, obliterate: 2 };
  const userLevel = tierOrder[userTier] ?? 0;

  // ── Emergency: Platform spend > 90% ──────────────────
  if (platformSpendPct > 90) {
    logger.warn(`🚨 EMERGENCY: Platform spend at ${platformSpendPct}% — forcing cheapest model`);
    return MODEL_REGISTRY.deepseek_v4_flash || MODEL_REGISTRY.gpt4o_mini;
  }

  // ── Auto-downgrade at 80% spend ──────────────────────
  if (platformSpendPct > 80) {
    logger.warn(`⚠️  Platform spend at ${platformSpendPct}% — cost optimization active`);
    return MODEL_REGISTRY.gpt4o_mini;
  }

  // ── Simple queries → cheapest capable model ───────────
  if (type === 'simple' && complexity === 'simple') {
    return MODEL_REGISTRY.gpt4o_mini;
  }

  // ── Code routing ──────────────────────────────────────
  if (type === 'code') {
    if (complexity === 'complex' && userLevel >= 1) {
      return MODEL_REGISTRY.gpt4o;  // Shatter+
    }
    return MODEL_REGISTRY.gpt4o_mini;
  }

  // ── Math routing ──────────────────────────────────────
  if (type === 'math' && complexity === 'complex') {
    if (userLevel >= 2) return MODEL_REGISTRY.gpt4o_pro;
    if (userLevel >= 1) return MODEL_REGISTRY.gpt4o;
    return MODEL_REGISTRY.gpt4o_mini;
  }

  // ── Reasoning routing ────────────────────────────────
  if (type === 'reasoning' && complexity === 'complex') {
    if (userLevel >= 2) return MODEL_REGISTRY.claude_opus47;
    if (userLevel >= 1) return MODEL_REGISTRY.gpt4o;
    return MODEL_REGISTRY.gpt4o_mini;
  }

  // ── Agent routing ────────────────────────────────────
  if (type === 'agent') {
    if (userLevel >= 2) return MODEL_REGISTRY.claude_opus47;
    if (userLevel >= 1) return MODEL_REGISTRY.gpt4o;
    return MODEL_REGISTRY.gpt4o_mini;
  }

  // ── Creative routing ─────────────────────────────────
  if (type === 'creative') {
    return MODEL_REGISTRY.gpt4o_mini;  // Mini is great for creative writing
  }

  // ── Default: cost-optimized quality ───────────────────
  return MODEL_REGISTRY.gpt4o_mini;
}

// ═══════════════════════════════════════════════════════════
// MAIN CHAT HANDLER (non-streaming)
// ═══════════════════════════════════════════════════════════

async function handleChat({ message, history, user, platformSpendPct, systemPrompt }) {
  // 1. Classify the query
  const classification = classifyQuery(message, history);
  logger.info(`📍 Query classified: type=${classification.type}, complexity=${classification.complexity}, confidence=${classification.confidence.toFixed(2)}`);

  // 2. Select model
  let model = selectModel(classification, user.tier, platformSpendPct);

  // 3. Tier access check
  const tierOrder = { breaker: 0, shatter: 1, obliterate: 2 };
  if ((tierOrder[user.tier] ?? 0) < (tierOrder[model.tierMin] ?? 0)) {
    logger.info(`🔒 User tier ${user.tier} can't access ${model.id}, downgrading`);
    model = MODEL_REGISTRY.gpt4o_mini;
  }

  // 4. Estimate tokens and cost
  const inputTokens = tokenEstimator.estimateTokens(message, { language: 'mixed' });
  const historyTokens = tokenEstimator.estimateTokensFromMessages(history);
  const totalInputTokens = inputTokens + historyTokens;
  const estimatedOutputTokens = classification.complexity === 'complex' ? 1200 : 800;
  const estimatedCost = tokenEstimator.calculateCost(totalInputTokens, estimatedOutputTokens, model);

  // 5. Token limit validation
  const tokenCheck = tokenEstimator.validateTokenLimit(totalInputTokens, user.tier, model.maxContext);
  if (!tokenCheck.allowed) {
    throw new Error(`Mesajınız çok uzun. ${tokenCheck.overBy} token fazla. Lütfen kısaltın.`);
  }

  // 6. Pre-request cost guard
  const costCheck = costGuard.canAfford(estimatedCost);
  if (!costCheck.allowed) {
    logger.warn(`💰 Cost guard blocked: ${costCheck.reason}`);
    // Try cheapest model
    const cheapModel = MODEL_REGISTRY.gpt4o_mini;
    const cheapCost = tokenEstimator.calculateCost(totalInputTokens, 500, cheapModel);
    const cheapCheck = costGuard.canAfford(cheapCost);
    if (!cheapCheck.allowed) {
      throw new Error('Şu anda sistem kapasiteye ulaştı. Lütfen biraz sonra tekrar deneyin.');
    }
    model = cheapModel;
  }

  // 7. Per-request cost limit
  const maxPerRequest = parseFloat(process.env.MAX_PER_REQUEST_COST_USD) || 0.05;
  if (estimatedCost > maxPerRequest) {
    logger.warn(`💸 Request cost $${estimatedCost.toFixed(4)} exceeds limit $${maxPerRequest}`);
    throw new Error('Mesajınız çok uzun. Lütfen kısaltın.');
  }

  // 8. Call the model with retry + failover
  const provider = loadProvider(model.provider);
  if (!provider) {
    throw new Error('AI servisi şu anda kullanılamıyor. Lütfen biraz sonra deneyin.');
  }

  let response;
  let retries = 0;
  const MAX_RETRIES = 2;

  while (retries <= MAX_RETRIES) {
    try {
      response = await provider.chat({
        model: model.apiModel || model.id,
        messages: history.concat([{ role: 'user', content: message }]),
        maxTokens: estimatedOutputTokens,
        systemPrompt: systemPrompt || null,
      });
      break;
    } catch (err) {
      retries++;
      logger.error(`❌ Model ${model.id} failed (attempt ${retries}/${MAX_RETRIES + 1}): ${err.message}`);

      // If out of retries, try failover
      if (retries > MAX_RETRIES) {
        if (model.failover && MODEL_REGISTRY[model.failover]) {
          logger.info(`🔄 Failing over to ${model.failover}`);
          model = MODEL_REGISTRY[model.failover];
          const failoverProvider = loadProvider(model.provider);
          if (failoverProvider) {
            try {
              response = await failoverProvider.chat({
                model: model.apiModel || model.id,
                messages: history.concat([{ role: 'user', content: message }]),
                maxTokens: estimatedOutputTokens,
                systemPrompt: systemPrompt || null,
              });
              break;
            } catch (failoverErr) {
              logger.error(`❌ Failover ${model.id} also failed: ${failoverErr.message}`);
            }
          }
        }
        // All providers failed
        if (err.code === 'rate_limit') {
          throw new Error('Şu anda çok yoğun talep var. Biraz bekleyip tekrar deneyin.');
        }
        throw new Error('AI modelleri geçici olarak kullanılamıyor. Lütfen biraz sonra deneyin.');
      }

      // Wait before retry (exponential backoff)
      await new Promise(r => setTimeout(r, 1000 * Math.pow(2, retries)));
    }
  }

  // 9. Calculate actual cost
  const actualInputTokens = response.usage?.prompt_tokens || totalInputTokens;
  const actualOutputTokens = response.usage?.completion_tokens || estimatedOutputTokens;
  const actualCost = tokenEstimator.calculateCost(actualInputTokens, actualOutputTokens, model);

  // 10. Record cost
  costGuard.recordSpend(actualCost, model.id);

  logger.info(`✅ Chat completed: model=${model.id} tokens=${actualInputTokens}+${actualOutputTokens} cost=$${actualCost.toFixed(4)} latency=${response.latencyMs}ms`);

  // 11. Return (NEVER expose model identity to user)
  return {
    content: response.content,
    usage: {
      tokensIn: actualInputTokens,
      tokensOut: actualOutputTokens,
    },
    internalMeta: {
      modelUsed: model.id,
      apiModel: model.apiModel,
      classification,
      costUsd: actualCost,
      latencyMs: response.latencyMs,
      inputTokens: actualInputTokens,
      outputTokens: actualOutputTokens,
    },
  };
}

// ═══════════════════════════════════════════════════════════
// STREAMING CHAT HANDLER
// ═══════════════════════════════════════════════════════════

async function handleChatStream({ message, history, user, platformSpendPct, systemPrompt }, onChunk, onDone) {
  // 1. Classify + select model
  const classification = classifyQuery(message, history);
  let model = selectModel(classification, user.tier, platformSpendPct);

  // Tier check
  const tierOrder = { breaker: 0, shatter: 1, obliterate: 2 };
  if ((tierOrder[user.tier] ?? 0) < (tierOrder[model.tierMin] ?? 0)) {
    model = MODEL_REGISTRY.gpt4o_mini;
  }

  // Cost check
  const inputTokens = tokenEstimator.estimateTokens(message, { language: 'mixed' });
  const historyTokens = tokenEstimator.estimateTokensFromMessages(history);
  const totalInputTokens = inputTokens + historyTokens;
  const estimatedCost = tokenEstimator.calculateCost(totalInputTokens, 800, model);

  const costCheck = costGuard.canAfford(estimatedCost);
  if (!costCheck.allowed) {
    model = MODEL_REGISTRY.gpt4o_mini;
  }

  // Per-request cost limit
  const maxPerRequest = parseFloat(process.env.MAX_PER_REQUEST_COST_USD) || 0.05;
  if (estimatedCost > maxPerRequest) {
    onChunk('\n\n[Mesajınız çok uzun. Lütfen kısaltın.]');
    onDone({ internalMeta: { modelUsed: 'none', costUsd: 0, latencyMs: 0 } });
    return;
  }

  // 2. Call provider
  const provider = loadProvider(model.provider);
  if (!provider) {
    onChunk('\n\n[AI servisi şu anda kullanılamıyor.]');
    onDone({ internalMeta: { modelUsed: 'none', costUsd: 0, latencyMs: 0 } });
    return;
  }

  const startTime = Date.now();
  let fullContent = '';

  try {
    await provider.chatStream({
      model: model.apiModel || model.id,
      messages: history.concat([{ role: 'user', content: message }]),
      maxTokens: classification.complexity === 'complex' ? 1200 : 800,
      systemPrompt: systemPrompt || null,
    }, (chunk) => {
      fullContent += chunk;
      onChunk(chunk);
    }, (meta) => {
      const latencyMs = Date.now() - startTime;
      const actualInputTokens = meta.usage?.prompt_tokens || totalInputTokens;
      const actualOutputTokens = meta.usage?.completion_tokens || Math.ceil(fullContent.length / 3.5);
      const actualCost = tokenEstimator.calculateCost(actualInputTokens, actualOutputTokens, model);

      costGuard.recordSpend(actualCost, model.id);

      logger.info(`✅ Stream completed: model=${model.id} tokens=${actualInputTokens}+${actualOutputTokens} cost=$${actualCost.toFixed(4)} latency=${latencyMs}ms`);

      onDone({
        internalMeta: {
          modelUsed: model.id,
          apiModel: model.apiModel,
          classification,
          costUsd: actualCost,
          latencyMs,
          tokensIn: actualInputTokens,
          tokensOut: actualOutputTokens,
        },
      });
    }, (err) => {
      // Error callback — try failover
      logger.error(`❌ Stream error: ${err.message}`);

      if (model.failover && MODEL_REGISTRY[model.failover]) {
        const failModel = MODEL_REGISTRY[model.failover];
        const failProvider = loadProvider(failModel.provider);
        if (failProvider) {
          failProvider.chatStream({
            model: failModel.apiModel || failModel.id,
            messages: history.concat([{ role: 'user', content: message }]),
            maxTokens: 800,
            systemPrompt: systemPrompt || null,
          }, onChunk, onDone).catch(() => {
            onChunk('\n\n[Bağlantı hatası. Lütfen tekrar deneyin.]');
            onDone({ internalMeta: { modelUsed: failModel.id, costUsd: 0, latencyMs: Date.now() - startTime } });
          });
          return;
        }
      }

      onChunk('\n\n[Bağlantı hatası. Lütfen tekrar deneyin.]');
      onDone({ internalMeta: { modelUsed: model.id, costUsd: 0, latencyMs: Date.now() - startTime } });
    });

  } catch (err) {
    logger.error(`❌ Stream failed: ${err.message}`);
    onChunk('\n\n[Bağlantı hatası. Lütfen tekrar deneyin.]');
    onDone({ internalMeta: { modelUsed: model.id, costUsd: 0, latencyMs: Date.now() - startTime } });
  }
}

// ═══════════════════════════════════════════════════════════
// COMPANION-SPECIFIC CHAT (delegates to main router)
// ═══════════════════════════════════════════════════════════

async function handleCompanionChat({ systemPrompt, messages, user, tier }) {
  // Companion always uses cost-effective model
  let model = MODEL_REGISTRY.gpt4o_mini;

  // Elite Pro companions can use better model
  if (tier === 'elite_pro') {
    model = MODEL_REGISTRY.gpt4o;
  }

  const provider = loadProvider(model.provider);
  if (!provider) {
    throw new Error('Companion servisi geçici olarak kullanılamıyor.');
  }

  try {
    const response = await provider.chat({
      model: model.apiModel || model.id,
      messages,
      maxTokens: 600,
      temperature: 0.8,  // More creative for companion
      systemPrompt,
    });

    const inputTokens = response.usage?.prompt_tokens || 0;
    const outputTokens = response.usage?.completion_tokens || 0;
    const costUsd = tokenEstimator.calculateCost(inputTokens, outputTokens, model);

    costGuard.recordSpend(costUsd, model.id);

    logger.info(`🤖 Companion chat: model=${model.id} cost=$${costUsd.toFixed(4)}`);

    return {
      content: response.content,
      internalMeta: {
        modelUsed: model.id,
        costUsd,
        latencyMs: response.latencyMs,
      },
    };
  } catch (err) {
    logger.error(`❌ Companion chat error: ${err.message}`);
    throw new Error('Companion şu anda yanıt veremiyor. Lütfen tekrar deneyin.');
  }
}

// ═══════════════════════════════════════════════════════════
// HEALTH CHECK — Test all providers
// ═══════════════════════════════════════════════════════════

async function checkProviderHealth() {
  const results = {};

  for (const [id, model] of Object.entries(MODEL_REGISTRY)) {
    const provider = loadProvider(model.provider);
    if (provider && provider.checkHealth) {
      try {
        results[model.provider] = await provider.checkHealth();
      } catch (err) {
        results[model.provider] = { status: 'down', error: err.message };
      }
    } else if (provider) {
      results[model.provider] = { status: 'unknown' };
    } else {
      results[model.provider] = { status: 'not_configured' };
    }
  }

  return results;
}

// ═══════════════════════════════════════════════════════════
// GET ACTIVE MODEL — for admin dashboard
// ═══════════════════════════════════════════════════════════

function getActiveModels() {
  return Object.entries(MODEL_REGISTRY).map(([id, m]) => ({
    id: m.id,
    provider: m.provider,
    quality: m.quality,
    costInPerM: m.costIn,
    costOutPerM: m.costOut,
    tierMin: m.tierMin,
    isDefault: m.isDefault || false,
  }));
}

function getDefaultModel() {
  return MODEL_REGISTRY[process.env.DEFAULT_MODEL || 'gpt4o_mini'] || MODEL_REGISTRY.gpt4o_mini;
}

// ═══════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════

module.exports = {
  handleChat,
  handleChatStream,
  handleCompanionChat,
  classifyQuery,
  selectModel,
  checkProviderHealth,
  getActiveModels,
  getDefaultModel,
  MODEL_REGISTRY,
};
