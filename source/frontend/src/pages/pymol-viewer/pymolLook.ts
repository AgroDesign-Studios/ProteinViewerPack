import { LIMITS } from './pymolFrameProtocol'

/**
 * What a PyMOL scene looks like, as plain JSON DATA (frame protocol 4): the
 * format `worker.js` writes for `exportLook` and rebuilds a scene from for
 * `applyLook` (its LOOK_PY), carried into the standalone HTML export.
 *
 * This is the look of a scene without the scene's session: a `.pse` is an
 * unrestricted pickle that desktop PyMOL would run code from, so it is never
 * embedded or offered (PT-3031). Per molecule object it holds the object's
 * current state as mmCIF written by PyMOL (plus `_struct_conf` /
 * `_struct_sheet_range` loops the worker adds, since PyMOL's writer leaves
 * the secondary structure out), each atom's colour and representations, and
 * the object's own values of the allow-listed settings; for the scene, the
 * view, the background and the global values of those settings.
 *
 * Atom order: `color[i]` and `reps[i]` belong to the i-th atom row of the
 * text's `_atom_site` loop, whose `_atom_site.id` is `i + 1`. The worker
 * proves this for every object before it answers (it reads the text back
 * with file order kept and compares atom by atom) and refuses the export
 * otherwise; `applyLook` loads with file order kept and checks the count.
 *
 * The bytes come out of the PyMOL frame, which is untrusted,
 * so `parsePymolLook` checks every field and builds a fresh object from the
 * checked values only — an unknown key anywhere is a refusal, not ignored.
 * `pymolLook.test.ts` holds the allow-lists and caps here equal to
 * `worker.js`'s, which checks the same again before it applies a look.
 */

export const PYMOL_LOOK_VERSION = 1

/** Numeric settings a look carries (`worker.js` LOOK_NUM_SETTINGS). */
export const PYMOL_LOOK_NUMBER_SETTINGS = Object.freeze([
  'cartoon_transparency', 'transparency', 'sphere_transparency', 'stick_transparency',
  'stick_radius', 'sphere_scale', 'line_width', 'valence', 'cartoon_tube_radius', 'cartoon_loop_radius',
  'cartoon_fancy_helices', 'cartoon_cylindrical_helices', 'cartoon_flat_sheets', 'cartoon_side_chain_helper',
  'surface_quality', 'ambient', 'specular', 'depth_cue', 'fog', 'orthoscopic', 'field_of_view',
] as const)

/**
 * Colour settings a look carries, as `[r, g, b]` 0..1 (`worker.js`
 * LOOK_COLOR_SETTINGS). Their default — the atoms' own colours — is not
 * carried globally: absent means that default. An object that keeps it under
 * a fixed global colour carries `-1` (`PYMOL_LOOK_ATOM_COLOURS`, PT-9090
 * item 2).
 */
export const PYMOL_LOOK_COLOR_SETTINGS = Object.freeze(['cartoon_color', 'stick_color', 'sphere_color', 'surface_color'] as const)

/** A colour setting's value for "the atoms' own colours" (PyMOL's `default`, colour index -1). */
export const PYMOL_LOOK_ATOM_COLOURS = -1

export type PymolLookNumberSetting = (typeof PYMOL_LOOK_NUMBER_SETTINGS)[number]
export type PymolLookColorSetting = (typeof PYMOL_LOOK_COLOR_SETTINGS)[number]

/**
 * PyMOL's representation bits (`pymol/constants.py` repmasks), as found in
 * `PymolLookObject.reps`. Labels' text and measurements are not carried, so
 * `labels` / `dashes` draw nothing on their own.
 */
export const PYMOL_REP = Object.freeze({
  sticks: 1 << 0,
  spheres: 1 << 1,
  surface: 1 << 2,
  labels: 1 << 3,
  nb_spheres: 1 << 4,
  cartoon: 1 << 5,
  ribbon: 1 << 6,
  lines: 1 << 7,
  mesh: 1 << 8,
  dots: 1 << 9,
  dashes: 1 << 10,
  nonbonded: 1 << 11,
})

/** The caps a look is checked against (`worker.js` LOOK_MAX and _LOOK_MAX_*). */
export const PYMOL_LOOK_LIMITS = Object.freeze({
  bytes: LIMITS.lookBytes,
  objects: 256,
  skipped: 256,
  /** Atoms over all objects. */
  atoms: 2_000_000,
  /** Every representation bit PyMOL has (`everything`). */
  repsMax: 0x1fffff,
  /** A numeric setting's magnitude. */
  settingAbs: 1e6,
  /** `skipped[].type`. */
  typeChars: 32,
})

