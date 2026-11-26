import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { PYMOL_RUNTIME_VERSION } from './pymolRuntimeManifest'
import { LIMITS, MiB } from './pymolFrameProtocol'
import {
  encodePymolLook,
  parsePymolLook,
  PYMOL_LOOK_ATOM_COLOURS,
  PYMOL_LOOK_COLOR_SETTINGS,
  PYMOL_LOOK_LIMITS,
  PYMOL_LOOK_NUMBER_SETTINGS,
  PYMOL_LOOK_VERSION,
  PYMOL_REP,
  PymolLookError,
  RESERVED_ID,
  type PymolLook,
} from './pymolLook'

/**
 * The look format (frame protocol 4): what `worker.js` writes for
 * `exportLook` and checks again before `applyLook`. The bytes come out of an
 * untrusted frame, so every malformed field is a
 * refusal here, and the allow-lists and caps are held equal to the worker's.
 */

const WORKER = readFileSync(join(process.cwd(), 'public', 'vendor', 'pymol', PYMOL_RUNTIME_VERSION, 'worker.js'), 'utf8')

function sample(): PymolLook {
  return {
    v: 1,
    view: Array.from({ length: 18 }, (_, i) => i * 0.5 - 3),
    bg: [0.2, 0.2, 0.2],
    settings: { cartoon_transparency: 0.3, stick_radius: 0.15, valence: 1, cartoon_color: [1, 1, 1] },
    objects: [
      {
        name: 'crn',
        enabled: true,
        text: 'data_crn\nloop_\n_atom_site.id\nATOM 1\nATOM 2\nATOM 3\n',
        atoms: 3,
        color: [0xff0000, 0x00ff00, 0x0000ff],
        reps: [PYMOL_REP.cartoon, PYMOL_REP.cartoon | PYMOL_REP.sticks, 0],
        settings: { stick_radius: 0.3 },
      },
    ],
    skipped: [{ name: 'dist01', type: 'measurement' }],
  }
}

const bytesOf = (v: unknown): ArrayBuffer => new TextEncoder().encode(JSON.stringify(v)).buffer as ArrayBuffer

/** The reason and field `parsePymolLook` refuses `v` with. */
function refusal(v: unknown): { reason: string; field: string | null } {
  try {
    parsePymolLook(typeof v === 'string' ? (new TextEncoder().encode(v).buffer as ArrayBuffer) : bytesOf(v))
  } catch (e) {
    if (e instanceof PymolLookError) return { reason: e.reason, field: e.field }
    throw e
  }
  return { reason: 'ok', field: null }
}

/** `sample()` with one change made by `edit`. */
function edited(edit: (l: Record<string, unknown> & { objects: Array<Record<string, unknown>> }) => void): unknown {
  const l = JSON.parse(JSON.stringify(sample())) as Record<string, unknown> & { objects: Array<Record<string, unknown>> }
  edit(l)
  return l
}

