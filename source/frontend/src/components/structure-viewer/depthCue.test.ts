/**
 * depthCue — the arithmetic between the two toolbar controls and the numbers
 * 3Dmol's camera actually takes.
 *
 * The assertions worth having here are the ones a screenshot cannot make: that
 * the resting state reproduces 3Dmol's own defaults exactly (so the feature is
 * invisible until asked for), that the slice moves the way the sliders claim,
 * and that a hand-edited localStorage blob cannot reach the clipping planes.
 */
import { describe, it, expect, vi } from 'vitest'
import {
  CAP_COLOR_PRESETS,
  CAP_OPACITY_DEFAULT,
  CAP_OPACITY_MAX,
  CAP_OPACITY_MIN,
  CUT_MAX,
  DEPTH_CUE_DEFAULT,
  FOG_DEFAULT_START,
  MIN_SPAN_A,
  THICKNESS_MIN,
  applyDepthCue,
  applyProjection,
  assertsSlab,
  capFillFor,
  capOpacityFor,
  depthCueFromViewState,
  depthWindowA,
  fogForDepthCue,
  isCustomCapColor,
  isDepthCueDefault,
  measureSpan,
  orthoAfterToggle,
  orthoFor,
  sanitizeDepthCue,
  slabForDepthCue,
  sliderFill,
  type DepthCue,
} from './depthCue'

const SPAN = 100

const cue = (over: Partial<DepthCue> = {}): DepthCue => ({ ...DEPTH_CUE_DEFAULT, ...over })

/**
 * Recording double with the same shape the page's real viewer exposes.
 *
 * The return type is inferred rather than annotated as `SlabCapableViewer`:
 * the interface would erase the `Mock` wrappers and take `.mock.calls` with
 * them. `applyDepthCue` still type-checks its argument structurally, so the
 * double is verified against the interface at every call site below.
 */
function stubViewer(far = 50) {
  return {
    fitSlab: vi.fn(),
    getSlab: vi.fn(() => ({ near: -far / 0.95, far })),
    setSlab: vi.fn(),
    enableFog: vi.fn(),
    setProjection: vi.fn(),
    render: vi.fn(),
  }
}

describe('slabForDepthCue', () => {
  it('reproduces 3Dmol zoomTo()s permissive slab when nothing is enabled', () => {
    // Not "close to" — the same expression zoomTo({}) uses. A view at rest has
    // to be the view that existed before this feature.
    expect(slabForDepthCue(DEPTH_CUE_DEFAULT, SPAN)).toEqual({ near: -200, far: 200 })
  })

  it('keeps the 50 A floor for a molecule small enough to need it', () => {
    expect(slabForDepthCue(DEPTH_CUE_DEFAULT, 10)).toEqual({ near: -50, far: 50 })
  })

  it('tightens to the molecule when only the depth cue is on', () => {
    // Fog is measured against the slab, so leaving the permissive slab in place
    // would make the strength slider nearly inert. This is the branch that
    // makes the cue visible at all.
    const slab = slabForDepthCue(cue({ fog: true }), SPAN)
    expect(slab.near).toBeCloseTo(-100 / 1.9, 6)
    expect(slab.far).toBeCloseTo(50, 6)
  })

  it('cuts the front and keeps the requested thickness', () => {
    const tightNear = -SPAN / 1.9
    const depth = SPAN / 2 - tightNear
    const slab = slabForDepthCue(cue({ slab: true, cut: 0.25, thickness: 0.5 }), SPAN)
    expect(slab.near).toBeCloseTo(tightNear + 0.25 * depth, 6)
    expect(slab.far - slab.near).toBeCloseTo(0.5 * depth, 6)
  })

  it('translates the slice without changing its thickness as cut grows', () => {
    // This is the whole point of the two-slider shape the owner picked: the
    // thickness stays put and the window walks backwards through the molecule.
    const a = slabForDepthCue(cue({ slab: true, cut: 0.1, thickness: 0.3 }), SPAN)
    const b = slabForDepthCue(cue({ slab: true, cut: 0.5, thickness: 0.3 }), SPAN)
    expect(b.near).toBeGreaterThan(a.near)
    expect(b.far - b.near).toBeCloseTo(a.far - a.near, 6)
  })

  it('clamps a cut beyond the cap so the scene can never be emptied', () => {
    const capped = slabForDepthCue(cue({ slab: true, cut: 5 }), SPAN)
    expect(capped).toEqual(slabForDepthCue(cue({ slab: true, cut: CUT_MAX }), SPAN))
  })

  it('never returns a zero- or negative-depth window', () => {
    for (const thickness of [0, -1, Number.NaN]) {
      const slab = slabForDepthCue(cue({ slab: true, cut: CUT_MAX, thickness }), SPAN)
      expect(slab.far).toBeGreaterThan(slab.near)
    }
  })

  it('falls back to the floor span for a non-finite measurement', () => {
    expect(slabForDepthCue(DEPTH_CUE_DEFAULT, Number.NaN))
      .toEqual(slabForDepthCue(DEPTH_CUE_DEFAULT, MIN_SPAN_A))
  })
})

