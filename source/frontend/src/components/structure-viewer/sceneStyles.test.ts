/**
 * The base scene the viewers share.
 *
 * These assertions are the reason the module exists: one copy of this logic
 * for every viewer, so the viewers cannot drift apart. A fake viewer records the
 * calls in order, because the ORDER is what several of the rules are about.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SURFACE_TYPE_LEGACY } from './surfaceType'
import {
  SURFACE_TRANSLUCENT_OPACITY,
  VIEW_STYLES_DEFAULT,
  VIEW_STYLE_KEYS,
  applyResidueHighlight,
  applySceneStyles,
  flattenToColor,
  issuedWhile,
  proteinStyleFor,
  proteinStyleForSet,
  sameViewStyles,
  sanitizeViewStyles,
  toggleViewStyle,
  type SceneSettings,
  type SurfaceHandle,
  type ViewStyle,
} from './sceneStyles'

interface Call {
  fn: string
  args: unknown[]
}

function makeViewer() {
  const calls: Call[] = []
  const rec = (fn: string) => (...args: unknown[]) => { calls.push({ fn, args }) }
  return {
    calls,
    removeAllSurfaces: vi.fn(rec('removeAllSurfaces')),
    setStyle: vi.fn(rec('setStyle')),
    addStyle: vi.fn(rec('addStyle')),
    addSurface: vi.fn(rec('addSurface')),
  }
}

const BASE_SETTINGS: SceneSettings = {
  viewStyles: ['cartoon'],
  colorOption: { colorscheme: 'spectrum' },
  showProtein: true,
  showLigands: true,
  showWater: false,
  showSurface: false,
  surfaceOpaque: false,
  // The pre-selectable-surface constant, so every case that is not ABOUT
  // the surface type keeps drawing what these tests were written against.
  surfaceType: SURFACE_TYPE_LEGACY,
}

describe('proteinStyleFor', () => {
  it('spreads the colour option into every representation it builds', () => {
    const colorOption = { colorscheme: 'chain' }
    for (const style of ['cartoon', 'stick', 'ballstick', 'line', 'trace', 'cross'] as const) {
      const built = proteinStyleFor(style, colorOption)
      const reps = Object.values(built)
      expect(reps.length).toBeGreaterThan(0)
      // Every representation carries the colouring. A missed spread renders the
      // protein in 3Dmol's default colours while the menu claims otherwise —
      // which looks like a working feature.
      for (const rep of reps) expect(rep).toMatchObject(colorOption)
    }
  })

  it('builds ball-and-stick from TWO representations, not one', () => {
    const built = proteinStyleFor('ballstick', {})
    expect(Object.keys(built).sort()).toEqual(['sphere', 'stick'])
    expect(built.sphere.scale).toBe(0.3)
  })

  it('draws trace as a 3Dmol trace-style cartoon and cross with a usable line width', () => {
    // The key NAME is the whole feature: 3Dmol dispatches the Cα trace on
    // `cartoon.style === 'trace'` and silently ignores any key it does not know.
    // The previous spelling, `tube: true`, was such a key, so Trace rendered
    // pixel-identical to Ribbon for the life of the feature — while this test
    // pinned the misspelling as correct. Assert the read key AND the absence of
    // the ignored one, so neither can quietly come back.
    const trace = proteinStyleFor('trace', {}).cartoon
    expect(trace).toMatchObject({ style: 'trace' })
    expect(trace).not.toHaveProperty('tube')
    expect(proteinStyleFor('cross', {}).cross).toMatchObject({ linewidth: 2 })
  })

  it('falls back to cartoon for an unknown style rather than rendering nothing', () => {
    // Reachable through a persisted viewer-state blob written by an older build.
    const built = proteinStyleFor('nonsense' as never, {})
    expect(Object.keys(built)).toEqual(['cartoon'])
  })
})

describe('flattenToColor', () => {
  it('overrides a scheme instead of leaving it beside the flat colour', () => {
    // The whole point of the base layer. `colorscheme` left in place wins over
    // `color` in 3Dmol, so an omitted override is a base layer that never
    // appears — and an unscored residue then reads as a confident low score.
    const flat = flattenToColor({ cartoon: { colorscheme: 'spectrum' } }, 'grey')
    expect(flat.cartoon.color).toBe('grey')
    expect('colorscheme' in flat.cartoon).toBe(true)
    expect(flat.cartoon.colorscheme).toBeUndefined()
  })

  it('clears a colorfunc for the same reason', () => {
    const flat = flattenToColor({ stick: { colorfunc: () => 'red' } }, 'grey')
    expect(flat.stick.colorfunc).toBeUndefined()
  })

  it('does not mutate the style it was given', () => {
    const original = { cartoon: { colorscheme: 'spectrum' } }
    flattenToColor(original, 'grey')
    expect(original.cartoon.colorscheme).toBe('spectrum')
  })
})

describe('applySceneStyles', () => {
  let viewer: ReturnType<typeof makeViewer>

  beforeEach(() => { viewer = makeViewer() })
  afterEach(() => { delete (window as any).$3Dmol })

  it('clears every model style before painting anything', () => {
    applySceneStyles(viewer, BASE_SETTINGS)
    // Unscoped, and FIRST: this is what wipes a caller's own models, which is
    // why the caller has to re-apply them after every restyle.
    expect(viewer.calls[0]).toEqual({ fn: 'setStyle', args: [{}, {}] })
  })

  it('scopes every style step to one model when asked, and the surface to none', () => {
    // A viewer may hold many other models beside the receptor. Unscoped, the
    // clear and the ligand step reach every one of them, and each restyle
    // (once per frame on a drag) forces a geometry rebuild per model. With
    // `model` set, no other model's atom is selected.
    const receptor = { id: 0 }
    applySceneStyles(viewer, { ...BASE_SETTINGS, showLigands: true, showWater: true }, { model: receptor })
    const styleCalls = viewer.calls.filter(c => c.fn === 'setStyle' || c.fn === 'addStyle')
    expect(styleCalls.length).toBeGreaterThan(3)
    for (const c of styleCalls) {
      expect((c.args[0] as Record<string, unknown>).model).toBe(receptor)
    }
    // The opening clear is still first — scoped, not gone.
    expect(viewer.calls[0]).toEqual({ fn: 'setStyle', args: [{ model: receptor }, {}] })
  })

  it('leaves the surface selector unscoped even when the styles are scoped', () => {
    // `surfaceController` compares requests by their selector, and
    // `{hetflag: false}` already excludes every HETATM atom, so scoping it would
    // change the request identity for no coverage gain.
    (window as any).$3Dmol = { SurfaceType: { VDW: 1, MS: 2, SAS: 3, SES: 4 } }
    applySceneStyles(viewer, { ...BASE_SETTINGS, showSurface: true }, { model: { id: 0 } })
    expect(viewer.addSurface).toHaveBeenCalled()
    expect(viewer.addSurface.mock.calls[0][2]).toEqual({ hetflag: false })
  })

  it('scopes the surface to one model by id when asked', () => {
    // Symmetry mates are ATOM records too, so `{hetflag: false}` alone would
    // wrap one mesh around the reference and every copy. The id must be a
    // NUMBER: `surfaceController` compares selectors by primitive value, and a
    // model handle there would make every restyle a rebuild.
    (window as any).$3Dmol = { SurfaceType: { VDW: 1, MS: 2, SAS: 3, SES: 4 } }
    applySceneStyles(viewer, { ...BASE_SETTINGS, showSurface: true }, { model: 0, surfaceModel: 0 })
    expect(viewer.addSurface.mock.calls[0][2]).toEqual({ hetflag: false, model: 0 })
  })

  it('still clears the surface, now from the step that owns it', () => {
    // The `removeAllSurfaces()` that used to lead this function moved into step
    // 5 so `surfaceController` could weigh the old surface against the new
    // request. This pins that it did not simply disappear: with Surface off,
    // a restyle is still what wipes a mesh some other path left in the scene.
    applySceneStyles(viewer, BASE_SETTINGS)
    expect(viewer.removeAllSurfaces).toHaveBeenCalledTimes(1)
  })

  it('leaves the surface mesh alone under skipSurface', () => {
    (window as any).$3Dmol = { SurfaceType: { VDW: 1, MS: 2, SAS: 3, SES: 4 } }
    applySceneStyles(viewer, { ...BASE_SETTINGS, showSurface: true }, { skipSurface: true })
    expect(viewer.removeAllSurfaces).not.toHaveBeenCalled()
    expect(viewer.addSurface).not.toHaveBeenCalled()
  })

  it('paints no protein at all when the switch is off', () => {
    applySceneStyles(viewer, { ...BASE_SETTINGS, showProtein: false, showLigands: false })
    // Only the unscoped clear; nothing selected hetflag:false afterwards.
    const proteinCalls = viewer.setStyle.mock.calls.filter(
      ([sel]) => (sel as Record<string, unknown>)?.hetflag === false,
    )
    expect(proteinCalls).toHaveLength(0)
  })

  const isWater = (sel: unknown) => {
    const resn = (sel as { resn?: unknown } | undefined)?.resn
    return Array.isArray(resn) && resn.includes('HOH')
  }

  it('clears water when ligands are on, so Ligands does not drag water in', () => {
    applySceneStyles(viewer, { ...BASE_SETTINGS, showLigands: true, showWater: false })
    const order = viewer.calls.map(c => c.fn + JSON.stringify(c.args[0]))
    expect(order).toContain('addStyle{"hetflag":true}')
    // Every water residue name, one list (PT-1070 item 18).
    expect(order).toContain('setStyle{"resn":["HOH","WAT","DOD"]}')
    // ...and nothing put it back.
    expect(viewer.addStyle.mock.calls.some(([sel]) => isWater(sel))).toBe(false)
  })

  it('re-adds water AFTER the ligand step cleared it', () => {
    applySceneStyles(viewer, { ...BASE_SETTINGS, showLigands: true, showWater: true })
    const clearedAt = viewer.calls.findIndex(c => c.fn === 'setStyle' && isWater(c.args[0]))
    const addedAt = viewer.calls.findIndex(c => c.fn === 'addStyle' && isWater(c.args[0]))
    expect(clearedAt).toBeGreaterThanOrEqual(0)
    // Inverting these two silently loses water whenever Ligands is also on.
    expect(addedAt).toBeGreaterThan(clearedAt)
  })

  it('paints the base layer first and the ramp only over its selection', () => {
    applySceneStyles(viewer, {
      ...BASE_SETTINGS,
      base: { color: 'grey', rampSelection: { chain: ['A'], hetflag: false } },
    })
    const baseCall = viewer.setStyle.mock.calls.find(
      ([sel]) => (sel as any)?.hetflag === false,
    )
    expect((baseCall?.[1] as any).cartoon.color).toBe('grey')
    const rampCall = viewer.addStyle.mock.calls.find(([sel]) => (sel as any)?.chain)
    expect((rampCall?.[1] as any).cartoon.colorscheme).toBe('spectrum')
  })

  it('paints the base bare when there is nothing to ramp over', () => {
    applySceneStyles(viewer, { ...BASE_SETTINGS, base: { color: 'grey', rampSelection: null } })
    // No chain-scoped addStyle: an unavailable score set must leave the grey
    // base as the whole picture rather than fall back to a rainbow that looks
    // exactly like a real colouring.
    expect(viewer.addStyle.mock.calls.some(([sel]) => (sel as any)?.chain)).toBe(false)
  })

  it('skips the surface when 3Dmol has not loaded, instead of throwing', () => {
    applySceneStyles(viewer, { ...BASE_SETTINGS, showSurface: true })
    expect(viewer.addSurface).not.toHaveBeenCalled()
  })

  it('uses full opacity only when the caller says nothing is hidden behind it', () => {
    (window as any).$3Dmol = { SurfaceType: { VDW: 1, MS: 2, SAS: 3, SES: 4 } }
    applySceneStyles(viewer, { ...BASE_SETTINGS, showSurface: true, surfaceOpaque: true })
    expect((viewer.addSurface.mock.calls[0][1] as any).opacity).toBe(1)

    viewer = makeViewer()
    applySceneStyles(viewer, { ...BASE_SETTINGS, showSurface: true, surfaceOpaque: false })
    expect((viewer.addSurface.mock.calls[0][1] as any).opacity).toBe(SURFACE_TRANSLUCENT_OPACITY)
  })

  it('draws the surface type the caller asked for, as 3Dmol’s own number', () => {
    // Argument ZERO, and the exact number: `const x: SurfaceType = 4` and `= 2`
    // both type-check, so nothing but the value can tell MS from SES — and an
    // `undefined` here is drawn as VDW with nothing logged.
    ;(window as any).$3Dmol = { SurfaceType: { VDW: 1, MS: 2, SAS: 3, SES: 4 } }
    applySceneStyles(viewer, { ...BASE_SETTINGS, showSurface: true, surfaceType: 'MS' })
    expect(viewer.addSurface.mock.calls[0][0]).toBe(2)

    viewer.addSurface.mockClear()
    applySceneStyles(viewer, { ...BASE_SETTINGS, showSurface: true, surfaceType: 'SES' })
    expect(viewer.addSurface.mock.calls[0][0]).toBe(4)
  })

  it('never hands addSurface an undefined type, even with a partial enum', () => {
    ;(window as any).$3Dmol = { SurfaceType: { VDW: 1 } }
    applySceneStyles(viewer, { ...BASE_SETTINGS, showSurface: true, surfaceType: 'MS' })
    expect(viewer.addSurface.mock.calls[0][0]).toBeTypeOf('number')
  })

  it('scopes the surface to the protein so a ligand is not buried in it', () => {
    (window as any).$3Dmol = { SurfaceType: { VDW: 1, MS: 2, SAS: 3, SES: 4 } }
    applySceneStyles(viewer, { ...BASE_SETTINGS, showSurface: true })
    expect(viewer.addSurface.mock.calls[0][2]).toEqual({ hetflag: false })
  })
})

describe('applyResidueHighlight', () => {
  it('does nothing when nothing is picked', () => {
    const viewer = makeViewer()
    applyResidueHighlight(viewer, null, '#FBBF24')
    expect(viewer.addStyle).not.toHaveBeenCalled()
  })

  it('passes the caller\'s residue selector through unchanged', () => {
    // Both shapes, because both ship: a range string and a bare number, each
    // pinned by its own page test. A
    // helper that normalised them would silently rewrite one page's selector.
    const ranged = makeViewer()
    applyResidueHighlight(ranged, { chain: 'B', resi: '10-12' }, '#FBBF24')
    expect(ranged.addStyle.mock.calls[0][0]).toEqual({ chain: 'B', resi: '10-12', hetflag: false })

    const single = makeViewer()
    applyResidueHighlight(single, { chain: 'A', resi: 42 }, '#FBBF24')
    expect(single.addStyle.mock.calls[0][0]).toEqual({ chain: 'A', resi: 42, hetflag: false })
  })

  it('scopes the highlight to one model only when a model is given', () => {
    // A symmetry copy carries the reference's chain ids and residue numbers,
    // so without the scope every copy lights up the picked residue too.
    const scoped = makeViewer()
    applyResidueHighlight(scoped, { chain: 'A', resi: 42, model: 0 }, '#FBBF24')
    expect(scoped.addStyle.mock.calls[0][0]).toEqual({ chain: 'A', resi: 42, hetflag: false, model: 0 })
  })

  it('paints both representations, so the residue is visible in every style', () => {
    const viewer = makeViewer()
    applyResidueHighlight(viewer, { chain: 'A', resi: 5 }, '#FBBF24')
    const style = viewer.addStyle.mock.calls[0][1] as any
    // Cartoon alone leaves the highlight invisible in Stick; stick alone leaves
    // it invisible in Ribbon. Both, always.
    expect(style.cartoon.color).toBe('#FBBF24')
    expect(style.stick.color).toBe('#FBBF24')
  })

  it('stays on the ATOM side unless the caller says otherwise', () => {
    // The default for picks that come from a sequence strip and a protein-only
    // click guard: a HETATM pass there could only ever paint a ligand nobody
    // chose.
    const viewer = makeViewer()
    applyResidueHighlight(viewer, { chain: 'A', resi: 42 }, '#FBBF24')
    expect((viewer.addStyle.mock.calls[0][0] as any).hetflag).toBe(false)
  })

  it('paints a HETATM pick on the HETATM side when asked', () => {
    // A pick that names a bound ligand or a metal ion: `hetflag: false`
    // matches none of those —
    // silently, so the residue would glow nowhere while the readout claimed it
    // was selected.
    const viewer = makeViewer()
    applyResidueHighlight(viewer, { chain: 'A', resi: 9, het: true }, '#FBBF24')
    expect(viewer.addStyle.mock.calls[0][0]).toEqual({ chain: 'A', resi: 9, hetflag: true })
  })

  it('accepts a list, one addStyle per entry', () => {
    // `chain` and `hetflag` are scalars in a 3Dmol selector — only `resi` can
    // carry a list — so entries differing in either cannot be merged.
    const viewer = makeViewer()
    applyResidueHighlight(viewer, [
      { chain: 'A', resi: [1, 2] },
      { chain: 'B', resi: [9], het: true },
    ], '#FBBF24')

    expect(viewer.addStyle).toHaveBeenCalledTimes(2)
    expect(viewer.addStyle.mock.calls[0][0]).toEqual({ chain: 'A', resi: [1, 2], hetflag: false })
    expect(viewer.addStyle.mock.calls[1][0]).toEqual({ chain: 'B', resi: [9], hetflag: true })
  })

  it('does nothing for an empty list', () => {
    const viewer = makeViewer()
    applyResidueHighlight(viewer, [], '#FBBF24')
    expect(viewer.addStyle).not.toHaveBeenCalled()
  })

  it('overrides a colour scheme instead of leaving it beside the highlight (PT-472)', () => {
    // `addStyle` MERGES into the spec the base painted, and 3Dmol resolves a
    // `colorscheme` (and a `colorfunc`) AFTER `color`, so a highlight that only
    // set `color` lost to the base's scheme in every slot the base had already
    // painted — the ribbon under Cartoon, the sticks under Stick — under Chain /
    // Secondary Structure / Element / B-factor / Dyna-1, every scheme the
    // viewers offer but Spectrum (a `color`, so simply overwritten). The keys
    // have to be PRESENT and undefined, exactly as `flattenToColor` does it: an
    // absent key would leave the scheme in place. Both slots, every entry, for
    // the same reason the previous test paints both.
    const viewer = makeViewer()
    applyResidueHighlight(viewer, [
      { chain: 'A', resi: 5 },
      { chain: 'B', resi: 7 },
    ], '#FBBF24')
    expect(viewer.addStyle).toHaveBeenCalledTimes(2)
    for (const call of viewer.addStyle.mock.calls) {
      const style = call[1] as any
      for (const slot of ['cartoon', 'stick']) {
        expect('colorscheme' in style[slot]).toBe(true)
        expect(style[slot].colorscheme).toBeUndefined()
        expect('colorfunc' in style[slot]).toBe(true)
        expect(style[slot].colorfunc).toBeUndefined()
      }
      // Each slot is its own object: the stick's radius must not reach the
      // cartoon, which a spec that reused one object for both would leak.
      expect(style.stick.radius).toBe(0.25)
      expect('radius' in style.cartoon).toBe(false)
      expect(style.stick).not.toBe(style.cartoon)
    }
  })

  it('resolves to the pick colour through the real 3Dmol merge and colour lookup', async () => {
    // The fix rests on two facts about the LIBRARY, not about this module:
    // `GLModel.setStyle(sel, spec, add=true)` copies a present-and-undefined
    // key over the base's value, and `getColorFromStyle` then treats the
    // undefined scheme as absent. A hand-written `Object.assign` model of the
    // merge would keep passing whatever a future 3dmol did (package.json pins
    // a caret range), so this drives the installed build: a two-residue model
    // painted with a Chain scheme on cartoon AND stick — both slots pre-filled,
    // the case that hid the pick — then the exact spec `applyResidueHighlight`
    // sends, through the real `addStyle` path and the real colour resolution.
    const umd = '3dmol/build/3Dmol.js' // registers window.$3Dmol; a variable, so tsc does not look for a .d.ts
    await import(/* @vite-ignore */ umd)
    const lib = (window as any).$3Dmol
    const model = new lib.GLModel(0, {})
    model.addMolData(twoResiduePdb(), 'pdb')
    model.setStyle({}, { cartoon: { colorscheme: 'chain', style: 'trace' }, stick: { colorscheme: 'chain' } })

    const viewer = makeViewer()
    applyResidueHighlight(viewer, { chain: 'A', resi: 5 }, '#FBBF24')
    const [sel, spec] = viewer.addStyle.mock.calls[0]
    model.setStyle(sel, spec, true) // what viewer.addStyle(sel, spec) does to each model

    const hexOf = (c: any) => (typeof c === 'number' ? c : c.getHex())
    const hex = (atom: any, slot: string) => hexOf(lib.getColorFromStyle(atom, atom.style[slot]))
    const picked = model.selectedAtoms({ resi: 5 })[0]
    const neighbour = model.selectedAtoms({ resi: 6 })[0]
    expect(hex(picked, 'cartoon')).toBe(0xfbbf24)
    expect(hex(picked, 'stick')).toBe(0xfbbf24)
    expect(picked.style.cartoon.style).toBe('trace') // #1794: the base's trace survives the merge
    expect(hex(neighbour, 'cartoon')).not.toBe(0xfbbf24) // scoped to the pick
    // The control that names the defect: in this build a bare `color` beside
    // the base's scheme still loses to it — which is why the keys are nulled.
    expect(hexOf(lib.getColorFromStyle(picked, { colorscheme: 'chain', color: '#FBBF24' }))).not.toBe(0xfbbf24)
  })
})

