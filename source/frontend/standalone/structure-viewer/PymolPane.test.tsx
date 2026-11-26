/**
 * The offline file's PyMOL pane against a scripted bridge: Reset and the
 * object panel's pull tab keep the focus while PyMOL reloads, the tab's
 * place and state (owner 2026-11-15), 「初期表示」 left of File, no 「📏 測定」
 * of the page's on a computer but a 「測定中・終了」 while PyMOL measures, and
 * what the command line says while the phone's sheet is closed is said by
 * the view. A phone (owner 2026-11-19) has no PyMOL object panel: its own
 * 「オブジェクト」 button and list, presets as buttons, PyMOL's menu folded
 * without what needs the panel or a mouse, and a measuring card.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key} ${JSON.stringify(vars)}` : key),
    i18n: { language: 'en' },
  }),
}))

import { resetModalStackForTests } from '../../src/components/modalStack'
import { MEASURE_OFF } from '../../src/pages/pymol-viewer/PymolMeasureChip'
import { MEASURE_DELETE_LAST, MEASURE_OFF_QUIET, MEASURE_ON_QUIET, measureModeCommand } from './PymolMeasureCard'
import type { BridgeState, StandalonePymol } from './pymolBridge'
import { resetOriginalPanelForTests, setOriginalPanel } from './originalPanel'
import { MOTION_SPIN_STOP, MOTION_STOP } from './PymolControlTail'
import { seqHighlightCommand, seqWantCommand } from './pymolSeq'
import type { PymolInkHandle } from './pymolInk'
import { SEQ_STRIP_H } from './PymolSeqStrip'
import { inkOntoPng } from './pymolInk'
import { PymolPane, zoomSteps } from './PymolPane'

// The lines go onto PyMOL's picture through a canvas jsdom has not: what the pane hands over is what is checked.
vi.mock('./pymolInk', async importOriginal => ({
  ...(await importOriginal<typeof import('./pymolInk')>()),
  inkOntoPng: vi.fn(async (png: ArrayBuffer) => ({ png, left: null })),
}))

/** A pointer event jsdom can construct (it has no PointerEvent): a mouse's left button. */
function pointer(el: Element, type: string, x: number, y: number, buttons = 1) {
  act(() => {
    const evt = new MouseEvent(type, { clientX: x, clientY: y, buttons, bubbles: true })
    Object.defineProperty(evt, 'pointerId', { value: 1 })
    el.dispatchEvent(evt)
  })
}

const READY: BridgeState = { phase: 'ready', failure: null, busy: null, ui: null, scene: 'plain', lookError: null, generation: 1, objectPanel: false }

function fakeBridge() {
  let state = READY
  const listeners = new Set<() => void>()
  const set = (p: Partial<BridgeState>) => {
    state = { ...state, ...p }
    for (const l of listeners) l()
  }
  const bridge = {
    subscribe: (fn: () => void) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    getState: () => state,
    attach: vi.fn(),
    relabel: vi.fn(),
    start: vi.fn(async () => undefined),
    cancel: vi.fn(() => false),
    runCommand: vi.fn(async () => undefined),
    currentView: vi.fn((): number[] | null => null),
    resetScene: vi.fn(async () => set({ phase: 'loading' })),
    toggleObjectPanel: vi.fn(async () => set({ phase: 'loading' })),
    setObjectPanel: vi.fn(async (_shown: boolean) => undefined),
    setDocked: vi.fn((_docked: boolean) => undefined),
    setOriginalPanel: vi.fn((_on: boolean) => undefined),
    objectAction: vi.fn(async (_index: number, _action: unknown) => undefined),
  }
  return { bridge, set }
}

const pane = (bridge: unknown, over: Partial<Parameters<typeof PymolPane>[0]> = {}) => (
  <PymolPane bridge={bridge as StandalonePymol} bColumn="bfactor" onOpenLicences={() => undefined} onOpenFile={() => undefined} onExport={() => undefined} {...over} />
)

afterEach(() => {
  cleanup()
  resetModalStackForTests()
})

