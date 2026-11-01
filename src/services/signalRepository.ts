import { supabase } from './supabaseClient';
import { Signal, SignalDirection, Timeframe, SignalStatus } from '../types/signals';
import { getMarketClock, cairoDayStartUtcIso, cairoDayEndUtcIso } from './marketClock';

/**
 * Converts a Cairo calendar date (YYYY-MM-DD) into the real UTC half-open
 * range [start, end) that the database should be filtered on.
 */
function cairoDayRangeUtcIso(dateStr: string): { startIso: string; endIso: string } {
  // Anchor at Cairo noon so DST transitions can never push us into the
  // neighbouring day.
  const anchorMs = new Date(`${dateStr}T12:00:00.000Z`).getTime();
  return {
    startIso: cairoDayStartUtcIso(anchorMs),
    endIso: cairoDayEndUtcIso(anchorMs),
  };
}

export interface DbSignalRecord {
  id?: string;
  symbol: string;
  timeframe: string;
  direction: 'LONG' | 'SHORT' | 'NEUTRAL';
  confidence: number;
  entry: number;
  stop_loss: number;
  tp1: number;
  tp2: number;
  tp3: number;
  risk_reward: number;
  reasons: string[];
  status: string;
  created_at?: string;
  activated_at?: string | null;
  closed_at?: string | null;
  closed_price?: number | null;
  pips_gained?: number | null;
  outcome?: string | null;
}

/**
 * HARD PRODUCTION GUARD: Strict validation before any signal persistence
 */
export function validateSignalForProduction(sig: Signal): void {
  const validStates = [
    'pending',
    'active',
    'won',
    'lost',
    'not_triggered',
    'cancelled',
    'open',
    'tp1_hit',
    'tp2_hit',
    'sl_hit',
    'closed_in_profit',
    'expired',
  ];
  const validSymbols = [
    'EUR/USD',
    'GBP/USD',
    'USD/JPY',
    'USD/CHF',
    'AUD/USD',
    'NZD/USD',
    'USD/CAD',
    'XAU/USD',
    'XAG/USD',
    'WTI',
    'WTI Oil',
    'Brent Oil',
  ];

  if (!validSymbols.includes(sig.symbol)) {
    throw new Error(`Invalid symbol: ${sig.symbol}`);
  }

  if (typeof sig.confidence !== 'number' || sig.confidence < 0 || sig.confidence > 100) {
    throw new Error(`Invalid confidence: ${sig.confidence}`);
  }

  const normStatus = (sig.status ? String(sig.status).toLowerCase() : 'pending');
  if (!validStates.includes(normStatus)) {
    throw new Error(`Invalid status: ${sig.status}`);
  }

  if (sig.direction !== 'LONG' && sig.direction !== 'SHORT' && sig.direction !== 'NEUTRAL') {
    throw new Error(`Invalid direction: ${sig.direction}`);
  }

  const stopLoss = (sig as any).stopLoss ?? (sig as any).stop_loss;
  const tp1 = (sig as any).takeProfit1 ?? (sig as any).tp1;

  // Sanity: SL must be on the correct side of entry
  if (sig.direction === 'LONG' && stopLoss >= sig.entry) {
    throw new Error(`LONG: SL (${stopLoss}) must be below entry (${sig.entry})`);
  }
  if (sig.direction === 'SHORT' && stopLoss <= sig.entry) {
    throw new Error(`SHORT: SL (${stopLoss}) must be above entry (${sig.entry})`);
  }

  // Sanity: TP must be on the correct side
  if (sig.direction === 'LONG' && tp1 <= sig.entry) {
    throw new Error(`LONG: TP1 (${tp1}) must be above entry (${sig.entry})`);
  }
  if (sig.direction === 'SHORT' && tp1 >= sig.entry) {
    throw new Error(`SHORT: TP1 (${tp1}) must be below entry (${sig.entry})`);
  }

  // Sanity: Check if timestamp is in the future.
  // BUGFIX: this was the ONLY date guard in the whole codebase, and it only
  // caught future timestamps. It never rejected a Saturday. Now a signal is
  // also rejected when its activation lands inside the closed FX week.
  const now = new Date();
  const sigDate = sig.timestamp ? new Date(sig.timestamp) : now;
  if (sigDate.getTime() > now.getTime() + 60000) {
    throw new Error(`Signal timestamp cannot be in the future: ${sig.timestamp}`);
  }
  const activationMs = sig.activated_at ? new Date(sig.activated_at).getTime() : null;
  if (activationMs !== null && Number.isFinite(activationMs)) {
    if (activationMs > now.getTime() + 60000) {
      throw new Error(`Signal activation cannot be in the future: ${sig.activated_at}`);
    }
    const clock = getMarketClock(now.getTime());
    if (!clock.isOpen && activationMs > clock.lastOpenMs) {
      throw new Error(
        `Cannot activate a signal while the FX market is closed (${clock.closedReasonAr}). ` +
          `Last valid session open was ${new Date(clock.lastOpenMs).toISOString()}.`
      );
    }
  }
}

