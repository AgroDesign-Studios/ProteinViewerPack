/**
 * What the surface controller is FOR, pinned as behaviour.
 *
 * Two of these cases are the whole reason the module exists (PT-382 items 1 and
 * 2) and neither can be observed from a page test that only counts renders: an
 * Opaque press must not rebuild the mesh, and a burst of chip clicks must not
 * start a build per click. Everything else here exists because the paths that
 * fail SILENTLY outnumber the ones that throw — `setSurfaceMaterialStyle` on an
 * unknown id does nothing, and a build that never settles leaves the viewer
 * unable to draw a surface again for the life of the page.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Same boundary the sibling suite mocks: the real reporter drags errorCapture,
// the error reporter (mocked in unit tests), behind a leaf module.
vi.mock('./surfaceFailure', () => ({ reportSurfaceFailure: vi.fn() }))

import { reportSurfaceFailure } from './surfaceFailure'
import { applySurface, builtSurface, forgetBuiltSurface, forgetSurface, type SurfaceRequest } from './surfaceController'
// The four properties a 3Dmol surface double has to have, owned in one place
// so five suites cannot disagree about them again — the module's own docstring
// is the contract, and PT-423 item 3 is why it exists.
import {
  DOUBLE_SIDE,
  makeSurfaceStore,
  type SurfaceLike,
  type SurfacePart,
} from '../../test/surfaceDouble'

interface Settler {
  resolve: () => void
  reject: (reason: unknown) => void
}

/**
 * A 3Dmol viewer reduced to the calls this module makes, MODELLED rather than
 * merely counted.
 *
 * The four details the real one has that matter here, each of which a
 * count-only double hides:
 *  - `addSurface` returns a promise with `surfid` stamped on it SYNCHRONOUSLY;
 *  - `getSurface` answers with the surface's PARTS, from the same map
 *    `removeAllSurfaces` empties;
 *  - each part carries the material, and `addSurface` leaves its
 *    `side = DoubleSide` (a `MeshDoubleLambertMaterial`, since AgDB never sets
 *    `onesided`);
 *  - `setSurfaceMaterialStyle` rebuilds that material and then overwrites the
 *    side with `FrontSide` (`GLViewer.ts` ~4750).
 *
 * ⚠️ The last two are not decoration. A `vi.fn()` that only records the call
 * cannot see a restyle silently turning a translucent surface single-sided,
 * which is exactly what shipped through a full round of tests once.
 *
 * `settlers` exposes each in-flight build so a test can decide WHEN it finishes
 * — that timing is the subject of half this file.
 */
function makeViewer(opts: {
  getSurface?: boolean
  addSurfaceReturns?: 'promise' | 'nothing' | 'throw' | 'never'
  /** A viewer whose models the page has already cleared (teardown). */
  models?: boolean
  /** Parts per surface — a count, or the per-part `mat.side` values. */
  parts?: number | number[]
} = {}) {
  const calls: string[] = []
  const settlers: Settler[] = []
  const store = makeSurfaceStore()
  const surfaces = store.surfaces

  return {
    calls,
    settlers,
    surfaces,
    store,
    removeAllSurfaces: vi.fn(() => { calls.push('removeAllSurfaces'); store.removeAllSurfaces() }),
    setSurfaceMaterialStyle: vi.fn((id: number, ..._rest: unknown[]) => {
      calls.push('setSurfaceMaterialStyle')
      store.setSurfaceMaterialStyle(id)
    }),
    render: vi.fn(() => { calls.push('render') }),
    getModel: vi.fn(() => (opts.models === false ? null : { id: 'model' })),
    addSurface: vi.fn((..._args: unknown[]) => {
      calls.push('addSurface')
      if (opts.addSurfaceReturns === 'throw') throw new Error('no webgl')
      const surfid = store.addSurface(opts.parts ?? 1)
      if (opts.addSurfaceReturns === 'nothing') return undefined
      if (opts.addSurfaceReturns === 'never') {
        // The PT-382 item 5 shape, and the ONLY faithful model of it: 3Dmol
        // resolves once every extent has reported and rejects only from
        // `worker.onerror`, so a worker the browser kills settles the promise
        // NEITHER way. A thenable that never calls back, with the surfid still
        // stamped and the entry still registered — because the real one does
        // both before the first worker has said anything.
        return { then: () => {}, surfid }
      }
      const promise = new Promise<void>((resolve, reject) => {
        settlers.push({ resolve, reject: (reason: unknown) => reject(reason) })
      }) as Promise<void> & { surfid: number }
      promise.surfid = surfid
      return promise
    }),
    // `undefined` rather than absent for the opt-out, so the fake keeps one
    // shape: `isLive` asks `typeof viewer.getSurface === 'function'`, which is
    // false either way, and the property that is missing in a real old viewer
    // stays type-visible here.
    getSurface: opts.getSurface === false
      ? undefined
      : (id: number) => surfaces.get(id),
  }
}

/** A fresh object every time — a shared reference would satisfy every
 *  comparison in this module for the wrong reason. */
function req(
  type: number,
  opacity = 0.7,
  sel: Record<string, unknown> = { hetflag: false },
): SurfaceRequest {
  return { type, style: { opacity, color: 'white' }, sel }
}

/** Drain the microtask queue so a settled build's continuation has run. */
const flush = () => vi.advanceTimersByTimeAsync(0)

