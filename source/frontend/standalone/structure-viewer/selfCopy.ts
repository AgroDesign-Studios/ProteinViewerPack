/**
 * 「HTMLappとして出力（このアプリをコピー）」 (owner 2026-11-15): the app makes
 * a copy of itself — one HTML file, the full or the light edition, with the
 * structure now open in it or blank — from what this page already holds, with
 * no server and no network (the file may be anywhere, a mail attachment on a
 * phone).
 *
 * How (the UI consult's Opus answer): at boot, before React draws anything,
 * `captureTemplate` keeps the page as it arrived, its data blocks taken out
 * and the payload slot marked where they stood (the app's own scripts and
 * styles, the CSP, everything else verbatim). A copy is that template with
 * the blocks put back: the ones that do not change are the page's own,
 * copied as they are (their base64 text, never decoded and re-encoded — the
 * PyMOL runtime is ~20 MB); the config, and the structure when one is put in,
 * are written fresh (gzip by the browser's CompressionStream, as the builder
 * does); the light edition leaves out the PyMOL runtime and PyMOL's licences.
 * Fetching the page's own URL is no way to do it: a file:// page cannot, and
 * the CSP allows only RCSB.
 *
 * The same copy can be made in another app's shell (owner 2026-11-17, HELP's
 * 「最新版ダウンロード」): `captureShell` applies the boot-time capture to any
 * document — the latest release's blank app, parsed (never run) by
 * `latestShell.ts` — and `makeAppCopy` with a `target` keeps that shell's own
 * code, runtime and licences, and puts this page's data in it.
 */
import { PYMOL_ASSET_BYTES } from '../../src/pages/pymol-viewer/pymolRuntimeManifest'
import {
  BLOCK_NAME,
  blockElement,
  RUNTIME_SCRIPT_BLOCKS,
  RUNTIME_SCRIPT_BYTES,
  type LicenceEntry,
} from '../../src/pages/structure-html-export/standaloneFormat'
import type { Mol3dLook } from '../../src/pages/structure-html-export/mol3dLook'
import type { PageConfig } from './blocks'
import type { StructureDoc } from './localFile'
import { SIGNATURE_META } from './releaseSignature'

/** The data blocks' script type (`blocks.ts`, `standaloneFormat.ts` blockElement). */
export const BLOCK_SELECTOR = 'script[type="application/x-agdb-b64"]'

/** The blocks only the full edition carries (PyMOL's runtime and worker). */
export const FULL_ONLY = /^(worker|pyodide-js|pyodide-core|rt-.+)$/

/**
 * Where the blocks stood, in the captured page: an empty element, not the
 * builder's comment marker — a `<!--` in this bundle's own code is refused
 * by the single-file build (an inline script cannot hold one).
 */
export const SLOT_ID = 'agdb-copy-slot'
const SLOT = `<template id="${SLOT_ID}"></template>`

/** The page as it arrived, its blocks out and the payload slot marked; null before `captureTemplate`. */
let template: string | null = null

/** Each block's name and base64 length as the page arrived (the blocks never change after). */
let sizes: readonly { name: string; b64Length: number }[] = []

/**
 * The blocks a full-edition copy cannot be made without, and each one's
 * length (`data-len`; null: any): the worker, the runtime's two scripts and
 * every file the worker hands over, as this app's runtime manifest names
 * them (PT-9276 item 1). A page that lost one gives a copy that cannot start
 * PyMOL, so none is offered.
 */
function defaultRuntimeBlocks(): ReadonlyMap<string, number | null> {
  const m = new Map<string, number | null>([['worker', null]])
  for (const [file, name] of RUNTIME_SCRIPT_BLOCKS) m.set(name, RUNTIME_SCRIPT_BYTES[file] ?? null)
  for (const [file, bytes] of Object.entries(PYMOL_ASSET_BYTES)) m.set(`rt-${file}`, bytes)
  return m
}
let runtimeBlocks: ReadonlyMap<string, number | null> = defaultRuntimeBlocks()

/** For tests: the required runtime blocks of a fixture page. */
export function setRuntimeBlocksForTests(blocks: ReadonlyMap<string, number | null> | null): void {
  runtimeBlocks = blocks ?? defaultRuntimeBlocks()
}

/** A block element's text length, read from its text nodes without building the (up to 20 MB) string. */
function textLength(el: Element): number {
  let n = 0
  for (let c = el.firstChild; c !== null; c = c.nextSibling) if (c.nodeType === 3) n += (c as Text).length
  return n
}

