/**
 * The 3Dmol side of the filled cross-section: where the cut plane is, and how
 * the cap becomes a shape in the scene.
 *
 * The geometry itself is in `capGeometry.ts`, which imports nothing. This file
 * is the only place that knows about a viewer, and every call it makes is
 * public and typed in `3dmol/build/types/GLViewer.d.ts` — `getSurface`,
 * `getView`, `getSlab`, `getPerceivedDistance`, `addCustom`, `removeShape`,
 * `container`. Nothing here is patched, wrapped or reached into.
 */

import {
  COARSE_GRID_VOLUME_A3,
  DEFAULT_MAX_STITCH_A,
  buildCapMesh,
  weldSurfaceMesh,
  type SurfaceGeometryGroup,
  type Vec3,
  type WeldedMesh,
} from './capGeometry'
import { CAP_COLOR_DEFAULT, isCapColorPreset, isCustomCapColor } from './depthCue'
import { SURFACE_TRANSLUCENT_OPACITY, type SurfaceHandle } from './sceneStyles'
import { pinBoundingSphereToBox } from './shapeBoundingSphere'
import { subscribeViewChange } from './viewChangeMux'

/**
 * Consecutive failed builds after which the cap gives up on a surface.
 *
 * Small on purpose. Above one so a single transient throw — one lost frame
 * during a context restore — does not cost the user their cut face; small
 * enough that a genuinely broken viewer stops re-welding a 420k-vertex mesh
 * within a few frames of a drag rather than for its whole duration.
 *
 * Exported for the test that pins the bound, so the two cannot drift.
 */
export const MAX_CAP_BUILD_FAILURES = 3

/** The plane the near clipping plane cuts, in MODEL coordinates. */
export interface CutPlane {
  /** Unit normal, pointing at the camera. */
  normal: Vec3
  /** The kept half-space is `dot(p, normal) <= offset`. */
  offset: number
}

/**
 * Derive the near clipping plane from a viewer's own numbers.
 *
 * Kept as a pure function of three readings so it can be tested in both of the
 * regimes below without a viewer.
 *
 * 3Dmol holds the molecule still and rotates a group around it, so the world
 * plane `z = const` becomes, in model space, a plane whose normal is the third
 * row of the rotation matrix. From `GLViewer.setSlabAndFog`:
 *
 *     center      = CAMERA_Z - rotationGroup.z        (== getPerceivedDistance())
 *     camera.near = center + slabNear,  floored at 1 in PERSPECTIVE
 *     camera.far  = center + slabFar,   floored at camera.near + 1
 *
 * a vertex survives while `world.z <= CAMERA_Z - camera.near`, and
 * `world.z = (R * (p + modelGroup.position)).z + rotationGroup.z`, so the plane
 * constant is `center - camera.near` less the model-group offset along the
 * normal.
 *
 * **Reproducing the near floor is not optional.** While it is inactive the
 * `center` terms cancel and the constant is simply `-slabNear`, so the zoom does
 * not move the cut. The moment `center + slabNear` drops below 1 the floor bites
 * and the cut plane starts sliding through the molecule as the user zooms —
 * measured at 4.7 A of drift at 8x zoom and 12.6 A at 14x on a small protein,
 * with the shell really cut where a `getSlab()`-only derivation says nothing
 * should be. A cap built from the wrong constant is not subtly off; it is
 * somewhere else entirely, or absent.
 */
export function cutPlaneFrom(
  view: readonly number[],
  slab: { near: number; far: number },
  perceivedDistance: number,
  ortho: boolean,
): CutPlane | null {
  if (view.length < 8) return null
  const [mx, my, mz, , qx, qy, qz, qw] = view
  if (![mx, my, mz, qx, qy, qz, qw, perceivedDistance, slab.near].every(Number.isFinite)) {
    return null
  }
  // Third row of the rotation matrix for this quaternion, matching 3Dmol's own
  // `Matrix4.setRotationFromQuaternion` term for term.
  let nx = 2 * (qx * qz - qw * qy)
  let ny = 2 * (qy * qz + qw * qx)
  let nz = 1 - 2 * (qx * qx + qy * qy)
  // 3Dmol keeps the quaternion normalised, but the plane constant is measured
  // along this vector, so a drifted length would scale every distance.
  const length = Math.hypot(nx, ny, nz)
  if (!(length > 0)) return null
  nx /= length
  ny /= length
  nz /= length

  // TWO floors, not one. `setSlabAndFog` clamps the centre distance itself
  // before deriving anything from it (GLViewer.ts:331) and then clamps
  // camera.near again (:334). Both bite when a saved view puts the camera closer
  // than one unit — `setView` writes rotationGroup.position.z straight from a
  // user-writable blob.
  //
  // ⚠️ The clamped centre is used ONLY to derive `camera.near`. Converting that
  // back to model space uses the UNCLAMPED distance, because the camera itself
  // never moved: the near plane sits at world z = CAMERA_Z - camera.near, and
  // subtracting the rotation group's own z leaves (CAMERA_Z - rgz) - near, where
  // the first term is `getPerceivedDistance()` exactly as reported. Using the
  // clamped value on both sides — as this did at first — silently offsets the
  // cap from the plane the renderer actually cuts at.
  let center = perceivedDistance
  if (center < 1) center = 1
  let near = center + slab.near
  if (!ortho && near < 1) near = 1
  const offset = perceivedDistance - near - (mx * nx + my * ny + mz * nz)
  if (!Number.isFinite(offset)) return null
  return { normal: { x: nx, y: ny, z: nz }, offset }
}

