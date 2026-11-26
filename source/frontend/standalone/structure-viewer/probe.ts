/**
 * Read-only diagnostics for an automated browser test (it reads
 * `window.__agdbStandalone`): errors, CSP violations and where each engine
 * stands. It holds no data of the structure and controls nothing.
 */
export interface Probe {
  errors: string[]
  csp: string[]
  dmol: string
  py: string
}

export const probe: Probe = { errors: [], csp: [], dmol: 'off', py: 'off' }

export function installProbe(): void {
  ;(window as unknown as { __agdbStandalone?: Probe }).__agdbStandalone = probe
  document.addEventListener('securitypolicyviolation', e => probe.csp.push(`${e.violatedDirective} ${String(e.blockedURI).slice(0, 80)}`))
  window.addEventListener('error', e => probe.errors.push(String(e.message).slice(0, 300)))
  window.addEventListener('unhandledrejection', e => {
    const r = e.reason as { message?: unknown } | null
    probe.errors.push(`rejection: ${String(r && r.message !== undefined ? r.message : r).slice(0, 300)}`)
  })
}
