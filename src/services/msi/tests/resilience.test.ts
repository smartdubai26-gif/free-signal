import { TwelveDataWebSocket, ConnectionState } from '../tdConnection';

async function testResilience() {
  console.log('Running resilience tests...');
  
  let state: any = 'DISCONNECTED';
  
  const tdWs = new TwelveDataWebSocket(
    'dummy-key',
    (data) => console.log('Message received'),
    (s) => {
      state = s;
      console.log('State changed to:', state);
    }
  );
  
  // Test 1: Connect
  tdWs.connect();
  if (state !== 'CONNECTING') {
      console.error('Test 1 Failed: Should be CONNECTING');
      process.exit(1);
  }
  
  // Test 2: Close
  tdWs.close();
  if (state !== 'DISCONNECTED') {
      console.error('Test 2 Failed: Should be DISCONNECTED');
      process.exit(1);
  }
  
  console.log('All resilience tests passed');
  process.exit(0);
}

testResilience();
