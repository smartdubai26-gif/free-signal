/**
 * marketClock.ts — Single source of truth for market time.
 * ------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 * Before this module the app had FOUR different clocks fighting each other:
 *   1. `new Date().toISOString()`            -> UTC date (mockData, App storage guard)
 *   2. `new Date().setHours(0,0,0,0)`        -> the *device's* local midnight (signalRepository)
 *   3. `Intl ... Africa/Cairo`               -> Cairo date (scheduler)
 *   4. `toLocaleString('ar-EG')` with no tz  -> the *device's* timezone (SignalCard)
 * The result: on a Saturday the app still stamped activation times and presented
 * stale Friday signals as "today's opportunities".
 *
 * Every time/date decision in the app MUST go through this module.
 */

/** The trading clock the product speaks in. All *displayed* times use this zone. */
export const MARKET_TIMEZONE = 'Africa/Cairo';
export const MARKET_TZ_LABEL_AR = 'توقيت القاهرة';

/* ------------------------------------------------------------------ */
/* Preview-only clock override                                        */
/* ------------------------------------------------------------------ */
/**
 * Every default `now` in this module goes through `marketNowMs()` instead of
 * `Date.now()` so the three market states (Friday / Saturday / Sunday) can be
 * demonstrated on a live preview without waiting for the calendar.
 *
 * The override is read from `?debugNow=<ISO>` and is **preview-only**: it is
 * compiled out unless the build sets `VITE_PREVIEW_CLOCK=1`. A normal
 * production build (Vercel) never sets it, so a real user can never shift the
 * market clock by editing the URL.
 */
let _debugNowMs: number | null = null;

export function setDebugNow(ms: number | null): void {
  _debugNowMs = ms;
}

/** True when this build was compiled with the preview clock enabled. */
// `import.meta.env` is injected by Vite; under Node (the verify scripts in
// `scripts/`) it is undefined, so the optional chain falls back to `false`
// instead of throwing before the module body runs.
export const PREVIEW_CLOCK_ENABLED = (import.meta as any).env?.VITE_PREVIEW_CLOCK === '1';

export function marketNowMs(): number {
  if (_debugNowMs !== null) return _debugNowMs;
  try {
    if (PREVIEW_CLOCK_ENABLED && typeof window !== 'undefined') {
      const raw = new URLSearchParams(window.location.search).get('debugNow');
      if (raw) {
        const ms = new Date(raw).getTime();
        if (Number.isFinite(ms)) {
          _debugNowMs = ms;
          return ms;
        }
      }
    }
  } catch {
    /* no window / no URLSearchParams — fall through to the real clock */
  }
  return Date.now();
}

/** True when the preview clock override is active (used to label the UI). */
export function isDebugClockActive(): boolean {
  return _debugNowMs !== null;
}

/* ------------------------------------------------------------------ */
/* Forex week boundary — SATURDAY-ONLY CLOSURE                        */
/* ------------------------------------------------------------------ */
/**
 * PRODUCT RULE (changed in v7): the market is closed on **Saturday only**.
 *
 *   closed   Cairo Saturday 00:00  ->  Cairo Sunday 00:00
 *   open     every other day, 24 hours
 *
 * Friday is a normal trading day and Sunday is a normal trading day. The
 * previous rule (Friday 21:00 UTC -> Sunday 21:00 UTC) shut the market for
 * 48 hours and made Friday evening and all of Sunday look dead, which is not
 * what this product promises its users.
 *
 * The boundary is expressed on the CAIRO calendar, not the UTC calendar,
 * because that is the calendar the user reads in the UI. A UTC-based Saturday
 * would close Cairo 02:00 Saturday -> 02:00 Sunday, so a user opening the app
 * at 01:00 on Saturday would be told the market is open on a day the product
 * calls a holiday.
 *
 * If your broker keeps different hours, change ONLY this constant.
 */
export const CLOSED_WEEKDAY_CAIRO = 6; // 0=Sunday … 6=Saturday

/** Session definitions in UTC (institutional / "GMT" hours). */
export interface SessionDef {
  id: string;
  city: string;
  nameAr: string;
  openUtc: number; // minutes from 00:00 UTC
  closeUtc: number; // minutes from 00:00 UTC (may wrap past 1440)
}

export const SESSION_DEFS: SessionDef[] = [
  { id: 'sydney', city: 'Sydney', nameAr: 'بورصة سيدني (الأسترالي)', openUtc: 21 * 60, closeUtc: 30 * 60 },
  { id: 'tokyo', city: 'Tokyo', nameAr: 'بورصة طوكيو (الآسيوي)', openUtc: 0, closeUtc: 9 * 60 },
  { id: 'london', city: 'London', nameAr: 'بورصة لندن (الأوروبي)', openUtc: 7 * 60, closeUtc: 16 * 60 },
  { id: 'newyork', city: 'New York', nameAr: 'بورصة نيويورك (الأمريكي)', openUtc: 12 * 60, closeUtc: 21 * 60 },
];

