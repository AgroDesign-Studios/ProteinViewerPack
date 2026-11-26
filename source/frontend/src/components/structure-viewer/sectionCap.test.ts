/**
 * sectionCap — where the cut plane is, and the two regimes 3Dmol puts it in.
 *
 * `buildCapMesh` is tested against shapes with known areas in
 * `capGeometry.test.ts`. What is left here is the part that cannot be seen at
 * all until it is wrong: the plane the cap is built ON. A wrong constant does
 * not produce a slightly-off cut face, it produces one somewhere else or none,
 * and the two ways to get it wrong (ignoring the near-plane floor, ignoring the
 * model-group offset) both look correct at the default zoom.
 */
import { afterEach, describe, it, expect, vi } from 'vitest'
import {
  MAX_CAP_BUILD_FAILURES,
  centreBoundingSphere,
  createSectionCap,
  cutPlaneFrom,
  isCapCapable,
  stitchToleranceFor,
} from './sectionCap'
import { COARSE_GRID_VOLUME_A3, DEFAULT_MAX_STITCH_A, type WeldedMesh } from './capGeometry'
import { CAP_COLOR_DEFAULT } from './depthCue'
// The species-hostile `Array` subclass 3Dmol's `getSurface` really answers with
// (`GLViewer.ts:34-40`). This module walks that result with plain loops for
// exactly that reason (`sectionCap.ts:558-566`) — and until PT-423 item 3 the
// double here handed it a plain array, so a regression to `flatMap`/`filter`
// would have stayed green in jsdom and thrown in every real browser.
import { SurfaceLike } from '../../test/surfaceDouble'

/** `getView()` with no translation and no rotation. */
const IDENTITY_VIEW = [0, 0, 0, 0, 0, 0, 0, 1]

describe('cutPlaneFrom', () => {
  it('puts the plane where setSlabAndFog puts camera.near', () => {
    // center 150, slabNear -50 -> camera.near 100 -> the kept half-space ends
    // 50 in front of the rotation centre.
    const plane = cutPlaneFrom(IDENTITY_VIEW, { near: -50, far: 50 }, 150, false)
    expect(plane).not.toBeNull()
    expect(plane!.normal).toEqual({ x: 0, y: 0, z: 1 })
    expect(plane!.offset).toBeCloseTo(50, 9)
  })

  it('does NOT move with the zoom while the near floor is inactive', () => {
    // The `center` terms cancel, which is the whole reason a `getSlab()`-only
    // derivation looks right in every ordinary view.
    const wide = cutPlaneFrom(IDENTITY_VIEW, { near: -50, far: 50 }, 150, false)!
    const closer = cutPlaneFrom(IDENTITY_VIEW, { near: -50, far: 50 }, 80, false)!
    expect(closer.offset).toBeCloseTo(wide.offset, 9)
  })

  it('DOES move with the zoom once the near floor bites', () => {
    // `setSlabAndFog` clamps camera.near to 1 in perspective. From there on the
    // cut plane slides through the molecule as the user zooms — measured at 4.7 A
    // of drift at 8x and 12.6 A at 14x on a real structure. A cap derived from
    // slab.near alone detaches from the shell exactly here.
    const floored = cutPlaneFrom(IDENTITY_VIEW, { near: -20, far: 20 }, 10, false)!
    expect(floored.offset).toBeCloseTo(9, 9) // 10 - 1, not 10 - (-10) = 20
    const deeper = cutPlaneFrom(IDENTITY_VIEW, { near: -20, far: 20 }, 4, false)!
    expect(deeper.offset).toBeCloseTo(3, 9)
    expect(deeper.offset).not.toBeCloseTo(floored.offset, 3)
  })

  it('clamps what setSlabAndFog clamps, and converts with what it does not', () => {
    // `setSlabAndFog` floors the centre distance before deriving camera.near
    // from it (GLViewer.ts:331) and floors camera.near again (:334). Both bite
    // when a saved view puts the camera closer than one unit — `setView` writes
    // rotationGroup.position.z straight from a user-writable blob.
    //
    // ⚠️ But the conversion back to model space uses the UNCLAMPED distance: the
    // camera never moved, so the near plane is at CAMERA_Z - camera.near and
    // subtracting the rotation group's z leaves (CAMERA_Z - rgz) - near, whose
    // first term is exactly what getPerceivedDistance() reports. A round-1 fix
    // used the clamped value on both sides, and the test written with it pinned
    // that mistake: it asserted -0.75 was NOT the answer. It is.
    const floored = cutPlaneFrom(IDENTITY_VIEW, { near: -3, far: 3 }, 0.25, false)!
    // centre floors to 1, so near = 1 + (-3) = -2, itself floored to 1.
    // offset = 0.25 (UNCLAMPED) - 1 = -0.75.
    expect(floored.offset).toBeCloseTo(-0.75, 9)
  })

  it('leaves both floors alone when neither applies', () => {
    const plain = cutPlaneFrom(IDENTITY_VIEW, { near: -3, far: 3 }, 40, false)!
    expect(plain.offset).toBeCloseTo(3, 9)
  })

  it('skips the floor in orthographic, exactly as 3Dmol does', () => {
    const ortho = cutPlaneFrom(IDENTITY_VIEW, { near: -20, far: 20 }, 10, true)!
    expect(ortho.offset).toBeCloseTo(20, 9)
  })

  it('turns the camera quaternion into the model-space normal', () => {
    // 90 degrees about y. The normal is the third ROW of the rotation matrix —
    // transposed, not the third column — and swapping the two is a mistake that
    // still yields a unit vector, so only a rotated case can catch it.
    const s = Math.SQRT1_2
    const plane = cutPlaneFrom([0, 0, 0, 0, 0, s, 0, s], { near: -50, far: 50 }, 150, false)!
    expect(plane.normal.x).toBeCloseTo(-1, 9)
    expect(plane.normal.y).toBeCloseTo(0, 9)
    expect(plane.normal.z).toBeCloseTo(0, 9)
  })

  it('subtracts the model-group translation along the normal', () => {
    // 3Dmol centres the molecule by translating the model group, so model
    // coordinates are offset from the ones the slab is measured in.
    const plane = cutPlaneFrom([0, 0, 7, 0, 0, 0, 0, 1], { near: -50, far: 50 }, 150, false)!
    expect(plane.offset).toBeCloseTo(43, 9)
  })

  it('normalises a drifted quaternion rather than scaling every distance', () => {
    const plane = cutPlaneFrom([0, 0, 0, 0, 0, 0, 0, 2], { near: -50, far: 50 }, 150, false)!
    expect(Math.hypot(plane.normal.x, plane.normal.y, plane.normal.z)).toBeCloseTo(1, 9)
  })

  it('refuses a view it cannot read', () => {
    expect(cutPlaneFrom([0, 0, 0, 0], { near: -50, far: 50 }, 150, false)).toBeNull()
    expect(cutPlaneFrom(IDENTITY_VIEW, { near: Number.NaN, far: 50 }, 150, false)).toBeNull()
    expect(cutPlaneFrom(IDENTITY_VIEW, { near: -50, far: 50 }, Number.NaN, false)).toBeNull()
    expect(cutPlaneFrom([0, 0, 0, 0, Number.NaN, 0, 0, 1], { near: -50, far: 50 }, 150, false))
      .toBeNull()
  })
})

