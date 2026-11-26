/**
 * `freeze3dmolLook` against the INSTALLED 3Dmol: a real `GLModel` parsed from
 * mmCIF and styled the way the structure card styles it (`sceneStyles.ts`),
 * inside a viewer reduced to what the freezer reads (jsdom has no WebGL, and a
 * model's styles and colours are CPU-side). The colours are checked against
 * 3Dmol's own resolvers, so a 3dmol upgrade that changes them fails here.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'

const built = vi.hoisted(() => ({ value: null as null | { surfid: number; request: { type: number; style: { opacity: number; color: string }; sel: Record<string, unknown> } } }))
vi.mock('../../components/structure-viewer/surfaceController', () => ({ builtSurface: () => built.value }))

import { freeze3dmolLook, type Mol3dLook } from './mol3dLook'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let lib: any

beforeAll(async () => {
  const umd = '3dmol/build/3Dmol.js' // registers window.$3Dmol; a variable, so tsc does not look for a .d.ts
  await import(/* @vite-ignore */ umd)
  lib = (window as any).$3Dmol // eslint-disable-line @typescript-eslint/no-explicit-any
})

// Three alanines (chain A, residues 1-3), one ligand atom set, one water.
const ATOMS: [string, string, string, string, number, string, number, number, number][] = [
  ['ATOM', 'N', 'N', 'ALA', 1, 'A', 0.0, 0.0, 0.0], ['ATOM', 'CA', 'C', 'ALA', 1, 'A', 1.46, 0.0, 0.0],
  ['ATOM', 'C', 'C', 'ALA', 1, 'A', 2.0, 1.42, 0.0], ['ATOM', 'O', 'O', 'ALA', 1, 'A', 1.25, 2.4, 0.0],
  ['ATOM', 'N', 'N', 'ALA', 2, 'A', 3.33, 1.5, 0.0], ['ATOM', 'CA', 'C', 'ALA', 2, 'A', 3.96, 2.8, 0.0],
  ['ATOM', 'C', 'C', 'ALA', 2, 'A', 5.48, 2.7, 0.0], ['ATOM', 'O', 'O', 'ALA', 2, 'A', 6.1, 1.64, 0.0],
  ['ATOM', 'N', 'N', 'ALA', 3, 'A', 6.04, 3.9, 0.0], ['ATOM', 'CA', 'C', 'ALA', 3, 'A', 7.49, 4.0, 0.0],
  ['ATOM', 'C', 'C', 'ALA', 3, 'A', 8.0, 5.42, 0.0], ['ATOM', 'O', 'O', 'ALA', 3, 'A', 7.25, 6.4, 0.0],
  ['HETATM', 'C1', 'C', 'LIG', 101, 'A', 4.0, 6.0, 2.0], ['HETATM', 'O1', 'O', 'LIG', 101, 'A', 5.2, 6.0, 2.0],
  ['HETATM', 'O', 'O', 'HOH', 201, 'A', 9.0, 9.0, 9.0],
]
const CIF = [
  'data_TEST', 'loop_', '_atom_site.group_PDB', '_atom_site.id', '_atom_site.type_symbol', '_atom_site.label_atom_id',
  '_atom_site.label_comp_id', '_atom_site.label_asym_id', '_atom_site.label_seq_id', '_atom_site.Cartn_x',
  '_atom_site.Cartn_y', '_atom_site.Cartn_z', '_atom_site.auth_seq_id', '_atom_site.auth_comp_id',
  '_atom_site.auth_asym_id', '_atom_site.auth_atom_id', '_atom_site.pdbx_PDB_model_num',
  ...ATOMS.map(([g, name, el, resn, seq, ch, x, y, z], i) => `${g} ${i + 1} ${el} ${name} ${resn} ${ch} ${seq} ${x.toFixed(3)} ${y.toFixed(3)} ${z.toFixed(3)} ${seq} ${resn} ${ch} ${name} 1`),
  '#', '',
].join('\n')

const VIEW = [1, 2, 3, -40, 0, 0, 0.3826834, 0.9238795]

function scene(paint: (model: any) => void, surfaces: Record<string, unknown> = {}) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const model = new lib.GLModel(0)
  model.addMolData(CIF, 'cif')
  paint(model)
  return {
    model,
    viewer: {
      getModel: (i?: number) => (i === undefined || i === 0 ? model : null),
      selectedAtoms: (sel: Record<string, unknown>) => model.selectedAtoms(sel),
      surfaces,
      getView: () => [...VIEW],
      bgColor: 0x112233,
    },
  }
}

/** The card's own base scene (sceneStyles.ts steps 1-4, cartoon + spectrum). */
function cardStyle(model: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
  model.setStyle({}, {})
  model.setStyle({ hetflag: false }, { cartoon: { color: 'spectrum' } })
  model.setStyle({ hetflag: true }, { stick: { radius: 0.15, colorscheme: 'greenCarbon' } }, true) // GLModel's addStyle
  model.setStyle({ resn: ['HOH', 'WAT', 'DOD'] }, {})
}

