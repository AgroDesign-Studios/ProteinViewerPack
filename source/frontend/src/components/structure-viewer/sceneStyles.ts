/**
 * The base 3D scene every AgDB structure viewer paints, in one place.
 *
 * Every viewer draws the same picture from the same six switches. None of them
 * may import another (`vibe-coding-best-practices.md`
 * §15.2), so the shared body belongs in a leaf that imports neither: this file
 * imports no page, no component, and no colour policy. The caller resolves its
 * own colour option (`viewerColorScheme.getColorOption`) and hands it in.
 *
 * What is deliberately NOT here: anything only one caller has. Such extra
 * styling stays with its caller and is applied AFTER this function, because
 * step 1 below is an unscoped `setStyle` that wipes every model in the scene:
 * anything applied before it vanishes on the next restyle.
 */

import { applySurface, type SurfaceHandle } from './surfaceController'
import { resolveSurfaceType, type SurfaceTypeKey } from './surfaceType'

/**
 * Re-exported from `surfaceController.ts`, where every handle is now born and
 * every mesh dropped — its docstring there carries the identity contract (a
 * fresh object per completed build, because 3Dmol recycles the NUMBERS).
 * Consumers keep this module as their one import site.
 */
export type { SurfaceHandle } from './surfaceController'

/**
 * Wrap a surface-handle consumer so it only publishes while the generation it
 * captured still stands.
 *
 * Lives here, beside `SurfaceHandle`, because it defends exactly the contract
 * that docstring describes: a handle is an ID, and 3Dmol re-issues IDs. Any
 * caller that lets something ELSE mutate the surface set has to be able to say "the build I
 * issued no longer owns the id it was given", and a completion callback is the
 * only place that can be decided.
 *
 * The capture happens HERE, when the wrapper is built, which is the caller's
 * issue moment. `applySceneStyles` publishes AT MOST twice per request — `null`
 * when the old mesh is dropped, then the handle when the new one finishes.
 * Neither happens under `skipSurface`, only the first when the surface is off,
 * and neither when `surfaceController` serves the request by restyling or
 * reusing the mesh it already holds; see `onSurface`'s own doc on
 * `ApplyOptions`. A request that lands while a build is running is QUEUED in
 * the controller, so both of its publishes can arrive after later issues —
 * which is exactly the overtaking this generation comparison absorbs.
 *
 * Takes the ref OBJECT, not its value: the guard has to read the generation as
 * it is at COMPLETION time, and compare it with the one captured at issue time.
 */
export function issuedWhile(
  generation: { readonly current: number },
  publish: (surface: SurfaceHandle | null) => void,
): (surface: SurfaceHandle | null) => void {
  const issuedAt = generation.current
  return surface => {
    if (generation.current !== issuedAt) return
    publish(surface)
  }
}

/** 3Dmol publishes no types; its viewer is `any` by the documented exception
 *  in `vibe-coding-best-practices.md` §6.4 (3D viewer callbacks). */
type Viewer = any

/**
 * Opacity of a surface that is NOT opaque.
 *
 * 0.7 rather than a lower value because the surface is the subject at that
 * point, not a veil: below about this the pocket mouth stops reading as a
 * surface at all.
 */
export const SURFACE_TRANSLUCENT_OPACITY = 0.7

/**
 * Residue names drawn as water: by the Water switch here, and left out of the
 * symmetry-mate copies (`useSymmetryMates`). One list, so the two cannot
 * disagree about what water is (PT-1070 item 18).
 */
export const WATER_RESNAMES = ['HOH', 'WAT', 'DOD'] as const

/** The representations the Style row offers. `surface` is a legacy alias that
 *  paints a cartoon — the surface itself is the `showSurface` switch. */
export type ViewStyle = 'cartoon' | 'stick' | 'ballstick' | 'line' | 'trace' | 'cross' | 'surface'

/**
 * The keys the Style row offers, in the order it renders them — and, because
 * `proteinStyleForSet` folds in this order, the order that decides which of two
 * representations wins when they collide. See that function for the one pair
 * that actually can.
 *
 * `surface` is deliberately absent: it is a legacy alias for `cartoon` and has
 * never had a control of its own. `sanitizeViewStyles` folds it away so that
 * every member of a live selection has a checkbox — a selected value with no
 * control is a state the user can see the effect of and not the cause.
 */
export const VIEW_STYLE_KEYS = ['cartoon', 'stick', 'ballstick', 'line', 'trace', 'cross'] as const

