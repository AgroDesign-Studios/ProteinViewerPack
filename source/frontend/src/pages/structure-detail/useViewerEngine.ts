import { useCallback, useRef, useState } from 'react'

export type ViewerEngine = '3dmol' | 'pymol' | 'coot'

/** Per tab and per structure (owner 2026-11-09): a reload or Back returns to PyMOL in this tab only. */
export function viewerEngineKey(structureId: number): string {
  return `agdb.proteindb.viewerEngine.${structureId}`
}

function readStored(structureId: number): ViewerEngine {
  try {
    const stored = window.sessionStorage.getItem(viewerEngineKey(structureId))
    return stored === 'pymol' || stored === 'coot' ? stored : '3dmol'
  } catch {
    // Storage blocked (a private window, a sandbox): start on 3Dmol.
    return '3dmol'
  }
}

function store(structureId: number, engine: ViewerEngine): void {
  try {
    window.sessionStorage.setItem(viewerEngineKey(structureId), engine)
  } catch {
    // Not remembered; the choice still holds in this page.
  }
}

export interface ViewerEngineState {
  structureId: number
  engine: ViewerEngine
  /** PyMOL has been started for this structure (and is kept, hidden, while 3Dmol shows). */
  started: boolean
  /** The camera PyMOL was started with (18 numbers), or null for PyMOL's own. */
  camera: readonly number[] | null
  /**
   * PyMOL has been on screen since it started. False after a background
   * preload (`preload()`), so the first pick of PyMOL knows to bring the
   * 3Dmol view of that moment over (the panel started with no camera).
   */
  shown: boolean
  /**
   * The third engine's panel is mounted for this structure (and kept,
   * hidden, while another engine shows). Kept apart from PyMOL's state: it
   * is never preloaded.
   */
  cootStarted: boolean
}

function initial(structureId: number): ViewerEngineState {
  const engine = readStored(structureId)
  // A stored PyMOL choice starts PyMOL again: that is what the user left on.
  // A stored choice of the third engine opens its panel again.
  return { structureId, engine, started: engine === 'pymol', camera: null, shown: engine === 'pymol', cootStarted: engine === 'coot' }
}

/**
 * Which engine the 3D view shows, and whether its PyMOL runs.
 *
 * The page starts PyMOL in the background once 3Dmol has drawn (`preload()`,
 * owner 2026-11-10: the default stays 3Dmol.js, PyMOL loads behind it), or the
 * first time the user picks it; going back to 3Dmol keeps it running,
 * hidden. `stop()` ends it. The choice is
 * remembered in `sessionStorage` per structure. Another structure id under
 * the same page (7, then 8) keeps the page mounted: the state is re-read for 8 in the same render, so PyMOL 7
 * is never shown for 8 and 8 starts on its own stored choice.
 *
 * `captureCamera` is read when PyMOL is first started: the 3Dmol view on
 * screen then becomes PyMOL's first camera.
 */
export function useViewerEngine(structureId: number, captureCamera: () => number[] | null) {
  const [state, setState] = useState<ViewerEngineState>(() => initial(structureId))
  let current = state
  // Object.is: a malformed `:id` is NaN, which `!==` would call a change on every render.
  if (!Object.is(state.structureId, structureId)) {
    // Another structure under the same page: its own stored choice, now.
    current = initial(structureId)
    setState(current)
  }
  const currentRef = useRef(current)
  currentRef.current = current
  const captureRef = useRef(captureCamera)
  captureRef.current = captureCamera

  const commit = useCallback((next: ViewerEngineState) => {
    currentRef.current = next
    setState(next)
    store(next.structureId, next.engine)
  }, [])

  /** Show `engine`; picking PyMOL the first time starts it at `opts.camera` (default: the 3Dmol view now). */
  const choose = useCallback(
    (engine: ViewerEngine, opts?: { camera?: readonly number[] | null }) => {
      const prev = currentRef.current
      if (engine === 'coot') {
        // Mounted on the first pick (its start panel), kept after.
        if (prev.engine !== 'coot' || !prev.cootStarted) commit({ ...prev, engine, cootStarted: true })
        return
      }
      if (engine === 'pymol' && prev.started && !prev.shown) {
        // Preloaded and never shown: the caller brings the 3Dmol view over.
        commit({ ...prev, engine, shown: true })
        return
      }
      if (engine === 'pymol' && !prev.started) {
        let camera: readonly number[] | null = null
        if (opts?.camera !== undefined) camera = opts.camera
        else {
          try {
            camera = captureRef.current()
          } catch {
            camera = null
          }
        }
        commit({ ...prev, engine, started: true, camera, shown: true })
        return
      }
      if (prev.engine !== engine) commit({ ...prev, engine })
    },
    [commit],
  )

  /** Start PyMOL behind 3Dmol, with no camera of its own (`shown` stays false). */
  const preload = useCallback(() => {
    const prev = currentRef.current
    if (prev.started) return
    // Not stored: a reload starts on the user's own choice, not on a preload.
    currentRef.current = { ...prev, started: true, camera: null, shown: false }
    setState(currentRef.current)
  }, [])

  /** End PyMOL (the panel unmounts) and show 3Dmol. */
  const stop = useCallback(() => {
    commit({ ...currentRef.current, engine: '3dmol', started: false, camera: null, shown: false })
  }, [commit])

  /** End the third engine (its panel unmounts, the frame with it) and show 3Dmol. */
  const stopCoot = useCallback(() => {
    commit({ ...currentRef.current, engine: '3dmol', cootStarted: false })
  }, [commit])

  return { ...current, choose, preload, stop, stopCoot }
}
