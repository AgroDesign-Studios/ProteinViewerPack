/**
 * HELP's 「今のデータを引き継いだ最新版を別途保存」 (owner 2026-11-17), its download:
 * the blank app of this file's edition, of the latest release, from GitHub.
 *
 * Where from (measured 2026-11-17, `curl -H 'Origin: null'` on a public
 * repository's latest release): the release's own attachment cannot be read
 * by a page — `github.com/<o>/<r>/releases/download/…` and the API's asset
 * address both answer 302 to `release-assets.githubusercontent.com`, which
 * sends no `Access-Control-Allow-Origin`, so the browser refuses the body
 * (GitHub's REST docs promise CORS for `api.github.com` only). Files of a
 * public repository at `raw.githubusercontent.com` answer with
 * `Access-Control-Allow-Origin: *`, a tag name as the ref included. So each
 * release carries the same two blank apps in its tagged commit, under
 * `latest/` with fixed names (`LATEST_FILE`; the distribution runbook, §1),
 * and this reads the one of this edition at the release's tag — the one
 * source, fixed here and in the page's CSP `connect-src`.
 *
 * Nothing of the page goes out (no credentials, no referrer, no structure):
 * the request is the fixed address with the tag in it. No redirect is
 * followed. The body is read up to `LATEST_MAX_BYTES`; when the release
 * lists the same-edition attachment, the file must be exactly as large and,
 * where GitHub gives the attachment's SHA-256, hash to it — a file at the tag
 * that is not the release's is refused. What the file holds is checked after
 * (`latestShell.ts`).
 */
import type { ReleaseAsset } from './latestRelease'

/** The one host the download may use (the page's CSP `connect-src` names it, `boundary.test.ts` holds both). */
export const LATEST_RAW_ORIGIN = 'https://raw.githubusercontent.com'

/** The blank apps each release's tagged commit carries, by edition. */
export const LATEST_FILE: Readonly<Record<'full' | 'light', string>> = Object.freeze({
  full: 'latest/AgroDesign-ProteinViewerPack_full.html',
  light: 'latest/AgroDesign-ProteinViewerPack_light.html',
})

/** The most a download (or a file chosen here) may be: the full edition is ~21 MB. */
export const LATEST_MAX_BYTES = 64 * 1024 * 1024

/** Nothing arriving for this long gives the download up (counted again at the answer and every chunk). */
export const LATEST_IDLE_MS = 30_000

/** The whole download's ceiling, however steadily it comes: 64 MiB at under ~1 Mbit/s. */
export const LATEST_MAX_MS = 10 * 60_000

/** The repository's page, `https://github.com/<owner>/<repo>` (as `latestRelease.ts` reads it). */
const REPO_URL = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/

/** A release tag the address may carry: `v` and SemVer without build metadata. */
const TAG = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

/** The address of `edition`'s blank app at `tag`, or null when the repository or the tag cannot be one. */
export function latestFileUrl(repoUrl: string, tag: string, edition: 'full' | 'light'): string | null {
  const m = REPO_URL.exec(repoUrl)
  if (m === null || !TAG.test(tag)) return null
  return `${LATEST_RAW_ORIGIN}/${m[1]}/${m[2]}/${tag}/${LATEST_FILE[edition]}`
}

/** The release's own attachment of `edition` (`AgroDesign-ProteinViewerPack-v<ver>_<edition>_<date>.html`), when it lists one. */
export function editionAsset(assets: readonly ReleaseAsset[] | undefined, edition: 'full' | 'light'): ReleaseAsset | null {
  const re = new RegExp(`^AgroDesign-ProteinViewerPack-v[0-9A-Za-z.-]+_${edition}_\\d{8}\\.html$`)
  return assets?.find(a => re.test(a.name)) ?? null
}

/** Why the download gave nothing. */
export type FetchFailure =
  /** 404: no such file at the tag (the release made before `latest/` was carried, or no public repository). */
  | { kind: 'not-found' }
  | { kind: 'http'; status: number }
  /** No connection, the browser's CORS or the page's CSP. */
  | { kind: 'network' }
  | { kind: 'timeout' }
  | { kind: 'too-slow' }
  | { kind: 'too-large' }
  /** The answer was a redirect, or came from another address. */
  | { kind: 'redirected' }
  /** Not as large as the release's attachment. */
  | { kind: 'size' }
  /** Not the release's attachment by its SHA-256. */
  | { kind: 'digest' }
  | { kind: 'aborted' }

