import { describe, expect, it, vi } from 'vitest'

import { attachTwoFingerPan, SLOP_PX, TwoFingerPan, type Finger } from './twoFingerPan'

const two = (ax: number, ay: number, bx: number, by: number): Finger[] => [
  { id: 1, x: ax, y: ay },
  { id: 2, x: bx, y: by },
]

describe('TwoFingerPan (owner 2026-11-17: two fingers move the Light viewer)', () => {
  it('two fingers moving together are a move: held back from 3Dmol.js, the view follows their centre', () => {
    const p = new TwoFingerPan()
    p.reset(two(100, 300, 160, 300))
    // Within the slop: held back, nothing moved yet.
    expect(p.move(two(102, 300, 162, 300))).toEqual({ pass: false, dx: 0, dy: 0 })
    // Past it: a move, from where the fingers started.
    expect(p.move(two(110, 304, 170, 304))).toEqual({ pass: false, dx: 10, dy: 4 })
    expect(p.move(two(130, 304, 190, 304))).toEqual({ pass: false, dx: 20, dy: 0 })
  })

  it('two fingers spreading are a pinch, left to 3Dmol.js for the whole gesture', () => {
    const p = new TwoFingerPan()
    p.reset(two(100, 300, 160, 300))
    expect(p.move(two(100 - SLOP_PX, 300, 160 + SLOP_PX, 300))).toEqual({ pass: true })
    // Once a pinch, a move of the centre stays a pinch (decided once, as touchMouse.ts does).
    expect(p.move(two(150, 300, 230, 300))).toEqual({ pass: true })
  })

  it('one finger and three are 3Dmol.js’s own (turn; its own three-finger move)', () => {
    const p = new TwoFingerPan()
    p.reset([{ id: 1, x: 10, y: 10 }])
    expect(p.move([{ id: 1, x: 60, y: 10 }])).toEqual({ pass: true })
    p.reset([...two(0, 0, 50, 0), { id: 3, x: 25, y: 40 }])
    expect(p.move([...two(20, 0, 70, 0), { id: 3, x: 45, y: 40 }])).toEqual({ pass: true })
  })

  it('a finger lifted ends the gesture: what is left is 3Dmol.js’s again', () => {
    const p = new TwoFingerPan()
    p.reset(two(100, 300, 160, 300))
    p.move(two(120, 300, 180, 300))
    p.reset([{ id: 1, x: 120, y: 300 }])
    expect(p.move([{ id: 1, x: 140, y: 300 }])).toEqual({ pass: true })
  })
})

describe('attachTwoFingerPan', () => {
  /** A touch event whose fingers jsdom cannot make: targetTouches given as a plain list. */
  function touch(type: string, fingers: Finger[]) {
    const e = new Event(type, { bubbles: true, cancelable: true }) as Event & { targetTouches: unknown }
    const list = fingers.map(f => ({ identifier: f.id, clientX: f.x, clientY: f.y }))
    Object.defineProperty(e, 'targetTouches', { value: Object.assign(list, { item: (i: number) => list[i] }) })
    return e
  }

  it('moves the view by the screen pixels times the canvas ratio, and 3Dmol.js’s canvas never sees the moves; detached, nothing is held back', () => {
    const el = document.createElement('div')
    const canvas = document.createElement('canvas')
    el.appendChild(canvas)
    document.body.appendChild(el)
    const seen = vi.fn()
    canvas.addEventListener('touchmove', seen)
    const translateScene = vi.fn()
    const viewer = { translateScene, renderer: { getXRatio: () => 2, getYRatio: () => 2 } }
    const detach = attachTwoFingerPan(el, () => viewer)
    canvas.dispatchEvent(touch('touchstart', two(100, 300, 160, 300)))
    const move = touch('touchmove', two(120, 310, 180, 310))
    canvas.dispatchEvent(move)
    expect(translateScene).toHaveBeenCalledWith(40, 20)
    expect(seen).not.toHaveBeenCalled()
    expect(move.defaultPrevented).toBe(true)
    detach()
    canvas.dispatchEvent(touch('touchstart', two(100, 300, 160, 300)))
    canvas.dispatchEvent(touch('touchmove', two(120, 310, 180, 310)))
    expect(seen).toHaveBeenCalledTimes(1)
    expect(translateScene).toHaveBeenCalledTimes(1)
    el.remove()
  })
})
