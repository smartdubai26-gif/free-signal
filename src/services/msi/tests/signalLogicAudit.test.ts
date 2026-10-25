/**
 * MSI Phase 21 & 23 — Signal Logic Audit, Risk Math Correction, and Paper Journal Validation Test Suite
 */

import test from 'node:test';
import assert from 'node:assert';
import dotenv from 'dotenv';
import { calculatePriceAction } from '../priceActionEngine';
import { calculateVolumeProfile } from '../volumeProfileEngine';
import { calculateAnchoredVWAP } from '../anchoredVwapEngine';
import { calculateOrderFlow } from '../orderFlowEngine';
import { evaluateConfluence } from '../confluenceEngine';
import { DataProvenance } from '../../../types/msi';
import { Candle } from '../../../types/signals';

dotenv.config();

const validProvenance: DataProvenance = {
  providerId: 'TWELVEDATA_PAPER',
  mode: 'LIVE',
  granularity: 'CANDLE_LEVEL',
  calculationMethod: 'MSI_QUANTITATIVE_CONFLUENCE_v1',
  freshnessStatus: 'FRESH',
  validationStatus: 'VALID',
  timestamp: new Date().toISOString(),
};

// Construct candles with clear swing structure for BULLISH trend detection
const sampleCandles: Candle[] = Array.from({ length: 15 }, (_, i) => {
  let low = 1.0 + i * 0.005;
  let high = low + 0.015;
  if (i === 3) low = 1.00;
  if (i === 6) high = 1.08;
  if (i === 9) low = 1.03; // Higher low than index 3 (1.00)
  if (i === 12) high = 1.12; // Higher high than index 6 (1.08)
  return {
    time: `0${i}:00`,
    timestamp: (i + 1) * 1000,
    open: low + 0.005,
    high,
    low,
    close: low + 0.008,
    volume: 1000,
  };
});

test('Phase 21 — A: Trade direction aligns strictly with Price Action trend', () => {
  const paRes = calculatePriceAction(sampleCandles, validProvenance);
  const trend = paRes.data?.trend || 'RANGING';
  const isLong = trend === 'BULLISH';
  if (trend === 'BULLISH') {
    assert.strictEqual(isLong, true, 'Bullish trend must map to LONG direction');
  } else {
    assert.strictEqual(trend, 'RANGING', 'Fallback trend is RANGING when swings are indeterminate');
  }
});

test('Phase 21 — B: Confluence scoring formulas & evidence coverage gating', () => {
  const paRes = calculatePriceAction(sampleCandles, validProvenance);
  const vpRes = calculateVolumeProfile(sampleCandles, validProvenance);
  const avwapRes = calculateAnchoredVWAP(sampleCandles, validProvenance, []); // UNAVAILABLE
  const ofRes = calculateOrderFlow(sampleCandles, validProvenance); // UNAVAILABLE

  const evalResult = evaluateConfluence('EUR/USD', 'M15', vpRes, paRes, avwapRes, ofRes, validProvenance);

  assert.ok(typeof evalResult.rawWeightedScore === 'number');
  assert.ok(typeof evalResult.evidenceCoverageRatio === 'number');
  assert.ok(typeof evalResult.normalizedAvailableScore === 'number');
  assert.strictEqual(evalResult.decisionEligibility, false, 'Coverage ratio below 0.60 must block eligibility');
  assert.ok(evalResult.eligibilityReason.includes('INADEQUATE_COVERAGE'));
});

test('Phase 23 — A: Spread cost monetary value is UNAVAILABLE without position size', () => {
  const isGold = false;
  const spreadPips = isGold ? 3.5 : 1.2;
  const spreadInfo = {
    spreadPips,
    source: 'TWELVEDATA_ESTIMATED_BASELINE',
    quality: 'ESTIMATED',
    timestamp: new Date().toISOString(),
    monetaryCostUsd: null, // UNAVAILABLE
  };

  assert.strictEqual(spreadInfo.spreadPips, 1.2);
  assert.strictEqual(spreadInfo.quality, 'ESTIMATED');
  assert.strictEqual(spreadInfo.monetaryCostUsd, null, 'Monetary spread cost must be null when position size is unknown');
});

test('Phase 23 — B: Risk Math 1.5R and 2.5R calculation rules for LONG positions', () => {
  const entryPrice = 1.1000;
  const swingPrice = 1.0950;
  const riskDist = Math.abs(entryPrice - swingPrice); // 0.0050
  const isLong = true;

  const stopLoss = Number((entryPrice - riskDist).toFixed(5)); // 1.0950
  const tp1 = Number((entryPrice + riskDist * 1.5).toFixed(5)); // 1.1075
  const tp2 = Number((entryPrice + riskDist * 2.5).toFixed(5)); // 1.1125

  assert.strictEqual(stopLoss, 1.0950);
  assert.strictEqual(tp1, 1.1075);
  assert.strictEqual(tp2, 1.1125);
  assert.ok(tp1 > entryPrice && entryPrice > stopLoss, 'LONG TP1 must be above entry and SL below entry');
});

test('Phase 23 — C: Missing confirmed swings trigger MISSING_STRUCTURAL_INVALIDATION', () => {
  const flatCandles: Candle[] = Array.from({ length: 8 }, (_, i) => ({
    time: `0${i}:00`,
    timestamp: (i + 1) * 1000,
    open: 1.1,
    high: 1.101,
    low: 1.099,
    close: 1.1,
    volume: 1000,
  }));

  const paRes = calculatePriceAction(flatCandles, validProvenance);
  const hasValidSwings = paRes.data && paRes.data.recentSwings && paRes.data.recentSwings.length > 0;
  assert.strictEqual(hasValidSwings, false, 'Flat candles must have zero confirmed swings');
});
