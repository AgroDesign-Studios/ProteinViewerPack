/**
 * The latest version's blank app, checked and given this page's data (owner
 * 2026-11-17, HELP's 「最新版ダウンロード」): read as a document that never runs,
 * refused with a reason for any form this version does not know, and the copy
 * made in it — its code, runtime, licences and CSP as they came, this page's
 * structure and views in it.
 */
import { gunzipSync, gzipSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { viewerPackFileStem } from '../../src/pages/structure-html-export/viewerPackFileName'
import { blockElement } from '../../src/pages/structure-html-export/standaloneFormat'
import type { PageConfig } from './blocks'
import { cspWithin, inspectShell, PAGE_CSP, SHELL_RAW_MAX } from './latestShell'
import { migrateInto, movesOf, type CopySource } from './latestUpdate'
import { embeddedDoc, type StructureDoc } from './localFile'
import { captureTemplate, makeAppCopy, resetTemplateForTests, setRuntimeBlocksForTests } from './selfCopy'

const enc = (s: string) => new TextEncoder().encode(s)
const block = (name: string, data: string | Uint8Array) => {
  const bytes = typeof data === 'string' ? enc(data) : data
  return blockElement(name, gzipSync(bytes).toString('base64'), bytes.byteLength)
}

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
  skipped: [],
  runtime: { base: 'https://agdb-standalone.invalid/pymol/old/', handed: ['a.whl'] },
}

/** This page, as the builder wrote it (`selfCopy.test.ts`'s fixture): the old app. */
function oldPage(edition: 'full' | 'light', logo = false) {
  const blocks = [
    block('config', JSON.stringify({ ...CONFIG, edition, runtime: edition === 'full' ? CONFIG.runtime : null })),
    block('structure', 'data_1CRN\n'),
    block('mol3d', '{"v":1}'),
    ...(edition === 'full' ? [block('pymol-look', '{"v":1}')] : []),
    ...(logo ? [block('logo', 'OLDLOGO')] : []),
    block('3dmol', '/* 3Dmol old */'),
    ...(edition === 'full' ? [block('worker', 'old worker'), block('pyodide-js', 'p'), block('pyodide-core', 'c'), block('rt-a.whl', new Uint8Array([1, 2, 3]))] : []),
    block('licenses', '[{"title":"3Dmol.js","text":"old","group":"3dmol"}]'),
  ].join('')
  document.documentElement.innerHTML =
    `<head><meta http-equiv="Content-Security-Policy" content="${PAGE_CSP}"><title>old</title><style>.old{}</style></head>` +
    `<body><div id="root"></div>${blocks}<script>/* old app */</script></body>`
  captureTemplate()
}

interface ShellOptions {
  /** Head markup put before the policy (after <meta charset>). */
  beforeCsp?: string
  edition?: 'full' | 'light'
  version?: string | null
  reads?: string
  v?: unknown
  csp?: string | null
  cspAfterScript?: boolean
  extraBlocks?: string[]
  drop?: string[]
  config?: string
  slot?: boolean
  logo?: boolean
  structure?: boolean
}