/** What a viewer opens with, and what an unreadable stored value falls back to. */
export const VIEW_STYLES_DEFAULT: readonly ViewStyle[] = Object.freeze(['cartoon' as ViewStyle])

export function isViewStyle(value: unknown): value is ViewStyle {
  return (
    value === 'surface' ||
    (typeof value === 'string' && (VIEW_STYLE_KEYS as readonly string[]).includes(value))
  )
}

/**
 * Read boundary for the Style selection, from either untrusted source — the
 * localStorage blob and a stored view.
 *
 * Accepts the ARRAY the multi-select writes and the bare STRING that every blob
 * written before it carries; a single style is exactly a one-element selection,
 * so there is no second legacy default to keep here (contrast `cap` and
 * `surfaceType`, where the old and new defaults genuinely differ).
 *
 * The result is deduplicated and ordered by `VIEW_STYLE_KEYS`, so the merge
 * below cannot depend on the order the user happened to tick the boxes in — two
 * blobs describing the same picture must not draw differently.
 *
 * An EMPTY array is a legitimate result and is passed through, not replaced by
 * the fallback: with no representation ticked the protein is not drawn, which is
 * a state the checkboxes can reach and must therefore be able to restore. Only a
 * value that is not a usable selection at all — a number, a null, an array of
 * nothing recognisable — falls back.
 */
export function sanitizeViewStyles(raw: unknown, fallback: readonly ViewStyle[]): ViewStyle[] {
  const candidates: unknown[] = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : []
  if (!Array.isArray(raw) && candidates.length === 0) return [...fallback]
  const seen = new Set<ViewStyle>()
  for (const candidate of candidates) {
    if (!isViewStyle(candidate)) continue
    // The legacy alias collapses into the representation it has always painted,
    // so `['surface', 'cartoon']` is one cartoon rather than a duplicate.
    seen.add(foldAlias(candidate))
  }
  // An array that contained ONLY unusable entries is not an empty selection — it
  // is an unreadable one, and the empty-selection carve-out above must not
  // launder it into "draw no protein".
  if (candidates.length > 0 && seen.size === 0) return [...fallback]
  return VIEW_STYLE_KEYS.filter(key => seen.has(key))
}

/** The legacy alias resolved to the representation it has always painted. */
function foldAlias(style: ViewStyle): ViewStyle {
  return style === 'surface' ? 'cartoon' : style
}

/**
 * Tick or untick one checkbox, keeping the canonical order.
 *
 * Folds the legacy alias on BOTH the incoming list and the key, so all three
 * functions that have to agree with the `ViewStyle` union treat it identically.
 * Without the fold the filter below would simply DROP a `'surface'` — the same
 * silent "draws nothing" `proteinStyleForSet` guards against — and ticking or
 * unticking it would be a no-op. No shipped control offers the alias, so this is
 * latent today; the signature accepts it, which is what makes it worth closing.
 */
export function toggleViewStyle(styles: readonly ViewStyle[], key: ViewStyle): ViewStyle[] {
  const next = new Set<ViewStyle>(Array.from(styles, foldAlias))
  const target = foldAlias(key)
  if (next.has(target)) next.delete(target)
  else next.add(target)
  return VIEW_STYLE_KEYS.filter(k => next.has(k))
}

/**
 * True when two selections describe the same picture.
 *
 * An index compare is sufficient because every producer here — `VIEW_STYLES_DEFAULT`,
 * `sanitizeViewStyles`, `toggleViewStyle` — emits `VIEW_STYLE_KEYS` order.
 *
 * Exists because the selection became an ARRAY. React bails out of a re-render
 * on `Object.is`, which the old single string satisfied and a fresh array never
 * can, so a restore that changes nothing would otherwise re-run the whole
 * restyle — `removeAllSurfaces()` plus an MS rebuild, and a cut face that
 * visibly disappears and comes back. Callers that assert a whole selection from
 * outside (a stored view's restore, a localStorage blob) use this to keep the
 * previous reference when the value is unchanged.
 */
export function sameViewStyles(a: readonly ViewStyle[], b: readonly ViewStyle[]): boolean {
  return a.length === b.length && a.every((style, i) => style === b[i])
}

/**
 * A colouring painted under the main one.
 *
 * An atom whose score property is missing keeps its own colour under a
 * `colorfunc`, which reads as a confident low score rather than as "not
 * computed". Painting a flat base first and the ramp over `rampSelection` only
 * makes an unscored residue look unscored.
 */
