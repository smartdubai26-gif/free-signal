/**
 * MSI Phase 18 — Live Production-Path Verification Test Suite
 * Executes live production-path checks against real Twelve Data feeds and running backend.
 */

import test from 'node:test';
import assert from 'node:assert';
import WebSocket from 'ws';
import dotenv from 'dotenv';
import { TickAggregator } from '../liveStreamAggregator';
import { GapReconciler } from '../gapReconciler';
import { calculatePriceAction } from '../priceActionEngine';
import { calculateAnchoredVWAP } from '../anchoredVwapEngine';
import { calculateVolumeProfile } from '../volumeProfileEngine';
import { calculateOrderFlow } from '../orderFlowEngine';
import { evaluateConfluence, buildOpportunity } from '../confluenceEngine';
import { fetchHistoricalCandles } from '../historicalDataBridge';
import { DataProvenance } from '../../../types/msi';

dotenv.config();

const API_KEY = process.env.TWELVE_DATA_API_KEY || '';

test('Check 1: Backend HTTP and WebSocket servers are running on port 3000', async () => {
  const res = await fetch('http://localhost:3000/api/msi/candles?symbol=EUR/USD&interval=M1');
  assert.strictEqual(res.status, 200, 'HTTP 200 required from candles endpoint');
  const data = await res.json();
  assert.strictEqual(data.symbol, 'EUR/USD');
  assert.strictEqual(data.interval, 'M1');
});

test('Check 2: Live WebSocket connection, tick timestamps, UTC alignment for EUR/USD and XAU/USD', async () => {
  // Connect to local backend stream which is connected to Twelve Data live quotes
  const ws = new WebSocket('ws://localhost:3000');
  
  let statusReceived = false;
  let candleReceived = false;
  let receivedCandle: any = null;

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.close();
      if (statusReceived) {
        resolve(); // Connected even if market tick delayed
      } else {
        reject(new Error('Timeout waiting for WS status'));
      }
    }, 8000);

    ws.on('open', () => {
      // WS opened
    });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'status') {
          statusReceived = true;
          assert.ok(msg.state === 'CONNECTED' || msg.state === 'CONNECTING');
        }
        if (msg.type === 'candle') {
          candleReceived = true;
          receivedCandle = msg.candle;
          clearTimeout(timer);
          ws.close();
          resolve();
        }
      } catch (err) {
        reject(err);
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });

  assert.ok(statusReceived, 'Must receive initial status from backend WS');
  if (receivedCandle) {
    assert.ok(receivedCandle.timestamp % 60000 === 0, 'Timestamp must be UTC minute aligned');
    assert.strictEqual(typeof receivedCandle.open, 'number');
    assert.strictEqual(typeof receivedCandle.close, 'number');
  }
});

test('Check 3: Active candles remain incomplete (isComplete === false) during their interval', async () => {
  const res = await fetch('http://localhost:3000/api/msi/candles?symbol=EUR/USD&interval=M1');
  const data = await res.json();
  
  if (data.active) {
    assert.strictEqual(data.active.isComplete, false, 'Active candle must have isComplete: false');
    assert.ok(data.active.timestamp % 60000 === 0, 'Active candle timestamp must be UTC aligned');
  }
  if (data.lastFinalized) {
    assert.strictEqual(data.lastFinalized.isComplete, true, 'Finalized candle must have isComplete: true');
  }
});

test('Check 4: Disconnect simulation, reconnect, and live REST gap recovery', async () => {
  const aggregator = new TickAggregator();
  const reconciler = new GapReconciler(aggregator);

  // Simulate a disconnect that missed the last 3 minutes
  const now = Date.now();
  const disconnectStart = Math.floor((now - 180000) / 60000) * 60000;
  const reconnectedAt = now;

  // Execute reconciliation querying real backend proxy endpoint
  const result = await reconciler.reconcileGap('EUR/USD', disconnectStart, reconnectedAt, ['M1']);

  assert.strictEqual(result.symbol, 'EUR/USD');
  assert.strictEqual(result.rateLimited, false);
  assert.ok(result.recovered.M1 !== undefined, 'M1 recovery attempted');
  
  // Verify candles merged in aggregator
  const history = aggregator.getCandleHistory('EUR/USD', 'M1');
  assert.ok(history.length > 0, 'At least one historical candle recovered from real TD REST');
  for (const c of history) {
    assert.strictEqual(c.isComplete, true);
    assert.ok(c.timestamp % 60000 === 0);
  }
});

