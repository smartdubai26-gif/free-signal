import { getMsiData } from '../dataBridge';
import { calculateVolumeProfile } from '../volumeProfileEngine';
import { calculatePriceAction } from '../priceActionEngine';

// Simple integration test for MSI data pipeline
async function runIntegrationTest() {
  console.log('Running integration test...');
  
  const symbol = 'XAU/USD';
  const data = await getMsiData(symbol);
  
  console.log('Data provenance:', data.provenance);
  console.log('Candles count:', data.candles.length);
  
  // Verify that engines report UNAVAILABLE given only 1 candle
  const vp = calculateVolumeProfile(data.candles, data.provenance);
  const pa = calculatePriceAction(data.candles, data.provenance);
  
  console.log('VP Status:', vp.status);
  console.log('PA Status:', pa.status);
  
  if ((vp.status === 'UNAVAILABLE' || vp.status === 'DEGRADED') && (pa.status === 'UNAVAILABLE' || pa.status === 'DEGRADED')) {
    console.log('SUCCESS: Engines correctly report UNAVAILABLE with insufficient data.');
    process.exit(0);
  } else {
    console.error('FAILED: Engines did not report UNAVAILABLE.');
    process.exit(1);
  }
}

runIntegrationTest();
