import { generateSignal } from '../../technicalEngine';
import { Candle } from '../../../types/signals';

function createMockCandles(count: number, startPrice: number, trend: 'up' | 'down' | 'range'): Candle[] {
  const candles: Candle[] = [];
  let price = startPrice;
  const now = Date.now();

  for (let i = 0; i < count; i++) {
    let delta = 0;
    if (trend === 'up') delta = (Math.sin(i * 0.1) * 2) + 1.2;
    else if (trend === 'down') delta = (Math.sin(i * 0.1) * 2) - 1.2;
    else delta = Math.sin(i * 0.4) * 0.5;

    price += delta;
    const open = price - delta * 0.5;
    const close = price;
    const high = Math.max(open, close) + Math.abs(delta * 0.3);
    const low = Math.min(open, close) - Math.abs(delta * 0.3);

    candles.push({
      time: new Date(now - (count - i) * 3600000).toISOString(),
      timestamp: now - (count - i) * 3600000,
      open: Number(open.toFixed(2)),
      high: Number(high.toFixed(2)),
      low: Number(low.toFixed(2)),
      close: Number(close.toFixed(2)),
      volume: 1000 + Math.floor(Math.random() * 500),
    });
  }
  return candles;
}

export function runScoringEngineTests() {
  console.log('=== Running Scoring Engine Unit Tests ===');

  // Test 1: Strong Bullish Scenario
  const bullishCandles = createMockCandles(200, 2000, 'up');
  const bullishSignal = generateSignal(bullishCandles, {}, 'XAU/USD', 'H1');
  console.log('Test 1 (Bullish Scenario Result):', {
    direction: bullishSignal.direction,
    confidence: bullishSignal.confidence,
    passed: bullishSignal.confidence >= 40,
  });

  // Test 2: Strong Bearish Scenario
  const bearishCandles = createMockCandles(200, 3000, 'down');
  const bearishSignal = generateSignal(bearishCandles, {}, 'XAU/USD', 'H1');
  console.log('Test 2 (Bearish Scenario Result):', {
    direction: bearishSignal.direction,
    confidence: bearishSignal.confidence,
    passed: bearishSignal.confidence >= 40,
  });

  // Test 3: Neutral Scenario
  const neutralCandles = createMockCandles(200, 2500, 'range');
  const neutralSignal = generateSignal(neutralCandles, {}, 'EUR/USD', 'H1');
  console.log('Test 3 (Neutral Scenario Result):', {
    direction: neutralSignal.direction,
    confidence: neutralSignal.confidence,
    passed: neutralSignal.confidence < 70,
  });

  return { bullishSignal, bearishSignal, neutralSignal };
}