describe('PymolPane', () => {
  it('draws the page logo before 創薬表示; none without one or once it fails (owner 2026-11-16)', () => {
    const { bridge } = fakeBridge()
    const LOGO = 'data:image/png;base64,iVBORw0KGgo='
    const { unmount } = render(pane(bridge, { logo: LOGO }))
    const logos = document.querySelectorAll('img.pymolv-menubar-logo')
    expect(logos).toHaveLength(1)
    expect(logos[0]).toHaveAttribute('src', LOGO)
    expect(logos[0]).toHaveAttribute('aria-hidden', 'true')
    expect(logos[0].closest('[role="menuitem"]')).toHaveTextContent('pymol:menu_presets')
    fireEvent.error(logos[0])
    expect(document.querySelector('img.pymolv-menubar-logo')).toBeNull()
    unmount()
    render(pane(bridge))
    expect(document.querySelector('img.pymolv-menubar-logo')).toBeNull()
  })

  it('Reset keeps the focus while PyMOL reloads: aria-disabled, never disabled, and a press then does nothing (PT-9220 item 1)', async () => {
    const { bridge, set } = fakeBridge()
    const user = userEvent.setup()
    render(pane(bridge))
    const reset = screen.getByRole('button', { name: 'htmlExport:sa_view_exported' })
    await user.click(reset)
    expect(bridge.resetScene).toHaveBeenCalledOnce()
    // 'loading' now: still focused, unavailable, and a second press asks nothing.
    expect(reset).toHaveFocus()
    expect(reset).toBeEnabled()
    expect(reset).toHaveAttribute('aria-disabled', 'true')
    await user.click(reset)
    expect(bridge.resetScene).toHaveBeenCalledOnce()
    const panel = screen.getByRole('button', { name: 'htmlExport:sa_pymol_objects_name' })
    expect(panel).toHaveAttribute('aria-disabled', 'true')
    expect(panel).toHaveAccessibleDescription('htmlExport:sa_pymol_objects_wait')
    await user.click(panel)
    expect(bridge.toggleObjectPanel).not.toHaveBeenCalled()
    expect(panel).toHaveFocus()
    act(() => set({ phase: 'ready' }))
    expect(reset).not.toHaveAttribute('aria-disabled')
    expect(panel).toHaveFocus()
  })

  it('the object panel’s pull tab: right of the view, outside it, an expandable control that toggles the panel (owner 2026-11-15)', async () => {
    const { bridge, set } = fakeBridge()
    bridge.toggleObjectPanel.mockImplementation(async () => set({ objectPanel: !bridge.getState().objectPanel }))
    const user = userEvent.setup()
    render(pane(bridge))
    const tab = screen.getByRole('button', { name: 'htmlExport:sa_pymol_objects_name' })
    // No 「オブジェクト一覧」 button in the row any more: the tab is the one control.
    expect(document.querySelector('.pymolv-bar')!.contains(tab)).toBe(false)
    // In the stage, after the view's host — never inside it (the bridge owns that).
    const host = document.querySelector('.sav-pymol-host')!
    expect(host.contains(tab)).toBe(false)
    expect(host.parentElement!.contains(tab)).toBe(true)
    expect(tab).toHaveAttribute('aria-controls', host.id)
    expect(tab).toHaveTextContent('htmlExport:sa_pymol_objects_tab')
    expect(tab).toHaveAttribute('aria-expanded', 'false')
    await user.click(tab)
    expect(tab).toHaveAttribute('aria-expanded', 'true')
    tab.focus()
    await user.keyboard('{Enter}')
    expect(tab).toHaveAttribute('aria-expanded', 'false')
    await user.keyboard(' ')
    expect(tab).toHaveAttribute('aria-expanded', 'true')
    expect(bridge.toggleObjectPanel).toHaveBeenCalledTimes(3)
  })

  it('the open tab sits left of the panel as wide as the worker says, and shows while the mouse is over the panel (owner 2026-11-16)', () => {
    const { bridge, set } = fakeBridge()
    render(pane(bridge))
    const tab = screen.getByRole('button', { name: 'htmlExport:sa_pymol_objects_name' })
    const strip = tab.parentElement!
    const stage = document.querySelector('.sav-pymol-stage') as HTMLElement
    expect(strip.style.right).toBe('')
    // Before the worker's report: PyMOL's default at this scale (jsdom's DPR 1: 220 CSS px).
    act(() => set({ objectPanel: true }))
    expect(strip.style.right).toMatch(/^min\(220px\W+calc\(100% - 28px\)\)$/)
    act(() => set({ objectPanelWidth: 300 }))
    expect(strip.style.right).toMatch(/^min\(300px\W+calc\(100% - 28px\)\)$/)
    vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue({ left: 0, right: 900, top: 0, bottom: 500, width: 900, height: 500 } as DOMRect)
    const move = (x: number, pointerType = 'mouse') => {
      const e = new MouseEvent('pointermove', { bubbles: true, clientX: x, clientY: 200 })
      Object.defineProperty(e, 'pointerType', { value: pointerType })
      fireEvent(stage, e)
    }
    expect(strip).not.toHaveAttribute('data-revealed')
    move(650)
    expect(strip).toHaveAttribute('data-revealed', 'true')
    move(500)
    expect(strip).not.toHaveAttribute('data-revealed')
    // A touch screen: always shown while open.
    move(10, 'touch')
    expect(strip).toHaveAttribute('data-revealed', 'true')
    // Closed, it is at the right edge and never transparent.
    act(() => set({ objectPanel: false }))
    expect(strip.style.right).toBe('')
    expect(strip).toHaveAttribute('data-open', 'false')
  })

  it('a swipe on the tab asks the bridge for the panel one way, never for a flip (PT-9400 item 1)', () => {
    const { bridge } = fakeBridge()
    render(pane(bridge))
    const tab = screen.getByRole('button', { name: 'htmlExport:sa_pymol_objects_name' })
    // jsdom has no PointerEvent: a MouseEvent carrying pointerId (as PymolObjectDrawerTab.test.tsx).
    const pointer = (type: string, x: number) => {
      const e = new MouseEvent(type, { bubbles: true, clientX: x, clientY: 100 })
      Object.defineProperty(e, 'pointerId', { value: 1 })
      fireEvent(tab, e)
    }
    for (const [from, to] of [[200, 150], [200, 150], [150, 200]]) {
      pointer('pointerdown', from)
      pointer('pointerup', to)
    }
    expect(bridge.setObjectPanel.mock.calls).toEqual([[true], [true], [false]])
    expect(bridge.toggleObjectPanel).not.toHaveBeenCalled()
  })

  it('the tab of a stopped PyMOL says so and does nothing', async () => {
    const { bridge, set } = fakeBridge()
    const user = userEvent.setup()
    render(pane(bridge))
    act(() => set({ phase: 'failed', failure: 'x' }))
    const tab = screen.getByRole('button', { name: 'htmlExport:sa_pymol_objects_name' })
    expect(tab).toHaveAttribute('aria-disabled', 'true')
    expect(tab).toHaveAccessibleDescription('htmlExport:sa_pymol_objects_off')
    await user.click(tab)
    expect(bridge.toggleObjectPanel).not.toHaveBeenCalled()
  })

  it('「初期表示」 is left of File, in one row with the menu bar but outside its menubar role (owner 2026-11-15)', () => {
    const { bridge } = fakeBridge()
    render(pane(bridge))
    const reset = screen.getByRole('button', { name: 'htmlExport:sa_view_exported' })
    const menubar = screen.getByRole('menubar')
    expect(menubar.contains(reset)).toBe(false)
    const row = reset.parentElement!
    expect(row).toHaveClass('sav-pymol-menurow')
    expect(row.contains(menubar)).toBe(true)
    expect(row.firstElementChild).toBe(reset)
    expect(menubar.querySelector('button')).toHaveTextContent('File')
  })

  it('docked, the sheet has 「初期表示」 and 「📏 測定」, the presets as buttons, and PyMOL’s menu and command line folded (owner 2026-11-19)', async () => {
    const { bridge } = fakeBridge()
    const user = userEvent.setup()
    const sheet = document.createElement('div')
    document.body.appendChild(sheet)
    const onCloseSheet = vi.fn()
    render(pane(bridge, { docked: true, toolsHost: sheet, onCloseSheet }))
    const quick = sheet.querySelector('.sav-pymol-quick')!
    expect(quick.firstElementChild).toHaveTextContent('htmlExport:sa_view_exported')
    // The presets: the B-factor colouring that fits the structure, never both.
    const presets = sheet.querySelector('[role="group"].sav-pymol-presets')!
    expect([...presets.querySelectorAll('button')].map(b => b.textContent)).toEqual([
      'pymol:preset_ligand_site',
      'pymol:preset_pocket',
      'pymol:preset_bfactor',
      'pymol:preset_publication',
      'pymol:preset_reset',
    ])
    // PyMOL's menu, folded with the command line, without what needs the object panel or a mouse.
    const more = sheet.querySelector('details.sav-pymol-more')!
    expect(more).not.toHaveAttribute('open')
    const tops = [...more.querySelectorAll('[role="menubar"] > * > [role="menuitem"], [role="menubar"] > [role="menuitem"]')].map(b => b.textContent)
    expect(tops).toContain('File')
    expect(tops).toContain('Display')
    for (const gone of ['Build', 'Mouse', 'Wizard', 'pymol:menu_presets']) expect(tops).not.toContain(gone)
    expect(more.querySelector('input')).not.toBeNull()
    // 「📏 測定」 closes the sheet, so atoms can be tapped, and starts PyMOL's Measurement wizard.
    await user.click(screen.getByRole('button', { name: /pymol:measure$/ }))
    expect(onCloseSheet).toHaveBeenCalled()
    expect(bridge.runCommand).toHaveBeenCalledWith(MEASURE_ON_QUIET, undefined)
    sheet.remove()
  })

  it('a computer: 「🖱 マウス操作」 at the right of the menu row opens the card over the view, clear of the panel; Escape gives the focus back (owner 2026-11-19)', async () => {
    const { bridge, set } = fakeBridge()
    const user = userEvent.setup()
    render(pane(bridge))
    act(() => set({ objectPanel: true, objectPanelWidth: 220, mouseMode: '3-Button Editing' }))
    const button = screen.getByRole('button', { name: 'htmlExport:sa_mouse_button' })
    expect(button.closest('.sav-pymol-menurow')).not.toBeNull()
    expect(button).toHaveAttribute('aria-expanded', 'false')
    await user.click(button)
    const card = screen.getByRole('dialog', { name: /sa_mouse_title/ })
    expect(button).toHaveAttribute('aria-controls', card.id)
    expect(card.closest('.sav-pymol-stage')).not.toBeNull()
    expect(card.style.right).toBe('228px')
    // The mode PyMOL reports is the card's.
    expect(card).toHaveTextContent('{"mode":"3-Button Editing"}')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: /sa_mouse_title/ })).toBeNull()
    expect(button).toHaveFocus()
  })

  it('docked, there is no mouse card: a phone has its own gestures', () => {
    const { bridge } = fakeBridge()
    render(pane(bridge, { docked: true, toolsHost: null }))
    expect(screen.queryByRole('button', { name: 'htmlExport:sa_mouse_button' })).toBeNull()
  })

  it('docked, the bridge keeps PyMOL’s object panel hidden; the view has 「オブジェクト」 with the objects’ count, not the pull tab (owner 2026-11-19)', async () => {
    const { bridge, set } = fakeBridge()
    const user = userEvent.setup()
    const onObjects = vi.fn()
    const lists = document.createElement('div')
    document.body.appendChild(lists)
    const { rerender } = render(pane(bridge, { docked: true, toolsHost: null, onObjects }))
    expect(bridge.setDocked).toHaveBeenLastCalledWith(true)
    expect(document.querySelector('.pymolv-drawer-tab')).toBeNull()
    const button = screen.getByRole('button', { name: 'htmlExport:sa_objs_button' })
    expect(button).toHaveAttribute('aria-haspopup', 'dialog')
    act(() =>
      set({
        objects: {
          v: 1,
          items: [
            { name: '1abc', kind: 'molecule', on: true },
            { name: 'lig', kind: 'molecule', on: false },
            { name: 'sele', kind: 'selection', on: true },
          ],
          more: false,
          focus: null,
          reps: null,
        },
      }),
    )
    expect(screen.getByRole('button', { name: 'htmlExport:sa_objs_button 2' })).toBe(button)
    expect(button.textContent).toBe('htmlExport:sa_objs_button 2')
    await user.click(button)
    expect(onObjects).toHaveBeenCalled()
    // The sheet's 「オブジェクト」 tab: the list is drawn there.
    rerender(pane(bridge, { docked: true, toolsHost: null, onObjects, objectsHost: lists }))
    expect(lists.querySelector('.sav-objs-list')).not.toBeNull()
    // Back on a computer: the bridge may show the panel again, and the pull tab is back.
    rerender(pane(bridge, { docked: false }))
    expect(bridge.setDocked).toHaveBeenLastCalledWith(false)
    expect(document.querySelector('.pymolv-drawer-tab')).not.toBeNull()
    lists.remove()
  })

  it('no 「📏 測定」 button of the page’s: PyMOL’s Wizard > Measurement is the way in; while one runs the button row offers its end (owner 2026-11-15)', async () => {
    const { bridge, set } = fakeBridge()
    const user = userEvent.setup()
    render(pane(bridge))
    expect(screen.queryByRole('button', { name: /pymol:measure|sa_pymol_measure_end/ })).toBeNull()
    expect(document.querySelector('.pymolv-stage-tools')).toBeNull()
    // Begun from the Wizard menu or the command line: PyMOL reports its wizard.
    act(() => set({ ui: { sel: null, atoms: null, more: false, shown: 1, hetero: false, wizard: 'measurement' } as unknown as BridgeState['ui'] }))
    const end = screen.getByRole('button', { name: /sa_pymol_measure_end/ })
    expect(end.closest('.pymolv-bar')).not.toBeNull()
    await user.click(end)
    expect(bridge.runCommand).toHaveBeenCalledWith(MEASURE_OFF, undefined)
    act(() => set({ ui: { sel: null, atoms: null, more: false, shown: 1, hetero: false, wizard: null } as unknown as BridgeState['ui'] }))
    expect(screen.queryByRole('button', { name: /sa_pymol_measure_end/ })).toBeNull()
  })

  it('docked, while measuring the view offers a card: distances, angles or dihedrals, the last one away, and Done (owner 2026-11-19)', async () => {
    const { bridge, set } = fakeBridge()
    const user = userEvent.setup()
    render(pane(bridge, { docked: true, toolsHost: null }))
    expect(screen.queryByRole('group', { name: 'htmlExport:sa_measure_card' })).toBeNull()
    act(() => set({ ui: { sel: null, atoms: null, more: false, shown: 1, hetero: false, wizard: 'measurement' } as unknown as BridgeState['ui'] }))
    const card = screen.getByRole('group', { name: 'htmlExport:sa_measure_card' })
    expect(card.closest('.sav-measure-float')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'htmlExport:sa_measure_mode_pairs' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'htmlExport:sa_measure_mode_angle' }))
    expect(bridge.runCommand).toHaveBeenCalledWith(measureModeCommand('angle'), undefined)
    expect(screen.getByRole('button', { name: 'htmlExport:sa_measure_mode_angle' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'htmlExport:sa_measure_delete_last' }))
    expect(bridge.runCommand).toHaveBeenCalledWith(MEASURE_DELETE_LAST, undefined)
    await user.click(screen.getByRole('button', { name: 'htmlExport:sa_measure_end' }))
    expect(bridge.runCommand).toHaveBeenCalledWith(MEASURE_OFF_QUIET, undefined)
    act(() => set({ ui: { sel: null, atoms: null, more: false, shown: 1, hetero: false, wizard: null } as unknown as BridgeState['ui'] }))
    expect(screen.queryByRole('group', { name: 'htmlExport:sa_measure_card' })).toBeNull()
  })

  it('a preset’s note: under the view with 「詳しく」 and ×, which empties it and leaves the focus on the command line (owner 2026-11-19)', async () => {
    const { bridge } = fakeBridge()
    const user = userEvent.setup()
    render(pane(bridge))
    await user.click(screen.getByRole('menuitem', { name: /pymol:menu_presets/ }))
    await user.click(screen.getByRole('menuitem', { name: /pymol:preset_ligand_site/ }))
    const note = await screen.findByText('pymol:preset_note_ligand_site')
    expect(note).toHaveAttribute('role', 'status')
    expect(note.closest('.pymolv-foot')).not.toBeNull()
    await user.click(screen.getByRole('button', { name: 'pymol:menu_message_close' }))
    expect(note).toBeEmptyDOMElement()
    expect(screen.getByRole('textbox')).toHaveFocus()
  })

  it('docked, the note floats over the view’s foot (above the measuring card), and × leaves the focus on 「オブジェクト」', async () => {
    const { bridge, set } = fakeBridge()
    const user = userEvent.setup()
    const sheet = document.createElement('div')
    document.body.appendChild(sheet)
    const { rerender } = render(pane(bridge, { docked: true, toolsHost: sheet }))
    await user.click(screen.getByRole('button', { name: 'pymol:preset_ligand_site' }))
    // The sheet closes so the view shows: the note is by the view, not in the sheet.
    rerender(pane(bridge, { docked: true, toolsHost: null }))
    const note = await screen.findByText('pymol:preset_note_ligand_site')
    const float = note.closest('.sav-note-float')!
    expect(float).not.toBeNull()
    expect(float.closest('.sav-pymol-stage')).not.toBeNull()
    expect(float).not.toHaveClass('sav-note-float--above')
    act(() => set({ ui: { sel: null, atoms: null, more: false, shown: 1, hetero: false, wizard: 'measurement' } as unknown as BridgeState['ui'] }))
    expect(float).toHaveClass('sav-note-float--above')
    await user.click(screen.getByRole('button', { name: 'pymol:menu_message_close' }))
    expect(note).toBeEmptyDOMElement()
    expect(document.activeElement).toHaveClass('sav-objs-fab')
    sheet.remove()
  })

  it('what the command line says while the phone’s sheet is closed is said by the view (PT-9229 item 5)', async () => {
    const { bridge } = fakeBridge()
    let fail: (e: Error) => void = () => undefined
    bridge.runCommand.mockImplementation(() => new Promise<undefined>((_r, rej) => (fail = rej)))
    const user = userEvent.setup()
    const sheet = document.createElement('div')
    document.body.appendChild(sheet)
    const { rerender } = render(pane(bridge, { docked: true, toolsHost: sheet }))
    const box = await screen.findByRole('textbox')
    await user.type(box, 'show sticks{Enter}')
    // The sheet closes while the line runs: the box leaves the document.
    rerender(pane(bridge, { docked: true, toolsHost: null }))
    expect(screen.queryByRole('textbox')).toBeNull()
    const echo = document.querySelector('.sav-cmd-echo')!
    expect(echo).toHaveTextContent('')
    await act(async () => fail(new Error('Selector-Error: invalid')))
    expect(echo).toHaveAttribute('role', 'status')
    expect(echo).toHaveTextContent('pymol:cmd_failed')
    // The sheet opens again: the box says it itself; the view's copy goes.
    rerender(pane(bridge, { docked: true, toolsHost: sheet }))
    expect(echo).toHaveTextContent('')
    sheet.remove()
  })
})

