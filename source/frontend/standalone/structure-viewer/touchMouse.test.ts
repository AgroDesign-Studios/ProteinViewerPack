/**
 * Touch gestures turned into PyMOL's mouse input (`touchMouse.ts`): one
 * finger rotates (left button), a pinch zooms (right button, dragged down as
 * the fingers spread), two fingers moving together move the view (middle
 * button), and every gesture lets go of its button.
 */
import { describe, expect, it } from 'vitest'
import { GESTURE_SLOP_PX, PINCH_GAIN, TouchMouse, type MouseOp, type TouchPoint } from './touchMouse'

const pt = (id: number, x: number, y: number): TouchPoint => ({ id, x, y })
const downs = (ops: MouseOp[]) => ops.filter(o => o.kind === 'down')
const ups = (ops: MouseOp[]) => ops.filter(o => o.kind === 'up')

describe('TouchMouse', () => {
  it('one finger presses the left button where it landed once it moves, drags it, and lets go when lifted', () => {
    const t = new TouchMouse()
    // Landing alone presses nothing: it may become a two-finger gesture or a tap.
    expect(t.update([pt(1, 100, 200)])).toEqual([])
    expect(t.update([pt(1, 100 + GESTURE_SLOP_PX - 2, 200)])).toEqual([])
    expect(t.update([pt(1, 130, 190)])).toEqual([
      { kind: 'move', x: 100, y: 200 },
      { kind: 'down', button: 0, x: 100, y: 200 },
      { kind: 'move', x: 130, y: 190 },
    ])
    // No movement, no input.
    expect(t.update([pt(1, 130, 190)])).toEqual([])
    expect(t.update([])).toEqual([{ kind: 'up', button: 0, x: 130, y: 190 }])
    // Nothing held: a second lift says nothing.
    expect(t.update([])).toEqual([])
  })

  it('a pinch apart holds the right button at the centre and drags it down; closing drags it back up', () => {
    const t = new TouchMouse()
    // Both fingers land together: nothing is pressed until the gesture is known.
    expect(t.update([pt(1, 100, 300), pt(2, 200, 300)])).toEqual([])
    // Spread by 40 px, the centre still: a pinch.
    const ops = t.update([pt(1, 80, 300), pt(2, 220, 300)])
    expect(downs(ops)).toEqual([{ kind: 'down', button: 2, x: 150, y: 300 }])
    expect(ops[ops.length - 1]).toEqual({ kind: 'move', x: 150, y: 300 + PINCH_GAIN * 40 })
    // Closing past where they started: above the anchor (zooms out).
    expect(t.update([pt(1, 110, 300), pt(2, 190, 300)])).toEqual([{ kind: 'move', x: 150, y: 300 - PINCH_GAIN * 20 }])
    expect(ups(t.update([]))).toEqual([{ kind: 'up', button: 2, x: 150, y: 300 - PINCH_GAIN * 20 }])
  })

  it('two fingers moving together hold the middle button and drag it with their centre', () => {
    const t = new TouchMouse()
    t.update([pt(1, 100, 300), pt(2, 200, 300)])
    const ops = t.update([pt(1, 100, 340), pt(2, 200, 340)])
    expect(downs(ops)).toEqual([{ kind: 'down', button: 1, x: 150, y: 300 }])
    expect(ops[ops.length - 1]).toEqual({ kind: 'move', x: 150, y: 340 })
    expect(t.update([pt(1, 160, 360), pt(2, 260, 360)])).toEqual([{ kind: 'move', x: 210, y: 360 }])
    expect(ups(t.update([]))).toEqual([{ kind: 'up', button: 1, x: 210, y: 360 }])
  })

  it('waits for the fingers to move past the slop before choosing', () => {
    const t = new TouchMouse()
    t.update([pt(1, 100, 300), pt(2, 200, 300)])
    expect(t.update([pt(1, 100 + (GESTURE_SLOP_PX - 2), 300), pt(2, 200, 300)])).toEqual([])
    // Lifted before it was anything: nothing was pressed, nothing to let go.
    expect(t.update([])).toEqual([])
  })

  it('a tap (lifted before it moved) is a left click where the finger landed', () => {
    const t = new TouchMouse()
    expect(t.update([pt(1, 50, 60)])).toEqual([])
    expect(t.update([pt(1, 52, 61)])).toEqual([])
    expect(t.update([])).toEqual([
      { kind: 'move', x: 50, y: 60 },
      { kind: 'down', button: 0, x: 50, y: 60 },
      { kind: 'up', button: 0, x: 50, y: 60 },
    ])
  })

  it('a two-finger gesture whose fingers land one after the other sends no click first (PT-9192 item 5)', () => {
    const t = new TouchMouse()
    expect(t.update([pt(1, 100, 300)])).toEqual([])
    // The second finger lands before the first moved: no button went down, none comes up.
    expect(t.update([pt(1, 100, 300), pt(2, 200, 300)])).toEqual([])
    const ops = t.update([pt(1, 80, 300), pt(2, 220, 300)])
    expect(downs(ops)).toEqual([{ kind: 'down', button: 2, x: 150, y: 300 }])
    expect(ups(t.update([]))).toEqual([{ kind: 'up', button: 2, x: 150, y: 300 + PINCH_GAIN * 40 }])
  })

  it('a finger other than the one that started the rotation lets go and moves nothing (PT-9192 item 1)', () => {
    const t = new TouchMouse()
    t.update([pt(1, 100, 100)])
    t.update([pt(1, 140, 100)])
    // Finger 1 is no longer listed, finger 7 is: the rotation lets go and stays put.
    expect(t.update([pt(7, 300, 300)])).toEqual([{ kind: 'up', button: 0, x: 140, y: 100 }])
    expect(t.update([pt(7, 320, 300)])).toEqual([])
    expect(t.update([])).toEqual([])
  })

  it('a second finger lets go of the rotation; the finger left after it does nothing until all are up', () => {
    const t = new TouchMouse()
    t.update([pt(1, 100, 100)])
    t.update([pt(1, 120, 100)])
    expect(t.update([pt(1, 120, 100), pt(2, 220, 100)])).toEqual([{ kind: 'up', button: 0, x: 120, y: 100 }])
    const pinch = t.update([pt(1, 100, 100), pt(2, 240, 100)])
    expect(downs(pinch)).toEqual([{ kind: 'down', button: 2, x: 170, y: 100 }])
    // One finger lifted: the zoom lets go, and the other finger does not rotate.
    expect(t.update([pt(2, 240, 100)])).toEqual([{ kind: 'up', button: 2, x: 170, y: 100 + PINCH_GAIN * 40 }])
    expect(t.update([pt(2, 300, 150)])).toEqual([])
    expect(t.update([])).toEqual([])
    // A fresh touch rotates again.
    t.update([pt(3, 50, 50)])
    expect(downs(t.update([pt(3, 80, 50)]))).toEqual([{ kind: 'down', button: 0, x: 50, y: 50 }])
  })

  it('a different pair of fingers starts a new gesture, letting go of the old one', () => {
    const t = new TouchMouse()
    t.update([pt(1, 100, 300), pt(2, 200, 300)])
    t.update([pt(1, 100, 340), pt(2, 200, 340)])
    expect(t.update([pt(2, 200, 340), pt(3, 400, 340)])).toEqual([{ kind: 'up', button: 1, x: 150, y: 340 }])
    expect(downs(t.update([pt(2, 180, 340), pt(3, 420, 340)]))).toEqual([{ kind: 'down', button: 2, x: 300, y: 340 }])
  })

  it('a cancelled gesture lets go of whatever it held, and a cancelled tap clicks nothing', () => {
    const t = new TouchMouse()
    t.update([pt(1, 10, 10)])
    t.update([pt(1, 30, 10)])
    expect(t.cancel()).toEqual([{ kind: 'up', button: 0, x: 30, y: 10 }])
    t.update([pt(2, 10, 10)])
    expect(t.cancel()).toEqual([])
    // And it starts over.
    expect(t.update([])).toEqual([])
  })
})
