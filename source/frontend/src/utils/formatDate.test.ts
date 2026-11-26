import { describe, it, expect, afterEach } from 'vitest'
import {
  formatCalendarDate,
  formatDate,
  formatDateTime,
  formatDateTimeLong,
  formatTime,
  formatTimeSec,
  formatDurationMinSec,
  formatYearMonth,
  durationBetween,
  getDisplayTimeZone,
  localIsoDate,
  setDisplayTimeZone,
} from './formatDate'

// PT-831: these pin the display zone, because the bug they guard is a UTC
// calendar date leaking into a JST display.
describe('formatYearMonth', () => {
  afterEach(() => setDisplayTimeZone(undefined))

  it('returns a dash for null / undefined / empty / unparseable', () => {
    expect(formatYearMonth(null)).toBe('-')
    expect(formatYearMonth(undefined)).toBe('-')
    expect(formatYearMonth('')).toBe('-')
    expect(formatYearMonth('not-a-date')).toBe('-')
  })

  it('takes the month in the display zone, not the UTC month', () => {
    setDisplayTimeZone('Asia/Tokyo')
    // 2026-05-31T20:00Z is 2026-06-01 05:00 in Tokyo.
    expect(formatYearMonth('2026-05-31T20:00:00Z')).toBe('2026/06')
  })
})

