/**
 * Types for `earcut` (Mapbox, ISC), which ships no declarations of its own.
 *
 * Hand-written rather than pulled from DefinitelyTyped because the whole public
 * surface this project uses is the one call below, and the signature has been
 * stable since 2.0. If a future version changes it, `capGeometry.ts` is the only
 * caller and `tsc` will say so there.
 */
declare module 'earcut' {
  /**
   * Triangulate a polygon given as flat coordinates.
   *
   * @param vertices flat `[x0, y0, x1, y1, ...]` — the outer ring first, then
   *   every hole ring, all concatenated.
   * @param holeIndices start index (in VERTICES, not in array slots) of each
   *   hole ring, or null/omitted when the polygon has none.
   * @param dimensions coordinates per vertex; 2 for a planar polygon.
   * @returns flat triples of indices into `vertices` (again vertex indices).
   */
  export default function earcut(
    vertices: ArrayLike<number>,
    holeIndices?: ArrayLike<number> | null,
    dimensions?: number,
  ): number[]
}