/** One vertex as 3Dmol's `addCustom` wants it. */
interface XYZ {
  x: number
  y: number
  z: number
}

/** A 3Dmol surface entry, narrowed to the mesh capping reads. */
interface SurfaceEntry {
  geo?: { geometryGroups?: SurfaceGeometryGroup[] | null } | null
}

/**
 * The 3Dmol surface this module drives.
 *
 * Structural, so a rename in a future 3Dmol fails at `tsc` here rather than at
 * runtime inside a drag — the same reason `depthCue.ts` types its own five
 * methods instead of taking `any`.
 */
export interface CapCapableViewer {
  getSurface(surfid: number): SurfaceEntry[] | null | undefined
  getView(): number[]
  getSlab(): { near: number; far: number }
  getPerceivedDistance(): number
  addCustom(spec: {
    vertexArr: XYZ[]
    normalArr: XYZ[]
    faceArr: number[]
    color: string
    opacity: number
  }): unknown
  removeShape(shape: unknown): unknown
  render(): void
  container?: HTMLElement | null
}

/**
 * Does this object actually have the methods above?
 *
 * The viewer is `any` at every AgDB call site (3Dmol publishes no types for the
 * instance), and the test doubles the depth-cue suites use implement only the
 * five slab methods. Probing rather than casting means those doubles get no cap
 * instead of a TypeError, while a real viewer that lost a method says so once in
 * the console rather than failing silently every frame.
 */
export function isCapCapable(viewer: unknown): viewer is CapCapableViewer {
  if (typeof viewer !== 'object' || viewer === null) return false
  const v = viewer as Record<string, unknown>
  return (
    typeof v.getSurface === 'function' &&
    typeof v.getView === 'function' &&
    typeof v.getSlab === 'function' &&
    typeof v.getPerceivedDistance === 'function' &&
    typeof v.addCustom === 'function' &&
    typeof v.removeShape === 'function' &&
    typeof v.render === 'function'
  )
}

/**
 * Fallback fill for the cut face when the custom property does not resolve
 * (jsdom, or before the stylesheet applies). A CSS colour keyword, never a hex
 * literal here — same rule the ink palette follows (DESIGN.md §6.2.1).
 */
const CAP_FALLBACK_COLOR = 'lightgray'

/**
 * The literal colour to hand 3Dmol for a chosen fill.
 *
 * A colour the user mixed is already a literal and is passed through. A preset
 * names its own `--sv3d-cap-*` custom property, which is where the value lives
 * so that no hex sits in a `.ts` file (DESIGN.md §6.2.1); when that does not
 * resolve, the preset KEY is used, every one of them being a CSS colour keyword.
 * Anything else — only reachable from a stored blob that got past
 * `sanitizeDepthCue`, or a caller that skipped it — is refused rather than
 * forwarded to `addCustom` unchecked.
 *
 * ⚠️ `gray` is the exception, and keeps `CAP_FALLBACK_COLOR`. Its keyword value
 * is #808080, about half the lightness of the `--gray` token it stands in for,
 * so using the key there would make the unresolved case visibly darker than the
 * fill this feature shipped with. The other five keywords sit close enough to
 * their tokens to need no such carve-out.
 */
function resolveCapColor(container: HTMLElement | null | undefined, choice: string): string {
  if (isCustomCapColor(choice)) return choice
  if (!isCapColorPreset(choice)) return CAP_FALLBACK_COLOR
  const fallback = choice === CAP_COLOR_DEFAULT ? CAP_FALLBACK_COLOR : choice
  if (!container || typeof window.getComputedStyle !== 'function') return fallback
  const value = window.getComputedStyle(container).getPropertyValue(`--sv3d-cap-${choice}`)?.trim()
  return value && value.length > 0 ? value : fallback
}