describe('fogForDepthCue', () => {
  it('returns 3Dmol resting numbers when the cue is off, not "no fog"', () => {
    // 3Dmol ships fog ENABLED at fogStart 0.4. Switching our control off has to
    // restore that, or every view would lose a fade it always had.
    expect(fogForDepthCue(DEPTH_CUE_DEFAULT)).toEqual({ fogStart: FOG_DEFAULT_START, fogEnd: 1 })
  })

  it('starts the fade earlier as strength rises', () => {
    expect(fogForDepthCue(cue({ fog: true, fogStrength: 0.25 })).fogStart).toBeCloseTo(0.75, 6)
    expect(fogForDepthCue(cue({ fog: true, fogStrength: 1 })).fogStart).toBeCloseTo(0, 6)
  })

  it('collapses start onto end at strength 0, which is how the shaders spell off', () => {
    const fog = fogForDepthCue(cue({ fog: true, fogStrength: 0 }))
    expect(fog.fogStart).toBe(fog.fogEnd)
  })

  it('reproduces the library default at the default strength', () => {
    // 0.6 was chosen precisely so the first click lands on 3Dmol's own number;
    // what changes is the slab it is measured against.
    expect(fogForDepthCue(cue({ fog: true })).fogStart).toBeCloseTo(FOG_DEFAULT_START, 6)
  })
})

describe('measureSpan', () => {
  it('recovers the bounding-box diagonal from what fitSlab leaves behind', () => {
    const viewer = stubViewer(50)
    expect(measureSpan(viewer)).toBe(100)
    expect(viewer.fitSlab).toHaveBeenCalledWith({})
  })

  it('reports null rather than throwing when the model cannot be measured', () => {
    // Null, not the floor: the caller caches a measurement for the life of the
    // viewer, and caching the floor for a model that merely was not ready yet
    // would describe a full-size protein as 5 A until the page is reloaded.
    const viewer = stubViewer()
    viewer.getSlab = vi.fn(() => {
      throw new Error('getExtent on an empty model')
    })
    expect(measureSpan(viewer)).toBeNull()
  })

  it('reports null for a degenerate measurement', () => {
    expect(measureSpan(stubViewer(0))).toBeNull()
    expect(measureSpan(stubViewer(Number.NaN))).toBeNull()
  })

  it('measures again once the model becomes measurable', () => {
    // The contract that makes a retry possible at all: the same viewer that
    // could not be measured answers normally on a later call.
    const viewer = stubViewer()
    const real = viewer.getSlab
    viewer.getSlab = vi.fn(() => { throw new Error('not ready') })
    expect(measureSpan(viewer)).toBeNull()
    viewer.getSlab = real
    expect(measureSpan(viewer)).toBe(100)
  })

  it('still renders conservatively while unmeasured, via the floor downstream', () => {
    // Nothing is broken by a null: the arithmetic applies MIN_SPAN_A itself, so
    // an unmeasured viewer gets a correct-but-conservative window rather than
    // a NaN clipping plane.
    expect(slabForDepthCue(DEPTH_CUE_DEFAULT, Number.NaN))
      .toEqual(slabForDepthCue(DEPTH_CUE_DEFAULT, MIN_SPAN_A))
    expect(depthWindowA(Number.NaN)).toBeCloseTo(depthWindowA(MIN_SPAN_A), 6)
  })
})

