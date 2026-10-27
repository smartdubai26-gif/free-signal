import { supabase, isSupabaseConfigured } from './supabaseClient';
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

function updateLocalSignal(id: string, updates: Record<string, any>) {
  try {
    if (typeof localStorage === 'undefined') return;
    const stored = localStorage.getItem('alphafx_today_signals');
    if (!stored) return;
    const list = JSON.parse(stored);
    if (!Array.isArray(list)) return;
    const updated = list.map((s: any) => {
      if (s.id === id) {
        return {
          ...s,
          ...updates,
          status: updates.status || s.status,
          outcome: updates.outcome || s.outcome,
          exitPrice: updates.closed_price !== undefined ? updates.closed_price : s.exitPrice,
          exitTime: updates.closed_at || s.exitTime,
          resultPips: updates.pips_gained !== undefined ? updates.pips_gained : s.resultPips,
        };
      }
      return s;
    });
    localStorage.setItem('alphafx_today_signals', JSON.stringify(updated));
  } catch (e) {
    // ignore
  }
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
    let signals: any[] = [];
    let isUsingLocal = !isSupabaseConfigured();

    if (!isUsingLocal) {
      try {
        const { data, error: fetchError } = await supabase
          .from('signals')
          .select('*')
          .in('status', ['pending', 'active', 'OPEN']);

        if (fetchError) {
          console.warn('Supabase fetch notice (falling back to local settlement):', fetchError.message);
          isUsingLocal = true;
        } else {
          signals = data || [];
        }
      } catch (err: any) {
        console.warn('Supabase network notice (falling back to local settlement):', err?.message || err);
        isUsingLocal = true;
      }
    }

    if (isUsingLocal) {
      try {
        if (typeof localStorage !== 'undefined') {
          const stored = localStorage.getItem('alphafx_today_signals');
          if (stored) {
            const parsed = JSON.parse(stored);
            if (Array.isArray(parsed)) {
              signals = parsed.filter((s: any) => {
                const st = (s.status || '').toLowerCase();
                return st === 'pending' || st === 'active' || st === 'open';
              });
            }
          }
        }
      } catch (e) {
        // ignore
      }
    }

    if (!signals || signals.length === 0) {
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
        report.errors.push(warn);
        continue;
      }

      const status = (sig.status || 'pending').toLowerCase();
      const direction: 'LONG' | 'SHORT' = sig.direction === 'LONG' ? 'LONG' : 'SHORT';
      const entry = Number(sig.entry);
      const stopLoss = Number(sig.stop_loss ?? sig.stopLoss);
      const tp1 = Number(sig.tp1 ?? sig.takeProfit1);

      // ─── STATE 1: PENDING -> ACTIVE ───
      if (status === 'pending') {
        const isTriggered =
          direction === 'LONG' ? currentPrice <= entry : currentPrice >= entry;

        if (isTriggered) {
          const updates = {
            status: 'active',
            activated_at: nowIso,
          };

          if (!isUsingLocal) {
            try {
              await supabase.from('signals').update(updates).eq('id', sig.id);
            } catch {
              updateLocalSignal(sig.id, updates);
            }
          } else {
            updateLocalSignal(sig.id, updates);
          }

          console.log(`[Settlement] Signal ${symbol} (${sig.id}) activated at price ${currentPrice}`);
          report.activatedCount++;
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
          const updates = {
            status: 'lost',
            outcome: 'loss',
            closed_at: nowIso,
            closed_price: currentPrice,
            pips_gained: pips,
          };

          if (!isUsingLocal) {
            try {
              const { error: updateErr } = await supabase
                .from('signals')
                .update(updates)
                .eq('id', sig.id);

              if (updateErr) {
                updateLocalSignal(sig.id, updates);
              }
            } catch {
              updateLocalSignal(sig.id, updates);
            }
          } else {
            updateLocalSignal(sig.id, updates);
          }

          console.log(`[Settlement] Signal ${symbol} (${sig.id}) hit SL: lost (${pips} pips)`);
          report.lostCount++;
        } else if (isWin) {
          const pips = calculatePipGain(symbol, entry, currentPrice, direction);
          const updates = {
            status: 'won',
            outcome: 'win',
            closed_at: nowIso,
            closed_price: currentPrice,
            pips_gained: pips,
          };

          if (!isUsingLocal) {
            try {
              const { error: updateErr } = await supabase
                .from('signals')
                .update(updates)
                .eq('id', sig.id);

              if (updateErr) {
                updateLocalSignal(sig.id, updates);
              }
            } catch {
              updateLocalSignal(sig.id, updates);
            }
          } else {
            updateLocalSignal(sig.id, updates);
          }

          console.log(`[Settlement] Signal ${symbol} (${sig.id}) hit TP1: won (+${pips} pips)`);
          report.wonCount++;
        } else {
          report.stillActiveCount++;
        }
      }
    }
  } catch (err: any) {
    const msg = `runSettlement notice: ${err?.message || err}`;
    console.warn(msg);
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
    let count = 0;

    if (isSupabaseConfigured()) {
      try {
        const { data, error } = await supabase
          .from('signals')
          .update({
            status: 'not_triggered',
            outcome: 'not_triggered',
            closed_at: nowIso,
          })
          .eq('status', 'pending')
          .select('id');

        if (!error && data) {
          count = data.length;
        }
      } catch (e) {
        // continue to local fallback
      }
    }

    // Also update localStorage
    try {
      if (typeof localStorage !== 'undefined') {
        const stored = localStorage.getItem('alphafx_today_signals');
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed)) {
            let localCount = 0;
            const updated = parsed.map((s: any) => {
              if ((s.status || '').toLowerCase() === 'pending') {
                localCount++;
                return { ...s, status: 'not_triggered', outcome: 'not_triggered', closed_at: nowIso };
              }
              return s;
            });
            localStorage.setItem('alphafx_today_signals', JSON.stringify(updated));
            if (count === 0) count = localCount;
          }
        }
      }
    } catch {
      // ignore
    }

    console.log(`[Settlement] Closed ${count} expired pending signals as not_triggered.`);
    return count;
  } catch (err) {
    console.warn('closeExpiredSignals exception:', err);
    return 0;
  }
}
