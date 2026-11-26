/**
 * 「PDB から読み込む」 (owner 2026-11-14): which IDs are taken, the one URL
 * asked, and how RCSB's answers — the entry, no such entry, another HTTP
 * answer, no connection, a stop, an entry over the cap — come back. What is
 * downloaded meets `readStructureFile` as a file would.
 */
import { describe, expect, it, vi } from 'vitest'

import { capOf, readStructureFile } from './localFile'
import { downloadPdbEntry, normalizePdbId, RCSB_DOWNLOAD_BASE, RCSB_TIMEOUT_MS } from './rcsb'

const CIF = 'data_1CRN\n_entry.id 1CRN\n'

type Init = RequestInit & { signal: AbortSignal }

function answering(make: (url: string, init: Init) => Response | Promise<Response>) {
  return vi.fn((url: string, init: RequestInit) => Promise.resolve(make(url, init as Init)))
}

describe('normalizePdbId', () => {
  it('takes a classic ID — a digit and three letters or digits — upper-cased', () => {
    expect(normalizePdbId('1crn')).toBe('1CRN')
    expect(normalizePdbId(' 4HHB ')).toBe('4HHB')
    expect(normalizePdbId('9zzz')).toBe('9ZZZ')
  })

  it('takes an extended ID, as the classic one when it only pads it', () => {
    expect(normalizePdbId('pdb_00001crn')).toBe('1CRN')
    expect(normalizePdbId('PDB_00001CRN')).toBe('1CRN')
    expect(normalizePdbId('pdb_10001abc')).toBe('pdb_10001abc')
    // `0001` is no classic ID (those start 1-9): asked for under the extended name (PT-9188 item 8).
    expect(normalizePdbId('pdb_00000001')).toBe('pdb_00000001')
  })

  it('refuses anything else, so nothing but an ID reaches the URL', () => {
    for (const bad of ['', '0abc', '0001', 'crn1', '1cr', '1crnn', '1c-n', '1c/n', '../1crn', '1crn.cif', 'pdb_0001crn', 'pdb_00001crn1', 'pdb-00001crn', '１CRN']) {
      expect(normalizePdbId(bad), bad).toBeNull()
    }
  })
})

