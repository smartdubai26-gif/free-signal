import { supabase } from './supabaseClient';
import { DailySummary } from '../types/signals';

/**
 * Formats a Date object to YYYY-MM-DD
 */
export function formatDateYmd(d: Date = new Date()): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Computes and updates daily summary metrics for a given date in Supabase
 */
export async function updateDailySummary(dateStr: string = formatDateYmd()): Promise<DailySummary | null> {
  try {
    const startIso = `${dateStr}T00:00:00.000Z`;
    const endIso = `${dateStr}T23:59:59.999Z`;

    // 1. Fetch all signals for that day
    const { data: signals, error: fetchErr } = await supabase
      .from('signals')
      .select('*')
      .gte('created_at', startIso)
      .lte('created_at', endIso);

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

  // Fallback to generating 7 days based on current date if no history is present yet
  const fallback: DailySummary[] = [];
  const today = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = formatDateYmd(d);
    fallback.push({
      date: dateStr,
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
