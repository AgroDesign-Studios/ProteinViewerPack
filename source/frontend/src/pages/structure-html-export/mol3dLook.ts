/**
 * The 3Dmol look of a live viewer, frozen into plain data for the standalone
 * HTML export: every atom's representation with its
 * colour resolved to a number, the surfaces, the background and the camera.
 *
 * Why frozen: the viewer paints with colour SCHEMES (`colorscheme`, a
 * `colorfunc` closure, a cartoon `color: 'spectrum'` gradient that 3Dmol
 * resolves over the whole model at draw time). None of those survive JSON,
 * and a scheme re-evaluated in another file could resolve differently. A
 * concrete colour per atom draws the same picture anywhere.
 *
 * The standalone page loads the SAME mmCIF text with the same parser call the
 * card uses (`addModel(safeModelText(text, 'cif'), 'cif')`, which alters no
 * atom's place in the text, PT-9131), so an atom's position in the model is
 * the key; `atoms` lets the page refuse a look whose count does not match.
 *
 * Not carried (the export dialog lists them): labels, shapes (contours,
 * boxes), other models (symmetry mates, any further model).
 */
import { builtSurface } from '../../components/structure-viewer/surfaceController'
import { SURFACE_TYPE_DEFAULT, type SurfaceTypeKey } from '../../components/structure-viewer/surfaceType'

export interface Mol3dLookGroup {
  /** A 3Dmol AtomStyleSpec with every colour a plain 0xRRGGBB number. */
  style: Record<string, unknown>
  /** Inclusive [first, last] atom positions in the model. */
  ranges: [number, number][]
}

export interface Mol3dLookSurface {
  type: 'VDW' | 'MS' | 'SAS' | 'SES'
  opacity: number
  /** The atoms the surface is drawn over, inclusive ranges. */
  ranges: [number, number][]
  /** One 0xRRGGBB per atom in `ranges`, in range order. */
  colors: number[]
}

export interface Mol3dLook {
  v: 1
  /** `viewer.getView()`: 8 numbers. */
  view: number[]
  /** '#rrggbb'. */
  bg: string
  /** Atom count of the model when it was frozen (an addition to the spec'd shape). */
  atoms: number
  groups: Mol3dLookGroup[]
  surfaces: Mol3dLookSurface[]
}

/** The representation keys of a 3Dmol atom style that draw something. */
const REP_KEYS = ['line', 'cross', 'stick', 'sphere', 'cartoon'] as const

/** Keys whose values are colour inputs, replaced by the resolved `color`. */
const COLOUR_KEYS = new Set(['color', 'colorscheme', 'colorfunc'])

const SURFACE_KEYS: readonly SurfaceTypeKey[] = ['VDW', 'MS', 'SAS', 'SES']

type Lib = {
  getColorFromStyle: (atom: unknown, style: unknown) => { getHex: () => number }
  Gradient?: { builtinGradients?: Record<string, new (min: number, max: number) => { valueToHex: (v: number) => number }> }
  SurfaceType?: Record<string, unknown>
}

type Atom = Record<string, unknown> & { style?: Record<string, Record<string, unknown> | undefined> }

/** A JSON-safe copy: functions and undefined dropped, numbers finite. */
function plain(value: unknown, depth = 0): unknown {
  if (depth > 6) return undefined
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (Array.isArray(value)) return value.map(v => plain(v, depth + 1)).filter(v => v !== undefined)
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value as object).sort()) {
      const v = plain((value as Record<string, unknown>)[key], depth + 1)
      if (v !== undefined) out[key] = v
    }
    return out
  }
  return undefined
}

/** Inclusive ranges from ascending positions. */
function toRanges(positions: readonly number[]): [number, number][] {
  const out: [number, number][] = []
  for (const p of positions) {
    const last = out[out.length - 1]
    if (last && p === last[1] + 1) last[1] = p
    else out.push([p, p])
  }
  return out
}

function hexColour(n: number): string {
  return '#' + (n & 0xffffff).toString(16).padStart(6, '0')
}

/**
 * The cartoon colour 3Dmol draws for a `color: 'spectrum'` atom: a builtin
 * gradient (the cartoon's `colorscheme` when it names one, else sinebow) built
 * REVERSED over the residue range of every visible, non-hetero spectrum
 * cartoon atom in the model (`GLModel.createMolObj` + `glcartoon.drawCartoon`,
 * 3Dmol 2.5).
 */
function spectrumResolver(lib: Lib, atoms: readonly Atom[]): ((atom: Atom, cartoon: Record<string, unknown>) => number) | null {
  const range = [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]
  for (const atom of atoms) {
    const c = atom.style?.cartoon
    if (!c || c.hidden || c.color !== 'spectrum' || typeof atom.resi !== 'number' || atom.hetflag) continue
    range[0] = Math.min(range[0], atom.resi)
    range[1] = Math.max(range[1], atom.resi)
  }
  const builtins = lib.Gradient?.builtinGradients
  if (!builtins) return null
  const cache = new Map<string, { valueToHex: (v: number) => number }>()
  return (atom, cartoon) => {
    const name = typeof cartoon.colorscheme === 'string' && cartoon.colorscheme in builtins ? cartoon.colorscheme : 'sinebow'
    let grad = cache.get(name)
    if (!grad) {
      grad = new builtins[name](range[1], range[0])
      cache.set(name, grad)
    }
    return grad.valueToHex(Number(atom.resi)) & 0xffffff
  }
}

