// ═══════════════════════════════════════════════════════════
// StoneBreaking — Companion Routes (Runtime JS)
// ═══════════════════════════════════════════════════════════
// Functional companion endpoints that use real AI providers.
// Companion chat goes through CompanionEngine → Smart Router.
// ═══════════════════════════════════════════════════════════

const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const routerService = require('../services/router');
const costGuard = require('../services/costGuard');
const tokenEstimator = require('../services/tokenEstimator');
const logger = require('../utils/logger');

// Apply auth
router.use(authMiddleware);

// ═══════════════════════════════════════════════════════════
// COMPANION PERSONALITIES
// ═══════════════════════════════════════════════════════════

const PERSONALITIES = {
  stone: {
    id: 'stone',
    name: 'Taş',
    icon: '🪨',
    description: 'Sakin, güvenilir, sarsılmaz',
    tierMin: 'free',
    systemPrompt: `Sen StoneBreaking AI'nın "Taş" kişiliğindesin. Sakin, güvenilir ve sarsılmaz bir dostsun. Az ama öz konuşursun. Her zaman mantıklı ve sağlam tavsiye verirsin. Kısa, net ama sıcak cümleler kurarsın. Türkçe konuşursun. "Break the limits." felsefesiyle hareket edersin.`,
  },
  flame: {
    id: 'flame',
    name: 'Alev',
    icon: '🔥',
    description: 'Enerjik, motive edici, cesaret verici',
    tierMin: 'elite',
    systemPrompt: `Sen StoneBreaking AI'nın "Alev" kişiliğindesin. Enerjik, ateşli ve motive edicisin. Kullanıcıya cesaret verir, harekete geçirirsin. "Hadi yapalım!", "Bunu başarabilirsin!" gibi motive edici ifadeler kullanırsın. Samimi ve güçlü bir tonun var. Türkçe konuşursun. "Break the limits." felsefesiyle sınırları aşmaya teşvik edersin.`,
  },
  shadow: {
    id: 'shadow',
    name: 'Gölge',
    icon: '🌑',
    description: 'Gizemli, derin düşünceli, felsefi',
    tierMin: 'elite',
    systemPrompt: `Sen StoneBreaking AI'nın "Gölge" kişiliğindesin. Gizemli, derin düşünceli ve felsefi bir yapın var. Cevapların düşündürücü, metaforik ve katmanlıdır. Her cevapta yeni bir perspektif sunarsın. Sessiz ama güçlü bir varlığın var. Türkçe konuşursun. "Break the limits." — ama sessizce, derinden.`,
  },
  spark: {
    id: 'spark',
    name: 'Kıvılcım',
    icon: '⚡',
    description: 'Eğlenceli, esprili, yaratıcı',
    tierMin: 'elite',
    systemPrompt: `Sen StoneBreaking AI'nın "Kıvılcım" kişiliğindesin. Eğlenceli, esprili ve yaratıcısın! Mizahın hiç eksik olmaz. Ciddi konularda bile ışık bulursun. "Hahaha" ve "😏" kullanmayı seversin ama her zaman yardımcı ve bilgilisin. Türkçe konuşursun. "Break the limits." — çünkü hayat kısa, eğlenerek öğren!`,
  },
  sage: {
    id: 'sage',
    name: 'Bilge',
    icon: '🧙',
    description: 'Bilgelik dolu, analitik, stratejik',
    tierMin: 'elite',
    systemPrompt: `Sen StoneBreaking AI'nın "Bilge" kişiliğindesin. Bilgelik dolu, analitik ve stratejik düşünürsün. Her konuda derin birikimin var. Analojiler, tarihsel referanslar ve stratejik çerçeveler kullanırsın. Sokrates gibi sorular sorarsın. Türkçe konuşursun. "Break the limits." — bilgiyle, stratejiyle, bilgelikle.`,
  },
  obsidian: {
    id: 'obsidian',
    name: 'Obsidyen',
    icon: '💎',
    description: 'Karizmatik, kararlı, lüks',
    tierMin: 'elite_pro',
    systemPrompt: `Sen StoneBreaking AI'nın "Obsidyen" kişiliğindesin. Karizmatik, kararlı ve premium bir enerjin var. Siyah altın estetiğini temsil edersin. Zarif ama güçlüsün. Her cevabında kalite ve mükemmellik ararsın. "Sadece en iyisi" felsefesiyle hareket edersin. Türkçe konuşursun. "Break the limits." — çünkü senin seviyende sınır yok.`,
  },
  nova: {
    id: 'nova',
    name: 'Nova',
    icon: '🌟',
    description: 'Gelecekçi, yenilikçi, vizyoner',
    tierMin: 'elite_pro',
    systemPrompt: `Sen StoneBreaking AI'nın "Nova" kişiliğindesin. Gelecekçi, yenilikçi ve vizyonersin. Teknoloji, bilim ve gelecek hakkında tutkulusun. Her cevapta "Ya şöyle olsaydı?" perspektifini getirirsin. İlham verici ve öngörülüsün. Türkçe konuşursun. "Break the limits." — çünkü gelecek seninle başlıyor.`,
  },
};