// ⚠️ INJECTED TIME FOR THE WHOLE FILE, not only the watchdog block. Any test
// that leaves a build unsettled arms a real 5 s poll that outlives it, and a
// timer firing inside a LATER test is the kind of cross-test coupling that is
// only ever diagnosed the hard way. It also means `flush` cannot be a real
// `setTimeout(0)` any more — hence the change above.
beforeEach(() => {
  vi.useFakeTimers()
  vi.mocked(reportSurfaceFailure).mockClear()
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('applySurface, with nothing in flight', () => {
  it('builds the surface the caller asked for, clearing first', () => {
    const viewer = makeViewer()
    applySurface(viewer, req(2))
    expect(viewer.calls).toEqual(['removeAllSurfaces', 'addSurface'])
    // Argument ZERO and the exact number: `const x: SurfaceType = 4` and `= 2`
    // both type-check, so nothing but the value distinguishes MS from SES.
    expect(viewer.addSurface.mock.calls[0][0]).toBe(2)
    expect(viewer.addSurface.mock.calls[0][1]).toEqual({ opacity: 0.7, color: 'white' })
    expect(viewer.addSurface.mock.calls[0][2]).toEqual({ hetflag: false })
  })

  it('clears even when it has never built anything', () => {
    // Parity with the unconditional `removeAllSurfaces()` that used to sit in
    // applySceneStyles step 1: a restyle with Surface OFF is still what wipes a
    // surface some other path (a raw caller) put in the scene.
    const viewer = makeViewer()
    applySurface(viewer, null)
    expect(viewer.removeAllSurfaces).toHaveBeenCalledTimes(1)
    expect(viewer.addSurface).not.toHaveBeenCalled()
  })

  it('does nothing at all when the request has not changed', async () => {
    const viewer = makeViewer()
    applySurface(viewer, req(2))
    viewer.settlers[0].resolve()
    await flush()
    viewer.calls.length = 0

    applySurface(viewer, req(2))
    // Not "no addSurface" — NOTHING. A removeAllSurfaces here would drop the
    // mesh and leave the viewer surfaceless until the next real change.
    expect(viewer.calls).toEqual([])
  })

  it('restyles instead of rebuilding when only the opacity changed', async () => {
    // PT-382 item 2. Opaque is the most-pressed control in the toolbar and it
    // was costing a full MS build to change one number.
    const viewer = makeViewer()
    applySurface(viewer, req(2, 0.7))
    const surfid = viewer.addSurface.mock.results[0].value.surfid
    viewer.settlers[0].resolve()
    await flush()
    viewer.calls.length = 0

    applySurface(viewer, req(2, 1))
    expect(viewer.addSurface).toHaveBeenCalledTimes(1)
    expect(viewer.removeAllSurfaces).toHaveBeenCalledTimes(1)
    expect(viewer.setSurfaceMaterialStyle).toHaveBeenCalledWith(surfid, { opacity: 1, color: 'white' })
    // And a render, because setSurfaceMaterialStyle only marks the surface
    // unfinished — render() is what rebuilds the GL mesh from the new material.
    // Without this the toggle looks dead until something else repaints.
    expect(viewer.calls).toEqual(['setSurfaceMaterialStyle', 'render'])
  })

  it('leaves the mesh double-sided, as a rebuild would have', async () => {
    // The shortcut has to produce the SAME PICTURE, not merely a cheaper call.
    // 3Dmol's setSurfaceMaterialStyle ends with `mat.side = FrontSide` while
    // addSurface leaves the MeshDoubleLambertMaterial's DoubleSide alone, so
    // without restoring it the first Opaque press strips every back-facing
    // triangle off a translucent surface — the far wall of every pocket — and
    // nothing ever puts it back, because the geometry never changes again.
    const viewer = makeViewer()
    applySurface(viewer, req(2, 0.7))
    const surfid = viewer.addSurface.mock.results[0].value.surfid
    viewer.settlers[0].resolve()
    await flush()

    applySurface(viewer, req(2, 1))
    expect(viewer.setSurfaceMaterialStyle).toHaveBeenCalled()
    expect(viewer.surfaces.get(surfid)![0].mat.side).toBe(DOUBLE_SIDE)

    // ...and back again, so this is not "the first press happens to be safe".
    applySurface(viewer, req(2, 0.7))
    expect(viewer.surfaces.get(surfid)![0].mat.side).toBe(DOUBLE_SIDE)
  })

  it('rebuilds rather than restyle when the material cannot be read back', async () => {
    // If the side cannot be captured it cannot be restored, and an unrestorable
    // restyle is worse than a rebuild — it is the silent single-sided picture
    // above. So the shortcut is only available when the material was readable.
    const viewer = makeViewer()
    // A surface whose parts carry no readable material — the shape that makes
    // the side uncapturable, and therefore unrestorable.
    viewer.getSurface = ((id: number) =>
      (viewer.surfaces.has(id) ? [{}] : undefined)) as typeof viewer.getSurface
    applySurface(viewer, req(2, 0.7))
    viewer.settlers[0].resolve()
    await flush()
    viewer.calls.length = 0

    applySurface(viewer, req(2, 1))
    expect(viewer.calls).toEqual(['removeAllSurfaces', 'addSurface'])
    expect(viewer.setSurfaceMaterialStyle).not.toHaveBeenCalled()
  })

  it('rebuilds rather than restyle on a viewer with no setSurfaceMaterialStyle', async () => {
    // `isLive` proves `getSurface` exists, which is a different method from the
    // one the restyle branch actually calls.
    const viewer = makeViewer()
    applySurface(viewer, req(2, 0.7))
    viewer.settlers[0].resolve()
    await flush()
    ;(viewer as { setSurfaceMaterialStyle?: unknown }).setSurfaceMaterialStyle = undefined
    viewer.calls.length = 0

    applySurface(viewer, req(2, 1))
    expect(viewer.calls).toEqual(['removeAllSurfaces', 'addSurface'])
  })

  it('rebuilds when the surface TYPE changed', async () => {
    const viewer = makeViewer()
    applySurface(viewer, req(2))
    viewer.settlers[0].resolve()
    await flush()
    viewer.calls.length = 0

    applySurface(viewer, req(4))
    // The mesh geometry is what a type change alters, so restyling it would
    // leave MS on screen while the chips claimed SES.
    expect(viewer.calls).toEqual(['removeAllSurfaces', 'addSurface'])
    expect(viewer.addSurface.mock.calls[1][0]).toBe(4)
    expect(viewer.setSurfaceMaterialStyle).not.toHaveBeenCalled()
  })

  it('rebuilds when the SELECTION changed, even at the same type', async () => {
    const viewer = makeViewer()
    applySurface(viewer, req(2, 0.7, { hetflag: false }))
    viewer.settlers[0].resolve()
    await flush()
    viewer.calls.length = 0

    applySurface(viewer, req(2, 0.7, { hetflag: false, chain: 'A' }))
    expect(viewer.calls).toEqual(['removeAllSurfaces', 'addSurface'])
  })

  it('does not let one selector forge another selector key', async () => {
    // The key is a joined `k=type:v` list, so an unescaped separator inside a
    // key or a value can encode as some OTHER selector — and reusing a mesh
    // built over different atoms is the one failure this comparison's own
    // invariant promises cannot happen ("an unnecessary rebuild, never a wrong
    // picture"). These two are the collision the flat join produced.
    const viewer = makeViewer()
    applySurface(viewer, req(2, 0.7, { 'a=string:1&b': '2' }))
    viewer.settlers[0].resolve()
    await flush()
    viewer.calls.length = 0

    applySurface(viewer, req(2, 0.7, { a: '1', b: '2' }))
    expect(viewer.calls).toEqual(['removeAllSurfaces', 'addSurface'])
  })

  it('does not confuse a selector value with its string spelling', async () => {
    const viewer = makeViewer()
    applySurface(viewer, req(2, 0.7, { resi: 1 }))
    viewer.settlers[0].resolve()
    await flush()
    viewer.calls.length = 0

    applySurface(viewer, req(2, 0.7, { resi: '1' }))
    expect(viewer.calls).toEqual(['removeAllSurfaces', 'addSurface'])
  })

  it('rebuilds rather than compare a selector it cannot compare', async () => {
    // A non-primitive selector value stringifies unreliably (a function drops
    // out entirely), so the key is refused and the comparison fails closed. An
    // unnecessary rebuild is the correct failure; reusing a mesh built for a
    // different selection is not.
    const viewer = makeViewer()
    const nested = { within: { distance: 5 } }
    applySurface(viewer, req(2, 0.7, nested))
    viewer.settlers[0].resolve()
    await flush()
    viewer.calls.length = 0

    applySurface(viewer, req(2, 0.7, { within: { distance: 5 } }))
    expect(viewer.calls).toEqual(['removeAllSurfaces', 'addSurface'])
  })

  it('removes the surface when the switch goes off, and rebuilds when it comes back', async () => {
    const viewer = makeViewer()
    applySurface(viewer, req(2))
    viewer.settlers[0].resolve()
    await flush()

    applySurface(viewer, null)
    expect(viewer.removeAllSurfaces).toHaveBeenCalledTimes(2)

    viewer.calls.length = 0
    applySurface(viewer, req(2))
    // The retention has to be dropped by the removal. If it survived, this
    // would take the restyle path against an id that no longer exists — which
    // setSurfaceMaterialStyle answers by doing nothing, silently.
    expect(viewer.calls).toEqual(['removeAllSurfaces', 'addSurface'])
  })
})

describe('builtSurface (read by the HTML export)', () => {
  it('names the mesh on screen and the request it was built from, and nothing once it is removed', async () => {
    const viewer = makeViewer()
    expect(builtSurface(viewer)).toBeNull()
    applySurface(viewer, req(4, 1))
    viewer.settlers[0].resolve()
    await flush()
    const held = builtSurface(viewer)
    expect(held?.surfid).toBe([...viewer.surfaces.keys()][0])
    expect(held?.request.type).toBe(4)
    expect(held?.request.style.opacity).toBe(1)

    applySurface(viewer, null)
    expect(builtSurface(viewer)).toBeNull()
  })
})

describe('applySurface, while a build is running', () => {
  it('starts no second build, and applies the request when the first settles', async () => {
    // PT-382 item 1. 3Dmol has no cancel: a superseded build keeps its four
    // workers to completion and then merges into a disposed geometry. The only
    // available fix is not to start the second one.
    const viewer = makeViewer()
    applySurface(viewer, req(1))
    applySurface(viewer, req(2))
    expect(viewer.addSurface).toHaveBeenCalledTimes(1)
    expect(viewer.addSurface.mock.calls[0][0]).toBe(1)

    viewer.settlers[0].resolve()
    await flush()
    expect(viewer.addSurface).toHaveBeenCalledTimes(2)
    expect(viewer.addSurface.mock.calls[1][0]).toBe(2)
  })

  it('keeps only the LAST request of a burst', async () => {
    const viewer = makeViewer()
    applySurface(viewer, req(1))
    applySurface(viewer, req(3))
    applySurface(viewer, req(4))
    applySurface(viewer, req(2))
    expect(viewer.addSurface).toHaveBeenCalledTimes(1)

    viewer.settlers[0].resolve()
    await flush()
    // Two builds for four clicks: the one already running, and the final state.
    // A queue rather than a slot would build all four in turn.
    expect(viewer.addSurface).toHaveBeenCalledTimes(2)
    expect(viewer.addSurface.mock.calls[1][0]).toBe(2)
  })

  it('renders after a deferred build, because no caller is left to', async () => {
    const viewer = makeViewer()
    applySurface(viewer, req(1))
    applySurface(viewer, req(2))
    viewer.calls.length = 0
    viewer.settlers[0].resolve()
    await flush()
    expect(viewer.calls).toContain('render')
  })

  it('turns the surface OFF at once, without waiting for the build', async () => {
    // A removal is the one request that is never queued. It needs no build and
    // cannot race one — `removeAllSurfaces` deletes the entry and `render()`
    // walks `viewer.surfaces` alone — so deferring it only left the surface
    // painted, and still growing, while the chip already read unpressed.
    const viewer = makeViewer()
    applySurface(viewer, req(2))
    viewer.calls.length = 0

    applySurface(viewer, null)
    expect(viewer.calls).toEqual(['removeAllSurfaces'])
    expect(viewer.surfaces.size).toBe(0)

    // ...and the build that could not be cancelled adds nothing when it lands.
    viewer.settlers[0].resolve()
    await flush()
    expect(viewer.addSurface).toHaveBeenCalledTimes(1)
    expect(viewer.surfaces.size).toBe(0)
  })

  it('drops a queued request when the surface is switched off before it lands', async () => {
    const viewer = makeViewer()
    applySurface(viewer, req(2))
    applySurface(viewer, req(4))   // queued behind the running build
    applySurface(viewer, null)     // ...and then the user turns Surface off
    viewer.calls.length = 0

    viewer.settlers[0].resolve()
    await flush()
    // The queued SES request is stale intent: the user's last word was OFF.
    expect(viewer.calls).toEqual([])
    expect(viewer.addSurface).toHaveBeenCalledTimes(1)
  })

  it('does not rebuild when the queued request is what is already drawn', async () => {
    const viewer = makeViewer()
    applySurface(viewer, req(2))
    applySurface(viewer, req(2))
    viewer.settlers[0].resolve()
    await flush()
    expect(viewer.addSurface).toHaveBeenCalledTimes(1)
    expect(viewer.setSurfaceMaterialStyle).not.toHaveBeenCalled()
  })

  it('restyles a queued material change instead of rebuilding it', async () => {
    const viewer = makeViewer()
    applySurface(viewer, req(2, 0.7))
    applySurface(viewer, req(2, 1))
    viewer.settlers[0].resolve()
    await flush()
    expect(viewer.addSurface).toHaveBeenCalledTimes(1)
    expect(viewer.setSurfaceMaterialStyle).toHaveBeenCalledTimes(1)
  })

  it('drops the queued request when the page has torn the viewer down', async () => {
    // The unmount path is where this module's own cost reappears: the pages
    // drop the viewer without telling anyone, and a deferred commit would then
    // spawn a fresh set of surface workers for a mesh nothing can ever show.
    // A viewer whose models are gone is the signal, and it needs no cooperation
    // from the pages.
    const viewer = makeViewer({ models: false })
    applySurface(viewer, req(2))
    applySurface(viewer, req(4))
    viewer.calls.length = 0

    viewer.settlers[0].resolve()
    await flush()
    expect(viewer.calls).toEqual([])
    expect(viewer.addSurface).toHaveBeenCalledTimes(1)
  })

  it('still applies the queued request on a viewer it cannot interrogate', async () => {
    // Deliberately the OPPOSITE direction to the restyle guard: dropping a
    // request the user actually made, because a double does not implement
    // `getModel`, is worse than one wasted build.
    const viewer = makeViewer()
    ;(viewer as { getModel?: unknown }).getModel = undefined
    applySurface(viewer, req(2))
    applySurface(viewer, req(4))

    viewer.settlers[0].resolve()
    await flush()
    expect(viewer.addSurface).toHaveBeenCalledTimes(2)
  })

  it('reports a throw from the deferred commit instead of leaving it unhandled', async () => {
    // `.then(settle, onFail)` returns a promise nobody observes, and unlike the
    // `.catch(reportSurfaceFailure)` this replaced, `settle` now runs real
    // viewer work. A throw escaping it would be the stackless
    // UnhandledRejection that surfaceFailure.ts exists to prevent, on top of
    // losing the request.
    const viewer = makeViewer()
    applySurface(viewer, req(2))
    applySurface(viewer, req(4))
    viewer.removeAllSurfaces.mockImplementation(() => { throw new Error('context lost') })

    viewer.settlers[0].resolve()
    await flush()
    expect(reportSurfaceFailure).toHaveBeenCalledTimes(1)

    // ...and the retention is dropped, so the next request rebuilds cleanly
    // rather than restyling against an id whose clear never completed.
    viewer.removeAllSurfaces.mockImplementation(() => { viewer.calls.push('removeAllSurfaces') })
    viewer.calls.length = 0
    applySurface(viewer, req(4, 1))
    expect(viewer.calls).toEqual(['removeAllSurfaces', 'addSurface'])
  })
})

describe('applySurface, when a build does not succeed', () => {
  it('reports the rejection and lets the next request build again', async () => {
    const viewer = makeViewer()
    applySurface(viewer, req(2))
    viewer.settlers[0].reject({ message: 'worker died' })
    await flush()
    expect(reportSurfaceFailure).toHaveBeenCalledTimes(1)

    viewer.calls.length = 0
    applySurface(viewer, req(2, 1))
    // A rebuild, NOT a restyle: nothing finished, so there is no mesh whose
    // material could be changed.
    expect(viewer.calls).toEqual(['removeAllSurfaces', 'addSurface'])
  })

  it('does not latch the gate on a rejection', async () => {
    const viewer = makeViewer()
    applySurface(viewer, req(2))
    viewer.settlers[0].reject({ message: 'worker died' })
    await flush()
    applySurface(viewer, req(4))
    // Latching here would leave the viewer unable to draw any surface for the
    // life of the page, with every later request silently queued behind a build
    // that already failed.
    expect(viewer.addSurface).toHaveBeenCalledTimes(2)
  })

  it('reports a synchronous throw and stays usable', () => {
    const viewer = makeViewer({ addSurfaceReturns: 'throw' })
    applySurface(viewer, req(2))
    expect(reportSurfaceFailure).toHaveBeenCalledTimes(1)
    applySurface(viewer, req(4))
    expect(viewer.addSurface).toHaveBeenCalledTimes(2)
  })

  it('does not latch when addSurface returns something that is not a promise', () => {
    // 3Dmol returns a bare surfid instead of a promise when a surfacecallback is
    // passed, and test doubles routinely return undefined. Arming the gate on a
    // value that can never settle it would be a permanent stall.
    const viewer = makeViewer({ addSurfaceReturns: 'nothing' })
    applySurface(viewer, req(2))
    applySurface(viewer, req(4))
    expect(viewer.addSurface).toHaveBeenCalledTimes(2)
  })
})

describe('surfaces this module did not create', () => {
  it('rebuilds after forgetSurface, even for an unchanged request', async () => {
    const viewer = makeViewer()
    applySurface(viewer, req(2))
    viewer.settlers[0].resolve()
    await flush()

    forgetSurface(viewer)
    viewer.calls.length = 0
    applySurface(viewer, req(2, 1))
    // The rebuild is the point: it is also what clears whatever the raw caller
    // added. A restyle would leave that second surface in the scene.
    expect(viewer.calls).toEqual(['removeAllSurfaces', 'addSurface'])
  })

  it('forgets a request queued BEFORE the raw caller acted', async () => {
    // Otherwise a chip click made before a raw caller's surface reaches settle
    // time and opens with removeAllSurfaces, wiping the surface that caller just
    // drew — with no toolbar interaction in between, which is the opposite of
    // the documented "it survives until the next toolbar change".
    const viewer = makeViewer()
    applySurface(viewer, req(2))
    applySurface(viewer, req(4))   // the user's chip click, queued
    forgetSurface(viewer)          // ...then a raw caller draws its own surface
    viewer.calls.length = 0

    viewer.settlers[0].resolve()
    await flush()
    expect(viewer.calls).toEqual([])
  })

  it('rebuilds when the surface was removed behind its back', async () => {
    const viewer = makeViewer()
    applySurface(viewer, req(2))
    viewer.settlers[0].resolve()
    await flush()

    // What a raw caller's `removeAllSurfaces()` does, without telling
    // this module. The retained id now names nothing.
    viewer.removeAllSurfaces()
    viewer.calls.length = 0

    applySurface(viewer, req(2, 1))
    expect(viewer.calls).toEqual(['removeAllSurfaces', 'addSurface'])
    // Not this. setSurfaceMaterialStyle on an unknown id returns without doing
    // anything and without a warning, so the Opaque toggle would simply stop
    // working with nothing on screen or in the console to say why.
    expect(viewer.setSurfaceMaterialStyle).not.toHaveBeenCalled()
  })

  it('never restyles a viewer it cannot interrogate', async () => {
    const viewer = makeViewer({ getSurface: false })
    applySurface(viewer, req(2))
    viewer.settlers[0].resolve()
    await flush()
    viewer.calls.length = 0

    applySurface(viewer, req(2, 1))
    // An unverifiable id falls through to a rebuild. The restyle path is the
    // only one that can be silently wrong, so it must never be the guess.
    expect(viewer.calls).toEqual(['removeAllSurfaces', 'addSurface'])
  })
})

describe('state is per viewer', () => {
  it('keeps one viewer from restyling its mesh against another viewer request', async () => {
    // More than one viewer can be open at once, each with its own state.
    //
    // ⚠️ Written as a THREE-step interleaving on purpose. The obvious version —
    // build on `a`, then assert `b` rebuilds — passes with the WeakMap replaced
    // by a single shared object, because each fake has its own id space so
    // `isLive` fails on `b` and forces the rebuild anyway. That version proves
    // `isLive`, not isolation. Here both viewers really do hold surfid 1, so a
    // shared state would let `a`'s MS mesh be restyled against `b`'s SES
    // request: the wrong picture, silently.
    const a = makeViewer()
    const b = makeViewer()
    applySurface(a, req(2))
    a.settlers[0].resolve()
    await flush()

    applySurface(b, req(4))
    b.settlers[0].resolve()
    await flush()

    a.calls.length = 0
    applySurface(a, req(4, 1))
    expect(a.calls).toEqual(['removeAllSurfaces', 'addSurface'])
    expect(a.setSurfaceMaterialStyle).not.toHaveBeenCalled()
  })
})

describe('the publisher, threaded through the controller', () => {
  it('the fake really is species-hostile, like 3Dmol', () => {
    // If someone "simplifies" SurfaceLike back to a plain array, every test
    // in this file goes blind to the class of bug that broke captureSides in
    // every real browser while 630 tests passed. Pin the trap itself.
    const viewer = makeViewer()
    applySurface(viewer, req(2))
    viewer.settlers[0].resolve()
    const parts = viewer.surfaces.get(1)
    expect(parts).toBeDefined()
    expect(() => (parts as SurfaceLike<SurfacePart>).map(p => p)).toThrow(TypeError)
  })

  // Per-build handle IDENTITY (same id, distinct objects) is pinned at the
  // integration level in sceneStyles.test.ts, where the stub can recycle ids.
  it('publishes null at the drop, then the handle once the mesh finishes', async () => {
    const viewer = makeViewer()
    const onSurface = vi.fn()
    applySurface(viewer, req(2), onSurface)
    expect(onSurface.mock.calls).toEqual([[null]])
    viewer.settlers[0].resolve()
    await flush()
    expect(onSurface).toHaveBeenLastCalledWith({ id: 1 })
  })

  it('publishes NOTHING on the restyle path — the mesh a handle points at is unchanged', async () => {
    const viewer = makeViewer()
    const onSurface = vi.fn()
    applySurface(viewer, req(2, 0.7), onSurface)
    viewer.settlers[0].resolve()
    await flush()
    onSurface.mockClear()

    // Material-only change: served by setSurfaceMaterialStyle, no publishes.
    applySurface(viewer, req(2, 1), onSurface)
    expect(viewer.setSurfaceMaterialStyle).toHaveBeenCalled()
    expect(onSurface).not.toHaveBeenCalled()
  })

  it('a throwing consumer neither kills the build nor reaches the failure reporter', async () => {
    const viewer = makeViewer()
    const onSurface = vi.fn(() => { throw new Error('consumer bug') })
    applySurface(viewer, req(2), onSurface)
    // The drop was published (and threw); the build must have started anyway.
    expect(viewer.addSurface).toHaveBeenCalledTimes(1)
    viewer.settlers[0].resolve()
    await flush()
    // The completion publish threw too; neither throw is a SURFACE failure.
    expect(onSurface).toHaveBeenCalledTimes(2)
    expect(reportSurfaceFailure).not.toHaveBeenCalled()
  })

  it('a queued request publishes through ITS caller, not the running build', async () => {
    const viewer = makeViewer()
    const runningPub = vi.fn()
    const queuedPub = vi.fn()
    applySurface(viewer, req(2), runningPub)
    applySurface(viewer, req(4), queuedPub)  // different geometry, queued
    viewer.settlers[0].resolve()
    await flush()
    viewer.settlers[1].resolve()
    await flush()
    expect(runningPub.mock.calls.map(c => c[0])).toEqual([null, { id: 1 }])
    // The SAME number for the second build, deliberately: the queued commit's
    // `removeAllSurfaces` emptied the map, so `nextSurfID` hands id 1 back.
    // Which is the whole reason a handle is an object — see the id-reuse case
    // in 'surfaces this module did not create'.
    expect(queuedPub.mock.calls.map(c => c[0])).toEqual([null, { id: 1 }])
  })

  it('OFF mid-build publishes its null at once, and the disowned build stays silent', async () => {
    // This used to pin the OPPOSITE — the doomed build reporting its handle
    // late, on the reasoning that a consumer re-reads by id, finds the mesh
    // gone and refuses. That reasoning stopped holding once a removal releases
    // the gate (PT-382 item 5's watchdog brought the same mechanism): the very
    // next build is handed the SAME id back, because `nextSurfID` is max+1 over
    // the remaining keys, so the late report would point the consumer at a mesh
    // that is still merging rather than at nothing.
    const viewer = makeViewer()
    const buildPub = vi.fn()
    const offPub = vi.fn()
    applySurface(viewer, req(2), buildPub)
    applySurface(viewer, null, offPub)
    expect(offPub.mock.calls).toEqual([[null]])
    viewer.settlers[0].resolve()
    await flush()
    expect(buildPub.mock.calls.map(c => c[0])).toEqual([null])
  })

  it('forgetBuiltSurface keeps the queue: the queued click still builds on settle', async () => {
    // Round 2 used forgetSurface on a model swap and silently lost a live
    // chip click; this pins the split that fixed it.
    const viewer = makeViewer()
    const queuedPub = vi.fn()
    applySurface(viewer, req(2))
    applySurface(viewer, req(4), queuedPub)  // queued mid-build
    forgetBuiltSurface(viewer)               // model swap: mesh forgotten, click kept
    viewer.settlers[0].resolve()
    await flush()
    expect(viewer.addSurface).toHaveBeenCalledTimes(2)
    viewer.settlers[1].resolve()
    await flush()
    // `{ id: 1 }`, not `{ id: 2 }`: the rebuild's `removeAllSurfaces` emptied
    // the map first, and `nextSurfID` is max+1 over what is LEFT, so the second
    // build is handed the first one's number back. This read `{ id: 2 }` while
    // the double allocated with a `++` counter — the monotonic fiction PT-382
    // follow-up 4 found in three suites at once.
    expect(queuedPub.mock.calls.map(c => c[0])).toEqual([null, { id: 1 }])
  })

  it('forgetBuiltSurface forces the next identical request to rebuild, not restyle', async () => {
    const viewer = makeViewer()
    applySurface(viewer, req(2, 0.7))
    viewer.settlers[0].resolve()
    await flush()
    forgetBuiltSurface(viewer)
    applySurface(viewer, req(2, 1))  // material-only: would restyle if retained
    expect(viewer.setSurfaceMaterialStyle).not.toHaveBeenCalled()
    expect(viewer.addSurface).toHaveBeenCalledTimes(2)
  })

  it('forgetSurface drops the queued publisher with the queued request', async () => {
    const viewer = makeViewer()
    const queuedPub = vi.fn()
    applySurface(viewer, req(2))
    applySurface(viewer, req(4), queuedPub)  // queued mid-build
    forgetSurface(viewer)
    viewer.settlers[0].resolve()
    await flush()
    // The queued request is stale intent and went with its publisher: no
    // second build, no publish through a dead callback.
    expect(viewer.addSurface).toHaveBeenCalledTimes(1)
    expect(queuedPub).not.toHaveBeenCalled()
  })
})

describe('3Dmol recycles surface ids', () => {
  it('hands the SAME number to the next build, so only identity tells them apart', async () => {
    // `nextSurfID` is max+1 over the REMAINING keys (`GLViewer.ts:313-325`), so
    // once `removeAllSurfaces` has emptied the map the next surface is handed
    // the number back. EVERYTHING that exists because of this — `SurfaceHandle`
    // being an object rather than a number, `issuedWhile`, `sectionCap`
    // comparing identity, `buildToken` — was untested in every suite while the
    // doubles allocated with a `++` counter and a comment claiming 3Dmol does
    // too. Rewriting `SurfaceHandle` as a bare `number` would have stayed green.
    const viewer = makeViewer()
    const pub = vi.fn()
    applySurface(viewer, req(2), pub)
    viewer.settlers[0].resolve()
    await flush()

    forgetSurface(viewer)
    applySurface(viewer, req(2), pub)
    viewer.settlers[1].resolve()
    await flush()

    const handles = pub.mock.calls.map(c => c[0]).filter(Boolean) as Array<{ id: number }>
    expect(handles).toHaveLength(2)
    expect(handles[1].id).toBe(handles[0].id)
    expect(handles[1]).not.toBe(handles[0])
  })
})

describe('Surface OFF then ON while a build is running', () => {
  it('builds again at once instead of waiting out the mesh it just threw away', () => {
    // The regression this closes: `applySurface(null)` removed the mesh but left
    // the gate shut, so the ON went into the queue and did not start until the
    // DISCARDED build settled. That made the round trip cost more than it did
    // before the controller existed — and it is the gesture a user makes when
    // the viewer feels stuck, which is exactly item 5's symptom.
    const viewer = makeViewer()
    applySurface(viewer, req(2))
    applySurface(viewer, null)
    applySurface(viewer, req(2))
    expect(viewer.addSurface).toHaveBeenCalledTimes(2)
  })

  it('and the build it threw away changes nothing when it lands', async () => {
    const viewer = makeViewer()
    const buildPub = vi.fn()
    applySurface(viewer, req(2), buildPub)
    applySurface(viewer, null)
    applySurface(viewer, req(2))
    viewer.calls.length = 0
    buildPub.mockClear()

    viewer.settlers[0].resolve()
    await flush()
    // Not one viewer call and not one publish: its id now names the SECOND
    // build's mesh, which is still merging.
    expect(viewer.calls).toEqual([])
    expect(buildPub).not.toHaveBeenCalled()
  })
})

describe('a raw caller taking the scene mid-build', () => {
  it('still queues the next toolbar request rather than starting a second build', async () => {
    // `forgetSurface` deliberately does NOT open the gate. A raw caller's
    // `addSurface` is additive and already spawned its own four workers; ours
    // are still burning too, and letting a chip click start a third set is the
    // stacking PT-382 item 1 exists to stop.
    const viewer = makeViewer()
    applySurface(viewer, req(2))
    forgetSurface(viewer)
    applySurface(viewer, req(4))
    expect(viewer.addSurface).toHaveBeenCalledTimes(1)

    viewer.settlers[0].resolve()
    await flush()
    expect(viewer.addSurface).toHaveBeenCalledTimes(2)
    expect(viewer.addSurface.mock.calls[1][0]).toBe(4)
  })
})

describe('a build that never settles (PT-382 item 5)', () => {
  it('starts exactly one build, however many chips are pressed', () => {
    const viewer = makeViewer({ addSurfaceReturns: 'never' })
    applySurface(viewer, req(2))
    applySurface(viewer, req(1))
    applySurface(viewer, req(4))
    expect(viewer.addSurface).toHaveBeenCalledTimes(1)
  })

  it('gives up after twenty still seconds and applies the click that was waiting', async () => {
    const viewer = makeViewer({ addSurfaceReturns: 'never' })
    applySurface(viewer, req(2))
    applySurface(viewer, req(4))          // queued behind the dead build

    await vi.advanceTimersByTimeAsync(15_000)
    expect(viewer.addSurface).toHaveBeenCalledTimes(1)   // still inside the grace

    await vi.advanceTimersByTimeAsync(5_000)
    expect(viewer.addSurface).toHaveBeenCalledTimes(2)
    expect(viewer.addSurface.mock.calls[1][0]).toBe(4)
  })

  it('lets a NEW chip press build once it has given up', async () => {
    const viewer = makeViewer({ addSurfaceReturns: 'never' })
    applySurface(viewer, req(2))
    await vi.advanceTimersByTimeAsync(20_000)
    expect(viewer.addSurface).toHaveBeenCalledTimes(1)   // nothing was queued

    applySurface(viewer, req(4))
    expect(viewer.addSurface).toHaveBeenCalledTimes(2)
  })

  it('keeps waiting while the mesh is still growing, however slow the build is', async () => {
    // The whole reason this is a PROGRESS watchdog and not a clock. A legitimate
    // MS build on a big protein merges an extent every ~2 s at the worst
    // measurement in the module doc; a dead one merges nothing. No constant on a
    // clock alone can tell those apart, which is why item 5 was deferred.
    const viewer = makeViewer({ addSurfaceReturns: 'never' })
    applySurface(viewer, req(2))
    const surfid = viewer.addSurface.mock.results[0].value.surfid

    for (let extent = 0; extent < 8; extent++) {
      await vi.advanceTimersByTimeAsync(15_000)
      viewer.store.mergeExtent(surfid)
    }
    // Two minutes in, and not given up on once.
    expect(viewer.addSurface).toHaveBeenCalledTimes(1)

    // Then the workers die and nothing merges again. The give-up lands within
    // one poll of the twenty seconds — progress is OBSERVED on a poll, not at
    // the instant it happens — so this waits out stall + poll rather than
    // pinning the exact tick and inviting a flake.
    await vi.advanceTimersByTimeAsync(30_000)
    applySurface(viewer, req(4))
    expect(viewer.addSurface).toHaveBeenCalledTimes(2)
  })

  it('ignores a build it gave up on, even if it resolves in the end', async () => {
    const viewer = makeViewer()
    const pub = vi.fn()
    applySurface(viewer, req(2, 0.7), pub)
    await vi.advanceTimersByTimeAsync(20_000)
    pub.mockClear()
    viewer.calls.length = 0

    viewer.settlers[0].resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(pub).not.toHaveBeenCalled()
    expect(viewer.calls).toEqual([])
  })

  it('drops the retention with the gate, so the next press rebuilds', async () => {
    // A half-merged mesh must never be restyled: `setSurfaceMaterialStyle` over
    // it would paint whatever fraction of the surface arrived and call it done.
    const viewer = makeViewer({ addSurfaceReturns: 'never' })
    applySurface(viewer, req(2, 0.7))
    await vi.advanceTimersByTimeAsync(20_000)

    applySurface(viewer, req(2, 1))   // material-only: would restyle if retained
    expect(viewer.setSurfaceMaterialStyle).not.toHaveBeenCalled()
    expect(viewer.addSurface).toHaveBeenCalledTimes(2)
  })

  it('frees a toolbar request queued behind a scene a raw caller took over', async () => {
    const viewer = makeViewer({ addSurfaceReturns: 'never' })
    applySurface(viewer, req(2))
    forgetSurface(viewer)             // a raw caller took the scene
    applySurface(viewer, req(4))      // and then the user pressed a chip
    expect(viewer.addSurface).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(20_000)
    expect(viewer.addSurface).toHaveBeenCalledTimes(2)
  })

  it('gives up on a LIVE build whose viewer stops answering mid-build', async () => {
    // The only case that reaches `poll`'s `parts === watched` comparison against
    // an unreadable read: every other hostile-viewer case in this file breaks
    // before the watchdog arms, or after it has stopped.
    //
    // ⚠️ Three things have to be asserted, and an earlier version asserted only
    // the first, which made it unable to tell this design from having no catch
    // in `surfaceParts` at all — the throw would then be caught one frame up by
    // `guarded`, which disowns and runs the same `onStalled()`, producing the
    // same two calls with the same argument:
    //   1. the queued click lands;
    //   2. it lands AFTER the twenty-second grace, not on the first bad poll
    //      (`guarded`'s catch would fire immediately);
    //   3. nothing is reported (`guarded`'s catch reports).
    const viewer = makeViewer({ addSurfaceReturns: 'never' })
    applySurface(viewer, req(2))
    applySurface(viewer, req(4))          // the user's click, queued behind it
    const surfid = viewer.addSurface.mock.results[0].value.surfid

    // ALIVE, and demonstrably so: a merge after every poll keeps resetting the
    // stall count, which is the whole premise of a progress watchdog.
    for (let extent = 0; extent < 6; extent++) {
      await vi.advanceTimersByTimeAsync(5_000)
      viewer.store.mergeExtent(surfid)
    }
    expect(viewer.addSurface).toHaveBeenCalledTimes(1)

    // ...and now the viewer stops answering, with the build still in flight.
    viewer.getSurface = () => { throw new TypeError('viewer is gone') }

    await vi.advanceTimersByTimeAsync(15_000)
    expect(viewer.addSurface).toHaveBeenCalledTimes(1)   // still inside the grace

    await vi.advanceTimersByTimeAsync(5_000)
    expect(viewer.addSurface).toHaveBeenCalledTimes(2)
    expect(viewer.addSurface.mock.calls[1][0]).toBe(4)
    expect(reportSurfaceFailure).not.toHaveBeenCalled()
  })

  it('does not watch a viewer whose surface it cannot read, and says so here', async () => {
    // A DOCUMENTED limit, pinned so it stays a decision. With no `getSurface`
    // there is no progress signal, and releasing on elapsed time alone is the
    // clock-only watchdog item 5 refused. Real 3Dmol always answers; only a
    // degenerate double reaches this.
    const viewer = makeViewer({ addSurfaceReturns: 'never', getSurface: false })
    applySurface(viewer, req(2))
    applySurface(viewer, req(4))
    await vi.advanceTimersByTimeAsync(120_000)
    expect(viewer.addSurface).toHaveBeenCalledTimes(1)
  })
})

describe('the price of releasing the gate on a removal', () => {
  it('lets OFF->ON skip the wait, which is the whole point', () => {
    const viewer = makeViewer()
    applySurface(viewer, req(2))
    applySurface(viewer, null)
    applySurface(viewer, req(2))
    expect(viewer.addSurface).toHaveBeenCalledTimes(2)
  })

  it('and charges one build per ON while the earlier ones are still burning', () => {
    // ⚠️ PINNED AS THE COST, not as a bound. Each OFF reopens the gate, so a
    // user working the switch during one slow build starts a build per ON —
    // the pre-#1668 cost of this ONE gesture, self-limiting because each
    // build's workers stop when it completes. A bound was written and deleted
    // in review (PT-470): one boolean produced four Medium findings in a single
    // round, all of them inside the bound. If this ever becomes a real problem
    // the number below is what will change, so it is stated rather than
    // implied.
    const viewer = makeViewer({ addSurfaceReturns: 'never' })
    applySurface(viewer, req(2))
    for (let i = 0; i < 3; i++) {
      applySurface(viewer, null)
      applySurface(viewer, req(2))
    }
    expect(viewer.addSurface).toHaveBeenCalledTimes(4)
  })

  // The distinction the cost above rests on — a chip click is not a removal and
  // is still gated — is pinned by 'starts exactly one build, however many chips
  // are pressed' below. A second copy here was byte-equivalent to it.
})

describe('the watchdog watches OUR mesh, not an id', () => {
  it('does not read a recycled surface as its own build making progress', async () => {
    // `nextSurfID` is max+1 over the REMAINING keys, so after someone else's
    // `removeAllSurfaces` the same NUMBER names a different surface. Watching
    // the number alone let that surface's extents read as our dead build's
    // progress and re-arm the watchdog forever — defeating the one mechanism
    // this module has for the failure it was added to catch.
    const viewer = makeViewer({ addSurfaceReturns: 'never' })
    applySurface(viewer, req(2))
    const surfid = viewer.addSurface.mock.results[0].value.surfid
    applySurface(viewer, req(4))          // queued behind the dead build

    // A raw caller wipes the scene and adds its own surface, which is handed
    // the same id back.
    viewer.store.removeAllSurfaces()
    const recycled = viewer.store.addSurface()
    expect(recycled).toBe(surfid)

    // ...and it keeps merging extents for two minutes.
    for (let i = 0; i < 8; i++) {
      await vi.advanceTimersByTimeAsync(15_000)
      viewer.store.mergeExtent(recycled)
    }
    // Our build is still dead, so the gate opened and the queued click landed.
    expect(viewer.addSurface).toHaveBeenCalledTimes(2)
    expect(viewer.addSurface.mock.calls[1][0]).toBe(4)
  })
})

describe('a viewer whose getSurface answers with a non-array', () => {
  it('is treated as unreadable, not iterated', async () => {
    // `surfaceParts`' `Array.isArray` branch. It lost its only test when the
    // round-2 'nonsense viewer' case was replaced by the throwing ones — and it
    // is the branch that stops every downstream `for (const part of parts)`
    // from running over an object.
    const viewer = {
      removeAllSurfaces: vi.fn(),
      render: vi.fn(),
      getModel: vi.fn(() => ({ id: 'model' })),
      setSurfaceMaterialStyle: vi.fn(),
      getSurface: vi.fn(() => ({ 0: { mat: { side: 2 } }, length: 1 })),
      addSurface: vi.fn((..._args: unknown[]) => {
        const promise = Promise.resolve() as Promise<void> & { surfid: number }
        promise.surfid = 1
        return promise
      }),
    }
    // ⚠️ THIS assertion is the whole pin. Drop the `Array.isArray` branch and
    // `captureSides` iterates `{0: {...}, length: 1}`, which is not iterable,
    // and the TypeError propagates out through `commit` -> `applySurface`.
    expect(() => applySurface(viewer, req(2, 0.7))).not.toThrow()
    await flush()

    // The two below follow from `sides === []` alone — the same refusal a
    // throwing viewer gets — so they do NOT distinguish `isLive`'s routing.
    // The case for that is 'will not restyle a mesh whose viewer starts
    // answering with a non-array'.
    applySurface(viewer, req(2, 1))
    expect(viewer.setSurfaceMaterialStyle).not.toHaveBeenCalled()
    expect(viewer.addSurface).toHaveBeenCalledTimes(2)
  })

  it('will not restyle a mesh whose viewer starts answering with a non-array', async () => {
    // The OTHER half of `isLive`'s routing, and the only case that distinguishes
    // it: a viewer readable at build time (so `sides` is non-empty and
    // `canRestyle` walks all the way to `isLive`) that later answers with a
    // truthy non-array. Reverting `isLive` to `Boolean(viewer.getSurface(id))`
    // takes the restyle path here and clobbers `mat.side` with nothing able to
    // restore it.
    const viewer = makeViewer()
    applySurface(viewer, req(2, 0.7))
    viewer.settlers[0].resolve()
    await flush()

    viewer.getSurface = () => ({ 0: { mat: { side: DOUBLE_SIDE } }, length: 1 }) as never
    applySurface(viewer, req(2, 1))   // material-only
    expect(viewer.setSurfaceMaterialStyle).not.toHaveBeenCalled()
    expect(viewer.addSurface).toHaveBeenCalledTimes(2)
  })
})

describe('a viewer whose getSurface THROWS', () => {
  // The only remaining throw source once `surfaceParts` guards the shape, and
  // therefore the only input that exercises the arming try/catch. The test this
  // replaced handed the viewer a truthy non-array, which `surfaceParts` already
  // absorbed in the base commit — so it proved neither of the two structural
  // fixes it was written for, and never looked at the gate at all.
  function makeThrowingViewer() {
    const store = makeSurfaceStore()
    const settlers: Array<() => void> = []
    return {
      settlers,
      removeAllSurfaces: vi.fn(() => { store.removeAllSurfaces() }),
      render: vi.fn(),
      getModel: vi.fn(() => ({ id: 'model' })),
      // Present because the restyle assertion below reads it. `canRestyle`
      // short-circuits at `sides.length > 0` for this viewer either way —
      // `captureSides` returns `[]` when the read is unreadable — so the method
      // is here to be ASSERTED ON, not to change the decision.
      setSurfaceMaterialStyle: vi.fn(),
      getSurface: vi.fn(() => { throw new TypeError('viewer is gone') }),
      addSurface: vi.fn((..._args: unknown[]) => {
        const surfid = store.addSurface()
        const promise = new Promise<void>(resolve => {
          settlers.push(resolve)
        }) as Promise<void> & { surfid: number }
        promise.surfid = surfid
        return promise
      }),
    }
  }

  it('builds without letting the throw reach applySceneStyles', () => {
    // It used to escape from `captureSides`, mid-restyle, straight out of
    // `applySurface` — before this PR too. `surfaceParts` is now the one place
    // that reads `getSurface`, and it answers "unreadable" instead.
    const viewer = makeThrowingViewer()
    expect(() => applySurface(viewer, req(2))).not.toThrow()
    expect(viewer.addSurface).toHaveBeenCalledTimes(1)
  })

  it('never restyles it — an unreadable material cannot be restored', async () => {
    const viewer = makeThrowingViewer()
    applySurface(viewer, req(2, 0.7))
    viewer.settlers[0]()
    await flush()

    applySurface(viewer, req(2, 1))   // material-only: would restyle if readable
    expect(viewer.setSurfaceMaterialStyle).not.toHaveBeenCalled()
    expect(viewer.addSurface).toHaveBeenCalledTimes(2)
  })

  it('does not escape when the viewer breaks AFTER a successful build', async () => {
    // The half of the input class the three cases above miss. Here `getSurface`
    // answers at build time, so `state.sides` is captured non-empty and
    // `canRestyle` walks past its `sides.length > 0` short-circuit all the way
    // to `isLive` — which read `getSurface` directly until round 4. The throw
    // escaped `commit` -> `applySurface` -> `applySceneStyles`, out of a React
    // effect.
    const viewer = makeViewer()
    applySurface(viewer, req(2, 0.7))
    viewer.settlers[0].resolve()
    await flush()

    viewer.getSurface = () => { throw new TypeError('viewer is gone') }
    expect(() => applySurface(viewer, req(2, 1))).not.toThrow()
    // ...and it rebuilds rather than restyling a mesh it can no longer read.
    expect(viewer.setSurfaceMaterialStyle).not.toHaveBeenCalled()
    expect(viewer.addSurface).toHaveBeenCalledTimes(2)
  })

  it('is not watched, and the gate still protects it', async () => {
    // The same documented limit as a viewer with no `getSurface` at all: with
    // no readable progress there is no signal to distinguish a slow build from
    // a dead one, and releasing on elapsed time alone is the clock-only
    // watchdog PT-382 item 5 refused.
    const viewer = makeThrowingViewer()
    applySurface(viewer, req(2))
    applySurface(viewer, req(4))      // queued behind the unwatchable build
    await vi.advanceTimersByTimeAsync(120_000)
    expect(viewer.addSurface).toHaveBeenCalledTimes(1)

    // ...and it is the build's own settle that still releases it.
    viewer.settlers[0]()
    await flush()
    expect(viewer.addSurface).toHaveBeenCalledTimes(2)
  })
})

describe('a surface with more than one part', () => {
  it('restores each part’s side to the one IT was built with', async () => {
    // 3Dmol pushes one part per model, and `captureSides`/`restoreSides` walk
    // that array by INDEX. A double stuck at one part can never catch an
    // off-by-one between the capture and the restore.
    // ⚠️ DISTINCT per part, and distinct FROM THE BUILD, because `captureSides`
    // runs inside the build. With every part at DoubleSide, `sides[0]`,
    // `sides[len-1-i]` and `sides[i % 1]` all restore the same picture, so the
    // off-by-one this test names would stay green. Only distinct values pin the
    // MAPPING.
    const viewer = makeViewer({ parts: [DOUBLE_SIDE, 7, 9] })
    applySurface(viewer, req(2, 0.7))
    const surfid = viewer.addSurface.mock.results[0].value.surfid
    viewer.settlers[0].resolve()
    await flush()

    applySurface(viewer, req(2, 1))     // material-only: restyle
    expect(viewer.setSurfaceMaterialStyle).toHaveBeenCalled()
    const parts = viewer.surfaces.get(surfid)!
    expect(parts.length).toBe(3)
    expect([parts[0].mat.side, parts[1].mat.side, parts[2].mat.side])
      .toEqual([DOUBLE_SIDE, 7, 9])
  })
})
