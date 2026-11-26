/**
 * surfaceType.ts
 * The one place that knows which 3Dmol surface the viewer draws.
 *
 * 3Dmol's surface enum is `{ VDW = 1, MS = 2, SAS = 3, SES = 4 }`, and its
 * member 4 draws a solid that is a subset of member 2's, thinner than a
 * solvent-excluded surface. So `MS` is the molecular surface drawn here, and
 * the default stays `MS`, not `SES`.
 */

/**
 * The keys, in the order the chips render them: least to most processed.
 *
 * VDW and MS come first because they are the two a user should normally pick;
 * SAS and SES follow because each is a different question about the same
 * molecule and each reads as "smoother" on screen while meaning something else.
 */
export const SURFACE_TYPE_KEYS = ['VDW', 'MS', 'SAS', 'SES'] as const

export type SurfaceTypeKey = (typeof SURFACE_TYPE_KEYS)[number]

/**
 * What a viewer opens with when nothing is remembered.
 *
 * MS, because the i18n strings shipped with the Surface toggle have promised
 * "the molecular surface" / 「分子表面」 since before this control existed, while
 * the code drew VDW. Flipping the default is what makes that text true.
 */
export const SURFACE_TYPE_DEFAULT: SurfaceTypeKey = 'MS'

/**
 * What an ABSENT field in a stored blob means — deliberately NOT the default
 * above.
 *
 * Every stored blob and every stored view written before this
 * field existed was rendered with VDW, so VDW is the honest reading of a
 * missing value: it is the picture that blob or view actually was. Collapsing
 * the two constants would make every older stored view restore a surface
 * it was never drawn with — the same rule the opaque toggle wrote down when it landed
 * ("those were all translucent, so `false` is the correct reading of a missing
 * field").
 */
export const SURFACE_TYPE_LEGACY: SurfaceTypeKey = 'VDW'

/**
 * Surface types whose geometry answers a different question than "where is the
 * molecule", and which therefore carry a caveat in the UI.
 *
 * SES is thinner than the molecule (see the header). SAS is the surface traced
 * by the probe's CENTRE, so it sits a whole solvent radius out and reads as a
 * fattened molecule. Both are legitimate to look at and misleading to measure
 * a pocket or a contact against, which is most of what this viewer is used for.
 */
export const SURFACE_TYPES_WITH_CAVEAT: readonly SurfaceTypeKey[] = ['SAS', 'SES']

/**
 * 3Dmol's own numeric enum members, written out rather than derived from
 * `SURFACE_TYPE_KEYS`' position.
 *
 * The array above is ordered for the CHIPS; deriving numbers from its index
 * would make a UI reordering silently redefine what a stored `2` means — the
 * same class of invisible mistake this whole module exists to prevent. Only the
 * numeric-tolerant read boundary uses this; everything on the drawing path goes
 * through `resolveSurfaceType`, which reads the LIVE enum and is therefore
 * still correct if 3Dmol ever renumbers.
 */
export const SURFACE_TYPE_NUMBERS: Record<SurfaceTypeKey, number> = {
  VDW: 1,
  MS: 2,
  SAS: 3,
  SES: 4,
}

export function isSurfaceTypeKey(value: unknown): value is SurfaceTypeKey {
  return typeof value === 'string' && (SURFACE_TYPE_KEYS as readonly string[]).includes(value)
}

/**
 * Read boundary for both outside sources — a localStorage blob and a
 * stored view. Both arrive as plain JSON whose shape no earlier
 * step checks, so this is where the value is checked.
 *
 * `fallback` is explicit at every call site rather than defaulted here, because
 * the two callers legitimately want different answers: a fresh viewer wants
 * `SURFACE_TYPE_DEFAULT`, a stored blob wants `SURFACE_TYPE_LEGACY`.
 *
 * Case-SENSITIVE, deliberately, and not to be "made consistent" with the loose
 * one below. Every WRITER of these two fields is this repository — the blob
 * literal and the stored view both store a `SurfaceTypeKey` — so a
 * lowercase spelling is not a spelling variant that needs tolerating. It can
 * still ARRIVE, because the blob is user-writable and that is why this function
 * exists at all; but arriving by hand-edit is not a reason to honour it.
 * Folding would widen the boundary for a shape no writer emits, and it would
 * buy a hand-editor nothing they could not get by typing the key correctly.
 */
export function sanitizeSurfaceType(raw: unknown, fallback: SurfaceTypeKey): SurfaceTypeKey {
  return isSurfaceTypeKey(raw) ? raw : fallback
}

