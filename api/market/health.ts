import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors } from '../_lib/providers';

/**
 * GET /api/market/health
 * Reports which providers are configured — booleans only, never the values.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!applyCors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    alltick: Boolean(process.env.ALLTICK_TOKEN),
    twelvedata: Boolean(process.env.TWELVE_DATA_API_KEY),
    finnhub: Boolean(process.env.FINNHUB_API_KEY),
    supabase: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY),
  });
}
