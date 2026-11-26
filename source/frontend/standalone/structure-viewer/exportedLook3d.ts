/**
 * The display the file was exported with, drawn in 3Dmol.js: a `Mol3dLook`
 * (3Dmol.js's own look, frozen by `mol3dLook.ts`) or a `PymolLook` (PyMOL's
 * colours and representations per atom, `pymolLook.ts`) translated into 3Dmol
 * styles. Both are data from the file, checked here before 3Dmol sees them:
 * only the representation keys and plain values reach an atom's style, and a
 * PyMOL look has already passed `parsePymolLook` (which refuses reserved
 * identifiers, PT-9089 item 3), and each object's text reaches 3Dmol.js
 * through `safeModelText`, which neutralises reserved identifiers before
 * parsing (PT-9131).
 */
import { safeModelText } from '../../src/components/structure-viewer/safeModelText'
import type { PymolLook } from '../../src/pages/pymol-viewer/pymolLook'
import { PYMOL_LOOK_ATOM_COLOURS, PYMOL_REP } from '../../src/pages/pymol-viewer/pymolLook'
import type { Mol3dLook, Mol3dLookSurface } from '../../src/pages/structure-html-export/mol3dLook'

/* eslint-disable @typescript-eslint/no-explicit-any -- 3Dmol.js has no types here */
type Viewer = any
type Model = any
type Atom = any

const REP_KEYS = ['line', 'cross', 'stick', 'sphere', 'cartoon'] as const
const SURFACE_TYPES = ['VDW', 'MS', 'SAS', 'SES'] as const
const HEX = /^#[0-9a-fA-F]{6}$/

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isRange = (r: unknown): r is [number, number] => Array.isArray(r) && r.length === 2 && Number.isInteger(r[0]) && Number.isInteger(r[1]) && r[0] >= 0 && r[1] >= r[0]

/** One representation's options with plain values only (numbers, strings, booleans). */
function repOptions(v: unknown): Record<string, unknown> | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null
  const out: Record<string, unknown> = {}
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue
    if (isNum(x) || typeof x === 'boolean' || (typeof x === 'string' && x.length <= 40)) out[k] = x
  }
  return out
}

/** A `Mol3dLook` from the `mol3d` block, every field checked; null when it is not one. */
export function checkMol3dLook(raw: unknown): Mol3dLook | null {
  if (typeof raw !== 'object' || raw === null) return null
  const l = raw as Record<string, unknown>
  if (l.v !== 1 || !Number.isInteger(l.atoms) || (l.atoms as number) < 1) return null
  const view = Array.isArray(l.view) && l.view.length >= 8 && l.view.every(isNum) ? (l.view as number[]).slice() : []
  const bg = typeof l.bg === 'string' && HEX.test(l.bg) ? l.bg : '#ffffff'
  const groups: Mol3dLook['groups'] = []
  for (const g of Array.isArray(l.groups) ? l.groups : []) {
    const gg = g as { style?: unknown; ranges?: unknown }
    const style: Record<string, unknown> = {}
    const s = (typeof gg.style === 'object' && gg.style !== null ? gg.style : {}) as Record<string, unknown>
    for (const key of REP_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(s, key)) continue
      const opts = repOptions(s[key])
      if (opts !== null) style[key] = opts
    }
    const ranges = Array.isArray(gg.ranges) ? gg.ranges.filter(isRange).map(r => [r[0], r[1]] as [number, number]) : []
    groups.push({ style, ranges })
  }
  const surfaces: Mol3dLookSurface[] = []
  for (const sf of Array.isArray(l.surfaces) ? l.surfaces : []) {
    const s = sf as Record<string, unknown>
    const type = (SURFACE_TYPES as readonly unknown[]).includes(s.type) ? (s.type as Mol3dLookSurface['type']) : 'MS'
    surfaces.push({
      type,
      opacity: isNum(s.opacity) ? Math.min(1, Math.max(0, s.opacity)) : 1,
      ranges: Array.isArray(s.ranges) ? s.ranges.filter(isRange).map(r => [r[0], r[1]] as [number, number]) : [],
      colors: Array.isArray(s.colors) ? s.colors.map(c => (Number.isInteger(c) ? (c as number) & 0xffffff : 0xffffff)) : [],
    })
  }
  return { v: 1, view, bg, atoms: l.atoms as number, groups, surfaces }
}

