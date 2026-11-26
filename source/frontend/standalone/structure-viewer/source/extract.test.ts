/**
 * The viewer's published source (`extract.json`, PT-9911) is closed under
 * its imports: every module a declared file imports — by value, by type, in
 * a dynamic import or a `vi.mock` — is declared too, and every package it
 * imports by value is one the declaration's `package` lists. With the entry,
 * the build config, the release script and the test setup declared, that is
 * what lets the extract type-check, build and run its tests on its own. A
 * file that starts importing an undeclared module fails here. The same test
 * runs in the extract.
 *
 * Files read at run time (the PyMOL runtime, 3Dmol.js, fixtures) are not
 * imports; a clean build of the extract is their check. When frontend/ runs
 * alone, the declared files outside frontend/ (the release scripts,
 * pymol-wasm/) are skipped; a whole checkout checks them.
 *
 * Also here (PT-9911 PR C): the viewer's own directory is decided file by
 * file (PT-10171 item 1: a file added there is published or withheld by name,
 * never by a directory rule), and the extract carries its README and LICENSE
 * at its top — the app's MIT text, then what it does not cover — beside the
 * runtime's own licence files, untransformed.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { basename, join, posix, resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { PYMOL_RUNTIME_VERSION } from '../../../src/pages/pymol-viewer/pymolRuntimeManifest'
import { STANDALONE_ALIASES } from '../aliases'
import { APP_LICENCE_TEXT } from '../appLicence'
import extract from './extract.json'
import { SOURCE_TESTS } from './sourceTests'

const FRONTEND = resolve(__dirname, '..', '..', '..')
/** frontend/ sits in a whole checkout (scripts/ beside it), not on its own. */
const WHOLE_CHECKOUT = basename(FRONTEND) === 'frontend' && existsSync(join(FRONTEND, '..', 'scripts'))
/** A repository path on disk: under frontend/ wherever it is mounted; anything else beside it. */
const abs = (p: string): string =>
  p.startsWith('frontend/') ? join(FRONTEND, ...p.slice('frontend/'.length).split('/')) : join(FRONTEND, '..', ...p.split('/'))
/** Whether this run can read `p`: everything in a whole checkout, frontend/ alone otherwise. */
const readable = (p: string): boolean => WHOLE_CHECKOUT || p.startsWith('frontend/')

/** This run is inside the extract (its manifest sits beside frontend/). */
const IN_EXTRACT = existsSync(join(FRONTEND, '..', 'EXTRACT.json'))
const ROOT: Record<string, string> = extract.root
const WITHHELD: Record<string, string> = extract.withheld

/** Every file under `dir` (a repository path) on disk, as repository paths. */
function filesUnder(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(abs(dir))) {
    const child = `${dir}/${name}`
    if (statSync(abs(child)).isDirectory()) out.push(...filesUnder(child))
    else out.push(child)
  }
  return out
}

/** A root file's text: at the extract's top there, at its source path here. */
const rootText = (name: string): string =>
  readFileSync(IN_EXTRACT ? join(FRONTEND, '..', name) : abs(ROOT[name]), 'utf8')

/** Every file the declaration takes from a commit, as repository paths (the working tree stands in for the commit). */
function declared(): Set<string> {
  const out = new Set<string>(extract.files)
  const walk = (p: string): void => {
    for (const name of readdirSync(abs(p))) {
      const child = `${p}/${name}`
      if (statSync(abs(child)).isDirectory()) walk(child)
      else out.add(child)
    }
  }
  extract.trees.forEach(walk)
  return out
}

/** The extract's module set: the declared files and the shims written in place of modules it does not carry. */
const DECLARED = declared()
const MODULES = new Set([...DECLARED, ...Object.keys(extract.shims)])
const ALIASES = new Map(STANDALONE_ALIASES.map(a => [`frontend/${a.find}`, `frontend/${a.replacement}`]))
const EXTS = ['', '.ts', '.tsx', '.js', '.mjs', '.json', '/index.ts', '/index.tsx']

/** A relative import of `from` as a repository path: an alias first (as the build applies it), else the declared or existing file. */
function resolveImport(from: string, spec: string): string | null {
  const base = posix.join(posix.dirname(from), spec.split('?')[0])
  const aliased = ALIASES.get(base)
  if (aliased !== undefined) return aliased
  for (const ext of EXTS) if (MODULES.has(base + ext)) return base + ext
  for (const ext of EXTS) if (existsSync(abs(base + ext)) && statSync(abs(base + ext)).isFile()) return base + ext
  return null
}