export type PymolLookSettings = Record<string, number | [number, number, number]>

export interface PymolLookObject {
  /** PyMOL object name, `[A-Za-z0-9_]{1,64}` (the worker renames any other). */
  name: string
  enabled: boolean
  /** mmCIF of the object's current state, written by PyMOL. */
  text: string
  /** Atom count; `color.length === reps.length === atoms`. */
  atoms: number
  /** 0xRRGGBB per atom, in the order the atoms appear in `text`. */
  color: number[]
  /** PyMOL `reps` bitmask per atom (`PYMOL_REP`), same order. */
  reps: number[]
  /** Object-level values of allow-listed settings that differ from the global ones. */
  settings: PymolLookSettings
}

export interface PymolLook {
  v: 1
  /** 18 finite numbers (`cmd.get_view`). */
  view: number[]
  /** Background, 0..1. */
  bg: [number, number, number]
  /** Global values of the allow-listed settings. */
  settings: PymolLookSettings
  /** Molecule objects only, in PyMOL's object order. */
  objects: PymolLookObject[]
  /** Non-molecule objects not carried (maps, meshes, measurements, CGOs, groups…). */
  skipped: { name: string; type: string }[]
}

export type PymolLookErrorReason = 'empty' | 'too-large' | 'not-text' | 'not-json' | 'invalid'

/** Why bytes are not a look. `field` names the first field that failed. */
export class PymolLookError extends Error {
  readonly reason: PymolLookErrorReason
  readonly field: string | null
  constructor(reason: PymolLookErrorReason, field: string | null = null) {
    super(field === null ? `pymol look: ${reason}` : `pymol look: ${reason} (${field})`)
    this.name = 'PymolLookError'
    this.reason = reason
    this.field = field
  }
}

const NAME = /^[A-Za-z0-9_]{1,64}$/
/**
 * A token of the mmCIF text that is a JavaScript object key (`__proto__`,
 * `constructor`, `prototype`): such a chain, residue or atom name is refused
 * (PT-9089 item 3). `worker.js` `_LOOK_BAD_ID` refuses the same tokens.
 */
