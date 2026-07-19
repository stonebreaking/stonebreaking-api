# 🏔️ StoneBreaking — API Backend

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/stonebreaking/stonebreaking-api)

## Tek Tıkla Deploy

1. Yukarıdaki **"Deploy to Render"** butonuna tıkla
2. Render'a GitHub ile giriş yap
3. `OPENAI_API_KEY` değerine DeepSeek API key'ini yapıştır
4. **"Apply"** butonuna bas
5. Deploy başlar → URL alırsın ✅

## Manuel Deploy

1. https://dashboard.render.com → "New" → "Web Service"
2. `stonebreaking-api` repo'sunu seç
3. Build: `npm install` / Start: `npm start`
4. Environment Variables:
   ```
   OPENAI_API_KEY      = sk-buraya-deepseek-key
   OPENAI_BASE_URL     = https://api.deepseek.com
   DEFAULT_MODEL       = deepseek-chat
   JWT_SECRET          = rastgele-bir-sey-yaz
   DAILY_SPEND_CAP_USD = 20
   ```
5. "Create Web Service" → Deploy başlar

## Test

```bash
curl https://stonebreaking-api.onrender.com/api/health
```

## Maliyet: $0/ay (Render Free + DeepSeek 5M ücretsiz token)