/** The latest version's blank app as the release carries it: its own code, runtime and licences. */
function shell(o: ShellOptions = {}): string {
  const edition = o.edition ?? 'full'
  const version = o.version === undefined ? '1.1.0' : o.version
  const config = o.config ?? JSON.stringify({ v: o.v ?? 1, edition, structureId: 0, title: '', runtime: edition === 'full' ? { base: 'https://agdb-standalone.invalid/pymol/new/', handed: ['b.whl'] } : null })
  const blocks: [string, string][] = [
    ['config', block('config', config)],
    ...(o.structure ? ([['structure', block('structure', 'data_THEIRS\n')]] as [string, string][]) : []),
    ...(o.logo ? ([['logo', block('logo', 'NEWLOGO')]] as [string, string][]) : []),
    ['3dmol', block('3dmol', '/* 3Dmol new */')],
    ...(edition === 'full'
      ? ([
          ['worker', block('worker', 'new worker')],
          ['pyodide-js', block('pyodide-js', 'P2')],
          ['pyodide-core', block('pyodide-core', 'C2')],
          ['rt-b.whl', block('rt-b.whl', new Uint8Array([9, 9]))],
        ] as [string, string][])
      : []),
    ['licenses', block('licenses', '[{"title":"3Dmol.js","text":"new","group":"3dmol"}]')],
  ]
  const body = blocks.filter(([n]) => !(o.drop ?? []).includes(n)).map(([, b]) => b).join('') + (o.extraBlocks ?? []).join('')
  const csp = o.csp === null ? '' : `<meta http-equiv="Content-Security-Policy" content="${o.csp ?? PAGE_CSP}">`
  const mark = version === null ? '' : `<meta name="agdb-viewer-pack" content="${version}" data-config="${o.reads ?? '1'}">`
  const script = '<script>window.__shellRan = 1; document.title = "ran"</script>'
  return (
    '<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">' +
    (o.beforeCsp ?? '') +
    (o.cspAfterScript ? script + csp : csp) +
    `${mark}<title>new</title><style>.new{}</style></head><body><div id="root"></div>${o.slot ? '<template id="agdb-copy-slot"></template>' : ''}` +
    `${body}<img src="x" onerror="window.__shellRan = 2"><script>/* new app */ window.__shellRan = 3</script></body></html>`
  )
}

function readText(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsText(blob)
  })
}

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

const FIXTURE_RUNTIME = new Map<string, number | null>([['worker', null], ['pyodide-js', 1], ['pyodide-core', 1], ['rt-a.whl', 3]])

beforeEach(() => {
  resetTemplateForTests()
  setRuntimeBlocksForTests(FIXTURE_RUNTIME)
  delete (window as unknown as Record<string, unknown>).__shellRan
})
afterEach(() => {
  document.documentElement.innerHTML = '<head></head><body></body>'
})

const FULL = { edition: 'full' as const, current: '1.0.0' }

