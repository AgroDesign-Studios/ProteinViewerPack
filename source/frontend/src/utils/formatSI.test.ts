import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  activeNumberFormatStyle,
  formatSI,
  formatWithStyle,
  parseFormattedNumber,
  setNumberFormatStyle,
} from './formatSI'

beforeEach(() => {
  // Pin the style so tests never depend on the runner's locale.
  setNumberFormatStyle('si')
})

afterEach(() => {
  setNumberFormatStyle('si')
})

describe('formatSI — SI style (the historical default)', () => {
  it('groups the integer part with an ASCII space', () => {
    expect(formatSI(98438)).toBe('98 438')
    expect(formatSI(1234567)).toBe('1 234 567')
    expect(formatSI(999)).toBe('999')
  })

  it('keeps the decimal part ungrouped and full-precision', () => {
    expect(formatSI(98438.8)).toBe('98 438.8')
    expect(formatSI(0.123456789)).toBe('0.123456789')
  })

  it('honours fractionDigits', () => {
    expect(formatSI(1234.5678, { fractionDigits: 2 })).toBe('1 234.57')
    expect(formatSI(1234, { fractionDigits: 1 })).toBe('1 234.0')
  })

  it('handles negatives without splitting the sign', () => {
    expect(formatSI(-1234567.5)).toBe('-1 234 567.5')
    expect(formatSI(-999)).toBe('-999')
  })

  it('returns a dash for null / undefined / NaN', () => {
    expect(formatSI(null)).toBe('-')
    expect(formatSI(undefined)).toBe('-')
    expect(formatSI(NaN)).toBe('-')
    expect(formatSI(Infinity)).toBe('-')
  })

  it('returns an empty string when emptyDash is false', () => {
    expect(formatSI(null, { emptyDash: false })).toBe('')
  })

  it('leaves exponential notation alone', () => {
    expect(formatSI(1e-7)).toBe('1e-7')
    expect(formatSI(1.5e21)).toBe('1.5e+21')
  })
})

describe('formatSI — the active style is a preference', () => {
  it('switches grouping and radix together', () => {
    setNumberFormatStyle('comma')
    expect(formatSI(1234567.5)).toBe('1,234,567.5')
    setNumberFormatStyle('euro')
    expect(formatSI(1234567.5)).toBe('1.234.567,5')
    setNumberFormatStyle('none')
    expect(formatSI(1234567.5)).toBe('1234567.5')
  })

  it('reports the resolved style, never auto', () => {
    setNumberFormatStyle('auto')
    expect(['si', 'comma', 'euro', 'none']).toContain(activeNumberFormatStyle())
  })

  it('applies the euro radix to fractionDigits output too', () => {
    setNumberFormatStyle('euro')
    expect(formatSI(1234.5678, { fractionDigits: 2 })).toBe('1.234,57')
    expect(formatSI(-0.5, { fractionDigits: 1 })).toBe('-0,5')
  })
})

describe('formatWithStyle', () => {
  it('ignores the active preference', () => {
    setNumberFormatStyle('euro')
    expect(formatWithStyle(1234.5, 'si')).toBe('1 234.5')
    expect(formatWithStyle(1234.5, 'comma')).toBe('1,234.5')
  })
})

