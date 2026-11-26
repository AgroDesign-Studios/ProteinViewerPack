/**
 * The data blocks written into the file: one
 * `<script type="application/x-agdb-b64" id="agdb-<name>">` element per block,
 * gzip + base64 of the bytes, `data-len` their length. Read as text
 * (`textContent`), decoded here, never parsed as markup.
 */

import { extensionOf, type OpenExtension } from './localFile'

/** The config block (`StandaloneConfig`), as this page reads it. */
export interface PageConfig {
  edition: 'full' | 'light'
  structureId: number
  title: string
  code: string | null
  exporterName: string | null
  lang: 'ja' | 'en'
  initialEngine: '3dmol' | 'pymol'
  /** What the B-factor column holds: which of 創薬表示's two colourings by it is open. */
  bColumn: 'plddt' | 'bfactor'
  exportedAt: string
  timeZone: string | null
  pymolView: number[] | null
  skipped: string[]
  runtime: { base: string; handed: string[] } | null
  /**
   * The embedded structure's format when it is not mmCIF: a copy the app made
   * of itself with a file opened from this computer in it (`selfCopy.ts`).
   * Absent (mmCIF) in every file the AgDB builder writes.
   */
  structureFormat?: OpenExtension
}

const el = (name: string): HTMLElement | null => document.getElementById(`agdb-${name}`)

export function hasBlock(name: string): boolean {
  return el(name) !== null
}

function b64ToBytes(b64: string): Uint8Array {
  const native = (Uint8Array as unknown as { fromBase64?: (s: string) => Uint8Array }).fromBase64
  if (typeof native === 'function') return native(b64)
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** The block's bytes; throws when it is missing or its length does not match. */
export async function bytesOf(name: string): Promise<ArrayBuffer> {
  const node = el(name)
  if (node === null) throw new Error(`missing block ${name}`)
  const raw = b64ToBytes((node.textContent ?? '').trim())
  let buf: ArrayBuffer
  if (node.dataset.gz === '1') {
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(raw)
        controller.close()
      },
    })
    const stream = source.pipeThrough(new DecompressionStream('gzip') as unknown as TransformStream<Uint8Array, Uint8Array>)
    buf = await new Response(stream).arrayBuffer()
  } else {
    buf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer
  }
  if (String(buf.byteLength) !== node.dataset.len) throw new Error(`block ${name} is damaged`)
  return buf
}

export async function textOf(name: string): Promise<string> {
  return new TextDecoder().decode(await bytesOf(name))
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const finiteList = (v: unknown, n: number): number[] | null =>
  Array.isArray(v) && v.length === n && v.every(x => typeof x === 'number' && Number.isFinite(x)) ? (v as number[]).slice() : null

/**
 * The config block, every field checked (the builder wrote it, but the file
 * travels: anything malformed falls back rather than reaching the page).
 */
export async function readConfig(): Promise<PageConfig> {
  const raw: unknown = JSON.parse(await textOf('config'))
  const c = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const edition = c.edition === 'full' ? 'full' : 'light'
  const runtime = c.runtime as { base?: unknown; handed?: unknown } | null | undefined
  return {
    edition,
    structureId: typeof c.structureId === 'number' && Number.isSafeInteger(c.structureId) ? c.structureId : 0,
    title: str(c.title),
    code: strOrNull(c.code),
    exporterName: strOrNull(c.exporterName),
    lang: c.lang === 'en' ? 'en' : 'ja',
    initialEngine: edition === 'full' && c.initialEngine === 'pymol' ? 'pymol' : '3dmol',
    bColumn: c.bColumn === 'plddt' ? 'plddt' : 'bfactor',
    exportedAt: str(c.exportedAt),
    timeZone: strOrNull(c.timeZone),
    pymolView: finiteList(c.pymolView, 18),
    skipped: Array.isArray(c.skipped) ? c.skipped.filter((s): s is string => typeof s === 'string') : [],
    runtime:
      edition === 'full' && runtime && typeof runtime.base === 'string' && Array.isArray(runtime.handed)
        ? { base: runtime.base, handed: runtime.handed.filter((s): s is string => typeof s === 'string') }
        : null,
    ...(typeof c.structureFormat === 'string' && c.structureFormat !== 'cif' && extensionOf(`x.${c.structureFormat}`) !== null
      ? { structureFormat: extensionOf(`x.${c.structureFormat}`) as OpenExtension }
      : {}),
  }
}

/** The image types the logo may be, by their first bytes. */
const LOGO_MAGIC: readonly { type: string; head: readonly number[] }[] = [
  { type: 'image/jpeg', head: [0xff, 0xd8, 0xff] },
  { type: 'image/png', head: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
]

/** The most a header logo may be (the builder's own cap). */
export const LOGO_MAX_BYTES = 512 * 1024

/**
 * The exporter's company logo (the `logo` block) as
 * a data: URI for the header, or null when the file has none or it is not a
 * small JPEG or PNG — the header then shows the name alone.
 */
export async function readLogo(): Promise<string | null> {
  if (!hasBlock('logo')) return null
  const bytes = new Uint8Array(await bytesOf('logo'))
  if (bytes.byteLength === 0 || bytes.byteLength > LOGO_MAX_BYTES) return null
  const kind = LOGO_MAGIC.find(m => m.head.every((b, i) => bytes[i] === b))
  if (kind === undefined) return null
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return `data:${kind.type};base64,${btoa(bin)}`
}

/** Runs the embedded 3Dmol.js (its block) from a blob: URL, which sets `window.$3Dmol`. */
export async function load3dmolFromBlock(): Promise<void> {
  const w = window as unknown as { $3Dmol?: unknown }
  if (w.$3Dmol) return
  const buf = await bytesOf('3dmol')
  const url = URL.createObjectURL(new Blob([buf], { type: 'text/javascript' }))
  await new Promise<void>((resolve, reject) => {
    const s = document.createElement('script')
    s.src = url
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('3Dmol.js did not load'))
    document.head.appendChild(s)
  })
}
