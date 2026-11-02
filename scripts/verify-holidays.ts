/**
 * verify-holidays.ts — proves the v9 holiday calendar.
 *
 * Run:  npx tsx scripts/verify-holidays.ts
 *
 * Every assertion is a real call into the shipped module — nothing is
 * re-implemented here. If a date is wrong, this script says so.
 */
import {
  getMarketClock,
  getAnalysisSchedule,
  getMarketHoliday,
  isMarketHoliday,
  isMarketClosed,
  isForexWeekend,
  isMarketOpen,
  listHolidaysForYear,
  HOLIDAY_OVERRIDES,
  formatMarketDateTime,
  formatMarketDateTimeShort,
  nextMarketOpenMs,
} from '../src/services/marketClock';
import { buildSeedSignals } from '../src/services/mockData';

let failures = 0;
let passed = 0;
const check = (name: string, actual: unknown, expected: unknown) => {
  const ok = actual === expected;
  if (ok) passed++;
  else failures++;
  console.log(
    `   ${ok ? '✅' : '❌'} ${name}: ${String(actual)}${ok ? '' : `   ← expected ${String(expected)}`}`
  );
};

const ms = (iso: string) => new Date(iso).getTime();

function describe(label: string, iso: string) {
  const t = ms(iso);
  const c = getMarketClock(t);
  const s = getAnalysisSchedule(t);
  console.log(`\n━━━ ${label} ━━━`);
  console.log(`   UTC       : ${iso}`);
  console.log(`   Cairo     : ${formatMarketDateTime(iso)}`);
  console.log(`   isOpen    : ${c.isOpen}`);
  console.log(`   closedKind: ${c.closedKind ?? '—'}`);
  console.log(`   holiday   : ${c.holiday ? `${c.holiday.id} / ${c.holiday.nameEn} (${c.holiday.date})` : '—'}`);
  console.log(`   reason    : ${c.closedReasonAr ?? '—'}`);
  console.log(`   nextOpen  : ${formatMarketDateTime(new Date(c.nextOpenMs).toISOString())}`);
  console.log(`   lastCheck : ${formatMarketDateTime(new Date(s.lastCheckMs).toISOString())}`);
  console.log(`   nextCheck : ${formatMarketDateTime(new Date(s.nextCheckMs).toISOString())}`);
  console.log(`   seeds     : ${buildSeedSignals(t).length} → status ${[...new Set(buildSeedSignals(t).map((x) => x.status))].join(',')}`);
  return { clock: c, sched: s };
}

/* ═══════════════════════════════════════════════════════════════════
   PART 1 — the five cases the request names, side by side
   ═══════════════════════════════════════════════════════════════════ */
console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║  PART 1 — the five states, printed in full                    ║');
console.log('╚══════════════════════════════════════════════════════════════╝');

describe('🎄 Christmas Day 2026 (Friday 25 Dec) — CLOSED', '2026-12-25T10:00:00Z');
describe("🎆 New Year's Day 2027 (Friday 1 Jan) — CLOSED", '2027-01-01T10:00:00Z');
describe('✝️  Good Friday 2027 (Friday 26 Mar) — CLOSED', '2027-03-26T10:00:00Z');
describe('📈 An ordinary Tuesday 2027 (2 Mar) — OPEN', '2027-03-02T10:00:00Z');
describe('🛑 Saturday 31 Oct 2026 — CLOSED (weekly)', '2026-10-31T10:00:00Z');

/* ═══════════════════════════════════════════════════════════════════
   PART 2 — assertions
   ═══════════════════════════════════════════════════════════════════ */
console.log('\n\n╔══════════════════════════════════════════════════════════════╗');
console.log('║  PART 2 — assertions                                          ║');
console.log('╚══════════════════════════════════════════════════════════════╝');

