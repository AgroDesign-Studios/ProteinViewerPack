/**
 * Digit-grouping style — user-level preference stored in localStorage.
 *
 * Four concrete styles plus
 * `auto`, which resolves from the browser/OS locale via `navigator.languages`.
 * `auto` is the default and never reaches a formatter: it is resolved once per
 * boot into one of the four concrete styles, so `formatSI` keeps its
 * deterministic ASCII output and full numeric precision.
 *
 * Mirrors the displayTimeZone.ts localStorage-preference shape.
 * Consumed by formatSI.ts (the actual formatter).
 */

export const NUMBER_FORMAT_STORAGE_KEY = 'agdb_number_format'

/** The four concrete styles a formatter can apply. */
export const CONCRETE_NUMBER_FORMAT_STYLES = ['si', 'comma', 'euro', 'none'] as const
export type ConcreteNumberFormatStyle = (typeof CONCRETE_NUMBER_FORMAT_STYLES)[number]

/** Stored preference: a concrete style, or `auto` (resolve from the locale). */
export const NUMBER_FORMAT_STYLES = ['auto', ...CONCRETE_NUMBER_FORMAT_STYLES] as const
export type NumberFormatStyle = (typeof NUMBER_FORMAT_STYLES)[number]

export const DEFAULT_NUMBER_FORMAT_STYLE: NumberFormatStyle = 'auto'

/** Separator pair per concrete style. `group: ''` = no grouping at all. */
export interface NumberFormatSeparators {
  group: string
  decimal: string
}

const SEPARATORS: Record<ConcreteNumberFormatStyle, NumberFormatSeparators> = {
  si: { group: ' ', decimal: '.' }, // SI: half-width ASCII space + period
  comma: { group: ',', decimal: '.' }, // en / ja
  euro: { group: '.', decimal: ',' }, // continental Europe
  none: { group: '', decimal: '.' },
}

export function separatorsFor(style: ConcreteNumberFormatStyle): NumberFormatSeparators {
  return SEPARATORS[style]
}

/** Sample rendering of 1234.5, for labelling a style option. */
export function sampleFor(style: ConcreteNumberFormatStyle): string {
  const { group, decimal } = SEPARATORS[style]
  return `1${group}234${decimal}5`
}

function isNumberFormatStyle(v: string): v is NumberFormatStyle {
  return (NUMBER_FORMAT_STYLES as readonly string[]).includes(v)
}

/** The stored preference, or the default when missing / invalid / unreadable. */
export function getStoredNumberFormatStyle(): NumberFormatStyle {
  try {
    const v = localStorage.getItem(NUMBER_FORMAT_STORAGE_KEY)
    return v && isNumberFormatStyle(v) ? v : DEFAULT_NUMBER_FORMAT_STYLE
  } catch {
    return DEFAULT_NUMBER_FORMAT_STYLE
  }
}

/** Persist the preference. The default (`auto`) is stored as absence. */
export function storeNumberFormatStyle(style: NumberFormatStyle): void {
  try {
    if (style === DEFAULT_NUMBER_FORMAT_STYLE) localStorage.removeItem(NUMBER_FORMAT_STORAGE_KEY)
    else localStorage.setItem(NUMBER_FORMAT_STORAGE_KEY, style)
  } catch {
    // private-mode / disabled storage — the preference simply won't persist.
  }
}

/**
 * Classify one BCP-47 tag into a concrete style by probing `Intl`.
 *
 * The probe value needs ≥ 7 digits: CLDR's `minimumGroupingDigits = 2` locales
 * (es-ES, pl-PL, …) leave 1234 ungrouped and would misclassify as `none`.
 * `numberingSystem: 'latn'` keeps ar-EG / fa-IR from reporting Arabic-Indic
 * separators (and digits) that none of the four styles can express.
 *
 * Returns `undefined` when the tag is unsupported or the probe is unusable, so
 * the caller can try the next tag.
 */
export function classifyLocale(locale: string): ConcreteNumberFormatStyle | undefined {
  let parts: Intl.NumberFormatPart[]
  try {
    parts = new Intl.NumberFormat(locale, {
      useGrouping: true,
      numberingSystem: 'latn',
      maximumFractionDigits: 1,
    }).formatToParts(1234567.5)
  } catch {
    return undefined
  }
  const group = parts.find((p) => p.type === 'group')?.value
  const decimal = parts.find((p) => p.type === 'decimal')?.value
  // A probe that produced no decimal part at all is not a usable signal.
  if (decimal == null) return undefined
  // The radix mark decides euro vs not; the group mark then decides si vs comma.
  // fr-FR / sv-SE / ru-RU (space-ish group + comma radix) are euro, not si —
  // mapping them to si would silently change the radix, the worse half to get wrong.
  if (decimal === ',') return 'euro'
  if (group == null || group === '') return 'none'
  if (group === ',') return 'comma'
  // Space-family (U+0020 / U+00A0 / U+202F / U+2009) and de-CH's apostrophe
  // have no exact AgDB equivalent; SI's space is the closest non-glyph match.
  return 'si'
}

/** Resolve `auto` against the browser/OS locale preference order. */
export function detectNumberFormatStyle(): ConcreteNumberFormatStyle {
  const tags: string[] = []
  try {
    if (typeof navigator !== 'undefined') {
      if (navigator.languages?.length) tags.push(...navigator.languages)
      else if (navigator.language) tags.push(navigator.language)
    }
  } catch {
    // fall through to the default below
  }
  for (const tag of tags) {
    // Region carries the grouping information (en-CA vs fr-CA), so the tag
    // is NOT truncated to its primary subtag.
    const style = classifyLocale(tag)
    if (style) return style
  }
  return 'si'
}

/** Collapse a stored preference to the style a formatter should apply. */
export function resolveNumberFormatStyle(style: NumberFormatStyle): ConcreteNumberFormatStyle {
  return style === 'auto' ? detectNumberFormatStyle() : style
}