describe('applyDepthCue', () => {
  it('writes the slab before the fog, because the fog is measured against it', () => {
    const viewer = stubViewer()
    applyDepthCue(viewer, cue({ fog: true, fogStrength: 0.5 }), SPAN)
    expect(viewer.setSlab.mock.invocationCallOrder[0])
      .toBeLessThan(viewer.enableFog.mock.invocationCallOrder[0])
    expect(viewer.enableFog).toHaveBeenCalledWith({ fogStart: 0.5, fogEnd: 1 })
  })

  it('is a no-op in effect at the defaults', () => {
    const viewer = stubViewer()
    applyDepthCue(viewer, DEPTH_CUE_DEFAULT, SPAN)
    expect(viewer.setSlab).toHaveBeenCalledWith(-200, 200)
    expect(viewer.enableFog).toHaveBeenCalledWith({ fogStart: FOG_DEFAULT_START, fogEnd: 1 })
    expect(viewer.setProjection).toHaveBeenCalledWith('perspective')
  })

  it('switches projection and always ends in a repaint', () => {
    const viewer = stubViewer()
    applyDepthCue(viewer, cue({ ortho: true }), SPAN)
    expect(viewer.setProjection).toHaveBeenCalledWith('orthographic')
    expect(viewer.render).toHaveBeenCalledTimes(1)
  })

  it('draws a following projection orthographic only while density is shown', () => {
    const shown = stubViewer()
    applyDepthCue(shown, DEPTH_CUE_DEFAULT, SPAN, { densityShown: true })
    expect(shown.setProjection).toHaveBeenCalledWith('orthographic')
    const none = stubViewer()
    applyDepthCue(none, DEPTH_CUE_DEFAULT, SPAN)
    expect(none.setProjection).toHaveBeenCalledWith('perspective')
  })

  describe('afterCameraMove', () => {
    it('touches nothing at the resting settings', () => {
      // Regression (round 1, Medium): a selection `zoomTo(sel)` leaves 3Dmol's
      // TIGHT slab — only `zoomTo({})` leaves the permissive one. Writing the
      // resting window here REPLACED that choice, widening a ligand-focus view
      // for users who never touched these controls.
      const viewer = stubViewer()
      applyDepthCue(viewer, DEPTH_CUE_DEFAULT, SPAN, { afterCameraMove: true })
      expect(viewer.setSlab).not.toHaveBeenCalled()
      expect(viewer.enableFog).not.toHaveBeenCalled()
      expect(viewer.setProjection).not.toHaveBeenCalled()
      expect(viewer.render).not.toHaveBeenCalled()
    })

    it('still asserts the settings when fog or the cross-section is on', () => {
      for (const on of [{ fog: true }, { slab: true }]) {
        const viewer = stubViewer()
        applyDepthCue(viewer, cue(on), SPAN, { afterCameraMove: true })
        expect(viewer.setSlab).toHaveBeenCalledTimes(1)
        expect(viewer.render).toHaveBeenCalledTimes(1)
      }
    })

    it('leaves the slab alone when only the projection is set', () => {
      // Regression (PT-1299): this used to count orthographic as "something
      // on", so with it set every ligand focus had its tight slab replaced by
      // the resting one. The projection itself survives the camera call —
      // `zoomTo` never touches `camera.ortho` — so there is nothing to write.
      for (const [ortho, densityShown] of [[true, false], [null, true]] as const) {
        const viewer = stubViewer()
        applyDepthCue(viewer, cue({ ortho }), SPAN, { afterCameraMove: true, densityShown })
        expect(viewer.setSlab).not.toHaveBeenCalled()
        expect(viewer.setProjection).not.toHaveBeenCalled()
      }
    })

    it('does NOT skip on the settings path, so switching off undoes a slice', () => {
      // The mirror of the first case: the resting write is what reopens the
      // view when the user turns the cross-section back off. Skipping it there
      // would strand the slab on the last slice.
      const viewer = stubViewer()
      applyDepthCue(viewer, DEPTH_CUE_DEFAULT, SPAN)
      expect(viewer.setSlab).toHaveBeenCalledWith(-200, 200)
    })
  })
})

