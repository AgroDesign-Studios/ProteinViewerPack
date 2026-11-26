import { useCallback, useEffect, useRef, useState } from 'react'

import {
  DEPTH_CUE_DEFAULT,
  applyDepthCue,
  applyProjection,
  assertsSlab,
  capFillFor,
  capOpacityFor,
  measureSpan,
  orthoFor,
  type DepthCue,
  type SlabCapableViewer,
} from './depthCue'
import { installOrthoFraming } from './orthoFraming'
import { SURFACE_TRANSLUCENT_OPACITY, type SurfaceHandle } from './sceneStyles'
import { createSectionCap, type SectionCapController } from './sectionCap'

interface Options {
  /** The live 3Dmol instance, or null between a teardown and the next build. */
  viewerInstanceRef: { current: SlabCapableViewer | null }
  /** Bumped whenever a NEW instance exists, so the settings can be re-asserted. */
  viewerEpoch: number
  /**
   * The built protein surface, or null when the page is not drawing one.
   *
   * The cross-section cap is geometry cut from THIS mesh, so it can only exist
   * while the mesh does. Callers get the handle from `applySceneStyles`'s
   * `onSurface` option, which fires with null on every rebuild and with a FRESH
   * handle once a mesh is ready. Pass the handle through unchanged — its
   * identity is what tells the cap that a build finished, because 3Dmol recycles
   * the id underneath it.
   */
  surface?: SurfaceHandle | null
  /**
   * Whether that surface is drawn opaque.
   *
   * The cap follows it rather than forcing it: the owner's ruling (2026-08-27)
   * was that opacity stays the user's choice, and the viewers
   * deliberately leave the surface translucent so a focused ligand inside it
   * stays visible.
   *
   * Following is now the DEFAULT rather than the only behaviour — `capOpacity`
   * overrides it. This is still the value an unset override resolves against, so
   * it is as load-bearing as it ever was.
   */
  surfaceOpaque?: boolean
  /**
   * A density map is on screen — what the projection follows while the user has
   * not set it by hand (`DepthCue.ortho`, `orthoFor`). Omitted by a viewer that
   * never shows density, which then always rests in perspective.
   *
   * Pass the state of the SCENE (a contour actually drawn), not of a request: a
   * map that failed to load must not leave the view orthographic.
   */
  densityShown?: boolean
}

export interface DepthCueController {
  /** What the toolbar shows and what the canvas is rendering, live. */
  cue: DepthCue
  setCue: (next: DepthCue) => void
  /**
   * The last COMMITTED settings — what belongs in the persisted viewer-state
   * blob. Advances when a gesture ends, never per drag frame; see `commit`.
   */
  persistedCue: DepthCue
  /** End of a gesture: the live value becomes the persisted one. */
  commit: (next: DepthCue) => void
  /** A gesture the system aborted: drop the live value, keep the committed one. */
  cancelGesture: () => void
  /** The molecule's depth in angstroms, or null until it has been measured. */
  spanA: number | null
  /** Re-assert the settings after a camera call that re-framed the scene. */
  applyAfterCamera: (viewer: SlabCapableViewer | null) => void
  /**
   * Re-assert ALL the settings — slab, fog and projection — whatever they are.
   *
   * For a jump of the view that is not a camera call of ours: a stored
   * view's `setView`. The settings effect re-applies only when one of the
   * five slab/fog fields changes, so committing a restored cue equal to the
   * current one writes nothing — and after a ligand focus (`zoomTo(sel)` leaves
   * 3Dmol's TIGHT slab) the restored full view would render as a thin slice
   * round the rotation centre. Unlike `applyAfterCamera` this writes the resting
   * window too, which is the point: the saved view was drawn with it.
   */
  reassert: (viewer: SlabCapableViewer | null) => void
  /** Leaving a structure: the next one starts from the defaults. */
  resetForStructureChange: () => void
  /** The viewer was torn down: the measured depth belonged to the old model. */
  onViewerCleared: () => void
}