describe('inspectShell: the latest version’s blank app, read, never run', () => {
  it('passes a blank app of this edition and a version this one can write for; nothing of it runs or reaches the page', async () => {
    oldPage('full')
    const before = document.documentElement.outerHTML
    const got = await inspectShell(shell(), { ...FULL, tag: 'v1.1.0' })
    expect(got.ok).toBe(true)
    if (!got.ok) return
    expect(got.shell).toMatchObject({ edition: 'full', version: '1.1.0', runtime: { base: 'https://agdb-standalone.invalid/pymol/new/', handed: ['b.whl'] } })
    expect(got.shell.template).toContain('<template id="agdb-copy-slot"></template>')
    // No script of it ran, no image of it loaded, nothing of it is in this page, no frame was made.
    expect((window as unknown as Record<string, unknown>).__shellRan).toBeUndefined()
    expect(document.title).toBe('old')
    expect(document.documentElement.outerHTML).toBe(before)
    expect(document.querySelectorAll('iframe')).toHaveLength(0)
  })

  it('a light page takes a light blank app with no PyMOL blocks', async () => {
    const got = await inspectShell(shell({ edition: 'light' }), { edition: 'light', current: '1.0.0' })
    expect(got).toMatchObject({ ok: true, shell: { edition: 'light', runtime: null } })
  })

  it('refuses a file with no app version mark, or one that is no SemVer: a form this version does not know', async () => {
    expect(await inspectShell(shell({ version: null }), FULL)).toEqual({ ok: false, why: { code: 'not-app' } })
    expect(await inspectShell(shell({ version: '__SAV_APP_VERSION__' }), FULL)).toEqual({ ok: false, why: { code: 'not-app' } })
    expect(await inspectShell('<!doctype html><p>hello</p>', FULL)).toEqual({ ok: false, why: { code: 'not-app' } })
    expect(await inspectShell('\u0000\u0001 not html at all', FULL)).toEqual({ ok: false, why: { code: 'not-app' } })
  })

  it('refuses a file that cannot read this version’s config, by its mark or by its config block', async () => {
    expect(await inspectShell(shell({ reads: '2' }), FULL)).toEqual({ ok: false, why: { code: 'config-version', detail: '2' } })
    expect(await inspectShell(shell({ v: 3 }), FULL)).toEqual({ ok: false, why: { code: 'config-version', detail: '3' } })
    expect(await inspectShell(shell({ v: '1' }), FULL)).toEqual({ ok: false, why: { code: 'config-version', detail: '1' } })
    // A newer app that reads both is taken.
    expect((await inspectShell(shell({ reads: '1 2', v: 2 }), FULL)).ok).toBe(true)
  })

  it('refuses another edition, by its config or by its blocks', async () => {
    expect(await inspectShell(shell({ edition: 'light' }), FULL)).toEqual({ ok: false, why: { code: 'edition', detail: 'light' } })
    expect(await inspectShell(shell({ edition: 'full' }), { edition: 'light', current: '1.0.0' })).toEqual({ ok: false, why: { code: 'edition', detail: 'full' } })
    const lightWithWorker = shell({ edition: 'light', extraBlocks: [block('worker', 'w')] })
    expect(await inspectShell(lightWithWorker, { edition: 'light', current: '1.0.0' })).toEqual({ ok: false, why: { code: 'edition', detail: 'full' } })
  })

  it('downloaded: the file’s version must be the release tag’s; chosen here: never older than this one', async () => {
    expect(await inspectShell(shell({ version: '1.2.0' }), { ...FULL, tag: 'v1.1.0' })).toEqual({ ok: false, why: { code: 'version-mismatch', detail: '1.2.0' } })
    expect((await inspectShell(shell({ version: '1.1.0+build.7' }), { ...FULL, tag: 'v1.1.0' })).ok).toBe(true)
    expect(await inspectShell(shell({ version: '0.9.0' }), FULL)).toEqual({ ok: false, why: { code: 'older', detail: '0.9.0' } })
    expect((await inspectShell(shell({ version: '1.0.0' }), FULL)).ok).toBe(true)
  })

  it('refuses a block twice, a block missing, a malformed one, a copy slot, or blocks too large together', async () => {
    expect(await inspectShell(shell({ extraBlocks: [block('3dmol', 'again')] }), FULL)).toEqual({ ok: false, why: { code: 'blocks', detail: '3dmol twice' } })
    expect(await inspectShell(shell({ drop: ['licenses'] }), FULL)).toEqual({ ok: false, why: { code: 'blocks', detail: 'licenses missing' } })
    expect(await inspectShell(shell({ drop: ['rt-b.whl'] }), FULL)).toEqual({ ok: false, why: { code: 'blocks', detail: 'rt-b.whl missing' } })
    expect(await inspectShell(shell({ drop: ['worker'] }), FULL)).toEqual({ ok: false, why: { code: 'blocks', detail: 'worker missing' } })
    const notGz = '<script type="application/x-agdb-b64" id="agdb-extra" data-len="3">abc</script>'
    expect(await inspectShell(shell({ extraBlocks: [notGz] }), FULL)).toEqual({ ok: false, why: { code: 'blocks', detail: 'extra' } })
    const notB64 = '<script type="application/x-agdb-b64" id="agdb-extra" data-gz="1" data-len="3">&lt;script&gt;</script>'
    expect(await inspectShell(shell({ extraBlocks: [notB64] }), FULL)).toEqual({ ok: false, why: { code: 'blocks', detail: 'extra' } })
    expect(await inspectShell(shell({ slot: true }), FULL)).toEqual({ ok: false, why: { code: 'blocks', detail: 'a copy slot' } })
    const huge = `<script type="application/x-agdb-b64" id="agdb-huge" data-gz="1" data-len="${SHELL_RAW_MAX}">AAAA</script>`
    expect(await inspectShell(shell({ extraBlocks: [huge] }), FULL)).toEqual({ ok: false, why: { code: 'too-large' } })
  })

  it('reads the config with a cap: a gzip bomb stops there, and a config that is no object is refused', async () => {
    expect(await inspectShell(shell({ config: JSON.stringify({ v: 1, edition: 'full', pad: 'x'.repeat(300 * 1024) }) }), FULL)).toEqual({ ok: false, why: { code: 'blocks', detail: 'config' } })
    expect(await inspectShell(shell({ config: '[1]' }), FULL)).toEqual({ ok: false, why: { code: 'blocks', detail: 'config' } })
    expect(await inspectShell(shell({ config: '{"v":1,"edition":"full","runtime":{"base":1}}' }), FULL)).toEqual({ ok: false, why: { code: 'blocks', detail: 'runtime' } })
  })

  it('refuses a policy wider than this app’s, missing, twice, out of the head or after a script', async () => {
    const wider = PAGE_CSP.replace('connect-src https://files.rcsb.org', 'connect-src https://files.rcsb.org https://evil.example')
    expect(await inspectShell(shell({ csp: wider }), FULL)).toEqual({ ok: false, why: { code: 'csp', detail: 'connect-src https://evil.example' } })
    expect(await inspectShell(shell({ csp: PAGE_CSP.replace("frame-src 'none'", "frame-src *") }), FULL)).toEqual({ ok: false, why: { code: 'csp', detail: 'frame-src *' } })
    expect(await inspectShell(shell({ csp: PAGE_CSP.replace("; base-uri 'none'", '') }), FULL)).toEqual({ ok: false, why: { code: 'csp', detail: 'base-uri (missing)' } })
    expect(await inspectShell(shell({ csp: null }), FULL)).toEqual({ ok: false, why: { code: 'csp', detail: 'none' } })
    expect(await inspectShell(shell({ cspAfterScript: true }), FULL)).toEqual({ ok: false, why: { code: 'csp', detail: 'an element before it' } })
    // A narrower one is fine: it allows nothing this app does not.
    expect((await inspectShell(shell({ csp: PAGE_CSP.replace(' https://api.github.com', '') }), FULL)).ok).toBe(true)
  })
})