describe('depthWindowA', () => {
  it('is the slab window, not the span', () => {
    // What one unit of cut/thickness is a fraction OF. The readouts multiplied
    // by the span instead, under-reporting every angstrom figure by 2.6%.
    expect(depthWindowA(100)).toBeCloseTo(100 / 2 + 100 / 1.9, 6)
    expect(depthWindowA(100)).toBeGreaterThan(100)
  })

  it('falls back to the floor span for a degenerate measurement', () => {
    expect(depthWindowA(Number.NaN)).toBeCloseTo(depthWindowA(MIN_SPAN_A), 6)
    expect(depthWindowA(0)).toBeCloseTo(depthWindowA(MIN_SPAN_A), 6)
  })

  it('matches the window slabForDepthCue actually spans', () => {
    const slab = slabForDepthCue(cue({ fog: true }), SPAN)
    expect(slab.far - slab.near).toBeCloseTo(depthWindowA(SPAN), 6)
  })
})

describe('DEPTH_CUE_DEFAULT', () => {
  it('is frozen, so nothing can redefine "default" for the whole session', () => {
    // It is both the initial React state AND sanitizeDepthCue's fallback, so a
    // single stray mutation would be untraceable from either use site.
    expect(Object.isFrozen(DEPTH_CUE_DEFAULT)).toBe(true)
  })
})

describe('sanitizeDepthCue', () => {
  it('reads a missing field as the defaults', () => {
    expect(sanitizeDepthCue(undefined)).toEqual(DEPTH_CUE_DEFAULT)
    expect(sanitizeDepthCue(null)).toEqual(DEPTH_CUE_DEFAULT)
    expect(sanitizeDepthCue('cross-section')).toEqual(DEPTH_CUE_DEFAULT)
  })

  it('reads a stored blob with no cap key as UNCAPPED', () => {
    // NOT the fresh-viewer default. Everything stored before the cut face
    // existed was drawn hollow, and both a localStorage blob and a stored
    // view come through here — restoring a stored view with a filled cut
    // it never had would show a picture it never was.
    // Same two-defaults rule as SURFACE_TYPE_DEFAULT vs SURFACE_TYPE_LEGACY.
    expect(DEPTH_CUE_DEFAULT.cap).toBe(true)
    expect(sanitizeDepthCue({ fog: false, slab: true, cut: 0.2 }).cap).toBe(false)
    expect(sanitizeDepthCue({ slab: true, cap: true }).cap).toBe(true)
    expect(sanitizeDepthCue({ slab: true, cap: 'yes' }).cap).toBe(false)
  })

  it('rejects values that would blank the canvas', () => {
    // The blob is user-writable localStorage and these numbers become
    // camera.near / camera.far: a NaN there renders nothing, with no error.
    const cleaned = sanitizeDepthCue({
      fog: 'yes', fogStrength: Number.NaN, slab: true, cut: 99, thickness: -3, ortho: null,
    })
    expect(cleaned.fog).toBe(DEPTH_CUE_DEFAULT.fog)
    expect(cleaned.fogStrength).toBe(DEPTH_CUE_DEFAULT.fogStrength)
    expect(cleaned.slab).toBe(true)
    expect(cleaned.cut).toBe(CUT_MAX)
    expect(cleaned.thickness).toBe(THICKNESS_MIN)
    expect(cleaned.ortho).toBe(DEPTH_CUE_DEFAULT.ortho)
  })

  it('keeps a stored projection as an override, and reads anything else as following', () => {
    // Every blob written before the projection followed the density says
    // `false`, and those views were perspective whatever the density: reading
    // that as "follow" would draw them orthographic under a map.
    expect(sanitizeDepthCue({ ortho: false }).ortho).toBe(false)
    expect(sanitizeDepthCue({ ortho: true }).ortho).toBe(true)
    expect(sanitizeDepthCue({ ortho: null }).ortho).toBeNull()
    expect(sanitizeDepthCue({ ortho: 'yes' }).ortho).toBeNull()
    expect(sanitizeDepthCue({ fog: true }).ortho).toBeNull()
  })

  it('passes a well-formed blob through unchanged', () => {
    const stored = cue({ fog: true, fogStrength: 0.35, slab: true, cut: 0.2, thickness: 0.4 })
    expect(sanitizeDepthCue(stored)).toEqual(stored)
  })
})

