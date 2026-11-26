/**
 * The offline file's 3Dmol.js pane against a recording 3Dmol.js stand-in
 * (jsdom has no WebGL): the viewer is built once the library has run, a file
 * 3Dmol.js cannot read is said once on the alert line, the exported display
 * opens first and 「初期表示」 returns to it after a toolbar restyle, a look
 * that does not fit the structure is dropped for AgDB's scene, the phone's
 * upright view is fitted to its width, the page's export handle (PNG, VRML,
 * zoom, look) and the two-atom measurement.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createRef, type MutableRefObject } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key} ${JSON.stringify(vars)}` : key),
    i18n: { language: 'en' },
  }),
}))

import type { PymolLook } from '../../src/pages/pymol-viewer/pymolLook'
import { PYMOL_REP } from '../../src/pages/pymol-viewer/pymolLook'
import type { Mol3dLook } from '../../src/pages/structure-html-export/mol3dLook'
import { Mol3dPane, type Mol3dHandle } from './Mol3dPane'
import { probe } from './probe'

/* eslint-disable @typescript-eslint/no-explicit-any -- a 3Dmol.js stand-in */

interface FakeAtom {
  index: number
  serial: number
  chain: string
  resi: number
  hetflag?: boolean
  resn?: string
  x: number
  y: number
  z: number
  bonds: number[]
  style?: unknown
}

function makeAtoms(n: number): FakeAtom[] {
  return Array.from({ length: n }, (_, i) => ({ index: i, serial: i, chain: 'A', resi: i + 1, hetflag: false, x: i * 3, y: i * 4, z: 0, bonds: [1] }))
}

/** One 3Dmol.js model over `atoms` atoms. */
function fakeModel(atoms: number) {
  const list = makeAtoms(atoms)
  return { atoms: list, selectedAtoms: vi.fn(() => list), setStyle: vi.fn() }
}

type FakeModel = ReturnType<typeof fakeModel>

/** The methods the pane and AgDB's scene code call, each recorded. */
function fakeViewer(opts: { atoms: number; unreadable: boolean }) {
  const canvas = document.createElement('canvas')
  const models: FakeModel[] = []
  let click: ((atom: unknown) => void) | null = null
  const viewer = {
    models,
    click: (atom: unknown) => click?.(atom),
    addModel: vi.fn((_text: string, format: string) => {
      if (opts.unreadable) throw new Error('no atoms in this file')
      const m = fakeModel(opts.atoms)
      if (format === 'mol2') {
        // 3Dmol.js's MOL2 reader sets no hetflag; the substructure name carries the residue number.
        m.atoms.forEach((a, i) => {
          delete a.hetflag
          a.resn = i === 0 ? 'THR1' : 'LIG'
        })
      }
      models.push(m)
      return m
    }),
    removeModel: vi.fn(),
    removeAllModels: vi.fn(),
    getModel: vi.fn(() => models[0] ?? null),
    setStyle: vi.fn(),
    addStyle: vi.fn(),
    addSurface: vi.fn(() => Promise.resolve()),
    getSurface: vi.fn(() => []),
    removeAllSurfaces: vi.fn(),
    setSurfaceMaterialStyle: vi.fn(),
    removeShape: vi.fn(),
    addCustom: vi.fn(),
    setBackgroundColor: vi.fn(),
    zoomTo: vi.fn(),
    zoom: vi.fn(),
    setView: vi.fn(),
    getView: vi.fn(() => [0, 0, 0, 150, 0, 0, 0, 1]),
    getSlab: vi.fn(() => ({ near: -20, far: 20 })),
    setSlab: vi.fn(),
    fitSlab: vi.fn(),
    enableFog: vi.fn(),
    setProjection: vi.fn(),
    getPerceivedDistance: vi.fn(() => 100),
    getRenderer: vi.fn(() => null),
    spin: vi.fn(),
    resize: vi.fn(),
    render: vi.fn(),
    clear: vi.fn(),
    addLabel: vi.fn(),
    addCylinder: vi.fn(),
    pngURI: vi.fn(() => `data:image/png;base64,${btoa('PNGDATA')}`),
    setClickable: vi.fn((_sel: unknown, _on: boolean, cb: (atom: unknown) => void) => {
      click = cb
    }),
    getCanvas: () => canvas,
    container: null as unknown,
  }
  return viewer
}