/**
 * 3Dmol's `GLShape`, narrowed to the single method that repaints one.
 *
 * `GLViewer.addCustom` returns the `GLShape` it created (3Dmol 2.5.4,
 * `build/3Dmol.js:24291-24299`) — the same object `removeShape` is given.
 * `GLShape.updateStyle({color})` merges the spec and calls `updateFromStyle`,
 * which assigns `shape.color` (:20329-20337); `globj` then applies it via
 * `GLShape.updateColor(this.geo, this.color)` (:21057) and is re-run for every
 * shape on every `viewer.render()` (:22884-22890). So the colour the cut face is
 * drawn in is already re-read from the shape on each frame, and writing a new
 * one plus a repaint is the whole job.
 *
 * OPACITY travels the same road, and it is worth stating why rather than
 * assuming the symmetry: `updateFromStyle` clamps `stylespec.opacity` into
 * `shape.opacity` (:20340-20343), and the same per-frame `globj` builds the
 * material from it — `transparent: (this.opacity < 1)`, `opacity: this.opacity`
 * (:21059-21077). So the cut face's transparency is re-read every frame too, and
 * changing it needs **no re-CUT**.
 *
 * ⚠️ "and no re-upload" is what this said until 2026-08-29, and that part was
 * false. `globj` runs for every shape on every `render()` (:22884-22890) and
 * re-enters `finalizeGeo` → `truncateArrayBuffers(true, true)`, which
 * REALLOCATES the vertex/normal/face/colour arrays; it then calls `updateColor`
 * whenever the shape carries a colour — which this one always does — rewriting
 * all 3·V colour floats and setting `colorsNeedUpdate`. Every 3Dmol custom
 * shape pays that each frame whether or not anything changed, so the saving
 * here is the 2.5-7.3 ms cut, not a per-frame upload, and there is no
 * regression against the colour drag that already existed. Do not repeat the
 * stronger claim.
 *
 * ⚠️ Both keys go in ONE spec, and the spec must always carry the colour.
 * `updateStyle` merges into the shape's OWN `stylespec` and then re-derives every
 * field from the merged object — including the `else` branch at :20335, which
 * resolves an absent colour to `CC.color(0)`, i.e. BLACK. The merge is what saves
 * a colour-only call here (the cap's `addCustom` spec set one), but relying on
 * that would make a future refactor that drops the colour from the spec paint a
 * black hole in the surface, silently.
 */
interface RecolourableShape {
  updateStyle(spec: { color: string; opacity: number }): void
}

/**
 * Probed, not cast — same discipline as `isCapCapable` above.
 *
 * A 3Dmol that renamed or dropped `updateStyle` must fall back to rebuilding the
 * cap rather than throwing inside a drag, and the depth-cue suites' doubles
 * return plain objects that have no such method.
 */
function canRecolour(shape: unknown): shape is RecolourableShape {
  return typeof (shape as RecolourableShape | null)?.updateStyle === 'function'
}

/** See `createSectionCap` — the warning is emitted at most once per session. */
let warnedMissingApi = false

/** What the caller wants drawn, re-asserted whenever any of it changes. */
export interface SectionCapState {
  /**
   * The built protein surface to cap, or null when there is none.
   *
   * The HANDLE, not its id: 3Dmol recycles surface ids and a build that is
   * already in flight still reports, so a number cannot distinguish "this mesh
   * finished" from "nothing changed" (see `SurfaceHandle`). Identity can.
   */
  surface: SurfaceHandle | null
  /** Draw the cap at all. False leaves the cut hollow, as before. */
  enabled: boolean
  /**
   * How opaque to draw the cut face, 0..1, ALREADY RESOLVED.
   *
   * A number rather than the surface's boolean, because the cut face now has its
   * own optional setting and the caller is the only place that can decide
   * between the two (`capOpacityFor`). This module just draws what it is given —
   * it must not know that "follow the surface" is even a state, or the fallback
   * would exist in two places that can disagree.
   */
  opacity: number
  /** The projection, because the near floor applies only in perspective. */
  ortho: boolean
  /**
   * The fill to draw the cut face in: a `--sv3d-cap-*` preset key, or a
   * `#rrggbb` the user mixed. Resolved here rather than by the caller because
   * resolving a preset needs the viewer's own element.
   */
  color: string
}

export interface SectionCapController {
  /** Assert new settings and repaint. */
  update(state: SectionCapState): void
  /** Drop the cap and release the view-change subscription. */
  dispose(): void
}

