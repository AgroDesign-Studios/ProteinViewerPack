/**
 * viewerColorScheme.
 *
 * These are the guardrails of the Dyna-1 3D colouring, and each of them fails
 * SILENTLY if it regresses — a wrong ramp still produces a full-colour picture.
 *
 * - `'dyna1'` must never paint through `prop: 'b'`. For predicted structures
 *   the B column carries pLDDT, and the file may be the only record of it.
 * - The atom mapper must write exactly one key.
 * - A scheme that cannot be honoured must degrade, or the viewer drops every
 *   atom to element colours and calls it a dynamics view.
 */
import { describe, expect, it } from 'vitest'

import {
  DYNA1_ATOM_PROPERTY,
  colorSchemeAvailable,
  getColorOption,
  makeDyna1AtomMapper,
  restoreColorScheme,
  type Dyna1ColorScale,
} from './viewerColorScheme'

const SCALE: Dyna1ColorScale = { min: 0, max: 0.34, colors: ['#edf2f7', '#4fd1c5', '#553c9a'] }

/** The loose shape 3Dmol hands the mapper. Declared here so the assertions can
 *  read keys the mapper is not supposed to touch. */
interface TestAtom {
  chain?: string
  resi?: number
  b?: number
  properties?: Record<string, unknown>
}

/** Every colorscheme literal in the returned fragment, however nested. */
function propsUsed(option: Record<string, unknown>): string[] {
  const scheme = option.colorscheme
  if (scheme && typeof scheme === 'object' && 'prop' in scheme) {
    return [String((scheme as { prop: unknown }).prop)]
  }
  return []
}

describe('getColorOption', () => {
  it('never paints Dyna-1 through the B-factor column', () => {
    const option = getColorOption('dyna1', SCALE)
    expect(propsUsed(option)).toEqual([DYNA1_ATOM_PROPERTY])
    expect(propsUsed(option)).not.toContain('b')
    expect(JSON.stringify(option)).not.toContain('"prop":"b"')
    expect(JSON.stringify(option)).not.toContain('bfactor')
  })

  it('reads its bounds from the passed scale, not from a constant', () => {
    const option = getColorOption('dyna1', { ...SCALE, max: 0.51 })
    expect(option).toEqual({
      colorscheme: {
        prop: DYNA1_ATOM_PROPERTY,
        gradient: 'linear',
        min: 0,
        max: 0.51,
        colors: SCALE.colors,
      },
    })
  })

  it('degrades to spectrum when the scale is missing or degenerate', () => {
    expect(getColorOption('dyna1', null)).toEqual({ color: 'spectrum' })
    expect(getColorOption('dyna1')).toEqual({ color: 'spectrum' })
    expect(getColorOption('dyna1', { ...SCALE, max: 0 })).toEqual({ color: 'spectrum' })
  })

  it('leaves every pre-existing scheme exactly as it was', () => {
    expect(getColorOption('spectrum')).toEqual({ color: 'spectrum' })
    expect(getColorOption('chain')).toEqual({ colorscheme: 'chain' })
    expect(getColorOption('ss')).toEqual({ colorscheme: 'ssJmol' })
    expect(getColorOption('element')).toEqual({ colorscheme: 'Jmol' })
    expect(getColorOption('bfactor')).toEqual({
      colorscheme: { prop: 'b', gradient: 'rwb', min: 10, max: 80 },
    })
  })
})

describe('restoreColorScheme', () => {
  it('is the ONLY restore path, and a saved dyna1 always degrades at restore time', () => {
    // A restore is told availability once; with no Dyna-1 scores available
    // it degrades. Keeping it now and dropping it later would need a state
    // machine that can tell "no scores yet" from "no scores exist".
    expect(restoreColorScheme('dyna1', { dyna1Available: false })).toBe('spectrum')
  })

  it('drops a saved dyna1 when no Dyna-1 scores are available', () => {
    expect(restoreColorScheme('dyna1', { dyna1Available: false })).toBe('spectrum')
  })

  it('keeps a saved dyna1 when Dyna-1 scores are available', () => {
    expect(restoreColorScheme('dyna1', { dyna1Available: true })).toBe('dyna1')
  })

  it('drops anything it does not recognise', () => {
    // localStorage is user-writable and a persisted scheme outlives builds.
    expect(restoreColorScheme('rainbow', { dyna1Available: true })).toBe('spectrum')
    expect(restoreColorScheme(undefined, { dyna1Available: true })).toBe('spectrum')
    expect(restoreColorScheme(null, { dyna1Available: true })).toBe('spectrum')
  })

  it('never touches an unconditional scheme', () => {
    expect(restoreColorScheme('bfactor', { dyna1Available: false })).toBe('bfactor')
    expect(colorSchemeAvailable('bfactor', false)).toBe(true)
    expect(colorSchemeAvailable('dyna1', false)).toBe(false)
  })
})

describe('makeDyna1AtomMapper', () => {
  it('writes only atom.properties.dyna1', () => {
    const atom: TestAtom = { chain: 'A', resi: 42, b: 71.5, properties: { keep: 1 } }
    makeDyna1AtomMapper(new Map([['A:42', 0.21]]))(atom)
    expect(atom.properties).toEqual({ keep: 1, dyna1: 0.21 })
    // The B column is the pLDDT record for predicted structures. Untouched.
    expect(atom.b).toBe(71.5)
    expect(Object.keys(atom).sort()).toEqual(['b', 'chain', 'properties', 'resi'])
  })

  it('creates the properties bag only when there is a score to put in it', () => {
    const scored: TestAtom = { chain: 'A', resi: 42 }
    makeDyna1AtomMapper(new Map([['A:42', 0.21]]))(scored)
    expect(scored.properties).toEqual({ dyna1: 0.21 })

    const unscored: TestAtom = { chain: 'A', resi: 99 }
    makeDyna1AtomMapper(new Map([['A:42', 0.21]]))(unscored)
    // Left unset on purpose: that is what lets the grey base layer show through
    // as "not computed" instead of as a confident low score.
    expect(unscored.properties).toBeUndefined()
  })

  it('ignores an atom with no chain or residue number', () => {
    const mapper = makeDyna1AtomMapper(new Map([['A:42', 0.21]]))
    const nameless: TestAtom = { resi: 42 }
    mapper(nameless)
    expect(nameless.properties).toBeUndefined()
  })

  it('keys on the chain as well as the residue', () => {
    const atom: TestAtom = { chain: 'B', resi: 42 }
    makeDyna1AtomMapper(new Map([['A:42', 0.21]]))(atom)
    expect(atom.properties).toBeUndefined()
  })
})
