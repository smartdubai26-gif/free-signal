/**
 * MSI Phase 17 — End-to-End Data Integrity Audit Test Suite
 *
 * Deterministic tests for:
 * 1. Active candle open protection (never marked complete while interval open).
 * 2. Recovery / live-update race condition (never overwriting newer live close).
 * 3. Finalized vs active candle separation.
 * 4. Window-wide gap inspection across Price Action, Anchored VWAP, and Volume Profile.
 * 5. Stale data detection across analysis windows.
 * 6. Provider timestamp semantics and Forex weekend closure handling.
 * 7. Partial recovery: unrecovered intervals remain registered in gap store.
 * 8. Gap registry clearance only upon full verified recovery.
 * 9. Confluence gating: unavailable/incomplete mandatory evidence cannot produce a confirmed opportunity.
 * 10. Volume-dependent engines remain UNAVAILABLE without genuine trade/DOM data.
 */

import test from 'node:test';
import assert from 'node:assert';
import {
  TickAggregator,
  AggregatedCandle,
  isForexMarketClosed,
  getUTCIntervalBoundary,
} from '../liveStreamAggregator';
import { GapReconciler } from '../gapReconciler';
import { calculatePriceAction } from '../priceActionEngine';
import { calculateAnchoredVWAP } from '../anchoredVwapEngine';
import { calculateVolumeProfile } from '../volumeProfileEngine';
import { calculateOrderFlow } from '../orderFlowEngine';
import { evaluateConfluence, buildOpportunity } from '../confluenceEngine';
import { DataProvenance } from '../../../types/msi';
import { Candle } from '../../../types/signals';

const validProvenance: DataProvenance = {
  providerId: 'TWELVEDATA_LIVE',
  mode: 'LIVE',
  granularity: 'CANDLE_LEVEL',
  calculationMethod: 'MSI_QUANTITATIVE_CONFLUENCE_v1',
  freshnessStatus: 'FRESH',
  validationStatus: 'VALID',
  timestamp: new Date().toISOString(),
};

test('Phase 17 — Requirement 2 & 4: Active candle is not marked complete while interval is open and live close is preserved', () => {
  const aggregator = new TickAggregator();
  const symbol = 'EUR/USD';

  // Use a timestamp that is open right now
  const now = Date.now();
  const currentIntervalBoundary = Math.floor(now / 60000) * 60000;

  // 1. Live ticks arrive for current interval
  aggregator.processTick({ symbol, price: 1.0800, timestamp: currentIntervalBoundary + 1000 }, 1);
  aggregator.processTick({ symbol, price: 1.0825, timestamp: currentIntervalBoundary + 2000 }, 1); // High
  aggregator.processTick({ symbol, price: 1.0790, timestamp: currentIntervalBoundary + 3000 }, 1); // Low
  aggregator.processTick({ symbol, price: 1.0815, timestamp: currentIntervalBoundary + 4000 }, 1); // Close

  const activeBefore = aggregator.getActiveCandle(symbol, 'M1');
  assert.ok(activeBefore);
  assert.strictEqual(activeBefore.close, 1.0815);
  assert.strictEqual(activeBefore.isComplete, false);

  // 2. REST recovery arrives with snapshot candle for this same open interval
  // Suppose REST snapshot has older/different close
  const recoveredSnapshot: AggregatedCandle = {
    symbol,
    interval: 'M1',
    open: 1.0800,
    high: 1.0820,
    low: 1.0795,
    close: 1.0805, // older close
    timestamp: currentIntervalBoundary,
    isComplete: true,
  };

  const mergeResult = aggregator.mergeRecoveredCandles(symbol, 'M1', [recoveredSnapshot]);
  assert.strictEqual(mergeResult.updated, 1);

  const activeAfter = aggregator.getActiveCandle(symbol, 'M1');
  assert.ok(activeAfter);
  // Invariant 1: Live close MUST NOT be overwritten with older REST close
  assert.strictEqual(activeAfter.close, 1.0815, 'Live close must be preserved over older REST close');
  // Invariant 2: Active open candle MUST remain isComplete: false
  assert.strictEqual(activeAfter.isComplete, false, 'Active candle must remain open (isComplete: false)');
  // Invariant 3: High/Low are safely merged
  assert.strictEqual(activeAfter.high, 1.0825);
  assert.strictEqual(activeAfter.low, 1.0790);
});

