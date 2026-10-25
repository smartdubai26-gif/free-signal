/**
 * MSI Historical Data Bridge
 * Connects Twelve Data historical candles to MSI Engines
 */

import { Candle } from '../../types/signals';
import { DataProvenance } from '../../types/msi';

export async function fetchHistoricalCandles(
  symbol: string,
  interval: string = '1day',
  outputSize: number = 30
): Promise<{ candles: Candle[]; provenance: DataProvenance }> {
  const baseUrl = typeof window !== 'undefined' ? '' : 'http://localhost:3000';
  const url = `${baseUrl}/api/msi/time_series?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&outputsize=${outputSize}`;
  
  const res = await fetch(url);
  const json = await res.json();

  if (json.status === 'error') {
    throw new Error(`Historical data fetch failed: ${json.message}`);
  }

  const candles: Candle[] = json.values.map((v: any) => ({
    time: v.datetime,
    timestamp: new Date(v.datetime).getTime(),
    open: parseFloat(v.open),
    high: parseFloat(v.high),
    low: parseFloat(v.low),
    close: parseFloat(v.close),
    volume: v.volume ? parseFloat(v.volume) : 0,
  })).reverse();

  const provenance: DataProvenance = {
    providerId: 'TWELVEDATA_HISTORICAL',
    mode: 'HISTORICAL',
    granularity: 'CANDLE_LEVEL',
    calculationMethod: 'MSI_QUANTITATIVE_CONFLUENCE_v1',
    freshnessStatus: 'FRESH',
    validationStatus: 'VALID',
    timestamp: new Date().toISOString(),
  };

  return { candles, provenance };
}
