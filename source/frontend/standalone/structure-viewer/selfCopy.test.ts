/**
 * 「HTMLappとして出力」 (owner 2026-11-15): the page makes a copy of itself
 * from what it holds (`selfCopy.ts`) — the template as it arrived, its own
 * blocks verbatim, a fresh config and structure — the full or the light
 * edition, with the open structure or blank.
 */
import { gunzipSync, gzipSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { blockElement, PAYLOAD_MARKER } from '../../src/pages/structure-html-export/standaloneFormat'
import { readConfig, type PageConfig } from './blocks'
import { embeddedDoc, type StructureDoc } from './localFile'
import { appCopyRefusal, captureTemplate, estimateAppCopy, makeAppCopy, resetTemplateForTests, setRuntimeBlocksForTests } from './selfCopy'

const enc = (s: string) => new TextEncoder().encode(s)
const block = (name: string, data: string | Uint8Array) => {
  const bytes = typeof data === 'string' ? enc(data) : data
  return blockElement(name, gzipSync(bytes).toString('base64'), bytes.byteLength)
}

const LICENCES = JSON.stringify([
  { title: '3Dmol.js', text: 'BSD', group: '3dmol' },
  { title: 'pako 2.1.0 (MIT AND Zlib)', text: 'pako', group: '3dmol' },
  { title: 'Open-Source PyMOL', text: 'PyMOL', group: 'pymol' },
])

const CONFIG: PageConfig = {
  edition: 'full',
  structureId: 42,
  title: 'Crambin',
  code: '1CRN',
  exporterName: 'Example Author',
  lang: 'ja',
  initialEngine: 'pymol',
  bColumn: 'bfactor',
  exportedAt: '2026-11-13T05:06:07.000Z',
  timeZone: 'Asia/Tokyo',
  pymolView: Array(18).fill(1),
  skipped: ['map1'],
  runtime: { base: 'https://agdb-standalone.invalid/pymol/x/', handed: ['a.whl'] },
}

/** The page as the builder wrote it: the template, its slot filled with blocks. */
function page(edition: 'full' | 'light') {
  const blocks = [
    block('config', JSON.stringify({ ...CONFIG, edition })),
    block('structure', 'data_1CRN\n'),
    block('mol3d', '{"v":1}'),
    ...(edition === 'full' ? [block('pymol-look', '{"v":1}')] : []),
    block('3dmol', '/* 3Dmol */'),
    ...(edition === 'full' ? [block('worker', 'self.onmessage=0'), block('pyodide-js', 'p'), block('pyodide-core', 'c'), block('rt-a.whl', new Uint8Array([1, 2, 3]))] : []),
    block('licenses', LICENCES),
  ].join('')
  document.documentElement.innerHTML =
    '<head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'"><title>t</title><style>.x{}</style></head>' +
    `<body><div id="root"></div>${blocks}<script type="module">/* app */</script></body>`
}

/** jsdom's Blob has no text(): read it as a browser's FileReader would. */
function readText(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsText(blob)
  })
}

/** The copy taken apart: everything but the blocks, and each block's bytes. */
async function takeApart(blob: Blob) {
  const html = await readText(blob)
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  const out = new Map<string, Buffer>()
  for (const el of Array.from(parsed.querySelectorAll<HTMLElement>('script[type="application/x-agdb-b64"]'))) {
    const raw = gunzipSync(Buffer.from((el.textContent ?? '').trim(), 'base64'))
    expect(String(raw.byteLength)).toBe(el.dataset.len)
    out.set(el.id.replace(/^agdb-/, ''), raw)
    el.remove()
  }
  return { html, rest: parsed.documentElement.outerHTML, blocks: out }
}

const pdb = (serial: number): StructureDoc => ({ name: 'lig.pdb', stem: 'lig', ext: 'pdb', bytes: enc('ATOM  1\nEND\n').buffer as ArrayBuffer, text: 'ATOM  1\nEND\n', serial })

/** The fixture page's runtime: the blocks a full copy needs, by name and raw length. */
const FIXTURE_RUNTIME = new Map<string, number | null>([['worker', null], ['pyodide-js', 1], ['pyodide-core', 1], ['rt-a.whl', 3]])

beforeEach(() => {
  resetTemplateForTests()
  setRuntimeBlocksForTests(FIXTURE_RUNTIME)
})
afterEach(() => {
  document.documentElement.innerHTML = '<head></head><body></body>'
})

