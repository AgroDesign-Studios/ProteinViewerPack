/**
 * The page's open (`docOpener.ts`, PT-9133 item 7): a document the open
 * dialog accepted is shown at once and opened in PyMOL behind it, or added
 * to PyMOL; the latest open wins; a session PyMOL refuses goes back to what
 * was shown, another format stays in 3Dmol.js.
 */
import { describe, expect, it, vi } from 'vitest'

import { DocOpener, type OpenTarget } from './docOpener'
import type { PageMessage } from './ExportHub'
import { embeddedDoc, type StructureDoc } from './localFile'
import { DocRefused } from './pymolBridge'

const docOf = (name: string, ext: StructureDoc['ext'], serial: number): StructureDoc => ({ ...embeddedDoc('data_x\n', name, name), name, ext, serial })

/** A promise and its settle functions. */
function deferred() {
  let resolve: () => void = () => undefined
  let reject: (e: unknown) => void = () => undefined
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function page(over: Partial<OpenTarget> = {}) {
  const shown: (StructureDoc | null)[] = []
  const said: (PageMessage | null)[] = []
  const target: OpenTarget = {
    bridge: { addDocument: vi.fn(async () => undefined), openDocument: vi.fn(async () => undefined) },
    before: docOf('before.pdb', 'pdb', 1),
    show: d => shown.push(d),
    say: m => said.push(m),
    startPymol: vi.fn(),
    replaced: vi.fn(),
    ...over,
  }
  return { target, shown, said, last: () => said[said.length - 1] }
}

describe('DocOpener', () => {
  it('shows a replaced document at once, says so, and opens it in PyMOL behind it', async () => {
    const p = page()
    const next = docOf('next.pdb', 'pdb', 2)
    await new DocOpener().open(next, 'replace', p.target)
    expect(p.shown).toEqual([next])
    expect(p.target.replaced).toHaveBeenCalledOnce()
    expect(p.last()).toEqual({ key: 'htmlExport:sa_open_opened', vars: { name: 'next.pdb' }, error: false })
    expect(p.target.bridge!.openDocument).toHaveBeenCalledWith(next)
    expect(p.target.startPymol).not.toHaveBeenCalled()
  })

  it('adds to PyMOL without touching what is shown, and says a refusal', async () => {
    const p = page()
    const add = p.target.bridge!.addDocument as ReturnType<typeof vi.fn>
    await new DocOpener().open(docOf('lig.sdf', 'sdf', 2), 'add', p.target)
    expect(p.shown).toEqual([])
    expect(p.last()).toEqual({ key: 'htmlExport:sa_open_added', vars: { name: 'lig.sdf' }, error: false })
    add.mockRejectedValueOnce(new Error('cmd.load failed'))
    await new DocOpener().open(docOf('bad.sdf', 'sdf', 3), 'add', p.target)
    expect(p.last()).toEqual({ key: 'htmlExport:sa_open_err_add', vars: { detail: 'cmd.load failed' }, error: true })
    expect(p.target.replaced).not.toHaveBeenCalled()
  })

  it('starts PyMOL for a session, and goes back to what was shown when PyMOL refuses it', async () => {
    const p = page()
    ;(p.target.bridge!.openDocument as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('not a session'))
    const pse = docOf('s.pse', 'pse', 2)
    await new DocOpener().open(pse, 'replace', p.target)
    expect(p.target.startPymol).toHaveBeenCalledOnce()
    expect(p.shown).toEqual([pse, p.target.before])
    expect(p.last()).toEqual({ key: 'htmlExport:sa_open_err_pymol', vars: { name: 's.pse', detail: 'not a session' }, error: true })
  })

  it('keeps another format open in 3Dmol.js when PyMOL refuses it', async () => {
    const p = page()
    ;(p.target.bridge!.openDocument as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('bad atoms'))
    const next = docOf('odd.pdb', 'pdb', 2)
    await new DocOpener().open(next, 'replace', p.target)
    expect(p.shown).toEqual([next])
    expect(p.last()?.error).toBe(true)
  })

  it('lets the latest open win: an older one that fails later says nothing and reverts nothing', async () => {
    const first = deferred()
    const openDocument = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValueOnce(undefined)
    const p = page({ bridge: { addDocument: vi.fn(), openDocument } })
    const opener = new DocOpener()
    const pse = docOf('old.pse', 'pse', 2)
    const older = opener.open(pse, 'replace', p.target)
    const newer = docOf('new.pdb', 'pdb', 3)
    await opener.open(newer, 'replace', { ...p.target, before: pse })
    first.reject(new Error('late'))
    await older
    expect(p.shown).toEqual([pse, newer])
    expect(p.last()).toEqual({ key: 'htmlExport:sa_open_opened', vars: { name: 'new.pdb' }, error: false })
  })

  it('a refused session goes back to the scene PyMOL says it went back to (PT-9228 item 3)', async () => {
    const p = page()
    const pyScene = docOf('kept.pdb', 'pdb', 5)
    ;(p.target.bridge!.openDocument as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new DocRefused('refused', pyScene))
    const pse = docOf('s.pse', 'pse', 6)
    await new DocOpener().open(pse, 'replace', p.target)
    expect(p.shown).toEqual([pse, pyScene])
  })

  it('a newer session refused while an older one was still loading goes back to the last that opened, never to the older one (PT-9228 items 3, 4; PT-9230 item 7)', async () => {
    const olderLoad = deferred()
    const newerLoad = deferred()
    const openDocument = vi.fn().mockReturnValueOnce(olderLoad.promise).mockReturnValueOnce(newerLoad.promise)
    const p = page({ bridge: { addDocument: vi.fn(), openDocument } })
    const opener = new DocOpener()
    const first = p.target.before
    const older = docOf('older.pse', 'pse', 7)
    const newer = docOf('newer.pse', 'pse', 8)
    const a = opener.open(older, 'replace', p.target)
    // The page's `before` for the newer open is the older session, which PyMOL then refuses.
    const b = opener.open(newer, 'replace', { ...p.target, before: older })
    olderLoad.reject(new Error('older refused'))
    newerLoad.reject(new Error('newer refused'))
    await a
    await b
    expect(p.shown).toEqual([older, newer, first])
    expect(p.last()).toMatchObject({ key: 'htmlExport:sa_open_err_pymol', vars: { name: 'newer.pse' }, error: true })
  })

  it('a session that did open is where a later refused one goes back to', async () => {
    const openDocument = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('refused'))
    const p = page({ bridge: { addDocument: vi.fn(), openDocument } })
    const opener = new DocOpener()
    const good = docOf('good.pse', 'pse', 9)
    await opener.open(good, 'replace', p.target)
    await opener.open(docOf('bad.pse', 'pse', 10), 'replace', { ...p.target, before: null })
    expect(p.shown[p.shown.length - 1]).toBe(good)
  })

  it('the light edition (no PyMOL) only shows', async () => {
    const p = page({ bridge: null })
    const next = docOf('a.pdb', 'pdb', 2)
    await new DocOpener().open(next, 'add', p.target)
    expect(p.shown).toEqual([next])
  })
})
