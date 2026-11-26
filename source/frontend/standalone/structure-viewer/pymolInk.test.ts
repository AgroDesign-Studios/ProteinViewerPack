/**
 * The pen's lines onto a PNG PyMOL made (owner 2026-11-21): any multiple of
 * the view, no size cap, through an ImageBitmap and a blob (never a data:
 * URI, PR #10244's review), and the picture as it was, with the reason, when
 * they cannot go on. The drawing itself is paintAnnotationOnto's (its own tests).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/components/structure-viewer/compositeScreenshot', () => ({
  paintAnnotationOnto: vi.fn(),
  staleCaptureNote: (stale: boolean, _el: unknown, text: string) => (stale ? { staleNote: { text } } : {}),
}))

import type { Stroke } from '../../src/components/structure-viewer/annotationModel'
import { paintAnnotationOnto } from '../../src/components/structure-viewer/compositeScreenshot'
import { inkOntoPng, inkSceneKey } from './pymolInk'
import type { PymolObjects } from './pymolObjects'

const LINE: Stroke = {
  id: 1,
  ink: 'red',
  points: [
    { x: 0.1, y: 0.1 },
    { x: 0.5, y: 0.5 },
  ],
}
const box = (w: number, h: number) => {
  const el = document.createElement('div')
  el.getBoundingClientRect = () => ({ width: w, height: h, left: 0, top: 0, right: w, bottom: h, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
  return el
}
const PNG = new Uint8Array([137, 80, 78, 71]).buffer

let drawn: Blob | null
beforeEach(() => {
  // jsdom's Blob has no arrayBuffer(); a browser's has.
  drawn = { arrayBuffer: async () => new TextEncoder().encode('DRAWN').buffer } as unknown as Blob
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ width: 3200, height: 2400, close: vi.fn() })),
  )
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (cb: BlobCallback) {
    cb(drawn)
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('inkOntoPng', () => {
  it('no lines: the picture as PyMOL made it', async () => {
    const out = await inkOntoPng(PNG, { w: 800, h: 600 }, box(800, 600), { strokes: [], stale: false }, 'moved')
    expect(out).toEqual({ png: PNG, left: null })
  })

  it('no box, or a picture of another shape than the view: left out, with the reason', async () => {
    expect((await inkOntoPng(PNG, { w: 800, h: 600 }, null, { strokes: [LINE], stale: false }, 'moved')).left).toBe('failed')
    expect((await inkOntoPng(PNG, { w: 800, h: 800 }, box(800, 600), { strokes: [LINE], stale: false }, 'moved')).left).toBe('shape')
  })

  it('drawn on at any multiple of the view, with the caption when the view moved since, and no data: URI', async () => {
    const btoa = vi.spyOn(window, 'btoa')
    const out = await inkOntoPng(PNG, { w: 3200, h: 2400 }, box(800, 600), { strokes: [LINE], stale: true }, 'moved')
    expect(out.left).toBeNull()
    expect(new TextDecoder().decode(out.png)).toBe('DRAWN')
    const call = vi.mocked(paintAnnotationOnto).mock.lastCall!
    expect(call[1]).toEqual({ width: 3200, height: 2400 })
    expect(call[4]).toEqual({ width: 800, height: 600 })
    expect(call[5]).toEqual({ staleNote: { text: 'moved' } })
    expect(btoa).not.toHaveBeenCalled()
  })

  it('the box as it was when the lines were taken, not as it is now', async () => {
    await inkOntoPng(PNG, { w: 1000, h: 500 }, box(800, 600), { strokes: [LINE], stale: false }, 'moved', { width: 500, height: 250 })
    expect(vi.mocked(paintAnnotationOnto).mock.lastCall![4]).toEqual({ width: 500, height: 250 })
  })

  it('a picture the browser cannot draw: left out', async () => {
    drawn = null
    const out = await inkOntoPng(PNG, { w: 800, h: 600 }, box(800, 600), { strokes: [LINE], stale: false }, 'moved')
    expect(out).toEqual({ png: PNG, left: 'failed' })
    vi.stubGlobal('createImageBitmap', undefined)
    expect((await inkOntoPng(PNG, { w: 800, h: 600 }, box(800, 600), { strokes: [LINE], stale: false }, 'moved')).left).toBe('failed')
  })
})

describe('inkSceneKey', () => {
  const list = (items: [string, PymolObjects['items'][number]['kind'], boolean][]): PymolObjects => ({
    v: 1,
    items: items.map(([name, kind, on]) => ({ name, kind, on })),
    more: false,
    focus: null,
    reps: null,
  })

  it('moves when an object is hidden, shown, added, deleted or renamed, though the list’s version does not (PR #10261 review)', () => {
    const shown = inkSceneKey(list([['Structure_25HN', 'molecule', true], ['ligand', 'molecule', true]]))
    expect(inkSceneKey(list([['Structure_25HN', 'molecule', true], ['ligand', 'molecule', false]]))).not.toBe(shown)
    expect(inkSceneKey(list([['Structure_25HN', 'molecule', true]]))).not.toBe(shown)
    expect(inkSceneKey(list([['Structure_25HN', 'molecule', true], ['ligand2', 'molecule', true]]))).not.toBe(shown)
    expect(inkSceneKey(list([['Structure_25HN', 'molecule', true], ['ligand', 'molecule', true], ['map', 'map', true]]))).not.toBe(shown)
  })

  it('does not move for a pick or a measurement: they draw on the same atoms', () => {
    const shown = inkSceneKey(list([['Structure_25HN', 'molecule', true]]))
    expect(inkSceneKey(list([['Structure_25HN', 'molecule', true], ['sele', 'selection', true]]))).toBe(shown)
    expect(inkSceneKey(list([['Structure_25HN', 'molecule', true], ['dist01', 'distance', true]]))).toBe(shown)
    expect(inkSceneKey(list([['Structure_25HN', 'molecule', true], ['sele', 'selection', false]]))).toBe(shown)
  })

  it('is empty before PyMOL has said its list', () => {
    expect(inkSceneKey(undefined)).toBe('')
  })
})