type FakeViewer = ReturnType<typeof fakeViewer>

let made: FakeViewer[] = []
let setup = { atoms: 3, unreadable: false }

beforeEach(() => {
  made = []
  setup = { atoms: 3, unreadable: false }
  probe.errors.length = 0
  probe.dmol = 'off'
  // jsdom has no 2D context; the pen's layer asks for one and copes with null.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  ;(window as any).$3Dmol = {
    createViewer: vi.fn((el: HTMLElement) => {
      const v = fakeViewer(setup)
      el.append(v.getCanvas())
      v.container = el
      made.push(v)
      return v
    }),
    rasmolElementColors: {},
    SurfaceType: { VDW: 1, MS: 2, SAS: 3, SES: 4 },
  }
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  delete (window as any).$3Dmol
})

const CIF = 'data_1CRN\n'

const mol3dLook = (atoms: number, bg = '#000000'): Mol3dLook => ({
  v: 1,
  view: [1, 2, 3, 120, 0, 0, 0, 1],
  bg,
  atoms,
  groups: [{ style: { stick: { color: 0xff0000 } }, ranges: [[0, atoms - 1]] }],
  surfaces: [],
})

const pymolLook = (): PymolLook => ({
  v: 1,
  view: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -50, 1, 2, 3, 40, 60, -20],
  bg: [1, 1, 1],
  settings: {},
  objects: [{ name: 'obj', enabled: true, text: CIF, atoms: 3, color: [0xff0000, 0x00ff00, 0x0000ff], reps: [PYMOL_REP.sticks, PYMOL_REP.sticks, PYMOL_REP.sticks], settings: {} }],
  skipped: [],
})

function renderPane(over: Partial<Parameters<typeof Mol3dPane>[0]> = {}) {
  const handleRef = createRef<Mol3dHandle | null>() as MutableRefObject<Mol3dHandle | null>
  handleRef.current = null
  const onStatus = vi.fn()
  const onError = vi.fn()
  const props: Parameters<typeof Mol3dPane>[0] = {
    structure: { text: CIF, format: 'cif' },
    mol3d: null,
    pymol: null,
    pymolView: null,
    fileStem: '1CRN',
    libReady: true,
    shown: true,
    onStatus,
    onError,
    handleRef,
    ...over,
  }
  const view = render(<Mol3dPane {...props} />)
  return { ...view, handleRef, onStatus, onError, props }
}

/** The line over the view that says the residue picked (other status regions exist in the toolbar). */
const readout = () => document.querySelector('.sav-stage-readout')

const initialButton = () => screen.queryByRole('button', { name: 'htmlExport:sa_view_exported' })

