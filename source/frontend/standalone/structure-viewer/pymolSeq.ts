/**
 * The sequence the page shows over PyMOL's view (owner 2026-11-21:
 * 「PyMOLの右上に『配列』タグをつけて、クリックすると、配列が展開する」 and
 * 「配列を出しているとき配列の文字を…光らせる。また、マウスオーバーと対応した
 * ところの残基が一時的に目立つようにする…左上あたりに半透明にウインドウを出して、
 * どのオブジェクトの何番目のなんという残基かを表示する」).
 *
 * The worker reports, while the page wants it, every polymer residue of the
 * molecules shown — object, chain, residue number, residue name — in
 * PyMOL's order (`seq`, `_agdb_seq` in the runtime's `worker.js`), with a
 * version; the page names a residue to emphasise by its index in the list
 * of that version (`_agdb_seq_hl`), never by a name, as the object list
 * does (`pymolObjects.ts`). Names come from structure files: they are
 * checked here as text and only ever shown as text.
 */

/** One residue: the object's index in `objs`, its chain, its number (insertion code kept), its three-letter name. */
export type SeqResidue = readonly [obj: number, chain: string, resi: string, resn: string]

export interface SeqReport {
  /** The list's version: a residue is named by its index in this version. */
  v: number
  /** The molecules, in PyMOL's order. */
  objs: readonly string[]
  res: readonly SeqResidue[]
  /** More residues than the worker sends (`SEQ_MAX` there). */
  more: boolean
}

/** At most this many residues are listed (the worker's cut, checked again here). */
export const SEQ_MAX = 20000

/** PyMOL's own longest object name (layer1/Setting.h, ObjNameMax). */
const MAX_NAME = 255
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max

/** The worker's `seq` report, or null when anything in it is not as the worker sends it. */
export function seqReportOf(m: Record<string, unknown>): SeqReport | null {
  const { v, objs, res, more } = m
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) return null
  if (!Array.isArray(objs) || objs.length > 300 || !objs.every(o => text(o, MAX_NAME) && o !== '')) return null
  if (!Array.isArray(res) || res.length > SEQ_MAX) return null
  for (const r of res) {
    if (!Array.isArray(r) || r.length !== 4) return null
    const [o, c, i, n] = r as unknown[]
    if (typeof o !== 'number' || !Number.isInteger(o) || o < 0 || o >= objs.length) return null
    if (!text(c, 8) || !text(i, 16) || i === '' || !text(n, 8)) return null
  }
  return { v, objs: objs as string[], res: res as SeqResidue[], more: more === true }
}

/** The one-letter codes PyMOL's own sequence uses, for amino acids and nucleotides; anything else is its name in brackets. */
const ONE: Readonly<Record<string, string>> = {
  ALA: 'A', ARG: 'R', ASN: 'N', ASP: 'D', CYS: 'C', GLN: 'Q', GLU: 'E', GLY: 'G', HIS: 'H', ILE: 'I',
  LEU: 'L', LYS: 'K', MET: 'M', PHE: 'F', PRO: 'P', SER: 'S', THR: 'T', TRP: 'W', TYR: 'Y', VAL: 'V',
  SEC: 'U', PYL: 'O', MSE: 'M', HID: 'H', HIE: 'H', HIP: 'H', HSD: 'H', HSE: 'H', HSP: 'H', CYX: 'C', CSO: 'C', SEP: 'S', TPO: 'T', PTR: 'Y',
  A: 'A', C: 'C', G: 'G', U: 'U', T: 'T', I: 'I', DA: 'A', DC: 'C', DG: 'G', DT: 'T', DU: 'U', DI: 'I',
}

/** A residue as one letter where PyMOL's sequence has one, else its name in brackets. */
export function residueLetter(resn: string): string {
  return ONE[resn.toUpperCase()] ?? `[${resn}]`
}

/** The command that emphasises residue `index` of version `v` (−1: none), quiet and not echoed. */
export function seqHighlightCommand(v: number, index: number): string {
  return `_ /_agdb_seq_hl(${Math.trunc(v)}, ${Math.trunc(index)})`
}

/** The command that starts or stops the worker's `seq` reports (stopping takes any emphasis down). */
export function seqWantCommand(on: boolean): string {
  return `_ /_agdb_seq_want(${on ? 1 : 0})`
}
