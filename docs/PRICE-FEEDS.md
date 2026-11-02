# AlphaFX — مصادر الأسعار: إيه اللي محتاج مفاتيح وإيه اللي شغّال من غيرها

> مرجع تقني. آخر تحديث: 2026-11-01.
> كل أرقام الأسطر هنا مأخوذة من الكود الفعلي في `free-signal_v10`، مش من الذاكرة.

---

## 1. الوضع الحالي في الكود — فحص فعلي

### 1.1 طبقة المتصفح (Client)

| الملف | السطر | إيه اللي بيحصل | مفتاح؟ |
|---|---|---|---|
| `src/services/liveMarketData.ts` | 72 | `fetch('/api/market/candle?symbol=XAU%2FUSD')` | ❌ لا — عبر السيرفر |
| `src/services/liveMarketData.ts` | 105 | `fetch('/api/market/test')` | ❌ لا — المفتاح يُرسل مرة للتحقق فقط |
| `src/services/liveMarketData.ts` | 162 | `fetch('/api/market/rates')` | ❌ لا — عبر السيرفر |
| `src/services/liveMarketData.ts` | 209–216 | **`applyMicroFluctuations()`** — يضيف اهتزازًا صناعيًا بـ `Math.sin(Date.now()/4000 + charCode)` فوق السعر الحقيقي | — |
| `src/App.tsx` | 83 | `VITE_USE_MOCK_DATA === 'true'` | — |
| `src/App.tsx` | 881–929 | **أسعار احتياطية مكتوبة في الكود**: `1.1186` · `1.3347` · `157.44` · `1.4016` · `0.8271` · `4043.25` · `71.85` | — |
| `src/services/mockData.ts` | 8–28 | `generateCandles()` — شموع بـ `Math.random()` بالكامل | — |
| `src/services/msi/historicalDataBridge.ts` | 15 | `fetch('/api/msi/time_series?...')` | ❌ لا — عبر السيرفر |

**الخلاصة:** المتصفح **لا يحمل أي مفتاح**. كل شيء يمر عبر `/api/*`. ده صحيح ومقصود (تعليق صريح في `liveMarketData.ts` سطر 1–11).

### 1.2 طبقة السيرفر (Vercel Serverless — `api/`)

| الملف | السطر | المصدر | مفتاح؟ |
|---|---|---|---|
| `api/market/rates.ts` | 22 | AllTick REST (`quote.alltick.co`) | ✅ `ALLTICK_TOKEN` |
| `api/market/rates.ts` | 48 | `open.er-api.com/v6/latest/USD` | ❌ **مجاني بلا مفتاح** |
| `api/market/rates.ts` | 78 | Binance `PAXGUSDT` (بديل الذهب) | ❌ **مجاني بلا مفتاح** |
| `api/market/rates.ts` | 93 | Binance `BRENTUSDT` (بديل النفط) | ❌ **مجاني بلا مفتاح** |
| `api/market/candle.ts` | 20–22 | AllTick فقط — يرجّع **503** لو المفتاح ناقص | ✅ `ALLTICK_TOKEN` |
| `api/market/health.ts` | 12–15 | يرجّع booleans فقط (لا يكشف القيم) | — |
| `api/market/test.ts` | 30–36 | يتحقق من `TWELVE_DATA_API_KEY` / `FINNHUB_API_KEY` / `ALLTICK_TOKEN` | ✅ |
| `api/_lib/providers.ts` | 10–25 | `ALLOWED_SYMBOLS` — 14 رمزًا مسموحًا | — |
| `api/_lib/providers.ts` | 54 | `rateLimit()` — 60 طلب/دقيقة افتراضيًا | — |

### 1.3 سيرفر Node (`server.ts`) — **للتطوير المحلي فقط**

