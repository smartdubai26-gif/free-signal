/**
 * MSI Tick Aggregator & Candle Store.
 * Aggregates live tick updates into M1/M5/M15/M30 candles.
 * Tracks last valid tick timestamps, finalized candles, and unrecoverable data gaps.
 */

export interface AggregatedCandle {
  symbol: string;
  interval: string; // 'M1' | 'M5' | 'M15' | 'M30'
  open: number;
  high: number;
  low: number;
  close: number;
  timestamp: number; // UTC boundary start in ms
  isComplete: boolean;
  hasGap?: boolean;
  gapDetails?: string;
  source?: 'LIVE_TICK' | 'REST_RECOVERED' | 'REST_RECONCILED';
  tickCount?: number;
}

export interface DataGapRecord {
  symbol: string;
  interval: string;
  startTime: number;
  endTime: number;
  reason: 'REST_UNAVAILABLE' | 'REST_EMPTY' | 'RATE_LIMITED' | 'PROVIDER_ERROR' | 'UNRESOLVED_DISCONNECT';
  detectedAt: number;
  missedCandles: number;
}

export const TIMEFRAME_MINUTES: Record<string, number> = {
  M1: 1,
  M5: 5,
  M15: 15,
  M30: 30,
};

export const TIMEFRAME_MS: Record<string, number> = {
  M1: 60 * 1000,
  M5: 5 * 60 * 1000,
  M15: 15 * 60 * 1000,
  M30: 30 * 60 * 1000,
};

export function getUTCIntervalBoundary(timestamp: number, intervalMinutes: number): number {
  const intervalMs = intervalMinutes * 60 * 1000;
  return Math.floor(timestamp / intervalMs) * intervalMs;
}

/**
 * Helper to check if a UTC timestamp falls within standard Forex weekend closure:
 * Friday 21:00 UTC to Sunday 21:00 UTC.
 */
export function isForexMarketClosed(timestampMs: number): boolean {
  const date = new Date(timestampMs);
  const day = date.getUTCDay(); // 0 is Sunday, 5 is Friday, 6 is Saturday
  const hour = date.getUTCHours();

  // Friday after 21:00 UTC
  if (day === 5 && hour >= 21) return true;
  // Saturday all day
  if (day === 6) return true;
  // Sunday before 21:00 UTC
  if (day === 0 && hour < 21) return true;

  return false;
}

export class TickAggregator {
  // Independent timestamp state per symbol to prevent cross-symbol interference
  private lastTickTimestamp: Map<string, number> = new Map();
  private lastIntervalTickTimestamp: Map<string, number> = new Map();
  private lastIntervalTickPrice: Map<string, number> = new Map();
  // Active (currently building) candle per `${symbol}_M${intervalMinutes}`
  private activeCandles: Map<string, AggregatedCandle> = new Map();
  // Last finalized candle per `${symbol}_M${intervalMinutes}`
  private lastFinalizedCandles: Map<string, AggregatedCandle> = new Map();
  // Completed & recovered history per `${symbol}_M${intervalMinutes}`
  private candleHistory: Map<string, AggregatedCandle[]> = new Map();
  // Detected unrecoverable or unresolved gaps
  private dataGaps: Map<string, DataGapRecord[]> = new Map();

  private readonly maxHistoryPerKey = 200;

