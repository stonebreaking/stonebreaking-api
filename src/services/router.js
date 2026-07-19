// ═══════════════════════════════════════════════════════════
// StoneBreaking — AI Model Router (THE CORE BRAIN) v2.1
// ═══════════════════════════════════════════════════════════
// Gemini-powered router with smart model selection.
// Users NEVER see which model is used. StoneBreaking IS the AI.
// ═══════════════════════════════════════════════════════════

const logger = require('../utils/logger');
const costGuard = require('./costGuard');
const tokenEstimator = require('./tokenEstimator');

// Provider instances (lazy-loaded)
let openaiProvider = null;

// ═══════════════════════════════════════════════════════════
// MODEL REGISTRY — Google Gemini via OpenAI-compatible API
// ═══════════════════════════════════════════════════════════

const MODEL_REGISTRY = {
  gemini_flash: {
    id: 'gemini_flash',
    provider: 'openai',
    apiModel: process.env.CHEAP_MODEL || 'gemini-2.0-flash',
    costIn: 0.075,     // $/1M input tokens (free tier)
    costOut: 0.30,     // $/1M output tokens (free tier)
    quality: 90,
    maxContext: 1048576,
    tierMin: 'breaker',
    supports: ['text', 'code', 'reasoning', 'math', 'creative'],
    latencyMs: 1500,
    failover: null,
    isDefault: true,
  },
  gemini_pro: {
    id: 'gemini_pro',
    provider: 'openai',
    apiModel: process.env.PREMIUM_MODEL || 'gemini-2.5-flash',
    costIn: 0.15,
    costOut: 0.60,
    quality: 95,
    maxContext: 1048576,
    tierMin: 'shatter',
    supports: ['text', 'code', 'reasoning', 'math', 'agent'],
    latencyMs: 3000,
    failover: 'gemini_flash',
  },
};

// ═══════════════════════════════════════════════════════════
// LAZY PROVIDER LOADER
// ═══════════════════════════════════════════════════════════

function loadProvider(providerName) {
  if (providerName === 'openai') {
    if (!openaiProvider) {
      try {
        openaiProvider = require('../providers/openaiProvider');
        logger.info('✅ OpenAI-compatible provider loaded');
      } catch (err) {
        logger.error(`❌ Failed to load provider: ${err.message}`);
        return null;
      }
    }
    return openaiProvider;
  }

  logger.warn(`Unknown provider: ${providerName}`);
  return null;
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

  // Emergency: Platform spend > 90%
  if (platformSpendPct > 90) {
    logger.warn(`🚨 EMERGENCY: Platform spend at ${platformSpendPct}%`);
    return MODEL_REGISTRY.gemini_flash;
  }

  // Auto-downgrade at 80% spend
  if (platformSpendPct > 80) {
    logger.warn(`⚠️  Platform spend at ${platformSpendPct}%`);
    return MODEL_REGISTRY.gemini_flash;
  }

  // Complex code/math/reasoning/agent + high tier → pro model
  if (complexity === 'complex' && (type === 'code' || type === 'math' || type === 'reasoning' || type === 'agent')) {
    if (userLevel >= 1) {
      return MODEL_REGISTRY.gemini_pro;
    }
    return MODEL_REGISTRY.gemini_flash;
  }

  // Default: cost-optimized
  return MODEL_REGISTRY.gemini_flash;
}

// ═══════════════════════════════════════════════════════════
// MAIN CHAT HANDLER (non-streaming)
// ═══════════════════════════════════════════════════════════

