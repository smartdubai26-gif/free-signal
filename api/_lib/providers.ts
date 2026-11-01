import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Shared helpers for the market-data serverless functions.
 *
 * SECURITY: every provider secret is read from process.env on the server only.
 * Nothing in this file is ever bundled into the client.
 */

export const ALLOWED_SYMBOLS = new Set([
  'EUR/USD',
  'GBP/USD',
  'USD/JPY',
  'USD/CAD',
  'USD/CHF',
  'AUD/USD',
  'NZD/USD',
  'EUR/GBP',
  'EUR/JPY',
  'GBP/JPY',
  'AUD/JPY',
  'XAU/USD',
  'WTI Oil',
  'Brent Oil',
]);

export const ALLOWED_PROVIDERS = new Set(['twelvedata', 'finnhub', 'alltick']);

/** Only these origins may call the API from a browser. */
export function applyCors(req: VercelRequest, res: VercelResponse): boolean {
  const allowed = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  const origin = req.headers.origin;
  if (origin && allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return false;
  }
  return true;
}

/** Very small in-memory throttle (per warm lambda instance). */
const hits = new Map<string, { count: number; reset: number }>();

export function rateLimit(key: string, limit = 60, windowMs = 60_000): boolean {
  const now = Date.now();
  const entry = hits.get(key);
  if (!entry || now > entry.reset) {
    hits.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  entry.count += 1;
  return entry.count <= limit;
}

export function clientKey(req: VercelRequest): string {
  const fwd = req.headers['x-forwarded-for'];
  const ip = Array.isArray(fwd) ? fwd[0] : (fwd || '').split(',')[0].trim();
  return ip || 'unknown';
}

export async function fetchWithTimeout(url: string, timeoutMs = 7000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}