  processTick(
    tick: { symbol: string; price: number; timestamp: number },
    intervalMinutes: number = 1
  ): AggregatedCandle | null {
    if (!tick || typeof tick.price !== 'number' || isNaN(tick.price) || !tick.symbol || !tick.timestamp) {
      return null;
    }

    // Provider timestamps may arrive in seconds (< 10000000000); normalize to ms
    const timestampMs = tick.timestamp < 10000000000 ? tick.timestamp * 1000 : tick.timestamp;

    const intervalStr = `M${intervalMinutes}`;
    const intervalKey = `${tick.symbol}_${intervalStr}`;
    const intervalMs = intervalMinutes * 60 * 1000;

    // Discard out-of-order ticks on this interval
    const lastTimestamp = this.lastIntervalTickTimestamp.get(intervalKey) || 0;
    const lastPrice = this.lastIntervalTickPrice.get(intervalKey);

    if (timestampMs < lastTimestamp) {
      return null;
    }
    // Discard identical duplicate tick on the same interval
    if (timestampMs === lastTimestamp && tick.price === lastPrice) {
      return null;
    }

    this.lastIntervalTickTimestamp.set(intervalKey, timestampMs);
    this.lastIntervalTickPrice.set(intervalKey, tick.price);
    this.lastTickTimestamp.set(tick.symbol, Math.max(this.lastTickTimestamp.get(tick.symbol) || 0, timestampMs));

    const candleTime = getUTCIntervalBoundary(timestampMs, intervalMinutes);
    let candle = this.activeCandles.get(intervalKey);

    if (!candle) {
      // First candle for this symbol & interval
      candle = {
        symbol: tick.symbol,
        interval: intervalStr,
        open: tick.price,
        high: tick.price,
        low: tick.price,
        close: tick.price,
        timestamp: candleTime,
        isComplete: false,
        source: 'LIVE_TICK',
        tickCount: 1,
      };
      this.activeCandles.set(intervalKey, candle);
      return candle;
    }

    if (candle.timestamp !== candleTime) {
      // Candle boundary crossed: finalize previous candle
      const finalized = { ...candle, isComplete: true };
      this.lastFinalizedCandles.set(intervalKey, finalized);
      this.appendHistory(intervalKey, finalized);

      // Check if there was an empty interval gap between candle.timestamp and candleTime
      const expectedNext = candle.timestamp + intervalMs;
      if (candleTime > expectedNext) {
        // Only flag as gap if not within a scheduled Forex market closure
        if (!isForexMarketClosed(expectedNext)) {
          const missedCandles = Math.floor((candleTime - expectedNext) / intervalMs);
          if (missedCandles > 0) {
            this.recordDataGap({
              symbol: tick.symbol,
              interval: intervalStr,
              startTime: expectedNext,
              endTime: candleTime,
              reason: 'UNRESOLVED_DISCONNECT',
              detectedAt: Date.now(),
              missedCandles,
            });
          }
        }
      }

      // Initialize new active candle
      candle = {
        symbol: tick.symbol,
        interval: intervalStr,
        open: tick.price,
        high: tick.price,
        low: tick.price,
        close: tick.price,
        timestamp: candleTime,
        isComplete: false,
        source: 'LIVE_TICK',
        tickCount: 1,
      };
      this.activeCandles.set(intervalKey, candle);
      return candle;
    }

    // Update existing active candle
    candle.high = Math.max(candle.high, tick.price);
    candle.low = Math.min(candle.low, tick.price);
    candle.close = tick.price;
    candle.tickCount = (candle.tickCount || 1) + 1;
    this.activeCandles.set(intervalKey, candle);
    return candle;
  }

  private appendHistory(intervalKey: string, candle: AggregatedCandle) {
    const list = this.candleHistory.get(intervalKey) || [];
    const existingIdx = list.findIndex(c => c.timestamp === candle.timestamp);
    if (existingIdx !== -1) {
      list[existingIdx] = candle;
    } else {
      list.push(candle);
    }
    list.sort((a, b) => a.timestamp - b.timestamp);
    if (list.length > this.maxHistoryPerKey) {
      list.splice(0, list.length - this.maxHistoryPerKey);
    }
    this.candleHistory.set(intervalKey, list);
  }

  getLastValidTickTimestamp(symbol: string): number | null {
    return this.lastTickTimestamp.get(symbol) ?? null;
  }

  getLastFinalizedCandle(symbol: string, intervalStr: string): AggregatedCandle | null {
    const intervalKey = `${symbol}_${intervalStr.toUpperCase()}`;
    return this.lastFinalizedCandles.get(intervalKey) ?? null;
  }

