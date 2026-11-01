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
/* Forex week boundary (UTC)                                          */
/* ------------------------------------------------------------------ */
/**
 * Forex is a 24/5 market. The conventional institutional window is:
 *   open   Sunday    21:00 UTC   (Sydney/Monday session open)
 *   close  Friday    21:00 UTC
 * So the market is closed for the whole of Saturday and until Sunday 21:00 UTC.
 *
 * NOTE: this is the *standard* rule, not a broker-specific holiday calendar.
 * If your broker keeps different hours, change ONLY these three constants.
 */
export const WEEK_OPEN_UTC_HOUR = 21; // Sunday 21:00 UTC
export const WEEK_CLOSE_UTC_HOUR = 21; // Friday 21:00 UTC
export const WEEK_CLOSE_UTC_DAY = 5; // Friday
export const WEEK_OPEN_UTC_DAY = 0; // Sunday

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
/* Primitive helpers                                                  */
/* ------------------------------------------------------------------ */

export function isValidDate(input: unknown): input is string {
  if (typeof input !== 'string' || !input) return false;
  const ms = new Date(input).getTime();
  return Number.isFinite(ms);
}

/** UTC weekday: 0=Sunday … 6=Saturday */
function utcDay(ms: number): number {
  return new Date(ms).getUTCDay();
}

