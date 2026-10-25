import WebSocket from 'ws';
import dotenv from 'dotenv';
dotenv.config();

const apiKey = process.env.TWELVE_DATA_API_KEY;
if (!apiKey) {
  console.error('API Key missing');
  process.exit(1);
}

const ws = new WebSocket(`wss://ws.twelvedata.com/v1/quotes/price?apikey=${apiKey}`);

ws.on('open', () => {
  console.log('WebSocket connected');
  ws.send(JSON.stringify({
    action: 'subscribe',
    params: {
      symbols: 'EUR/USD,XAU/USD'
    }
  }));
});

ws.on('message', (data) => {
  console.log('Received:', data.toString());
  ws.close();
  process.exit(0);
});

ws.on('error', (err) => {
  console.error('WebSocket Error:', err);
  process.exit(1);
});

ws.on('close', () => {
  console.log('WebSocket closed');
});
