/**
 * viewChangeMux — 3Dmol's one view-change slot, shared.
 *
 * The bug this module exists to prevent is silent: whichever feature registered
 * second used to overwrite the first, and the first went on rendering as if it
 * were still being told about the camera. So the assertions that matter are that
 * BOTH listeners fire, and that releasing one does not release the other.
 */
import { describe, it, expect, vi } from 'vitest'
import { hasViewChangeHook, releaseViewChange, subscribeViewChange } from './viewChangeMux'

function fakeViewer() {
  const viewer = {
    callback: null as ((view: unknown) => void) | null,
    setViewChangeCallback: vi.fn((cb: ((view: unknown) => void) | null) => {
      viewer.callback = cb
    }),
    fire(view: unknown = [1, 2, 3]) {
      viewer.callback?.(view)
    },
  }
  return viewer
}

describe('subscribeViewChange', () => {
  it('delivers to every subscriber, not just the last one', () => {
    const viewer = fakeViewer()
    const handles = vi.fn()
    const cap = vi.fn()
    subscribeViewChange(viewer, handles)
    subscribeViewChange(viewer, cap)

    viewer.fire()

    expect(handles).toHaveBeenCalledTimes(1)
    expect(cap).toHaveBeenCalledTimes(1)
    // One dispatcher installed, not one per subscriber.
    expect(viewer.setViewChangeCallback).toHaveBeenCalledTimes(1)
  })

  it('passes the view through unchanged', () => {
    const viewer = fakeViewer()
    const seen = vi.fn()
    subscribeViewChange(viewer, seen)
    viewer.fire([0, 0, 0, 100, 0, 0, 0, 1])
    expect(seen).toHaveBeenCalledWith([0, 0, 0, 100, 0, 0, 0, 1])
  })

  it('keeps the survivors when one subscriber leaves', () => {
    const viewer = fakeViewer()
    const handles = vi.fn()
    const cap = vi.fn()
    const releaseCap = subscribeViewChange(viewer, cap)
    subscribeViewChange(viewer, handles)

    releaseCap()
    viewer.fire()

    expect(cap).not.toHaveBeenCalled()
    expect(handles).toHaveBeenCalledTimes(1)
    expect(viewer.callback).not.toBeNull()
  })

  it('releases the slot only when the last subscriber leaves', () => {
    const viewer = fakeViewer()
    const a = subscribeViewChange(viewer, vi.fn())
    const b = subscribeViewChange(viewer, vi.fn())

    a()
    expect(viewer.callback).not.toBeNull()
    b()
    expect(viewer.callback).toBeNull()
  })

  it('survives a listener that throws', () => {
    // A throw inside the dispatcher would propagate into 3Dmol's render loop.
    const viewer = fakeViewer()
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const good = vi.fn()
    subscribeViewChange(viewer, () => { throw new Error('boom') })
    subscribeViewChange(viewer, good)

    expect(() => viewer.fire()).not.toThrow()
    expect(good).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })

  it('lets a listener unsubscribe itself from inside the call', () => {
    const viewer = fakeViewer()
    const other = vi.fn()
    let release: (() => void) | null = null
    release = subscribeViewChange(viewer, () => release?.())
    subscribeViewChange(viewer, other)

    expect(() => viewer.fire()).not.toThrow()
    expect(other).toHaveBeenCalledTimes(1)
  })

  it('keeps two subscriptions apart even when they pass the SAME function', () => {
    // A Set keyed on the function itself would collapse these into one, and
    // either unsubscribe would silently cancel both. Two components sharing a
    // module-level handler is an ordinary thing to write.
    const viewer = fakeViewer()
    const shared = vi.fn()
    const releaseA = subscribeViewChange(viewer, shared)
    subscribeViewChange(viewer, shared)

    viewer.fire()
    expect(shared).toHaveBeenCalledTimes(2)

    releaseA()
    shared.mockClear()
    viewer.fire()
    expect(shared).toHaveBeenCalledTimes(1)
    expect(viewer.callback).not.toBeNull()
  })

  it('releaseViewChange hands the slot back AND forgets the subscribers', () => {
    // A teardown that nulls the slot directly would leave this module believing
    // a dispatcher is installed, so the next subscriber would join a set nothing
    // dispatches to — every subscriber silently stops hearing the camera.
    const viewer = fakeViewer()
    const first = vi.fn()
    subscribeViewChange(viewer, first)

    releaseViewChange(viewer)
    expect(viewer.callback).toBeNull()

    const second = vi.fn()
    subscribeViewChange(viewer, second)
    expect(viewer.callback).not.toBeNull()
    viewer.fire()
    expect(second).toHaveBeenCalledTimes(1)
    expect(first).not.toHaveBeenCalled()
  })

  it('is a no-op on a build without the hook', () => {
    const release = subscribeViewChange({ render: () => {} }, vi.fn())
    expect(() => release()).not.toThrow()
  })

  it('recognises the hook', () => {
    expect(hasViewChangeHook({ setViewChangeCallback: () => {} })).toBe(true)
    expect(hasViewChangeHook({})).toBe(false)
    expect(hasViewChangeHook(null)).toBe(false)
  })
})
