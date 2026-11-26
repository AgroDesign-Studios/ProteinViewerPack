/**
 * The single-owner click arbiter for the 3D viewer.
 *
 * A page drives picking entirely through this hook, so the ordering bug —
 * registering against a viewer ref that is still null — and the measure-mode
 * clobber are both pinned here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useResiduePicking, RESIDUE_HIGHLIGHT_COLOR, type PickMode } from './useResiduePicking'

function makeViewer() {
  let captured: ((atom: unknown) => void) | null = null
  const viewer = {
    setClickable: vi.fn((_sel: unknown, on: boolean, cb: (atom: unknown) => void) => {
      captured = on ? cb : null
    }),
    render: vi.fn(),
    click: (atom: unknown) => captured?.(atom),
    get handler() { return captured },
  }
  return viewer
}

interface Args {
  viewer: ReturnType<typeof makeViewer> | null
  viewerEpoch: number
  mode: PickMode
}

function setup(initial: Args) {
  const onPickResidue = vi.fn()
  const onPickAtom = vi.fn()
  const ref = { current: initial.viewer } as React.MutableRefObject<any>
  const view = renderHook(
    ({ viewerEpoch, mode }: { viewerEpoch: number; mode: PickMode }) =>
      useResiduePicking({ viewerRef: ref, viewerEpoch, mode, onPickResidue, onPickAtom }),
    { initialProps: { viewerEpoch: initial.viewerEpoch, mode: initial.mode } },
  )
  return { ...view, ref, onPickResidue, onPickAtom }
}

describe('useResiduePicking', () => {
  let viewer: ReturnType<typeof makeViewer>

  beforeEach(() => { viewer = makeViewer() })

  it('registers nothing while the viewer ref is still null', () => {
    // The exact shape of the original bug: the effect ran during the render pass
    // that kicked off load3Dmol(), long before the instance existed.
    //
    // Asserting on onPickResidue here would be vacuous — it is never called in
    // this scenario whether the null guard exists or not. The observable
    // difference is that setClickable must not be reached at all: without the
    // guard it throws on null and the try/catch turns a hard bug into a warning.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    setup({ viewer: null, viewerEpoch: 0, mode: 'residue' })
    expect(warn).not.toHaveBeenCalled()
  })

  it('does not re-register on an unrelated render', () => {
    const { rerender } = setup({ viewer, viewerEpoch: 1, mode: 'residue' })
    rerender({ viewerEpoch: 1, mode: 'residue' })
    expect(viewer.setClickable).toHaveBeenCalledTimes(1)
  })

  it('ignores residue picks on the symmetry-mate model but still measures them', () => {
    const onPickResidue = vi.fn()
    const onPickAtom = vi.fn()
    const ref = { current: viewer } as React.MutableRefObject<any>
    const { rerender } = renderHook(
      ({ mode }: { mode: PickMode }) =>
        useResiduePicking({ viewerRef: ref, viewerEpoch: 1, ignoreResidueModel: 3, mode, onPickResidue, onPickAtom }),
      { initialProps: { mode: 'residue' as PickMode } },
    )
    viewer.click({ chain: 'A', resi: 10, hetflag: false, model: 3 })
    expect(onPickResidue).not.toHaveBeenCalled()
    viewer.click({ chain: 'A', resi: 10, hetflag: false, model: 0 })
    expect(onPickResidue).toHaveBeenCalledWith('A', 10)

    rerender({ mode: 'measure' })
    const mate = { chain: 'A', resi: 10, hetflag: false, model: 3 }
    viewer.click(mate)
    expect(onPickAtom).toHaveBeenCalledWith(mate)
  })

  it('re-registers when a docking pose adds a model, so its atoms become pickable', () => {
    // setClickable flips a flag on the atoms that exist when it runs, so a model
    // added later is invisible to picking — measure mode could not reach a pose
    // at all.
    const onPickResidue = vi.fn()
    const onPickAtom = vi.fn()
    const ref = { current: viewer } as React.MutableRefObject<any>
    const { rerender } = renderHook(
      ({ modelsKey }: { modelsKey: number | null }) =>
        useResiduePicking({ viewerRef: ref, viewerEpoch: 1, modelsKey, mode: 'measure', onPickResidue, onPickAtom }),
      { initialProps: { modelsKey: null as number | null } },
    )
    expect(viewer.setClickable).toHaveBeenCalledTimes(1)
    rerender({ modelsKey: 42 })
    expect(viewer.setClickable).toHaveBeenCalledTimes(2)
  })

  it('registers once the viewer epoch announces a live instance', () => {
    const { ref, rerender } = setup({ viewer: null, viewerEpoch: 0, mode: 'residue' })
    expect(viewer.setClickable).not.toHaveBeenCalled()

    // What the page does inside load3Dmol().then(): assign, then bump.
    ref.current = viewer
    rerender({ viewerEpoch: 1, mode: 'residue' })

    expect(viewer.setClickable).toHaveBeenCalledTimes(1)
    expect(viewer.handler).not.toBeNull()
  })

  it('renders after registering, because 3Dmol rebuilds raycast targets only in render()', () => {
    setup({ viewer, viewerEpoch: 1, mode: 'residue' })
    expect(viewer.render).toHaveBeenCalled()
  })

  it('reports the chain and residue of a picked protein atom', () => {
    const { onPickResidue } = setup({ viewer, viewerEpoch: 1, mode: 'residue' })
    viewer.click({ chain: 'A', resi: 42, hetflag: false })
    expect(onPickResidue).toHaveBeenCalledWith('A', 42)
  })

  it('coerces a non-string chain id, which 3Dmol can hand back', () => {
    const { onPickResidue } = setup({ viewer, viewerEpoch: 1, mode: 'residue' })
    viewer.click({ chain: 1, resi: 7, hetflag: false })
    expect(onPickResidue).toHaveBeenCalledWith('1', 7)
  })

  it.each([
    ['a HETATM ligand', { chain: 'A', resi: 501, hetflag: true }],
    ['an atom with no residue number', { chain: 'A', hetflag: false }],
    ['a NaN residue number', { chain: 'A', resi: Number.NaN, hetflag: false }],
    ['an atom with no chain', { resi: 12, hetflag: false }],
    ['a null atom', null],
  ])('ignores %s', (_label, atom) => {
    // These would produce a selection the sequence viewer cannot render and the
    // hetflag:false highlight selector cannot paint.
    const { onPickResidue } = setup({ viewer, viewerEpoch: 1, mode: 'residue' })
    viewer.click(atom)
    expect(onPickResidue).not.toHaveBeenCalled()
  })

  it('routes to the measure callback while measure mode is on', () => {
    const { onPickAtom, onPickResidue } = setup({ viewer, viewerEpoch: 1, mode: 'measure' })
    const atom = { chain: 'A', resi: 42, hetflag: false, x: 1, y: 2, z: 3 }
    viewer.click(atom)
    expect(onPickAtom).toHaveBeenCalledWith(atom)
    expect(onPickResidue).not.toHaveBeenCalled()
  })

  it('passes a HETATM through in measure mode, since distances are not residue-scoped', () => {
    const { onPickAtom } = setup({ viewer, viewerEpoch: 1, mode: 'measure' })
    viewer.click({ hetflag: true, x: 0, y: 0, z: 0 })
    expect(onPickAtom).toHaveBeenCalled()
  })

  it('switches mode without re-registering with 3Dmol', () => {
    // Re-registering walks every atom to reset its clickable flag; the mode is
    // read through a ref precisely so a toolbar toggle stays free.
    const { rerender } = setup({ viewer, viewerEpoch: 1, mode: 'residue' })
    expect(viewer.setClickable).toHaveBeenCalledTimes(1)
    rerender({ viewerEpoch: 1, mode: 'measure' })
    expect(viewer.setClickable).toHaveBeenCalledTimes(1)
  })

  it('restores residue picking after measure mode is turned off', () => {
    // Regression: the old measure toggle called setClickable({}, false, ...) on
    // exit, killing every click until the viewer was rebuilt.
    const { rerender, onPickResidue } = setup({ viewer, viewerEpoch: 1, mode: 'residue' })
    rerender({ viewerEpoch: 1, mode: 'measure' })
    rerender({ viewerEpoch: 1, mode: 'residue' })

    expect(viewer.handler).not.toBeNull()
    viewer.click({ chain: 'C', resi: 9, hetflag: false })
    expect(onPickResidue).toHaveBeenCalledWith('C', 9)
  })

  it('survives a viewer whose setClickable throws', () => {
    const angry = { ...makeViewer(), setClickable: vi.fn(() => { throw new Error('no models yet') }) }
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => setup({ viewer: angry as any, viewerEpoch: 1, mode: 'residue' })).not.toThrow()
  })

  it('exposes one highlight colour for both viewer pages', () => {
    // 3Dmol needs a literal material colour, so this cannot be a CSS variable;
    // pinning it keeps the two pages from drifting apart.
    expect(RESIDUE_HIGHLIGHT_COLOR).toBe('#FBBF24')
  })
})
