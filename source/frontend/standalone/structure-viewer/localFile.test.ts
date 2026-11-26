/**
 * Files the offline structure file opens from this computer (owner
 * 2026-11-14): which extensions, how each reaches 3Dmol.js, and the refusals
 * that come before a byte is read.
 */
import { describe, expect, it, vi } from 'vitest'

import { LIMITS } from '../../src/pages/pymol-viewer/pymolFrameProtocol'
import {
  capOf,
  DMOL_FORMAT,
  embeddedDoc,
  extensionOf,
  formatName,
  lockSharedPrototypes,
  markHetero,
  objectNameOf,
  OPEN_ACCEPT,
  OPEN_EXTENSIONS,
  readStructureFile,
  stemOfName,
  textFor3dmol,
} from './localFile'

const file = (name: string, text: string, size = new TextEncoder().encode(text).byteLength) => ({
  name,
  size,
  arrayBuffer: vi.fn(async () => new TextEncoder().encode(text).buffer as ArrayBuffer),
})

describe('localFile', () => {
  it('names each format the structure file export writes (owner 2026-11-16: 構造ファイル（mmCIF）)', () => {
    expect(OPEN_EXTENSIONS.map(formatName)).toEqual(['PDB', 'PDB', 'mmCIF', 'mmCIF', 'SDF', 'MOL', 'MOL2', 'XYZ', 'PSE'])
    expect(formatName('CIF')).toBe('mmCIF')
    // Outside the list: the extension itself, never a prototype's property.
    expect(formatName('constructor')).toBe('CONSTRUCTOR')
  })

  it('opens PyMOL’s structure formats and its session, never a map or another pickle', () => {
    expect(OPEN_ACCEPT).toBe('.pdb,.ent,.cif,.mmcif,.sdf,.mol,.mol2,.xyz,.pse')
    for (const bad of ['map', 'ccp4', 'mrc', 'pkl', 'pml', 'py', 'html', '']) expect(OPEN_EXTENSIONS as readonly string[]).not.toContain(bad)
    expect(extensionOf('1CRN.PDB')).toBe('pdb')
    expect(extensionOf('a.b.mmCIF')).toBe('mmcif')
    expect(extensionOf('session.pse')).toBe('pse')
    expect(extensionOf('script.pml')).toBeNull()
    expect(extensionOf('noext')).toBeNull()
  })

  it('reads each with 3Dmol.js’s own reader, and a session with none', () => {
    expect(DMOL_FORMAT).toEqual({ pdb: 'pdb', ent: 'pdb', cif: 'cif', mmcif: 'cif', sdf: 'sdf', mol: 'sdf', mol2: 'mol2', xyz: 'xyz', pse: null })
  })

  it('caps a session and a structure as PyMOL does', () => {
    expect(capOf('pse')).toBe(LIMITS.pseBytes)
    expect(capOf('pdb')).toBe(LIMITS.loadBytes)
  })

  it('makes an ASCII stem from the file name', () => {
    expect(stemOfName('my protein (v2).pdb')).toBe('my_protein_v2')
    expect(stemOfName('日本語.cif')).toBe('structure')
    expect(stemOfName('.pse')).toBe('pse')
  })

  it('reads a structure file as bytes and text, and a session as bytes only', async () => {
    const pdb = await readStructureFile(file('a.pdb', 'ATOM\nEND\n'))
    expect(pdb).toMatchObject({ ok: true, doc: { name: 'a.pdb', stem: 'a', ext: 'pdb', text: 'ATOM\nEND\n' } })
    const pse = await readStructureFile(file('s.pse', '}q'))
    expect(pse).toMatchObject({ ok: true, doc: { ext: 'pse', text: null } })
    if (pdb.ok && pse.ok) expect(pse.doc.serial).toBeGreaterThan(pdb.doc.serial)
  })

  it('refuses an unknown kind, an empty file and one over the cap — the last before reading it', async () => {
    expect(await readStructureFile(file('x.pml', 'load x'))).toEqual({ ok: false, why: { code: 'format', ext: 'pml' } })
    expect(await readStructureFile(file('x.pdb', '', 0))).toEqual({ ok: false, why: { code: 'empty' } })
    const big = file('x.pse', '', LIMITS.pseBytes + 1)
    expect(await readStructureFile(big)).toEqual({ ok: false, why: { code: 'too-large', limitMiB: 25 } })
    expect(big.arrayBuffer).not.toHaveBeenCalled()
  })

  it('says a read that failed', async () => {
    const broken = { name: 'x.pdb', size: 3, arrayBuffer: async () => Promise.reject(new Error('NotReadableError')) }
    expect(await readStructureFile(broken)).toEqual({ ok: false, why: { code: 'unreadable', detail: 'NotReadableError' } })
  })

  it('makes the embedded mmCIF the first document', () => {
    const d = embeddedDoc('data_x\n', '1CRN', 'Crambin')
    expect(d).toMatchObject({ name: 'Crambin', stem: '1CRN', ext: 'cif', text: 'data_x\n', serial: 0 })
    expect(new TextDecoder().decode(d.bytes)).toBe('data_x\n')
  })

  it('marks MOL2 atoms polymer or ligand as the PDB reader would, leaving a reader’s own flag alone', () => {
    const atoms: { hetflag?: boolean; resn?: string }[] = [{ resn: 'ALA' }, { resn: 'lig' }, { resn: ' DG ' }, { resn: 'HOH' }, {}, { resn: 'ALA', hetflag: true }, { resn: 'THR1' }]
    markHetero(atoms)
    expect(atoms.map(a => a.hetflag)).toEqual([false, true, false, true, true, true, false])
  })

  it('renames the SD data item 3Dmol.js reads as styling, at the same length, and moves no line (PR #8239 review)', () => {
    const sdf = ['lig', '  x', '', '  1  0  0  0  0  0  0  0  0  0999 V2000', 'M  END', '> <NAME>', 'aspirin', '', '>  < 3dmol_style >', '{"a": 1}', '{"b": 2}', '', '> <OTHER>', 'x', '$$$$', ''].join('\n')
    const out = textFor3dmol(sdf, 'sdf')
    expect(out).not.toMatch(/3dmol_style/i)
    expect(out.split('\n')).toHaveLength(sdf.split('\n').length)
    expect(out.length).toBe(sdf.length)
    expect(out).toContain('>  < 3DMOL_STYL0 >\n{"a": 1}')
    expect(out).toContain('> <NAME>\naspirin')
    expect(out).toContain('> <OTHER>\nx\n$$$$')
    // A record title that reads like the header stays a title: the record keeps its lines.
    const titled = '> <3DMOL_STYLE>\n  x\n\n  1  0  0  0  0  0  0  0  0  0999 V2000\nM  END\n$$$$\n'
    expect(textFor3dmol(titled, 'sdf')).toBe('> <3DMOL_STYL0>\n  x\n\n  1  0  0  0  0  0  0  0  0  0999 V2000\nM  END\n$$$$\n')
    // CR-only and mixed line breaks, split as 3Dmol.js splits them (PR #8239 review).
    const cr = 't\r\r\r  1  0  0  0  0  0  0  0  0  0999 V2000\rM  END\r> <3DMOL_STYLE>\r{"a":1}\r$$$$'
    expect(textFor3dmol(cr, 'sdf')).toBe('t\r\r\r  1  0  0  0  0  0  0  0  0  0999 V2000\rM  END\r> <3DMOL_STYL0>\r{"a":1}\r$$$$')
    expect(textFor3dmol('> <A>\r> <3DMOL_STYLE>\r{"a":1}\n> <B>\r\nv', 'sdf')).toBe('> <A>\r> <3DMOL_STYL0>\r{"a":1}\n> <B>\r\nv')
    // Other formats go through as they are.
    expect(textFor3dmol('> <3DMOL_STYLE>\n{}', 'pdb')).toBe('> <3DMOL_STYLE>\n{}')
  })

  it('makes the shared prototypes non-extensible', () => {
    const spy = vi.spyOn(Object, 'preventExtensions').mockImplementation(o => o)
    lockSharedPrototypes()
    expect(spy).toHaveBeenCalledWith(Object.prototype)
    expect(spy).toHaveBeenCalledWith(Array.prototype)
    spy.mockRestore()
  })

  it('names an opened file’s PyMOL object after it, unless PyMOL keeps that word', () => {
    expect(objectNameOf('1crn')).toBe('1crn')
    expect(objectNameOf('model')).toBe('f_model')
    expect(objectNameOf('ALL')).toBe('f_ALL')
    expect(objectNameOf('and')).toBe('f_and')
    // Every word the bundled PyMOL refused or renamed as an object name
    // (an automated browser test, 2026-11-15; PT-9132 item 3).
    const measured =
      'all none enabled visible center origin and or not in like within around expand gap near_to beyond model chain segi segid ' +
      'resn resi name alt elem ss b q id ID index rank state polymer organic inorganic solvent hetatm hydro hydrogens metals ' +
      'backbone sidechain guide bonded protected fixed restrained masked flag present first last object byres bychain ' +
      'bymolecule byobject bysegi byfragment neighbor pepseq pk1 pk2 pk3 pk4 pkmol pkresi pkchain pkobject het symbol x y z ' +
      'bound_to extend donors acceptors formal_charge partial_charge text_type numeric_type stereo rep color cartoon_color ' +
      'ribbon_color label custom byring bycell bycalpha delocalized resid segment residue element'
    for (const w of measured.split(' ')) expect(objectNameOf(w)).toBe(`f_${w}`)
    // Words it took as names stay as they are.
    for (const w of ['lig', 'receptor', 'protein', 'a', 'n', 'water']) expect(objectNameOf(w)).toBe(w)
  })
})