console.log('\n[25 ديسمبر 2026 — الكريسماس]');
const xmas = ms('2026-12-25T10:00:00Z');
check('Christmas is a holiday', isMarketHoliday(xmas), true);
check('market closed', isMarketClosed(xmas), true);
check('closedKind = holiday', getMarketClock(xmas).closedKind, 'holiday');
check('holiday id = christmas', getMarketHoliday(xmas)?.id, 'christmas');
check('NOT flagged as weekend', isForexWeekend(xmas), false);
check('isMarketOpen = false', isMarketOpen(xmas), false);
check('seeds are EXPIRED', buildSeedSignals(xmas).every((s) => s.status === 'EXPIRED'), true);
check(
  'reopens Sat 26 Dec 00:00 Cairo — but Boxing Day is also closed',
  getMarketHoliday(ms('2026-12-26T10:00:00Z'))?.id,
  'boxing_day'
);
check(
  'next open = Sun 27 Dec 00:00 Cairo (Boxing Day 26 Dec is a Saturday, already closed)',
  new Date(nextMarketOpenMs(xmas)).toISOString(),
  '2026-12-26T22:00:00.000Z'
);

console.log("\n[1 يناير 2027 — رأس السنة]");
const nyd = ms('2027-01-01T10:00:00Z');
check('New Year is a holiday', isMarketHoliday(nyd), true);
check('holiday id = new_year', getMarketHoliday(nyd)?.id, 'new_year');
check('closedKind = holiday', getMarketClock(nyd).closedKind, 'holiday');
check('NOT flagged as weekend', isForexWeekend(nyd), false);

console.log('\n[Good Friday 2027 — 26 مارس]');
const goodFri = ms('2027-03-26T10:00:00Z');
check('Good Friday is a holiday', isMarketHoliday(goodFri), true);
check('holiday id = good_friday', getMarketHoliday(goodFri)?.id, 'good_friday');
check('movable = true', getMarketHoliday(goodFri)?.movable, true);
check('closedKind = holiday', getMarketClock(goodFri).closedKind, 'holiday');

console.log('\n[Easter Monday 2027 — 29 مارس]');
const easterMon = ms('2027-03-29T10:00:00Z');
check('Easter Monday is a holiday', isMarketHoliday(easterMon), true);
check('holiday id = easter_monday', getMarketHoliday(easterMon)?.id, 'easter_monday');

console.log('\n[يوم عادي — الثلاثاء 2 مارس 2027]');
const normal = ms('2027-03-02T10:00:00Z');
check('not a holiday', isMarketHoliday(normal), false);
check('market open', isMarketOpen(normal), true);
check('closedKind = null', getMarketClock(normal).closedKind, null);
check('seeds are live', buildSeedSignals(normal).every((s) => s.status !== 'EXPIRED'), true);
check('analysis NOT deferred', getAnalysisSchedule(normal).deferredFromWeekend, false);

console.log('\n[السبت — 31 أكتوبر 2026]');
const sat = ms('2026-10-31T10:00:00Z');
check('market closed', isMarketClosed(sat), true);
check('closedKind = weekend', getMarketClock(sat).closedKind, 'weekend');
check('not a holiday', isMarketHoliday(sat), false);
check('seeds are EXPIRED', buildSeedSignals(sat).every((s) => s.status === 'EXPIRED'), true);

console.log('\n[الجمعة والأحد — تداول عادي (v7 preserved)]');
check('Friday 30 Oct 10:00Z open', isMarketOpen(ms('2026-10-30T10:00:00Z')), true);
check('Friday 21:00Z still open', isMarketOpen(ms('2026-10-30T21:00:00Z')), true);
check('Sunday 1 Nov 10:00Z open', isMarketOpen(ms('2026-11-01T10:00:00Z')), true);

/* ── Easter computus: known published dates ─────────────────────── */
console.log('\n[Computus — مطابقة تواريخ الفصح المنشورة]');
const KNOWN_EASTER: Array<[number, string]> = [
  [2024, '2024-03-31'],
  [2025, '2025-04-20'],
  [2026, '2026-04-05'],
  [2027, '2027-03-28'],
  [2028, '2028-04-16'],
  [2030, '2030-04-21'],
  [2038, '2038-04-25'],
];
for (const [year, easterDate] of KNOWN_EASTER) {
  const holidays = listHolidaysForYear(year);
  // Good Friday is 2 days before Easter Sunday.
  const gf = holidays.find((h) => h.id === 'good_friday');
  const expectedGf = new Date(new Date(`${easterDate}T12:00:00Z`).getTime() - 2 * 86400000)
    .toISOString()
    .slice(0, 10);
  check(
    `Easter ${year} = ${easterDate} ⇒ Good Friday ${expectedGf}`,
    gf?.date,
    expectedGf
  );
}

