async function probe() {
  console.log('Probing Twelve Data volume semantics...');
  const symbols = ['EUR/USD', 'XAU/USD'];
  for (const symbol of symbols) {
    try {
      const res = await fetch(`https://api.twelvedata.com/time_series?symbol=${symbol}&interval=1day&outputsize=1&apikey=demo`);
      const data = await res.json();
      console.log(`API Response for ${symbol}:`, JSON.stringify(data.values[0], null, 2));
    } catch (err) {
      console.log(`Probe failed for ${symbol}:`, err);
    }
  }
}
probe();
