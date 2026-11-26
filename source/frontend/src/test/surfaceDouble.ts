/**
 * The 3Dmol surface API, faked once, faithfully — because a double that gets
 * this wrong makes its whole suite green and blind (PT-423 item 3, PT-382
 * follow-up 4).
 *
 * Five suites exercise `surfaceController.ts` / `sectionCap.ts` through a fake
 * viewer, and each had built its own. They disagreed with 3Dmol, and with each
 * other, on the four details below — so the tests that mattered most passed for
 * the wrong reason. This module owns those four details; a suite keeps its own
 * viewer object and its own `vi.fn()` wrappers (its call counts and assertions
 * are its business) and delegates only the surface bookkeeping here.
 *
 * THE FOUR PROPERTIES, each with the bug its absence hides:
 *
 *  (a) **`addSurface` stamps `surfid` synchronously and registers the entry
 *      before it returns.** `GLViewer.ts` ~4715: `this.surfaces[surfid] = surf;
 *      promise.surfid = surfid`. Without it `state.surfid` stays null, the
 *      restyle path is unreachable, and every surface test silently measures
 *      the rebuild path instead.
 *  (b) **Ids are `max(remaining keys) + 1`, NOT a monotonic counter.**
 *      `GLViewer.ts:313-325` walks `this.surfaces` and returns max+1, so after
 *      `removeAllSurfaces` the SAME number comes back (measured: 1, 2,
 *      removeAll, 1). Three doubles asserted the opposite in a comment —
 *      "Monotonic, as 3Dmol's nextSurfID is: an id is never handed out twice" —
 *      which is exactly backwards. Everything that exists because ids are
 *      recycled (`SurfaceHandle` being an object rather than a number,
 *      `issuedWhile`, `sectionCap` comparing identity, `buildToken`) was
 *      therefore untested everywhere: rewriting `SurfaceHandle` as a bare
 *      `number` would have left every suite green.
 *  (c) **`getSurface` reads the same map `removeAllSurfaces` empties, and
 *      answers with an `Array` SUBCLASS whose constructor spreads.** 3Dmol's
 *      `Surface extends Array` (`GLViewer.ts:34-40`), so any species-
 *      constructing method — `map`, `flatMap`, `filter`, `slice` — dies on
 *      `new Surface(len)`. A plain-array double never reaches it, and the bug
 *      ships to a real browser; it did once already (`sectionCap.ts:558-566`).
 *  (d) **`setSurfaceMaterialStyle` replaces each part's `mat` and forces
 *      `side = FrontSide`.** `GLViewer.ts` ~4750, unconditional. A `vi.fn()`
 *      that only counts cannot see a restyle permanently stripping the back
 *      faces off a translucent surface, which is the one thing
 *      `captureSides`/`restoreSides` exist to prevent.
 *
 * Plus one property no consumer needs but the PT-382 item 5 watchdog does:
 * `mergeExtent` models `mergeGeos` PUSHING a group onto `geo.geometryGroups`
 * per merged chunk (`utilities.ts:244`), which is the only externally visible
 * sign that a build is still making progress.
 */

/** `$3Dmol.Sides`, by value: what `addSurface` leaves a material at... */
export const DOUBLE_SIDE = 2
/** ...and what `setSurfaceMaterialStyle` overwrites it with. */
export const FRONT_SIDE = 0

/** One entry of a surface — 3Dmol keeps one per model, usually one. */
export interface SurfacePart {
  mat: { side: number }
  geo: { geometryGroups: Array<{ vertices: number }> }
}

/**
 * 3Dmol's `Surface`: an `Array` subclass whose constructor SPREADS its
 * argument, so `new SurfaceLike(3)` throws instead of allocating three holes.
 * That is what makes species-constructing array methods fail — see (c) above.
 */
export class SurfaceLike<T> extends Array<T> {
  constructor(items: T[]) {
    super(...items)
  }
}

export interface SurfaceStore {
  /** The map `getSurface` reads and `removeAllSurfaces` empties. */
  readonly surfaces: Map<number, SurfaceLike<SurfacePart>>
  /**
   * Allocate and register one surface, as `addSurface` does. Returns its id.
   *
   * `parts` is how many entries it carries, or the per-part `mat.side` values
   * to build them with. 3Dmol pushes ONE PER MODEL (`GLViewer.ts` ~4690: a
   * `surf.push` per model with atoms to show), and `captureSides`/`restoreSides`
   * walk that array BY INDEX.
   *
   * ⚠️ Pass DISTINCT sides to pin the mapping. A count alone gives every part
   * the same value, and then `sides[0]`, `sides[len-1-i]` and `sides[i % 1]` all
   * restore the same picture — the off-by-one such a test names is the one thing
   * it cannot see.
   */
  addSurface(parts?: number | number[]): number
  getSurface(id: number): SurfaceLike<SurfacePart> | undefined
  removeAllSurfaces(): void
  setSurfaceMaterialStyle(id: number): void
  /** One more merged chunk on a build in flight — the progress a watchdog reads. */
  mergeExtent(id: number, chunks?: number): void
}

export function makeSurfaceStore(): SurfaceStore {
  const surfaces = new Map<number, SurfaceLike<SurfacePart>>()

  /** `GLViewer.ts:313-325`, exactly: max over the REMAINING keys, plus one. */
  const nextSurfID = (): number => {
    let max = 0
    for (const id of surfaces.keys()) if (id > max) max = id
    return max + 1
  }

  return {
    surfaces,
    addSurface(parts: number | number[] = 1): number {
      const id = nextSurfID()
      const sides = Array.isArray(parts)
        ? parts
        : Array.from({ length: parts }, () => DOUBLE_SIDE)
      // `geometryGroups` starts EMPTY (`Geometry.ts:388`) and grows as extents
      // merge; a build that has drawn nothing yet is the normal first state.
      const entries: SurfacePart[] = sides.map(side => ({
        mat: { side },
        geo: { geometryGroups: [] as Array<{ vertices: number }> },
      }))
      surfaces.set(id, new SurfaceLike<SurfacePart>(entries))
      return id
    },
    getSurface(id: number) {
      return surfaces.get(id)
    },
    removeAllSurfaces(): void {
      surfaces.clear()
    },
    setSurfaceMaterialStyle(id: number): void {
      // A for-of, never `.forEach` on a fresh array: this walks a `SurfaceLike`
      // and the point of the class is that it does not survive being copied.
      for (const part of surfaces.get(id) ?? []) part.mat = { side: FRONT_SIDE }
    },
    mergeExtent(id: number, chunks = 1): void {
      const parts = surfaces.get(id)
      if (!parts) return
      for (let i = 0; i < chunks; i++) {
        for (const part of parts) part.geo.geometryGroups.push({ vertices: 3 })
      }
    },
  }
}
