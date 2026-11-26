/**
 * `useLatestUpdate` and `migrateInto` below HELP's panel (LatestPanel.test.tsx
 * drives the happy path through the dialog): the download is said in whole
 * MB steps, a tag or repository that cannot make an address is not fetched,
 * a chosen file too large or unreadable is refused before any check, an
 * unsigned file is refused before its form is read, one run at a time, Stop
 * and reset, and the copy's own failures — the Heavy viewer's session, the
 * copy itself, a Stop while the session is written.
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { PageConfig } from './blocks'
import { LATEST_MAX_BYTES } from './latestFetch'
import type { CheckedShell } from './latestShell'
import { migrateInto, useLatestUpdate, type CopySource } from './latestUpdate'
import { embeddedDoc } from './localFile'
import { releaseKeyPair } from './releaseSigning.testkit'

const LIGHT: PageConfig = {
  edition: 'light',
  structureId: 0,
  title: 'Crambin',
  code: '1CRN',
  exporterName: null,
  lang: 'ja',
  initialEngine: '3dmol',
  bColumn: 'bfactor',
  exportedAt: '',
  timeZone: null,
  pymolView: null,
  skipped: [],
  runtime: null,
}
const FULL: PageConfig = { ...LIGHT, edition: 'full', runtime: { base: 'https://agdb-standalone.invalid/pymol/x/', handed: [] } }

const doc = () => embeddedDoc('data_1CRN\n', '1CRN', 'Crambin')
const light = (): CopySource => ({ config: LIGHT, doc: doc(), lang: 'ja', engine: '3dmol', dmolLook: null, pymolSession: null })

let KEY: string
beforeAll(async () => {
  KEY = (await releaseKeyPair()).publicKey
})

afterEach(() => {
  vi.restoreAllMocks()
})

const MiB = 1024 * 1024

/**
 * A 200 answer whose body arrives in chunks of the given sizes, one per
 * macrotask: as a network delivers them, so React renders between them.
 */
function chunked(sizes: number[]): Response {
  const left = [...sizes]
  const body = new ReadableStream<Uint8Array>({
    async pull(c) {
      await new Promise(r => setTimeout(r, 0))
      const n = left.shift()
      if (n === undefined) c.close()
      else c.enqueue(new Uint8Array(n))
    },
  })
  return new Response(body, { status: 200 })
}

