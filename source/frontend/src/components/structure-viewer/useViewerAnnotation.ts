import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { InkKey, Stroke } from './annotationModel'

/**
 * Tool armed on the annotation overlay. `none` is the resting state, in which
 * the overlay is pointer-transparent and 3Dmol owns every gesture.
 */
export type AnnotationTool = 'none' | 'pen' | 'eraser'

/**
 * What the pointer looks like over the stage. `laser` hides the native cursor
 * and draws a red dot instead — 3Dmol never touches `style.cursor`, so this
 * cannot collide with it.
 */
export type CursorMode = 'default' | 'laser' | 'crosshair'

export interface ViewerAnnotation {
  tool: AnnotationTool
  setTool: (t: AnnotationTool) => void
  ink: InkKey
  setInk: (k: InkKey) => void
  cursorMode: CursorMode
  setCursorMode: (m: CursorMode) => void
  strokes: Stroke[]
  /** True once the camera moved after a stroke was drawn: the ink no longer lines up. */
  stale: boolean
  /**
   * Commit one finished stroke.
   *
   * A stroke is added whole, not point by point: growing it through state would
   * copy the stroke array and the points array on every pointermove and re-run
   * the full repaint, which is quadratic in the stroke's length (a 500-point
   * stroke costs ~125k point copies and ~125k redundant lineTo calls). The layer
   * keeps the in-progress stroke in a ref and draws it incrementally instead.
   */
  addStroke: (ink: InkKey, points: { x: number; y: number }[]) => void
  eraseStroke: (id: number) => void
  clearStrokes: () => void
  /** Called from the viewer whenever the camera changes (spin, rotate, restore). */
  markStale: () => void
  /**
   * Lifts the mark once the lines that were out of register are gone (erased),
   * and every line left was drawn at the camera on screen.
   */
  clearStale: () => void
  /**
   * True from the moment the eraser put itself away (its last line is gone)
   * until the next tool choice: the layer says so for screen readers.
   */
  eraserDone: boolean
}

/**
 * Owns the freehand annotation + pointer state for one 3D viewer stage.
 *
 * Strokes live in React state (normalised 0..1) rather than in the canvas pixel
 * buffer, because every resize clears the buffer and the stage is resized by the
 * page layout and by 3Dmol's own resize path.
 */
export function useViewerAnnotation(initial?: { ink?: InkKey; cursorMode?: CursorMode }): ViewerAnnotation {
  const [tool, setToolState] = useState<AnnotationTool>('none')
  const [ink, setInk] = useState<InkKey>(initial?.ink ?? 'red')
  const [cursorMode, setCursorMode] = useState<CursorMode>(initial?.cursorMode ?? 'default')
  const [strokes, setStrokes] = useState<Stroke[]>([])
  const [stale, setStale] = useState(false)
  const nextIdRef = useRef(1)

  const [eraserDone, setEraserDone] = useState(false)

  const setTool = useCallback((t: AnnotationTool) => {
    setEraserDone(false)
    setToolState(prev => (prev === t ? 'none' : t))
  }, [])

  // Mirrored into a ref so markStale can stay a stable, dependency-free callback
  // that the camera listener does not have to re-bind on every stroke.
  //
  // It is updated EAGERLY by the mutators below, not only by the reconciling
  // effect: a child component's effect runs before its parent's, so a consumer
  // reacting to a just-committed stroke would call markStale while the effect
  // still had the old count and the call would silently do nothing.
  const strokeCountRef = useRef(0)

  const addStroke = useCallback((strokeInk: InkKey, points: { x: number; y: number }[]) => {
    if (points.length === 0) return
    const id = nextIdRef.current++
    // A fresh stroke is drawn against the current camera, so the whole layer is
    // in register again — even if an older stroke had gone stale, the user has
    // just re-annotated for this view.
    setStale(false)
    strokeCountRef.current += 1
    setStrokes(prev => [...prev, { id, ink: strokeInk, points }])
  }, [])

  const eraseStroke = useCallback((id: number) => {
    strokeCountRef.current = Math.max(0, strokeCountRef.current - 1)
    setStrokes(prev => prev.filter(s => s.id !== id))
  }, [])

  const clearStrokes = useCallback(() => {
    strokeCountRef.current = 0
    setStrokes([])
    setStale(false)
  }, [])

  // Reconcile: the eager updates above are optimistic, this is the authority.
  useEffect(() => { strokeCountRef.current = strokes.length }, [strokes])

  // The eraser puts itself away once the last line is gone (erased or
  // cleared). An armed tool takes every drag and wheel turn from the viewer,
  // and an eraser with nothing left to erase answers none of them: the view
  // looked frozen until the page was left (owner 2026-11-11). Judged from the
  // real count going from some to none, never from the optimistic ref.
  const hadStrokesRef = useRef(false)
  useEffect(() => {
    const had = hadStrokesRef.current
    hadStrokesRef.current = strokes.length > 0
    if (had && strokes.length === 0 && tool === 'eraser') {
      setToolState('none')
      setEraserDone(true)
    }
  }, [strokes.length, tool])

  const markStale = useCallback(() => {
    // Only meaningful while there is ink on screen; avoids a pointless re-render
    // on every camera nudge of a clean viewer.
    if (strokeCountRef.current > 0) setStale(true)
  }, [])
  const clearStale = useCallback(() => setStale(false), [])

  return useMemo(
    () => ({
      tool, setTool, ink, setInk, cursorMode, setCursorMode,
      strokes, stale, addStroke, eraseStroke, clearStrokes, markStale, clearStale, eraserDone,
    }),
    [tool, setTool, ink, cursorMode, strokes, stale, addStroke, eraseStroke, clearStrokes, markStale, clearStale, eraserDone],
  )
}
