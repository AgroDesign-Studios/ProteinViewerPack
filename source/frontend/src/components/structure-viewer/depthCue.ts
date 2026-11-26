/**
 * Depth cue (fog) + cross-section (slab) settings for the 3Dmol viewers.
 *
 * Both features exist in 3Dmol.js 2.5.4 and neither was wired up before: fog
 * via `enableFog`, near/far clipping via `setSlab`. What this module owns is
 * the arithmetic between the two controls the user sees and the model-space
 * numbers 3Dmol wants, plus the one measurement that makes the mapping
 * possible.
 *
 * Two facts about 3Dmol drive the whole design:
 *
 * 1. **Fog is scaled to the slab, not to the molecule.** `setSlabAndFog`
 *    computes `fog.near = camera.near + fogStart * (camera.far - camera.near)`,
 *    so how strong the fog looks depends entirely on how deep the slab is. And
 *    `zoomTo()` with no selection deliberately sets a very permissive slab
 *    (`+/- max(2 * maxD, 50)`), which is why the default fog 3Dmol already
 *    applies is nearly invisible on a protein: the molecule occupies about a
 *    quarter of the range the fade is spread over. Turning fog "on" therefore
 *    means tightening the slab as well — see `slabForDepthCue`.
 * 2. **Every `zoomTo` / `center` / `fitSlab` call overwrites the slab.** The
 *    settings here are not sticky inside 3Dmol, so callers must re-apply them
 *    after any camera call that re-frames the scene. `getView()` does not carry
 *    them either (it is 8 numbers: translation, zoom, quaternion), which is why
 *    `ViewerState` persists this object separately.
 *
 * The user-facing sizes are fractions of the molecule, not angstroms, so one
 * setting survives a structure switch and a round trip through localStorage.
 * The panel converts to angstroms for the readout using the measured span.
 */

/** Cross-section and depth-cue settings, as the toolbar holds them. */
/**
 * Preset fills offered for the cut face.
 *
 * The colours themselves live in the `--sv3d-cap-*` custom properties, the same
 * arrangement as the annotation inks (DESIGN.md §6.2.1): no hex literal sits in
 * a `.ts`/`.tsx` file, and every key here is ALSO a valid CSS colour keyword, so
 * an environment that resolves no custom properties (jsdom, or the frame before
 * the stylesheet applies) still draws the intended colour rather than a generic
 * fallback.
 */
export const CAP_COLOR_PRESETS = ['gray', 'steelblue', 'seagreen', 'firebrick', 'tan', 'white'] as const

export type CapColorPreset = (typeof CAP_COLOR_PRESETS)[number]

/** A preset, or the colour the user mixed (held in `DepthCue.capCustomColor`). */
export type CapColorChoice = CapColorPreset | 'custom'

/** The fill the cut face has always had; `--sv3d-cap-fill` is its CSS home. */
export const CAP_COLOR_DEFAULT: CapColorPreset = 'gray'

/**
 * The colour the picker starts on, and what a stored blob falls back to when it
 * carries something the grammar below rejects.
 *
 * The one hex literal in this file, and deliberately not a style: DESIGN.md §1.4
 * keeps colours out of `.ts` because they belong to the design system, whereas
 * this is the initial DATA value of an `<input type="color">`, whose HTML grammar
 * admits nothing but `#rrggbb` — not a keyword, not a token, not the empty
 * string. It is pinned equal to `--gray` (which `--sv3d-cap-fill` pulls from) by
 * `depthCue.test.ts`, so the picker cannot drift away from opening on the colour
 * the cut face already has.
 */
export const CAP_CUSTOM_COLOR_DEFAULT = '#c7cdd6'

/**
 * The cut face's own opacity range.
 *
 * The floor is 0.1 rather than 0: a cut face at zero is indistinguishable from
 * the hollow cut the `cap` chip already switches off, so the slider would have
 * a whole end that duplicates a control beside it — and a user who dragged
 * there would have no way to tell which of the two had taken the face away.
 */
export const CAP_OPACITY_MIN = 0.1
export const CAP_OPACITY_MAX = 1
export const CAP_OPACITY_STEP = 0.05

/**
 * Where the override starts when the user first turns it on.
 *
 * Deliberately NOT `SURFACE_TRANSLUCENT_OPACITY` (0.7). Turning the control on
 * has to be visibly different from leaving it off, and off over a translucent
 * surface already IS 0.7 — seeding there would make the chip look broken in
 * exactly the case a user with a translucent surface tries it.
 */
