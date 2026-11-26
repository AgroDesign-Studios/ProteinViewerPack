/**
 * Files the offline structure file opens from this computer (owner
 * 2026-11-14: 「ファイルを開く」 in the file, and a blank file with no
 * structure in it). A `File` is read in the page — no network: it is sent
 * nowhere — and handed to 3Dmol.js
 * (`addModel(text, format)`) and to PyMOL (the worker's `load`, the formats of
 * `LOAD_FORMATS`; a `.pse` through the restricted unpickler and
 * RESTORE_PY). An entry downloaded from RCSB
 * (`rcsb.ts`) comes through `readStructureFile` the same way.
 */
import { LIMITS } from '../../src/pages/pymol-viewer/pymolFrameProtocol'

/** The extensions the file opens, in the picker's order. Never a map (no atoms to show) and never a pickle but `.pse`. */
export const OPEN_EXTENSIONS = Object.freeze(['pdb', 'ent', 'cif', 'mmcif', 'sdf', 'mol', 'mol2', 'xyz', 'pse'] as const)
export type OpenExtension = (typeof OPEN_EXTENSIONS)[number]

/** The picker's `accept`: the extensions above, dotted. */
export const OPEN_ACCEPT = OPEN_EXTENSIONS.map(e => `.${e}`).join(',')

/**
 * The 3Dmol.js format each extension is read as, or null where 3Dmol.js has
 * no reader (`.pse`, a PyMOL session: PyMOL only).
 */
export const DMOL_FORMAT: Readonly<Record<OpenExtension, string | null>> = Object.freeze({
  pdb: 'pdb',
  ent: 'pdb',
  cif: 'cif',
  mmcif: 'cif',
  sdf: 'sdf',
  mol: 'sdf',
  mol2: 'mol2',
  xyz: 'xyz',
  pse: null,
})

/** Each extension's format by its usual name: what 「構造ファイル（…）」 says it saves. */
const FORMAT_NAME: Readonly<Record<OpenExtension, string>> = Object.freeze({
  pdb: 'PDB',
  ent: 'PDB',
  cif: 'mmCIF',
  mmcif: 'mmCIF',
  sdf: 'SDF',
  mol: 'MOL',
  mol2: 'MOL2',
  xyz: 'XYZ',
  pse: 'PSE',
})

/**
 * The format the structure file export writes, by name: the open file's own
 * (it is saved unchanged), so the label names what is actually saved (UI
 * consult, owner 2026-11-16). An extension outside the list is named itself.
 */
export function formatName(extension: string): string {
  const ext = extension.toLowerCase()
  return Object.prototype.hasOwnProperty.call(FORMAT_NAME, ext) ? FORMAT_NAME[ext as OpenExtension] : ext.toUpperCase()
}

/** A structure the page shows: the file's own (embedded mmCIF) or one opened from this computer. */
export interface StructureDoc {
  /** Shown in the header and used for saved files' names. */
  name: string
  /** The name stem, ASCII, for files the page saves. */
  stem: string
  ext: OpenExtension
  bytes: ArrayBuffer
  /** The bytes as text (every format but `.pse`), for 3Dmol.js. */
  text: string | null
  /** Bumped per opened file: a new one rebuilds the 3Dmol.js pane. */
  serial: number
  /** The PDB ID, when the file was downloaded from RCSB rather than opened from this computer. */
  pdbId?: string
}

export type OpenRefusal = { code: 'format'; ext: string } | { code: 'too-large'; limitMiB: number } | { code: 'empty' } | { code: 'unreadable'; detail: string }

/** The extension of `name`, lower case, if the file opens it. */
export function extensionOf(name: string): OpenExtension | null {
  const dot = name.lastIndexOf('.')
  const ext = dot < 0 ? '' : name.slice(dot + 1).toLowerCase()
  return (OPEN_EXTENSIONS as readonly string[]).includes(ext) ? (ext as OpenExtension) : null
}

/** The most the page reads of one file: PyMOL's own caps (a session's, else a structure's). */
export function capOf(ext: OpenExtension): number {
  return ext === 'pse' ? LIMITS.pseBytes : LIMITS.loadBytes
}

/** An ASCII name stem for what the page saves from this file. */
export function stemOfName(name: string): string {
  const dot = name.lastIndexOf('.')
  const base = dot > 0 ? name.slice(0, dot) : name
  return base.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'structure'
}

