/**
 * Display timezone — user-level preference stored in localStorage.
 *
 * Empty / absent = "Same as browser" (the default): the date formatters omit
 * the `timeZone` option so `Intl` uses the browser/OS zone. A stored IANA zone
 * id (e.g. `Asia/Tokyo`) overrides that for display only — this affects
 * rendering, not data.
 *
 * Consumed by formatDate.ts (the actual Intl formatters).
 */

export const TZ_STORAGE_KEY = 'agdb_tz'

/** `<select>` sentinel for "same as browser" (empty value). */
export const BROWSER_TZ = ''

// TS lib may predate Intl.supportedValuesOf; narrow the cast instead of `any`.
type IntlWithSupported = typeof Intl & {
  supportedValuesOf?: (key: 'timeZone') => string[]
}

/** Validate an IANA zone id by attempting to construct a formatter. */
export function isValidTimeZone(tz: string): boolean {
  if (!tz) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/** The stored preference, or `undefined` for "same as browser" (also returned
 *  when the stored value is missing, invalid, or storage is unreadable). */
export function getStoredTimeZone(): string | undefined {
  try {
    const v = localStorage.getItem(TZ_STORAGE_KEY)
    return v && isValidTimeZone(v) ? v : undefined
  } catch {
    return undefined
  }
}

/** Persist the preference. `undefined` / '' clears it (back to browser zone). */
export function storeTimeZone(tz: string | undefined): void {
  try {
    if (tz) localStorage.setItem(TZ_STORAGE_KEY, tz)
    else localStorage.removeItem(TZ_STORAGE_KEY)
  } catch {
    // private-mode / disabled storage — the preference simply won't persist.
  }
}

/** Full IANA zone list (engine-sorted). Falls back to a small common set on
 *  engines without `Intl.supportedValuesOf` (older Safari). */
export function listTimeZones(): string[] {
  const sv = (Intl as IntlWithSupported).supportedValuesOf
  if (typeof sv === 'function') {
    try {
      const zones = sv('timeZone')
      // Some ICU builds omit the plain `UTC` alias (canonical names only);
      // surface it explicitly so users who want UTC can pick it.
      return zones.includes('UTC') ? zones : ['UTC', ...zones]
    } catch {
      // fall through to the static fallback
    }
  }
  return [
    'UTC', 'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Seoul', 'Asia/Kolkata',
    'Europe/London', 'Europe/Paris', 'America/New_York', 'America/Los_Angeles',
  ]
}

/** The browser/OS resolved zone — used for the "Same as browser (…)" label. */
export function browserTimeZone(): string {
  try {
    return new Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}