export const CAP_OPACITY_DEFAULT = 0.5

/** The `#rrggbb` grammar an `<input type="color">` both emits and accepts. */
const CUSTOM_CAP_COLOR = /^#[0-9a-f]{6}$/i

/** True for a colour the user mixed, as opposed to the name of a preset. */
export function isCustomCapColor(value: string): boolean {
  return CUSTOM_CAP_COLOR.test(value)
}

export function isCapColorPreset(value: unknown): value is CapColorPreset {
  return typeof value === 'string' && (CAP_COLOR_PRESETS as readonly string[]).includes(value)
}

export interface DepthCue {
  /** Fade distant geometry into the background colour. */
  fog: boolean
  /** 0 = no fade, 1 = fade starts at the very front of the slab. */
  fogStrength: number
  /** Clip to a slice instead of showing the whole depth of the molecule. */
  slab: boolean
  /**
   * Fill the cut face of the surface instead of leaving the shell open.
   *
   * Only means anything while `slab` is on and a surface is drawn: the cap is
   * geometry built at the near clipping plane (`sectionCap.ts`), and with no cut
   * there is nothing to fill.
   */
  cap: boolean
  /** How much of the molecule's depth is cut away from the front, 0..CUT_MAX. */
  cut: number
  /** How deep the visible slice is, as a fraction of the molecule's depth. */
  thickness: number
  /**
   * The projection: true orthographic, false perspective, or **null to follow
   * the electron density** — orthographic while a density map is on screen,
   * perspective otherwise (owner ruling 2026-10-03, PT-1299). Read it through
   * `orthoFor`, never directly.
   *
   * Why density decides: fitting a side chain to its cage is judged in an
   * orthographic view. In perspective the cage wall in front of
   * an atom is drawn displaced from the atom towards the edge of the view — by
   * 0.18–0.29 Å per Å of depth at the edges and corners of this 20° view
   * (measured on one crystal structure) — which is a difference a crystallographer
   * sees. Away from density, perspective stays: it is the depth cue a reader who
   * is not a crystallographer relies on.
   *
   * Same `null`-means-follow shape as `capOpacity`, and for the same reason:
   * "follow" is a STATE, so a localStorage blob and a stored view
   * store and restore it like any other value. Nothing has to replay "density
   * was switched on" as an event, which is what would have let a restore flip
   * the projection a user had set by hand.
   */
  ortho: boolean | null
  /**
   * Which fill the cut face is drawn in: a preset, or `'custom'` for the colour
   * in `capCustomColor`.
   *
   * Two fields rather than one string that is "either a preset name or a hex" so
   * that selecting a preset does not discard the colour the user mixed. Figure
   * work is the reason the picker exists at all, and holding a custom colour up
   * against a preset is exactly the gesture that would throw it away.
   */
  capColor: CapColorChoice
  /**
   * The colour the picker holds, always `#rrggbb`.
   *
   * Remembered whether or not it is the one being drawn, which is what makes the
   * comparison above non-destructive.
   */
  capCustomColor: string
  /**
   * How opaque the cut face is drawn, or **null to follow the surface**.
   *
   * `null` is not "no opinion" — it is the setting the cut face has always had:
   * `sectionCap` took the surface's own opacity so the two could not drift, on
   * the reasoning that a cap is part of the surface it is cut from. Keeping it
   * as a representable state is what makes an absent key in a stored blob
   * restore the picture that blob actually was, so unlike `cap` there is no
   * second legacy constant here — the fresh default and the legacy reading are
   * the same value.
   *
   * A number overrides that link. Figure work is why: a translucent shell with a
   * solid cut face, or the reverse, is a picture the linked version cannot make
   * at all, and neither is reachable by adjusting the surface instead — the
   * surface's own control is a two-state chip.
   */
  capOpacity: number | null
}

/**
 * The minimal 3Dmol GLViewer surface this module drives.
 *
 * Structural rather than `any` so the unit tests can pass a recording double,
 * and so a 3Dmol upgrade that renames one of these five methods fails at
 * `tsc` instead of at runtime inside a slider drag.
 */