/* ── Every year in the supported window has the full set ────────── */
console.log('\n[كل سنة 2024–2035 فيها الأربعة أعياد]');
for (let y = 2024; y <= 2035; y++) {
  const ids = new Set(listHolidaysForYear(y).map((h) => h.id));
  const ok =
    ids.has('new_year') &&
    ids.has('christmas') &&
    ids.has('boxing_day') &&
    ids.has('good_friday') &&
    ids.has('easter_monday');
  check(`${y}: new_year + christmas + boxing_day + good_friday + easter_monday`, ok, true);
}

/* ── Overrides table is empty; the mechanism still works ─────────── */
console.log('\n[Override — الطبقة موجودة وفاضية عمدًا]');
check('HOLIDAY_OVERRIDES is empty', Object.keys(HOLIDAY_OVERRIDES).length, 0);
check(
  '26 Dec 2027 (Sunday) closed by the fixed rule alone',
  getMarketHoliday(ms('2027-12-26T10:00:00Z'))?.id,
  'boxing_day'
);
check(
  '27 Dec 2027 (Monday) is a normal trading day — no observed shift baked in',
  getMarketHoliday(ms('2027-12-27T10:00:00Z')),
  null
);

/* ── Two consecutive closed days (Sat + Boxing-Day Sunday) ───────── */
console.log('\n[25/26 ديسمبر 2027: سبت + أحد (Boxing Day) ⇒ أول فتح هو الاثنين]');
check(
  'Saturday 25 Dec 2027 → next open Monday 27 Dec 00:00 Cairo',
  new Date(nextMarketOpenMs(ms('2027-12-25T10:00:00Z'))).toISOString(),
  // Monday 27 Dec 00:00 Cairo (UTC+2) = Sunday 26 Dec 22:00Z
  '2027-12-26T22:00:00.000Z'
);

/* ── H4 schedule defers across a holiday, not just a Saturday ───── */
console.log('\n[H4 — الفحص يتأجل عبر العطلة لأول شمعة بعد الفتح]');
const xmasSched = getAnalysisSchedule(xmas);
check('Christmas: deferred flag', xmasSched.deferredFromWeekend, true);
check(
  'Christmas: last scan is the final close before the closure (24 Dec 20:00Z)',
  new Date(xmasSched.lastCheckMs).toISOString(),
  '2026-12-24T20:00:00.000Z'
);
check(
  'Christmas: next scan is the first H4 close after the reopen (27 Dec 00:00Z)',
  new Date(xmasSched.nextCheckMs).toISOString(),
  '2026-12-27T00:00:00.000Z'
);

/* ═══════════════════════════════════════════════════════════════════
   PART 3 — the year list the UI can show
   ═══════════════════════════════════════════════════════════════════ */
console.log('\n\n╔══════════════════════════════════════════════════════════════╗');
console.log('║  PART 3 — 2027 holiday calendar                              ║');
console.log('╚══════════════════════════════════════════════════════════════╝');
for (const h of listHolidaysForYear(2027)) {
  const dayMs = ms(`${h.date}T12:00:00Z`);
  console.log(
    `   ${h.date}  ${formatMarketDateTimeShort(new Date(dayMs).toISOString()).padEnd(22)}  ` +
      `${h.movable ? '(متحرك)' : '(ثابت)  '}  ${h.nameEn}`
  );
}

console.log(
  `\n\n${failures === 0 ? '✅ ALL ASSERTIONS PASSED' : `❌ ${failures} FAILURE(S)`}` +
    `  —  ${passed} passed, ${failures} failed`
);
process.exit(failures === 0 ? 0 : 1);
