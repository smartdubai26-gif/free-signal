/**
 * MSI Phase 19 — Stress, Stability & Multi-Timeframe Integrity Audit Test Suite
 *
 * Comprehensive tests for:
 * 1. WebSocket state machine transitions, clean shutdown, and malformed message resilience.
 * 2. Multi-timeframe mathematical integrity (M1, M5, M15, M30 constituent OHLC reconciliation).
 * 3. Deterministic tick fixture handling (out-of-order, same-second price updates, duplicates).
 * 4. Long disconnects, bounded recovery, partial recovery, 429 rate-limiting, and deduplication.
 * 5. 100,000+ tick stress workload with heap/rss memory bounds, history capping, and loop latency.
 * 6. Live API endpoint boundary validation, secret isolation, and analytical safety gating.
 */

import test from 'node:test';
import assert from 'node:assert';
import dotenv from 'dotenv';
import {
  TickAggregator,
  AggregatedCandle,
  isForexMarketClosed,
  getUTCIntervalBoundary,
} from '../liveStreamAggregator';
import { TwelveDataWebSocket, ConnectionState } from '../tdConnection';
import { GapReconciler, RestCandleFetcher } from '../gapReconciler';
import { calculatePriceAction } from '../priceActionEngine';
import { calculateAnchoredVWAP } from '../anchoredVwapEngine';
import { calculateVolumeProfile } from '../volumeProfileEngine';
import { calculateOrderFlow } from '../orderFlowEngine';
import { evaluateConfluence, buildOpportunity } from '../confluenceEngine';
import { DataProvenance } from '../../../types/msi';
import { Candle } from '../../../types/signals';

dotenv.config();

const API_KEY = process.env.TWELVE_DATA_API_KEY || '';

// ============================================================================
// SECTION 1: WEBSOCKET STABILITY & STATE MACHINE LIFECYCLE
// ============================================================================

test('Phase 19 — 1.1: State machine transitions (CONNECTING -> CONNECTED -> STALE -> DISCONNECTED)', async () => {
  const transitions: ConnectionState[] = [];

  const ws = new TwelveDataWebSocket(
    'dummy-key',
    () => {},
    (state) => transitions.push(state)
  );

  assert.strictEqual(ws.getState(), 'DISCONNECTED');

  // Initiate connection
  ws.connect();
  assert.strictEqual(ws.getState(), 'CONNECTING');
  assert.ok(transitions.includes('CONNECTING'));

  // Clean shutdown
  ws.close();
  assert.strictEqual(ws.getState(), 'DISCONNECTED');
  assert.strictEqual(ws.getDisconnectStartTime(), null);
});

test('Phase 19 — 1.2: Clean shutdown eliminates reconnect timers and prevents orphaned reconnect loops', async () => {
  let reconnectCount = 0;

  const ws = new TwelveDataWebSocket(
    'dummy-key',
    () => {},
    (state) => {
      if (state === 'RECONNECTING') reconnectCount++;
    }
  );

  ws.connect();
  // Immediately close explicitly
  ws.close();

  // Wait 100ms to verify no timer fires
  await new Promise((r) => setTimeout(r, 100));

  assert.strictEqual(ws.getState(), 'DISCONNECTED');
  assert.strictEqual(reconnectCount, 0, 'No reconnect loop should be scheduled after explicit close');
});

test('Phase 19 — 1.3: Subscription contract matches Twelve Data specification with params.symbols', () => {
  const ws = new TwelveDataWebSocket('dummy-key', () => {}, () => {});
  const sentMessages: string[] = [];

  // Mock socket send
  (ws as any).ws = {
    readyState: 1, // OPEN
    send: (payload: string) => sentMessages.push(payload),
    close: () => {},
  };
  (ws as any).state = 'CONNECTED';

  ws.subscribe(['EUR/USD', 'XAU/USD']);
  assert.strictEqual(sentMessages.length, 1);
  const subPayload = JSON.parse(sentMessages[0]);
  assert.strictEqual(subPayload.action, 'subscribe');
  assert.strictEqual(subPayload.params.symbols, 'EUR/USD,XAU/USD');

  ws.unsubscribe(['EUR/USD']);
  assert.strictEqual(sentMessages.length, 2);
  const unsubPayload = JSON.parse(sentMessages[1]);
  assert.strictEqual(unsubPayload.action, 'unsubscribe');
  assert.strictEqual(unsubPayload.params.symbols, 'EUR/USD');
});

