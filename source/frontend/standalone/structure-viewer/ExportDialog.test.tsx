/**
 * The offline file's one 「エクスポート」 (owner 2026-11-14): which formats it
 * offers by edition and by the engine on screen (the app itself first, owner
 * 2026-11-15; the pictures in 「画像出力」 since 2026-11-16, `imageItems`), the engines named on each in small stacked tags — both for an
 * entry either engine serves, never 「どちらでも」 — and that an entry of the
 * engine not shown switches only when the person agrees.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key} ${JSON.stringify(vars)}` : key),
    i18n: { language: 'ja' },
  }),
}))

import { ExportDialog } from './ExportDialog'
import { exportItems, imageItems, type ExportContext } from './exportItems'

const ctx = (over: Partial<ExportContext> = {}): ExportContext => ({ full: true, shown: '3dmol', gl: true, dmolView: true, ...over })
const ids = (c: ExportContext) => exportItems(c).map(i => i.id)
const byId = <T extends { id: string }>(list: readonly T[]) => Object.fromEntries(list.map(i => [i.id, i]))

describe('exportItems', () => {
  it('the light edition offers no PyMOL format at all', () => {
    const items = exportItems(ctx({ full: false }))
    expect(items.map(i => i.id)).toEqual(['app', 'structure', 'vrml'])
    expect(items.every(i => i.engine !== 'pymol' && i.switchTo === null)).toBe(true)
    // No PyMOL tag anywhere in the light edition, the engine-free entries included.
    expect(items.every(i => !i.tags.includes('pymol'))).toBe(true)
    expect(items.find(i => i.id === 'app')?.tags).toEqual(['3dmol'])
  })

  it('the full edition offers every file: the app first; VRML just above the PyMOL session (owner 2026-11-16); no pictures', () => {
    expect(ids(ctx())).toEqual(['app', 'structure', 'mol', 'vrml', 'pse'])
    expect(ids(ctx({ shown: 'pymol' }))).toEqual(['app', 'structure', 'mol', 'vrml', 'pse'])
  })

  it('sets the app itself apart, and nothing else', () => {
    for (const full of [true, false]) {
      expect(exportItems(ctx({ full })).filter(i => i.featured).map(i => i.id)).toEqual(['app'])
    }
  })

  it('an entry either engine serves is tagged with both, PyMOL above 3Dmol.js; the others with their one', () => {
    const tags = Object.fromEntries(exportItems(ctx()).map(i => [i.id, i.tags]))
    expect(tags).toEqual({
      app: ['pymol', '3dmol'],
      structure: ['pymol', '3dmol'],
      mol: ['pymol'],
      pse: ['pymol'],
      vrml: ['3dmol'],
    })
  })

  it('names the engine that writes each', () => {
    const on3dmol = byId(exportItems(ctx()))
    expect(on3dmol.structure).toMatchObject({ engine: 'any', switchTo: null })
    expect(on3dmol.vrml).toMatchObject({ engine: '3dmol', switchTo: null })
    for (const id of ['mol', 'pse']) expect(on3dmol[id]).toMatchObject({ engine: 'pymol', switchTo: 'pymol' })
    const onPymol = byId(exportItems(ctx({ shown: 'pymol' })))
    for (const id of ['mol', 'pse']) expect(onPymol[id]).toMatchObject({ engine: 'pymol', switchTo: null })
    // VRML is written from 3Dmol.js's pane even while PyMOL is shown.
    expect(onPymol.vrml).toMatchObject({ engine: '3dmol', switchTo: null, blocked: null })
  })

  it('shows what cannot be used, and why', () => {
    const blocked = (c: ExportContext) => Object.fromEntries(exportItems(c).map(i => [i.id, i.blocked]))
    expect(blocked(ctx({ gl: false, dmolView: false }))).toMatchObject({ vrml: 'no-3d', mol: 'no-3d', structure: null })
    // A session: 3Dmol.js has no view of it.
    expect(blocked(ctx({ dmolView: false }))).toMatchObject({ vrml: 'no-dmol-view', structure: null, pse: null })
    // 3Dmol.js itself did not load: its VRML says that, not ".pse" (PT-9188 item 6).
    expect(blocked(ctx({ dmolReady: false }))).toMatchObject({ vrml: 'no-dmol-lib', structure: null, mol: null })
    // Still loading: said as loading, never as a failure (PT-9229 item 1).
    expect(blocked(ctx({ dmolReady: false, dmolLoading: true }))).toMatchObject({ vrml: 'dmol-loading', structure: null })
    // A phone that cannot run PyMOL: its formats, not the others (PT-9192 item 3).
    expect(blocked(ctx({ pymolBlocked: true }))).toMatchObject({ mol: 'no-pymol', pse: 'no-pymol', structure: null, vrml: null })
    // PyMOL saving a picture holds no file (PT-9188 item 2).
    expect(blocked(ctx({ shown: 'pymol', pymolSaving: true }))).toMatchObject({ mol: null, pse: null })
  })
})

describe('imageItems (「画像出力」, owner 2026-11-16)', () => {
  it('offers the screenshot and, full edition only, PyMOL’s ray trace', () => {
    expect(imageItems(ctx()).map(i => i.id)).toEqual(['png', 'ray'])
    expect(imageItems(ctx({ full: false })).map(i => i.id)).toEqual(['png'])
    expect(imageItems(ctx({ full: false, shown: 'pymol' }))[0]).toMatchObject({ engine: '3dmol', tags: ['3dmol'] })
  })

  it('the screenshot is the engine on screen’s; the ray trace asks to switch to PyMOL first while 3Dmol.js is shown', () => {
    const on3dmol = byId(imageItems(ctx()))
    expect(on3dmol.png).toMatchObject({ engine: '3dmol', switchTo: null, tags: ['3dmol'] })
    expect(on3dmol.ray).toMatchObject({ engine: 'pymol', switchTo: 'pymol', tags: ['pymol'] })
    const onPymol = byId(imageItems(ctx({ shown: 'pymol' })))
    expect(onPymol.png).toMatchObject({ engine: 'pymol', switchTo: null, tags: ['pymol'] })
    expect(onPymol.ray).toMatchObject({ engine: 'pymol', switchTo: null })
  })

  it('says why a picture cannot be saved now', () => {
    const blocked = (c: ExportContext) => Object.fromEntries(imageItems(c).map(i => [i.id, i.blocked]))
    expect(blocked(ctx({ gl: false, dmolView: false }))).toEqual({ png: 'no-3d', ray: 'no-3d' })
    expect(blocked(ctx({ dmolView: false }))).toEqual({ png: 'no-dmol-view', ray: null })
    expect(blocked(ctx({ dmolView: false, shown: 'pymol' }))).toEqual({ png: null, ray: null })
    expect(blocked(ctx({ dmolReady: false }))).toEqual({ png: 'no-dmol-lib', ray: null })
    expect(blocked(ctx({ dmolReady: false, dmolLoading: true }))).toEqual({ png: 'dmol-loading', ray: null })
    // A phone that cannot run PyMOL: the ray trace says so, not hidden (PT-9192 item 3).
    expect(blocked(ctx({ pymolBlocked: true }))).toEqual({ png: null, ray: 'no-pymol' })
    // PyMOL saving a picture: no second one (PT-9188 item 2).
    expect(blocked(ctx({ shown: 'pymol', pymolSaving: true }))).toEqual({ png: 'saving', ray: 'saving' })
    expect(blocked(ctx({ pymolSaving: true }))).toEqual({ png: null, ray: 'saving' })
  })
})

describe('ExportDialog', () => {
  function open(c: ExportContext, structureFormat = 'mmCIF') {
    const onPick = vi.fn()
    const onClose = vi.fn()
    render(<ExportDialog items={exportItems(c)} structureFormat={structureFormat} onPick={onPick} onClose={onClose} />)
    return { onPick, onClose, user: userEvent.setup() }
  }

  it('「HTMLappとして出力」 stands out: its own row class and a 「おすすめ」 word badge in its name (owner 2026-11-16)', () => {
    open(ctx())
    const app = screen.getAllByRole('button', { name: /sa_export_/ })[0]
    expect(app).toHaveAccessibleName(/^htmlExport:sa_export_app htmlExport:sa_export_recommended /)
    expect(app.closest('li')).toHaveClass('sav-export-row--featured')
    expect(within(app).getByText('htmlExport:sa_export_recommended')).toHaveClass('sav-export-badge')
    expect(document.querySelectorAll('.sav-export-row--featured, .sav-export-badge')).toHaveLength(2)
  })

  it('「HTMLappとして出力」 goes darker under the pointer, as the other rows change on hover (owner 2026-11-19)', () => {
    const css = readFileSync(join(__dirname, 'standalone.css'), 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '')
    const rule = (selector: string) => css.match(new RegExp(`(?:^|\\})\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[1] ?? ''
    const base = rule('.sav-export-row--featured .sav-export-item')
    const hover = rule(".sav-export-row--featured .sav-export-item:hover:not(:disabled):not([aria-disabled='true'])")
    const rowHover = rule(".sav-export-item:hover:not(:disabled):not([aria-disabled='true'])")
    // The featured fill is the other rows' hover fill, so it needs a hover of its own, one shade darker.
    expect(base).toMatch(/background:\s*var\(--blue-bg\)/)
    expect(rowHover).toMatch(/background:\s*var\(--blue-bg\)/)
    expect(hover).toMatch(/background:\s*var\(--blue-light\)/)
  })

  it('the featured row’s engine tags keep 4.5:1 under that hover: they sit on white (PT-9894)', () => {
    const css = readFileSync(join(__dirname, 'standalone.css'), 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(css).toMatch(/\.sav-export-row--featured \.sav-tag\s*\{[^}]*background:\s*var\(--card-bg\)/)
    // The tags' colours against the white they sit on, from the app's own tokens (WCAG 2 contrast).
    const tokens = readFileSync(join(__dirname, '../../src/index.css'), 'utf-8')
    const token = (name: string) => tokens.match(new RegExp(`^\\s*--${name}:\\s*(#[0-9A-Fa-f]{6});`, 'm'))?.[1] ?? ''
    const luminance = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const contrast = (a: string, b: string) => {
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
      return (hi + 0.05) / (lo + 0.05)
    }
    for (const tag of ['blue-text', 'pink-text']) {
      expect(contrast(token(tag), token('card-bg')), `--${tag} on --card-bg`).toBeGreaterThanOrEqual(4.5)
      // What it would be on the hover fill: under 4.5:1, which is why the tags carry their own white.
      expect(contrast(token(tag), token('blue-light')), `--${tag} on --blue-light`).toBeLessThan(4.5)
    }
  })

  it('names the structure file by the open file’s own format', () => {
    open(ctx(), 'PDB')
    expect(screen.getByRole('button', { name: /sa_export_structure/ })).toHaveAccessibleName(/^htmlExport:sa_export_structure \{"format":"PDB"\}/)
  })

  it('lists the formats, 「HTMLappとして出力」 first, each with its engines as small words', () => {
    open(ctx())
    expect(screen.getByRole('dialog', { name: 'htmlExport:sa_export_title' })).toBeInTheDocument()
    const rows = screen.getAllByRole('button', { name: /sa_export_/ })
    expect(rows[0]).toHaveAccessibleName(/^htmlExport:sa_export_app/)
    const tags = (label: string) =>
      Array.from(screen.getByRole('button', { name: new RegExp(label) }).querySelectorAll('.sav-tag')).map(el => el.textContent)
    // PyMOL's tag is its mode's name without "mode" (owner 2026-11-18: PyMOL's name only in the forms its licence allows).
    expect(tags('sa_export_mol')).toEqual(['Includes PyMOL™'])
    expect(tags('sa_export_vrml')).toEqual(['3Dmol.js'])
    expect(tags('sa_export_structure')).toEqual(['Includes PyMOL™', '3Dmol.js'])
    expect(tags('sa_export_app')).toEqual(['Includes PyMOL™', '3Dmol.js'])
    // Never the old 「どちらでも」 word.
    expect(screen.queryByText(/sa_export_engine_any/)).toBeNull()
    // The pictures are 「画像出力」's now (owner 2026-11-16).
    expect(screen.queryByRole('button', { name: /sa_export_png|sa_export_ray/ })).toBeNull()
  })

  it('the light edition shows no PyMOL entry', () => {
    open(ctx({ full: false }))
    expect(document.querySelector('.sav-tag--pymol')).toBeNull()
    expect(screen.getAllByRole('button', { name: /sa_export_/ })).toHaveLength(3)
  })

  it('a format of the engine on screen is picked at once', async () => {
    const { user, onPick } = open(ctx())
    await user.click(screen.getByRole('button', { name: /sa_export_vrml/ }))
    expect(onPick).toHaveBeenCalledWith('vrml', false)
  })

  it('a PyMOL format while 3Dmol.js is shown asks first, and switches only on the second press', async () => {
    const { user, onPick } = open(ctx())
    const mol = screen.getByRole('button', { name: /sa_export_mol/ })
    await user.click(mol)
    expect(onPick).not.toHaveBeenCalled()
    expect(mol).toHaveAttribute('aria-expanded', 'true')
    const go = screen.getByRole('button', { name: 'htmlExport:sa_export_switch' })
    expect(go).toHaveFocus()
    await user.click(go)
    expect(onPick).toHaveBeenCalledWith('mol', true)
  })

  it('a PyMOL format while PyMOL is shown is picked at once', async () => {
    const { user, onPick } = open(ctx({ shown: 'pymol' }))
    await user.click(screen.getByRole('button', { name: /sa_export_pse/ }))
    expect(onPick).toHaveBeenCalledWith('pse', false)
    expect(screen.queryByRole('button', { name: 'htmlExport:sa_export_switch' })).toBeNull()
  })

  it('a format that cannot be used is shown greyed with its reason', async () => {
    const { user, onPick } = open(ctx({ dmolView: false }))
    const vrml = screen.getByRole('button', { name: /sa_export_vrml/ })
    expect(vrml).toHaveAttribute('aria-disabled', 'true')
    expect(vrml).toHaveAccessibleDescription('htmlExport:sa_export_blocked_no_dmol')
    await user.click(vrml)
    expect(onPick).not.toHaveBeenCalled()
    // Still in the Tab order: a keyboard user reaches it and hears why (PT-9230 item 6).
    vrml.blur()
    for (let i = 0; i < 12 && document.activeElement !== vrml; i++) await user.tab()
    expect(vrml).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(onPick).not.toHaveBeenCalled()
  })
})
