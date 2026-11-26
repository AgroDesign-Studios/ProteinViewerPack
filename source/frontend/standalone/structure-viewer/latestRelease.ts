/**
 * HELP's 「最新版ダウンロード」 (owner 2026-11-16): is this file the newest
 * published version? One question to GitHub's API, the latest release of
 * the app's repository (`APP_GITHUB_URL`), asked only when the person presses
 * the button — never on opening the tab, never on a timer, never again on
 * its own after a failure. The file's second network call beside the RCSB
 * download (`rcsb.ts`); the page's CSP allows `https://api.github.com` for it
 * and nothing else of GitHub's (`boundary.test.ts` holds both).
 *
 * Nothing the page holds goes out: no credentials, no referrer, no structure
 * and no PDB ID — the request is the repository's fixed URL. What comes back
 * is read for two fields, `tag_name` and `html_url`, and the tag is compared
 * as SemVer (`compareSemVer`): the answer lives in memory only. A newer
 * release also keeps its tag and its attachments' names, sizes and SHA-256
 * digests (`assets`), which the download of its blank app checks against
 * (`latestFetch.ts`, owner 2026-11-17).
 */

/** How long the question may take, answer and body together (UI consult: 8 s, then say so). */
export const RELEASE_TIMEOUT_MS = 8_000

/** The repository's page, `https://github.com/<owner>/<repo>`, and nothing more. */
const REPO_URL = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/

/** The API's latest release of the repository at `repoUrl`, or null when that is no GitHub repository page. */
export function latestReleaseApiUrl(repoUrl: string): string | null {
  const m = REPO_URL.exec(repoUrl)
  return m === null ? null : `https://api.github.com/repos/${m[1]}/${m[2]}/releases/latest`
}

/** A version read as SemVer 2.0.0: its three numbers and its pre-release identifiers (build metadata dropped). */
export interface SemVer {
  major: number
  minor: number
  patch: number
  pre: readonly (number | string)[]
}

/** semver.org's grammar: no leading zeros, an optional pre-release, an optional build. */
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/

/**
 * `1.2.3`, `v1.2.3`, `1.2.3-rc.1`, `1.2.3+build.5` as SemVer, or null for
 * anything else (`1.2`, `v1.02.0`, `release-3`): a tag that is not a version
 * cannot be compared, and the panel says so instead of guessing.
 */
export function parseSemVer(input: string): SemVer | null {
  const m = SEMVER.exec(input.trim().replace(/^[vV]/, ''))
  if (m === null) return null
  const nums = [m[1], m[2], m[3]].map(Number)
  if (!nums.every(Number.isSafeInteger)) return null
  const pre = m[4] === undefined ? [] : m[4].split('.').map(id => (/^\d+$/.test(id) ? Number(id) : id))
  // A numeric identifier past 2^53 would compare equal to its neighbours (PT-9495 item 3): no version, as an unsafe major.
  if (pre.some(id => typeof id === 'number' && !Number.isSafeInteger(id))) return null
  return { major: nums[0], minor: nums[1], patch: nums[2], pre }
}

/**
 * SemVer precedence (semver.org §11): the numbers in turn; then a version
 * with a pre-release is lower than the same one without; then the
 * identifiers in turn, numbers below words, numbers by value, words in ASCII
 * order, and the shorter list lower when all before are equal. Build
 * metadata never counts. -1, 0 or 1 as `a` is lower, equal or higher.
 */
export function compareSemVer(a: SemVer, b: SemVer): -1 | 0 | 1 {
  const sign = (n: number): -1 | 0 | 1 => (n < 0 ? -1 : n > 0 ? 1 : 0)
  for (const k of ['major', 'minor', 'patch'] as const) {
    if (a[k] !== b[k]) return sign(a[k] - b[k])
  }
  if (a.pre.length === 0 || b.pre.length === 0) return sign(b.pre.length - a.pre.length)
  for (let i = 0; i < Math.min(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i]
    const y = b.pre[i]
    if (x === y) continue
    if (typeof x === 'number' && typeof y === 'number') return sign(x - y)
    if (typeof x === 'number') return -1
    if (typeof y === 'number') return 1
    return x < y ? -1 : 1
  }
  return sign(a.pre.length - b.pre.length)
}

/** One attachment of a release, as the API lists it: the SHA-256 only where GitHub gives one (`digest: "sha256:…"`). */
export interface ReleaseAsset {
  name: string
  size: number
  sha256: string | null
}

/** The most attachments read from a release, and the longest name kept. */
const ASSETS_READ = 50
const ASSET_NAME_MAX = 200

/** A release's attachments as the API's `assets` lists them; anything not shaped as one is left out. */
export function releaseAssets(raw: unknown): ReleaseAsset[] {
  if (!Array.isArray(raw)) return []
  return raw.slice(0, ASSETS_READ).flatMap((a: unknown) => {
    if (typeof a !== 'object' || a === null) return []
    const { name, size, digest } = a as Record<string, unknown>
    if (typeof name !== 'string' || name === '' || name.length > ASSET_NAME_MAX) return []
    if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0) return []
    const m = typeof digest === 'string' ? /^sha256:([0-9a-f]{64})$/.exec(digest) : null
    return [{ name, size, sha256: m === null ? null : m[1] }]
  })
}

