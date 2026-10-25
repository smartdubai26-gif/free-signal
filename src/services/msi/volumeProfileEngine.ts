/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Candle } from '../../types/signals';
import { VolumeProfileResult, VolumeProfileBin, EngineExecutionResult, DataProvenance } from '../../types/msi';

/**
 * Deterministic Volume Profile Engine using Candle Range Triangular Distribution approximation.
 */
export function calculateVolumeProfile(
  candles: Candle[],
  provenance: DataProvenance,
  numBins: number = 100,
  valueAreaPct: number = 0.68
): EngineExecutionResult<VolumeProfileResult> {
  if (!candles || candles.length === 0) {
    return {
      engineName: 'VOLUME_PROFILE',
      status: 'UNAVAILABLE',
      provenance,
      data: null,
      error: 'No candle data provided for Volume Profile calculation.',
    };
  }

  // Safety gate: block dependent analysis if candles contain data gaps, incomplete intervals, or stale data
  const hasCandleGap = candles.some((c: any) => c.hasGap === true || c.isComplete === false);
  const isStale = provenance.freshnessStatus === 'STALE' || provenance.freshnessStatus === 'EXPIRED';

  if (hasCandleGap || provenance.validationStatus === 'INCOMPLETE_CANDLE' || isStale) {
    return {
      engineName: 'VOLUME_PROFILE',
      status: 'UNAVAILABLE',
      provenance: {
        ...provenance,
        freshnessStatus: isStale ? 'STALE' : provenance.freshnessStatus,
        validationStatus: hasCandleGap ? 'INCOMPLETE_CANDLE' : provenance.validationStatus,
        validationReason: isStale
          ? 'Stale data in input series; Volume Profile calculation blocked.'
          : 'Data gap or incomplete candle detected in input series; Volume Profile calculation blocked.',
      },
      data: null,
      error: isStale ? 'Stale data in input series.' : 'Data gap or incomplete candle detected in input series.',
    };
  }

  // 1. Find session high and low
  let sessionLow = Infinity;
  let sessionHigh = -Infinity;
  let totalInputVolume = 0;

  candles.forEach((c) => {
    if (c.low < sessionLow) sessionLow = c.low;
    if (c.high > sessionHigh) sessionHigh = c.high;
    totalInputVolume += c.volume || 0;
  });

  if (sessionLow >= sessionHigh || totalInputVolume <= 0) {
    return {
      engineName: 'VOLUME_PROFILE',
      status: 'UNAVAILABLE',
      provenance,
      data: null,
      error: 'Invalid price span or zero total volume across candles.',
    };
  }

  const priceSpan = sessionHigh - sessionLow;
  const binSize = priceSpan / numBins;

  // Initialize bins
  const bins: VolumeProfileBin[] = [];
  for (let i = 0; i < numBins; i++) {
    bins.push({
      price: sessionLow + i * binSize,
      volume: 0,
      isPOC: false,
      isVAH: false,
      isVAL: false,
      nodeType: 'STANDARD',
    });
  }

  // 2. Distribute candle volume using triangular distribution
  let totalAllocatedVolume = 0;

  candles.forEach((c) => {
    const cVol = c.volume || 0;
    if (cVol <= 0) return;

    const cLow = Math.max(sessionLow, c.low);
    const cHigh = Math.min(sessionHigh, c.high);
    const cClose = c.close;

    // Find intersecting bins
    const intersectingBins: { index: number; weight: number }[] = [];
    let totalWeight = 0;

    for (let i = 0; i < numBins; i++) {
      const bLow = bins[i].price;
      const bHigh = bLow + binSize;

      // Check intersection
      if (bHigh > cLow && bLow < cHigh) {
        const overlapLow = Math.max(bLow, cLow);
        const overlapHigh = Math.min(bHigh, cHigh);
        const midPoint = (overlapLow + overlapHigh) / 2;

        // Triangular weight peaking at close
        const rangeWidth = cHigh - cLow;
        let weight = 1.0;
        if (rangeWidth > 0) {
          weight = 1.0 - Math.abs(midPoint - cClose) / rangeWidth;
          weight = Math.max(0.05, weight); // minimum floor weight
        }

        intersectingBins.push({ index: i, weight });
        totalWeight += weight;
      }
    }

    if (totalWeight > 0) {
      intersectingBins.forEach((item) => {
        const normalizedWeight = item.weight / totalWeight;
        const allocated = cVol * normalizedWeight;
        bins[item.index].volume += allocated;
        totalAllocatedVolume += allocated;
      });
    }
  });

  // 3. Mass conservation check (tolerance 1e-4 relative)
  const massDiff = Math.abs(totalAllocatedVolume - totalInputVolume);
  if (totalInputVolume > 0 && massDiff / totalInputVolume > 1e-4) {
    return {
      engineName: 'VOLUME_PROFILE',
      status: 'DEGRADED',
      provenance,
      data: null,
      error: `Mass conservation violation: Allocated ${totalAllocatedVolume} vs Input ${totalInputVolume}`,
    };
  }

  // 4. Determine POC with deterministic tie-breaking (closest to session VWAP or median price)
  let maxVol = -1;
  let pocIndex = 0;
  const sessionMidpoint = (sessionHigh + sessionLow) / 2;

  bins.forEach((b, idx) => {
    if (b.volume > maxVol) {
      maxVol = b.volume;
      pocIndex = idx;
    } else if (Math.abs(b.volume - maxVol) < 1e-6) {
      // Tie-breaking: choose bin closer to session midpoint
      const currentDist = Math.abs(b.price - sessionMidpoint);
      const bestDist = Math.abs(bins[pocIndex].price - sessionMidpoint);
      if (currentDist < bestDist) {
        pocIndex = idx;
      }
    }
  });

  bins[pocIndex].isPOC = true;
  bins[pocIndex].nodeType = 'POC';
  const pocPrice = bins[pocIndex].price + binSize / 2;

  // 5. Value Area (VA) calculation (68% default)
  const targetVAVolume = totalAllocatedVolume * valueAreaPct;
  let currentVAVolume = bins[pocIndex].volume;
  let upperCursor = pocIndex;
  let lowerCursor = pocIndex;

  bins[pocIndex].isVAH = true;
  bins[pocIndex].isVAL = true;

  while (currentVAVolume < targetVAVolume && (upperCursor < numBins - 1 || lowerCursor > 0)) {
    const upperVol = upperCursor < numBins - 1 ? bins[upperCursor + 1].volume : -1;
    const lowerVol = lowerCursor > 0 ? bins[lowerCursor - 1].volume : -1;

    if (upperVol >= lowerVol && upperCursor < numBins - 1) {
      upperCursor++;
      currentVAVolume += bins[upperCursor].volume;
      bins[upperCursor].isVAH = true;
    } else if (lowerCursor > 0) {
      lowerCursor--;
      currentVAVolume += bins[lowerCursor].volume;
      bins[lowerCursor].isVAL = true;
    } else {
      break;
    }
  }

  const vahPrice = bins[upperCursor].price + binSize;
  const valPrice = bins[lowerCursor].price;

  // 6. HVN and LVN threshold calculation
  const nonZeroBins = bins.filter((b) => b.volume > 0);
  const meanVol = nonZeroBins.reduce((acc, b) => acc + b.volume, 0) / (nonZeroBins.length || 1);
  const variance = nonZeroBins.reduce((acc, b) => acc + Math.pow(b.volume - meanVol, 2), 0) / (nonZeroBins.length || 1);
  const stdDevVol = Math.sqrt(variance);

  const hvnThreshold = meanVol + 1.5 * stdDevVol;
  const lvnThreshold = Math.max(0, meanVol - 1.0 * stdDevVol);

  bins.forEach((b) => {
    if (b.isPOC) return;
    if (b.volume >= hvnThreshold) {
      b.nodeType = 'HVN';
    } else if (b.volume <= lvnThreshold && b.volume > 0) {
      b.nodeType = 'LVN';
    }
  });

  return {
    engineName: 'VOLUME_PROFILE',
    status: 'SUCCESS',
    provenance: {
      ...provenance,
      calculationMethod: 'CANDLE_RANGE_TRIANGULAR_DISTRIBUTION',
    },
    data: {
      poc: Number(pocPrice.toFixed(4)),
      vah: Number(vahPrice.toFixed(4)),
      val: Number(valPrice.toFixed(4)),
      totalVolume: Number(totalAllocatedVolume.toFixed(2)),
      allocationMethod: 'CANDLE_RANGE_TRIANGULAR_DISTRIBUTION',
      valueAreaPercentage: valueAreaPct * 100,
      bins,
    },
  };
}