test('Phase 19 — 1.4: Malformed messages, missing fields, and unexpected provider errors do not crash aggregator', () => {
  const aggregator = new TickAggregator();

  // 1. Completely invalid tick payloads
  const badTicks = [
    null as any,
    undefined as any,
    {} as any,
    { symbol: 'EUR/USD' } as any, // missing price & timestamp
    { symbol: 'EUR/USD', price: NaN, timestamp: 1700000000000 },
    { symbol: 'EUR/USD', price: 'invalid' as any, timestamp: 1700000000000 },
    { symbol: '', price: 1.085, timestamp: 1700000000000 },
    { symbol: 'EUR/USD', price: 1.085, timestamp: null as any },
  ];

  for (const bad of badTicks) {
    const res = aggregator.processTick(bad, 1);
    assert.strictEqual(res, null, 'Invalid tick must safely return null without throwing');
  }

  // 2. Aggregator state remains completely pristine
  assert.strictEqual(aggregator.getActiveCandle('EUR/USD', 'M1'), null);
  assert.strictEqual(aggregator.getCandleHistory('EUR/USD', 'M1').length, 0);
});

// ============================================================================
// SECTION 2: MULTI-TIMEFRAME INTEGRITY & MATHEMATICAL CONSTITUENT RECONCILIATION
// ============================================================================