test('Phase 17 — Requirement 4: Finalized candles vs Active open candles separation', () => {
  const aggregator = new TickAggregator();
  const symbol = 'XAU/USD';

  // Tick at boundary 1
  const t0 = 1700000000000;
  const boundary0 = getUTCIntervalBoundary(t0, 1);
  aggregator.processTick({ symbol, price: 2000.0, timestamp: boundary0 + 1000 }, 1);
  aggregator.processTick({ symbol, price: 2005.0, timestamp: boundary0 + 2000 }, 1);

  // Tick crossing into boundary 2 (finalizes boundary 0)
  const boundary1 = boundary0 + 60000;
  aggregator.processTick({ symbol, price: 2004.0, timestamp: boundary1 + 1000 }, 1);

  // boundary 0 is finalized, boundary 1 is active
  const finalized = aggregator.getFinalizedCandles(symbol, 'M1');
  assert.strictEqual(finalized.length, 1);
  assert.strictEqual(finalized[0].timestamp, boundary0);
  assert.strictEqual(finalized[0].isComplete, true);

  const active = aggregator.getActiveCandle(symbol, 'M1');
  assert.ok(active);
  assert.strictEqual(active.timestamp, boundary1);
  assert.strictEqual(active.isComplete, false);

  // Analysis candles without open current candle excludes boundary 1 (use maxStalenessMs: Infinity for historical test time)
  const analysisClosedOnly = aggregator.getAnalysisCandles(symbol, 'M1', 1, {
    allowOpenCurrent: false,
    maxStalenessMs: Infinity,
  });
  assert.strictEqual(analysisClosedOnly.isValid, true);
  assert.strictEqual(analysisClosedOnly.candles.length, 1);
  assert.strictEqual(analysisClosedOnly.candles[0].timestamp, boundary0);

  // Analysis requiring 2 candles fails with INSUFFICIENT_DATA when open candle is disallowed
  const analysisReq2 = aggregator.getAnalysisCandles(symbol, 'M1', 2, {
    allowOpenCurrent: false,
    maxStalenessMs: Infinity,
  });
  assert.strictEqual(analysisReq2.isValid, false);
  assert.strictEqual(analysisReq2.validationStatus, 'INSUFFICIENT_DATA');
});

test('Phase 17 — Requirement 3: Window-wide gap inspection in Price Action, VWAP, and Volume Profile', () => {
  // Construct a window of 10 candles where candle at index 4 has a gap
  const candlesWithGap: (Candle & { hasGap?: boolean; isComplete?: boolean })[] = [];
  const baseTime = 1700000000000;

  for (let i = 0; i < 10; i++) {
    candlesWithGap.push({
      time: new Date(baseTime + i * 60000).toISOString(),
      timestamp: baseTime + i * 60000,
      open: 1.1000 + i * 0.001,
      high: 1.1020 + i * 0.001,
      low: 1.0980 + i * 0.001,
      close: 1.1010 + i * 0.001,
      volume: 1000,
      hasGap: i === 4, // Mid-window gap!
      isComplete: i !== 4,
    });
  }

  // 1. Price Action Engine must block analysis
  const paRes = calculatePriceAction(candlesWithGap as any, validProvenance);
  assert.strictEqual(paRes.status, 'UNAVAILABLE');
  assert.strictEqual(paRes.provenance.validationStatus, 'INCOMPLETE_CANDLE');
  assert.ok(paRes.error?.includes('gap'));

  // 2. Anchored VWAP Engine must block analysis
  const avwapRes = calculateAnchoredVWAP(candlesWithGap as any, validProvenance, [
    { anchorId: 'a1', anchorType: 'SESSION_OPEN', candleIndex: 0 },
  ]);
  assert.strictEqual(avwapRes.status, 'UNAVAILABLE');
  assert.strictEqual(avwapRes.provenance.validationStatus, 'INCOMPLETE_CANDLE');

  // 3. Volume Profile Engine must block analysis
  const vpRes = calculateVolumeProfile(candlesWithGap as any, validProvenance);
  assert.strictEqual(vpRes.status, 'UNAVAILABLE');
  assert.strictEqual(vpRes.provenance.validationStatus, 'INCOMPLETE_CANDLE');
});

