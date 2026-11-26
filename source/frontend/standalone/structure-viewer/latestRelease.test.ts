/**
 * HELP's latest-version check (owner 2026-11-16): the release tag as SemVer
 * (a leading v dropped, pre-releases ordered, build metadata ignored, other
 * tags not compared), one request to GitHub's API that sends nothing of the
 * page, and every way it can end told apart — 404, the rate limit, another
 * HTTP answer, no connection, 8 s with no complete answer — with no retry.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { checkLatestRelease, compareSemVer, judgeRelease, latestReleaseApiUrl, parseSemVer, releaseAssets, RELEASE_TIMEOUT_MS, type SemVer } from './latestRelease'

const REPO = 'https://github.com/AgroDesign-Studios/ProteinViewerPack'
const API = 'https://api.github.com/repos/AgroDesign-Studios/ProteinViewerPack/releases/latest'

const v = (s: string): SemVer => {
  const got = parseSemVer(s)
  if (got === null) throw new Error(`not SemVer: ${s}`)
  return got
}

afterEach(() => vi.useRealTimers())

describe('latestReleaseApiUrl', () => {
  it('is the API’s latest release of a github.com repository page, and null for anything else', () => {
    expect(latestReleaseApiUrl(REPO)).toBe(API)
    for (const bad of ['', 'https://github.com/AgroDesign-Studios', 'http://github.com/a/b', 'https://github.com/a/b/', 'https://github.com/a/b?x=1', 'https://evil.example/a/b', 'https://github.com.evil/a/b']) {
      expect(latestReleaseApiUrl(bad), bad).toBeNull()
    }
  })
})

describe('parseSemVer', () => {
  it('reads x.y.z, a leading v, a pre-release and build metadata (dropped)', () => {
    expect(parseSemVer('1.0.0')).toEqual({ major: 1, minor: 0, patch: 0, pre: [] })
    expect(parseSemVer('v2.10.3')).toEqual({ major: 2, minor: 10, patch: 3, pre: [] })
    expect(parseSemVer('V1.0.0-rc.1')).toEqual({ major: 1, minor: 0, patch: 0, pre: ['rc', 1] })
    expect(parseSemVer('1.0.0-alpha.beta+exp.sha.5114f85')).toEqual({ major: 1, minor: 0, patch: 0, pre: ['alpha', 'beta'] })
    expect(parseSemVer(' 1.0.0+20261116 ')).toEqual({ major: 1, minor: 0, patch: 0, pre: [] })
  })

  it('refuses a numeric pre-release identifier past 2^53, which would compare equal to its neighbours (PT-9495 item 3)', () => {
    expect(parseSemVer('1.0.0-9007199254740991')).toEqual({ major: 1, minor: 0, patch: 0, pre: [9007199254740991] })
    expect(parseSemVer('1.0.0-9007199254740993')).toBeNull()
    expect(parseSemVer('1.0.0-rc.99999999999999999999')).toBeNull()
  })

  it('refuses what is no SemVer', () => {
    for (const bad of ['', '1', '1.0', '1.0.0.0', 'v', 'vv1.0.0', '01.0.0', '1.02.0', '1.0.0-', '1.0.0-01', '1.0.0+', 'release-3', 'latest', '1.0.0 beta', '９.0.0']) {
      expect(parseSemVer(bad), bad).toBeNull()
    }
  })
})

describe('compareSemVer (semver.org §11)', () => {
  it('orders the numbers in turn, by value', () => {
    expect(compareSemVer(v('1.0.0'), v('1.0.0'))).toBe(0)
    expect(compareSemVer(v('1.0.0'), v('2.0.0'))).toBe(-1)
    expect(compareSemVer(v('2.1.0'), v('2.0.9'))).toBe(1)
    expect(compareSemVer(v('1.9.0'), v('1.10.0'))).toBe(-1)
    expect(compareSemVer(v('1.0.10'), v('1.0.9'))).toBe(1)
  })

  it('puts a pre-release below its release, and orders pre-releases as the spec does', () => {
    const chain = ['1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0']
    for (let i = 0; i < chain.length - 1; i++) {
      expect(compareSemVer(v(chain[i]), v(chain[i + 1])), `${chain[i]} < ${chain[i + 1]}`).toBe(-1)
      expect(compareSemVer(v(chain[i + 1]), v(chain[i])), `${chain[i + 1]} > ${chain[i]}`).toBe(1)
    }
    expect(compareSemVer(v('1.0.1-rc.1'), v('1.0.0'))).toBe(1)
  })

  it('ignores build metadata', () => {
    expect(compareSemVer(v('1.0.0+a'), v('1.0.0+b'))).toBe(0)
    expect(compareSemVer(v('v1.0.0+build.9'), v('1.0.0'))).toBe(0)
  })
})

describe('judgeRelease', () => {
  it('the same version number, a newer one (with its own release page), an older one', () => {
    expect(judgeRelease('1.0.0', 'v1.0.0', `${REPO}/releases/tag/v1.0.0`, REPO)).toEqual({ kind: 'same', latest: '1.0.0' })
    expect(judgeRelease('1.0.0', 'v1.0.0+build.3', null, REPO)).toEqual({ kind: 'same', latest: '1.0.0+build.3' })
    expect(judgeRelease('1.0.0', 'v1.2.0', `${REPO}/releases/tag/v1.2.0`, REPO)).toEqual({ kind: 'newer', latest: '1.2.0', url: `${REPO}/releases/tag/v1.2.0` })
    expect(judgeRelease('1.0.0-rc.1', '1.0.0', undefined, REPO)).toMatchObject({ kind: 'newer', latest: '1.0.0' })
    expect(judgeRelease('1.0.0', 'v0.9.0', null, REPO)).toEqual({ kind: 'ahead', latest: '0.9.0' })
    expect(judgeRelease('1.0.0', '1.0.0-rc.2', null, REPO)).toEqual({ kind: 'ahead', latest: '1.0.0-rc.2' })
  })

  it('links a newer release only to this repository’s releases, else to the releases page', () => {
    for (const other of ['https://evil.example/x', `${REPO}x/releases/tag/v2.0.0`, 'javascript:alert(1)', `${REPO}/releases/tag/v2 "x"`, 42]) {
      expect(judgeRelease('1.0.0', 'v2.0.0', other, REPO)).toEqual({ kind: 'newer', latest: '2.0.0', url: `${REPO}/releases` })
    }
  })

  it('says a tag that is no SemVer cannot be compared, and shows at most 40 characters of it', () => {
    expect(judgeRelease('1.0.0', 'nightly', null, REPO)).toEqual({ kind: 'unreadable-tag', tag: 'nightly' })
    expect(judgeRelease('1.0.0', 'x'.repeat(100), null, REPO)).toEqual({ kind: 'unreadable-tag', tag: 'x'.repeat(40) })
  })
})

type Init = RequestInit & { signal: AbortSignal }

/** A fetch that answers `make()` and records what it was asked. */
function answering(make: () => Response) {
  return vi.fn(async (_url: string, _init: RequestInit) => make())
}

