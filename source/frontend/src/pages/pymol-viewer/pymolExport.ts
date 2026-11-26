import { saveTextFile } from '../../lib/saveTextFile'
import { WITHDRAWN } from './pymolBusy'
import type { PymolExportFrame } from './pymolExportFrame'
import { isSelectionExpression, MOL_FORMATS, type MolFormat } from './pymolFrameProtocol'

/**
 * The PyMOL page's molecule export (PT-3615 item 1): the atoms of a selection,
 * in their current state, as one PDB, mmCIF, SDF or MOL2 file the user
 * downloads.
 *
 * The bytes come out of the frame, which is untrusted, so they are treated
 * like a png or a pse: asked for with a click-scoped nonce through
 * the export gate (`requestExport('mol', …)`), capped at 32 MiB, and then
 * checked here before anything is saved — UTF-8 text, no NUL, and the record
 * that makes the format (`checkMolFile`). The file name is this page's own,
 * never the frame's, and its extension is fixed by the format. Nothing is
 * uploaded: the file goes to the user's disk only. A whole session (`.pse`)
 * is saved by `PymolPseExportDialog`, never through here.
 */

/** What to write, as the dialog offers it. `custom` takes the user's expression. */
export const EXPORT_TARGETS = Object.freeze(['sele', 'all', 'ligand', 'polymer', 'custom'] as const)
export type ExportTarget = (typeof EXPORT_TARGETS)[number]

/**
 * The PyMOL selection each fixed target writes. `sele` is PyMOL's current
 * selection (a click or a drag in the frame makes it); `all` includes hidden
 * objects and every loaded structure; `organic` is PyMOL's own
 * small-molecule class (no water, no ions). None falls back to another: an
 * unknown or empty selection is an error the user is told about.
 */
export const TARGET_SELECTION: Readonly<Record<Exclude<ExportTarget, 'custom'>, string>> = Object.freeze({
  sele: 'sele',
  all: 'all',
  ligand: 'organic',
  polymer: 'polymer',
})

/** The selection a target writes, or null for a custom expression that cannot be sent. */
export function selectionFor(target: ExportTarget, custom: string): string | null {
  if (target !== 'custom') return TARGET_SELECTION[target]
  const s = custom.trim()
  return isSelectionExpression(s) ? s : null
}

/** Characters no Windows file name may hold, and control characters. */
const FORBIDDEN = /[<>:"/\\|?*\x00-\x1f\x7f]/g
/**
 * The names Windows keeps for devices, whatever follows them after spaces or
 * a dot: no file called `CON.pdb`, `com1 .sdf` or `CONIN$.pdb` can be made
 * there.
 */
const DEVICE_NAME = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$)(?=[.\s]|$)/i
export const FILE_STEM_MAX = 100

/**
 * A file-name stem the user may edit: forbidden characters become `_`,
 * leading and trailing dots and spaces go (Windows drops them silently), a
 * name Windows keeps for a device (`CON`, `NUL`, `COM1`, `CONIN$` …) gets a
 * `_` after it, and it is cut to `FILE_STEM_MAX`. The device name is matched
 * before a space as well as a dot or the end, so spaces the cut leaves
 * trailing cannot uncover one (PT-3816 item 15, PT-4164 item 2). Empty after
 * that: `fallback`.
 */
export function cleanFileStem(raw: string, fallback: string): string {
  const s = raw.replace(FORBIDDEN, '_').replace(/^[.\s]+|[.\s]+$/g, '').replace(DEVICE_NAME, '$1_')
  const cut = [...s].slice(0, FILE_STEM_MAX).join('').replace(/[.\s]+$/, '')
  return cut === '' ? fallback : cut
}

const pad2 = (n: number) => String(n).padStart(2, '0')

/**
 * The stem the dialog starts from: `<object>_<target>_<yyyyMMdd-HHmm>`, ASCII.
 * The session dialog passes `session` for the target.
 */