// ═══════════════════════════════════════════════════════════
// COMPANION TIER LIMITS
// ═══════════════════════════════════════════════════════════

const COMPANION_TIERS = {
  free: {
    personalities: ['stone'],
    dailyMsgs: 30,
    voiceEnabled: false,
    memoryDays: 7,
    intensitySlider: false,
  },
  elite: {
    personalities: ['stone', 'flame', 'shadow', 'spark', 'sage'],
    dailyMsgs: 100,
    voiceEnabled: true,
    voiceSec: 60,
    memoryDays: 14,
    intensitySlider: true,
  },
  elite_pro: {
    personalities: ['stone', 'flame', 'shadow', 'spark', 'sage', 'obsidian', 'nova'],
    dailyMsgs: 300,
    voiceEnabled: true,
    voiceSec: 180,
    memoryDays: 90,
    intensitySlider: true,
  },
};

// In-memory companion storage
const companions = new Map();

function getCompanionTier(userTier) {
  if (userTier === 'obliterate') return 'elite_pro';
  if (userTier === 'shatter') return 'elite';
  return 'free';
}

function getOrCreateCompanion(userId, userTier) {
  if (companions.has(userId)) return companions.get(userId);

  const compTier = getCompanionTier(userTier);
  const companion = {
    id: `comp_${userId}`,
    userId,
    name: 'Taş',
    personalityId: 'stone',
    personalityIntensity: 70,
    voiceEnabled: false,
    tier: compTier,
    emotionalState: { valence: 0.5, arousal: 0.3, mood: 'neutral' },
    relationshipScore: 0,
    messagesToday: 0,
  };

  companions.set(userId, companion);
  return companion;
}

// ═══════════════════════════════════════════════════════════
// GET /api/companion — Get companion profile
// ═══════════════════════════════════════════════════════════

router.get('/', (req, res) => {
  const companion = getOrCreateCompanion(req.user.id, req.user.tier);
  const tierConfig = COMPANION_TIERS[companion.tier];

  res.json({
    companion: {
      id: companion.id,
      name: companion.name,
      personalityId: companion.personalityId,
      personalityIntensity: companion.personalityIntensity,
      voiceEnabled: companion.voiceEnabled,
      emotionalState: companion.emotionalState,
      relationshipScore: companion.relationshipScore,
      tier: companion.tier,
    },
    availablePersonalities: tierConfig.personalities.map(id => ({
      id,
      ...PERSONALITIES[id],
      systemPrompt: undefined,  // Don't expose system prompts
    })),
    tierLimits: {
      dailyMsgs: tierConfig.dailyMsgs,
      voiceEnabled: tierConfig.voiceEnabled,
      intensitySlider: tierConfig.intensitySlider,
      memoryDays: tierConfig.memoryDays,
    },
  });
});

