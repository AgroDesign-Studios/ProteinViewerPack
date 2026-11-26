/**
 * The worker-WebGL probe (`workerGlAvailable`) against a scripted Worker, and
 * the crash mark (`pymolCrashMark.ts`). The real probe — a worker with no
 * WebGL in Playwright's WebKit, one with WebGL in headless Chrome — was run
 * against the built page (PR body, 2026-11-15).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetWorkerGlProbe, WORKER_GL_PROBE_MS, workerGlAvailable } from './noGl'
import { CRASH_MARK_FRESH_MS, CRASH_MARK_RELOAD_MS, markPymolStarting, takePymolCrashMark } from './pymolCrashMark'

const KEY = 'agdb-pvp-pymol-starting'

type Answer = { kind: 'message'; data: unknown } | { kind: 'error' } | { kind: 'silent' } | { kind: 'throw' }

let answer: Answer = { kind: 'silent' }
let made: { url: string; terminated: boolean }[] = []

class ScriptedWorker {
  onmessage: ((e: MessageEvent) => void) | null = null
  onerror: ((e: ErrorEvent) => void) | null = null
  private rec: { url: string; terminated: boolean }
  constructor(url: string) {
    if (answer.kind === 'throw') throw new Error('SecurityError')
    this.rec = { url, terminated: false }
    made.push(this.rec)
    const a = answer
    queueMicrotask(() => {
      if (a.kind === 'message') this.onmessage?.({ data: a.data } as MessageEvent)
      else if (a.kind === 'error') this.onerror?.({ message: 'x' } as ErrorEvent)
    })
  }
  terminate() {
    this.rec.terminated = true
  }
}

const blobs = new Map<string, Blob>()
let seq = 0

function blobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsText(blob)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  resetWorkerGlProbe()
  made = []
  answer = { kind: 'silent' }
  vi.stubGlobal('Worker', ScriptedWorker)
  URL.createObjectURL = vi.fn((b: Blob) => {
    const url = `blob:x/${++seq}`
    blobs.set(url, b)
    return url
  })
  URL.revokeObjectURL = vi.fn()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  window.sessionStorage.clear()
})

describe('workerGlAvailable', () => {
  it.each([
    [true, true],
    [false, false],
    ['nonsense', false],
  ] as const)('reads the worker’s answer %s as %s, then ends the worker and lets its URL go', async (data, want) => {
    answer = { kind: 'message', data }
    await expect(workerGlAvailable()).resolves.toBe(want)
    expect(made).toHaveLength(1)
    expect(made[0].terminated).toBe(true)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(made[0].url)
  })

  it('keeps a true for the page: a second call takes it (no second WebGL context, PT-9194 item 4)', async () => {
    answer = { kind: 'message', data: true }
    await workerGlAvailable()
    answer = { kind: 'message', data: false }
    await expect(workerGlAvailable()).resolves.toBe(true)
    expect(made).toHaveLength(1)
  })

  it.each([
    ['false', { kind: 'message', data: false }],
    ['null', { kind: 'error' }],
  ] as const)('asks again after a %s: a passing failure does not keep PyMOL from the page (PT-9307 item 2)', async (_what, first) => {
    answer = first
    await workerGlAvailable()
    answer = { kind: 'message', data: true }
    await expect(workerGlAvailable()).resolves.toBe(true)
    expect(made).toHaveLength(2)
  })

  it('calls while a probe runs share it: one worker', async () => {
    answer = { kind: 'message', data: false }
    const [a, b] = await Promise.all([workerGlAvailable(), workerGlAvailable()])
    expect([a, b]).toEqual([false, false])
    expect(made).toHaveLength(1)
  })

  it.each([
    ['the worker errs', { kind: 'error' }],
    ['no Worker can be made', { kind: 'throw' }],
  ] as const)('cannot tell (null) when %s', async (_why, a) => {
    answer = a
    await expect(workerGlAvailable()).resolves.toBeNull()
  })

  it('cannot tell (null) when the worker never answers', async () => {
    answer = { kind: 'silent' }
    const p = workerGlAvailable()
    await vi.advanceTimersByTimeAsync(WORKER_GL_PROBE_MS)
    await expect(p).resolves.toBeNull()
    expect(made[0].terminated).toBe(true)
  })

  it('asks for WebGL2, else WebGL 1, on an OffscreenCanvas, as worker.js does', async () => {
    answer = { kind: 'message', data: true }
    await workerGlAvailable()
    vi.useRealTimers()
    const src = await blobText(blobs.get(made[0].url)!)
    expect(src).toContain('new OffscreenCanvas(1, 1)')
    expect(src).toMatch(/getContext\("webgl2"\) \|\| c\.getContext\("webgl"\)/)
  })
})

describe('the crash mark', () => {
  it('is taken once: set while PyMOL starts, read and cleared by the next page', () => {
    expect(takePymolCrashMark()).toBe(false)
    markPymolStarting(true)
    expect(takePymolCrashMark()).toBe(true)
    expect(takePymolCrashMark()).toBe(false)
  })

  it('cleared, it is not there', () => {
    markPymolStarting(true)
    markPymolStarting(false)
    expect(takePymolCrashMark()).toBe(false)
  })

  it('is told only fresh: a mark not renewed for longer than the window is an old one (PT-9309 item 4)', () => {
    markPymolStarting(true, 1_000_000)
    expect(takePymolCrashMark(1_000_000 + CRASH_MARK_FRESH_MS)).toBe(true)
    markPymolStarting(true, 1_000_000)
    expect(takePymolCrashMark(1_000_000 + CRASH_MARK_FRESH_MS + 1)).toBe(false)
    // Taken either way.
    expect(window.sessionStorage.getItem(KEY)).toBeNull()
  })

  it('a reload is told an older mark: Chrome waits on its crash page for the user’s Reload (PT-9376)', () => {
    const arrived = (type: string) =>
      vi.spyOn(performance, 'getEntriesByType').mockReturnValue([{ type } as unknown as PerformanceEntry])
    arrived('reload')
    const later = 1_000_000 + 10 * 60_000
    markPymolStarting(true, 1_000_000)
    expect(takePymolCrashMark(later)).toBe(true)
    markPymolStarting(true, 1_000_000)
    expect(takePymolCrashMark(1_000_000 + CRASH_MARK_RELOAD_MS)).toBe(true)
    markPymolStarting(true, 1_000_000)
    expect(takePymolCrashMark(1_000_000 + CRASH_MARK_RELOAD_MS + 1)).toBe(false)
    // A page that opens otherwise keeps the short window.
    arrived('navigate')
    markPymolStarting(true, 1_000_000)
    expect(takePymolCrashMark(later)).toBe(false)
    markPymolStarting(true, 1_000_000)
    expect(takePymolCrashMark(1_000_000 + CRASH_MARK_FRESH_MS)).toBe(true)
    // A reload of a tab the browser discarded is still not told, however young the mark.
    arrived('reload')
    Object.defineProperty(document, 'wasDiscarded', { configurable: true, value: true })
    try {
      markPymolStarting(true, 1_000_000)
      expect(takePymolCrashMark(1_000_000 + 1)).toBe(false)
    } finally {
      delete (document as Document & { wasDiscarded?: boolean }).wasDiscarded
    }
  })

  it('is told only to the page that set it: another file opened next in the tab does not take it (PT-9309 item 1)', () => {
    window.sessionStorage.setItem(KEY, JSON.stringify({ at: Date.now(), page: 'file:///C:/other.html' }))
    expect(takePymolCrashMark()).toBe(false)
  })

  it('an older page’s mark, or one that is not ours, is no crash', () => {
    window.sessionStorage.setItem(KEY, '1')
    expect(takePymolCrashMark()).toBe(false)
    window.sessionStorage.setItem(KEY, '{"page":1')
    expect(takePymolCrashMark()).toBe(false)
  })

  it('a page brought back from history (a duplicated tab, a restored session) is not told (PT-9308 item 2)', () => {
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([{ type: 'back_forward' } as unknown as PerformanceEntry])
    markPymolStarting(true)
    expect(takePymolCrashMark()).toBe(false)
    vi.mocked(performance.getEntriesByType).mockReturnValue([{ type: 'reload' } as unknown as PerformanceEntry])
    markPymolStarting(true)
    expect(takePymolCrashMark()).toBe(true)
  })

  it('a tab the browser discarded and reloads is not told', () => {
    Object.defineProperty(document, 'wasDiscarded', { configurable: true, value: true })
    try {
      markPymolStarting(true)
      expect(takePymolCrashMark()).toBe(false)
    } finally {
      delete (document as Document & { wasDiscarded?: boolean }).wasDiscarded
    }
  })

  it('a browser with no storage (an opaque origin) has no mark, and nothing throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError')
    })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError')
    })
    expect(() => markPymolStarting(true)).not.toThrow()
    expect(takePymolCrashMark()).toBe(false)
  })
})
