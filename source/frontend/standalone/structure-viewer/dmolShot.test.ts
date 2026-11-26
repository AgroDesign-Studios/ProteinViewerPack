/**
 * 3Dmol.js's screenshot at a multiple of its pixels (owner 2026-11-20): the
 * view laid out once at the pixel ratio × the multiple, read, and laid out
 * back, with the window's own ratio put back whatever happens. The size made
 * is read from the renderer's own context, as 3Dmol.js 2.5 draws on a shared
 * OffscreenCanvas: the page canvas's width is only the number set (PT-10148).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { dmolPngUri, dmolShotSize } from './dmolShot'

/**
 * A stand-in for 3Dmol.js's viewer: its layout reads the window's ratio (upscaled
 * to 2 at least) into the page canvas's width, as 3Dmol.js does, and its
 * renderer's context has a drawing buffer the GPU may clamp to `cap` a side.
 */
function fakeViewer(css = { w: 400, h: 300 }, cap = Infinity, renderer = true) {
  const canvas = document.createElement('canvas')
  const layout = () => {
    const r = Math.max(window.devicePixelRatio, 2)
    canvas.width = css.w * r
    canvas.height = css.h * r
    canvas.style.width = `${css.w}px`
    canvas.style.height = `${css.h}px`
  }
  layout()
  const gl = {
    get drawingBufferWidth() {
      return Math.min(canvas.width, cap)
    },
    get drawingBufferHeight() {
      return Math.min(canvas.height, cap)
    },
    isContextLost: () => false,
  }
  const shots: string[] = []
  return {
    canvas,
    shots,
    getCanvas: () => canvas,
    getRenderer: renderer ? () => ({ getContext: () => gl }) : undefined,
    resize: layout,
    render: () => undefined,
    pngURI: () => {
      const uri = `png:${canvas.width}x${canvas.height}`
      shots.push(uri)
      return uri
    },
  }
}

const RATIO = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio')

beforeEach(() => {
  // The page canvas holds a bitmaprenderer in a browser: no WebGL context of its own.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})

afterEach(() => {
  vi.restoreAllMocks()
  if (RATIO !== undefined) Object.defineProperty(window, 'devicePixelRatio', RATIO)
})

describe('dmolShot', () => {
  it('1 is the canvas as it is; its size is what 「画面と同じ」 says', () => {
    const v = fakeViewer()
    expect(dmolShotSize(v)).toEqual({ w: 800, h: 600 })
    expect(dmolPngUri(v, 1)).toBe('png:800x600')
    expect(dmolShotSize(null)).toBeNull()
  })

  it('a multiple lays the view out that much larger for the read, then back, and the window keeps its ratio', () => {
    const v = fakeViewer()
    const before = window.devicePixelRatio
    expect(dmolPngUri(v, 3)).toBe('png:2400x1800')
    expect(v.canvas.width).toBe(800)
    expect(v.canvas.style.width).toBe('400px')
    expect(window.devicePixelRatio).toBe(before)
  })

  it('a drawing buffer the GPU made smaller than asked is refused, though the page canvas says the full size (PT-10148 item 1)', () => {
    const v = fakeViewer({ w: 400, h: 300 }, 2000)
    const before = window.devicePixelRatio
    expect(() => dmolPngUri(v, 3)).toThrow('2400 × 1800 px: this device made 2000 × 1800')
    expect(v.shots).toEqual([])
    expect(v.canvas.width).toBe(800)
    expect(window.devicePixelRatio).toBe(before)
  })

  it('a buffer it cannot see is not trusted: no renderer and no context of the canvas’s own is a refusal', () => {
    const v = fakeViewer({ w: 400, h: 300 }, Infinity, false)
    expect(() => dmolPngUri(v, 2)).toThrow('cannot be checked')
    expect(v.shots).toEqual([])
    expect(v.canvas.width).toBe(800)
  })
})