/**
 * Depth cue + cross-section state for a viewer page.
 *
 * Extracted because both viewer pages need the identical ~30 lines and neither
 * may import the other (`vibe-coding-best-practices.md` §15.2). Per §15.8 the
 * hook owns its own state rather than taking the pages' setters: the pages pass
 * only the viewer handle and the epoch, and get back a controller.
 *
 * Three things live here that a page cannot get right by accident:
 *
 * 1. **The live callback is reachable from deferred callers.** `applyAfterCamera`
 *    reads a ref, so a listener registered several renders ago cannot apply the
 *    settings as they were then — that would write stale settings over a
 *    user's cross-section while the chips still read pressed (#1623).
 * 2. **The measured span is cached, but a FAILED measurement is not.**
 *    `measureSpan` walks every atom, so it must not run per drag frame; but it
 *    returns null for a model it cannot measure, and caching that would leave
 *    every readout describing a 5 A molecule for the life of the viewer.
 * 3. **Persistence is release-committed.** `cue` changes on every pointer move
 *    (the canvas has to follow the slider); `persistedCue` changes when the
 *    gesture ends. The viewer-state blob is a whole-object `JSON.stringify` +
 *    `localStorage.setItem`, which is not a per-frame cost — the same reason
 *    other sliders commit on release (`sliderRelease.ts`).
 *
 * The projection is written on its own path, separately from the slab and fog:
 * a density map appearing, or the projection chip, must not rewrite the slab —
 * at rest that would replace a ligand focus's tight slab with the resting one.
 */
