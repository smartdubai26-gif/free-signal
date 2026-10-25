/**
 * MSI Gap Reconciliation Engine (Phase 16)
 * Detects missed intervals after disconnects, queries Twelve Data historical REST proxy,
 * validates recovered candles, deterministically merges data, and enforces strict gap flagging.
 *
 * Safety Invariants:
 * 1. Never overwrites newer valid data with older data.
 * 2. Never fabricates prices or silently fills gaps with synthetic candles.
 * 3. Keeps rate limits bounded and deduplicates concurrent queries.
 * 4. Flags unrecoverable gaps so downstream engines mark analysis as INCOMPLETE_CANDLE / UNAVAILABLE.
 */

import {
  TickAggregator,
  AggregatedCandle,
  DataGapRecord,
  TIMEFRAME_MINUTES,
  TIMEFRAME_MS,
  getUTCIntervalBoundary,
} from './liveStreamAggregator';

export interface GapDetectionDetail {
  timeframe: string;
  intervalMinutes: number;
  missedCount: number;
  gapStart: number;
  gapEnd: number;
}

export interface ReconciliationResult {
  symbol: string;
  disconnectStart: number;
  reconnectedAt: number;
  disconnectDurationMs: number;
  detectedGaps: Record<string, GapDetectionDetail>;
  recovered: Record<string, { merged: number; updated: number; rejected: number }>;
  unrecoveredGaps: DataGapRecord[];
  rateLimited: boolean;
}

export type RestCandleFetcher = (
  symbol: string,
  interval: string,
  outputsize: number
) => Promise<any>;

// Default Twelve Data REST fetcher that queries backend proxy
export const defaultRestFetcher: RestCandleFetcher = async (
  symbol: string,
  interval: string,
  outputsize: number
) => {
  const url = `http://localhost:3000/api/msi/time_series?symbol=${encodeURIComponent(
    symbol
  )}&interval=${encodeURIComponent(interval)}&outputsize=${outputsize}`;

  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 429) {
      throw new Error('PROVIDER_RATE_LIMIT_429');
    }
    throw new Error(`HTTP_${res.status}_PROVIDER_ERROR`);
  }
  const json = await res.json();
  if (json.status === 'error' || json.code === 429) {
    if (json.message?.toLowerCase().includes('rate limit') || json.code === 429) {
      throw new Error('PROVIDER_RATE_LIMIT_429');
    }
    throw new Error(json.message || 'PROVIDER_RETURNED_ERROR');
  }
  return json;
};

export class GapReconciler {
  private aggregator: TickAggregator;
  private restFetcher: RestCandleFetcher;
  private maxRecoveryWindow: number;
  private cooldownPeriodMs: number;

  private inFlightRecoveries: Set<string> = new Set();
  private rateLimitCooldownUntil: number = 0;

  // Supported timeframe to Twelve Data REST interval param
  private readonly intervalMap: Record<string, string> = {
    M1: '1min',
    M5: '5min',
    M15: '15min',
    M30: '30min',
  };

  constructor(
    aggregator: TickAggregator,
    restFetcher: RestCandleFetcher = defaultRestFetcher,
    options?: { maxRecoveryWindow?: number; cooldownPeriodMs?: number }
  ) {
    this.aggregator = aggregator;
    this.restFetcher = restFetcher;
    this.maxRecoveryWindow = options?.maxRecoveryWindow ?? 30;
    this.cooldownPeriodMs = options?.cooldownPeriodMs ?? 60000;
  }

  isRateLimited(): boolean {
    return Date.now() < this.rateLimitCooldownUntil;
  }

  getRemainingCooldown(): number {
    return Math.max(0, this.rateLimitCooldownUntil - Date.now());
  }

  setRateLimitCooldown(ms?: number) {
    this.rateLimitCooldownUntil = Date.now() + (ms ?? this.cooldownPeriodMs);
  }

