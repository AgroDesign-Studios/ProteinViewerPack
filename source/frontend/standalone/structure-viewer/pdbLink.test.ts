/** The PDB ID before the structure's name (owner 2026-11-19): only when the app knows it came from the PDB. */
import { describe, expect, it } from 'vitest'

import { rcsbEntryUrl, shownPdbId } from './pdbLink'

describe('shownPdbId', () => {
  it('a structure opened from the PDB in this app: its ID, the short form', () => {
    expect(shownPdbId({ embedded: false, structureId: 0, code: null, docPdbId: '1crn' })).toBe('1CRN')
    expect(shownPdbId({ embedded: false, structureId: 0, code: null, docPdbId: 'pdb_00001crn' })).toBe('1CRN')
  })

  it('a copy of the app (no database structure): the PDB ID it was opened with', () => {
    expect(shownPdbId({ embedded: true, structureId: 0, code: '25HN', docPdbId: undefined })).toBe('25HN')
    expect(shownPdbId({ embedded: true, structureId: 0, code: null, docPdbId: undefined })).toBeNull()
  })

  it('none for an exported structure with an ID other than 0 (its code may be any display code), a local file, or no PDB ID', () => {
    expect(shownPdbId({ embedded: true, structureId: 42, code: '1CRN', docPdbId: undefined })).toBeNull()
    expect(shownPdbId({ embedded: false, structureId: 42, code: '1CRN', docPdbId: undefined })).toBeNull()
    expect(shownPdbId({ embedded: true, structureId: 0, code: 'my-compound', docPdbId: undefined })).toBeNull()
  })
})

describe('rcsbEntryUrl', () => {
  it('names RCSB PDB’s entry page', () => {
    expect(rcsbEntryUrl('1CRN')).toBe('https://www.rcsb.org/structure/1CRN')
    expect(rcsbEntryUrl('pdb_00009xyz')).toBe('https://www.rcsb.org/structure/pdb_00009xyz')
  })
})
