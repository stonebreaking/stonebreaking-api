// ═══════════════════════════════════════════════════════════
// StoneBreaking — Token Estimator
// ═══════════════════════════════════════════════════════════
// Accurate token estimation for cost tracking.
// Uses character-based heuristics calibrated for
// Turkish + English mixed content.
// ═══════════════════════════════════════════════════════════

const logger = require('../utils/logger');

// ═══════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════

// Average chars per token by language
// Turkish uses more tokens per char due to agglutination + special chars
const CHARS_PER_TOKEN = {
  english:  4.0,   // GPT standard
  turkish:  3.2,   // More tokens due to ö, ü, ç, ş, ğ, ı + agglutination
  code:     3.5,   // Code has lots of symbols → more tokens
  mixed:    3.5,   // Default for Turkish users (mixed TR+EN)
};

// Turkish special characters that increase token count
const TURKISH_CHARS = /[çÇğĞıİöÖşŞüÜ]/g;

// Code indicators
const CODE_INDICATORS = /[\{\}\[\]\(\)<>=;:\/\\|&\*\+\-\%#@!~`]/g;

// ═══════════════════════════════════════════════════════════
// MAIN — Estimate tokens for a text string
// ═══════════════════════════════════════════════════════════

function estimateTokens(text, options = {}) {
  if (!text || typeof text !== 'string') return 0;

  const { language = null, isCode = false } = options;
  const len = text.length;

  // Auto-detect language if not specified
  let charRatio;

  if (isCode) {
    charRatio = CHARS_PER_TOKEN.code;
  } else if (language) {
    charRatio = CHARS_PER_TOKEN[language] || CHARS_PER_TOKEN.mixed;
  } else {
    charRatio = detectCharRatio(text);
  }

  // Base token count
  let tokens = Math.ceil(len / charRatio);

  // Turkish special chars increase token count (~10% more)
  const turkishCharCount = (text.match(TURKISH_CHARS) || []).length;
  if (turkishCharCount > 0) {
    tokens += Math.ceil(turkishCharCount * 0.3);  // Each special char ≈ 0.3 extra token
  }

  // Code symbols increase token count
  const codeSymbolCount = (text.match(CODE_INDICATORS) || []).length;
  if (codeSymbolCount > len * 0.15) {  // If >15% code symbols
    tokens = Math.ceil(tokens * 1.15);
  }

  // Message overhead (role, formatting, etc.)
  tokens += 4;

  return Math.max(1, tokens);
}

// ═══════════════════════════════════════════════════════════
// ESTIMATE FROM MESSAGE ARRAY
// ═══════════════════════════════════════════════════════════

function estimateTokensFromMessages(messages) {
  if (!Array.isArray(messages)) return 0;

  let total = 0;

  for (const msg of messages) {
    // Each message has ~4 tokens overhead (role, separators)
    total += estimateTokens(msg.content || '', { isCode: msg.role === 'system' }) + 4;
  }

  // Conversation-level overhead
  total += 3;

  return total;
}

// ═══════════════════════════════════════════════════════════
// COST CALCULATION
// ═══════════════════════════════════════════════════════════

function calculateCost(inputTokens, outputTokens, modelConfig) {
  if (!modelConfig) return 0;

  const costIn = (inputTokens / 1_000_000) * (modelConfig.costIn || modelConfig.costInPerM || 0);
  const costOut = (outputTokens / 1_000_000) * (modelConfig.costOut || modelConfig.costOutPerM || 0);

  return costIn + costOut;
}

// Calculate per-user profitability
function calculateProfitability(userPaidTRY, messagesToday, avgCostPerMsgUSD, usdToTry = 32) {
  const totalCostUSD = messagesToday * avgCostPerMsgUSD;
  const totalCostTRY = totalCostUSD * usdToTry;
  const profitTRY = userPaidTRY - totalCostTRY;
  const profitMargin = userPaidTRY > 0 ? (profitTRY / userPaidTRY) * 100 : 0;

  return {
    userPaidTRY,
    totalCostUSD,
    totalCostTRY,
    profitTRY,
    profitMargin,
    isProfitable: profitTRY > 0,
  };
}

// ═══════════════════════════════════════════════════════════
// INTERNAL — Detect language ratio from text
// ═══════════════════════════════════════════════════════════

function detectCharRatio(text) {
  const sample = text.slice(0, 500);  // Check first 500 chars
  const turkishCount = (sample.match(TURKISH_CHARS) || []).length;
  const codeCount = (sample.match(CODE_INDICATORS) || []).length;

  // If significant Turkish content
  if (turkishCount > sample.length * 0.02) {
    return CHARS_PER_TOKEN.turkish;
  }

  // If code-like
  if (codeCount > sample.length * 0.15) {
    return CHARS_PER_TOKEN.code;
  }

  return CHARS_PER_TOKEN.mixed;
}

// ═══════════════════════════════════════════════════════════
// VALIDATION — Check if token count is within limits
// ═══════════════════════════════════════════════════════════

function validateTokenLimit(inputTokens, tier, modelMaxContext) {
  const tierLimits = {
    breaker:    4000,
    shatter:    8000,
    obliterate: 16000,
  };

  const userMax = tierLimits[tier] || 4000;
  const effectiveMax = Math.min(userMax, modelMaxContext || 128000);

  return {
    allowed: inputTokens <= effectiveMax,
    inputTokens,
    maxAllowed: effectiveMax,
    overBy: Math.max(0, inputTokens - effectiveMax),
    percentUsed: (inputTokens / effectiveMax) * 100,
  };
}

// ═══════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════

module.exports = {
  estimateTokens,
  estimateTokensFromMessages,
  calculateCost,
  calculateProfitability,
  validateTokenLimit,
  CHARS_PER_TOKEN,
};
