/**
 * Mol3dToolbar — the 3Dmol toolbar both structure viewers draw.
 *
 * The page tests cover each toolbar wired to its page's state; these cover the
 * component's own contract: each control calls its callback, `variant` keeps
 * each page's wording, a LOCKED control is shown greyed with a 🔒 and its
 * reason (never hidden) and does nothing, and the module stays free of server /
 * session / router imports so a standalone build can bundle it.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRef, type ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import enProteindb from '../../i18n/locales/en/proteindb.json'

const BUNDLE = enProteindb as Record<string, string>

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'en' },
    t: (key: string, opts?: Record<string, unknown>) => {
      const name = key.includes(':') ? key.split(':')[1] : key
      const template = BUNDLE[name]
      if (template === undefined) return name
      return template.replace(/\{\{(\w+)\}\}/g, (_m, token) => String(opts?.[token] ?? ''))
    },
  }),
}))

import Mol3dToolbar, {
  CONTROL_AVAILABLE,
  type ControlAvailability,
  type Mol3dToolbarBarProps,
  type Mol3dToolbarCardProps,
  type Mol3dToolbarFullscreenProps,
} from './Mol3dToolbar'
import { useViewerAnnotation } from './useViewerAnnotation'
import { DEPTH_CUE_DEFAULT } from './depthCue'

const LOCKED: ControlAvailability = { state: 'locked', reason: 'Needs the AgDB server' }

type Shared = Omit<Mol3dToolbarCardProps, 'variant' | 'annotation' | 'savingScreenshot' | 'activeLigand' | 'onResetLigandView' | 'ai' | 'mates'>

function sharedProps(): Shared {
  return {
    viewStyles: ['cartoon'],
    onToggleViewStyle: vi.fn(),
    colorScheme: 'spectrum',
    onColorScheme: vi.fn(),
    dyna1: CONTROL_AVAILABLE,
    visibility: { protein: true, ligands: true, water: false, spin: false },
    onToggleVisibility: vi.fn(),
    surface: { shown: false, opaque: false, opaqueSuppressed: false, type: 'VDW' },
    onToggleSurface: vi.fn(),
    onToggleSurfaceOpaque: vi.fn(),
    onSurfaceType: vi.fn(),
    depthCue: {
      value: DEPTH_CUE_DEFAULT,
      onChange: vi.fn(),
      onCommit: vi.fn(),
      onCancelGesture: vi.fn(),
      committed: DEPTH_CUE_DEFAULT,
      spanA: 50,
      capAvailable: false,
    },
    measureMode: false,
    onToggleMeasure: vi.fn(),
    screenshot: CONTROL_AVAILABLE,
    onScreenshot: vi.fn(),
    bgColor: 'white',
    onBgColor: vi.fn(),
  }
}

function cardProps(over: Partial<Mol3dToolbarCardProps> = {}): Omit<Mol3dToolbarCardProps, 'annotation'> {
  return {
    ...sharedProps(),
    variant: 'card',
    savingScreenshot: false,
    activeLigand: null,
    onResetLigandView: vi.fn(),
    ai: { availability: CONTROL_AVAILABLE, open: false, onToggle: vi.fn() },
    mates: {
      availability: CONTROL_AVAILABLE,
      shown: false,
      onToggle: vi.fn(),
      cutoff: 8,
      onCutoff: vi.fn(),
      statusText: '',
    },
    ...over,
  }
}

function fullscreenProps(over: Partial<Mol3dToolbarFullscreenProps> = {}): Omit<Mol3dToolbarFullscreenProps, 'annotation'> {
  return {
    ...sharedProps(),
    variant: 'fullscreen',
    selectedResidue: null,
    onClearSelectedResidue: vi.fn(),
    ...over,
  }
}

/** The annotation hook is real: the toolbar only hands it to ViewerToolChips. */
function WithAnnotation({ children }: { children: (a: ReturnType<typeof useViewerAnnotation>) => ReactNode }) {
  const annotation = useViewerAnnotation()
  return <>{children(annotation)}</>
}

function renderCard(props: Omit<Mol3dToolbarCardProps, 'annotation'>) {
  return render(<WithAnnotation>{a => <Mol3dToolbar {...props} annotation={a} />}</WithAnnotation>)
}

function renderFullscreen(props: Omit<Mol3dToolbarFullscreenProps, 'annotation'>) {
  return render(<WithAnnotation>{a => <Mol3dToolbar {...props} annotation={a} />}</WithAnnotation>)
}