export interface SlabCapableViewer {
  fitSlab(sel: Record<string, never>): unknown
  getSlab(): { near: number; far: number }
  setSlab(near: number, far: number): void
  enableFog(fog: boolean | { fogStart: number; fogEnd: number }): void
  setProjection(proj: 'orthographic' | 'perspective'): void
  render(): void
}

/**
 * 3Dmol's own resting fog, and the reason the "off" state is not "no fog".
 *
 * `GLViewer` initialises `fogStart = 0.4` / `fogEnd = 1.0` and leaves fog
 * ENABLED, so every view has always had a faint fade at the back —
 * faint only because `zoomTo()`'s permissive slab spreads the ramp over about
 * four times the molecule's depth. Switching the depth cue off therefore
 * restores these numbers rather than calling `enableFog(false)`: the control is
 * an emphasis, and a viewer at rest must look exactly as it did before this
 * feature existed.
 *
 * A genuinely fog-free picture is still reachable — turn the cue on and pull
 * the strength to 0, which collapses `fogStart` onto `fogEnd` and makes every
 * fragment shader skip the mix.
 */
export const FOG_DEFAULT_START = 0.4

/**
 * Cut is capped below 1 so the control can never produce an empty scene.
 * At cut = 1 the near plane sits at the back face of the molecule and only
 * whatever the thickness reaches beyond it would render — which is nothing.
 */
export const CUT_MAX = 0.9
/** Slider granularity, in fractions of the molecule's depth. */
export const CUT_STEP = 0.01
/** A slice thinner than this is a plane, not a section. */
export const THICKNESS_MIN = 0.02
export const THICKNESS_MAX = 1
export const THICKNESS_STEP = 0.01
export const FOG_STRENGTH_STEP = 0.05

/**
 * Smallest span `measureSpan` will report, matching 3Dmol's own floor: its
 * `fitSlab` clamps `maxD` to 5 before halving it, so a single-atom model still
 * gets a usable depth window rather than a zero-thickness one.
 */
export const MIN_SPAN_A = 5

/** Options for `applyDepthCue`. */
export interface ApplyDepthCueOptions {
  /**
   * This call follows a CAMERA move (`zoomTo` / `center` / `fitSlab`) rather
   * than a change to the settings themselves. With neither fog nor the
   * cross-section on that makes the call a genuine no-op — see `applyDepthCue`.
   */
  afterCameraMove?: boolean
  /**
   * A density map is on screen, which is what `ortho: null` follows
   * (`orthoFor`). Absent means none.
   */
  densityShown?: boolean
}

/**
 * Defaults are chosen so that turning a feature on is immediately visible but
 * never destructive:
 *
 * - `fogStrength` 0.6 maps to `fogStart` 0.4, which IS 3Dmol's own default —
 *   the difference is that it now applies over a slab tightened to the
 *   molecule, where it can actually be seen.
 * - `thickness` 0.6 trims the back of the molecule rather than the front, so
 *   the first click on the cross-section chip demonstrates the effect without
 *   hiding the face the user is looking at. `cut` then walks the slice
 *   backwards from there.
 * - `cap` is ON, by owner ruling 2026-08-27: a cut that shows a filled face is
 *   the one people mean by "cross-section". Note this is the FRESH-viewer
 *   default only — a stored value with no `cap` key restores UNCAPPED, for the
 *   reason `sanitizeDepthCue` gives.
 * - `ortho` is null: the projection follows the density (owner ruling
 *   2026-10-03), so a viewer with no map on screen still opens in 3Dmol's own
 *   perspective and looks exactly as it did before this setting existed.
 */
// Frozen: this object is handed straight to `useState` as the initial value AND
// returned by `sanitizeDepthCue` as its fallback, so a single stray mutation
// anywhere would redefine "default" for every viewer in the session and for the
// Reset button. Freezing makes that a throw in strict mode rather than a state
// nobody can trace back here.
export const DEPTH_CUE_DEFAULT: DepthCue = Object.freeze({
  fog: false,
  fogStrength: 0.6,
  slab: false,
  cut: 0,
  thickness: 0.6,
  ortho: null,
  cap: true,
  capColor: CAP_COLOR_DEFAULT,
  capCustomColor: CAP_CUSTOM_COLOR_DEFAULT,
  capOpacity: null,
})

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, value))
}