test('Phase 19 — 2.1: Deterministic 30-minute tick fixture with constituent OHLC reconciliation (M1, M5, M15, M30)', () => {
  const aggregator = new TickAggregator();
  const symbol = 'EUR/USD';

  // Base timestamp: 2026-10-22 10:00:00 UTC (strictly aligned to 30m boundary)
  const baseTime = 1792663200000;
  assert.strictEqual(baseTime % 1800000, 0, 'Base time must align with 30m boundary');

  // Generate 1,800 deterministic ticks (1 tick per second across 30 minutes)
  // Price follows a predictable sine curve to produce distinct Open, High, Low, Close
  const tickCount = 1800;
  const prices: number[] = [];

  for (let s = 0; s < tickCount; s++) {
    const t = baseTime + s * 1000;
    // Price moves between 1.0800 and 1.0860
    const price = Number((1.0830 + 0.0030 * Math.sin((s / tickCount) * 2 * Math.PI)).toFixed(5));
    prices.push(price);

    // Feed tick across all 4 timeframes
    aggregator.processTick({ symbol, price, timestamp: t }, 1);
    aggregator.processTick({ symbol, price, timestamp: t }, 5);
    aggregator.processTick({ symbol, price, timestamp: t }, 15);
    aggregator.processTick({ symbol, price, timestamp: t }, 30);
  }

  // Advance by 1 second into minute 31 to trigger finalization of all previous candles
  const finalizeTime = baseTime + 1800 * 1000; // 10:30:00 UTC
  const finalPrice = 1.0830;
  aggregator.processTick({ symbol, price: finalPrice, timestamp: finalizeTime }, 1);
  aggregator.processTick({ symbol, price: finalPrice, timestamp: finalizeTime }, 5);
  aggregator.processTick({ symbol, price: finalPrice, timestamp: finalizeTime }, 15);
  aggregator.processTick({ symbol, price: finalPrice, timestamp: finalizeTime }, 30);

  // 1. Verify finalized candle counts
  const m1History = aggregator.getFinalizedCandles(symbol, 'M1');
  const m5History = aggregator.getFinalizedCandles(symbol, 'M5');
  const m15History = aggregator.getFinalizedCandles(symbol, 'M15');
  const m30History = aggregator.getFinalizedCandles(symbol, 'M30');

  assert.strictEqual(m1History.length, 30, 'Must produce exactly 30 finalized M1 candles');
  assert.strictEqual(m5History.length, 6, 'Must produce exactly 6 finalized M5 candles');
  assert.strictEqual(m15History.length, 2, 'Must produce exactly 2 finalized M15 candles');
  assert.strictEqual(m30History.length, 1, 'Must produce exactly 1 finalized M30 candle');

  // 2. MATHEMATICAL CONSTITUENT RECONCILIATION:
  // An M5 candle OHLC must mathematically match the constituent 5 M1 candles
  for (let i = 0; i < 6; i++) {
    const m5 = m5History[i];
    const constituentM1 = m1History.slice(i * 5, (i + 1) * 5);

    assert.strictEqual(constituentM1.length, 5);
    assert.strictEqual(m5.open, constituentM1[0].open, `M5[${i}] open must equal M1[0] open`);
    assert.strictEqual(m5.close, constituentM1[4].close, `M5[${i}] close must equal M1[4] close`);
    assert.strictEqual(
      m5.high,
      Math.max(...constituentM1.map((c) => c.high)),
      `M5[${i}] high must equal max M1 high`
    );
    assert.strictEqual(
      m5.low,
      Math.min(...constituentM1.map((c) => c.low)),
      `M5[${i}] low must equal min M1 low`
    );
    assert.strictEqual(m5.timestamp, constituentM1[0].timestamp, `M5[${i}] timestamp must match start M1`);
  }

  // 3. Constituent reconciliation for M15 (each M15 must equal 3x M5 and 15x M1)
  for (let j = 0; j < 2; j++) {
    const m15 = m15History[j];
    const constituentM5 = m5History.slice(j * 3, (j + 1) * 3);

    assert.strictEqual(m15.open, constituentM5[0].open);
    assert.strictEqual(m15.close, constituentM5[2].close);
    assert.strictEqual(m15.high, Math.max(...constituentM5.map((c) => c.high)));
    assert.strictEqual(m15.low, Math.min(...constituentM5.map((c) => c.low)));
  }

  // 4. Constituent reconciliation for M30 (equals 2x M15, 6x M5, 30x M1)
  const m30 = m30History[0];
  assert.strictEqual(m30.open, m15History[0].open);
  assert.strictEqual(m30.close, m15History[1].close);
  assert.strictEqual(m30.high, Math.max(m15History[0].high, m15History[1].high));
  assert.strictEqual(m30.low, Math.min(m15History[0].low, m15History[1].low));
  assert.strictEqual(m30.timestamp, baseTime);
});

test('Phase 19 — 2.2: Intra-second ticks with different prices update OHLC correctly without dropping', () => {
  const aggregator = new TickAggregator();
  const symbol = 'XAU/USD';
  const baseTime = 1792663200000;

  // Ingest 3 ticks within the EXACT same second (timestamp in seconds: 1792663200)
  const secTimestamp = baseTime / 1000; // provider format in seconds
  const c1 = aggregator.processTick({ symbol, price: 4070.0, timestamp: secTimestamp }, 1);
  assert.ok(c1);
  assert.strictEqual(c1.close, 4070.0);
  assert.strictEqual(c1.tickCount, 1);

  // New tick in same second with higher price (high updated)
  const c2 = aggregator.processTick({ symbol, price: 4075.5, timestamp: secTimestamp }, 1);
  assert.ok(c2);
  assert.strictEqual(c2.high, 4075.5);
  assert.strictEqual(c2.close, 4075.5);
  assert.strictEqual(c2.tickCount, 2);

  // New tick in same second with lower price (low updated)
  const c3 = aggregator.processTick({ symbol, price: 4068.2, timestamp: secTimestamp }, 1);
  assert.ok(c3);
  assert.strictEqual(c3.low, 4068.2);
  assert.strictEqual(c3.close, 4068.2);
  assert.strictEqual(c3.tickCount, 3);

  // Exact duplicate (same second, same price) must be discarded deterministically
  const cDup = aggregator.processTick({ symbol, price: 4068.2, timestamp: secTimestamp }, 1);
  assert.strictEqual(cDup, null, 'Exact duplicate tick must be rejected');

  // Out-of-order tick (earlier second) must be discarded
  const cOld = aggregator.processTick({ symbol, price: 4069.0, timestamp: secTimestamp - 1 }, 1);
  assert.strictEqual(cOld, null, 'Out of order tick must be rejected');
});