describe('depthCueFromViewState', () => {
  it('restores a shot older than the depth cue in perspective, not following the density', () => {
    // PT-2044 item 4. A view stored before #1623 has no `depthCue` at all and
    // was drawn in perspective; the fresh default (`ortho: null`) would draw it
    // orthographic whenever a map is on screen at restore time.
    const restored = depthCueFromViewState({})
    expect(restored.ortho).toBe(false)
    expect(orthoFor(restored, true)).toBe(false)
    expect({ ...restored, ortho: null }).toEqual(DEPTH_CUE_DEFAULT)
  })

  it('reads a present depth cue exactly as sanitizeDepthCue does', () => {
    const stored = cue({ fog: true, slab: true, cut: 0.2, ortho: null })
    expect(depthCueFromViewState({ depthCue: stored })).toEqual(sanitizeDepthCue(stored))
    expect(depthCueFromViewState({ depthCue: { ortho: true } }).ortho).toBe(true)
    // Present but mangled is damage, not age: the fresh defaults.
    expect(depthCueFromViewState({ depthCue: null })).toEqual(DEPTH_CUE_DEFAULT)
    expect(depthCueFromViewState({ depthCue: 'x' })).toEqual(DEPTH_CUE_DEFAULT)
  })
})

describe('isDepthCueDefault', () => {
  it('is true whenever all three switches are off, whatever the sliders say', () => {
    // A slider parked away from its default while its feature is off changes
    // nothing on screen, so offering Reset for it would be a control that
    // appears to do nothing.
    expect(isDepthCueDefault(cue({ fogStrength: 0.1, cut: 0.5, thickness: 0.2 }))).toBe(true)
  })

  it('is false as soon as one switch is on', () => {
    expect(isDepthCueDefault(cue({ fog: true }))).toBe(false)
    expect(isDepthCueDefault(cue({ slab: true }))).toBe(false)
    expect(isDepthCueDefault(cue({ ortho: true }))).toBe(false)
  })

  it('judges a projection override against what the density would pick', () => {
    // An override that agrees with the density is invisible, so Reset for it
    // would do nothing on screen; one that disagrees is exactly what Reset undoes.
    expect(isDepthCueDefault(cue({ ortho: true }), true)).toBe(true)
    expect(isDepthCueDefault(cue({ ortho: false }), false)).toBe(true)
    expect(isDepthCueDefault(cue({ ortho: false }), true)).toBe(false)
    expect(isDepthCueDefault(cue({ ortho: null }), true)).toBe(true)
  })
})

describe('the projection follows the density (PT-1299)', () => {
  it('rests in perspective and turns orthographic while a map is shown', () => {
    // A map is fitted in an orthographic view; away from density, perspective is the depth
    // cue a non-crystallographer reads.
    expect(DEPTH_CUE_DEFAULT.ortho).toBeNull()
    expect(orthoFor(DEPTH_CUE_DEFAULT, false)).toBe(false)
    expect(orthoFor(DEPTH_CUE_DEFAULT, true)).toBe(true)
  })

  it('lets a projection set by hand win either way', () => {
    expect(orthoFor(cue({ ortho: false }), true)).toBe(false)
    expect(orthoFor(cue({ ortho: true }), false)).toBe(true)
  })

  it('records a click that disagrees with the density as an override', () => {
    expect(orthoAfterToggle(DEPTH_CUE_DEFAULT, true)).toBe(false)
    expect(orthoAfterToggle(DEPTH_CUE_DEFAULT, false)).toBe(true)
  })

  it('drops the override when a click brings the projection back to the density’s', () => {
    // On, then off again, is where the user started: following. Recording
    // `false` instead would refuse to switch the next time a map is shown.
    expect(orthoAfterToggle(cue({ ortho: true }), false)).toBeNull()
    expect(orthoAfterToggle(cue({ ortho: false }), true)).toBeNull()
  })

  it('counts only fog and the cross-section as asserting a slab', () => {
    expect(assertsSlab(cue({ ortho: true }))).toBe(false)
    expect(assertsSlab(cue({ fog: true }))).toBe(true)
    expect(assertsSlab(cue({ slab: true }))).toBe(true)
  })

  it('applyProjection writes the projection and nothing else', () => {
    const viewer = stubViewer()
    applyProjection(viewer, true)
    expect(viewer.setProjection).toHaveBeenCalledWith('orthographic')
    expect(viewer.render).toHaveBeenCalledTimes(1)
    expect(viewer.setSlab).not.toHaveBeenCalled()
    expect(viewer.enableFog).not.toHaveBeenCalled()
  })
})