export function defaultFileStem(objectName: string, target: ExportTarget | 'session', now: Date): string {
  const stamp = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}-${pad2(now.getHours())}${pad2(now.getMinutes())}`
  const obj = objectName.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 40) || 'pymol'
  return `${obj}_${target}_${stamp}`
}

/**
 * The stem a press saves under, for both export dialogs (PT-9126 item 4). An
 * untouched name is made again now, so its time is the press's (PT-3816 item
 * 19); a typed one is cleaned. A typed name that cleans to nothing counts as
 * untouched again (`edited` false), or the made name the field then shows
 * would be held as typed: a change of target would no longer rename it
 * (PT-4213).
 */
export function fileStemAtPress(a: { stem: string; edited: boolean; objectName: string; target: ExportTarget | 'session'; now: Date }): { name: string; edited: boolean } {
  const typed = a.edited ? cleanFileStem(a.stem, '') : ''
  return typed === '' ? { name: defaultFileStem(a.objectName, a.target, a.now), edited: false } : { name: typed, edited: true }
}

export type MolCheck = { ok: true; text: string } | { ok: false; reason: 'not-text' | 'no-atoms' }

/** The line each format's file cannot lack (`checkMolFile`). */
export const MOL_RECORD: Readonly<Record<MolFormat, RegExp>> = Object.freeze({
  pdb: /^(ATOM {2}|HETATM)/m,
  cif: /^_atom_site\./m,
  sdf: /^M {2}END\s*$/m,
  mol2: /^@<TRIPOS>ATOM\s*$/m,
})

/**
 * Whether bytes from the frame are a file of the requested format. Not a
 * parser, and not what makes a file from the frame safe: it refuses what
 * plainly is not one — bytes that are not UTF-8 text (a pickle of protocol 2
 * or later is among them), a NUL, no ATOM / HETATM record for PDB, no
 * `_atom_site.` loop for mmCIF, no `M  END` line for SDF, no
 * `@<TRIPOS>ATOM` section for MOL2 — so a failed export is never handed over
 * under the format's name (`MOL_RECORD`). Text the frame chose to write passes: an SDF with no
 * atoms, or ATOM lines after a protocol-0 pickle. What keeps such a file
 * harmless is that only the user's press starts an export, the page picks
 * the name and the extension, and the file reaches the user's own disk
 * only (PT-3816 item 4).
 */
export function checkMolFile(bytes: ArrayBuffer, format: MolFormat): MolCheck {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return { ok: false, reason: 'not-text' }
  }
  if (text.includes('\u0000')) return { ok: false, reason: 'not-text' }
  return MOL_RECORD[format].test(text) ? { ok: true, text } : { ok: false, reason: 'no-atoms' }
}

/** Why an export did not end in a file, for the dialog to say. */
export type ExportFailure =
  | { code: 'bad-selection' }
  | { code: 'cancelled' }
  | { code: 'withdrawn' }
  | { code: 'too-large' }
  | { code: 'not-text' }
  | { code: 'no-atoms' }
  | { code: 'empty-selection' }
  | { code: 'unknown-selection'; detail: string }
  | { code: 'failed'; detail: string }

export class PymolExportError extends Error {
  readonly failure: ExportFailure
  constructor(failure: ExportFailure) {
    super(failure.code)
    this.name = 'PymolExportError'
    this.failure = failure
  }
}

/**
 * The worker's own refusals (`worker.js` EXPORT_PY), by the text it starts
 * with, and the controller's stop and withdrawal. Shared with the session
 * dialog (`PymolPseExportDialog`), whose request ends the same ways (PT-9126
 * item 4).
 */
export function exportFailureOf(e: unknown): ExportFailure {
  const detail = e instanceof Error ? e.message : String(e)
  if (detail === 'cancelled') return { code: 'cancelled' }
  if (detail === WITHDRAWN) return { code: 'withdrawn' }
  if (detail === 'export-too-large') return { code: 'too-large' }
  if (detail.startsWith('export: no atoms in the selection')) return { code: 'empty-selection' }
  if (detail.startsWith('export: invalid selection')) return { code: 'unknown-selection', detail: detail.slice('export: invalid selection'.length).replace(/^:\s*/, '') }
  return { code: 'failed', detail }
}

/**
 * Ask the frame for one molecule file and hand it to the browser as a
 * download. Resolves with the file name and its size; rejects with a
 * `PymolExportError`. `signal` withdraws the request while it still waits
 * in the frame's queue (`requestExport`); `onSent` is told when it leaves
 * that queue for PyMOL (PT-9232 item 1). `wanted`, asked once the file has
 * passed its checks, skips the save when it answers false — the dialog that
 * asked is gone (PT-3827 item 11).
 */
export async function exportMolecule(a: {
  frame: Pick<PymolExportFrame, 'requestExport'>
  format: MolFormat
  selection: string | null
  stem: string
  save?: (text: string, stem: string, extension: string, mime: string) => void
  wanted?: () => boolean
  signal?: AbortSignal
  onSent?: () => void
}): Promise<{ name: string; bytes: number }> {
  if (a.selection === null || !isSelectionExpression(a.selection)) throw new PymolExportError({ code: 'bad-selection' })
  if (!(MOL_FORMATS as readonly string[]).includes(a.format)) throw new PymolExportError({ code: 'failed', detail: a.format })
  let bytes: ArrayBuffer
  try {
    bytes = (await a.frame.requestExport('mol', { format: a.format, selection: a.selection, signal: a.signal, onSent: a.onSent })).bytes
  } catch (e) {
    throw new PymolExportError(exportFailureOf(e))
  }
  const check = checkMolFile(bytes, a.format)
  if (!check.ok) throw new PymolExportError({ code: check.reason })
  if (a.wanted?.() !== false) (a.save ?? saveTextFile)(check.text, a.stem, a.format, 'text/plain')
  return { name: `${a.stem}.${a.format}`, bytes: bytes.byteLength }
}
