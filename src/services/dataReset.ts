/**
 * Single source of truth for "wipe every stored signal".
 *
 * The reset button used to lie. Three independent paths could resurrect the
 * rows it had just deleted:
 *
 *   1. `handleResetAndRescan` only called `localStorage.removeItem(...)`. It
 *      never touched Supabase, so the very next `getTodaySignals()` pulled the
 *      same rows straight back.
 *   2. The persist effect wrote `JSON.stringify([])` — the string "[]". On the
 *      next load the state initialiser saw an empty array, decided there was
 *      nothing usable, and fell through to `buildSeedSignals()`. An empty array
 *      and "the user deliberately emptied this" looked identical.
 *   3. The mount-sync effect (`getTodaySignals()` on first render) and the
 *      scheduler callbacks re-populated state from the database after the
 *      wipe, with no idea a wipe had happened.
 *
 * This module fixes all three: one cleared marker that survives reloads, one
 * purge epoch that every DB-sync path respects, and one function that wipes
 * BOTH stores.
 */

import { deleteAllSignalsFromSupabaseDetailed } from './signalRepository';

/** Marker written to a key the user deliberately emptied. */
export const CLEARED_MARKER = JSON.stringify({ cleared: true, at: 0 });

/** Epoch (ms) of the most recent purge; 0 when the app has never been purged. */
export const PURGE_EPOCH_KEY = 'alphafx_data_purged_at';

/**
 * v11 — the reset lock.
 *
 * The cleared marker answers "is the list deliberately empty?". The lock
 * answers a different question: "may anything refill it on its own?".
 *
 * They are separate because the two answers diverge. A user who presses reset
 * wants an empty list that STAYS empty — the H4 scheduler must not quietly
 * regenerate opportunities four hours later, and the hourly settlement must
 * not re-hydrate rows. But the same user may still press "تشغيل التحليل"
 * on purpose, and that must work.
 *
 * So: the lock blocks AUTOMATIC refills only. Any explicit user action clears
 * it. That is the whole contract.
 */
export const RESET_LOCK_KEY = 'alphafx_reset_lock';

export const SIGNAL_STATE_KEYS = [
  'alphafx_today_signals',
  'alphafx_historical_signals',
] as const;

/** Credential leftovers from older builds. Never survives a purge. */
export const LEGACY_SECRET_KEYS = [
  'alphafx_api_config',
  'alphafx_alltick_token',
  'alphafx_twelvedata_key',
  'alphafx_finnhub_key',
] as const;

/** Preferences that are not data and are legitimately kept across a purge. */
export const PREFERENCE_KEYS = ['alphafx_provider_pref'] as const;

export interface PurgeOptions {
  /** Also clear provider preference + UI preferences. */
  includePreferences?: boolean;
  /** Call Supabase delete. Default true. */
  remote?: boolean;
}

export interface PurgeReport {
  localKeysRemoved: number;
  /** True only when the database actually confirmed the delete. */
  remoteCleared: boolean;
  /** False when Supabase is not configured at all (nothing to delete). */
  remoteConfigured: boolean;
  /** Provider error text when the delete was attempted and failed. */
  remoteError?: string;
  epoch: number;
}