describe('localIsoDate', () => {
  afterEach(() => setDisplayTimeZone(undefined))

  it('returns the display-zone calendar date as YYYY-MM-DD', () => {
    setDisplayTimeZone('Asia/Tokyo')
    // 2026-05-27T23:30Z is already the 28th in Tokyo; the UTC slice says 27.
    expect(localIsoDate(new Date('2026-05-27T23:30:00Z'))).toBe('2026-05-28')
  })

  it('follows a zone west of UTC as well', () => {
    setDisplayTimeZone('America/New_York')
    expect(localIsoDate(new Date('2026-05-28T02:00:00Z'))).toBe('2026-05-27')
  })

  it('defaults to now', () => {
    expect(localIsoDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('renders an invalid Date as a dash instead of throwing (PT-1229 item 5)', () => {
    // A caller may pass a Date built from a missing field; Intl throws RangeError on NaN.
    expect(localIsoDate(new Date('not a date'))).toBe('-')
  })
})

describe('formatDate in the display zone', () => {
  afterEach(() => setDisplayTimeZone(undefined))

  it('renders the Tokyo calendar date for an early-morning JST event', () => {
    setDisplayTimeZone('Asia/Tokyo')
    // JST 2026-05-28 03:00 — the old .slice(0, 10) rendered 2026-05-27.
    expect(formatDate('2026-05-27T18:00:00+00:00')).toBe('2026/05/28')
    expect(formatDateTime('2026-05-27T18:00:00+00:00')).toBe('2026/05/28 03:00')
  })
})

// PT-6295 item 2: a DATE column's value is a calendar date, not an instant.
describe('calendar dates', () => {
  afterEach(() => setDisplayTimeZone(undefined))

  it('keeps the day in a display zone west of UTC', () => {
    setDisplayTimeZone('America/Los_Angeles')
    // As an instant, 2026-04-01 is UTC midnight: 2026/03/31 in Los Angeles.
    expect(formatCalendarDate('2026-04-01')).toBe('2026/04/01')
    expect(formatDate('2026-04-01')).toBe('2026/04/01')
    // A timestamp still follows the display zone.
    expect(formatDate('2026-04-01T00:00:00Z')).toBe('2026/03/31')
  })

  it('keeps the day east of UTC too', () => {
    setDisplayTimeZone('Pacific/Kiritimati')
    expect(formatDate('2026-12-31')).toBe('2026/12/31')
  })

  it('returns a dash for empty input and for what is no calendar date', () => {
    expect(formatCalendarDate(null)).toBe('-')
    expect(formatCalendarDate(undefined)).toBe('-')
    expect(formatCalendarDate('')).toBe('-')
    expect(formatCalendarDate('2026-02-31')).toBe('-')
    expect(formatCalendarDate('2026-13-01')).toBe('-')
    expect(formatCalendarDate('2026-04-01T00:00:00Z')).toBe('-')
    expect(formatDate('2026-02-31')).toBe('-')
  })

  // PT-6733 item 4: Date.UTC read years 0-99 as 19xx, so these showed as '-'.
  it('shows an early-year date as itself', () => {
    expect(formatCalendarDate('0050-01-01')).toBe('0050/01/01')
    expect(formatCalendarDate('0001-12-31')).toBe('0001/12/31')
    expect(formatCalendarDate('0000-01-01')).toBe('0000/01/01')
    expect(formatDate('0099-06-15')).toBe('0099/06/15')
    expect(formatCalendarDate('0050-02-29')).toBe('-')
    expect(formatCalendarDate('0048-02-29')).toBe('0048/02/29')
  })
})

describe('formatDateTime', () => {
  it('returns a dash for null / undefined / empty', () => {
    expect(formatDateTime(null)).toBe('-')
    expect(formatDateTime(undefined)).toBe('-')
    expect(formatDateTime('')).toBe('-')
  })

  it('returns a dash for an unparseable string', () => {
    expect(formatDateTime('not-a-date')).toBe('-')
  })

  it('formats an ISO timestamp to a non-empty localized string with the year', () => {
    const out = formatDateTime('2026-05-27T10:05:00Z')
    expect(out).not.toBe('-')
    expect(out).toMatch(/2026/)
  })
})

describe('formatDate', () => {
  it('returns a dash for null / undefined / empty / unparseable', () => {
    expect(formatDate(null)).toBe('-')
    expect(formatDate(undefined)).toBe('-')
    expect(formatDate('')).toBe('-')
    expect(formatDate('not-a-date')).toBe('-')
  })

  it('formats a date without any time component', () => {
    const out = formatDate('2026-05-27T10:05:00Z')
    expect(out).toMatch(/2026/)
    // date-only: no HH:mm clock portion
    expect(out).not.toMatch(/\d{2}:\d{2}/)
  })
})

describe('formatTime', () => {
  it('returns a dash for null / undefined / empty / unparseable', () => {
    expect(formatTime(null)).toBe('-')
    expect(formatTime(undefined)).toBe('-')
    expect(formatTime('')).toBe('-')
    expect(formatTime('not-a-date')).toBe('-')
  })

  it('formats time-only (HH:mm) with no date component', () => {
    const out = formatTime('2026-05-27T10:05:00Z')
    // HH:mm clock portion present; no year.
    expect(out).toMatch(/\d{2}:\d{2}/)
    expect(out).not.toMatch(/2026/)
  })
})

describe('formatDateTimeLong', () => {
  // The other suites here assert loosely (/2026/) because the output follows the
  // MACHINE's zone. This one pins the exact string, which is the whole point of
  // the shape the request specified — so pin the zone too and put it back after.
  const original = getDisplayTimeZone()
  afterEach(() => setDisplayTimeZone(original))

  it('returns a dash for null / undefined / empty / unparseable', () => {
    expect(formatDateTimeLong(null)).toBe('-')
    expect(formatDateTimeLong(undefined)).toBe('-')
    expect(formatDateTimeLong('')).toBe('-')
    expect(formatDateTimeLong('not-a-date')).toBe('-')
  })

  it('renders the Japanese 〇〇年〇〇月〇〇日〇〇:〇〇 shape, and does so by default', () => {
    setDisplayTimeZone('Asia/Tokyo')
    expect(formatDateTimeLong('2026-07-28T13:47:00Z', 'ja')).toBe('2026年07月28日22:47')
    // Language omitted → Japanese (the app's primary locale).
    expect(formatDateTimeLong('2026-07-28T13:47:00Z')).toBe('2026年07月28日22:47')
  })

  it('zero-pads month, day, hour and minute', () => {
    setDisplayTimeZone('Asia/Tokyo')
    // 2026-01-05 09:03 JST — every field is single-digit before padding.
    expect(formatDateTimeLong('2026-01-05T00:03:00Z', 'ja')).toBe('2026年01月05日09:03')
  })

  it('renders midnight as 00:00 of the new day, never 24:00 of the old one', () => {
    setDisplayTimeZone('Asia/Tokyo')
    // 2026-07-28 00:00 JST. `hour12: false` resolves to the h24 cycle in some
    // ICU builds, which would render this as "2026年07月27日24:00" — a date the
    // reader would take at face value. hourCycle:'h23' is what forbids that.
    expect(formatDateTimeLong('2026-07-27T15:00:00Z', 'ja')).toBe('2026年07月28日00:00')
  })

  it('renders a non-Japanese language without the CJK units', () => {
    setDisplayTimeZone('Asia/Tokyo')
    expect(formatDateTimeLong('2026-07-28T13:47:00Z', 'en')).toBe('28 Jul 2026 22:47')
    expect(formatDateTimeLong('2026-07-28T13:47:00Z', 'en-GB')).toBe('28 Jul 2026 22:47')
  })

  it('matches Japanese on the primary subtag, so a regional tag is not treated as English', () => {
    // Review finding (Codex conf 0.9): branching on `lang === 'ja'` made `ja-JP`
    // fall through to the English shape. This helper is exported and takes an
    // arbitrary string, so it must not depend on a caller normalising first.
    setDisplayTimeZone('Asia/Tokyo')
    for (const tag of ['ja', 'ja-JP', 'JA', 'ja-Hira-JP']) {
      expect(formatDateTimeLong('2026-07-28T13:47:00Z', tag)).toBe('2026年07月28日22:47')
    }
  })

  it('follows the display-timezone override', () => {
    setDisplayTimeZone('UTC')
    expect(formatDateTimeLong('2026-07-28T13:47:00Z', 'ja')).toBe('2026年07月28日13:47')
    setDisplayTimeZone('Asia/Tokyo')
    expect(formatDateTimeLong('2026-07-28T13:47:00Z', 'ja')).toBe('2026年07月28日22:47')
  })
})

describe('formatDurationMinSec', () => {
  it('returns null for null / undefined / NaN / negative input', () => {
    expect(formatDurationMinSec(null)).toBeNull()
    expect(formatDurationMinSec(undefined)).toBeNull()
    expect(formatDurationMinSec(NaN)).toBeNull()
    expect(formatDurationMinSec(-1)).toBeNull()
  })

  it('renders sub-second durations as 00 m 00 s', () => {
    expect(formatDurationMinSec(0)).toBe('00 m 00 s')
    expect(formatDurationMinSec(400)).toBe('00 m 00 s')
  })

  it('renders MM m SS s with a half-width space before each unit', () => {
    expect(formatDurationMinSec(45_000)).toBe('00 m 45 s')
    expect(formatDurationMinSec(80_000)).toBe('01 m 20 s')
    expect(formatDurationMinSec(327_000)).toBe('05 m 27 s')
    expect(formatDurationMinSec(3_599_000)).toBe('59 m 59 s')
  })

  it('keeps minutes as minutes past one hour (never rolls up to hours)', () => {
    expect(formatDurationMinSec(3_600_000)).toBe('60 m 00 s')
    expect(formatDurationMinSec(7_503_000)).toBe('125 m 03 s')
  })

  it('rounds to the nearest second', () => {
    expect(formatDurationMinSec(1_500)).toBe('00 m 02 s')
    expect(formatDurationMinSec(1_499)).toBe('00 m 01 s')
  })
})

describe('durationBetween', () => {
  it('returns null when either endpoint is missing or unparseable', () => {
    expect(durationBetween(null, '2026-05-27T10:05:00Z')).toBeNull()
    expect(durationBetween('2026-05-27T10:05:00Z', null)).toBeNull()
    expect(durationBetween(undefined, undefined)).toBeNull()
    expect(durationBetween('nope', '2026-05-27T10:05:00Z')).toBeNull()
  })

  it('returns the elapsed milliseconds for an in-order interval', () => {
    expect(
      durationBetween('2026-05-27T10:00:00Z', '2026-05-27T10:01:20Z'),
    ).toBe(80_000)
  })

  it('returns null for a negative (out-of-order) interval', () => {
    expect(
      durationBetween('2026-05-27T10:01:20Z', '2026-05-27T10:00:00Z'),
    ).toBeNull()
  })
})

// A live graph's time axis: seconds matter there, two ticks share a minute.
describe('formatTimeSec', () => {
  afterEach(() => setDisplayTimeZone(undefined))

  it('returns a dash for null / undefined / empty / unparseable', () => {
    expect(formatTimeSec(null)).toBe('-')
    expect(formatTimeSec(undefined)).toBe('-')
    expect(formatTimeSec('')).toBe('-')
    expect(formatTimeSec('not-a-date')).toBe('-')
    expect(formatTimeSec(Number.NaN)).toBe('-')
  })

  it('formats HH:mm:ss in the display zone from an ISO string, a ms epoch or a Date', () => {
    setDisplayTimeZone('Asia/Tokyo')
    // 2026-05-31T20:00:07Z is 05:00:07 in Tokyo.
    expect(formatTimeSec('2026-05-31T20:00:07Z')).toBe('05:00:07')
    expect(formatTimeSec(Date.UTC(2026, 4, 31, 20, 0, 7))).toBe('05:00:07')
    expect(formatTimeSec(new Date('2026-05-31T20:00:07Z'))).toBe('05:00:07')
  })

  it('reads midnight as 00, never 24', () => {
    setDisplayTimeZone('Asia/Tokyo')
    expect(formatTimeSec('2026-05-31T15:00:00Z')).toBe('00:00:00')
  })

  it('follows a display-zone change', () => {
    setDisplayTimeZone('UTC')
    expect(formatTimeSec('2026-05-31T20:00:07Z')).toBe('20:00:07')
  })
})