/**
 * Whether these settings draw orthographically, with density on screen or not.
 *
 * The one place `ortho: null` is resolved. Everything that asks "which
 * projection?" — the camera, the cut face's near floor, the chip's pressed
 * state — goes through here, so the follow rule cannot be implemented twice and
 * disagree.
 */
export function orthoFor(cue: DepthCue, densityShown: boolean): boolean {
  return cue.ortho ?? densityShown
}

/**
 * The `ortho` value a click on the projection chip commits.
 *
 * The click flips what is on screen. When the flipped value is the one the
 * density would pick anyway, the override is DROPPED (null) rather than
 * recorded: a user who switches the chip on and back off is where they started,
 * following the density again — not holding a "perspective" that would silently
 * refuse to switch the next time a map is shown. A click that disagrees with the
 * density is kept as an override, so a projection chosen by hand outlives
 * density being switched on or off.
 */
export function orthoAfterToggle(cue: DepthCue, densityShown: boolean): boolean | null {
  const next = !orthoFor(cue, densityShown)
  return next === densityShown ? null : next
}

/**
 * True when these settings put a slab of their own on the camera.
 *
 * Only fog and the cross-section do. The projection does not touch the slab,
 * and it survives every camera call — `zoomTo` / `center` / `fitSlab` rewrite
 * the clipping planes but never `camera.ortho` — so a camera move needs nothing
 * re-asserted unless one of these two is on.
 */
export function assertsSlab(cue: DepthCue): boolean {
  return cue.fog || cue.slab
}

/**
 * True when nothing is set — i.e. the viewer looks exactly as it would at the
 * defaults, with the density as it is now.
 *
 * `densityShown` matters only to the projection: an override that agrees with
 * what the density would pick anyway is invisible, and offering Reset for it
 * would be a control that appears to do nothing. Defaults to false for a
 * viewer that never shows density.
 */
export function isDepthCueDefault(cue: DepthCue, densityShown = false): boolean {
  // Only the switches decide this. A slider left at a non-default position
  // while its feature is off changes nothing on screen, for the same reason.
  return !assertsSlab(cue) && orthoFor(cue, densityShown) === densityShown
}

/**
 * The depth window 3Dmol's own `fitSlab({})` would set: the bounding-box
 * diagonal, split the way 3Dmol splits it. Slightly more is kept in front of
 * the rotation centre than behind it, which is 3Dmol's convention (`-maxD/1.9`
 * against `+maxD/2`) and is preserved here so a tightened slab frames the
 * molecule the same way the library does.
 */
function tightSlab(span: number): { near: number; far: number } {
  return { near: -span / 1.9, far: span / 2 }
}

/**
 * The depth of that window, in angstroms — what one unit of `cut` or
 * `thickness` is a fraction OF.
 *
 * Not the same as the span: the window is `span/2 + span/1.9`, about 1.026x the
 * bounding-box diagonal. The readouts beside the sliders must use this, or a
 * "25.0 Å" caption describes a plane 2.6% away from where the near plane
 * actually sits — a number shown to someone measuring a pocket.
 */
export function depthWindowA(span: number): number {
  const safeSpan = Number.isFinite(span) && span > 0 ? span : MIN_SPAN_A
  const tight = tightSlab(safeSpan)
  return tight.far - tight.near
}

/**
 * Model-space near/far clipping planes for these settings.
 *
 * Three regimes, and the middle one is the reason this is not simply
 * "apply the sliders":
 *
 * - cross-section on: a slice of `thickness`, its front face `cut` deep into
 *   the molecule.
 * - cross-section off but fog on: the tight window, because fog is measured
 *   against the slab and a permissive slab makes it invisible (see the module
 *   docstring).
 * - both off: exactly what `zoomTo()` with no selection would leave behind, so
 *   turning everything off restores the untouched view rather than an
 *   approximation of it.
 */
export function slabForDepthCue(cue: DepthCue, span: number): { near: number; far: number } {
  const safeSpan = Number.isFinite(span) && span > 0 ? span : MIN_SPAN_A
  if (!cue.slab) {
    if (cue.fog) return tightSlab(safeSpan)
    // 3Dmol's `zoomTo({})` branch, reproduced rather than approximated.
    return { near: Math.min(-safeSpan * 2, -50), far: Math.max(safeSpan * 2, 50) }
  }
  const tight = tightSlab(safeSpan)
  const depth = tight.far - tight.near
  const near = tight.near + clamp(cue.cut, 0, CUT_MAX) * depth
  const far = near + clamp(cue.thickness, THICKNESS_MIN, THICKNESS_MAX) * depth
  return { near, far }
}

