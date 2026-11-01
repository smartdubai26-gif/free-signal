import { runSettlement, closeExpiredSignals, SettlementReport } from './settlementEngine';
import { updateDailySummary } from './dailySummary';
import {
  getMarketClock,
  isMarketOpen,
  getCairoParts,
  getAnalysisSchedule,
  getLastH4CloseMs,
  getScanPriority,
  type AnalysisSchedule,
} from './marketClock';

export interface SchedulerOptions {
  /**
   * Runs the analysis engine. `closeMs` is the H4 candle close being scanned
   * and `weight` is the session priority multiplier (1.15 at the London open).
   */
  onRunAnalysis?: (closeMs: number, weight: number) => Promise<void>;
  onSettlementComplete?: (report: SettlementReport) => void;
  onEodComplete?: (count: number) => void;
  onMarketStateChange?: (isOpen: boolean) => void;
  /** Fires whenever the schedule advances, so the UI can re-render the countdown. */
  onScheduleChange?: (schedule: AnalysisSchedule) => void;
}

/**
 * Returns current Cairo date (YYYY-MM-DD), hour (0-23), and minute (0-59).
 *
 * BUGFIX: this used to silently fall back to the DEVICE timezone
 * (`now.getHours()`) whenever Intl threw, which shifted every milestone by the
 * user's UTC offset. It now delegates to marketClock, which has a single,
 * tested Cairo implementation.
 */
export function getCairoDateTime(): { dateStr: string; hour: number; minute: number } {
  const p = getCairoParts();
  return { dateStr: p.date, hour: p.hour, minute: p.minute };
}

/**
 * Starts the background lifecycle scheduler.
 *
 * SCHEDULE (changed from a single daily 07:30 milestone):
 *   Analysis now runs on EVERY H4 candle close — 00:00, 04:00, 08:00, 12:00,
 *   16:00 and 20:00 UTC — instead of once per day. The 08:00 UTC close (the
 *   London-open candle) and the 12:00 UTC close (London/New York overlap) are
 *   weighted higher, so opportunities found there outrank the routine scans.
 *
 * MARKET GATING (kept from the previous fix, still mandatory):
 *   - No analysis while the FX week is closed (Saturday, Friday after 21:00 UTC,
 *     Sunday before 21:00 UTC).
 *   - A scan that would have fallen inside the weekend is deferred to the
 *     week-open instant (Sunday 21:00 UTC), i.e. the first candle after the open.
 *   - Settlement still runs hourly while open, and the 23:00 Cairo EOD close
 *     still runs even when closed (a weekend must reconcile Friday's leftovers).
 */
export function startScheduler(options: SchedulerOptions): () => void {
  console.log('[Scheduler] Initializing H4 candle-close scheduler...');

  let lastSettlementTimestamp = 0;
  let lastKnownMarketOpen: boolean | null = null;
  let lastScannedCloseMs = 0;
  const ONE_HOUR_MS = 60 * 60 * 1000;

  /**
   * Restores the last scanned candle from storage so a page reload does not
   * re-run the same H4 close twice.
   */
  const readLastScanned = (): number => {
    try {
      const raw = localStorage.getItem('alphafx_last_scanned_h4_close');
      const n = raw ? parseInt(raw, 10) : 0;
      return Number.isFinite(n) ? n : 0;
    } catch {
      return 0;
    }
  };

  const writeLastScanned = (ms: number) => {
    try {
      localStorage.setItem('alphafx_last_scanned_h4_close', String(ms));
    } catch {
      /* storage unavailable — in-memory guard still applies */
    }
  };

  lastScannedCloseMs = readLastScanned();

  const tick = async () => {
    const now = Date.now();
    const clock = getMarketClock(now);
    const { date: dateStr, hour } = clock.cairo;

    // Notify the UI whenever the week opens/closes so it can drop or restore
    // live opportunities immediately instead of waiting for a reload.
    if (lastKnownMarketOpen !== clock.isOpen) {
      lastKnownMarketOpen = clock.isOpen;
      console.log(
        `[Scheduler] Market state -> ${clock.isOpen ? 'OPEN' : 'CLOSED'}${
          clock.closedReasonAr ? ` (${clock.closedReasonAr})` : ''
        }`
      );
      options.onMarketStateChange?.(clock.isOpen);
    }

    // Publish the schedule every tick so the countdown never drifts.
    const schedule = getAnalysisSchedule(now);
    options.onScheduleChange?.(schedule);

    // ── 1. Hourly Settlement Check — ONLY while the market is trading ──
    if (!clock.isOpen) {
      // Reset the timer so that the first tick after the week reopens runs
      // immediately rather than waiting up to an hour.
      lastSettlementTimestamp = 0;
    } else if (now - lastSettlementTimestamp >= ONE_HOUR_MS) {
      lastSettlementTimestamp = now;
      console.log(`[Scheduler] Running automated hourly settlement at ${new Date(now).toISOString()}...`);
      try {
        const report = await runSettlement();
        options.onSettlementComplete?.(report);
        await updateDailySummary(dateStr);
      } catch (err) {
        console.warn('[Scheduler] Hourly settlement error:', err);
      }
    }

    // ── 2. H4 candle-close analysis — ONLY while the market is trading ──
    // The trigger is the *candle close instant*, not the wall clock hour, so a
    // tick that lands 20 seconds after 08:00 UTC still scans the 08:00 candle.
    if (clock.isOpen && options.onRunAnalysis) {
      const closeMs = getLastH4CloseMs(now);
      if (closeMs > lastScannedCloseMs) {
        const priority = getScanPriority(closeMs);
        console.log(
          `[Scheduler] H4 close ${new Date(closeMs).toISOString()} reached ` +
            `(priority=${priority.priority}, weight=${priority.weight}). Triggering analysis...`
        );
        // Write the marker BEFORE awaiting, so a slow/failed run cannot
        // re-trigger on the next 30s tick.
        lastScannedCloseMs = closeMs;
        writeLastScanned(closeMs);
        try {
          await options.onRunAnalysis(closeMs, priority.weight);
        } catch (err) {
          console.warn('[Scheduler] H4 analysis error:', err);
        }
      }
    }

    // ── 3. Cairo 23:00 EOD Close — runs regardless of market state ──
    // A weekend still has to reconcile Friday's leftover pending orders.
    const isPastEodTime = hour >= 23;
    if (isPastEodTime) {
      try {
        const lastEodRun = localStorage.getItem('alphafx_eod_last_run_date');
        if (lastEodRun !== dateStr) {
          console.log(`[Scheduler] 23:00 Cairo EOD milestone reached for ${dateStr}. Closing expired pending signals...`);
          localStorage.setItem('alphafx_eod_last_run_date', dateStr);
          const closedCount = await closeExpiredSignals();
          await updateDailySummary(dateStr);
          options.onEodComplete?.(closedCount);
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

export { isMarketOpen };
