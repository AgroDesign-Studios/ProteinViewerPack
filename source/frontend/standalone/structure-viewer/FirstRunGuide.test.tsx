/**
 * The first-run guide (owner 2026-11-19): bubbles at the mode switch and at
 * Export, placed inside the window and clear of each other, closed by any
 * press (which still reaches the page) or Esc, kept closed in this browser.
 */
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

import { FirstRunGuide, GUIDE_SEEN_KEY, GUIDE_TARGETS_FULL, GUIDE_TARGETS_LIGHT, placeBubbles, useFirstRunGuide, type GuideTarget } from './FirstRunGuide'

const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect

/** A control the guide points at, laid out where jsdom lays out nothing. */
function anchor(target: GuideTarget, r: DOMRect, describedBy?: string) {
  const el = document.createElement('button')
  el.dataset.guide = target
  if (describedBy !== undefined) el.setAttribute('aria-describedby', describedBy)
  el.getBoundingClientRect = () => r
  document.body.appendChild(el)
  return el
}

beforeEach(() => {
  window.localStorage.clear()
})
afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('placeBubbles', () => {
  const view = { width: 1280, height: 800 }
  const size = () => ({ width: 240, height: 60 })

  it('puts a bubble under a control in the header, centred on it, its arrow at the control', () => {
    const places = placeBubbles(['export'], size, view, () => rect(400, 10, 80, 32))
    expect(places.get('export')).toEqual({ left: 320, top: 52, side: 'below', arrow: 120 })
  })

  it('over a control at the window’s foot (the phone’s bar), kept inside the window, the arrow still at the control', () => {
    const phone = { width: 390, height: 800 }
    const places = placeBubbles(['engine'], size, phone, () => rect(330, 740, 56, 56))
    const p = places.get('engine')!
    expect(p.side).toBe('above')
    expect(p.top).toBe(740 - 10 - 60)
    // Right edge: 390 - 8 - 240.
    expect(p.left).toBe(142)
    expect(p.arrow).toBe(330 + 28 - 142)
  })

  it('a phone’s bar: the two bubbles side by side, each over its own button, never covering each other', () => {
    const phone = { width: 390, height: 800 }
    const half = () => ({ width: 183, height: 80 })
    // The bar's 2nd and 4th buttons (Export, モード).
    const r: Record<GuideTarget, DOMRect> = { engine: rect(292, 740, 90, 56), export: rect(103, 740, 90, 56) }
    const places = placeBubbles(['engine', 'export'], half, phone, t => r[t])
    const a = places.get('engine')!
    const b = places.get('export')!
    expect(a).toEqual({ left: 199, top: 650, side: 'above', arrow: 138 })
    expect(b).toEqual({ left: 8, top: 650, side: 'above', arrow: 140 })
    expect(b.left + 183).toBeLessThan(a.left)
  })

  it('a short window (a phone held sideways): a bubble that fits neither under nor over its control stays inside the window (PT-9918 item 4)', () => {
    const short = { width: 800, height: 120 }
    const places = placeBubbles(['export'], () => ({ width: 240, height: 90 }), short, () => rect(300, 40, 80, 32))
    const p = places.get('export')!
    expect(p.top).toBeGreaterThanOrEqual(8)
    expect(p.top + 90).toBeLessThanOrEqual(120 - 8 + 0.5)
  })

  it('with no room beside, the second moves further from its control; a control not shown gets no place', () => {
    const narrow = { width: 300, height: 800 }
    const r: Record<GuideTarget, DOMRect> = { engine: rect(200, 10, 80, 40), export: rect(120, 10, 80, 32) }
    const places = placeBubbles(['engine', 'export'], size, narrow, t => r[t])
    const a = places.get('engine')!
    const b = places.get('export')!
    expect(b.top).toBeGreaterThanOrEqual(a.top + 60 + 8)
    expect(placeBubbles(['engine', 'export'], size, view, t => (t === 'engine' ? null : r[t])).has('engine')).toBe(false)
  })
})

