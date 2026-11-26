/**
 * The offline structure file's import boundary: what its entry graph may
 * reach. The file runs from file://, so it may reach only modules the
 * published source carries (source/extract.json) and only the packages that
 * source declares, and only three modules may call the network: `rcsb.ts`,
 * which downloads a PDB entry from RCSB (owner 2026-11-14); `latestRelease.ts`,
 * which asks GitHub's API for the app's latest release when HELP's button is
 * pressed (owner 2026-11-16); and `latestFetch.ts`, which downloads that
 * release's blank app from raw.githubusercontent.com when asked to — the
 * three hosts the page's CSP lets it reach. A component that grows such an import
 * or call fails here before it can reach a handed-out file.
 */
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { entryGraph } from './entryGraph'
import extract from './source/extract.json'
import { PAGE_CSP } from './latestShell'

const ROOT = join(__dirname, '..', '..')
const graph = entryGraph(ROOT)
const rel = (f: string) => relative(ROOT, f).split('\\').join('/')
const files = graph.files.map(rel)

/** What the published source carries, by frontend-relative path: its files and trees (extract.json). */
const PUBLISHED = [...extract.files, ...extract.trees].filter(p => p.startsWith('frontend/')).map(p => p.slice('frontend/'.length))
const isPublished = (f: string) => PUBLISHED.some(p => f === p || f.startsWith(`${p}/`))
/** Modules the source replaces with the offline file's stand-ins (aliases.ts): reached only as the stand-in. */
const SHIMMED = Object.keys(extract.shims).map(p => p.slice('frontend/'.length).replace(/\.(tsx?|js)$/, ''))
/** A call that reaches the network, in code (comments stripped). */
const NETWORK = /\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\s*\(/

function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
}

describe('the offline structure file', () => {
  it('reaches the AgDB components the owner asked for, from its entry', () => {
    for (const f of [
      'src/components/structure-viewer/Mol3dToolbar.tsx',
      'src/components/structure-viewer/sceneStyles.ts',
      'src/components/structure-viewer/useDepthCue.ts',
      'src/components/structure-viewer/ViewerAnnotationLayer.tsx',
      'src/pages/pymol-viewer/PymolMenuBar.tsx',
      'src/pages/pymol-viewer/pymolMenuData.ts',
      'src/pages/pymol-viewer/PymolCommandLine.tsx',
      'src/pages/pymol-viewer/PymolRayDialog.tsx',
      'src/pages/pymol-viewer/PymolSettingsDialog.tsx',
      'src/pages/pymol-viewer/PymolExportDialog.tsx',
      'src/pages/structure-detail/Viewer3dHeader.tsx',
    ]) {
      expect(files, f).toContain(f)
    }
  })

  it('reaches only modules and packages the published source declares', () => {
    expect(files.filter(f => !isPublished(f))).toEqual([])
    expect(files.filter(f => SHIMMED.includes(f.replace(/\.(tsx?|js)$/, '')))).toEqual([])
    // `virtual:` modules come from the build's own plugins (vite-plugins/, published).
    expect(graph.packages.filter(p => !p.startsWith('virtual:') && !extract.package.dependencies.includes(p))).toEqual([])
  })

  it('swaps the bug reporter for the offline stub', () => {
    expect(files).toContain('standalone/structure-viewer/offlineErrorCapture.ts')
  })

  it('has three modules that call the network — the RCSB download, the latest-release check and its blank app’s download — each its own host only', () => {
    const calling = graph.files.filter(f => NETWORK.test(code(f))).map(rel)
    expect(calling.sort()).toEqual(['standalone/structure-viewer/latestFetch.ts', 'standalone/structure-viewer/latestRelease.ts', 'standalone/structure-viewer/rcsb.ts'])
    // The latest version's download names the raw file host and nothing else; no credentials, no referrer, no redirect followed.
    const download = code(join(__dirname, 'latestFetch.ts'))
    expect([...download.matchAll(/https?:\/\/[^'"`\s$/]+/g)].map(m => m[0])).toEqual(['https://raw.githubusercontent.com'])
    expect(download).toContain("credentials: 'omit'")
    expect(download).toContain("referrerPolicy: 'no-referrer'")
    expect(download).toContain("redirect: 'manual'")
    // The check names GitHub's API and nothing else; it sends no credentials and no referrer.
    const latest = code(join(__dirname, 'latestRelease.ts'))
    expect([...latest.matchAll(/https?:\/\/[^'"`\s$]+/g)].map(m => m[0])).toEqual(['https://api.github.com/repos/'])
    expect(latest).toContain("credentials: 'omit'")
    expect(latest).toContain("referrerPolicy: 'no-referrer'")
    const rcsb = code(join(__dirname, 'rcsb.ts'))
    // Every URL it names is RCSB's file server, over HTTPS.
    expect([...rcsb.matchAll(/https?:\/\/[^'"`\s]+/g)].map(m => m[0])).toEqual(['https://files.rcsb.org/download/'])
    // It sends no credentials and no referrer.
    expect(rcsb).toContain("credentials: 'omit'")
    expect(rcsb).toContain("referrerPolicy: 'no-referrer'")
    // The PDB ID's link (owner 2026-11-19) names RCSB PDB's entry page alone, a page the reader opens: it fetches nothing.
    const pdbLink = code(join(__dirname, 'pdbLink.ts'))
    expect([...pdbLink.matchAll(/https?:\/\/[^'"`\s]+/g)].map(m => m[0])).toEqual(['https://www.rcsb.org/structure/'])
    expect(pdbLink).not.toMatch(/\bfetch\(|XMLHttpRequest|sendBeacon/)
  })

  it('keeps the page CSP with no connection but to RCSB, the GitHub API and its raw files, and no frame or form target', () => {
    const html = readFileSync(join(__dirname, 'index.html'), 'utf8')
    const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] ?? ''
    expect(csp).toContain("default-src 'none'")
    expect(csp).toContain('connect-src https://files.rcsb.org https://api.github.com https://raw.githubusercontent.com;')
    expect(csp).toContain("frame-src 'none'")
    expect(csp).toContain("form-action 'none'")
    expect(csp).toContain("base-uri 'none'")
    // RCSB's file server, GitHub's API and its raw files are the only hosts it names, and only for connections.
    expect([...csp.matchAll(/https?:\/\/[^\s;]+/g)].map(m => m[0])).toEqual(['https://files.rcsb.org', 'https://api.github.com', 'https://raw.githubusercontent.com'])
    // The policy a newer version's file is held to is this one (latestShell.ts).
    expect(PAGE_CSP).toBe(csp)
    // The app's version mark, filled in by the build (vite.structure-viewer.config.ts).
    expect(html).toContain('<meta name="agdb-viewer-pack" content="__SAV_APP_VERSION__" data-config="1" />')
    // The release signature's place, empty in every build: scripts/viewer_pack_signing.mjs fills it in a release (releaseSignature.ts).
    expect(html).toContain('<meta name="agdb-viewer-pack-signature" content="" />')
    const firstScript = html.search(/<script\b/)
    expect(firstScript).toBeGreaterThan(0)
    expect(html.indexOf('agdb-viewer-pack-signature')).toBeLessThan(firstScript)
    // The builder's one payload slot.
    expect(html.split('<!--@@AGDB-PAYLOAD@@-->').length).toBe(2)
  })
})