/** A coloured surface over the atoms its ranges name. */
function addColouredSurface(viewer: Viewer, model: Model, atoms: Atom[], surf: { type: string; opacity: number; ranges: [number, number][]; colors: number[]; wireframe?: boolean }): void {
  const colours = new Map<number, number>()
  let n = 0
  for (const [a, b] of surf.ranges) {
    for (let k = a; k <= b && k < atoms.length; k++) {
      colours.set(atoms[k].index, surf.colors[n] ?? 0xffffff)
      n++
    }
  }
  if (colours.size === 0) return
  const $3Dmol = (window as any).$3Dmol
  const type = $3Dmol.SurfaceType[surf.type] ?? $3Dmol.SurfaceType.MS
  const style: Record<string, unknown> = { opacity: surf.opacity, colorfunc: (atom: Atom) => colours.get(atom.index) ?? 0xffffff }
  if (surf.wireframe) style.wireframe = true
  // A failed surface build rejects; the structure stays drawn without it.
  void Promise.resolve(viewer.addSurface(type, style, { model, predicate: (atom: Atom) => colours.has(atom.index) })).catch(() => undefined)
}

/** Draws `look` on the model the structure was loaded as; false when it does not fit this structure. */
export function applyMol3dLook(viewer: Viewer, model: Model, look: Mol3dLook): boolean {
  const atoms: Atom[] = model.selectedAtoms({})
  if (look.atoms !== atoms.length) return false
  for (const atom of atoms) atom.style = {}
  for (const g of look.groups) {
    for (const [a, b0] of g.ranges) {
      const b = Math.min(b0, atoms.length - 1)
      for (let k = a; k <= b; k++) {
        const own: Record<string, unknown> = {}
        for (const key of Object.keys(g.style)) own[key] = { ...(g.style[key] as Record<string, unknown>) }
        atoms[k].style = own
      }
    }
  }
  // Writing atom.style directly lets one pass cover every group; an empty
  // additive setStyle then marks the model for a rebuild.
  model.setStyle({}, {}, true)
  for (const s of look.surfaces) addColouredSurface(viewer, model, atoms, s)
  viewer.setBackgroundColor(look.bg)
  return true
}

function rgb01ToHex(c: unknown): string | null {
  if (!Array.isArray(c) || c.length !== 3 || !c.every(isNum)) return null
  let h = 0
  for (const x of c) h = h * 256 + Math.max(0, Math.min(255, Math.round(x * 255)))
  return `#${h.toString(16).padStart(6, '0')}`
}

function numSetting(look: PymolLook, settings: Record<string, unknown>, name: string, dflt: number): number {
  const own = settings[name]
  if (isNum(own)) return own
  const global = look.settings[name]
  return isNum(global) ? global : dflt
}

/** A colour setting as a 0xRRGGBB, or null for the atoms' own colours — the object's own `-1` among them (PT-9090 item 2). */
function colourSetting(look: PymolLook, settings: Record<string, unknown>, name: string): number | null {
  if (settings[name] === PYMOL_LOOK_ATOM_COLOURS) return null
  const v = Array.isArray(settings[name]) ? settings[name] : look.settings[name]
  const hex = rgb01ToHex(v)
  return hex === null ? null : parseInt(hex.slice(1), 16)
}

/**
 * Adds every shown object of a PyMOL look as its own model and draws each
 * atom with PyMOL's representations and colour. Returns the models; empty when
 * the look has no shown object.
 */