describe('the app’s copy of itself', () => {
  it('keeps the page as it arrived and puts the blocks back where they stood', async () => {
    page('full')
    captureTemplate()
    // What React and 3Dmol.js do after boot is not in the copy.
    document.getElementById('root')!.textContent = 'drawn'
    const embedded = embeddedDoc('data_1CRN\n', '1CRN', 'Crambin')
    const blob = await makeAppCopy({ edition: 'full', doc: embedded, config: CONFIG, lang: 'en', engine: '3dmol', now: new Date('2026-11-15T00:00:00Z') })
    const { html, rest, blocks } = await takeApart(blob)
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true)
    expect(html).not.toContain(PAYLOAD_MARKER)
    expect(html).not.toContain('agdb-copy-slot')
    expect(rest).toContain('Content-Security-Policy')
    expect(rest).toContain('/* app */')
    expect(rest).not.toContain('drawn')
    expect([...blocks.keys()]).toEqual(['config', 'structure', 'mol3d', 'pymol-look', '3dmol', 'worker', 'pyodide-js', 'pyodide-core', 'rt-a.whl', 'licenses'])
    const config = JSON.parse(blocks.get('config')!.toString('utf8'))
    // The file's own structure keeps its identity and looks; the copy opens as asked.
    // ...and who exported it, and when: the copy did not change that (PT-9275 item 1).
    expect(config).toMatchObject({ edition: 'full', structureId: 42, title: 'Crambin', code: '1CRN', lang: 'en', initialEngine: '3dmol', runtime: CONFIG.runtime })
    expect(config).toMatchObject({ exporterName: 'Example Author', exportedAt: CONFIG.exportedAt, timeZone: CONFIG.timeZone })
    expect(config.structureFormat).toBeUndefined()
    expect(blocks.get('rt-a.whl')).toEqual(Buffer.from([1, 2, 3]))
    expect(JSON.parse(blocks.get('licenses')!.toString('utf8'))).toHaveLength(3)
  })

  it('the light edition from a full page: no PyMOL runtime, no PyMOL look, no PyMOL licence; a file opened here goes in with its format', async () => {
    page('full')
    captureTemplate()
    const blob = await makeAppCopy({ edition: 'light', doc: pdb(5), config: CONFIG, lang: 'ja', engine: 'pymol', now: new Date() })
    const { blocks } = await takeApart(blob)
    expect([...blocks.keys()]).toEqual(['config', 'structure', '3dmol', 'licenses'])
    const config = JSON.parse(blocks.get('config')!.toString('utf8'))
    expect(config).toMatchObject({ edition: 'light', structureId: 0, title: 'lig.pdb', code: null, initialEngine: '3dmol', runtime: null, pymolView: null, skipped: [], structureFormat: 'pdb' })
    // Not the structure the exporter exported: no exporter named, dated now (PT-9275 item 1).
    expect(config.exporterName).toBeNull()
    expect(config.exportedAt).not.toBe(CONFIG.exportedAt)
    expect(blocks.get('structure')!.toString('utf8')).toBe('ATOM  1\nEND\n')
    expect(JSON.parse(blocks.get('licenses')!.toString('utf8')).map((l: { title: string }) => l.title)).toEqual(['3Dmol.js', 'pako 2.1.0 (MIT AND Zlib)'])
    // The copy, opened: its page reads the structure's format from the config.
    document.documentElement.innerHTML = new DOMParser().parseFromString(await readText(blob), 'text/html').documentElement.innerHTML
    expect(await readConfig()).toMatchObject({ edition: 'light', structureFormat: 'pdb', runtime: null })
  })

  it('a blank app: no structure, no looks', async () => {
    page('light')
    captureTemplate()
    const { blocks } = await takeApart(await makeAppCopy({ edition: 'light', doc: null, config: { ...CONFIG, edition: 'light', runtime: null }, lang: 'ja', engine: '3dmol', now: new Date() }))
    expect([...blocks.keys()]).toEqual(['config', '3dmol', 'licenses'])
    expect(JSON.parse(blocks.get('config')!.toString('utf8'))).toMatchObject({ structureId: 0, title: '', exporterName: null })
  })

  it('offers no full edition when a runtime block is missing, damaged or of the wrong length (PT-9276 item 1)', () => {
    const full = { edition: 'full' as const, doc: null, config: CONFIG }
    page('full')
    captureTemplate()
    expect(appCopyRefusal(full)).toBeNull()
    document.getElementById('agdb-rt-a.whl')!.remove()
    expect(appCopyRefusal(full)).toBe('runtime-damaged')
    page('full')
    document.getElementById('agdb-pyodide-core')!.setAttribute('data-len', '999')
    expect(appCopyRefusal(full)).toBe('runtime-damaged')
    page('full')
    document.getElementById('agdb-worker')!.textContent = ''
    expect(appCopyRefusal(full)).toBe('runtime-damaged')
  })

  it('captures the page without copying any block\'s text (PT-9276 item 3)', () => {
    page('full')
    const deep = vi.spyOn(Node.prototype, 'cloneNode')
    captureTemplate()
    expect(deep.mock.calls.every(([d]) => d !== true)).toBe(true)
    deep.mockRestore()
  })

  it('refuses what it cannot make, and says why: no full edition from a light file, no session in the light edition', () => {
    page('light')
    captureTemplate()
    const light = { ...CONFIG, edition: 'light' as const, runtime: null }
    expect(appCopyRefusal({ edition: 'full', doc: null, config: light })).toBe('no-runtime')
    expect(appCopyRefusal({ edition: 'light', doc: null, config: light })).toBeNull()
    const pse: StructureDoc = { name: 's.pse', stem: 's', ext: 'pse', bytes: new ArrayBuffer(4), text: null, serial: 3 }
    expect(appCopyRefusal({ edition: 'light', doc: pse, config: light })).toBe('pse-light')
    resetTemplateForTests()
    expect(appCopyRefusal({ edition: 'light', doc: null, config: light })).toBe('no-template')
  })

  it('estimates the copy near its real size', async () => {
    page('full')
    captureTemplate()
    const req = { edition: 'full' as const, doc: embeddedDoc('data_1CRN\n', '1CRN', 'Crambin'), config: CONFIG }
    const real = (await makeAppCopy({ ...req, lang: 'ja', engine: '3dmol', now: new Date() })).size
    const est = estimateAppCopy(req)
    expect(Math.abs(est - real) / real).toBeLessThan(0.3)
    expect(estimateAppCopy({ ...req, edition: 'light' })).toBeLessThan(est)
  })
})

