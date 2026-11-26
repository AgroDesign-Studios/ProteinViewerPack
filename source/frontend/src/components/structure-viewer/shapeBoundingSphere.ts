/**
 * Where Reset View should think a custom 3Dmol shape is.
 *
 * 3Dmol leaves a non-clickable `addCustom` shape's bounding sphere at the world
 * origin with radius 0, and an empty-selection `zoomTo()` / `center()` — Reset
 * View — folds every shape's sphere into the extent it frames. So a shape drawn
 * around a crystal structure far from the origin pulls that view out to
 * (0, 0, 0). A custom shape the viewer draws, such as the cut face
 * (`sectionCap.ts`), lies inside the model it belongs to, so the fix is the
 * same for each: a point in the middle of the shape, radius 0, which adds
 * nothing to the extent.
 */

type Vec3Tuple = readonly [number, number, number]

/**
 * Move `shape`'s bounding sphere to the middle of the box `min`..`max`, radius 0.
 *
 * A no-op for a shape without a settable sphere — 3Dmol ships no usable type
 * for the GLShape `addCustom` returns, so its shape is checked, not assumed.
 */
export function pinBoundingSphereToBox(shape: unknown, min: Vec3Tuple, max: Vec3Tuple): void {
  const sphere = (shape as { boundingSphere?: { center?: { set?: unknown }; radius?: number } } | null)
    ?.boundingSphere
  const centre = sphere?.center
  if (!sphere || !centre || typeof centre.set !== 'function') return
  ;(centre.set as (x: number, y: number, z: number) => void).call(
    centre, (min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2,
  )
  sphere.radius = 0
}