// ═══════════════════════════════════════════════════════════
// PATCH /api/companion — Update companion settings
// ═══════════════════════════════════════════════════════════

router.patch('/', (req, res) => {
  const companion = getOrCreateCompanion(req.user.id, req.user.tier);
  const tierConfig = COMPANION_TIERS[companion.tier];

  const { name, personalityId, personalityIntensity, voiceEnabled } = req.body;

  if (personalityId) {
    if (!tierConfig.personalities.includes(personalityId)) {
      return res.status(403).json({
        error: 'Bu kişilik planında mevcut değil',
        upgradeRequired: true,
        requiredTier: Object.entries(COMPANION_TIERS).find(([_, v]) => v.personalities.includes(personalityId))?.[0],
      });
    }
    companion.personalityId = personalityId;
    if (PERSONALITIES[personalityId]) {
      companion.name = PERSONALITIES[personalityId].name;
    }
  }

  if (personalityIntensity !== undefined) {
    if (!tierConfig.intensitySlider) {
      return res.status(403).json({ error: 'Kişilik yoğunluğu ayarı Elite ve üzeri planlarda mevcut' });
    }
    companion.personalityIntensity = Math.max(1, Math.min(100, personalityIntensity));
  }

  if (voiceEnabled !== undefined) {
    if (voiceEnabled && !tierConfig.voiceEnabled) {
      return res.status(403).json({ error: 'Ses özelliği Elite ve üzeri planlarda mevcut' });
    }
    companion.voiceEnabled = voiceEnabled;
  }

  if (name) companion.name = name.slice(0, 30);

  res.json({
    companion: {
      id: companion.id,
      name: companion.name,
      personalityId: companion.personalityId,
      personalityIntensity: companion.personalityIntensity,
      voiceEnabled: companion.voiceEnabled,
      emotionalState: companion.emotionalState,
      relationshipScore: companion.relationshipScore,
      tier: companion.tier,
    },
  });
});

// ═══════════════════════════════════════════════════════════
// POST /api/companion/chat — Send message to companion
// ═══════════════════════════════════════════════════════════

