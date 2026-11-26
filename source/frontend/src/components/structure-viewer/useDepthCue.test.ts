/**
 * useDepthCue — the controller a viewer page drives its depth cue with.
 *
 * The bar's own tests run against a harness that re-implements this contract,
 * which proves the BAR wires its callbacks correctly and nothing about the
 * shipped hook. These are the assertions that make the difference: the
 * live-vs-persisted split (what stops a drag writing localStorage per frame),
 * the gesture cancel, and the measurement cache — including the one case where
 * it must NOT cache.
 */
import { act, renderHook } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

import { DEPTH_CUE_DEFAULT, MIN_SPAN_A, type DepthCue } from './depthCue'
import { useDepthCue } from './useDepthCue'

/** The stub answers `getSlab` with far = 50, i.e. a 100 Å span. */
function stubViewer(far: number | (() => number) = 50) {
  return {
    fitSlab: vi.fn(),
    getSlab: vi.fn(() => ({ near: -50, far: typeof far === 'function' ? far() : far })),
    setSlab: vi.fn(),
    enableFog: vi.fn(),
    setProjection: vi.fn(),
    render: vi.fn(),
  }
}

function mount(viewer: ReturnType<typeof stubViewer> | null = stubViewer(), densityShown = false) {
  const viewerInstanceRef = { current: viewer }
  const view = renderHook(
    ({ epoch, densityShown: shown }: { epoch: number; densityShown: boolean }) =>
      useDepthCue({ viewerInstanceRef, viewerEpoch: epoch, densityShown: shown }),
    { initialProps: { epoch: 1, densityShown } },
  )
  return { ...view, viewerInstanceRef }
}

const sliced: DepthCue = { ...DEPTH_CUE_DEFAULT, slab: true, cut: 0.3 }

describe('live vs persisted', () => {
  it('setCue moves what the canvas shows and leaves the persisted value alone', () => {
    // This split IS the localStorage fix: the pages persist `persistedCue`, so
    // a drag that only calls setCue cannot write the blob.
    const { result } = mount()
    act(() => result.current.setCue(sliced))
    expect(result.current.cue).toEqual(sliced)
    expect(result.current.persistedCue).toEqual(DEPTH_CUE_DEFAULT)
  })

  it('commit moves both', () => {
    const { result } = mount()
    act(() => result.current.commit(sliced))
    expect(result.current.cue).toEqual(sliced)
    expect(result.current.persistedCue).toEqual(sliced)
  })

  it('cancelGesture puts the canvas back to the committed value', () => {
    // touchcancel: the system took the gesture over, so the in-progress value
    // was never chosen.
    const { result } = mount()
    act(() => result.current.commit({ ...DEPTH_CUE_DEFAULT, slab: true, cut: 0.1 }))
    act(() => result.current.setCue({ ...DEPTH_CUE_DEFAULT, slab: true, cut: 0.8 }))
    act(() => result.current.cancelGesture())
    expect(result.current.cue.cut).toBe(0.1)
    expect(result.current.persistedCue.cut).toBe(0.1)
  })

  it('a cancelGesture captured renders ago still returns to the LATEST commit (PT-4272)', () => {
    // The bar's picker cleanup calls the copy from the last render it drew; on
    // a structure switch that runs after `resetForStructureChange`.
    const { result } = mount()
    act(() => result.current.commit(sliced))
    const stale = result.current.cancelGesture
    act(() => result.current.setCue({ ...sliced, cut: 0.6 }))
    act(() => result.current.resetForStructureChange())
    act(() => stale())
    expect(result.current.cue).toEqual(DEPTH_CUE_DEFAULT)
  })

  it('cancelGesture is a no-op when nothing was in progress', () => {
    const { result } = mount()
    act(() => result.current.commit(sliced))
    const before = result.current.cue
    act(() => result.current.cancelGesture())
    expect(result.current.cue).toBe(before)
  })
})

describe('the measurement cache', () => {
  it('measures once, however many times the settings move', () => {
    // `measureSpan` calls 3Dmol's `fitSlab({})`, which walks every atom. Doing
    // that per pointer move is the cost the cache exists to remove.
    const viewer = stubViewer()
    const { result } = mount(viewer)
    expect(viewer.fitSlab).toHaveBeenCalledTimes(1)
    expect(result.current.spanA).toBe(100)

    for (const cut of [0.1, 0.2, 0.3, 0.4]) {
      act(() => result.current.setCue({ ...DEPTH_CUE_DEFAULT, slab: true, cut }))
    }
    expect(viewer.fitSlab).toHaveBeenCalledTimes(1)
  })

  it('accepts 3Dmol’s clamped floor as a real measurement', () => {
    // Regression: `fitSlab` clamps maxD to 5 before halving, so a tiny model
    // reports far = 2.5. A strict `>` rejected that as unmeasurable, which left
    // the captions blank AND re-ran the atom walk every drag frame.
    const viewer = stubViewer(2.5)
    const { result } = mount(viewer)
    expect(result.current.spanA).toBe(MIN_SPAN_A)
    act(() => result.current.setCue(sliced))
    expect(viewer.fitSlab).toHaveBeenCalledTimes(1)
  })

  it('does NOT cache a failed measurement, and measures again later', () => {
    // The other half: caching the floor for a model that merely was not ready
    // would describe a full-size protein as 5 Å for the life of the viewer.
    let ready = false
    const viewer = stubViewer()
    viewer.getSlab = vi.fn(() => {
      if (!ready) throw new Error('getExtent on a half-built model')
      return { near: -50, far: 50 }
    })
    const { result } = mount(viewer)
    expect(result.current.spanA).toBeNull()

    ready = true
    act(() => result.current.setCue(sliced))
    expect(result.current.spanA).toBe(100)
  })

  it('onViewerCleared drops the measurement so the next model is measured', () => {
    const viewer = stubViewer()
    const { result } = mount(viewer)
    expect(result.current.spanA).toBe(100)

    act(() => result.current.onViewerCleared())
    expect(result.current.spanA).toBeNull()
    act(() => result.current.setCue(sliced))
    expect(viewer.fitSlab).toHaveBeenCalledTimes(2)
  })
})