describe('stitchToleranceFor', () => {
  /** A mesh that is nothing but its bounding box — all this function reads. */
  function box(dx: number, dy: number, dz: number): WeldedMesh {
    return {
      x: Float64Array.from([0, dx]),
      y: Float64Array.from([0, dy]),
      z: Float64Array.from([0, dz]),
      tri: Int32Array.from([]),
      rawVertices: 2,
      triangles: 0,
    }
  }

  it('assumes the fine grid for an ordinary protein', () => {
    // 60 A across is a comfortable single domain; 3Dmol marches it at 0.5 A.
    expect(stitchToleranceFor(box(60, 55, 50))).toBe(DEFAULT_MAX_STITCH_A)
  })

  it('assumes the coarse grid for a structure that really earns it', () => {
    // GroEL's scale: an atom box of ~137 x 137 x 146, comfortably past 1e6 even
    // after the surface reach is taken back off every side. This is the mesh the
    // 1.011 A seam measurement came from, so the branch has to fire here.
    expect(stitchToleranceFor(box(146, 146, 155))).toBe(4.0)
  })

  it('does NOT call the coarse grid on a mesh box that only LOOKS past 1e6', () => {
    // The regression this test exists for. 3Dmol decides on the box of atom
    // CENTRES — `initparm`'s `volume > 1000000` runs before `margin` and the
    // probe radius are added — and the mesh is that box grown by a radius on
    // every side. A 104 A mesh cube has a raw volume of 1.12e6, but the atoms
    // inside it span 104 - 2 x 5.5 = 93 A, i.e. 8.0e5: the fine grid, where a
    // 4.0 A tolerance would stitch a genuine 3 A void shut and draw across it.
    expect(104 ** 3).toBeGreaterThan(COARSE_GRID_VOLUME_A3)
    expect(stitchToleranceFor(box(104, 104, 104))).toBe(DEFAULT_MAX_STITCH_A)
  })

  it('brackets SURFACE_REACH_A from both sides', () => {
    // The other cases in this suite keep their grid at any reach from 2 to
    // about 24, so none of them pins the constant — and this PR spent a whole
    // review round on a value that was wrong (2.75 + 1.4 omits the
    // grid-quantisation term, so it was not the upper bound its docstring
    // claimed). Two cubes are what bracket it, and it takes both:
    //
    //   110 A: atom span (110 - 2R). Crosses 1e6 at R = 5.0 exactly, so FINE
    //          holds for R >= 5.0 — this line fails if the reach SHRINKS.
    //   112 A: atom span (112 - 2R). At R = 5.5 that is 101 A = 1.03e6, COARSE;
    //          at R = 6.0 it is exactly 100 A = 1.00e6, which is not `>` the
    //          threshold, so FINE — this line fails if the reach GROWS.
    //
    // Together: 5.0 <= SURFACE_REACH_A < 6.0. ⚠️ A first version of this test
    // asserted `(110 - 2 * 4.5) ** 3 > COARSE_GRID_VOLUME_A3` and called that
    // the second side. It is not — both sides of that comparison are literals,
    // so it is arithmetic that cannot fail whatever the constant becomes, and
    // the suite stayed green at a reach of 6.5, 8 or 20.
    expect(stitchToleranceFor(box(110, 110, 110))).toBe(DEFAULT_MAX_STITCH_A)
    expect(stitchToleranceFor(box(112, 112, 112))).toBe(4.0)
  })

  it('shrinks per AXIS, so an elongated box is not misread', () => {
    // The same trap, and the reason a scalar volume correction cannot express
    // it: a 400 x 130 x 25 mesh has a raw volume of 1.3e6, but its short axis is
    // almost all surface reach — 25 - 2 x 5.5 = 14 — leaving an atom volume of
    // 6.5e5. A fibre, in other words, which 3Dmol marches finely.
    expect(400 * 130 * 25).toBeGreaterThan(COARSE_GRID_VOLUME_A3)
    expect(stitchToleranceFor(box(400, 130, 25))).toBe(DEFAULT_MAX_STITCH_A)
  })

  it('falls back to the fine grid on a mesh it cannot measure', () => {
    const empty: WeldedMesh = {
      x: Float64Array.from([]),
      y: Float64Array.from([]),
      z: Float64Array.from([]),
      tri: Int32Array.from([]),
      rawVertices: 0,
      triangles: 0,
    }
    expect(stitchToleranceFor(empty)).toBe(DEFAULT_MAX_STITCH_A)
  })
})

