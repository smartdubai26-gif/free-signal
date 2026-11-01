import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ALLOWED_PROVIDERS, applyCors, clientKey, fetchWithTimeout, rateLimit } from '../_lib/providers';

/**
 * POST /api/market/test
 * body: { provider: 'twelvedata' | 'finnhub' | 'alltick', apiKey?: string }
 *
 * Verifies a provider key WITHOUT ever persisting it. If apiKey is omitted the
 * server falls back to its own environment key, so the UI can simply say
 * "test the configured connection".
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!rateLimit(clientKey(req), 20, 60_000)) {
    return res.status(429).json({ success: false, message: 'طلبات كثيرة جداً، حاول بعد دقيقة.' });
  }

  const provider = String(req.body?.provider || '');
  if (!ALLOWED_PROVIDERS.has(provider)) {
    return res.status(400).json({ success: false, message: 'مزود غير مدعوم.' });
  }

  const envKey =
    provider === 'twelvedata'
      ? process.env.TWELVE_DATA_API_KEY
      : provider === 'finnhub'
        ? process.env.FINNHUB_API_KEY
        : process.env.ALLTICK_TOKEN;

  const supplied = typeof req.body?.apiKey === 'string' ? req.body.apiKey.trim() : '';
  const key = supplied || envKey || '';

  if (!key) {
    return res.status(200).json({
      success: false,
      message: 'لا يوجد مفتاح مُهيّأ على السيرفر لهذا المزود. أضِفه في متغيرات بيئة Vercel.',
    });
  }

  try {
    if (provider === 'twelvedata') {
      const r = await fetchWithTimeout(
        `https://api.twelvedata.com/price?symbol=EUR/USD&apikey=${encodeURIComponent(key)}`,
        6000
      );
      const data: any = await r.json();
      if (data?.price) {
        return res.status(200).json({
          success: true,
          message: `تم الاتصال بنجاح بمزود Twelve Data (EUR/USD: ${Number(data.price).toFixed(4)})`,
          samplePrice: Number(data.price),
        });
      }
      return res.status(200).json({
        success: false,
        message: data?.message || 'مفتاح Twelve Data غير صالح أو تجاوز الحد المجاني.',
      });
    }

    if (provider === 'finnhub') {
      const r = await fetchWithTimeout(
        `https://finnhub.io/api/v1/quote?symbol=BINANCE:BTCUSDT&token=${encodeURIComponent(key)}`,
        6000
      );
      const data: any = await r.json();
      if (data?.c > 0) {
        return res.status(200).json({
          success: true,
          message: 'تم الاتصال بنجاح بمزود Finnhub.',
          samplePrice: data.c,
        });
      }
      return res.status(200).json({ success: false, message: 'مفتاح Finnhub غير صالح أو تجاوز الحد.' });
    }

    const r = await fetchWithTimeout(
      `https://quote.alltick.co/quote-b-rest/kline?token=${encodeURIComponent(key)}&symbol=XAUUSD&period=1m&count=1`,
      6000
    );
    const data: any = await r.json();
    if (data?.ret === 401) {
      return res.status(200).json({ success: false, message: 'رمز AllTick غير صالح (401).' });
    }
    const candle = data?.showapi_res_body?.data?.[0] || data?.data?.[0];
    if (candle?.close) {
      return res.status(200).json({
        success: true,
        message: `تم التحقق من AllTick بنجاح (الذهب: ${Number(candle.close).toFixed(2)})`,
        samplePrice: Number(candle.close),
      });
    }
    return res.status(200).json({ success: false, message: data?.msg || 'استجابة غير صالحة من AllTick.' });
  } catch {
    return res.status(200).json({ success: false, message: 'تعذّر الوصول إلى المزود من السيرفر.' });
  }
}