  /**
   * Detect exact missed interval boundaries for each timeframe during disconnect.
   */
  detectGaps(
    symbol: string,
    disconnectStart: number,
    reconnectedAt: number
  ): Record<string, GapDetectionDetail> {
    const result: Record<string, GapDetectionDetail> = {};

    for (const [tf, minutes] of Object.entries(TIMEFRAME_MINUTES)) {
      const intervalMs = minutes * 60 * 1000;
      // First boundary at or strictly after disconnectStart
      const tFirst = Math.ceil(disconnectStart / intervalMs) * intervalMs;
      // Last boundary at or strictly before reconnectedAt
      const tLast = Math.floor(reconnectedAt / intervalMs) * intervalMs;

      if (tFirst <= tLast) {
        const missedCount = Math.floor((tLast - tFirst) / intervalMs) + 1;
        result[tf] = {
          timeframe: tf,
          intervalMinutes: minutes,
          missedCount,
          gapStart: tFirst,
          gapEnd: tLast + intervalMs,
        };
      } else {
        // Disconnect was shorter than the interval and didn't cross a boundary
        result[tf] = {
          timeframe: tf,
          intervalMinutes: minutes,
          missedCount: 0,
          gapStart: 0,
          gapEnd: 0,
        };
      }
    }

    return result;
  }

