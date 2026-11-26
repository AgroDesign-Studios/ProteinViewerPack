// Date / time formatting for AgDB.
//
// Dates are SI-exempt (DESIGN.md §2.5 — formatSI is for counts/measurements,
// not timestamps), but they must still be consistent across the app. Per
// frontend-best-practices §6, format via `Intl.DateTimeFormat` with an explicit
// locale — never a bare `toLocaleString()` (locale-dependent output) or
// `String(date)`.
//
// Display timezone: by default the browser/OS zone (no `timeZone` option). The
// zone can be overridden through `setDisplayTimeZone` (stored in localStorage
// as `agdb_tz`). This only changes rendering.
import { getStoredTimeZone } from './displayTimeZone'

const LOCALE = 'ja-JP'

// undefined = "same as browser" → omit `timeZone` so Intl uses the browser zone.
let _timeZone: string | undefined = getStoredTimeZone()

function withTz(opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormatOptions {
  return _timeZone ? { ...opts, timeZone: _timeZone } : opts
}

let _dateTimeFmt: Intl.DateTimeFormat
let _dateTimeSecFmt: Intl.DateTimeFormat
let _dateFmt: Intl.DateTimeFormat
let _timeFmt: Intl.DateTimeFormat
let _timeSecFmt: Intl.DateTimeFormat
let _yearMonthFmt: Intl.DateTimeFormat
let _isoPartsFmt: Intl.DateTimeFormat
let _longJaFmt: Intl.DateTimeFormat
let _longEnFmt: Intl.DateTimeFormat

function buildFormatters(): void {
  _dateTimeFmt = new Intl.DateTimeFormat(LOCALE, withTz({
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }))
  // Seconds-precision sibling of _dateTimeFmt — see formatDateTimeSec.
  // `hourCycle: 'h23'` rather than `hour12: false` for the reason spelled out
  // on the long formatters below: the two are NOT synonyms, and `hour12: false`
  // resolves to `h24` in some ICU builds, rendering midnight as `24:00` on the
  // previous day's date.
  _dateTimeSecFmt = new Intl.DateTimeFormat(LOCALE, withTz({
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }))
  _dateFmt = new Intl.DateTimeFormat(LOCALE, withTz({
    year: 'numeric', month: '2-digit', day: '2-digit',
  }))
  _timeFmt = new Intl.DateTimeFormat(LOCALE, withTz({
    hour: '2-digit', minute: '2-digit', hour12: false,
  }))
  // Seconds-precision sibling of _timeFmt — see formatTimeSec. `hourCycle: 'h23'`
  // for the reason given on _dateTimeSecFmt (midnight must read 00, never 24).
  _timeSecFmt = new Intl.DateTimeFormat(LOCALE, withTz({
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }))
  _yearMonthFmt = new Intl.DateTimeFormat(LOCALE, withTz({
    year: 'numeric', month: '2-digit',
  }))
  // Read through formatToParts only (see localIsoDate), so the locale's own
  // separators never reach the output.
  _isoPartsFmt = new Intl.DateTimeFormat('en-US', withTz({
    year: 'numeric', month: '2-digit', day: '2-digit',
  }))
  // Long form — see formatDateTimeLong. Assembled from `formatToParts`, not from
  // a `dateStyle`, because the requested Japanese shape zero-pads the month and
  // day (`2026年07月28日`) while every `ja-JP` dateStyle drops the padding
  // (`2026年7月28日`). `hourCycle: 'h23'` rather than `hour12: false`: the two
  // are NOT synonyms — `hour12: false` resolves to `h24` in some ICU builds,
  // which renders midnight as `24:00` on the PREVIOUS day's date.
  _longJaFmt = new Intl.DateTimeFormat('ja-JP', withTz({
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }))
  _longEnFmt = new Intl.DateTimeFormat('en-GB', withTz({
    year: 'numeric', month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }))
}
buildFormatters()

/**
 * Set the display timezone for every formatter. `undefined` / '' restores the
 * browser/OS zone. Rebuilds the memoized `Intl` formatters in place, so views
 * rendered after the call pick up the change; nodes already on screen update on
 * their next render (a navigation or page refresh refreshes everything).
 */
export function setDisplayTimeZone(tz: string | undefined): void {
  _timeZone = tz || undefined
  buildFormatters()
}

/** The active display timezone, or `undefined` for "same as browser". */
export function getDisplayTimeZone(): string | undefined {
  return _timeZone
}

/** Format an ISO timestamp as `YYYY/MM/DD HH:mm`. Returns `-` for null /
 *  undefined / empty / unparseable input so callers can render it directly. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '-'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '-'
  return _dateTimeFmt.format(d)
}

/**
 * Format an ISO timestamp as `YYYY/MM/DD HH:mm:ss` — `formatDateTime` plus
 * seconds, for a list where two events routinely share a minute and their
 * ORDER is the information (an event log, for one). Honours the
 * `agdb_tz` display override like every other formatter here, which is why a
 * page that needs seconds calls this rather than build its own
 * `Intl.DateTimeFormat` (DESIGN.md §10 DATE-1 tracks that class of bypass).
 * Returns `-` for null / undefined / empty / unparseable input.
 */
export function formatDateTimeSec(iso: string | null | undefined): string {
  if (!iso) return '-'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '-'
  return _dateTimeSecFmt.format(d)
}

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * Format a calendar date — a bare `YYYY-MM-DD` — as `YYYY/MM/DD`, the same shape
 * as `formatDate`, without moving it through any time zone. `new Date('2026-04-01')`
 * is UTC midnight, so formatting it in a display zone west of UTC showed
 * 2026/03/31 (PT-6295 item 2). Returns `-` for null / undefined / empty input
 * and for anything that is not a real calendar date.
 */
export function formatCalendarDate(value: string | null | undefined): string {
  if (!value) return '-'
  const m = CALENDAR_DATE.exec(value)
  if (!m) return '-'
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  // A calendar date has no time zone: it is only checked here (as UTC midnight)
  // and never formatted through a zone, so no display zone can move it a day.
  // setUTCFullYear, not Date.UTC: Date.UTC reads years 0-99 as 1900-1999, so a
  // valid 0050-01-01 failed the check below (PT-6733 item 4).
  const date = new Date(0)
  date.setUTCFullYear(y, mo - 1, d)
  // A day past the month's end rolls over (2026-02-31 → March): no date.
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return '-'
  // Shown as the digits it was given, in formatDate's YYYY/MM/DD shape. Intl
  // would write year 50 as "50" and year 0 as "1" (1 BC, era dropped).
  return `${m[1]}/${m[2]}/${m[3]}`
}

/** Format an ISO timestamp as `YYYY/MM/DD` (date only, no time) in the display
 *  zone. A bare calendar date (`YYYY-MM-DD`) is no instant and is shown as
 *  itself, through `formatCalendarDate`, never shifted by the zone. Returns `-`
 *  for null / undefined / empty / unparseable input. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '-'
  if (CALENDAR_DATE.test(iso)) return formatCalendarDate(iso)
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '-'
  return _dateFmt.format(d)
}

/** Format an ISO timestamp as `HH:mm` (time only). For compact displays (e.g.
 *  a list of steps within one day); pair with `formatDateTime` as a hover title
 *  for the full date. Returns `-` for null / undefined / empty / unparseable. */
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '-'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '-'
  return _timeFmt.format(d)
}

