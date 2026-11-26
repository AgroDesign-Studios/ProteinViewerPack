/**
 * Unit tests for displayTimeZone (localStorage-backed display-TZ preference)
 * and formatDate's setDisplayTimeZone wiring.
 *
 * Contract: '' / absent = "same as browser" (no timeZone option); a stored
 * IANA zone overrides display only. Invalid/unreadable storage → browser zone.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  BROWSER_TZ,
  TZ_STORAGE_KEY,
  browserTimeZone,
  getStoredTimeZone,
  isValidTimeZone,
  listTimeZones,
  storeTimeZone,
} from './displayTimeZone'
import { formatDateTime, getDisplayTimeZone, setDisplayTimeZone } from './formatDate'

beforeEach(() => {
  localStorage.clear()
  // This file's subject IS the timezone singleton, so it opts out of the
  // Asia/Tokyo pin the test setup applies to every other test (which exists so
  // date assertions elsewhere do not depend on the runner's TZ). Setup-file
  // hooks run BEFORE file-level ones, so without this the pin would still be
  // in force here and "defaults to undefined" could never be observed. Restoring from `getStoredTimeZone()`
  // rather than hardcoding `undefined` reproduces exactly what the module does
  // at import, on the localStorage this hook just cleared.
  setDisplayTimeZone(getStoredTimeZone())
})

afterEach(() => {
  localStorage.clear()
  setDisplayTimeZone(undefined) // reset the formatter singleton between tests
})

describe('isValidTimeZone', () => {
  it('accepts a real IANA zone', () => {
    expect(isValidTimeZone('Asia/Tokyo')).toBe(true)
  })
  it('rejects garbage and empty', () => {
    expect(isValidTimeZone('Not/AZone')).toBe(false)
    expect(isValidTimeZone('')).toBe(false)
  })
})

describe('getStoredTimeZone / storeTimeZone', () => {
  it('returns undefined when nothing is stored (= same as browser)', () => {
    expect(getStoredTimeZone()).toBeUndefined()
  })
  it('round-trips a valid zone', () => {
    storeTimeZone('Asia/Tokyo')
    expect(localStorage.getItem(TZ_STORAGE_KEY)).toBe('Asia/Tokyo')
    expect(getStoredTimeZone()).toBe('Asia/Tokyo')
  })
  it('clears the key when given undefined / empty', () => {
    storeTimeZone('Asia/Tokyo')
    storeTimeZone(undefined)
    expect(localStorage.getItem(TZ_STORAGE_KEY)).toBeNull()
    expect(getStoredTimeZone()).toBeUndefined()
  })
  it('ignores an invalid stored value (falls back to browser zone)', () => {
    localStorage.setItem(TZ_STORAGE_KEY, 'Bogus/Zone')
    expect(getStoredTimeZone()).toBeUndefined()
  })
})

describe('listTimeZones / browserTimeZone', () => {
  it('returns a non-empty list including Asia/Tokyo and UTC', () => {
    const zones = listTimeZones()
    expect(zones.length).toBeGreaterThan(0)
    expect(zones).toContain('Asia/Tokyo')
    expect(zones).toContain('UTC')
  })
  it('resolves a browser zone string', () => {
    expect(typeof browserTimeZone()).toBe('string')
    expect(browserTimeZone().length).toBeGreaterThan(0)
  })
  it('BROWSER_TZ sentinel is the empty string', () => {
    expect(BROWSER_TZ).toBe('')
  })
})

describe('formatDate setDisplayTimeZone wiring', () => {
  // A fixed instant: 2026-06-16T00:30:00Z. In Asia/Tokyo (+09:00) that is
  // 09:30 on the 16th; in UTC it is 00:30 on the 16th — different rendering.
  const iso = '2026-06-16T00:30:00Z'

  it('defaults to undefined (same as browser)', () => {
    expect(getDisplayTimeZone()).toBeUndefined()
  })

  it('renders the chosen zone after setDisplayTimeZone', () => {
    setDisplayTimeZone('Asia/Tokyo')
    expect(getDisplayTimeZone()).toBe('Asia/Tokyo')
    expect(formatDateTime(iso)).toContain('09:30')

    setDisplayTimeZone('UTC')
    expect(formatDateTime(iso)).toContain('00:30')
  })

  it('empty string resets to browser zone (undefined)', () => {
    setDisplayTimeZone('UTC')
    setDisplayTimeZone('')
    expect(getDisplayTimeZone()).toBeUndefined()
  })

  it('still returns "-" for nullish input regardless of zone', () => {
    setDisplayTimeZone('Asia/Tokyo')
    expect(formatDateTime(null)).toBe('-')
    expect(formatDateTime('')).toBe('-')
  })
})
