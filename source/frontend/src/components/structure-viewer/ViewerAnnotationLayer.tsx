import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  STROKE_WIDTH_PX,
  hitTestStroke,
  normalisePoint,
  paintStrokes,
  shouldAppendPoint,
  type InkKey,
  type InkPalette,
  type NormPoint,
  type StageSize,
} from './annotationModel'
import { resolveInkPalette } from './inkPalette'
import { eraserCursor, penCursor } from './inkCursor'
import type { ViewerAnnotation } from './useViewerAnnotation'

interface Props {
  /** The positioned box that also holds the 3Dmol mount div. */
  stageRef: React.RefObject<HTMLDivElement | null>
  annotation: ViewerAnnotation
  /**
   * True while the camera moves on its own (Spin). Screen-space ink cannot
   * follow the molecule, so anything drawn during it is stale on arrival.
   */
  cameraMoving?: boolean
  /**
   * Over a viewer in a frame of its own (PyMOL in a frame): the page never
   * sees the pointer inside it, so the frame draws the laser and the
   * crosshair itself and PyMOL keeps every
   * drag and wheel (owner 2026-11-12); a camera move is read from `viewToken`
   * instead of from the stage's own drags.
   */
  framed?: boolean
  /**
   * Changes whenever the viewer's CAMERA changes (polled); null while the
   * viewer is not up. Framed, the only sign of a camera move. Unframed (the
   * offline app's PyMOL, whose canvas also holds its object panel, where a
   * drag moves no camera), it replaces the stage's drag and wheel as the sign.
   */
  viewToken?: () => string | null
}

/** How often a given `viewToken` is read while there is ink (framed or not). */
export const VIEW_TOKEN_POLL_MS = 500

const EMPTY_STAGE: StageSize = { width: 0, height: 0 }

/**
 * Transparent freehand-annotation surface stacked over the 3Dmol canvas, plus
 * the laser-pointer dot.
 *
 * Two invariants matter here:
 *
 * 1. The canvas is a SIBLING of the 3Dmol mount div, never a child — 3Dmol's
 *    lost-context recovery does `container.querySelector('canvas')` and would
 *    adopt this one as its render target.
 * 2. It is `pointer-events: none` unless a tool is armed. 3Dmol binds mousedown
 *    / wheel / mousemove directly on its own canvas, so an overlay that takes
 *    pointer events at rest would kill rotation, zoom and pan outright.
 */