describe('a file that reads differently once opened (PR #8790 review, round 1)', () => {
  // The check refuses any element whose parse depends on scripting; this input must be refused.
  const NOSCRIPT = '<noscript><style></noscript><script>window.__shellRan = 9</script></style></noscript>'

  it('refuses a head <noscript> that hides a script before the policy, and any other element there', async () => {
    expect(await inspectShell(shell({ beforeCsp: NOSCRIPT }), FULL)).toEqual({ ok: false, why: { code: 'csp', detail: 'a <noscript> element' } })
    expect(await inspectShell(shell({ beforeCsp: '<title>x</title>' }), FULL)).toEqual({ ok: false, why: { code: 'csp', detail: 'an element before it' } })
    expect(await inspectShell(shell({ beforeCsp: '<link rel="stylesheet" href="https://evil.example/x.css">' }), FULL)).toEqual({ ok: false, why: { code: 'csp', detail: 'an element before it' } })
    expect((window as unknown as Record<string, unknown>).__shellRan).toBeUndefined()
  })

  it('refuses noscript, raw-text, frame and embed elements anywhere: the app’s page has none', async () => {
    for (const [tag, markup] of [
      ['noscript', '<noscript>x</noscript>'],
      ['noembed', '<noembed>x</noembed>'],
      ['noframes', '<noframes>x</noframes>'],
      ['xmp', '<xmp>x</xmp>'],
      ['iframe', '<iframe></iframe>'],
      ['object', '<object></object>'],
      ['embed', '<embed>'],
    ]) {
      expect(await inspectShell(shell({ extraBlocks: [markup] }), FULL), tag).toEqual({ ok: false, why: { code: 'csp', detail: `a <${tag}> element` } })
    }
  })

  it('a page that passes reads the same once saved: the policy first, the same scripts, one slot', async () => {
    const got = await inspectShell(shell(), FULL)
    if (!got.ok) throw new Error('refused')
    const again = new DOMParser().parseFromString(got.shell.template, 'text/html')
    expect(again.head.firstElementChild?.getAttribute('charset')).toBe('UTF-8')
    expect(again.head.children[1].getAttribute('http-equiv')).toBe('Content-Security-Policy')
    expect(again.querySelectorAll('script')).toHaveLength(1)
    expect(again.querySelectorAll('#agdb-copy-slot')).toHaveLength(1)
  })
})

