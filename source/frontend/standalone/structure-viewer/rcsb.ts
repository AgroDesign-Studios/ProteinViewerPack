/**
 * 「PDB から読み込む」 in the offline structure file (owner 2026-11-14): the
 * file carries no copy of the PDB — an entry's mmCIF is
 * downloaded from RCSB (`files.rcsb.org`, CORS `*`) straight into the page.
 *
 * One of the file's two network calls (the other, `latestRelease.ts`, asks
 * GitHub's API, a host of its own), and the page's CSP allows exactly this
 * host (`connect-src https://files.rcsb.org`; `boundary.test.ts` holds both).
 * Only the ID goes out: no credentials, no referrer, nothing the page holds.
 * What comes back is handed to `readStructureFile` as a file would be, so it
 * meets the same cap, checks and 3Dmol.js preparation as one from this
 * computer.
 */
import { capOf } from './localFile'

/** Where an entry's mmCIF is: `<base><ID>.cif`. */
export const RCSB_DOWNLOAD_BASE = 'https://files.rcsb.org/download/'

/** A classic PDB ID: a digit 1-9 (no classic ID starts with 0) and three letters or digits (`1CRN`). */
const CLASSIC_ID = /^[1-9][A-Za-z0-9]{3}$/
/** An extended PDB ID (wwPDB, 2024-): `pdb_` and eight letters or digits (`pdb_00001crn`). */
const EXTENDED_ID = /^pdb_[0-9a-z]{8}$/i

/**
 * How long a download may go with nothing arriving before it is given up
 * (the runbook's 30 s for RCSB, PT-9188 item 3): counted again at the answer
 * and at every chunk of the body, so a slow but healthy download of a large
 * entry goes on (PT-9229 item 2). This idle rule, the ceiling below and the
 * absence of a retry are recorded in code-review-prompt.md #10.5's table
 * (PT-9238 item 3).
 */
export const RCSB_TIMEOUT_MS = 30_000
/** The whole download's ceiling, however steadily it comes: 32 MiB at under ~0.5 Mbit/s. */
export const RCSB_MAX_MS = 10 * 60_000

/**
 * The ID as RCSB names its file, or null when `input` is no PDB ID. A classic
 * ID is upper-cased; an extended one that only pads a classic ID
 * (`pdb_0000` + 4) becomes that ID, any other extended one is lower-cased.
 *
 * RCSB serves the extended name too (`files.rcsb.org/download/pdb_00001crn.cif`
 * answers the same file as `1CRN.cif`, checked 2026-11-15, PT-9188 item 8),
 * so an extended ID that pads no classic one is asked for under its own
 * name: until wwPDB issues such IDs, RCSB answers 404 and the person is told
 * there is no such entry, which is true. `pdb_00000001` pads `0001`, no
 * classic ID, so it stays extended.
 */
export function normalizePdbId(input: string): string | null {
  const s = input.trim()
  if (CLASSIC_ID.test(s)) return s.toUpperCase()
  if (!EXTENDED_ID.test(s)) return null
  const lower = s.toLowerCase()
  const tail = lower.slice('pdb_0000'.length)
  return lower.startsWith('pdb_0000') && CLASSIC_ID.test(tail) ? tail.toUpperCase() : lower
}

/** The download's own failures; what it got is judged by `readStructureFile`. */
export type RcsbFailure =
  | { code: 'not-found' }
  | { code: 'http'; status: number }
  | { code: 'network' }
  /** Nothing arrived for `RCSB_TIMEOUT_MS`. */
  | { code: 'timeout' }
  /** Still coming at `RCSB_MAX_MS`. */
  | { code: 'too-slow' }
  | { code: 'aborted' }