/* ------------------------------------------------------------------ */
/* Public holiday calendar — holidays close the market like Saturday   */
/* ------------------------------------------------------------------ */
/**
 * WHY THIS BLOCK EXISTS (v9)
 * Until v9 the only closure in the product was "Cairo Saturday". That is the
 * weekly closure, not the whole truth: on Christmas Day, New Year's Day and
 * Good Friday the FX market does not trade either, yet the app happily
 * generated "today's opportunities" at 08:00 on 25 December.
 *
 * HOW THE DATES ARE DEFINED
 *   - Fixed civil holidays  -> FIXED_HOLIDAYS  (month + day, repeats yearly)
 *   - Feasts tied to Easter -> MOVABLE_HOLIDAYS (offset from Easter Sunday,
 *                              computed with the Gregorian Computus)
 *   - Anything a broker does differently -> HOLIDAY_OVERRIDES, keyed by the
 *                              literal Cairo date. This is where you add an
 *                              observed shift (e.g. Boxing Day observed on
 *                              Monday when 26 Dec falls on a Sunday) or a
 *                              one-off exchange closure. An override WINS over
 *                              every rule above, and `closed: false` turns a
 *                              rule-generated date back into a trading day.
 *
 * WHY THE CAIRO CALENDAR, LIKE THE SATURDAY RULE
 * Christmas Day on the Cairo calendar is 25 Dec 00:00 -> 26 Dec 00:00 Cairo,
 * i.e. 24 Dec 22:00Z -> 25 Dec 22:00Z. That is exactly when an FX desk stops
 * quoting, so the Cairo calendar is the right frame here too.
 */

export interface MarketHoliday {
  id: string;
  /** Arabic label shown to the user, e.g. «عيد الميلاد المجيد (الكريسماس)» */
  nameAr: string;
  nameEn: string;
  /** Cairo calendar date, YYYY-MM-DD */
  date: string;
  /** True for feasts whose date moves every year (Easter-derived). */
  movable: boolean;
}

interface FixedHolidayDef {
  id: string;
  month: number;
  day: number;
  nameAr: string;
  nameEn: string;
}

interface MovableHolidayDef {
  id: string;
  /** Offset in days from Easter Sunday (Good Friday = -2, Easter Monday = +1). */
  easterOffsetDays: number;
  nameAr: string;
  nameEn: string;
}

/**
 * Fixed-date closures. Add a line here and every module honours it — there is
 * no second list anywhere in the codebase.
 */
const FIXED_HOLIDAYS: FixedHolidayDef[] = [
  { id: 'new_year', month: 1, day: 1, nameAr: 'رأس السنة الميلادية', nameEn: "New Year's Day" },
  { id: 'christmas', month: 12, day: 25, nameAr: 'عيد الميلاد المجيد (الكريسماس)', nameEn: 'Christmas Day' },
  { id: 'boxing_day', month: 12, day: 26, nameAr: 'عيد الصناديق (Boxing Day)', nameEn: 'Boxing Day' },
];

/**** Feasts that follow Easter. */
const MOVABLE_HOLIDAYS: MovableHolidayDef[] = [
  { id: 'good_friday', easterOffsetDays: -2, nameAr: 'الجمعة العظيمة (Good Friday)', nameEn: 'Good Friday' },
  { id: 'easter_monday', easterOffsetDays: 1, nameAr: 'اثنين الفصح (Easter Monday)', nameEn: 'Easter Monday' },
];

/**
 * Many FX brokers run a normal Monday session on Easter Monday. Flip this to
 * `false` if yours does — nothing else needs to change.
 */
export const CLOSE_ON_EASTER_MONDAY = true;

export interface HolidayOverride {
  id: string;
  nameAr: string;
  nameEn: string;
  /** `false` cancels a date that a rule above would have closed. */
  closed?: boolean;
}

/**
 * Explicit date-keyed overrides. Use for observed shifts and broker-specific
 * closures. This is the place to edit when a rule gets next year wrong.
 *
 * EMPTY BY DEFAULT — and that is deliberate.
 *
 * The obvious first entry would be "2027: Christmas is a Saturday and Boxing
 * Day is a Sunday, so observe Boxing Day on Monday 27 Dec". It was written,
 * tested, and then removed: 25 / 26 / 27 December 2027 are Saturday / Sunday /
 * Monday, so adding that shift closes THREE consecutive days. How long the
 * desk shuts for the year-end is a commercial decision for the account owner,
 * not a fact about the calendar, and an agent should not bake it in silently.
 *
 * The mechanism is kept so it is one line when they decide:
 *
 *   '2027-12-27': {
 *     id: 'boxing_day_observed',
 *     nameAr: 'عيد الصناديق (إجازة معوّضة)',
 *     nameEn: 'Boxing Day (observed)',
 *   },
 *
 * And a cancellation (forces a rule-generated date back to a trading day):
 *
 *   '2026-12-26': { id: 'boxing_day_off', nameAr: '—', nameEn: '—', closed: false },
 */