describe('the release signature stays with the file AgroDesign signed (owner 2026-11-17)', () => {
  it('a shell’s signature meta is left out of the page a copy is made in, and so is the page’s own', async () => {
    const signedShell = shell().replace('<title>new</title>', '<meta name="agdb-viewer-pack-signature" content="c2lnbmF0dXJl"><title>new</title>')
    const got = await inspectShell(signedShell, FULL)
    if (!got.ok) throw new Error('refused')
    expect(signedShell).toContain('agdb-viewer-pack-signature')
    expect(got.shell.template).not.toContain('agdb-viewer-pack-signature')
    oldPage('full')
    document.head.insertAdjacentHTML('beforeend', '<meta name="agdb-viewer-pack-signature" content="c2lnbmF0dXJl">')
    captureTemplate()
    const copy = await makeAppCopy({ edition: 'full', doc: null, config: CONFIG, lang: 'ja', engine: '3dmol', now: new Date() })
    expect(await readText(copy)).not.toContain('agdb-viewer-pack-signature')
  })
})

describe('cspWithin', () => {
  it('the same policy, or a narrower one, is within; any source more, a directive more or a directive dropped is not', () => {
    expect(cspWithin(PAGE_CSP)).toBeNull()
    expect(cspWithin(PAGE_CSP.replace("img-src data: blob:", 'img-src data:'))).toBeNull()
    expect(cspWithin(`${PAGE_CSP}; report-uri https://x.example/r`)).toBe('report-uri https://x.example/r')
    expect(cspWithin(`${PAGE_CSP}; upgrade-insecure-requests`)).toBeNull()
    expect(cspWithin(PAGE_CSP.replace("default-src 'none'", "default-src 'self'"))).toBe('default-src')
    expect(cspWithin(`${PAGE_CSP}; script-src *`)).toBe('a directive given twice')
  })
})

