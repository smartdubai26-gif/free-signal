/**
 * MSI Phase 16 — Historical Gap Reconciliation & Candle Completeness Test Suite
 *
 * Deterministic tests covering:
 * 1. Short disconnects (no boundary crossed)
 * 2. Long disconnects spanning M1, M5, M15, M30 boundaries
 * 3. UTC alignment for M1, M5, M15, and M30 boundaries
 * 4. Merging recovered REST candles deterministically without duplicates
 * 5. Rejection of invalid, out-of-order, or future timestamps (never overwriting newer data)
 * 6. Unavailable REST recovery (network/500 errors) — flags gaps, NO fabricated prices
 * 7. Rate limit handling (HTTP 429) — initiates cooldown, bounds queries, records gaps
 * 8. Independent symbol timestamp state (EUR/USD does not discard XAU/USD)
 * 9. Bounded recovery window enforcement (caps excessive requests)
 * 10. Dependent engine safety gate (blocks Price Action on incomplete data)
 */

import test from 'node:test';
import assert from 'node:assert';
import {
  TickAggregator,
  getUTCIntervalBoundary,
  TIMEFRAME_MINUTES,
  TIMEFRAME_MS,
  AggregatedCandle,
} from '../liveStreamAggregator';
import { GapReconciler, RestCandleFetcher } from '../gapReconciler';
import { calculatePriceAction } from '../priceActionEngine';
import { Candle } from '../../../types/signals';
import { DataProvenance } from '../../../types/msi';

const mockProvenance: DataProvenance = {
  providerId: 'TWELVEDATA_HISTORICAL',
  mode: 'HISTORICAL',
  granularity: 'CANDLE_LEVEL',
  calculationMethod: 'MSI_TEST',
  freshnessStatus: 'FRESH',
  validationStatus: 'VALID',
  timestamp: new Date().toISOString(),
};

test('1. Short disconnect detection (no boundary crossed)', async () => {
  const aggregator = new TickAggregator();
  const reconciler = new GapReconciler(aggregator);

  // Disconnect from 14:04:10 to 14:04:40 (30 seconds within same M1, M5, M15, M30)
  // 1774965850000 = 2026-03-31T14:04:10.000Z
  const disconnectStart = 1774965850000;
  const reconnectedAt = 1774965880000; // 14:04:40.000Z

  const gaps = reconciler.detectGaps('EUR/USD', disconnectStart, reconnectedAt);

  assert.strictEqual(gaps.M1.missedCount, 0, 'M1 should have 0 missed boundaries');
  assert.strictEqual(gaps.M5.missedCount, 0, 'M5 should have 0 missed boundaries');
  assert.strictEqual(gaps.M15.missedCount, 0, 'M15 should have 0 missed boundaries');
  assert.strictEqual(gaps.M30.missedCount, 0, 'M30 should have 0 missed boundaries');
});

test('2. Long disconnect spanning M1, M5, M15, M30 boundaries', async () => {
  const aggregator = new TickAggregator();
  const reconciler = new GapReconciler(aggregator);

  // Disconnect from 14:04:00 to 14:36:00 (32 minutes)
  // Crosses 32 M1 boundaries, 6 M5 boundaries, 2 M15 boundaries, 1 M30 boundary
  const disconnectStart = 1774965840000; // 14:04:00
  const reconnectedAt = 1774967760000;   // 14:36:00

  const gaps = reconciler.detectGaps('EUR/USD', disconnectStart, reconnectedAt);

  assert.strictEqual(gaps.M1.missedCount, 33);
  assert.strictEqual(gaps.M5.missedCount, 7);
  assert.strictEqual(gaps.M15.missedCount, 2);
  assert.strictEqual(gaps.M30.missedCount, 1);
});

