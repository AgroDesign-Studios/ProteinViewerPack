/**
 * The latest version's blank app, as text — downloaded (`latestFetch.ts`) or
 * chosen on this computer — checked before this page's data is put in it
 * (owner 2026-11-17, HELP's 「最新版ダウンロード」). It is read, never run:
 * `DOMParser` gives a document with no scripting and no browsing context (no
 * script runs, nothing loads), nothing of it is put in this page or a frame,
 * and the copy is made as text and saved as a Blob (`selfCopy.ts`).
 *
 * What it must be, else it is refused with the reason (a form this version
 * does not know is never guessed at):
 *
 * - no larger than `LATEST_MAX_BYTES`, and its blocks' raw lengths together
 *   under `SHELL_RAW_MAX`; its config block no larger than `CONFIG_MAX`
 *   once unzipped (read with a cap, so a gzip bomb stops there);
 * - this app, of a version this one can write for: one
 *   `<meta name="agdb-viewer-pack">` (`APP_MARKER`), its `content` the app's
 *   version (SemVer) and its `data-config` the config versions it reads,
 *   which must include this app's (`CONFIG_VERSION`); its config block's `v`
 *   one of those. When downloaded, the version is the release tag's; a file
 *   chosen here may be this version or a newer one, never an older one;
 * - of this page's edition, by its config and by its blocks: the full one
 *   with its PyMOL worker, runtime scripts and every runtime file its config
 *   names; the light one with none of them;
 * - every block once, each a gzip + base64 block as the builder writes them
 *   (`blockElement`), the config, the licences and 3Dmol.js among them, and
 *   no copy slot (a page captured, not a file);
 * - one Content-Security-Policy `<meta>` in the head, nothing but a
 *   `<meta charset>` before it and every script after it, that allows
 *   nothing this app's own (`PAGE_CSP`) does not: every directive of this
 *   app's present, each source of each directive one this app allows too,
 *   and `default-src 'none'`. A newer version that needs more is downloaded
 *   by hand from the releases page;
 * - read the same way when the saved file opens: no element whose parse
 *   depends on scripting (`<noscript>`, PR #8790's review), holds raw text or
 *   embeds another document (`FOREIGN`; the app's page has none), and the
 *   page made from it, parsed again, passes the same checks with the same
 *   scripts (a serialisation that reads differently is refused).
 */
import { BLOCK_NAME } from '../../src/pages/structure-html-export/standaloneFormat'
import { compareSemVer, parseSemVer } from './latestRelease'
import { LATEST_MAX_BYTES } from './latestFetch'
import { BLOCK_SELECTOR, captureShell, FULL_ONLY, SLOT_ID, type CopyTarget } from './selfCopy'

/** The app's own mark in its page: `<meta name="agdb-viewer-pack" content="<version>" data-config="<versions read>">`. */
export const APP_MARKER = 'agdb-viewer-pack'

/** The config version this app writes (`v` in `makeAppCopy`'s config), and so the one a shell must read. */
export const CONFIG_VERSION = 1

/**
 * This app's own Content-Security-Policy, as index.html carries it
 * (`boundary.test.ts` holds the two equal): what a shell may allow at most.
 */
export const PAGE_CSP =
  "default-src 'none'; script-src 'unsafe-inline' blob: 'wasm-unsafe-eval'; worker-src blob:; connect-src https://files.rcsb.org https://api.github.com https://raw.githubusercontent.com; img-src data: blob:; style-src 'unsafe-inline'; font-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'"

/**
 * Elements the app's page never has whose reading differs between DOMParser
 * and the opened file (`noscript`), that hold raw text (`noembed`, `noframes`,
 * `xmp`, `plaintext`), or that embed or redirect another document.
 */
const FOREIGN = 'noscript, noembed, noframes, xmp, plaintext, iframe, frame, frameset, object, embed, base'

/**
 * The page's policy as the opened file would apply it, or why not: one CSP
 * `<meta>`, a child of the head with only `<meta charset>` before it, every
 * script after it, no wider than this app's; and no `FOREIGN` element.
 */
function policyProblem(doc: Document): string | null {
  const odd = doc.querySelector(FOREIGN)
  if (odd !== null) return `a <${odd.localName}> element`
  const csps = Array.from(doc.querySelectorAll('meta[http-equiv]')).filter(m => (m.getAttribute('http-equiv') ?? '').trim().toLowerCase() === 'content-security-policy')
  if (csps.length !== 1) return csps.length === 0 ? 'none' : `${csps.length} policies`
  const csp = csps[0]
  if (csp.parentElement !== doc.head) return 'not in the head'
  for (let el = doc.head.firstElementChild; el !== csp; el = el.nextElementSibling) {
    if (el === null || el.localName !== 'meta' || !el.hasAttribute('charset')) return 'an element before it'
  }
  for (const script of Array.from(doc.querySelectorAll('script'))) {
    if (!(csp.compareDocumentPosition(script) & Node.DOCUMENT_POSITION_FOLLOWING)) return 'a script before it'
  }
  const wider = cspWithin(csp.getAttribute('content') ?? '')
  return wider === null ? null : shown(wider)
}