  getActiveCandle(symbol: string, intervalStr: string): AggregatedCandle | null {
    const intervalKey = `${symbol}_${intervalStr.toUpperCase()}`;
    return this.activeCandles.get(intervalKey) ?? null;
  }

  getCandleHistory(symbol: string, intervalStr: string): AggregatedCandle[] {
    const intervalKey = `${symbol}_${intervalStr.toUpperCase()}`;
    return [...(this.candleHistory.get(intervalKey) || [])];
  }

  /**
   * Returns only verified, finalized candles for the given symbol and timeframe.
   * Open / building active candles are never returned.
   * Candles with unresolved gaps are excluded.
   */
  getFinalizedCandles(symbol: string, intervalStr: string, limit?: number): AggregatedCandle[] {
    const intervalKey = `${symbol}_${intervalStr.toUpperCase()}`;
    const history = this.candleHistory.get(intervalKey) || [];
    const valid = history.filter(c => c.isComplete && !c.hasGap);
    if (limit && limit > 0) {
      return valid.slice(-limit);
    }
    return valid;
  }

  /**
   * Retrieves candle window for engine analysis, enforcing strict candle completeness.
   * Fails if any required candle in the window has a gap or is incomplete.
   */
  getAnalysisCandles(
    symbol: string,
    intervalStr: string,
    windowSize: number,
    options?: { allowOpenCurrent?: boolean; maxStalenessMs?: number }
  ): {
    candles: AggregatedCandle[];
    isValid: boolean;
    validationStatus: 'VALID' | 'INCOMPLETE_CANDLE' | 'STALE' | 'INSUFFICIENT_DATA';
    reason?: string;
  } {
    const finalized = this.getFinalizedCandles(symbol, intervalStr);
    const allowOpen = options?.allowOpenCurrent ?? false;
    const active = allowOpen ? this.getActiveCandle(symbol, intervalStr) : null;

    const list = [...finalized];
    if (active) {
      list.push(active);
    }

    if (list.length < windowSize) {
      return {
        candles: list,
        isValid: false,
        validationStatus: 'INSUFFICIENT_DATA',
        reason: `Insufficient candles: required ${windowSize}, available ${list.length}`,
      };
    }

    const window = list.slice(-windowSize);

    // Verify EVERY candle in the analysis window
    for (const c of window) {
      if (c.hasGap) {
        return {
          candles: window,
          isValid: false,
          validationStatus: 'INCOMPLETE_CANDLE',
          reason: `Candle at ${new Date(c.timestamp).toISOString()} has data gap (${c.gapDetails || 'UNKNOWN_GAP'})`,
        };
      }
      if (!allowOpen && !c.isComplete) {
        return {
          candles: window,
          isValid: false,
          validationStatus: 'INCOMPLETE_CANDLE',
          reason: `Candle at ${new Date(c.timestamp).toISOString()} is incomplete/open.`,
        };
      }
    }

    // Check staleness of the latest candle
    const latest = window[window.length - 1];
    const maxStaleness = options?.maxStalenessMs !== undefined
      ? options.maxStalenessMs
      : (TIMEFRAME_MS[intervalStr.toUpperCase()] || 60000) * 3;
    const now = Date.now();
    if (isFinite(maxStaleness) && !isForexMarketClosed(now) && (now - latest.timestamp > maxStaleness)) {
      return {
        candles: window,
        isValid: false,
        validationStatus: 'STALE',
        reason: `Latest candle timestamp ${new Date(latest.timestamp).toISOString()} exceeds staleness threshold of ${maxStaleness}ms`,
      };
    }

    return {
      candles: window,
      isValid: true,
      validationStatus: 'VALID',
    };
  }

  getDataGaps(symbol: string, intervalStr: string): DataGapRecord[] {
    const intervalKey = `${symbol}_${intervalStr.toUpperCase()}`;
    return [...(this.dataGaps.get(intervalKey) || [])];
  }