describe('Mol3dPane — building the viewer', () => {
  it('waits for 3Dmol.js, then draws the structure once in AgDB’s scene', () => {
    const { rerender, props } = renderPane({ libReady: false })
    expect(made).toHaveLength(0)
    expect(probe.dmol).toBe('off')

    rerender(<Mol3dPane {...props} libReady />)

    expect(made).toHaveLength(1)
    const v = made[0]
    expect(v.addModel).toHaveBeenCalledTimes(1)
    expect(v.addModel.mock.calls[0][1]).toBe('cif')
    // AgDB's scene styles the structure; no exported look, so no 「初期表示」.
    expect(v.setStyle).toHaveBeenCalled()
    expect(v.zoomTo).toHaveBeenCalled()
    expect(v.setView).not.toHaveBeenCalled()
    expect(initialButton()).toBeNull()
    expect(probe.dmol).toBe('shown')
  })

  it('marks a MOL2 file’s non-polymer atoms as hetero, which 3Dmol.js’s MOL2 reader leaves unset', () => {
    renderPane({ structure: { text: '@<TRIPOS>MOLECULE\n', format: 'mol2' } })
    expect(made[0].models[0].atoms.map(a => a.hetflag)).toEqual([false, true, true])
  })

  it('says a file 3Dmol.js cannot read once on the alert line, and draws nothing more', () => {
    setup.unreadable = true
    const { onError } = renderPane()
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith('htmlExport:sa_dmol_unreadable', { detail: 'no atoms in this file' })
    expect(probe.errors.some(e => e.startsWith('3dmol addModel:'))).toBe(true)

    // A restyle does not ask 3Dmol.js to read it again.
    fireEvent.click(screen.getByRole('checkbox', { hidden: true, name: 'Water' }))
    expect(made[0].addModel).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('opens on the camera PyMOL exported when there is no look', () => {
    renderPane({ pymolView: pymolLook().view })
    expect(made[0].setView).toHaveBeenCalledWith([-1, -2, -3, 100, 0, 0, 0, 1, 0, 0])
  })

  it('zooms an upright (phone) view out by its width-to-height ratio, after the fit and after the saved camera', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 390, height: 780, top: 0, left: 0, right: 390, bottom: 780, x: 0, y: 0, toJSON: () => ({}) })
    renderPane({ pymolView: pymolLook().view })
    expect(made[0].zoom.mock.calls).toEqual([[0.5], [0.5]])
  })

  it('retires the viewer and empties the export handle when the pane goes', () => {
    const { unmount, handleRef } = renderPane()
    const v = made[0]
    expect(handleRef.current).not.toBeNull()
    expect(v.getCanvas().isConnected).toBe(true)

    unmount()

    expect(handleRef.current).toBeNull()
    expect(v.clear).toHaveBeenCalled()
    expect(v.getCanvas().isConnected).toBe(false)
  })
})

describe('Mol3dPane — the exported display', () => {
  it('opens on the exported 3Dmol.js look: its styles, background and camera', () => {
    renderPane({ mol3d: mol3dLook(3) })
    const v = made[0]
    const atoms = v.models[0].atoms
    expect(atoms.every(a => JSON.stringify(a.style) === JSON.stringify({ stick: { color: 0xff0000 } }))).toBe(true)
    expect(v.setBackgroundColor).toHaveBeenCalledWith('#000000')
    expect(v.setView).toHaveBeenCalledWith([1, 2, 3, 120, 0, 0, 0, 1])
    expect(initialButton()).toHaveAttribute('aria-pressed', 'true')
  })

  it('drops a look made for another structure, says so, and keeps AgDB’s scene on white', () => {
    const { onStatus } = renderPane({ mol3d: mol3dLook(5) })
    const v = made[0]
    expect(onStatus).toHaveBeenCalledWith('htmlExport:sa_status_look_mismatch')
    expect(initialButton()).toBeNull()
    expect(v.setBackgroundColor).toHaveBeenLastCalledWith('white')
  })

  it('draws a PyMOL look as its own models, on its camera', () => {
    renderPane({ pymol: pymolLook() })
    const v = made[0]
    expect(v.models).toHaveLength(1)
    expect((v.models[0].atoms[0].style as { stick: { color: number } }).stick.color).toBe(0xff0000)
    expect(v.setView).toHaveBeenCalledWith([-1, -2, -3, 100, 0, 0, 0, 1, 0, 0])
    expect(initialButton()).toHaveAttribute('aria-pressed', 'true')
  })

  it('a PyMOL look 3Dmol.js cannot read falls back to the structure alone, in AgDB’s scene', () => {
    setup.unreadable = true
    // The look's object and the structure both fail to read: the look's
    // failure is caught by the pane, the structure's said on the alert line.
    const { onStatus, onError } = renderPane({ pymol: pymolLook() })
    const v = made[0]
    expect(v.removeAllModels).toHaveBeenCalled()
    expect(probe.errors.some(e => e.startsWith('3dmol look:'))).toBe(true)
    expect(onStatus).toHaveBeenCalledWith('htmlExport:sa_status_look_mismatch')
    expect(onError).toHaveBeenCalledWith('htmlExport:sa_dmol_unreadable', { detail: 'no atoms in this file' })
    expect(initialButton()).toBeNull()
  })

  it('a toolbar restyle switches to AgDB’s scene, and 「初期表示」 returns to the exported look and camera', () => {
    renderPane({ mol3d: mol3dLook(3) })
    const v = made[0]
    const exportedModel = v.models[0]

    fireEvent.click(screen.getByRole('checkbox', { hidden: true, name: 'Water' }))

    // The look's model goes; the structure comes back as one model for AgDB's scene.
    expect(v.removeModel).toHaveBeenCalledWith(exportedModel)
    expect(v.models).toHaveLength(2)
    expect(initialButton()).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('checkbox', { hidden: true, name: 'Water' })).toBeChecked()

    v.setView.mockClear()
    fireEvent.click(initialButton()!)

    expect(initialButton()).toHaveAttribute('aria-pressed', 'true')
    // The toolbar is back on AgDB's defaults, the camera on the one the file opened with.
    expect(screen.getByRole('checkbox', { hidden: true, name: 'Water' })).not.toBeChecked()
    expect(v.setView).toHaveBeenCalledWith([0, 0, 0, 150, 0, 0, 0, 1])
    expect(v.models).toHaveLength(3)
  })
})