describe('isCapCapable', () => {
  const full = {
    getSurface: () => new SurfaceLike([]),
    getView: () => IDENTITY_VIEW,
    getSlab: () => ({ near: -50, far: 50 }),
    getPerceivedDistance: () => 150,
    addCustom: () => ({}),
    removeShape: () => ({}),
    render: () => {},
  }

  it('accepts a viewer with the whole mesh read-back API', () => {
    expect(isCapCapable(full)).toBe(true)
  })

  it('rejects the slab-only doubles the depth-cue suites use', () => {
    // Those doubles implement setSlab/getSlab/fitSlab/enableFog/setProjection and
    // nothing else. They must get no cap rather than a TypeError.
    expect(isCapCapable({ getSlab: () => ({ near: 0, far: 1 }), render: () => {} })).toBe(false)
  })

  it('rejects a viewer missing any single method', () => {
    for (const key of Object.keys(full)) {
      const partial: Record<string, unknown> = { ...full }
      delete partial[key]
      expect(isCapCapable(partial)).toBe(false)
    }
  })

  it('rejects non-objects', () => {
    expect(isCapCapable(null)).toBe(false)
    expect(isCapCapable(undefined)).toBe(false)
    expect(isCapCapable('viewer')).toBe(false)
  })
})

describe('createSectionCap', () => {
  /** The four side walls of a 2x2 prism spanning z -1..1, as one 3Dmol group. */
  function prismGroup() {
    const corners: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]]
    const positions: number[] = []
    const faces: number[] = []
    for (let i = 0; i < 4; i++) {
      const [x0, y0] = corners[i]
      const [x1, y1] = corners[(i + 1) % 4]
      const b = positions.length / 3
      positions.push(x0, y0, -1, x1, y1, -1, x1, y1, 1, x0, y0, 1)
      faces.push(b, b + 1, b + 2, b, b + 2, b + 3)
    }
    return {
      vertexArray: Float32Array.from(positions),
      faceArray: Uint16Array.from(faces),
      vertices: positions.length / 3,
      faceidx: faces.length,
    }
  }

  /**
   * A viewer whose numbers put the cut plane at z = 0: perceived 100 and
   * slabNear 0 give camera.near 100, so the plane constant is 100 - 100 = 0.
   */
  /**
   * Takes over `requestAnimationFrame` so a test can actually RUN what the
   * view-change hook schedules.
   *
   * jsdom's own rAF fires on a timer, i.e. after the test's assertions have
   * already been made, so a test that calls `viewer.callback?.(...)` and then
   * asserts is not exercising the frame path at all — everything it observes
   * came from the synchronous `update()` next to it. Captured here and run on
   * demand, so `flush()` is the only thing that drives `schedule()`.
   */
  function captureFrames() {
    const queue = new Map<number, FrameRequestCallback>()
    let nextId = 1
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => {
      const id = nextId++
      queue.set(id, cb)
      return id
    })
    // Honoured for real: a `dispose()` that cancels must actually stop the
    // callback, or `flush()` would run a frame the code correctly dropped and
    // the test would be measuring its own mock.
    const caf = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => {
      queue.delete(id)
    })
    const harness = {
      get pending() { return queue.size },
      flush() {
        const due = [...queue.values()]
        queue.clear()
        for (const cb of due) cb(0)
      },
      restore() { raf.mockRestore(); caf.mockRestore() },
    }
    live.push(harness)
    return harness
  }

  // Restored HERE, not at the end of the test body. `vitest.config.ts` sets
  // `clearMocks` but NOT `restoreMocks`, and `clearMocks` wipes call history
  // while leaving the IMPLEMENTATION in place — so one failing assertion before
  // a straight-line `restore()` would leave `window.requestAnimationFrame`
  // replaced for every later test in this file, turning one red into a cascade
  // of unrelated ones.
  const live: { restore(): void }[] = []
  afterEach(() => {
    for (const h of live.splice(0)) h.restore()
  })

  function fakeViewer(opts: { failAdd?: number; recolourable?: boolean } = {}) {
    let failsLeft = opts.failAdd ?? 0
    let viewFailsLeft = 0
    const shapes: unknown[] = []
    const viewer = {
      shapes,
      addCalls: 0,
      removeCalls: 0,
      renders: 0,
      callback: null as ((view: unknown) => void) | null,
      getSurface: () => new SurfaceLike([{ geo: { geometryGroups: [prismGroup()] } }]),
      // Mutable so a test can move the CUT, which is what makes the plane key
      // differ — and therefore the only way past the per-plane latch, which is
      // exactly the retry storm pinned below. Moving the CAMERA would not: while
      // the near floor is inactive the `center` terms cancel, as the
      // `cutPlaneFrom` suite above pins, so a test that varied the zoom would
      // re-attempt one single plane and prove nothing about the bound.
      slabNear: 0,
      /** Make the NEXT `getView` throw, i.e. fail before there is a plane key. */
      failViewOnce: () => { viewFailsLeft++ },
      getView: () => {
        if (viewFailsLeft > 0) { viewFailsLeft--; throw new Error('viewer gone') }
        return [0, 0, 0, 0, 0, 0, 0, 1]
      },
      getSlab: () => ({ near: viewer.slabNear, far: 200 }),
      getPerceivedDistance: () => 100,
      addCustom: (spec: unknown) => {
        viewer.addCalls++
        if (failsLeft > 0) { failsLeft--; throw new Error('context lost') }
        // 3Dmol returns the GLShape it built, not the spec it was given, and
        // `updateStyle` on that object is what a recolour uses. `recolourable:
        // false` models a 3Dmol that does not offer it, which must fall back to
        // rebuilding rather than throw inside a drag.
        const built = { ...(spec as Record<string, unknown>) } as {
          color: string
          opacity: number
          /** Every spec the fill path sends, so a test can prove what it carried. */
          styleSpecs?: { color: string; opacity: number }[]
          updateStyle?: (next: { color: string; opacity: number }) => void
        }
        if (opts.recolourable !== false) {
          built.styleSpecs = []
          // Both fields, the way the real `updateFromStyle` re-derives both from
          // the merged spec — so a call that omits one is visible here rather
          // than silently keeping the old value the way a partial copy would.
          built.updateStyle = (next: { color: string; opacity: number }) => {
            built.styleSpecs?.push(next)
            built.color = next.color
            built.opacity = next.opacity
          }
        }
        shapes.push(built)
        return built
      },
      removeShape: (shape: unknown) => {
        viewer.removeCalls++
        const at = shapes.indexOf(shape)
        if (at >= 0) shapes.splice(at, 1)
      },
      render: () => { viewer.renders++ },
      setViewChangeCallback: (cb: ((view: unknown) => void) | null) => { viewer.callback = cb },
    }
    return viewer
  }

  const ON = (surface: { id: number }) =>
    ({ surface, enabled: true, opacity: 1, ortho: false, color: CAP_COLOR_DEFAULT })

  it('draws exactly one cap, and removes it on dispose', () => {
    const viewer = fakeViewer()
    const cap = createSectionCap(viewer)
    cap.update(ON({ id: 1 }))

    expect(viewer.shapes).toHaveLength(1)
    cap.dispose()
    expect(viewer.shapes).toHaveLength(0)
    expect(viewer.callback).toBeNull()
  })

  it('moves the drawn cap\'s bounding sphere onto the cap (PT-1298 item 5)', () => {
    // The helper's own suite below pins the arithmetic; this pins that the
    // build actually calls it on the shape `addCustom` returned. The sphere is
    // seeded off the cap, so a build that skipped the call leaves it there.
    const viewer = fakeViewer()
    const add = viewer.addCustom
    const sphere = {
      center: { x: 7, y: 8, z: 9, set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z } },
      radius: 4,
    }
    viewer.addCustom = (spec: unknown) => Object.assign(add(spec), { boundingSphere: sphere })
    const cap = createSectionCap(viewer)
    cap.update(ON({ id: 1 }))

    expect(viewer.shapes).toHaveLength(1)
    // The prism's cut at z = 0 is the square -1..1 in x and y; the cap sits a
    // hair behind the plane, hence close-to rather than equal on z.
    expect(sphere.center.x).toBe(0)
    expect(sphere.center.y).toBe(0)
    expect(sphere.center.z).toBeCloseTo(0, 1)
    expect(sphere.radius).toBe(0)
  })

  it('draws the cut face in the chosen preset', () => {
    const viewer = fakeViewer()
    const cap = createSectionCap(viewer)
    cap.update({ ...ON({ id: 1 }), color: 'firebrick' })

    // The fake has no `container`, so the `--sv3d-cap-*` lookup cannot resolve
    // and the preset KEY is used instead — which is the whole reason every
    // preset name is also a CSS colour keyword (DESIGN.md §6.2.1).
    expect(viewer.shapes).toHaveLength(1)
    expect((viewer.shapes[0] as { color: string }).color).toBe('firebrick')
  })

  it('prefers the stylesheet over the key when there is an element to read', () => {
    const container = document.createElement('div')
    container.style.setProperty('--sv3d-cap-steelblue', 'rgb(1, 2, 3)')
    // `Object.assign` rather than a spread: the fake's methods close over the
    // object they were built on, so a copy would count its calls elsewhere.
    const viewer = Object.assign(fakeViewer(), { container })
    const cap = createSectionCap(viewer)
    cap.update({ ...ON({ id: 1 }), color: 'steelblue' })

    expect((viewer.shapes[0] as { color: string }).color).toBe('rgb(1, 2, 3)')
  })

  it('passes a colour the user mixed straight through', () => {
    const viewer = fakeViewer()
    const cap = createSectionCap(viewer)
    cap.update({ ...ON({ id: 1 }), color: '#4A90D9' })

    expect((viewer.shapes[0] as { color: string }).color).toBe('#4A90D9')
  })

  it('refuses a fill that is neither a preset nor a colour', () => {
    // Only reachable from a hand-edited blob that got past `sanitizeDepthCue`,
    // but `addCustom` draws whatever it is handed and 3Dmol resolves anything it
    // cannot parse to BLACK — which over a white surface reads as a hole rather
    // than as a cut face, i.e. the exact picture an explicit colour exists to
    // prevent.
    const viewer = fakeViewer()
    const cap = createSectionCap(viewer)
    cap.update({ ...ON({ id: 1 }), color: 'rebeccapurple' })

    expect((viewer.shapes[0] as { color: string }).color).toBe('lightgray')
  })

  it('recolours the cut face in place, without cutting or uploading again', () => {
    // The whole reason the colour is not part of the plane key: 3Dmol re-reads
    // `shape.color` through `globj` on every render, so a repaint is the entire
    // job. A second `addCustom` here would mean the geometry was re-uploaded for
    // a change that is not geometry.
    const viewer = fakeViewer()
    const surface = { id: 1 }
    const cap = createSectionCap(viewer)
    cap.update(ON(surface))
    expect(viewer.addCalls).toBe(1)
    const rendersAfterFirst = viewer.renders

    cap.update({ ...ON(surface), color: 'seagreen' })

    expect(viewer.addCalls).toBe(1)
    expect(viewer.removeCalls).toBe(0)
    expect(viewer.shapes).toHaveLength(1)
    expect((viewer.shapes[0] as { color: string }).color).toBe('seagreen')
    // ...and it repainted, or the new colour would sit in the shape unseen.
    expect(viewer.renders).toBeGreaterThan(rendersAfterFirst)
  })

  it('falls back to a rebuild when the shape cannot be recoloured', () => {
    // A 3Dmol that renamed or dropped `updateStyle`. The cut face must still
    // change colour — more expensively, never not at all.
    const viewer = fakeViewer({ recolourable: false })
    const surface = { id: 1 }
    const cap = createSectionCap(viewer)
    cap.update(ON(surface))
    expect(viewer.addCalls).toBe(1)

    cap.update({ ...ON(surface), color: 'seagreen' })

    expect(viewer.addCalls).toBe(2)
    expect(viewer.removeCalls).toBe(1)
    expect(viewer.shapes).toHaveLength(1)
    expect((viewer.shapes[0] as { color: string }).color).toBe('seagreen')
  })

  it('does nothing when the same colour is asserted again', () => {
    // The plane has not moved and neither has the colour. This is the branch the
    // view-change callback lands on after every repaint, so a rebuild here would
    // re-enter the render loop the module exists to terminate.
    const viewer = fakeViewer()
    const surface = { id: 1 }
    const cap = createSectionCap(viewer)
    cap.update(ON(surface))
    const renders = viewer.renders

    cap.update(ON(surface))

    expect(viewer.addCalls).toBe(1)
    expect(viewer.removeCalls).toBe(0)
    expect(viewer.renders).toBe(renders)
  })

  it('does not invent a cut face for a plane that had none', () => {
    // A plane past the whole molecule is a COMPLETED build that drew nothing —
    // not a failure. Recolouring it must stay nothing: there is no shape on the
    // scene, so there is nothing for the colour path to repaint.
    const viewer = fakeViewer()
    const surface = { id: 1 }
    const cap = createSectionCap(viewer)

    // A real cap FIRST, so there is a cached mesh to wrongly resurrect. Without
    // this the case is vacuous: nothing has been built, so keeping the cache
    // would look identical to clearing it.
    cap.update(ON(surface))
    expect(viewer.shapes).toHaveLength(1)

    viewer.slabNear = -1000
    cap.update(ON(surface))
    expect(viewer.shapes).toHaveLength(0)
    const afterMiss = viewer.addCalls

    cap.update({ ...ON(surface), color: 'firebrick' })

    expect(viewer.shapes).toHaveLength(0)
    expect(viewer.addCalls).toBe(afterMiss)
  })

  it('does not loop when the upload throws', () => {
    // The round-1 defect: the failure path cleared `lastKey`, so the repaint it
    // triggered brought the view-change hook back to the SAME plane, which
    // rebuilt, threw and repainted again — bounded by nothing.
    const viewer = fakeViewer({ failAdd: 99 })
    const frames = captureFrames()
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const cap = createSectionCap(viewer)
    // The SAME handle throughout: a new one legitimately means a new build
    // finished, which is a new attempt, not a repeat of the one that failed.
    const surface = { id: 1 }

    cap.update(ON(surface))
    const afterFirst = viewer.addCalls
    // The real path, not a stand-in: the hook queues a frame, and the frame is
    // where the rebuild lives. Flushed repeatedly because the defect was that
    // each attempt repainted, and each repaint queued the next one.
    for (let i = 0; i < 5; i++) {
      viewer.callback?.([])
      frames.flush()
    }
    cap.update(ON(surface))

    expect(afterFirst).toBe(1)
    expect(viewer.addCalls).toBe(1)
    expect(viewer.shapes).toHaveLength(0)
    // Nothing left queued: a blocked rebuild reports no change, so it never
    // repaints, so it never schedules the next frame.
    expect(frames.pending).toBe(0)
    cap.dispose()
    spy.mockRestore()
  })

  it('stops rebuilding after a bounded run of consecutive failures', () => {
    // The round-3 defect, and the other end of the same axis. Latching the
    // PLANE fixed the same-plane loop above, but every distinct camera position
    // is a distinct plane, so a viewer that throws on every build turned one
    // drag into a full weld + cut + upload per frame. Nothing here repeats a
    // plane; the bound is the only thing that can stop it.
    const viewer = fakeViewer({ failAdd: 99 })
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warns = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const cap = createSectionCap(viewer)
    const surface = { id: 1 }

    for (let i = 0; i < 20; i++) {
      // 0 .. 0.95, so every plane still crosses the prism. One that missed it
      // would be a completed build with nothing to draw — a success, which
      // resets the counter under test.
      viewer.slabNear = -i * 0.05
      cap.update(ON(surface))
    }

    expect(viewer.addCalls).toBe(MAX_CAP_BUILD_FAILURES)
    expect(viewer.shapes).toHaveLength(0)
    // Once, when it gave up — not once per refused frame.
    expect(warns).toHaveBeenCalledTimes(1)
    cap.dispose()
    warns.mockRestore()
    errors.mockRestore()
  })

  it('retries a failed cut face when a different fill is picked', () => {
    // One transient throw latches `failedKey` for this plane. The colour row is
    // the only control the user is touching, so picking a fill has to count as
    // the retry — otherwise the cut face cannot come back without a camera move
    // or a chip re-tick.
    const viewer = fakeViewer({ failAdd: 1 })
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const cap = createSectionCap(viewer)
    const surface = { id: 1 }

    cap.update(ON(surface))
    expect(viewer.shapes).toHaveLength(0)

    cap.update({ ...ON(surface), color: 'firebrick' })

    expect(viewer.shapes).toHaveLength(1)
    expect((viewer.shapes[0] as { color: string }).color).toBe('firebrick')
    cap.dispose()
    errors.mockRestore()
  })

  it('does not let a colour drag defeat the failure breaker', () => {
    // The other direction of the same rule, and the reason the retry clears the
    // plane latch ONLY. `update()` runs once per value the colour dialog emits —
    // once per pointer move — so re-arming the counter here would mean it can
    // never reach the bound, and a drag against a dead viewer would re-cut and
    // log per frame for the whole gesture.
    const viewer = fakeViewer({ failAdd: 99 })
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warns = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const cap = createSectionCap(viewer)
    const surface = { id: 1 }

    cap.update(ON(surface))
    // 20 values, about what one sweep inside the colour dialog emits.
    for (let i = 0; i < 20; i++) {
      cap.update({ ...ON(surface), color: i % 2 ? '#112233' : '#445566' })
    }

    expect(viewer.addCalls).toBe(MAX_CAP_BUILD_FAILURES)
    cap.dispose()
    warns.mockRestore()
    errors.mockRestore()
  })

  it('reports the removal even when the run that removed it then throws', () => {
    // `removeShape` only detaches; it does not draw. A removal the run fails to
    // report is a removal nothing repaints, so the last painted frame — cut face
    // and all — stays on the canvas over a plane that no longer has one.
    const viewer = fakeViewer()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const cap = createSectionCap(viewer)
    const surface = { id: 1 }

    cap.update(ON(surface))
    expect(viewer.shapes).toHaveLength(1)
    const paintedWithCap = viewer.renders

    // A NEW plane, so the run clears the old cap and then fails to build one.
    viewer.addCustom = () => { viewer.addCalls++; throw new Error('context lost') }
    viewer.slabNear = -0.4
    cap.update(ON(surface))

    expect(viewer.shapes).toHaveLength(0)
    expect(viewer.renders).toBeGreaterThan(paintedWithCap)
    errors.mockRestore()
  })

  it('comes back after the breaker trips, once the chip is re-ticked', () => {
    // The breaker must not become the sticky surface latch it replaced. A user
    // whose WebGL context was restored has exactly one discoverable move, and
    // it has to work.
    const viewer = fakeViewer({ failAdd: MAX_CAP_BUILD_FAILURES })
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warns = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const cap = createSectionCap(viewer)
    const surface = { id: 1 }

    for (let i = 0; i < 10; i++) {
      viewer.slabNear = -i * 0.05
      cap.update(ON(surface))
    }
    expect(viewer.shapes).toHaveLength(0)
    expect(viewer.addCalls).toBe(MAX_CAP_BUILD_FAILURES)

    cap.update({ surface, enabled: false, opacity: 1, ortho: false, color: CAP_COLOR_DEFAULT })
    cap.update(ON(surface))

    expect(viewer.shapes).toHaveLength(1)
    cap.dispose()
    warns.mockRestore()
    errors.mockRestore()
  })

  it('does not disarm the latch when the throw happens before the plane exists', () => {
    // `getView` on a viewer being torn down throws before there IS a key. The
    // catch used to write that null over the live latch, re-arming the plane
    // that was actually failing — so one unrelated transient throw put the
    // expensive rebuild back on the very next frame.
    const viewer = fakeViewer({ failAdd: 1 })
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const cap = createSectionCap(viewer)
    const surface = { id: 1 }

    cap.update(ON(surface))          // plane A fails at addCustom -> latched
    expect(viewer.addCalls).toBe(1)

    viewer.failViewOnce()            // a throw that never reaches a key
    cap.update(ON(surface))
    expect(viewer.addCalls).toBe(1)

    cap.update(ON(surface))          // back at plane A, and still latched
    expect(viewer.addCalls).toBe(1)
    expect(viewer.shapes).toHaveLength(0)

    cap.dispose()
    errors.mockRestore()
  })

  it('gives a failed surface another chance when the chip is re-ticked', () => {
    // Latching the SURFACE meant one transient throw removed the cut face for
    // the rest of that surface's life, with the chip still reading pressed.
    const viewer = fakeViewer({ failAdd: 1 })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const cap = createSectionCap(viewer)
    const surface = { id: 1 }

    cap.update(ON(surface))
    expect(viewer.shapes).toHaveLength(0)

    cap.update({ surface, enabled: false, opacity: 1, ortho: false, color: CAP_COLOR_DEFAULT })
    cap.update(ON(surface))

    expect(viewer.shapes).toHaveLength(1)
    spy.mockRestore()
  })

  it('repaints when losing the surface takes the cap off the scene', () => {
    // `removeShape` only detaches from the model group — it does not draw. So a
    // removal with no render after it leaves the LAST PAINTED FRAME, cap and
    // all, on the canvas over a surface that no longer exists. `rebuild()`
    // cannot report the removal either: it re-clears an already-empty slot and
    // returns false. Reachable whenever a caller's `removeAllSurfaces` drops
    // the page's handle.
    const viewer = fakeViewer()
    const cap = createSectionCap(viewer)
    const surface = { id: 1 }

    cap.update(ON(surface))
    expect(viewer.shapes).toHaveLength(1)
    const paintedWithCap = viewer.renders

    cap.update({ surface: null, enabled: true, opacity: 1, ortho: false, color: CAP_COLOR_DEFAULT })

    expect(viewer.shapes).toHaveLength(0)
    expect(viewer.renders).toBeGreaterThan(paintedWithCap)
    cap.dispose()
  })

  it('re-reads the mesh for a NEW handle carrying the same id', () => {
    // 3Dmol recycles ids, so the number cannot say "this build finished".
    const viewer = fakeViewer()
    const cap = createSectionCap(viewer)

    cap.update(ON({ id: 1 }))
    const first = viewer.addCalls
    cap.update(ON({ id: 1 }))

    expect(first).toBe(1)
    expect(viewer.addCalls).toBe(2)
    expect(viewer.shapes).toHaveLength(1)
  })

  it('draws nothing, and stays quiet, when the cap is off', () => {
    const viewer = fakeViewer()
    const cap = createSectionCap(viewer)
    cap.update({ surface: { id: 1 }, enabled: false, opacity: 1, ortho: false, color: CAP_COLOR_DEFAULT })
    expect(viewer.addCalls).toBe(0)
    expect(viewer.shapes).toHaveLength(0)
  })

  describe('the cut face\'s own opacity', () => {
    it('draws the cut face at exactly the opacity the caller resolved', () => {
      // A NUMBER, not a boolean this module turns back into one of two
      // constants: "follow the surface" is a decision the caller makes, and
      // duplicating it here is how the two would come to disagree.
      const viewer = fakeViewer()
      const cap = createSectionCap(viewer)
      cap.update({ ...ON({ id: 1 }), opacity: 0.35 })

      expect((viewer.shapes[0] as { opacity: number }).opacity).toBe(0.35)
    })

    it('changes the opacity in place, without cutting or uploading again', () => {
      // Same reasoning as the colour, and the reason the surface's `opaque` came
      // OUT of the plane key: `globj` rebuilds the material from `shape.opacity`
      // on every render, so a repaint is the whole job. Left in the key, the
      // mesh would be re-cut once per pointer move of the opacity slider.
      const viewer = fakeViewer()
      const surface = { id: 1 }
      const cap = createSectionCap(viewer)
      cap.update(ON(surface))
      expect(viewer.addCalls).toBe(1)
      const rendersAfterFirst = viewer.renders

      cap.update({ ...ON(surface), opacity: 0.5 })

      expect(viewer.addCalls).toBe(1)
      expect(viewer.removeCalls).toBe(0)
      expect((viewer.shapes[0] as { opacity: number }).opacity).toBe(0.5)
      expect(viewer.renders).toBeGreaterThan(rendersAfterFirst)
    })

    it('always sends the COLOUR with the opacity, never the opacity alone', () => {
      // `updateFromStyle` resolves an ABSENT colour to black. The shape's own
      // merged stylespec happens to save us today, but a spec that stopped
      // carrying the colour would paint a black hole in the surface, silently.
      const viewer = fakeViewer()
      const surface = { id: 1 }
      const cap = createSectionCap(viewer)
      cap.update(ON(surface))

      cap.update({ ...ON(surface), opacity: 0.5 })

      const specs = (viewer.shapes[0] as {
        styleSpecs?: { color: string; opacity: number }[]
      }).styleSpecs
      expect(specs).toHaveLength(1)
      expect(typeof specs?.[0].color).toBe('string')
      expect(specs?.[0].color.length).toBeGreaterThan(0)
      expect(specs?.[0].opacity).toBe(0.5)
    })

    it('does nothing when the same opacity is asserted again', () => {
      // The branch the view-change callback lands on after every repaint. A
      // rebuild here re-enters the render loop this module exists to terminate.
      const viewer = fakeViewer()
      const surface = { id: 1 }
      const cap = createSectionCap(viewer)
      cap.update({ ...ON(surface), opacity: 0.5 })
      const renders = viewer.renders

      cap.update({ ...ON(surface), opacity: 0.5 })

      expect(viewer.addCalls).toBe(1)
      expect(viewer.renders).toBe(renders)
    })

    it('falls back to a rebuild when the shape cannot be restyled', () => {
      // A 3Dmol that renamed or dropped `updateStyle`: the cut face must still
      // change opacity — more expensively, never not at all.
      const viewer = fakeViewer({ recolourable: false })
      const surface = { id: 1 }
      const cap = createSectionCap(viewer)
      cap.update(ON(surface))
      expect(viewer.addCalls).toBe(1)

      cap.update({ ...ON(surface), opacity: 0.5 })

      expect(viewer.addCalls).toBe(2)
      expect(viewer.shapes).toHaveLength(1)
      expect((viewer.shapes[0] as { opacity: number }).opacity).toBe(0.5)
    })

    it('changes colour and opacity together in ONE restyle', () => {
      const viewer = fakeViewer()
      const surface = { id: 1 }
      const cap = createSectionCap(viewer)
      cap.update(ON(surface))

      cap.update({ ...ON(surface), color: 'seagreen', opacity: 0.2 })

      const shape = viewer.shapes[0] as {
        color: string
        opacity: number
        styleSpecs?: unknown[]
      }
      expect(shape.color).toBe('seagreen')
      expect(shape.opacity).toBe(0.2)
      expect(shape.styleSpecs).toHaveLength(1)
      expect(viewer.addCalls).toBe(1)
    })
  })
})

describe('centreBoundingSphere (PT-1298 item 5)', () => {
  // 3Dmol leaves a non-clickable custom shape's sphere at the origin, and Reset
  // View folds it into the extent: a crystal structure far from (0, 0, 0) was
  // framed out to the origin whenever a cut face was on.
  const sphereDouble = () => {
    const center = { x: 0, y: 0, z: 0, set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z } }
    return { boundingSphere: { center, radius: 0 } }
  }

  it('moves the sphere to the middle of the cap, radius left at 0', () => {
    const shape = sphereDouble()
    centreBoundingSphere(shape, new Float32Array([40, 50, 60, 44, 52, 70, 42, 58, 64]))
    expect(shape.boundingSphere.center).toMatchObject({ x: 42, y: 54, z: 65 })
    expect(shape.boundingSphere.radius).toBe(0)
  })

  it('leaves a shape without a settable sphere alone', () => {
    expect(() => centreBoundingSphere({}, new Float32Array([1, 2, 3]))).not.toThrow()
    expect(() => centreBoundingSphere(null, new Float32Array([1, 2, 3]))).not.toThrow()
  })
})