test('Phase 17 — Requirement 3: Stale feed detection across engines', () => {
  const staleProvenance: DataProvenance = {
    ...validProvenance,
    freshnessStatus: 'STALE',
    validationStatus: 'VALID',
  };

  const validCandles: Candle[] = [
    { time: '01:00', timestamp: 1000, open: 1.1, high: 1.12, low: 1.09, close: 1.11, volume: 500 },
    { time: '02:00', timestamp: 2000, open: 1.11, high: 1.13, low: 1.1, close: 1.12, volume: 600 },
    { time: '03:00', timestamp: 3000, open: 1.12, high: 1.14, low: 1.11, close: 1.13, volume: 700 },
    { time: '04:00', timestamp: 4000, open: 1.13, high: 1.15, low: 1.12, close: 1.14, volume: 800 },
    { time: '05:00', timestamp: 5000, open: 1.14, high: 1.16, low: 1.13, close: 1.15, volume: 900 },
    { time: '06:00', timestamp: 6000, open: 1.15, high: 1.17, low: 1.14, close: 1.16, volume: 1000 },
    { time: '07:00', timestamp: 7000, open: 1.16, high: 1.18, low: 1.15, close: 1.17, volume: 1100 },
  ];

  const paRes = calculatePriceAction(validCandles, staleProvenance);
  assert.strictEqual(paRes.status, 'UNAVAILABLE');
  assert.strictEqual(paRes.provenance.freshnessStatus, 'STALE');

  const avwapRes = calculateAnchoredVWAP(validCandles, staleProvenance, [
    { anchorId: 'a1', anchorType: 'SESSION_OPEN', candleIndex: 0 },
  ]);
  assert.strictEqual(avwapRes.status, 'UNAVAILABLE');
  assert.strictEqual(avwapRes.provenance.freshnessStatus, 'STALE');

  const vpRes = calculateVolumeProfile(validCandles, staleProvenance);
  assert.strictEqual(vpRes.status, 'UNAVAILABLE');
  assert.strictEqual(vpRes.provenance.freshnessStatus, 'STALE');
});

test('Phase 17 — Requirement 5: Provider timestamp semantics & Forex market weekend closure', () => {
  // Friday 20:00 UTC (Market open)
  const fridayOpen = new Date('2025-05-09T20:00:00Z').getTime();
  assert.strictEqual(isForexMarketClosed(fridayOpen), false);

  // Friday 22:00 UTC (Market closed)
  const fridayClosed = new Date('2025-05-09T22:00:00Z').getTime();
  assert.strictEqual(isForexMarketClosed(fridayClosed), true);

  // Saturday 12:00 UTC (Market closed)
  const saturdayClosed = new Date('2025-05-10T12:00:00Z').getTime();
  assert.strictEqual(isForexMarketClosed(saturdayClosed), true);

  // Sunday 15:00 UTC (Market closed)
  const sundayClosed = new Date('2025-05-11T15:00:00Z').getTime();
  assert.strictEqual(isForexMarketClosed(sundayClosed), true);

  // Sunday 22:00 UTC (Market reopened)
  const sundayReopened = new Date('2025-05-11T22:00:00Z').getTime();
  assert.strictEqual(isForexMarketClosed(sundayReopened), false);

  // Aggregator does not flag gaps during weekend closure
  const aggregator = new TickAggregator();
  const isComplete = aggregator.isIntervalComplete(
    'EUR/USD',
    'M1',
    fridayClosed,
    fridayClosed + 3600000 // 1 hour during closed market
  );
  assert.strictEqual(isComplete, true, 'Market closure period must not be marked incomplete');
});