describe('sliderFill', () => {
  it('maps a value onto its track percentage', () => {
    expect(sliderFill(0.5, 0, 1)).toBe(50)
    expect(sliderFill(0.02, 0.02, 1)).toBe(0)
  })

  it('clamps rather than overflowing the gradient', () => {
    expect(sliderFill(-1, 0, 1)).toBe(0)
    expect(sliderFill(9, 0, 1)).toBe(100)
    expect(sliderFill(1, 5, 5)).toBe(0)
  })
})

describe('cut-face colour', () => {
  it('starts on the fill the feature shipped with', () => {
    expect(DEPTH_CUE_DEFAULT.capColor).toBe('gray')
    expect(CAP_COLOR_PRESETS).toContain(DEPTH_CUE_DEFAULT.capColor)
    // The picker has to open on SOMETHING, and an `<input type="color">` accepts
    // nothing but `#rrggbb`.
    expect(isCustomCapColor(DEPTH_CUE_DEFAULT.capCustomColor)).toBe(true)
  })

  it('draws a preset by name, and the mixed colour only once it is chosen', () => {
    const base = { ...DEPTH_CUE_DEFAULT, capCustomColor: '#123456' }
    expect(capFillFor({ ...base, capColor: 'firebrick' })).toBe('firebrick')
    expect(capFillFor({ ...base, capColor: 'custom' })).toBe('#123456')
  })

  it('keeps the mixed colour while a preset is held up against it', () => {
    // This is why the choice and the colour are two fields rather than one
    // "either a name or a hex" string: comparing a mixed colour with a preset is
    // the ordinary gesture of figure work, and one field would discard the mix
    // on the first click.
    const mixed = { ...DEPTH_CUE_DEFAULT, capColor: 'custom' as const, capCustomColor: '#123456' }
    const viaPreset = sanitizeDepthCue({ ...mixed, capColor: 'seagreen' })
    expect(capFillFor(viaPreset)).toBe('seagreen')
    expect(viaPreset.capCustomColor).toBe('#123456')
  })

  it('restores the default fill for a blob written before the picker existed', () => {
    // Unlike `cap`, both answers coincide: everything stored then was drawn in
    // the default grey, and the default grey is also where a fresh viewer
    // starts. There is deliberately no second constant here.
    const legacy = {
      fog: false, fogStrength: 0.6, slab: true, cut: 0.2, thickness: 0.6, ortho: false, cap: true,
    }
    const restored = sanitizeDepthCue(legacy)
    expect(restored.capColor).toBe(DEPTH_CUE_DEFAULT.capColor)
    expect(restored.capCustomColor).toBe(DEPTH_CUE_DEFAULT.capCustomColor)
  })

  it('refuses a fill a hand-edited blob invented', () => {
    // localStorage is user-writable and this value reaches 3Dmol's `addCustom`.
    // `rebeccapurple` is in the list on purpose: it IS a valid CSS colour, and
    // being one is not the test — being one of OURS is.
    for (const bad of ['rebeccapurple', 'custom-ish', '#12345', 'url(x)', 42, null, {}]) {
      expect(sanitizeDepthCue({ capColor: bad }).capColor).toBe(DEPTH_CUE_DEFAULT.capColor)
    }
    for (const bad of ['red', '#12345', '#1234567', 'rgb(1,2,3)', '', 7]) {
      expect(sanitizeDepthCue({ capCustomColor: bad }).capCustomColor)
        .toBe(DEPTH_CUE_DEFAULT.capCustomColor)
    }
  })

  it('normalises a well-formed mixed colour to the case the control uses', () => {
    // `<input type="color">` lower-cases its own value. Storing the blob's case
    // verbatim would leave the DOM value and the React prop permanently unequal,
    // and React would reassign `node.value` on every render — including every
    // render driven by an `input` while the dialog is open.
    expect(sanitizeDepthCue({ capColor: 'custom', capCustomColor: '#AbCdEf' }))
      .toMatchObject({ capColor: 'custom', capCustomColor: '#abcdef' })
  })
})

