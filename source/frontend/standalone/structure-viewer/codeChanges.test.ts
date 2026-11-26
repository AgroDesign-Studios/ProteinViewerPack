/**
 * HELP's 「改良点」 links to CODE-CHANGES.md (this folder's copy, which the
 * release copies to the repository; owner 2026-11-20): it must say what the
 * shipped build is. Its patch list is the runtime's, each patch in full; its
 * 3Dmol.js version the one node_modules embeds; its intro the runtime's
 * commit and Pyodide. A runtime bump that adds or drops a patch, or a
 * 3Dmol.js bump, fails here until the document follows.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { PYMOL_PATCH_FILES } from '../../src/pages/structure-html-export/standaloneFormat'
import { PYMOL_RUNTIME_VERSION } from '../../src/pages/pymol-viewer/pymolRuntimeManifest'
import { CODE_CHANGES_FILE, MOL3D_VERSION, runtimeParts } from './HelpChanges'

const FRONTEND = join(__dirname, '..', '..')
const RUNTIME = join(FRONTEND, 'public', 'vendor', 'pymol', PYMOL_RUNTIME_VERSION)
/** The builder's own patches: present when pymol-wasm/ sits beside frontend/, absent when frontend/ runs alone. */
const BUILDER_PATCHES = join(FRONTEND, '..', 'pymol-wasm', 'patches')
const DOC = readFileSync(join(__dirname, CODE_CHANGES_FILE), 'utf8')
/** The document's two halves, by their headings (the tab's links land on them). */
const half = (heading: string) => {
  const at = DOC.indexOf(`\n## ${heading}\n`)
  expect(at, heading).toBeGreaterThan(0)
  const next = DOC.indexOf('\n## ', at + 1)
  return DOC.slice(at, next < 0 ? undefined : next)
}

describe('CODE-CHANGES.md against the shipped build', () => {
  it('has a Japanese and an English half, each naming every patch the runtime carries, once, with its diff', () => {
    for (const part of [half('日本語'), half('English')]) {
      const named = [...part.matchAll(/^\*\*[^*]+\*\* `(\d{4}-[\w.-]+\.patch)`$/gm)].map(m => m[1])
      expect([...named].sort()).toEqual([...PYMOL_PATCH_FILES].sort())
      for (const f of PYMOL_PATCH_FILES) {
        const diff = readFileSync(join(RUNTIME, 'patches', f), 'utf8').replace(/\n$/, '')
        expect(part.includes('````diff\n' + diff + '\n````'), f).toBe(true)
      }
    }
  })

  it('names the 3Dmol.js node_modules holds, and the runtime’s commit and Pyodide', () => {
    const pkg = JSON.parse(readFileSync(join(FRONTEND, 'node_modules', '3dmol', 'package.json'), 'utf8')) as { version: string }
    expect(MOL3D_VERSION).toBe(pkg.version)
    const { commit, pyodide } = runtimeParts()
    for (const part of [half('日本語'), half('English')]) {
      expect(part).toContain(`3Dmol.js ${MOL3D_VERSION}`)
      expect(part).toContain(commit)
      expect(part).toContain(`Pyodide ${pyodide}`)
    }
    // Code spans close: an odd count of backticks outside the diffs would run code into the text.
    const prose = DOC.replace(/````diff\n[\s\S]*?\n````/g, '')
    for (const line of prose.split('\n')) expect((line.match(/`/g) ?? []).length % 2, line.slice(0, 80)).toBe(0)
  })

  it('carries the runtime’s patches beside it, the ones its README lists', () => {
    expect(readdirSync(join(RUNTIME, 'patches')).sort()).toEqual([...PYMOL_PATCH_FILES].sort())
    const readme = readFileSync(join(RUNTIME, 'README.md'), 'utf8')
    const listed = [...readme.matchAll(/^\| `(\d{4}-[\w-]+)` \|/gm)].map(m => `${m[1]}.patch`)
    expect(listed.sort()).toEqual([...PYMOL_PATCH_FILES].sort())
  })

  it.skipIf(!existsSync(BUILDER_PATCHES))('holds byte-identical copies of pymol-wasm/patches (when pymol-wasm/ is present)', () => {
    expect(readdirSync(BUILDER_PATCHES).sort()).toEqual([...PYMOL_PATCH_FILES].sort())
    for (const f of PYMOL_PATCH_FILES) expect(readFileSync(join(RUNTIME, 'patches', f)).equals(readFileSync(join(BUILDER_PATCHES, f))), f).toBe(true)
  })

  it('reads the commit and the Pyodide version out of the runtime’s name', () => {
    expect(runtimeParts('3.2.0a-edcda80f-s3-pyodide-314.0.7')).toEqual({ commit: 'edcda80f', pyodide: '314.0.7' })
    expect(runtimeParts('3.2.0a-edcda80f-pyodide-314.0.7')).toEqual({ commit: 'edcda80f', pyodide: '314.0.7' })
    expect(runtimeParts('odd')).toEqual({ commit: '?', pyodide: '?' })
    expect(runtimeParts()).not.toEqual({ commit: '?', pyodide: '?' })
  })
})