describe('FirstRunGuide', () => {
  it('points at the mode switch and Export, each described by its bubble while it is up; any press closes it and still reaches the page', () => {
    const engine = anchor('engine', rect(1100, 10, 120, 60))
    const exp = anchor('export', rect(400, 10, 80, 32), 'why')
    const clicked = vi.fn()
    exp.addEventListener('click', clicked)
    const onDismiss = vi.fn()
    const { unmount } = render(<FirstRunGuide targets={GUIDE_TARGETS_FULL} onDismiss={onDismiss} />)
    const note = screen.getByRole('note', { name: 'htmlExport:sa_guide_label' })
    expect(note).toHaveTextContent('htmlExport:sa_guide_engine')
    expect(note).toHaveTextContent('htmlExport:sa_guide_export')
    // Said once, by Export's bubble.
    expect(note.querySelectorAll('.sav-guide-close')).toHaveLength(1)
    const engineBubble = note.querySelector<HTMLElement>('[data-target="engine"]')!
    const exportBubble = note.querySelector<HTMLElement>('[data-target="export"]')!
    expect(engineBubble.style.visibility).toBe('')
    expect(engine.getAttribute('aria-describedby')).toBe(engineBubble.id)
    // An existing description is kept, the bubble's added.
    expect(exp.getAttribute('aria-describedby')).toBe(`why ${exportBubble.id}`)
    fireEvent.pointerDown(exp)
    fireEvent.click(exp)
    expect(onDismiss).toHaveBeenCalled()
    expect(clicked).toHaveBeenCalledOnce()
    unmount()
    expect(engine.hasAttribute('aria-describedby')).toBe(false)
    expect(exp.getAttribute('aria-describedby')).toBe('why')
  })

  it('a computer’s mode switch is a group of radios: each radio, not the group’s wrapper, is described by the bubble (PT-9918 item 2)', () => {
    const wrap = document.createElement('div')
    wrap.dataset.guide = 'engine'
    wrap.getBoundingClientRect = () => rect(1100, 10, 120, 60)
    const radios = ['3dmol', 'pymol'].map(v => {
      const r = document.createElement('input')
      r.type = 'radio'
      r.value = v
      wrap.appendChild(r)
      return r
    })
    radios[1].setAttribute('aria-describedby', 'load-state')
    document.body.appendChild(wrap)
    anchor('export', rect(400, 10, 80, 32))
    const { unmount } = render(<FirstRunGuide targets={GUIDE_TARGETS_FULL} onDismiss={() => undefined} />)
    const id = document.querySelector('[data-target="engine"]')!.id
    expect(wrap.hasAttribute('aria-describedby')).toBe(false)
    expect(radios[0].getAttribute('aria-describedby')).toBe(id)
    expect(radios[1].getAttribute('aria-describedby')).toBe(`load-state ${id}`)
    unmount()
    expect(radios[0].hasAttribute('aria-describedby')).toBe(false)
    expect(radios[1].getAttribute('aria-describedby')).toBe('load-state')
  })

  it('Esc closes it; the light edition points at Export alone, and a control not shown keeps its bubble hidden', () => {
    anchor('export', rect(0, 0, 0, 0))
    const onDismiss = vi.fn()
    render(<FirstRunGuide targets={GUIDE_TARGETS_LIGHT} onDismiss={onDismiss} />)
    const bubbles = document.querySelectorAll<HTMLElement>('.sav-guide-bubble')
    expect(bubbles).toHaveLength(1)
    expect(bubbles[0].style.visibility).toBe('hidden')
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(onDismiss).not.toHaveBeenCalled()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('takes no pointer and sits under the dialogs; no fade under reduced motion (CSS)', () => {
    const css = readFileSync(join(__dirname, 'standalone.css'), 'utf8')
    expect(css).toMatch(/\.sav-guide \{[^}]*z-index: 150;[^}]*pointer-events: none;/)
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.sav-guide-bubble \{\s*animation: none;/)
  })
})

describe('useFirstRunGuide', () => {
  it('shows until closed, then stays closed in this browser', () => {
    const first = renderHook(() => useFirstRunGuide())
    expect(first.result.current.pending).toBe(true)
    act(() => first.result.current.dismiss())
    expect(first.result.current.pending).toBe(false)
    expect(window.localStorage.getItem(GUIDE_SEEN_KEY)).toBe('1')
    expect(renderHook(() => useFirstRunGuide()).result.current.pending).toBe(false)
  })

  it('where the browser keeps nothing: shown, closed for this visit, shown again next time', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    const first = renderHook(() => useFirstRunGuide())
    act(() => first.result.current.dismiss())
    expect(first.result.current.pending).toBe(false)
    expect(renderHook(() => useFirstRunGuide()).result.current.pending).toBe(true)
  })
})
