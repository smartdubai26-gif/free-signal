import { supabase } from './supabaseClient';
import { DailySummary } from '../types/signals';
import { cairoDateYmd, cairoDayStartUtcIso, cairoDayEndUtcIso, getCairoParts } from './marketClock';

/**
 * Formats a Date object to YYYY-MM-DD **in the market timezone**.
 *
 * BUGFIX: the previous implementation used getFullYear/getMonth/getDate, i.e.
 * the DEVICE calendar. A user in UTC-5 at 20:00 local time got yesterday's
 * date while the server-side filter used today's — summaries landed in the
 * wrong bucket and the 7-day chart drifted.
 */
export function formatDateYmd(d: Date = new Date()): string {
  return cairoDateYmd(d.getTime());
}

/**
 * Computes and updates daily summary metrics for a given date in Supabase
 */
export async function updateDailySummary(dateStr: string = formatDateYmd()): Promise<DailySummary | null> {
  try {
    // BUGFIX: a Cairo calendar day is NOT 00:00Z..23:59Z. Using UTC bounds
    // clipped the first 2–3 hours of every trading day and swept in the tail
    // of the previous one. Compute the real bounds from the Cairo offset.
    const dayMs = new Date(`${dateStr}T12:00:00.000Z`).getTime();
    const startIso = cairoDayStartUtcIso(dayMs);
    const endIso = cairoDayEndUtcIso(dayMs);

    // 1. Fetch all signals for that day
    const { data: signals, error: fetchErr } = await supabase
      .from('signals')
      .select('*')
      .gte('created_at', startIso)
      .lt('created_at', endIso);

    if (fetchErr) {
      console.warn('Failed to fetch signals for daily summary:', fetchErr.message);
      return null;
    }

    const items = signals || [];
    const total_signals = items.length;

    let active_signals = 0;
    let won_signals = 0;
    let lost_signals = 0;
    let not_triggered_signals = 0;
    let total_pips = 0;
    let best_trade_pips = 0;
    let worst_trade_pips = 0;

    const closedGains: number[] = [];

    items.forEach((sig) => {
      const status = (sig.status || '').toLowerCase();
      const outcome = (sig.outcome || '').toLowerCase();

      if (status === 'active') {
        active_signals++;
      } else if (outcome === 'win' || status === 'won') {
        won_signals++;
        const pips = sig.pips_gained != null ? Number(sig.pips_gained) : 0;
        closedGains.push(pips);
      } else if (outcome === 'loss' || status === 'lost') {
        lost_signals++;
        const pips = sig.pips_gained != null ? Number(sig.pips_gained) : 0;
        closedGains.push(pips);
      } else if (outcome === 'not_triggered' || status === 'not_triggered') {
        not_triggered_signals++;
      }
    });

    if (closedGains.length > 0) {
      total_pips = Number(closedGains.reduce((acc, curr) => acc + curr, 0).toFixed(1));
      best_trade_pips = Math.max(...closedGains);
      worst_trade_pips = Math.min(...closedGains);
    }

    const completedCount = won_signals + lost_signals;
    const win_rate = completedCount > 0 ? Number(((won_signals / completedCount) * 100).toFixed(1)) : 0;

    const summaryRecord: DailySummary = {
      date: dateStr,
      total_signals,
      active_signals,
      won_signals,
      lost_signals,
      not_triggered_signals,
      win_rate,
      total_pips,
      best_trade_pips,
      worst_trade_pips,
      updated_at: new Date().toISOString(),
    };

    // 2. Upsert record into daily_summary table
    const { error: upsertErr } = await supabase
      .from('daily_summary')
      .upsert(summaryRecord, { onConflict: 'date' });

    if (upsertErr) {
      console.warn('daily_summary upsert warning (table might need creation in DB):', upsertErr.message);
    } else {
      console.log(`[DailySummary] Upserted summary for ${dateStr}: WinRate=${win_rate}%, Pips=${total_pips}`);
    }

    return summaryRecord;
  } catch (err) {
    console.warn('updateDailySummary exception:', err);
    return null;
  }
}

/**
 * Retained for backwards compatibility with callers that only need the
 * current Cairo clock parts.
 */
export function currentCairoParts() {
  return getCairoParts();
}
/**
 * Fetches the daily summary for a specific date
 */
export async function getDailySummary(dateStr: string = formatDateYmd()): Promise<DailySummary | null> {
  try {
    const { data, error } = await supabase
      .from('daily_summary')
      .select('*')
      .eq('date', dateStr)
      .maybeSingle();

    if (error || !data) {
      // If not yet computed in DB, compute now
      return await updateDailySummary(dateStr);
    }

    return {
      date: data.date,
      total_signals: Number(data.total_signals || 0),
      active_signals: Number(data.active_signals || 0),
      won_signals: Number(data.won_signals || 0),
      lost_signals: Number(data.lost_signals || 0),
      not_triggered_signals: Number(data.not_triggered_signals || 0),
      win_rate: Number(data.win_rate || 0),
      total_pips: Number(data.total_pips || 0),
      best_trade_pips: Number(data.best_trade_pips || 0),
      worst_trade_pips: Number(data.worst_trade_pips || 0),
      updated_at: data.updated_at,
    };
  } catch (err) {
    console.warn('getDailySummary error:', err);
    return null;
  }
}

/**
 * Fetches the last 7 daily summaries from Supabase for UI charts and tables
 */
export async function get7DaySummaries(): Promise<DailySummary[]> {
  try {
    const { data, error } = await supabase
      .from('daily_summary')
      .select('*')
      .order('date', { ascending: false })
      .limit(7);

    if (!error && data && data.length > 0) {
      const sortedAsc = data
        .map((d: any) => ({
          date: d.date,
          total_signals: Number(d.total_signals || 0),
          active_signals: Number(d.active_signals || 0),
          won_signals: Number(d.won_signals || 0),
          lost_signals: Number(d.lost_signals || 0),
          not_triggered_signals: Number(d.not_triggered_signals || 0),
          win_rate: Number(d.win_rate || 0),
          total_pips: Number(d.total_pips || 0),
          best_trade_pips: Number(d.best_trade_pips || 0),
          worst_trade_pips: Number(d.worst_trade_pips || 0),
          updated_at: d.updated_at,
        }))
        .reverse();
      return sortedAsc;
    }
  } catch (err) {
    console.warn('get7DaySummaries fetch error:', err);
  }

  // Fallback: the last 7 TRADING days (weekends excluded) instead of blind
  // calendar days — otherwise Sat/Sun always render as zero-signal dips and
  // make the performance chart look like a losing streak.
  const fallback: DailySummary[] = [];
  const today = new Date();
  const tradingDays: string[] = [];
  for (let i = 0; tradingDays.length < 7 && i < 30; i++) {
    const d = new Date(today.getTime() - i * 24 * 3600_000);
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue; // skip Sun/Mon-open edge + Sat
    tradingDays.push(formatDateYmd(d));
  }
  for (let i = tradingDays.length - 1; i >= 0; i--) {
    fallback.push({
      date: tradingDays[i],
      total_signals: 0,
      active_signals: 0,
      won_signals: 0,
      lost_signals: 0,
      not_triggered_signals: 0,
      win_rate: 0,
      total_pips: 0,
      best_trade_pips: 0,
      worst_trade_pips: 0,
    });
  }
  return fallback;
}
