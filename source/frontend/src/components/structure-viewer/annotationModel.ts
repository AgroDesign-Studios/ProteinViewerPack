/**
 * Pure geometry + painting model for the 3D viewer's freehand annotation layer.
 *
 * Everything here is DOM-free apart from the optional CanvasRenderingContext2D
 * argument. That is deliberate: jsdom returns `null` from `getContext('2d')`
 * (no `canvas` package is installed in this repo), so the layer component guards
 * on a null context and the geometry is verified through these functions instead
 * of through rendered pixels.
 *
 * Stroke points are stored NORMALISED to 0..1 of the stage rect. The overlay
 * canvas is resized by the page layout and by 3Dmol's own resize path, and a
 * canvas resize clears its pixel buffer — so the buffer is never the source of
 * truth, the stroke list is, and it survives any resize without rescaling.
 */

/** Ink choices offered by the toolbar. Actual colours come from CSS custom properties. */
export const INK_KEYS = ['red', 'blue', 'yellow', 'green', 'black', 'white'] as const

export type InkKey = (typeof INK_KEYS)[number]

/**
 * Resolved CSS colours keyed by ink. The component reads these off the
 * `--sv3d-ink-*` custom properties so no hex literal lives in a .tsx file
 * (DESIGN.md §1.4 / §5 — CSS-first, inline hex forbidden). Canvas needs a real
 * colour string, which is why resolution happens at paint time rather than in
 * the stroke record.
 */
export type InkPalette = Record<InkKey, string>

/** A point in stage-normalised coordinates: 0..1 on both axes. */
export interface NormPoint {
  x: number
  y: number
}

export interface Stroke {
  id: number
  ink: InkKey
  points: NormPoint[]
}

/** Pixel size of the stage the strokes are painted onto. */
export interface StageSize {
  width: number
  height: number
}

/** Line width in CSS pixels. Kept here so the eraser tolerance can key off it. */
export const STROKE_WIDTH_PX = 3

/** Eraser reach in CSS pixels, measured from the stroke centre line. */
export const ERASER_TOLERANCE_PX = 8

function clamp01(v: number): number {
  if (v < 0) return 0
  if (v > 1) return 1
  return v
}

/**
 * Convert a pointer position to stage-normalised coordinates.
 *
 * The rect must be read fresh per event rather than cached: a surrounding
 * `.card` lifts by 2px on hover (index.css `.card:hover`), so a cached rect
 * puts every stroke 2px off as soon as the pointer is over the card.
 */
export function normalisePoint(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }): NormPoint {
  if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 }
  return {
    x: clamp01((clientX - rect.left) / rect.width),
    y: clamp01((clientY - rect.top) / rect.height),
  }
}

/** Squared distance, in pixels, from point p to segment ab. */
function distanceToSegmentSqPx(p: NormPoint, a: NormPoint, b: NormPoint, stage: StageSize): number {
  const px = p.x * stage.width
  const py = p.y * stage.height
  const ax = a.x * stage.width
  const ay = a.y * stage.height
  const bx = b.x * stage.width
  const by = b.y * stage.height

  const dx = bx - ax
  const dy = by - ay
  const lenSq = dx * dx + dy * dy
  // Degenerate segment (a single-point stroke): fall back to point distance.
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq))
  const cx = ax + t * dx
  const cy = ay + t * dy
  return (px - cx) * (px - cx) + (py - cy) * (py - cy)
}

/**
 * Topmost stroke within `tolerancePx` of `point`, or null.
 *
 * Stroke-erase rather than pixel-erase: a whole stroke leaves at once. That
 * keeps the stroke list as the single source of truth (a pixel eraser would
 * have to write into the buffer, which any resize then discards) and makes the
 * behaviour reproducible in a test with no 2D context.
 */
export function hitTestStroke(
  strokes: readonly Stroke[],
  point: NormPoint,
  stage: StageSize,
  tolerancePx: number = ERASER_TOLERANCE_PX,
): number | null {
  // A zero-sized stage collapses every distance to 0, which would make the
  // eraser delete the topmost stroke wherever it was tapped. jsdom always
  // reports 0x0, and so does a stage inside a collapsed panel.
  if (stage.width <= 0 || stage.height <= 0) return null
  const limitSq = tolerancePx * tolerancePx
  // Last drawn is topmost, so walk backwards.
  for (let i = strokes.length - 1; i >= 0; i--) {
    const s = strokes[i]
    if (s.points.length === 0) continue
    if (s.points.length === 1) {
      if (distanceToSegmentSqPx(point, s.points[0], s.points[0], stage) <= limitSq) return s.id
      continue
    }
    for (let j = 0; j < s.points.length - 1; j++) {
      if (distanceToSegmentSqPx(point, s.points[j], s.points[j + 1], stage) <= limitSq) return s.id
    }
  }
  return null
}

/**
 * Paint every stroke onto a 2D context sized `stage`.
 *
 * `scale` lets the screenshot compositor reuse this at the captured image's
 * resolution, which differs from the on-screen CSS size because 3Dmol renders
 * its canvas at the device pixel ratio.
 */
export function paintStrokes(
  ctx: CanvasRenderingContext2D,
  strokes: readonly Stroke[],
  stage: StageSize,
  palette: InkPalette,
  opts: { alpha?: number; scale?: number } = {},
): void {
  const scale = opts.scale ?? 1
  ctx.save()
  ctx.globalAlpha = opts.alpha ?? 1
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.lineWidth = STROKE_WIDTH_PX * scale
  for (const s of strokes) {
    if (s.points.length === 0) continue
    ctx.strokeStyle = palette[s.ink]
    ctx.beginPath()
    const first = s.points[0]
    ctx.moveTo(first.x * stage.width, first.y * stage.height)
    if (s.points.length === 1) {
      // A tap with no drag still has to leave a visible dot.
      ctx.lineTo(first.x * stage.width, first.y * stage.height)
    } else {
      for (let i = 1; i < s.points.length; i++) {
        ctx.lineTo(s.points[i].x * stage.width, s.points[i].y * stage.height)
      }
    }
    ctx.stroke()
  }
  ctx.restore()
}

/**
 * Drop consecutive points closer than `minDistPx` so a slow drag does not
 * accumulate hundreds of near-identical vertices.
 */
export function shouldAppendPoint(last: NormPoint | undefined, next: NormPoint, stage: StageSize, minDistPx = 2): boolean {
  if (!last) return true
  const dx = (next.x - last.x) * stage.width
  const dy = (next.y - last.y) * stage.height
  return dx * dx + dy * dy >= minDistPx * minDistPx
}
