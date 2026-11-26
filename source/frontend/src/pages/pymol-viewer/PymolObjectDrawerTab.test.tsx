/**
 * The object panel's pull tab (owner 2026-11-15): a tap toggles; a sideways
 * swipe of 24 px or more started on the tab says which way it wants the panel
 * (leftwards out, rightwards back), once per gesture; a shorter or mostly
 * vertical move is no swipe; only a pointer click right after a swipe is the
 * swipe's, never a key press (PT-9400 item 4); a locked tab does nothing and
 * says why.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DRAWER_BUBBLE_DELAY_MS, DRAWER_BUBBLE_LEAVE_MS, DRAWER_SWIPE_CLICK_MS, DRAWER_TOUCH_FOCUS_MS, DRAWER_SWIPE_PX, DRAWER_ZOOM_HYSTERESIS_PX, PymolObjectDrawerTab, useDrawerReveal, zoomPreview } from './PymolObjectDrawerTab'

afterEach(cleanup)

// jsdom has no PointerEvent, and testing-library's fallback Event drops
// pointerId / clientX: an additive polyfill (with the pointer's type, which
// the bubble reads).
if (!('PointerEvent' in window)) {
  class PointerEventPolyfill extends MouseEvent {
    readonly pointerId: number
    readonly pointerType: string
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init)
      this.pointerId = init.pointerId ?? 0
      this.pointerType = init.pointerType ?? ''
    }
  }
  Object.defineProperty(window, 'PointerEvent', { value: PointerEventPolyfill, writable: true })
}

function Harness({
  start = false,
  reason = null,
  spy,
  swipeSpy = () => undefined,
}: {
  start?: boolean
  reason?: string | null
  spy: () => void
  swipeSpy?: (open: boolean) => void
}) {
  const [open, setOpen] = useState(start)
  return (
    <PymolObjectDrawerTab
      open={open}
      onToggle={() => {
        spy()
        setOpen(o => !o)
      }}
      onSwipe={v => {
        swipeSpy(v)
        setOpen(v)
      }}
      label="Objects"
      name="Objects panel"
      controls="view"
      disabledReason={reason}
    />
  )
}

const tab = () => screen.getByRole('button', { name: 'Objects panel' })

/** A swipe as a browser sends it: down, up, then the click a mouse drag still fires. */
function swipe(dx: number, dy = 0, click = true) {
  fireEvent.pointerDown(tab(), { pointerId: 1, clientX: 200, clientY: 300 })
  fireEvent.pointerUp(tab(), { pointerId: 1, clientX: 200 + dx, clientY: 300 + dy })
  // A mouse's click carries its click count (detail 1); a key's has 0.
  if (click) fireEvent.click(tab(), { detail: 1 })
}

