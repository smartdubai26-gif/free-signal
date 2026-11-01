import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors, clientKey, fetchWithTimeout, rateLimit } from '../_lib/providers';

/**
 * GET /api/market/rates
 *
 * Returns live market rates. All provider tokens stay on the server.
 * The client never sees a key, and never talks to a provider directly.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!applyCors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!rateLimit(clientKey(req), 120, 60_000)) {
    return res.status(429).json({ error: 'Too many requests' });
  }

  const now = Date.now();
  const rates: Record<string, { price: number; lastUpdated: number; source: string }> = {};
  let activeSource = 'live-feed';

  // 1) AllTick (server-side token only)
  const alltickToken = process.env.ALLTICK_TOKEN;
  if (alltickToken) {
    try {
      const url = `https://quote.alltick.co/quote-b-rest/kline?token=${encodeURIComponent(
        alltickToken
      )}&symbol=XAUUSD&period=1m&count=1`;
      const r = await fetchWithTimeout(url, 6000);
      if (r.ok) {
        const data: any = await r.json();
        const candle = data?.showapi_res_body?.data?.[0] || data?.data?.[0];
        if (candle?.close) {
          rates['XAU/USD'] = {
            price: Number(parseFloat(candle.close).toFixed(2)),
            lastUpdated: now,
            source: 'alltick',
          };
          activeSource = 'alltick';
        }
      }
    } catch {
      /* fall through to public feeds */
    }
  }

  // 2) Public FX feed
  try {
    const r = await fetchWithTimeout('https://open.er-api.com/v6/latest/USD', 5000);
    if (r.ok) {
      const data: any = await r.json();
      const x = data?.rates;
      if (x) {
        const put = (sym: string, price: number, dp = 4) => {
          if (Number.isFinite(price) && price > 0) {
            rates[sym] = { price: Number(price.toFixed(dp)), lastUpdated: now, source: 'live-feed' };
          }
        };
        if (x.EUR) put('EUR/USD', 1 / x.EUR);
        if (x.GBP) put('GBP/USD', 1 / x.GBP);
        if (x.JPY) put('USD/JPY', x.JPY, 2);
        if (x.CAD) put('USD/CAD', x.CAD);
        if (x.CHF) put('USD/CHF', x.CHF);
        if (x.AUD) put('AUD/USD', 1 / x.AUD);
        if (x.NZD) put('NZD/USD', 1 / x.NZD);
        if (x.EUR && x.GBP) put('EUR/GBP', x.GBP / x.EUR);
        if (x.EUR && x.JPY) put('EUR/JPY', x.JPY / x.EUR, 2);
        if (x.GBP && x.JPY) put('GBP/JPY', x.JPY / x.GBP, 2);
        if (x.AUD && x.JPY) put('AUD/JPY', x.JPY / x.AUD, 2);
      }
    }
  } catch {
    /* ignore */
  }

  // 3) Gold proxy via PAXG if AllTick did not answer
  if (!rates['XAU/USD']) {
    try {
      const r = await fetchWithTimeout('https://api.binance.com/api/v3/ticker/price?symbol=PAXGUSDT', 4000);
      if (r.ok) {
        const data: any = await r.json();
        const p = parseFloat(data?.price);
        if (Number.isFinite(p) && p > 1000) {
          rates['XAU/USD'] = { price: Number(p.toFixed(2)), lastUpdated: now, source: 'live-feed' };
        }
      }
    } catch {
      /* ignore */
    }
  }

  // 4) Oil
  try {
    const r = await fetchWithTimeout('https://api.binance.com/api/v3/ticker/price?symbol=BRENTUSDT', 3500);
    if (r.ok) {
      const data: any = await r.json();
      const p = parseFloat(data?.price);
      if (Number.isFinite(p) && p > 30) {
        rates['Brent Oil'] = { price: Number(p.toFixed(2)), lastUpdated: now, source: 'live-feed' };
        rates['WTI Oil'] = { price: Number((p * 0.955).toFixed(2)), lastUpdated: now, source: 'live-feed' };
      }
    }
  } catch {
    /* ignore */
  }

  res.setHeader('Cache-Control', 'public, s-maxage=5, stale-while-revalidate=20');
  return res.status(200).json({ rates, activeSource, fetchedAt: now });
}