/**
 * Fog fractions for these settings.
 *
 * `fogEnd` stays at 1.0 (the back of the slab) and only the start moves, so
 * the slider reads as "how early the fade begins". Strength 0 collapses start
 * onto end, which is how 3Dmol's shaders spell "no fog": they guard the mix
 * with `if (fogNear != fogFar)`.
 *
 * ⚠️ "every fragment shader" is what this said, and it is not true. Nine of the
 * ten fog-aware shaders in the 2.5.4 bundle carry the guard; `instanced.frag`
 * (bundle :34870) does not — it runs `smoothstep(fogNear, fogFar, depth)`
 * unconditionally, and GLSL leaves `smoothstep(e, e, x)` undefined.
 *
 * That exception is not reachable here, but NOT because of anything AgDB
 * configures — `sphereGeometry.instanced` is not an app-visible knob. 3Dmol
 * sets it itself (:18015), inside the `else if (options.supportsAIA)` (:18012)
 * that follows `if (options.supportsImposters)` (:18002); and
 * `supportsImposters` is `EXT_frag_depth || !isWebGL1()` (:29050), so a WebGL2
 * context never reaches the instanced branch at all.
 *
 * And in any case, unconditionally: the surface and its cut face are drawn with
 * `lambertdouble`, which DOES guard. That last clause is what the conclusion
 * rests on; the reachability argument is a second line of defence. Line numbers
 * are for the 2.5.4 bundle — grep the quoted expressions, not the numbers.
 *
 * With the cue off this returns 3Dmol's resting numbers, not "off"; see
 * `FOG_DEFAULT_START`.
 */
export function fogForDepthCue(cue: DepthCue): { fogStart: number; fogEnd: number } {
  if (!cue.fog) return { fogStart: FOG_DEFAULT_START, fogEnd: 1 }
  return { fogStart: 1 - clamp(cue.fogStrength, 0, 1), fogEnd: 1 }
}

/**
 * Measure the molecule's depth, in angstroms, by asking 3Dmol.
 *
 * `maxD` — the bounding-box diagonal every slab default is derived from — is
 * private to GLViewer, but `fitSlab({})` writes `maxD / 2` into `slabFar`,
 * so one call and one read recovers it without reaching into internals.
 *
 * The diagonal, not the z-extent, is the right measure here for the same
 * reason 3Dmol uses it: the molecule rotates, so the depth actually facing the
 * camera changes, and a per-axis measurement would make the sliders mean
 * something different at every orientation.
 *
 * This CLOBBERS the slab, which is why callers apply their own immediately
 * afterwards — `applyDepthCue` does exactly that.
 *
 * Returns **null** when the molecule cannot be measured, rather than the floor.
 * The difference is that a caller can tell "5 A molecule" from "ask again
 * later": an empty or half-built model throws inside `getExtent`, and a caller
 * that cached the floor for it would keep describing a full-size protein as
 * 5 A for the life of the viewer, with the readouts and every slider silently
 * wrong. The floor still exists — `slabForDepthCue` and `depthWindowA` apply it
 * — so a null costs a correct-but-conservative frame, not a broken one.
 */
export function measureSpan(viewer: SlabCapableViewer): number | null {
  try {
    viewer.fitSlab({})
    const slab = viewer.getSlab()
    const span = slab.far * 2
    // `>=`, not `>`: 3Dmol's `fitSlab` clamps `maxD` to 5 before halving it, so
    // a molecule at or below that floor measures as EXACTLY `MIN_SPAN_A`. That
    // is a real answer — "smaller than 3Dmol resolves" — and rejecting it was a
    // bug with two costs: the angstrom captions read "-" for the life of the
    // viewer, and, because nothing was cached, the O(atoms) `fitSlab` walk
    // re-ran on every pointer move of a drag. Only a non-finite or impossible
    // result now means "ask again".
    return Number.isFinite(span) && span >= MIN_SPAN_A ? span : null
  } catch {
    return null
  }
}