/** The release signature's meta (`releaseSignature.ts`): it belongs to the file AgroDesign signed, never to a copy. */
const isSignature = (node: Node): boolean =>
  node.nodeType === 1 && (node as Element).localName === 'meta' && (node as Element).getAttribute('name') === SIGNATURE_META

/**
 * The page without its blocks, cloned node by node so no block's text is
 * copied (PT-9276 item 3: a deep clone took the ~20 MB runtime with it at
 * startup). The first block's place gets the slot. The release signature is
 * left out (owner 2026-11-17): a copy carries other data than what was signed.
 */
function cloneWithoutBlocks(node: Node, blocks: ReadonlySet<Node>, first: Node, doc: Document): Node | null {
  if (blocks.has(node)) {
    if (node !== first) return null
    const slot = doc.createElement('template')
    slot.id = SLOT_ID
    return slot
  }
  if (isSignature(node)) return null
  const copy = node.cloneNode(false)
  for (let c = node.firstChild; c !== null; c = c.nextSibling) {
    const kid = cloneWithoutBlocks(c, blocks, first, doc)
    if (kid !== null) copy.appendChild(kid)
  }
  return copy
}

/** A document as a shell for copies: its text with the blocks out and the slot where the first stood, and each block's base64 length. */
export interface CapturedShell {
  template: string
  sizes: readonly { name: string; b64Length: number }[]
}

/**
 * `doc` without its blocks, the slot in their place, as text; null when it
 * has no block. The document is only read (cloned node by node): the page's
 * own at boot, or one parsed from a file that is never run.
 */
export function captureShell(doc: Document): CapturedShell | null {
  const blocks = Array.from(doc.querySelectorAll(BLOCK_SELECTOR))
  if (blocks.length === 0) return null
  const root = cloneWithoutBlocks(doc.documentElement, new Set(blocks), blocks[0], doc) as HTMLElement
  const doctype = doc.doctype ? `<!DOCTYPE ${doc.doctype.name}>\n` : '<!DOCTYPE html>\n'
  return {
    template: doctype + root.outerHTML,
    sizes: blocks.flatMap(el => {
      const name = el.id.startsWith('agdb-') ? el.id.slice('agdb-'.length) : ''
      return BLOCK_NAME.test(name) ? [{ name, b64Length: textLength(el) }] : []
    }),
  }
}

/**
 * Keeps the page as it arrived. Call once, before anything changes the
 * document (main.tsx, before React renders and before 3Dmol.js's script is
 * added). The live blocks stay in the page: a copy reads them when it is made.
 */
export function captureTemplate(doc: Document = document): void {
  const shell = captureShell(doc)
  template = shell?.template ?? null
  sizes = shell?.sizes ?? []
}

/** For tests: forget the captured page. */
export function resetTemplateForTests(): void {
  template = null
  sizes = []
  runtimeBlocks = defaultRuntimeBlocks()
}

/** One of the page's own blocks, as it is in the document (base64 text, raw length). */
export interface LiveBlock {
  name: string
  b64: string
  len: number
}

export function liveBlocks(doc: Document): LiveBlock[] {
  return Array.from(doc.querySelectorAll<HTMLElement>(BLOCK_SELECTOR)).flatMap(el => {
    const name = el.id.startsWith('agdb-') ? el.id.slice('agdb-'.length) : ''
    if (!BLOCK_NAME.test(name) || el.dataset.gz !== '1') return []
    return [{ name, b64: (el.textContent ?? '').trim(), len: Number(el.dataset.len) }]
  })
}

async function gzipBase64(bytes: Uint8Array): Promise<string> {
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
  const gz = new Uint8Array(await new Response(source.pipeThrough(new CompressionStream('gzip') as unknown as TransformStream<Uint8Array, Uint8Array>)).arrayBuffer())
  let bin = ''
  for (let i = 0; i < gz.length; i += 0x8000) bin += String.fromCharCode(...gz.subarray(i, i + 0x8000))
  return btoa(bin)
}

async function freshBlock(name: string, bytes: Uint8Array): Promise<string> {
  return blockElement(name, await gzipBase64(bytes), bytes.byteLength)
}

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s)

export type AppCopyEdition = 'full' | 'light'

