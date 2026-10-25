import { fetchHistoricalCandles } from '../historicalDataBridge';
import { calculateVolumeProfile } from '../volumeProfileEngine';
import { calculatePriceAction } from '../priceActionEngine';
import { calculateAnchoredVWAP } from '../anchoredVwapEngine';
import { calculateOrderFlow } from '../orderFlowEngine';

async function runE2EVerification() {
  console.log('Running E2E Historical Data Verification...');
  
  const symbol = 'EUR/USD';
  const { candles, provenance } = await fetchHistoricalCandles(symbol, '1day', 30);
  
  console.log('Provenance:', JSON.stringify(provenance, null, 2));
  console.log('Candles count:', candles.length);
  console.log('Last candle:', candles[candles.length - 1]);
  console.log('Volume semantics:', candles[0].volume);

  // Run Engines
  const vp = calculateVolumeProfile(candles, provenance);
  const pa = calculatePriceAction(candles, provenance);
  const avwap = calculateAnchoredVWAP(candles, provenance, [{ anchorId: 'start', anchorType: 'SESSION_OPEN', candleIndex: 0 }]);
  const of = calculateOrderFlow(candles, provenance);

  console.log('VP Status:', vp.status, 'Data:', !!vp.data);
  console.log('PA Status:', pa.status, 'Data:', !!pa.data);
  console.log('AVWAP Status:', avwap.status, 'Data:', !!avwap.data);
  console.log('Order Flow Status:', of.status);

  // Validate Statuses
  if (vp.status !== 'UNAVAILABLE' || avwap.status !== 'UNAVAILABLE' || pa.status !== 'SUCCESS' || of.status !== 'UNAVAILABLE') {
    console.error('FAILED: Incorrect engine statuses. VP/AVWAP/OF should be UNAVAILABLE, PA should be SUCCESS.');
    process.exit(1);
  }
  
  console.log('SUCCESS: E2E Verification Passed.');
  process.exit(0);
}

runE2EVerification();