export interface SceneBaseLayer {
  /** Flat colour for everything the ramp does not reach. */
  color: string
  /** Where the main colour option is re-applied, or null to leave the base bare. */
  rampSelection: Record<string, unknown> | null
}

export interface SceneSettings {
  /**
   * Every representation to draw, merged into one 3Dmol style object.
   *
   * A LIST rather than one choice because the Style row is checkboxes: comparing
   * a ribbon against the sticks it traces is the ordinary gesture, and a
   * single-value control makes it a flicker between two pictures instead of one
   * picture. Empty means "draw no protein", which is reachable and legitimate —
   * see `proteinStyleForSet`.
   */
  viewStyles: readonly ViewStyle[]
  /** Already-resolved 3Dmol colour option — `{ color }` or `{ colorscheme }` or
   *  a `colorfunc`. This module never decides a colour. */
  colorOption: Record<string, unknown>
  base?: SceneBaseLayer | null
  showProtein: boolean
  showLigands: boolean
  showWater: boolean
  showSurface: boolean
  /**
   * Paint the surface fully opaque.
   *
   * The caller resolves this, because "is there something inside the surface
   * that must stay visible?" is a question only the caller can answer — a
   * focused ligand, for one.
   */
  surfaceOpaque: boolean
  /**
   * WHICH surface — van der Waals, molecular, solvent-accessible, or 3Dmol's
   * "SES". A KEY, not the enum number: this module resolves it against the live
   * 3Dmol enum, so the MS-vs-SES trap stays in one place (`surfaceType.ts`) and
   * a test can assert the exact number that reached `addSurface`.
   *
   * The caller decides, because not every viewer offers the user a control
   * for it.
   */
  surfaceType: SurfaceTypeKey
}

export interface ApplyOptions {
  /**
   * Do not touch the surface at all — neither draw it nor remove it.
   *
   * Generating a VDW mesh over a whole protein is the expensive part of a
   * restyle, and nothing that merely changes a selection can alter its
   * geometry. `surfaceController` would now reach the same conclusion on its
   * own (an identical request is a no-op there), so this is no longer the only
   * thing standing between a residue click and a rebuild — but it stays,
   * because it states at the CALL SITE that this call cannot mean a surface
   * change. A caller that relied on the controller instead would silently start
   * rebuilding the moment it began passing a different `surfaceType`.
   */
  skipSurface?: boolean
  /**
   * Told which surface now exists, so a caller can attach to its mesh.
   *
   * Called with null the moment the old surfaces are dropped, and again with a
   * fresh `SurfaceHandle` once a mesh has finished building — never in between,
   * because the mesh a caller wants to read does not exist until the workers
   * resolve. The handle is a new object every time, deliberately; see its own
   * docstring for why a bare id cannot be compared.
   *
   * Both publishes come from `surfaceController`, the only place that knows
   * whether a request drops the mesh, rebuilds it, or is served by restyling
   * the one already on screen. A restyle or reuse publishes NOTHING: the mesh
   * a handle points at is unchanged, so the handle a consumer holds stays
   * valid — silence here means "nothing you attached to has moved".
   *
   * Not called at all under `skipSurface`, which leaves the existing mesh — and
   * therefore anything attached to it — in place.
   */
  onSurface?: (surface: SurfaceHandle | null) => void
  /**
   * Restrict the base scene to ONE model — the receptor — so every other model
   * in the viewer keeps whatever style its owner painted.
   *
   * Steps 1-4 are unscoped by default: the opening clear blanks EVERY model in
   * the scene and the ligand step paints EVERY HETATM green. That is correct
   * for a viewer that holds one structure, and it is why this docstring's
   * header says a caller's own additions must be re-applied after every
   * restyle. A viewer that holds many models beside the receptor would re-apply
   * each of their styles per restyle and rebuild each geometry per frame on a
   * drag. Scoping the four style steps to the receptor removes the whole class:
   * a receptor restyle then touches no other model's atom, so nothing has to be
   * re-applied.
   *
   * A 3Dmol model handle (what `addModel` returned) or a model id — anything
   * `AtomSelectionSpec.model` accepts. The surface (step 5) is deliberately NOT
   * scoped: its selector is what `surfaceController` compares requests by, and
   * `{hetflag: false}` already excludes every HETATM atom.
   */
  model?: unknown
  /**
   * Restrict the SURFACE (step 5) to one model, by its numeric id.
   *
   * Separate from `model` because the surface has a constraint the style steps
   * do not: `surfaceController` reuses a mesh only when the new selector
   * compares equal to the old one, and it compares primitives only — a model
   * HANDLE in the selector would make every restyle a rebuild. The id is what
   * keeps the comparison possible.
   *
   * Needed once a second PROTEIN model shares the scene: symmetry
   * mates are ATOM records, so `{hetflag: false}` alone would wrap one
   * surface around the reference and every copy of it.
   */
  surfaceModel?: number
}