/**
 * The block a copy carries PyMOL's saved session in (owner 2026-11-16): a
 * `.pse` PyMOL opens instead of the structure, while 3Dmol.js shows the
 * structure. Read by `main.tsx` in the full edition only; PyMOL reads it
 * through the runtime's restricted unpickler, as any `.pse` it opens.
 */
export const PYMOL_SESSION_BLOCK = 'pymol-session'

/**
 * The block a copy carries the 3Dmol.js session in (owner 2026-11-16): the
 * view frozen when it was saved (a `Mol3dLook`), which `main.tsx` shows in
 * place of the exporter's own `mol3d` look. Its own block, apart from that
 * look, so a copy whose 3Dmol.js switch is off leaves it out and keeps the
 * look the file was exported with (PR #8717 review).
 */
export const MOL3D_SESSION_BLOCK = 'mol3d-session'

/** The page carries `name` as it arrived (a session saved into it, say). */
export function carriesBlock(name: string): boolean {
  return sizes.some(b => b.name === name)
}

export interface AppCopyRequest {
  edition: AppCopyEdition
  /** The structure to put in, or null for a blank app. */
  doc: StructureDoc | null
  /** The page's config: what the copy keeps of it (the exporter, the B-factor column, the runtime). */
  config: PageConfig
  /** The language the copy opens in (the one shown now). */
  lang: 'ja' | 'en'
  /** The engine the copy opens on (full edition only). */
  engine: '3dmol' | 'pymol'
  /** When it was made. */
  now: Date
  /**
   * The 3Dmol.js session switch (owner 2026-11-16): on, the copy opens on
   * `mol3dLook` (the view frozen now, `freeze3dmolLook`) in a `mol3d-session`
   * block, or — none frozen — on the session this file opened with; off (or
   * absent), it carries no 3Dmol.js session and opens on the exported look.
   */
  keepMol3dSession?: boolean
  mol3dLook?: Mol3dLook | null
  /**
   * The PyMOL session switch (owner 2026-11-16), full edition only: on, the
   * copy's PyMOL opens on `pymolSession` (a `.pse` written fresh by PyMOL) in
   * a `pymol-session` block — or, when the structure is itself a session, as
   * the structure's bytes — or, none written, on the session this file opened
   * with; off (or absent), it carries no PyMOL session.
   */
  keepPymolSession?: boolean
  pymolSession?: ArrayBuffer | null
}

/** Why a copy cannot be made as asked. */
export type AppCopyRefusal = 'no-template' | 'no-runtime' | 'runtime-damaged' | 'pse-light'

/**
 * Another app's shell a copy is made in (`latestShell.ts` checked it): its
 * text with the slot, the parsed document its blocks are read from, its
 * edition and the runtime its config names. Its code, runtime and licences
 * are kept as they are; this page gives the data.
 */
export interface CopyTarget {
  template: string
  doc: Document
  edition: AppCopyEdition
  runtime: PageConfig['runtime']
}

/** The blocks that are a file's data, not its app: what a copy in another shell takes from this page. */
const DATA_BLOCKS: ReadonlySet<string> = new Set(['config', 'structure', 'mol3d', 'pymol-look', MOL3D_SESSION_BLOCK, PYMOL_SESSION_BLOCK])

/** Is every block the full edition needs in the page, gzipped, with the length the runtime manifest gives? */
function hasRuntime(doc: Document): boolean {
  for (const [name, bytes] of runtimeBlocks) {
    const el = doc.getElementById(`agdb-${name}`)
    if (el === null || el.dataset.gz !== '1' || !el.firstChild) return false
    if (bytes !== null && el.dataset.len !== String(bytes)) return false
  }
  return true
}

/** Can this page make a copy of `edition` with `doc` in it? null when it can. */
export function appCopyRefusal(req: Pick<AppCopyRequest, 'edition' | 'doc' | 'config'>, doc: Document = document): AppCopyRefusal | null {
  if (template === null) return 'no-template'
  if (req.edition === 'full' && (req.config.edition !== 'full' || req.config.runtime === null)) return 'no-runtime'
  if (req.edition === 'full' && !hasRuntime(doc)) return 'runtime-damaged'
  if (req.edition === 'light' && req.doc?.ext === 'pse') return 'pse-light'
  return null
}

/** The structure's own exported identity and looks travel only with the structure the file was made with (serial 0). */
const isOriginal = (d: StructureDoc | null): boolean => d !== null && d.serial === 0

