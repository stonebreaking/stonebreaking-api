// StoneBreaking — Cost Guard
// Prevents the platform from losing money.
// Every single AI request must pass through this module.

const logger = require('../utils/logger');

// In-memory tracking (production: use Redis)
let hourlySpend = 0;
let dailySpend = 0;
let hourlyResetAt = Date.now() + 3600000;  // +1 hour
let dailyResetAt = Date.now() + 86400000;  // +24 hours
let modelBreakdown = {};

const DAILY_CAP = parseFloat(process.env.DAILY_SPEND_CAP_USD) || 50;
const HOURLY_CAP = parseFloat(process.env.HOURLY_SPEND_CAP_USD) || 10;
const DOWNGRADE_PCT = parseFloat(process.env.DOWNGRADE_THRESHOLD_PCT) || 80;

// ============================================
// CAN WE AFFORD THIS REQUEST?
// ============================================

function canAfford(estimatedCostUsd) {
  // Emergency kill switch
  if (process.env.EMERGENCY_KILL_SWITCH === 'true') {
    return { allowed: false, reason: 'Emergency kill switch is active' };
  }

  // Reset counters if time elapsed
  resetIfNeeded();

  // Check hourly cap
  if (hourlySpend + estimatedCostUsd > HOURLY_CAP) {
    logger.warn(`🚫 Hourly spend cap: $${hourlySpend.toFixed(4)}/$${HOURLY_CAP}`);
    return { allowed: false, reason: 'Hourly platform spend limit reached' };
  }

  // Check daily cap
  if (dailySpend + estimatedCostUsd > DAILY_CAP) {
    logger.error(`🚨 DAILY SPEND CAP HIT: $${dailySpend.toFixed(4)}/$${DAILY_CAP}`);
    return { allowed: false, reason: 'Daily platform spend limit reached' };
  }

  return { allowed: true, hourlyPct: (hourlySpend / HOURLY_CAP) * 100, dailyPct: (dailySpend / DAILY_CAP) * 100 };
}

// ============================================
// RECORD ACTUAL SPEND
// ============================================

function recordSpend(costUsd, modelId) {
  resetIfNeeded();

  hourlySpend += costUsd;
  dailySpend += costUsd;

  if (!modelBreakdown[modelId]) {
    modelBreakdown[modelId] = { cost: 0, requests: 0 };
  }
  modelBreakdown[modelId].cost += costUsd;
  modelBreakdown[modelId].requests += 1;

  // Alert thresholds
  const dailyPct = (dailySpend / DAILY_CAP) * 100;
  const hourlyPct = (hourlySpend / HOURLY_CAP) * 100;

  if (dailyPct > 90) {
    logger.error(`🚨 CRITICAL: Daily spend at ${dailyPct.toFixed(1)}% ($${dailySpend.toFixed(4)}/$${DAILY_CAP})`);
  } else if (dailyPct > 70) {
    logger.warn(`⚠️  Daily spend at ${dailyPct.toFixed(1)}% ($${dailySpend.toFixed(4)}/$${DAILY_CAP})`);
  }

  if (hourlyPct > 90) {
    logger.error(`🚨 CRITICAL: Hourly spend at ${hourlyPct.toFixed(1)}%`);
  }

  return { dailySpend, hourlySpend, dailyPct, hourlyPct };
}

// ============================================
// GET PLATFORM SPEND PERCENTAGE (for router)
// ============================================

function getDailySpendPct() {
  resetIfNeeded();
  return (dailySpend / DAILY_CAP) * 100;
}

function getStats() {
  resetIfNeeded();
  return {
    hourlySpend: hourlySpend.toFixed(4),
    dailySpend: dailySpend.toFixed(4),
    hourlyCap: HOURLY_CAP,
    dailyCap: DAILY_CAP,
    hourlyPct: ((hourlySpend / HOURLY_CAP) * 100).toFixed(1),
    dailyPct: ((dailySpend / DAILY_CAP) * 100).toFixed(1),
    shouldDowngrade: getDailySpendPct() > DOWNGRADE_PCT,
    killSwitch: process.env.EMERGENCY_KILL_SWITCH === 'true',
    modelBreakdown,
  };
}

// ============================================
// INTERNAL
// ============================================

function resetIfNeeded() {
  const now = Date.now();
  if (now > hourlyResetAt) {
    hourlySpend = 0;
    hourlyResetAt = now + 3600000;
    logger.info('📊 Hourly spend counter reset');
  }
  if (now > dailyResetAt) {
    dailySpend = 0;
    modelBreakdown = {};
    dailyResetAt = now + 86400000;
    logger.info('📊 Daily spend counter reset');
  }
}

module.exports = { canAfford, recordSpend, getDailySpendPct, getStats };
