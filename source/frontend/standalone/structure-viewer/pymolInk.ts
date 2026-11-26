import type { Stroke } from '../../src/components/structure-viewer/annotationModel'
import { paintAnnotationOnto, staleCaptureNote } from '../../src/components/structure-viewer/compositeScreenshot'
import { resolveInkPalette } from '../../src/components/structure-viewer/inkPalette'
import type { PymolObjects } from './pymolObjects'

/**
 * What the lines sit over, beside PyMOL's camera: each object drawn or not, by
 * name. An object hidden, shown, added, deleted or renamed moves no camera, yet
 * the lines drawn over it no longer point at what is on screen (PR #10261's
 * review: the list's version moves only when the names do). Selections and
 * measurements are left out: a pick (PyMOL's `sele`) or a distance draws on
 * the same atoms, so the lines still sit on theirs.
 */
export function inkSceneKey(objects: PymolObjects | undefined): string {
  if (objects === undefined) return ''
  return objects.items
    .filter(o => o.kind !== 'selection' && o.kind !== 'distance')
    .map(o => `${o.on ? '+' : '-'}${o.name}`)
    .join('\n')
}

/** What the pen has drawn over a view now: how many lines, and whether the view moved since. */
export interface InkNow {
  lines: number
  stale: boolean
}

/** The lines as they were when a picture was asked for, ready to go onto it. */
export interface InkTaken {
  lines: number
  /** The PNG PyMOL made, with these lines drawn on it, or why they are not (`inkOntoPng`). Never throws. */
  onto: (png: ArrayBuffer, image: { w: number; h: number }) => Promise<InkOnto>
}

/**
 * The pen over "Includes PyMOL™" mode's view, as the page's picture saves
 * reach it (owner 2026-11-21: 「『描画』で書いた線をスクリーンショットに加える
 * かどうか選べる」). Filled by the PyMOL pane while it is mounted.
 */
export interface PymolInkHandle {
  ink: () => InkNow
  /**
   * The lines now, taken when a picture is asked for (none: null): a line
   * drawn or erased while PyMOL makes the picture changes nothing in it
   * (PR #10244's review).
   */
  take: () => InkTaken | null
}

/**
 * A picture with the lines drawn on it, or the picture as PyMOL made it and why:
 * `shape`, the picture is another shape than the view the lines were drawn over
 * (lines stretched to fit would point at the wrong atoms); `failed`, the
 * drawing could not be done (no canvas of that size, an image the browser
 * cannot read).
 */
export interface InkOnto {
  png: ArrayBuffer
  left: null | 'shape' | 'failed'
}

/** The widest gap between the picture's and the view's width/height ratio that is still the same shape. */
const SAME_SHAPE = 0.01

/**
 * Draws the lines over PyMOL's view onto a PNG PyMOL made of it: the whole
 * canvas, its object panel in it when open — the box the lines were drawn
 * over — at any multiple of its pixels. `inkOntoPymolPng` does the same with
 * a size cap, which a 4× picture here passes; this one has none, and goes through an ImageBitmap and a blob,
 * never a data: URI, which some browsers cap below such a picture (PR #10244's
 * review). Lines drawn before the view moved go on with the caption that says
 * so (`staleText`), as 3Dmol.js mode's do. `rect`: the box's size when the
 * lines were taken (default: now).
 */
export async function inkOntoPng(
  png: ArrayBuffer,
  image: { w: number; h: number },
  box: HTMLElement | null,
  ink: { strokes: readonly Stroke[]; stale: boolean },
  staleText: string,
  rect: { width: number; height: number } | null = null,
): Promise<InkOnto> {
  if (ink.strokes.length === 0) return { png, left: null }
  if (box === null) return { png, left: 'failed' }
  const size = rect ?? box.getBoundingClientRect()
  if (size.width < 1 || size.height < 1 || image.w < 1 || image.h < 1) return { png, left: 'failed' }
  if (Math.abs(image.w / image.h - size.width / size.height) > SAME_SHAPE) return { png, left: 'shape' }
  try {
    if (typeof createImageBitmap !== 'function') return { png, left: 'failed' }
    const bitmap = await createImageBitmap(new Blob([png], { type: 'image/png' }))
    try {
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const ctx = canvas.getContext('2d')
      if (ctx === null || canvas.width < 1 || canvas.height < 1) return { png, left: 'failed' }
      ctx.drawImage(bitmap, 0, 0)
      paintAnnotationOnto(ctx, { width: canvas.width, height: canvas.height }, ink.strokes, resolveInkPalette(box), { width: size.width, height: size.height }, staleCaptureNote(ink.stale, box, staleText))
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
      if (blob === null) return { png, left: 'failed' }
      return { png: await blob.arrayBuffer(), left: null }
    } finally {
      bitmap.close()
    }
  } catch {
    return { png, left: 'failed' }
  }
}
