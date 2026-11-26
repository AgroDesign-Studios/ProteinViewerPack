/**
 * The latest version's blank app, downloaded (owner 2026-11-17): from the
 * one fixed host at the release's tag, nothing of the page sent, no redirect
 * followed, up to 64 MiB, and — when the release lists the attachment — of
 * its size and SHA-256 exactly. Every way it can end is told apart.
 */
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { editionAsset, fetchLatestFile, LATEST_IDLE_MS, LATEST_MAX_BYTES, latestFileUrl, sha256Hex } from './latestFetch'
import type { ReleaseAsset } from './latestRelease'

const REPO = 'https://github.com/AgroDesign-Studios/ProteinViewerPack'
const URL_FULL = 'https://raw.githubusercontent.com/AgroDesign-Studios/ProteinViewerPack/v1.1.0/latest/AgroDesign-ProteinViewerPack_full.html'

afterEach(() => vi.useRealTimers())

const BODY = new TextEncoder().encode('<!doctype html><p>latest</p>')
const hex = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')

/** A response whose body comes in `chunks`. */
function streamed(chunks: Uint8Array[], init: ResponseInit = { status: 200 }): Response {
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const x of chunks) c.enqueue(x)
      c.close()
    },
  })
  return new Response(body, init)
}

const answering = (make: () => Response) => vi.fn(async (_u: string, _i: RequestInit) => make())

/** The bytes got, as a plain list (typed arrays of two realms never compare equal). */
const bytesGot = (r: Awaited<ReturnType<typeof fetchLatestFile>>) => (r.ok ? [...r.bytes] : r)

describe('latestFileUrl', () => {
  it('is the edition’s blank app at the release’s tag on the raw file host, and null for any other repository or tag', () => {
    expect(latestFileUrl(REPO, 'v1.1.0', 'full')).toBe(URL_FULL)
    expect(latestFileUrl(REPO, '1.2.0-rc.1', 'light')).toBe('https://raw.githubusercontent.com/AgroDesign-Studios/ProteinViewerPack/1.2.0-rc.1/latest/AgroDesign-ProteinViewerPack_light.html')
    for (const tag of ['', 'main', 'v1.0', '../v1.0.0', 'v1.0.0/../../x', 'v1.0.0+build', 'v1.0.0?x', 'v1.0.0#x', ' v1.0.0']) expect(latestFileUrl(REPO, tag, 'full'), tag).toBeNull()
    expect(latestFileUrl('https://evil.example/a/b', 'v1.0.0', 'full')).toBeNull()
  })
})

describe('editionAsset', () => {
  it('finds the release’s attachment of the edition by its name', () => {
    const assets: ReleaseAsset[] = [
      { name: 'AgroDesign-ProteinViewerPack-v1.1.0_light_20261201.html', size: 1, sha256: null },
      { name: 'AgroDesign-ProteinViewerPack-v1.1.0_full_20261201.html', size: 2, sha256: null },
      { name: 'notes.txt', size: 3, sha256: null },
    ]
    expect(editionAsset(assets, 'full')?.size).toBe(2)
    expect(editionAsset(assets, 'light')?.size).toBe(1)
    expect(editionAsset([assets[2]], 'full')).toBeNull()
    expect(editionAsset(undefined, 'full')).toBeNull()
  })
})