const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, ...init })

describe('checkLatestRelease', () => {
  it('asks the repository’s latest release once, with no credentials, no referrer, no cache, and nothing of the page', async () => {
    const fetchImpl = answering(() => json({ tag_name: 'v1.0.0', html_url: `${REPO}/releases/tag/v1.0.0` }))
    expect(await checkLatestRelease(REPO, '1.0.0', new AbortController().signal, fetchImpl)).toEqual({ kind: 'same', latest: '1.0.0' })
    expect(fetchImpl).toHaveBeenCalledOnce()
    const [url, init] = fetchImpl.mock.calls[0] as [string, Init]
    expect(url).toBe(API)
    expect(init).toMatchObject({ method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' })
    expect(init.body).toBeUndefined()
    expect(init.headers).toEqual({ Accept: 'application/vnd.github+json' })
  })

  it('a newer release, with its page, its tag and its attachments (for the download of its blank app)', async () => {
    const digest = `sha256:${'ab'.repeat(32)}`
    const fetchImpl = answering(() =>
      json({
        tag_name: ' v1.1.0 ',
        html_url: `${REPO}/releases/tag/v1.1.0`,
        assets: [
          { name: 'AgroDesign-ProteinViewerPack-v1.1.0_full_20261201.html', size: 21_000_000, digest },
          { name: 'AgroDesign-ProteinViewerPack-v1.1.0_light_20261201.html', size: 1_200_000, digest: null },
        ],
      }),
    )
    expect(await checkLatestRelease(REPO, '1.0.0', new AbortController().signal, fetchImpl)).toEqual({
      kind: 'newer',
      latest: '1.1.0',
      url: `${REPO}/releases/tag/v1.1.0`,
      tag: 'v1.1.0',
      assets: [
        { name: 'AgroDesign-ProteinViewerPack-v1.1.0_full_20261201.html', size: 21_000_000, sha256: 'ab'.repeat(32) },
        { name: 'AgroDesign-ProteinViewerPack-v1.1.0_light_20261201.html', size: 1_200_000, sha256: null },
      ],
    })
  })

  it('reads attachments only as the API shapes them: a name, a whole size, a SHA-256 digest or none', () => {
    expect(releaseAssets(undefined)).toEqual([])
    expect(releaseAssets({ name: 'x' })).toEqual([])
    expect(
      releaseAssets([
        null,
        'x',
        { name: '', size: 1 },
        { name: 'a', size: -1 },
        { name: 'b', size: 1.5 },
        { name: 'c'.repeat(201), size: 1 },
        { name: 'ok', size: 3, digest: 'sha256:XYZ' },
        { name: 'md5', size: 3, digest: `md5:${'a'.repeat(32)}` },
      ]),
    ).toEqual([
      { name: 'ok', size: 3, sha256: null },
      { name: 'md5', size: 3, sha256: null },
    ])
    expect(releaseAssets(Array.from({ length: 80 }, (_, i) => ({ name: `f${i}`, size: i })))).toHaveLength(50)
  })

  it('404 is no public release (the repository is private or has none yet)', async () => {
    const fetchImpl = answering(() => new Response('{"message":"Not Found"}', { status: 404 }))
    expect(await checkLatestRelease(REPO, '1.0.0', new AbortController().signal, fetchImpl)).toEqual({ kind: 'not-found' })
  })

  it('tells the rate limit (429; 403 with none remaining, or its message) from another 403 or 5xx', async () => {
    const signal = new AbortController().signal
    expect(await checkLatestRelease(REPO, '1.0.0', signal, answering(() => new Response('', { status: 429 })))).toEqual({ kind: 'rate-limited' })
    expect(
      await checkLatestRelease(REPO, '1.0.0', signal, answering(() => new Response('{}', { status: 403, headers: { 'x-ratelimit-remaining': '0' } }))),
    ).toEqual({ kind: 'rate-limited' })
    expect(
      await checkLatestRelease(REPO, '1.0.0', signal, answering(() => new Response('{"message":"API rate limit exceeded for 1.2.3.4."}', { status: 403 }))),
    ).toEqual({ kind: 'rate-limited' })
    expect(
      await checkLatestRelease(REPO, '1.0.0', signal, answering(() => new Response('{"message":"Forbidden"}', { status: 403, headers: { 'x-ratelimit-remaining': '42' } }))),
    ).toEqual({ kind: 'http', status: 403 })
    expect(await checkLatestRelease(REPO, '1.0.0', signal, answering(() => new Response('', { status: 503 })))).toEqual({ kind: 'http', status: 503 })
  })

  it('an answer that is no release: not JSON, no tag', async () => {
    const signal = new AbortController().signal
    expect(await checkLatestRelease(REPO, '1.0.0', signal, answering(() => new Response('<html>', { status: 200 })))).toEqual({ kind: 'bad-answer' })
    expect(await checkLatestRelease(REPO, '1.0.0', signal, answering(() => json({ name: 'x' })))).toEqual({ kind: 'bad-answer' })
    expect(await checkLatestRelease(REPO, '1.0.0', signal, answering(() => json(null)))).toEqual({ kind: 'bad-answer' })
    expect(await checkLatestRelease(REPO, '1.0.0', signal, answering(() => json({ tag_name: 'nightly' })))).toEqual({ kind: 'unreadable-tag', tag: 'nightly' })
  })

  it('no connection (offline, the CSP) is not a timeout', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    expect(await checkLatestRelease(REPO, '1.0.0', new AbortController().signal, fetchImpl)).toEqual({ kind: 'network' })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it(`gives up after ${RELEASE_TIMEOUT_MS / 1000} s with no complete answer, and does not ask again`, async () => {
    vi.useFakeTimers()
    const fetchImpl = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        }),
    )
    const pending = checkLatestRelease(REPO, '1.0.0', new AbortController().signal, fetchImpl)
    await vi.advanceTimersByTimeAsync(RELEASE_TIMEOUT_MS - 1)
    expect((fetchImpl.mock.calls[0][1] as Init).signal.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await pending).toEqual({ kind: 'timeout' })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('a 403 whose body stops coming is the timeout, not an HTTP error (PT-9495 item 1)', async () => {
    vi.useFakeTimers()
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      // A 403 whose body never finishes, unless the request is stopped.
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          init.signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')))
        },
      })
      return new Response(body, { status: 403 })
    })
    const pending = checkLatestRelease(REPO, '1.0.0', new AbortController().signal, fetchImpl)
    await vi.advanceTimersByTimeAsync(RELEASE_TIMEOUT_MS)
    expect(await pending).toEqual({ kind: 'timeout' })
  })

  it('stops when its caller stops it (HELP closed)', async () => {
    const stop = new AbortController()
    const fetchImpl = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        }),
    )
    const pending = checkLatestRelease(REPO, '1.0.0', stop.signal, fetchImpl)
    stop.abort()
    expect(await pending).toEqual({ kind: 'network' })
    expect((fetchImpl.mock.calls[0][1] as Init).signal.aborted).toBe(true)
  })

  it('asks nothing when the repository URL is no GitHub repository page', async () => {
    const fetchImpl = answering(() => json({ tag_name: 'v1.0.0' }))
    expect(await checkLatestRelease('', '1.0.0', new AbortController().signal, fetchImpl)).toEqual({ kind: 'not-found' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
