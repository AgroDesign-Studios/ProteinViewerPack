import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { inflateRawSync } from 'node:zlib'
import { describe, expect, it, vi } from 'vitest'

import { PYMOL_RUNTIME_VERSION } from './pymolRuntimeManifest'
import {
  buildCursor,
  FRAME_CURSORS,
  FRAME_LOCAL_TYPES,
  allowedFields,
  arrayBufferByteLength,
  buildCommand,
  buildExportLook,
  buildExportMol,
  buildExportPng,
  buildLoad,
  buildRestoreSnapshot,
  buildSetView,
  EXPECTED_ALLOW_COUNT,
  EXPECTED_ALLOW_LIST,
  EXPORT_TOO_LARGE_REASONS,
  ExportGate,
  FRAME_MESSAGE_TYPES,
  isSelectionExpression,
  LIMITS,
  LOAD_FORMATS,
  MessageBudget,
  MOL_FORMATS,
  MiB,
  PARENT_MESSAGE_TYPES,
  refusedBytes,
  pymolObjectName,
  rawNonce,
  RATE_PER_SECOND,
  readyRefusal,
  validateFrameMessage,
  type ReadyInfo,
} from './pymolFrameProtocol'

/**
 * The parent's validation of everything the PyMOL frame sends (ADR-0049
 * § 分離構成 4, TN0110 §7-30/31/32). The frame is untrusted, so each case
 * here is a shape a compromised worker could post.
 */

const DIR = join(process.cwd(), 'public', 'vendor', 'pymol', PYMOL_RUNTIME_VERSION)

const READY = {
  type: 'ready', webgl: 2, maxThreads: '1', allowCount: 18, allowList: EXPECTED_ALLOW_LIST.join('\n'), restricted: true,
  heapMB: 212.5, w: 1600, h: 900, workerMs: 4200,
}

const reasonOf = (data: unknown): string => {
  const r = validateFrameMessage(data)
  return r.ok ? 'ok' : r.reason
}

describe('message types', () => {
  it('accepts exactly the types host.js relays, and knows every one of them', () => {
    // Parsed from host.js's own OUT set, so adding a type there without a
    // validator here (or the reverse) fails.
    const host = readFileSync(join(DIR, 'host.js'), 'utf8')
    const out = /const OUT = new Set\(\[([^\]]*)\]\)/.exec(host)?.[1] ?? ''
    const relayed = [...out.matchAll(/'([^']+)'/g)].map(m => m[1]).sort()
    expect(relayed).toEqual([...FRAME_MESSAGE_TYPES].sort())
    expect(relayed).toContain('heartbeat')
  })

  it("sends only the types host.js forwards to the worker", () => {
    const host = readFileSync(join(DIR, 'host.js'), 'utf8')
    const inbound = /const IN = new Set\(\[([^\]]*)\]\)/.exec(host)?.[1] ?? ''
    expect([...inbound.matchAll(/'([^']+)'/g)].map(m => m[1]).sort()).toEqual([...PARENT_MESSAGE_TYPES].sort())
  })

  it('loads only the formats worker.js maps, and never a pickle format', () => {
    const worker = readFileSync(join(DIR, 'worker.js'), 'utf8')
    const formats = /const FORMATS = \{([^}]*)\}/.exec(worker)?.[1] ?? ''
    const keys = [...formats.matchAll(/(\w+):/g)].map(m => m[1]).sort()
    expect(keys).toEqual([...LOAD_FORMATS].sort())
    // mae: incentive-only in this open-source build, so a load always fails (PT-3601).
    for (const banned of ['pkl', 'model', 'pickle', 'brick', 'cc1', 'pml', 'py', 'mae']) {
      expect(LOAD_FORMATS as readonly string[]).not.toContain(banned)
    }
  })

  it.each(['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf', 'isPrototypeOf', 'port-handshake', 'init', ''])(
    'drops type %j',
    type => {
      expect(reasonOf({ type, s: 'x' })).toBe('unknown-type')
    },
  )

  it('drops a message whose own `__proto__` key came through JSON', () => {
    // JSON.parse makes `__proto__` an OWN property, which a spread or an `in`
    // check would treat as the prototype.
    const data: unknown = JSON.parse('{"type":"log","s":"x","__proto__":{"fatal":true}}')
    expect(reasonOf(data)).toBe('unexpected-field:__proto__')
  })

  it('drops non-objects, arrays, class instances, and a type that is not a string', () => {
    for (const v of [null, undefined, 1, 'ready', true, [READY], new Date(), new Map([['type', 'ready']])]) {
      expect(validateFrameMessage(v).ok, String(v)).toBe(false)
    }
    expect(reasonOf({ type: 1 })).toBe('no-type')
    expect(reasonOf({ type: new String('log'), s: 'x' })).toBe('no-type')
    class Fake { type = 'log'; s = 'x' }
    expect(reasonOf(new Fake())).toBe('not-a-plain-object')
  })

  it('drops an unknown field, a symbol key and too many fields', () => {
    expect(reasonOf({ type: 'log', s: 'x', extra: 1 })).toBe('unexpected-field:extra')
    expect(reasonOf({ type: 'log', s: 'x', [Symbol('s')]: 1 })).toBe('symbol-key')
    const many: Record<string, unknown> = { type: 'log', s: 'x' }
    for (let i = 0; i < LIMITS.messageKeys; i++) many[`k${i}`] = i
    expect(reasonOf(many)).toBe('too-many-fields')
  })

  it('takes `snapshot-skipped` with a byte count only (PT-8314 item 1)', () => {
    const r = validateFrameMessage({ type: 'snapshot-skipped', bytes: 200 * 1024 * 1024 })
    expect(r.ok && r.msg).toEqual({ type: 'snapshot-skipped', bytes: 200 * 1024 * 1024 })
    expect(validateFrameMessage({ type: 'snapshot-skipped', bytes: -1 }).ok).toBe(false)
    expect(validateFrameMessage({ type: 'snapshot-skipped', bytes: '9' }).ok).toBe(false)
    expect(validateFrameMessage({ type: 'snapshot-skipped', bytes: 1, extra: 1 }).ok).toBe(false)
  })

  it('returns a fresh object holding only checked values', () => {
    const data = { type: 'log', s: 'hello' }
    const r = validateFrameMessage(data)
    expect(r.ok && r.msg).toEqual({ type: 'log', s: 'hello' })
    expect(r.ok && r.msg).not.toBe(data)
  })
})

