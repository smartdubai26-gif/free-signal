import { Candle, Signal, MarketSession, PerformanceStats } from '../types/signals';
import { calculateEMA, calculateRSI } from './technicalEngine';
import { getMarketClock, formatMarketDateTime } from './marketClock';

/**
 * Helper to generate authentic realistic candles for a symbol
 */
export function generateCandles(basePrice: number, volatility: number, count: number = 60, trend: 'up' | 'down' | 'range' = 'up'): Candle[] {
  const candles: Candle[] = [];
  let currentPrice = basePrice;
  const now = Date.now();
  const stepMs = 4 * 3600 * 1000; // 4 hour candles

  for (let i = count - 1; i >= 0; i--) {
    const timestamp = now - i * stepMs;
    const time = new Date(timestamp).toLocaleDateString('ar-EG', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    
    // Trend bias
    let bias = 0;
    if (trend === 'up') bias = (volatility * 0.15);
    else if (trend === 'down') bias = -(volatility * 0.15);

    const delta = (Math.random() - 0.48) * volatility + bias;
    const open = currentPrice;
    const close = Number((open + delta).toFixed(4));
    const high = Number((Math.max(open, close) + Math.random() * volatility * 0.6).toFixed(4));
    const low = Number((Math.min(open, close) - Math.random() * volatility * 0.6).toFixed(4));
    const volume = Math.floor(12000 + Math.random() * 25000);

    candles.push({
      time,
      timestamp,
      open,
      high,
      low,
      close,
      volume,
    });
    currentPrice = close;
  }

  // Calculate indicator overlays
  const closes = candles.map(c => c.close);
  const ema20 = calculateEMA(closes, 20);
  const ema50 = calculateEMA(closes, 50);
  const rsi = calculateRSI(closes, 14);

  return candles.map((c, idx) => ({
    ...c,
    ema20: Number(ema20[idx].toFixed(4)),
    ema50: Number(ema50[idx].toFixed(4)),
    rsi: Number(rsi[idx].toFixed(1)),
  }));
}

// Market sessions with realistic GMT timings
export const MARKET_SESSIONS: MarketSession[] = [
  {
    id: 'london',
    nameAr: 'بورصة لندن (السوق الأوروبي)',
    nameEn: 'London / European Session',
    city: 'London',
    openGmt: '07:00',
    closeGmt: '16:00',
    isOpen: true,
    nextEvent: 'إغلاق السوق الأوروبي 16:00 GMT',
  },
  {
    id: 'newyork',
    nameAr: 'بورصة نيويورك (السوق الأمريكي)',
    nameEn: 'New York / US Session',
    city: 'New York',
    openGmt: '12:00',
    closeGmt: '21:00',
    isOpen: true,
    nextEvent: 'إغلاق السوق الأمريكي وتقرير النتائج 21:00 GMT',
  },
  {
    id: 'tokyo',
    nameAr: 'بورصة طوكيو (السوق الآسيوي)',
    nameEn: 'Tokyo / Asian Session',
    city: 'Tokyo',
    openGmt: '00:00',
    closeGmt: '09:00',
    isOpen: false,
    nextEvent: 'افتتاح الجلسة القادمة 00:00 GMT',
  },
  {
    id: 'sydney',
    nameAr: 'بورصة سيدني (السوق الأسترالي)',
    nameEn: 'Sydney Session',
    city: 'Sydney',
    openGmt: '21:00',
    closeGmt: '06:00',
    isOpen: false,
    nextEvent: 'افتتاح الجلسة القادمة 21:00 GMT',
  },
];

/* ------------------------------------------------------------------ */
/* Seed timestamps                                                     */
/* ------------------------------------------------------------------ */
/**
 * BUGFIX (activation-time): these used to be
 *     new Date().toISOString().split('T')[0] + 'T07:30:00Z'
 * which stamped *today's UTC date* onto every seed signal at a hard-coded
 * 07:30Z — including Saturdays, when the market is shut and no such
 * activation could ever have happened.
 *
 * Now the timestamp is the last moment the FX week actually opened, so a
 * seed can never claim an activation inside a closed weekend.
 */
const _seedClock = getMarketClock();
const todayIsoStr = new Date(_seedClock.lastOpenMs).toISOString();
const todayDateTag = _seedClock.date.replace(/-/g, '');

// Seed templates. Timestamps are re-stamped per call in `buildSeedSignals()`.
const SEED_TEMPLATES: Signal[] = [
  {
    id: `sig-xauusd-${todayDateTag}`,
    symbol: 'XAU/USD',
    nameAr: 'الذهب مقابل الدولار الأمريكي',
    nameEn: 'Gold / US Dollar',
    assetClass: 'metals',
    direction: 'LONG',
    entry: 4038.50,
    stopLoss: 4015.00,
    takeProfit1: 4075.00,
    takeProfit2: 4110.00,
    confidence: 91,
    timeframe: 'H4',
    reasoningAr: 'اختراق صريح لمقاومة 4038$ مدعوماً بتقاطع إيجابي لمتوسطات EMA 20/50 + مؤشر القوة النسبية RSI عند 62.5 في مسار صاعد + قوة الاتجاه ADX تتجاوز 28 مع ثبات أعلى قاع الدعم الأسبوعي.',
    reasoningEn: 'Clear breakout above $4,038 resistance supported by bullish EMA 20/50 cross + RSI at 62.5 + ADX > 28.',
    indicators: {
      rsi: 62.5,
      macd: { macd: 8.4, signal: 4.6, histogram: 3.8 },
      ema20: 4032.10,
      ema50: 4018.40,
      ema200: 3980.00,
      atr: 14.50,
      adx: 29.4,
      bollinger: { upper: 4070.0, middle: 4040.0, lower: 4010.0 },
      support: [4020.0, 4005.0, 3980.0],
      resistance: [4075.0, 4110.0, 4150.0],
      pivotPoints: { pp: 4038.0, r1: 4065.0, r2: 4095.0, s1: 4018.0, s2: 3995.0 }
    },
    candles: generateCandles(4015, 12, 60, 'up'),
    timestamp: todayIsoStr,
    activated_at: todayIsoStr,
    sessionTarget: 'جلسة لندن (إغلاق شمعة H4)',
    status: 'OPEN',
    currentPrice: 4043.25,
    resultPips: 48,
    pipValueDecimals: 2,
    riskRewardRatio: '1:2.4',
    highSinceEntry: 4048.50,
    lowSinceEntry: 4036.00,
    isTopOpportunity: true,
    isLiveFeed: true,
    isLocked: true,
  },
  {
    id: `sig-eurusd-${todayDateTag}`,
    symbol: 'EUR/USD',
    nameAr: 'اليورو مقابل الدولار الأمريكي',
    nameEn: 'Euro / US Dollar',
    assetClass: 'forex-major',
    direction: 'SHORT',
    entry: 1.1220,
    stopLoss: 1.1265,
    takeProfit1: 1.1140,
    takeProfit2: 1.1090,
    confidence: 86,
    timeframe: 'H1',
    reasoningAr: 'ارتداد هابط من إعادة اختبار سقف القناة الهابطة على H4 مع تكوّن نموذج قمة مزدوجة + كسر خط العنق عند 1.1220 + تقاطع سلبي لـ MACD وRSI أسفل 48.',
    reasoningEn: 'Bearish rejection from descending channel retest on H4 with double-top pattern + MACD bearish cross.',
    indicators: {
      rsi: 43.8,
      macd: { macd: -0.0014, signal: -0.0007, histogram: -0.0007 },
      ema20: 1.1210,
      ema50: 1.1235,
      ema200: 1.1270,
      atr: 0.0025,
      adx: 27.8,
      bollinger: { upper: 1.1250, middle: 1.1210, lower: 1.1170 },
      support: [1.1140, 1.1090, 1.1040],
      resistance: [1.1240, 1.1280, 1.1320],
      pivotPoints: { pp: 1.1205, r1: 1.1240, r2: 1.1275, s1: 1.1170, s2: 1.1135 }
    },
    candles: generateCandles(1.1230, 0.0035, 60, 'down'),
    timestamp: todayIsoStr,
    activated_at: todayIsoStr,
    sessionTarget: 'جلسة لندن (إغلاق شمعة H4)',
    status: 'OPEN',
    currentPrice: 1.1186,
    resultPips: 34,
    pipValueDecimals: 4,
    riskRewardRatio: '1:2.9',
    highSinceEntry: 1.1228,
    lowSinceEntry: 1.1182,
    isTopOpportunity: true,
    isLiveFeed: true,
    isLocked: true,
  },
  {
    id: `sig-gbpusd-${todayDateTag}`,
    symbol: 'GBP/USD',
    nameAr: 'الجنيه الإسترليني مقابل الدولار',
    nameEn: 'British Pound / US Dollar',
    assetClass: 'forex-major',
    direction: 'LONG',
    entry: 1.3305,
    stopLoss: 1.3260,
    takeProfit1: 1.3395,
    takeProfit2: 1.3460,
    confidence: 89,
    timeframe: 'H1',
    reasoningAr: 'تأكيد كسر نطاق التماسك الصباحي قبل افتتاح لندن مع تخطي المقاومة المحورية 1.3300 + مؤشر ADX عند 32 يعكس زخماً متسارعاً + تقارب المتوسطات المتحركة نحو الصعود.',
    reasoningEn: 'London pre-open consolidation breakout above 1.3300 psychological resistance, ADX at 32 demonstrating strong momentum.',
    indicators: {
      rsi: 66.2,
      macd: { macd: 0.0019, signal: 0.0010, histogram: 0.0009 },
      ema20: 1.3320,
      ema50: 1.3290,
      ema200: 1.3210,
      atr: 0.0028,
      adx: 32.2,
      bollinger: { upper: 1.3385, middle: 1.3325, lower: 1.3265 },
      support: [1.3280, 1.3240, 1.3190],
      resistance: [1.3395, 1.3460, 1.3520],
      pivotPoints: { pp: 1.3320, r1: 1.3375, r2: 1.3430, s1: 1.3265, s2: 1.3210 }
    },
    candles: generateCandles(1.3280, 0.004, 60, 'up'),
    timestamp: todayIsoStr,
    activated_at: todayIsoStr,
    sessionTarget: 'جلسة لندن (إغلاق شمعة H4)',
    status: 'OPEN',
    currentPrice: 1.3347,
    resultPips: 42,
    pipValueDecimals: 4,
    riskRewardRatio: '1:3.3',
    highSinceEntry: 1.3355,
    lowSinceEntry: 1.3300,
    isTopOpportunity: true,
    isLiveFeed: true,
    isLocked: true,
  },
  {
    id: `sig-wti-${todayDateTag}`,
    symbol: 'WTI Oil',
    nameAr: 'نفط غرب تكساس (Crude Oil CL)',
    nameEn: 'WTI Crude Oil',
    assetClass: 'energy',
    direction: 'LONG',
    entry: 71.10,
    stopLoss: 69.80,
    takeProfit1: 73.20,
    takeProfit2: 74.80,
    confidence: 85,
    timeframe: 'H4',
    reasoningAr: 'ارتداد قوي من مستوى دعم فيبوناتشي 61.8% حول 71.00$ مدعوماً بتباعد إيجابي (Bullish Divergence) على مؤشر RSI وظهور شمعة ابتلاعية شرائية قوية على إطار 4 ساعات.',
    reasoningEn: 'Strong bounce from 61.8% Fibonacci support around $71.00 with Bullish RSI Divergence and H4 engulfing bar.',
    indicators: {
      rsi: 56.4,
      macd: { macd: 0.28, signal: 0.12, histogram: 0.16 },
      ema20: 71.50,
      ema50: 70.90,
      ema200: 73.10,
      atr: 0.88,
      adx: 27.5,
      bollinger: { upper: 73.20, middle: 71.60, lower: 69.90 },
      support: [70.20, 69.10, 67.80],
      resistance: [73.20, 74.80, 76.50],
      pivotPoints: { pp: 71.60, r1: 72.90, r2: 74.20, s1: 70.30, s2: 68.90 }
    },
    candles: generateCandles(70.5, 0.9, 60, 'up'),
    timestamp: todayIsoStr,
    activated_at: todayIsoStr,
    sessionTarget: 'جلسة لندن (إغلاق شمعة H4)',
    status: 'OPEN',
    currentPrice: 71.85,
    resultPips: 75,
    pipValueDecimals: 2,
    riskRewardRatio: '1:3.0',
    highSinceEntry: 72.10,
    lowSinceEntry: 70.95,
    isTopOpportunity: true,
    isLiveFeed: true,
    isLocked: true,
  },
  {
    id: `sig-usdjpy-${todayDateTag}`,
    symbol: 'USD/JPY',
    nameAr: 'الدولار الأمريكي مقابل الين الياباني',
    nameEn: 'US Dollar / Japanese Yen',
    assetClass: 'forex-major',
    direction: 'SHORT',
    entry: 157.95,
    stopLoss: 158.60,
    takeProfit1: 156.80,
    takeProfit2: 156.10,
    confidence: 84,
    timeframe: 'H4',
    reasoningAr: 'فشل السعر في الحفاظ على مستوى 158.00 مع ظهور شمعة هابطة عاكسة (Shooting Star) + تشبع شرائي على مؤشر ستوكاستيك وتقاطع سلبي لمتوسطات EMA.',
    reasoningEn: 'Failure to hold 158.00 barrier with bearish candle rejection and stochastic overbought rollover.',
    indicators: {
      rsi: 44.8,
      macd: { macd: -0.18, signal: 0.04, histogram: -0.22 },
      ema20: 157.65,
      ema50: 157.90,
      ema200: 156.20,
      atr: 0.55,
      adx: 26.2,
      bollinger: { upper: 158.40, middle: 157.60, lower: 156.80 },
      support: [156.80, 156.10, 155.40],
      resistance: [158.20, 158.60, 159.10],
      pivotPoints: { pp: 157.60, r1: 158.10, r2: 158.65, s1: 157.10, s2: 156.60 }
    },
    candles: generateCandles(158.2, 0.65, 60, 'down'),
    timestamp: todayIsoStr,
    activated_at: todayIsoStr,
    sessionTarget: 'جلسة لندن (إغلاق شمعة H4)',
    status: 'OPEN',
    currentPrice: 157.44,
    resultPips: 51,
    pipValueDecimals: 2,
    riskRewardRatio: '1:2.7',
    highSinceEntry: 158.05,
    lowSinceEntry: 157.38,
    isTopOpportunity: true,
    isLiveFeed: true,
    isLocked: true,
  },
  {
    id: `sig-xagusd-${todayDateTag}`,
    symbol: 'XAG/USD',
    nameAr: 'الفضة مقابل الدولار الأمريكي',
    nameEn: 'Silver / US Dollar',
    assetClass: 'metals',
    direction: 'LONG',
    entry: 48.50,
    stopLoss: 47.80,
    takeProfit1: 49.80,
    takeProfit2: 50.80,
    confidence: 83,
    timeframe: 'H4',
    reasoningAr: 'استقرار الفضة فوق المتوسط المتحرك 50 على الديلي مع ارتداد إيجابي من منطقة الطلب وتوافق حركة المعادن الثمينة مع الذهب في مسار صاعد.',
    reasoningEn: 'Silver stabilizing above daily 50 SMA with positive bounce from demand zone, correlated with Gold surge.',
    indicators: {
      rsi: 61.2,
      macd: { macd: 0.32, signal: 0.15, histogram: 0.17 },
      ema20: 48.80,
      ema50: 48.20,
      ema200: 46.50,
      atr: 0.52,
      adx: 28.1,
      bollinger: { upper: 50.10, middle: 48.70, lower: 47.30 },
      support: [47.80, 47.10, 46.20],
      resistance: [49.80, 50.80, 51.90],
      pivotPoints: { pp: 48.75, r1: 49.60, r2: 50.45, s1: 47.90, s2: 47.05 }
    },
    candles: generateCandles(47.2, 0.65, 60, 'up'),
    timestamp: todayIsoStr,
    activated_at: todayIsoStr,
    sessionTarget: 'جلسة لندن (إغلاق شمعة H4)',
    status: 'OPEN',
    currentPrice: 49.28,
    resultPips: 78,
    pipValueDecimals: 2,
    riskRewardRatio: '1:3.3',
    highSinceEntry: 49.45,
    lowSinceEntry: 48.42,
    isTopOpportunity: false,
    isLiveFeed: true,
    isLocked: true,
  },
  {
    id: `sig-brent-${todayDateTag}`,
    symbol: 'Brent Oil',
    nameAr: 'خام برنت (Brent Crude BZ)',
    nameEn: 'Brent Crude Oil',
    assetClass: 'energy',
    direction: 'LONG',
    entry: 74.90,
    stopLoss: 73.60,
    takeProfit1: 77.20,
    takeProfit2: 78.80,
    confidence: 84,
    timeframe: 'H4',
    reasoningAr: 'تأكيد تماسك خام برنت فوق قاع القناة الأفقية مع تقلص فوارق بولنجر باند استعداداً لانفجار سعري صاعد متوافق مع بيانات السحب من المخزونات.',
    reasoningEn: 'Brent consolidation above horizontal floor with Bollinger squeeze preceding expected upward expansion.',
    indicators: {
      rsi: 58.0,
      macd: { macd: 0.35, signal: 0.18, histogram: 0.17 },
      ema20: 75.40,
      ema50: 74.90,
      ema200: 76.50,
      atr: 0.95,
      adx: 27.4,
      bollinger: { upper: 77.50, middle: 75.30, lower: 73.10 },
      support: [73.60, 72.40, 71.00],
      resistance: [77.20, 78.80, 80.50],
      pivotPoints: { pp: 75.20, r1: 76.80, r2: 78.50, s1: 73.50, s2: 71.90 }
    },
    candles: generateCandles(73.8, 1.1, 60, 'up'),
    timestamp: todayIsoStr,
    activated_at: todayIsoStr,
    sessionTarget: 'جلسة لندن (إغلاق شمعة H4)',
    status: 'OPEN',
    currentPrice: 76.20,
    resultPips: 130,
    pipValueDecimals: 2,
    riskRewardRatio: '1:3.0',
    highSinceEntry: 76.50,
    lowSinceEntry: 74.80,
    isTopOpportunity: false,
    isLiveFeed: true,
    isLocked: true,
  },
  {
    id: `sig-usdcad-${todayDateTag}`,
    symbol: 'USD/CAD',
    nameAr: 'الدولار الأمريكي مقابل الدولار الكندي',
    nameEn: 'US Dollar / Canadian Dollar',
    assetClass: 'forex-major',
    direction: 'SHORT',
    entry: 1.4240,
    stopLoss: 1.4285,
    takeProfit1: 1.4160,
    takeProfit2: 1.4090,
    confidence: 82,
    timeframe: 'H1',
    reasoningAr: 'كسر خط دعم الاتجاه الصاعد مع ضعف عوائد السندات الأمريكية وقوة أسعار النفط الخام عالمياً.',
    reasoningEn: 'Ascending trendline breakdown on H1 amidst strengthening crude prices.',
    indicators: {
      rsi: 42.1,
      macd: { macd: -0.0012, signal: -0.0005, histogram: -0.0007 },
      ema20: 1.4225,
      ema50: 1.4245,
      ema200: 1.4290,
      atr: 0.0026,
      adx: 26.0,
      bollinger: { upper: 1.4270, middle: 1.4220, lower: 1.4170 },
      support: [1.4160, 1.4090, 1.4020],
      resistance: [1.4285, 1.4330, 1.4380],
      pivotPoints: { pp: 1.4220, r1: 1.4260, r2: 1.4300, s1: 1.4180, s2: 1.4140 }
    },
    candles: generateCandles(1.4270, 0.003, 60, 'down'),
    timestamp: todayIsoStr,
    activated_at: todayIsoStr,
    sessionTarget: 'جلسة لندن (إغلاق شمعة H4)',
    status: 'OPEN',
    currentPrice: 1.4191,
    resultPips: 49,
    pipValueDecimals: 4,
    riskRewardRatio: '1:3.3',
    highSinceEntry: 1.4248,
    lowSinceEntry: 1.4185,
    isTopOpportunity: false,
    isLiveFeed: true,
    isLocked: true,
  },
  {
    id: `sig-audusd-${todayDateTag}`,
    symbol: 'AUD/USD',
    nameAr: 'الدولار الأسترالي مقابل الدولار الأمريكي',
    nameEn: 'Australian Dollar / US Dollar',
    assetClass: 'forex-major',
    direction: 'LONG',
    entry: 0.6890,
    stopLoss: 0.6850,
    takeProfit1: 0.6945,
    takeProfit2: 0.6995,
    confidence: 85,
    timeframe: 'H1',
    reasoningAr: 'ارتداد صاعد من الدعم الأسبوعي 0.6880 مع اختراق قمة الجلسة السابقة + مؤشر RSI عند 57 في مسار صاعد + تقاطع إيجابي لمتوسطات EMA 20/50.',
    reasoningEn: 'Bullish bounce from 0.6880 weekly support with previous session high breakout and positive EMA 20/50 cross.',
    indicators: {
      rsi: 57.4,
      macd: { macd: 0.0008, signal: 0.0003, histogram: 0.0005 },
      ema20: 0.6905,
      ema50: 0.6885,
      ema200: 0.6840,
      atr: 0.0022,
      adx: 27.2,
      bollinger: { upper: 0.6935, middle: 0.6900, lower: 0.6865 },
      support: [0.6850, 0.6810, 0.6770],
      resistance: [0.6945, 0.6995, 0.7040],
      pivotPoints: { pp: 0.6895, r1: 0.6935, r2: 0.6970, s1: 0.6860, s2: 0.6825 }
    },
    candles: generateCandles(0.6860, 0.003, 60, 'up'),
    timestamp: todayIsoStr,
    activated_at: todayIsoStr,
    sessionTarget: 'جلسة لندن (إغلاق شمعة H4)',
    status: 'OPEN',
    currentPrice: 0.6916,
    resultPips: 26,
    pipValueDecimals: 4,
    riskRewardRatio: '1:2.6',
    highSinceEntry: 0.6922,
    lowSinceEntry: 0.6885,
    isTopOpportunity: true,
    isLiveFeed: true,
    isLocked: true,
  },
  {
    id: `sig-usdchf-${todayDateTag}`,
    symbol: 'USD/CHF',
    nameAr: 'الدولار الأمريكي مقابل الفرنك السويسري',
    nameEn: 'US Dollar / Swiss Franc',
    assetClass: 'forex-major',
    direction: 'SHORT',
    entry: 0.8320,
    stopLoss: 0.8360,
    takeProfit1: 0.8260,
    takeProfit2: 0.8205,
    confidence: 84,
    timeframe: 'H4',
    reasoningAr: 'رفض سعري متكرر عند المقاومة 0.8350 مع استمرار الضغط البيعي وكسر متوسط EMA 50 للأسفل + زخم هابط على مؤشر الماكد.',
    reasoningEn: 'Repeated resistance rejection at 0.8350 with sustained selling pressure and breakdown below EMA 50.',
    indicators: {
      rsi: 43.5,
      macd: { macd: -0.0011, signal: -0.0004, histogram: -0.0007 },
      ema20: 0.8305,
      ema50: 0.8330,
      ema200: 0.8385,
      atr: 0.0024,
      adx: 26.5,
      bollinger: { upper: 0.8355, middle: 0.8310, lower: 0.8265 },
      support: [0.8260, 0.8205, 0.8160],
      resistance: [0.8360, 0.8410, 0.8460],
      pivotPoints: { pp: 0.8315, r1: 0.8350, r2: 0.8390, s1: 0.8275, s2: 0.8240 }
    },
    candles: generateCandles(0.8340, 0.0028, 60, 'down'),
    timestamp: todayIsoStr,
    activated_at: todayIsoStr,
    sessionTarget: 'جلسة لندن (إغلاق شمعة H4)',
    status: 'OPEN',
    currentPrice: 0.8283,
    resultPips: 37,
    pipValueDecimals: 4,
    riskRewardRatio: '1:2.8',
    highSinceEntry: 0.8325,
    lowSinceEntry: 0.8278,
    isTopOpportunity: false,
    isLiveFeed: true,
    isLocked: true,
  }
];

/* ------------------------------------------------------------------ */
/* Seed builder — the ONLY way the UI should obtain starter signals    */
/* ------------------------------------------------------------------ */
/**
 * Produces today's starter signals with timestamps that are TRUE for the
 * moment of the call.
 *
 * Behaviour by market state:
 *  - Market OPEN  -> signals are stamped at the real session open and are
 *                    presented as active/pending, same as before.
 *  - Market CLOSED (weekend / Friday-close / Sunday-preopen) -> the same
 *                    setups are returned but explicitly EXPIRED, stamped at
 *                    the last real session open and closed at week end.
 *                    The UI must render these as "منتهية", never as today's
 *                    live opportunities.
 */
export function buildSeedSignals(nowMs: number = Date.now()): Signal[] {
  const clock = getMarketClock(nowMs);
  const dateTag = clock.date.replace(/-/g, '');
  const activationIso = new Date(clock.lastOpenMs).toISOString();
  const isClosed = !clock.isOpen;

  return SEED_TEMPLATES.map((tpl) => {
    const symbolSlug = tpl.symbol.replace(/[^a-z0-9]/gi, '').toLowerCase();
    return {
      ...tpl,
      id: `sig-${symbolSlug}-${dateTag}`,
      timestamp: activationIso,
      activated_at: isClosed ? activationIso : tpl.activated_at ? activationIso : undefined,
      status: isClosed ? 'EXPIRED' : (tpl.status as any),
      closed_at: isClosed ? activationIso : undefined,
      sessionTarget: isClosed
        ? `آخر جلسة مفتوحة · ${formatMarketDateTime(activationIso)}`
        : tpl.sessionTarget,
      isLiveFeed: !isClosed,
    };
  });
}

/** Back-compat snapshot for call sites that only read `.length`. */
export const INITIAL_TODAY_SIGNALS: Signal[] = buildSeedSignals();

// Settled Historical Signals for the Results Ledger & Archive
export const HISTORICAL_SIGNALS: Signal[] = [];

export const ALL_INSTRUMENTS = [
  { symbol: 'XAU/USD', nameAr: 'الذهب (Gold)', nameEn: 'Gold Spot', class: 'metals', basePrice: 4043.25, defaultSpread: 1.2 },
  { symbol: 'XAG/USD', nameAr: 'الفضة (Silver)', nameEn: 'Silver Spot', class: 'metals', basePrice: 34.15, defaultSpread: 0.05 },
  { symbol: 'WTI Oil', nameAr: 'نفط تكساس (CL)', nameEn: 'WTI Crude Oil', class: 'energy', basePrice: 71.85, defaultSpread: 0.04 },
  { symbol: 'Brent Oil', nameAr: 'نفط برنت (BZ)', nameEn: 'Brent Crude', class: 'energy', basePrice: 75.30, defaultSpread: 0.04 },
  { symbol: 'EUR/USD', nameAr: 'اليورو / دولار', nameEn: 'Euro / US Dollar', class: 'forex-major', basePrice: 1.1186, defaultSpread: 0.0001 },
  { symbol: 'GBP/USD', nameAr: 'الإسترليني / دولار', nameEn: 'Pound / US Dollar', class: 'forex-major', basePrice: 1.3347, defaultSpread: 0.00015 },
  { symbol: 'USD/JPY', nameAr: 'الدولار / ين', nameEn: 'US Dollar / Yen', class: 'forex-major', basePrice: 157.44, defaultSpread: 0.012 },
  { symbol: 'USD/CHF', nameAr: 'الدولار / فرنك', nameEn: 'Dollar / Franc', class: 'forex-major', basePrice: 0.8271, defaultSpread: 0.00018 },
  { symbol: 'AUD/USD', nameAr: 'الأسترالي / دولار', nameEn: 'Aussie / US Dollar', class: 'forex-major', basePrice: 0.7020, defaultSpread: 0.00014 },
  { symbol: 'NZD/USD', nameAr: 'النيوزيلندي / دولار', nameEn: 'Kiwi / US Dollar', class: 'forex-major', basePrice: 0.5686, defaultSpread: 0.00018 },
  { symbol: 'USD/CAD', nameAr: 'الدولار / كندي', nameEn: 'Dollar / Loonie', class: 'forex-major', basePrice: 1.4016, defaultSpread: 0.00015 },
  { symbol: 'EUR/GBP', nameAr: 'اليورو / إسترليني', nameEn: 'Euro / Pound', class: 'forex-minor', basePrice: 0.8381, defaultSpread: 0.00016 },
  { symbol: 'EUR/JPY', nameAr: 'اليورو / ين', nameEn: 'Euro / Yen', class: 'forex-minor', basePrice: 176.12, defaultSpread: 0.015 },
  { symbol: 'GBP/JPY', nameAr: 'الإسترليني / ين', nameEn: 'Pound / Yen', class: 'forex-minor', basePrice: 210.13, defaultSpread: 0.02 },
  { symbol: 'AUD/JPY', nameAr: 'الأسترالي / ين', nameEn: 'Aussie / Yen', class: 'forex-minor', basePrice: 110.52, defaultSpread: 0.018 }
];

export const OVERALL_PERFORMANCE: PerformanceStats = {
  winRate: 77.4,
  totalPips: 4480,
  totalTrades: 124,
  winningTrades: 96,
  losingTrades: 28,
  openTrades: 6,
  profitFactor: 2.85,
  avgRiskReward: '1:2.4',
  bestTradePips: 320,
  worstTradePips: -85,
  consecutiveWins: 8,
};

export const MONTHLY_STATS = [
  { monthAr: 'مايو 2026', monthEn: 'May', pips: 820, wins: 18, losses: 5, winRate: 78.2 },
  { monthAr: 'يونيو 2026', monthEn: 'Jun', pips: 940, wins: 21, losses: 6, winRate: 77.8 },
  { monthAr: 'يوليو 2026', monthEn: 'Jul', pips: 710, wins: 16, losses: 6, winRate: 72.7 },
  { monthAr: 'أغسطس 2026', monthEn: 'Aug', pips: 890, wins: 19, losses: 5, winRate: 79.1 },
  { monthAr: 'سبتمبر 2026', monthEn: 'Sep', pips: 1120, wins: 22, losses: 6, winRate: 78.6 },
];