/** Format a timestamp as `HH:mm:ss` (time only, with seconds) in the display zone —
 *  `formatTime` plus seconds, for a time axis whose whole visible window is a
 *  few minutes, where two ticks routinely share a minute. Takes an ISO
 *  string, a ms epoch or a Date. Returns `-` for null /
 *  undefined / empty / unparseable input. */
export function formatTimeSec(value: string | number | Date | null | undefined): string {
  if (value == null || value === '') return '-'
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return '-'
  return _timeSecFmt.format(d)
}

/** Format an ISO timestamp as `YYYY/MM` (year and month only). Returns `-`
 *  for null / undefined / empty / unparseable input. */
export function formatYearMonth(iso: string | null | undefined): string {
  if (!iso) return '-'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '-'
  return _yearMonthFmt.format(d)
}

/** Look one part out of a formatted date, or '' when the engine omitted it. */
function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find(p => p.type === type)?.value ?? ''
}

/**
 * The calendar date of `d` in the display timezone, as `YYYY-MM-DD` — the
 * shape an `<input type="date">` value, a DATE column and a file-name stamp
 * all take. Defaults to now, so `localIsoDate()` is "today" as the user reads
 * it.
 *
 * Never `d.toISOString().slice(0, 10)`: that is the UTC date, which in JST is
 * still yesterday until 09:00 (PT-831). An invalid `Date` gives `-`, like the
 * other formatters here, rather than Intl's RangeError (PT-1229 item 5).
 */