/** One representation with its colour resolved for `atom`. */
function frozenRep(
  lib: Lib,
  atom: Atom,
  key: string,
  spec: Record<string, unknown>,
  spectrum: ReturnType<typeof spectrumResolver>,
): Record<string, unknown> {
  let colour: number
  if (key === 'cartoon' && spec.color === 'spectrum' && spectrum && typeof atom.resi === 'number') {
    colour = spectrum(atom, spec)
  } else {
    colour = lib.getColorFromStyle(atom, spec).getHex() & 0xffffff
  }
  const rest: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(spec)) if (!COLOUR_KEYS.has(k)) rest[k] = v
  const out = (plain(rest) ?? {}) as Record<string, unknown>
  out.color = colour
  return out
}

function surfaceKey(lib: Lib, type: number | undefined): SurfaceTypeKey {
  const table = lib.SurfaceType ?? {}
  for (const key of SURFACE_KEYS) if (table[key] === type) return key
  return SURFACE_TYPE_DEFAULT
}

/**
 * Snapshot the look of model `modelIndex` of a live 3Dmol viewer.
 *
 * Throws when the viewer has no such model or 3Dmol is not loaded — the
 * caller then exports without a 3Dmol look (the file falls back to its own
 * default display).
 */
export function freeze3dmolLook(viewer: unknown, modelIndex = 0): Mol3dLook {
  const lib = (globalThis as { $3Dmol?: Lib }).$3Dmol
  if (!lib || typeof lib.getColorFromStyle !== 'function') throw new Error('3Dmol is not loaded')
  // 3Dmol publishes no types (vibe-coding §6.4, 3D viewer exception).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const v = viewer as any
  const model = typeof v?.getModel === 'function' ? v.getModel(modelIndex) : null
  if (!model || typeof model.selectedAtoms !== 'function') throw new Error(`no model ${modelIndex}`)
  const atoms: Atom[] = model.selectedAtoms({})
  const position = new Map<unknown, number>()
  atoms.forEach((a, i) => position.set(a, i))

  // ---- per-atom styles, grouped by their frozen JSON ----------------------
  const spectrum = spectrumResolver(lib, atoms)
  const byKey = new Map<string, { style: Record<string, unknown>; positions: number[] }>()
  atoms.forEach((atom, i) => {
    const style = atom.style
    if (!style) return
    const frozen: Record<string, unknown> = {}
    for (const key of REP_KEYS) {
      const spec = style[key]
      if (!spec || typeof spec !== 'object' || spec.hidden === true) continue
      frozen[key] = frozenRep(lib, atom, key, spec, spectrum)
    }
    if (Object.keys(frozen).length === 0) return
    const json = JSON.stringify(frozen)
    let group = byKey.get(json)
    if (!group) {
      group = { style: frozen, positions: [] }
      byKey.set(json, group)
    }
    group.positions.push(i)
  })
  const groups = [...byKey.values()].map(g => ({ style: g.style, ranges: toRanges(g.positions) }))

  // ---- surfaces over this model --------------------------------------------
  const surfaces: Mol3dLookSurface[] = []
  const held = builtSurface(viewer)
  const table: Record<string, unknown> = v.surfaces && typeof v.surfaces === 'object' ? v.surfaces : {}
  for (const [id, surf] of Object.entries(table)) {
    if (!Array.isArray(surf) || surf.length === 0) continue
    const s = surf as unknown[] & { style?: Record<string, unknown>; atomsel?: Record<string, unknown> }
    const mine = held !== null && String(held.surfid) === id ? held.request : null
    // The controller restyles in place (`setSurfaceMaterialStyle`), which
    // leaves `surf.style` at the build-time material; its request is current.
    const style: Record<string, unknown> = mine ? { ...mine.style } : { ...(s.style ?? {}) }
    let picked: unknown[] = []
    try {
      picked = typeof v.selectedAtoms === 'function' ? v.selectedAtoms(s.atomsel ?? {}) : []
    } catch {
      picked = []
    }
    const positions = picked
      .map(a => position.get(a))
      .filter((p): p is number => p !== undefined)
      .sort((a, b) => a - b)
    if (positions.length === 0) continue
    const colors = positions.map(p => lib.getColorFromStyle(atoms[p], style).getHex() & 0xffffff)
    const part = s[0] as { mat?: { opacity?: unknown } }
    const matOpacity = part?.mat?.opacity
    const opacity = typeof matOpacity === 'number' && Number.isFinite(matOpacity)
      ? matOpacity
      : typeof style.opacity === 'number' ? style.opacity : 1
    surfaces.push({
      type: surfaceKey(lib, mine?.type),
      opacity: Math.min(1, Math.max(0, opacity)),
      ranges: toRanges(positions),
      colors,
    })
  }

  const rawView: unknown = typeof v.getView === 'function' ? v.getView() : null
  const view = Array.isArray(rawView) && rawView.length >= 8 && rawView.slice(0, 8).every(n => Number.isFinite(n))
    ? (rawView.slice(0, 8) as number[])
    : [0, 0, 0, 0, 0, 0, 0, 1]
  const bg = typeof v.bgColor === 'number' ? hexColour(v.bgColor) : '#ffffff'
  return { v: 1, view, bg, atoms: atoms.length, groups, surfaces }
}