describe('parsePymolLook / encodePymolLook', () => {
  it('round-trips a look, and what it returns is a fresh copy', () => {
    const look = sample()
    const bytes = encodePymolLook(look)
    const back = parsePymolLook(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
    expect(back).toEqual(look)
    expect(back.objects[0].color).not.toBe(look.objects[0].color)
    expect(PYMOL_LOOK_VERSION).toBe(1)
  })

  it('carries an object’s colour setting left at the atoms’ own colours under a fixed global one (PT-9090 item 2)', () => {
    const look = edited(l => { l.objects[0].settings = { cartoon_color: PYMOL_LOOK_ATOM_COLOURS } })
    expect(refusal(look).reason).toBe('ok')
    expect(parsePymolLook(bytesOf(look)).objects[0].settings.cartoon_color).toBe(-1)
    // worker.js sets it back as PyMOL's `default`.
    expect(WORKER).toContain("out.append((k, 'default')); continue")
  })

  it('accepts a scene with no molecule objects and nothing skipped', () => {
    expect(refusal(edited(l => { l.objects = []; l.skipped = [] })).reason).toBe('ok')
  })

  it('refuses bytes that are empty, too large, not UTF-8 or not JSON — the size before decoding', () => {
    const reason = (b: ArrayBuffer) => { try { parsePymolLook(b); return 'ok' } catch (e) { return (e as PymolLookError).reason } }
    expect(reason(new ArrayBuffer(0))).toBe('empty')
    expect(reason(new ArrayBuffer(PYMOL_LOOK_LIMITS.bytes + 1))).toBe('too-large')
    expect(reason(new Uint8Array([0x7b, 0xff, 0x7d]).buffer)).toBe('not-text')
    expect(refusal('{"v":1,').reason).toBe('not-json')
    expect(refusal('NaN').reason).toBe('not-json')
  })

  it.each<[string, (l: Record<string, unknown> & { objects: Array<Record<string, unknown>> }) => void, string]>([
    ['a version other than 1', l => { l.v = 2 }, 'v'],
    ['a version that is a string', l => { l.v = '1' }, 'v'],
    ['a key the format does not have', l => { l.extra = 1 }, 'look'],
    ['a missing key', l => { delete l.skipped }, 'look'],
    ['a view of 17 numbers', l => { l.view = (l.view as number[]).slice(1) }, 'view'],
    ['a view with text in it', l => { (l.view as unknown[])[3] = '1' }, 'view'],
    ['a view with a number past float range', l => { l.view = '__INF__' }, 'view'],
    ['a background over 1', l => { l.bg = [0, 0, 1.5] }, 'bg'],
    ['a background of two values', l => { l.bg = [0, 0] }, 'bg'],
    ['a setting outside the allow-list', l => { (l.settings as Record<string, unknown>).ray_trace_mode = 1 }, 'settings.ray_trace_mode'],
    ['a setting named __proto__', l => { l.settings = JSON.parse('{"__proto__": 1}') }, 'settings.__proto__'],
    ['a numeric setting that is text', l => { (l.settings as Record<string, unknown>).stick_radius = '0.2' }, 'settings.stick_radius'],
    ['a numeric setting that is a boolean', l => { (l.settings as Record<string, unknown>).valence = true }, 'settings.valence'],
    ['a numeric setting past its magnitude cap', l => { (l.settings as Record<string, unknown>).stick_radius = 1e7 }, 'settings.stick_radius'],
    ['a colour setting that is a number', l => { (l.settings as Record<string, unknown>).cartoon_color = 3 }, 'settings.cartoon_color'],
    ['a colour setting of -2', l => { l.objects[0].settings = { cartoon_color: -2 } }, 'objects[].settings.cartoon_color'],
    ['a colour setting over 1', l => { (l.settings as Record<string, unknown>).cartoon_color = [1, 2, 1] }, 'settings.cartoon_color'],
    ['settings that are a list', l => { l.settings = [] }, 'settings'],
    ['objects that are not a list', l => { l.objects = {} as never }, 'objects'],
    ['too many objects', l => { l.objects = Array.from({ length: PYMOL_LOOK_LIMITS.objects + 1 }, () => l.objects[0]) }, 'objects'],
    ['an object with an extra key', l => { l.objects[0].state = 1 }, 'objects[]'],
    ['an object name with a space', l => { l.objects[0].name = 'a b' }, 'objects[].name'],
    ['an object name of 65 characters', l => { l.objects[0].name = 'a'.repeat(65) }, 'objects[].name'],
    ['an empty object name', l => { l.objects[0].name = '' }, 'objects[].name'],
    ['two objects of one name', l => { l.objects.push(JSON.parse(JSON.stringify(l.objects[0])) as Record<string, unknown>) }, 'objects[].name'],
    ['enabled as a number', l => { l.objects[0].enabled = 1 }, 'objects[].enabled'],
    ['an empty text', l => { l.objects[0].text = '' }, 'objects[].text'],
    ['a text that is not a string', l => { l.objects[0].text = ['x'] }, 'objects[].text'],
    // PT-9089 item 3: chain / residue / atom names that are JavaScript object keys are refused.
    ['a chain named __proto__', l => { l.objects[0].text = 'data_x\nloop_\n_atom_site.auth_asym_id\n__proto__\n' }, 'objects[].text: a reserved identifier'],
    ['a residue named constructor', l => { l.objects[0].text = "data_x\nATOM 1 C CA 'constructor' A\n" }, 'objects[].text: a reserved identifier'],
    ['an atom named prototype', l => { l.objects[0].text = 'data_x\nATOM 1 C prototype ALA A' }, 'objects[].text: a reserved identifier'],
    ['zero atoms', l => { l.objects[0].atoms = 0 }, 'objects[].atoms'],
    ['a fractional atom count', l => { l.objects[0].atoms = 2.5 }, 'objects[].atoms'],
    ['more atoms than the cap', l => { l.objects[0].atoms = PYMOL_LOOK_LIMITS.atoms + 1 }, 'objects[].atoms'],
    ['fewer colours than atoms', l => { l.objects[0].color = [1, 2] }, 'objects[].color'],
    ['a colour past 0xFFFFFF', l => { l.objects[0].color = [0, 0, 0x1000000] }, 'objects[].color'],
    ['a negative colour', l => { l.objects[0].color = [0, -1, 0] }, 'objects[].color'],
    ['a fractional colour', l => { l.objects[0].color = [0, 0.5, 0] }, 'objects[].color'],
    ['a colour as text', l => { l.objects[0].color = ['#fff', 0, 0] }, 'objects[].color'],
    ['more reps than atoms', l => { l.objects[0].reps = [0, 0, 0, 0] }, 'objects[].reps'],
    ['a rep bit PyMOL does not have', l => { l.objects[0].reps = [0, 0, PYMOL_LOOK_LIMITS.repsMax + 1] }, 'objects[].reps'],
    ['an object setting outside the allow-list', l => { l.objects[0].settings = { bg_rgb: 1 } }, 'objects[].settings.bg_rgb'],
    ['skipped that is not a list', l => { l.skipped = 'map' }, 'skipped'],
    ['too many skipped', l => { l.skipped = Array.from({ length: PYMOL_LOOK_LIMITS.skipped + 1 }, () => ({ name: 'm', type: 'map' })) }, 'skipped'],
    ['a skipped entry with an extra key', l => { l.skipped = [{ name: 'm', type: 'map', x: 1 }] }, 'skipped[]'],
    ['a skipped name with markup', l => { l.skipped = [{ name: '<b>m</b>', type: 'map' }] }, 'skipped[].name'],
    ['a skipped type with a colon', l => { l.skipped = [{ name: 'm', type: 'object:map' }] }, 'skipped[].type'],
    ['a skipped type past 32 characters', l => { l.skipped = [{ name: 'm', type: 'm'.repeat(33) }] }, 'skipped[].type'],
  ])('refuses %s', (_label, edit, field) => {
    const v = edited(edit)
    // JSON cannot spell a number past float range; write 1e999, which JSON.parse reads as Infinity.
    const text = JSON.stringify(v).replace('"__INF__"', '[1e999,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]')
    expect(refusal(text)).toEqual({ reason: 'invalid', field })
  })

  it('refuses more atoms over all objects than the cap', () => {
    const many = PYMOL_LOOK_LIMITS.atoms / 2 + 1
    const obj = (name: string) => ({ name, enabled: true, text: 'x', atoms: many, color: new Array(many).fill(0), reps: new Array(many).fill(0), settings: {} })
    expect(refusal(edited(l => { l.objects = [obj('a'), obj('b')] }))).toEqual({ reason: 'invalid', field: 'objects[].atoms' })
  })

  it('refuses a JSON key `__proto__` on the look and on an object', () => {
    const text = JSON.stringify(sample())
    expect(refusal(text.replace('{"v":1,', '{"__proto__":{"v":1},"v":1,')).field).toBe('look')
    expect(refusal(text.replace('{"name":"crn",', '{"__proto__":{},"name":"crn",')).field).toBe('objects[]')
  })

  it('will not encode what it would not parse', () => {
    const bad = sample()
    bad.objects[0].color = [0x1000000, 0, 0]
    expect(() => encodePymolLook(bad)).toThrow(PymolLookError)
    const named = sample()
    named.objects[0].name = 'a-b'
    expect(() => encodePymolLook(named)).toThrow(/objects\[\]\.name/)
  })
})

describe('the look format is the one worker.js writes and checks', () => {
  const lookPy = /const LOOK_PY = String\.raw`([\s\S]*?)`;/.exec(WORKER)?.[1] ?? ''
  const pyInt = (name: string): number => {
    const m = new RegExp(`${name} = (0x[0-9A-Fa-f]+|\\d+(?:e\\d+)?)`).exec(lookPy)
    if (!m) throw new Error(`worker.js LOOK_PY: ${name} not found`)
    return Number(m[1])
  }
  const jsList = (name: string): string[] => {
    const m = new RegExp(`const ${name} = \\[([^\\]]*)\\];`).exec(WORKER)
    if (!m) throw new Error(`worker.js: ${name} not found`)
    return [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1])
  }

  it('carries the same settings', () => {
    expect(jsList('LOOK_NUM_SETTINGS')).toEqual([...PYMOL_LOOK_NUMBER_SETTINGS])
    expect(jsList('LOOK_COLOR_SETTINGS')).toEqual([...PYMOL_LOOK_COLOR_SETTINGS])
    expect(lookPy).toContain('_LOOK_NUM = ${JSON.stringify(LOOK_NUM_SETTINGS)}')
    expect(lookPy).toContain('_LOOK_COLOR = ${JSON.stringify(LOOK_COLOR_SETTINGS)}')
  })

  it('has the same caps', () => {
    expect(/const LOOK_MAX = (\d+) \* MiB;/.exec(WORKER)?.[1]).toBe(String(PYMOL_LOOK_LIMITS.bytes / MiB))
    expect(PYMOL_LOOK_LIMITS.bytes).toBe(LIMITS.lookBytes)
    expect(pyInt('_LOOK_MAX_OBJECTS')).toBe(PYMOL_LOOK_LIMITS.objects)
    expect(pyInt('_LOOK_MAX_SKIPPED')).toBe(PYMOL_LOOK_LIMITS.skipped)
    expect(pyInt('_LOOK_MAX_ATOMS')).toBe(PYMOL_LOOK_LIMITS.atoms)
    expect(pyInt('_LOOK_REPS_MAX')).toBe(PYMOL_LOOK_LIMITS.repsMax)
    expect(pyInt('_LOOK_SETTING_ABS')).toBe(PYMOL_LOOK_LIMITS.settingAbs)
    expect(lookPy).toContain("_LOOK_NAME = _lre.compile(r'[A-Za-z0-9_]{1,64}\\Z')")
    // The same reserved tokens (PT-9089 item 3), refused before the text is loaded.
    expect(lookPy).toContain(`_LOOK_BAD_ID = _lre.compile(r'''${RESERVED_ID.source}''', _lre.M)`)
    expect(lookPy).toContain("if _LOOK_BAD_ID.search(o['text']): _look_fail('object.text: a reserved identifier')")
  })

  it('keeps names that only contain a reserved word', () => {
    expect(RESERVED_ID.test('ATOM 1 C proto_x my__proto__ prototypes constructorA')).toBe(false)
  })

  it('names the representation bits as PyMOL does', () => {
    // pymol/constants.py repmasks: one bit per representation, in this order.
    const order = ['sticks', 'spheres', 'surface', 'labels', 'nb_spheres', 'cartoon', 'ribbon', 'lines', 'mesh', 'dots', 'dashes', 'nonbonded']
    expect(Object.keys(PYMOL_REP)).toEqual(order)
    order.forEach((k, i) => expect(PYMOL_REP[k as keyof typeof PYMOL_REP]).toBe(1 << i))
  })
})