/** Style of atom `i` as the look describes it (null when it is drawn by no group). */
function styleOf(look: Mol3dLook, i: number): Record<string, Record<string, unknown>> | null {
  for (const g of look.groups) for (const [a, b] of g.ranges) if (i >= a && i <= b) return g.style as Record<string, Record<string, unknown>>
  return null
}

describe('freeze3dmolLook — the card scene through the real 3Dmol', () => {
  it('resolves the spectrum cartoon to 3Dmol\'s own gradient colour per residue', () => {
    const { viewer } = scene(cardStyle)
    const look = freeze3dmolLook(viewer)
    // GLModel builds the gradient REVERSED over the spectrum atoms' residue range (1..3).
    const grad = new lib.Gradient.builtinGradients.sinebow(3, 1)
    for (const [i, resi] of [[0, 1], [5, 2], [11, 3]] as const) {
      expect(styleOf(look, i)?.cartoon.color).toBe(grad.valueToHex(resi) & 0xffffff)
    }
    // One group per residue colour, contiguous ranges.
    expect(styleOf(look, 0)).toEqual(styleOf(look, 3))
    expect(styleOf(look, 0)).not.toEqual(styleOf(look, 4))
  })

  it('resolves a colour scheme per atom and hides what the card hides', () => {
    const { viewer } = scene(cardStyle)
    const look = freeze3dmolLook(viewer)
    const ligC = styleOf(look, 12), ligO = styleOf(look, 13)
    expect(ligC?.stick).toEqual({ radius: 0.15, color: lib.getColorFromStyle({ elem: 'C' }, { colorscheme: 'greenCarbon' }).getHex() })
    expect(ligO?.stick.color).toBe(lib.getColorFromStyle({ elem: 'O' }, { colorscheme: 'greenCarbon' }).getHex())
    expect(ligC?.stick.color).not.toBe(ligO?.stick.color)
    expect(styleOf(look, 14)).toBeNull() // water
    expect(look.atoms).toBe(15)
  })

  it('carries nothing that is not plain JSON: no scheme, no function, numbers for colours', () => {
    const { viewer } = scene(model => {
      model.setStyle({}, { stick: { colorfunc: (a: { resi: number }) => (a.resi === 2 ? 0xff0000 : 'blue') }, sphere: { color: 'orange', scale: 0.3 } })
    })
    const look = freeze3dmolLook(viewer)
    const text = JSON.stringify(look)
    expect(JSON.parse(text)).toEqual(look)
    expect(text).not.toMatch(/colorscheme|colorfunc|spectrum/)
    expect(styleOf(look, 5)?.stick.color).toBe(0xff0000)
    expect(styleOf(look, 0)?.stick.color).toBe(0x0000ff)
    expect(styleOf(look, 0)?.sphere).toEqual({ color: 0xffa500, scale: 0.3 })
    for (const g of look.groups) for (const spec of Object.values(g.style)) expect(typeof (spec as { color: unknown }).color).toBe('number')
  })

  it('takes the view, the background and the atom count', () => {
    const { viewer } = scene(cardStyle)
    const look = freeze3dmolLook(viewer)
    expect(look).toMatchObject({ v: 1, view: VIEW, bg: '#112233', atoms: 15 })
  })

  it('refuses a viewer without that model', () => {
    const { viewer } = scene(cardStyle)
    expect(() => freeze3dmolLook(viewer, 3)).toThrow(/no model 3/)
    expect(() => freeze3dmolLook({})).toThrow()
  })
})

describe('freeze3dmolLook — surfaces', () => {
  /** What GLViewer.addSurface stores: an array of parts with the build-time style and selection. */
  function surface(style: Record<string, unknown>, atomsel: Record<string, unknown>, opacity: number) {
    return Object.assign([{ mat: { opacity } }], { style, atomsel })
  }

  it('describes the controller\'s surface by its current request (type, colour) and the atoms it covers', () => {
    const { viewer } = scene(cardStyle, { 7: surface({ opacity: 0.7, color: 'white' }, { hetflag: false }, 1) })
    built.value = { surfid: 7, request: { type: lib.SurfaceType.SAS, style: { opacity: 1, color: 'red' }, sel: { hetflag: false } } }
    try {
      const [s] = freeze3dmolLook(viewer).surfaces
      expect(s.type).toBe('SAS')
      expect(s.opacity).toBe(1)
      expect(s.ranges).toEqual([[0, 11]])
      expect(s.colors).toEqual(new Array(12).fill(0xff0000))
    } finally {
      built.value = null
    }
  })

  it('falls back to the stored style and the default type for a surface added elsewhere', () => {
    const { viewer } = scene(cardStyle, { 3: surface({ opacity: 0.5, colorscheme: 'Jmol' }, { resn: 'LIG' }, 0.5) })
    const [s] = freeze3dmolLook(viewer).surfaces
    expect(s.type).toBe('MS')
    expect(s.opacity).toBe(0.5)
    expect(s.ranges).toEqual([[12, 13]])
    expect(s.colors[0]).toBe(lib.getColorFromStyle({ elem: 'C' }, { colorscheme: 'Jmol' }).getHex())
  })
})
