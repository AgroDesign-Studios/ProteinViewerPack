import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mocked for the reason this module was split out of surfaceType.ts in the
// first place: errorCapture is the error reporter (mocked in unit tests), an
// integration boundary a unit test has no business loading.
vi.mock('../../utils/errorCapture', () => ({ reportBoundaryError: vi.fn() }))

import { reportBoundaryError } from '../../utils/errorCapture'
import { reportSurfaceFailure } from './surfaceFailure'

describe('reportSurfaceFailure', () => {
  beforeEach(() => {
    vi.mocked(reportBoundaryError).mockClear()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reports through the explicit channel, not by leaving the promise unhandled', () => {
    // The whole point: a bare console.warn would have deleted the only
    // report, because errorCapture hooks window.error and
    // unhandledrejection and never reads the console.
    reportSurfaceFailure({ message: 'worker died' })
    expect(reportBoundaryError).toHaveBeenCalledTimes(1)
    const err = vi.mocked(reportBoundaryError).mock.calls[0][0] as Error
    expect(err.name).toBe('SurfaceGenerationError')
    expect(err.message).toContain('worker died')
  })

  it('reports EVERY occurrence — no page-lifetime suppression', () => {
    // This is the contract, not an oversight. The reporter may drop a send it
    // cannot make at that moment, so an "already reported" gate would latch on
    // an attempt that never sent and swallow every later identical failure for
    // the life of the tab. The reporter bounds the volume itself; the repeat
    // count is what separates a one-off from a persistent break.
    reportSurfaceFailure({ message: 'worker died' })
    reportSurfaceFailure({ message: 'worker died' })
    reportSurfaceFailure({ message: 'worker died' })
    expect(reportBoundaryError).toHaveBeenCalledTimes(3)
    expect(console.warn).toHaveBeenCalledTimes(3)
  })

  it('survives the shapes a rejected surface build actually hands back', () => {
    // A DOM ErrorEvent, not an Error: no .stack, and .name is undefined. It
    // runs inside a promise catch, so throwing here would create the very
    // unhandled rejection it exists to prevent.
    expect(() => reportSurfaceFailure(undefined)).not.toThrow()
    expect(() => reportSurfaceFailure(null)).not.toThrow()
    expect(() => reportSurfaceFailure('a bare string')).not.toThrow()
    expect(() => reportSurfaceFailure({ nothing: true })).not.toThrow()
    // Times, not merely "called": a count of 1 would also satisfy
    // `toHaveBeenCalled()` while three of the four shapes were being swallowed.
    expect(reportBoundaryError).toHaveBeenCalledTimes(4)
  })

  it('always hands reportBoundaryError a real Error, whatever it was given', () => {
    reportSurfaceFailure(undefined)
    const err = vi.mocked(reportBoundaryError).mock.calls[0][0] as Error
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('SurfaceGenerationError')
  })
})