describe('getters never run', () => {
  it('drops a fake ArrayBuffer built on ArrayBuffer.prototype without calling its getter', () => {
    let calls = 0
    const fake = Object.create(ArrayBuffer.prototype, {
      byteLength: { get: () => { calls += 1; return 10 } },
    })
    expect(fake instanceof ArrayBuffer).toBe(true) // what `instanceof` alone would have believed
    expect(arrayBufferByteLength(fake)).toBeNull()
    expect(reasonOf({ type: 'snapshot', bytes: fake })).toBe('snapshot.bytes')
    expect(reasonOf({ type: 'png', nonce: 'n', bytes: fake, w: 1, h: 1 })).toBe('png.bytes')
    expect(calls).toBe(0)
  })

  it('names a reply over its cap apart from one of the wrong shape (PT-3298 item 12)', () => {
    expect(reasonOf({ type: 'pse', nonce: 'n', bytes: new ArrayBuffer(LIMITS.pseBytes + 1) })).toBe('pse.too-large')
    expect(reasonOf({ type: 'png', nonce: 'n', bytes: new ArrayBuffer(LIMITS.pngBytes + 1), w: 1, h: 1 })).toBe('png.too-large')
    expect(reasonOf({ type: 'mol', nonce: 'n', bytes: new ArrayBuffer(LIMITS.molBytes + 1) })).toBe('mol.too-large')
    expect(reasonOf({ type: 'look', nonce: 'n', bytes: new ArrayBuffer(LIMITS.lookBytes + 1) })).toBe('look.too-large')
    for (const reason of ['pse.too-large', 'png.too-large', 'mol.too-large', 'look.too-large']) expect(EXPORT_TOO_LARGE_REASONS.has(reason)).toBe(true)
    for (const type of ['pse', 'mol', 'look']) {
      for (const bytes of ['x', new ArrayBuffer(0), new Uint8Array(4)]) {
        const reason = reasonOf({ type, nonce: 'n', bytes })
        expect(reason).toBe(`${type}.bytes`)
        expect(EXPORT_TOO_LARGE_REASONS.has(reason)).toBe(false)
      }
    }
  })

  it('drops a message whose field is an accessor, without calling it', () => {
    let calls = 0
    const data = { type: 'snapshot' }
    Object.defineProperty(data, 'bytes', { enumerable: true, get: () => { calls += 1; return new ArrayBuffer(4) } })
    expect(reasonOf(data)).toBe('accessor-field:bytes')
    const typed = {}
    Object.defineProperty(typed, 'type', { enumerable: true, get: () => { calls += 1; return 'log' } })
    expect(reasonOf(typed)).toBe('no-type')
    expect(calls).toBe(0)
  })

  it('drops an array element that is an accessor, without calling it', () => {
    let calls = 0
    const v = Array.from({ length: 18 }, () => 0)
    Object.defineProperty(v, 3, { get: () => { calls += 1; return 0 } })
    expect(reasonOf({ type: 'view18', v })).toBe('view18.v')
    expect(calls).toBe(0)
  })

  it('drops a view, a detached buffer and a SharedArrayBuffer-like as bytes', () => {
    expect(reasonOf({ type: 'snapshot', bytes: new Uint8Array(4) })).toBe('snapshot.bytes')
    const detached = new ArrayBuffer(4)
    structuredClone(detached, { transfer: [detached] })
    expect(detached.byteLength).toBe(0)
    expect(reasonOf({ type: 'snapshot', bytes: detached })).toBe('snapshot.bytes')
    expect(reasonOf({ type: 'snapshot', bytes: { byteLength: 4 } })).toBe('snapshot.bytes')
  })
})

describe('caps: exactly at the limit passes, one over fails', () => {
  it.each([
    ['png', LIMITS.pngBytes, (b: ArrayBuffer) => ({ type: 'png', nonce: 'n1', bytes: b, w: 10, h: 10 })],
    ['pse', LIMITS.pseBytes, (b: ArrayBuffer) => ({ type: 'pse', nonce: 'n1', bytes: b })],
    ['mol', LIMITS.molBytes, (b: ArrayBuffer) => ({ type: 'mol', nonce: 'n1', bytes: b })],
    ['look', LIMITS.lookBytes, (b: ArrayBuffer) => ({ type: 'look', nonce: 'n1', bytes: b })],
    ['snapshot', LIMITS.snapshotBytes, (b: ArrayBuffer) => ({ type: 'snapshot', bytes: b })],
  ])('%s', (_type, cap, make) => {
    expect(reasonOf(make(new ArrayBuffer(cap)))).toBe('ok')
    expect(reasonOf(make(new ArrayBuffer(cap + 1)))).not.toBe('ok')
  })

  it('pins the caps to the ADR (png 16, pse 25, load 32, mol 32, snapshot 128 MiB) and the look at 64 MiB (protocol 4)', () => {
    expect([LIMITS.pngBytes, LIMITS.pseBytes, LIMITS.loadBytes, LIMITS.molBytes, LIMITS.snapshotBytes]).toEqual([16 * MiB, 25 * MiB, 32 * MiB, 32 * MiB, 128 * MiB])
    expect(LIMITS.lookBytes).toBe(64 * MiB)
    // worker.js refuses a larger look before reading it, with the text the page reads as too large.
    const worker = readFileSync(join(DIR, 'worker.js'), 'utf8')
    expect(/const LOOK_MAX = (\d+) \* MiB;/.exec(worker)?.[1]).toBe(String(LIMITS.lookBytes / MiB))
  })

  it('refuses an empty buffer', () => {
    expect(reasonOf({ type: 'snapshot', bytes: new ArrayBuffer(0) })).toBe('snapshot.bytes')
  })

  it('cuts error and log text to the kept length, and refuses it past the hard cap', () => {
    for (const type of ['error', 'log']) {
      const exact = validateFrameMessage({ type, s: 'x'.repeat(LIMITS.textChars) })
      expect(exact.ok && 's' in exact.msg && exact.msg.s).toHaveLength(LIMITS.textChars)
      // One over is kept, cut: an error that answers a request must not be
      // lost, or the request would hang to its deadline.
      const over = validateFrameMessage({ type, s: 'y'.repeat(LIMITS.textChars + 1) })
      expect(over.ok).toBe(true)
      const s = over.ok && 's' in over.msg ? over.msg.s : ''
      expect(s).toHaveLength(LIMITS.textChars)
      expect(s.endsWith('…')).toBe(true)
      expect(reasonOf({ type, s: 'z'.repeat(LIMITS.textHardChars) })).toBe('ok')
      expect(reasonOf({ type, s: 'z'.repeat(LIMITS.textHardChars + 1) })).toBe(`${type}.s`)
    }
  })

  it('keeps the first entries of a long pick list, and refuses one past the hard cap', () => {
    const atom = { model: 'm', index: 1 }
    const exact = validateFrameMessage({ type: 'pick', atoms: Array.from({ length: LIMITS.pickAtoms }, () => atom) })
    expect(exact.ok && exact.msg.type === 'pick' && [exact.msg.atoms.length, exact.msg.truncated]).toEqual([LIMITS.pickAtoms, false])
    const over = validateFrameMessage({ type: 'pick', atoms: Array.from({ length: LIMITS.pickAtoms + 1 }, () => atom) })
    expect(over.ok && over.msg.type === 'pick' && [over.msg.atoms.length, over.msg.truncated]).toEqual([LIMITS.pickAtoms, true])
    expect(reasonOf({ type: 'pick', atoms: Array.from({ length: LIMITS.pickHardAtoms }, () => atom) })).toBe('ok')
    expect(reasonOf({ type: 'pick', atoms: Array.from({ length: LIMITS.pickHardAtoms + 1 }, () => atom) })).toBe('pick.atoms')
    expect(reasonOf({ type: 'pick', atoms: [{ model: 'm'.repeat(LIMITS.pickModelChars), index: 0 }] })).toBe('ok')
    expect(reasonOf({ type: 'pick', atoms: [{ model: 'm'.repeat(LIMITS.pickModelChars + 1), index: 0 }] })).toBe('pick.atom')
    // Every entry is checked, not only the ones kept: bulk riding past the
    // first `pickAtoms` entries refuses the message.
    const tail = (bad: unknown) => [...Array.from({ length: LIMITS.pickAtoms }, () => atom), bad]
    expect(reasonOf({ type: 'pick', atoms: tail({ model: 'm', index: 0, junk: 'x' }) })).toBe('pick.atom')
    expect(reasonOf({ type: 'pick', atoms: tail({ model: 'm'.repeat(LIMITS.pickModelChars + 1), index: 0 }) })).toBe('pick.atom')
    expect(reasonOf({ type: 'pick', atoms: tail('x'.repeat(1000)) })).toBe('pick.atom')
    expect(reasonOf({ type: 'pick', atoms: [{ model: 'm', index: -1 }] })).toBe('pick.atom')
    expect(reasonOf({ type: 'pick', atoms: [{ model: 'm', index: 1, x: 1 }] })).toBe('pick.atom')
  })

  it('caps the nonce and the exported PNG dimensions', () => {
    const b = new ArrayBuffer(1)
    expect(reasonOf({ type: 'pse', nonce: 'n'.repeat(LIMITS.nonceChars), bytes: b })).toBe('ok')
    expect(reasonOf({ type: 'pse', nonce: 'n'.repeat(LIMITS.nonceChars + 1), bytes: b })).toBe('pse.nonce')
    expect(reasonOf({ type: 'pse', nonce: '', bytes: b })).toBe('pse.nonce')
    expect(reasonOf({ type: 'pse', nonce: 7, bytes: b })).toBe('pse.nonce')
    expect(reasonOf({ type: 'png', nonce: 'n', bytes: b, w: LIMITS.pngSide, h: 1 })).toBe('ok')
    expect(reasonOf({ type: 'png', nonce: 'n', bytes: b, w: LIMITS.pngSide + 1, h: 1 })).toBe('png.dimensions')
    expect(reasonOf({ type: 'png', nonce: 'n', bytes: b, w: 0, h: 1 })).toBe('png.dimensions')
  })
})