let serial = 0

/**
 * Reads one chosen or dropped file, or says why not: an extension the page
 * does not open, nothing in it, or more than PyMOL's cap — checked on the
 * size before a byte is read.
 */
export async function readStructureFile(file: Pick<File, 'name' | 'size' | 'arrayBuffer'>): Promise<{ ok: true; doc: StructureDoc } | { ok: false; why: OpenRefusal }> {
  const ext = extensionOf(file.name)
  if (ext === null) {
    const dot = file.name.lastIndexOf('.')
    return { ok: false, why: { code: 'format', ext: dot < 0 ? '' : file.name.slice(dot + 1, dot + 12) } }
  }
  const cap = capOf(ext)
  if (file.size > cap) return { ok: false, why: { code: 'too-large', limitMiB: Math.round(cap / (1024 * 1024)) } }
  if (file.size === 0) return { ok: false, why: { code: 'empty' } }
  let bytes: ArrayBuffer
  try {
    bytes = await file.arrayBuffer()
  } catch (e) {
    return { ok: false, why: { code: 'unreadable', detail: (e instanceof Error ? e.message : String(e)).slice(0, 200) } }
  }
  if (bytes.byteLength > cap) return { ok: false, why: { code: 'too-large', limitMiB: Math.round(cap / (1024 * 1024)) } }
  const text = ext === 'pse' ? null : new TextDecoder('utf-8').decode(bytes)
  serial += 1
  return { ok: true, doc: { name: file.name.slice(0, 200), stem: stemOfName(file.name), ext, bytes, text, serial } }
}

/** The file's own structure (the embedded mmCIF) as a document. */
export function embeddedDoc(cif: string, stem: string, name: string): StructureDoc {
  return { name, stem, ext: 'cif', bytes: new TextEncoder().encode(cif).buffer as ArrayBuffer, text: cif, serial: 0 }
}

/**
 * The file's own structure in another format than mmCIF (a copy the app made
 * of itself with a file opened from this computer in it, `selfCopy.ts`): the
 * file's own document all the same (serial 0), named by the copy's title.
 */
export function embeddedFileDoc(bytes: ArrayBuffer, ext: OpenExtension, title: string): StructureDoc {
  const name = title || `structure.${ext}`
  return { name, stem: stemOfName(name), ext, bytes, text: ext === 'pse' ? null : new TextDecoder('utf-8').decode(bytes), serial: 0 }
}

/** Residues AgDB's 3D scene draws as polymer (cartoon) rather than as a ligand. */
const POLYMER_RESIDUES: ReadonlySet<string> = new Set([
  'ALA', 'ARG', 'ASN', 'ASP', 'CYS', 'GLN', 'GLU', 'GLY', 'HIS', 'ILE', 'LEU', 'LYS', 'MET', 'PHE', 'PRO', 'SER', 'THR', 'TRP', 'TYR', 'VAL',
  'HID', 'HIE', 'HIP', 'CYX', 'ASH', 'GLH', 'LYN', 'MSE', 'SEC', 'PYL',
  'A', 'C', 'G', 'U', 'DA', 'DC', 'DG', 'DT', 'DU',
])

/**
 * 3Dmol.js's MOL2 reader leaves `hetflag` unset, and AgDB's scene picks the
 * polymer by `hetflag: false` and the ligands by `hetflag: true` — so a MOL2
 * file would draw nothing. Sets it the way the PDB and mmCIF readers would
 * have: false on a polymer residue, true on anything else. 3Dmol.js 2.5.5's
 * MOL2 reader keeps no residue names at all, so today every MOL2 atom is
 * drawn as a ligand (sticks) — the molecule is shown, without a cartoon a
 * MOL2 file cannot give it; PyMOL draws it with its residues.
 */
export function markHetero(atoms: readonly { hetflag?: boolean; resn?: string }[]): void {
  for (const a of atoms) {
    // A MOL2 substructure name carries the residue number (`THR1`): the name is what counts.
    if (a.hetflag === undefined) a.hetflag = !POLYMER_RESIDUES.has(String(a.resn ?? '').trim().toUpperCase().replace(/\d+$/, ''))
  }
}

/** An SD data item's header naming the field 3Dmol.js reads as styling. */
const SD_STYLE_HEADER = /^>\s*<\s*3DMOL_STYLE\s*>/i

