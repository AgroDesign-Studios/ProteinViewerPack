/**
 * Geometry of the 3D viewer's freehand annotation layer.
 *
 * These assertions live at the model level on purpose: jsdom returns null from
 * `getContext('2d')` (no `canvas` package is installed), so nothing about the
 * painted result is observable in a component test. Everything that can be
 * wrong about a stroke — where it lands, whether the eraser reaches it, whether
 * it survives a resize — is decided by these pure functions.
 */
import { describe, it, expect, vi } from 'vitest'
import {
  ERASER_TOLERANCE_PX,
  INK_KEYS,
  STROKE_WIDTH_PX,
  hitTestStroke,
  normalisePoint,
  paintStrokes,
  shouldAppendPoint,
  type InkPalette,
  type Stroke,
} from './annotationModel'

const STAGE = { width: 800, height: 600 }
const RECT = { left: 100, top: 50, width: 800, height: 600 }

const PALETTE = INK_KEYS.reduce((acc, k) => { acc[k] = `mock-${k}`; return acc }, {} as InkPalette)

function stroke(id: number, points: [number, number][], ink: Stroke['ink'] = 'red'): Stroke {
  return { id, ink, points: points.map(([x, y]) => ({ x, y })) }
}

describe('normalisePoint', () => {
  it('maps a client position to 0..1 of the stage, offset by the rect origin', () => {
    expect(normalisePoint(500, 350, RECT)).toEqual({ x: 0.5, y: 0.5 })
  })

  it('clamps a position outside the stage instead of producing out-of-range ink', () => {
    // Pointer capture keeps delivering moves after the pointer leaves the stage.
    expect(normalisePoint(-1000, -1000, RECT)).toEqual({ x: 0, y: 0 })
    expect(normalisePoint(99999, 99999, RECT)).toEqual({ x: 1, y: 1 })
  })

  it('returns the origin for a zero-sized rect rather than dividing by zero', () => {
    // jsdom performs no layout, so every getBoundingClientRect is 0x0.
    expect(normalisePoint(10, 10, { left: 0, top: 0, width: 0, height: 0 })).toEqual({ x: 0, y: 0 })
  })
})

describe('hitTestStroke', () => {
  const horizontal = stroke(1, [[0.25, 0.5], [0.75, 0.5]])

  it('finds a stroke the pointer is directly over', () => {
    expect(hitTestStroke([horizontal], { x: 0.5, y: 0.5 }, STAGE)).toBe(1)
  })

  it('measures distance in pixels, not in normalised units', () => {
    // 2px below the line: well inside the tolerance despite a tiny delta in
    // normalised space. A model that compared normalised distances against a
    // pixel tolerance would match almost the whole canvas.
    const twoPxBelow = { x: 0.5, y: 0.5 + 2 / STAGE.height }
    expect(hitTestStroke([horizontal], twoPxBelow, STAGE)).toBe(1)

    const farBelow = { x: 0.5, y: 0.5 + (ERASER_TOLERANCE_PX + 6) / STAGE.height }
    expect(hitTestStroke([horizontal], farBelow, STAGE)).toBeNull()
  })

  it('misses a point beyond the end of the segment', () => {
    expect(hitTestStroke([horizontal], { x: 0.05, y: 0.5 }, STAGE)).toBeNull()
  })

  it('returns the topmost stroke when two overlap', () => {
    const later = stroke(2, [[0.25, 0.5], [0.75, 0.5]], 'blue')
    expect(hitTestStroke([horizontal, later], { x: 0.5, y: 0.5 }, STAGE)).toBe(2)
  })

  it('hits a single-point stroke, so a tap can be erased', () => {
    expect(hitTestStroke([stroke(9, [[0.5, 0.5]])], { x: 0.5, y: 0.5 }, STAGE)).toBe(9)
  })

  it('ignores an empty stroke rather than throwing', () => {
    expect(hitTestStroke([stroke(3, [])], { x: 0.5, y: 0.5 }, STAGE)).toBeNull()
  })

  it('returns null against an empty list', () => {
    expect(hitTestStroke([], { x: 0.5, y: 0.5 }, STAGE)).toBeNull()
  })
})

