/**
 * 3Dmol.js's VRML of the live view, with the live view kept whole after it
 * (PT-9125 items 3, 4; PT-9126 item 1).
 *
 * `GLViewer.exportVRML()` (3Dmol.js 2.5.5, `build/3Dmol.es6.js` 25009-25018)
 * swaps `modelGroup` for a throwaway `Object3D` and renders the whole scene
 * into it with `regen`. That render re-points state at the throwaway group:
 * every surface's `lastGL`, every shape's `renderedShapeObj`, and the label
 * sprites move into it. Only the models are cleaned up afterwards. Left so,
 * a later `removeSurface` / `removeShape` misses the live meshes (they stay
 * drawn for good) and the labels vanish. And if the export throws, nothing
 * is put back at all: `modelGroup` stays the throwaway, which is attached to
 * nothing, and the pane is blank for the rest of the session.
 *
 * So: note what the scene points at before the call, put it back in a
 * `finally` (the group too), then render once with `regen`, which rebuilds
 * models, surfaces, shapes and labels into the live group from those
 * pointers — the same regeneration the export itself runs.
 *
 * These are 3Dmol.js internals, read defensively: a field that is missing
 * (another version) is skipped, and the closing render still runs.
 */

/** The VRML of a 3Dmol viewer, the one model export 3Dmol.js has that keeps what is shown. */
export interface VrmlSource {
  exportVRML: () => string
  render: () => void
}

interface SurfaceEntry { lastGL?: unknown }
interface ShapeEntry { renderedShapeObj?: unknown }
interface ViewerInternals {
  modelGroup?: unknown
  surfaces?: Record<string, ArrayLike<SurfaceEntry | undefined> | undefined>
  shapes?: ArrayLike<ShapeEntry | null | undefined>
  renderer?: { supportedExtensions?: () => Record<string, unknown> }
  render: (callback?: unknown, exts?: Record<string, unknown>) => void
}

function surfaceEntries(v: ViewerInternals): SurfaceEntry[] {
  const out: SurfaceEntry[] = []
  for (const key of Object.keys(v.surfaces ?? {})) {
    const list = v.surfaces?.[key]
    if (!list) continue
    for (let i = 0; i < list.length; i++) {
      const e = list[i]
      if (e && typeof e === 'object') out.push(e)
    }
  }
  return out
}

function shapeEntries(v: ViewerInternals): ShapeEntry[] {
  const out: ShapeEntry[] = []
  const list = v.shapes
  if (!list) return out
  for (let i = 0; i < list.length; i++) {
    const e = list[i]
    if (e && typeof e === 'object') out.push(e)
  }
  return out
}

/** The VRML text; the live view is drawn again, whole, whether the export worked or threw. */
export function exportVrmlKeepingScene(source: VrmlSource): string {
  const v = source as unknown as ViewerInternals
  const group = v.modelGroup
  const surfaces = surfaceEntries(v).map(e => [e, e.lastGL] as const)
  const shapes = shapeEntries(v).map(e => [e, e.renderedShapeObj] as const)
  try {
    return source.exportVRML()
  } finally {
    if ('modelGroup' in v) v.modelGroup = group
    for (const [e, gl] of surfaces) e.lastGL = gl
    for (const [e, obj] of shapes) e.renderedShapeObj = obj
    let exts: Record<string, unknown> | undefined
    try {
      exts = v.renderer?.supportedExtensions?.()
    } catch {
      exts = undefined
    }
    v.render(undefined, { ...(exts ?? {}), regen: true })
  }
}