/**
 * Saves a signal into Supabase with duplicate check (same symbol + timeframe + today's date)
 */
export async function saveSignal(signal: Signal): Promise<boolean> {
  try {
    // Enforce hard production integrity guard before doing anything
    validateSignalForProduction(signal);

    // BUGFIX: `setHours(0,0,0,0)` used the DEVICE's midnight while the stored
    // column is UTC. On a device in UTC+2 the "today" window started 22:00Z
    // the previous day, so the duplicate check compared against the wrong
    // window and could both miss real duplicates and block fresh signals.
    const todayStart = new Date(getMarketClock().dayStartUtcIso);

    // 1. Check for existing duplicate today
    const { data: existing, error: queryError } = await supabase
      .from('signals')
      .select('id')
      .eq('symbol', signal.symbol)
      .eq('timeframe', signal.timeframe)
      .gte('created_at', todayStart.toISOString());

    if (queryError) {
      console.warn('Duplicate check warning:', queryError.message);
    }

    if (existing && existing.length > 0) {
      console.log(`Signal for ${signal.symbol} (${signal.timeframe}) already exists today. Skipping insert.`);
      return false;
    }

    // 2. Prepare DB record
    const record: DbSignalRecord = {
      symbol: signal.symbol,
      timeframe: signal.timeframe,
      direction: signal.direction as any,
      confidence: signal.confidence,
      entry: signal.entry,
      stop_loss: signal.stopLoss,
      tp1: signal.takeProfit1,
      tp2: signal.takeProfit2,
      tp3: signal.takeProfit3 || signal.takeProfit2,
      risk_reward: signal.riskReward || 2.0,
      reasons: signal.reasons || [signal.reasoningAr],
      status: signal.status ? signal.status.toLowerCase() : 'pending',
    };

    const { error: insertError } = await supabase.from('signals').insert([record]);

    if (insertError) {
      console.warn('Supabase insert error (using local state fallback):', insertError.message);
      return false;
    }

    console.log(`Successfully persisted signal for ${signal.symbol} to Supabase.`);
    return true;
  } catch (err) {
    console.warn('saveSignal connection error:', err);
    return false;
  }
}

/**
 * Map raw Supabase database row to frontend Signal entity
 */
export function mapRowToSignal(row: any): Signal {
  const normStatus = (row.status || 'pending').toLowerCase();
  const pips = row.pips_gained != null ? Number(row.pips_gained) : 0;
  const currentPrice = row.closed_price != null ? Number(row.closed_price) : Number(row.entry);

  return {
    id: row.id,
    symbol: row.symbol,
    nameAr: row.symbol === 'XAU/USD' ? 'الذهب الفوري' : row.symbol,
    nameEn: row.symbol,
    assetClass: row.symbol.includes('XAU') ? 'metals' : row.symbol.includes('Oil') ? 'energy' : 'forex-major',
    direction: row.direction,
    entry: Number(row.entry),
    stopLoss: Number(row.stop_loss),
    takeProfit1: Number(row.tp1),
    takeProfit2: Number(row.tp2),
    takeProfit3: Number(row.tp3),
    confidence: Number(row.confidence),
    timeframe: row.timeframe as Timeframe,
    reasoningAr: Array.isArray(row.reasons) ? row.reasons[0] : 'تحليل فني متقدم',
    reasoningEn: Array.isArray(row.reasons) ? row.reasons[0] : 'Advanced technical analysis',
    indicators: {
      rsi: 58,
      macd: { macd: 0.0015, signal: 0.0012, histogram: 0.0003 },
      ema20: Number(row.entry) - 0.5,
      ema50: Number(row.entry) - 1.2,
      ema200: Number(row.entry) - 3.5,
      atr: 1.2,
      adx: 28,
      bollinger: { upper: Number(row.entry) + 2, middle: Number(row.entry), lower: Number(row.entry) - 2 },
      support: [Number(row.stop_loss)],
      resistance: [Number(row.tp1), Number(row.tp2)],
      pivotPoints: { pp: Number(row.entry), r1: Number(row.tp1), r2: Number(row.tp2), s1: Number(row.stop_loss), s2: Number(row.stop_loss) - 1 },
    },
    candles: [],
    timestamp: row.created_at,
    sessionTarget: 'جلسة التداول اللحظية',
    status: normStatus as SignalStatus,
    currentPrice: currentPrice,
    resultPips: pips,
    pipValueDecimals: row.symbol.includes('JPY') || row.symbol.includes('XAU') ? 2 : 4,
    riskRewardRatio: `1:${row.risk_reward}`,
    riskReward: Number(row.risk_reward),
    highSinceEntry: Number(row.entry),
    lowSinceEntry: Number(row.entry),
    isTopOpportunity: Number(row.confidence) >= 85,
    isLiveFeed: true,
    isLocked: true,
    reasons: row.reasons,
    dataQuality: 'live',
    activated_at: row.activated_at || undefined,
    closed_at: row.closed_at || undefined,
    closed_price: row.closed_price != null ? Number(row.closed_price) : undefined,
    pips_gained: row.pips_gained != null ? Number(row.pips_gained) : undefined,
    outcome: row.outcome || undefined,
    exitPrice: row.closed_price != null ? Number(row.closed_price) : undefined,
    exitTime: row.closed_at || undefined,
  };
}