export const RESERVED_ID = /(?:^|[\s'"])(?:__proto__|constructor|prototype)(?=$|[\s'"])/m
const TYPE = /^[A-Za-z0-9_]+$/
const NUMBER_SETTINGS: ReadonlySet<string> = new Set(PYMOL_LOOK_NUMBER_SETTINGS)
const COLOR_SETTINGS: ReadonlySet<string> = new Set(PYMOL_LOOK_COLOR_SETTINGS)
const LOOK_KEYS = ['bg', 'objects', 'settings', 'skipped', 'v', 'view']
const OBJECT_KEYS = ['atoms', 'color', 'enabled', 'name', 'reps', 'settings', 'text']
const SKIPPED_KEYS = ['name', 'type']

const invalid = (field: string): never => {
  throw new PymolLookError('invalid', field)
}

/** A plain object (JSON's kind) with exactly `keys` as its own keys; null for anything else. */
function record(v: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null
  const proto: unknown = Object.getPrototypeOf(v)
  if (proto !== Object.prototype && proto !== null) return null
  const own = Object.keys(v).sort()
  if (own.length !== keys.length || own.some((k, i) => k !== keys[i])) return null
  return v as Record<string, unknown>
}

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isInt = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi
const isUnit = (v: unknown): v is number => isFiniteNumber(v) && v >= 0 && v <= 1

function rgb(v: unknown, field: string): [number, number, number] {
  if (!Array.isArray(v) || v.length !== 3 || !v.every(isUnit)) invalid(field)
  const a = v as number[]
  return [a[0], a[1], a[2]]
}

function settingsOf(v: unknown, field: string): PymolLookSettings {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return invalid(field)
  const proto: unknown = Object.getPrototypeOf(v)
  if (proto !== Object.prototype && proto !== null) return invalid(field)
  const out: PymolLookSettings = {}
  for (const [k, value] of Object.entries(v as Record<string, unknown>)) {
    if (NUMBER_SETTINGS.has(k)) {
      if (!isFiniteNumber(value) || Math.abs(value) > PYMOL_LOOK_LIMITS.settingAbs) invalid(`${field}.${k}`)
      out[k] = value as number
    } else if (COLOR_SETTINGS.has(k)) {
      out[k] = value === PYMOL_LOOK_ATOM_COLOURS ? PYMOL_LOOK_ATOM_COLOURS : rgb(value, `${field}.${k}`)
    } else {
      invalid(`${field}.${k.slice(0, 40)}`)
    }
  }
  return out
}

/** A list of exactly `n` integers in lo..hi, copied. */
function intList(v: unknown, n: number, lo: number, hi: number, field: string): number[] {
  if (!Array.isArray(v) || v.length !== n) return invalid(field)
  const out = new Array<number>(n)
  for (let i = 0; i < n; i++) {
    const x: unknown = v[i]
    if (!isInt(x, lo, hi)) invalid(field)
    out[i] = x as number
  }
  return out
}

/** Check a decoded value as a look; a fresh `PymolLook` of checked values, or a throw. */
function checkLook(value: unknown): PymolLook {
  const look = record(value, LOOK_KEYS)
  if (look === null) return invalid('look')
  if (look.v !== PYMOL_LOOK_VERSION) invalid('v')
  const view = look.view
  if (!Array.isArray(view) || view.length !== 18 || !view.every(isFiniteNumber)) invalid('view')
  const bg = rgb(look.bg, 'bg')
  const settings = settingsOf(look.settings, 'settings')
  const objects = look.objects
  if (!Array.isArray(objects) || objects.length > PYMOL_LOOK_LIMITS.objects) invalid('objects')
  const names = new Set<string>()
  let atomsTotal = 0
  const outObjects: PymolLookObject[] = []
  for (const raw of objects as unknown[]) {
    const o = record(raw, OBJECT_KEYS)
    if (o === null) return invalid('objects[]')
    const name = o.name
    if (typeof name !== 'string' || !NAME.test(name) || names.has(name)) invalid('objects[].name')
    names.add(name as string)
    if (typeof o.enabled !== 'boolean') invalid('objects[].enabled')
    if (typeof o.text !== 'string' || o.text.length === 0) invalid('objects[].text')
    if (RESERVED_ID.test(o.text as string)) invalid('objects[].text: a reserved identifier')
    const atoms = o.atoms
    if (!isInt(atoms, 1, PYMOL_LOOK_LIMITS.atoms)) return invalid('objects[].atoms')
    atomsTotal += atoms
    if (atomsTotal > PYMOL_LOOK_LIMITS.atoms) invalid('objects[].atoms')
    outObjects.push({
      name: name as string,
      enabled: o.enabled as boolean,
      text: o.text as string,
      atoms,
      color: intList(o.color, atoms, 0, 0xffffff, 'objects[].color'),
      reps: intList(o.reps, atoms, 0, PYMOL_LOOK_LIMITS.repsMax, 'objects[].reps'),
      settings: settingsOf(o.settings, 'objects[].settings'),
    })
  }
  const skipped = look.skipped
  if (!Array.isArray(skipped) || skipped.length > PYMOL_LOOK_LIMITS.skipped) invalid('skipped')
  const outSkipped: PymolLook['skipped'] = []
  for (const raw of skipped as unknown[]) {
    const s = record(raw, SKIPPED_KEYS)
    if (s === null) return invalid('skipped[]')
    if (typeof s.name !== 'string' || !NAME.test(s.name)) invalid('skipped[].name')
    if (typeof s.type !== 'string' || s.type.length > PYMOL_LOOK_LIMITS.typeChars || !TYPE.test(s.type)) invalid('skipped[].type')
    outSkipped.push({ name: s.name as string, type: s.type as string })
  }
  return { v: 1, view: (view as number[]).slice(), bg, settings, objects: outObjects, skipped: outSkipped }
}

/**
 * Read a look from the bytes `requestExport('look')` answered with (or that a
 * standalone page embeds). Throws `PymolLookError`: `empty`, `too-large`
 * (over `PYMOL_LOOK_LIMITS.bytes`, refused before decoding), `not-text`
 * (not UTF-8), `not-json`, or `invalid` with the first failing field.
 */
export function parsePymolLook(bytes: ArrayBuffer): PymolLook {
  const n = bytes.byteLength
  if (n === 0) throw new PymolLookError('empty')
  if (n > PYMOL_LOOK_LIMITS.bytes) throw new PymolLookError('too-large')
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new PymolLookError('not-text')
  }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new PymolLookError('not-json')
  }
  return checkLook(value)
}

/**
 * A look as UTF-8 JSON bytes — what `worker.js` `applyLook` reads. Checked
 * first with the same rules as `parsePymolLook`, so what this encodes always
 * parses; throws `PymolLookError` otherwise, or `too-large` past the cap.
 */
export function encodePymolLook(look: PymolLook): Uint8Array {
  const checked = checkLook(look)
  const bytes = new TextEncoder().encode(JSON.stringify(checked))
  if (bytes.byteLength > PYMOL_LOOK_LIMITS.bytes) throw new PymolLookError('too-large')
  return bytes
}
