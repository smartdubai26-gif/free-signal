import { TickAggregator } from '../liveStreamAggregator';

function testAggregation() {
  const aggregator = new TickAggregator();
  const symbol = 'EUR/USD';
  const tick = { symbol, price: 1.1234, timestamp: 1792675680000 };
  const candle = aggregator.processTick(tick, 1);
  
  if (candle && candle.open === 1.1234 && candle.close === 1.1234) {
    console.log('Aggregation test passed');
  } else {
    console.error('Aggregation test failed');
    process.exit(1);
  }
}

testAggregation();