/**
 * How far an isosurface vertex can lie from the nearest atom CENTRE, in angstroms.
 *
 * Three terms, all read off 3Dmol 2.5.4, not estimated:
 *
 * 1. the largest vdW radius in `ProteinSurface4`'s own table — 2.75 A
 *    (`this.vdwRadii`, K at :27344);
 * 2. the probe radius, 1.4 A (`this.probeRadius`, :27318), which `SAS` adds and
 *    this viewer offers (`surfaceType.ts` lists VDW / MS / SAS / SES);
 * 3. ONE grid step of quantisation. `boundingatom` builds its stencil at
 *    `tradius[i] = (r + this.probeRadius) * this.scaleFactor + 0.5` — half a
 *    voxel of slack (:27494) — and `fillAtom` snaps each centre to the nearest
 *    lattice point, `Math.floor(0.5 + this.scaleFactor * (atom.x + this.ptranx))`
 *    (:27535), for another half. On the coarse grid that step is 1.0 A.
 *
 * ⚠️ :27494, NOT :27492. Both are branches of one `if` inside
 * `boundingatom(btype)`: :27492 is `r * scaleFactor + 0.5`, with NO probe term.
 * `initparm` is called with `btype = (type === 1) ? false : true`, so only VDW
 * takes it and MS / SAS / SES take :27494. Landing on the wrong branch invites
 * dropping term 2 — 2.75 + 1.0 = 3.75 — which UNDER-estimates the reach, and
 * under-estimating is the direction that draws material across a real void.
 *
 * Line numbers are for the 2.5.4 bundle and drift on every 3Dmol bump; the
 * quoted expressions are what to grep for.
 *
 * 2.75 + 1.4 + 1.0 = 5.15, rounded up to 5.5.
 *
 * ⚠️ The two error directions are NOT symmetric, and this constant is set for
 * the safe one. It shrinks a mesh box back to the atom box `initparm` judged,
 * so over-estimating it under-estimates that box and pushes the inference
 * towards the FINE grid: a tolerance one step too tight drops rings and leaves
 * the cut hollow, which the user can read. Under-estimating pushes towards the
 * COARSE grid, where a 4.0 A stitch closes a genuine 3 A void and draws
 * material that is not there, which they cannot. So it is deliberately rounded
 * UP, and the cost — a large, THIN structure near the threshold judged fine
 * when it was marched coarsely, losing its cut face to dropped rings — is
 * accepted in exchange.
 *
 * ⚠️ It also read 4.5 for one review round, on 2.75 + 1.4 alone. That is not an
 * upper bound: it omits term 3, which is exactly the unsafe direction.
 */
const SURFACE_REACH_A = 5.5

/**
 * The longest gap the boundary stitch may close for THIS mesh, in angstroms.
 *
 * Computed ONCE per welded mesh and cached with it — it is a constant of the
 * mesh, and this walks every vertex. Calling it per frame, as the first version
 * did, put an O(V) pass over up to 420k vertices inside the drag loop to
 * recompute a number that cannot change.
 *
 * `capGeometry` is pure and cannot see 3Dmol's grid, so the caller supplies it.
 * `ProteinSurface4` halves its resolution once the volume passes 1e6 A^3
 * (`scaleFactor` 2 -> 1, i.e. 0.5 A -> 1.0 A per voxel), and a seam cannot
 * exceed a small multiple of that step — see `DEFAULT_MAX_STITCH_A`.
 *
 * Two things about the volume it judges, both verified against 3Dmol 2.5.4 and
 * both got wrong at least once while this module was under review:
 *
 * 1. It is the box of atom CENTRES (`GLViewer.volume(getExtent(atomsToShow,
 *    true))`), with no radii and no padding — `initparm`'s resolution branch
 *    runs BEFORE `margin` and the probe radius are added to the extent. The
 *    only mesh this module can see is the isosurface, whose box is that box
 *    GROWN by up to `SURFACE_REACH_A` on every side, so the box has to be
 *    shrunk before it is compared. Moving the threshold down instead, as an
 *    earlier round did, corrects in the wrong direction twice over.
 * 2. The shrink is PER AXIS. A scalar volume correction cannot express it: two
 *    boxes of equal volume, one cubic and one long and thin, lose very
 *    different fractions to the same per-side inset, and the thin one loses far
 *    more. A single volume factor therefore misclassifies exactly the elongated
 *    surfaces — fibres, filaments, a stack of chains.
 */
export function stitchToleranceFor(mesh: WeldedMesh): number {
  if (mesh.x.length === 0) return DEFAULT_MAX_STITCH_A
  let minX = Infinity; let minY = Infinity; let minZ = Infinity
  let maxX = -Infinity; let maxY = -Infinity; let maxZ = -Infinity
  for (let i = 0; i < mesh.x.length; i++) {
    if (mesh.x[i] < minX) minX = mesh.x[i]
    if (mesh.x[i] > maxX) maxX = mesh.x[i]
    if (mesh.y[i] < minY) minY = mesh.y[i]
    if (mesh.y[i] > maxY) maxY = mesh.y[i]
    if (mesh.z[i] < minZ) minZ = mesh.z[i]
    if (mesh.z[i] > maxZ) maxZ = mesh.z[i]
  }
  // Back to the atom-centre box 3Dmol actually judged, one axis at a time.
  const ax = Math.max(0, maxX - minX - 2 * SURFACE_REACH_A)
  const ay = Math.max(0, maxY - minY - 2 * SURFACE_REACH_A)
  const az = Math.max(0, maxZ - minZ - 2 * SURFACE_REACH_A)
  const atomVolume = ax * ay * az
  if (!Number.isFinite(atomVolume)) return DEFAULT_MAX_STITCH_A
  // 4 x the voxel step, as derived on DEFAULT_MAX_STITCH_A.
  return atomVolume > COARSE_GRID_VOLUME_A3 ? 4.0 : DEFAULT_MAX_STITCH_A
}

/**
 * Move the cap shape's bounding sphere onto the cap, radius 0.
 *
 * Without it a crystal structure far from the origin was framed out to
 * (0, 0, 0) by Reset View while a cut face was on (PT-1298 item 5). The why,
 * and the move itself, are in `shapeBoundingSphere.ts`; this only finds the
 * cap's box.
 *
 * Exported for its test.
 */