test('3. UTC candle boundaries remain strictly aligned for M1, M5, M15, M30', () => {
  // 2026-03-31T14:23:45.123Z = 1774967025123 ms
  const ts = 1774967025123;

  const m1 = getUTCIntervalBoundary(ts, 1);
  const m5 = getUTCIntervalBoundary(ts, 5);
  const m15 = getUTCIntervalBoundary(ts, 15);
  const m30 = getUTCIntervalBoundary(ts, 30);

  // M1 should be 14:23:00.000Z
  assert.strictEqual(new Date(m1).toISOString(), '2026-03-31T14:23:00.000Z');
  assert.strictEqual(m1 % TIMEFRAME_MS.M1, 0);

  // M5 should be 14:20:00.000Z
  assert.strictEqual(new Date(m5).toISOString(), '2026-03-31T14:20:00.000Z');
  assert.strictEqual(m5 % TIMEFRAME_MS.M5, 0);

  // M15 should be 14:15:00.000Z
  assert.strictEqual(new Date(m15).toISOString(), '2026-03-31T14:15:00.000Z');
  assert.strictEqual(m15 % TIMEFRAME_MS.M15, 0);

  // M30 should be 14:00:00.000Z
  assert.strictEqual(new Date(m30).toISOString(), '2026-03-31T14:00:00.000Z');
  assert.strictEqual(m30 % TIMEFRAME_MS.M30, 0);
});

test('4. Successful REST gap recovery & deterministic merge', async () => {
  const aggregator = new TickAggregator();

  // Simulate tick before disconnect at 14:00:00
  const t0 = 1774965600000;
  aggregator.processTick({ symbol: 'EUR/USD', price: 1.0850, timestamp: t0 }, 1);

  // Mock REST fetcher returning 2 missed candles (14:01:00 and 14:02:00)
  const mockFetcher: RestCandleFetcher = async (_sym, _interval, _size) => {
    return {
      status: 'ok',
      values: [
        { datetime: '2026-03-31 14:02:00', open: '1.0855', high: '1.0860', low: '1.0852', close: '1.0858', volume: '100' },
        { datetime: '2026-03-31 14:01:00', open: '1.0850', high: '1.0857', low: '1.0848', close: '1.0855', volume: '120' },
      ],
    };
  };

  const reconciler = new GapReconciler(aggregator, mockFetcher);
  const result = await reconciler.reconcileGap('EUR/USD', t0 + 1000, t0 + 150000, ['M1']);

  assert.strictEqual(result.recovered.M1.merged, 2);
  assert.strictEqual(result.recovered.M1.rejected, 0);
  assert.strictEqual(result.unrecoveredGaps.length, 0);

  const history = aggregator.getCandleHistory('EUR/USD', 'M1');
  assert.strictEqual(history.length, 2);
  assert.strictEqual(history[0].open, 1.0850);
  assert.strictEqual(history[1].close, 1.0858);
});

test('5. Overlapping recovered candles & conflict resolution without duplicate entries', async () => {
  const aggregator = new TickAggregator();
  const baseTime = 1774965600000;

  // Insert a recovered candle at baseTime
  const initialCandles: AggregatedCandle[] = [
    {
      symbol: 'EUR/USD',
      interval: 'M1',
      open: 1.0800,
      high: 1.0820,
      low: 1.0790,
      close: 1.0810,
      timestamp: baseTime,
      isComplete: true,
    },
  ];
  aggregator.mergeRecoveredCandles('EUR/USD', 'M1', initialCandles);

  // Attempt to re-merge the exact same timestamp with conflicting prices
  const overlappingCandles: AggregatedCandle[] = [
    {
      symbol: 'EUR/USD',
      interval: 'M1',
      open: 1.0999, // Conflicting older/alternate data
      high: 1.0999,
      low: 1.0999,
      close: 1.0999,
      timestamp: baseTime,
      isComplete: true,
    },
    {
      symbol: 'EUR/USD',
      interval: 'M1',
      open: 1.0810,
      high: 1.0830,
      low: 1.0805,
      close: 1.0825,
      timestamp: baseTime + 60000, // New valid candle
      isComplete: true,
    },
  ];

  const mergeRes = aggregator.mergeRecoveredCandles('EUR/USD', 'M1', overlappingCandles);
  assert.strictEqual(mergeRes.merged, 1, 'Only the new timestamp should be merged');

  const history = aggregator.getCandleHistory('EUR/USD', 'M1');
  assert.strictEqual(history.length, 2, 'No duplicates permitted');
  // First candle preserved without being overwritten by conflicting older data
  assert.strictEqual(history[0].open, 1.0800);
  assert.strictEqual(history[1].open, 1.0810);
});