/** Two Cα atoms on chain A, residues 5 and 6, in PDB fixed-column format. */
function twoResiduePdb(): string {
  const atom = (serial: number, resi: number, x: number) =>
    'ATOM  ' + String(serial).padStart(5) + '  CA  ALA A' + String(resi).padStart(4) +
    '    ' + x.toFixed(3).padStart(8) + '  10.000  10.000  1.00 20.00           C  '
  return [atom(1, 5, 10), atom(2, 6, 13.8), 'END'].join('\n')
}

describe('onSurface — which build is allowed to report', () => {
  // The surface branch is guarded on the live 3Dmol global, because SurfaceType
  // is read off it (see `resolveSurfaceType`).
  beforeEach(() => {
    ;(window as any).$3Dmol = { SurfaceType: { VDW: 1, MS: 2, SAS: 3, SES: 4 } }
  })
  afterEach(() => { delete (window as any).$3Dmol })

  /** A promise plus its resolver, so a test can settle two builds out of order. */
  function deferred(): { promise: Promise<void>; resolve: () => void } {
    let resolve!: () => void
    const promise = new Promise<void>(r => { resolve = r })
    return { promise, resolve }
  }

  function surfaceSettings(): SceneSettings {
    return { ...BASE_SETTINGS, showSurface: true }
  }

  it('reports a handle once the mesh is built, not synchronously', async () => {
    const viewer = makeViewer()
    const build = deferred()
    // Cast: the recorder's `addSurface` is typed void, and this test needs the
    // real shape 3Dmol returns — a promise with `surfid` stamped on it.
    viewer.addSurface = vi.fn(() => Object.assign(build.promise, { surfid: 1 })) as never

    const onSurface = vi.fn()
    applySceneStyles(viewer as never, surfaceSettings(), { onSurface })
    // The null goes out immediately — the old surfaces are gone by then.
    expect(onSurface.mock.calls).toEqual([[null]])

    build.resolve()
    await build.promise
    await Promise.resolve()
    expect(onSurface).toHaveBeenLastCalledWith({ id: 1 })
  })

  it('reports every completed build as a DISTINCT object, id or no id', async () => {
    // 3Dmol recycles surface ids: `nextSurfID` is max+1 over the REMAINING
    // keys, so the surface replacing one after `removeAllSurfaces` is handed
    // the same number back. Two builds therefore report the same NUMBER, and a
    // consumer comparing numbers cannot tell "the mesh finished" from "nothing
    // changed" — which is how a cap gets cut from a half-merged mesh that no
    // later id change ever corrects. Identity is what carries the information,
    // so EVERY completed build reports a fresh object and the consumer re-reads
    // on each.
    //
    // The second apply lands mid-build, so `surfaceController` QUEUES it —
    // one build at a time is the module's point — and its build starts when
    // the first settles. This recorder viewer has no `getSurface`, so the
    // controller cannot verify its retained mesh and the queued request
    // rebuilds rather than reuses; both builds therefore report, serially.
    const viewer = makeViewer()
    const first = deferred()
    const second = deferred()
    viewer.addSurface = vi
      .fn()
      .mockReturnValueOnce(Object.assign(first.promise, { surfid: 1 }))
      .mockReturnValueOnce(Object.assign(second.promise, { surfid: 1 })) as never

    const onSurface = vi.fn()
    applySceneStyles(viewer as never, surfaceSettings(), { onSurface })
    applySceneStyles(viewer as never, surfaceSettings(), { onSurface })
    // Queued, not started: one build in flight means one `addSurface`.
    expect(viewer.addSurface).toHaveBeenCalledTimes(1)

    first.resolve()
    await first.promise
    await Promise.resolve()
    second.resolve()
    await second.promise
    await Promise.resolve()

    const calls = onSurface.mock.calls
    expect(calls.map(c => c[0])).toEqual([null, { id: 1 }, null, { id: 1 }])
    // Same number, different objects — that is the whole point.
    expect(calls[1][0]).not.toBe(calls[3][0])
  })

  it('a queued request reports through ITS caller, not the running build', async () => {
    // The publisher rides the request through the controller's queue. If the
    // queue kept only the request, the deferred build would report through
    // whatever callback armed the RUNNING build — a page that re-rendered in
    // between would have its fresh closure silently skipped.
    const viewer = makeViewer()
    const first = deferred()
    const second = deferred()
    viewer.addSurface = vi
      .fn()
      .mockReturnValueOnce(Object.assign(first.promise, { surfid: 1 }))
      .mockReturnValueOnce(Object.assign(second.promise, { surfid: 1 })) as never

    const runningPub = vi.fn()
    const queuedPub = vi.fn()
    applySceneStyles(viewer as never, surfaceSettings(), { onSurface: runningPub })
    applySceneStyles(viewer as never, surfaceSettings(), { onSurface: queuedPub })

    first.resolve()
    await first.promise
    await Promise.resolve()
    second.resolve()
    await second.promise
    await Promise.resolve()

    // The running build's drop and completion belong to the first caller...
    expect(runningPub.mock.calls.map(c => c[0])).toEqual([null, { id: 1 }])
    // ...and the queued build's to the second, drop included.
    expect(queuedPub.mock.calls.map(c => c[0])).toEqual([null, { id: 1 }])
  })

  it('does not touch the surface handoff under skipSurface', () => {
    const viewer = makeViewer()
    const onSurface = vi.fn()
    applySceneStyles(viewer as never, surfaceSettings(), { onSurface, skipSurface: true })
    expect(onSurface).not.toHaveBeenCalled()
    expect(viewer.removeAllSurfaces).not.toHaveBeenCalled()
  })
})

