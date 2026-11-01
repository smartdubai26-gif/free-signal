import { getMarketClock, isForexWeekend, classifySignal, formatMarketDateTime } from '../src/services/marketClock';
import { buildSeedSignals } from '../src/services/mockData';

const now = Date.now();
const c = getMarketClock(now);
console.log('NOW (UTC)      :', new Date(now).toISOString());
console.log('Cairo date     :', c.date, '| dow UTC:', new Date(now).getUTCDay());
console.log('isWeekend      :', c.isWeekend);
console.log('isOpen         :', c.isOpen);
console.log('reason         :', c.closedReasonAr);
console.log('lastOpen       :', new Date(c.lastOpenMs).toISOString(), '=>', formatMarketDateTime(new Date(c.lastOpenMs).toISOString()));
console.log('nextOpen       :', new Date(c.nextOpenMs).toISOString(), '=>', formatMarketDateTime(new Date(c.nextOpenMs).toISOString()));
console.log('--- seeds ---');
const seeds = buildSeedSignals(now);
for (const s of seeds.slice(0,3)) {
  console.log(s.symbol, '| status:', s.status, '| activated:', s.activated_at, '| class:', classifySignal(s, now));
}
console.log('total seeds:', seeds.length, '| all EXPIRED:', seeds.every(s=>s.status==='EXPIRED'));
console.log('--- future guard ---');
console.log('future ts classified:', classifySignal({status:'active', activated_at: new Date(now+86400000).toISOString()}, now));
console.log('--- weekend checks ---');
for (const iso of ['2026-10-31T12:00:00Z','2026-11-01T12:00:00Z','2026-11-01T22:00:00Z','2026-11-02T10:00:00Z','2026-10-30T22:00:00Z']) {
  console.log(iso, '=> weekend?', isForexWeekend(new Date(iso).getTime()));
}