describe('cut-face opacity', () => {
  it('opens FOLLOWING the surface rather than at a number of its own', () => {
    // `null` is the setting the cut face has always had — it took the surface's
    // opacity so the two could not drift. Seeding a number instead would change
    // every existing viewer's picture the moment this shipped.
    expect(DEPTH_CUE_DEFAULT.capOpacity).toBeNull()
  })

  it('resolves a null override against whatever the surface is drawn at', () => {
    expect(capOpacityFor(cue({ capOpacity: null }), 1)).toBe(1)
    expect(capOpacityFor(cue({ capOpacity: null }), 0.7)).toBe(0.7)
  })

  it('lets a number win over the surface, in BOTH directions', () => {
    // The two pictures the linked version cannot make at all, and the reason the
    // control exists: a solid shell with a see-through cut, and the reverse.
    expect(capOpacityFor(cue({ capOpacity: 0.4 }), 1)).toBe(0.4)
    expect(capOpacityFor(cue({ capOpacity: 1 }), 0.7)).toBe(1)
  })

  it('does not treat a legitimate 0-ish override as absent', () => {
    // `??`, not `||`. The floor is 0.1 so a literal 0 cannot arrive from the
    // slider, but a `||` here would also swallow it if the floor ever moved.
    expect(capOpacityFor(cue({ capOpacity: CAP_OPACITY_MIN }), 1)).toBe(CAP_OPACITY_MIN)
  })

  it('reads a stored blob with no capOpacity key as "follow the surface"', () => {
    // Unlike `cap`, the fresh default and the legacy reading agree here: a blob
    // written before this control existed WAS following the surface. So there is
    // one constant, not two, and a legacy blob restores the picture it was.
    expect(sanitizeDepthCue({ slab: true, cap: true }).capOpacity).toBeNull()
  })

  it('clamps a stored override into the range the slider offers', () => {
    // localStorage is user-writable and this number reaches the WebGL material.
    expect(sanitizeDepthCue({ capOpacity: 5 }).capOpacity).toBe(CAP_OPACITY_MAX)
    expect(sanitizeDepthCue({ capOpacity: -1 }).capOpacity).toBe(CAP_OPACITY_MIN)
  })

  it('reads anything that is not a usable number as "follow", not as a default number', () => {
    for (const raw of [Number.NaN, Number.POSITIVE_INFINITY, '0.5', true, {}, null]) {
      expect(sanitizeDepthCue({ capOpacity: raw }).capOpacity).toBeNull()
    }
  })

  it('passes a well-formed override through unchanged', () => {
    expect(sanitizeDepthCue(cue({ capOpacity: CAP_OPACITY_DEFAULT })).capOpacity)
      .toBe(CAP_OPACITY_DEFAULT)
  })

  it('starts the override somewhere visibly different from following a translucent surface', () => {
    // Turning the control on has to change the picture even for the user whose
    // surface is already translucent, or the chip looks broken in exactly the
    // case they try it.
    expect(CAP_OPACITY_DEFAULT).not.toBe(capOpacityFor(cue({ capOpacity: null }), 0.7))
    expect(CAP_OPACITY_DEFAULT).toBeGreaterThanOrEqual(CAP_OPACITY_MIN)
    expect(CAP_OPACITY_DEFAULT).toBeLessThanOrEqual(CAP_OPACITY_MAX)
  })
})
