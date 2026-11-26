/**
 * Frame 3Dmol's orthographic camera the way its perspective camera is framed.
 *
 * 3Dmol 2.5.4 sizes the two projections on different bases. Perspective uses the
 * VERTICAL field of view: at the rotation centre the view is
 * `2 * centre * tan(fov / 2)` tall, whatever the canvas width. Orthographic is
 * `GLViewer.setSlabAndFog`'s
 *
 *     this.camera.right = center * Math.tan(Math.PI / 180 * this.fov);
 *     this.camera.top = this.camera.right / this.ASPECT;
 *
 * — anchored to the WIDTH, and on the full angle rather than half of it. The two
 * agree only on a canvas whose aspect is tan(fov) / tan(fov / 2), about 2.06 at
 * the 20° these viewers use. On anything narrower, switching to orthographic
 * shrinks the molecule (at the rotation centre: to 48% of its size on a square
 * canvas, 65% at 4:3, 87% at 1.8:1 — the formula's values, which a headless
 * Chrome run against the installed 2.5.4 bundle reproduced), and
 * while orthographic, the WIDTH of the canvas sets the scale — narrowing the
 * canvas shrinks the protein. Neither happens in
 * perspective. `zoomTo` computes its distance from `camera.fov / 2` in both
 * modes, so the orthographic camera also frames a `zoomTo` too loosely.
 *
 * The fix re-derives the four extents from the perspective formula right after
 * 3Dmol writes its own, every time it writes them. `setSlabAndFog` runs at the
 * start of every `show()` (which `resize()` ends in), from `setProjection` and
 * from `setCameraParameters`, so wrapping it covers zoom, resize and projection
 * changes with no state of its own: the extents are a pure function of the camera
 * distance, the field of view and the aspect, all read fresh on each call. The
 * picture at the rotation centre is then the same size in both projections, which
 * is what lets a view switch projection without the molecule jumping.
 *
 * ⚠️ This reaches past 3Dmol's public API — `setSlabAndFog`, `camera` and
 * `rotationGroup` are `private` in `GLViewer.d.ts` — which nothing else in these
 * viewers does (`sectionCap.ts` holds to public calls only). It is probed
 * structurally and does nothing when the shape is not there, so a 3Dmol upgrade
 * that renames any of it degrades to the old shrinking orthographic view rather
 * than breaking the viewer. `orthoFraming.test.ts` drives the INSTALLED
 * library's own `setSlabAndFog`, so an upgrade that changes the formula fails
 * there instead of shipping a wrong correction.
 */

/** The parts of a 3Dmol `Camera` the correction reads and writes. */
interface FramableCamera {
  ortho: boolean
  /** Degrees, vertical — `setSlabAndFog` copies the viewer's own `fov` here. */
  fov: number
  /** Width / height, kept in step with the canvas by `GLViewer.updateSize`. */
  aspect: number
  position: { z: number }
  top: number
  bottom: number
  left: number
  right: number
  updateProjectionMatrix(): void
}

/** The private 3Dmol `GLViewer` surface this module relies on. */
interface FramableViewer {
  setSlabAndFog(): void
  camera: FramableCamera
  rotationGroup: { position: { z: number } }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

/**
 * True when `viewer` has the private shape the correction needs.
 *
 * Checked field by field rather than assumed, because every one of these names
 * is an implementation detail 3Dmol is free to change in any release.
 */
function isFramable(viewer: unknown): viewer is FramableViewer {
  if (!isRecord(viewer) || typeof viewer.setSlabAndFog !== 'function') return false
  const camera = viewer.camera
  const group = viewer.rotationGroup
  return isRecord(camera)
    && typeof camera.ortho === 'boolean'
    && typeof camera.fov === 'number'
    && typeof camera.aspect === 'number'
    && isRecord(camera.position)
    && typeof camera.position.z === 'number'
    && typeof camera.updateProjectionMatrix === 'function'
    && isRecord(group)
    && isRecord(group.position)
    && typeof group.position.z === 'number'
}

/**
 * Rewrite an orthographic camera's extents to the perspective framing.
 *
 * Perspective cameras are left exactly as 3Dmol set them. Exported for the test,
 * which applies it to the library's own output.
 */
export function framePerspectiveLike(viewer: FramableViewer): void {
  const camera = viewer.camera
  if (!camera.ortho) return
  // 3Dmol's own floor (`if (center < 1) center = 1`), so the two projections
  // agree on it as well — `sectionCap.cutPlaneFrom` documents the same clamp.
  let center = camera.position.z - viewer.rotationGroup.position.z
  if (center < 1) center = 1
  const halfHeight = center * Math.tan((Math.PI / 180) * (camera.fov / 2))
  const halfWidth = halfHeight * camera.aspect
  // A NaN extent blanks the canvas with nothing on screen to explain it. Leave
  // 3Dmol's own numbers in place instead: a shrunken view, not an empty one.
  if (!(halfHeight > 0) || !(halfWidth > 0) || !Number.isFinite(halfWidth)) return
  camera.top = halfHeight
  camera.bottom = -halfHeight
  camera.right = halfWidth
  camera.left = -halfWidth
  camera.updateProjectionMatrix()
}

// Weak, so a torn-down viewer is not kept alive by having been framed.
const installed = new WeakSet<object>()

/**
 * Make this viewer frame its orthographic camera like its perspective one.
 *
 * Idempotent per instance: an effect that re-runs against the same viewer (React
 * StrictMode does exactly that) must not wrap the wrapper, which would apply the
 * correction twice per frame — harmless today, since it is a pure overwrite, but
 * a trap for any later change that makes it relative.
 *
 * Returns false, and changes nothing, when the viewer does not have the private
 * shape this relies on.
 */
export function installOrthoFraming(viewer: unknown): boolean {
  if (!isFramable(viewer)) return false
  if (installed.has(viewer)) return true
  const own = viewer.setSlabAndFog
  viewer.setSlabAndFog = function setSlabAndFogFramed(): void {
    own.call(viewer)
    framePerspectiveLike(viewer)
  }
  installed.add(viewer)
  return true
}
