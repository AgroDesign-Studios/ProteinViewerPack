/**
 * The offline file's own small parts: reading its data blocks, checking the
 * exported 3Dmol look before 3Dmol sees it, the PyMOL→3Dmol camera, and the
 * no-WebGL summary of the structure.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import { LOGO_MAX_BYTES, readConfig, readLogo, textOf } from './blocks'
import type { PymolLook } from '../../src/pages/pymol-viewer/pymolLook'
import { PYMOL_REP } from '../../src/pages/pymol-viewer/pymolLook'
import { applyPymolLookTo3dmol, bgOfLook, checkMol3dLook, view3dFromPymol } from './exportedLook3d'
import { cifSummary } from './noGl'

function addBlock(name: string, text: string | Buffer, gz = true) {
  const raw = typeof text === 'string' ? Buffer.from(text, 'utf8') : text
  const el = document.createElement('script')
  el.type = 'application/x-agdb-b64'
  el.id = `agdb-${name}`
  el.dataset.gz = gz ? '1' : '0'
  el.dataset.len = String(raw.byteLength)
  el.textContent = (gz ? gzipSync(raw) : raw).toString('base64')
  document.body.appendChild(el)
}

afterEach(() => {
  document.body.textContent = ''
})

describe('blocks', () => {
  it('reads a gzip + base64 block as text, and refuses a damaged one', async () => {
    addBlock('structure', 'data_1CRN\n')
    await expect(textOf('structure')).resolves.toBe('data_1CRN\n')
    document.getElementById('agdb-structure')!.dataset.len = '3'
    await expect(textOf('structure')).rejects.toThrow('damaged')
    await expect(textOf('missing')).rejects.toThrow('missing block')
  })

  it('checks every config field; the light edition never starts PyMOL', async () => {
    addBlock('config', JSON.stringify({ v: 1, edition: 'light', structureId: 7, title: 1, code: 'X', lang: 'xx', initialEngine: 'pymol', bColumn: 'nope', pymolView: [1, 2], skipped: ['a', 3], runtime: { base: 'b', handed: [] } }))
    const c = await readConfig()
    expect(c).toMatchObject({ edition: 'light', structureId: 7, title: '', code: 'X', lang: 'ja', initialEngine: '3dmol', bColumn: 'bfactor', pymolView: null, skipped: ['a'], runtime: null })
  })

  it('keeps a full edition’s runtime and engine', async () => {
    addBlock('config', JSON.stringify({ edition: 'full', structureId: 1, title: 'T', code: null, lang: 'en', initialEngine: 'pymol', bColumn: 'plddt', pymolView: Array(18).fill(0), skipped: [], runtime: { base: 'B/', handed: ['x.whl'] } }))
    expect(await readConfig()).toMatchObject({ edition: 'full', lang: 'en', initialEngine: 'pymol', bColumn: 'plddt', runtime: { base: 'B/', handed: ['x.whl'] } })
  })

  it('reads the header logo as a data: URI only when it is a small JPEG or PNG', async () => {
    expect(await readLogo()).toBeNull()
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0xff, 0xd9])
    addBlock('logo', jpeg)
    expect(await readLogo()).toBe(`data:image/jpeg;base64,${jpeg.toString('base64')}`)
    document.body.textContent = ''
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
    addBlock('logo', png)
    expect(await readLogo()).toBe(`data:image/png;base64,${png.toString('base64')}`)
    for (const bad of [Buffer.from('<svg onload="x()"/>'), Buffer.alloc(0), Buffer.concat([jpeg, Buffer.alloc(LOGO_MAX_BYTES)])]) {
      document.body.textContent = ''
      addBlock('logo', bad)
      expect(await readLogo()).toBeNull()
    }
  })
})

describe('checkMol3dLook', () => {
  it('keeps the representations and plain values only', () => {
    const raw = JSON.parse(
      '{"v":1,"view":[0,0,0,0,0,0,0,1],"bg":"#000000","atoms":3,' +
        '"groups":[{"style":{"stick":{"color":255,"radius":0.2,"colorfunc":{"x":1},"__proto__":{"polluted":true}},"onclick":{"a":1}},"ranges":[[0,2],[5,1],"x"]}],' +
        '"surfaces":[{"type":"EVIL","opacity":7,"ranges":[[0,0]],"colors":[1.5,16777216]}]}',
    )
    const look = checkMol3dLook(raw)!
    expect(look.groups[0].style).toEqual({ stick: { color: 255, radius: 0.2 } })
    expect(look.groups[0].ranges).toEqual([[0, 2]])
    expect(look.surfaces[0]).toEqual({ type: 'MS', opacity: 1, ranges: [[0, 0]], colors: [0xffffff, 0] })
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('refuses anything that is not a look', () => {
    expect(checkMol3dLook(null)).toBeNull()
    expect(checkMol3dLook({ v: 2, atoms: 1 })).toBeNull()
    expect(checkMol3dLook({ v: 1, atoms: 0 })).toBeNull()
    expect(checkMol3dLook({ v: 1, atoms: 3, bg: 'red; x' })?.bg).toBe('#ffffff')
  })
})

describe('the exported look in 3Dmol.js', () => {
  const look = (objSettings: Record<string, number | [number, number, number]>): PymolLook => ({
    v: 1,
    view: Array.from({ length: 18 }, () => 0),
    bg: [0, 0, 0],
    settings: { cartoon_color: [1, 0, 0] },
    objects: [{ name: 'o', enabled: true, text: 'data_o\n', atoms: 1, color: [0x00ff00], reps: [PYMOL_REP.cartoon], settings: objSettings }],
    skipped: [],
  })
  /** A 3Dmol.js stand-in with one atom per model: the style the look gives it. */
  const styled = (l: PymolLook) => {
    const atom: Record<string, unknown> = { serial: 0, bonds: [] }
    const viewer = { addModel: () => ({ selectedAtoms: () => [atom], setStyle: () => undefined }), setBackgroundColor: () => undefined }
    applyPymolLookTo3dmol(viewer, l)
    return atom.style as { cartoon?: { color: number } }
  }

  it('an object left at the atoms’ own colours under a fixed global one keeps them (PT-9090 item 2)', () => {
    expect(styled(look({})).cartoon?.color).toBe(0xff0000)
    expect(styled(look({ cartoon_color: -1 })).cartoon?.color).toBe(0x00ff00)
  })

  it('starts the toolbar on the background the file was exported with (PT-9109 item 4)', () => {
    expect(bgOfLook(null, null)).toBe('white')
    expect(bgOfLook(null, look({}))).toBe('black')
    expect(bgOfLook({ v: 1, view: [], bg: '#FFFFFF', atoms: 1, groups: [], surfaces: [] }, null)).toBe('white')
    expect(bgOfLook({ v: 1, view: [], bg: '#336699', atoms: 1, groups: [], surfaces: [] }, null)).toBe('#336699')
  })
})