/** UTC minutes since midnight */
function utcMinutes(ms: number): number {
  const d = new Date(ms);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/* ------------------------------------------------------------------ */
/* Weekend / session state                                            */
/* ------------------------------------------------------------------ */

/**
 * True when the FX week is closed (Saturday, or Friday after close, or
 * Sunday before open). Deliberately explicit rather than a `getDay() === 6`.
 */
export function isForexWeekend(nowMs: number = Date.now()): boolean {
  const day = utcDay(nowMs);
  const mins = utcMinutes(nowMs);

  if (day === 6) return true; // Saturday — always closed
  if (day === WEEK_CLOSE_UTC_DAY && mins >= WEEK_CLOSE_UTC_HOUR * 60) return true; // Friday evening
  if (day === WEEK_OPEN_UTC_DAY && mins < WEEK_OPEN_UTC_HOUR * 60) return true; // Sunday before open
  return false;
}

/** True when the FX market is trading right now. */
export function isMarketOpen(nowMs: number = Date.now()): boolean {
  return !isForexWeekend(nowMs);
}

/** Which named session is live right now (null when the week is closed). */
export function getActiveSessionId(nowMs: number = Date.now()): string | null {
  if (isForexWeekend(nowMs)) return null;
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

/** Next moment the week opens, in ms (Sunday 21:00 UTC). */
export function nextWeekOpenMs(nowMs: number = Date.now()): number {
  const d = new Date(nowMs);
  d.setUTCHours(WEEK_OPEN_UTC_HOUR, 0, 0, 0);
  // Advance to the next Sunday at or after now.
  while (d.getUTCDay() !== WEEK_OPEN_UTC_DAY || d.getTime() <= nowMs) {
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return d.getTime();
}

/**
 * The most recent moment the market actually opened (or re-opened after the
 * weekend). Used to stamp a truthful `activated_at` on freshly seeded signals
 * instead of pretending they activated at a hard-coded 07:30.
 */
export function lastSessionOpenMs(nowMs: number = Date.now()): number {
  // Walk backwards to the most recent moment a *trading day* opened.
  // A "trading day open" is 07:00 UTC (London open) on a weekday.
  // This is what a seed signal should be stamped with: on a Saturday it
  // resolves to Friday 07:00 UTC, not to last Sunday's week open.
  const d = new Date(nowMs);
  d.setUTCHours(7, 0, 0, 0);
  if (d.getTime() > nowMs) d.setUTCDate(d.getUTCDate() - 1);

  // Step back over Saturday/Sunday and over Friday-after-close.
  for (let guard = 0; guard < 10; guard++) {
    const day = d.getUTCDay();
    const mins = d.getUTCHours() * 60 + d.getUTCMinutes();
    const isClosedMoment =
      day === 6 ||
      day === 0 ||
      (day === WEEK_CLOSE_UTC_DAY && mins >= WEEK_CLOSE_UTC_HOUR * 60);
    if (!isClosedMoment) return d.getTime();
    d.setUTCDate(d.getUTCDate() - 1);
    d.setUTCHours(7, 0, 0, 0);
  }
  return d.getTime();
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

export function getCairoParts(nowMs: number = Date.now()): CairoParts {
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
export function cairoDateYmd(nowMs: number = Date.now()): string {
  return getCairoParts(nowMs).date;
}

/** The UTC instant that starts "today" in Cairo. Use for DB range filters. */
export function cairoDayStartUtcIso(nowMs: number = Date.now()): string {
  const parts = getCairoParts(nowMs);
  const offsetMin = parseOffsetMinutes(parts.offsetLabel);
  const [y, m, d] = parts.date.split('-').map(Number);
  // Cairo midnight expressed in UTC = midnight - offset
  const utcMidnight = Date.UTC(y, m - 1, d, 0, 0, 0, 0) - offsetMin * 60_000;
  return new Date(utcMidnight).toISOString();
}

/** The UTC instant that ends "today" in Cairo (exclusive). */
export function cairoDayEndUtcIso(nowMs: number = Date.now()): string {
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
  if (isForexWeekend(nowMs)) return 'stale';

  return 'active';
}

/** True if the timestamp should never be rendered as a live activation. */
export function isFutureTimestamp(iso?: string | null, nowMs: number = Date.now()): boolean {
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
  isWeekend: boolean;
  isOpen: boolean;
  activeSessionId: string | null;
  /** Human-readable Arabic reason when closed */
  closedReasonAr: string | null;
  nextOpenMs: number;
  lastOpenMs: number;
  dayStartUtcIso: string;
  dayEndUtcIso: string;
  /** ISO for "the moment this trading day opened", or null when closed */
  sessionOpenIso: string | null;
}

export function getMarketClock(nowMs: number = Date.now()): MarketClock {
  const weekend = isForexWeekend(nowMs);
  const open = !weekend;
  const cairo = getCairoParts(nowMs);
  const dow = utcDay(nowMs);

  let closedReasonAr: string | null = null;
  if (weekend) {
    if (dow === 6) closedReasonAr = 'السوق مغلق — اليوم سبت (عطلة نهاية الأسبوع في سوق العملات)';
    else if (dow === 5) closedReasonAr = 'السوق مغلق — انتهى تداول الأسبوع يوم الجمعة 21:00 بتوقيت جرينتش';
    else closedReasonAr = 'السوق مغلق — يُفتح تداول الأسبوع يوم الأحد 21:00 بتوقيت جرينتش';
  }

  return {
    nowMs,
    cairo,
    date: cairo.date,
    isWeekend: weekend,
    isOpen: open,
    activeSessionId: getActiveSessionId(nowMs),
    closedReasonAr,
    nextOpenMs: nextWeekOpenMs(nowMs),
    lastOpenMs: lastSessionOpenMs(nowMs),
    dayStartUtcIso: cairoDayStartUtcIso(nowMs),
    dayEndUtcIso: cairoDayEndUtcIso(nowMs),
    sessionOpenIso: open ? new Date(lastSessionOpenMs(nowMs)).toISOString() : null,
  };
}

/** Live session rows for the header chips. */
export function getMarketSessions(nowMs: number = Date.now()) {
  const weekend = isForexWeekend(nowMs);
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
      isOpen: !weekend && inWindow,
      statusAr: weekend ? 'مغلق (عطلة)' : inWindow ? 'مفتوح' : 'مغلق',
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
export function isLondonOpenWindow(ms: number = Date.now()): boolean {
  if (isForexWeekend(ms)) return false;
  const mins = utcMinutes(ms);
  return mins >= LONDON_OPEN_UTC_MIN && mins < LONDON_OPEN_END_UTC_MIN;
}

/**
 * The most recent H4 boundary at or before `nowMs`.
 * If `nowMs` sits exactly on a boundary, that boundary is returned (a close
 * has just happened and is eligible to be scanned).
 */
export function getLastH4CloseMs(nowMs: number = Date.now()): number {
  const d = new Date(nowMs);
  const h = d.getUTCHours();
  const boundaryHour = Math.floor(h / 4) * 4;
  d.setUTCHours(boundaryHour, 0, 0, 0);
  return d.getTime();
}

/** The next H4 boundary strictly after `nowMs`. */
export function getNextH4CloseMs(nowMs: number = Date.now()): number {
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
export function lastTradingH4CloseMs(nowMs: number = Date.now()): number {
  let candidate = getLastH4CloseMs(nowMs);
  // Walk back over the closed week (max 3 days of boundaries).
  for (let guard = 0; guard < 24; guard++) {
    if (!isForexWeekend(candidate)) return candidate;
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
export function nextAnalysisMs(nowMs: number = Date.now()): number {
  if (isForexWeekend(nowMs)) return nextWeekOpenMs(nowMs);
  return getNextH4CloseMs(nowMs);
}

/** Milliseconds until the next scan. */
export function msUntilNextAnalysis(nowMs: number = Date.now()): number {
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
export function getAnalysisSchedule(nowMs: number = Date.now()): AnalysisSchedule {
  const open = !isForexWeekend(nowMs);
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