describe('Mol3dPane — the page’s export handle', () => {
  it('saves the view as a PNG under the file’s name', async () => {
    const { handleRef } = renderPane()
    const file = await handleRef.current!.pngFile()
    expect(file.name).toBe('1CRN_3dmol.png')
    expect(file.blob.type).toBe('image/png')
    // jsdom's Blob has no arrayBuffer(): read it back through FileReader.
    const text = await new Promise<string>(resolve => {
      const r = new FileReader()
      r.onload = () => resolve(String(r.result))
      r.readAsText(file.blob)
    })
    expect(text).toBe('PNGDATA')
  })

  it('hands over the viewer for its VRML, and no look when 3Dmol.js cannot freeze the view', () => {
    const { handleRef } = renderPane()
    expect(handleRef.current!.vrml()).toBe(made[0])
    // The stand-in has no getColorFromStyle: freezing throws, the handle says null.
    expect(handleRef.current!.look()).toBeNull()
  })

  it('zooms in, out and back to everything in view', () => {
    const { handleRef } = renderPane()
    const v = made[0]
    v.zoom.mockClear()
    v.zoomTo.mockClear()
    act(() => handleRef.current!.zoom('in'))
    act(() => handleRef.current!.zoom('out'))
    expect(v.zoom.mock.calls).toEqual([[1.25], [0.8]])
    act(() => handleRef.current!.zoom('fit'))
    expect(v.zoomTo).toHaveBeenCalledTimes(1)
  })
})

describe('Mol3dPane — picking', () => {
  it('a click on a residue says it over the view; a second click on it clears it', () => {
    renderPane()
    const v = made[0]
    const atom = { chain: 'B', resi: 42, hetflag: false, x: 0, y: 0, z: 0 }
    act(() => v.click(atom))
    expect(readout()).toHaveTextContent('proteindb:viewer_selected_residue {"chain":"B","resi":"42"}')
    act(() => v.click(atom))
    expect(readout()).toBeEmptyDOMElement()
  })

  it('a residue click in the exported display leaves it as it was', () => {
    renderPane({ mol3d: mol3dLook(3) })
    act(() => made[0].click({ chain: 'A', resi: 1, hetflag: false, x: 0, y: 0, z: 0 }))
    expect(readout()).toBeEmptyDOMElement()
  })

  it('measures the distance between two clicked atoms in Å', () => {
    renderPane()
    const v = made[0]
    fireEvent.click(screen.getByRole('button', { name: /Measure/ }))
    act(() => v.click({ chain: 'A', resi: 1, hetflag: false, x: 0, y: 0, z: 0 }))
    expect(v.addLabel).not.toHaveBeenCalled()
    act(() => v.click({ chain: 'A', resi: 2, hetflag: false, x: 3, y: 4, z: 0 }))
    expect(v.addLabel).toHaveBeenCalledWith('5.00 Å', expect.objectContaining({ position: { x: 1.5, y: 2, z: 0 } }))
    expect(v.addCylinder).toHaveBeenCalledWith(expect.objectContaining({ start: { x: 0, y: 0, z: 0 }, end: { x: 3, y: 4, z: 0 }, dashed: true }))
  })
})