describe('PymolPane, the object panel (owner 2026-11-19)', () => {
  /** PyMOL's defaults doubled: a 1000 × 600 buffer on a 500 × 300 canvas (panelGeometry.test.ts). */
  const LAYOUT = { bw: 1000, bh: 600, px: 440, lh: 36, tw: 34, ts: 32, cm: 4, ops: 5, rows: 3, bottom: 328 }
  const rect = { left: 0, right: 500, top: 0, bottom: 300, width: 500, height: 300, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
  // A move over the stage lands on PyMOL's canvas, in the bridge's host: only there is the panel marked.
  const move = (el: Element, x: number, y: number, pointerType = 'mouse', buttons = 0) => {
    const e = new MouseEvent('pointermove', { bubbles: true, clientX: x, clientY: y, buttons })
    Object.defineProperty(e, 'pointerType', { value: pointerType })
    fireEvent(el.classList.contains('sav-pymol-stage') ? (el.querySelector('.sav-pymol-host') ?? el) : el, e)
  }
  afterEach(() => {
    window.localStorage.clear()
    resetOriginalPanelForTests()
    vi.restoreAllMocks()
  })

  it('a computer: the button under the mouse is marked and named, the name cell too; nothing off the panel, under a press, or on a touch', () => {
    const { bridge, set } = fakeBridge()
    render(pane(bridge))
    act(() => set({ objectPanel: true, objectPanelLayout: LAYOUT }))
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect)
    const stage = document.querySelector('.sav-pymol-stage') as HTMLElement
    move(stage, 499, 10)
    const mark = document.querySelector<HTMLElement>('.sav-panel-mark')!
    expect(mark).toHaveAttribute('aria-hidden', 'true')
    expect(mark.style.left).toBe(`${(1000 - 34) / 2}px`)
    expect(mark.style.width).toBe('16px')
    expect(document.querySelector('.sav-panel-tip')).toHaveTextContent('htmlExport:sa_pymol_panel_btn_c')
    expect(stage).toHaveClass('is-panel-spot')
    move(stage, 499 - 68, 10)
    expect(document.querySelector('.sav-panel-tip')).toHaveTextContent('htmlExport:sa_pymol_panel_btn_a')
    move(stage, 320, 30)
    expect(document.querySelector('.sav-panel-tip')).toHaveTextContent('htmlExport:sa_pymol_panel_name')
    move(stage, 100, 30)
    expect(document.querySelector('.sav-panel-mark')).toBeNull()
    expect(stage).not.toHaveClass('is-panel-spot')
    move(stage, 499, 10, 'mouse', 1)
    expect(document.querySelector('.sav-panel-mark')).toBeNull()
    move(stage, 499, 10, 'touch')
    expect(document.querySelector('.sav-panel-mark')).toBeNull()
  })

  it('a press on a button opens PyMOL’s menu over the panel: no mark until the next press', () => {
    const { bridge, set } = fakeBridge()
    render(pane(bridge))
    act(() => set({ objectPanel: true, objectPanelLayout: LAYOUT }))
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect)
    const stage = document.querySelector('.sav-pymol-stage') as HTMLElement
    // The press lands on PyMOL's canvas, in the bridge's host.
    const host = document.querySelector('.sav-pymol-host') as HTMLElement
    move(stage, 499, 10)
    fireEvent(host, new MouseEvent('pointerdown', { bubbles: true, clientX: 499, clientY: 10 }))
    move(stage, 499, 10)
    expect(document.querySelector('.sav-panel-mark')).toBeNull()
    fireEvent(host, new MouseEvent('pointerdown', { bubbles: true, clientX: 300, clientY: 100 }))
    move(stage, 499, 10)
    expect(document.querySelector('.sav-panel-mark')).not.toBeNull()
  })

  it('the movie buttons and the mouse box are marked and named too; full screen and, with one state, the frame buttons say they do nothing (owner 2026-11-20)', () => {
    const { bridge, set } = fakeBridge()
    render(pane(bridge))
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect)
    act(() => set({ objectPanel: true, objectPanelLayout: { ...LAYOUT, bottom: 120, lower: { mv: 0, ct: 40, bm: 80, nf: 1 } } }))
    // The mouse box is under its lid at first (owner 2026-11-21); its tab lifts it.
    fireEvent.click(screen.getByRole('button', { name: 'htmlExport:sa_pymol_mouse_box_tab' }))
    const stage = document.querySelector('.sav-pymol-stage') as HTMLElement
    const tip = () => document.querySelector('.sav-panel-tip')
    const mark = () => document.querySelector('.sav-panel-mark')
    // Device y 580 (CSS 290) is the movie buttons' band; x 999 is F, x 950 rocking, x 577 the first.
    // PyMOL's S, ▼ and F lie under the page's own 「Seq」 and ▼ (owner 2026-11-21): no mark there.
    move(stage, 999 / 2, 290)
    expect(tip()).toBeNull()
    move(stage, 950 / 2, 290)
    expect(tip()).toBeNull()
    move(stage, 577 / 2, 290)
    expect(tip()).toHaveTextContent('htmlExport:sa_pymol_panel_ctl_rewind htmlExport:sa_pymol_panel_ctl_single')
    expect(mark()).toHaveClass('sav-panel-mark--off')
    move(stage, 700 / 2, 270)
    expect(tip()).toHaveTextContent('htmlExport:sa_pymol_panel_mouse_select')
    move(stage, 700 / 2, 245)
    expect(tip()).toHaveTextContent('htmlExport:sa_pymol_panel_mouse_mode')
    // Many states: the frame buttons work, and say only what they do.
    act(() => set({ objectPanelLayout: { ...LAYOUT, bottom: 120, lower: { mv: 0, ct: 40, bm: 80, nf: 20 } } }))
    move(stage, 577 / 2, 290)
    expect(tip()).toHaveTextContent(/^htmlExport:sa_pymol_panel_ctl_rewind$/)
    expect(mark()).not.toHaveClass('sav-panel-mark--off')
  })

  it('PyMOL’s mouse box lies under a lid in the panel’s grey, shut by default; its tab lifts it and puts it back (owner 2026-11-21)', () => {
    const { bridge, set } = fakeBridge()
    render(pane(bridge))
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect)
    act(() => set({ objectPanel: true, objectPanelLayout: { ...LAYOUT, bottom: 120, lower: { mv: 0, ct: 40, bm: 80, nf: 1 } } }))
    const lid = document.querySelector('.sav-mouse-lid') as HTMLElement
    // Buffer 1000 × 600 on a 500 × 300 canvas: the box is 440 device px wide from x 560, y 480–560.
    expect(lid.style.left).toBe('280px')
    expect(lid.style.top).toBe('240px')
    expect(lid.style.width).toBe('220px')
    expect(lid.style.height).toBe('40px')
    expect(lid).not.toHaveClass('is-open')
    expect(lid).toHaveAttribute('aria-hidden', 'true')
    const tab = screen.getByRole('button', { name: 'htmlExport:sa_pymol_mouse_box_tab' })
    expect(tab).toHaveAttribute('aria-expanded', 'false')
    expect(tab).toHaveAttribute('title', 'htmlExport:sa_pymol_mouse_box_hint')
    // Shut, nothing under it is marked: it is not there to press.
    const stage = document.querySelector('.sav-pymol-stage') as HTMLElement
    move(stage, 700 / 2, 245)
    expect(document.querySelector('.sav-panel-tip')).toBeNull()
    fireEvent.click(tab)
    expect(lid).toHaveClass('is-open')
    expect(tab).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(tab)
    expect(lid).not.toHaveClass('is-open')
    // The panel hidden: no lid.
    act(() => set({ objectPanel: false }))
    expect(document.querySelector('.sav-mouse-lid')).toBeNull()
  })

  it('「Seq」 and ▼ lie over PyMOL’s S, ▼ and F; 「Seq」 opens the page’s sequence, and PyMOL’s ■ let go stops the page’s turn too (owner 2026-11-21)', async () => {
    const { bridge, set } = fakeBridge()
    render(pane(bridge))
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect)
    act(() => set({ objectPanel: true, objectPanelLayout: { ...LAYOUT, bottom: 120, lower: { mv: 0, ct: 40, bm: 80, nf: 1 } } }))
    const tail = document.querySelector('.sav-ctl-tail') as HTMLElement
    expect(tail.style.left).toBe(`${858 / 2}px`)
    expect(tail.style.width).toBe(`${(1000 - 858) / 2}px`)
    const seq = screen.getByRole('button', { name: 'htmlExport:sa_pymol_seq_button' })
    await act(async () => fireEvent.click(seq))
    expect(bridge.runCommand).toHaveBeenLastCalledWith(seqWantCommand(true), { page: true })
    expect(seq).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /htmlExport:sa_pymol_seq_tag/ })).toHaveAttribute('aria-expanded', 'true')
    // ■ is the movie row's third slot (device x 576 + 2 × 424 / 9 ≈ 670): PyMOL acts on the release, and so does the page.
    const host = document.querySelector('.sav-pymol-host') as HTMLElement
    act(() => set({ motion: { rock: false, rockSpeed: 0, spin: 30 } }))
    const calls = () => (bridge.runCommand as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0])
    fireEvent(host, new MouseEvent('pointerdown', { bubbles: true, clientX: 680 / 2, clientY: 290 }))
    expect(calls()).not.toContain(MOTION_SPIN_STOP)
    fireEvent(host, new MouseEvent('pointerup', { bubbles: true, clientX: 680 / 2, clientY: 290 }))
    expect(bridge.runCommand).toHaveBeenLastCalledWith(MOTION_SPIN_STOP, { page: true })
    // Pressed on ■ but let go elsewhere: PyMOL does nothing, nor does the page.
    const n = calls().length
    fireEvent(host, new MouseEvent('pointerdown', { bubbles: true, clientX: 680 / 2, clientY: 290 }))
    fireEvent(host, new MouseEvent('pointerup', { bubbles: true, clientX: 100, clientY: 100 }))
    expect(calls().length).toBe(n)
    // A phone's own list (no PyMOL panel): no strip.
    act(() => set({ objectPanel: false }))
    expect(document.querySelector('.sav-ctl-tail')).toBeNull()
  })

  it('the 『配列』 tag opens the sequence; a residue pointed at is lit, shown in PyMOL for the moment, and named at the top left (owner 2026-11-21)', async () => {
    const { bridge, set } = fakeBridge()
    render(pane(bridge))
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect)
    act(() => set({ objectPanel: true, objectPanelWidth: 220, objectPanelLayout: { ...LAYOUT, bottom: 120, lower: { mv: 0, ct: 40, bm: 80, nf: 1 } } }))
    const tag = screen.getByRole('button', { name: /htmlExport:sa_pymol_seq_tag/ })
    expect(tag).toHaveAttribute('aria-expanded', 'false')
    // At the view's top right: left of PyMOL's 220 px panel.
    expect(tag.style.left).toBe(`${500 - 220 - 6}px`)
    await act(async () => fireEvent.click(tag))
    expect(bridge.runCommand).toHaveBeenLastCalledWith(seqWantCommand(true), { page: true })
    const row = document.querySelector('.sav-seq') as HTMLElement
    expect(row.style.width).toBe(`${500 - 220}px`)
    expect(row).toHaveTextContent('htmlExport:sa_pymol_seq_loading')
    act(() => set({ seq: { v: 3, objs: ['Structure_25HN'], res: [[0, 'A', '1', 'MET'], [0, 'A', '2', 'SER'], [0, 'B', '1', 'GLY']], more: false } }))
    expect(row).toHaveTextContent('/Structure_25HN/A')
    expect(row).toHaveTextContent('/Structure_25HN/B')
    const res = row.querySelectorAll('.sav-seq-res')
    expect([...res].map(r => r.textContent?.slice(-1))).toEqual(['M', 'S', 'G'])
    const hover = new MouseEvent('pointermove', { bubbles: true })
    Object.defineProperty(hover, 'pointerType', { value: 'mouse' })
    await act(async () => {
      res[1].dispatchEvent(hover)
    })
    expect(res[1]).toHaveClass('is-lit')
    expect(bridge.runCommand).toHaveBeenLastCalledWith(seqHighlightCommand(3, 1), { page: true })
    expect(document.querySelector('.sav-seq-info')).toHaveTextContent('htmlExport:sa_pymol_seq_info')
    await act(async () => {
      fireEvent.pointerLeave(row.querySelector('.sav-seq-row')!, { pointerType: 'mouse' })
    })
    expect(bridge.runCommand).toHaveBeenLastCalledWith(seqHighlightCommand(3, -1), { page: true })
    // Closed again: the worker stops sending it.
    await act(async () => fireEvent.click(tag))
    expect(bridge.runCommand).toHaveBeenLastCalledWith(seqWantCommand(false), { page: true })
    expect(document.querySelector('.sav-seq')).toBeNull()
  })

  it('a residue lit in one list lights nothing in the next; a highlight still waiting when the row closes is never sent (PR #10172 review)', async () => {
    const { bridge, set } = fakeBridge()
    render(pane(bridge))
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect)
    act(() => set({ objectPanel: true, objectPanelWidth: 220, objectPanelLayout: { ...LAYOUT, bottom: 120, lower: { mv: 0, ct: 40, bm: 80, nf: 1 } } }))
    const tag = screen.getByRole('button', { name: /htmlExport:sa_pymol_seq_tag/ })
    await act(async () => fireEvent.click(tag))
    const list = (v: number) => ({ v, objs: ['Structure_25HN'], res: [[0, 'A', '1', 'MET'], [0, 'A', '2', 'SER'], [0, 'B', '1', 'GLY']] as [number, string, string, string][], more: false })
    act(() => set({ seq: list(3) }))
    const calls = () => (bridge.runCommand as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0])
    const point = async (i: number) => {
      const ev = new MouseEvent('pointermove', { bubbles: true })
      Object.defineProperty(ev, 'pointerType', { value: 'mouse' })
      await act(async () => {
        document.querySelectorAll('.sav-seq-res')[i].dispatchEvent(ev)
      })
    }
    await point(1)
    expect(bridge.runCommand).toHaveBeenLastCalledWith(seqHighlightCommand(3, 1), { page: true })
    // A new list: its residue 1 may be another residue; nothing is lit, and PyMOL is told so.
    await act(async () => set({ seq: list(4) }))
    expect(calls()).not.toContain(seqHighlightCommand(4, 1))
    expect(bridge.runCommand).toHaveBeenLastCalledWith(seqHighlightCommand(4, -1), { page: true })
    expect(document.querySelector('.sav-seq-res.is-lit')).toBeNull()
    // One highlight on its way, another waiting; the row closes before the first is done.
    let done: () => void = () => undefined
    ;(bridge.runCommand as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () =>
        new Promise<void>(r => {
          done = r
        }),
    )
    await point(0)
    await point(2)
    expect(calls()).not.toContain(seqHighlightCommand(4, 2))
    await act(async () => fireEvent.click(tag))
    expect(bridge.runCommand).toHaveBeenLastCalledWith(seqWantCommand(false), { page: true })
    await act(async () => done())
    expect(calls()).not.toContain(seqHighlightCommand(4, 2))
    expect(bridge.runCommand).toHaveBeenLastCalledWith(seqWantCommand(false), { page: true })
  })

  it('「描画」 after PyMOL’s menus: the pen over the whole canvas, the turn stopped, the way back beside it; out of sight it is put away (owner 2026-11-21)', async () => {
    const { bridge, set } = fakeBridge()
    const inkRef: { current: PymolInkHandle | null } = { current: null }
    const { rerender } = render(pane(bridge, { inkRef }))
    act(() => set({ motion: { rock: false, rockSpeed: 0, spin: 30 } }))
    const draw = screen.getByRole('button', { name: /proteindb:viewer_bar_draw/ })
    expect(draw.closest('.sav-pymol-menurow')).not.toBeNull()
    await act(async () => fireEvent.click(draw))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'proteindb:viewer_pen' })))
    expect(bridge.runCommand).toHaveBeenLastCalledWith(MOTION_STOP, { page: true })
    const ink = document.querySelector('canvas.sv3d-ink') as HTMLElement
    // Beside PyMOL's canvas, never in it: the bridge owns the host's children.
    expect(ink.parentElement).toHaveClass('sav-pymol-stage')
    expect(ink).toHaveClass('is-armed')
    expect(screen.getAllByRole('button', { name: 'proteindb:viewer_navigate' }).length).toBeGreaterThan(0)
    expect(inkRef.current?.ink()).toEqual({ lines: 0, stale: false })
    expect(inkRef.current?.take()).toBeNull()
    // The way back beside 「描画」: its press leaves the focus on 「描画」, not on <body> (PR #10244 review).
    const back = [...document.querySelectorAll<HTMLElement>('.sav-pymol-draw > .sv3d-chip')]
    expect(back).toHaveLength(1)
    back[0].focus()
    await act(async () => fireEvent.click(back[0]))
    expect(document.activeElement).toBe(draw)
    expect(ink).not.toHaveClass('is-armed')
    // The drop-down may still be open: the pen again, then the pane out of sight.
    if (screen.queryByRole('button', { name: 'proteindb:viewer_pen' }) === null) await act(async () => fireEvent.click(draw))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'proteindb:viewer_pen' })))
    expect(ink).toHaveClass('is-armed')
    rerender(pane(bridge, { inkRef, shown: false }))
    expect(ink).not.toHaveClass('is-armed')
  })

  it('the pen’s note sits under the sequence row and its box while they show (PR #10244 review)', async () => {
    const { bridge, set } = fakeBridge()
    render(pane(bridge))
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect)
    act(() => set({ objectPanel: true, objectPanelWidth: 220, objectPanelLayout: { ...LAYOUT, bottom: 120, lower: { mv: 0, ct: 40, bm: 80, nf: 1 } } }))
    const stage = document.querySelector('.sav-pymol-stage') as HTMLElement
    expect(stage.style.getPropertyValue('--sav-ink-note-top')).toBe('')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /htmlExport:sa_pymol_seq_tag/ })))
    expect(stage.style.getPropertyValue('--sav-ink-note-top')).toBe(`${SEQ_STRIP_H + 64}px`)
  })

  it('the pen’s note follows the row where the canvas starts lower in the stage: both are the stage’s children (PR #10261 review)', async () => {
    const { bridge, set } = fakeBridge()
    render(pane(bridge))
    const host = { ...rect, top: 30, y: 30, bottom: 330 } as DOMRect
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('sav-pymol-host') ? host : rect
    })
    act(() => set({ objectPanel: true, objectPanelWidth: 220, objectPanelLayout: { ...LAYOUT, bottom: 120, lower: { mv: 0, ct: 40, bm: 80, nf: 1 } } }))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /htmlExport:sa_pymol_seq_tag/ })))
    const stage = document.querySelector('.sav-pymol-stage') as HTMLElement
    expect(stage.style.getPropertyValue('--sav-ink-note-top')).toBe(`${30 + SEQ_STRIP_H + 64}px`)
  })

  it('a phone moves the stale-lines note up only while a note or the measuring card is at the view’s foot (PR #10261 review)', () => {
    const { bridge, set } = fakeBridge()
    render(pane(bridge, { docked: true, toolsHost: null }))
    const stage = document.querySelector('.sav-pymol-stage') as HTMLElement
    expect(stage).not.toHaveClass('has-note')
    act(() => set({ ui: { sel: null, atoms: null, more: false, shown: 1, hetero: false, wizard: 'measurement' } as unknown as BridgeState['ui'] }))
    expect(stage).toHaveClass('has-note')
    act(() => set({ ui: { sel: null, atoms: null, more: false, shown: 1, hetero: false, wizard: null } as unknown as BridgeState['ui'] }))
    expect(stage).not.toHaveClass('has-note')
  })

  it('lines over a view moved, or an object hidden, while PyMOL made the picture go on captioned; a pick does not mark them (PR #10261 review)', async () => {
    const { bridge, set } = fakeBridge()
    const inkRef: { current: PymolInkHandle | null } = { current: null }
    render(pane(bridge, { inkRef }))
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect)
    let view = [1, 2, 3]
    bridge.currentView.mockImplementation(() => view)
    const objects = (on: boolean, sele = false) => ({
      v: 1,
      items: [{ name: 'Structure_25HN', kind: 'molecule' as const, on }, ...(sele ? [{ name: 'sele', kind: 'selection' as const, on: true }] : [])],
      more: false,
      focus: null,
      reps: null,
    })
    act(() => set({ objects: objects(true) }))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /proteindb:viewer_bar_draw/ })))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'proteindb:viewer_pen' })))
    const canvas = document.querySelector('canvas.sv3d-ink') as HTMLElement
    pointer(canvas, 'pointerdown', 100, 100)
    pointer(canvas, 'pointermove', 200, 150)
    pointer(canvas, 'pointerup', 200, 150, 0)
    expect(inkRef.current?.ink()).toEqual({ lines: 1, stale: false })
    const onto = vi.mocked(inkOntoPng)
    const png = new ArrayBuffer(8)
    // Nothing moved while the picture was made: the lines go on as they are.
    const still = inkRef.current?.take()
    await still?.onto(png, { w: 500, h: 300 })
    expect(onto.mock.lastCall?.[3]).toMatchObject({ stale: false })
    // A pick makes PyMOL's `sele`: the lines still sit on their atoms.
    act(() => set({ objects: objects(true, true) }))
    expect(inkRef.current?.ink().stale).toBe(false)
    // The view moved after the picture was asked for and before PyMOL made it.
    const moving = inkRef.current?.take()
    view = [4, 5, 6]
    await act(async () => {
      await moving?.onto(png, { w: 500, h: 300 })
    })
    expect(onto.mock.lastCall?.[3]).toMatchObject({ stale: true })
    // Hiding the object under the lines marks them too, though no camera moved.
    view = [1, 2, 3]
    act(() => set({ objects: objects(true) }))
    const hiding = inkRef.current?.take()
    act(() => set({ objects: objects(false) }))
    await act(async () => {
      await hiding?.onto(png, { w: 500, h: 300 })
    })
    expect(onto.mock.lastCall?.[3]).toMatchObject({ stale: true })
    expect(inkRef.current?.ink().stale).toBe(true)
  })

  it('the lid’s tab lies on the shut lid; open, it rides above the box only where PyMOL draws nothing (PT-10470 item 2)', () => {
    const { bridge, set } = fakeBridge()
    render(pane(bridge))
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect)
    // Three rows end at device 108; the box's top is 480 (CSS 240).
    act(() => set({ objectPanel: true, objectPanelLayout: { ...LAYOUT, bottom: 120, lower: { mv: 0, ct: 40, bm: 80, nf: 1 } } }))
    const tab = screen.getByRole('button', { name: 'htmlExport:sa_pymol_mouse_box_tab' })
    expect(tab).not.toHaveClass('is-above')
    expect(tab.style.top).toBe('244px')
    fireEvent.click(tab)
    expect(tab).toHaveClass('is-above')
    expect(tab.style.top).toBe('240px')
    // The rows reach the box, or the measurement wizard's lines sit above it: the tab stays on the band.
    act(() => set({ objectPanelLayout: { ...LAYOUT, rows: 40, bottom: 120, lower: { mv: 0, ct: 40, bm: 80, nf: 1 } } }))
    expect(tab).not.toHaveClass('is-above')
    act(() => set({ objectPanelLayout: { ...LAYOUT, bottom: 120 + 184, lower: { mv: 0, ct: 40, bm: 80, nf: 1 } } }))
    expect(tab).not.toHaveClass('is-above')
  })

  it('the lid steps aside while a PyMOL menu is up, and lets a drag from the view through (PT-10470 item 1, PT-10471 item 1)', () => {
    const { bridge, set } = fakeBridge()
    render(pane(bridge))
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect)
    act(() => set({ objectPanel: true, objectPanelLayout: { ...LAYOUT, bottom: 120, lower: { mv: 0, ct: 40, bm: 80, nf: 1 } } }))
    const lid = document.querySelector('.sav-mouse-lid') as HTMLElement
    const tab = screen.getByRole('button', { name: 'htmlExport:sa_pymol_mouse_box_tab' })
    const host = document.querySelector('.sav-pymol-host') as HTMLElement
    const press = (type: 'pointerdown' | 'pointerup', x: number, y: number, button = 0) => {
      const e = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button })
      Object.defineProperty(e, 'pointerType', { value: 'mouse' })
      fireEvent(host, e)
    }
    // Row 0's A button (device x 999 → CSS 499.5, row 0's middle): PyMOL opens its menu.
    press('pointerdown', 499, 9)
    expect(lid).toHaveClass('is-aside')
    expect(tab).toHaveClass('is-aside')
    // The drag that began on the canvas is through the lid until it is let go.
    expect(lid).toHaveClass('is-through')
    fireEvent.pointerUp(window)
    expect(lid).not.toHaveClass('is-through')
    // The next press closes the menu: the lid is back.
    press('pointerdown', 100, 100)
    expect(lid).not.toHaveClass('is-aside')
    fireEvent.pointerUp(window)
    // A right click let go in place opens PyMOL's menu; a right drag (its zoom) does not.
    press('pointerdown', 100, 100, 2)
    press('pointerup', 100, 100, 2)
    expect(lid).toHaveClass('is-aside')
    press('pointerdown', 100, 100)
    expect(lid).not.toHaveClass('is-aside')
    press('pointerdown', 100, 100, 2)
    press('pointerup', 100, 160, 2)
    expect(lid).not.toHaveClass('is-aside')
    // A row's menu pressed open, dragged to an item and let go: PyMOL chose it and closed the menu,
    // so the next row's button opens one again (PT-10596).
    press('pointerdown', 499, 9)
    expect(lid).toHaveClass('is-aside')
    press('pointerup', 470, 60)
    expect(lid).not.toHaveClass('is-aside')
    press('pointerdown', 499, 27)
    expect(lid).toHaveClass('is-aside')
    // A press on the page's own overlay never reaches PyMOL: its menu is still up (PT-10597 items 1, 7).
    fireEvent.pointerDown(document.querySelector('.pymolv-drawer-tab') as HTMLElement)
    expect(lid).toHaveClass('is-aside')
    press('pointerdown', 100, 100)
    expect(lid).not.toHaveClass('is-aside')
    // A right click on the mouse box (CSS y 250) or the movie buttons acts there and opens no menu (PT-10597 item 2).
    press('pointerdown', 350, 250, 2)
    press('pointerup', 350, 250, 2)
    expect(lid).not.toHaveClass('is-aside')
    press('pointerdown', 400, 290, 2)
    press('pointerup', 400, 290, 2)
    expect(lid).not.toHaveClass('is-aside')
  })

  it('a box lower than the tab has the shut lid’s tab above it with room, else shrunk to the box (PT-10597 items 3, 8)', () => {
    const { bridge, set } = fakeBridge()
    render(pane(bridge))
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect)
    // A 40-device-px box on a 2× buffer: 20 CSS px, under the tab's 24.
    act(() => set({ objectPanel: true, objectPanelLayout: { ...LAYOUT, bottom: 60, lower: { mv: 0, ct: 20, bm: 40, nf: 1 } } }))
    const tab = screen.getByRole('button', { name: 'htmlExport:sa_pymol_mouse_box_tab' })
    expect(tab).toHaveClass('is-above')
    expect(tab).not.toHaveClass('is-small')
    act(() => set({ objectPanelLayout: { ...LAYOUT, rows: 40, bottom: 60, lower: { mv: 0, ct: 20, bm: 40, nf: 1 } } }))
    expect(tab).not.toHaveClass('is-above')
    expect(tab).toHaveClass('is-small')
    expect(tab.style.height).toBe('20px')
    expect(tab.style.top).toBe(`${(600 - 20 - 40) / 2}px`)
  })

  it('the lid is there before the worker gives the layout, from PyMOL’s defaults, and gone once PyMOL failed (PT-10470 item 6, PT-10471 item 4)', () => {
    const { bridge, set } = fakeBridge()
    // Measured at the start: the worker has said nothing yet.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect)
    render(pane(bridge))
    act(() => set({ objectPanel: true, objectPanelLayout: undefined, objectPanelWidth: 220 }))
    const lid = document.querySelector('.sav-mouse-lid') as HTMLElement
    expect(lid).not.toBeNull()
    expect(lid.style.left).toBe('280px')
    expect(lid.style.width).toBe('220px')
    act(() => set({ phase: 'failed' }))
    expect(document.querySelector('.sav-mouse-lid')).toBeNull()
  })

  it('「オリジナル表示」 on a computer opens the mouse box with its grid; a phone keeps it shut with no tab (owner 2026-11-21)', async () => {
    const { bridge, set } = fakeBridge()
    const user = userEvent.setup()
    const lists = document.createElement('div')
    document.body.appendChild(lists)
    render(pane(bridge, { docked: true, toolsHost: null, objectsHost: lists }))
    await user.click(screen.getByRole('switch', { name: 'htmlExport:sa_pymol_original_label' }))
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect)
    act(() => set({ objectPanel: true, objectPanelLayout: { ...LAYOUT, bottom: 120, lower: { mv: 0, ct: 40, bm: 80, nf: 1 } } }))
    expect(document.querySelector('.sav-mouse-lid')).not.toHaveClass('is-open')
    expect(screen.queryByRole('button', { name: 'htmlExport:sa_pymol_mouse_box_tab' })).toBeNull()
    cleanup()
    // A computer with 「オリジナル表示」 on: the grid, and the box open from the start.
    const pc = fakeBridge()
    render(pane(pc.bridge))
    act(() => pc.set({ objectPanel: true, objectPanelLayout: { ...LAYOUT, bottom: 120, lower: { mv: 0, ct: 40, bm: 80, nf: 1 } } }))
    expect(pc.bridge.setOriginalPanel).toHaveBeenLastCalledWith(true)
    expect(document.querySelector('.sav-mouse-lid')).toHaveClass('is-open')
    expect(screen.getByRole('button', { name: 'htmlExport:sa_pymol_mouse_box_tab' })).toHaveAttribute('aria-expanded', 'true')
    // Off again: the grid goes and the lid shuts.
    act(() => setOriginalPanel(false))
    expect(pc.bridge.setOriginalPanel).toHaveBeenLastCalledWith(false)
    expect(document.querySelector('.sav-mouse-lid')).not.toHaveClass('is-open')
  })

  it('「オリジナル表示」 on a phone: the bridge keeps PyMOL’s panel, the view has the pull tab, and the 「オブジェクト」 tab says so instead of listing (owner 2026-11-20)', async () => {
    const { bridge } = fakeBridge()
    const user = userEvent.setup()
    const lists = document.createElement('div')
    document.body.appendChild(lists)
    render(pane(bridge, { docked: true, toolsHost: null, objectsHost: lists }))
    expect(bridge.setDocked).toHaveBeenLastCalledWith(true)
    const sw = screen.getByRole('switch', { name: 'htmlExport:sa_pymol_original_label' })
    await user.click(sw)
    expect(bridge.setDocked).toHaveBeenLastCalledWith(false)
    // A phone's mouse box stays shut, its grid off even in 「オリジナル表示」 (owner 2026-11-21: 完全に消す).
    expect(bridge.setOriginalPanel).toHaveBeenLastCalledWith(false)
    expect(document.querySelector('.pymolv-drawer-tab')).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'htmlExport:sa_objs_button' })).toBeNull()
    // The switch's note says where the panel is; the page's own list is gone.
    expect(lists).toHaveTextContent('htmlExport:sa_pymol_original_note_phone')
    expect(lists).not.toHaveTextContent('htmlExport:sa_objs_list')
    expect(window.localStorage.getItem('agdb-pvp-pymol-original-panel')).toBe('1')
    await user.click(sw)
    expect(bridge.setDocked).toHaveBeenLastCalledWith(true)
    lists.remove()
  })

  it('pull to zoom: the open tab’s sizes follow the display scale, and a step sets the scale as the settings dialog does, said in words', () => {
    const { bridge, set } = fakeBridge()
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1200)
    render(pane(bridge))
    act(() => set({ objectPanel: true, objectPanelWidth: 220 }))
    const tabEl = document.querySelector('.pymolv-drawer-tab') as HTMLElement
    expect(document.querySelector('.pymolv-drawer-grip')).not.toBeNull()
    fireEvent.keyDown(tabEl, { key: 'ArrowLeft' })
    expect(bridge.runCommand).toHaveBeenCalledWith('set display_scale_factor, 2', { page: true })
    expect(window.localStorage.getItem('agdb_pymol_display_scale')).toBe('2')
    expect(screen.getByText('htmlExport:sa_pymol_zoom_said {"n":2,"max":3}')).toHaveAttribute('role', 'status')
  })
})