/**
 * Push these settings into a live viewer and repaint.
 *
 * Ordering note: the slab goes first because both of the calls after it read
 * it — `enableFog` stores fractions that `setSlabAndFog` resolves against the
 * camera planes, and `setProjection` recomputes those planes on the spot.
 * `enableFog({...})` does not repaint on its own, hence the trailing `render()`.
 *
 * Applying this at the default settings is a deliberate no-op rather than a
 * skipped branch: every value it writes is the one 3Dmol already holds, so
 * there is one code path instead of two and no state where the toolbar and the
 * canvas can disagree. `afterCameraMove` is the one exception — see below.
 */
export function applyDepthCue(
  viewer: SlabCapableViewer,
  cue: DepthCue,
  span: number,
  opts: ApplyDepthCueOptions = {},
): void {
  // Nothing of ours to assert, and the camera call already set the slab it
  // wants. Writing the resting window here would REPLACE that choice rather
  // than restore it: `zoomTo(sel)` with a NON-empty selection leaves 3Dmol's
  // TIGHT slab, and only `zoomTo({})` leaves the permissive one the resting
  // branch reproduces (`GLViewer.zoomTo`, the `Object.keys(sel).length === 0`
  // test). Without this a ligand focus would render background the previous
  // build clipped away, and lose the fade with it — for a user who never
  // touched these controls.
  //
  // It cannot be unconditional: the settings path relies on the resting write
  // to UNDO a slice when the user switches the cross-section back off.
  //
  // The projection does not count (`assertsSlab`). It used to — this read
  // `isDepthCueDefault` — so with orthographic on, every ligand focus had its
  // tight slab replaced by the resting one, although the projection itself had
  // survived the camera call untouched and needed nothing written.
  if (opts.afterCameraMove && !assertsSlab(cue)) return
  const { near, far } = slabForDepthCue(cue, span)
  viewer.setSlab(near, far)
  viewer.enableFog(fogForDepthCue(cue))
  viewer.setProjection(projectionName(orthoFor(cue, opts.densityShown ?? false)))
  viewer.render()
}

/** 3Dmol's name for a projection — the one mapping both writers above and below share. */
function projectionName(ortho: boolean): 'orthographic' | 'perspective' {
  return ortho ? 'orthographic' : 'perspective'
}

/**
 * Switch only the projection, and repaint.
 *
 * For a change that moved nothing else — the projection chip, or a density map
 * appearing or going away. Going through `applyDepthCue` instead would also
 * rewrite the slab, and at rest that means replacing a ligand focus's tight
 * slab with the resting one: the same widening the `afterCameraMove` guard
 * exists to prevent, reached from the settings side.
 */
export function applyProjection(
  viewer: Pick<SlabCapableViewer, 'setProjection' | 'render'>,
  ortho: boolean,
): void {
  viewer.setProjection(projectionName(ortho))
  viewer.render()
}

/**
 * Validate a `DepthCue` that came off a localStorage blob.
 *
 * The blob is user-writable, and every field here reaches WebGL: a NaN
 * thickness makes `camera.far` NaN and the canvas goes blank with nothing on
 * screen to explain it. Unknown shapes fall back to the default rather than
 * being partially trusted.
 */
