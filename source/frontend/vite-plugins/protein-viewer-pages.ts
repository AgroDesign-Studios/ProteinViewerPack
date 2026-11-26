import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { promisify } from 'node:util'
import { gzip } from 'node:zlib'
import { PYMOL_ASSET_BYTES, PYMOL_ASSET_DIGESTS, PYMOL_RUNTIME_VERSION } from '../src/pages/pymol-viewer/pymolRuntimeManifest.ts'
import {
  BLANK_APP_PATHS,
  BLOCK_NAME,
  blockElement,
  bundledPackageName,
  MOL3D_BUNDLED_PACKAGES,
  mol3dBundledTitle,
  PAYLOAD_MARKER,
  PYMOL_LICENSE_FILES,
  RUNTIME_SCRIPT_BLOCKS,
  RUNTIME_SCRIPT_BYTES,
  RUNTIME_SCRIPT_DIGESTS,
  standaloneRuntime,
  WORKER_CORE_HOOK,
  WORKER_CORE_HOOK_MISSING,
  type HtmlExportEdition,
  type LicenceEntry,
  type StandaloneConfig,
} from '../src/pages/structure-html-export/standaloneFormat.ts'
import type { DerivedPages } from './derived-pages.ts'

/**
 * The BLANK Protein Viewer Pack — the offline structure app with no structure
 * in it — served at fixed paths. This plugin sets no response header: a
 * server that serves these paths must send, with each page, a header that
 * sandboxes it wherever it is opened and limits who may frame it (CSP
 * `sandbox` and `frame-ancestors`), since a page opened at its own URL is
 * otherwise not sandboxed at all. A document served from its own URL carries
 * its own policy: the page's own CSP meta.
 *
 * The page is a blank source with no logo — the template and its blocks in
 * order, with the files and pins of standaloneFormat.ts and
 * pymolRuntimeManifest.ts (import-free so this plugin can load them).
 * Four variants: the full edition (PyMOL, ~21 MB) and the light one (3Dmol.js,
 * ~0.9 MB), each opening in Japanese or English (the app has its own toggle).
 * No logo: the header carries the app's name alone.
 *
 * Caching: the gzip+base64 blocks of each edition are made once and shared
 * by both languages, until a file they are made from changes under
 * public/vendor/pymol/ (worker.js can change without a version bump; Vite's
 * watcher reports it, `affectsBlocks`, PT-9212) — a runtime
 * upgrade changes pymolRuntimeManifest.ts, which this config loads, so Vite
 * restarts the server. node_modules/3dmol is not watched (Vite's watcher
 * skips node_modules); it changes only with an `npm install`, after which
 * the server must be restarted (Vite does not restart for it) for the blocks
 * to be made again. Each page is
 * re-assembled when the template it is made from changes, or its blocks
 * (derived-pages.ts `DerivedPages`).
 */

/** The four served paths, from the one list (standaloneFormat.ts BLANK_APP_PATHS). */
const PAGES: ReadonlyMap<string, { edition: HtmlExportEdition; lang: 'ja' | 'en' }> = new Map(
  (Object.keys(BLANK_APP_PATHS) as HtmlExportEdition[]).flatMap(edition =>
    (['ja', 'en'] as const).map(lang => [BLANK_APP_PATHS[edition][lang], { edition, lang }] as const),
  ),
)

export const PROTEIN_VIEWER_PAGE_PATHS: readonly string[] = Object.freeze([...PAGES.keys()])

const gzipAsync = promisify(gzip)

/** Decoded and re-encoded exactly as the browser builder's fetchText → TextEncoder does. */
const asUtf8Text = (buf: Uint8Array): Buffer => Buffer.from(new TextDecoder().decode(buf), 'utf8')

const sha256 = (buf: Uint8Array): string => createHash('sha256').update(buf).digest('hex')

async function block(name: string, bytes: Uint8Array): Promise<string> {
  if (!BLOCK_NAME.test(name)) throw new Error(`bad block name ${name}`)
  // Async: the zlib work runs off the dev server's event loop (~1 s for the full edition).
  const gz = await gzipAsync(bytes)
  return blockElement(name, gz.toString('base64'), bytes.byteLength)
}

/** A pinned runtime file: its exact length and SHA-256, or the page is refused. */
async function pinned(file: string, full: string, bytes: number, digest: string): Promise<Buffer> {
  const buf = await readFile(full)
  if (buf.byteLength !== bytes) throw new Error(`${file}: ${buf.byteLength} bytes, pinned ${bytes}`)
  const actual = sha256(buf)
  if (actual !== digest) throw new Error(`${file}: SHA-256 ${actual} does not match the pinned ${digest}`)
  return buf
}

/** Where the files come from: the frontend root (`public/`, `node_modules/`). */
export interface PageFiles {
  root: string
}