describe('issuedWhile', () => {
  /**
   * The whole point is a moment, not a value: the generation is read once when
   * the wrapper is BUILT and again when the build COMPLETES. Every case below
   * is one ordering of those two reads against a bump.
   */
  const gen = (start = 0) => ({ current: start })

  it('publishes when nothing mutated the surface set in between', () => {
    const publish = vi.fn()
    const g = gen()
    issuedWhile(g, publish)({ id: 1 })
    expect(publish).toHaveBeenCalledWith({ id: 1 })
  })

  it('drops a completion that a foreign mutation has overtaken', () => {
    // The defect this exists for: a toolbar build issued surfid 1 completes
    // after another path's `removeAllSurfaces` + `addSurface`, and `nextSurfID()`
    // being max-existing-key + 1 means that id now names the other surface.
    const publish = vi.fn()
    const g = gen()
    const report = issuedWhile(g, publish)
    g.current++
    report({ id: 1 })
    expect(publish).not.toHaveBeenCalled()
  })

  it('passes the SYNCHRONOUS null through, which is the one that must never be dropped', () => {
    // `applySceneStyles` clears its consumer in step 1, beside its own
    // `removeAllSurfaces`, and builds in step 5 — one synchronous run, so
    // nothing can bump in between. Swallowing that null would leave the page
    // holding a handle for a surface step 1 had just destroyed, which is
    // strictly worse than the bug the guard closes.
    const publish = vi.fn()
    const g = gen()
    const report = issuedWhile(g, publish)
    report(null)
    expect(publish).toHaveBeenCalledWith(null)
  })

  it('reads the generation live, not the value it was handed', () => {
    // Takes the ref OBJECT for exactly this reason. A wrapper built from a
    // number could only ever compare a snapshot with itself.
    const publish = vi.fn()
    const g = gen(7)
    const report = issuedWhile(g, publish)
    g.current = 8
    report({ id: 2 })
    g.current = 7
    report({ id: 3 })
    expect(publish).toHaveBeenCalledTimes(1)
    expect(publish).toHaveBeenCalledWith({ id: 3 })
  })

  it('lets two ordinary overlapping builds both report', () => {
    // Only a FOREIGN mutation bumps the generation, so a second restyle does
    // not silence the first — the behaviour an earlier review round settled on
    // (a superseded build's late report costs one extra read of the CURRENT
    // surface, and the live build's own report is always the last word).
    const published: (SurfaceHandle | null)[] = []
    const g = gen()
    const first = issuedWhile(g, s => published.push(s))
    const second = issuedWhile(g, s => published.push(s))
    second({ id: 1 })
    first({ id: 1 })
    expect(published).toHaveLength(2)
  })
})