describe('parseFormattedNumber', () => {
  it('reads a value in the style it was rendered in', () => {
    expect(parseFormattedNumber('1 234 567.5', 'si')).toBe(1234567.5)
    expect(parseFormattedNumber('1,234,567.5', 'comma')).toBe(1234567.5)
    expect(parseFormattedNumber('1.234.567,5', 'euro')).toBe(1234567.5)
    expect(parseFormattedNumber('1234567.5', 'none')).toBe(1234567.5)
  })

  it('resolves the lone-separator ambiguity from the STYLE, not the shape', () => {
    // The 1000x trap: the same text means different numbers per style, and
    // guessing from digit shape is what silently produced a wrong value.
    expect(parseFormattedNumber('1.234', 'comma')).toBe(1.234)
    expect(parseFormattedNumber('1.234', 'si')).toBe(1.234)
    expect(parseFormattedNumber('1.234', 'none')).toBe(1.234)
    expect(parseFormattedNumber('1.234', 'euro')).toBe(1234)
    expect(parseFormattedNumber('1,234', 'comma')).toBe(1234)
    expect(parseFormattedNumber('1,234', 'euro')).toBe(1.234)
  })

  it('defaults to the active style', () => {
    setNumberFormatStyle('euro')
    expect(parseFormattedNumber('1.234')).toBe(1234)
    setNumberFormatStyle('comma')
    expect(parseFormattedNumber('1.234')).toBe(1.234)
  })

  it('honours position when BOTH marks appear, whatever the style', () => {
    // Unambiguous by position, so a paste from another locale still reads right.
    expect(parseFormattedNumber('1.234.567,5', 'comma')).toBe(1234567.5)
    expect(parseFormattedNumber('1,234,567.5', 'euro')).toBe(1234567.5)
  })

  it('rejects text it cannot read in the given style', () => {
    // euro grouping read in the comma style: rejected, not guessed —
    // the caller shows an error instead of keeping a 1000x-off number.
    expect(parseFormattedNumber('1.234.567', 'comma')).toBeNull()
    expect(parseFormattedNumber('1,234,567', 'euro')).toBeNull()
  })

  it('treats the space family and apostrophes as group marks in every style', () => {
    expect(parseFormattedNumber('-1 234.5', 'si')).toBe(-1234.5)
    expect(parseFormattedNumber('1\u00A0234', 'comma')).toBe(1234)
    expect(parseFormattedNumber('1\u202F234', 'comma')).toBe(1234)
    expect(parseFormattedNumber('1\u2019234', 'comma')).toBe(1234)
    expect(parseFormattedNumber('1\u3000234', 'comma')).toBe(1234)
  })

  it('rejects malformed grouping instead of normalising it to another number', () => {
    // A malformed group must be rejected, not normalised to a different number:
    // stripping separators blindly would turn a typo into a DIFFERENT valid one.
    expect(parseFormattedNumber('1,2,3', 'comma')).toBeNull()
    expect(parseFormattedNumber('12,34', 'comma')).toBeNull()
    expect(parseFormattedNumber('1 2 3', 'si')).toBeNull()
    expect(parseFormattedNumber('1.2.3', 'euro')).toBeNull()
    expect(parseFormattedNumber('1,0000', 'comma')).toBeNull()
    expect(parseFormattedNumber('1234,567,89', 'comma')).toBeNull()
    // ...while a correctly-grouped value and an ungrouped one both still pass.
    expect(parseFormattedNumber('1,234,567', 'comma')).toBe(1234567)
    expect(parseFormattedNumber('1234567', 'comma')).toBe(1234567)
  })

  it('accepts signs, a bare fraction and an empty fraction', () => {
    expect(parseFormattedNumber('+1 234', 'si')).toBe(1234)
    expect(parseFormattedNumber('.5', 'comma')).toBe(0.5)
    expect(parseFormattedNumber('12.', 'comma')).toBe(12)
    expect(parseFormattedNumber('.', 'comma')).toBeNull()
    expect(parseFormattedNumber('-', 'comma')).toBeNull()
  })

  it('rejects text that is not a single number', () => {
    expect(parseFormattedNumber('')).toBeNull()
    expect(parseFormattedNumber('   ')).toBeNull()
    expect(parseFormattedNumber('abc')).toBeNull()
    expect(parseFormattedNumber('1 2 abc')).toBeNull()
    expect(parseFormattedNumber('1.2.3', 'comma')).toBeNull()
  })

  it('round-trips exponential notation, which formatWithStyle passes through', () => {
    for (const style of ['si', 'comma', 'euro', 'none'] as const) {
      expect(parseFormattedNumber(formatWithStyle(1.5e21, style), style)).toBe(1.5e21)
      expect(parseFormattedNumber(formatWithStyle(1e-7, style), style)).toBe(1e-7)
      expect(parseFormattedNumber(formatWithStyle(-2.5e-8, style), style)).toBe(-2.5e-8)
    }
  })

  it('round-trips whatever formatSI rendered', () => {
    for (const style of ['si', 'comma', 'euro', 'none'] as const) {
      setNumberFormatStyle(style)
      for (const v of [0, 5, -12, 1234, 1234567.5, -98438.8, 0.25]) {
        expect(parseFormattedNumber(formatSI(v), style)).toBe(v)
      }
    }
  })
})
