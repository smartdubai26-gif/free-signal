/**
 * verify-holiday.ts — proves the v7 holiday rule: SATURDAY ONLY.
 *
 * Run:  npx tsx scripts/verify-holiday.ts
 *
 * Prints, for Friday / Saturday / Sunday, the full market clock, the H4
 * analysis schedule and the seed-signal state, so the three cases can be
 * compared side by side instead of trusted.
 */
import {
  getMarketClock,
  getAnalysisSchedule,
  isForexWeekend,
  isMarketOpen,
  cairoWeekday,
  formatMarketDateTime,
  nextWeekOpenMs,
  lastWeekOpenMs,
  getMarketSessions,
} from '../src/services/marketClock';
import { buildSeedSignals } from '../src/services/mockData';

const CASES: Array<{ label: string; iso: string }> = [
  { label: 'الجمعة (يوم تداول)', iso: '2026-10-30T10:00:00Z' },
  { label: 'الجمعة 21:00 UTC = 23:00 القاهرة (كانت مغلقة قبل v7)', iso: '2026-10-30T21:00:00Z' },
  { label: 'السبت (الإجازة الوحيدة)', iso: '2026-10-31T10:00:00Z' },
  { label: 'السبت 01:00 القاهرة (حدّ اليوم)', iso: '2026-10-30T23:00:00Z' },
  { label: 'الأحد (يوم تداول)', iso: '2026-11-01T10:00:00Z' },
  { label: 'الأحد 00:30 القاهرة (أول نصف ساعة بعد الفتح)', iso: '2026-10-31T22:30:00Z' },
];

let failures = 0;
const check = (name: string, actual: unknown, expected: unknown) => {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`   ${ok ? '✅' : '❌'} ${name}: ${String(actual)}${ok ? '' : ` (expected ${String(expected)})`}`);
};

for (const c of CASES) {
  const ms = new Date(c.iso).getTime();
  const clock = getMarketClock(ms);
  const sched = getAnalysisSchedule(ms);
  const seeds = buildSeedSignals(ms);

  console.log(`\n━━━ ${c.label} ━━━`);
  console.log(`   UTC        : ${c.iso}`);
  console.log(`   Cairo      : ${formatMarketDateTime(c.iso)}`);
  console.log(`   Cairo dow  : ${cairoWeekday(ms)} (0=Sun … 6=Sat)`);
  console.log(`   isOpen     : ${clock.isOpen}`);
  console.log(`   reason     : ${clock.closedReasonAr ?? '—'}`);
  console.log(`   lastOpen   : ${formatMarketDateTime(new Date(clock.lastOpenMs).toISOString())}`);
  console.log(`   nextOpen   : ${formatMarketDateTime(new Date(clock.nextOpenMs).toISOString())}`);
  console.log(`   lastCheck  : ${formatMarketDateTime(new Date(sched.lastCheckMs).toISOString())}  [${sched.lastLabelAr}]`);
  console.log(`   nextCheck  : ${formatMarketDateTime(new Date(sched.nextCheckMs).toISOString())}  [${sched.nextLabelAr}]`);
  console.log(`   deferred   : ${sched.deferredFromWeekend}`);
  console.log(`   seeds      : ${seeds.length} | statuses: ${[...new Set(seeds.map((s) => s.status))].join(',')}`);
  console.log(`   sessions   : ${getMarketSessions(ms).map((s) => `${s.city}=${s.statusAr}`).join(' | ')}`);
}

console.log('\n\n════════ ASSERTIONS ════════');

// Friday
const fri = new Date('2026-10-30T10:00:00Z').getTime();
console.log('\n[الجمعة 10:00 UTC]');
check('isForexWeekend', isForexWeekend(fri), false);
check('isMarketOpen', isMarketOpen(fri), true);
check('seeds are live (not EXPIRED)', buildSeedSignals(fri).every((s) => s.status !== 'EXPIRED'), true);

// Friday evening — the case v6 got wrong. 21:00 UTC is still Friday in Cairo
// (23:00), so the market must be OPEN. 22:00 UTC would already be Saturday.
const friEve = new Date('2026-10-30T21:00:00Z').getTime();
console.log('\n[الجمعة 21:00 UTC = 23:00 القاهرة — كانت مغلقة قبل v7]');
check('isForexWeekend', isForexWeekend(friEve), false);
check('isMarketOpen', isMarketOpen(friEve), true);

// The Cairo-midnight boundary: 22:00 UTC Friday is 00:00 Saturday in Cairo.
const friLate = new Date('2026-10-30T22:00:00Z').getTime();
console.log('\n[الجمعة 22:00 UTC = السبت 00:00 القاهرة — بداية الإجازة]');
check('isForexWeekend', isForexWeekend(friLate), true);

// Saturday
const sat = new Date('2026-10-31T10:00:00Z').getTime();
console.log('\n[السبت 10:00 UTC]');
check('isForexWeekend', isForexWeekend(sat), true);
check('isMarketOpen', isMarketOpen(sat), false);
check('seeds are EXPIRED', buildSeedSignals(sat).every((s) => s.status === 'EXPIRED'), true);
check(
  'nextOpen is Sunday 00:00 Cairo (2026-10-31T22:00Z)',
  new Date(nextWeekOpenMs(sat)).toISOString(),
  '2026-10-31T22:00:00.000Z'
);
check(
  'nextCheck is the first H4 close after reopen (2026-11-01T00:00Z = 02:00 Cairo)',
  new Date(getAnalysisSchedule(sat).nextCheckMs).toISOString(),
  '2026-11-01T00:00:00.000Z'
);

// Saturday 01:00 Cairo — the boundary that a UTC-based rule would get wrong
const satEarly = new Date('2026-10-30T23:00:00Z').getTime();
console.log('\n[السبت 01:00 القاهرة = 2026-10-30T23:00Z]');
check('isForexWeekend (Cairo calendar)', isForexWeekend(satEarly), true);

// Sunday
const sun = new Date('2026-11-01T10:00:00Z').getTime();
console.log('\n[الأحد 10:00 UTC]');
check('isForexWeekend', isForexWeekend(sun), false);
check('isMarketOpen', isMarketOpen(sun), true);
check('seeds are live', buildSeedSignals(sun).every((s) => s.status !== 'EXPIRED'), true);

// Sunday 00:30 Cairo — first half hour after reopen
const sunEarly = new Date('2026-10-31T22:30:00Z').getTime();
console.log('\n[الأحد 00:30 القاهرة = 2026-10-31T22:30Z]');
check('isForexWeekend', isForexWeekend(sunEarly), false);
check('lastOpen is Sunday 00:00 Cairo', new Date(lastWeekOpenMs(sunEarly)).toISOString(), '2026-10-31T22:00:00.000Z');
check(
  'seed activation is not before the reopen',
  new Date(buildSeedSignals(sunEarly)[0].timestamp).getTime() >= lastWeekOpenMs(sunEarly),
  true
);

console.log(`\n${failures === 0 ? '✅ ALL ASSERTIONS PASSED' : `❌ ${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