/** The styling field's name in a header, renamed to `STYLE_RENAMED` (same length). */
const SD_STYLE_NAME = /3DMOL_STYLE/i
const STYLE_RENAMED = '3DMOL_STYL0'

/**
 * The text of an opened file as 3Dmol.js may read it. 3Dmol.js reads a
 * `> <3DMOL_STYLE>` SD data item as styling, and AgDB's scene sets every style
 * itself, so SDF style fields are neutralised before parsing (PR #8239
 * review): in SDF/MOL text the item's header is renamed to `3DMOL_STYL0`, at
 * the same length, and 3Dmol.js passes the item over as any other data field.
 * No line is dropped, so a record title or another line that only looks like
 * such a header stays where it was and no record shifts (PT-9244 item 5,
 * PR #8340; `safeModelText` renames in place the same way, PT-9249 item 1).
 * The lines are split as 3Dmol.js splits them, so every line-break form is
 * handled. `Mol3dPane` hands every text, this one included, through
 * `safeModelText` (`src/components/structure-viewer/safeModelText.ts`), which
 * neutralises reserved identifiers before parsing (PT-9131). See the tests.
 */
export function textFor3dmol(text: string, dmolFormat: string): string {
  if (dmolFormat !== 'sdf') return text
  // Lines as 3Dmol.js splits them (`/\r?\n|\r/`, SDF.ts), each with the break
  // after it: parts[2k] is line k and parts[2k + 1] the break after it.
  const parts = text.split(/(\r\n|\r|\n)/)
  for (let i = 0; i < parts.length; i += 2) {
    if (SD_STYLE_HEADER.test(parts[i])) parts[i] = parts[i].replace(SD_STYLE_NAME, STYLE_RENAMED)
  }
  return parts.join('')
}

/**
 * Words PyMOL reads as selection syntax or keeps for itself: an object named
 * after a file `model.pdb` or `all.pdb` would make `count_atoms(obj)` and
 * every selection naming it mean something else (PR #8239 review), and PyMOL
 * renames one named after an argument keyword (`and` → `and_`). Checked
 * against the bundled PyMOL itself (an automated browser test, 2026-11-15, PT-9132
 * item 3): every word below that PyMOL refuses or renames as an object name
 * is here — the second block was found that way — and the rest are names
 * PyMOL makes itself (`sele`, `pk1`…) or representation names, kept clear of.
 * PyMOL has no call that lists its selection keywords to the page.
 */
const PYMOL_RESERVED: ReadonlySet<string> = new Set(
  (
    'all none sele enabled visible center origin same and or not in like within around expand gap near_to beyond ' +
    'model chain segi segid resn resi resv name alt elem ss b q id ID index rank state polymer organic inorganic ' +
    'solvent hetatm hydro hydrogens metals backbone sidechain guide bonded protected fixed restrained masked flag ' +
    'present first last object byres bychain bymolecule byobject bysegi byfragment neighbor pepseq ps ' +
    'pk1 pk2 pk3 pk4 pkmol pkresi pkchain pkobject cartoon sticks lines spheres surface mesh dots ribbon labels ' +
    'het symbol x y z bound_to extend donors acceptors formal_charge partial_charge text_type numeric_type stereo ' +
    'rep color cartoon_color ribbon_color label custom byring bycell bycalpha delocalized resid segment residue element'
  )
    .split(' ')
    .map(w => w.toLowerCase()),
)

/** The PyMOL object name for an opened file: its stem, or `f_<stem>` when PyMOL keeps that word. */
export function objectNameOf(stem: string): string {
  return PYMOL_RESERVED.has(stem.toLowerCase()) ? `f_${stem}` : stem
}

/**
 * Makes `Object.prototype` and `Array.prototype` non-extensible; called once,
 * before any file is read, so a parser can add no new key to them (PT-9131).
 * Reserved identifiers are neutralised before parsing by `safeModelText`; see
 * the tests. Freezing both prototypes instead was measured (PT-9131,
 * 2026-11-15) and rejected: a frozen key turns an ordinary
 * `obj.toString = …` into a TypeError in strict code (3Dmol.js's own NetCDF
 * reader does that in a class constructor).
 */
export function lockSharedPrototypes(): void {
  Object.preventExtensions(Object.prototype)
  Object.preventExtensions(Array.prototype)
}