/**
 * The 3Dmol style object for one representation.
 *
 * Exported for its own test: the six branches are the part that silently
 * degrades (a missed spread leaves the representation uncoloured), and proving
 * them through a rendered component costs a fake viewer per case.
 */
export function proteinStyleFor(
  viewStyle: ViewStyle,
  colorOption: Record<string, unknown>,
): Record<string, Record<string, unknown>> {
  switch (viewStyle) {
    case 'stick':
      return { stick: { ...colorOption } }
    case 'ballstick':
      return { sphere: { scale: 0.3, ...colorOption }, stick: { ...colorOption } }
    case 'line':
      return { line: { ...colorOption } }
    case 'trace':
      // `style: 'trace'` is the ONLY key 3Dmol's cartoon renderer dispatches on
      // for a Cα trace (glcartoon.ts `cartoon.style === "trace"`). It used to be
      // `tube: true`, which is not a CartoonStyleSpec key at all — 3Dmol copies
      // an unknown key onto the atom unvalidated and without a warning, so Trace
      // drew the default rectangle cartoon, pixel-identical to Ribbon, from the
      // initial commit until 2026-09-03. The exact spelling IS the feature: the
      // real plural `tubes: true` is a different picture (helices as cylinders).
      return { cartoon: { ...colorOption, style: 'trace' } }
    case 'cross':
      return { cross: { ...colorOption, linewidth: 2 } }
    case 'cartoon':
    case 'surface':
    default:
      return { cartoon: { ...colorOption } }
  }
}

/**
 * The 3Dmol style object for a SET of representations, drawn at once.
 *
 * 3Dmol takes one style object per selection and each of its keys — `cartoon`,
 * `stick`, `sphere`, `line`, `cross` — is a slot that holds one spec. So drawing
 * several representations together is a MERGE of the single-style objects, not a
 * sequence of `addStyle` calls: a second `setStyle` would replace the first, and
 * `addStyle` on the same selection re-enters the same slots anyway.
 *
 * Folded in `VIEW_STYLE_KEYS` order, so the result depends on WHICH boxes are
 * ticked and never on the order they were ticked in.
 *
 * ⚠️ ONE PAIR ACTUALLY COLLIDES, and the library is why: `cartoon` and `trace`
 * are both cartoons — trace is `{ cartoon: { style: 'trace' } }` — so they
 * compete for the single `cartoon` slot and 3Dmol cannot draw both. Ticking both
 * draws the TRACE, because `trace` comes later in the order above. That is a real
 * limitation of the representation, not of this merge: there is no 3Dmol call
 * that puts a ribbon and a trace on the same atoms. (Until 2026-09-03 this
 * collision was invisible, because the trace key was misspelt and both ticks
 * drew the same ribbon — see `proteinStyleFor`.) `stick` and `ballstick` also
 * share the `stick` slot, but their specs are identical, so the overwrite is
 * invisible and ball-and-stick keeps its spheres.
 *
 * An empty set returns `{}` — the style object that draws nothing, which is
 * exactly what an unticked Style row should produce.
 */
export function proteinStyleForSet(
  viewStyles: readonly ViewStyle[],
  colorOption: Record<string, unknown>,
): Record<string, Record<string, unknown>> {
  // The legacy alias is folded here as well as in `sanitizeViewStyles`, so that
  // a caller holding an unsanitised list draws a cartoon rather than NOTHING —
  // the failure of the alternative is silent, which is the worst kind here.
  const wanted = new Set<ViewStyle>(Array.from(viewStyles, foldAlias))
  const merged: Record<string, Record<string, unknown>> = {}
  for (const key of VIEW_STYLE_KEYS) {
    if (!wanted.has(key)) continue
    Object.assign(merged, proteinStyleFor(key, colorOption))
  }
  return merged
}