/** The blocks' raw bytes together, at most (the full edition is ~70 MB unzipped). */
export const SHELL_RAW_MAX = 512 * 1024 * 1024

/** The config block, unzipped, at most. */
export const CONFIG_MAX = 256 * 1024

/** Why a file is not used. `detail` names what was found, as text to show. */
export type ShellRefusal =
  | { code: 'too-large' }
  | { code: 'not-app' }
  | { code: 'config-version'; detail: string }
  | { code: 'edition'; detail: 'full' | 'light' }
  | { code: 'version-mismatch'; detail: string }
  | { code: 'older'; detail: string }
  | { code: 'blocks'; detail: string }
  | { code: 'csp'; detail: string }

/** A shell that passed: what `makeAppCopy` needs, and its version. */
export interface CheckedShell extends CopyTarget {
  version: string
}

const SHOWN = 80
const shown = (s: string) => (s.length > SHOWN ? `${s.slice(0, SHOWN)}…` : s)

/** A Content-Security-Policy as its directives (lower-cased names) and their sources; null when a directive comes twice. */
export function parseCsp(policy: string): Map<string, string[]> | null {
  const out = new Map<string, string[]>()
  for (const part of policy.split(';')) {
    const words = part.trim().split(/\s+/).filter(w => w !== '')
    if (words.length === 0) continue
    const name = words[0].toLowerCase()
    if (out.has(name)) return null
    out.set(name, words.slice(1))
  }
  return out
}

/** null when `found` allows nothing `reference` does not; else the directive (and source) that does. */
export function cspWithin(found: string, reference: string = PAGE_CSP): string | null {
  const got = parseCsp(found)
  const ref = parseCsp(reference)
  if (got === null || ref === null) return 'a directive given twice'
  if ((got.get('default-src') ?? []).join(' ') !== "'none'") return 'default-src'
  for (const name of ref.keys()) if (!got.has(name)) return `${name} (missing)`
  for (const [name, sources] of got) {
    const allowed = ref.get(name) ?? ref.get('default-src') ?? []
    for (const source of sources) if (!allowed.includes(source)) return `${name} ${source}`
  }
  return null
}

/** The SemVer text without build metadata (`1.2.0-rc.1`), for the file name. */
function versionText(v: NonNullable<ReturnType<typeof parseSemVer>>): string {
  return `${v.major}.${v.minor}.${v.patch}${v.pre.length > 0 ? `-${v.pre.join('.')}` : ''}`
}

/** Base64 of a block, as the builder writes it (whitespace aside). */
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/