describe('useLatestUpdate — from the release', () => {
  it('says the download in whole MB steps, then refuses it unsigned without reading its form', async () => {
    const seen: number[] = []
    const fetchImpl = vi.fn(async () => chunked([MiB / 2, MiB / 2, MiB / 4, MiB, 10]))
    const { result } = renderHook(() => {
      const u = useLatestUpdate(light(), { fetchImpl, publicKey: KEY })
      if (u.step.phase === 'fetching') seen.push(u.step.received)
      return u
    })
    act(() => result.current.fromRelease({ tag: 'v1.1.0', assets: [] }))
    await waitFor(() => expect(result.current.step.phase).toBe('failed'))
    // 0 at the start, then once per whole MB crossed: 1 MiB, then 2.25 MiB (not 1.25).
    expect([...new Set(seen)]).toEqual([0, MiB, 2 * MiB + MiB / 4])
    expect(result.current.step).toMatchObject({ phase: 'failed', source: 'release', why: { kind: 'signature' } })
  })

  it('fetches nothing for a tag that cannot be in an address', async () => {
    const fetchImpl = vi.fn()
    const { result } = renderHook(() => useLatestUpdate(light(), { fetchImpl, publicKey: KEY }))
    act(() => result.current.fromRelease({ tag: 'latest/../../x', assets: [] }))
    await waitFor(() => expect(result.current.step.phase).toBe('failed'))
    expect(result.current.step).toEqual({ phase: 'failed', source: 'release', why: { kind: 'fetch', failure: { kind: 'not-found' } } })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('a download that fails is said with its reason', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 503 }))
    const { result } = renderHook(() => useLatestUpdate(light(), { fetchImpl, publicKey: KEY }))
    act(() => result.current.fromRelease({ tag: 'v1.1.0', assets: [] }))
    await waitFor(() => expect(result.current.step.phase).toBe('failed'))
    expect(result.current.step).toEqual({ phase: 'failed', source: 'release', why: { kind: 'fetch', failure: { kind: 'http', status: 503 } } })
  })

  it('does nothing without a page to copy from', () => {
    const fetchImpl = vi.fn()
    const { result } = renderHook(() => useLatestUpdate(null, { fetchImpl, publicKey: KEY }))
    act(() => result.current.fromRelease({ tag: 'v1.1.0', assets: [] }))
    act(() => result.current.fromFile(new File(['x'], 'x.html')))
    expect(result.current.step).toEqual({ phase: 'idle' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('one run at a time: a second press while one runs does nothing; reset waits for it, Stop ends it', async () => {
    let answer: (r: Response) => void = () => undefined
    const fetchImpl = vi.fn((_u: string, init: RequestInit) => {
      init.signal?.addEventListener('abort', () => answer(new Response('', { status: 499 })))
      return new Promise<Response>(r => (answer = r))
    })
    const { result } = renderHook(() => useLatestUpdate(light(), { fetchImpl, publicKey: KEY }))
    act(() => result.current.fromRelease({ tag: 'v1.1.0', assets: [] }))
    act(() => result.current.fromRelease({ tag: 'v1.1.0', assets: [] }))
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    act(() => result.current.reset())
    expect(result.current.step.phase).toBe('fetching')
    act(() => result.current.stop())
    expect(result.current.step).toEqual({ phase: 'stopped' })
    // The aborted download's answer changes nothing.
    await act(async () => undefined)
    expect(result.current.step).toEqual({ phase: 'stopped' })
    act(() => result.current.reset())
    expect(result.current.step).toEqual({ phase: 'idle' })
  })
})

describe('useLatestUpdate — a file chosen here', () => {
  it('refuses a file over the size cap before reading it', async () => {
    const read = vi.spyOn(FileReader.prototype, 'readAsArrayBuffer')
    const file = new File(['x'], 'big.html')
    Object.defineProperty(file, 'size', { value: LATEST_MAX_BYTES + 1 })
    const { result } = renderHook(() => useLatestUpdate(light(), { publicKey: KEY }))
    act(() => result.current.fromFile(file))
    await waitFor(() => expect(result.current.step.phase).toBe('failed'))
    expect(result.current.step).toEqual({ phase: 'failed', source: 'file', why: { kind: 'shell', refusal: { code: 'too-large' } } })
    expect(read).not.toHaveBeenCalled()
  })

  it('says a file the browser could not read', async () => {
    vi.spyOn(FileReader.prototype, 'readAsArrayBuffer').mockImplementation(function (this: FileReader) {
      Object.defineProperty(this, 'error', { value: new Error('The file\n could not be read') })
      this.onerror?.(new ProgressEvent('error') as ProgressEvent<FileReader>)
    })
    const { result } = renderHook(() => useLatestUpdate(light(), { publicKey: KEY }))
    act(() => result.current.fromFile(new File(['x'], 'x.html')))
    await waitFor(() => expect(result.current.step.phase).toBe('failed'))
    expect(result.current.step).toEqual({ phase: 'failed', source: 'file', why: { kind: 'read', detail: 'The file could not be read' } })
  })

  it('refuses an unsigned file before its form is read', async () => {
    const { result } = renderHook(() => useLatestUpdate(light(), { publicKey: KEY }))
    act(() => result.current.fromFile(new File(['<!DOCTYPE html><html></html>'], 'x.html')))
    await waitFor(() => expect(result.current.step.phase).toBe('failed'))
    expect(result.current.step).toMatchObject({ phase: 'failed', source: 'file', why: { kind: 'signature' } })
  })
})

describe('migrateInto', () => {
  /** A full page on its original structure, with the Heavy viewer running on it. */
  const full = (pymolSession: CopySource['pymolSession']): CopySource => ({ config: FULL, doc: doc(), lang: 'en', engine: 'pymol', dmolLook: null, pymolSession })
  const shell = { edition: 'full', version: '1.1.0' } as unknown as CheckedShell

  it('a session the Heavy viewer could not write is its own failure, with its words on one line', async () => {
    const src = full(async () => {
      throw new Error('PyMOL\n  stopped')
    })
    await expect(migrateInto(shell, src, new AbortController().signal)).rejects.toMatchObject({ code: 'session', detail: 'PyMOL stopped' })
  })

  it('a Stop while the session is written ends it as stopped, not as a failure', async () => {
    const stop = new AbortController()
    const src = full(async () => {
      stop.abort()
      return new ArrayBuffer(4)
    })
    await expect(migrateInto(shell, src, stop.signal)).rejects.toMatchObject({ code: 'aborted' })
  })

  it('a copy that cannot be made is a failure of the copy', async () => {
    // A shell that is no page: the copy cannot be put into it.
    await expect(migrateInto(shell, light(), new AbortController().signal)).rejects.toMatchObject({ code: 'make' })
  })
})