export function centreBoundingSphere(shape: unknown, positions: Float32Array): void {
  if (positions.length < 3) return
  let minX = Infinity; let minY = Infinity; let minZ = Infinity
  let maxX = -Infinity; let maxY = -Infinity; let maxZ = -Infinity
  for (let i = 0; i < positions.length; i += 3) {
    if (positions[i] < minX) minX = positions[i]
    if (positions[i] > maxX) maxX = positions[i]
    if (positions[i + 1] < minY) minY = positions[i + 1]
    if (positions[i + 1] > maxY) maxY = positions[i + 1]
    if (positions[i + 2] < minZ) minZ = positions[i + 2]
    if (positions[i + 2] > maxZ) maxZ = positions[i + 2]
  }
  pinBoundingSphereToBox(shape, [minX, minY, minZ], [maxX, maxY, maxZ])
}

function toXYZ(flat: Float32Array): XYZ[] {
  const out = new Array<XYZ>(flat.length / 3)
  for (let i = 0; i < out.length; i++) {
    out[i] = { x: flat[i * 3], y: flat[i * 3 + 1], z: flat[i * 3 + 2] }
  }
  return out
}

/**
 * Keep a filled cut face in step with the camera.
 *
 * The cut plane is defined in CAMERA space (that is what `setSlab` is), so it
 * sweeps through the molecule as the user rotates and the cap has to be rebuilt
 * per camera change, not per slider drag. ChimeraX has the identical property
 * and rebuilds its caps every frame for the same reason. Measured cost of a
 * rebuild, software-rendered: 2.5 ms on a 173k-triangle surface, 7.3 ms on a
 * 489k-triangle one.
 *
 * Two things keep that affordable and non-recursive:
 *
 * 1. **The welded mesh is built once per surface, lazily.** Welding walks every
 *    vertex (about 50 ms for a median protein), so it happens on the first cap
 *    of a given surface and not on the surface build — a user who never opens
 *    the cross-section never pays it.
 * 2. **A rebuild is skipped when the plane has not moved, and the repaint is
 *    coalesced into one animation frame.** 3Dmol's view-change hook fires AFTER
 *    every render, so a listener that renders re-enters; here the second pass
 *    finds an unchanged plane, does nothing, and the loop stops.
 *
 * The hook firing after the frame is also why a moving cap costs ONE EXTRA
 * `render()` per animation frame: the new cut face cannot reach the frame that
 * revealed the plane it belongs to. Deferring instead — letting the drag's next
 * repaint carry it — was rejected: the cap would trail the shell by a frame,
 * which at an ordinary drag speed shows as a filled face poking outside the
 * silhouette, and the LAST frame of a gesture has no next repaint to fix it.
 * The coalescing bounds the cost at one extra pass per frame however fast
 * pointermove fires.
 */