/**
 * The two keys through which a 3Dmol colour scheme beats a flat `color`.
 *
 * Set to undefined EXPLICITLY, never omitted. Both consumers spread this into a
 * spec that 3Dmol MERGES into whatever the base painted — `GLModel.setStyle`
 * with `add=true` is an `Object.assign` per slot — and `getColorFromStyle`
 * reads `color` first, then lets a `colorscheme` or a `colorfunc` override it.
 * An ABSENT key leaves the base's value in place and the scheme wins; a
 * present-and-undefined key overwrites it, and 3Dmol tests the keys with
 * `typeof`, so undefined reads as absent. One constant, so a third scheme key
 * in a future 3Dmol cannot be nulled in one caller and forgotten in the other.
 */
const SCHEME_OFF = { colorscheme: undefined, colorfunc: undefined } as const

/**
 * The same representation, flattened to one colour.
 *
 * The scheme keys are overridden through `SCHEME_OFF` — its docstring says why
 * they must be present rather than omitted. Here the cost of omitting them
 * would be a base layer that simply does not appear.
 */
export function flattenToColor(
  style: Record<string, Record<string, unknown>>,
  color: string,
): Record<string, Record<string, unknown>> {
  const flat: Record<string, Record<string, unknown>> = {}
  for (const [key, value] of Object.entries(style)) {
    flat[key] = { ...value, color, ...SCHEME_OFF }
  }
  return flat
}

/**
 * Rebuild the base scene from the current switches.
 *
 * Step order is load-bearing and each step is numbered so a later edit can see
 * what it is stepping between.
 */
export function applySceneStyles(
  viewer: Viewer,
  settings: SceneSettings,
  opts: ApplyOptions = {},
): void {
  const w = window as any
  // Every style selector below goes through this. With `opts.model` unset it is
  // the identity, and steps 1-4 are UNSCOPED as they always were; with it set,
  // each selector names the one model, so other models in the scene are never
  // touched (see `ApplyOptions.model`).
  const scope = (sel: Record<string, unknown>): Record<string, unknown> =>
    (opts.model === undefined ? sel : { ...sel, model: opts.model })

  // 1. Clear. Without `opts.model` the setStyle is UNSCOPED, so it blanks every
  //    model in the scene — including any the caller added itself. Whatever
  //    the caller re-applies afterwards has to be re-applied on EVERY restyle,
  //    not once at load. With `opts.model` it blanks that model alone.
  //
  //    The surface is NOT cleared here. It used to be — an unconditional
  //    `removeAllSurfaces()` on this line, with `onSurface`'s null published
  //    beside it — and moving both into step 5 is what lets `surfaceController`
  //    see the old surface and the new request at the same moment and decide
  //    between them. The move itself changes nothing: surfaces live in
  //    `viewer.surfaces`, model styles in the models, and nothing renders
  //    between here and there.
  viewer.setStyle(scope({}), {})

  // 2. Protein (ATOM records = hetflag false).
  const proteinStyle = proteinStyleForSet(settings.viewStyles, settings.colorOption)
  if (settings.showProtein) {
    if (settings.base) {
      viewer.setStyle(scope({ hetflag: false }), flattenToColor(proteinStyle, settings.base.color))
      if (settings.base.rampSelection) {
        viewer.addStyle(scope(settings.base.rampSelection), proteinStyle)
      }
    } else {
      viewer.setStyle(scope({ hetflag: false }), proteinStyle)
    }
  }

  // 3. Ligands (HETATM). Water is a HETATM too and has its own switch, so it is
  //    cleared here and re-added by step 4 — otherwise turning Ligands on would
  //    drag every water molecule in with it.
  if (settings.showLigands) {
    viewer.addStyle(scope({ hetflag: true }), { stick: { radius: 0.15, colorscheme: 'greenCarbon' } })
    viewer.setStyle(scope({ resn: [...WATER_RESNAMES] }), {})
  }

  // 4. Water.
  if (settings.showWater) {
    viewer.addStyle(scope({ resn: [...WATER_RESNAMES] }), { sphere: { radius: 0.4, color: 'red' } })
  }

  // 5. Surface, over the protein only — including its REMOVAL, which is why
  //    `skipSurface` guards the whole step rather than just the drawing.
  //
  //    Everything about when a mesh is built, restyled, reused or dropped lives
  //    in `surfaceController`, which also owns the rejection handling that used
  //    to be a `.catch()` on this line and every `onSurface` publish — null
  //    when a mesh is dropped, a fresh handle when one finishes, nothing when
  //    the mesh is kept. Passing null is how "the switch is off" reaches it;
  //    the `$3Dmol` half of that condition is the same guard as before, because
  //    `SurfaceType` is read off the global and a viewer built before the
  //    library finished loading would throw rather than skip.
  if (!opts.skipSurface) {
    applySurface(
      viewer,
      settings.showSurface && w.$3Dmol
        ? {
            type: resolveSurfaceType(w, settings.surfaceType),
            style: {
              opacity: settings.surfaceOpaque ? 1 : SURFACE_TRANSLUCENT_OPACITY,
              color: 'white',
            },
            sel: opts.surfaceModel === undefined ? { hetflag: false } : { hetflag: false, model: opts.surfaceModel },
          }
        : null,
      opts.onSurface,
    )
  }
}