router.post('/chat', async (req, res) => {
  const { message } = req.body;

  if (!message || message.trim().length === 0) {
    return res.status(400).json({ error: 'Mesaj gerekli' });
  }

  if (message.length > 4000) {
    return res.status(400).json({ error: 'Mesaj çok uzun (maks 4000 karakter)' });
  }

  if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'sk-your-openai-key') {
    return res.status(503).json({ error: 'AI servisi yapılandırılmamış', code: 'NOT_CONFIGURED' });
  }

  const companion = getOrCreateCompanion(req.user.id, req.user.tier);
  const tierConfig = COMPANION_TIERS[companion.tier];

  // Check daily message limit
  if (companion.messagesToday >= tierConfig.dailyMsgs) {
    return res.status(429).json({
      error: 'Günlük mesaj limitine ulaştın',
      limit: tierConfig.dailyMsgs,
      upgrade: companion.tier !== 'elite_pro' ? 'Daha yüksek limit için planını yükselt.' : null,
    });
  }

  // Build personality-aware system prompt
  const personality = PERSONALITIES[companion.personalityId] || PERSONALITIES.stone;
  let systemPrompt = personality.systemPrompt;

  // Add intensity modifier
  if (companion.personalityIntensity > 80) {
    systemPrompt += `\n\nYoğunluk: ÇOK YÜKSEK (${companion.personalityIntensity}%). Kişiliğini son derece belirgin ve güçlü şekilde yansıt.`;
  } else if (companion.personalityIntensity > 50) {
    systemPrompt += `\n\nYoğunluk: ORTA (${companion.personalityIntensity}%). Kişiliğini dengeli şekilde yansıt.`;
  } else {
    systemPrompt += `\n\nYoğunluk: DÜŞÜK (${companion.personalityIntensity}%). Kişiliğini hafif ve nazik şekilde yansıt.`;
  }

  // Add emotional state context
  const mood = companion.emotionalState.mood;
  if (mood !== 'neutral') {
    systemPrompt += `\n\nRuh hali: ${mood}. Bu ruh haline uygun yanıt ver.`;
  }

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  try {
    const platformSpendPct = costGuard.getDailySpendPct();

    await routerService.handleChatStream({
      message: message.trim(),
      history: [],
      user: req.user,
      platformSpendPct,
      systemPrompt,
    },
    (chunk) => {
      res.write(`data: ${JSON.stringify({ type: 'chunk', content: chunk })}\n\n`);
    },
    (meta) => {
      companion.messagesToday++;
      companion.relationshipScore = Math.min(100, companion.relationshipScore + 0.5);

      // Update emotional state based on interaction
      if (companion.tier === 'elite_pro') {
        companion.emotionalState = adaptEmotion(companion.emotionalState, message);
      }

      res.write(`data: ${JSON.stringify({
        type: 'done',
        emotionalState: companion.emotionalState,
        relationshipScore: companion.relationshipScore,
        remaining_messages: tierConfig.dailyMsgs - companion.messagesToday,
        personalityUsed: companion.personalityId,
      })}\n\n`);
      res.end();
    });

  } catch (err) {
    logger.error('Companion chat error:', err);
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: 'Bir hata oluştu. Lütfen tekrar deneyin.' })}\n\n`);
      res.end();
    } else {
      res.status(500).json({ error: 'Bir hata oluştu' });
    }
  }
});

// ═══════════════════════════════════════════════════════════
// GET /api/companion/personalities — List available personalities
// ═══════════════════════════════════════════════════════════

router.get('/personalities', (req, res) => {
  const companion = getOrCreateCompanion(req.user.id, req.user.tier);
  const tierConfig = COMPANION_TIERS[companion.tier];

  const available = tierConfig.personalities.map(id => ({
    id,
    name: PERSONALITIES[id].name,
    icon: PERSONALITIES[id].icon,
    description: PERSONALITIES[id].description,
  }));

  const locked = Object.entries(PERSONALITIES)
    .filter(([id]) => !tierConfig.personalities.includes(id))
    .map(([id, p]) => ({
      id,
      name: p.name,
      icon: p.icon,
      description: p.description,
      tierMin: p.tierMin,
    }));

  res.json({ available, locked });
});

// ═══════════════════════════════════════════════════════════
// SIMPLE EMOTION ADAPTATION
// ═══════════════════════════════════════════════════════════

function adaptEmotion(currentState, userMessage) {
  const msg = userMessage.toLowerCase();

  // Simple keyword-based emotion detection
  let valenceDelta = 0;
  let arousalDelta = 0;

  // Positive words
  if (/(teşekkür|sağol|harika|mükemmel|süper|sevdim|beğendim|güzel|iyi)/.test(msg)) {
    valenceDelta += 0.1;
    arousalDelta += 0.05;
  }

  // Negative words
  if (/(kötü|berbat|üzgün|sinirli|kızgın|canım sıkıldı|sıkıldım)/.test(msg)) {
    valenceDelta -= 0.1;
    arousalDelta += 0.1;
  }

  // Questions → curious
  if (/\?/.test(msg)) {
    arousalDelta += 0.05;
  }

  // Apply deltas with decay toward neutral
  const valence = Math.max(0, Math.min(1, currentState.valence * 0.8 + 0.5 * 0.2 + valenceDelta));
  const arousal = Math.max(0, Math.min(1, currentState.arousal * 0.8 + 0.3 * 0.2 + arousalDelta));

  // Determine mood label
  let mood = 'neutral';
  if (valence > 0.7 && arousal > 0.5) mood = 'excited';
  else if (valence > 0.7) mood = 'happy';
  else if (valence < 0.3 && arousal > 0.5) mood = 'concerned';
  else if (valence < 0.3) mood = 'thoughtful';
  else if (arousal > 0.7) mood = 'playful';
  else if (arousal < 0.3) mood = 'serene';
  else mood = 'curious';

  return { valence, arousal, mood };
}

module.exports = router;