describe('PymolObjectDrawerTab', () => {
  it('is a named, expandable control whose word runs top to bottom with a drawn « or » (owner 2026-11-16: ‹ alone was hard to read)', () => {
    render(<Harness spy={vi.fn()} />)
    expect(tab()).toHaveAttribute('aria-expanded', 'false')
    expect(tab()).toHaveAttribute('aria-controls', 'view')
    expect(tab()).toHaveTextContent(/^Objects$/)
    // Two chevrons as one SVG path, hidden from assistive technology: no font's glyph.
    const mark = () => tab().querySelector('svg.pymolv-drawer-chevron')!
    expect(mark()).toHaveAttribute('aria-hidden', 'true')
    expect(mark().querySelector('path')!.getAttribute('d')).toBe('M8 3 3 8l5 5M13 3 8 8l5 5')
    fireEvent.click(tab())
    expect(tab()).toHaveAttribute('aria-expanded', 'true')
    expect(mark().querySelector('path')!.getAttribute('d')).toBe('M3 3l5 5-5 5M8 3l5 5-5 5')
  })

  it('closed it sits at the view’s right edge; open, just left of the panel, kept inside the view; revealed only when told', () => {
    const props = { onToggle: vi.fn(), onSwipe: vi.fn(), label: 'Objects', name: 'Objects panel', panelWidth: 219.6 }
    const { rerender } = render(<PymolObjectDrawerTab open={false} {...props} revealed />)
    const strip = () => tab().parentElement!
    expect(strip()).toHaveAttribute('data-open', 'false')
    expect(strip().style.right).toBe('')
    expect(strip()).not.toHaveAttribute('data-revealed')
    rerender(<PymolObjectDrawerTab open {...props} />)
    expect(strip()).toHaveAttribute('data-open', 'true')
    expect(strip().style.right).toMatch(/^min\(220px\W+calc\(100% - 28px\)\)$/)
    expect(strip()).not.toHaveAttribute('data-revealed')
    rerender(<PymolObjectDrawerTab open {...props} revealed />)
    expect(strip()).toHaveAttribute('data-revealed', 'true')
    // Still a control in the Tab order, transparent or not.
    expect(tab()).toBeVisible()
    expect(tab().tabIndex).toBe(0)
  })

  it('its CSS: laid over the view taking no width, no pointer but the tab’s; open, transparent unless revealed, hovered, focused, or on a screen with no hover', () => {
    const css = readFileSync(join(__dirname, 'pymolViewer.css'), 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '')
    const rule = (sel: string) => {
      const m = new RegExp(`(?:^|})\\s*${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css)
      if (!m) throw new Error(`no rule ${sel}`)
      return m[1]
    }
    const strip = rule('.pymolv-drawer-strip')
    expect(strip).toMatch(/position:\s*absolute/)
    expect(strip).toMatch(/pointer-events:\s*none/)
    expect(strip).not.toMatch(/background|flex:\s*none/)
    expect(rule('.pymolv-drawer-tab')).toMatch(/pointer-events:\s*auto/)
    expect(rule(".pymolv-drawer-strip[data-open='true'] > .pymolv-drawer-tab")).toMatch(/opacity:\s*0;/)
    const shown = rule(
      ".pymolv-drawer-strip[data-revealed='true'] > .pymolv-drawer-tab,\n.pymolv-drawer-strip[data-open='true'] > .pymolv-drawer-tab:hover,\n.pymolv-drawer-strip[data-open='true'] > .pymolv-drawer-tab:focus-visible",
    )
    expect(shown).toMatch(/opacity:\s*1/)
    expect(css).toMatch(/@media \(hover: none\) \{\s*\.pymolv-drawer-strip\[data-open='true'\] > \.pymolv-drawer-tab \{\s*opacity: 1;/)
    // Hidden only by opacity: never out of the Tab order or the accessibility tree.
    expect(css).not.toMatch(/pymolv-drawer[^{]*\{[^}]*(display:\s*none|visibility:\s*hidden)/)
  })

  it('a leftwards swipe on the tab asks for the panel out, a rightwards one back: once per gesture, with or without the trailing click', () => {
    const spy = vi.fn()
    const swipeSpy = vi.fn()
    render(<Harness spy={spy} swipeSpy={swipeSpy} />)
    swipe(-DRAWER_SWIPE_PX)
    expect(tab()).toHaveAttribute('aria-expanded', 'true')
    swipe(-40)
    expect(tab()).toHaveAttribute('aria-expanded', 'true')
    // A touch swipe sends no click afterwards.
    swipe(40, 0, false)
    expect(tab()).toHaveAttribute('aria-expanded', 'false')
    // Each swipe says which way, never a flip; no swipe's click toggled.
    expect(swipeSpy.mock.calls).toEqual([[true], [true], [false]])
    expect(spy).not.toHaveBeenCalled()
    // The next plain tap is a tap again, not swallowed by the last swipe.
    fireEvent.pointerDown(tab(), { pointerId: 2, clientX: 10, clientY: 10 })
    fireEvent.pointerUp(tab(), { pointerId: 2, clientX: 11, clientY: 10 })
    fireEvent.click(tab(), { detail: 1 })
    expect(tab()).toHaveAttribute('aria-expanded', 'true')
  })

  it('a swipe says the way it wants, not the flip of a lagging `open`: two quick swipes the same way never undo each other (PT-9400 item 1)', () => {
    // A host whose `open` has not caught up yet (PyMOL busy): it stays closed.
    const swipeSpy = vi.fn()
    render(<PymolObjectDrawerTab open={false} onToggle={vi.fn()} onSwipe={swipeSpy} label="Objects" name="Objects panel" />)
    swipe(-40, 0, false)
    swipe(-40, 0, false)
    expect(swipeSpy.mock.calls).toEqual([[true], [true]])
  })

  it('after a touch swipe (no click follows), Enter, Space or assistive technology still toggle at once (PT-9400 item 4)', () => {
    const spy = vi.fn()
    render(<Harness spy={spy} />)
    swipe(-40, 0, false)
    expect(tab()).toHaveAttribute('aria-expanded', 'true')
    // A key's or assistive technology's click: detail 0.
    fireEvent.click(tab(), { detail: 0 })
    expect(spy).toHaveBeenCalledTimes(1)
    expect(tab()).toHaveAttribute('aria-expanded', 'false')
  })

  it('only a pointer click soon after the swipe is the swipe’s own; a later one is a tap', () => {
    vi.useFakeTimers()
    try {
      const spy = vi.fn()
      render(<Harness spy={spy} />)
      swipe(-40, 0, false)
      vi.advanceTimersByTime(DRAWER_SWIPE_CLICK_MS)
      fireEvent.click(tab(), { detail: 1 })
      expect(spy).toHaveBeenCalledTimes(1)
      expect(tab()).toHaveAttribute('aria-expanded', 'false')
    } finally {
      vi.useRealTimers()
    }
  })

  it('a short or mostly vertical move is no swipe; its click is a tap', () => {
    const spy = vi.fn()
    render(<Harness spy={spy} />)
    swipe(-(DRAWER_SWIPE_PX - 1))
    expect(spy).toHaveBeenCalledTimes(1)
    swipe(-30, 60)
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('locked, it stays reachable with its reason and does nothing, swiped or pressed', () => {
    const spy = vi.fn()
    const swipeSpy = vi.fn()
    render(<Harness spy={spy} swipeSpy={swipeSpy} reason="Available once PyMOL is ready" />)
    expect(tab()).toBeEnabled()
    expect(tab()).toHaveAttribute('aria-disabled', 'true')
    expect(tab()).toHaveAccessibleDescription('Available once PyMOL is ready')
    fireEvent.click(tab())
    swipe(-40)
    expect(spy).not.toHaveBeenCalled()
    expect(swipeSpy).not.toHaveBeenCalled()
  })

  it('its widened hit area reaches over the view only while the panel is closed: open, PyMOL’s own panel is there (PT-9400 item 3)', () => {
    const css = readFileSync(join(__dirname, 'pymolViewer.css'), 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '')
    const widenings = [...css.matchAll(/([^{}]+)\{[^}]*left:\s*-16px[^}]*\}/g)].map(m => m[1].trim())
    expect(widenings).toEqual([".pymolv-drawer-tab[aria-expanded='false']::before"])
  })
})

function RevealHarness({ panelWidth }: { panelWidth: number }) {
  const { revealed, handlers } = useDrawerReveal(panelWidth)
  return <div data-testid="stage" data-revealed={revealed} {...handlers} />
}

describe('useDrawerReveal', () => {
  // React makes its pointerleave of the native pointerout to outside the element.
  const at = (type: string, x: number, pointerType = 'mouse') => {
    const native = type === 'pointerleave' ? 'pointerout' : type
    const e = new MouseEvent(native, { bubbles: true, clientX: x, clientY: 50, relatedTarget: document.body })
    Object.defineProperty(e, 'pointerType', { value: pointerType })
    fireEvent(screen.getByTestId('stage'), e)
  }
  const revealed = () => screen.getByTestId('stage').getAttribute('data-revealed')

  it('reveals while a mouse is over the panel’s width at the right, and not once it leaves; a touch keeps it revealed until a mouse moves again', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, right: 800, top: 0, bottom: 400, width: 800, height: 400 } as DOMRect)
    try {
      render(<RevealHarness panelWidth={220} />)
      expect(revealed()).toBe('false')
      at('pointermove', 579)
      expect(revealed()).toBe('false')
      at('pointermove', 580)
      expect(revealed()).toBe('true')
      at('pointermove', 799)
      expect(revealed()).toBe('true')
      at('pointerleave', 900)
      expect(revealed()).toBe('false')
      // A finger anywhere: shown, whatever the place, and a lift does not hide it.
      at('pointerdown', 10, 'touch')
      expect(revealed()).toBe('true')
      at('pointerleave', 10, 'touch')
      expect(revealed()).toBe('true')
      // The mouse again: the hover decides.
      at('pointermove', 100)
      expect(revealed()).toBe('false')
    } finally {
      vi.restoreAllMocks()
    }
  })
})

describe('pull to zoom (owner 2026-11-20)', () => {
  // Display scale 1 of 3 at DPR 1: the panel 220, 440 or 660 wide; the last has no room.
  const STEPS = [
    { width: 220, allowed: true },
    { width: 440, allowed: true },
    { width: 660, allowed: false },
  ]

  it('zoomPreview: the nearest allowed size to where the tab is, kept within the hysteresis, close past the smallest', () => {
    const z = { steps: STEPS, current: 0 }
    // Shorter than a swipe: nothing yet.
    expect(zoomPreview(z, -10, null)).toBeNull()
    // Leftwards 120: the tab asks for 340 — 220 is nearer than 440 by 0 → the first nearest, then 440 from 150 on.
    expect(zoomPreview(z, -100, null)).toBe(0)
    expect(zoomPreview(z, -150, null)).toBe(1)
    // From 1, back to 0 only once 0 is nearer by the hysteresis.
    expect(zoomPreview(z, -108, 1)).toBe(1)
    expect(zoomPreview(z, -100, 1)).toBe(0)
    // Far left: 660 has no room, so 440 stays.
    expect(zoomPreview(z, -500, null)).toBe(1)
    // Rightwards past the smallest by a swipe's length: close; from a larger size, smaller first.
    expect(zoomPreview(z, 30, null)).toBe('close')
    expect(zoomPreview({ steps: STEPS, current: 1 }, 150, null)).toBe(0)
    expect(zoomPreview(z, Number.NaN, null)).toBeNull()
    expect(DRAWER_ZOOM_HYSTERESIS_PX).toBe(8)
  })

  function ZoomHarness({
    onStep,
    onSwipe,
    onPreview,
    onToggle = () => undefined,
    noZoom = false,
  }: {
    onStep: (i: number) => void
    onSwipe: (v: boolean) => void
    onPreview: (p: unknown) => void
    onToggle?: () => void
    noZoom?: boolean
  }) {
    return (
      <PymolObjectDrawerTab
        open
        onToggle={onToggle}
        onSwipe={onSwipe}
        label="Objects"
        name="Objects panel"
        panelWidth={220}
        zoom={noZoom ? undefined : { steps: STEPS, current: 0, onStep, onPreview, hint: 'Pull sideways' }}
      />
    )
  }

  it('a pull leftwards previews then sets the size on release; the tab says how, and has its grip', () => {
    const onStep = vi.fn()
    const onSwipe = vi.fn()
    const onPreview = vi.fn()
    render(<ZoomHarness onStep={onStep} onSwipe={onSwipe} onPreview={onPreview} />)
    expect(tab()).toHaveAccessibleDescription('Pull sideways')
    expect(document.querySelector('.pymolv-drawer-grip')).not.toBeNull()
    fireEvent.pointerDown(tab(), { pointerId: 1, clientX: 500, clientY: 300 })
    fireEvent.pointerMove(tab(), { pointerId: 1, clientX: 340, clientY: 300 })
    expect(onPreview).toHaveBeenLastCalledWith(1)
    expect(document.querySelector('.pymolv-drawer-strip')).toHaveAttribute('data-dragging', 'true')
    fireEvent.pointerUp(tab(), { pointerId: 1, clientX: 340, clientY: 300 })
    expect(onStep).toHaveBeenCalledWith(1)
    expect(onSwipe).not.toHaveBeenCalled()
    expect(onPreview).toHaveBeenLastCalledWith(null)
    // The click the mouse sends after the drag is the drag's, not a tap.
    fireEvent.click(tab(), { detail: 1 })
    expect(onSwipe).not.toHaveBeenCalled()
  })

  it('rightwards past the smallest still puts the panel back; Esc drops a drag; ← and → step without a drag', () => {
    const onStep = vi.fn()
    const onSwipe = vi.fn()
    render(<ZoomHarness onStep={onStep} onSwipe={onSwipe} onPreview={() => undefined} />)
    fireEvent.pointerDown(tab(), { pointerId: 1, clientX: 500, clientY: 300 })
    fireEvent.pointerUp(tab(), { pointerId: 1, clientX: 540, clientY: 300 })
    expect(onSwipe).toHaveBeenCalledWith(false)
    fireEvent.pointerDown(tab(), { pointerId: 2, clientX: 500, clientY: 300 })
    fireEvent.pointerMove(tab(), { pointerId: 2, clientX: 300, clientY: 300 })
    fireEvent.keyDown(tab(), { key: 'Escape' })
    fireEvent.pointerUp(tab(), { pointerId: 2, clientX: 300, clientY: 300 })
    expect(onStep).not.toHaveBeenCalled()
    fireEvent.keyDown(tab(), { key: 'ArrowLeft' })
    expect(onStep).toHaveBeenCalledWith(1)
    // At the smallest, → has nowhere to go (the panel is put back by Enter, not by an arrow).
    onStep.mockClear()
    fireEvent.keyDown(tab(), { key: 'ArrowRight' })
    expect(onStep).not.toHaveBeenCalled()
  })

  it('a drag Esc dropped, or one ended mostly up or down, leaves the panel as it was: its release and click change nothing (PT-10132 items 1, 4, 8)', () => {
    const onStep = vi.fn()
    const onSwipe = vi.fn()
    const onToggle = vi.fn()
    const onPreview = vi.fn()
    render(<ZoomHarness onStep={onStep} onSwipe={onSwipe} onPreview={onPreview} onToggle={onToggle} />)
    // Esc heard wherever the focus is (Safari gives a pressed button none).
    fireEvent.pointerDown(tab(), { pointerId: 1, clientX: 500, clientY: 300 })
    fireEvent.pointerMove(tab(), { pointerId: 1, clientX: 300, clientY: 300 })
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onPreview).toHaveBeenLastCalledWith(null)
    fireEvent.pointerMove(tab(), { pointerId: 1, clientX: 280, clientY: 300 })
    expect(onPreview).toHaveBeenLastCalledWith(null)
    fireEvent.pointerUp(tab(), { pointerId: 1, clientX: 280, clientY: 300 })
    fireEvent.click(tab(), { detail: 1 })
    // Diagonal: a size was shown, the release is mostly downwards.
    fireEvent.pointerDown(tab(), { pointerId: 2, clientX: 500, clientY: 300 })
    fireEvent.pointerMove(tab(), { pointerId: 2, clientX: 340, clientY: 300 })
    fireEvent.pointerUp(tab(), { pointerId: 2, clientX: 440, clientY: 400 })
    fireEvent.click(tab(), { detail: 1 })
    expect(onStep).not.toHaveBeenCalled()
    expect(onSwipe).not.toHaveBeenCalled()
    expect(onToggle).not.toHaveBeenCalled()
    // A plain tap still toggles.
    fireEvent.pointerDown(tab(), { pointerId: 3, clientX: 500, clientY: 300 })
    fireEvent.pointerUp(tab(), { pointerId: 3, clientX: 500, clientY: 300 })
    fireEvent.click(tab(), { detail: 1 })
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('Esc before any size was shown leaves the panel too; a tab gone mid-drag takes its guides down (PT-10138)', () => {
    const onToggle = vi.fn()
    const onPreview = vi.fn()
    const { unmount } = render(<ZoomHarness onStep={vi.fn()} onSwipe={vi.fn()} onPreview={onPreview} onToggle={onToggle} />)
    fireEvent.pointerDown(tab(), { pointerId: 1, clientX: 500, clientY: 300 })
    fireEvent.pointerMove(tab(), { pointerId: 1, clientX: 490, clientY: 300 })
    fireEvent.keyDown(document.body, { key: 'Escape' })
    fireEvent.pointerUp(tab(), { pointerId: 1, clientX: 490, clientY: 300 })
    fireEvent.click(tab(), { detail: 1 })
    expect(onToggle).not.toHaveBeenCalled()
    fireEvent.pointerDown(tab(), { pointerId: 2, clientX: 500, clientY: 300 })
    fireEvent.pointerMove(tab(), { pointerId: 2, clientX: 340, clientY: 300 })
    expect(onPreview).toHaveBeenLastCalledWith(1)
    unmount()
    expect(onPreview).toHaveBeenLastCalledWith(null)
  })

  it('the sizes going mid-drag (PyMOL restarting) still take the guides down at the release (PT-10132 item 2)', () => {
    const onPreview = vi.fn()
    const props = { onStep: vi.fn(), onSwipe: vi.fn(), onPreview }
    const { rerender } = render(<ZoomHarness {...props} />)
    fireEvent.pointerDown(tab(), { pointerId: 1, clientX: 500, clientY: 300 })
    fireEvent.pointerMove(tab(), { pointerId: 1, clientX: 340, clientY: 300 })
    expect(onPreview).toHaveBeenLastCalledWith(1)
    rerender(<ZoomHarness {...props} noZoom />)
    fireEvent.pointerUp(tab(), { pointerId: 1, clientX: 340, clientY: 300 })
    expect(onPreview).toHaveBeenLastCalledWith(null)
    expect(document.querySelector('.pymolv-drawer-strip')).not.toHaveAttribute('data-dragging', 'true')
  })

  it('its hint is a bubble after a mouse rests on the open tab, never for a touch, gone on leave, press or Esc (owner 2026-11-21: 吹き出しで示す)', () => {
    vi.useFakeTimers()
    try {
      render(<ZoomHarness onStep={vi.fn()} onSwipe={vi.fn()} onPreview={vi.fn()} />)
      const bubble = () => document.querySelector('.pymolv-drawer-bubble')
      // No title of its own any more: the bubble is the hint, and still the tab's description.
      expect(tab()).not.toHaveAttribute('title')
      expect(tab()).toHaveAccessibleDescription('Pull sideways')
      fireEvent.pointerEnter(tab(), { pointerType: 'touch' })
      act(() => vi.advanceTimersByTime(DRAWER_BUBBLE_DELAY_MS + 50))
      expect(bubble()).toBeNull()
      fireEvent.pointerEnter(tab(), { pointerType: 'mouse' })
      act(() => vi.advanceTimersByTime(DRAWER_BUBBLE_DELAY_MS - 50))
      expect(bubble()).toBeNull()
      act(() => vi.advanceTimersByTime(100))
      expect(bubble()).toHaveTextContent('Pull sideways')
      expect(tab()).toHaveAccessibleDescription('Pull sideways')
      fireEvent.keyDown(tab(), { key: 'Escape' })
      expect(bubble()).toBeNull()
      // Esc dismisses it wherever the focus is: a hover moves no focus (PT-10470 item 3).
      fireEvent.pointerLeave(tab(), { pointerType: 'mouse' })
      act(() => vi.advanceTimersByTime(DRAWER_BUBBLE_LEAVE_MS + 10))
      fireEvent.pointerEnter(tab(), { pointerType: 'mouse' })
      act(() => vi.advanceTimersByTime(DRAWER_BUBBLE_DELAY_MS + 10))
      expect(bubble()).not.toBeNull()
      const pageEsc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      act(() => {
        document.body.dispatchEvent(pageEsc)
      })
      expect(bubble()).toBeNull()
      fireEvent.pointerEnter(tab(), { pointerType: 'mouse' })
      act(() => vi.advanceTimersByTime(DRAWER_BUBBLE_DELAY_MS + 10))
      expect(bubble()).not.toBeNull()
      // The pointer can move onto the bubble and rest there (PT-10470 item 4).
      fireEvent.pointerLeave(tab(), { pointerType: 'mouse' })
      act(() => vi.advanceTimersByTime(DRAWER_BUBBLE_LEAVE_MS - 50))
      expect(bubble()).not.toBeNull()
      fireEvent.pointerEnter(bubble()!, { pointerType: 'mouse' })
      act(() => vi.advanceTimersByTime(DRAWER_BUBBLE_LEAVE_MS + 50))
      expect(bubble()).not.toBeNull()
      fireEvent.pointerLeave(bubble()!, { pointerType: 'mouse' })
      act(() => vi.advanceTimersByTime(DRAWER_BUBBLE_LEAVE_MS + 10))
      expect(bubble()).toBeNull()
      fireEvent.pointerEnter(tab(), { pointerType: 'mouse' })
      act(() => vi.advanceTimersByTime(DRAWER_BUBBLE_DELAY_MS + 10))
      fireEvent.pointerDown(tab(), { pointerId: 1, clientX: 500, clientY: 300 })
      expect(bubble()).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('focus after a touch shows no bubble; the keyboard’s focus does, also when it opens the panel from the tab (PT-10470 item 5, PT-10471 item 6)', () => {
    const props = { onStep: vi.fn(), onSwipe: vi.fn(), onPreview: vi.fn() }
    const { rerender } = render(<ZoomHarness {...props} />)
    const bubble = () => document.querySelector('.pymolv-drawer-bubble')
    let now = 10_000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    fireEvent.pointerDown(tab(), { pointerId: 1, pointerType: 'touch', clientX: 500, clientY: 300 })
    act(() => tab().focus())
    expect(bubble()).toBeNull()
    // A focus long after the touch is the keyboard's, even with no blur between (iOS Safari's
    // tap focuses nothing: PT-10597 item 5).
    act(() => tab().blur())
    now += DRAWER_TOUCH_FOCUS_MS + 1
    act(() => tab().focus())
    expect(bubble()).not.toBeNull()
    // The keyboard's focus holds it: the mouse passing over and leaving does not take it (PT-10598).
    // (Timers only: the clock above stays the test's.)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      fireEvent.pointerEnter(tab(), { pointerType: 'mouse' })
      fireEvent.pointerLeave(tab(), { pointerType: 'mouse' })
      act(() => vi.advanceTimersByTime(DRAWER_BUBBLE_LEAVE_MS + 50))
      expect(bubble()).not.toBeNull()
    } finally {
      vi.useRealTimers()
    }
    // The panel closed (no hint): nothing left to swallow an Esc (PT-10471 items 2, 5).
    rerender(<ZoomHarness {...props} noZoom />)
    expect(bubble()).toBeNull()
    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    const seen = vi.fn()
    document.addEventListener('keydown', seen)
    try {
      act(() => {
        tab().dispatchEvent(esc)
      })
      expect(seen).toHaveBeenCalledTimes(1)
    } finally {
      document.removeEventListener('keydown', seen)
    }
    // The hint coming while the keyboard is on the tab (it opened the panel): the bubble.
    rerender(<ZoomHarness {...props} />)
    expect(bubble()).not.toBeNull()
  })

  it('Esc with the focus in another control hides the bubble and still reaches that control (PT-10597 item 4)', () => {
    vi.useFakeTimers()
    try {
      render(
        <>
          <ZoomHarness onStep={vi.fn()} onSwipe={vi.fn()} onPreview={vi.fn()} />
          <button type="button">Elsewhere</button>
        </>,
      )
      fireEvent.pointerEnter(tab(), { pointerType: 'mouse' })
      act(() => vi.advanceTimersByTime(DRAWER_BUBBLE_DELAY_MS + 10))
      expect(document.querySelector('.pymolv-drawer-bubble')).not.toBeNull()
      const other = screen.getByRole('button', { name: 'Elsewhere' })
      other.focus()
      const seen = vi.fn()
      other.addEventListener('keydown', seen)
      act(() => {
        other.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
      })
      expect(document.querySelector('.pymolv-drawer-bubble')).toBeNull()
      expect(seen).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a tab without sizes has no bubble: AgDB’s PyMOL page keeps its plain tab', () => {
    vi.useFakeTimers()
    try {
      render(<ZoomHarness onStep={vi.fn()} onSwipe={vi.fn()} onPreview={vi.fn()} noZoom />)
      fireEvent.pointerEnter(tab(), { pointerType: 'mouse' })
      act(() => vi.advanceTimersByTime(DRAWER_BUBBLE_DELAY_MS + 50))
      expect(document.querySelector('.pymolv-drawer-bubble')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('a closed tab, or one without sizes (AgDB’s PyMOL page), swipes as before and has no grip', () => {
    const spy = vi.fn()
    const swipeSpy = vi.fn()
    render(<Harness spy={spy} swipeSpy={swipeSpy} />)
    expect(document.querySelector('.pymolv-drawer-grip')).toBeNull()
    swipe(-DRAWER_SWIPE_PX)
    expect(swipeSpy).toHaveBeenCalledWith(true)
  })
})