/** A residue selection picked in 3D or in the sequence strip. */
export interface ResidueHighlight {
  chain: string
  /**
   * A 3Dmol residue selector, passed through UNCHANGED.
   *
   * Deliberately not a `{ start, end }` pair the helper would format. Callers
   * send different shapes — a `start-end` range string for a drag selection, a
   * bare number for one click, an ARRAY for an arbitrary set — and each is
   * pinned by its own tests. What they actually share is the STYLE object
   * below, not the selector, so normalising the selector here would rewrite
   * callers' wire formats to no end.
   */
  resi: number | string | readonly number[]
  /**
   * Paint HETATM records instead of ATOM ones.
   *
   * Defaults false: a pick from a sequence strip or from a protein-only click
   * guard names protein residues only, so a `hetflag: true` pass there could
   * only ever paint a ligand the user did not choose. A caller whose pick names
   * a bound ligand or a metal ion sets it — a selector that says `hetflag: false` matches none of those,
   * silently, so the highlight would simply not appear.
   */
  het?: boolean
  /**
   * Paint only this model's residue. Unset = every model, as before.
   *
   * Set it while symmetry mates are on screen: a copy carries
   * the reference's chain ids and residue numbers, so an unscoped highlight
   * would light up the same residue in every copy of the molecule.
   */
  model?: number
}

/**
 * Paint the picked residues.
 *
 * Applied by the caller AFTER everything else it adds, for the reason step 1
 * gives: any restyle wipes it, so it cannot live in the effect that set the
 * selection. Every viewer draws it the same way, which is why the style object
 * is here rather than repeated per viewer.
 *
 * Accepts a list as well as a single highlight so a caller with a mixed
 * selection — several chains, or protein and ligand together — can express it
 * without looping at each call site. One `addStyle` per entry, because
 * `chain` and `hetflag` are scalars in a 3Dmol selector: only `resi` can carry
 * a list, so entries that differ in either of the other two cannot be merged.
 *
 * It is an `addStyle`, not a `setStyle`, so the base representation survives —
 * a Trace residue stays a trace under its highlight. But `addStyle` MERGES into
 * the spec the base painted, and 3Dmol lets the base's `colorscheme` or
 * `colorfunc` beat a flat `color` (see `SCHEME_OFF`). So under every scheme but
 * Spectrum — Chain, Secondary Structure, Element, B-factor, Dyna-1 — the slot
 * the base had already painted kept its scheme colour: the ribbon under Cartoon
 * or Trace, the sticks under Stick or Ball & Stick, the `greenCarbon` sticks of
 * a ligand pick. Only a slot the base had NOT painted came
 * out flat, which is why the default Cartoon view still grew amber sticks over
 * a residue whose ribbon never changed (PT-472). The scheme keys are now nulled
 * explicitly in both slots this helper paints; `sphere`, `line` and `cross` are
 * not painted here and keep the base scheme, as they always have.
 */
export function applyResidueHighlight(
  viewer: Viewer,
  highlight: ResidueHighlight | readonly ResidueHighlight[] | null,
  color: string,
): void {
  if (!highlight) return
  const list: readonly ResidueHighlight[] = Array.isArray(highlight)
    ? (highlight as readonly ResidueHighlight[])
    : [highlight as ResidueHighlight]
  // Spread into a fresh object per slot, so the stick's `radius` cannot leak
  // into the cartoon and a slot spec is never shared between two entries.
  const pick = { color, ...SCHEME_OFF }
  for (const entry of list) {
    const sel: Record<string, unknown> = { chain: entry.chain, resi: entry.resi, hetflag: entry.het ?? false }
    if (entry.model !== undefined) sel.model = entry.model
    viewer.addStyle(
      sel,
      { stick: { ...pick, radius: 0.25 }, cartoon: { ...pick } },
    )
  }
}