describe('zoomSteps (pull to zoom sizes)', () => {
  const allowed = (steps: { allowed: boolean }[]) => steps.map(s => s.allowed)

  it('a phone shrunk to 1/3 can always be pulled back to its own scale (owner 2026-11-21: 戻らない)', () => {
    // DPR 3: the panel started at 3 (220 CSS px); shrunk to 1 it is 73 px in a 390 px view.
    const steps = zoomSteps(220 / 3, 1, 390, 3)
    expect(steps).toHaveLength(3)
    expect(allowed(steps)).toEqual([true, true, true])
    // The old rule (no home): sizes 2 and 3 were greyed, so the panel never came back.
    expect(allowed(zoomSteps(220 / 3, 1, 390))).toEqual([true, false, false])
  })

  it('above the larger of now and home, a size still needs the view to keep 280 px and 40 %', () => {
    // A computer at scale 1 (DPR 1, home 1) in a 900 px view: 220 / 440 / 660 px wide, 660 leaving 240 px.
    expect(allowed(zoomSteps(220, 1, 900, 1))).toEqual([true, true, false])
    // A narrow view: only what is not larger than now or home.
    expect(allowed(zoomSteps(220, 1, 500, 1))).toEqual([true, false, false])
    // A home of 4 (DPR 4) is reachable even past the usual three.
    expect(zoomSteps(55, 1, 400, 4)).toHaveLength(4)
    expect(allowed(zoomSteps(55, 1, 400, 4))).toEqual([true, true, true, true])
  })
})
