/**
 * The end of PyMOL's movie-button row redrawn by the page (owner 2026-11-21):
 * 「Seq」 for S, ▼ with its choices — rock or turn, 1×, 2×, 4× — and no F;
 * with PR #10151's review fixes (PT-10647 … PT-10650).
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Motion } from './pymolBridge'
import { MOTION_EXPECT_MS, MOTION_HOVER_MS, MOTION_LEAVE_MS, MOTION_STOP, PymolControlTail, motionCommand, resetMotionChoiceForTests, TAIL_MIN_H, TAIL_MIN_H_TOUCH } from './PymolControlTail'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, o?: Record<string, unknown>) => (o === undefined ? k : `${k} ${JSON.stringify(o)}`) }),
}))

afterEach(() => {
  cleanup()
  resetMotionChoiceForTests()
  vi.useRealTimers()
})

// jsdom has no PointerEvent: the pointer's type, which the hover reads (as PymolObjectDrawerTab.test.tsx).
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

const STILL: Motion = { rock: false, rockSpeed: 0, spin: 0 }
const RECT = { x: 400, y: 280, w: 72, h: 20 }
const setup = (motion: Motion | undefined = STILL, ready = true, rect = RECT) => {
  const run = vi.fn()
  const onSeq = vi.fn()
  const el = (m: Motion | undefined) => <PymolControlTail rect={rect} ready={ready} motion={m} run={run} onSeq={onSeq} />
  const view = render(el(motion))
  const motionBtn = () => screen.getByRole('button', { name: 'htmlExport:sa_pymol_motion_button' })
  return { run, onSeq, motionBtn, rerender: (m: Motion | undefined) => view.rerender(el(m)), unmount: view.unmount }
}
const choice = (name: string) => screen.getByRole('button', { name })

describe('motionCommand', () => {
  it('rocks with the worker’s rock (the user’s sweep settings kept), turns with its steady turn at 30° a second × the speed; each stops the other', () => {
    expect(motionCommand('rock', 1)).toBe('_ /[_agdb_spin_set(0), _agdb_rock_set(1)]')
    expect(motionCommand('rock', 4)).toBe('_ /[_agdb_spin_set(0), _agdb_rock_set(4)]')
    expect(motionCommand('turn', 2)).toBe('_ /[_agdb_rock_set(0), _agdb_spin_set(60)]')
    expect(MOTION_STOP).toBe('_ /[_agdb_spin_set(0), _agdb_rock_set(0)]')
  })
})

describe('PymolControlTail', () => {
  it('lies over PyMOL’s S, ▼ and F with two buttons, 「Seq」 and ▼; 「Seq」 shows or hides the page’s sequence', () => {
    const { onSeq } = setup()
    const tail = document.querySelector('.sav-ctl-tail') as HTMLElement
    expect(tail.style.left).toBe('400px')
    expect(tail.style.width).toBe('72px')
    const seq = screen.getByRole('button', { name: 'htmlExport:sa_pymol_seq_button' })
    expect(seq).toHaveAttribute('title', 'htmlExport:sa_pymol_seq_hint')
    fireEvent.click(seq)
    expect(onSeq).toHaveBeenCalledTimes(1)
    // No F: nothing else is a button.
    expect(screen.getAllByRole('button')).toHaveLength(2)
  })

  it('a band lower than TAIL_MIN_H grows upwards, its words sized to it (PT-10648 item 3)', () => {
    setup(STILL, true, { x: 0, y: 100, w: 60, h: 8.5 })
    const tail = document.querySelector('.sav-ctl-tail') as HTMLElement
    expect(tail.style.height).toBe(`${TAIL_MIN_H}px`)
    expect(tail.style.top).toBe(`${100 + 8.5 - TAIL_MIN_H}px`)
    expect(Number.parseFloat(tail.style.fontSize)).toBeLessThanOrEqual(TAIL_MIN_H - 6)
  })

  it('▼ is a toggle, not a menu button: a click starts the chosen motion or stops it; what runs is the worker’s word', () => {
    const { run, motionBtn, rerender } = setup()
    expect(motionBtn()).toHaveAttribute('aria-pressed', 'false')
    expect(motionBtn()).not.toHaveAttribute('aria-expanded')
    fireEvent.click(motionBtn())
    expect(run).toHaveBeenLastCalledWith(motionCommand('rock', 1))
    rerender({ rock: true, rockSpeed: 1, spin: 0 })
    expect(motionBtn()).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(motionBtn())
    expect(run).toHaveBeenLastCalledWith(MOTION_STOP)
    // A rock started from PyMOL's own menu shows as running too.
    rerender(STILL)
    rerender({ rock: true, rockSpeed: 0, spin: 0 })
    expect(motionBtn()).toHaveAttribute('aria-pressed', 'true')
  })

  it('a quick second click stops what the first started, before the worker has said so (PT-10647 item 4)', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { run, motionBtn } = setup()
    fireEvent.click(motionBtn())
    expect(run).toHaveBeenLastCalledWith(motionCommand('rock', 1))
    expect(motionBtn()).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(motionBtn())
    expect(run).toHaveBeenLastCalledWith(MOTION_STOP)
    // No report ever came: after the wait the worker's word stands again.
    act(() => vi.advanceTimersByTime(MOTION_EXPECT_MS + 10))
    expect(motionBtn()).toHaveAttribute('aria-pressed', 'false')
  })

  it('a mouse resting on ▼ opens its choices; a kind chosen starts it, a speed applies at once while it runs; the speed shown is the worker’s', () => {
    vi.useFakeTimers()
    const { run, motionBtn, rerender } = setup()
    fireEvent.pointerEnter(motionBtn(), { pointerType: 'mouse' })
    act(() => vi.advanceTimersByTime(MOTION_HOVER_MS - 50))
    expect(document.querySelector('.sav-motion-pop')).toBeNull()
    act(() => vi.advanceTimersByTime(100))
    expect(document.querySelector('.sav-motion-pop')).not.toBeNull()
    fireEvent.click(choice('htmlExport:sa_pymol_motion_turn'))
    expect(run).toHaveBeenLastCalledWith(motionCommand('turn', 1))
    rerender({ rock: false, rockSpeed: 0, spin: 30 })
    expect(choice('htmlExport:sa_pymol_motion_turn')).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(choice('htmlExport:sa_pymol_motion_times {"n":4}'))
    expect(run).toHaveBeenLastCalledWith(motionCommand('turn', 4))
    rerender({ rock: false, rockSpeed: 0, spin: 120 })
    expect(choice('htmlExport:sa_pymol_motion_times {"n":4}')).toHaveAttribute('aria-pressed', 'true')
    expect(choice('htmlExport:sa_pymol_motion_stop')).toBeInTheDocument()
    // The pointer may cross to the choices: they stay while it is on them.
    const pop = document.querySelector('.sav-motion-pop') as HTMLElement
    fireEvent.pointerLeave(motionBtn(), { pointerType: 'mouse' })
    fireEvent.pointerEnter(pop, { pointerType: 'mouse' })
    act(() => vi.advanceTimersByTime(MOTION_LEAVE_MS + 50))
    expect(document.querySelector('.sav-motion-pop')).not.toBeNull()
  })

  it('the speed last chosen outlives the strip (PT-10648 item 6)', () => {
    vi.useFakeTimers()
    const first = setup()
    fireEvent.keyDown(first.motionBtn(), { key: 'ArrowUp' })
    fireEvent.click(choice('htmlExport:sa_pymol_motion_times {"n":2}'))
    first.unmount()
    const again = setup()
    fireEvent.click(again.motionBtn())
    expect(again.run).toHaveBeenLastCalledWith(motionCommand('rock', 2))
  })

  it('Esc closes the choices; it is theirs only with the focus on them or nobody, and a focused control elsewhere still gets it (PT-10647 items 1, 5)', () => {
    vi.useFakeTimers()
    render(<button type="button">Elsewhere</button>)
    const { motionBtn } = setup()
    fireEvent.pointerEnter(motionBtn(), { pointerType: 'mouse' })
    act(() => vi.advanceTimersByTime(MOTION_HOVER_MS + 10))
    const other = screen.getByRole('button', { name: 'Elsewhere' })
    other.focus()
    const seen = vi.fn()
    other.addEventListener('keydown', seen)
    act(() => {
      other.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(document.querySelector('.sav-motion-pop')).toBeNull()
    expect(seen).toHaveBeenCalledTimes(1)
    // Opened from the keyboard: the focus is in them, the Esc is theirs, the focus back on ▼.
    motionBtn().focus()
    fireEvent.keyDown(motionBtn(), { key: 'ArrowUp' })
    expect(document.activeElement).toBe(choice('htmlExport:sa_pymol_motion_rock'))
    const page = vi.fn()
    document.addEventListener('keydown', page)
    try {
      act(() => {
        document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      })
      expect(page).not.toHaveBeenCalled()
    } finally {
      document.removeEventListener('keydown', page)
    }
    expect(document.querySelector('.sav-motion-pop')).toBeNull()
    expect(document.activeElement).toBe(motionBtn())
  })

  it('choices opened by a tap or the keyboard close on a press or the focus elsewhere, and a mouse passing by does not close them under the focus (PT-10647 item 2, PT-10649 item 7)', () => {
    vi.useFakeTimers()
    render(<button type="button">Elsewhere</button>)
    const { run, motionBtn } = setup()
    fireEvent.pointerDown(motionBtn(), { pointerType: 'touch' })
    fireEvent.click(motionBtn())
    expect(run).not.toHaveBeenCalled()
    expect(document.querySelector('.sav-motion-pop')).not.toBeNull()
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Elsewhere' }))
    expect(document.querySelector('.sav-motion-pop')).toBeNull()
    motionBtn().focus()
    fireEvent.keyDown(motionBtn(), { key: 'ArrowUp' })
    fireEvent.pointerEnter(motionBtn(), { pointerType: 'mouse' })
    fireEvent.pointerLeave(motionBtn(), { pointerType: 'mouse' })
    act(() => vi.advanceTimersByTime(MOTION_LEAVE_MS + 50))
    expect(document.querySelector('.sav-motion-pop')).not.toBeNull()
    act(() => screen.getByRole('button', { name: 'Elsewhere' }).focus())
    expect(document.querySelector('.sav-motion-pop')).toBeNull()
  })

  it('a blur with nowhere to go — Safari focuses no button it clicks — leaves the choices to the press behind it (PR #10172 review)', () => {
    render(<button type="button">Elsewhere</button>)
    const { motionBtn } = setup()
    motionBtn().focus()
    fireEvent.keyDown(motionBtn(), { key: 'ArrowUp' })
    expect(document.querySelector('.sav-motion-pop')).not.toBeNull()
    act(() => motionBtn().blur())
    expect(document.querySelector('.sav-motion-pop')).not.toBeNull()
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Elsewhere' }))
    expect(document.querySelector('.sav-motion-pop')).toBeNull()
  })

  it('on a touch screen the strip is at least the 24 px target: a finger has no other way to ▼’s choices (PR #10172 review)', () => {
    const had = Object.getOwnPropertyDescriptor(window, 'matchMedia')
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (q: string) => ({ matches: q === '(any-pointer: coarse)', media: q, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false }),
    })
    try {
      setup(STILL, true, { x: 400, y: 100, w: 72, h: 8.5 })
      const tail = document.querySelector('.sav-ctl-tail') as HTMLElement
      expect(tail.style.height).toBe(`${TAIL_MIN_H_TOUCH}px`)
      expect(tail.style.top).toBe(`${100 + 8.5 - TAIL_MIN_H_TOUCH}px`)
    } finally {
      if (had) Object.defineProperty(window, 'matchMedia', had)
      else delete (window as { matchMedia?: unknown }).matchMedia
    }
  })

  it('not ready, nothing is sent, and every button says so (PT-10650 item 2)', () => {
    const { run, onSeq, motionBtn } = setup(STILL, false)
    fireEvent.click(motionBtn())
    fireEvent.click(screen.getByRole('button', { name: 'htmlExport:sa_pymol_seq_button' }))
    expect(run).not.toHaveBeenCalled()
    expect(onSeq).not.toHaveBeenCalled()
    fireEvent.keyDown(motionBtn(), { key: 'ArrowUp' })
    for (const b of screen.getAllByRole('button')) expect(b).toHaveAttribute('aria-disabled', 'true')
  })
})