describe('applying to the viewer', () => {
  it('asserts the settings whenever they change', () => {
    const viewer = stubViewer()
    const { result } = mount(viewer)
    const before = viewer.setSlab.mock.calls.length
    act(() => result.current.setCue(sliced))
    expect(viewer.setSlab.mock.calls.length).toBeGreaterThan(before)
  })

  it('writes nothing after a camera move while every control is off', () => {
    // A selection `zoomTo` leaves 3Dmol's own tight slab; writing the resting
    // window over it would widen a ligand-focus view for a user who never
    // touched these controls.
    //
    // `onViewerCleared()` first, and that is load-bearing: with the span still
    // cached from mount, `apply` never reaches `measureSpan` whether or not the
    // hook's early return exists, so the `fitSlab` assertion below could not
    // fail — and the `setSlab` half would be upheld by `applyDepthCue`'s own
    // duplicate guard rather than by the hook. Uncached, this case is the only
    // thing that holds the ORDERING the guard exists for.
    const viewer = stubViewer()
    const { result } = mount(viewer)
    act(() => result.current.onViewerCleared())
    viewer.setSlab.mockClear()
    viewer.fitSlab.mockClear()

    act(() => result.current.applyAfterCamera(viewer))
    expect(viewer.setSlab).not.toHaveBeenCalled()
    // …and it decides BEFORE measuring, since `fitSlab` clobbers the slab.
    expect(viewer.fitSlab).not.toHaveBeenCalled()
  })

  it('re-asserts after a camera move once something IS on', () => {
    const viewer = stubViewer()
    const { result } = mount(viewer)
    act(() => result.current.commit(sliced))
    viewer.setSlab.mockClear()

    act(() => result.current.applyAfterCamera(viewer))
    expect(viewer.setSlab).toHaveBeenCalledTimes(1)
  })

  it('re-asserts against a rebuilt viewer when the epoch bumps', () => {
    const viewer = stubViewer()
    const { result, rerender } = mount(viewer)
    act(() => result.current.commit(sliced))
    viewer.setSlab.mockClear()

    rerender({ epoch: 2, densityShown: false })
    expect(viewer.setSlab).toHaveBeenCalled()
  })

  it('reassert writes the whole cue even when nothing in it changed', () => {
    // PT-2044 item 1. A stored view's restore commits a cue equal to the current
    // one, so the settings effect has nothing to run for — and after a ligand
    // focus left 3Dmol's tight slab, the restored full view drew a thin slice.
    // `reassert` is the call the restore makes after `setView`.
    const viewer = stubViewer()
    const { result } = mount(viewer)
    act(() => result.current.commit({ ...DEPTH_CUE_DEFAULT }))
    viewer.setSlab.mockClear()
    viewer.setProjection.mockClear()

    act(() => result.current.reassert(viewer))
    // The resting window `zoomTo({})` leaves, for the 100 Å stub.
    expect(viewer.setSlab).toHaveBeenCalledWith(-200, 200)
    expect(viewer.setProjection).toHaveBeenLastCalledWith('perspective')
  })

  it('writes the projection once per rebuilt viewer, not twice', () => {
    // PT-2044 item 6: the full re-apply already writes it on every epoch.
    const viewer = stubViewer()
    const { rerender } = mount(viewer)
    viewer.setProjection.mockClear()
    rerender({ epoch: 2, densityShown: false })
    expect(viewer.setProjection).toHaveBeenCalledTimes(1)
  })

  it('survives a viewer that throws, rather than taking the page down', () => {
    const viewer = stubViewer()
    viewer.setSlab = vi.fn(() => { throw new Error('context lost') })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result } = mount(viewer)
    expect(() => act(() => result.current.setCue(sliced))).not.toThrow()
    vi.restoreAllMocks()
  })
})