describe('downloadPdbEntry', () => {
  it('asks RCSB for <ID>.cif with no credentials and no referrer, and hands back a file readStructureFile opens', async () => {
    const fetchImpl = answering(() => new Response(CIF, { status: 200, headers: { 'Content-Type': 'chemical/x-cif' } }))
    const got = await downloadPdbEntry('1CRN', new AbortController().signal, fetchImpl)
    expect(fetchImpl).toHaveBeenCalledOnce()
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe(`${RCSB_DOWNLOAD_BASE}1CRN.cif`)
    expect(url).toBe('https://files.rcsb.org/download/1CRN.cif')
    expect(init).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer', mode: 'cors' })
    expect(got.ok).toBe(true)
    if (!got.ok) return
    expect(got.file.name).toBe('1CRN.cif')
    const read = await readStructureFile(got.file)
    expect(read.ok && read.doc.ext).toBe('cif')
    expect(read.ok && read.doc.text).toBe(CIF)
  })

  it('says "not found" for an ID RCSB does not have (404)', async () => {
    const got = await downloadPdbEntry('0XXX', new AbortController().signal, answering(() => new Response('Not Found', { status: 404 })))
    expect(got).toEqual({ ok: false, why: { code: 'not-found' } })
  })

  it('names any other HTTP answer', async () => {
    const got = await downloadPdbEntry('1CRN', new AbortController().signal, answering(() => new Response('busy', { status: 503 })))
    expect(got).toEqual({ ok: false, why: { code: 'http', status: 503 } })
  })

  it('says "no connection" when the request cannot be made (offline, or the CSP)', async () => {
    const fetchImpl = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')))
    expect(await downloadPdbEntry('1CRN', new AbortController().signal, fetchImpl)).toEqual({ ok: false, why: { code: 'network' } })
  })

  it('stops when its signal fires, before or during the download', async () => {
    const stop = new AbortController()
    const fetchImpl = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        }),
    )
    const pending = downloadPdbEntry('1CRN', stop.signal, fetchImpl)
    stop.abort()
    expect(await pending).toEqual({ ok: false, why: { code: 'aborted' } })
  })

  it('gives up a download that stalls, as "no answer in time", not as stopped (PT-9188 item 3)', async () => {
    vi.useFakeTimers()
    try {
      const fetchImpl = vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
          }),
      )
      const pending = downloadPdbEntry('1CRN', new AbortController().signal, fetchImpl)
      await vi.advanceTimersByTimeAsync(RCSB_TIMEOUT_MS - 1)
      let settled = false
      void pending.then(() => (settled = true))
      await Promise.resolve()
      expect(settled).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      expect(await pending).toEqual({ ok: false, why: { code: 'timeout' } })
    } finally {
      vi.useRealTimers()
    }
  })

  it('a slow download that keeps coming goes on past the stall deadline; one that never ends stops at the ceiling (PT-9229 item 2)', async () => {
    vi.useFakeTimers()
    try {
      const chunk = new TextEncoder().encode('data_x\n')
      // A chunk every 20 s for 2 minutes: never 30 s without one.
      let sent = 0
      const steady = new ReadableStream<Uint8Array>({
        async pull(controller) {
          await new Promise(res => setTimeout(res, 20_000))
          controller.enqueue(chunk)
          if (++sent === 6) controller.close()
        },
      })
      const slow = downloadPdbEntry('1CRN', new AbortController().signal, answering(() => new Response(steady, { status: 200 })))
      await vi.advanceTimersByTimeAsync(130_000)
      const got = await slow
      expect(got.ok).toBe(true)
      if (got.ok) expect(got.file.size).toBe(chunk.byteLength * 6)
      // A chunk every 20 s for ever: stopped at the ceiling, said as such.
      const endless = (signal: AbortSignal | null | undefined) =>
        new ReadableStream<Uint8Array>({
          async pull(controller) {
            await new Promise(res => setTimeout(res, 20_000))
            if (signal?.aborted) controller.error(new DOMException('aborted', 'AbortError'))
            else controller.enqueue(chunk)
          },
        })
      const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => new Response(endless(init.signal), { status: 200 }))
      const pending = downloadPdbEntry('1CRN', new AbortController().signal, fetchImpl, RCSB_TIMEOUT_MS, 100_000)
      await vi.advanceTimersByTimeAsync(130_000)
      expect(await pending).toEqual({ ok: false, why: { code: 'too-slow' } })
    } finally {
      vi.useRealTimers()
    }
  })

  it('never reads an entry over the cap: readStructureFile refuses it as too large', async () => {
    const cap = capOf('cif')
    // Declared too large: not read at all.
    const declared = await downloadPdbEntry('1CRN', new AbortController().signal, answering(() => new Response(CIF, { status: 200, headers: { 'Content-Length': String(cap + 1) } })))
    expect(declared.ok).toBe(true)
    if (!declared.ok) return
    expect(declared.file.size).toBe(cap + 1)
    expect(await readStructureFile(declared.file)).toEqual({ ok: false, why: { code: 'too-large', limitMiB: Math.round(cap / (1024 * 1024)) } })
    // Undeclared: the stream stops past the cap.
    let sent = 0
    const big = new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = new Uint8Array(4 * 1024 * 1024)
        sent += chunk.byteLength
        controller.enqueue(chunk)
        if (sent > cap * 3) controller.close()
      },
    })
    const streamed = await downloadPdbEntry('1CRN', new AbortController().signal, answering(() => new Response(big, { status: 200 })))
    expect(streamed.ok).toBe(true)
    if (!streamed.ok) return
    expect(streamed.file.size).toBeGreaterThan(cap)
    expect(sent).toBeLessThan(cap * 2)
    expect((await readStructureFile(streamed.file)).ok).toBe(false)
  })
})