describe('sanitizeViewStyles', () => {
  it('takes the array the multi-select writes', () => {
    expect(sanitizeViewStyles(['stick', 'line'], VIEW_STYLES_DEFAULT)).toEqual(['stick', 'line'])
  })

  it('takes the bare string every pre-multi-select blob carries', () => {
    // The whole point of accepting two shapes: a blob or a stored view written
    // before this row became a multi-select stores one value, and it means
    // exactly a one-element selection.
    expect(sanitizeViewStyles('trace', VIEW_STYLES_DEFAULT)).toEqual(['trace'])
  })

  it('orders by VIEW_STYLE_KEYS, not by the order the boxes were ticked', () => {
    // Two blobs describing the same picture must not draw differently, and the
    // merge in proteinStyleForSet resolves collisions by position.
    expect(sanitizeViewStyles(['cross', 'cartoon', 'stick'], VIEW_STYLES_DEFAULT))
      .toEqual(['cartoon', 'stick', 'cross'])
  })

  it('folds the legacy `surface` alias into the cartoon it has always painted', () => {
    expect(sanitizeViewStyles(['surface'], VIEW_STYLES_DEFAULT)).toEqual(['cartoon'])
    // ...and does not then carry it twice.
    expect(sanitizeViewStyles(['surface', 'cartoon'], VIEW_STYLES_DEFAULT)).toEqual(['cartoon'])
  })

  it('deduplicates', () => {
    expect(sanitizeViewStyles(['stick', 'stick'], VIEW_STYLES_DEFAULT)).toEqual(['stick'])
  })

  it('preserves an EMPTY selection rather than replacing it with the fallback', () => {
    // Reachable from the UI — every box can be unticked — so it has to survive a
    // round trip, or the viewer would silently repaint a protein the user hid.
    expect(sanitizeViewStyles([], VIEW_STYLES_DEFAULT)).toEqual([])
  })

  it('falls back when an array holds nothing usable, which is NOT an empty selection', () => {
    // The distinction the carve-out above must not launder away: `[]` is a
    // choice, `['bogus']` is a corrupt blob.
    expect(sanitizeViewStyles(['bogus'], VIEW_STYLES_DEFAULT)).toEqual([...VIEW_STYLES_DEFAULT])
    expect(sanitizeViewStyles(['bogus', 42, null], VIEW_STYLES_DEFAULT))
      .toEqual([...VIEW_STYLES_DEFAULT])
  })

  it('falls back on anything that is not a selection at all', () => {
    for (const raw of [undefined, null, 42, {}, true, '']) {
      expect(sanitizeViewStyles(raw, VIEW_STYLES_DEFAULT)).toEqual([...VIEW_STYLES_DEFAULT])
    }
  })

  it("honours the caller's fallback rather than a constant of its own", () => {
    expect(sanitizeViewStyles(undefined, ['cross'])).toEqual(['cross'])
  })
})

