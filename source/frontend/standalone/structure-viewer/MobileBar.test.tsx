/**
 * The phone mode's parts (owner 2026-11-14): the bar fixed at the bottom
 * (Open, Export, View, and Engine in the full edition only), the 「表示」
 * sheet (zoom buttons, then a slot for the engine's own controls) and the
 * 「エンジン」 sheet (PyMOL heavy, refused with a reason where it cannot run,
 * a failed start sending the view back to 3Dmol.js). The sheets are the
 * shared `Modal`: a named dialog that Escape closes. `useMobile` follows the
 * 640 px query.
 */
import { act, cleanup, render, renderHook, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key} ${JSON.stringify(vars)}` : key),
    i18n: { language: 'ja' },
  }),
}))

import { EngineSheet, MobileBar, ViewSheet } from './MobileBar'
import { MOBILE_QUERY, useMobile } from './useMobile'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function bar(over: Partial<Parameters<typeof MobileBar>[0]> = {}) {
  const onOpen = vi.fn()
  const onExport = vi.fn()
  const onSheet = vi.fn()
  render(<MobileBar full shown="3dmol" canExport onOpen={onOpen} onExport={onExport} onSheet={onSheet} {...over} />)
  return { onOpen, onExport, onSheet, user: userEvent.setup() }
}

describe('MobileBar', () => {
  it('holds Open, Export, View and the engine on screen, each opening its own dialog', async () => {
    const { onOpen, onExport, onSheet, user } = bar()
    const nav = screen.getByRole('navigation', { name: 'htmlExport:sa_m_bar_label' })
    const buttons = Array.from(nav.querySelectorAll('button'))
    expect(buttons.map(b => b.querySelector('.sav-mbar-label')?.textContent)).toEqual([
      'htmlExport:sa_m_openhtmlExport:sa_m_open_sub',
      'htmlExport:sa_m_export',
      'htmlExport:sa_m_viewhtmlExport:sa_m_view_sub',
      'htmlExport:sa_m_engine3Dmol.js',
    ])
    for (const b of buttons) expect(b).toHaveAttribute('aria-haspopup', 'dialog')
    // Open is named by one sentence, not two labels run together (PT-9264 item 1).
    expect(buttons[0]).toHaveAccessibleName('htmlExport:sa_open_button')
    // 「表示」 over 「ツール」 (owner 2026-11-15), named once: 「表示ツール」.
    expect(buttons[2].querySelector('.sav-mbar-sub')).toHaveTextContent('htmlExport:sa_m_view_sub')
    expect(buttons[2]).toHaveAccessibleName('htmlExport:sa_m_view_aria')
    // The engine button's name says which engine is on screen.
    // (jsdom has no layout: it puts a space around the name's inner span, a browser does not.)
    expect(screen.getByRole('button', { name: /^htmlExport:sa_m_engine_aria \{"engine":" ?3Dmol\.js ?"\}$/ })).toBeInTheDocument()
    await user.click(buttons[0])
    await user.click(buttons[1])
    await user.click(buttons[2])
    await user.click(buttons[3])
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onExport).toHaveBeenCalledTimes(1)
    expect(onSheet.mock.calls).toEqual([['view'], ['engine']])
  })

  it('has no engine button in the light edition; with nothing open, Export is unavailable but reachable and says why (PT-9188 item 7)', async () => {
    const { onExport, user } = bar({ full: false, canExport: false })
    const nav = screen.getByRole('navigation')
    expect(nav.querySelectorAll('button')).toHaveLength(3)
    const exp = screen.getByRole('button', { name: 'htmlExport:sa_m_export' })
    // Not `disabled`: a disabled button is skipped by Tab and shows no reason.
    expect(exp).toBeEnabled()
    expect(exp).toHaveAttribute('aria-disabled', 'true')
    expect(exp).not.toHaveAttribute('aria-haspopup')
    expect(exp).toHaveAccessibleDescription('htmlExport:sa_export_none')
    // The press is the page's to answer (it says the reason).
    await user.click(exp)
    expect(onExport).toHaveBeenCalledTimes(1)
  })

  it('names PyMOL by the licence’s phrase when PyMOL is on screen, and shows the mode’s short name in small type (owner 2026-11-18; the Heavy viewer before, PyMOL™ before that, PT-9195 item 1)', () => {
    bar({ shown: 'pymol' })
    const engine = screen.getByRole('button', { name: /^htmlExport:sa_m_engine_aria \{"engine":" ?pymolNotice:contains_label ?"\}$/ })
    expect(engine.querySelector('.sav-mbar-sub')).toHaveTextContent(/^Includes PyMOL™$/)
    expect(engine.querySelector('.sav-mbar-sub')).toHaveClass('sav-mbar-sub--long')
    // The licence phrase is English inside the Japanese sentence: marked so a voice reads it as English (PT-9230 item 5).
    expect(engine.querySelector('[lang="en"]')).toHaveTextContent('pymolNotice:contains_label')
  })
})

describe('ViewSheet', () => {
  function sheet(over: Partial<Parameters<typeof ViewSheet>[0]> = {}) {
    const onZoom = vi.fn()
    const toolsRef = vi.fn<(el: HTMLDivElement | null) => void>()
    const onClose = vi.fn()
    render(<ViewSheet engine="3dmol" zoomDisabled={false} onZoom={onZoom} toolsRef={toolsRef} onClose={onClose} {...over} />)
    return { onZoom, toolsRef, onClose, user: userEvent.setup() }
  }

  it('is a named dialog with zoom buttons — no gesture needed — and a slot for the engine’s controls', async () => {
    const { onZoom, toolsRef, user } = sheet()
    const dialog = screen.getByRole('dialog', { name: 'htmlExport:sa_m_view_title {"engine":"3Dmol.js"}' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    const group = screen.getByRole('group', { name: 'htmlExport:sa_m_zoom_group' })
    expect(group).toHaveAccessibleDescription('htmlExport:sa_m_gestures')
    await user.click(screen.getByRole('button', { name: /sa_m_zoom_in/ }))
    await user.click(screen.getByRole('button', { name: /sa_m_zoom_out/ }))
    expect(onZoom.mock.calls).toEqual([['in'], ['out']])
    // 3Dmol.js has no 「全体表示」 in this app (owner 2026-11-16).
    expect(screen.queryByRole('button', { name: 'htmlExport:sa_view_fit' })).toBeNull()
    // The pane draws into the slot the sheet hands over.
    const slot = toolsRef.mock.calls.map(c => c[0]).find(el => el !== null)
    expect(slot).toBeDefined()
    expect(dialog).toContainElement(slot ?? null)
  })

  it('keeps 「全体表示」 for PyMOL', async () => {
    const { onZoom, user } = sheet({ engine: 'pymol' })
    await user.click(screen.getByRole('button', { name: 'htmlExport:sa_view_fit' }))
    expect(onZoom).toHaveBeenCalledWith('fit')
  })

  it('closes on Escape and on ×, and hands the slot back', async () => {
    const { onClose, user } = sheet()
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'pymol:dialog_close' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('keeps the focus in the sheet when the engine on screen changes under it (PT-9195 item 3)', async () => {
    const onZoom = vi.fn()
    const toolsRef = vi.fn<(el: HTMLDivElement | null) => void>()
    const { rerender } = render(<ViewSheet engine="3dmol" zoomDisabled={false} onZoom={onZoom} toolsRef={toolsRef} onClose={vi.fn()} />)
    const slot = toolsRef.mock.calls.map(c => c[0]).find(el => el !== null)!
    // A control of the engine's own, focused, then gone with that engine.
    const control = document.createElement('button')
    slot.appendChild(control)
    control.focus()
    expect(control).toHaveFocus()
    rerender(<ViewSheet engine="pymol" zoomDisabled={false} onZoom={onZoom} toolsRef={toolsRef} onClose={vi.fn()} />)
    control.remove()
    const dialog = screen.getByRole('dialog', { name: 'htmlExport:sa_m_view_title {"engine":"Includes PyMOL™"}' })
    await vi.waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
  })

  it('has no 「📏 測定」 of its own: the PyMOL pane puts its own in the slot (owner 2026-11-15, 2026-11-19)', () => {
    sheet({ engine: 'pymol', onHelp: vi.fn() })
    const dialog = screen.getByRole('dialog', { name: 'htmlExport:sa_m_view_title {"engine":"Includes PyMOL™"}' })
    const names = Array.from(dialog.querySelectorAll('button')).map(b => b.textContent ?? '')
    expect(names.some(n => n.includes('measure') || n.includes('📏'))).toBe(false)
    // The page's buttons come first.
    expect(names.findIndex(n => n.includes('sa_help_button'))).toBeLessThan(names.findIndex(n => n.includes('sa_m_zoom_in')))
  })

  it('PyMOL’s sheet has two tabs, 「オブジェクト」 and 「表示・操作」: both panels stay in the document, the one not chosen hidden (owner 2026-11-19)', async () => {
    const onTab = vi.fn()
    const objectsRef = vi.fn<(el: HTMLDivElement | null) => void>()
    const { toolsRef, user } = sheet({ engine: 'pymol', objects: { tab: 'objects', onTab, ref: objectsRef } })
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map(t => t.textContent)).toEqual(['htmlExport:sa_objs_tab', 'htmlExport:sa_objs_tools_tab'])
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    expect(tabs[1]).toHaveAttribute('tabindex', '-1')
    const objectsSlot = objectsRef.mock.calls.map(c => c[0]).find(el => el !== null)!
    const toolsSlot = toolsRef.mock.calls.map(c => c[0]).find(el => el !== null)!
    expect(objectsSlot.closest('[role="tabpanel"]')).not.toHaveAttribute('hidden')
    expect(toolsSlot.closest('[role="tabpanel"]')).toHaveAttribute('hidden')
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('htmlExport:sa_objs_tab')
    await user.click(tabs[1])
    expect(onTab).toHaveBeenLastCalledWith('tools')
    tabs[0].focus()
    await user.keyboard('{ArrowRight}')
    expect(onTab).toHaveBeenLastCalledWith('tools')
    await user.keyboard('{End}')
    expect(onTab).toHaveBeenLastCalledWith('tools')
  })

  it('3Dmol.js’s sheet has no tabs', () => {
    sheet()
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(screen.queryByRole('tabpanel')).toBeNull()
  })

  it('offers no zoom while the view cannot take it', () => {
    sheet({ zoomDisabled: true, engine: 'pymol' })
    expect(screen.getByRole('dialog', { name: 'htmlExport:sa_m_view_title {"engine":"Includes PyMOL™"}' })).toBeInTheDocument()
    for (const b of screen.getByRole('group').querySelectorAll('button')) expect(b).toBeDisabled()
  })
})

describe('EngineSheet', () => {
  function sheet(over: Partial<Parameters<typeof EngineSheet>[0]> = {}) {
    const onEngine = vi.fn()
    const onRetry = vi.fn()
    const onClose = vi.fn()
    render(<EngineSheet engine="3dmol" onEngine={onEngine} pymolLoad="idle" failureText={null} blocker={null} onRetry={onRetry} onClose={onClose} {...over} />)
    return { onEngine, onRetry, onClose, user: userEvent.setup() }
  }

  it('offers 3Dmol.js (chosen) and PyMOL, named by the licence and described as heavy', async () => {
    const { onEngine, user } = sheet()
    expect(screen.getByRole('dialog', { name: 'proteindb:viewer_head_engine_legend' })).toBeInTheDocument()
    const dmol = screen.getByRole('radio', { name: '3Dmol.js' })
    const pymol = screen.getByRole('radio', { name: 'pymolNotice:contains_label' })
    expect(dmol).toBeChecked()
    expect(dmol).toHaveAccessibleDescription('htmlExport:sa_m_engine_dmol_note')
    expect(pymol).toHaveAccessibleDescription('htmlExport:sa_m_engine_pymol_note')
    expect(pymol).toBeEnabled()
    await user.click(pymol)
    expect(onEngine).toHaveBeenCalledWith('pymol')
  })

  it.each([
    ['no-webgl2', 'htmlExport:sa_m_engine_no_webgl2'],
    ['no-offscreen', 'htmlExport:sa_m_engine_no_offscreen'],
    ['no-worker-gl', 'htmlExport:sa_m_engine_no_worker_gl'],
  ] as const)('cannot choose PyMOL where it cannot run (%s), and says why', (blocker, why) => {
    sheet({ blocker })
    const pymol = screen.getByRole('radio', { name: 'pymolNotice:contains_label' })
    expect(pymol).toBeDisabled()
    expect(pymol).toHaveAccessibleDescription(why)
  })

  it('says the failure as the page words it, and offers Retry', async () => {
    const { onRetry, user } = sheet({ pymolLoad: 'failed', failureText: 'PyMOL could not start: out of memory.' })
    expect(screen.getByRole('alert')).toHaveTextContent('PyMOL could not start: out of memory.')
    await user.click(screen.getByRole('button', { name: 'htmlExport:sa_retry' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('offers no Retry when there is nothing for PyMOL to load (PT-9250 item 2)', () => {
    sheet({ pymolLoad: 'failed', failureText: 'PyMOL stopped.', onRetry: undefined })
    expect(screen.getByRole('alert')).toHaveTextContent('PyMOL stopped.')
    expect(screen.queryByRole('button', { name: 'htmlExport:sa_retry' })).toBeNull()
  })

  it('says PyMOL is starting while it loads', () => {
    sheet({ engine: 'pymol', pymolLoad: 'loading' })
    expect(screen.getByRole('status')).toHaveTextContent('htmlExport:sa_status_pymol_booting')
    expect(screen.getByRole('alert')).toBeEmptyDOMElement()
  })
})

describe('useMobile', () => {
  it('follows the 640 px query as the window changes', () => {
    let matches = false
    const listeners = new Set<() => void>()
    const mql = {
      get matches() {
        return matches
      },
      media: MOBILE_QUERY,
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    } as unknown as MediaQueryList
    const spy = vi.spyOn(window, 'matchMedia').mockReturnValue(mql)
    const { result, unmount } = renderHook(() => useMobile())
    expect(spy).toHaveBeenCalledWith('(max-width: 640px)')
    expect(result.current).toBe(false)
    act(() => {
      matches = true
      for (const fn of listeners) fn()
    })
    expect(result.current).toBe(true)
    // One MediaQueryList, however often React reads the snapshot (PT-9194 item 7).
    expect(spy).toHaveBeenCalledTimes(1)
    unmount()
    expect(listeners.size).toBe(0)
  })
})
