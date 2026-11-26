/**
 * Unit tests for useMatchMedia.
 *
 * The test setup reinstalls a `matches: false` matchMedia double before every
 * test, so the first case runs against that double; the others stub their own
 * (`vi.stubGlobal`, undone by `vi.unstubAllGlobals` afterwards). In the
 * stateful stub `state.matches` flips and `fire()` runs the listeners the
 * hook registered, like a window crossing the breakpoint.
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useMatchMedia } from './useMatchMedia'

const Q = '(min-width: 1800px)'

afterEach(() => vi.unstubAllGlobals())

/** A matchMedia whose answer for `Q` can be flipped after the hook subscribed. */
function stubLiveMatchMedia(matches: boolean) {
  const state = { matches }
  const listeners = new Set<() => void>()
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      get matches() {
        return query === Q && state.matches
      },
      media: query,
      onchange: null,
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    })),
  )
  return { state, listeners, fire: () => listeners.forEach(fn => fn()) }
}

describe('useMatchMedia', () => {
  it('is false with the setup double (the narrow tier every other test runs in)', () => {
    const { result } = renderHook(() => useMatchMedia(Q))
    expect(result.current).toBe(false)
    expect(window.matchMedia).toHaveBeenCalledWith(Q)
  })

  it('is true when matchMedia matches the query', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: query === Q,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    )
    const { result } = renderHook(() => useMatchMedia(Q))
    expect(result.current).toBe(true)
    // Another query is not the same answer.
    const { result: other } = renderHook(() => useMatchMedia('(min-width: 4000px)'))
    expect(other.current).toBe(false)
  })

  it("follows 'change': a flipped answer re-renders with the new value", () => {
    const live = stubLiveMatchMedia(false)
    const { result } = renderHook(() => useMatchMedia(Q))
    expect(result.current).toBe(false)
    expect(live.listeners.size).toBe(1)
    act(() => {
      live.state.matches = true
      live.fire()
    })
    expect(result.current).toBe(true)
    act(() => {
      live.state.matches = false
      live.fire()
    })
    expect(result.current).toBe(false)
  })

  it('on unmount, removes the same change listener it added', () => {
    const mql = {
      matches: false,
      media: Q,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }
    vi.stubGlobal('matchMedia', vi.fn(() => mql))
    const { unmount } = renderHook(() => useMatchMedia(Q))
    expect(mql.addEventListener).toHaveBeenCalledTimes(1)
    const [event, added] = mql.addEventListener.mock.calls[0]
    expect(event).toBe('change')
    expect(typeof added).toBe('function')
    expect(mql.removeEventListener).not.toHaveBeenCalled()
    unmount()
    expect(mql.removeEventListener).toHaveBeenCalledTimes(1)
    expect(mql.removeEventListener).toHaveBeenCalledWith('change', added)
  })

  it('is false, and does not throw, where matchMedia does not exist', () => {
    vi.stubGlobal('matchMedia', undefined)
    expect(typeof window.matchMedia).toBe('undefined')
    const { result, unmount } = renderHook(() => useMatchMedia(Q))
    expect(result.current).toBe(false)
    expect(() => unmount()).not.toThrow()
  })
})