describe('view3dFromPymol', () => {
  it('turns the identity rotation into the identity quaternion', () => {
    const v = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -50, 1, 2, 3, 40, 60, -20]
    expect(view3dFromPymol(v)).toEqual([-1, -2, -3, 100, 0, 0, 0, 1, 0, 0])
    expect(view3dFromPymol([1, 2])).toBeNull()
    expect(view3dFromPymol(null)).toBeNull()
  })
})

describe('cifSummary', () => {
  it('counts 1CRN’s one chain of 46 residues and no ligand', () => {
    const cif = readFileSync(join(__dirname, '../../src/pages/structure-html-export/__fixtures__/1crn.cif'), 'utf8')
    expect(cifSummary(cif)).toEqual({ chains: [{ chain: 'A', residues: 46 }], ligands: [] })
  })

  it('lists ligands but never water, and keys chains safely', () => {
    const cif = [
      'loop_',
      '_atom_site.group_PDB',
      '_atom_site.auth_asym_id',
      '_atom_site.auth_seq_id',
      '_atom_site.auth_comp_id',
      'ATOM __proto__ 1 ALA',
      'HETATM A 2 HOH',
      'HETATM A 3 ATP',
      '#',
    ].join('\n')
    expect(cifSummary(cif)).toEqual({ chains: [{ chain: '__proto__', residues: 1 }], ligands: ['ATP'] })
  })
})
