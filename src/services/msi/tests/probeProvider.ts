import { fetchLiveMarketRates } from '../../liveMarketData';

async function probe() {
  console.log('Probing provider capabilities for historical candles...');
  try {
    // Attempting to fetch historical candles from Twelve Data using an empty key
    const res = await fetch('https://api.twelvedata.com/time_series?symbol=EUR/USD&interval=1day&apikey=demo');
    const data = await res.json();
    console.log('API Response:', JSON.stringify(data, null, 2));
  } catch (err) {
    console.log('Probe failed:', err);
  }
}

probe();
