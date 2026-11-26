import { normalizePdbId } from './rcsb'

/**
 * RCSB PDB's page for one entry. Only ever a link the reader opens in a new
 * tab: the app connects to nothing here (the page's CSP `connect-src` names
 * RCSB's file server alone, `boundary.test.ts`).
 */
export const RCSB_ENTRY_PAGE = 'https://www.rcsb.org/structure/'

/** The entry's RCSB PDB page, for an ID `shownPdbId` gave. */
export function rcsbEntryUrl(id: string): string {
  return RCSB_ENTRY_PAGE + encodeURIComponent(id)
}

/**
 * The PDB ID shown before the structure's name, linked to its RCSB PDB page
 * (owner 2026-11-19: PDB からダウンロードした構造は、タンパク質名の前に
 * PDB ID（短い方）), or null. Only when the app knows the structure came
 * from the PDB, never guessed from a code's shape (UI consult, Codex astra):
 * - a structure opened from the PDB by its ID in this app (`docPdbId`);
 * - the structure a copy of this app carries with `structureId` 0: its code is the PDB ID it was opened with
 *   (`selfCopy.ts`, and the release's sample, `viewer_pack_release.mjs`).
 * A structure with any other ID carries a display code, which may be no PDB
 * ID at all: none.
 * The short ID (`1CRN`, not `pdb_00001crn`) where there is one.
 */
export function shownPdbId(source: { embedded: boolean; structureId: number; code: string | null; docPdbId: string | undefined }): string | null {
  const { embedded, structureId, code, docPdbId } = source
  if (embedded) return structureId === 0 && code ? normalizePdbId(code) : null
  return docPdbId === undefined ? null : normalizePdbId(docPdbId)
}
