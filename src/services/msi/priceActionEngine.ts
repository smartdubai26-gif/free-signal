/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Candle } from '../../types/signals';
import { PriceActionResult, StructureEvent, EngineExecutionResult, DataProvenance } from '../../types/msi';

/**
 * Price Action Engine: identifies swing points, Market Structure (BOS, CHoCH), and liquidity sweeps without look-ahead bias.
 */
export function calculatePriceAction(
  candles: Candle[],
  provenance: DataProvenance,
  swingLookback: number = 3
): EngineExecutionResult<PriceActionResult> {
  if (!candles || candles.length < swingLookback * 2 + 1) {
    return {
      engineName: 'PRICE_ACTION',
      status: 'UNAVAILABLE',
      provenance,
      data: null,
      error: 'Insufficient candles for Price Action swing structure analysis.',
    };
  }

  // Safety gate: block dependent analysis if candles contain data gaps, incomplete intervals, or stale data
  const hasCandleGap = candles.some((c: any) => c.hasGap === true || c.isComplete === false);
  const isStale = provenance.freshnessStatus === 'STALE' || provenance.freshnessStatus === 'EXPIRED';

  if (hasCandleGap || provenance.validationStatus === 'INCOMPLETE_CANDLE' || isStale) {
    return {
      engineName: 'PRICE_ACTION',
      status: 'UNAVAILABLE',
      provenance: {
        ...provenance,
        freshnessStatus: isStale ? 'STALE' : provenance.freshnessStatus,
        validationStatus: hasCandleGap ? 'INCOMPLETE_CANDLE' : provenance.validationStatus,
        validationReason: isStale
          ? 'Stale candle data detected; structure analysis blocked.'
          : 'Data gap or incomplete candle detected in input series; structure analysis blocked.',
      },
      data: null,
      error: isStale ? 'Stale candle data detected.' : 'Data gap detected in input candles; structure analysis blocked.',
    };
  }

  const swings: StructureEvent[] = [];
  const liquiditySweeps: StructureEvent[] = [];

  // 1. Identify confirmed historical swings (avoiding look-ahead bias by strictly requiring index <= current - lookback)
  for (let i = swingLookback; i < candles.length - swingLookback; i++) {
    const currentHigh = candles[i].high;
    const currentLow = candles[i].low;

    let isSwingHigh = true;
    let isSwingLow = true;

    for (let j = 1; j <= swingLookback; j++) {
      if (candles[i - j].high >= currentHigh || candles[i + j].high >= currentHigh) {
        isSwingHigh = false;
      }
      if (candles[i - j].low <= currentLow || candles[i + j].low <= currentLow) {
        isSwingLow = false;
      }
    }

    if (isSwingHigh) {
      swings.push({
        id: `swing-h-${i}`,
        type: 'SWING_HIGH',
        price: currentHigh,
        timestamp: candles[i].time || new Date(candles[i].timestamp).toISOString(),
        candleIndex: i,
        isConfirmed: true,
        invalidationLevel: currentHigh + (candles[i].high - candles[i].low) * 0.5,
      });
    }

    if (isSwingLow) {
      swings.push({
        id: `swing-l-${i}`,
        type: 'SWING_LOW',
        price: currentLow,
        timestamp: candles[i].time || new Date(candles[i].timestamp).toISOString(),
        candleIndex: i,
        isConfirmed: true,
        invalidationLevel: currentLow - (candles[i].high - candles[i].low) * 0.5,
      });
    }
  }

  // 2. Identify Market Structure Events (BOS and CHoCH)
  let lastBOS: StructureEvent | null = null;
  let lastCHoCH: StructureEvent | null = null;
  let trend: 'BULLISH' | 'BEARISH' | 'RANGING' = 'RANGING';

  const swingHighs = swings.filter((s) => s.type === 'SWING_HIGH').sort((a, b) => a.candleIndex - b.candleIndex);
  const swingLows = swings.filter((s) => s.type === 'SWING_LOW').sort((a, b) => a.candleIndex - b.candleIndex);

  if (swingHighs.length >= 2 && swingLows.length >= 2) {
    const recentHigh1 = swingHighs[swingHighs.length - 1];
    const recentHigh2 = swingHighs[swingHighs.length - 2];
    const recentLow1 = swingLows[swingLows.length - 1];
    const recentLow2 = swingLows[swingLows.length - 2];

    if (recentHigh1.price > recentHigh2.price && recentLow1.price > recentLow2.price) {
      trend = 'BULLISH';
      lastBOS = {
        id: `bos-${recentHigh1.candleIndex}`,
        type: 'BOS',
        price: recentHigh1.price,
        timestamp: recentHigh1.timestamp,
        candleIndex: recentHigh1.candleIndex,
        isConfirmed: true,
        invalidationLevel: recentLow1.price,
      };
    } else if (recentHigh1.price < recentHigh2.price && recentLow1.price < recentLow2.price) {
      trend = 'BEARISH';
      lastBOS = {
        id: `bos-${recentLow1.candleIndex}`,
        type: 'BOS',
        price: recentLow1.price,
        timestamp: recentLow1.timestamp,
        candleIndex: recentLow1.candleIndex,
        isConfirmed: true,
        invalidationLevel: recentHigh1.price,
      };
    }

    // Check CHoCH (Change of Character: trend reversal signal)
    if (trend === 'BEARISH' && recentHigh1.price > recentHigh2.price) {
      lastCHoCH = {
        id: `choch-${recentHigh1.candleIndex}`,
        type: 'CHoCH',
        price: recentHigh1.price,
        timestamp: recentHigh1.timestamp,
        candleIndex: recentHigh1.candleIndex,
        isConfirmed: true,
        invalidationLevel: recentLow1.price,
      };
      trend = 'BULLISH';
    } else if (trend === 'BULLISH' && recentLow1.price < recentLow2.price) {
      lastCHoCH = {
        id: `choch-${recentLow1.candleIndex}`,
        type: 'CHoCH',
        price: recentLow1.price,
        timestamp: recentLow1.timestamp,
        candleIndex: recentLow1.candleIndex,
        isConfirmed: true,
        invalidationLevel: recentHigh1.price,
      };
      trend = 'BEARISH';
    }
  }

  // 3. Detect Liquidity Sweeps (wicks breaking prior swing levels but closing back within range)
  candles.forEach((c, idx) => {
    swings.forEach((sw) => {
      if (sw.candleIndex >= idx) return; // avoid look-ahead
      if (sw.type === 'SWING_HIGH' && c.high > sw.price && c.close < sw.price) {
        liquiditySweeps.push({
          id: `sweep-h-${idx}`,
          type: 'LIQUIDITY_SWEEP',
          price: sw.price,
          timestamp: c.time || new Date(c.timestamp).toISOString(),
          candleIndex: idx,
          isConfirmed: true,
          invalidationLevel: c.high,
        });
      } else if (sw.type === 'SWING_LOW' && c.low < sw.price && c.close > sw.price) {
        liquiditySweeps.push({
          id: `sweep-l-${idx}`,
          type: 'LIQUIDITY_SWEEP',
          price: sw.price,
          timestamp: c.time || new Date(c.timestamp).toISOString(),
          candleIndex: idx,
          isConfirmed: true,
          invalidationLevel: c.low,
        });
      }
    });
  });

  // Extract support & resistance zones from recent swing extremes
  const supportZones = Array.from(new Set(swingLows.slice(-3).map((s) => s.price)));
  const resistanceZones = Array.from(new Set(swingHighs.slice(-3).map((s) => s.price)));

  return {
    engineName: 'PRICE_ACTION',
    status: 'SUCCESS',
    provenance: {
      ...provenance,
      calculationMethod: 'SWING_STRUCTURE_BOS_CHOCH',
    },
    data: {
      trend,
      lastBOS,
      lastCHoCH,
      recentSwings: swings.slice(-6),
      liquiditySweeps: liquiditySweeps.slice(-4),
      supportZones,
      resistanceZones,
    },
  };
}