export const HOLIDAY_OVERRIDES: Record<string, HolidayOverride> = {};

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * Easter Sunday for a Gregorian year — the anonymous (Meeus/Jones/Butcher)
 * computus. Returns a calendar date, never an instant.
 */
function easterSundayMonthDay(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = March, 4 = April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

/** Calendar-date arithmetic that never touches a timezone. */
function shiftYmd(year: number, month: number, day: number, deltaDays: number) {
  const d = new Date(Date.UTC(year, month - 1, day + deltaDays));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

const holidayYearCache = new Map<number, Map<string, MarketHoliday>>();

function buildHolidayIndex(year: number): Map<string, MarketHoliday> {
  const out = new Map<string, MarketHoliday>();

  for (const f of FIXED_HOLIDAYS) {
    const date = `${year}-${pad2(f.month)}-${pad2(f.day)}`;
    out.set(date, { id: f.id, nameAr: f.nameAr, nameEn: f.nameEn, date, movable: false });
  }

  const easter = easterSundayMonthDay(year);
  for (const mv of MOVABLE_HOLIDAYS) {
    if (mv.id === 'easter_monday' && !CLOSE_ON_EASTER_MONDAY) continue;
    const t = shiftYmd(year, easter.month, easter.day, mv.easterOffsetDays);
    const date = `${t.year}-${pad2(t.month)}-${pad2(t.day)}`;
    out.set(date, { id: mv.id, nameAr: mv.nameAr, nameEn: mv.nameEn, date, movable: true });
  }

  const prefix = `${year}-`;
  for (const [date, ov] of Object.entries(HOLIDAY_OVERRIDES)) {
    if (!date.startsWith(prefix)) continue;
    if (ov.closed === false) {
      out.delete(date);
      continue;
    }
    out.set(date, { id: ov.id, nameAr: ov.nameAr, nameEn: ov.nameEn, date, movable: false });
  }

  return out;
}

function holidayIndex(year: number): Map<string, MarketHoliday> {
  const cached = holidayYearCache.get(year);
  if (cached) return cached;
  const built = buildHolidayIndex(year);
  holidayYearCache.set(year, built);
  return built;
}

/** The public holiday that falls on this instant's Cairo date, or null. */
export function getMarketHoliday(nowMs: number = marketNowMs()): MarketHoliday | null {
  const ymd = cairoDateYmd(nowMs);
  const year = parseInt(ymd.slice(0, 4), 10);
  if (!Number.isFinite(year)) return null;
  return holidayIndex(year).get(ymd) ?? null;
}

/**
 * True when the Cairo date of `nowMs` is a public holiday.
 * Holidays are NOT part of the weekly closure — they are a separate kind of
 * closure, and `isMarketClosed()` is the one predicate that covers both.
 */
export function isMarketHoliday(nowMs: number = marketNowMs()): boolean {
  return getMarketHoliday(nowMs) !== null;
}

/** Every holiday of a given year — used by the schedule UI and the tests. */
export function listHolidaysForYear(year: number): MarketHoliday[] {
  return [...holidayIndex(year).values()].sort((a, b) => a.date.localeCompare(b.date));
}

export type MarketClosedKind = 'weekend' | 'holiday' | null;

/**
 * Why the market is closed right now: `weekend` (Cairo Saturday), `holiday`
 * (a date in the calendar above), or `null` (trading).
 */
export function getMarketClosedKind(nowMs: number = marketNowMs()): MarketClosedKind {
  if (cairoWeekday(nowMs) === CLOSED_WEEKDAY_CAIRO) return 'weekend';
  if (isMarketHoliday(nowMs)) return 'holiday';
  return null;
}

/**
 * The single closure predicate. EVERY module must gate on this instead of
 * re-deriving a weekday: it covers Saturday AND the holiday calendar.
 */
export function isMarketClosed(nowMs: number = marketNowMs()): boolean {
  return getMarketClosedKind(nowMs) !== null;
}

/** UTC instant of Cairo midnight with the offset re-read for that very day. */
function cairoMidnightRefined(y: number, m: number, d: number, seedOffsetMin: number): number {
  let cand = cairoMidnightUtc(y, m, d, seedOffsetMin);
  const refined = parseOffsetMinutes(getCairoParts(cand).offsetLabel);
  if (refined !== seedOffsetMin) cand = cairoMidnightUtc(y, m, d, refined);
  return cand;
}

/**
 * The next moment the market reopens.
 *
 * Walks forward day by day on the Cairo calendar until it has passed a closed
 * day and landed on an open one — so a Saturday followed by a Boxing-Day
 * Sunday (2027) reopens on Monday, not on the closed Sunday.
 */
export function nextMarketOpenMs(nowMs: number = marketNowMs()): number {
  const parts = getCairoParts(nowMs);
  const [y, m, d] = parts.date.split('-').map(Number);
  const seed = parseOffsetMinutes(parts.offsetLabel);

  let sawClosedDay = false;
  for (let i = 0; i <= 21; i++) {
    const cand = cairoMidnightRefined(y, m, d + i, seed);
    if (getMarketClosedKind(cand) !== null) {
      sawClosedDay = true;
      continue;
    }
    if (sawClosedDay && cand > nowMs) return cand;
  }
  return cairoMidnightRefined(y, m, d + 8, seed);
}

/**
 * The most recent moment the market reopened: an open Cairo midnight whose
 * previous day was closed (Saturday or a holiday).
 */
export function lastMarketOpenMs(nowMs: number = marketNowMs()): number {
  const parts = getCairoParts(nowMs);
  const [y, m, d] = parts.date.split('-').map(Number);
  const seed = parseOffsetMinutes(parts.offsetLabel);

  for (let i = 0; i <= 21; i++) {
    const cand = cairoMidnightRefined(y, m, d - i, seed);
    if (cand > nowMs) continue;
    if (getMarketClosedKind(cand) !== null) continue;
    const prev = cairoMidnightRefined(y, m, d - i - 1, seed);
    if (getMarketClosedKind(prev) !== null) return cand;
  }
  return cairoMidnightRefined(y, m, d - 8, seed);
}

/** Arabic one-liner used by the closed banner. */
function buildHolidayClosedReason(holiday: MarketHoliday, reopenMs: number): string {
  return (
    `السوق مغلق — عطلة رسمية: ${holiday.nameAr}. ` +
    `لا يتم توليد إشارات جديدة، ولا تنشيط صفقات، ولا تسوية TP/SL في هذا اليوم. ` +
    `يُستأنف التداول ${formatMarketDateTimeShort(new Date(reopenMs).toISOString())} بتوقيت القاهرة.`
  );
}

/* ------------------------------------------------------------------ */
/* Primitive helpers                                                  */
/* ------------------------------------------------------------------ */

export function isValidDate(input: unknown): input is string {
  if (typeof input !== 'string' || !input) return false;
  const ms = new Date(input).getTime();
  return Number.isFinite(ms);
}

/** UTC minutes since midnight */
function utcMinutes(ms: number): number {
  const d = new Date(ms);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

const cairoWeekdayFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: MARKET_TIMEZONE,
  weekday: 'short',
});

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

/**
 * Weekday on the CAIRO calendar: 0=Sunday … 6=Saturday.
 * This is the calendar the user reads, so it is the calendar the holiday rule
 * must use. `new Date(ms).getUTCDay()` would be off by one for the first two
 * hours of every Cairo day.
 */
export function cairoWeekday(nowMs: number = marketNowMs()): number {
  const wd = cairoWeekdayFormatter.format(new Date(nowMs));
  return WEEKDAY_INDEX[wd] ?? 0;
}

/** UTC instant of Cairo midnight for a given Cairo calendar date. */
function cairoMidnightUtc(y: number, m: number, d: number, offsetMin: number): number {
  return Date.UTC(y, m - 1, d, 0, 0, 0, 0) - offsetMin * 60_000;
}

/* ------------------------------------------------------------------ */
/* Weekend / session state                                            */
/* ------------------------------------------------------------------ */

/**
 * True when the FX market is closed — **Saturday only**, on the Cairo calendar.
 *
 * Friday and Sunday are ordinary trading days. This is the single place the
 * holiday rule lives; every other module asks this function rather than
 * re-deriving a weekday itself.
 */
export function isForexWeekend(nowMs: number = marketNowMs()): boolean {
  return cairoWeekday(nowMs) === CLOSED_WEEKDAY_CAIRO;
}

/** True when the FX market is trading right now (weekends AND holidays). */
export function isMarketOpen(nowMs: number = marketNowMs()): boolean {
  return !isMarketClosed(nowMs);
}

/** Which named session is live right now (null when the market is closed). */
export function getActiveSessionId(nowMs: number = marketNowMs()): string | null {
  if (isMarketClosed(nowMs)) return null;
  const mins = utcMinutes(nowMs);
  for (const s of SESSION_DEFS) {
    // Sessions may wrap midnight (Sydney 21:00 -> 06:00 next day).
    const inWindow =
      s.closeUtc > s.openUtc
        ? mins >= s.openUtc && mins < s.closeUtc
        : mins >= s.openUtc || mins < s.closeUtc;
    if (inWindow) return s.id;
  }
  return null;
}

/**
 * Next moment the market reopens, in ms — Cairo Sunday 00:00, i.e. the instant
 * Saturday ends. The offset is re-read per candidate day so an Egyptian DST
 * change cannot shift the boundary by an hour.
 */
export function nextWeekOpenMs(nowMs: number = marketNowMs()): number {
  // v9: delegates to the holiday-aware walker. Kept under the old name so
  // every existing caller keeps working while the semantics get stricter
  // (a Saturday followed by a closed Sunday now reopens on Monday).
  return nextMarketOpenMs(nowMs);
}

/**
 * The most recent moment the market reopened (Cairo Sunday 00:00) at or before
 * `nowMs`. Used to keep a freshly reopened session from being stamped with a
 * timestamp from before the holiday.
 */
export function lastWeekOpenMs(nowMs: number = marketNowMs()): number {
  return lastMarketOpenMs(nowMs);
}

/**
 * The most recent moment the market actually opened (or re-opened after the
 * weekend). Used to stamp a truthful `activated_at` on freshly seeded signals
 * instead of pretending they activated at a hard-coded 07:30.
 */
export function lastSessionOpenMs(nowMs: number = marketNowMs()): number {
  // Walk backwards to the most recent moment a *trading day* opened.
  // A "trading day open" is 07:00 UTC (London open) on a trading day.
  // This is what a seed signal should be stamped with: on a Saturday it
  // resolves to Friday 07:00 UTC, never to a phantom Saturday activation.
  const d = new Date(nowMs);
  d.setUTCHours(7, 0, 0, 0);
  if (d.getTime() > nowMs) d.setUTCDate(d.getUTCDate() - 1);

  // Step back over the closed day (Cairo Saturday) only.
  for (let guard = 0; guard < 10; guard++) {
    if (getMarketClosedKind(d.getTime()) === null) break;
    d.setUTCDate(d.getUTCDate() - 1);
    d.setUTCHours(7, 0, 0, 0);
  }

  // Never return a moment before the market actually reopened: in the first
  // hours of Sunday the 07:00 anchor still points at Friday.
  return Math.max(d.getTime(), lastWeekOpenMs(nowMs));
}

/* ------------------------------------------------------------------ */
/* Cairo wall-clock helpers                                           */
/* ------------------------------------------------------------------ */

export interface CairoParts {
  /** YYYY-MM-DD in Africa/Cairo */
  date: string;
  hour: number;
  minute: number;
  second: number;
  /** "GMT+2" / "GMT+3" style short offset label */
  offsetLabel: string;
}

const cairoPartsFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: MARKET_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
  timeZoneName: 'shortOffset',
});