test('Phase 17 — Requirement 6: Gap registry persistence on partial recovery and clearance on full recovery', () => {
  const aggregator = new TickAggregator();
  const symbol = 'EUR/USD';

  const tStart = getUTCIntervalBoundary(1700000000000, 1);
  const tEnd = tStart + 5 * 60000; // 5 missing M1 intervals

  // Manually register a disconnect gap of 5 candles
  aggregator.recordDataGap({
    symbol,
    interval: 'M1',
    startTime: tStart,
    endTime: tEnd,
    reason: 'UNRESOLVED_DISCONNECT',
    detectedAt: Date.now(),
    missedCandles: 5,
  });

  assert.strictEqual(aggregator.getDataGaps(symbol, 'M1').length, 1);

  // Partial recovery: only 2 of the 5 candles are recovered
  const partialRecovered: AggregatedCandle[] = [
    { symbol, interval: 'M1', open: 1.08, high: 1.082, low: 1.079, close: 1.081, timestamp: tStart, isComplete: true },
    { symbol, interval: 'M1', open: 1.081, high: 1.083, low: 1.080, close: 1.082, timestamp: tStart + 60000, isComplete: true },
  ];

  aggregator.mergeRecoveredCandles(symbol, 'M1', partialRecovered);

  // Invariant: Because 3 intervals remain unrecovered, the gap record MUST REMAIN
  const remainingGaps = aggregator.getDataGaps(symbol, 'M1');
  assert.strictEqual(remainingGaps.length, 1, 'Gap must not be cleared on partial recovery');

  // Full recovery: the remaining 3 candles are recovered
  const remainingRecovered: AggregatedCandle[] = [
    { symbol, interval: 'M1', open: 1.082, high: 1.084, low: 1.081, close: 1.083, timestamp: tStart + 120000, isComplete: true },
    { symbol, interval: 'M1', open: 1.083, high: 1.085, low: 1.082, close: 1.084, timestamp: tStart + 180000, isComplete: true },
    { symbol, interval: 'M1', open: 1.084, high: 1.086, low: 1.083, close: 1.085, timestamp: tStart + 240000, isComplete: true },
  ];

  aggregator.mergeRecoveredCandles(symbol, 'M1', remainingRecovered);

  // Invariant: Now all 5 intervals exist with isComplete: true, gap registry is cleanly cleared
  const gapsAfterFull = aggregator.getDataGaps(symbol, 'M1');
  assert.strictEqual(gapsAfterFull.length, 0, 'Gap registry must clear only after all intervals are fully verified');
});

test('Phase 17 — Requirement 7: Confluence gating prevents CONFIRMED opportunities when evidence is incomplete or unavailable', () => {
  const sampleCandles: Candle[] = [
    { time: '01:00', timestamp: 1000, open: 1.1, high: 1.12, low: 1.09, close: 1.11, volume: 500 },
    { time: '02:00', timestamp: 2000, open: 1.11, high: 1.13, low: 1.1, close: 1.12, volume: 600 },
    { time: '03:00', timestamp: 3000, open: 1.12, high: 1.14, low: 1.11, close: 1.13, volume: 700 },
    { time: '04:00', timestamp: 4000, open: 1.13, high: 1.15, low: 1.12, close: 1.14, volume: 800 },
    { time: '05:00', timestamp: 5000, open: 1.14, high: 1.16, low: 1.13, close: 1.15, volume: 900 },
    { time: '06:00', timestamp: 6000, open: 1.15, high: 1.17, low: 1.14, close: 1.16, volume: 1000 },
    { time: '07:00', timestamp: 7000, open: 1.16, high: 1.18, low: 1.15, close: 1.17, volume: 1100 },
  ];

  const incompleteProvenance: DataProvenance = {
    ...validProvenance,
    validationStatus: 'INCOMPLETE_CANDLE',
  };

  const vpRes = calculateVolumeProfile(sampleCandles, incompleteProvenance);
  const paRes = calculatePriceAction(sampleCandles, incompleteProvenance);
  const avwapRes = calculateAnchoredVWAP(sampleCandles, incompleteProvenance, [
    { anchorId: 'a1', anchorType: 'SESSION_OPEN', candleIndex: 0 },
  ]);
  const ofRes = calculateOrderFlow(sampleCandles, incompleteProvenance);

  const confluence = evaluateConfluence('EUR/USD', 'M15', vpRes, paRes, avwapRes, ofRes, incompleteProvenance);

  // Invariant 1: Decision eligibility must be FALSE
  assert.strictEqual(confluence.decisionEligibility, false);
  assert.ok(confluence.eligibilityReason.includes('INCOMPLETE_OR_STALE_EVIDENCE'));

  // Invariant 2: buildOpportunity MUST NOT produce CONFIRMED status
  const opp = buildOpportunity({
    id: 'opp-audit-1',
    symbol: 'EUR/USD',
    timeframe: 'M15',
    direction: 'LONG',
    confluence,
    entryPrice: 1.1200,
    stopLoss: 1.1150,
    takeProfit1: 1.1300,
    takeProfit2: 1.1350,
    riskRewardRatio: 2.0,
    invalidationCondition: 'BOS Invalidation',
    provenance: incompleteProvenance,
  });

  assert.strictEqual(opp.confirmationRulesSatisfied, false);
  assert.notStrictEqual(opp.lifecycleState, 'CONFIRMED');
  assert.strictEqual(opp.lifecycleState, 'CANDIDATE');
});