describe('the projection (PT-1299)', () => {
  it('turns orthographic when a density map appears, and back when it goes', () => {
    const viewer = stubViewer()
    const { rerender } = mount(viewer)
    expect(viewer.setProjection).toHaveBeenLastCalledWith('perspective')

    rerender({ epoch: 1, densityShown: true })
    expect(viewer.setProjection).toHaveBeenLastCalledWith('orthographic')
    rerender({ epoch: 1, densityShown: false })
    expect(viewer.setProjection).toHaveBeenLastCalledWith('perspective')
  })

  it('switches the projection without rewriting the slab', () => {
    // At rest a rewrite means the resting window, which REPLACES the tight slab
    // a ligand focus's `zoomTo` left — the same widening the camera-move guard
    // prevents, reached from the settings side. Holds for the density and for
    // the chip alike.
    const viewer = stubViewer()
    const { result, rerender } = mount(viewer)
    viewer.setSlab.mockClear()
    viewer.enableFog.mockClear()

    rerender({ epoch: 1, densityShown: true })
    act(() => result.current.commit({ ...DEPTH_CUE_DEFAULT, ortho: false }))
    expect(viewer.setProjection).toHaveBeenLastCalledWith('perspective')
    expect(viewer.setSlab).not.toHaveBeenCalled()
    expect(viewer.enableFog).not.toHaveBeenCalled()
  })

  it('keeps a projection set by hand while the density comes and goes', () => {
    const viewer = stubViewer()
    const { result, rerender } = mount(viewer, true)
    act(() => result.current.commit({ ...DEPTH_CUE_DEFAULT, ortho: false }))
    rerender({ epoch: 1, densityShown: false })
    rerender({ epoch: 1, densityShown: true })
    expect(viewer.setProjection).toHaveBeenLastCalledWith('perspective')
  })

  it('writes nothing after a camera move when only the projection is set', () => {
    // Regression: orthographic used to count as "something on" here, so with it
    // set every ligand focus lost its tight slab.
    const viewer = stubViewer()
    const { result } = mount(viewer, true)
    act(() => result.current.commit({ ...DEPTH_CUE_DEFAULT, ortho: true }))
    viewer.setSlab.mockClear()
    act(() => result.current.applyAfterCamera(viewer))
    expect(viewer.setSlab).not.toHaveBeenCalled()
  })

  it('writes the density-following projection on a full re-assert too', () => {
    // A camera move with fog on goes through `applyDepthCue`, which writes the
    // projection as well — it must be the one the density picks.
    const viewer = stubViewer()
    const { result } = mount(viewer, true)
    act(() => result.current.commit({ ...DEPTH_CUE_DEFAULT, fog: true }))
    viewer.setProjection.mockClear()
    act(() => result.current.applyAfterCamera(viewer))
    expect(viewer.setSlab).toHaveBeenCalled()
    expect(viewer.setProjection).toHaveBeenLastCalledWith('orthographic')
  })

  it('frames each new viewer’s orthographic camera', () => {
    // `installOrthoFraming` is tested against the real library in its own
    // suite; this pins that the hook installs it on every instance it is given.
    const own = vi.fn()
    const framable = {
      ...stubViewer(),
      setSlabAndFog: own,
      camera: {
        ortho: false, fov: 20, aspect: 1, position: { z: 150 },
        top: 0, bottom: 0, left: 0, right: 0, updateProjectionMatrix: vi.fn(),
      },
      rotationGroup: { position: { z: 50 } },
    }
    mount(framable)
    expect(framable.setSlabAndFog).not.toBe(own)
  })

  it('frames a new instance re-asserted after a camera call before its epoch bumps', () => {
    // PT-2044 item 5. A caller may call `applyAfterCamera` on a fresh viewer
    // and only then bump the epoch; the epoch effect has not framed it yet, so
    // this call has to, or the first orthographic write draws one shrunken frame.
    const viewer = stubViewer()
    const { result } = mount(viewer)
    act(() => result.current.commit({ ...DEPTH_CUE_DEFAULT, fog: true, ortho: true }))
    const own = vi.fn()
    const fresh = {
      ...stubViewer(),
      setSlabAndFog: own,
      camera: {
        ortho: false, fov: 20, aspect: 1, position: { z: 150 },
        top: 0, bottom: 0, left: 0, right: 0, updateProjectionMatrix: vi.fn(),
      },
      rotationGroup: { position: { z: 50 } },
    }
    let framedAtWrite: boolean | null = null
    fresh.setProjection = vi.fn(() => { framedAtWrite = fresh.setSlabAndFog !== own })

    act(() => result.current.applyAfterCamera(fresh))
    expect(fresh.setProjection).toHaveBeenCalledWith('orthographic')
    expect(framedAtWrite).toBe(true)
  })
})

describe('leaving a structure', () => {
  it('resetForStructureChange returns both values to the defaults', () => {
    // A slice carried into the next protein is indistinguishable from missing
    // density, and the persisted copy has to go with it or the blob would still
    // hand the next page the previous structure's slice.
    const { result } = mount()
    act(() => result.current.commit(sliced))
    act(() => result.current.resetForStructureChange())
    expect(result.current.cue).toEqual(DEPTH_CUE_DEFAULT)
    expect(result.current.persistedCue).toEqual(DEPTH_CUE_DEFAULT)
  })
})