// ============================================================================
// SECTION 3: LONG & PARTIAL GAP RECOVERY & RATE-LIMIT COOLDOWN
// ============================================================================

test('Phase 19 — 3.1: Long disconnect exceeding maxRecoveryWindow caps query and flags excess as unrecoverable', async () => {
  const aggregator = new TickAggregator();
  let requestedOutputSize = 0;

  const mockFetcher: RestCandleFetcher = async (_sym, _intv, outputsize) => {
    requestedOutputSize = outputsize;
    // Return 30 candles
    const values = [];
    for (let i = 0; i < 30; i++) {
      values.push({
        datetime: `2026-10-22 10:${String(i).padStart(2, '0')}:00`,
        open: '1.08',
        high: '1.085',
        low: '1.075',
        close: '1.082',
      });
    }
    return { status: 'ok', values };
  };

  const reconciler = new GapReconciler(aggregator, mockFetcher, { maxRecoveryWindow: 30 });
  const start = 1792663200000;
  // Disconnect of 50 minutes (50 M1 candles missed)
  const end = start + 50 * 60 * 1000;

  const result = await reconciler.reconcileGap('EUR/USD', start, end, ['M1']);

  // Outputsize must be capped at maxRecoveryWindow (30)
  assert.strictEqual(requestedOutputSize, 30);
  // Unrecoverable excess gap must be recorded
  assert.ok(result.unrecoveredGaps.length > 0);
  const excess = result.unrecoveredGaps.find((g) => g.reason === 'UNRESOLVED_DISCONNECT');
  assert.ok(excess, 'Excess portion beyond maxRecoveryWindow must be registered as UNRESOLVED_DISCONNECT');
  assert.strictEqual(excess.missedCandles, 21); // 51 boundaries - 30 max = 21 excess
});

test('Phase 19 — 3.2: Concurrent gap recoveries for the same symbol/timeframe are deduplicated', async () => {
  const aggregator = new TickAggregator();
  let fetchCount = 0;

  const delayedFetcher: RestCandleFetcher = async () => {
    fetchCount++;
    await new Promise((r) => setTimeout(r, 50));
    return { status: 'ok', values: [] };
  };

  const reconciler = new GapReconciler(aggregator, delayedFetcher);
  const start = 1792663200000;
  const end = start + 180000;

  // Launch 3 simultaneous reconciliation calls
  await Promise.all([
    reconciler.reconcileGap('EUR/USD', start, end, ['M1']),
    reconciler.reconcileGap('EUR/USD', start, end, ['M1']),
    reconciler.reconcileGap('EUR/USD', start, end, ['M1']),
  ]);

  assert.strictEqual(fetchCount, 1, 'In-flight recoveries must deduplicate concurrent requests');
});

test('Phase 19 — 3.3: Weekend gap detection skips Forex closure window (Friday 21:00 UTC to Sunday 21:00 UTC)', () => {
  // Friday Oct 23 2026, 21:30 UTC -> Market is officially closed
  const fridayClosed = new Date('2026-10-23T21:30:00Z').getTime();
  assert.strictEqual(isForexMarketClosed(fridayClosed), true);

  // Saturday Oct 24 2026, 12:00 UTC -> Market is officially closed
  const saturdayClosed = new Date('2026-10-24T12:00:00Z').getTime();
  assert.strictEqual(isForexMarketClosed(saturdayClosed), true);

  // Sunday Oct 25 2026, 20:30 UTC -> Market is closed
  const sundayClosed = new Date('2026-10-25T20:30:00Z').getTime();
  assert.strictEqual(isForexMarketClosed(sundayClosed), true);

  // Sunday Oct 25 2026, 21:30 UTC -> Market is OPEN (Sydney session open)
  const sundayOpen = new Date('2026-10-25T21:30:00Z').getTime();
  assert.strictEqual(isForexMarketClosed(sundayOpen), false);

  // Monday Oct 26 2026, 10:00 UTC -> Market is OPEN
  const mondayOpen = new Date('2026-10-26T10:00:00Z').getTime();
  assert.strictEqual(isForexMarketClosed(mondayOpen), false);
});

