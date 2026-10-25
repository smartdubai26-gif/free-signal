/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Candle } from '../../types/signals';
import { AnchoredVWAPResult, AnchoredVWAPPoint, EngineExecutionResult, DataProvenance, AnchorType } from '../../types/msi';

/**
 * Anchored VWAP Engine: calculates VWAP from verified anchor points with zero-volume handling.
 */
export function calculateAnchoredVWAP(
  candles: Candle[],
  provenance: DataProvenance,
  anchorConfigs: { anchorId: string; anchorType: AnchorType; candleIndex: number }[]
): EngineExecutionResult<AnchoredVWAPResult> {
  if (!candles || candles.length === 0) {
    return {
      engineName: 'ANCHORED_VWAP',
      status: 'UNAVAILABLE',
      provenance,
      data: null,
      error: 'No candle data provided for Anchored VWAP.',
    };
  }

  // Safety gate: block dependent analysis if candles contain data gaps, incomplete intervals, or stale data
  const hasCandleGap = candles.some((c: any) => c.hasGap === true || c.isComplete === false);
  const isStale = provenance.freshnessStatus === 'STALE' || provenance.freshnessStatus === 'EXPIRED';

  if (hasCandleGap || provenance.validationStatus === 'INCOMPLETE_CANDLE' || isStale) {
    return {
      engineName: 'ANCHORED_VWAP',
      status: 'UNAVAILABLE',
      provenance: {
        ...provenance,
        freshnessStatus: isStale ? 'STALE' : provenance.freshnessStatus,
        validationStatus: hasCandleGap ? 'INCOMPLETE_CANDLE' : provenance.validationStatus,
        validationReason: isStale
          ? 'Stale data in input series; Anchored VWAP calculation blocked.'
          : 'Data gap or incomplete candle detected in input series; Anchored VWAP blocked.',
      },
      data: null,
      error: isStale ? 'Stale data in input series.' : 'Data gap or incomplete candle detected in input series.',
    };
  }

  const points: AnchoredVWAPPoint[] = [];

  for (const cfg of anchorConfigs) {
    const startIdx = Math.max(0, Math.min(cfg.candleIndex, candles.length - 1));
    let cumulativePV = 0;
    let cumulativeVol = 0;
    let squaredDevSum = 0;

    let validCandlesCount = 0;

    for (let i = startIdx; i < candles.length; i++) {
      const c = candles[i];
      const typicalPrice = (c.high + c.low + c.close) / 3;
      const vol = c.volume || 0;

      if (vol > 0) {
        cumulativePV += typicalPrice * vol;
        cumulativeVol += vol;
        validCandlesCount++;
      }
    }

    // Zero-volume safeguard: never substitute unit weights
    if (cumulativeVol <= 0 || validCandlesCount === 0) {
      return {
        engineName: 'ANCHORED_VWAP',
        status: 'UNAVAILABLE',
        provenance,
        data: null,
        error: 'Zero cumulative volume for VWAP calculation.',
      };
    }

    const vwap = cumulativePV / cumulativeVol;

    // Calculate standard deviation band around VWAP
    for (let i = startIdx; i < candles.length; i++) {
      const c = candles[i];
      const typicalPrice = (c.high + c.low + c.close) / 3;
      const vol = c.volume || 0;
      if (vol > 0) {
        squaredDevSum += vol * Math.pow(typicalPrice - vwap, 2);
      }
    }

    const variance = squaredDevSum / cumulativeVol;
    const stdDev = Math.sqrt(Math.max(0, variance));

    const upperBand1 = vwap + stdDev;
    const lowerBand1 = vwap - stdDev;

    const currentPrice = candles[candles.length - 1].close;
    let priceRelativeToVWAP: 'ABOVE' | 'BELOW' | 'TESTING' = 'TESTING';
    if (currentPrice > upperBand1) priceRelativeToVWAP = 'ABOVE';
    else if (currentPrice < lowerBand1) priceRelativeToVWAP = 'BELOW';

    const distancePips = Math.abs(currentPrice - vwap) * 10000; // approximate forex pips

    points.push({
      anchorId: cfg.anchorId,
      anchorType: cfg.anchorType,
      anchorTimestamp: candles[startIdx].time || new Date(candles[startIdx].timestamp).toISOString(),
      anchorIndex: startIdx,
      anchorPrice: candles[startIdx].close,
      weightingType: provenance.granularity === 'TRADE_LEVEL' ? 'ACTUAL_VOLUME' : 'TICK_VOLUME',
      currentVWAP: Number(vwap.toFixed(4)),
      upperBand1: Number(upperBand1.toFixed(4)),
      lowerBand1: Number(lowerBand1.toFixed(4)),
      priceRelativeToVWAP,
      distancePips: Number(distancePips.toFixed(1)),
    });
  }

  return {
    engineName: 'ANCHORED_VWAP',
    status: 'SUCCESS',
    provenance: {
      ...provenance,
      calculationMethod: 'VOLUME_WEIGHTED_AVERAGE_PRICE_ANCHORED',
    },
    data: {
      anchors: points,
    },
  };
}