/** What `readStructureFile` reads: the downloaded entry as a file named `<ID>.cif`. */
export interface DownloadedFile {
  name: string
  size: number
  arrayBuffer: () => Promise<ArrayBuffer>
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>

const isAbort = (e: unknown, signal: AbortSignal) => signal.aborted || (e instanceof DOMException && e.name === 'AbortError')

/**
 * Reads the body up to `cap + 1` bytes: a larger entry stops there and comes
 * back with the size it reached, which `readStructureFile` refuses as too
 * large before reading it.
 */
async function readUpTo(res: Response, cap: number, progressed: () => void): Promise<Uint8Array> {
  const reader = res.body?.getReader()
  if (reader === undefined) {
    const all = new Uint8Array(await res.arrayBuffer())
    return all.byteLength > cap ? all.subarray(0, cap + 1) : all
  }
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    progressed()
    chunks.push(value)
    total += value.byteLength
    if (total > cap) {
      await reader.cancel().catch(() => undefined)
      break
    }
  }
  const out = new Uint8Array(total)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.byteLength
  }
  return out
}

/**
 * Downloads one entry's mmCIF from RCSB. `id` is `normalizePdbId`'s answer.
 * `signal` stops it (「中止」); `timeoutMs` gives it up on a connection that
 * stalls (a captive portal, a proxy that holds the body) — nothing for that
 * long, before the answer or between chunks — and `maxMs` on one that never
 * ends. Resolves with the entry as a file, or the reason it could not be
 * had: no such entry (404), another HTTP answer, no connection (or the
 * page's CSP), a stall, the ceiling, or stopped.
 */
export async function downloadPdbEntry(
  id: string,
  signal: AbortSignal,
  fetchImpl: FetchLike = (url, init) => fetch(url, init),
  timeoutMs: number = RCSB_TIMEOUT_MS,
  maxMs: number = RCSB_MAX_MS,
): Promise<{ ok: true; file: DownloadedFile } | { ok: false; why: RcsbFailure }> {
  const name = `${id}.cif`
  const cap = capOf('cif')
  // The caller's stop, a stall or the ceiling, whichever comes first, ends the request.
  const request = new AbortController()
  let timedOut: 'timeout' | 'too-slow' | null = null
  const stop = () => request.abort()
  const giveUp = (why: 'timeout' | 'too-slow') => () => {
    timedOut ??= why
    request.abort()
  }
  let idle = setTimeout(giveUp('timeout'), timeoutMs)
  const progressed = () => {
    clearTimeout(idle)
    idle = setTimeout(giveUp('timeout'), timeoutMs)
  }
  const ceiling = setTimeout(giveUp('too-slow'), maxMs)
  if (signal.aborted) request.abort()
  else signal.addEventListener('abort', stop, { once: true })
  const ended = (e: unknown): RcsbFailure =>
    signal.aborted ? { code: 'aborted' } : timedOut !== null ? { code: timedOut } : isAbort(e, request.signal) ? { code: 'aborted' } : { code: 'network' }
  try {
    let res: Response
    try {
      res = await fetchImpl(RCSB_DOWNLOAD_BASE + encodeURIComponent(name), {
        signal: request.signal,
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        mode: 'cors',
      })
    } catch (e) {
      return { ok: false, why: ended(e) }
    }
    progressed()
    if (res.status === 404 || res.status === 410) return { ok: false, why: { code: 'not-found' } }
    if (!res.ok) return { ok: false, why: { code: 'http', status: res.status } }
    const declared = Number(res.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > cap) {
      // Never read: `readStructureFile` refuses it on the size.
      await res.body?.cancel().catch(() => undefined)
      return { ok: true, file: { name, size: declared, arrayBuffer: () => Promise.reject(new Error('too large')) } }
    }
    let bytes: Uint8Array
    try {
      bytes = await readUpTo(res, cap, progressed)
    } catch (e) {
      return { ok: false, why: ended(e) }
    }
    if (request.signal.aborted) return { ok: false, why: ended(null) }
    return {
      ok: true,
      file: { name, size: bytes.byteLength, arrayBuffer: () => Promise.resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer) },
    }
  } finally {
    clearTimeout(idle)
    clearTimeout(ceiling)
    signal.removeEventListener('abort', stop)
  }
}
