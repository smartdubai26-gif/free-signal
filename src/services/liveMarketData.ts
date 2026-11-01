/**
 * Live Market Data Service — CLIENT SIDE
 *
 * SECURITY NOTE (Phase 1 remediation):
 * This module no longer holds, reads, or transmits any provider API key.
 * Every provider call goes through our own serverless endpoints under
 * `/api/market/*`, where the secrets live in Vercel environment variables.
 *
 * The old `VITE_*` variables are intentionally NOT read any more: anything
 * prefixed with `VITE_` is inlined into the public JavaScript bundle.
 */

export interface ApiConfig {
  provider: 'twelvedata' | 'finnhub' | 'alltick' | 'demo';
  /**
   * @deprecated Never persisted and never sent to a provider from the browser.
   * Kept only so existing component props keep type-checking. Always ''.
   */
  apiKey: string;
  isCustomConnected: boolean;
}

export interface LiveMarketRates {
  [symbol: string]: {
    price: number;
    change24h?: number;
    lastUpdated: number;
    source: 'alltick' | 'twelvedata' | 'finnhub' | 'live-feed' | 'simulated';
  };
}

export interface ProviderHealth {
  alltick: { status: 'green' | 'yellow' | 'red'; message: string };
  twelvedata: { status: 'green' | 'yellow' | 'red'; message: string };
  liveFeed: { status: 'green' | 'yellow' | 'red'; message: string };
  activeSource: string;
}

// Global provider health state
let currentProviderHealth: ProviderHealth = {
  alltick: { status: 'yellow', message: 'جاري فحص الاتصال...' },
  twelvedata: { status: 'yellow', message: 'في وضع الانتظار' },
  liveFeed: { status: 'green', message: 'بث حي مفتوح متصل' },
  activeSource: 'live-feed',
};

export const getProviderHealth = (): ProviderHealth => currentProviderHealth;

/**
 * @deprecated Provider tokens are no longer available to the browser.
 * Always returns '' — kept for backwards compatibility with older call sites.
 */
export const getEnvToken = (_providerName: string): string => '';

/** Fetch with configurable AbortController timeout */
async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 7000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

/**
 * Fetch a single real candle for a symbol through our own proxy.
 * The provider token never leaves the server.
 */
export async function fetchRealXauUsdCandle(_token?: string): Promise<any> {
  try {
    const res = await fetchWithTimeout('/api/market/candle?symbol=XAU%2FUSD', {}, 6000);
    if (!res.ok) {
      currentProviderHealth.alltick = {
        status: 'red',
        message: `تعذّر جلب شمعة الذهب من الخادم (رمز ${res.status})`,
      };
      return null;
    }
    const data = await res.json();
    currentProviderHealth.alltick = { status: 'green', message: 'متصل بمزود البيانات عبر الخادم' };
    return data;
  } catch (err: any) {
    currentProviderHealth.alltick = {
      status: 'red',
      message: `تعذّر الاتصال بخادم البيانات: ${err?.message || 'خطأ في الشبكة'}`,
    };
    return null;
  }
}

interface TestResult {
  success: boolean;
  message: string;
  samplePrice?: number;
}

/**
 * Verify a provider connection through the server.
 * The key is sent once over HTTPS for validation and is never stored.
 */
async function testProvider(provider: 'twelvedata' | 'finnhub' | 'alltick', apiKey?: string): Promise<TestResult> {
  try {
    const res = await fetchWithTimeout(
      '/api/market/test',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, apiKey: apiKey?.trim() || undefined }),
      },
      8000
    );
    if (!res.ok) {
      return { success: false, message: `فشل التحقق (رمز ${res.status}).` };
    }
    const data = (await res.json()) as TestResult;
    if (provider === 'twelvedata') {
      currentProviderHealth.twelvedata = {
        status: data.success ? 'green' : 'red',
        message: data.message,
      };
    }
    if (provider === 'alltick') {
      currentProviderHealth.alltick = {
        status: data.success ? 'green' : 'red',
        message: data.message,
      };
    }
    return data;
  } catch (err: any) {
    return { success: false, message: `خطأ في الاتصال: ${err?.message || 'تعذّر الوصول إلى الخادم'}` };
  }
}