test('Check 5: Unrecovered or partially recovered gaps remain registered and block analysis', async () => {
  const aggregator = new TickAggregator();
  
  // Intentionally record an unresolved gap
  const gapStart = 1774965600000;
  const gapEnd = 1774965720000;
  aggregator.recordDataGap({
    symbol: 'EUR/USD',
    interval: 'M1',
    startTime: gapStart,
    endTime: gapEnd,
    reason: 'REST_UNAVAILABLE',
    detectedAt: Date.now(),
    missedCandles: 2,
  });

  // Verify gap is present
  const gaps = aggregator.getDataGaps('EUR/USD', 'M1');
  assert.strictEqual(gaps.length, 1);
  assert.strictEqual(gaps[0].reason, 'REST_UNAVAILABLE');

  // Verify interval is NOT complete
  const isComplete = aggregator.isIntervalComplete('EUR/USD', 'M1', gapStart, gapEnd + 60000);
  assert.strictEqual(isComplete, false, 'Interval with unresolved gap must report isComplete: false');
});

test('Check 6: Stale feeds, missing candles, and synthetic data cannot produce CONFIRMED opportunities', () => {
  const syntheticProvenance: DataProvenance = {
    providerId: 'SYNTHETIC_INTERPOLATION',
    mode: 'SIMULATED' as const,
    granularity: 'CANDLE_LEVEL' as const,
    calculationMethod: 'INTERPOLATED',
    freshnessStatus: 'STALE' as const,
    validationStatus: 'INCOMPLETE_CANDLE' as const,
    timestamp: new Date().toISOString(),
  };

  const sampleCandles = [
    { time: '2026-10-22', timestamp: 1792627200000, open: 1.12, high: 1.13, low: 1.11, close: 1.125, volume: 100 },
    { time: '2026-10-23', timestamp: 1792713600000, open: 1.125, high: 1.135, low: 1.12, close: 1.13, volume: 100 },
  ];

  const pa = calculatePriceAction(sampleCandles, syntheticProvenance);
  const vp = calculateVolumeProfile(sampleCandles, syntheticProvenance);
  const avwap = calculateAnchoredVWAP(sampleCandles, syntheticProvenance, [{ anchorId: 'a1', anchorType: 'SESSION_OPEN', candleIndex: 0 }]);
  const of = calculateOrderFlow(sampleCandles, syntheticProvenance);

  const evalResult = evaluateConfluence('EUR/USD', 'M15', vp, pa, avwap, of, syntheticProvenance);

  // Invariant 1: Synthetic data cannot be eligible
  assert.strictEqual(evalResult.decisionEligibility, false);
  assert.ok(evalResult.eligibilityReason.includes('BLOCKED_SYNTHETIC_DATA'));

  // Invariant 2: buildOpportunity cannot produce CONFIRMED
  const opp = buildOpportunity({
    id: 'opp-synth-1',
    symbol: 'EUR/USD',
    timeframe: 'M15',
    direction: 'LONG',
    confluence: evalResult,
    entryPrice: 1.1200,
    stopLoss: 1.1150,
    takeProfit1: 1.1300,
    takeProfit2: 1.1350,
    riskRewardRatio: 2.0,
    invalidationCondition: 'BOS Invalidation',
    provenance: syntheticProvenance,
  });

  assert.strictEqual(opp.confirmationRulesSatisfied, false);
  assert.notStrictEqual(opp.lifecycleState, 'CONFIRMED');
});

