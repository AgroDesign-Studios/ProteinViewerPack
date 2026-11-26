/**
 * The page's sequence (owner 2026-11-21: the 『配列』 tag): the worker's
 * report read as data, a residue as a letter, the commands that ask for it.
 */
import { describe, expect, it } from 'vitest'

import { residueLetter, SEQ_MAX, seqHighlightCommand, seqReportOf, seqWantCommand } from './pymolSeq'

describe('seqReportOf', () => {
  const ok = { type: 'seq', v: 2, objs: ['Structure_25HN', 'ligand'], res: [[0, 'A', '1', 'MET'], [0, 'A', '52A', 'GLY'], [1, '', '-3', 'DA']], more: false }

  it('keeps a report as the worker sends it', () => {
    expect(seqReportOf(ok)).toEqual({ v: 2, objs: ['Structure_25HN', 'ligand'], res: ok.res, more: false })
    expect(seqReportOf({ ...ok, res: [], more: true })?.more).toBe(true)
  })

  it('refuses anything else: a bad version, object index, field or size', () => {
    expect(seqReportOf({ ...ok, v: -1 })).toBeNull()
    expect(seqReportOf({ ...ok, v: 1.5 })).toBeNull()
    expect(seqReportOf({ ...ok, objs: [''] })).toBeNull()
    expect(seqReportOf({ ...ok, objs: ['x'.repeat(129)] })).toBeNull()
    expect(seqReportOf({ ...ok, res: [[2, 'A', '1', 'MET']] })).toBeNull()
    expect(seqReportOf({ ...ok, res: [[0, 'A', '', 'MET']] })).toBeNull()
    expect(seqReportOf({ ...ok, res: [[0, 'A', '1']] })).toBeNull()
    expect(seqReportOf({ ...ok, res: [[0, 'ABCDEFGHI', '1', 'MET']] })).toBeNull()
    expect(seqReportOf({ ...ok, res: Array.from({ length: SEQ_MAX + 1 }, () => [0, 'A', '1', 'MET']) })).toBeNull()
  })
})

describe('residueLetter', () => {
  it('is PyMOL’s one letter for amino acids and nucleotides, else the name in brackets', () => {
    expect(['ALA', 'gly', 'MSE', 'HIE', 'DA', 'U'].map(residueLetter)).toEqual(['A', 'G', 'M', 'H', 'A', 'U'])
    expect(residueLetter('HEM')).toBe('[HEM]')
  })
})

describe('the commands', () => {
  it('name a residue by its index in a version, never by a name', () => {
    expect(seqHighlightCommand(4, 17)).toBe('_ /_agdb_seq_hl(4, 17)')
    expect(seqHighlightCommand(4, -1)).toBe('_ /_agdb_seq_hl(4, -1)')
    expect(seqHighlightCommand(4.9, 2.7)).toBe('_ /_agdb_seq_hl(4, 2)')
    expect(seqWantCommand(true)).toBe('_ /_agdb_seq_want(1)')
    expect(seqWantCommand(false)).toBe('_ /_agdb_seq_want(0)')
  })
})