describe('toggleViewStyle', () => {
  it('adds and removes one key', () => {
    expect(toggleViewStyle(['cartoon'], 'stick')).toEqual(['cartoon', 'stick'])
    expect(toggleViewStyle(['cartoon', 'stick'], 'cartoon')).toEqual(['stick'])
  })

  it('can empty the selection', () => {
    expect(toggleViewStyle(['cartoon'], 'cartoon')).toEqual([])
  })

  it('keeps the canonical order however the boxes are ticked', () => {
    let styles: readonly ViewStyle[] = []
    for (const key of ['cross', 'cartoon', 'line'] as const) styles = toggleViewStyle(styles, key)
    expect(styles).toEqual(['cartoon', 'line', 'cross'])
  })
})

describe('proteinStyleForSet', () => {
  const color = { colorscheme: 'chain' }

  it('draws nothing for an empty selection', () => {
    // `{}` is the 3Dmol style object that paints nothing, which is what an
    // unticked Style row must produce — not a silent fallback to cartoon.
    expect(proteinStyleForSet([], color)).toEqual({})
  })

  it('merges the representations into ONE style object', () => {
    // 3Dmol takes one style object per selection, so drawing several
    // representations is a merge — a second setStyle would replace the first.
    const built = proteinStyleForSet(['cartoon', 'stick'], color)
    expect(built).toHaveProperty('cartoon')
    expect(built).toHaveProperty('stick')
    expect(built.cartoon).toMatchObject(color)
    expect(built.stick).toMatchObject(color)
  })

  it('is independent of the order the caller lists them in', () => {
    expect(proteinStyleForSet(['stick', 'cartoon'], color))
      .toEqual(proteinStyleForSet(['cartoon', 'stick'], color))
  })

  it('resolves the one pair that genuinely collides in favour of trace', () => {
    // `cartoon` and `trace` compete for 3Dmol's single `cartoon` slot and the
    // library cannot draw both. `trace` comes later in VIEW_STYLE_KEYS, so the
    // trace wins — deterministically, which is the part that matters.
    const built = proteinStyleForSet(['cartoon', 'trace'], color)
    expect(Object.keys(built)).toEqual(['cartoon'])
    expect(built.cartoon.style).toBe('trace')
  })

  it("keeps ball-and-stick's spheres when plain Stick is ticked too", () => {
    // They share the `stick` slot, but with identical specs — so the overwrite
    // is invisible and the spheres must survive it.
    const built = proteinStyleForSet(['stick', 'ballstick'], color)
    expect(built.sphere).toMatchObject({ scale: 0.3 })
    expect(built.stick).toMatchObject(color)
  })

  it('folds the legacy alias here too, so an unsanitised list still draws', () => {
    // Belt and braces with `sanitizeViewStyles`: the failure of not doing it is
    // that NOTHING is drawn, which is silent.
    expect(proteinStyleForSet(['surface'], color)).toEqual(proteinStyleForSet(['cartoon'], color))
  })

  it('agrees with proteinStyleFor on every single-key selection', () => {
    // The merge must not quietly change what one representation looks like.
    for (const key of VIEW_STYLE_KEYS) {
      expect(proteinStyleForSet([key], color)).toEqual(proteinStyleFor(key, color))
    }
  })
})

