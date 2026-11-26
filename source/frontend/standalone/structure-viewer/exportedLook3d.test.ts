/**
 * The exported display drawn in 3Dmol.js (`exportedLook3d.ts`) against a
 * recording stand-in: a 3Dmol.js look's groups and coloured surfaces land on
 * the atoms they name, a look for another atom count is refused, PyMOL's
 * representation bits and per-object settings become 3Dmol styles, and every
 * branch of PyMOL's rotation → 3Dmol's quaternion.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PymolLook, PymolLookObject } from '../../src/pages/pymol-viewer/pymolLook'
import { PYMOL_REP } from '../../src/pages/pymol-viewer/pymolLook'
import type { Mol3dLook } from '../../src/pages/structure-html-export/mol3dLook'
import { applyMol3dLook, applyPymolLookTo3dmol, view3dFromPymol } from './exportedLook3d'

/* eslint-disable @typescript-eslint/no-explicit-any -- a 3Dmol.js stand-in */

type Atom = { index: number; serial: number; bonds?: number[]; style?: any }

const atomsOf = (n: number, bonded = true): Atom[] => Array.from({ length: n }, (_, i) => ({ index: i, serial: i, bonds: bonded ? [0] : [] }))

function stand(atoms: Atom[]) {
  const model = { selectedAtoms: vi.fn(() => atoms), setStyle: vi.fn() }
  const viewer = {
    addModel: vi.fn(() => model),
    addSurface: vi.fn((_type: number, _style: any, _sel: any): unknown => Promise.resolve()),
    setBackgroundColor: vi.fn(),
  }
  return { model, viewer }
}

beforeEach(() => {
  ;(window as any).$3Dmol = { SurfaceType: { VDW: 1, MS: 2, SAS: 3, SES: 4 } }
})

afterEach(() => {
  delete (window as any).$3Dmol
})

const look3d = (over: Partial<Mol3dLook> = {}): Mol3dLook => ({ v: 1, view: [], bg: '#102030', atoms: 4, groups: [], surfaces: [], ...over })

describe('applyMol3dLook', () => {
  it('refuses a look frozen over another atom count and leaves the atoms alone', () => {
    const atoms = atomsOf(3)
    const { model, viewer } = stand(atoms)
    expect(applyMol3dLook(viewer, model, look3d({ atoms: 4 }))).toBe(false)
    expect(atoms.every(a => a.style === undefined)).toBe(true)
    expect(viewer.setBackgroundColor).not.toHaveBeenCalled()
  })

  it('gives each group’s atoms their own copy of its style, clears the rest, and sets the background', () => {
    const atoms = atomsOf(4)
    atoms[3].style = { sphere: {} }
    const { model, viewer } = stand(atoms)
    // A range past the last atom stops at it.
    const ok = applyMol3dLook(viewer, model, look3d({ groups: [{ style: { stick: { radius: 0.2 } }, ranges: [[0, 1]] }, { style: { cartoon: { color: 1 } }, ranges: [[2, 99]] }] }))
    expect(ok).toBe(true)
    expect(atoms.map(a => a.style)).toEqual([{ stick: { radius: 0.2 } }, { stick: { radius: 0.2 } }, { cartoon: { color: 1 } }, { cartoon: { color: 1 } }])
    expect(atoms[0].style.stick).not.toBe(atoms[1].style.stick)
    expect(model.setStyle).toHaveBeenCalledWith({}, {}, true)
    expect(viewer.setBackgroundColor).toHaveBeenCalledWith('#102030')
  })

  it('draws a surface over the atoms its ranges name, in their colours, and skips one that names none', () => {
    const atoms = atomsOf(4)
    const { model, viewer } = stand(atoms)
    applyMol3dLook(
      viewer,
      model,
      look3d({
        surfaces: [
          { type: 'SES', opacity: 0.5, ranges: [[1, 2]], colors: [0x111111] },
          { type: 'MS', opacity: 1, ranges: [[9, 12]], colors: [] },
        ],
      }),
    )
    expect(viewer.addSurface).toHaveBeenCalledTimes(1)
    const [type, style, sel] = viewer.addSurface.mock.calls[0]
    expect(type).toBe(4)
    expect(style.opacity).toBe(0.5)
    expect(style.wireframe).toBeUndefined()
    // The second atom of the range has no colour of its own: white.
    expect([1, 2, 0].map(i => style.colorfunc(atoms[i]))).toEqual([0x111111, 0xffffff, 0xffffff])
    expect(sel.model).toBe(model)
    expect(atoms.map(a => sel.predicate(a))).toEqual([false, true, true, false])
  })

  it('keeps the structure drawn when a surface build is refused', async () => {
    const { model, viewer } = stand(atomsOf(2))
    viewer.addSurface.mockReturnValue(Promise.reject(new Error('worker gone')))
    expect(applyMol3dLook(viewer, model, look3d({ atoms: 2, surfaces: [{ type: 'MS', opacity: 1, ranges: [[0, 1]], colors: [1, 2] }] }))).toBe(true)
    // The rejection is handled: nothing reaches the test run as unhandled.
    await new Promise(r => setTimeout(r, 0))
  })
})