describe('the sessions a copy opens with (owner 2026-11-16)', () => {
  const LOOK = { v: 1 as const, view: [1, 2, 3, 4, 5, 6, 7, 8], bg: '#000000', atoms: 1, groups: [], surfaces: [] }
  const PSE = new Uint8Array([0x80, 0x04, 0x95, 0x01]).buffer as ArrayBuffer
  const NOW = new Date('2026-11-16T00:00:00Z')
  const ON = { keepMol3dSession: true, keepPymolSession: true }

  it('writes the 3Dmol.js view now as mol3d-session, beside the exporter’s own mol3d look', async () => {
    page('full')
    captureTemplate()
    const embedded = embeddedDoc('data_1CRN\n', '1CRN', 'Crambin')
    const { blocks } = await takeApart(await makeAppCopy({ edition: 'full', doc: embedded, config: CONFIG, lang: 'ja', engine: '3dmol', now: NOW, keepMol3dSession: true, mol3dLook: LOOK }))
    expect(JSON.parse(blocks.get('mol3d-session')!.toString('utf8'))).toEqual(LOOK)
    expect(blocks.get('mol3d')!.toString('utf8')).toBe('{"v":1}')
    expect(blocks.has('pymol-look')).toBe(true)
    expect(blocks.has('pymol-session')).toBe(false)
  })

  it('writes PyMOL’s session as pymol-session beside the structure, full edition only', async () => {
    page('full')
    captureTemplate()
    const opened = pdb(3)
    const full = await takeApart(await makeAppCopy({ edition: 'full', doc: opened, config: CONFIG, lang: 'ja', engine: 'pymol', now: NOW, ...ON, pymolSession: PSE }))
    expect(full.blocks.get('pymol-session')).toEqual(Buffer.from(new Uint8Array(PSE)))
    expect(full.blocks.get('structure')!.toString('utf8')).toBe('ATOM  1\nEND\n')
    const light = await takeApart(await makeAppCopy({ edition: 'light', doc: opened, config: CONFIG, lang: 'ja', engine: 'pymol', now: NOW, ...ON, pymolSession: PSE }))
    expect(light.blocks.has('pymol-session')).toBe(false)
  })

  it('a capture without its switch on is not written', async () => {
    page('full')
    captureTemplate()
    const { blocks } = await takeApart(await makeAppCopy({ edition: 'full', doc: pdb(3), config: CONFIG, lang: 'ja', engine: 'pymol', now: NOW, mol3dLook: LOOK, pymolSession: PSE }))
    expect(blocks.has('mol3d-session')).toBe(false)
    expect(blocks.has('pymol-session')).toBe(false)
  })

  it('a session that is the structure itself is written as the structure', async () => {
    page('full')
    captureTemplate()
    const pse: StructureDoc = { name: 's.pse', stem: 's', ext: 'pse', bytes: new Uint8Array([1]).buffer as ArrayBuffer, text: null, serial: 2 }
    const { blocks } = await takeApart(await makeAppCopy({ edition: 'full', doc: pse, config: CONFIG, lang: 'ja', engine: 'pymol', now: NOW, ...ON, pymolSession: PSE, mol3dLook: LOOK }))
    expect(blocks.get('structure')).toEqual(Buffer.from(new Uint8Array(PSE)))
    expect(blocks.has('pymol-session')).toBe(false)
    // 3Dmol.js has no view of a session: no look is written for it.
    expect(blocks.has('mol3d-session')).toBe(false)
  })

  it('the page’s own sessions: left out with the switch off, kept with it on when none is captured now, replaced by a capture (PR #8717 review)', async () => {
    page('full')
    const lic = document.getElementById('agdb-licenses')!
    lic.insertAdjacentHTML('beforebegin', block('pymol-session', new Uint8Array([9, 9])))
    lic.insertAdjacentHTML('beforebegin', block('mol3d-session', '{"v":1,"own":true}'))
    captureTemplate()
    const embedded = embeddedDoc('data_1CRN\n', '1CRN', 'Crambin')
    const off = await takeApart(await makeAppCopy({ edition: 'full', doc: embedded, config: CONFIG, lang: 'ja', engine: '3dmol', now: NOW }))
    expect(off.blocks.has('pymol-session')).toBe(false)
    expect(off.blocks.has('mol3d-session')).toBe(false)
    expect(off.blocks.get('mol3d')!.toString('utf8')).toBe('{"v":1}')
    const kept = await takeApart(await makeAppCopy({ edition: 'full', doc: embedded, config: CONFIG, lang: 'ja', engine: '3dmol', now: NOW, ...ON }))
    expect(kept.blocks.get('pymol-session')).toEqual(Buffer.from([9, 9]))
    expect(kept.blocks.get('mol3d-session')!.toString('utf8')).toBe('{"v":1,"own":true}')
    const replaced = await takeApart(await makeAppCopy({ edition: 'full', doc: embedded, config: CONFIG, lang: 'ja', engine: '3dmol', now: NOW, ...ON, pymolSession: PSE, mol3dLook: LOOK }))
    expect(replaced.blocks.get('pymol-session')).toEqual(Buffer.from(new Uint8Array(PSE)))
    expect([...replaced.blocks.keys()].filter(k => k === 'pymol-session')).toHaveLength(1)
    expect(JSON.parse(replaced.blocks.get('mol3d-session')!.toString('utf8'))).toEqual(LOOK)
    expect([...replaced.blocks.keys()].filter(k => k === 'mol3d-session')).toHaveLength(1)
    // Another structure, or a blank app: the page's sessions belong to its own structure.
    const other = await takeApart(await makeAppCopy({ edition: 'full', doc: pdb(4), config: CONFIG, lang: 'ja', engine: '3dmol', now: NOW, ...ON }))
    expect(other.blocks.has('pymol-session')).toBe(false)
    expect(other.blocks.has('mol3d-session')).toBe(false)
    const blank = await takeApart(await makeAppCopy({ edition: 'full', doc: null, config: CONFIG, lang: 'ja', engine: '3dmol', now: NOW, ...ON, mol3dLook: LOOK, pymolSession: PSE }))
    expect(blank.blocks.has('mol3d-session')).toBe(false)
    expect(blank.blocks.has('pymol-session')).toBe(false)
  })
})