test('6. Never overwrite newer valid data with older data & reject future timestamps', () => {
  const aggregator = new TickAggregator();
  const now = Date.now();
  const pastBoundary = Math.floor((now - 120000) / 60000) * 60000;

  // Process live tick in pastBoundary
  aggregator.processTick({ symbol: 'EUR/USD', price: 1.0850, timestamp: pastBoundary + 1000 }, 1);
  // Advance with live tick to next boundary
  aggregator.processTick({ symbol: 'EUR/USD', price: 1.0860, timestamp: pastBoundary + 61000 }, 1);

  // Attempt to merge an unaligned timestamp and a future timestamp
  const invalidCandles: AggregatedCandle[] = [
    {
      symbol: 'EUR/USD',
      interval: 'M1',
      open: 1.0850,
      high: 1.0860,
      low: 1.0840,
      close: 1.0855,
      timestamp: pastBoundary + 12345, // NOT boundary aligned!
      isComplete: true,
    },
    {
      symbol: 'EUR/USD',
      interval: 'M1',
      open: 1.0850,
      high: 1.0860,
      low: 1.0840,
      close: 1.0855,
      timestamp: now + 3600000, // Future timestamp!
      isComplete: true,
    },
    {
      symbol: 'EUR/USD',
      interval: 'M1',
      open: 1.0850,
      high: 1.0800, // High < Low (invalid!)
      low: 1.0890,
      close: 1.0855,
      timestamp: pastBoundary,
      isComplete: true,
    },
  ];

  const res = aggregator.mergeRecoveredCandles('EUR/USD', 'M1', invalidCandles);
  assert.strictEqual(res.rejected, 3, 'All 3 invalid candles must be rejected');
});

test('7. Unavailable REST recovery flags data gap and never fabricates prices', async () => {
  const aggregator = new TickAggregator();

  // Mock REST fetcher throwing network error
  const failingFetcher: RestCandleFetcher = async () => {
    throw new Error('NETWORK_TIMEOUT_502');
  };

  const reconciler = new GapReconciler(aggregator, failingFetcher);
  const disconnectStart = 1774965600000;
  const reconnectedAt = 1774965800000; // Misses 3 M1 intervals

  const result = await reconciler.reconcileGap('EUR/USD', disconnectStart, reconnectedAt, ['M1']);

  assert.strictEqual(result.unrecoveredGaps.length, 1);
  assert.strictEqual(result.unrecoveredGaps[0].reason, 'REST_UNAVAILABLE');

  // Verify that NO synthetic candles were created in history
  const history = aggregator.getCandleHistory('EUR/USD', 'M1');
  assert.strictEqual(history.length, 0, 'No synthetic or fabricated candles allowed');

  // Verify gap is recorded and queryable
  const gaps = aggregator.getDataGaps('EUR/USD', 'M1');
  assert.strictEqual(gaps.length, 1);
  assert.strictEqual(gaps[0].reason, 'REST_UNAVAILABLE');

  // Interval completeness must return false
  const isComplete = aggregator.isIntervalComplete('EUR/USD', 'M1', disconnectStart, reconnectedAt);
  assert.strictEqual(isComplete, false);
});

test('8. Rate limit handling initiates cooldown and avoids excessive requests', async () => {
  const aggregator = new TickAggregator();

  let calls = 0;
  const rateLimitingFetcher: RestCandleFetcher = async () => {
    calls++;
    throw new Error('PROVIDER_RATE_LIMIT_429');
  };

  const reconciler = new GapReconciler(aggregator, rateLimitingFetcher, { cooldownPeriodMs: 60000 });
  const disconnectStart = 1774965600000;
  const reconnectedAt = 1774965800000;

  // First call hits 429
  const res1 = await reconciler.reconcileGap('EUR/USD', disconnectStart, reconnectedAt, ['M1']);
  assert.strictEqual(calls, 1);
  assert.strictEqual(res1.rateLimited, true);
  assert.strictEqual(reconciler.isRateLimited(), true);

  // Second call within cooldown window should NOT execute REST request
  const res2 = await reconciler.reconcileGap('EUR/USD', disconnectStart, reconnectedAt, ['M1']);
  assert.strictEqual(calls, 1, 'Rest fetcher must NOT be called while rate limited');
  assert.strictEqual(res2.rateLimited, true);
  assert.strictEqual(res2.unrecoveredGaps[0].reason, 'RATE_LIMITED');
});