type FetchLike = (url: string, init: RequestInit) => Promise<Response>

/** SHA-256 of `bytes` as lower-case hex, or null where the browser has no WebCrypto (a page that is not a secure context). */
export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle
  if (subtle === undefined) return null
  const digest = new Uint8Array(await subtle.digest('SHA-256', bytes))
  return Array.from(digest, b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Downloads `url` (`latestFileUrl`'s). `onProgress` is told the bytes so far
 * and the whole (the release's attachment size, when known). `signal` stops
 * it (「中止」). Resolves with the bytes or the reason there are none; never
 * throws.
 */
export async function fetchLatestFile(
  url: string,
  opts: {
    signal: AbortSignal
    expect: ReleaseAsset | null
    onProgress?: (received: number, total: number | null) => void
    fetchImpl?: FetchLike
    idleMs?: number
    maxMs?: number
  },
): Promise<{ ok: true; bytes: Uint8Array<ArrayBuffer> } | { ok: false; why: FetchFailure }> {
  const { signal, expect, onProgress, fetchImpl = (u, init) => fetch(u, init), idleMs = LATEST_IDLE_MS, maxMs = LATEST_MAX_MS } = opts
  const total = expect !== null ? expect.size : null
  const request = new AbortController()
  let timedOut: 'timeout' | 'too-slow' | null = null
  const giveUp = (why: 'timeout' | 'too-slow') => () => {
    timedOut ??= why
    request.abort()
  }
  let idle = setTimeout(giveUp('timeout'), idleMs)
  const progressed = () => {
    clearTimeout(idle)
    idle = setTimeout(giveUp('timeout'), idleMs)
  }
  const ceiling = setTimeout(giveUp('too-slow'), maxMs)
  const stop = () => request.abort()
  if (signal.aborted) request.abort()
  else signal.addEventListener('abort', stop, { once: true })
  const ended = (): FetchFailure => (signal.aborted ? { kind: 'aborted' } : timedOut !== null ? { kind: timedOut } : { kind: 'network' })
  try {
    let res: Response
    try {
      res = await fetchImpl(url, {
        method: 'GET',
        mode: 'cors',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
        redirect: 'manual',
        signal: request.signal,
      })
    } catch {
      return { ok: false, why: ended() }
    }
    progressed()
    if (res.type === 'opaqueredirect' || res.redirected || (res.url !== '' && res.url !== url)) return { ok: false, why: { kind: 'redirected' } }
    if (res.status === 404 || res.status === 410) return { ok: false, why: { kind: 'not-found' } }
    if (!res.ok) return { ok: false, why: { kind: 'http', status: res.status } }
    const cap = total ?? LATEST_MAX_BYTES
    if (cap > LATEST_MAX_BYTES) return { ok: false, why: { kind: 'too-large' } }
    const chunks: Uint8Array[] = []
    let received = 0
    try {
      const reader = res.body?.getReader()
      if (reader === undefined) {
        const all = new Uint8Array(await res.arrayBuffer())
        chunks.push(all)
        received = all.byteLength
      } else {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          progressed()
          chunks.push(value)
          received += value.byteLength
          if (received > cap) {
            await reader.cancel().catch(() => undefined)
            break
          }
          onProgress?.(received, total)
        }
      }
    } catch {
      return { ok: false, why: ended() }
    }
    if (request.signal.aborted) return { ok: false, why: ended() }
    if (received > LATEST_MAX_BYTES) return { ok: false, why: { kind: 'too-large' } }
    if (total !== null && received !== total) return { ok: false, why: { kind: 'size' } }
    const bytes = new Uint8Array(received)
    let at = 0
    for (const c of chunks) {
      bytes.set(c, at)
      at += c.byteLength
    }
    if (expect?.sha256 != null) {
      const got = await sha256Hex(bytes)
      if (got !== null && got !== expect.sha256) return { ok: false, why: { kind: 'digest' } }
    }
    return { ok: true, bytes }
  } finally {
    clearTimeout(idle)
    clearTimeout(ceiling)
    signal.removeEventListener('abort', stop)
  }
}