describe('Mol3dPane — the toolbar', () => {
  it('spins the view while 「Spin」 is on', () => {
    renderPane()
    const v = made[0]
    fireEvent.click(screen.getByRole('checkbox', { hidden: true, name: 'Spin' }))
    expect(v.spin).toHaveBeenLastCalledWith('y')
    fireEvent.click(screen.getByRole('checkbox', { hidden: true, name: 'Spin' }))
    expect(v.spin).toHaveBeenLastCalledWith(false)
  })

  it('each restyle control leaves the exported look and redraws in AgDB’s scene', () => {
    renderPane({ mol3d: mol3dLook(3) })
    const v = made[0]
    const redraws = () => v.setStyle.mock.calls.length
    const press = (control: () => void) => {
      const before = redraws()
      control()
      expect(redraws()).toBeGreaterThan(before)
      expect(initialButton()).toHaveAttribute('aria-pressed', 'false')
    }
    press(() => fireEvent.click(screen.getByRole('checkbox', { hidden: true, name: 'Protein' })))
    expect(screen.getByRole('checkbox', { hidden: true, name: 'Protein' })).not.toBeChecked()
    press(() => fireEvent.click(screen.getByRole('checkbox', { hidden: true, name: 'Ligands' })))
    press(() => fireEvent.change(screen.getByRole('combobox'), { target: { value: 'chain' } }))
    expect(screen.getByRole('combobox')).toHaveValue('chain')
    // A computer: the surface's controls are in the bar's 「表面」 drop-down (owner 2026-11-19).
    fireEvent.click(screen.getByRole('button', { name: /proteindb:viewer_bar_surface/ }))
    press(() => fireEvent.click(screen.getByRole('checkbox', { name: 'Surface' })))
    expect(v.addSurface).toHaveBeenCalled()
    press(() => fireEvent.click(screen.getByRole('button', { name: 'proteindb:viewer_surface_opaque' })))
    expect(screen.getByRole('button', { name: 'proteindb:viewer_surface_opaque' })).toHaveAttribute('aria-pressed', 'true')
    press(() => fireEvent.click(screen.getByRole('button', { name: /proteindb:viewer_surface_type_vdw/ })))
    expect(screen.getByRole('button', { name: /proteindb:viewer_surface_type_vdw/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('the background swatches set the view’s background', () => {
    renderPane()
    const v = made[0]
    fireEvent.click(screen.getByRole('button', { name: 'proteindb:viewer_bg_black' }))
    expect(v.setBackgroundColor).toHaveBeenLastCalledWith('black')
  })

  it('docked (phone) draws the controls only in the open sheet’s slot', () => {
    const { rerender, props } = renderPane({ docked: true, toolsHost: null })
    expect(screen.queryByRole('checkbox', { name: 'Water' })).toBeNull()

    const host = document.createElement('div')
    document.body.append(host)
    rerender(<Mol3dPane {...props} docked toolsHost={host} />)
    expect(host.querySelector('input[type="checkbox"]')).not.toBeNull()
    host.remove()
  })

  it('resizes the viewer when a hidden pane is shown again', () => {
    const { rerender, props } = renderPane({ shown: false })
    const v = made[0]
    expect(v.resize).not.toHaveBeenCalled()
    rerender(<Mol3dPane {...props} shown />)
    expect(v.resize).toHaveBeenCalledTimes(1)
  })
})
