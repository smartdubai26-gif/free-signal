import { runSettlement, closeExpiredSignals, SettlementReport } from './settlementEngine';
import { updateDailySummary } from './dailySummary';

export interface SchedulerOptions {
  onRunAnalysis?: () => Promise<void>;
  onSettlementComplete?: (report: SettlementReport) => void;
  onEodComplete?: (count: number) => void;
}

/**
 * Returns current Cairo date (YYYY-MM-DD), hour (0-23), and minute (0-59)
 */
export function getCairoDateTime(): { dateStr: string; hour: number; minute: number } {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Cairo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });

    const parts = formatter.formatToParts(new Date());
    const getPart = (type: string) => parts.find((p) => p.type === type)?.value || '';

    const year = getPart('year');
    const month = getPart('month');
    const day = getPart('day');
    const hour = parseInt(getPart('hour') || '0', 10);
    const minute = parseInt(getPart('minute') || '0', 10);

    const dateStr = `${year}-${month}-${day}`;
    return { dateStr, hour, minute };
  } catch (err) {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    return { dateStr, hour: now.getHours(), minute: now.getMinutes() };
  }
}

/**
 * Starts the background lifecycle scheduler
 * - Checks every 30 seconds
 * - Hourly settlement runs
 * - 07:30 Cairo time morning analysis
 * - 23:00 Cairo time EOD close
 */
export function startScheduler(options: SchedulerOptions): () => void {
  console.log('[Scheduler] Initializing automated trading lifecycle scheduler...');

  let lastSettlementTimestamp = 0;
  const ONE_HOUR_MS = 60 * 60 * 1000;

  const tick = async () => {
    const now = Date.now();
    const { dateStr, hour, minute } = getCairoDateTime();

    // 1. Hourly Settlement Check
    if (now - lastSettlementTimestamp >= ONE_HOUR_MS) {
      lastSettlementTimestamp = now;
      console.log(`[Scheduler] Running automated hourly settlement at ${new Date().toISOString()}...`);
      try {
        const report = await runSettlement();
        if (options.onSettlementComplete) {
          options.onSettlementComplete(report);
        }
        await updateDailySummary(dateStr);
      } catch (err) {
        console.warn('[Scheduler] Hourly settlement error:', err);
      }
    }

    // 2. Cairo 07:30 Morning Analysis Check
    const isPastMorningTime = hour > 7 || (hour === 7 && minute >= 30);
    if (isPastMorningTime && options.onRunAnalysis) {
      try {
        const lastRun = localStorage.getItem('alphafx_analysis_last_run_date');
        if (lastRun !== dateStr) {
          console.log(`[Scheduler] 07:30 Cairo milestone reached for ${dateStr}. Triggering market analysis...`);
          localStorage.setItem('alphafx_analysis_last_run_date', dateStr);
          await options.onRunAnalysis();
        }
      } catch (e) {
        console.warn('[Scheduler] Analysis trigger warning:', e);
      }
    }

    // 3. Cairo 23:00 EOD Close Check
    const isPastEodTime = hour >= 23;
    if (isPastEodTime) {
      try {
        const lastEodRun = localStorage.getItem('alphafx_eod_last_run_date');
        if (lastEodRun !== dateStr) {
          console.log(`[Scheduler] 23:00 Cairo EOD milestone reached for ${dateStr}. Closing expired pending signals...`);
          localStorage.setItem('alphafx_eod_last_run_date', dateStr);
          const closedCount = await closeExpiredSignals();
          await updateDailySummary(dateStr);
          if (options.onEodComplete) {
            options.onEodComplete(closedCount);
          }
        }
      } catch (e) {
        console.warn('[Scheduler] EOD trigger warning:', e);
      }
    }
  };

  // Run initial tick after 5 seconds
  const initialTimeout = setTimeout(tick, 5000);

  // Set interval every 30 seconds
  const intervalId = setInterval(tick, 30000);

  return () => {
    clearTimeout(initialTimeout);
    clearInterval(intervalId);
    console.log('[Scheduler] Scheduler stopped.');
  };
}