describe('fetchLatestFile', () => {
  it('asks the fixed address once, sending nothing of the page and following no redirect, and tells the progress', async () => {
    const fetchImpl = answering(() => streamed([BODY.subarray(0, 10), BODY.subarray(10)]))
    const onProgress = vi.fn()
    const got = await fetchLatestFile(URL_FULL, { signal: new AbortController().signal, expect: null, onProgress, fetchImpl })
    expect(bytesGot(got)).toEqual([...BODY])
    expect(fetchImpl).toHaveBeenCalledOnce()
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe(URL_FULL)
    expect(init).toMatchObject({ method: 'GET', mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', redirect: 'manual' })
    expect(init.headers).toBeUndefined()
    expect(init.body).toBeUndefined()
    expect(onProgress.mock.calls).toEqual([
      [10, null],
      [BODY.byteLength, null],
    ])
  })

  it('takes the file when it is the release’s attachment, by size and SHA-256; refuses it otherwise', async () => {
    const good: ReleaseAsset = { name: 'a', size: BODY.byteLength, sha256: hex(BODY) }
    expect(bytesGot(await fetchLatestFile(URL_FULL, { signal: new AbortController().signal, expect: good, fetchImpl: answering(() => streamed([BODY])) }))).toEqual([...BODY])
    const otherBytes = new Uint8Array(BODY)
    otherBytes[3] ^= 1
    expect(await fetchLatestFile(URL_FULL, { signal: new AbortController().signal, expect: good, fetchImpl: answering(() => streamed([otherBytes])) })).toEqual({ ok: false, why: { kind: 'digest' } })
    expect(await fetchLatestFile(URL_FULL, { signal: new AbortController().signal, expect: { ...good, size: 5 }, fetchImpl: answering(() => streamed([BODY])) })).toEqual({ ok: false, why: { kind: 'size' } })
    // No digest listed: the size alone.
    expect((await fetchLatestFile(URL_FULL, { signal: new AbortController().signal, expect: { ...good, sha256: null }, fetchImpl: answering(() => streamed([otherBytes])) })).ok).toBe(true)
  })

  it('stops reading past 64 MiB, and refuses a release that says its file is larger', async () => {
    const big = new Uint8Array(8 * 1024 * 1024)
    const chunks = Array.from({ length: 9 }, () => big)
    expect(await fetchLatestFile(URL_FULL, { signal: new AbortController().signal, expect: null, fetchImpl: answering(() => streamed(chunks)) })).toEqual({ ok: false, why: { kind: 'too-large' } })
    const fetchImpl = answering(() => streamed([BODY]))
    expect(await fetchLatestFile(URL_FULL, { signal: new AbortController().signal, expect: { name: 'a', size: LATEST_MAX_BYTES + 1, sha256: null }, fetchImpl })).toEqual({ ok: false, why: { kind: 'too-large' } })
  })

  it('tells 404, another HTTP answer, a redirect, no connection and a stop apart', async () => {
    const signal = new AbortController().signal
    expect(await fetchLatestFile(URL_FULL, { signal, expect: null, fetchImpl: answering(() => new Response('404: Not Found', { status: 404 })) })).toEqual({ ok: false, why: { kind: 'not-found' } })
    expect(await fetchLatestFile(URL_FULL, { signal, expect: null, fetchImpl: answering(() => new Response('', { status: 503 })) })).toEqual({ ok: false, why: { kind: 'http', status: 503 } })
    const redirected = new Response('x', { status: 200 })
    Object.defineProperty(redirected, 'redirected', { value: true })
    expect(await fetchLatestFile(URL_FULL, { signal, expect: null, fetchImpl: answering(() => redirected) })).toEqual({ ok: false, why: { kind: 'redirected' } })
    const opaque = new Response(null, { status: 200 })
    Object.defineProperty(opaque, 'type', { value: 'opaqueredirect' })
    expect(await fetchLatestFile(URL_FULL, { signal, expect: null, fetchImpl: answering(() => opaque) })).toEqual({ ok: false, why: { kind: 'redirected' } })
    const elsewhere = new Response('x', { status: 200 })
    Object.defineProperty(elsewhere, 'url', { value: 'https://raw.githubusercontent.com/other/repo/v1.1.0/latest/x.html' })
    expect(await fetchLatestFile(URL_FULL, { signal, expect: null, fetchImpl: answering(() => elsewhere) })).toEqual({ ok: false, why: { kind: 'redirected' } })
    const offline = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    expect(await fetchLatestFile(URL_FULL, { signal, expect: null, fetchImpl: offline })).toEqual({ ok: false, why: { kind: 'network' } })
    const stop = new AbortController()
    const hanging = vi.fn(
      (_u: string, init: RequestInit) =>
        new Promise<Response>((_r, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))),
    )
    const pending = fetchLatestFile(URL_FULL, { signal: stop.signal, expect: null, fetchImpl: hanging })
    stop.abort()
    expect(await pending).toEqual({ ok: false, why: { kind: 'aborted' } })
  })

  it(`gives up after ${LATEST_IDLE_MS / 1000} s with nothing arriving`, async () => {
    vi.useFakeTimers()
    const hanging = vi.fn(
      (_u: string, init: RequestInit) =>
        new Promise<Response>((_r, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))),
    )
    const pending = fetchLatestFile(URL_FULL, { signal: new AbortController().signal, expect: null, fetchImpl: hanging })
    await vi.advanceTimersByTimeAsync(LATEST_IDLE_MS)
    expect(await pending).toEqual({ ok: false, why: { kind: 'timeout' } })
  })
})

describe('sha256Hex', () => {
  it('is the SHA-256 as lower-case hex', async () => {
    expect(await sha256Hex(BODY)).toBe(hex(BODY))
  })
})