/** Every block of an edition after the config block, in the builder's order. */
export async function editionBlocks(edition: HtmlExportEdition, { root }: PageFiles): Promise<string[]> {
  const blocks: string[] = []
  const dmolDir = path.dirname(createRequire(path.join(root, 'package.json')).resolve('3dmol/package.json'))
  blocks.push(await block('3dmol', Buffer.from(await readFile(path.join(dmolDir, 'build', '3Dmol-min.js'), 'utf8'), 'utf8')))
  const licences: LicenceEntry[] = [{ title: '3Dmol.js', text: await readFile(path.join(dmolDir, 'LICENSE'), 'utf8'), group: '3dmol' }]
  // The packages bundled inside 3Dmol-min.js, as the browser builder reads them.
  // Each by its directory under node_modules: a nested copy (upng-js's own pako) is a path, not a name to resolve.
  const nodeModules = path.dirname(dmolDir)
  for (const name of MOL3D_BUNDLED_PACKAGES) {
    const dir = path.join(nodeModules, name)
    const meta = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8')) as { version?: unknown; license?: unknown }
    licences.push({ title: mol3dBundledTitle(bundledPackageName(name), String(meta.version ?? '?'), String(meta.license ?? '?')), text: await readFile(path.join(dir, 'LICENSE'), 'utf8'), group: '3dmol' })
  }
  if (edition === 'full') {
    const runtime = path.join(root, 'public', 'vendor', 'pymol', PYMOL_RUNTIME_VERSION)
    for (const { file, title } of PYMOL_LICENSE_FILES) {
      licences.push({ title, text: new TextDecoder().decode(await readFile(path.join(runtime, 'licenses', file))), group: 'pymol' })
    }
    const worker = asUtf8Text(await readFile(path.join(runtime, 'worker.js')))
    if (!worker.includes(WORKER_CORE_HOOK)) throw new Error(WORKER_CORE_HOOK_MISSING)
    blocks.push(await block('worker', worker))
    for (const [file, name] of RUNTIME_SCRIPT_BLOCKS) {
      blocks.push(await block(name, await pinned(file, path.join(runtime, file), RUNTIME_SCRIPT_BYTES[file], RUNTIME_SCRIPT_DIGESTS[file])))
    }
    for (const file of Object.keys(PYMOL_ASSET_DIGESTS)) {
      blocks.push(await block('rt-' + file, await pinned(file, path.join(runtime, file), PYMOL_ASSET_BYTES[file], PYMOL_ASSET_DIGESTS[file])))
    }
  }
  blocks.push(await block('licenses', Buffer.from(JSON.stringify(licences), 'utf8')))
  return blocks
}

/** The config block of a blank page: no structure, look, view or name; the viewer's own time zone. */
export function blankConfig(edition: HtmlExportEdition, lang: 'ja' | 'en', made: Date): StandaloneConfig {
  return {
    v: 1,
    edition,
    structureId: 0,
    title: '',
    code: null,
    exporterName: null,
    lang,
    initialEngine: '3dmol',
    bColumn: 'bfactor',
    exportedAt: made.toISOString(),
    timeZone: null,
    pymolView: null,
    skipped: [],
    runtime: standaloneRuntime(edition),
  }
}

/** The page as parts (joined on the wire): the template with its payload slot filled. */
export async function blankPageParts(
  template: string,
  edition: HtmlExportEdition,
  lang: 'ja' | 'en',
  blocks: readonly string[],
  made: Date,
): Promise<string[]> {
  const at = template.indexOf(PAYLOAD_MARKER)
  if (at < 0 || template.indexOf(PAYLOAD_MARKER, at + 1) >= 0) throw new Error('the viewer page has no single payload slot')
  const config = await block('config', Buffer.from(JSON.stringify(blankConfig(edition, lang, made)), 'utf8'))
  return [template.slice(0, at), config, ...blocks, template.slice(at + PAYLOAD_MARKER.length)]
}

/** True for a changed file a page's blocks are read from (the PyMOL runtime under public/). */
export function affectsBlocks(root: string, file: string): boolean {
  const rel = path.relative(root, file)
  if (rel.startsWith('..') || path.isAbsolute(rel)) return false
  return rel.startsWith(path.join('public', 'vendor', 'pymol') + path.sep)
}

/** The four pages, for `standaloneTemplate(STRUCTURE_VIEWER_SPEC, { derived })`; files are read under Vite's root. */
export function proteinViewerPages(now: () => Date = () => new Date()): DerivedPages {
  // One build per edition until its files change; a failed one is forgotten so the next request retries it.
  const memo = new Map<HtmlExportEdition, Promise<string[]>>()
  const blocksOf = (edition: HtmlExportEdition, root: string): Promise<string[]> => {
    let run = memo.get(edition)
    if (run === undefined) {
      run = editionBlocks(edition, { root })
      memo.set(edition, run)
      run.catch(() => {
        if (memo.get(edition) === run) memo.delete(edition)
      })
    }
    return run
  }
  return {
    label: 'protein viewer pack page',
    paths: PROTEIN_VIEWER_PAGE_PATHS,
    async render(template, servedPath, root) {
      const page = PAGES.get(servedPath)
      if (page === undefined) throw new Error(`not a protein viewer pack page: ${servedPath}`)
      return blankPageParts(template, page.edition, page.lang, await blocksOf(page.edition, root), now())
    },
    affects: affectsBlocks,
    invalidate() {
      // A build still running read the old files: it is dropped with the rest
      // (its own failure handler checks it is still the one held).
      memo.clear()
    },
  }
}