async function handleChat({ message, history, user, platformSpendPct, systemPrompt }) {
  const classification = classifyQuery(message, history);
  logger.info(`📍 Query classified: type=${classification.type}, complexity=${classification.complexity}`);

  let model = selectModel(classification, user.tier, platformSpendPct);

  const tierOrder = { breaker: 0, shatter: 1, obliterate: 2 };
  if ((tierOrder[user.tier] ?? 0) < (tierOrder[model.tierMin] ?? 0)) {
    model = MODEL_REGISTRY.gemini_flash;
  }

  const inputTokens = tokenEstimator.estimateTokens(message, { language: 'mixed' });
  const historyTokens = tokenEstimator.estimateTokensFromMessages(history);
  const totalInputTokens = inputTokens + historyTokens;
  const estimatedOutputTokens = classification.complexity === 'complex' ? 1500 : 1000;
  const estimatedCost = tokenEstimator.calculateCost(totalInputTokens, estimatedOutputTokens, model);

  const costCheck = costGuard.canAfford(estimatedCost);
  if (!costCheck.allowed) {
    model = MODEL_REGISTRY.gemini_flash;
  }

  const maxPerRequest = parseFloat(process.env.MAX_PER_REQUEST_COST_USD) || 0.10;
  if (estimatedCost > maxPerRequest) {
    throw new Error('Mesajınız çok uzun. Lütfen kısaltın.');
  }

  const provider = loadProvider(model.provider);
  if (!provider) {
    throw new Error('AI servisi geçici olarak kullanılamıyor.');
  }

  const MAX_RETRIES = 1;
  let retries = 0;
  let response;

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
      logger.error(`❌ Model ${model.id} failed (attempt ${retries}): ${err.message}`);

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
        throw new Error('AI modelleri geçici olarak kullanılamıyor. Lütfen biraz sonra deneyin.');
      }

      await new Promise(r => setTimeout(r, 1000 * Math.pow(2, retries)));
    }
  }

  const actualInputTokens = response.usage?.prompt_tokens || totalInputTokens;
  const actualOutputTokens = response.usage?.completion_tokens || estimatedOutputTokens;
  const actualCost = tokenEstimator.calculateCost(actualInputTokens, actualOutputTokens, model);

  costGuard.recordSpend(actualCost, model.id);

  logger.info(`✅ Chat: model=${model.id} tokens=${actualInputTokens}+${actualOutputTokens} cost=$${actualCost.toFixed(4)} latency=${response.latencyMs}ms`);

  return {
    content: response.content,
    usage: { tokensIn: actualInputTokens, tokensOut: actualOutputTokens },
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
  const classification = classifyQuery(message, history);
  let model = selectModel(classification, user.tier, platformSpendPct);

  const tierOrder = { breaker: 0, shatter: 1, obliterate: 2 };
  if ((tierOrder[user.tier] ?? 0) < (tierOrder[model.tierMin] ?? 0)) {
    model = MODEL_REGISTRY.gemini_flash;
  }

  const inputTokens = tokenEstimator.estimateTokens(message, { language: 'mixed' });
  const historyTokens = tokenEstimator.estimateTokensFromMessages(history);
  const totalInputTokens = inputTokens + historyTokens;
  const estimatedCost = tokenEstimator.calculateCost(totalInputTokens, 1000, model);

  const costCheck = costGuard.canAfford(estimatedCost);
  if (!costCheck.allowed) {
    model = MODEL_REGISTRY.gemini_flash;
  }

  const maxPerRequest = parseFloat(process.env.MAX_PER_REQUEST_COST_USD) || 0.10;
  if (estimatedCost > maxPerRequest) {
    onChunk('\n\n[Mesajınız çok uzun. Lütfen kısaltın.]');
    onDone({ internalMeta: { modelUsed: 'none', costUsd: 0, latencyMs: 0, tokensOut: 0 } });
    return;
  }

  const provider = loadProvider(model.provider);
  if (!provider) {
    onChunk('\n\n[AI servisi şu anda kullanılamıyor.]');
    onDone({ internalMeta: { modelUsed: 'none', costUsd: 0, latencyMs: 0, tokensOut: 0 } });
    return;
  }

  const startTime = Date.now();
  let fullContent = '';

  try {
    await provider.chatStream({
      model: model.apiModel || model.id,
      messages: history.concat([{ role: 'user', content: message }]),
      maxTokens: classification.complexity === 'complex' ? 1500 : 1000,
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

      logger.info(`✅ Stream: model=${model.id} tokens=${actualInputTokens}+${actualOutputTokens} cost=$${actualCost.toFixed(4)} latency=${latencyMs}ms`);

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
      logger.error(`❌ Stream error: ${err.message}`);

      if (model.failover && MODEL_REGISTRY[model.failover]) {
        const failModel = MODEL_REGISTRY[model.failover];
        const failProvider = loadProvider(failModel.provider);
        if (failProvider) {
          failProvider.chatStream({
            model: failModel.apiModel || failModel.id,
            messages: history.concat([{ role: 'user', content: message }]),
            maxTokens: 1000,
            systemPrompt: systemPrompt || null,
          }, onChunk, onDone).catch(() => {
            onChunk('\n\n[Bağlantı hatası. Lütfen tekrar deneyin.]');
            onDone({ internalMeta: { modelUsed: failModel.id, costUsd: 0, latencyMs: Date.now() - startTime, tokensOut: 0 } });
          });
          return;
        }
      }

      onChunk('\n\n[Bağlantı hatası. Lütfen tekrar deneyin.]');
      onDone({ internalMeta: { modelUsed: model.id, costUsd: 0, latencyMs: Date.now() - startTime, tokensOut: 0 } });
    });

  } catch (err) {
    logger.error(`❌ Stream failed: ${err.message}`);
    onChunk('\n\n[Bağlantı hatası. Lütfen tekrar deneyin.]');
    onDone({ internalMeta: { modelUsed: model.id, costUsd: 0, latencyMs: Date.now() - startTime, tokensOut: 0 } });
  }
}

// ═══════════════════════════════════════════════════════════
// COMPANION CHAT
// ═══════════════════════════════════════════════════════════

async function handleCompanionChat({ systemPrompt, messages, user, tier }) {
  const model = MODEL_REGISTRY.gemini_flash;
  const provider = loadProvider(model.provider);
  if (!provider) {
    throw new Error('Companion servisi geçici olarak kullanılamıyor.');
  }

  try {
    const response = await provider.chat({
      model: model.apiModel || model.id,
      messages,
      maxTokens: 800,
      temperature: 0.8,
      systemPrompt,
    });

    const inputTokens = response.usage?.prompt_tokens || 0;
    const outputTokens = response.usage?.completion_tokens || 0;
    const costUsd = tokenEstimator.calculateCost(inputTokens, outputTokens, model);

    costGuard.recordSpend(costUsd, model.id);

    return {
      content: response.content,
      internalMeta: { modelUsed: model.id, costUsd, latencyMs: response.latencyMs },
    };
  } catch (err) {
    logger.error(`❌ Companion chat error: ${err.message}`);
    throw new Error('Companion şu anda yanıt veremiyor. Lütfen tekrar deneyin.');
  }
}

// ═══════════════════════════════════════════════════════════
// HEALTH CHECK
// ═══════════════════════════════════════════════════════════

async function checkProviderHealth() {
  const provider = loadProvider('openai');
  if (provider && provider.checkHealth) {
    try {
      const health = await provider.checkHealth();
      return { openai: health };
    } catch (err) {
      return { openai: { status: 'down', error: err.message } };
    }
  }
  return { openai: { status: 'not_configured' } };
}

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
  return MODEL_REGISTRY.gemini_flash;
}

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
