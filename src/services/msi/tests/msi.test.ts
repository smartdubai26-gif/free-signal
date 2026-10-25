/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert';
import { calculateVolumeProfile } from '../volumeProfileEngine';
import { calculateAnchoredVWAP } from '../anchoredVwapEngine';
import { calculateOrderFlow } from '../orderFlowEngine';
import { evaluateConfluence, validateConfigWeights } from '../confluenceEngine';
import { DataProvenance } from '../../../types/msi';
import { Candle } from '../../../types/signals';

const mockProvenance: DataProvenance = {
  providerId: 'LIVE_EXCHANGE',
  mode: 'LIVE',
  granularity: 'CANDLE_LEVEL',
  calculationMethod: 'TEST_METHOD',
  freshnessStatus: 'FRESH',
  validationStatus: 'VALID',
  timestamp: new Date().toISOString(),
};

const mockSyntheticProvenance: DataProvenance = {
  ...mockProvenance,
  providerId: 'SYNTHETIC_GENERATOR',
  mode: 'SIMULATED',
};

const sampleCandles: Candle[] = [
  { time: '08:00', timestamp: 1000, open: 1.1200, high: 1.1250, low: 1.1180, close: 1.1220, volume: 1500 },
  { time: '12:00', timestamp: 2000, open: 1.1220, high: 1.1280, low: 1.1210, close: 1.1270, volume: 2200 },
  { time: '16:00', timestamp: 3000, open: 1.1270, high: 1.1300, low: 1.1240, close: 1.1250, volume: 1800 },
];

test('Config weights sum validation', () => {
  const validWeights = { volumeProfile: 0.2, priceAction: 0.25, anchoredVWAP: 0.2, orderFlow: 0.35 };
  assert.strictEqual(validateConfigWeights(validWeights), true);

  const invalidWeights = { volumeProfile: 0.2, priceAction: 0.2, anchoredVWAP: 0.2, orderFlow: 0.3 };
  assert.strictEqual(validateConfigWeights(invalidWeights), false);
});

test('Volume Profile allocation and mass conservation', () => {
  const vpResult = calculateVolumeProfile(sampleCandles, mockProvenance, 50, 0.68);
  assert.strictEqual(vpResult.status, 'SUCCESS');
  assert.ok(vpResult.data !== null);
  
  const totalAllocated = vpResult.data.totalVolume;
  const totalInput = sampleCandles.reduce((acc, c) => acc + c.volume, 0);
  
  // Mass conservation tolerance within 1e-4
  const diffRatio = Math.abs(totalAllocated - totalInput) / totalInput;
  assert.ok(diffRatio < 1e-4, `Mass conservation diff ratio: ${diffRatio}`);
  assert.ok(vpResult.data.poc > 0);
  assert.ok(vpResult.data.vah >= vpResult.data.val);
});

test('Anchored VWAP zero-volume handling', () => {
  const zeroVolCandles: Candle[] = [
    { time: '08:00', timestamp: 1000, open: 1.1200, high: 1.1250, low: 1.1180, close: 1.1220, volume: 0 },
  ];
  const avwapResult = calculateAnchoredVWAP(zeroVolCandles, mockProvenance, [{ anchorId: 'a1', anchorType: 'SESSION_OPEN', candleIndex: 0 }]);
  assert.strictEqual(avwapResult.status, 'UNAVAILABLE');
  assert.strictEqual(avwapResult.data, null);
});

test('Order Flow unavailability on spot forex candles', () => {
  const ofResult = calculateOrderFlow(sampleCandles, mockProvenance);
  assert.strictEqual(ofResult.status, 'UNAVAILABLE');
  assert.strictEqual(ofResult.data?.cvd.status, 'UNAVAILABLE');
});

test('Synthetic data blocking gate in confluence evaluation', () => {
  const vpRes = calculateVolumeProfile(sampleCandles, mockSyntheticProvenance);
  const paRes = { engineName: 'PRICE_ACTION' as const, status: 'SUCCESS' as const, provenance: mockSyntheticProvenance, data: { trend: 'BULLISH' as const, lastBOS: null, lastCHoCH: null, recentSwings: [], liquiditySweeps: [], supportZones: [], resistanceZones: [] } };
  const avwapRes = { engineName: 'ANCHORED_VWAP' as const, status: 'SUCCESS' as const, provenance: mockSyntheticProvenance, data: { anchors: [] } };
  const ofRes = calculateOrderFlow(sampleCandles, mockSyntheticProvenance);

  const evaluation = evaluateConfluence('EUR/USD', 'H1', vpRes, paRes, avwapRes, ofRes, mockSyntheticProvenance);
  assert.strictEqual(evaluation.decisionEligibility, false);
  assert.ok(evaluation.conflictingEvidence.some((e) => e.includes('Synthetic')));
});
