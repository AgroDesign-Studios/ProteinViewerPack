/**
 * The offline structure page's payload format: what is written into the
 * page's one slot and `standalone/structure-viewer/blocks.ts` reads back.
 * Every writer — vite-plugins/protein-viewer-pages.ts, which serves the BLANK
 * app, among them — shares it, so the file list, the pins, the shape of a
 * block and the blank app's served paths live here once.
 *
 * Imports only the import-free runtime manifest: the build plugin loads this
 * file too, so it runs in the dev server's own process.
 */
// With its extension: Vite's native config loader takes no extensionless import.
import { PYMOL_ASSET_DIGESTS, PYMOL_RUNTIME_VERSION } from '../pymol-viewer/pymolRuntimeManifest.ts'

export type HtmlExportEdition = 'full' | 'light'
export type HtmlExportEngine = '3dmol' | 'pymol'

/** The one slot in the template the payload replaces; must occur exactly once. */
export const PAYLOAD_MARKER = '<!--@@AGDB-PAYLOAD@@-->'

/**
 * Where the dev server serves the BLANK app (vite-plugins/protein-viewer-
 * pages.ts) and a frame loads it from: one list for both, so the
 * two cannot drift (PT-9216).
 */
export const BLANK_APP_PATHS: Readonly<Record<HtmlExportEdition, Readonly<Record<'ja' | 'en', string>>>> = Object.freeze({
  full: Object.freeze({ ja: '/__agdb/protein-viewer-pack-full-ja.html', en: '/__agdb/protein-viewer-pack-full-en.html' }),
  light: Object.freeze({ ja: '/__agdb/protein-viewer-pack-light-ja.html', en: '/__agdb/protein-viewer-pack-light-en.html' }),
})

/**
 * The fake runtime base the page keys the handed files under. `.invalid` can
 * never resolve (RFC 2606), and the page's CSP connects only to RCSB's file
 * server and GitHub's API (`connect-src https://files.rcsb.org
 * https://api.github.com`, its PDB download and latest-version check), so a key
 * the shim does not hold goes nowhere.
 */
export const STANDALONE_RUNTIME_BASE = `https://agdb-standalone.invalid/pymol/${PYMOL_RUNTIME_VERSION}/`

/**
 * The two scripts a networked frame loads over the network (and so
 * `PYMOL_ASSET_DIGESTS` does not pin) but which the file embeds and runs:
 * pinned here against the vendored README's digest table.
 */
export const RUNTIME_SCRIPT_DIGESTS: Readonly<Record<string, string>> = Object.freeze({
  'pyodide.js': '3141b814715a72e59b51b1b18b9ceae5bf19f7c852417e431bb0a34feadf825c',
  'pyodide.asm.mjs': 'f7cdc8ece80678ceb712f8e65ebe6d3a83203a180c399865f49612a051693635',
})
export const RUNTIME_SCRIPT_BYTES: Readonly<Record<string, number>> = Object.freeze({
  'pyodide.js': 18_912,
  'pyodide.asm.mjs': 1_250_344,
})

/** The runtime's two scripts, in the order the file carries them, and their block names. */
export const RUNTIME_SCRIPT_BLOCKS: readonly (readonly [file: string, block: string])[] = Object.freeze([
  ['pyodide.js', 'pyodide-js'],
  ['pyodide.asm.mjs', 'pyodide-core'],
] as const)

/**
 * The PyMOL runtime's licence files (`<runtime>/licenses/`) and their titles.
 * NOTICES.pymol-third-party.txt is the other people's code in PyMOL itself
 * (pymol-wasm/third_party_notices.py gathers it from the source); the two
 * other NOTICES files are what the Pyodide core links and what NumPy bundles
 * (pymol-wasm/runtime_notices.py).
 */
export const PYMOL_LICENSE_FILES: readonly { file: string; title: string }[] = Object.freeze([
  { file: 'LICENSE.pymol.txt', title: 'Open-Source PyMOL' },
  { file: 'NOTICES.pymol-third-party.txt', title: 'Open-Source PyMOL: third-party code inside it' },
  { file: 'LICENSE.pyodide.txt', title: 'Pyodide' },
  // MPL-2.0 §3.2(a): where the source of the executable form is (PT-9261 item 2).
  { file: 'SOURCE.pyodide.txt', title: 'Pyodide: where its source code is' },
  { file: 'LICENSE.cpython.txt', title: 'CPython' },
  // What pyodide.asm.wasm links besides CPython's own code (PT-9275 item 7; pymol-wasm/runtime_notices.py).
  { file: 'NOTICES.pyodide-core.txt', title: 'Pyodide core: libraries linked into it' },
  { file: 'LICENSE.numpy.txt', title: 'NumPy' },
  { file: 'NOTICES.numpy-bundled.txt', title: 'NumPy: code it bundles' },
  { file: 'LICENSE.emscripten.txt', title: 'Emscripten' },
  { file: 'LICENSE.llvm-libcxx.txt', title: 'LLVM libc++' },
  { file: 'LICENSE.zlib.txt', title: 'zlib' },
  { file: 'LICENSE.libpng.txt', title: 'libpng' },
  { file: 'LICENSE.freetype.txt', title: 'FreeType' },
  { file: 'FTL.freetype.txt', title: 'FreeType (FTL)' },
  { file: 'LICENSE.glm.txt', title: 'GLM' },
  { file: 'COPYRIGHT.musl.txt', title: 'musl libc' },
])