export function applyPymolLookTo3dmol(viewer: Viewer, look: PymolLook): Model[] {
  const models: Model[] = []
  for (const obj of look.objects) {
    if (!obj.enabled) continue
    // The look's own check covers its listed words; safeModelText neutralises the text's identifiers (PT-9131).
    const model = viewer.addModel(safeModelText(obj.text, 'cif'), 'cif')
    models.push(model)
    const atoms: Atom[] = model.selectedAtoms({})
    const s = obj.settings as Record<string, unknown>
    const stickR = numSetting(look, s, 'stick_radius', 0.25)
    const sphereS = numSetting(look, s, 'sphere_scale', 1)
    const cartoonOp = 1 - numSetting(look, s, 'cartoon_transparency', 0)
    const stickOp = 1 - numSetting(look, s, 'stick_transparency', 0)
    const sphereOp = 1 - numSetting(look, s, 'sphere_transparency', 0)
    const surfOp = 1 - numSetting(look, s, 'transparency', 0)
    const cCartoon = colourSetting(look, s, 'cartoon_color')
    const cStick = colourSetting(look, s, 'stick_color')
    const cSphere = colourSetting(look, s, 'sphere_color')
    const cSurface = colourSetting(look, s, 'surface_color')
    const pick = (fixed: number | null, mine: number) => (fixed === null ? mine : fixed)
    const surf = { type: 'MS', opacity: surfOp, ranges: [] as [number, number][], colors: [] as number[], wireframe: false }
    for (let i = 0; i < atoms.length; i++) {
      // 3Dmol's CIF parser sets serial to the atom_site row index, and the
      // look's index is the atom whose _atom_site.id is index + 1 (worker.js
      // writes rows in that order): keyed on the file row, never 3Dmol's order.
      const a = atoms[i]
      const row = a.serial as number
      const reps = Number.isInteger(obj.reps[row]) ? obj.reps[row] : 0
      const col = Number.isInteger(obj.color[row]) ? obj.color[row] & 0xffffff : 0xffffff
      const st: Record<string, unknown> = {}
      const lone = !a.bonds || a.bonds.length === 0
      if (reps & PYMOL_REP.cartoon) st.cartoon = { color: pick(cCartoon, col), opacity: cartoonOp }
      else if (reps & PYMOL_REP.ribbon) st.cartoon = { color: col, style: 'trace' }
      if (reps & PYMOL_REP.sticks) st.stick = { color: pick(cStick, col), radius: stickR, opacity: stickOp }
      if (reps & PYMOL_REP.spheres) st.sphere = { color: pick(cSphere, col), scale: sphereS, opacity: sphereOp }
      else if (reps & PYMOL_REP.nb_spheres && lone) st.sphere = { color: col, radius: 0.25 }
      if (reps & PYMOL_REP.lines) st.line = { color: col }
      if (reps & PYMOL_REP.nonbonded && lone) st.cross = { color: col, radius: 0.25 }
      a.style = st
      if (reps & (PYMOL_REP.surface | PYMOL_REP.mesh | PYMOL_REP.dots)) {
        if (reps & PYMOL_REP.mesh && !(reps & PYMOL_REP.surface)) surf.wireframe = true
        surf.ranges.push([i, i])
        surf.colors.push(pick(cSurface, col))
      }
    }
    model.setStyle({}, {}, true)
    if (surf.ranges.length > 0) addColouredSurface(viewer, model, atoms, surf)
  }
  const bg = rgb01ToHex(look.bg)
  if (bg !== null) viewer.setBackgroundColor(bg)
  return models
}

/**
 * The background a look was exported with, as the 3Dmol.js toolbar names
 * it: `white` and `black` are its two swatches, any other colour its third
 * (PT-9109 item 4). No look: white.
 */
export function bgOfLook(mol3d: Mol3dLook | null, pymol: PymolLook | null): string {
  const hex = mol3d !== null ? mol3d.bg : pymol !== null ? rgb01ToHex(pymol.bg) : null
  if (hex === null || !HEX.test(hex)) return 'white'
  const h = hex.toLowerCase()
  return h === '#ffffff' ? 'white' : h === '#000000' ? 'black' : h
}

/**
 * PyMOL's 18-number view as 3Dmol's 8 (the inverse of the 3Dmol-to-PyMOL
 * mapping: the rotation is column-major, 3Dmol's camera sits at z = 150).
 */
export function view3dFromPymol(v: readonly number[] | null): number[] | null {
  if (v === null || v.length !== 18 || !v.every(isNum)) return null
  const [m00, m10, m20, m01, m11, m21, m02, m12, m22] = v
  const tr = m00 + m11 + m22
  let qw: number, qx: number, qy: number, qz: number, s: number
  if (tr > 0) {
    s = Math.sqrt(tr + 1) * 2
    qw = 0.25 * s; qx = (m21 - m12) / s; qy = (m02 - m20) / s; qz = (m10 - m01) / s
  } else if (m00 > m11 && m00 > m22) {
    s = Math.sqrt(1 + m00 - m11 - m22) * 2
    qw = (m21 - m12) / s; qx = 0.25 * s; qy = (m01 + m10) / s; qz = (m02 + m20) / s
  } else if (m11 > m22) {
    s = Math.sqrt(1 + m11 - m00 - m22) * 2
    qw = (m02 - m20) / s; qx = (m01 + m10) / s; qy = 0.25 * s; qz = (m12 + m21) / s
  } else {
    s = Math.sqrt(1 + m22 - m00 - m11) * 2
    qw = (m10 - m01) / s; qx = (m02 + m20) / s; qy = (m12 + m21) / s; qz = 0.25 * s
  }
  const d = -v[11]
  return [-v[12], -v[13], -v[14], 150 - d, qx, qy, qz, qw, v[9], v[10]]
}