export function sanitizeDepthCue(raw: unknown): DepthCue {
  if (raw === null || typeof raw !== 'object') return DEPTH_CUE_DEFAULT
  const r = raw as Partial<Record<keyof DepthCue, unknown>>
  const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback)
  const num = (v: unknown, min: number, max: number, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? clamp(v, min, max) : fallback
  const choice = (v: unknown): CapColorChoice =>
    v === 'custom' || isCapColorPreset(v) ? v : DEPTH_CUE_DEFAULT.capColor
  return {
    fog: bool(r.fog, DEPTH_CUE_DEFAULT.fog),
    fogStrength: num(r.fogStrength, 0, 1, DEPTH_CUE_DEFAULT.fogStrength),
    slab: bool(r.slab, DEPTH_CUE_DEFAULT.slab),
    cut: num(r.cut, 0, CUT_MAX, DEPTH_CUE_DEFAULT.cut),
    thickness: num(r.thickness, THICKNESS_MIN, THICKNESS_MAX, DEPTH_CUE_DEFAULT.thickness),
    // A stored boolean is kept as an OVERRIDE, including the `false` every blob
    // written before 2026-10-03 carries: those views were drawn in perspective
    // whatever the density, and reading `false` as "follow" would draw one
    // orthographically whenever a map is on screen — a projection it never had.
    // Same two-readings rule as `cap` below. Anything else (null, or a value a
    // hand edit mangled) follows the density, which is the fresh default.
    ortho: typeof r.ortho === 'boolean' ? r.ortho : null,
    // NOT `DEPTH_CUE_DEFAULT.cap`. An absent key means the value was stored
    // before caps existed, and everything stored then was drawn UNCAPPED: the
    // a localStorage blob and a stored view both come through here, and
    // restoring a stored view with a filled cut face it never had would show a
    // picture it never was. Same two-defaults rule
    // as `SURFACE_TYPE_DEFAULT` vs `SURFACE_TYPE_LEGACY` (DESIGN.md §6.2.6).
    cap: bool(r.cap, false),
    // Unlike `cap` there is no second default here. An absent key means the blob
    // predates the picker, and everything stored then was drawn in the default
    // grey — which is what `DEPTH_CUE_DEFAULT` restores, so "what was it drawn as
    // when it was saved" and "what do we start from" are the same answer.
    capColor: choice(r.capColor),
    // Lower-cased to match what the control itself stores. `<input type="color">`
    // normalises its value, so an upper-case blob would leave the DOM value and
    // the React prop permanently unequal and React would reassign `node.value`
    // on every render — including every render driven by an `input` while the
    // dialog is open.
    capCustomColor:
      typeof r.capCustomColor === 'string' && isCustomCapColor(r.capCustomColor)
        ? r.capCustomColor.toLowerCase()
        : DEPTH_CUE_DEFAULT.capCustomColor,
    // Anything that is not a usable number reads as "follow the surface", which
    // is both the default and the honest reading of a blob written before this
    // control existed — see the field's own docstring. `num()` cannot be reused:
    // its fallback is a number, and null is the value that has to survive.
    capOpacity:
      typeof r.capOpacity === 'number' && Number.isFinite(r.capOpacity)
        ? clamp(r.capOpacity, CAP_OPACITY_MIN, CAP_OPACITY_MAX)
        : null,
  }
}

/**
 * The settings a stored view restores.
 *
 * `sanitizeDepthCue`, except for a state with no `depthCue` at all. Such a state
 * was stored before #1623 (2026-08-25), when these viewers had no depth cue and
 * always drew in perspective; the defaults would read its absent projection as
 * "follow the density", so restoring it while a map is shown would draw it
 * orthographically — a picture it never was. `ortho: false` is that old
 * reading, kept as an override the way a stored `false` is. Every state stored
 * since carries a `depthCue` with a boolean `ortho`, so nothing newer reaches
 * this branch.
 *
 * Only the key being ABSENT counts. A `depthCue` that is present but not an
 * object was mangled, not old, and gets the fresh defaults like any other
 * unreadable value.
 */
export function depthCueFromViewState(viewState: { depthCue?: unknown }): DepthCue {
  if (viewState.depthCue === undefined) return { ...DEPTH_CUE_DEFAULT, ortho: false }
  return sanitizeDepthCue(viewState.depthCue)
}

/**
 * The fill `sectionCap` should draw for these settings.
 *
 * Returns the CHOICE rather than a colour: a custom value is already a literal,
 * while a preset resolves against CSS at paint time, and resolving it needs the
 * viewer's own element — which only `sectionCap.ts` holds.
 */
export function capFillFor(cue: DepthCue): string {
  return cue.capColor === 'custom' ? cue.capCustomColor : cue.capColor
}

/**
 * The opacity `sectionCap` should draw the cut face at.
 *
 * `surfaceOpacity` is passed in rather than derived from a `surfaceOpaque`
 * boolean here, because the number is the surface's, and this module knows
 * nothing about how the surface is drawn — resolving it would mean importing
 * `sceneStyles`, whose own dependency chain reaches the network modules through
 * `surfaceFailure`. That is a chain the callers already carry and this leaf
 * deliberately does not (the same boundary `surfaceType.ts` records).
 */
export function capOpacityFor(cue: DepthCue, surfaceOpacity: number): number {
  return cue.capOpacity ?? surfaceOpacity
}

/** Percentage of a slider track left of the thumb, for the `--fill` gradient. */
export function sliderFill(value: number, min: number, max: number): number {
  if (!(max > min)) return 0
  return clamp(((value - min) / (max - min)) * 100, 0, 100)
}
