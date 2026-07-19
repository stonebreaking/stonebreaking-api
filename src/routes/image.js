// StoneBreaking — Image Generation Routes
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const { usageGuard, incrementImageUsage } = require('../middleware/usageGuard');
const costGuard = require('../services/costGuard');
const logger = require('../utils/logger');

router.use(authMiddleware, usageGuard);

router.post('/generate', async (req, res) => {
  const { prompt } = req.body;

  if (!prompt || prompt.trim().length === 0) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  // Check image limit
  if (req.usage.imagesUsed >= req.usage.imageLimit) {
    return res.status(429).json({
      error: 'Günlük görsel limitine ulaştınız',
      used: req.usage.imagesUsed,
      limit: req.usage.imageLimit,
    });
  }

  // Estimate cost
  const estimatedCost = 0.04; // ~$0.04 per image (DeepSeek/FLUX range)
  const costCheck = costGuard.canAfford(estimatedCost);
  if (!costCheck.allowed) {
    return res.status(503).json({ error: 'Image generation temporarily unavailable' });
  }

  try {
    // Phase 1: Use DeepSeek's image generation or OpenAI DALL-E
    // For now, return a placeholder response
    // In production, call the actual image API

    const imageUrl = await generateImage(prompt, req.user.tier);

    await incrementImageUsage(req.user.id);
    await costGuard.recordSpend(estimatedCost, 'image_gen');

    res.json({
      url: imageUrl,
      remaining: req.usage.imageLimit - req.usage.imagesUsed - 1,
    });
  } catch (err) {
    logger.error('Image generation error:', err);
    res.status(500).json({ error: 'Image generation failed' });
  }
});

async function generateImage(prompt, tier) {
  // TODO: Implement with actual API
  // Options:
  // 1. DeepSeek V4 image generation (cheapest)
  // 2. FLUX 2 via API ($0.014/image)
  // 3. GPT Image 2 for obliterate tier

  // Placeholder
  throw new Error('Image generation not yet implemented — add API integration');
}

module.exports = router;
