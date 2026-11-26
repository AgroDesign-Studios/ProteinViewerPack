/**
 * The 3D viewer's colour schemes, shared by every page that shows the viewer.
 *
 * One file, so an addition such as the Dyna-1 scheme cannot reach one page and
 * miss another, and so the guarantees below are testable.
 *
 * Three guarantees this module exists to hold:
 *
 * 1. **`'dyna1'` never paints through the B-factor column.** `prop: 'b'` is the
 *    pLDDT ramp for predicted structures, whose file may be the only pLDDT
 *    record there is. Nothing here writes B, and
 *    the Dyna-1 scheme reads its own atom property.
 * 2. **A scheme that cannot be honoured degrades to `'spectrum'`.** A saved
 *    `'dyna1'` restored when no Dyna-1 scores are available would otherwise drop every
 *    atom to element colours — a full-colour picture of nothing.
 * 3. **The atom mapper writes ONE key.** Anything else in `atom.properties`
 *    belongs to the file or to another feature.
 */

/** Every scheme the viewer offers. */
export type ColorScheme = 'spectrum' | 'chain' | 'ss' | 'element' | 'bfactor' | 'dyna1'

/** The single atom property the Dyna-1 colouring reads and writes. */
export const DYNA1_ATOM_PROPERTY = 'dyna1'

/** The scheme anything unrecognised or unavailable falls back to. */
export const FALLBACK_COLOR_SCHEME: ColorScheme = 'spectrum'

const COLOR_SCHEMES: readonly ColorScheme[] = [
  'spectrum',
  'chain',
  'ss',
  'element',
  'bfactor',
  'dyna1',
]

/**
 * What the Dyna-1 scheme needs before it can paint: the head's own scale and
 * the ramp resolved from the stylesheet.
 *
 * `min` / `max` are supplied by the caller, never from a literal here: a
 * hardcoded bound could go stale quietly, since a wrongly-scaled ramp still
 * produces a picture.
 */
export interface Dyna1ColorScale {
  min: number
  max: number
  /** Low → mid → high, from `resolveDynRamp`. */
  colors: [string, string, string]
}

function usableScale(scale: Dyna1ColorScale | null | undefined): scale is Dyna1ColorScale {
  if (!scale) return false
  if (!Number.isFinite(scale.min) || !Number.isFinite(scale.max)) return false
  if (scale.max <= scale.min) return false
  return Array.isArray(scale.colors) && scale.colors.length === 3
}

/**
 * The 3Dmol style fragment for one scheme.
 *
 * `dyna1Scale` is required only by `'dyna1'`; without it that scheme degrades
 * to the fallback rather than painting an unscaled or B-factor-based ramp.
 */
export function getColorOption(
  scheme: ColorScheme,
  dyna1Scale?: Dyna1ColorScale | null,
): Record<string, unknown> {
  switch (scheme) {
    case 'spectrum': return { color: 'spectrum' }
    case 'chain': return { colorscheme: 'chain' }
    case 'ss': return { colorscheme: 'ssJmol' }
    case 'element': return { colorscheme: 'Jmol' }
    case 'bfactor': return { colorscheme: { prop: 'b', gradient: 'rwb', min: 10, max: 80 } }
    case 'dyna1':
      // Its OWN property, its OWN bounds. `prop: 'b'` here would overwrite
      // nothing (3Dmol only reads it) but it would paint the pLDDT ramp over a
      // 0..0.34 quantity and call it a dynamics colouring.
      return usableScale(dyna1Scale)
        ? {
            colorscheme: {
              prop: DYNA1_ATOM_PROPERTY,
              gradient: 'linear',
              min: dyna1Scale.min,
              max: dyna1Scale.max,
              colors: dyna1Scale.colors,
            },
          }
        : { color: 'spectrum' }
    default: return { color: 'spectrum' }
  }
}

/**
 * Whether a scheme can be honoured right now.
 *
 * Only `'dyna1'` is conditional: every other scheme is a property of the file,
 * which is always loaded before the viewer exists.
 */
export function colorSchemeAvailable(scheme: ColorScheme, dyna1Available: boolean): boolean {
  return scheme !== 'dyna1' || dyna1Available
}

/**
 * Read a persisted scheme back, degrading anything unusable.
 *
 * Both sources are outside this build's control: localStorage
 * (user-writable), and a persisted scheme written by an older build,
 * possibly one this build has dropped. Neither may put the viewer into a state it
 * cannot paint.
 */
export function restoreColorScheme(
  saved: unknown,
  opts: { dyna1Available: boolean },
): ColorScheme {
  const scheme = COLOR_SCHEMES.find(s => s === saved)
  if (!scheme) return FALLBACK_COLOR_SCHEME
  return colorSchemeAvailable(scheme, opts.dyna1Available) ? scheme : FALLBACK_COLOR_SCHEME
}

/** The shape `mapAtomProperties` hands us. Loose because 3Dmol is untyped. */
interface MappableAtom {
  chain?: string
  resi?: number
  properties?: Record<string, unknown>
}

/**
 * Build the per-atom mapper for the Dyna-1 colouring.
 *
 * The FUNCTION form of `mapAtomProperties`, never the array form: the array
 * form is O(atoms × props) and costs roughly 17 M selector evaluations on a
 * 1 457-residue chain, which is a visible freeze on a page that also re-styles
 * on every residue click.
 *
 * Writes `atom.properties.dyna1` and nothing else — no B-factor, no other key,
 * and no key at all for an atom with no score (leaving it unset is what lets
 * the base layer show through as "not computed").
 */
export function makeDyna1AtomMapper(
  byKey: Map<string, number>,
): (atom: MappableAtom) => void {
  return (atom: MappableAtom): void => {
    if (!atom || typeof atom.chain !== 'string' || typeof atom.resi !== 'number') return
    const value = byKey.get(`${atom.chain}:${atom.resi}`)
    if (value === undefined) return
    const properties = atom.properties ?? (atom.properties = {})
    properties[DYNA1_ATOM_PROPERTY] = value
  }
}