/**
 * The npm packages webpack bundled into 3Dmol-min.js: 3dmol's dependencies,
 * transitively, each by its directory under node_modules — a nested copy by
 * its path, as upng-js carries its own pako 1.x beside the top-level pako 2
 * and 3Dmol-min.js holds both (PT-9262 item 2): the closure from
 * node_modules, resolving each dependency from its parent's directory as Node
 * does. Their licences
 * travel with 3Dmol.js in the file's licence list (owner 2026-11-15).
 */
export const MOL3D_BUNDLED_PACKAGES: readonly string[] = Object.freeze(['iobuffer', 'netcdfjs', 'pako', 'upng-js', 'upng-js/node_modules/pako'])

/** A bundled package's npm name: the last segment of its directory (`upng-js/node_modules/pako` is pako). */
export const bundledPackageName = (dir: string): string => dir.slice(dir.lastIndexOf('/') + 1)

/**
 * The source patches the runtime's Open-Source PyMOL is built with
 * (`<runtime>/patches/`, byte-identical copies of `pymol-wasm/patches/`),
 * in order. Until v1.0.4 the full edition carried them in its `licenses`
 * block as `pymol-change` entries for HELP's 「改良点」; since v1.0.5 they are
 * in the GitHub document that tab links (owner 2026-11-20:
 * standalone/structure-viewer/CODE-CHANGES.md). codeChanges.test.ts holds
 * this list to that document, the copies and the vendor README's table.
 */
export const PYMOL_PATCH_FILES: readonly string[] = Object.freeze([
  '0001-memoryusage-emscripten.patch',
  '0002-shaders-webgl1-fragdepth-ext.patch',
  '0003-glgenbuffer-clear-stale-errors.patch',
  '0004-replabel-es2-use-label-shader.patch',
  '0005-shadermgr-webgl2-glsl-es300.patch',
  '0006-chempy-restricted-unpickler.patch',
  '0007-typeface-truetype-modules-only.patch',
  '0008-repsurface-empty-va-is-null.patch',
  '0009-map-express-two-pass-triangle-start.patch',
  '0010-utf8-byte-lengths-upstream-522.patch',
  '0011-mypng-failed-read-builds-no-image.patch',
  '0012-text-sans-four-fonts-fallback.patch',
  '0013-shadermgr-es300-without-regex.patch',
  '0014-chempy-pkl-bundled-c-unpickler.patch',
])

/**
 * One entry of the `licenses` block. `group` is the engine whose code it is
 * (3Dmol.js and what it bundles, or PyMOL and its runtime): the page's licence
 * list shows them under that engine. `pymol-change` is one of the source
 * patches above (title = its file name), shown by 「改良点」, not as a licence.
 */
export interface LicenceEntry {
  title: string
  text: string
  group: '3dmol' | 'pymol' | 'pymol-change'
}

/**
 * The licence entry's title for a package bundled inside 3Dmol.js. An SPDX
 * expression that comes in its own parentheses (pako's `(MIT AND Zlib)`)
 * keeps one pair, not two (PT-9265 item 1).
 */
export const mol3dBundledTitle = (name: string, version: string, license: string): string =>
  `${name} ${version} (${/^\(.*\)$/.test(license) ? license.slice(1, -1) : license})`

/** A string worker.js must contain for the page to drive it (the standalone core hook: the factory the page's worker script leaves, `pymolBridge.ts`). */
export const WORKER_CORE_HOOK = '__AGDB_CORE_FACTORY'

/** The refusal of a worker.js without WORKER_CORE_HOOK: one text for the build plugin and the AgDB builder (PT-9313 item 2). */
export const WORKER_CORE_HOOK_MISSING = 'worker.js lacks the standalone core hook'

/** Block names are fixed identifiers, never data: anything else is a bug. */
export const BLOCK_NAME = /^[A-Za-z0-9._-]{1,80}$/

/**
 * One block as the page reads it: `b64` is base64 of the gzip of `rawBytes`
 * bytes. The caller checks the name against `BLOCK_NAME` first.
 */
export function blockElement(name: string, b64: string, rawBytes: number): string {
  return `<script type="application/x-agdb-b64" id="agdb-${name}" data-gz="1" data-len="${rawBytes}">${b64}</script>\n`
}

/** The config block the page reads (no secrets, nothing executable). */
export interface StandaloneConfig {
  v: 1
  edition: HtmlExportEdition
  structureId: number
  title: string
  code: string | null
  exporterName: string | null
  lang: 'ja' | 'en'
  initialEngine: HtmlExportEngine
  bColumn: 'plddt' | 'bfactor'
  /** ISO 8601 UTC instant. */
  exportedAt: string
  /** The exporter's IANA zone, so the page shows the time as it was read. */
  timeZone: string | null
  pymolView: number[] | null
  /** Non-molecule PyMOL objects the look did not carry (shown as a note). */
  skipped: string[]
  runtime: { base: string; handed: string[] } | null
}

/** What the full edition's page is told about the handed runtime files. */
export function standaloneRuntime(edition: HtmlExportEdition): StandaloneConfig['runtime'] {
  return edition === 'full' ? { base: STANDALONE_RUNTIME_BASE, handed: Object.keys(PYMOL_ASSET_DIGESTS) } : null
}
