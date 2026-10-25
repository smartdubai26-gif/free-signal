/**
 * MSI Data Bridge
 * Connects Live Market Data to MSI Engines
 */

import { fetchLiveMarketRates } from '../liveMarketData';
import { fetchHistoricalCandles } from './historicalDataBridge';
import { DataProvenance, MSIDataMode } from '../../types/msi';
import { Candle } from '../../types/signals';

export interface MsiDataSnapshot {
  candles: Candle[];
  provenance: DataProvenance;
}

export async function getMsiData(symbol: string, interval: string = '1h'): Promise<MsiDataSnapshot> {
  try {
    const historical = await fetchHistoricalCandles(symbol, interval, 30);
    if (historical.candles && historical.candles.length >= 5) {
      return historical;
    }
  } catch (err) {
    // Fall back to live snapshot if historical fetch fails
  }

  const rates = await fetchLiveMarketRates();
  const rate = rates[symbol];

  const now = Date.now();
  const provenance: DataProvenance = {
    providerId: 'LIVE_EXCHANGE',
    mode: rate ? 'LIVE' : 'UNAVAILABLE',
    granularity: 'TRADE_LEVEL',
    calculationMethod: 'MSI_QUANTITATIVE_CONFLUENCE_v1',
    freshnessStatus: rate && (now - rate.lastUpdated < 60000) ? 'FRESH' : 'STALE',
    validationStatus: rate ? 'VALID' : 'MISSING_REQUIRED_FIELDS',
    timestamp: new Date().toISOString(),
  };

  const candles: Candle[] = rate ? [{
    time: new Date(rate.lastUpdated).toLocaleDateString(),
    timestamp: rate.lastUpdated,
    open: rate.price,
    high: rate.price,
    low: rate.price,
    close: rate.price,
    volume: 0,
  }] : [];

  return { candles, provenance };
}