/**
 * Fetches all signals created today from Supabase
 */
export async function getTodaySignals(): Promise<Signal[]> {
  try {
    // BUGFIX: same device-midnight bug as saveSignal — use the Cairo day start.
    const todayStart = new Date(getMarketClock().dayStartUtcIso);

    const { data, error } = await supabase
      .from('signals')
      .select('*')
      .gte('created_at', todayStart.toISOString())
      .order('confidence', { ascending: false });

    if (error || !data) {
      console.warn('Supabase fetch error:', error?.message);
      return [];
    }

    return data.map(mapRowToSignal);
  } catch (err) {
    console.warn('getTodaySignals error:', err);
    return [];
  }
}

/**
 * Fetches all signals for a specific date (YYYY-MM-DD)
 */
export async function getSignalsByDate(dateStr: string): Promise<Signal[]> {
  try {
    // BUGFIX: `${dateStr}T00:00:00.000Z` treats the Cairo calendar day as UTC.
    // "2026-10-31" in Cairo begins at 2026-10-30T22:00Z, so 2–3 hours of every
    // day's signals were attributed to the wrong date.
    const { startIso, endIso } = cairoDayRangeUtcIso(dateStr);

    const { data, error } = await supabase
      .from('signals')
      .select('*')
      .gte('created_at', startIso)
      .lt('created_at', endIso)
      .order('created_at', { ascending: true });

    if (error || !data) {
      console.warn('getSignalsByDate error:', error?.message);
      return [];
    }

    return data.map(mapRowToSignal);
  } catch (err) {
    console.warn('getSignalsByDate exception:', err);
    return [];
  }
}

/**
 * Fetches all signals from Supabase (all-time)
 */
export async function getAllSignals(): Promise<Signal[]> {
  try {
    const { data, error } = await supabase
      .from('signals')
      .select('*')
      .order('created_at', { ascending: false });

    if (error || !data) {
      console.warn('getAllSignals error:', error?.message);
      return [];
    }

    return data.map(mapRowToSignal);
  } catch (err) {
    console.warn('getAllSignals exception:', err);
    return [];
  }
}

/**
 * Fetches all closed signals (outcome in win/loss or closed status)
 */
export async function getClosedSignals(): Promise<Signal[]> {
  try {
    const { data, error } = await supabase
      .from('signals')
      .select('*')
      .or('outcome.in.(win,loss),status.in.(won,lost,tp1_hit,tp2_hit,sl_hit,closed_in_profit)')
      .order('created_at', { ascending: false });

    if (error || !data) {
      console.warn('getClosedSignals error:', error?.message);
      return [];
    }

    return data.map(mapRowToSignal);
  } catch (err) {
    console.warn('getClosedSignals exception:', err);
    return [];
  }
}

export async function deleteAllSignalsFromSupabase() {
  try {
    const { error } = await supabase.from('signals').delete().neq('id', '0');
    return !error;
  } catch (err) {
    console.error('Error deleting all signals:', err);
    return false;
  }
}