describe('the copy in the latest version’s shell', () => {
  const embedded = () => embeddedDoc('data_1CRN\n', '1CRN', 'Crambin')

  it('keeps the shell’s code, runtime, licences and CSP; this page gives the config’s data, the structure and its views', async () => {
    oldPage('full')
    const got = await inspectShell(shell(), { ...FULL, tag: 'v1.1.0' })
    if (!got.ok) throw new Error('refused')
    const blob = await makeAppCopy({ edition: 'full', doc: embedded(), config: CONFIG, lang: 'en', engine: '3dmol', now: new Date('2026-11-17T00:00:00Z') }, document, got.shell)
    const { rest, blocks } = await takeApart(blob)
    expect([...blocks.keys()]).toEqual(['config', 'structure', 'mol3d', 'pymol-look', '3dmol', 'worker', 'pyodide-js', 'pyodide-core', 'rt-b.whl', 'licenses'])
    expect(blocks.get('structure')!.toString()).toBe('data_1CRN\n')
    expect(blocks.get('3dmol')!.toString()).toBe('/* 3Dmol new */')
    expect(blocks.get('worker')!.toString()).toBe('new worker')
    expect(JSON.parse(blocks.get('licenses')!.toString())[0].text).toBe('new')
    const config = JSON.parse(blocks.get('config')!.toString())
    expect(config).toMatchObject({ v: 1, edition: 'full', structureId: 42, title: 'Crambin', code: '1CRN', lang: 'en', runtime: { base: 'https://agdb-standalone.invalid/pymol/new/', handed: ['b.whl'] } })
    // The latest version's page around them, its mark and policy; nothing of the old app's.
    expect(rest).toContain('/* new app */')
    expect(rest).not.toContain('/* old app */')
    expect(rest).toContain('<meta name="agdb-viewer-pack" content="1.1.0" data-config="1">')
    expect(rest).toContain(PAGE_CSP)
    expect(rest).not.toContain('agdb-copy-slot')
  })

  it('the header logo: this page’s when it has one, else the shell’s own; a shell’s own data is left out', async () => {
    oldPage('light', true)
    const withOwn = await inspectShell(shell({ edition: 'light', logo: true, structure: true }), { edition: 'light', current: '1.0.0' })
    if (!withOwn.ok) throw new Error('refused')
    const light = { ...CONFIG, edition: 'light' as const, runtime: null }
    const a = await takeApart(await makeAppCopy({ edition: 'light', doc: embedded(), config: light, lang: 'ja', engine: '3dmol', now: new Date() }, document, withOwn.shell))
    expect(a.blocks.get('logo')!.toString()).toBe('OLDLOGO')
    expect(a.blocks.get('structure')!.toString()).toBe('data_1CRN\n')
    expect([...a.blocks.keys()].filter(k => k === 'logo' || k === 'structure')).toEqual(['structure', 'logo'])
    oldPage('light', false)
    const b = await takeApart(await makeAppCopy({ edition: 'light', doc: null, config: light, lang: 'ja', engine: '3dmol', now: new Date() }, document, withOwn.shell))
    expect(b.blocks.get('logo')!.toString()).toBe('NEWLOGO')
    // Blank: no structure, the shell's own included.
    expect(b.blocks.has('structure')).toBe(false)
  })

  it('refuses another edition than the shell’s', async () => {
    oldPage('full')
    const got = await inspectShell(shell(), FULL)
    if (!got.ok) throw new Error('refused')
    await expect(makeAppCopy({ edition: 'light', doc: null, config: CONFIG, lang: 'ja', engine: '3dmol', now: new Date() }, document, got.shell)).rejects.toThrow('edition')
  })

  it('migrateInto: the views and the Heavy viewer’s session as this page holds them, named by the rule with the latest version', async () => {
    oldPage('full')
    const got = await inspectShell(shell(), { ...FULL, tag: 'v1.1.0' })
    if (!got.ok) throw new Error('refused')
    const look = { v: 1 as const, view: [0, 0, 0, 0, 0, 0, 0, 1], bg: '#ffffff', atoms: 1, groups: [], surfaces: [] }
    const src: CopySource = {
      config: CONFIG,
      doc: embedded(),
      lang: 'ja',
      engine: 'pymol',
      dmolLook: () => look,
      pymolSession: async () => new Uint8Array([7, 7, 7]).buffer as ArrayBuffer,
    }
    expect(movesOf(src)).toEqual({ structure: 'Crambin', dmolView: true, pymolSession: true, pymolLeft: false, dmolMarks: true })
    const now = new Date(2026, 10, 17, 9, 0)
    const file = await migrateInto(got.shell, src, new AbortController().signal, now)
    expect(file.name).toBe(`${viewerPackFileStem('1CRN', 'full', now, '1.1.0')}.html`)
    expect(file.name).toMatch(/_AgroDesign-ProteinViewerPack-v1\.1\.0_full_20261117\.html$/)
    const { blocks } = await takeApart(file.blob)
    expect(JSON.parse(blocks.get('mol3d-session')!.toString())).toEqual(look)
    expect([...blocks.get('pymol-session')!]).toEqual([7, 7, 7])
    expect(JSON.parse(blocks.get('config')!.toString())).toMatchObject({ initialEngine: 'pymol' })
  })

  it('says what stays behind: the Heavy viewer’s state when it has not run on the structure, never a view a .pse has not', () => {
    oldPage('full')
    const pdb: StructureDoc = { name: 'lig.pdb', stem: 'lig', ext: 'pdb', bytes: enc('END\n').buffer as ArrayBuffer, text: 'END\n', serial: 2 }
    const base: CopySource = { config: CONFIG, doc: pdb, lang: 'ja', engine: '3dmol', dmolLook: null, pymolSession: null }
    expect(movesOf(base)).toEqual({ structure: 'lig.pdb', dmolView: false, pymolSession: false, pymolLeft: true, dmolMarks: true })
    expect(movesOf({ ...base, doc: null })).toEqual({ structure: null, dmolView: false, pymolSession: false, pymolLeft: false, dmolMarks: false })
    expect(movesOf({ ...base, config: { ...CONFIG, edition: 'light', runtime: null } })).toMatchObject({ pymolLeft: false, pymolSession: false })
  })
})