/** gunzip of `b64`, given up past `cap` bytes. */
async function unzipCapped(b64: string, cap: number): Promise<Uint8Array | null> {
  let raw: Uint8Array
  try {
    const bin = atob(b64)
    raw = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) raw[i] = bin.charCodeAt(i)
  } catch {
    return null
  }
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(raw)
      controller.close()
    },
  })
  const reader = source.pipeThrough(new DecompressionStream('gzip') as unknown as TransformStream<Uint8Array, Uint8Array>).getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > cap) {
        await reader.cancel().catch(() => undefined)
        return null
      }
      chunks.push(value)
    }
  } catch {
    return null
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
 * Checks `html` as the latest version's blank app for this page:
 * `edition` this page's, `current` this app's version, `tag` the release's
 * when downloaded (the file's version must be it). The shell to make the
 * copy in, or why it is refused.
 */
export async function inspectShell(
  html: string,
  expect: { edition: 'full' | 'light'; current: string; tag?: string },
): Promise<{ ok: true; shell: CheckedShell } | { ok: false; why: ShellRefusal }> {
  if (html.length > LATEST_MAX_BYTES) return { ok: false, why: { code: 'too-large' } }
  const doc = new DOMParser().parseFromString(html, 'text/html')

  // This app, and which version.
  const marks = doc.querySelectorAll(`meta[name="${APP_MARKER}"]`)
  if (marks.length !== 1) return { ok: false, why: { code: 'not-app' } }
  const mark = marks[0]
  const version = parseSemVer(mark.getAttribute('content') ?? '')
  if (version === null) return { ok: false, why: { code: 'not-app' } }
  const reads = (mark.getAttribute('data-config') ?? '').split(/\s+/).filter(w => /^\d{1,4}$/.test(w)).map(Number)
  if (!reads.includes(CONFIG_VERSION)) return { ok: false, why: { code: 'config-version', detail: shown(mark.getAttribute('data-config') ?? '') } }
  if (expect.tag !== undefined) {
    const tag = parseSemVer(expect.tag)
    if (tag === null || compareSemVer(version, tag) !== 0) return { ok: false, why: { code: 'version-mismatch', detail: versionText(version) } }
  }
  const mine = parseSemVer(expect.current)
  if (mine !== null && compareSemVer(version, mine) < 0) return { ok: false, why: { code: 'older', detail: versionText(version) } }

  // Its policy: one, first in the head, before every script, within this app's.
  const policy = policyProblem(doc)
  if (policy !== null) return { ok: false, why: { code: 'csp', detail: policy } }

  // Its blocks: each once, each as the builder writes it.
  if (doc.getElementById(SLOT_ID) !== null) return { ok: false, why: { code: 'blocks', detail: 'a copy slot' } }
  const names = new Set<string>()
  let raw = 0
  for (const el of Array.from(doc.querySelectorAll<HTMLElement>(BLOCK_SELECTOR))) {
    const name = el.id.startsWith('agdb-') ? el.id.slice('agdb-'.length) : ''
    if (!BLOCK_NAME.test(name)) return { ok: false, why: { code: 'blocks', detail: shown(el.id || '(no id)') } }
    if (names.has(name)) return { ok: false, why: { code: 'blocks', detail: `${name} twice` } }
    names.add(name)
    const len = Number(el.dataset.len)
    if (el.dataset.gz !== '1' || !Number.isSafeInteger(len) || len < 0) return { ok: false, why: { code: 'blocks', detail: name } }
    raw += len
    if (raw > SHELL_RAW_MAX) return { ok: false, why: { code: 'too-large' } }
    if (!BASE64.test((el.textContent ?? '').replace(/\s+/g, ''))) return { ok: false, why: { code: 'blocks', detail: name } }
  }
  for (const need of ['config', 'licenses', '3dmol']) if (!names.has(need)) return { ok: false, why: { code: 'blocks', detail: `${need} missing` } }

  // Its config: its version and edition, and its runtime.
  const cfgEl = doc.getElementById('agdb-config')
  const cfgBytes = cfgEl === null ? null : await unzipCapped((cfgEl.textContent ?? '').replace(/\s+/g, ''), CONFIG_MAX)
  if (cfgEl === null || cfgBytes === null || String(cfgBytes.byteLength) !== cfgEl.dataset.len) return { ok: false, why: { code: 'blocks', detail: 'config' } }
  let cfg: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(cfgBytes))
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not an object')
    cfg = parsed as Record<string, unknown>
  } catch {
    return { ok: false, why: { code: 'blocks', detail: 'config' } }
  }
  if (typeof cfg.v !== 'number' || !reads.includes(cfg.v)) return { ok: false, why: { code: 'config-version', detail: shown(String(cfg.v)) } }
  const edition = cfg.edition === 'full' ? 'full' : cfg.edition === 'light' ? 'light' : null
  if (edition === null) return { ok: false, why: { code: 'blocks', detail: 'config' } }
  if (edition !== expect.edition) return { ok: false, why: { code: 'edition', detail: edition } }
  let runtime: CheckedShell['runtime'] = null
  const fullBlocks = Array.from(names).filter(n => FULL_ONLY.test(n))
  if (edition === 'full') {
    const r = cfg.runtime as { base?: unknown; handed?: unknown } | null | undefined
    if (!r || typeof r.base !== 'string' || !Array.isArray(r.handed) || !r.handed.every((h): h is string => typeof h === 'string')) {
      return { ok: false, why: { code: 'blocks', detail: 'runtime' } }
    }
    runtime = { base: r.base, handed: r.handed.slice() }
    for (const need of ['worker', 'pyodide-js', 'pyodide-core', ...runtime.handed.map(h => `rt-${h}`)]) {
      if (!names.has(need)) return { ok: false, why: { code: 'blocks', detail: shown(`${need} missing`) } }
    }
  } else if (fullBlocks.length > 0) {
    return { ok: false, why: { code: 'edition', detail: 'full' } }
  }

  const captured = captureShell(doc)
  if (captured === null) return { ok: false, why: { code: 'blocks', detail: 'none' } }
  // The page as it will be saved, read again: the same policy, the same scripts but the blocks, one slot.
  const again = new DOMParser().parseFromString(captured.template, 'text/html')
  const policyAgain = policyProblem(again)
  if (policyAgain !== null) return { ok: false, why: { code: 'csp', detail: `${policyAgain} (read again)` } }
  const scripts = doc.querySelectorAll('script').length - names.size
  if (again.querySelectorAll('script').length !== scripts || again.querySelectorAll(`#${SLOT_ID}`).length !== 1) {
    return { ok: false, why: { code: 'csp', detail: 'the page reads differently once saved' } }
  }
  return { ok: true, shell: { template: captured.template, doc, edition, runtime, version: versionText(version) } }
}

/**
 * The bytes of an HTML file as text (UTF-8, the builder's), or null when they
 * are too many; a file that is not UTF-8 then fails as no app.
 */
export function shellText(bytes: Uint8Array): string | null {
  if (bytes.byteLength > LATEST_MAX_BYTES) return null
  return new TextDecoder('utf-8').decode(bytes)
}