/**
 * The copy, as an HTML Blob. The order of the blocks is the builder's: the
 * config, the structure and its looks, then the page's own others as they
 * stand in the document.
 *
 * With `target` (owner 2026-11-17: this page's data in the latest version),
 * the copy is that shell's: its template, its runtime and licences, its
 * other blocks as they stand in it, and its config's runtime; from this page
 * come only the config's data, the structure and the views (`DATA_BLOCKS`)
 * and the header's logo, when this page has one (the exporter's, else the
 * shell's own). The shell's own data, if it carried any, is left out. The
 * edition must be the shell's.
 */
export async function makeAppCopy(req: AppCopyRequest, doc: Document = document, target: CopyTarget | null = null): Promise<Blob> {
  if (target === null) {
    const refusal = appCopyRefusal(req, doc)
    if (refusal !== null || template === null) throw new Error(refusal ?? 'no-template')
  } else {
    if (req.edition !== target.edition) throw new Error('edition')
    if (req.edition === 'light' && req.doc?.ext === 'pse') throw new Error('pse-light')
    if (req.edition === 'full' && target.runtime === null) throw new Error('no-runtime')
  }
  const shellText = target === null ? (template as string) : target.template
  const { edition, config, lang, engine, now } = req
  const structure = req.doc
  const original = isOriginal(structure)
  const live = liveBlocks(doc)
  // Each session only with its switch on: the one captured now, else the
  // page's own (it opened with it); a blank app carries none.
  const keepLook = req.keepMol3dSession === true && structure !== null && structure.ext !== 'pse'
  const keepSession = req.keepPymolSession === true && structure !== null && edition === 'full'
  const look = keepLook ? (req.mol3dLook ?? null) : null
  const session = keepSession ? (req.pymolSession ?? null) : null
  const sessionIsStructure = session !== null && structure?.ext === 'pse'
  const keep = (b: LiveBlock): boolean => {
    if (b.name === 'config' || b.name === 'structure' || b.name === 'licenses') return false
    if (b.name === 'mol3d') return original
    if (b.name === MOL3D_SESSION_BLOCK) return original && keepLook && look === null
    if (b.name === PYMOL_SESSION_BLOCK) return original && keepSession && session === null
    if (b.name === 'pymol-look') return original && edition === 'full'
    if (FULL_ONLY.test(b.name)) return edition === 'full'
    return true
  }
  const out: string[] = []
  // Who exported it and when describe the structure the file was made with:
  // an original copy keeps them, anything else (a file opened here, a blank
  // app) names no exporter and is dated when it is made (PT-9275 item 1).
  const cfg = {
    v: 1,
    edition,
    structureId: original ? config.structureId : 0,
    title: structure === null ? '' : original ? config.title : structure.name,
    code: original ? config.code : (structure?.pdbId ?? null),
    exporterName: original ? config.exporterName : null,
    lang,
    initialEngine: edition === 'full' ? engine : '3dmol',
    bColumn: config.bColumn,
    exportedAt: original && config.exportedAt !== '' ? config.exportedAt : now.toISOString(),
    timeZone: original && config.exportedAt !== '' ? config.timeZone : localZone(),
    pymolView: original ? config.pymolView : null,
    skipped: original ? config.skipped : [],
    runtime: edition === 'full' ? (target === null ? config.runtime : target.runtime) : null,
    ...(structure !== null && structure.ext !== 'cif' ? { structureFormat: structure.ext } : {}),
  }
  out.push(await freshBlock('config', utf8(JSON.stringify(cfg))))
  if (structure !== null) {
    if (sessionIsStructure && session !== null) out.push(await freshBlock('structure', new Uint8Array(session)))
    else {
      const own = original ? live.find(b => b.name === 'structure') : undefined
      out.push(own ? blockElement('structure', own.b64, own.len) : await freshBlock('structure', new Uint8Array(structure.bytes)))
    }
  }
  if (look !== null) out.push(await freshBlock(MOL3D_SESSION_BLOCK, utf8(JSON.stringify(look))))
  if (session !== null && !sessionIsStructure) out.push(await freshBlock(PYMOL_SESSION_BLOCK, new Uint8Array(session)))
  if (target !== null) {
    // This page's data and its logo, then the shell's own blocks, its data and licences aside.
    const ownLogo = live.some(b => b.name === 'logo')
    for (const b of live) if ((DATA_BLOCKS.has(b.name) && keep(b)) || b.name === 'logo') out.push(blockElement(b.name, b.b64, b.len))
    const shell = liveBlocks(target.doc)
    for (const b of shell) {
      if (DATA_BLOCKS.has(b.name) || b.name === 'licenses' || (b.name === 'logo' && ownLogo)) continue
      if (FULL_ONLY.test(b.name) && edition !== 'full') continue
      out.push(blockElement(b.name, b.b64, b.len))
    }
    const lic = shell.find(b => b.name === 'licenses')
    if (lic !== undefined) out.push(blockElement('licenses', lic.b64, lic.len))
    return new Blob([shellText.replace(SLOT, () => out.join(''))], { type: 'text/html' })
  }
  for (const b of live) if (keep(b)) out.push(blockElement(b.name, b.b64, b.len))
  // The licences: the page's own block for the same edition; the light
  // edition from a full page without PyMOL's (it carries none of its code).
  const lic = live.find(b => b.name === 'licenses')
  if (lic !== undefined) {
    if (edition === config.edition) out.push(blockElement('licenses', lic.b64, lic.len))
    else {
      const all = JSON.parse(await licencesText(lic)) as LicenceEntry[]
      out.push(await freshBlock('licenses', utf8(JSON.stringify(all.filter(l => l.group === '3dmol' || (l.group === undefined && l.title === '3Dmol.js'))))))
    }
  }
  return new Blob([shellText.replace(SLOT, () => out.join(''))], { type: 'text/html' })
}

function localZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null
  } catch {
    return null
  }
}

async function licencesText(b: LiveBlock): Promise<string> {
  const bin = atob(b.b64)
  const raw = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) raw[i] = bin.charCodeAt(i)
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(raw)
      controller.close()
    },
  })
  return new TextDecoder().decode(await new Response(source.pipeThrough(new DecompressionStream('gzip') as unknown as TransformStream<Uint8Array, Uint8Array>)).arrayBuffer())
}

/**
 * About how large the copy will be, in bytes: the template, the page's own
 * blocks it keeps, and a new structure at about half its size (gzip + base64
 * of a text format; a .pse is counted whole). Reads only the lengths kept at
 * capture, so a render of the dialog costs nothing (PT-9275 item 5).
 *
 * The sessions (PT-9552 item 3): a session block the page carries counts when
 * its switch keeps it and none is captured now; a PyMOL session written now
 * (`freshPymolSession`) counts as 0.75 of the structure's bytes — measured on
 * 25HN 2026-11-16: a 3,913,034-byte mmCIF gave a 12,775,258-byte .pse,
 * 2,842,148 characters once gzipped and base64 (0.73). A 3Dmol.js view frozen
 * now is a few tens of kB, left out.
 */
export function estimateAppCopy(
  req: Pick<AppCopyRequest, 'edition' | 'doc' | 'config' | 'keepMol3dSession' | 'keepPymolSession'> & { freshMol3dSession?: boolean; freshPymolSession?: boolean },
): number {
  if (template === null) return 0
  const original = isOriginal(req.doc)
  const keepLook = req.keepMol3dSession === true && req.doc !== null && req.doc.ext !== 'pse'
  const keepSession = req.keepPymolSession === true && req.doc !== null && req.edition === 'full'
  let n = template.length
  for (const b of sizes) {
    if (b.name === 'structure') {
      if (original) n += b.b64Length
      continue
    }
    if (b.name === 'mol3d' && !original) continue
    // A session the page carries goes in only with its switch on and none captured now (makeAppCopy's keep).
    if (b.name === PYMOL_SESSION_BLOCK && !(original && keepSession && req.freshPymolSession !== true)) continue
    if (b.name === MOL3D_SESSION_BLOCK && !(original && keepLook && req.freshMol3dSession !== true)) continue
    if (b.name === 'pymol-look' && (!original || req.edition !== 'full')) continue
    if (FULL_ONLY.test(b.name) && req.edition !== 'full') continue
    n += b.b64Length + 120
  }
  if (req.doc !== null && !original) n += Math.round(req.doc.bytes.byteLength * (req.doc.ext === 'pse' ? 1.37 : 0.5))
  // A session written now beside the structure (one that is the structure replaces it, counted above).
  if (keepSession && req.freshPymolSession === true && req.doc !== null && req.doc.ext !== 'pse') n += Math.round(req.doc.bytes.byteLength * 0.75)
  return n
}