test('9. Independent timestamp state per symbol prevents cross-symbol interference', () => {
  const aggregator = new TickAggregator();

  const tEur = 1774965600000;
  const tXau = 1774965500000; // Older than EUR, but for a different symbol

  const candleEur = aggregator.processTick({ symbol: 'EUR/USD', price: 1.0850, timestamp: tEur }, 1);
  assert.ok(candleEur !== null, 'EUR/USD tick must be accepted');

  // XAU/USD has a timestamp earlier than EUR/USD's last tick, but it's an independent symbol!
  const candleXau = aggregator.processTick({ symbol: 'XAU/USD', price: 2150.5, timestamp: tXau }, 1);
  assert.ok(candleXau !== null, 'XAU/USD tick must NOT be discarded by EUR/USD timestamp');

  assert.strictEqual(aggregator.getLastValidTickTimestamp('EUR/USD'), tEur);
  assert.strictEqual(aggregator.getLastValidTickTimestamp('XAU/USD'), tXau);
});

test('10. Bounded recovery window caps requests during extended disconnects', async () => {
  const aggregator = new TickAggregator();
  let requestedOutputSize = 0;

  const mockFetcher: RestCandleFetcher = async (_sym, _interval, size) => {
    requestedOutputSize = size;
    return { status: 'ok', values: [] };
  };

  const maxRecoveryWindow = 20;
  const reconciler = new GapReconciler(aggregator, mockFetcher, { maxRecoveryWindow });

  // 100 minutes disconnect (100 M1 candles missed)
  const disconnectStart = 1774960000000;
  const reconnectedAt = 1774966000000;

  const res = await reconciler.reconcileGap('EUR/USD', disconnectStart, reconnectedAt, ['M1']);

  // Outputsize must be capped at maxRecoveryWindow (20)
  assert.strictEqual(requestedOutputSize, maxRecoveryWindow);
  // Excess 80 missed candles flagged as unrecoverable
  assert.ok(res.unrecoveredGaps.some(g => g.reason === 'UNRESOLVED_DISCONNECT' && g.missedCandles === 80));
});

test('11. Dependent Price Action analysis is blocked when candles contain data gaps', () => {
  const candlesWithGap: Candle[] = [
    { time: '08:00', timestamp: 1000, open: 1.1200, high: 1.1250, low: 1.1180, close: 1.1220, volume: 1500 },
    { time: '08:01', timestamp: 2000, open: 1.1220, high: 1.1280, low: 1.1210, close: 1.1270, volume: 2200 },
    { time: '08:02', timestamp: 3000, open: 1.1270, high: 1.1300, low: 1.1240, close: 1.1250, volume: 1800, hasGap: true } as any,
    { time: '08:03', timestamp: 4000, open: 1.1250, high: 1.1290, low: 1.1230, close: 1.1280, volume: 1600 },
    { time: '08:04', timestamp: 5000, open: 1.1280, high: 1.1320, low: 1.1260, close: 1.1310, volume: 1900 },
    { time: '08:05', timestamp: 6000, open: 1.1310, high: 1.1350, low: 1.1290, close: 1.1340, volume: 2100 },
    { time: '08:06', timestamp: 7000, open: 1.1340, high: 1.1380, low: 1.1320, close: 1.1370, volume: 2300 },
  ];

  const result = calculatePriceAction(candlesWithGap, mockProvenance);

  assert.strictEqual(result.status, 'UNAVAILABLE');
  assert.strictEqual(result.data, null);
  assert.strictEqual(result.provenance.validationStatus, 'INCOMPLETE_CANDLE');
  assert.ok(result.error?.includes('Data gap detected'));
});