export default function ViewerAnnotationLayer({ stageRef, annotation, cameraMoving = false, framed = false, viewToken }: Props) {
  const { t } = useTranslation('proteindb')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState<StageSize>(EMPTY_STAGE)
  const [palette, setPalette] = useState<InkPalette>(() => resolveInkPalette(null))
  const [laser, setLaser] = useState<{ x: number; y: number } | null>(null)
  /**
   * The stroke currently under the pointer. It lives in a ref, not in state:
   * growing it through state copies the stroke array and the points array on
   * every move and re-runs the full repaint, which is quadratic in the stroke's
   * length. It is drawn one segment at a time here and committed whole on
   * pointerup.
   */
  const activeRef = useRef<{ ink: InkKey; points: NormPoint[]; pointerId: number } | null>(null)
  /** pointerId of the erase drag in progress, or null. */
  const erasingRef = useRef<number | null>(null)

  const toolArmed = annotation.tool !== 'none'
  const armed = toolArmed

  // Esc puts the tool away. Listened for on the document, in capture: a press
  // on the canvas leaves focus outside the card, and the page's own Esc
  // handlers must see this press as taken, so one Esc does one thing.
  const { setTool } = annotation
  const backRef = useRef<HTMLButtonElement>(null)
  /**
   * Puts the tool away. The note's button leaves with it, so when focus is on
   * that button it moves first to the 「回転・拡大」 chip (now the pressed
   * one) rather than falling to <body>.
   */
  const putAway = useCallback(() => {
    if (backRef.current !== null && document.activeElement === backRef.current) {
      // The nearest pane first: the card holds a second chip row for the
      // other engine, out of sight and inert.
      const scope = backRef.current.closest('.v3d-engine-pane, .card, main, body')
      scope?.querySelector<HTMLButtonElement>('.sv3d-chip-group > button')?.focus()
    }
    setTool('none')
  }, [setTool])
  // With a view token: the ink is out of register once the viewer's camera or
  // scene has changed since the last line was drawn. Framed, the page cannot
  // see the drags; unframed, not every drag is the camera's.
  const strokeCount = annotation.strokes.length
  useEffect(() => {
    if (viewToken === undefined || strokeCount === 0) return
    let base = viewToken()
    const timer = setInterval(() => {
      const now = viewToken()
      if (now === null || now === base) return
      // A camera that only now became known is another one too: the lines
      // were kept across a stop and a new start of the viewer.
      base = now
      annotation.markStale()
    }, VIEW_TOKEN_POLL_MS)
    return () => clearInterval(timer)
    // A new line re-bases: it was drawn against the view as it is now.
  }, [viewToken, strokeCount, annotation.markStale])
  useEffect(() => {
    if (!armed) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing) return
      const target = e.target
      if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return
      if (document.querySelector('.modal-overlay, [role="dialog"][aria-modal="true"]')) return
      e.preventDefault()
      putAway()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [armed, putAway])
  const { markStale } = annotation

  // Measure on mount AND on resize. The mount measurement is not redundant:
  // The test setup installs a ResizeObserver stub whose observe() is a no-op,
  // so a resize-only measurement would leave the stage at 0x0 in every test.
  const measure = useCallback(() => {
    const el = stageRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setSize(prev => (prev.width === rect.width && prev.height === rect.height ? prev : { width: rect.width, height: rect.height }))
  }, [stageRef])

  useEffect(() => {
    measure()
    setPalette(resolveInkPalette(stageRef.current))
    const el = stageRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => measure())
    ro.observe(el)
    return () => ro.disconnect()
  }, [measure, stageRef])

  /**
   * Full repaint: committed strokes plus whatever is under the pointer right
   * now. Runs on every committed change and on resize.
   *
   * The pixel buffer is never the source of truth — sizing a canvas clears it,
   * and the stage is resized by the page layout and 3Dmol
   * itself — so everything is redrawn from the normalised stroke list.
   */
  const repaint = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const w = Math.max(0, Math.round(size.width * dpr))
    const h = Math.max(0, Math.round(size.height * dpr))
    if (canvas.width !== w) canvas.width = w
    if (canvas.height !== h) canvas.height = h
    // jsdom has no 2D context (the `canvas` package is not installed); bail
    // quietly so mounting this layer never throws in a test.
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    if (size.width <= 0 || size.height <= 0) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    paintStrokes(ctx, annotation.strokes, size, palette)
    const active = activeRef.current
    if (active) paintStrokes(ctx, [{ id: -1, ink: active.ink, points: active.points }], size, palette)
  }, [annotation.strokes, size, palette])

  useEffect(() => { repaint() }, [repaint])

  /** Draw one new segment of the in-progress stroke, leaving the rest alone. */
  const drawSegment = useCallback((from: NormPoint, to: NormPoint, inkKey: InkKey) => {
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx || size.width <= 0 || size.height <= 0) return
    // The transform is already dpr-scaled by the last repaint, so coordinates
    // stay in CSS pixels here.
    ctx.save()
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.lineWidth = STROKE_WIDTH_PX
    ctx.strokeStyle = palette[inkKey]
    ctx.beginPath()
    ctx.moveTo(from.x * size.width, from.y * size.height)
    ctx.lineTo(to.x * size.width, to.y * size.height)
    ctx.stroke()
    ctx.restore()
  }, [size, palette])

  // Laser dot follows the pointer over the whole stage. The listener sits on the
  // stage, not on this canvas, because at rest the canvas is pointer-transparent
  // — pointermove still bubbles up from the 3Dmol canvas underneath.
  useEffect(() => {
    const el = stageRef.current
    // Framed, the frame draws the laser on its own canvas.
    if (!el || framed || annotation.cursorMode !== 'laser') { setLaser(null); return }
    const onMove = (e: PointerEvent) => {
      // Read the rect per event: a surrounding `.card` lifts 2px on hover,
      // so a cached rect would offset the dot from the real pointer.
      const rect = el.getBoundingClientRect()
      setLaser({ x: e.clientX - rect.left, y: e.clientY - rect.top })
    }
    const onLeave = () => setLaser(null)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerleave', onLeave)
    return () => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerleave', onLeave)
    }
  }, [stageRef, annotation.cursorMode, framed])

  // Screen-space ink cannot follow the molecule, so detect the camera moving and
  // flag the strokes as out of register. A drag with a button held, or a wheel
  // tick, while no tool is armed is by definition 3Dmol rotating/zooming — a
  // plain click (residue pick) leaves the camera alone and must not trip this.
  const hasStrokes = annotation.strokes.length > 0
  // Unframed with a view token, the token says when the camera moved (above).
  const tokenOnly = !framed && viewToken !== undefined
  useEffect(() => {
    const el = stageRef.current
    if (!el || armed || !hasStrokes || tokenOnly) return
    const onMove = (e: PointerEvent) => { if (e.buttons !== 0) markStale() }
    const onWheel = () => markStale()
    el.addEventListener('pointermove', onMove)
    el.addEventListener('wheel', onWheel, { passive: true })
    return () => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('wheel', onWheel)
    }
  }, [stageRef, armed, hasStrokes, tokenOnly, markStale])

  // Any tool change ends whatever gesture was in flight. This is the recovery
  // path that makes the pointer-down guard safe: a pointerup that never reaches
  // the canvas — capture unavailable, or already lost — would otherwise leave an
  // owning id set, and since pointerIds are never reused the guard would refuse
  // every later gesture for the rest of the session. Pressing a tool chip clears
  // it, and the partial stroke is kept rather than discarded.
  const { addStroke } = annotation
  useEffect(() => {
    const active = activeRef.current
    activeRef.current = null
    erasingRef.current = null
    if (active) addStroke(active.ink, active.points)
  }, [annotation.tool, addStroke])

  // Ink drawn WHILE the camera is already moving is out of register the moment
  // it lands, but the drag detector below is disabled while a tool is armed and
  // markStale on the spin transition has already fired. Without this, drawing on
  // a spinning model never raises the banner.
  useEffect(() => {
    if (cameraMoving && annotation.strokes.length > 0) markStale()
  }, [cameraMoving, annotation.strokes.length, markStale])

  function rectOf(): { left: number; top: number; width: number; height: number } | null {
    const el = stageRef.current
    if (!el) return null
    return el.getBoundingClientRect()
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!toolArmed) return
    // The pen and the eraser are the main button's: a right press over PyMOL (its menu's
    // gesture) or the middle one draws nothing (PR #10244's review).
    if (e.pointerType === 'mouse' && e.button !== 0) return
    // A second finger or a palm fires a real pointerdown mid-gesture (the armed
    // layer sets touch-action: none). Overwriting the in-progress stroke would
    // drop its points without ever committing them, and a stray erase would
    // delete whatever happened to sit under the palm.
    if (activeRef.current || erasingRef.current !== null) return
    const rect = rectOf()
    if (!rect) return
    // Optional-call form: jsdom implements no setPointerCapture (house pattern
    // shared by other pointer-drag components).
    e.currentTarget.setPointerCapture?.(e.pointerId)
    const p = normalisePoint(e.clientX, e.clientY, rect)
    if (annotation.tool === 'pen') {
      activeRef.current = { ink: annotation.ink, points: [p], pointerId: e.pointerId }
      // A tap with no drag still has to leave a visible dot.
      drawSegment(p, p, annotation.ink)
    } else {
      erasingRef.current = e.pointerId
      const hit = hitTestStroke(annotation.strokes, p, size)
      if (hit !== null) annotation.eraseStroke(hit)
    }
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!toolArmed) return
    const rect = rectOf()
    if (!rect) return
    const p = normalisePoint(e.clientX, e.clientY, rect)
    const active = activeRef.current
    if (active && active.pointerId === e.pointerId) {
      // Lost capture (pointerup outside the window) leaves buttons at 0.
      if (e.buttons === 0) { commitActiveStroke(); return }
      const last = active.points[active.points.length - 1]
      if (!shouldAppendPoint(last, p, size)) return
      active.points.push(p)
      drawSegment(last, p, active.ink)
      return
    }
    if (erasingRef.current === e.pointerId) {
      if (e.buttons === 0) { erasingRef.current = null; return }
      const hit = hitTestStroke(annotation.strokes, p, size)
      if (hit !== null) annotation.eraseStroke(hit)
    }
  }

  /** Move the in-progress stroke into state as one unit. */
  function commitActiveStroke() {
    const active = activeRef.current
    activeRef.current = null
    if (active) annotation.addStroke(active.ink, active.points)
  }

  function endGesture(e: React.PointerEvent<HTMLCanvasElement>) {
    // Only the pointer that started the stroke may finish it; otherwise a second
    // finger lifting would commit — and thereby end — the first finger's stroke.
    const active = activeRef.current
    if (!active || active.pointerId === e.pointerId) commitActiveStroke()
    // Same ownership rule for the eraser: a second pointer lifting must not end
    // the erase drag the first one is still performing.
    if (erasingRef.current === e.pointerId) erasingRef.current = null
    // Throws InvalidPointerId when capture was already lost (a pointercancel can
    // arrive after the browser released it), and is simply absent in jsdom.
    try { e.currentTarget.releasePointerCapture?.(e.pointerId) } catch { /* capture already gone */ }
  }

  return (
    <>
      <canvas
        ref={canvasRef}
        className={`sv3d-ink${armed ? ' is-armed' : ''}${toolArmed ? ` is-${annotation.tool}` : ''}${annotation.stale ? ' is-stale' : ''}`}
        style={{
          width: '100%',
          height: '100%',
          // A pen or an eraser at the pointer (owner 2026-11-12), over either engine.
          cursor: annotation.tool === 'pen' ? penCursor(palette[annotation.ink]) : annotation.tool === 'eraser' ? eraserCursor() : undefined,
        }}
        data-testid={framed ? 'sv3d-ink-framed' : 'sv3d-ink'}
        aria-hidden="true"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
        // A tool up, a right click opens no browser menu over the view.
        onContextMenu={e => {
          if (toolArmed) e.preventDefault()
        }}
      />
      {/*
        While a tool is armed the view takes no drag and no wheel: said on the
        stage, with the way back. The status line is always mounted and filled
        in later, so a screen reader announces it; the button is outside it.
      */}
      <div className={`sv3d-tool-note${armed ? '' : ' is-empty'}`}>
        <span role="status">
          {toolArmed
            ? t(`proteindb:viewer_tool_note_${annotation.tool}`)
            : annotation.eraserDone ? <span className="sr-only">{t('proteindb:viewer_tool_returned')}</span> : null}
        </span>
        {armed && (
          <button ref={backRef} type="button" className="sv3d-chip" onClick={putAway}>
            {t('proteindb:viewer_tool_back')}
          </button>
        )}
      </div>
      {laser && !toolArmed && (
        <span
          className="sv3d-laser"
          data-testid="sv3d-laser"
          aria-hidden="true"
          style={{ left: laser.x, top: laser.y }}
        />
      )}
      {annotation.stale && annotation.strokes.length > 0 && (
        <div className="sv3d-stale-note" role="status">
          <span>{t('proteindb:viewer_ink_stale')}</span>
          <button type="button" className="sv3d-chip" onClick={annotation.clearStrokes}>
            {t('proteindb:viewer_ink_clear')}
          </button>
        </div>
      )}
    </>
  )
}

export type { InkKey }