/** What the check found: the comparison, or why there is none. */
export type LatestCheck =
  /** The published latest has the same version number as this file. */
  | { kind: 'same'; latest: string }
  /**
   * A newer version is published; `url` is its release page. `tag` (the
   * release's own, trimmed) and `assets` come with the API's answer, for the
   * download of its blank app.
   */
  | { kind: 'newer'; latest: string; url: string; tag?: string; assets?: readonly ReleaseAsset[] }
  /** This file is newer than the published latest. */
  | { kind: 'ahead'; latest: string }
  /** The latest release's tag (or this file's version) is no SemVer. */
  | { kind: 'unreadable-tag'; tag: string }
  /** No public release: 404 (an unpublished or private repository, or none released yet). */
  | { kind: 'not-found' }
  /** GitHub's request limit for this address is used up (429, or 403 with none remaining). */
  | { kind: 'rate-limited' }
  /** Any other HTTP answer. */
  | { kind: 'http'; status: number }
  /** An answer, but not a release as the API describes one. */
  | { kind: 'bad-answer' }
  /** No connection (offline, blocked, the page's CSP). */
  | { kind: 'network' }
  /** Nothing complete within `RELEASE_TIMEOUT_MS`. */
  | { kind: 'timeout' }

/** The longest tag shown back: a tag is the repository's text, drawn as text, but not a page of it. */
const TAG_SHOWN = 40

/**
 * The comparison of this file's version with the latest release's tag
 * (`v` taken off, SemVer). `htmlUrl` is used only when it is a release page
 * of this repository; else the repository's releases page stands in.
 */
export function judgeRelease(current: string, tag: string, htmlUrl: unknown, repoUrl: string): LatestCheck {
  const mine = parseSemVer(current)
  const theirs = parseSemVer(tag)
  const latest = tag.trim().replace(/^[vV]/, '')
  if (mine === null || theirs === null) return { kind: 'unreadable-tag', tag: (mine === null ? current : tag).slice(0, TAG_SHOWN) }
  const order = compareSemVer(theirs, mine)
  if (order === 0) return { kind: 'same', latest }
  if (order < 0) return { kind: 'ahead', latest }
  const own = typeof htmlUrl === 'string' && htmlUrl.startsWith(`${repoUrl}/releases/`) && !/[\s"'<>]/.test(htmlUrl)
  return { kind: 'newer', latest, url: own ? htmlUrl : `${repoUrl}/releases` }
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>

/**
 * 429, or a 403 that says the limit is used up (the header GitHub exposes to
 * CORS, or its message). A 403 body that stops coming when the timer or the
 * caller ends the request is no answer: the stop is thrown on, to be told as
 * the timeout it is (PT-9495 item 1).
 */
async function rateLimited(res: Response, signal: AbortSignal): Promise<boolean> {
  if (res.status === 429) return true
  if (res.status !== 403) return false
  if (res.headers.get('x-ratelimit-remaining') === '0') return true
  const text = await res.text().catch((e: unknown) => {
    if (signal.aborted) throw e
    return ''
  })
  return /rate limit/i.test(text)
}

/**
 * Asks GitHub for the latest release of `repoUrl` and compares it with
 * `current`. One request, no retry, given up after `timeoutMs` (the answer
 * and its body together) or when `signal` stops it (the dialog closed,
 * which reports nothing: the caller drops it). Never throws.
 */
export async function checkLatestRelease(
  repoUrl: string,
  current: string,
  signal: AbortSignal,
  fetchImpl: FetchLike = (url, init) => fetch(url, init),
  timeoutMs: number = RELEASE_TIMEOUT_MS,
): Promise<LatestCheck> {
  const api = latestReleaseApiUrl(repoUrl)
  if (api === null) return { kind: 'not-found' }
  const request = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    request.abort()
  }, timeoutMs)
  const stop = () => request.abort()
  signal.addEventListener('abort', stop)
  if (signal.aborted) request.abort()
  try {
    const res = await fetchImpl(api, {
      method: 'GET',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      headers: { Accept: 'application/vnd.github+json' },
      signal: request.signal,
    })
    if (res.status === 404) return { kind: 'not-found' }
    if (await rateLimited(res, request.signal)) return { kind: 'rate-limited' }
    if (!res.ok) return { kind: 'http', status: res.status }
    let body: unknown
    try {
      body = JSON.parse(await res.text())
    } catch (e) {
      if (request.signal.aborted) throw e
      return { kind: 'bad-answer' }
    }
    const tag = typeof body === 'object' && body !== null ? (body as Record<string, unknown>).tag_name : undefined
    if (typeof tag !== 'string' || tag.trim() === '') return { kind: 'bad-answer' }
    const judged = judgeRelease(current, tag, (body as Record<string, unknown>).html_url, repoUrl)
    return judged.kind === 'newer' ? { ...judged, tag: tag.trim(), assets: releaseAssets((body as Record<string, unknown>).assets) } : judged
  } catch {
    return timedOut ? { kind: 'timeout' } : { kind: 'network' }
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', stop)
  }
}
