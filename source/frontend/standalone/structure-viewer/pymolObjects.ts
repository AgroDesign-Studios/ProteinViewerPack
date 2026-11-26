/**
 * The phone's object list (owner 2026-11-19: PyMOL's own object panel is not
 * used on a phone; 「PyMOLのオブジェクトメニューは使わずに、別の方法を」):
 * what the worker reports of PyMOL's objects and selections (`objects`, sent
 * when `init` carries objectList: true; `_agdb_objects` in the runtime's
 * `worker.js`), and the one command the page sends to act on one of them.
 *
 * The page never writes a name into a command. It names an entry by its
 * index in the list the worker sent and that list's version (`v`, moved only
 * when the names change); the worker resolves the name itself and refuses a
 * stale version (`_agdb_obj`). Names come from structure files and `.pse`
 * sessions, so they are shown only as text.
 */

/** What an entry is, as the list says it. */
export type PymolObjectKind = 'molecule' | 'selection' | 'group' | 'distance' | 'map' | 'other'

const KINDS: readonly PymolObjectKind[] = ['molecule', 'selection', 'group', 'distance', 'map', 'other']

/** The representations the list shows and hides (PyMOL's names). */
export const PYMOL_REPS = ['cartoon', 'sticks', 'lines', 'spheres', 'surface', 'mesh'] as const
export type PymolRep = (typeof PYMOL_REPS)[number]

/** Colour schemes: by element (carbons kept), by chain, rainbow per chain, by secondary structure, by B factor. */
export const PYMOL_SCHEMES = ['element', 'chain', 'rainbow', 'ss', 'b'] as const
export type PymolScheme = (typeof PYMOL_SCHEMES)[number]

/** Plain colours (PyMOL's names), with the swatch each is drawn as. */
export const PYMOL_SWATCHES = [
  ['red', '#ff0000'],
  ['orange', '#ff8000'],
  ['yellow', '#ffff00'],
  ['green', '#00ff00'],
  ['cyan', '#00ffff'],
  ['blue', '#0000ff'],
  ['magenta', '#ff00ff'],
  ['white', '#ffffff'],
  ['grey70', '#b3b3b3'],
] as const
export type PymolSwatch = (typeof PYMOL_SWATCHES)[number][0]

/** Labels: residue name and number on each CA, atom names, or none. */
export const PYMOL_LABELS = ['residue', 'atom', 'clear'] as const
export type PymolLabel = (typeof PYMOL_LABELS)[number]

export interface PymolObject {
  name: string
  kind: PymolObjectKind
  /** Enabled: an object drawn, a selection's marks shown. */
  on: boolean
}

export interface PymolObjects {
  /** The list's version: an action names an entry by its index in this version. */
  v: number
  items: readonly PymolObject[]
  /** More names than the worker sends (it sends the first 300). */
  more: boolean
  /** The entry whose representations `reps` gives: its index, −1 for 「すべて」, or null. */
  focus: number | null
  /** The representations shown for `focus` (any atom of it), or null. */
  reps: readonly PymolRep[] | null
}

/** What can be done to an entry (−1 = every object, 「すべて」). */
export type ObjectAction =
  | {
      op: 'on' | 'off' | 'hideall' | 'zoom' | 'center' | 'orient' | 'delete' | 'focus' | 'unfocus'
    }
  | { op: 'show' | 'hide'; arg: PymolRep }
  | { op: 'color'; arg: PymolScheme | PymolSwatch }
  | { op: 'label'; arg: PymolLabel }

const NAME_CHARS = 255
const MAX_ITEMS = 300

/** The worker's `objects` report, or null when it is not one (every field checked). */
export function objectsOf(m: Record<string, unknown>): PymolObjects | null {
  const v = m.v
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || !Array.isArray(m.items)) return null
  const items: PymolObject[] = []
  for (const it of m.items.slice(0, MAX_ITEMS)) {
    if (!Array.isArray(it) || typeof it[0] !== 'string' || it[0] === '') return null
    const kind = KINDS.includes(it[1] as PymolObjectKind) ? (it[1] as PymolObjectKind) : 'other'
    items.push({ name: it[0].slice(0, NAME_CHARS), kind, on: it[2] === true })
  }
  const f = m.focus
  const focus = typeof f === 'number' && Number.isInteger(f) && f >= -1 && f < items.length ? f : null
  const reps = focus !== null && Array.isArray(m.reps) ? PYMOL_REPS.filter(r => (m.reps as unknown[]).includes(r)) : null
  return { v, items, more: m.more === true, focus, reps }
}

const ALLOWED: Readonly<Record<ObjectAction['op'], readonly string[] | null>> = {
  on: null,
  off: null,
  hideall: null,
  zoom: null,
  center: null,
  orient: null,
  delete: null,
  focus: null,
  unfocus: null,
  show: PYMOL_REPS,
  hide: PYMOL_REPS,
  color: [...PYMOL_SCHEMES, ...PYMOL_SWATCHES.map(s => s[0])],
  label: PYMOL_LABELS,
}

/**
 * The command that does `action` to entry `index` (−1: every object) of the
 * list at version `v`, or null for an index or argument outside what the
 * worker takes. Only integers and words from the lists above reach it.
 */
export function objectActionCommand(v: number, index: number, action: ObjectAction): string | null {
  if (!Number.isInteger(v) || v < 0 || !Number.isInteger(index) || index < -1) return null
  const allowed = ALLOWED[action.op]
  if (allowed === undefined) return null
  const arg = 'arg' in action ? action.arg : ''
  if (allowed === null ? arg !== '' : !allowed.includes(arg)) return null
  return `_ /_agdb_obj(${v}, ${index}, '${action.op}', '${arg}')`
}