  recordDataGap(gap: DataGapRecord): void {
    const intervalKey = `${gap.symbol}_${gap.interval.toUpperCase()}`;
    const gaps = this.dataGaps.get(intervalKey) || [];
    gaps.push(gap);
    this.dataGaps.set(intervalKey, gaps);

    // Flag any existing candles in history that fall within the gap window
    const list = this.candleHistory.get(intervalKey) || [];
    list.forEach(c => {
      if (c.timestamp >= gap.startTime && c.timestamp < gap.endTime) {
        c.hasGap = true;
        c.gapDetails = gap.reason;
      }
    });

    const active = this.activeCandles.get(intervalKey);
    if (active && active.timestamp >= gap.startTime && active.timestamp < gap.endTime) {
      active.hasGap = true;
      active.gapDetails = gap.reason;
    }
  }

  /**
   * Deterministically merge candles recovered from historical REST into candle store.
   * Safety guarantees (MSI Phase 17 Audit):
   * 1. Never overwrites newer valid live updates or live close with older data.
   * 2. Active open candles remain isComplete: false and are not corrupted.
   * 3. Rejects invalid timestamps or non-aligned boundaries.
   * 4. Never synthesizes or fills missing periods with fabricated prices.
   * 5. Clears data gap registry ONLY after successful, verified recovery of all intervals.
   */
  mergeRecoveredCandles(
    symbol: string,
    intervalStr: string,
    recoveredCandles: AggregatedCandle[]
  ): { merged: number; rejected: number; updated: number } {
    const intervalKey = `${symbol}_${intervalStr.toUpperCase()}`;
    const intervalMinutes = TIMEFRAME_MINUTES[intervalStr.toUpperCase()] || 1;
    const intervalMs = intervalMinutes * 60 * 1000;

    let merged = 0;
    let rejected = 0;
    let updated = 0;

    const history = this.candleHistory.get(intervalKey) || [];
    const activeCandle = this.activeCandles.get(intervalKey);
    const now = Date.now();

    for (const rec of recoveredCandles) {
      // 1. Validation checks
      if (
        !rec ||
        rec.symbol !== symbol ||
        typeof rec.open !== 'number' || rec.open <= 0 ||
        typeof rec.high !== 'number' || rec.high <= 0 ||
        typeof rec.low !== 'number' || rec.low <= 0 ||
        typeof rec.close !== 'number' || rec.close <= 0 ||
        rec.high < rec.low ||
        rec.high < rec.open ||
        rec.high < rec.close ||
        rec.low > rec.open ||
        rec.low > rec.close
      ) {
        rejected++;
        continue;
      }

      // Check boundary alignment
      if (rec.timestamp % intervalMs !== 0) {
        rejected++;
        continue;
      }

      // Prevent future timestamps
      if (rec.timestamp > now + 60000) {
        rejected++;
        continue;
      }

      // 2. Deterministic conflict resolution for active candle:
      if (activeCandle && activeCandle.timestamp === rec.timestamp) {
        const intervalHasEnded = now >= activeCandle.timestamp + intervalMs;
        const hasLiveTicks = (activeCandle.tickCount || 0) > 0;

        // Merge extremes safely
        activeCandle.high = Math.max(activeCandle.high, rec.high);
        activeCandle.low = Math.min(activeCandle.low, rec.low);
        activeCandle.hasGap = false;

        if (intervalHasEnded) {
          // If the interval has ended in real time, finalize it
          if (!hasLiveTicks) {
            activeCandle.open = rec.open;
            activeCandle.close = rec.close;
          }
          activeCandle.isComplete = true;
          activeCandle.source = 'REST_RECONCILED';
          this.appendHistory(intervalKey, { ...activeCandle });
          this.activeCandles.delete(intervalKey);
        } else {
          // The interval is STILL OPEN:
          // Strictly preserve live close if live ticks arrived; do NOT mark complete!
          if (!hasLiveTicks) {
            activeCandle.open = rec.open;
            activeCandle.close = rec.close;
          }
          activeCandle.isComplete = false; // MUST REMAIN FALSE while forming
          activeCandle.source = hasLiveTicks ? 'LIVE_TICK' : 'REST_RECONCILED';
          this.activeCandles.set(intervalKey, activeCandle);
        }
        updated++;
        continue;
      }

      // 3. If already present in finalized history
      const existingIdx = history.findIndex(h => h.timestamp === rec.timestamp);
      if (existingIdx !== -1) {
        const existing = history[existingIdx];
        if (existing.hasGap || !existing.isComplete) {
          history[existingIdx] = {
            ...rec,
            source: 'REST_RECONCILED',
            isComplete: true,
            hasGap: false,
          };
          updated++;
        }
        // Never overwrite existing valid, complete, gap-free candles
        continue;
      }

      // 4. Insert new recovered candle
      const validCandle: AggregatedCandle = {
        ...rec,
        symbol,
        interval: intervalStr.toUpperCase(),
        isComplete: true,
        hasGap: false,
        source: 'REST_RECOVERED',
      };
      history.push(validCandle);
      merged++;
    }

    // Keep history sorted chronologically
    history.sort((a, b) => a.timestamp - b.timestamp);
    if (history.length > this.maxHistoryPerKey) {
      history.splice(0, history.length - this.maxHistoryPerKey);
    }
    this.candleHistory.set(intervalKey, history);

    // Update lastFinalizedCandle
    if (history.length > 0) {
      const latestFinalized = history[history.length - 1];
      const currentFinalized = this.lastFinalizedCandles.get(intervalKey);
      if (!currentFinalized || latestFinalized.timestamp >= currentFinalized.timestamp) {
        this.lastFinalizedCandles.set(intervalKey, latestFinalized);
      }
    }

    // 5. Clear any resolved data gaps ONLY after verified recovery of all intervals
    const gaps = this.dataGaps.get(intervalKey) || [];
    const remainingGaps = gaps.filter(g => {
      let allResolved = true;
      for (let t = g.startTime; t < g.endTime; t += intervalMs) {
        const c = history.find(cand => cand.timestamp === t);
        if (!c || !c.isComplete || c.hasGap) {
          allResolved = false;
          break;
        }
      }
      return !allResolved;
    });
    this.dataGaps.set(intervalKey, remainingGaps);

    return { merged, rejected, updated };
  }