export function createSectionCap(viewer: unknown): SectionCapController {
  if (!isCapCapable(viewer)) {
    // Once per session, not once per viewer: the depth-cue suites construct
    // dozens of slab-only doubles, and a line per viewer would bury the case
    // this is actually for — a 3Dmol upgrade that renamed one of the seven
    // methods, where the cap would otherwise just stop appearing.
    if (!warnedMissingApi) {
      warnedMissingApi = true
      console.warn('Section cap unavailable: this viewer has no mesh read-back API')
    }
    return { update: () => {}, dispose: () => {} }
  }

  let state: SectionCapState = {
    surface: null,
    enabled: false,
    opacity: SURFACE_TRANSLUCENT_OPACITY,
    ortho: false,
    color: CAP_COLOR_DEFAULT,
  }
  let shape: unknown = null
  let welded: { handle: SurfaceHandle; mesh: WeldedMesh; tolerance: number } | null = null
  let lastKey: string | null = null
  /**
   * The fill `shape` is currently drawn in — colour AND opacity — with the
   * colour held UNRESOLVED (a preset key or a `#rrggbb`), not as the colour it
   * resolves to.
   *
   * Unresolved on purpose: `resolveCapColor` calls `getComputedStyle`, which
   * flushes pending style recalculation for the document, and the branch just
   * below is the one the view-change hook lands on after EVERY repaint. Comparing
   * the choice keeps that hot path free of a per-frame style flush. It is sound
   * because the `--sv3d-cap-*` properties are deliberately not re-declared per
   * theme (`structureViewer.css`), so one
   * choice cannot resolve to two colours in the life of a viewer.
   *
   * Null means "nothing is drawn for the current plane yet", which is why this is
   * a nullable object rather than two loose fields seeded with plausible values:
   * a seeded pair would compare EQUAL to a first assertion that happens to match
   * it, and the cap would never be uploaded at all.
   */
  let lastFill: { color: string; opacity: number } | null = null
  let frame: number | null = null
  let warnedFor: SurfaceHandle | null = null
  let disposed = false

  /**
   * The plane whose build threw, and is therefore not retried.
   *
   * Keyed on the KEY, not on the surface. Latching the surface — as the first
   * version did — meant one transient throw (a lost WebGL context inside
   * `addCustom`, a `getView` during a teardown frame) removed the cut face for
   * the rest of that surface's life, with the chip still reading pressed and no
   * discoverable way back. Keyed on the key, the retry costs one attempt per
   * distinct camera position, which is what breaks the render loop the round-1
   * finding was about: the repaint returns to the SAME plane, and the same plane
   * is what this refuses.
   */
  let failedKey: string | null = null

  /**
   * Consecutive failures, and the breaker they trip.
   *
   * `failedKey` on its own is the OTHER extreme, and it is the one a
   * persistently broken viewer lands in: every distinct camera position is a
   * distinct key, so a lost WebGL context turns one drag into a full weld + cut
   * + upload attempt per frame, each of them throwing. The per-plane latch has
   * to stay — it is what stops the same-plane repaint loop — so the bound sits
   * on top of it: a run of failures with no success in between takes the cap off
   * this surface until something says to try again.
   *
   * "Something says to try again" is deliberately explicit and never a timer: a
   * recovery this cannot observe would only restart the storm. Two signals reset
   * it: a new surface handle (a build finished, so there is a new mesh to read)
   * and the chip going off and on (the user asked).
   *
   * ⛔ A colour change is deliberately NOT one of them. It clears the per-plane
   * `failedKey` latch — that much is a user asking — but re-arming the COUNTER
   * from it would be self-defeating: the colour dialog emits a value per pointer
   * move, so the count could never reach this bound.
   */
  let failures = 0
  let brokenSurface = false

  const clearShape = (): boolean => {
    // Unconditionally, before the early return: `lastKey` is a cache of "the
    // plane the CURRENT shape was built for", so with no shape it is a lie. Left
    // set after a failed upload it made the plane look already-built, and the
    // cap could not come back even once the failure was cleared.
    lastKey = null
    if (shape == null) return false
    try {
      viewer.removeShape(shape)
    } catch (err) {
      console.error('Section cap could not be removed:', err)
    }
    shape = null
    return true
  }

  /**
   * A build that ran to completion, whatever it decided to draw.
   *
   * Every exit that is NOT a throw goes through here, including the ones that
   * draw nothing: an unreadable view, a surface with no mesh yet, a plane that
   * misses the molecule and a cut face the geometry refused are all honest
   * reports, not failures. Passes its argument straight back so it reads as
   * `return endRun(removed)` at the call sites.
   *
   * TWO deliberate exclusions, both above the work: `key === failedKey` is a
   * known failure being refused, and `key === lastKey` is not a run at all —
   * and a non-null `lastKey` is only ever set on a path that reaches here, so
   * the count is already 0 there.
   */
  const endRun = (changed: boolean): boolean => {
    failures = 0
    return changed
  }

  /** The welded mesh for a handle, welded on first use and cached with it. */
  const meshFor = (handle: SurfaceHandle): { mesh: WeldedMesh; tolerance: number } | null => {
    if (welded?.handle === handle) return welded
    // Plain loops, NOT flatMap/filter. `getSurface` returns 3Dmol's `Surface`,
    // which EXTENDS Array with a constructor that spreads its argument, so any
    // array method that species-constructs a new one — flatMap, filter, map,
    // slice — throws `Spread syntax requires ...iterable[Symbol.iterator] to be
    // a function` the first time a cap is built. Found in a real browser; jsdom
    // doubles that return a plain array never reach it.
    const groups: SurfaceGeometryGroup[] = []
    for (const entry of viewer.getSurface(handle.id) ?? []) {
      for (const group of entry?.geo?.geometryGroups ?? []) {
        // `geometryGroups` is over-allocated and `mergeGeos` leaves the array's
        // own counter at zero, so length is not a count; a group with no
        // vertices is simply skipped.
        if (group && (group.vertices | 0) > 0) groups.push(group)
      }
    }
    if (groups.length === 0) return null
    const mesh = weldSurfaceMesh(groups)
    if (mesh.triangles === 0) return null
    welded = { handle, mesh, tolerance: stitchToleranceFor(mesh) }
    return welded
  }

  /** Returns true when the scene changed and therefore needs a repaint. */
  const rebuild = (): boolean => {
    if (disposed) return false
    const handle = state.surface
    if (!state.enabled || !handle) return clearShape()

    if (brokenSurface) return clearShape()

    // ONE boundary around the whole build — reading the camera, reading the
    // surface back, welding it, cutting it, and uploading the result. A cut face
    // is an addition to a picture that already rendered, so losing it must never
    // take the viewer down from inside a drag; and because this also runs inside
    // a `requestAnimationFrame`, an escape would be an uncaught global error
    // that is reported with no usable stack.
    let key: string | null = null
    // Whether THIS run took the cut face off the model group. `removeShape` only
    // detaches; it does not draw. So a removal that is not reported back cannot
    // be repainted, and the last painted frame — cut face and all — stays on the
    // canvas over a plane that no longer has one. The catch below cannot re-read
    // it from `clearShape()`, which by then finds an already-empty slot and says
    // "nothing removed", so the run has to carry it itself.
    let removedThisRun = false
    try {
      const plane = cutPlaneFrom(
        viewer.getView(), viewer.getSlab(), viewer.getPerceivedDistance(), state.ortho,
      )
      if (!plane) return endRun(clearShape())

      key = `${plane.normal.x},${plane.normal.y},${plane.normal.z},${plane.offset},${handle.id}`
      // Neither the colour NOR the opacity is in the key, because neither is part
      // of the geometry: the key means "the plane this mesh was cut for", and
      // folding a fill into it would re-CUT for every value a control emits — one
      // per pointer move inside the colour dialog or along the opacity slider,
      // against a cut this file measures at 2.5 ms on a 173k-triangle surface and
      // 7.3 ms on a larger one (see the module docstring). It would NOT re-weld:
      // `meshFor` caches the welded mesh on the surface HANDLE, so a key miss
      // re-uses it.
      //
      // ⚠️ The surface's `opaque` boolean WAS in this key until the cut face got
      // its own opacity, and it could afford to be: a two-state chip emits one
      // value per click. A slider emits one per pointer move. Putting the number
      // back would restore the per-frame re-cut on the control that produces more
      // values than any other in this bar.
      if (
        key === lastKey && lastFill != null &&
        lastFill.color === state.color && lastFill.opacity === state.opacity
      ) return false
      if (key === lastKey) {
        // The plane has not moved, only the fill. Repaint the shape in place —
        // no CUT, and nothing cached that would then have to be kept in step
        // with the plane (see `RecolourableShape`, which also records what the
        // per-frame `globj` does pay regardless).
        lastFill = { color: state.color, opacity: state.opacity }
        // Nothing is on screen for this plane. A cut face that draws nothing
        // draws nothing in a new colour or at a new opacity either.
        if (shape == null) return false
        if (canRecolour(shape)) {
          // Colour AND opacity every time, never just the one that changed — see
          // `RecolourableShape` for what an absent colour resolves to.
          shape.updateStyle({
            color: resolveCapColor(viewer.container, state.color),
            opacity: state.opacity,
          })
          return endRun(true)
        }
        // A 3Dmol that cannot recolour in place: fall through and rebuild the
        // ordinary way. Correct, just more expensive.
      }
      // No `|| removedThisRun` here: nothing above this line removes anything, so
      // the flag is provably false. It matters only on the paths below.
      if (key === failedKey) return clearShape()

      const entry = meshFor(handle)
      if (!entry) return endRun(clearShape())

      const cap = buildCapMesh(entry.mesh, plane.normal, plane.offset, {
        maxStitchA: entry.tolerance,
      })
      const removed = clearShape()
      removedThisRun = removedThisRun || removed
      // Spent BEFORE the upload, deliberately. If `addCustom` throws, the key
      // must still count as tried — the catch below latches it, but a key
      // cleared here would make the very next frame rebuild the same plane.
      lastKey = key
      lastFill = { color: state.color, opacity: state.opacity }
      // No cut face at all — the plane misses the molecule. Not an error, and
      // not a reason to re-derive it until the camera moves again.
      if (!cap) return endRun(removed)

      // One line per surface, and only when something was actually LOST — a
      // ring dropped, or the whole cut face refused. A conflict on its own is
      // not a loss: it truncates a walk, the truncated chain becomes an open
      // one, and the stitch closes it within tolerance — real surfaces carry a
      // couple, so warning on them would put a line in every console for a cut
      // face that is entirely correct.
      //
      // `refused` is in the condition, not just in the text: a `corrupt`
      // refusal has no dropped ring at all, so keying the warning on
      // `droppedLoops` alone would take the cut face away in silence.
      if (warnedFor !== handle && (cap.stats.droppedLoops > 0 || cap.stats.refused)) {
        warnedFor = handle
        console.warn(
          `Section cap on surface ${handle.id}: ${cap.stats.droppedLoops} ring(s) could ` +
            `not be closed within ${entry.tolerance} A (${cap.stats.droppedAreaA2} A^2), ` +
            `${cap.stats.conflicts} ambiguous boundary point(s)` +
            (cap.stats.refusedReason === 'cavity'
              ? ' — one of them lies inside the cut face, which would have been filled in as ' +
                'material, so the cut is left hollow.'
              : cap.stats.refusedReason === 'corrupt'
                ? // No triangle count here: `capTriangles` is hard-zeroed on
                  // every refusal, so on the one path that reaches this branch
                  // it is the constant 0 — which would say earcut returned
                  // NOTHING, the one case a `corrupt` refusal excludes by
                  // construction (it needs `indices.length > 0`). Printing it
                  // sends the reader after the boundary walk instead of the
                  // triangulator, which is the exact mis-routing this branch
                  // exists to prevent.
                  ` — the triangulation misses the outline it was built from by ` +
                  `${cap.stats.areaErrorPct.toFixed(3)}% of its area (${cap.stats.loops} loop(s), ` +
                  `${cap.stats.outers} outer, ${cap.stats.holes} hole(s)), so it cannot be ` +
                  'trusted and the cut is left hollow.'
                : cap.stats.refusedReason === 'area'
                  ? ' — too much of the cut face to draw honestly, so it is left hollow.'
                  : '; that part of the cut face is left open.'),
        )
      }
      // Refused, or nothing to draw. Either way the hollow cut stands, which is
      // a picture the user already knows how to read.
      if (cap.stats.refused || cap.indices.length === 0) return endRun(removed)

      shape = viewer.addCustom({
        vertexArr: toXYZ(cap.positions),
        normalArr: toXYZ(cap.normals),
        faceArr: cap.indices,
        // An explicit colour is mandatory: 3Dmol resolves a missing one to
        // black, which over a white surface reads as a hole rather than a cap.
        color: resolveCapColor(viewer.container, state.color),
        // Already resolved by the caller — either the surface's own opacity, or
        // the override the cut face carries. See `SectionCapState.opacity` for
        // why the choice between them is not made here.
        opacity: state.opacity,
      })
      centreBoundingSphere(shape, cap.positions)
      return endRun(true)
    } catch (err) {
      console.error('Section cap could not be built:', err)
      // Only when there IS one. A throw before the key was derived — `getView`
      // on a viewer being torn down is the realistic one — must not overwrite a
      // live latch with null and re-arm the very plane that is failing.
      if (key !== null) failedKey = key
      if (++failures >= MAX_CAP_BUILD_FAILURES) {
        brokenSurface = true
        console.warn(
          `Section cap disabled for surface ${handle.id} after ${failures} consecutive ` +
            'failures; re-tick the chip or rebuild the surface to try again.',
        )
      }
      return clearShape() || removedThisRun
    }
  }

  /** Repaint, without letting a dead viewer's throw escape into a frame callback. */
  const repaint = (): void => {
    try {
      viewer.render()
    } catch (err) {
      console.error('Section cap could not repaint:', err)
    }
  }

  const schedule = (): void => {
    if (disposed || frame != null) return
    frame = window.requestAnimationFrame(() => {
      frame = null
      if (rebuild()) repaint()
    })
  }

  const unsubscribe = subscribeViewChange(viewer, () => {
    // Cheap guard so a viewer with the cap off — or one the breaker has given up
    // on — does not queue a frame on every repaint of an unrelated scene.
    // Recovery does not come through here: `update()` clears `brokenSurface` and
    // rebuilds directly.
    if (state.enabled && !brokenSurface) schedule()
  })

  return {
    update(next: SectionCapState) {
      if (disposed) return
      const surfaceChanged = next.surface !== state.surface
      // Turning the chip back on is a NEW attempt, not a continuation of the one
      // that failed: without this, a single transient throw would leave the user
      // with a pressed chip and no way back short of a reload.
      const reEnabled = next.enabled && !state.enabled
      // Picking a different fill — colour or opacity — is an explicit "try
      // again" for THIS PLANE: one throw during a recolour latches `failedKey`
      // for a parked camera, and without this none of the fill controls can bring
      // the cut face back — the full reset below fires only on a new surface or a
      // re-tick.
      //
      // ⛔ It clears the plane latch ONLY. It must NOT re-arm the breaker: this
      // path runs once per value the colour dialog or the opacity slider emits,
      // i.e. once per pointer move, so zeroing `failures` here would mean the
      // count can never reach the bound and a drag against a dead viewer would
      // re-cut — and log — per frame, for as long as the gesture lasts. That is
      // precisely the storm `MAX_CAP_BUILD_FAILURES` exists to end.
      const fillChanged = next.color !== state.color || next.opacity !== state.opacity
      state = next
      // Whether THIS call took a cap off the scene. `removeShape` only detaches
      // from the model group; it does not draw, so a removal that is not
      // followed by a render leaves the last painted frame — cap and all — on
      // the canvas over a surface that no longer exists. `rebuild()` cannot
      // report it either: it re-clears an already-empty slot and returns false.
      let removedHere = false
      if (surfaceChanged) {
        // A different handle means a different BUILD, even when 3Dmol hands the
        // same id back — which it does after `removeAllSurfaces`.
        welded = null
        warnedFor = null
        removedHere = clearShape()
      }
      if (fillChanged) failedKey = null
      if (surfaceChanged || reEnabled) {
        failedKey = null
        failures = 0
        brokenSurface = false
      }
      // `rebuild()` FIRST — `||` short-circuits, and it must always run.
      if (rebuild() || removedHere) repaint()
    },
    dispose() {
      disposed = true
      if (frame != null) {
        window.cancelAnimationFrame(frame)
        frame = null
      }
      unsubscribe()
      clearShape()
      welded = null
    },
  }
}