describe('applySceneStyles with several representations', () => {
  it('hands 3Dmol one style object carrying all of them', () => {
    // The integration the unit tests above cannot prove: `applySceneStyles` must
    // route through the SET builder. Routing through `proteinStyleFor` with one
    // of the values would draw a single representation and fail nothing else.
    const viewer = makeViewer()
    applySceneStyles(viewer, { ...BASE_SETTINGS, viewStyles: ['cartoon', 'stick'] })
    const protein = viewer.setStyle.mock.calls
      .filter(([sel]) => (sel as { hetflag?: boolean })?.hetflag === false)
      .map(([, style]) => style as Record<string, unknown>)
    expect(protein).toHaveLength(1)
    expect(protein[0]).toHaveProperty('cartoon')
    expect(protein[0]).toHaveProperty('stick')
  })

  it('paints no protein at all when nothing is ticked', () => {
    const viewer = makeViewer()
    applySceneStyles(viewer, { ...BASE_SETTINGS, viewStyles: [] })
    const protein = viewer.setStyle.mock.calls
      .filter(([sel]) => (sel as { hetflag?: boolean })?.hetflag === false)
      .map(([, style]) => style as Record<string, unknown>)
    // The call still happens — it is what CLEARS the previous representation —
    // but it carries nothing to draw.
    expect(protein).toEqual([{}])
  })
})