  /**
   * Completeness check: returns true only if every candle in [fromTime, toTime]
   * is present, marked isComplete, and free of data gaps.
   * Handles weekend Forex market closures gracefully without false gap alerts.
   */
  isIntervalComplete(symbol: string, intervalStr: string, fromTime: number, toTime: number): boolean {
    const intervalKey = `${symbol}_${intervalStr.toUpperCase()}`;
    const intervalMinutes = TIMEFRAME_MINUTES[intervalStr.toUpperCase()] || 1;
    const intervalMs = intervalMinutes * 60 * 1000;

    // Check registered unrecovered gaps
    const gaps = this.dataGaps.get(intervalKey) || [];
    const hasOverlappingGap = gaps.some(g => g.startTime < toTime && g.endTime > fromTime);
    if (hasOverlappingGap) return false;

    const history = this.candleHistory.get(intervalKey) || [];
    const active = this.activeCandles.get(intervalKey);

    const startBoundary = Math.floor(fromTime / intervalMs) * intervalMs;
    const endBoundary = Math.floor(toTime / intervalMs) * intervalMs;

    for (let t = startBoundary; t <= endBoundary; t += intervalMs) {
      // If the market is officially closed at this timestamp, skip expectation
      if (isForexMarketClosed(t)) {
        continue;
      }

      const histCandle = history.find(c => c.timestamp === t);
      const isCandleActive = active && active.timestamp === t;

      if (!histCandle && !isCandleActive) {
        return false; // Missing candle boundary!
      }

      if (histCandle && (histCandle.hasGap || !histCandle.isComplete)) {
        return false;
      }

      if (isCandleActive && !histCandle && (active.hasGap || !active.isComplete)) {
        return false;
      }
    }

    return true;
  }
}

