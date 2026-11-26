import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_NUMBER_FORMAT_STYLE,
  NUMBER_FORMAT_STORAGE_KEY,
  classifyLocale,
  detectNumberFormatStyle,
  getStoredNumberFormatStyle,
  resolveNumberFormatStyle,
  sampleFor,
  separatorsFor,
  storeNumberFormatStyle,
} from './numberFormatStyle'

function mockLanguages(languages: string[]): void {
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(languages)
}

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('separatorsFor / sampleFor', () => {
  it('renders each of the four styles', () => {
    expect(sampleFor('si')).toBe('1 234.5')
    expect(sampleFor('comma')).toBe('1,234.5')
    expect(sampleFor('euro')).toBe('1.234,5')
    expect(sampleFor('none')).toBe('1234.5')
  })

  it('exposes the group/decimal pair', () => {
    expect(separatorsFor('euro')).toEqual({ group: '.', decimal: ',' })
    expect(separatorsFor('none').group).toBe('')
  })
})

describe('classifyLocale', () => {
  it.each([
    ['en-US', 'comma'],
    ['ja-JP', 'comma'],
    ['en-GB', 'comma'],
    ['de-DE', 'euro'],
    ['es-ES', 'euro'],
    ['pt-BR', 'euro'],
    // Space group + comma radix: the radix decides, so euro (not si).
    ['fr-FR', 'euro'],
    ['sv-SE', 'euro'],
    ['ru-RU', 'euro'],
    // Apostrophe group + period radix: no exact match, space is closest.
    ['de-CH', 'si'],
    // Region carries the signal — the two Canadas differ.
    ['en-CA', 'comma'],
    ['fr-CA', 'euro'],
  ])('classifies %s as %s', (locale, expected) => {
    expect(classifyLocale(locale)).toBe(expected)
  })

  it('probes with enough digits for minimumGroupingDigits=2 locales', () => {
    // es-ES leaves 1234 ungrouped; a 4-digit probe would say "none".
    expect(classifyLocale('es-ES')).not.toBe('none')
  })

  it('forces latin digits so non-latin numbering systems stay expressible', () => {
    // ar-EG defaults to Arabic-Indic digits + U+066B/U+066C separators.
    expect(classifyLocale('ar-EG')).toBe('comma')
  })

  it('returns undefined for an unsupported tag instead of throwing', () => {
    expect(classifyLocale('not a locale')).toBeUndefined()
  })
})

describe('detectNumberFormatStyle', () => {
  it('follows the first usable browser language', () => {
    mockLanguages(['de-DE', 'en-US'])
    expect(detectNumberFormatStyle()).toBe('euro')
  })

  it('skips unusable tags and falls through to the next', () => {
    mockLanguages(['not a locale', 'de-DE'])
    expect(detectNumberFormatStyle()).toBe('euro')
  })

  it('falls back to si when nothing is detectable', () => {
    mockLanguages([])
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('')
    expect(detectNumberFormatStyle()).toBe('si')
  })
})

describe('resolveNumberFormatStyle', () => {
  it('passes concrete styles through untouched', () => {
    mockLanguages(['de-DE'])
    expect(resolveNumberFormatStyle('si')).toBe('si')
    expect(resolveNumberFormatStyle('none')).toBe('none')
  })

  it('resolves auto against the browser locale', () => {
    mockLanguages(['de-DE'])
    expect(resolveNumberFormatStyle('auto')).toBe('euro')
  })
})

describe('storage', () => {
  it('defaults to auto when nothing is stored', () => {
    expect(getStoredNumberFormatStyle()).toBe(DEFAULT_NUMBER_FORMAT_STYLE)
    expect(DEFAULT_NUMBER_FORMAT_STYLE).toBe('auto')
  })

  it('round-trips a concrete style', () => {
    storeNumberFormatStyle('euro')
    expect(localStorage.getItem(NUMBER_FORMAT_STORAGE_KEY)).toBe('euro')
    expect(getStoredNumberFormatStyle()).toBe('euro')
  })

  it('stores the default as absence', () => {
    storeNumberFormatStyle('euro')
    storeNumberFormatStyle('auto')
    expect(localStorage.getItem(NUMBER_FORMAT_STORAGE_KEY)).toBeNull()
    expect(getStoredNumberFormatStyle()).toBe('auto')
  })

  it('ignores a corrupted stored value', () => {
    localStorage.setItem(NUMBER_FORMAT_STORAGE_KEY, 'klingon')
    expect(getStoredNumberFormatStyle()).toBe(DEFAULT_NUMBER_FORMAT_STYLE)
  })

  it('survives unreadable storage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(getStoredNumberFormatStyle()).toBe(DEFAULT_NUMBER_FORMAT_STYLE)
    expect(() => storeNumberFormatStyle('si')).not.toThrow()
  })
})