describe('shouldAppendPoint', () => {
  it('accepts the first point of a stroke', () => {
    expect(shouldAppendPoint(undefined, { x: 0.5, y: 0.5 }, STAGE)).toBe(true)
  })

  it('drops a sub-pixel move so a slow drag does not pile up vertices', () => {
    const last = { x: 0.5, y: 0.5 }
    expect(shouldAppendPoint(last, { x: 0.5 + 0.5 / STAGE.width, y: 0.5 }, STAGE)).toBe(false)
  })

  it('accepts a move past the threshold', () => {
    const last = { x: 0.5, y: 0.5 }
    expect(shouldAppendPoint(last, { x: 0.5 + 10 / STAGE.width, y: 0.5 }, STAGE)).toBe(true)
  })
})

describe('paintStrokes', () => {
  function recordingCtx() {
    return {
      save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(),
      lineTo: vi.fn(), stroke: vi.fn(),
      globalAlpha: 1, lineCap: '', lineJoin: '', lineWidth: 0, strokeStyle: '',
    } as unknown as CanvasRenderingContext2D & Record<string, any>
  }

  it('converts normalised points to stage pixels', () => {
    const ctx = recordingCtx()
    paintStrokes(ctx, [stroke(1, [[0.25, 0.5], [0.75, 0.5]])], STAGE, PALETTE)
    expect(ctx.moveTo).toHaveBeenCalledWith(200, 300)
    expect(ctx.lineTo).toHaveBeenCalledWith(600, 300)
  })

  it('resolves the ink key through the palette instead of writing a colour itself', () => {
    // The palette comes from --sv3d-ink-* custom properties, which is what keeps
    // hex literals out of the .tsx files (DESIGN.md §1.4).
    const ctx = recordingCtx()
    paintStrokes(ctx, [stroke(1, [[0, 0], [1, 1]], 'green')], STAGE, PALETTE)
    expect(ctx.strokeStyle).toBe('mock-green')
  })

  it('scales the line width for a higher-resolution capture', () => {
    // The screenshot compositor repaints at the WebGL canvas backing size, which
    // is larger than the CSS stage by the device pixel ratio.
    const ctx = recordingCtx()
    paintStrokes(ctx, [stroke(1, [[0, 0], [1, 1]])], { width: 1600, height: 1200 }, PALETTE, { scale: 2 })
    expect(ctx.lineWidth).toBe(STROKE_WIDTH_PX * 2)
  })

  it('draws a dot for a single-point stroke', () => {
    const ctx = recordingCtx()
    paintStrokes(ctx, [stroke(1, [[0.5, 0.5]])], STAGE, PALETTE)
    expect(ctx.moveTo).toHaveBeenCalledWith(400, 300)
    expect(ctx.lineTo).toHaveBeenCalledWith(400, 300)
    expect(ctx.stroke).toHaveBeenCalledTimes(1)
  })

  it('skips an empty stroke without opening a path', () => {
    const ctx = recordingCtx()
    paintStrokes(ctx, [stroke(1, [])], STAGE, PALETTE)
    expect(ctx.beginPath).not.toHaveBeenCalled()
  })

  it('repaints identically at a new stage size, so a resize loses nothing', () => {
    // Sizing a canvas clears its buffer; the stroke list is the source of truth
    // and normalised coordinates are what make the repaint size-independent.
    const small = recordingCtx()
    const large = recordingCtx()
    const s = [stroke(1, [[0.5, 0.25], [0.5, 0.75]])]
    paintStrokes(small, s, { width: 400, height: 200 }, PALETTE)
    paintStrokes(large, s, { width: 800, height: 400 }, PALETTE)
    expect(small.moveTo).toHaveBeenCalledWith(200, 50)
    expect(large.moveTo).toHaveBeenCalledWith(400, 100)
  })
})