/**
 * Same read boundary, widened for an untrusted, loosely typed caller input
 * (the viewer-command path). It accepts:
 *   - a key in any ASCII letter case, after trimming (`'ms'` reads as MS);
 *   - 3Dmol's own NUMERIC enum members, as a number or a numeric string
 *     (`2` or `'2'` reads as MS), as the expression it replaced did by
 *     indexing the enum's reverse mapping.
 * Anything else falls back to `fallback`, and a value that was given but not
 * recognised is logged to the console. ([[PT-475]], split out of #1806.)
 *
 * Deliberately NOT folded into `sanitizeSurfaceType`. The blob and the
 * stored view store this field as a KEY and have never stored a number, so
 * widening their boundary would only add a shape nothing writes, and the
 * narrower a validation boundary is, the more it is worth.
 *
 * A case-folded or padded value draws the named surface, live or replayed.
 */
export function sanitizeSurfaceTypeLoose(raw: unknown, fallback: SurfaceTypeKey): SurfaceTypeKey {
  // Folded only for an ASCII-letter string, and only after trimming. Each of
  // those three restrictions is load-bearing:
  //
  // - `typeof raw === 'string'`, never `String(raw)`: the latter drags an
  //   object or a null through `toString()`. Not a hypothetical — the test
  //   beside this pins `{toString: () => 'MS'}`, which collides with a key
  //   that exists TODAY.
  // - ASCII letters only, because `toUpperCase()` is Unicode case mapping, not
  //   ASCII case folding: U+017F ('ſ', LATIN SMALL LETTER LONG S) upper-cases
  //   to 'S', so 'ſaſ' would otherwise select SAS. Accepting homoglyph
  //   spellings is the same widening the bullet above refuses, one alphabet
  //   over. (`toUpperCase`, not `toLocaleUpperCase`, so the Turkish dotless-i
  //   hazard never arises; none of the four keys contains I or K.)
  // - Trimmed, because the numeric branch below ALREADY tolerates padding
  //   (`Number(' 2 ')` is 2). A boundary that reads a loose spelling has no
  //   business being lenient about whitespace on one branch and strict on the
  //   other — that asymmetry is the same silent-VDW bug one space over.
  const trimmed = typeof raw === 'string' ? raw.trim() : null
  const folded = trimmed !== null && /^[A-Za-z]+$/.test(trimmed) ? trimmed.toUpperCase() : raw
  if (isSurfaceTypeKey(folded)) return folded
  // A numeric string counts too: untyped JSON input may send `"2"` for `2`.
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN
  for (const key of SURFACE_TYPE_KEYS) {
    if (SURFACE_TYPE_NUMBERS[key] === n) return key
  }
  // The other half of PT-475: a value that was given but not understood
  // (e.g. 'molecular surface' or 'ses.') would otherwise draw VDW silently, so
  // it is logged to the browser console.
  //
  // An ABSENT value is deliberately NOT warned about: leaving the type out is
  // the ordinary, documented shape of an addSurface command. `null` counts as
  // absent (the caller declined to name a surface); an EMPTY STRING warns,
  // because it is a value and an unusable one. The strict sibling warns on
  // nothing: there a missing field is the normal reading of a legacy blob.
  //
  // SCOPE: this covers the spelling only. A surface type sent under the wrong
  // key (`params.surfaceType`) reaches this function as `undefined`, the same
  // as an omitted one, so it is not seen here.
  if (raw !== undefined && raw !== null) {
    console.warn('[surfaceType] unrecognised surface type; drawing', fallback, '— got:', raw)
  }
  return fallback
}

/**
 * Resolve a key against the live 3Dmol enum.
 *
 * Every caller goes through this rather than writing `w.$3Dmol.SurfaceType.MS`
 * inline, because the failure mode of getting it wrong is invisible: 3Dmol's
 * `addSurface` starts from `let type = SurfaceType.VDW` and an `undefined`
 * argument matches neither its string nor its number branch, so it draws VDW
 * and logs nothing. A test whose 3Dmol double stubs the enum as `{ VDW: 1 }`
 * therefore passes while the feature does nothing at all.
 *
 * The explicit VDW fallback here is the same behaviour 3Dmol would produce
 * anyway; it is written out so the value handed to `addSurface` is never
 * `undefined` and an assertion on argument 0 can prove which surface was asked
 * for.
 */
export function resolveSurfaceType(w: { $3Dmol?: { SurfaceType?: Record<string, number> } }, key: SurfaceTypeKey): number {
  const table = w.$3Dmol?.SurfaceType
  const resolved = table?.[key]
  return typeof resolved === 'number' ? resolved : (table?.VDW ?? 1)
}