describe('per-type shapes', () => {
  it('accepts every message worker.js and host.js actually post', () => {
    for (const m of [
      READY,
      { ...READY, heapMB: null, webgl: 1 },
      { type: 'log', s: 'csp:script-src-elem:data' },
      { type: 'progress', phase: 'boot' },
      { type: 'progress', phase: 'pyodide' },
      { type: 'progress', phase: 'packages' },
      { type: 'progress', phase: 'command' },
      { type: 'progress', phase: 'loaded', atoms: 1234, heapMB: 300.1 },
      { type: 'progress', phase: 'loaded', atoms: null },
      { type: 'progress', phase: 'restored', atoms: 1234 },
      { type: 'pick', atoms: [{ model: '1hsg', index: 17 }] },
      { type: 'view18', v: Array.from({ length: 18 }, (_, i) => i - 9.5) },
      { type: 'png', nonce: 'abc', bytes: new ArrayBuffer(8), w: 1600, h: 900 },
      { type: 'pse', nonce: 'abc', bytes: new ArrayBuffer(8) },
      { type: 'mol', nonce: 'abc', bytes: new ArrayBuffer(8) },
      { type: 'snapshot', bytes: new ArrayBuffer(8) },
      { type: 'error', s: 'not ready for load' },
      { type: 'error', s: 'worker error: x', fatal: true },
      { type: 'error', s: 'tick: x', fatal: false },
      { type: 'heartbeat', ticks: 120, draws: 3, heapMB: 250.4, inputMs: null },
      { type: 'heartbeat', ticks: 0, draws: 0, heapMB: null, inputMs: 0 },
      { type: 'heartbeat', ticks: 7, draws: 7, heapMB: 1, inputMs: 81234 },
      { type: 'taken', req: 1 },
      { type: 'taken', req: 0 },
    ]) {
      expect(reasonOf(m), JSON.stringify(m)).toBe('ok')
    }
  })

  it('reads Pyodide None (undefined) as null on the nullable fields', () => {
    const r = validateFrameMessage({ type: 'progress', phase: 'restored', atoms: undefined })
    expect(r.ok && r.msg).toEqual({ type: 'progress', phase: 'restored', atoms: null, heapMB: null })
    const e = validateFrameMessage({ type: 'error', s: 'x' })
    expect(e.ok && e.msg).toEqual({ type: 'error', s: 'x', fatal: false })
  })

  it('drops the malformed ones', () => {
    expect(reasonOf({ ...READY, webgl: 3 })).toBe('ready.webgl')
    expect(reasonOf({ ...READY, maxThreads: 1 })).toBe('ready.maxThreads')
    expect(reasonOf({ ...READY, allowCount: '18' })).toBe('ready.allowCount')
    expect(reasonOf({ ...READY, allowList: EXPECTED_ALLOW_LIST })).toBe('ready.allowList')
    expect(reasonOf({ ...READY, allowList: 'x'.repeat(4_097) })).toBe('ready.allowList')
    const { allowList: _omitted, ...noList } = READY
    expect(reasonOf(noList)).toBe('ready.allowList')
    expect(reasonOf({ ...READY, restricted: 'true' })).toBe('ready.restricted')
    expect(reasonOf({ ...READY, heapMB: -1 })).toBe('ready.heapMB')
    expect(reasonOf({ ...READY, w: 1.5 })).toBe('ready.dimensions')
    expect(reasonOf({ type: 'progress', phase: 'done' })).toBe('progress.phase')
    expect(reasonOf({ type: 'progress', phase: 'boot', atoms: 1 })).toBe('progress.extras')
    expect(reasonOf({ type: 'progress', phase: 'restored', atoms: 1, heapMB: 1 })).toBe('progress.extras')
    expect(reasonOf({ type: 'progress', phase: 'loaded', atoms: -1 })).toBe('progress.atoms')
    expect(reasonOf({ type: 'view18', v: Array.from({ length: 17 }, () => 0) })).toBe('view18.v')
    expect(reasonOf({ type: 'view18', v: Array.from({ length: 19 }, () => 0) })).toBe('view18.v')
    expect(reasonOf({ type: 'view18', v: [...Array.from({ length: 17 }, () => 0), Number.NaN] })).toBe('view18.v')
    expect(reasonOf({ type: 'view18', v: [...Array.from({ length: 17 }, () => 0), Infinity] })).toBe('view18.v')
    const holey = Array.from({ length: 18 }, () => 0)
    delete holey[5]
    expect(holey).toHaveLength(18)
    expect(reasonOf({ type: 'view18', v: holey })).toBe('view18.v')
    const named = Array.from({ length: 18 }, () => 0) as number[] & { extra?: number }
    named.extra = 1
    expect(reasonOf({ type: 'view18', v: named })).toBe('view18.v')
    expect(reasonOf({ type: 'error', s: 'x', fatal: 1 })).toBe('error.fatal')
    expect(reasonOf({ type: 'heartbeat', ticks: -1, draws: 0 })).toBe('heartbeat.counters')
    expect(reasonOf({ type: 'heartbeat', ticks: 1.5, draws: 0 })).toBe('heartbeat.counters')
    expect(reasonOf({ type: 'heartbeat', ticks: 1, draws: 0, inputMs: -5 })).toBe('heartbeat.inputMs')
    expect(reasonOf({ type: 'heartbeat', ticks: 1, draws: 0, inputMs: '5' })).toBe('heartbeat.inputMs')
    for (const req of [-1, 1.5, '3', null, undefined, Number.MAX_SAFE_INTEGER + 1]) {
      expect(reasonOf({ type: 'taken', req }), String(req)).toBe('taken.req')
    }
  })

  it("allows exactly the fields worker.js posts for ready and heartbeat", () => {
    // Read from worker.js itself: a field renamed or added there without the
    // validator would drop every heartbeat (and the watchdog would rebuild an
    // idle viewer) or every ready (and every boot would time out).
    const worker = readFileSync(join(DIR, 'worker.js'), 'utf8')
    const literalKeys = (anchor: RegExp): string[] => {
      const m = anchor.exec(worker)
      if (!m) throw new Error(`worker.js: ${anchor} not found`)
      // The object literal starts at the `{` before `type:` and ends at its
      // matching `}`.
      let depth = 0, i = m.index, start = -1
      for (; i < worker.length; i++) {
        if (worker[i] === '{') { if (depth === 0) start = i; depth++ }
        else if (worker[i] === '}') { depth--; if (depth === 0) break }
      }
      const body = worker.slice(start + 1, i)
      // Top-level keys only: strip nested parentheses (calls) first.
      let flat = body
      for (let k = 0; k < 5; k++) flat = flat.replace(/\([^()]*\)/g, '()')
      // `key: value` and the shorthand `key` alike.
      return [...flat.matchAll(/(?:^|,)\s*([A-Za-z_]\w*)\s*(?=:|,|$)/g)].map(x => x[1]).sort()
    }
    expect(literalKeys(/postMessage\(\{ type: 'heartbeat'/)).toEqual(allowedFields('heartbeat'))
    expect(literalKeys(/postMessage\(\{ type: 'ready'/)).toEqual(allowedFields('ready'))
    expect(literalKeys(/postMessage\(\{ type: 'mol'/)).toEqual(allowedFields('mol'))
    expect(literalKeys(/postMessage\(\{ type: 'look'/)).toEqual(allowedFields('look'))
    expect(literalKeys(/postMessage\(\{ type: 'taken'/)).toEqual(allowedFields('taken'))
  })

  it('has worker.js write the molecule formats and take the selection length the page sends', () => {
    const worker = readFileSync(join(DIR, 'worker.js'), 'utf8')
    const formats = /const MOL_FORMATS = new Set\(\[([^\]]*)\]\)/.exec(worker)?.[1] ?? ''
    expect([...formats.matchAll(/'([^']+)'/g)].map(m => m[1]).sort()).toEqual([...MOL_FORMATS].sort())
    expect(/const SELECTION_MAX = (\d+);/.exec(worker)?.[1]).toBe(String(LIMITS.selectionChars))
    // The selection reaches Python only as a JSON string literal.
    expect(worker).toContain("'_agdb_export_mol(' + JSON.stringify(sel) + ', ' + JSON.stringify(fmt) + ', ' + JSON.stringify(path) + ')'")
  })

  it('has worker.js send a pick of at most one entry more than the parent keeps (the validator’s hard cap)', () => {
    // An honest `select pk1, all` on a large structure would otherwise post a
    // list the parent refuses, or cannot weigh, on a single click.
    const worker = readFileSync(join(DIR, 'worker.js'), 'utf8')
    const max = /const PICK_SEND_MAX = (\d+);/.exec(worker)
    expect(max, 'PICK_SEND_MAX').not.toBeNull()
    expect(Number((max as RegExpExecArray)[1])).toBe(LIMITS.pickAtoms + 1)
    expect(LIMITS.pickHardAtoms).toBe(LIMITS.pickAtoms + 1)
    // A larger pk1 is not listed at all (PT-3271 item 16).
    expect(worker).toContain('if (n > 0 && n <= PICK_SEND_MAX) {')
  })

  it('has worker.js actually send the heartbeat: from the tick, and on each click or key, within the parent’s rate', () => {
    // A heartbeat literal that nothing calls would pass the test above; the
    // watchdog would then rebuild every idle viewer, or a menu's long work.
    const worker = readFileSync(join(DIR, 'worker.js'), 'utf8')
    for (const kind of ['button', 'key']) {
      const line = worker.split('\n').find(l => l.includes(`if (m.type === '${kind}') {`))
      expect(line, kind).toMatch(/inputQ\.push\(.*\); noteInput\(\); return; \}/)
    }
    expect(worker).toMatch(/function noteInput\(\) \{[^}]*if \(loopStarted && !FATAL && tickOk && t - lastInputBeat >= INPUT_BEAT_MS\) \{ lastInputBeat = t; postHeartbeat\(t\); \}/)
    // In tick(): after the try/finally (so a throw cannot skip it), only when
    // that tick ran to the end (PT-3271 item 12),
    // never once FATAL, and before the next tick is scheduled.
    const tail = /\} finally \{ tickBusy = false; \}([\s\S]*?)\n  schedule\(\);\n\}/.exec(worker)
    expect(tail, 'the end of tick()').not.toBeNull()
    const body = (tail as RegExpExecArray)[1]
    expect(body.indexOf('if (FATAL) return;')).toBeGreaterThan(-1)
    expect(body.indexOf('if (FATAL) return;')).toBeLessThan(body.indexOf('postHeartbeat(t)'))
    expect(body).toMatch(/if \(tickOk && t - live\.lastPost >= HEARTBEAT_MS\) postHeartbeat\(t\);/)
    // Worst case in any one-second window of the parent's budget: the input
    // beats plus the tick's, each with one at the window's edge.
    const consts = /const HEARTBEAT_MS = (\d+), INPUT_BEAT_MS = (\d+);/.exec(worker)
    expect(consts).not.toBeNull()
    const [, beatMs, inputMs] = (consts as RegExpExecArray).map(Number)
    expect(Math.ceil(1000 / inputMs) + 1 + Math.ceil(1000 / beatMs) + 1).toBeLessThanOrEqual(RATE_PER_SECOND.heartbeat)
  })
})

describe('refused messages', () => {
  it('still give up the nonce they carried, and are weighed by every top-level field — without running a getter', () => {
    expect(rawNonce({ type: 'pse', nonce: 'abc', bytes: new ArrayBuffer(LIMITS.pseBytes + 1) })).toBe('abc')
    expect(rawNonce({ type: 'pse', nonce: 7 })).toBeNull()
    expect(rawNonce({ type: 'pse', nonce: 'n'.repeat(LIMITS.nonceChars + 1) })).toBeNull()
    let calls = 0
    const sneaky = { type: 'pse' }
    Object.defineProperty(sneaky, 'nonce', { get: () => { calls += 1; return 'abc' } })
    Object.defineProperty(sneaky, 'bytes', { get: () => { calls += 1; return new ArrayBuffer(9) } })
    expect(rawNonce(sneaky)).toBeNull()
    // Structured clone makes no accessor and nothing non-enumerable; such a
    // property is not read, so only `type` is weighed — its name and its value.
    expect(refusedBytes(sneaky)).toBe(8 + 6)
    expect(calls).toBe(0)
    // An enumerable accessor is not something a clone makes either: refused, never run.
    let runs = 0
    expect(refusedBytes({ type: 'pse', get nonce() { runs += 1; return 'a' } })).toBeNull()
    expect(runs).toBe(0)
    // Two bytes a character of every field's NAME, then its value.
    expect(refusedBytes({ type: 'snapshot', bytes: new ArrayBuffer(1000) })).toBe(8 + 16 + 10 + 1000)
    expect(refusedBytes({ type: 'log', s: 'abcd' })).toBe(8 + 6 + 2 + 8)
    // Every field counts, not only `bytes` and `s`: bulk in an over-long nonce…
    expect(refusedBytes({ type: 'png', nonce: 'x'.repeat(200), bytes: new ArrayBuffer(10), w: 1, h: 1 }))
      .toBe(8 + 6 + 10 + 400 + 10 + 10 + 2 + 8 + 2 + 8)
    // …or in a field's name.
    const key = 'k'.repeat(1_000_000)
    expect(refusedBytes({ type: 'log', s: '', [key]: 0 })).toBe(8 + 6 + 2 + 0 + key.length * 2 + 8)
    // The one honest refusal with a list in it: a view with a non-finite number.
    const view = [Number.NaN, ...Array.from({ length: 17 }, () => 1)]
    expect(reasonOf({ type: 'view18', v: view })).toBe('view18.v')
    expect(refusedBytes({ type: 'view18', v: view })).toBe(8 + 12 + 2 + 8 + 18 * 8)
  })

  it('cannot be weighed — null — when they carry anything else, and are never walked to find out', () => {
    // Weighing such a value means walking it, and the walk is the cost a
    // hostile frame wants the parent to pay (#3257 rounds 1-4); no honest
    // worker message has one, so the controller stops the page instead.
    const names = vi.spyOn(Object, 'getOwnPropertyNames')
    try {
      const junk = new Array(100_000).fill(0)
      expect(refusedBytes({ type: 'log', s: '', junk })).toBeNull()
      expect(names.mock.calls.some(([v]) => v === junk)).toBe(false)
    } finally {
      names.mockRestore()
    }
    expect(refusedBytes({ type: 'log', s: { x: 'y'.repeat(1000) } })).toBeNull()
    expect(refusedBytes({ type: 'png', bytes: new Uint8Array(new ArrayBuffer(1000), 0, 1) })).toBeNull()
    expect(refusedBytes({ type: 'log', odd: new Map() })).toBeNull()
    expect(refusedBytes(Object.assign(['x'], { type: 'log' }))).toBeNull()
    expect(refusedBytes({ type: 'pick', atoms: Array.from({ length: LIMITS.pickHardAtoms + 1 }, () => ({ model: 'm', index: 0 })) })).toBeNull()
    const many: Record<string, unknown> = { type: 'log' }
    for (let i = 0; i < LIMITS.messageKeys; i++) many[`k${i}`] = 0
    expect(refusedBytes(many)).toBeNull()
    expect(refusedBytes(null)).toBeNull()
    expect(refusedBytes('log')).toBeNull()
  })

  it('weigh a pick refused for an over-long model name by its entries, as validation reads them (PT-3271 item 17)', () => {
    const long = { model: 'm'.repeat(LIMITS.pickModelChars + 1), index: 3 }
    expect(reasonOf({ type: 'pick', atoms: [long] })).toBe('pick.atom')
    const names = ('model'.length + 'index'.length) * 2
    // `type` and `atoms`, then the list: eight, and each entry's names, model and index.
    expect(refusedBytes({ type: 'pick', atoms: [long, { model: 'ab', index: 1 }] }))
      .toBe(8 + 8 + 10 + 8 + (names + 2 * (LIMITS.pickModelChars + 1) + 8) + (names + 4 + 8))
    // An entry of any other shape still cannot be weighed.
    expect(refusedBytes({ type: 'pick', atoms: [{ model: 'ab', index: 1, x: 0 }] })).toBeNull()
    expect(refusedBytes({ type: 'pick', atoms: [{ model: { x: 1 }, index: 1 }] })).toBeNull()
    expect(refusedBytes({ type: 'log', s: '', list: Array.from({ length: 19 }, () => 1) })).toBeNull()
    // Only as a pick's `atoms`: anywhere else such a list is walked for nothing
    // — a clone keeps shared references, so one list under 16 keys costs the
    // frame one list and the page sixteen walks.
    const entries = Array.from({ length: 19 }, () => ({ model: 'm', index: 0 }))
    expect(refusedBytes({ type: 'log', s: '', a: entries })).toBeNull()
    expect(refusedBytes({ type: 'pick', atoms: [long], b: entries })).toBeNull()
  })

  it('weigh a pick whose `atoms` is no list of entries as any other field (PT-4165 item 1)', () => {
    // `type` and `atoms` (8 + 10), then the value as `topLevelBytes` weighs it.
    expect(reasonOf({ type: 'pick', atoms: null })).toBe('pick.atoms')
    expect(refusedBytes({ type: 'pick', atoms: null })).toBe(8 + 8 + 10 + 8)
    expect(refusedBytes({ type: 'pick', atoms: 'xy' })).toBe(8 + 8 + 10 + 4)
    expect(refusedBytes({ type: 'pick', atoms: 7 })).toBe(8 + 8 + 10 + 8)
    expect(refusedBytes({ type: 'pick', atoms: [1, 2] })).toBe(8 + 8 + 10 + 8 + 16)
    expect(refusedBytes({ type: 'pick', atoms: [] })).toBe(8 + 8 + 10 + 8)
  })
})

describe('resizable buffers (PT-3271 item 19)', () => {
  const resizable = (n: number, max: number): ArrayBuffer =>
    new (ArrayBuffer as unknown as new (n: number, o: { maxByteLength: number }) => ArrayBuffer)(n, { maxByteLength: max })

  it('are no buffer here: a message carrying one is refused, and cannot be weighed by its length', () => {
    // Weighed by its length, this would be 8 bytes; the clone reserves what it may grow to.
    const b = resizable(8, 2 ** 30)
    expect(arrayBufferByteLength(b)).toBeNull()
    expect(reasonOf({ type: 'snapshot', bytes: b })).toBe('snapshot.bytes')
    expect(reasonOf({ type: 'png', nonce: 'n', bytes: b, w: 1, h: 1 })).toBe('png.bytes')
    expect(refusedBytes({ type: 'snapshot', bytes: b })).toBeNull()
    // A fixed-length one is read as before.
    expect(arrayBufferByteLength(new ArrayBuffer(8))).toBe(8)
  })
})

describe('accepted messages', () => {
  const ok = (data: unknown) => {
    const r = validateFrameMessage(data)
    if (!r.ok) throw new Error(`refused: ${r.reason}`)
    return r
  }

  it('are weighed from what validation read: text as it arrived, a buffer by its length, eight for anything else', () => {
    // `type` is two bytes a character too.
    const long = 'x'.repeat(LIMITS.textChars + 1000)
    const log = ok({ type: 'log', s: long })
    expect(log.msg.type === 'log' && log.msg.s.length).toBe(LIMITS.textChars)
    expect(log.bytes).toBe(6 + long.length * 2)
    expect(ok({ type: 'snapshot', bytes: new ArrayBuffer(1000) }).bytes).toBe(16 + 1000)
    expect(ok({ type: 'heartbeat', ticks: 1, draws: 2, heapMB: 3 }).bytes).toBe(18 + 3 * 8)
    expect(ok({ type: 'view18', v: Array.from({ length: 18 }, () => 1) }).bytes).toBe(12 + 8 + 18 * 8)
  })

  it('weigh a pick by its checked entries, the one past what is kept included', () => {
    const atom = { model: 'ab', index: 1 }
    // Each entry's field names too: `model` and `index`, two bytes a character (PT-3274 item 10).
    const names = ('model'.length + 'index'.length) * 2
    expect(ok({ type: 'pick', atoms: [atom, atom, atom] }).bytes).toBe(8 + 8 + 3 * (names + 4 + 8))
    const full = Array.from({ length: LIMITS.pickHardAtoms }, () => ({ model: 'm'.repeat(LIMITS.pickModelChars), index: 0 }))
    const r = ok({ type: 'pick', atoms: full })
    expect(r.msg.type === 'pick' && r.msg.truncated).toBe(true)
    expect(r.bytes).toBe(8 + 8 + LIMITS.pickHardAtoms * (names + 2 * LIMITS.pickModelChars + 8))
  })
})

describe('the key count', () => {
  it('refuses an object with too many keys before listing them with getOwnPropertyNames', () => {
    // A cloned object with a million integer keys costs ~3-5x its clone to
    // list with getOwnPropertyNames (measured in V8). for-in's count gives up
    // at the cap, though V8 lists the keys before its first step too — at the
    // clone's own order of cost (0.3-1.7x).
    const many: Record<string, unknown> = { type: 'log' }
    for (let i = 0; i < 100_000; i++) many[i] = 0
    const names = vi.spyOn(Object, 'getOwnPropertyNames')
    try {
      expect(reasonOf(many)).toBe('too-many-fields')
      expect(names.mock.calls.some(([v]) => v === many)).toBe(false)
    } finally {
      names.mockRestore()
    }
    // At the cap exactly, the message is read as usual (and refused for its fields).
    const atCap: Record<string, unknown> = { type: 'log', s: 'x' }
    for (let i = 0; i < LIMITS.messageKeys - 2; i++) atCap[`k${i}`] = 0
    expect(reasonOf(atCap)).toMatch(/^unexpected-field:/)
  })

  it('refuses a short list with named properties before listing them with getOwnPropertyNames (PT-3274 item 8)', () => {
    // A view of 18 numbers is under its cap by length, so the length check
    // alone lets its millions of named properties through to the listing.
    const v = Array.from({ length: 18 }, () => 1) as number[] & Record<string, unknown>
    for (let i = 0; i < 100_000; i++) v[`k${i}`] = 0
    const names = vi.spyOn(Object, 'getOwnPropertyNames')
    try {
      expect(reasonOf({ type: 'view18', v })).toBe('view18.v')
      expect(refusedBytes({ type: 'view18', v })).toBeNull()
      expect(names.mock.calls.some(([x]) => x === v)).toBe(false)
    } finally {
      names.mockRestore()
    }
    // A dense list with no extra property still reads as before.
    expect(reasonOf({ type: 'view18', v: Array.from({ length: 18 }, () => 1) })).toBe('ok')
  })
})

describe('readyRefusal', () => {
  const ready = (over: Partial<ReadyInfo>): ReadyInfo => {
    const r = validateFrameMessage({ ...READY, ...over })
    if (!r.ok || r.msg.type !== 'ready') throw new Error('fixture')
    const { type: _t, ...info } = r.msg
    return info
  }

  it('accepts the restricted unpickler with its 18 names on one thread', () => {
    expect(EXPECTED_ALLOW_COUNT).toBe(18)
    expect(readyRefusal(ready({}))).toBeNull()
  })

  it('refuses an unrestricted unpickler, a different allow-list, or more threads', () => {
    expect(readyRefusal(ready({ restricted: false }))).toMatch(/restricted unpickler/)
    expect(readyRefusal(ready({ allowCount: 17 }))).toMatch(/17 names/)
    expect(readyRefusal(ready({ allowCount: 19 }))).toMatch(/19 names/)
    expect(readyRefusal(ready({ maxThreads: '2' }))).toMatch(/max_threads/)
  })

  it('refuses a list that keeps the count but not the names (PT-3272 item 3)', () => {
    const swapped = EXPECTED_ALLOW_LIST.map(n => (n === 'numpy.dtype' ? 'os.system' : n))
    const refusal = readyRefusal(ready({ allowList: swapped.join('\n') }))
    expect(refusal).toMatch(/not the pinned one/)
    expect(refusal).toContain('+os.system')
    expect(refusal).toContain('-numpy.dtype')
    // The same names out of order, or one twice in place of another, are not the list either.
    expect(readyRefusal(ready({ allowList: [...EXPECTED_ALLOW_LIST].reverse().join('\n') }))).toMatch(/\(order\)/)
    const doubled = [...EXPECTED_ALLOW_LIST.slice(0, 17), EXPECTED_ALLOW_LIST[0]]
    expect(readyRefusal(ready({ allowList: doubled.join('\n') }))).toContain('-pymol.Session_Storage')
    expect(readyRefusal(ready({ allowList: '' }))).toMatch(/not the pinned one/)
  })
})

/** One file of a zip (the pinned wheel), found by its central-directory entry. */
function unzipOne(zip: Buffer, name: string): string {
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  if (eocd < 0) throw new Error('not a zip')
  const count = zip.readUInt16LE(eocd + 10)
  let at = zip.readUInt32LE(eocd + 16)
  for (let i = 0; i < count; i++) {
    const method = zip.readUInt16LE(at + 10)
    const size = zip.readUInt32LE(at + 20)
    const nameLen = zip.readUInt16LE(at + 28), extraLen = zip.readUInt16LE(at + 30), commentLen = zip.readUInt16LE(at + 32)
    const local = zip.readUInt32LE(at + 42)
    if (zip.toString('utf8', at + 46, at + 46 + nameLen) === name) {
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28)
      const data = zip.subarray(start, start + size)
      return (method === 8 ? inflateRawSync(data) : data).toString('utf8')
    }
    at += 46 + nameLen + extraLen + commentLen
  }
  throw new Error(`${name} is not in the zip`)
}

describe('the pinned allow-list', () => {
  it('is the list in the pinned wheel itself, as worker.js reports it', () => {
    // The wheel the parent hands over is pinned by SHA-256 (PYMOL_ASSET_DIGESTS),
    // so its chempy/pkl.py is the unpickler that runs: a wheel whose list
    // changed fails here, not first in a chemist's browser.
    const wheel = readFileSync(join(DIR, 'pymol-3.2.0a-cp314-cp314-pyemscripten_2026_0_wasm32.whl'))
    const pkl = unzipOne(wheel, 'chempy/pkl.py')
    const body = /RESTRICTED_GLOBALS = frozenset\(\[([^\]]*)\]\)/.exec(pkl)
    expect(body, 'RESTRICTED_GLOBALS in chempy/pkl.py').not.toBeNull()
    const pairs = [...(body as RegExpExecArray)[1].matchAll(/\('([\w.]+)', '(\w+)'\)/g)]
    // worker.js _allow_list(): 'module.name', sorted (Python's code-point order is JS's for ASCII).
    expect(pairs.map(p => `${p[1]}.${p[2]}`).sort()).toEqual(EXPECTED_ALLOW_LIST)
    expect(EXPECTED_ALLOW_LIST).toHaveLength(EXPECTED_ALLOW_COUNT)
    const worker = readFileSync(join(DIR, 'worker.js'), 'utf8')
    expect(worker).toContain("return '\\n'.join(sorted(m + '.' + n for m, n in _ck.RESTRICTED_GLOBALS))")
    expect(worker).toContain("allowList: py.runPython('_allow_list()')")
  })
})

describe('ExportGate', () => {
  it('moves an open nonce\'s deadline, and nothing else (PT-3271 item 5)', () => {
    const g = new ExportGate()
    g.issue('png', 0, 1000, 'n')
    g.setDeadline('n', 5000)
    expect(g.expire(4000)).toEqual([])
    expect(g.accept({ type: 'png', nonce: 'n' }, 4000).ok).toBe(true)
    g.issue('png', 0, 1000, 'm')
    g.setDeadline('m', 500)
    expect(g.accept({ type: 'png', nonce: 'm' }, 600)).toEqual({ ok: false, reason: 'expired' })
    // A spent or unknown nonce stays as it is.
    g.setDeadline('n', 9000)
    g.setDeadline('never', 9000)
    expect(g.accept({ type: 'png', nonce: 'n' }, 1)).toEqual({ ok: false, reason: 'replay' })
    expect(g.openCount).toBe(0)
  })

  it('accepts the issued nonce once, as the issued kind', () => {
    const g = new ExportGate()
    const n = g.issue('png', 0, 1000, 'nonce-a')
    expect(n).toBe('nonce-a')
    expect(g.accept({ type: 'png', nonce: 'nonce-a' }, 500)).toEqual({ ok: true, kind: 'png', nonce: 'nonce-a' })
    expect(g.openCount).toBe(0)
  })

  it('drops a replay of an accepted nonce', () => {
    const g = new ExportGate()
    g.issue('pse', 0, 1000, 'n')
    expect(g.accept({ type: 'pse', nonce: 'n' }, 1).ok).toBe(true)
    expect(g.accept({ type: 'pse', nonce: 'n' }, 2)).toEqual({ ok: false, reason: 'replay' })
  })

  it('drops a reply nobody asked for, and a wrong nonce while one is open', () => {
    const g = new ExportGate()
    expect(g.accept({ type: 'png', nonce: 'x' }, 0)).toEqual({ ok: false, reason: 'unsolicited' })
    g.issue('png', 0, 1000, 'right')
    expect(g.accept({ type: 'png', nonce: 'wrong' }, 1)).toEqual({ ok: false, reason: 'nonce-mismatch' })
    // A near-miss is a miss: the frame echoes the nonce unchecked.
    expect(g.accept({ type: 'png', nonce: 'right ' }, 1)).toEqual({ ok: false, reason: 'nonce-mismatch' })
    expect(g.accept({ type: 'png', nonce: 'right' }, 2).ok).toBe(true)
  })

  it('voids a nonce answered with the other kind (a png request answered with a pse)', () => {
    const g = new ExportGate()
    g.issue('png', 0, 1000, 'n')
    expect(g.accept({ type: 'pse', nonce: 'n' }, 1)).toEqual({ ok: false, reason: 'kind-mismatch' })
    // …and the honest-looking png that follows does not revive it.
    expect(g.accept({ type: 'png', nonce: 'n' }, 2)).toEqual({ ok: false, reason: 'replay' })
  })

  it('keeps a molecule export to its own kind: a mol request answered with a pse is void, and the reverse', () => {
    const g = new ExportGate()
    g.issue('mol', 0, 1000, 'm')
    expect(g.accept({ type: 'pse', nonce: 'm' }, 1)).toEqual({ ok: false, reason: 'kind-mismatch' })
    g.issue('pse', 0, 1000, 'p')
    expect(g.accept({ type: 'mol', nonce: 'p' }, 1)).toEqual({ ok: false, reason: 'kind-mismatch' })
    g.issue('mol', 0, 1000, 'ok')
    expect(g.accept({ type: 'mol', nonce: 'ok' }, 1)).toEqual({ ok: true, kind: 'mol', nonce: 'ok' })
  })

  it('keeps a look export to its own kind (protocol 4)', () => {
    const g = new ExportGate()
    g.issue('look', 0, 1000, 'l')
    expect(g.accept({ type: 'mol', nonce: 'l' }, 1)).toEqual({ ok: false, reason: 'kind-mismatch' })
    g.issue('mol', 0, 1000, 'm')
    expect(g.accept({ type: 'look', nonce: 'm' }, 1)).toEqual({ ok: false, reason: 'kind-mismatch' })
    g.issue('look', 0, 1000, 'ok')
    expect(g.accept({ type: 'look', nonce: 'ok' }, 1)).toEqual({ ok: true, kind: 'look', nonce: 'ok' })
  })

  it('drops a late reply, and expire() closes what nobody answered', () => {
    const g = new ExportGate()
    g.issue('png', 0, 1000, 'late')
    expect(g.accept({ type: 'png', nonce: 'late' }, 1001)).toEqual({ ok: false, reason: 'expired' })
    g.issue('pse', 0, 1000, 'silent')
    expect(g.expire(999)).toEqual([])
    expect(g.expire(1001)).toEqual([{ nonce: 'silent', kind: 'pse' }])
    expect(g.accept({ type: 'pse', nonce: 'silent' }, 1002)).toEqual({ ok: false, reason: 'replay' })
  })

  it('revoke() and cancelAll() leave no nonce to accept', () => {
    const g = new ExportGate()
    g.issue('png', 0, 1000, 'a')
    g.issue('pse', 0, 1000, 'b')
    g.revoke('a')
    expect(g.accept({ type: 'png', nonce: 'a' }, 1)).toEqual({ ok: false, reason: 'replay' })
    expect(g.cancelAll()).toEqual([{ nonce: 'b', kind: 'pse' }])
    expect(g.openCount).toBe(0)
  })

  it('never reissues a nonce, and its own nonces are 128-bit hex', () => {
    const g = new ExportGate()
    g.issue('png', 0, 1000, 'same')
    expect(() => g.issue('png', 0, 1000, 'same')).toThrow()
    const a = g.issue('png', 0, 1000)
    const b = g.issue('png', 0, 1000)
    expect(a).toMatch(/^[0-9a-f]{32}$/)
    expect(a).not.toBe(b)
  })
})

describe('MessageBudget', () => {
  it('admits up to the per-second rate and resets with the window', () => {
    const b = new MessageBudget()
    for (let i = 0; i < 10; i++) expect(b.admit('heartbeat', 0)).toBe(true)
    expect(b.admit('heartbeat', 10)).toBe(false)
    expect(b.admit('heartbeat', 1000)).toBe(true)
  })

  it('leaves room for a drag on a 240 Hz display', () => {
    const b = new MessageBudget()
    for (let i = 0; i < 240; i++) expect(b.admit('view18', i * 4)).toBe(true)
  })

  it('opens a new window when the wall clock steps backward, rather than holding every cap for the step', () => {
    const b = new MessageBudget()
    for (let i = 0; i < 10; i++) expect(b.admit('heartbeat', 120_000)).toBe(true)
    expect(b.admit('heartbeat', 120_500)).toBe(false)
    // NTP or a hand-set clock: two minutes back.
    expect(b.admit('heartbeat', 600)).toBe(true)
  })

  it('admits nothing of a type it has no rate for', () => {
    const b = new MessageBudget()
    expect(b.admit('__proto__', 0)).toBe(false)
    expect(b.admit('ready', 0)).toBe(false)
  })
})

describe('outbound builders', () => {
  it('loads at most 32 MiB, a session at most 25 MiB, and only real buffers', () => {
    expect(buildLoad({ format: 'cif', bytes: new ArrayBuffer(LIMITS.loadBytes), obj: '1hsg', replace: true }).message.type).toBe('load')
    expect(() => buildLoad({ format: 'cif', bytes: new ArrayBuffer(LIMITS.loadBytes + 1), obj: '1hsg', replace: true })).toThrow()
    expect(() => buildLoad({ format: 'pse', bytes: new ArrayBuffer(LIMITS.pseBytes + 1), obj: 'x', replace: true })).toThrow()
    expect(() => buildLoad({ format: 'cif', bytes: new Uint8Array(4) as unknown as ArrayBuffer, obj: 'x', replace: true })).toThrow()
    expect(() => buildLoad({ format: 'pkl' as never, bytes: new ArrayBuffer(4), obj: 'x', replace: true })).toThrow()
    expect(() => buildLoad({ format: 'cif', bytes: new ArrayBuffer(4), obj: 'a b', replace: true })).toThrow()
  })

  it('transfers the bytes it was given, and nothing else', () => {
    const bytes = new ArrayBuffer(4)
    expect(buildLoad({ format: 'cif', bytes, obj: 'x', replace: false }).transfer).toEqual([bytes])
    expect(buildRestoreSnapshot(bytes).transfer).toEqual([bytes])
    expect(buildSetView(Array.from({ length: 18 }, () => 1)).transfer).toEqual([])
  })

  it('checks a view, a command and a snapshot', () => {
    expect(() => buildSetView([1, 2, 3])).toThrow()
    expect(() => buildSetView([...Array.from({ length: 17 }, () => 0), Number.NaN])).toThrow()
    expect(() => buildCommand('')).toThrow()
    expect(() => buildCommand('x'.repeat(LIMITS.commandChars + 1))).toThrow()
    expect(buildCommand('show cartoon').message).toEqual({ type: 'command', cmd: 'show cartoon' })
    expect(() => buildRestoreSnapshot(new ArrayBuffer(LIMITS.snapshotBytes + 1))).toThrow()
    expect(() => buildExportPng({ nonce: '', ray: false, w: 0, h: 0 })).toThrow()
  })

  it('carries only the listed ray settings, as finite numbers, and only on a ray (PT-8382)', () => {
    const settings = { antialias: 2, ray_shadows: 0, bg_rgb: 1 } as unknown as Record<string, number>
    expect(buildExportPng({ nonce: 'n', ray: true, w: 10, h: 10, settings }).message).toEqual({
      type: 'exportPng',
      nonce: 'n',
      ray: true,
      w: 10,
      h: 10,
      settings: { antialias: 2, ray_shadows: 0 },
    })
    expect(buildExportPng({ nonce: 'n', ray: false, w: 0, h: 0, settings }).message).not.toHaveProperty('settings')
    expect(buildExportPng({ nonce: 'n', ray: true, w: 0, h: 0 }).message).not.toHaveProperty('settings')
    expect(() => buildExportPng({ nonce: 'n', ray: true, w: 0, h: 0, settings: { antialias: Number.NaN } })).toThrow()
  })

  it('asks for a molecule file only in PyMOL\'s text formats (PDB, mmCIF, SDF, MOL2), of one printable one-line selection', () => {
    expect(buildExportMol({ nonce: 'n', format: 'pdb', selection: 'organic' })).toEqual({
      message: { type: 'exportMol', nonce: 'n', format: 'pdb', selection: 'organic' },
      transfer: [],
    })
    expect(buildExportMol({ nonce: 'n', format: 'sdf', selection: 'sele and not hydro' }).message.format).toBe('sdf')
    expect(() => buildExportMol({ nonce: '', format: 'pdb', selection: 'all' })).toThrow()
    for (const format of ['cif', 'mol2'] as const) expect(buildExportMol({ nonce: 'n', format, selection: 'all' }).message.format).toBe(format)
    // Never a session or a pickle through here: the session has its own request (`exportPse`).
    for (const format of ['pse', 'pkl', 'mmcif', 'mol', '']) {
      expect(() => buildExportMol({ nonce: 'n', format: format as never, selection: 'all' }), format).toThrow()
    }
    for (const selection of ['', '   ', 'all\nsele', 'all\r', 'organic\u0000', 'résidu', 'x'.repeat(LIMITS.selectionChars + 1)]) {
      expect(isSelectionExpression(selection), JSON.stringify(selection)).toBe(false)
      expect(() => buildExportMol({ nonce: 'n', format: 'pdb', selection })).toThrow()
    }
    expect(isSelectionExpression('x'.repeat(LIMITS.selectionChars))).toBe(true)
    // Quotes and brackets are selection syntax, and the worker passes the text
    // as a JSON string literal, so they are not refused here.
    expect(isSelectionExpression('resn "LIG" and (chain A)')).toBe(true)
  })

  it('names a PyMOL object the worker will not rewrite', () => {
    expect(pymolObjectName('1hsg', 'structure_5')).toBe('1hsg')
    expect(pymolObjectName('TMP-S001', 'structure_5')).toBe('TMP_S001')
    expect(pymolObjectName('', 'structure_5')).toBe('structure_5')
    expect(pymolObjectName('---', 'structure_5')).toBe('structure_5')
    expect(pymolObjectName('x'.repeat(50), 'structure_5')).toHaveLength(40)
  })
})

describe('uistate (protocol 3): what PyMOL shows', () => {
  const ok = { type: 'uistate', sel: 'sele', atoms: 40, runs: 'obj_1\tA\t-3\t5\nobj_1\tB\t10\t10', more: false, shown: 1, hetero: false, wizard: 'measurement' }

  it('takes a well-formed report and reads its runs', () => {
    const r = validateFrameMessage(ok)
    expect(r.ok).toBe(true)
    if (!r.ok || r.msg.type !== 'uistate') return
    expect(r.msg.runs).toEqual([
      { model: 'obj_1', chain: 'A', start: -3, end: 5 },
      { model: 'obj_1', chain: 'B', start: 10, end: 10 },
    ])
    expect(r.msg.wizard).toBe('measurement')
  })

  it('takes no selection with nothing about one, and a selection too large to walk (runs null)', () => {
    expect(reasonOf({ type: 'uistate', sel: null, atoms: null, runs: null, more: false, shown: 0, hetero: false, wizard: null })).toBe('ok')
    expect(reasonOf({ type: 'uistate', sel: 'all_of_it', atoms: 900000, runs: null, more: false, shown: 3, hetero: true, wizard: 'other' })).toBe('ok')
    expect(reasonOf({ type: 'uistate', sel: 'sele', atoms: 0, runs: '', more: false, shown: 1, hetero: false, wizard: null })).toBe('ok')
  })

  it('refuses a malformed run, too many runs, a bad wizard, and runs without a selection', () => {
    expect(reasonOf({ ...ok, runs: 'obj\tA\t5\t3' })).toBe('uistate.runs')
    expect(reasonOf({ ...ok, runs: 'obj\tA\t1' })).toBe('uistate.runs')
    expect(reasonOf({ ...ok, runs: 'obj\tA\t1.5\t3' })).toBe('uistate.runs')
    expect(reasonOf({ ...ok, runs: '\tA\t1\t3' })).toBe('uistate.runs')
    expect(reasonOf({ ...ok, runs: Array.from({ length: LIMITS.uiRuns + 1 }, (_, i) => `o\tA\t${i}\t${i}`).join('\n') })).toBe('uistate.runs')
    expect(reasonOf({ ...ok, runs: 'x'.repeat(LIMITS.uiRunsChars + 1) })).toBe('uistate.runs')
    expect(reasonOf({ ...ok, wizard: 'sculpting' })).toBe('uistate.wizard')
    expect(reasonOf({ ...ok, sel: null })).toBe('uistate.sel')
    expect(reasonOf({ ...ok, sel: '' })).toBe('uistate.sel')
    expect(reasonOf({ ...ok, atoms: -1 })).toBe('uistate.atoms')
    expect(reasonOf({ ...ok, shown: 0 })).toBe('uistate.shown')
    expect(reasonOf({ ...ok, shown: 1.5 })).toBe('uistate.shown')
    expect(reasonOf({ ...ok, hetero: 'yes' })).toBe('uistate.hetero')
    expect(reasonOf({ type: 'uistate', sel: null, atoms: null, runs: null, more: false, shown: 0, hetero: true, wizard: null })).toBe('uistate.sel')
    expect(reasonOf({ ...ok, extra: 1 })).not.toBe('ok')
  })
})

describe('cursor (protocol 3): the pointer shape the frame draws', () => {
  it('builds only the shapes host.js knows', () => {
    for (const mode of FRAME_CURSORS) expect(buildCursor(mode).message).toEqual({ type: 'cursor', mode })
    expect(() => buildCursor('none' as never)).toThrow(RangeError)
  })

  it('is acted on by host.js itself, never forwarded to the worker', () => {
    const host = readFileSync(join(DIR, 'host.js'), 'utf8')
    expect(FRAME_LOCAL_TYPES).toEqual(['cursor'])
    expect(PARENT_MESSAGE_TYPES).not.toContain('cursor')
    const cursors = /const CURSORS = \{ ([^}]*) \};/.exec(host)?.[1] ?? ''
    expect([...cursors.matchAll(/(\w+):/g)].map(m => m[1]).sort()).toEqual([...FRAME_CURSORS].sort())
  })
})

describe('the look export (protocol 4): exportLook / look', () => {
  it('builds exportLook with a nonce only', () => {
    expect(buildExportLook({ nonce: 'n' })).toEqual({ message: { type: 'exportLook', nonce: 'n' }, transfer: [] })
    expect(() => buildExportLook({ nonce: '' })).toThrow(RangeError)
    expect(() => buildExportLook({ nonce: 'x'.repeat(LIMITS.nonceChars + 1) })).toThrow(RangeError)
  })

  it('accepts a look of a nonce and real bytes only, as a fresh object', () => {
    const bytes = new ArrayBuffer(8)
    const r = validateFrameMessage({ type: 'look', nonce: 'n', bytes })
    expect(r.ok && r.msg).toEqual({ type: 'look', nonce: 'n', bytes })
    expect(r.ok && r.bytes).toBeGreaterThanOrEqual(8)
    expect(reasonOf({ type: 'look', nonce: '', bytes })).toBe('look.nonce')
    expect(reasonOf({ type: 'look', nonce: 7, bytes })).toBe('look.nonce')
    expect(reasonOf({ type: 'look', nonce: 'n', bytes: new Uint8Array(8) })).toBe('look.bytes')
    expect(reasonOf({ type: 'look', nonce: 'n', bytes: 'x' })).toBe('look.bytes')
    expect(reasonOf({ type: 'look', nonce: 'n' })).toBe('look.bytes')
    expect(reasonOf({ type: 'look', nonce: 'n', bytes, w: 1 })).toBe('unexpected-field:w')
  })

  it('rates look replies like the other exports', () => {
    expect(RATE_PER_SECOND.look).toBe(RATE_PER_SECOND.mol)
  })

  it('is relayed by host.js both ways, and applyLook never is (the standalone page sends it straight to its worker)', () => {
    const host = readFileSync(join(DIR, 'host.js'), 'utf8')
    expect(FRAME_MESSAGE_TYPES).toContain('look')
    expect(PARENT_MESSAGE_TYPES).toContain('exportLook')
    expect(PARENT_MESSAGE_TYPES as readonly string[]).not.toContain('applyLook')
    expect(host).not.toMatch(/'applyLook'/)
    // The look's bytes are transferred, not copied, as a mol's are.
    expect(host).toContain("d.type === 'look'")
  })
})
