import { execFileSync } from 'node:child_process'

/** A short commit id: 7 to 12 hex digits, lower case. */
const SHORT = /^[0-9a-f]{7,12}$/

/**
 * The short commit the offline structure file is built from, for its licence
 * tab's 「ver 1.0.0 (abc1234)」 (owner 2026-11-16; `appLicence.ts` reads what
 * vite.structure-viewer.config.ts writes in): AGDB_GIT_SHA when given (a
 * build without .git passes the commit in AGDB_GIT_SHA), else what git says
 * in `cwd`, else '' — the page then says 「ver
 * 1.0.0」 alone. Never throws: no version is no reason to fail a build.
 * Build-time only (Node); the app never imports it.
 */
export function buildSha(env: Readonly<Record<string, string | undefined>>, git: () => string): string {
  const given = (env.AGDB_GIT_SHA ?? '').trim().toLowerCase().slice(0, 12)
  if (SHORT.test(given)) return given
  try {
    const out = git().trim().toLowerCase()
    return SHORT.test(out) ? out : ''
  } catch {
    return ''
  }
}

/** `git rev-parse --short HEAD` in `cwd`, quietly, for `buildSha`. */
export const gitShortHead = (cwd: string) => (): string =>
  execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 })