export function localIsoDate(d: Date = new Date()): string {
  if (Number.isNaN(d.getTime())) return '-'
  const p = _isoPartsFmt.formatToParts(d)
  return `${part(p, 'year')}-${part(p, 'month')}-${part(p, 'day')}`
}

const _jstDateFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/**
 * The calendar date of `d` in Asia/Tokyo, as `YYYY-MM-DD` — NOT the display
 * timezone. For comparing a timestamp with a date computed in JST
 * (e.g. a "today" computed in Asia/Tokyo), where `localIsoDate` would disagree in any
 * other display zone.
 */
export function jstIsoDate(d: Date): string {
  const p = _jstDateFmt.formatToParts(d)
  return `${part(p, 'year')}-${part(p, 'month')}-${part(p, 'day')}`
}

/**
 * Format an ISO timestamp in the long, spelled-out form used where a timestamp
 * is the readable label of a thing rather than a table cell, such as each
 * entry of a message log.
 *
 * A `ja` PRIMARY SUBTAG (the default, so `ja` / `ja-JP` / `JA` all qualify) →
 * `2026年07月28日22:47`: 4-digit year, zero-padded month / day / hour / minute, and
 * no space before the clock. Any other language → `28 Jul 2026 22:47`, which
 * keeps the same day-month-year-clock reading order without the CJK units.
 *
 * Honours the display-timezone override like every other formatter here.
 * Returns `-` for null / undefined / empty / unparseable input so callers can
 * render it directly.
 */
export function formatDateTimeLong(iso: string | null | undefined, lang: string = 'ja'): string {
  if (!iso) return '-'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '-'
  // Compare the PRIMARY SUBTAG, not the whole tag: `ja-JP` (or `JA`) must not
  // fall through to the English shape. This is an exported helper taking an
  // arbitrary string — relying on a caller's normalisation would make a regional
  // tag silently render Japanese timestamps in English.
  if (lang.toLowerCase().split('-')[0] === 'ja') {
    const p = _longJaFmt.formatToParts(d)
    return `${part(p, 'year')}年${part(p, 'month')}月${part(p, 'day')}日${part(p, 'hour')}:${part(p, 'minute')}`
  }
  const p = _longEnFmt.formatToParts(d)
  return `${part(p, 'day')} ${part(p, 'month')} ${part(p, 'year')} ${part(p, 'hour')}:${part(p, 'minute')}`
}

/** Format an elapsed duration (milliseconds) as `MM m SS s` — minutes and
 *  seconds only, never rolling up to hours (so a 2-hour-5-minute run reads
 *  `125 m 03 s`, not `2h 05m`). A half-width ASCII space separates each number
 *  from its unit (`m` / `s`), matching the SI spacing used elsewhere in the app.
 *  Minutes are zero-padded to at least two digits and grow as needed; seconds
 *  are always two digits. Sub-second durations render as `00 m 00 s`. Returns
 *  `null` for null / undefined / NaN / negative input so callers can decide
 *  their own placeholder. */
export function formatDurationMinSec(ms: number | null | undefined): string | null {
  if (ms == null || Number.isNaN(ms) || ms < 0) return null
  const totalSec = Math.round(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(m)} m ${pad(s)} s`
}

/** Milliseconds between two ISO timestamps, or `null` if either is missing /
 *  unparseable or the interval is negative (clock skew / out-of-order stamps).
 *  Used to derive per-step durations from completion timestamps. */
export function durationBetween(
  fromIso: string | null | undefined,
  toIso: string | null | undefined,
): number | null {
  if (!fromIso || !toIso) return null
  const from = new Date(fromIso).getTime()
  const to = new Date(toIso).getTime()
  if (Number.isNaN(from) || Number.isNaN(to)) return null
  const ms = to - from
  return ms < 0 ? null : ms
}
