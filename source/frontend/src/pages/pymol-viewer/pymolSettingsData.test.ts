/**
 * PYMOL_SETTINGS = the generated rows with `SETTING_HELP_OVERRIDES` applied to
 * the help column only (PT-9554). The generated rows are read back from this
 * module's source text, as the generator splits it.
 */
import { describe, expect, it } from 'vitest'

import source from './pymolSettingsData.ts?raw'
import { PYMOL_SETTINGS, SETTING_HELP_OVERRIDES, withHelpOverrides, type SettingRow } from './pymolSettingsData'

/** The generated section's rows: the lines after the start line up to the next line that is exactly `]`. */
function generatedRows(): SettingRow[] {
  const lines = source.split('\n')
  const start = lines.indexOf('const GENERATED_SETTINGS: readonly SettingRow[] = [')
  const end = lines.findIndex((l, i) => i > start && l === ']')
  expect(start).toBeGreaterThan(0)
  expect(end).toBeGreaterThan(start)
  return lines.slice(start + 1, end).map(l => {
    expect(l).toMatch(/^ {2}\[.*\],$/)
    return JSON.parse(l.slice(2, -1)) as SettingRow
  })
}

const LABEL_FONT_HELP =
  '(integer, default: 5) Label font: 5 = Sans, 6 = Sans Oblique, 7 = Sans Bold, 8 = Sans Bold Oblique; any other id is drawn as Sans.'

describe('PYMOL_SETTINGS', () => {
  const generated = generatedRows()

  it('has the generated rows’ names, order, types and defaults', () => {
    expect(generated.length).toBe(695)
    expect(PYMOL_SETTINGS.map(r => [r[0], r[1], r[2]])).toEqual(generated.map(r => [r[0], r[1], r[2]]))
  })

  it('differs from the generated rows only in the help of the overridden settings', () => {
    const changed = PYMOL_SETTINGS.filter((r, i) => r[3] !== generated[i][3]).map(r => r[0])
    expect(changed).toEqual(Object.keys(SETTING_HELP_OVERRIDES))
  })

  it('names exactly one generated row per override key', () => {
    expect(Object.keys(SETTING_HELP_OVERRIDES).length).toBeGreaterThan(0)
    for (const name of Object.keys(SETTING_HELP_OVERRIDES)) expect(generated.filter(r => r[0] === name), name).toHaveLength(1)
  })

  it('tells what label_font_id draws in this runtime', () => {
    expect(PYMOL_SETTINGS.find(r => r[0] === 'label_font_id')?.[3]).toBe(LABEL_FONT_HELP)
    // The generated row keeps PyMOL's own text.
    expect(generated.find(r => r[0] === 'label_font_id')?.[3]).toMatch(/^\(integer: 1-15, default: 5\) controls what font is used to draw labels/)
  })
})

describe('withHelpOverrides', () => {
  const rows: readonly SettingRow[] = [
    ['a', 'int', '1', 'old a'],
    ['b', 'float', '2.0', 'old b'],
  ]

  it('replaces the help column of the named rows and keeps every other row the same object', () => {
    const out = withHelpOverrides(rows, { b: 'new b' })
    expect(out).toEqual([
      ['a', 'int', '1', 'old a'],
      ['b', 'float', '2.0', 'new b'],
    ])
    expect(out[0]).toBe(rows[0])
    expect(rows[1][3]).toBe('old b')
  })

  it('ignores inherited keys', () => {
    expect(withHelpOverrides([['toString', '', '', 'h']], {})).toEqual([['toString', '', '', 'h']])
  })
})