export function useDepthCue(
  { viewerInstanceRef, viewerEpoch, surface, surfaceOpaque, densityShown = false }: Options,
): DepthCueController {
  const [cue, setCue] = useState<DepthCue>(DEPTH_CUE_DEFAULT)
  const [persistedCue, setPersistedCue] = useState<DepthCue>(DEPTH_CUE_DEFAULT)
  const [spanA, setSpanA] = useState<number | null>(null)
  // The same number, readable synchronously: the apply path runs inside camera
  // callbacks that fire before a state update has flushed.
  const spanRef = useRef<number | null>(null)

  // Before anything below writes a projection: the very first `setProjection`
  // should already be framed (`orthoFraming.ts`). Once per instance — a rebuilt
  // viewer is a new object and needs its own.
  useEffect(() => {
    installOrthoFraming(viewerInstanceRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- viewerInstanceRef is a ref
  }, [viewerEpoch])

  const apply = useCallback((
    v: SlabCapableViewer | null,
    opts: { afterCameraMove?: boolean } = {},
  ) => {
    if (!v) return
    // Here as well as in the epoch effect above: a page may call this for a new
    // instance before it bumps the epoch, and an unframed first orthographic write
    // would draw one shrunken frame. Idempotent per instance.
    installOrthoFraming(v)
    // Decided BEFORE measuring: `measureSpan` calls 3Dmol's `fitSlab({})`,
    // which clobbers the slab the camera call just set. Measuring for a call
    // that is then a no-op would leave the tight window behind and return
    // without restoring anything.
    if (opts.afterCameraMove && !assertsSlab(cue)) return
    try {
      let span = spanRef.current
      if (span == null) {
        span = measureSpan(v)
        // Cache only a real measurement (see the hook docstring). A null means
        // "ask again", so the next call re-measures instead of pinning the
        // floor for the life of the viewer.
        if (span != null) {
          spanRef.current = span
          setSpanA(span)
        }
      }
      // `slabForDepthCue` / `depthWindowA` apply the floor themselves, so a
      // still-unmeasured span renders conservatively rather than not at all.
      applyDepthCue(v, cue, span ?? Number.NaN, { ...opts, densityShown })
    } catch (err) {
      // Never fatal: these settings are an overlay on a view that already
      // rendered, so a failure must leave that view standing rather than take
      // the page down from inside a slider drag.
      console.error('Depth cue could not be applied:', err)
    }
  }, [cue, densityShown])

  // The LIVE `apply`, for callers that run later than the render that created
  // them — see point 1 in the hook docstring.
  const applyRef = useRef(apply)
  useEffect(() => { applyRef.current = apply }, [apply])

  useEffect(() => {
    // Through the ref, which the effect above has already brought up to date:
    // `apply` changes with the projection too, and re-running THIS for a
    // projection change would rewrite the slab (see the hook docstring).
    applyRef.current(viewerInstanceRef.current)
    // `viewerEpoch` as well as the fields: the settings live in React and the
    // slab lives in a 3Dmol instance that is thrown away and rebuilt on every
    // structure switch, so the new instance has to be told again. The fields
    // are exactly the ones `slabForDepthCue` / `fogForDepthCue` read; the cut
    // face's own settings go to `sectionCap` below and never reach the slab.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- viewerInstanceRef is a ref
  }, [cue.fog, cue.fogStrength, cue.slab, cue.cut, cue.thickness, viewerEpoch])

  // The projection on its own: the chip, or a density map appearing or going
  // away. `applyProjection` writes nothing else, so a ligand focus keeps the
  // tight slab its `zoomTo` left.
  const ortho = orthoFor(cue, densityShown)
  useEffect(() => {
    const v = viewerInstanceRef.current
    if (!v) return
    try {
      applyProjection(v, ortho)
    } catch (err) {
      console.error('Projection could not be applied:', err)
    }
    // NOT `viewerEpoch`: a new instance is told the projection by the full
    // re-apply above, which runs on every epoch and writes it too — listing the
    // epoch here only repeated that `setProjection` + `render` once per viewer.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- viewerInstanceRef is a ref
  }, [ortho])

  const applyAfterCamera = useCallback((v: SlabCapableViewer | null) => {
    applyRef.current(v, { afterCameraMove: true })
  }, [])

  const reassert = useCallback((v: SlabCapableViewer | null) => {
    applyRef.current(v)
  }, [])

  // ── the filled cut face ─────────────────────────────────────────────────
  // One controller per viewer instance. It subscribes to the viewer's own
  // view-change hook, so a rotate or a zoom rebuilds the cap without this hook
  // hearing about it — which is also why nothing here re-renders per frame.
  const capRef = useRef<SectionCapController | null>(null)
  useEffect(() => {
    const v = viewerInstanceRef.current
    if (!v) return
    const controller = createSectionCap(v)
    capRef.current = controller
    return () => {
      controller.dispose()
      capRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- viewerInstanceRef is a ref
  }, [viewerEpoch])

  useEffect(() => {
    capRef.current?.update({
      surface: surface ?? null,
      // A cap only means anything over a cut: with the cross-section off the
      // slab is permissive and there is no cut face to fill.
      enabled: cue.slab && cue.cap,
      // Resolved HERE, because this is the only place that holds both halves:
      // the surface's opacity, which the cut face followed unconditionally until
      // it got a setting of its own, and the cue's optional override. Passing the
      // resolved number keeps `sectionCap` free of the notion that "follow" is a
      // state at all — see `SectionCapState.opacity`.
      opacity: capOpacityFor(cue, (surfaceOpaque ?? false) ? 1 : SURFACE_TRANSLUCENT_OPACITY),
      // Resolved, like the opacity above: the near floor the cut plane has to
      // reproduce depends on the projection actually drawn.
      ortho,
      // The CHOICE, not a resolved colour: a preset is a `--sv3d-cap-*` custom
      // property, and only the cap controller holds the element to resolve it
      // against.
      color: capFillFor(cue),
    })
    // `viewerEpoch` so a rebuilt viewer is told again — the effect above will
    // have replaced the controller with a fresh, empty one.
    // `capCustomColor` as well as `capColor`: while the picker is the active
    // choice, every value it emits changes the fill without changing which of
    // the two sources is being read.
    // `capOpacity` for the same reason on the other axis — and `surfaceOpaque`
    // stays in the list because it is still what a null `capOpacity` resolves
    // against, so flipping the surface's own chip must re-assert the cut face.
  }, [
    surface, surfaceOpaque, cue.slab, cue.cap, ortho,
    cue.capColor, cue.capCustomColor, cue.capOpacity, viewerEpoch,
  ])

  // The committed cue, readable synchronously by a `cancelGesture` captured
  // renders ago. The bar's picker cleanup calls the copy from the last render
  // it drew, and on a structure switch that runs AFTER
  // `resetForStructureChange` in the same flush — reading state there would
  // write the previous structure's cue over the reset (PT-4272). Written only
  // beside `setPersistedCue`, so the two cannot disagree.
  const persistedRef = useRef<DepthCue>(DEPTH_CUE_DEFAULT)

  const commit = useCallback((next: DepthCue) => {
    persistedRef.current = next
    setCue(next)
    setPersistedCue(next)
  }, [])

  const cancelGesture = useCallback(() => {
    // The gesture never completed, so the committed value is the truth — and
    // the canvas follows `cue`, so this is also what puts the picture back.
    const settled = persistedRef.current
    setCue(prev => (prev === settled ? prev : settled))
  }, [])

  const resetForStructureChange = useCallback(() => {
    persistedRef.current = DEPTH_CUE_DEFAULT
    setCue(DEPTH_CUE_DEFAULT)
    setPersistedCue(DEPTH_CUE_DEFAULT)
  }, [])

  const onViewerCleared = useCallback(() => {
    spanRef.current = null
    setSpanA(null)
  }, [])

  return {
    cue,
    setCue,
    persistedCue,
    commit,
    cancelGesture,
    spanA,
    applyAfterCamera,
    reassert,
    resetForStructureChange,
    onViewerCleared,
  }
}