  /**
   * Reconcile detected gaps across timeframes.
   */
  async reconcileGap(
    symbol: string,
    disconnectStart: number,
    reconnectedAt: number,
    timeframes: string[] = ['M1', 'M5', 'M15', 'M30']
  ): Promise<ReconciliationResult> {
    const duration = Math.max(0, reconnectedAt - disconnectStart);
    const gapDetails = this.detectGaps(symbol, disconnectStart, reconnectedAt);

    const summary: ReconciliationResult = {
      symbol,
      disconnectStart,
      reconnectedAt,
      disconnectDurationMs: duration,
      detectedGaps: gapDetails,
      recovered: {},
      unrecoveredGaps: [],
      rateLimited: this.isRateLimited(),
    };

    for (const tf of timeframes) {
      const detail = gapDetails[tf];
      if (!detail || detail.missedCount === 0) {
        summary.recovered[tf] = { merged: 0, updated: 0, rejected: 0 };
        continue;
      }

      const dedupeKey = `${symbol}_${tf}`;
      if (this.inFlightRecoveries.has(dedupeKey)) {
        // Skip duplicate recovery already in progress
        continue;
      }

      // Check rate limit state
      if (this.isRateLimited()) {
        const gapRecord: DataGapRecord = {
          symbol,
          interval: tf,
          startTime: detail.gapStart,
          endTime: detail.gapEnd,
          reason: 'RATE_LIMITED',
          detectedAt: Date.now(),
          missedCandles: detail.missedCount,
        };
        this.aggregator.recordDataGap(gapRecord);
        summary.unrecoveredGaps.push(gapRecord);
        summary.rateLimited = true;
        continue;
      }

      // Bounded recovery window
      const boundedOutputSize = Math.min(detail.missedCount + 2, this.maxRecoveryWindow);

      // If the gap exceeded maxRecoveryWindow, flag the excess older portion as unrecoverable
      if (detail.missedCount > this.maxRecoveryWindow) {
        const excessCount = detail.missedCount - this.maxRecoveryWindow;
        const intervalMs = detail.intervalMinutes * 60 * 1000;
        const unrecoverableEnd = detail.gapStart + excessCount * intervalMs;
        const unrecoverableRecord: DataGapRecord = {
          symbol,
          interval: tf,
          startTime: detail.gapStart,
          endTime: unrecoverableEnd,
          reason: 'UNRESOLVED_DISCONNECT',
          detectedAt: Date.now(),
          missedCandles: excessCount,
        };
        this.aggregator.recordDataGap(unrecoverableRecord);
        summary.unrecoveredGaps.push(unrecoverableRecord);
      }

      const tdInterval = this.intervalMap[tf] || '1min';

      try {
        this.inFlightRecoveries.add(dedupeKey);
        const data = await this.restFetcher(symbol, tdInterval, boundedOutputSize);

        if (!data || !data.values || !Array.isArray(data.values) || data.values.length === 0) {
          // REST returned empty data: flag gap as empty/unavailable
          const gapRecord: DataGapRecord = {
            symbol,
            interval: tf,
            startTime: detail.gapStart,
            endTime: detail.gapEnd,
            reason: 'REST_EMPTY',
            detectedAt: Date.now(),
            missedCandles: detail.missedCount,
          };
          this.aggregator.recordDataGap(gapRecord);
          summary.unrecoveredGaps.push(gapRecord);
          summary.recovered[tf] = { merged: 0, updated: 0, rejected: 0 };
          continue;
        }

        // Parse REST candles
        const parsedCandles: AggregatedCandle[] = [];
        for (const v of data.values) {
          const dateStr = v.datetime;
          const iso = dateStr.includes('T') ? dateStr : `${dateStr.replace(' ', 'T')}Z`;
          const ts = new Date(iso).getTime();
          const open = parseFloat(v.open);
          const high = parseFloat(v.high);
          const low = parseFloat(v.low);
          const close = parseFloat(v.close);

          if (!isNaN(ts) && !isNaN(open) && !isNaN(high) && !isNaN(low) && !isNaN(close)) {
            parsedCandles.push({
              symbol,
              interval: tf,
              open,
              high,
              low,
              close,
              timestamp: ts,
              isComplete: true,
              hasGap: false,
              source: 'REST_RECOVERED',
            });
          }
        }

        // Merge into aggregator
        const mergeResult = this.aggregator.mergeRecoveredCandles(symbol, tf, parsedCandles);
        summary.recovered[tf] = mergeResult;

        // Check if all expected timestamps in [gapStart, gapEnd) were covered
        const intervalMs = detail.intervalMinutes * 60 * 1000;
        const recoveredTimestamps = new Set(parsedCandles.map(c => c.timestamp));
        for (let t = detail.gapStart; t < detail.gapEnd; t += intervalMs) {
          if (!recoveredTimestamps.has(t)) {
            // Gap remains for this missing boundary: flag explicitly
            const missingRecord: DataGapRecord = {
              symbol,
              interval: tf,
              startTime: t,
              endTime: t + intervalMs,
              reason: 'REST_EMPTY',
              detectedAt: Date.now(),
              missedCandles: 1,
            };
            this.aggregator.recordDataGap(missingRecord);
            summary.unrecoveredGaps.push(missingRecord);
          }
        }
      } catch (err: any) {
        const errorMsg = String(err?.message || err);
        const isRateLimit =
          errorMsg.includes('RATE_LIMIT') ||
          errorMsg.includes('429') ||
          errorMsg.toLowerCase().includes('rate limit');

        if (isRateLimit) {
          this.setRateLimitCooldown();
          summary.rateLimited = true;
          const gapRecord: DataGapRecord = {
            symbol,
            interval: tf,
            startTime: detail.gapStart,
            endTime: detail.gapEnd,
            reason: 'RATE_LIMITED',
            detectedAt: Date.now(),
            missedCandles: detail.missedCount,
          };
          this.aggregator.recordDataGap(gapRecord);
          summary.unrecoveredGaps.push(gapRecord);
        } else {
          const gapRecord: DataGapRecord = {
            symbol,
            interval: tf,
            startTime: detail.gapStart,
            endTime: detail.gapEnd,
            reason: 'REST_UNAVAILABLE',
            detectedAt: Date.now(),
            missedCandles: detail.missedCount,
          };
          this.aggregator.recordDataGap(gapRecord);
          summary.unrecoveredGaps.push(gapRecord);
        }
        summary.recovered[tf] = { merged: 0, updated: 0, rejected: 0 };
      } finally {
        this.inFlightRecoveries.delete(dedupeKey);
      }
    }

    return summary;
  }
}
