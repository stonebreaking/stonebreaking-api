# 🏔️ StoneBreaking — API Backend (Render.com)

AI asistan backend'i. Render.com'da ücretsiz çalışır.

## Deploy Adımları

### 1. DeepSeek API Key Al (ÜCRETSİZ)
1. https://platform.deepseek.com → Sign Up
2. Email + telefon doğrula → 5M ücretsiz token
3. API Keys → "Create new API key" → kopyala

### 2. Render.com'a Deploy
1. https://render.com → GitHub ile giriş yap
2. "New" → "Web Service"
3. Bu repo'yu bağla: `stonebreaking-api`
4. Ayarlar:
   - Build Command: `npm install`
   - Start Command: `npm start`
5. Environment Variables ekle:
   ```
   OPENAI_API_KEY     = sk-deepseek-key-ini-buraya-yapistir
   OPENAI_BASE_URL    = https://api.deepseek.com
   DEFAULT_MODEL      = deepseek-chat
   CHEAP_MODEL        = deepseek-chat
   PREMIUM_MODEL      = deepseek-chat
   JWT_SECRET         = rastgele-64-karakter-bir-sey-yaz
   DAILY_SPEND_CAP_USD= 20
   EMERGENCY_KILL_SWITCH=false
   ```
6. "Create Web Service" → Deploy başlar
7. URL alırsın: `https://stonebreaking-api.onrender.com`

### 3. Frontend'i Bağla
GitHub Pages'deki frontend'de ⚙️ butonundan:
- Backend URL: `https://stonebreaking-api.onrender.com`
- Test Et → ✅ Bağlı

## Test

```bash
# Health check
curl https://stonebreaking-api.onrender.com/api/health

# Demo chat
curl -X POST https://stonebreaking-api.onrender.com/api/demo/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"Merhaba!"}'
```

## Maliyet
- Render Free Tier: **$0/ay**
- DeepSeek 5M ücretsiz token: ~2000-5000 mesaj
- Toplam: **$0 başlangıç**
