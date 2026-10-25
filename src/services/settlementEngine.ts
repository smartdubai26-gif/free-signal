import { supabase } from './supabaseClient';
import { fetchLiveMarketRates } from './liveMarketData';

export interface SettlementReport {
  processedCount: number;
  activatedCount: number;
  wonCount: number;
  lostCount: number;
  stillActiveCount: number;
  stillPendingCount: number;
  timestamp: string;
  errors: string[];
}

/**
 * Returns standard pip size per asset
 */
export function getPipSize(symbol: string): number {
  const sym = (symbol || '').toUpperCase();
  if (sym.includes('JPY')) return 0.01;
  if (sym.includes('XAU') || sym.includes('GOLD')) return 0.1;
  if (sym.includes('XAG') || sym.includes('SILVER')) return 0.001;
  if (sym.includes('OIL') || sym.includes('WTI') || sym.includes('BRENT')) return 0.01;
  return 0.0001;
}

/**
 * Calculates signed pip gain/loss based on trade direction
 */
export function calculatePipGain(
  symbol: string,
  entry: number,
  closedPrice: number,
  direction: 'LONG' | 'SHORT'
): number {
  const pipSize = getPipSize(symbol);
  const diff = direction === 'LONG' ? closedPrice - entry : entry - closedPrice;
  return Number((diff / pipSize).toFixed(1));
}

/**
 * Fetch current live price for a given symbol
 */
export async function getLivePrice(symbol: string, cachedRates?: Record<string, { price: number }>): Promise<number | null> {
  // 1. Check cached rates if provided
  if (cachedRates && cachedRates[symbol]?.price) {
    return cachedRates[symbol].price;
  }

  // 2. Fetch fresh rates from live service
  try {
    const rates = await fetchLiveMarketRates();
    if (rates && rates[symbol]?.price) {
      return rates[symbol].price;
    }
    // Also check standard symbol mappings (e.g. XAU/USD -> PAXG or gold)
    const normalized = symbol.replace('_', '/');
    if (rates && rates[normalized]?.price) {
      return rates[normalized].price;
    }
  } catch (err) {
    console.warn(`Could not fetch live market rate for ${symbol}:`, err);
  }

  return null;
}

/**
 * Executes a settlement run across all pending and active signals
 */