describe('Mol3dToolbar — card variant (structure detail page)', () => {
  it('draws the card wording and calls back for style, colour and visibility', () => {
    const p = cardProps()
    renderCard(p)
    expect(screen.getByText('Style:')).toBeInTheDocument()
    expect(screen.getByLabelText('Ribbon')).toBeChecked()
    fireEvent.click(screen.getByLabelText('Stick'))
    expect(p.onToggleViewStyle).toHaveBeenCalledWith('stick')

    const select = screen.getByRole('combobox')
    expect(within(select).getByRole('option', { name: 'Secondary Structure' })).toBeInTheDocument()
    fireEvent.change(select, { target: { value: 'chain' } })
    expect(p.onColorScheme).toHaveBeenCalledWith('chain')

    fireEvent.click(screen.getByLabelText('Water'))
    expect(p.onToggleVisibility).toHaveBeenCalledWith('water')
    expect(screen.getByRole('link', { name: /Includes 3Dmol\.js/ })).toBeInTheDocument()
  })

  it('draws an optional leading control first on the Style row, before a rule; none by default (owner 2026-11-15)', () => {
    const { unmount } = renderCard(cardProps({ leading: <button type="button">Initial view</button> }))
    const lead = screen.getByRole('button', { name: 'Initial view' })
    const row = lead.parentElement!
    expect(row.firstElementChild).toBe(lead)
    const rule = lead.nextElementSibling!
    expect(rule).toHaveAttribute('aria-hidden', 'true')
    expect(rule.nextElementSibling).toHaveTextContent('Style:')
    unmount()
    renderCard(cardProps())
    // Without `leading`: the Style label is the row's first element.
    expect(screen.getByText('Style:').previousElementSibling).toBeNull()
  })

  it('drops 「Includes 3Dmol.js」 only when asked; AgDB’s pages keep it by default (owner 2026-11-16)', () => {
    const { unmount } = renderCard(cardProps({ includes3dmol: false }))
    expect(screen.queryByRole('link', { name: /Includes 3Dmol\.js/ })).toBeNull()
    unmount()
    renderCard(cardProps())
    expect(screen.getByRole('link', { name: /Includes 3Dmol\.js/ })).toHaveAttribute('href', 'https://3dmol.csb.pitt.edu/')
  })

  it('leaves out the screenshot only when asked, the swatches then at the row end; AgDB’s pages keep it (owner 2026-11-16)', () => {
    const { unmount } = renderCard(cardProps({ hideScreenshot: true }))
    expect(screen.queryByRole('button', { name: /Screenshot/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'White background' }).parentElement).toHaveStyle({ marginLeft: 'auto' })
    unmount()
    renderCard(cardProps())
    expect(screen.getByRole('button', { name: /Screenshot/ })).toHaveStyle({ marginLeft: 'auto' })
    expect(screen.getByRole('button', { name: 'White background' }).parentElement).not.toHaveStyle({ marginLeft: 'auto' })
  })

  it('names the background swatches as a group by a visible word only when given one (owner 2026-11-16)', () => {
    const p = cardProps({ bgLabel: 'Background' })
    const { unmount } = renderCard(p)
    const group = screen.getByRole('group', { name: 'Background' })
    expect(within(group).getByText('Background')).toBeVisible()
    // Each swatch keeps its own name and pressed state.
    expect(within(group).getByRole('button', { name: 'White background' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(within(group).getByRole('button', { name: 'Black background' }))
    expect(p.onBgColor).toHaveBeenCalledWith('black')
    unmount()
    // Without `bgLabel`: no group, no word, the swatches alone.
    renderCard(cardProps())
    const wrap = screen.getByRole('button', { name: 'White background' }).parentElement!
    expect(wrap).not.toHaveAttribute('role')
    expect(wrap).not.toHaveAttribute('aria-labelledby')
    expect(wrap.firstElementChild).toBe(screen.getByRole('button', { name: 'White background' }))
  })

  it('lists a locked Dyna-1 disabled with its reason, never hidden (PT-9105 item 1, PT-9106 item 1)', () => {
    const { rerender } = renderCard(cardProps({ dyna1: LOCKED }))
    const locked = screen.getByRole('option', { name: 'Dyna-1 (🔒 Needs the AgDB server)' })
    expect(locked).toBeDisabled()
    rerender(<WithAnnotation>{a => <Mol3dToolbar {...cardProps()} annotation={a} />}</WithAnnotation>)
    expect(screen.getByRole('option', { name: 'Dyna-1' })).toBeEnabled()
  })

  it('keeps a Dyna-1 choice shown as its locked option while it waits, so Spectrum can still be picked (PT-9219 item 3)', () => {
    const p = cardProps({ dyna1: LOCKED, colorScheme: 'dyna1' })
    renderCard(p)
    const select = screen.getByRole('combobox')
    expect(select).toHaveValue('dyna1')
    expect(screen.getByRole('option', { name: 'Dyna-1 (🔒 Needs the AgDB server)', selected: true })).toBeDisabled()
    // Spectrum is a change now, not the value already shown.
    fireEvent.change(select, { target: { value: 'spectrum' } })
    expect(p.onColorScheme).toHaveBeenCalledWith('spectrum')
  })

  it('shows Spectrum, what the viewer paints, for a scheme the toolbar does not list (PT-9112 item 2)', () => {
    const { rerender } = renderCard(cardProps({ dyna1: undefined, colorScheme: 'dyna1' }))
    // No `dyna1`: the toolbar offers no Dyna-1 at all.
    expect(screen.getByRole('combobox')).toHaveValue('spectrum')
    rerender(<WithAnnotation>{a => <Mol3dToolbar {...cardProps({ colorScheme: 'dyna1' })} annotation={a} />}</WithAnnotation>)
    expect(screen.getByRole('combobox')).toHaveValue('dyna1')
  })

  it('reveals the surface type chips only while the surface is on', () => {
    renderCard(cardProps())
    expect(screen.getByRole('button', { name: BUNDLE.viewer_surface_opaque })).toBeDisabled()
    expect(screen.queryByRole('group', { name: BUNDLE.viewer_surface_type })).toBeNull()
    cleanup()
    renderCard(cardProps({ surface: { shown: true, opaque: false, opaqueSuppressed: true, type: 'VDW' } }))
    expect(screen.getByRole('button', { name: BUNDLE.viewer_surface_opaque })).toBeEnabled()
    expect(screen.getByRole('group', { name: BUNDLE.viewer_surface_type })).toBeInTheDocument()
    expect(screen.getByText(BUNDLE.viewer_surface_opaque_suppressed)).toBeInTheDocument()
  })

  it('shows the mate cutoffs and status while mates are on', () => {
    const p = cardProps({ mates: { ...cardProps().mates!, shown: true, statusText: 'P 21 21 21: 4 copies' } })
    renderCard(p)
    expect(screen.getByRole('button', { name: '8 Å' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: '12 Å' }))
    expect(p.mates!.onCutoff).toHaveBeenCalledWith(12)
    expect(screen.getByRole('status')).toHaveTextContent('P 21 21 21: 4 copies')
  })

  it('shows the focused ligand with Reset View, and the AI colour swatch', () => {
    const p = cardProps({ activeLigand: { ligandName: 'ATP', chainId: 'A' }, bgColor: '#123456' })
    renderCard(p)
    expect(screen.getByText('Showing: ATP (Chain A)')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reset View' }))
    expect(p.onResetLigandView).toHaveBeenCalled()
    expect(screen.getByRole('img', { name: 'Background set by AI: #123456' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Black background' }))
    expect(p.onBgColor).toHaveBeenCalledWith('black')
    expect(screen.getByRole('button', { name: 'White background' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('shows Saving... and disables the screenshot while one is being saved', () => {
    renderCard(cardProps({ savingScreenshot: true }))
    expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled()
  })

  it('shows locked controls greyed with a padlock and the reason, and never calls them', () => {
    const p = cardProps({ screenshot: LOCKED, ai: { ...cardProps().ai!, availability: LOCKED }, mates: { ...cardProps().mates!, availability: LOCKED, shown: false } })
    renderCard(p)
    const shot = screen.getByRole('button', { name: /Screenshot/ })
    const ai = screen.getByRole('button', { name: /AI/ })
    const mates = screen.getByLabelText(BUNDLE.viewer_mates)
    for (const el of [shot, ai, mates]) {
      expect(el).toHaveAttribute('aria-disabled', 'true')
      expect(el).toHaveAccessibleDescription(/Needs the AgDB server/)
    }
    expect(shot).toHaveClass('sv3d-locked')
    // The class's colours apply: no inline colour, fill or border wins over them (PT-9106 item 3).
    expect(shot.style.color).toBe('')
    expect(shot.style.background).toBe('')
    expect(screen.getAllByText('🔒', { exact: false })).toHaveLength(3)
    fireEvent.click(shot)
    fireEvent.click(ai)
    fireEvent.click(mates)
    expect(p.onScreenshot).not.toHaveBeenCalled()
    expect(p.ai!.onToggle).not.toHaveBeenCalled()
    expect(p.mates!.onToggle).not.toHaveBeenCalled()
    // A locked switch that is off: its cutoff chips stay away.
    expect(mates).not.toBeChecked()
    expect(screen.queryByRole('button', { name: '8 Å' })).toBeNull()
  })

  it('keeps a locked switch that is ON truthful and able to turn it off (PT-9104, PT-9105 item 8)', () => {
    const p = cardProps({
      ai: { ...cardProps().ai!, availability: LOCKED, open: true },
      mates: { ...cardProps().mates!, availability: LOCKED, shown: true, statusText: 'P 1: 2 copies' },
      screenshot: LOCKED,
      savingScreenshot: true,
    })
    renderCard(p)
    const mates = screen.getByLabelText(BUNDLE.viewer_mates)
    expect(mates).toBeChecked()
    expect(mates).not.toHaveAttribute('aria-disabled')
    expect(mates).toHaveAccessibleDescription(/Needs the AgDB server/)
    fireEvent.click(mates)
    expect(p.mates!.onToggle).toHaveBeenCalledOnce()
    // What is drawn is still described: the cutoff and the status.
    expect(screen.getByRole('button', { name: '8 Å' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('P 1: 2 copies')
    const ai = screen.getByRole('button', { name: /AI/ })
    expect(ai).toHaveAttribute('aria-pressed', 'true')
    expect(ai).not.toHaveAttribute('aria-disabled')
    fireEvent.click(ai)
    expect(p.ai!.onToggle).toHaveBeenCalledOnce()
    // A save already running still says so while the button is locked.
    expect(screen.getByRole('button', { name: 'Saving...' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('draws no AI, mates or Dyna-1 where the host leaves them out (the offline HTML export)', () => {
    renderCard(cardProps({ ai: undefined, mates: undefined, dyna1: undefined, colorScheme: 'dyna1' }))
    expect(screen.queryByRole('button', { name: /AI/ })).toBeNull()
    expect(screen.queryByLabelText(BUNDLE.viewer_mates)).toBeNull()
    expect(screen.queryByRole('option', { name: 'Dyna-1' })).toBeNull()
    expect(screen.queryByText('🔒', { exact: false })).toBeNull()
  })
})

describe('Mol3dToolbar — fullscreen variant (/viewer/:structureId)', () => {
  it('draws the fullscreen wording, the slots, and hands the toolbar element to the host', () => {
    const ref = createRef<HTMLDivElement>()
    const p = fullscreenProps({
      toolbarRef: ref,
      leading: <span>STR-1</span>,
      pymolEntry: <button type="button">PyMOL ↗</button>,
    })
    renderFullscreen(p)
    expect(ref.current).toHaveClass('sv3d', 'sv3d--dark')
    expect(ref.current?.firstElementChild).toHaveTextContent('STR-1')
    // Raw representation keys here, the card says Ribbon.
    expect(screen.getByLabelText('cartoon')).toBeChecked()
    expect(screen.queryByLabelText('Ribbon')).toBeNull()
    expect(screen.getByRole('option', { name: 'Sec. Structure' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'PyMOL ↗' })).toBeInTheDocument()
    // The card's own controls are not part of this variant.
    expect(screen.queryByRole('button', { name: /AI/ })).toBeNull()
    expect(screen.queryByLabelText(BUNDLE.viewer_mates)).toBeNull()
    // Named from the bundle, not by its emoji (PT-9106 item 4); so are the swatches.
    fireEvent.click(screen.getByRole('button', { name: BUNDLE.viewer_screenshot }))
    expect(p.onScreenshot).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: BUNDLE.viewer_bg_white })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: BUNDLE.viewer_bg_black }))
    expect(p.onBgColor).toHaveBeenCalledWith('black')
    fireEvent.click(screen.getByRole('button', { name: /Measure/ }))
    expect(p.onToggleMeasure).toHaveBeenCalled()
  })

  it('shows the picked residue with its clear button', () => {
    const p = fullscreenProps({ selectedResidue: { chain: 'B', resi: 1234 } })
    renderFullscreen(p)
    fireEvent.click(screen.getByRole('button', { name: BUNDLE.viewer_clear_selection }))
    expect(p.onClearSelectedResidue).toHaveBeenCalled()
    expect(screen.getByText(/1234/)).toBeInTheDocument()
  })

  it('locks the screenshot with a padlock and the reason', () => {
    const p = fullscreenProps({ screenshot: LOCKED })
    renderFullscreen(p)
    const shot = screen.getByRole('button', { name: BUNDLE.viewer_screenshot })
    expect(shot).toHaveAttribute('aria-disabled', 'true')
    expect(shot).toHaveAccessibleDescription(/Needs the AgDB server/)
    fireEvent.click(shot)
    expect(p.onScreenshot).not.toHaveBeenCalled()
  })
})

describe('Mol3dToolbar — bundleable into the offline HTML export', () => {
  it('imports nothing that reaches the server, the session or the router', () => {
    const source = readFileSync(join(__dirname, 'Mol3dToolbar.tsx'), 'utf-8')
    const imports = [...source.matchAll(/^import[^'"]*['"]([^'"]+)['"]/gm)].map(m => m[1])
    expect(imports.length).toBeGreaterThan(0)
    for (const spec of imports) {
      expect(spec).not.toMatch(/(^|\/)api(\/|$)|AuthContext|react-router/)
      // Only React, i18n and siblings in this folder.
      expect(spec === 'react' || spec === 'react-i18next' || spec.startsWith('./')).toBe(true)
    }
  })
})

describe('Mol3dToolbar — bar variant (the offline file on a computer, owner 2026-11-19)', () => {
  function renderBar(over: Partial<Omit<Mol3dToolbarBarProps, 'annotation'>> = {}) {
    const props: Omit<Mol3dToolbarBarProps, 'annotation'> = { ...sharedProps(), variant: 'bar', bgLabel: 'Background', ...over }
    return render(<WithAnnotation>{a => <Mol3dToolbar {...props} annotation={a} />}</WithAnnotation>)
  }

  it('is one named row: 初期表示, the colour select, Measure and the background in sight; the rest behind drop-downs', () => {
    const onToggleMeasure = vi.fn()
    renderBar({ viewStyles: ['cartoon', 'stick'], onToggleMeasure, leading: <button type="button">Initial view</button> })
    const bar = screen.getByRole('group', { name: 'Viewer controls' })
    expect(within(bar).getByRole('button', { name: 'Initial view' })).toBeInTheDocument()
    expect(within(bar).getByRole('combobox')).toHaveValue('spectrum')
    // Style says what is chosen; its checkboxes are in its closed panel.
    const style = within(bar).getByRole('button', { name: /^Style/ })
    expect(style).toHaveTextContent('StyleRibbon +1')
    expect(style).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('checkbox', { name: 'Ribbon' })).toBeNull()
    for (const name of [/^Show/, /^Surface/, /^Depth/, /^Draw/]) expect(within(bar).getByRole('button', { name })).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(within(bar).getByRole('button', { name: /Measure/ }))
    expect(onToggleMeasure).toHaveBeenCalled()
    expect(within(bar).getByRole('group', { name: 'Background' })).toBeInTheDocument()
    // No 📷 in this layout.
    expect(screen.queryByRole('button', { name: /Screenshot/ })).toBeNull()
  })

  it('a drop-down opens over the view with its controls, one at a time', () => {
    const onToggleViewStyle = vi.fn()
    const onToggleVisibility = vi.fn()
    renderBar({ onToggleViewStyle, onToggleVisibility })
    fireEvent.click(screen.getByRole('button', { name: /^Style/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Stick' }))
    expect(onToggleViewStyle).toHaveBeenCalledWith('stick')
    fireEvent.click(screen.getByRole('button', { name: /^Show/ }))
    expect(screen.getByRole('button', { name: /^Style/ })).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Water' }))
    expect(onToggleVisibility).toHaveBeenCalledWith('water')
  })

  it('says the surface is on, and with a pen armed offers the way back to turning the view on the row itself', () => {
    renderBar({ surface: { shown: true, opaque: false, opaqueSuppressed: false, type: 'VDW' } })
    expect(screen.getByRole('button', { name: /^Surface/ })).toHaveTextContent('SurfaceOn')
    fireEvent.click(screen.getByRole('button', { name: /^Draw/ }))
    fireEvent.click(screen.getByRole('button', { name: BUNDLE.viewer_pen }))
    expect(screen.getByRole('button', { name: /^Draw/ })).toHaveTextContent(`Draw${BUNDLE.viewer_pen}`)
    // Two ways back now: the panel's own chip and the row's.
    expect(screen.getAllByRole('button', { name: BUNDLE.viewer_navigate })).toHaveLength(2)
    fireEvent.click(screen.getAllByRole('button', { name: BUNDLE.viewer_navigate })[1])
    expect(screen.getByRole('button', { name: /^Draw/ })).toHaveTextContent(/^Draw▾$/)
  })
})