/** True while automatic refills are blocked after a reset. */
export function isResetLocked(): boolean {
  try {
    const raw = localStorage.getItem(RESET_LOCK_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return Boolean(parsed && parsed.locked === true);
  } catch {
    return false;
  }
}

/** Blocks automatic refills. Called by every purge. */
export function setResetLock(): void {
  try {
    localStorage.setItem(RESET_LOCK_KEY, JSON.stringify({ locked: true, at: Date.now() }));
  } catch {
    /* storage disabled — the in-memory cleared marker still applies */
  }
}

/**
 * Releases the lock. Called ONLY by an explicit user action that is meant to
 * produce signals again (manual scan, restore-defaults button).
 */
export function clearResetLock(): void {
  try {
    localStorage.removeItem(RESET_LOCK_KEY);
  } catch {
    /* ignore */
  }
}

/** Reads the purge epoch, tolerating a corrupted/garbage value. */
export function getPurgeEpoch(): number {
  try {
    const raw = localStorage.getItem(PURGE_EPOCH_KEY);
    if (!raw) return 0;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

/** True when the stored value is our "deliberately emptied" marker. */
export function isClearedMarker(raw: string | null | undefined): boolean {
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw);
    return Boolean(parsed && typeof parsed === 'object' && parsed.cleared === true);
  } catch {
    return false;
  }
}

/**
 * Writes the cleared marker into both signal keys and records the purge epoch.
 * Call this BEFORE any state change so a page reload mid-flight cannot reseed.
 */
export function writeClearedMarkers(): number {
  const epoch = Date.now();
  try {
    localStorage.setItem(PURGE_EPOCH_KEY, String(epoch));
    for (const key of SIGNAL_STATE_KEYS) {
      localStorage.setItem(key, JSON.stringify({ cleared: true, at: epoch }));
    }
  } catch (err) {
    console.warn('[dataReset] could not write cleared markers', err);
  }
  return epoch;
}

/** Removes every storage key this app owns (secrets first, data second). */
function removeLocalKeys(includePreferences: boolean): number {
  let removed = 0;
  const drop = (key: string) => {
    try {
      localStorage.removeItem(key);
      removed += 1;
    } catch {
      /* storage disabled — nothing to remove */
    }
  };

  for (const key of LEGACY_SECRET_KEYS) drop(key);
  for (const key of SIGNAL_STATE_KEYS) drop(key);
  if (includePreferences) {
    for (const key of PREFERENCE_KEYS) drop(key);
    drop('alphafx_last_scanned_h4_close');
    drop('alphafx_analysis_last_run_date');
  }

  // Belt and braces: sweep any remaining alphafx_* key we did not name, so a
  // future build cannot leave a stale cache behind that this build cannot see.
  try {
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith('alphafx_')) continue;
      if (key === PURGE_EPOCH_KEY) continue;
      if (!includePreferences) {
        if ((PREFERENCE_KEYS as readonly string[]).includes(key)) continue;
        if (key === 'alphafx_last_scanned_h4_close') continue;
        if (key === 'alphafx_analysis_last_run_date') continue;
      }
      drop(key);
    }
  } catch {
    /* localStorage enumeration unsupported */
  }

  return removed;
}

/**
 * Wipes signals from BOTH stores and leaves a durable "cleared" marker so the
 * app can never re-seed on the next load.
 */
export async function purgeAllSignals(options: PurgeOptions = {}): Promise<PurgeReport> {
  const { includePreferences = false, remote = true } = options;

  const localKeysRemoved = removeLocalKeys(includePreferences);
  const epoch = writeClearedMarkers();
  // Lock BEFORE the network call: a scheduler tick that fires while the delete
  // is in flight must already see the lock, not race it.
  setResetLock();

  let remoteCleared = false;
  let remoteConfigured = false;
  let remoteError: string | undefined;

  if (remote) {
    try {
      const result = await deleteAllSignalsFromSupabaseDetailed();
      remoteCleared = result.ok;
      remoteConfigured = result.configured;
      remoteError = result.error;
    } catch (err: any) {
      remoteError = err?.message || String(err);
      console.warn('[dataReset] remote delete threw', err);
    }
  }

  return { localKeysRemoved, remoteCleared, remoteConfigured, remoteError, epoch };
}

/**
 * Guard used by every path that pulls signals from the database.
 *
 * Returns true when a purge happened after `startedAt`, meaning the caller's
 * in-flight result is stale and must be discarded instead of written to state.
 */
export function isResultStale(resultStartedAt: number): boolean {
  const epoch = getPurgeEpoch();
  return epoch > 0 && resultStartedAt < epoch;
}
