import { fetchHistoricalCandles } from '../historicalDataBridge';

async function runIntradayTests() {
  console.log('Running Intraday Historical Data Tests...');
  const intervals = ['1min', '5min', '15min', '30min'];
  const symbol = 'EUR/USD';

  for (const interval of intervals) {
    try {
      const { candles, provenance } = await fetchHistoricalCandles(symbol, interval, 5);
      if (candles.length === 0) {
        throw new Error(`No candles returned for ${interval}`);
      }
      console.log(`PASSED: ${interval} - ${candles.length} candles received.`);
    } catch (error: any) {
      console.error(`FAILED: ${interval} - ${error.message}`);
      process.exit(1);
    }
  }
  console.log('ALL INTRADAY TESTS PASSED.');
  process.exit(0);
}

runIntradayTests();