export function getCairoParts(nowMs: number = marketNowMs()): CairoParts {
  const parts = cairoPartsFormatter.formatToParts(new Date(nowMs));
  const get = (t: string) => parts.find((p) => p.type === t)?.value || '';
  const offsetRaw = get('timeZoneName').replace('GMT', '').replace(':', '');
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    hour: parseInt(get('hour') || '0', 10),
    minute: parseInt(get('minute') || '0', 10),
    second: parseInt(get('second') || '0', 10),
    offsetLabel: offsetRaw ? `GMT${offsetRaw}` : 'GMT+2',
  };
}

/** YYYY-MM-DD on the Cairo calendar (NOT the UTC or device calendar). */
export function cairoDateYmd(nowMs: number = marketNowMs()): string {
  return getCairoParts(nowMs).date;
}

/** The UTC instant that starts "today" in Cairo. Use for DB range filters. */
export function cairoDayStartUtcIso(nowMs: number = marketNowMs()): string {
  const parts = getCairoParts(nowMs);
  const offsetMin = parseOffsetMinutes(parts.offsetLabel);
  const [y, m, d] = parts.date.split('-').map(Number);
  // Cairo midnight expressed in UTC = midnight - offset
  const utcMidnight = Date.UTC(y, m - 1, d, 0, 0, 0, 0) - offsetMin * 60_000;
  return new Date(utcMidnight).toISOString();
}

