import { fetchHistoricalCandles } from '../historicalDataBridge';

async function testHistoricalData() {
  console.log('Testing historical data bridge...');
  try {
    const { candles, provenance } = await fetchHistoricalCandles('EUR/USD', '1day', 5);
    console.log('Provenance:', JSON.stringify(provenance, null, 2));
    console.log('Candles count:', candles.length);
    console.log('Latest candle:', JSON.stringify(candles[candles.length - 1], null, 2));
    
    if (candles.length === 5 && candles[0].close > 0) {
      console.log('SUCCESS: Historical candles retrieved and validated.');
      process.exit(0);
    } else {
      console.error('FAILED: Invalid historical candle data.');
      process.exit(1);
    }
  } catch (err) {
    console.error('Test failed:', err);
    process.exit(1);
  }
}

testHistoricalData();