| السطر | إيه اللي بيحصل | مفتاح؟ |
|---|---|---|
| 91 | `/api/msi/time_series` — بروكسي Twelve Data | ✅ `TWELVE_DATA_API_KEY` |
| 211 | `evaluatePaperOpportunity()` — شموع Twelve Data | ✅ `TWELVE_DATA_API_KEY` |
| 414–418 | `WebSocketServer` + `TwelveDataWebSocket` | ✅ `TWELVE_DATA_API_KEY` |
| `src/services/msi/tdConnection.ts` | 59 | `wss://ws.twelvedata.com/v1/quotes/price?apikey=…` | ✅ |

> ⚠️ **`server.ts` لا يُنشر على Vercel.** `npm run dev` = `tsx server.ts` (محلي). على Vercel تُنشر دوال `api/` فقط. يعني **مسار الـ WebSocket الحقيقي غير مُفعَّل في الإنتاج** حاليًا.

### 1.4 السكربتات والـ CI

| الملف | المصدر | مفتاح؟ |
|---|---|---|
| `scripts/serverScheduler.ts` 35–37 | `ALLTICK_TOKEN` | ✅ |
| `scripts/serverScheduler.ts` 112 | AllTick REST | ✅ |
| `scripts/serverScheduler.ts` 131 | `open.er-api.com` | ❌ |
| `scripts/serverScheduler.ts` 155 | Binance `PAXGUSDT` | ❌ |
| `scripts/serverScheduler.ts` 165–166 | **قيم ثابتة**: `XAG/USD = 49.25` · `WTI = 72.85` | — |
| `.github/workflows/*.yml` (3 ملفات) | تمرّر `ALLTICK_TOKEN` + `SUPABASE_*` | ✅ |

### 1.5 قيد أمني مهم — CSP

`vercel.json` سطر 12:

```
connect-src 'self' https://*.supabase.co wss://*.supabase.co
```

**ده يمنع المتصفح من الاتصال بأي مزوّد أسعار مباشرة** — لا REST ولا WebSocket. أي مزوّد لازم يعدي على `/api/*` بتاعنا. ده قيد مقصود ومفيد، بس معناه إن **أي حل «مفتاح في المتصفح» مرفوض معماريًا** في المشروع ده.

---

## 2. جدول المزوّدين

| المزوّد | مفتاح؟ | الباقة المجانية | WebSocket؟ | فوركس فعلًا؟ | التكلفة المدفوعة |
|---|---|---|---|---|---|
| **Twelve Data** | ✅ نعم | 8 credits/دقيقة · 800/يوم · 3 أسواق · **8 credits WS تجريبي** | ✅ نعم (مدفوع؛ تجريبي على المجاني) | ✅ نعم — فوركس حقيقي | Grow **$29–79/شهر** (55–377 credit/دقيقة) · Pro $99–229 · Ultra $329–999 |
| **Finnhub** | ✅ نعم | **60 طلب/دقيقة** · **WS حتى 50 رمزًا مجانًا** · غير تجاري | ✅ نعم — على المجاني | ✅ نعم (`OANDA:EUR_USD`، forex candles/rates) | من ~$50/شهر لكل سوق |
| **Alpha Vantage** | ✅ نعم | **25 طلب/يوم** · 5/دقيقة | ❌ لا | ✅ نعم (`FX_DAILY`, `CURRENCY_EXCHANGE_RATE`) | $49.99 → $249.99/شهر |
| **Polygon.io** (Massive) | ✅ نعم | 5 طلبات/دقيقة · EOD · سنتان تاريخ | ✅ نعم (مدفوع) | ✅ نعم — Currencies Starter **$49/شهر** real-time | أسهم $29/$79/$199 · عملات $49+ |
| **OANDA v20** | ✅ نعم (توكن حساب) | **حساب demo مجاني** + streaming | ✅ نعم (`/pricing/stream`) | ✅ نعم — وسيط فوركس أصلي | الحساب مجاني؛ Exchange Rates API ~$4,850/سنة |
| **MetaTrader 5** | ❌ لا مفتاح (تسجيل دخول وسيط) | مجاني مع حساب demo من الوسيط | ✅ نعم (عبر منصة MT5، مش سحابي) | ✅ نعم | مجاني |
| **TradingView** | — | **لا يوجد API عام** | ❌ لا | — | — |
| **Binance** | ❌ لا للبيانات العامة | مجاني · 1200 weight/دقيقة · WS مجاني | ✅ نعم مجانًا | ❌ **كريبتو فقط** (PAXG ≈ بديل ذهب) | مجاني |
| **AllTick** | ✅ نعم | مفتاح مجاني محدود | ✅ نعم | ✅ نعم — 50+ زوجًا | من ~$99/شهر |
| **open.er-api.com** | ❌ لا | مجاني · تحديث ~يومي · rate-limited | ❌ لا | ✅ نعم (عملات ورقية فقط) | Pro $10/شهر (تحديث كل ساعة) |
| **Frankfurter / ECB** | ❌ لا | مجاني بلا حدود | ❌ لا | ✅ نعم (أسعار ECB ~16:00 CET يوميًا) | مجاني |
| **exchangerate.host** | اختياري | 100 طلب/شهر | ❌ لا | ✅ نعم | من $14.99/شهر |