describe('toggleViewStyle and the legacy alias', () => {
  it('folds `surface` on the incoming list instead of dropping it', () => {
    // Round-2 review finding. `VIEW_STYLE_KEYS` excludes the alias, so the
    // filter at the end of the toggler DISCARDED it — turning a selection that
    // means "draw a cartoon" into one that draws nothing, silently. The other
    // two functions that have to agree with the union both fold it.
    expect(toggleViewStyle(['surface'], 'stick')).toEqual(['cartoon', 'stick'])
  })

  it('folds `surface` on the key, so ticking it is not a no-op', () => {
    expect(toggleViewStyle([], 'surface')).toEqual(['cartoon'])
    expect(toggleViewStyle(['cartoon'], 'surface')).toEqual([])
  })
})

describe('sameViewStyles', () => {
  it('is true for equal canonical selections, including two empties', () => {
    expect(sameViewStyles(['cartoon', 'stick'], ['cartoon', 'stick'])).toBe(true)
    expect(sameViewStyles([], [])).toBe(true)
  })

  it('is false on a different length or a different member', () => {
    expect(sameViewStyles(['cartoon'], ['cartoon', 'stick'])).toBe(false)
    expect(sameViewStyles(['cartoon'], ['stick'])).toBe(false)
    expect(sameViewStyles(['cartoon'], [])).toBe(false)
  })

  it('lets a restore keep the previous REFERENCE when the value is unchanged', () => {
    // This is the whole point, and the reason the selection needed a comparison
    // at all: React bails out of a re-render on `Object.is`, which the old
    // single string satisfied for free. `sanitizeViewStyles` returns a fresh
    // array every call, so without this an idempotent stored-view restore re-ran
    // the full restyle — `removeAllSurfaces()`, an MS rebuild, and a cut face
    // that visibly disappeared and came back.
    const onScreen = sanitizeViewStyles(['cartoon'], VIEW_STYLES_DEFAULT)
    const restored = sanitizeViewStyles(['cartoon'], VIEW_STYLES_DEFAULT)
    expect(restored).not.toBe(onScreen)
    expect(sameViewStyles(onScreen, restored)).toBe(true)
    const kept = sameViewStyles(onScreen, restored) ? onScreen : restored
    expect(kept).toBe(onScreen)
  })

  it('still reports a change when the restore really differs', () => {
    const onScreen = sanitizeViewStyles(['cartoon'], VIEW_STYLES_DEFAULT)
    const restored = sanitizeViewStyles(['cartoon', 'stick'], VIEW_STYLES_DEFAULT)
    expect(sameViewStyles(onScreen, restored)).toBe(false)
  })

  it('compares by position, which every producer here guarantees', () => {
    // An index compare is only sound because `VIEW_STYLES_DEFAULT`,
    // `sanitizeViewStyles` and `toggleViewStyle` all emit VIEW_STYLE_KEYS order.
    // Pin that, so a producer that stopped ordering would fail here rather than
    // silently make two equal selections compare unequal.
    for (const raw of [['cross', 'cartoon'], ['stick', 'cartoon', 'line']]) {
      const sorted = sanitizeViewStyles(raw, VIEW_STYLES_DEFAULT)
      expect(sorted).toEqual(VIEW_STYLE_KEYS.filter(k => sorted.includes(k)))
    }
    expect(toggleViewStyle(['cross'], 'cartoon')).toEqual(['cartoon', 'cross'])
  })
})
