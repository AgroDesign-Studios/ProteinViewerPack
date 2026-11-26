// Numeric formatting per AgDB DESIGN.md §2.5 (numeric typography).
//
// The grouping/decimal style is one of four concrete styles plus `auto`, which
// follows the browser/OS locale. The active style is module state set by
// `setNumberFormatStyle`, mirroring formatDate.ts's display timezone: views
// rendered after it pick up the change, nodes already on screen update on
// their next render.
//
// User-visible numbers should pass through this helper rather than
// calling `.toLocaleString()` directly (which is locale-dependent, rounds to 3
// fraction digits by default, and can emit non-ASCII separators that break
// copy-paste into spreadsheets).
import {
  type ConcreteNumberFormatStyle,
  type NumberFormatStyle,
  getStoredNumberFormatStyle,
  resolveNumberFormatStyle,
  separatorsFor,
} from './numberFormatStyle'

let _style: ConcreteNumberFormatStyle = resolveNumberFormatStyle(getStoredNumberFormatStyle())

/** Set the active style (persisting it is the caller's job). */
export function setNumberFormatStyle(style: NumberFormatStyle): void {
  _style = resolveNumberFormatStyle(style)
}

/** The style currently applied by `formatSI` (never `auto`). */
export function activeNumberFormatStyle(): ConcreteNumberFormatStyle {
  return _style
}

export function formatSI(
  value: number | null | undefined,
  opts: { fractionDigits?: number; emptyDash?: boolean } = {},
): string {
  if (value == null || !Number.isFinite(value)) return opts.emptyDash === false ? '' : '-'
  return formatWithStyle(value, _style, opts.fractionDigits)
}

/**
 * Format with an explicit style, bypassing the preference.
 *
 * For UI that must show one specific style regardless of the setting — the
 * samples of each style and a page's own style override.
 */
export function formatWithStyle(
  value: number,
  style: ConcreteNumberFormatStyle,
  fractionDigits?: number,
): string {
  const { group, decimal } = separatorsFor(style)
  // `toString()` (not `toFixed`) when no digit count is given, so full
  // precision survives — descriptor and score values depend on it.
  const fixed = fractionDigits != null ? value.toFixed(fractionDigits) : value.toString()
  // Exponential notation has no integer run to group (1e-7 → "1e-7").
  if (fixed.includes('e') || fixed.includes('E')) return fixed
  const [intPart, decPart] = fixed.split('.')
  const neg = intPart.startsWith('-')
  const digits = neg ? intPart.slice(1) : intPart
  const grouped = group ? digits.replace(/\B(?=(\d{3})+(?!\d))/g, group) : digits
  const body = decPart ? `${grouped}${decimal}${decPart}` : grouped
  return neg ? `-${body}` : body
}

/**
 * Parse a number the user typed, or one that `formatSI` rendered.
 *
 * Read IN A KNOWN STYLE (the active one by default) — never inferred from the
 * digits. A lone `.` is fatally ambiguous: `1.234` is 1.234 to a comma/si user
 * and 1234 to a euro user, so guessing from shape silently yields a 1000x-off
 * value. Knowing the style makes both readings exact, and text that cannot be
 * read in that style returns `null` so the caller rejects it instead of saving
 * something wrong.
 *
 * Pass `style` explicitly whenever the text was rendered in something other
 * than the active preference — a per-page override, or history persisted
 * before the preference existed.
 */
export function parseFormattedNumber(
  raw: string,
  style: ConcreteNumberFormatStyle = _style,
): number | null {
  const text = raw.trim()
  if (!text) return null
  // `formatWithStyle` passes exponential notation through verbatim (period radix,
  // no grouping — there is no integer run to group), so accept that shape as-is in
  // every style. Without this the round trip breaks and such a value can never be
  // re-saved.
  if (/^[+-]?\d+(\.\d+)?[eE][+-]?\d+$/.test(text)) {
    const exp = Number(text)
    return Number.isFinite(exp) ? exp : null
  }
  const styleRadix = separatorsFor(style).decimal
  const styleGroup = styleRadix === ',' ? '.' : ','
  const lastRadix = text.lastIndexOf(styleRadix)
  const lastGroup = text.lastIndexOf(styleGroup)
  // Both marks present is unambiguous in ANY style — the later one is the
  // radix — so honour position even when it contradicts `style`. That is what
  // lets a paste from another locale read correctly rather than silently wrong.
  const radix = lastGroup > lastRadix && lastRadix >= 0 ? styleGroup : styleRadix
  const group = radix === styleRadix ? styleGroup : styleRadix
  // The space family, de-CH apostrophes and the Japanese full-width space are
  // group marks in every style — no locale uses them as a radix. Fold them into
  // the style's group mark so one rule validates every spelling of a group.
  const folded = text.replace(/[\s\u00A0\u202F\u2009\u2019'\u3000]/g, group)
  const sign = folded[0] === '+' || folded[0] === '-' ? folded[0] : ''
  const parts = (sign ? folded.slice(1) : folded).split(radix)
  if (parts.length > 2) return null
  const [intPart, fracPart = ''] = parts
  // Grouping, WHEN PRESENT, must be well-formed: a 1-3 digit lead then exact
  // 3-digit groups. Without this check the separators would just be stripped,
  // so a malformed group (`1,2,3`, `12,34`, `1 2 3`) would silently normalise
  // to a DIFFERENT valid number instead of being rejected.
  const groupRe = group === '.' ? '\\.' : ','
  const intOk = intPart.includes(group)
    ? new RegExp(`^\\d{1,3}(${groupRe}\\d{3})+$`).test(intPart)
    : /^\d*$/.test(intPart)
  if (!intOk || !/^\d*$/.test(fracPart)) return null
  const digits = intPart.split(group).join('')
  if (!digits && !fracPart) return null
  const n = Number(`${sign}${digits || '0'}.${fracPart || '0'}`)
  return Number.isFinite(n) ? n : null
}