---

## 3. real-time مقابل delayed مقابل EOD

| النوع | التأخير | يصلح لإيه | يصلح لإشارات فوركس؟ |
|---|---|---|---|
| **Real-time tick** | 0 — كل تغيير سعر | تنفيذ لحظي، سكالبينج، عدّاد pips حيّ | ✅ **ده المطلوب** |
| **Delayed 15 دقيقة** | 15 دقيقة | مراقبة عامة، لوحات معلومات | ❌ **خطر** — إشارة دخول على سعر قديم |
| **EOD (نهاية اليوم)** | حتى 24 ساعة | تحليل تاريخي، تقارير، باكتيست | ❌ لا — يصلح للتحليل فقط |

**لتطبيق إشارات فوركس:** محتاج **real-time tick** أو على الأقل **شموع دقيقة (M1) حقيقية**. الـ EOD يصلح فقط لبناء الشموع اليومية في التحليل التاريخي.

**الوضع الحالي في AlphaFX:**
- `open.er-api.com` → **EOD** (تحديث يومي) — يصلح للعرض فقط، لا للإشارات.
- Binance `PAXGUSDT` → **real-time** لكنه **بديل ذهب مشتق من الكريبتو**، مش سعر XAU/USD الحقيقي. الفرق ممكن يوصل دولارات.
- AllTick → **real-time tick** حقيقي — ده المصدر الوحيد الحقيقي حاليًا.

---

## 4. تخزين المفاتيح بأمان

### القاعدة الذهبية

```
VITE_*  →  يُدمج في حزمة JS العامة  →  ❌ ممنوع لأي سر
بدون VITE_  →  يبقى على السيرفر فقط  →  ✅ الصح
```

### في المشروع ده

1. **Vercel → Settings → Environment Variables** — أضف المفاتيح **بدون** بادئة `VITE_`.
2. `.env.example` موجود في الريبو (قالب فقط). `.env` في `.gitignore` سطر 12–14.
3. **GitHub Actions** → Settings → Secrets → `ALLTICK_TOKEN` · `SUPABASE_URL` · `SUPABASE_SERVICE_KEY`.
4. **التحقق:** `GET /api/market/health` يرجّع booleans فقط — لا يكشف أي قيمة.

### أي مزوّد يسمح بالمفتاح في المتصفح؟

| المزوّد | مفتاح في المتصفح؟ | السبب |
|---|---|---|
| Binance (بيانات عامة) | ✅ آمن | لا مفتاح أصلًا للبيانات العامة |
| open.er-api.com / Frankfurter | ✅ آمن | لا مفتاح |
| **كل الباقي** | ❌ **ممنوع** | المفتاح يظهر في DevTools ويُسرق |

**وفي المشروع ده تحديدًا:** CSP في `vercel.json` يمنع `connect-src` لأي نطاق خارجي غير Supabase — فحتى لو أردت، المتصفح **لا يستطيع** الاتصال بمزوّد مباشرة. كل شيء عبر `/api/*`.

---

## 5. حل بلا مفاتيح خالص — بصراحة

**موجود فعلًا في الكود وشغّال:**