export async function runSettlement(cachedRates?: Record<string, { price: number }>): Promise<SettlementReport> {
  const report: SettlementReport = {
    processedCount: 0,
    activatedCount: 0,
    wonCount: 0,
    lostCount: 0,
    stillActiveCount: 0,
    stillPendingCount: 0,
    timestamp: new Date().toISOString(),
    errors: [],
  };

  try {
    // 1. Fetch all pending and active signals from Supabase
    const { data: signals, error: fetchError } = await supabase
      .from('signals')
      .select('*')
      .in('status', ['pending', 'active', 'OPEN']);

    if (fetchError) {
      const err = `Failed to fetch signals for settlement: ${fetchError.message}`;
      console.error(err);
      report.errors.push(err);
      return report;
    }

    if (!signals || signals.length === 0) {
      console.log('No pending or active signals to settle.');
      return report;
    }

    report.processedCount = signals.length;

    // Fetch batch rates once to minimize API calls
    let marketRates = cachedRates;
    if (!marketRates) {
      try {
        marketRates = await fetchLiveMarketRates();
      } catch (rateErr: any) {
        console.warn('Batch live rates fetch warning:', rateErr?.message);
      }
    }

    const nowIso = new Date().toISOString();

    for (const sig of signals) {
      const symbol = sig.symbol;
      const currentPrice = await getLivePrice(symbol, marketRates);

      if (currentPrice === null || isNaN(currentPrice) || currentPrice <= 0) {
        const warn = `Price unavailable for ${symbol}; skipping settlement this cycle.`;
        console.warn(warn);
        report.errors.push(warn);
        continue;
      }

      const status = (sig.status || 'pending').toLowerCase();
      const direction: 'LONG' | 'SHORT' = sig.direction === 'LONG' ? 'LONG' : 'SHORT';
      const entry = Number(sig.entry);
      const stopLoss = Number(sig.stop_loss);
      const tp1 = Number(sig.tp1);

      // ─── STATE 1: PENDING -> ACTIVE ───
      if (status === 'pending') {
        const isTriggered =
          direction === 'LONG' ? currentPrice <= entry : currentPrice >= entry;

        if (isTriggered) {
          const { error: updateErr } = await supabase
            .from('signals')
            .update({
              status: 'active',
              activated_at: nowIso,
            })
            .eq('id', sig.id);

          if (updateErr) {
            report.errors.push(`Failed to activate ${sig.id}: ${updateErr.message}`);
          } else {
            console.log(`[Settlement] Signal ${symbol} (${sig.id}) activated at price ${currentPrice}`);
            report.activatedCount++;
          }
        } else {
          report.stillPendingCount++;
        }
        continue;
      }

      // ─── STATE 2: ACTIVE -> WON or LOST ───
      if (status === 'active' || status === 'open') {
        let isLoss = false;
        let isWin = false;

        // CRITICAL SAFETY RULE: Check STOP LOSS FIRST!
        if (direction === 'LONG') {
          if (currentPrice <= stopLoss) {
            isLoss = true;
          } else if (currentPrice >= tp1) {
            isWin = true;
          }
        } else {
          // SHORT
          if (currentPrice >= stopLoss) {
            isLoss = true;
          } else if (currentPrice <= tp1) {
            isWin = true;
          }
        }

        if (isLoss) {
          const pips = calculatePipGain(symbol, entry, currentPrice, direction);
          const { error: updateErr } = await supabase
            .from('signals')
            .update({
              status: 'lost',
              outcome: 'loss',
              closed_at: nowIso,
              closed_price: currentPrice,
              pips_gained: pips,
            })
            .eq('id', sig.id);

          if (updateErr) {
            report.errors.push(`Failed to mark ${sig.id} as lost: ${updateErr.message}`);
          } else {
            console.log(`[Settlement] Signal ${symbol} (${sig.id}) hit SL: lost (${pips} pips)`);
            report.lostCount++;
          }
        } else if (isWin) {
          const pips = calculatePipGain(symbol, entry, currentPrice, direction);
          const { error: updateErr } = await supabase
            .from('signals')
            .update({
              status: 'won',
              outcome: 'win',
              closed_at: nowIso,
              closed_price: currentPrice,
              pips_gained: pips,
            })
            .eq('id', sig.id);

          if (updateErr) {
            report.errors.push(`Failed to mark ${sig.id} as won: ${updateErr.message}`);
          } else {
            console.log(`[Settlement] Signal ${symbol} (${sig.id}) hit TP1: won (+${pips} pips)`);
            report.wonCount++;
          }
        } else {
          report.stillActiveCount++;
        }
      }
    }
  } catch (err: any) {
    const msg = `runSettlement unexpected exception: ${err?.message || err}`;
    console.error(msg);
    report.errors.push(msg);
  }

  return report;
}

/**
 * End-of-Day Close: Marks all un-triggered pending signals as 'not_triggered'
 */
export async function closeExpiredSignals(): Promise<number> {
  try {
    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
      .from('signals')
      .update({
        status: 'not_triggered',
        outcome: 'not_triggered',
        closed_at: nowIso,
      })
      .eq('status', 'pending')
      .select('id');

    if (error) {
      console.warn('closeExpiredSignals error:', error.message);
      return 0;
    }

    const count = data ? data.length : 0;
    console.log(`[Settlement] Closed ${count} expired pending signals as not_triggered.`);
    return count;
  } catch (err) {
    console.warn('closeExpiredSignals exception:', err);
    return 0;
  }
}