interface Imports {
  /** Relative specifiers, any kind of import. */
  local: string[]
  /** Package specifiers imported by value (a type-only import is erased). */
  packages: string[]
}

function importsOf(file: string): Imports {
  const text = readFileSync(abs(file), 'utf8')
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const local: string[] = []
  const packages: string[] = []
  const add = (spec: string, typeOnly: boolean): void => {
    if (spec.startsWith('.')) local.push(spec)
    else if (!typeOnly) packages.push(spec)
  }
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const c = node.importClause
      const typeOnly =
        c !== undefined &&
        (c.isTypeOnly ||
          (c.name === undefined &&
            c.namedBindings !== undefined &&
            ts.isNamedImports(c.namedBindings) &&
            c.namedBindings.elements.length > 0 &&
            c.namedBindings.elements.every(e => e.isTypeOnly)))
      add(node.moduleSpecifier.text, typeOnly)
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      add(node.moduleSpecifier.text, node.isTypeOnly)
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      add(node.argument.literal.text, true)
    } else if (ts.isCallExpression(node) && node.arguments.length > 0 && ts.isStringLiteral(node.arguments[0])) {
      const callee = node.expression
      const isDynamicImport = callee.kind === ts.SyntaxKind.ImportKeyword
      const isViMock =
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        callee.expression.text === 'vi' &&
        ['mock', 'doMock', 'importActual', 'importMock'].includes(callee.name.text)
      if (isDynamicImport || isViMock) add(node.arguments[0].text, isViMock)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return { local, packages }
}

const CODE = /\.(tsx?|m?js)$/
/** The declared modules of the app and its scripts, not the vendored runtime under public/ (data the release embeds, never imported). */
const CODE_FILES = [...DECLARED].filter(p => CODE.test(p) && !p.startsWith('frontend/public/') && !p.startsWith('pymol-wasm/') && readable(p))
/** The runtime builder's own scripts (its packages come with its Docker image and the runtime, not the app's package.json). */
const BUILDER_CODE = [...DECLARED].filter(p => CODE.test(p) && p.startsWith('pymol-wasm/') && readable(p))
const NODE_BUILTINS = new Set(builtinModules)
const packageOf = (spec: string): string => (spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0])