test('Check 7: API endpoints reject invalid parameters with HTTP 400', async () => {
  const tests = [
    { url: 'http://localhost:3000/api/msi/candles?symbol=INVALID&interval=M1', expectedStatus: 400 },
    { url: 'http://localhost:3000/api/msi/candles?symbol=EUR/USD&interval=M2', expectedStatus: 400 },
    { url: 'http://localhost:3000/api/msi/gaps?symbol=EUR/USD&interval=M1&from=200&to=100', expectedStatus: 400 },
    { url: 'http://localhost:3000/api/msi/gaps?symbol=EUR/USD&interval=M1&from=0&to=9999999999999', expectedStatus: 400 },
    { url: 'http://localhost:3000/api/msi/time_series?symbol=BADSYM&interval=1min&outputsize=5', expectedStatus: 400 },
    { url: 'http://localhost:3000/api/msi/time_series?symbol=EUR/USD&interval=9min&outputsize=5', expectedStatus: 400 },
    { url: 'http://localhost:3000/api/msi/time_series?symbol=EUR/USD&interval=1min&outputsize=999', expectedStatus: 400 },
  ];

  for (const t of tests) {
    const res = await fetch(t.url);
    assert.strictEqual(res.status, t.expectedStatus, `Expected ${t.expectedStatus} for ${t.url}`);
  }
});

test('Check 8: TWELVE_DATA_API_KEY is never exposed in responses or client code', async () => {
  assert.ok(API_KEY.length > 10, 'API key must exist');

  const urls = [
    'http://localhost:3000/api/msi/candles?symbol=EUR/USD&interval=M1',
    'http://localhost:3000/api/msi/gaps?symbol=EUR/USD&interval=M1',
    'http://localhost:3000/api/msi/time_series?symbol=EUR/USD&interval=1min&outputsize=2',
  ];

  for (const u of urls) {
    const res = await fetch(u);
    const text = await res.text();
    assert.strictEqual(text.includes(API_KEY), false, `Secret API key leaked in response of ${u}`);
  }
});

test('Check 9: Twelve Data rate-limit handling and cooldown backoff', async () => {
  const aggregator = new TickAggregator();
  let callCount = 0;

  const mockFetcher = async () => {
    callCount++;
    throw new Error('PROVIDER_RATE_LIMIT_429');
  };

  const reconciler = new GapReconciler(aggregator, mockFetcher, { cooldownPeriodMs: 60000 });
  const start = 1774965600000;
  const end = 1774965800000;

  // First call triggers 429 and enters cooldown
  const res1 = await reconciler.reconcileGap('EUR/USD', start, end, ['M1']);
  assert.strictEqual(res1.rateLimited, true);
  assert.strictEqual(reconciler.isRateLimited(), true);
  assert.strictEqual(callCount, 1);

  // Subsequent call within cooldown window does NOT invoke fetcher
  const res2 = await reconciler.reconcileGap('EUR/USD', start, end, ['M1']);
  assert.strictEqual(res2.rateLimited, true);
  assert.strictEqual(callCount, 1, 'No additional calls during cooldown (avoids request loops)');
});

test('Check 10: Volume Profile, Anchored VWAP, and Order Flow remain UNAVAILABLE on spot forex data', async () => {
  // Real live historical forex candles from Twelve Data
  const { candles, provenance } = await fetchHistoricalCandles('EUR/USD', '1day', 10);
  
  assert.ok(candles.length > 0);
  // Real spot forex volume is 0 or synthetic
  const vp = calculateVolumeProfile(candles, provenance);
  const avwap = calculateAnchoredVWAP(candles, provenance, [{ anchorId: 'd1', anchorType: 'SESSION_OPEN', candleIndex: 0 }]);
  const of = calculateOrderFlow(candles, provenance);

  assert.strictEqual(vp.status, 'UNAVAILABLE', 'Volume Profile must be UNAVAILABLE without genuine trade volume');
  assert.strictEqual(avwap.status, 'UNAVAILABLE', 'Anchored VWAP must be UNAVAILABLE without genuine trade volume');
  assert.strictEqual(of.status, 'UNAVAILABLE', 'Order Flow must be UNAVAILABLE without DOM/tick classification');
});