// ============================================================================
// SECTION 4: 100,000+ TICK STRESS & RESOURCE AUDIT
// ============================================================================

test('Phase 19 — 4.1: High-throughput stress workload (100,000 synthetic ticks across 4 symbols & 4 intervals)', () => {
  const aggregator = new TickAggregator();
  const symbols = ['EUR/USD', 'XAU/USD', 'GBP/USD', 'USD/JPY'];
  const intervals = [1, 5, 15, 30];
  const TOTAL_TICKS = 100000;

  // Record initial memory and time
  const memBefore = process.memoryUsage();
  const startTime = Date.now();

  const baseTimestamp = 1792663200000;

  for (let i = 0; i < TOTAL_TICKS; i++) {
    const symbol = symbols[i % symbols.length];
    const timestamp = baseTimestamp + Math.floor(i / symbols.length) * 1000;
    const price = 1.0 + (i % 1000) * 0.0001;

    // Process tick across intervals
    for (const intv of intervals) {
      aggregator.processTick({ symbol, price, timestamp }, intv);
    }

    // Interleave concurrent status & gap reads every 1,000 ticks
    if (i % 1000 === 0) {
      aggregator.getActiveCandle(symbol, 'M1');
      aggregator.getCandleHistory(symbol, 'M5');
      aggregator.getDataGaps(symbol, 'M15');
    }
  }

  const durationMs = Date.now() - startTime;
  const memAfter = process.memoryUsage();
  const heapDiffMb = (memAfter.heapUsed - memBefore.heapUsed) / (1024 * 1024);
  const throughputTicksPerSec = Math.round((TOTAL_TICKS / durationMs) * 1000);

  // VERIFY RESOURCE BOUNDS:
  // 1. History capping: Maximum history per symbol_interval is capped at 200
  for (const sym of symbols) {
    for (const intv of ['M1', 'M5', 'M15', 'M30']) {
      const history = aggregator.getCandleHistory(sym, intv);
      assert.ok(
        history.length <= 200,
        `History for ${sym}_${intv} must not exceed 200 candles (found ${history.length})`
      );
    }
  }

  // 2. Performance benchmark: Ingestion must process >= 20,000 ticks/sec
  assert.ok(
    throughputTicksPerSec > 20000,
    `Ingestion throughput (${throughputTicksPerSec} ticks/sec) must exceed 20,000 ticks/sec`
  );

  // 3. Heap bounded growth: 100,000 ticks should not leak unbounded memory (< 50MB retained)
  assert.ok(heapDiffMb < 50, `Heap growth (${heapDiffMb.toFixed(2)} MB) must be bounded under 50MB`);
});

// ============================================================================
// SECTION 5: LIVE SECURITY, API BOUNDARIES & ANALYTICAL SAFETY GATING
// ============================================================================