/** The UTC instant that ends "today" in Cairo (exclusive). */
export function cairoDayEndUtcIso(nowMs: number = marketNowMs()): string {
  const start = new Date(cairoDayStartUtcIso(nowMs)).getTime();
  return new Date(start + 24 * 3600_000).toISOString();
}

function parseOffsetMinutes(label: string): number {
  const m = /GMT([+-])(\d{1,2})(?::?(\d{2}))?/.exec(label);
  if (!m) return 120; // Cairo is UTC+2 in winter; safe default
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (parseInt(m[2], 10) * 60 + parseInt(m[3] || '0', 10));
}

/* ------------------------------------------------------------------ */
/* Display formatting — every user-visible timestamp uses this        */
/* ------------------------------------------------------------------ */

/**
 * Formats an ISO timestamp in the MARKET timezone with an explicit zone label,
 * e.g. "السبت 31 أكتوبر 2026 · 07:30 (GMT+2) · توقيت القاهرة".
 * Returns '—' for missing/invalid input instead of "Invalid Date".
 */
export function formatMarketDateTime(iso?: string | null): string {
  if (!isValidDate(iso)) return '—';
  const d = new Date(iso as string);
  const body = new Intl.DateTimeFormat('ar-EG', {
    timeZone: MARKET_TIMEZONE,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
    .format(d)
    // ar-EG renders midnight as ٢٤:٠٠; normalise to ٠٠:٠٠.
    .replace(/٢٤:/g, '٠٠:')
    .replace(/24:/g, '00:');
  const { offsetLabel } = getCairoParts(d.getTime());
  return `${body} · ${offsetLabel}`;
}

/** Short form: "31 أكتوبر · 07:30 (GMT+2)" */
export function formatMarketDateTimeShort(iso?: string | null): string {
  if (!isValidDate(iso)) return '—';
  const d = new Date(iso as string);
  const body = new Intl.DateTimeFormat('ar-EG', {
    timeZone: MARKET_TIMEZONE,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
    .format(d)
    .replace(/٢٤:/g, '٠٠:')
    .replace(/24:/g, '00:');
  const { offsetLabel } = getCairoParts(d.getTime());
  return `${body} (${offsetLabel})`;
}

/* ------------------------------------------------------------------ */
/* Signal freshness classification                                    */
/* ------------------------------------------------------------------ */

export type SignalFreshness =
  | 'closed'        // settled: has closed_at or a final status
  | 'active'        // live and legitimately open today
  | 'awaiting'      // pending, never activated — normal
  | 'invalid_future'// activated_at is in the future => bad data, must not show
  | 'stale';        // was "open" but belongs to a previous day/weekend

const FINAL_STATUSES = new Set([
  'won', 'lost', 'tp1_hit', 'tp2_hit', 'sl_hit', 'expired', 'cancelled', 'not_triggered',
]);

/**
 * Decides whether a signal may be presented as live, must be labelled as
 * finished, or must be hidden entirely.
 */
export function classifySignal(
  signal: { status?: string; activated_at?: string; closed_at?: string; timestamp?: string },
  nowMs: number = Date.now()
): SignalFreshness {
  const status = (signal.status || '').toLowerCase();
  if (signal.closed_at || FINAL_STATUSES.has(status)) return 'closed';

  const activationIso = signal.activated_at || signal.timestamp;
  if (isValidDate(activationIso)) {
    const t = new Date(activationIso as string).getTime();
    // A 60s grace absorbs clock skew between the browser and the data source.
    if (t > nowMs + 60_000) return 'invalid_future';
    if (cairoDateYmd(t) !== cairoDateYmd(nowMs)) return 'stale';
  }

  if (!signal.activated_at) return 'awaiting';

  // We are inside the weekend: nothing may claim to have activated after the close.
  if (isMarketClosed(nowMs)) return 'stale';

  return 'active';
}

/** True if the timestamp should never be rendered as a live activation. */
export function isFutureTimestamp(iso?: string | null, nowMs: number = marketNowMs()): boolean {
  if (!isValidDate(iso)) return false;
  return new Date(iso as string).getTime() > nowMs + 60_000;
}

/* ------------------------------------------------------------------ */
/* One aggregate the UI can consume                                   */
/* ------------------------------------------------------------------ */

export interface MarketClock {
  nowMs: number;
  cairo: CairoParts;
  /** YYYY-MM-DD on the Cairo calendar */
  date: string;
  /** True only for the weekly closure (Cairo Saturday). */
  isWeekend: boolean;
  /** True when the Cairo date is in the public-holiday calendar. */
  isHoliday: boolean;
  /** Why it is closed: 'weekend' | 'holiday' | null. */
  closedKind: MarketClosedKind;
  /** The holiday that closes today, or null. */
  holiday: MarketHoliday | null;
  isOpen: boolean;
  activeSessionId: string | null;
  /** Human-readable Arabic reason when closed (names the holiday). */
  closedReasonAr: string | null;
  /** Short Arabic label for a badge, e.g. «الكريسماس». */
  closedLabelAr: string | null;
  nextOpenMs: number;
  lastOpenMs: number;
  dayStartUtcIso: string;
  dayEndUtcIso: string;
  /** ISO for "the moment this trading day opened", or null when closed */
  sessionOpenIso: string | null;
}

export function getMarketClock(nowMs: number = marketNowMs()): MarketClock {
  const closedKind = getMarketClosedKind(nowMs);
  const holiday = getMarketHoliday(nowMs);
  const weekend = closedKind === 'weekend';
  const open = closedKind === null;
  const cairo = getCairoParts(nowMs);
  const nextOpenMs = nextMarketOpenMs(nowMs);

  let closedReasonAr: string | null = null;
  let closedLabelAr: string | null = null;

  if (closedKind === 'weekend') {
    closedLabelAr = 'عطلة السبت';
    closedReasonAr =
      'السوق مغلق — اليوم سبت، وهو يوم الإجازة الأسبوعية. ' +
      'الجمعة والأحد يومان تداول عاديان، ويُستأنف التداول ' +
      `${formatMarketDateTimeShort(new Date(nextOpenMs).toISOString())} بتوقيت القاهرة.`;
  } else if (closedKind === 'holiday' && holiday) {
    closedLabelAr = holiday.nameAr;
    closedReasonAr = buildHolidayClosedReason(holiday, nextOpenMs);
  }

  return {
    nowMs,
    cairo,
    date: cairo.date,
    isWeekend: weekend,
    isHoliday: closedKind === 'holiday',
    closedKind,
    holiday,
    isOpen: open,
    activeSessionId: getActiveSessionId(nowMs),
    closedReasonAr,
    closedLabelAr,
    nextOpenMs,
    lastOpenMs: lastSessionOpenMs(nowMs),
    dayStartUtcIso: cairoDayStartUtcIso(nowMs),
    dayEndUtcIso: cairoDayEndUtcIso(nowMs),
    sessionOpenIso: open ? new Date(lastSessionOpenMs(nowMs)).toISOString() : null,
  };
}

/** Live session rows for the header chips. */
export function getMarketSessions(nowMs: number = marketNowMs()) {
  // v9: sessions are also dark on a public holiday, not only on Saturday.
  const closed = isMarketClosed(nowMs);
  const mins = utcMinutes(nowMs);
  return SESSION_DEFS.map((s) => {
    const inWindow =
      s.closeUtc > s.openUtc
        ? mins >= s.openUtc && mins < s.closeUtc
        : mins >= s.openUtc || mins < s.closeUtc;
    const fmt = (m: number) =>
      `${String(Math.floor((m % 1440) / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    return {
      id: s.id,
      city: s.city,
      nameAr: s.nameAr,
      openGmt: fmt(s.openUtc),
      closeGmt: fmt(s.closeUtc),
      isOpen: !closed && inWindow,
      statusAr: closed ? 'مغلق (عطلة)' : inWindow ? 'مفتوح' : 'مغلق',
    };
  });
}

/* ------------------------------------------------------------------ */
/* H4 candle-close analysis schedule                                  */
/* ------------------------------------------------------------------ */
/**
 * WHY H4 AND NOT A DAILY 07:30 MILESTONE
 * The old schedule produced exactly ONE analysis per day at 07:30 Cairo.
 * That is wrong for a 24/5 market: a 4-hour candle closes six times a day and
 * each close is a genuine decision point. A daily-only scan meant the app sat
 * on a stale read for up to 24 hours while price moved through six candles.
 *
 * The new schedule fires on every H4 close:
 *   00:00 · 04:00 · 08:00 · 12:00 · 16:00 · 20:00 UTC
 * (which is 02:00 · 06:00 · 10:00 · 14:00 · 18:00 · 22:00 Cairo in winter).
 *
 * The 08:00 UTC close is the London-open candle and carries extra weight —
 * see LONDON_PRIORITY_* below.
 */
export const H4_CLOSE_HOURS_UTC = [0, 4, 8, 12, 16, 20] as const;
export const H4_INTERVAL_MS = 4 * 60 * 60 * 1000;

/**
 * London priority windows (UTC minutes from midnight).
 *  - 07:00–08:00 UTC: the European cash open. The 08:00 UTC H4 candle is the
 *    first candle that contains the London open, so its close is the single
 *    most informative scan of the day.
 *  - 12:00–13:00 UTC: London / New York overlap, the deepest liquidity.
 */
export const LONDON_OPEN_UTC_MIN = 7 * 60;
export const LONDON_OPEN_END_UTC_MIN = 8 * 60;
export const OVERLAP_UTC_MIN = 12 * 60;
export const OVERLAP_END_UTC_MIN = 13 * 60;

/** Confidence multiplier applied to signals produced by a priority scan. */
export const LONDON_PRIORITY_WEIGHT = 1.15;
export const OVERLAP_PRIORITY_WEIGHT = 1.08;

export type ScanPriority = 'london_open' | 'overlap' | 'standard';

export interface ScanPriorityInfo {
  priority: ScanPriority;
  weight: number;
  labelAr: string;
}

/**
 * Classifies a scan moment. `ms` should be the H4 close instant being scanned.
 */
export function getScanPriority(ms: number): ScanPriorityInfo {
  const d = new Date(ms);
  const mins = d.getUTCHours() * 60 + d.getUTCMinutes();
  if (mins === LONDON_OPEN_END_UTC_MIN) {
    return {
      priority: 'london_open',
      weight: LONDON_PRIORITY_WEIGHT,
      labelAr: 'أولوية لندن — إغلاق شمعة افتتاح السوق الأوروبي',
    };
  }
  if (mins === OVERLAP_UTC_MIN) {
    return {
      priority: 'overlap',
      weight: OVERLAP_PRIORITY_WEIGHT,
      labelAr: 'أولوية عالية — تداخل لندن ونيويورك',
    };
  }
  return { priority: 'standard', weight: 1, labelAr: 'فحص دوري (إغلاق شمعة 4 ساعات)' };
}

/** True when `ms` falls inside the European cash-open hour (07:00–08:00 UTC). */
export function isLondonOpenWindow(ms: number = marketNowMs()): boolean {
  if (isMarketClosed(ms)) return false;
  const mins = utcMinutes(ms);
  return mins >= LONDON_OPEN_UTC_MIN && mins < LONDON_OPEN_END_UTC_MIN;
}

/**
 * The most recent H4 boundary at or before `nowMs`.
 * If `nowMs` sits exactly on a boundary, that boundary is returned (a close
 * has just happened and is eligible to be scanned).
 */
export function getLastH4CloseMs(nowMs: number = marketNowMs()): number {
  const d = new Date(nowMs);
  const h = d.getUTCHours();
  const boundaryHour = Math.floor(h / 4) * 4;
  d.setUTCHours(boundaryHour, 0, 0, 0);
  return d.getTime();
}

/** The next H4 boundary strictly after `nowMs`. */
export function getNextH4CloseMs(nowMs: number = marketNowMs()): number {
  return getLastH4CloseMs(nowMs) + H4_INTERVAL_MS;
}

/** "H4 08:00 UTC" style label for a candle close. */
export function h4CandleLabel(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  return `H4 ${hh}:00 UTC`;
}

/**
 * The last H4 close that actually happened while the market was trading.
 * On a Saturday this resolves to Friday 20:00 UTC — the final close of the
 * week — never to a phantom Saturday close.
 */
export function lastTradingH4CloseMs(nowMs: number = marketNowMs()): number {
  let candidate = getLastH4CloseMs(nowMs);
  // Walk back over closed days (Saturday and any holiday).
  for (let guard = 0; guard < 48; guard++) {
    if (!isMarketClosed(candidate)) return candidate;
    candidate -= H4_INTERVAL_MS;
  }
  return candidate;
}

/**
 * The next moment a scan should run.
 *
 *  - Market open  -> the next H4 close.
 *  - Market closed -> the week-open instant (Sunday 21:00 UTC), because the
 *    first candle of the new week starts there and waiting for the following
 *    00:00 UTC boundary would leave the open unscanned for three hours.
 *
 * This is the "defer to the first candle after the open" rule.
 */
export function nextAnalysisMs(nowMs: number = marketNowMs()): number {
  if (!isMarketClosed(nowMs)) return getNextH4CloseMs(nowMs);

  // Closed: defer to the first H4 close at or after the reopen instant.
  // The reopen (an open Cairo midnight) is not itself an H4 boundary in UTC,
  // so returning it directly would schedule a scan at a moment no candle
  // closes.
  const reopen = nextMarketOpenMs(nowMs);
  const lastBoundary = getLastH4CloseMs(reopen);
  return lastBoundary >= reopen ? lastBoundary : lastBoundary + H4_INTERVAL_MS;
}

/** Milliseconds until the next scan. */
export function msUntilNextAnalysis(nowMs: number = marketNowMs()): number {
  return Math.max(0, nextAnalysisMs(nowMs) - nowMs);
}

export interface AnalysisSchedule {
  /** Last scan that actually ran (or should have run), in ms. */
  lastCheckMs: number;
  /** Next scheduled scan, in ms. */
  nextCheckMs: number;
  msUntilNext: number;
  marketOpen: boolean;
  /** True when the next scan is the week-open catch-up rather than an H4 close. */
  deferredFromWeekend: boolean;
  nextPriority: ScanPriorityInfo;
  lastPriority: ScanPriorityInfo;
  /** Arabic one-liner describing the next scan. */
  nextLabelAr: string;
  /** Arabic one-liner describing the last scan. */
  lastLabelAr: string;
}

/**
 * Everything the UI needs to render "last scan / next scan / countdown".
 * Single call, single source of truth — no component recomputes this itself.
 */
export function getAnalysisSchedule(nowMs: number = marketNowMs()): AnalysisSchedule {
  const clock = getMarketClock(nowMs);
  const open = clock.isOpen;
  const lastCheckMs = lastTradingH4CloseMs(nowMs);
  const nextCheckMs = nextAnalysisMs(nowMs);
  const deferred = !open;

  const nextPriority = deferred
    ? {
        priority: 'standard' as ScanPriority,
        weight: 1,
        labelAr: 'فحص افتتاح الأسبوع — أول شمعة بعد إعادة فتح السوق',
      }
    : getScanPriority(nextCheckMs);

  const lastPriority = getScanPriority(lastCheckMs);

  return {
    lastCheckMs,
    nextCheckMs,
    msUntilNext: Math.max(0, nextCheckMs - nowMs),
    marketOpen: open,
    deferredFromWeekend: deferred,
    nextPriority,
    lastPriority,
    nextLabelAr: deferred
      ? 'فحص افتتاح الأسبوع (مؤجَّل من العطلة)'
      : `${h4CandleLabel(nextCheckMs)} — ${nextPriority.labelAr}`,
    lastLabelAr: `${h4CandleLabel(lastCheckMs)} — ${lastPriority.labelAr}`,
  };
}

/**
 * Applies the session weight to a raw confidence score.
 * Clamped to 0–100 so a boosted score can never exceed the scale.
 */
export function applyScanWeight(confidence: number, weight: number): number {
  if (!Number.isFinite(confidence)) return 0;
  return Math.max(0, Math.min(100, Math.round(confidence * weight)));
}