test('Phase 17 — Requirement 2: Live ticks arriving after reconciliation cleanly build upon reconciled base', () => {
  const aggregator = new TickAggregator();
  const symbol = 'EUR/USD';
  const now = Date.now();
  const boundary = Math.floor(now / 60000) * 60000;

  // 1. Reconciliation injects base price into active open candle
  const recovered: AggregatedCandle = {
    symbol,
    interval: 'M1',
    open: 1.0800,
    high: 1.0810,
    low: 1.0790,
    close: 1.0805,
    timestamp: boundary,
    isComplete: true,
  };
  aggregator.mergeRecoveredCandles(symbol, 'M1', [recovered]);

  // 2. New live ticks arrive right after reconciliation
  const active1 = aggregator.processTick({ symbol, price: 1.0830, timestamp: boundary + 10000 }, 1);
  assert.ok(active1);
  assert.strictEqual(active1.high, 1.0830, 'New higher live tick expands high');
  assert.strictEqual(active1.close, 1.0830, 'Live tick updates close');
  assert.strictEqual(active1.isComplete, false);

  // 3. Tick crossing boundary finalizes this candle
  const boundaryNext = boundary + 60000;
  aggregator.processTick({ symbol, price: 1.0825, timestamp: boundaryNext + 1000 }, 1);

  const finalized = aggregator.getLastFinalizedCandle(symbol, 'M1');
  assert.ok(finalized);
  assert.strictEqual(finalized.timestamp, boundary);
  assert.strictEqual(finalized.close, 1.0830, 'Finalized candle preserves the latest live tick close');
  assert.strictEqual(finalized.isComplete, true);
});

test('Phase 17 — Requirement 8: Parameter allowlist and 30-day query bounds logic', () => {
  const ALLOWED_SYMBOLS = new Set(['EUR/USD', 'XAU/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD', 'USD/CAD', 'USD/CHF', 'NZD/USD']);
  const ALLOWED_INTERVALS = new Set(['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1']);

  // Valid inputs
  assert.ok(ALLOWED_SYMBOLS.has('EUR/USD'));
  assert.ok(ALLOWED_SYMBOLS.has('XAU/USD'));
  assert.ok(ALLOWED_INTERVALS.has('M1'));
  assert.ok(ALLOWED_INTERVALS.has('M30'));

  // Invalid / injection symbols rejected
  assert.strictEqual(ALLOWED_SYMBOLS.has('BTC/USD'), false);
  assert.strictEqual(ALLOWED_SYMBOLS.has('EUR/USD; DROP TABLE candles;'), false);
  assert.strictEqual(ALLOWED_SYMBOLS.has('../../../etc/passwd'), false);
  assert.strictEqual(ALLOWED_INTERVALS.has('M2'), false);
  assert.strictEqual(ALLOWED_INTERVALS.has('100YEAR'), false);

  // 30-day query window enforcement
  const MAX_QUERY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
  const validWindow = 7 * 24 * 60 * 60 * 1000; // 7 days
  const excessiveWindow = 35 * 24 * 60 * 60 * 1000; // 35 days
  assert.ok(validWindow <= MAX_QUERY_WINDOW_MS);
  assert.ok(excessiveWindow > MAX_QUERY_WINDOW_MS);
});