| المصدر | بيدّي إيه | القيود |
|---|---|---|
| `open.er-api.com` | 11 زوجًا رئيسيًا | **تحديث يومي** — مش لحظي |
| Binance `PAXGUSDT` | بديل ذهب | **مشتق من الكريبتو** — فرق ممكن يوصل دولارات |
| Binance `BRENTUSDT` | بديل نفط | نفس المشكلة |
| Frankfurter / ECB | عملات ورقية | **يومي ~16:00 CET** — لا تحديث في الويكند |

**الحكم الصريح:** الحل بلا مفاتيح **لا يعطيك أسعار فوركس لحظية**. يعطيك أسعارًا يومية + بدائل مشتقة. يصلح لـ:
- عرض تقريبي في الواجهة
- التحليل التاريخي (شموع يومية)
- وضع العرض التجريبي

**لا يصلح** لتوليد إشارات دخول/خروج لحظية. أي إشارة مبنية على `open.er-api.com` هي إشارة على سعر قد يكون عمره ساعات.

---

## 6. التوصية النهائية

### أقل عدد مفاتيح للأسعار اللحظية على مدار اليوم

| السيناريو | المفاتيح | التكلفة | يغطي |
|---|---|---|---|
| **الحد الأدنى المطلق** | **1** — `ALLTICK_TOKEN` | ~$99/شهر | فوركس لحظي + ذهب + نفط + WS |
| **الحد الأدنى العملي** | **1** — `TWELVE_DATA_API_KEY` (Grow) | **$29/شهر** | فوركس لحظي + شموع تاريخية + WS |
| **الأرخص (غير تجاري)** | **1** — `FINNHUB_API_KEY` | **مجاني** | 60/دقيقة + WS 50 رمزًا — لكن **ترخيص غير تجاري** |
| **الموصى به للإنتاج** | **2** — Twelve Data + Finnhub | $29/شهر | مصدر أساسي + احتياطي عند الفشل |

### الخطوات العملية بالترتيب

1. **سجّل في Twelve Data** → خُذ المفتاح → Vercel → Environment Variables → `TWELVE_DATA_API_KEY` (بدون `VITE_`).
2. **سجّل في Finnhub** (مجاني) → `FINNHUB_API_KEY` — للاحتياطي والأخبار.
3. **أضف `ALLTICK_TOKEN`** لو عندك اشتراك — هو المصدر اللحظي الوحيد المُدمج حاليًا.
4. **انشر مسار WebSocket على Vercel** — حاليًا `server.ts` محلي فقط. انقله إلى دالة `api/` أو استخدم خدمة WS خارجية.
5. **أضف `TWELVE_DATA_API_KEY` إلى GitHub Secrets** عشان الـ workflows تستخدمه.
6. **اختبر:** `GET /api/market/health` → لازم يرجّع `true` للمزوّد المُهيَّأ.
7. **أزل الأسعار الاحتياطية المكتوبة** من `App.tsx` سطر 881–929 — تعرض سعرًا وهميًا عند فشل الشبكة.
8. **راجع `applyMicroFluctuations()`** في `liveMarketData.ts` سطر 209 — يضيف حركة صناعية فوق السعر الحقيقي.

---

## 7. ملاحظات على الكود الحالي

| # | الملاحظة | الملف · السطر |
|---|---|---|
| 1 | أسعار احتياطية مكتوبة تُعرض عند فشل الشبكة | `App.tsx` 881–929 |
| 2 | اهتزاز صناعي يُضاف فوق السعر الحقيقي | `liveMarketData.ts` 209–216 |
| 3 | قيم ثابتة للفضة والنفط في السكربت | `serverScheduler.ts` 165–166 |
| 4 | مسار WebSocket غير منشور على Vercel | `server.ts` 414–418 |
| 5 | `candle.ts` يرجّع 503 بلا `ALLTICK_TOKEN` | `api/market/candle.ts` 20–22 |
| 6 | CSP يمنع أي اتصال مباشر بمزوّد | `vercel.json` 12 |

---

*هذا المستند مرجع هندسي. لا يُعد نصيحة استثمارية.*