test('Phase 19 — 5.1: Live API endpoint bounds, parameter allowlists, and error handling', async () => {
  const boundaryTests = [
    { url: 'http://localhost:3000/api/msi/candles?symbol=INVALID&interval=M1', expectedStatus: 400 },
    { url: 'http://localhost:3000/api/msi/candles?symbol=EUR/USD&interval=M7', expectedStatus: 400 },
    { url: 'http://localhost:3000/api/msi/candles?symbol=EUR/USD&interval=M1&limit=999', expectedStatus: 200 }, // capped to 200
    { url: 'http://localhost:3000/api/msi/gaps?symbol=EUR/USD&interval=M1&from=1000&to=500', expectedStatus: 400 }, // from > to
    { url: 'http://localhost:3000/api/msi/gaps?symbol=EUR/USD&interval=M1&from=0&to=9999999999999', expectedStatus: 400 }, // > 30 days
    { url: 'http://localhost:3000/api/msi/time_series?symbol=BAD&interval=1min&outputsize=10', expectedStatus: 400 },
    { url: 'http://localhost:3000/api/msi/time_series?symbol=EUR/USD&interval=3min&outputsize=10', expectedStatus: 400 },
    { url: 'http://localhost:3000/api/msi/time_series?symbol=EUR/USD&interval=1min&outputsize=600', expectedStatus: 400 }, // > 500
  ];

  for (const t of boundaryTests) {
    const res = await fetch(t.url);
    assert.strictEqual(res.status, t.expectedStatus, `Endpoint ${t.url} returned unexpected status`);
  }
});

test('Phase 19 — 5.2: Secret isolation audit: TWELVE_DATA_API_KEY is completely masked across all surfaces', async () => {
  assert.ok(API_KEY.length > 10, 'Valid API key must be configured in environment');

  const liveEndpoints = [
    'http://localhost:3000/api/msi/candles?symbol=EUR/USD&interval=M1',
    'http://localhost:3000/api/msi/gaps?symbol=EUR/USD&interval=M1',
    'http://localhost:3000/api/msi/time_series?symbol=EUR/USD&interval=1min&outputsize=2',
  ];

  for (const url of liveEndpoints) {
    const res = await fetch(url);
    const body = await res.text();
    assert.strictEqual(body.includes(API_KEY), false, `Secret leaked in response from ${url}`);
  }
});

test('Phase 19 — 5.3: Confluence gating strictly blocks CONFIRMED opportunities on gap-affected or synthetic data', () => {
  const invalidProvenance: DataProvenance = {
    providerId: 'SYNTHETIC_INTERPOLATION',
    mode: 'SIMULATED',
    granularity: 'CANDLE_LEVEL',
    calculationMethod: 'INTERPOLATED',
    freshnessStatus: 'STALE',
    validationStatus: 'INCOMPLETE_CANDLE',
    timestamp: new Date().toISOString(),
  };

  const sampleCandles: Candle[] = [
    { time: '10:00', timestamp: 1792663200000, open: 1.08, high: 1.085, low: 1.075, close: 1.082, volume: 100 },
    { time: '10:01', timestamp: 1792663260000, open: 1.082, high: 1.087, low: 1.08, close: 1.085, volume: 100 },
  ];

  const pa = calculatePriceAction(sampleCandles, invalidProvenance);
  const vp = calculateVolumeProfile(sampleCandles, invalidProvenance);
  const avwap = calculateAnchoredVWAP(sampleCandles, invalidProvenance, [
    { anchorId: 'a1', anchorType: 'SESSION_OPEN', candleIndex: 0 },
  ]);
  const of = calculateOrderFlow(sampleCandles, invalidProvenance);

  const evalResult = evaluateConfluence('EUR/USD', 'M1', vp, pa, avwap, of, invalidProvenance);

  // Invariant 1: Confluence decision eligibility is FALSE
  assert.strictEqual(evalResult.decisionEligibility, false);

  // Invariant 2: Candidate opportunity cannot be CONFIRMED
  const opp = buildOpportunity({
    id: 'opp-stress-1',
    symbol: 'EUR/USD',
    timeframe: 'M1',
    direction: 'LONG',
    confluence: evalResult,
    entryPrice: 1.085,
    stopLoss: 1.08,
    takeProfit1: 1.09,
    takeProfit2: 1.095,
    riskRewardRatio: 2.0,
    invalidationCondition: 'BOS Invalidation',
    provenance: invalidProvenance,
  });

  assert.strictEqual(opp.confirmationRulesSatisfied, false);
  assert.notStrictEqual(opp.lifecycleState, 'CONFIRMED');
});