describe("the viewer's published source", () => {
  it('names files that exist, and no locale file or stylesheet whole', () => {
    for (const f of extract.files.filter(readable)) expect(existsSync(abs(f)), f).toBe(true)
    for (const d of extract.trees) expect(existsSync(abs(d)), d).toBe(true)
    const transforms: Record<string, string> = extract.transforms
    for (const f of extract.files) {
      if (f.startsWith('frontend/src/i18n/locales/')) expect(transforms[f], f).toBe('strings')
    }
    expect(transforms['frontend/src/index.css']).toBe('css-prune')
  })

  it('carries the declarations every source file is type-checked with', () => {
    // The .d.ts files at src/'s top (vite/client, vitest's matchers, packages
    // with no types of their own) are no file's import: tsc reads them for all.
    const ambient = readdirSync(join(FRONTEND, 'src')).filter(f => f.endsWith('.d.ts'))
    expect(ambient.length).toBeGreaterThan(0)
    for (const f of ambient) expect(DECLARED.has(`frontend/src/${f}`), f).toBe(true)
  })

  it('carries the PyMOL runtime the app runs', () => {
    expect(extract.trees).toContain(`frontend/public/vendor/pymol/${PYMOL_RUNTIME_VERSION}`)
  })

  it('carries the entry, the build, the release script and the test setup', () => {
    for (const f of [
      'frontend/standalone/structure-viewer/main.tsx',
      'frontend/standalone/structure-viewer/index.html',
      'frontend/vite.structure-viewer.config.ts',
      'frontend/tsconfig.json',
      'frontend/src/test/domSetup.ts',
      'scripts/viewer_pack_release.mjs',
    ]) {
      expect(DECLARED.has(f), f).toBe(true)
    }
  })

  it.skipIf(!WHOLE_CHECKOUT)('names files outside frontend/ that exist (a whole checkout only)', () => {
    const beside = extract.files.filter(f => !f.startsWith('frontend/'))
    expect(beside.length).toBeGreaterThan(0)
    for (const f of beside) expect(existsSync(abs(f)), f).toBe(true)
  })

  it('is closed under its imports', () => {
    const outside: string[] = []
    for (const f of [...CODE_FILES, ...BUILDER_CODE]) {
      for (const spec of importsOf(f).local) {
        const target = resolveImport(f, spec)
        if (target === null || !MODULES.has(target)) outside.push(`${f} -> ${spec}${target === null ? '' : ` (${target})`}`)
      }
    }
    expect(outside, 'declare these in extract.json, or stop importing them from a published file').toEqual([])
  })

  it('declares every package it imports by value', () => {
    const named = new Set([...extract.package.dependencies, ...extract.package.devDependencies])
    const missing = new Set<string>()
    for (const f of CODE_FILES) {
      for (const spec of importsOf(f).packages) {
        if (spec.startsWith('node:') || spec.startsWith('virtual:') || NODE_BUILTINS.has(spec)) continue
        if (!named.has(packageOf(spec))) missing.add(`${packageOf(spec)} (${f})`)
      }
    }
    expect([...missing]).toEqual([])
  })

  it('declares only packages the app itself depends on', () => {
    const app = JSON.parse(readFileSync(join(FRONTEND, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    for (const n of extract.package.dependencies) expect(Object.keys(app.dependencies ?? {}), n).toContain(n)
    for (const n of extract.package.devDependencies) expect([...Object.keys(app.dependencies ?? {}), ...Object.keys(app.devDependencies ?? {})], n).toContain(n)
  })

  it('runs every declared test, and nothing else', () => {
    const tests = [...DECLARED].filter(p => p.startsWith('frontend/') && /\.(test|spec)\.tsx?$/.test(p)).map(p => posix.relative('frontend', p))
    expect([...SOURCE_TESTS].sort()).toEqual(tests.sort())
  })

  it('decides every file of the viewer one by one: published or withheld by name (PT-10171)', () => {
    // pymol-wasm/, the other decided directory, holds the runtime's build output when
    // it was built here: the extractor checks it on the commit's own tree instead.
    const dir = 'frontend/standalone/structure-viewer'
    expect(extract.decide).toContain(dir)
    const published = new Set([...extract.files, ...Object.values(ROOT)])
    const withheld = (p: string): boolean => Object.keys(WITHHELD).some(k => (k.endsWith('/') ? p.startsWith(k) : p === k))
    const undecided = filesUnder(dir).filter(p => !published.has(p) && !withheld(p))
    expect(undecided, 'name each in extract.json: files (published) or withheld (with the reason)').toEqual([])
    for (const [k, why] of Object.entries(WITHHELD)) expect(why.trim().length, k).toBeGreaterThan(8)
  })

  it('carries a README and the LICENSE at its top: the MIT text, then what it does not cover', () => {
    expect(Object.keys(ROOT).sort()).toEqual(['LICENSE', 'README.md'])
    const licence = rootText('LICENSE')
    expect(licence.startsWith(APP_LICENCE_TEXT)).toBe(true)
    for (const named of [`vendor/pymol/${PYMOL_RUNTIME_VERSION}`, 'Mozilla Public License 2.0', 'pymol-wasm/patches', 'Patch 0011', 'NOTICES.pymol-third-party.txt', 'CC BY-SA 3.0', 'pymolSettingsData.ts', 'GENERATED_SETTINGS', 'pymolMenuData.ts', 'PYMOL_MENU']) {
      expect(licence, named).toContain(named)
    }
    const readme = rootText('README.md')
    for (const named of ['LICENSE', 'EXTRACT.json', 'internal tracking', '/agro-github-publish', 'agrodesign-skills-for-claude-code v0.1.1']) expect(readme, named).toContain(named)
  })

  it("keeps the runtime's licence files whole: taken as they are, never transformed", () => {
    const runtime = `frontend/public/vendor/pymol/${PYMOL_RUNTIME_VERSION}`
    const licences = filesUnder(`${runtime}/licenses`)
    for (const f of ['LICENSE.pymol.txt', 'LICENSE.pyodide.txt', 'LICENSE.cpython.txt', 'NOTICES.pymol-third-party.txt']) {
      expect(licences, f).toContain(`${runtime}/licenses/${f}`)
    }
    const transforms: Record<string, string> = extract.transforms
    expect(Object.keys(transforms).filter(p => p.startsWith(`${runtime}/`) || /^(licen[cs]e|notices?)\b/i.test(posix.basename(p)))).toEqual([])
    if (IN_EXTRACT) {
      // The manifest says each came from the commit unchanged, and the bytes here are those.
      const manifest = JSON.parse(readFileSync(join(FRONTEND, '..', 'EXTRACT.json'), 'utf8')) as { files: Record<string, { from: string }> }
      for (const f of licences) expect(manifest.files[f]?.from, f).toBe('commit')
    }
  })
})