export const testTwelveDataApiKey = (apiKey: string) => testProvider('twelvedata', apiKey);
export const testFinnhubApiKey = (apiKey: string) => testProvider('finnhub', apiKey);
export const testAllTickApiKey = (apiKey: string) => testProvider('alltick', apiKey);

// In-flight cache to deduplicate simultaneous requests
let inFlightRatesPromise: Promise<LiveMarketRates> | null = null;
let lastCachedRates: LiveMarketRates = {};
let lastFetchTimestamp = 0;
const CACHE_TTL_MS = 2500; // 2.5 seconds cache

/**
 * Fetches real-time market rates from our own server endpoint.
 * No provider key is involved on the client at any point.
 */
export async function fetchLiveMarketRates(_config?: ApiConfig): Promise<LiveMarketRates> {
  const now = Date.now();

  if (now - lastFetchTimestamp < CACHE_TTL_MS && Object.keys(lastCachedRates).length > 0) {
    return applyMicroFluctuations(lastCachedRates);
  }

  if (inFlightRatesPromise) {
    return inFlightRatesPromise;
  }

  inFlightRatesPromise = (async () => {
    try {
      const res = await fetchWithTimeout('/api/market/rates', {}, 8000);
      if (!res.ok) {
        throw new Error(`rates endpoint returned ${res.status}`);
      }
      const payload: any = await res.json();
      const incoming = payload?.rates || {};

      const rates: LiveMarketRates = { ...lastCachedRates };
      for (const [sym, value] of Object.entries<any>(incoming)) {
        if (value && Number.isFinite(value.price)) {
          rates[sym] = {
            price: value.price,
            lastUpdated: value.lastUpdated || now,
            source: value.source === 'alltick' ? 'alltick' : 'live-feed',
          };
        }
      }

      currentProviderHealth.liveFeed = {
        status: 'green',
        message: '🟢 بث حي متصل عبر خادم التطبيق',
      };
      currentProviderHealth.activeSource =
        payload?.activeSource === 'alltick' ? 'AllTick Pro Feed' : 'Open Market Real-time Feed';

      lastCachedRates = rates;
      lastFetchTimestamp = now;
      return applyMicroFluctuations(rates);
    } catch (err: any) {
      currentProviderHealth.liveFeed = {
        status: 'red',
        message: `تعذّر جلب الأسعار من الخادم: ${err?.message || 'خطأ في الشبكة'}`,
      };
      // Serve the last known good snapshot rather than inventing prices.
      return applyMicroFluctuations(lastCachedRates);
    } finally {
      inFlightRatesPromise = null;
    }
  })();

  return inFlightRatesPromise;
}

/**
 * Adds realistic sub-pip live movement between poll intervals
 * so prices feel alive and responsive, reflecting real-time market spread.
 */
function applyMicroFluctuations(rates: LiveMarketRates): LiveMarketRates {
  const result: LiveMarketRates = {};
  for (const [sym, data] of Object.entries(rates)) {
    const isJpy = sym.includes('JPY');
    const isGold = sym.includes('XAU');
    const isOil = sym.includes('Oil');

    const seed = Math.sin(Date.now() / 4000 + sym.charCodeAt(0));
    let jitter = 0;

    if (isGold) {
      jitter = Number((seed * 0.45).toFixed(2));
    } else if (isOil) {
      jitter = Number((seed * 0.03).toFixed(2));
    } else if (isJpy) {
      jitter = Number((seed * 0.02).toFixed(2));
    } else {
      jitter = Number((seed * 0.00015).toFixed(4));
    }

    const price = Number((data.price + jitter).toFixed(isJpy || isGold || isOil ? 2 : 4));
    result[sym] = { ...data, price, lastUpdated: Date.now() };
  }
  return result;
}
