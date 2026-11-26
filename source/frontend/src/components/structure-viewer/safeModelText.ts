/**
 * The text every `addModel` hands to 3Dmol.js (PT-9131). Structure files are
 * untrusted data, so SDF style fields and reserved identifiers are
 * neutralised before parsing (see the tests). Before 3Dmol.js reads the text,
 * this module:
 *
 * - renames every occurrence of the name `3DMOL_STYLE`, in any case, in text
 *   3Dmol.js may read with its SDF reader (`mayReadAsSdf`: SDF / MOL, an
 *   unknown format, a guess), so the reader passes such an SD data item over
 *   (AgDB sets every style itself);
 * - renames every occurrence of a name a plain object inherits from
 *   `Object.prototype` (`__proto__`, `constructor`, `toString`, ...), wherever
 *   it stands and in any of the readings described at `INHERITED_ANYWHERE`,
 *   keeping the text's length (fixed-column formats).
 *
 * The keys checked are the ones 3Dmol.js 2.5.5's text readers (CIF, PDB/PDBQT,
 * SDF, MOL2, XYZ) and `GLModel.ts` take from the file's content. A 3Dmol.js
 * upgrade needs that read again.
 *
 * Only 3Dmol.js's copy is altered: the bytes kept, exported or handed to
 * PyMOL are the file's own. None of 30,000 randomly sampled PDB mmCIF entries
 * holds one of the names anywhere, in any of those readings (measured
 * 2026-11-15), so a real file reaches 3Dmol.js unchanged.
 */

/**
 * The names a plain object inherits from `Object.prototype` (its own keys in
 * every current engine; `safeModelText.test.ts` checks the list against the
 * test runtime's). Each occurrence in a file, in any letter case (3Dmol.js
 * lower-cases mmCIF item names), is altered.
 */
export const INHERITED_NAMES: readonly string[] = Object.freeze([
  '__proto__',
  '__defineGetter__',
  '__defineSetter__',
  '__lookupGetter__',
  '__lookupSetter__',
  'constructor',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
  'toLocaleString',
  'toString',
  'valueOf',
])

/**
 * One of the names anywhere in the text, in each spelling a reader could
 * normalise to it: any letter case, `_` or `.`, and quotes between its
 * letters.
 */
const INHERITED_ANYWHERE = new RegExp(
  INHERITED_NAMES.map(name => [...name].map(c => (c === '_' ? '[_.]' : c)).join(`["']*`)).join('|'),
  'gi',
)

/**
 * `text` with every occurrence of an inherited name altered, or `text` itself
 * when it holds none. The occurrence's last character becomes `0`: no name
 * holds a digit, so an altered text holds no name there in any of the
 * readings above, and the length stays. Repeated until none is left (an
 * overlapping occurrence the first pass stepped over).
 */
export function withoutInheritedNames(text: string): string {
  let out = text
  for (;;) {
    INHERITED_ANYWHERE.lastIndex = 0
    if (!INHERITED_ANYWHERE.test(out)) return out
    INHERITED_ANYWHERE.lastIndex = 0
    out = out.replace(INHERITED_ANYWHERE, m => m.slice(0, -1) + '0')
  }
}

/**
 * 3Dmol.js's readers other than SDF (its `Parsers` table, 2.5.5). Any other
 * format string reaches the SDF reader by name (`sdf`) or may reach it by
 * 3Dmol.js's guess from the content (`mol`, or anything it does not know:
 * `GLModel.parseMolData`), so its style items lose their name.
 */
const NOT_SDF: ReadonlySet<string> = new Set([
  'vasp', 'VASP', 'cube', 'CUBE', 'xyz', 'XYZ', 'json', 'cdjson', 'CDJSON', 'mcif', 'cif', 'CIF', 'mol2', 'MOL2',
  'pdb', 'PDB', 'pdbqt', 'PDBQT', 'pqr', 'PQR', 'mmtf', 'MMTF', 'prmtop', 'PRMTOP', 'gro', 'GRO', 'lammpstrj',
  'LAMMPSTRJ', 'bcif', 'BCIF',
])

/** Whether 3Dmol.js may read text given as `format` with its SDF reader (`parseMolData`: the name, else its last dotted part, else a guess). */
export function mayReadAsSdf(format: string): boolean {
  return !NOT_SDF.has(format) && !NOT_SDF.has(format.split('.').pop() ?? '')
}

/** The name of the SD data item 3Dmol.js reads as styling, in any letter case. */
const SD_STYLE_NAME = /3DMOL_STYLE/gi

/**
 * SDF/MOL text in which no data item is named `3DMOL_STYLE`: every
 * occurrence of the name, anywhere and in any letter case, has its last
 * character made `0`, as `withoutInheritedNames` does. 3Dmol.js's reader
 * styles from an item only when the name between its header's `<` and `>`,
 * trimmed, IS `3DMOL_STYLE` (`SDF.ts` `parseSDProperties`: `propName ===
 * "3DMOL_STYLE"`); a renamed item is read as one it does not know and passed
 * over with its data lines.
 *
 * Renamed, not dropped (PT-9244 item 5): no line is added or taken away and
 * none changes length, so a record reads the same lines it did. Dropping an
 * item would mean guessing from the text alone where a record's items start
 * (PT-9223 item 1); renaming needs no guess.
 */
export function withoutSdStyleItems(text: string): string {
  return text.replace(SD_STYLE_NAME, m => m.slice(0, -1) + '0')
}

/** The text to hand to 3Dmol.js's `addModel(…, format)` / `addModelsAsFrames`: both steps above. */
export function safeModelText(text: string, format: string): string {
  return withoutInheritedNames(mayReadAsSdf(format) ? withoutSdStyleItems(text) : text)
}
