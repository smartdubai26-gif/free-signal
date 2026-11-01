import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ALLOWED_SYMBOLS, applyCors, clientKey, fetchWithTimeout, rateLimit } from '../_lib/providers';

/**
 * GET /api/market/candle?symbol=XAU/USD
 * Returns a single 1-minute candle. Provider token stays server-side.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!applyCors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!rateLimit(clientKey(req), 60, 60_000)) {
    return res.status(429).json({ error: 'Too many requests' });
  }

  const symbol = String(req.query.symbol || 'XAU/USD').toUpperCase();
  if (!ALLOWED_SYMBOLS.has(symbol)) {
    return res.status(400).json({ error: 'Invalid or unsupported symbol' });
  }

  const token = process.env.ALLTICK_TOKEN;
  if (!token) {
    return res.status(503).json({ error: 'Market provider is not configured on the server' });
  }

  const providerSymbol = symbol.replace('/', '');
  try {
    const r = await fetchWithTimeout(
      `https://quote.alltick.co/quote-b-rest/kline?token=${encodeURIComponent(
        token
      )}&symbol=${providerSymbol}&period=1m&count=1`,
      6000
    );
    if (!r.ok) {
      return res.status(502).json({ error: 'Provider request failed' });
    }
    const data: any = await r.json();
    if (data?.ret === 401) {
      return res.status(502).json({ error: 'Provider rejected the configured credentials' });
    }
    const candle = data?.showapi_res_body?.data?.[0] || data?.data?.[0];
    if (!candle) {
      return res.status(502).json({ error: 'Provider returned no candle' });
    }
    res.setHeader('Cache-Control', 'public, s-maxage=10, stale-while-revalidate=30');
    return res.status(200).json({ symbol, candle });
  } catch {
    return res.status(502).json({ error: 'Failed to communicate with data provider' });
  }
}