describe('applyPymolLookTo3dmol', () => {
  const obj = (over: Partial<PymolLookObject>): PymolLookObject => ({ name: 'o', enabled: true, text: 'data_o\n', atoms: 1, color: [0x00ff00], reps: [0], settings: {}, ...over })
  const pyLook = (objects: PymolLookObject[], over: Partial<PymolLook> = {}): PymolLook => ({ v: 1, view: [], bg: [0, 0, 0], settings: {}, objects, skipped: [], ...over })

  /** The style each atom gets, one model of `atoms` per object. */
  function styles(l: PymolLook, atoms: Atom[]) {
    const { viewer } = stand(atoms)
    const models = applyPymolLookTo3dmol(viewer, l)
    return { models, viewer, styles: atoms.map(a => a.style) }
  }

  it('skips a hidden object and returns no model when none is shown', () => {
    const { models, viewer } = styles(pyLook([obj({ enabled: false })]), atomsOf(1))
    expect(models).toEqual([])
    expect(viewer.addModel).not.toHaveBeenCalled()
  })

  it('turns each representation bit into its 3Dmol style, with the object’s settings over the global ones', () => {
    const reps = PYMOL_REP.cartoon | PYMOL_REP.sticks | PYMOL_REP.spheres | PYMOL_REP.lines
    const l = pyLook([obj({ reps: [reps], settings: { stick_radius: 0.4, sphere_transparency: 0.5 } })], { settings: { stick_radius: 0.1, sphere_scale: 0.3, cartoon_transparency: 0.25 } })
    const [st] = styles(l, atomsOf(1)).styles
    expect(st).toEqual({
      cartoon: { color: 0x00ff00, opacity: 0.75 },
      stick: { color: 0x00ff00, radius: 0.4, opacity: 1 },
      sphere: { color: 0x00ff00, scale: 0.3, opacity: 0.5 },
      line: { color: 0x00ff00 },
    })
  })

  it('draws a ribbon as a trace, and lone atoms’ nb_spheres and nonbonded crosses only when they have no bond', () => {
    const reps = PYMOL_REP.ribbon | PYMOL_REP.nb_spheres | PYMOL_REP.nonbonded
    const lone = styles(pyLook([obj({ reps: [reps] })]), atomsOf(1, false)).styles[0]
    expect(lone).toEqual({ cartoon: { color: 0x00ff00, style: 'trace' }, sphere: { color: 0x00ff00, radius: 0.25 }, cross: { color: 0x00ff00, radius: 0.25 } })
    const bonded = styles(pyLook([obj({ reps: [reps] })]), atomsOf(1, true)).styles[0]
    expect(bonded).toEqual({ cartoon: { color: 0x00ff00, style: 'trace' } })
  })

  it('reads an atom missing from the look as drawn nothing, in white', () => {
    const atoms = atomsOf(2)
    const st = styles(pyLook([obj({ atoms: 1, reps: [PYMOL_REP.lines], color: [0x123456] })]), atoms).styles
    expect(st).toEqual([{ line: { color: 0x123456 } }, {}])
  })

  it('gathers surface, mesh and dots atoms into one surface — a wireframe when only mesh is asked', () => {
    const atoms = atomsOf(3)
    const l = pyLook([obj({ atoms: 3, reps: [PYMOL_REP.mesh, PYMOL_REP.dots, 0], color: [1, 2, 3], settings: { transparency: 0.2 } })])
    const { viewer } = styles(l, atoms)
    expect(viewer.addSurface).toHaveBeenCalledTimes(1)
    const [type, style, sel] = viewer.addSurface.mock.calls[0]
    expect(type).toBe(2)
    expect(style.wireframe).toBe(true)
    expect(style.opacity).toBeCloseTo(0.8)
    expect(atoms.map(a => sel.predicate(a))).toEqual([true, true, false])
    expect(atoms.slice(0, 2).map(a => style.colorfunc(a))).toEqual([1, 2])
  })

  it('a fixed surface colour overrides the atoms’ own; a solid surface is not a wireframe', () => {
    const atoms = atomsOf(1)
    const l = pyLook([obj({ reps: [PYMOL_REP.surface | PYMOL_REP.mesh], settings: { surface_color: [0, 0, 1] } })])
    const { viewer } = styles(l, atoms)
    const [, style] = viewer.addSurface.mock.calls[0]
    expect(style.wireframe).toBeUndefined()
    expect(style.colorfunc(atoms[0])).toBe(0x0000ff)
  })

  it('sets the background from the look, and none from a malformed one', () => {
    expect(styles(pyLook([obj({})], { bg: [1, 0.5, 0] }), atomsOf(1)).viewer.setBackgroundColor).toHaveBeenCalledWith('#ff8000')
    expect(styles(pyLook([obj({})], { bg: [1, 2] as unknown as [number, number, number] }), atomsOf(1)).viewer.setBackgroundColor).not.toHaveBeenCalled()
  })
})

