/**
 * The offline file's diagnostics (`installProbe`), which an automated browser
 * test reads from `window.__agdbStandalone`: an uncaught error, an unhandled
 * rejection and a CSP violation are each recorded, cut to their caps.
 */
import { describe, expect, it } from 'vitest'
import { installProbe, probe, type Probe } from './probe'

/** The newest entry (the tsconfig's lib predates `Array.prototype.at`). */
const last = (list: string[]): string => list[list.length - 1]

describe('installProbe', () => {
  it('publishes the probe and records errors, rejections and CSP violations', () => {
    installProbe()
    expect((window as unknown as { __agdbStandalone?: Probe }).__agdbStandalone).toBe(probe)

    window.dispatchEvent(new ErrorEvent('error', { message: `boom ${'x'.repeat(400)}` }))
    expect(last(probe.errors)).toHaveLength(300)
    expect(last(probe.errors).startsWith('boom x')).toBe(true)

    const rejection = (reason: unknown) => {
      const e = new Event('unhandledrejection') as Event & { reason?: unknown }
      e.reason = reason
      window.dispatchEvent(e)
    }
    rejection(new Error('worker gone'))
    expect(last(probe.errors)).toBe('rejection: worker gone')
    rejection(null)
    expect(last(probe.errors)).toBe('rejection: null')
    rejection('plain words')
    expect(last(probe.errors)).toBe('rejection: plain words')

    const csp = new Event('securitypolicyviolation') as Event & { violatedDirective?: string; blockedURI?: string }
    csp.violatedDirective = 'connect-src'
    csp.blockedURI = `https://example.invalid/${'p'.repeat(100)}`
    document.dispatchEvent(csp)
    expect(last(probe.csp)).toBe(`connect-src ${csp.blockedURI.slice(0, 80)}`)
  })
})