describe('the size shown before Save counts the sessions (PT-9552 item 3)', () => {
  /** Bytes gzip cannot shrink (a linear congruential sequence), so the block keeps its size. */
  const noise = (n: number) => {
    const out = new Uint8Array(n)
    let x = 12345
    for (let i = 0; i < n; i++) {
      x = (Math.imul(x, 1103515245) + 12345) >>> 0
      out[i] = x >>> 24
    }
    return out
  }
  it('a session the page carries counts with its switch on and none captured now; a PyMOL session written now counts by the structure', () => {
    page('full')
    document.getElementById('agdb-licenses')!.insertAdjacentHTML('beforebegin', block('pymol-session', noise(40000)))
    captureTemplate()
    const embedded = embeddedDoc('data_1CRN\n', '1CRN', 'Crambin')
    const base = { edition: 'full' as const, doc: embedded, config: CONFIG }
    const off = estimateAppCopy(base)
    const kept = estimateAppCopy({ ...base, keepPymolSession: true })
    expect(kept).toBeGreaterThan(off + 30000)
    // A fresh capture replaces the page's own: counted by the structure, not by the old block.
    const opened = pdb(5)
    const withFresh = estimateAppCopy({ edition: 'full', doc: opened, config: CONFIG, keepPymolSession: true, freshPymolSession: true })
    const without = estimateAppCopy({ edition: 'full', doc: opened, config: CONFIG })
    expect(withFresh - without).toBe(Math.round(opened.bytes.byteLength * 0.75))
    // The light edition carries no PyMOL session.
    expect(estimateAppCopy({ ...base, edition: 'light', keepPymolSession: true })).toBe(estimateAppCopy({ ...base, edition: 'light' }))
  })
})