describe('view3dFromPymol', () => {
  /** A PyMOL view with rotation `m` (row-major here, stored column-major as PyMOL does). */
  const viewOf = (m: number[][]): number[] => [m[0][0], m[1][0], m[2][0], m[0][1], m[1][1], m[2][1], m[0][2], m[1][2], m[2][2], 0, 0, -50, 0, 0, 0, 40, 60, 0]
  /** The quaternion part [qx, qy, qz, qw] of the result. */
  const quat = (v: number[] | null) => v!.slice(4, 8).map(x => Math.round(x * 1e6) / 1e6 + 0)

  it('rotations whose trace is not positive take the largest diagonal’s branch', () => {
    // 180° about x, y and z: trace −1, each with a different largest diagonal.
    expect(quat(view3dFromPymol(viewOf([[1, 0, 0], [0, -1, 0], [0, 0, -1]])))).toEqual([1, 0, 0, 0])
    expect(quat(view3dFromPymol(viewOf([[-1, 0, 0], [0, 1, 0], [0, 0, -1]])))).toEqual([0, 1, 0, 0])
    expect(quat(view3dFromPymol(viewOf([[-1, 0, 0], [0, -1, 0], [0, 0, 1]])))).toEqual([0, 0, 1, 0])
  })

  it('refuses a view with a non-finite number', () => {
    const v = viewOf([[1, 0, 0], [0, 1, 0], [0, 0, 1]])
    v[3] = Number.NaN
    expect(view3dFromPymol(v)).toBeNull()
  })
})
