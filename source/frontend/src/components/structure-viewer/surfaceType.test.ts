import { describe, expect, it, vi } from 'vitest'
import en from '../../i18n/locales/en/proteindb.json'
import ja from '../../i18n/locales/ja/proteindb.json'
import {
  SURFACE_TYPE_DEFAULT,
  SURFACE_TYPE_KEYS,
  SURFACE_TYPE_LEGACY,
  SURFACE_TYPE_NUMBERS,
  SURFACE_TYPES_WITH_CAVEAT,
  isSurfaceTypeKey,
  resolveSurfaceType,
  sanitizeSurfaceType,
  sanitizeSurfaceTypeLoose,
} from './surfaceType'
import type { SurfaceTypeKey } from './surfaceType'

/**
 * 3dmol 2.5.4's own enum, copied here so the resolver is tested against the
 * library's numbers rather than against itself. If a 3Dmol upgrade renumbers
 * these, this is the file that should go red.
 */
const REAL_ENUM = { VDW: 1, MS: 2, SAS: 3, SES: 4 }

describe('surface type constants', () => {
  it('defaults a fresh viewer to the molecular surface', () => {
    // The whole point of the feature: the Surface toggle's shipped wording has
    // promised "the molecular surface" since before the type was selectable,
    // while the code drew VDW.
    expect(SURFACE_TYPE_DEFAULT).toBe('MS')
  })

  it('reads an absent stored value as VDW, NOT as the current default', () => {
    // Deliberately two different constants. Every stored blob and every stored
    // view written before this field existed was rendered with VDW, so
    // VDW is the honest reading of a missing value — collapsing the two would
    // make an older stored view restore a surface it was never drawn with.
    // Do not "simplify" these into one.
    expect(SURFACE_TYPE_LEGACY).toBe('VDW')
    expect(SURFACE_TYPE_LEGACY).not.toBe(SURFACE_TYPE_DEFAULT)
  })

  it('offers exactly the members 3Dmol has', () => {
    expect([...SURFACE_TYPE_KEYS]).toEqual(Object.keys(REAL_ENUM))
  })

  it('marks the two whose geometry is not the molecule itself', () => {
    // SES draws every atom thinner than it is; SAS is traced by the probe's
    // centre and so sits a whole solvent radius out. Both read as "smoother
    // than VDW" on screen while meaning something else, which is why they carry
    // a caveat and VDW/MS do not.
    expect([...SURFACE_TYPES_WITH_CAVEAT]).toEqual(['SAS', 'SES'])
  })
})

describe('sanitizeSurfaceType', () => {
  it('keeps every real key', () => {
    for (const key of SURFACE_TYPE_KEYS) {
      expect(sanitizeSurfaceType(key, SURFACE_TYPE_LEGACY)).toBe(key)
    }
  })

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['an unknown name', 'MOLECULAR'],
    ['the wrong case', 'ms'],
    ['a number', 2],
    ['an object', { key: 'MS' }],
  ])('falls back on %s', (_label, raw) => {
    // The value can come from localStorage or a stored view state, so it is
    // checked here.
    expect(sanitizeSurfaceType(raw, SURFACE_TYPE_LEGACY)).toBe(SURFACE_TYPE_LEGACY)
  })

  it('honours the fallback the caller passed rather than a baked-in one', () => {
    expect(sanitizeSurfaceType(undefined, SURFACE_TYPE_DEFAULT)).toBe(SURFACE_TYPE_DEFAULT)
  })
})

describe('isSurfaceTypeKey', () => {
  it('accepts only the four names', () => {
    expect(isSurfaceTypeKey('MS')).toBe(true)
    expect(isSurfaceTypeKey('ms')).toBe(false)
    expect(isSurfaceTypeKey(2)).toBe(false)
    expect(isSurfaceTypeKey(undefined)).toBe(false)
  })
})

describe('resolveSurfaceType', () => {
  const w = { $3Dmol: { SurfaceType: REAL_ENUM } }

  it('maps each key to 3Dmol’s own number', () => {
    expect(resolveSurfaceType(w, 'VDW')).toBe(1)
    expect(resolveSurfaceType(w, 'MS')).toBe(2)
    expect(resolveSurfaceType(w, 'SAS')).toBe(3)
    expect(resolveSurfaceType(w, 'SES')).toBe(4)
  })

  it('does not confuse the molecular surface with 3Dmol’s SES', () => {
    // The single assertion this whole module exists for. 3Dmol's own docstring
    // calls member 4 "Solvent exposed surface" and a comment inside addSurface
    // claims `4: MS` outright, contradicting the enum in the same file.
    expect(resolveSurfaceType(w, 'MS')).not.toBe(resolveSurfaceType(w, 'SES'))
    expect(resolveSurfaceType(w, 'MS')).toBe(REAL_ENUM.MS)
  })

  it('returns a number, never undefined, when 3Dmol is missing or partial', () => {
    // An `undefined` reaching addSurface is the silent failure: 3Dmol starts
    // from VDW and matches neither its string nor its number branch, so it
    // draws VDW and logs nothing.
    expect(resolveSurfaceType({}, 'MS')).toBe(1)
    expect(resolveSurfaceType({ $3Dmol: {} }, 'MS')).toBe(1)
    expect(resolveSurfaceType({ $3Dmol: { SurfaceType: { VDW: 1 } } }, 'MS')).toBe(1)
  })
})

describe('sanitizeSurfaceTypeLoose (an untrusted, loosely typed caller input)', () => {
  it('accepts every string key exactly as the strict sanitizer does', () => {
    for (const key of SURFACE_TYPE_KEYS) {
      expect(sanitizeSurfaceTypeLoose(key, SURFACE_TYPE_LEGACY)).toBe(key)
    }
  })

  it('accepts 3Dmol’s numeric enum members, which the old dispatcher took', () => {
    // The expression this replaced indexed a real TypeScript enum, whose
    // reverse mapping turned 2 into 'MS'. A command that carries a number
    // must still draw that surface.
    expect(sanitizeSurfaceTypeLoose(1, SURFACE_TYPE_LEGACY)).toBe('VDW')
    expect(sanitizeSurfaceTypeLoose(2, SURFACE_TYPE_LEGACY)).toBe('MS')
    expect(sanitizeSurfaceTypeLoose(3, SURFACE_TYPE_LEGACY)).toBe('SAS')
    expect(sanitizeSurfaceTypeLoose(4, SURFACE_TYPE_LEGACY)).toBe('SES')
  })

  it('accepts the numeric-string form an untyped caller may send', () => {
    expect(sanitizeSurfaceTypeLoose('2', SURFACE_TYPE_LEGACY)).toBe('MS')
  })

  it('accepts every key in any letter case', () => {
    // PT-475: a viewer command may spell the key in lowercase
    // ('ms' / 'vdw').
    // Before this, a lowercase key matched no enum member and `Number('ms')`
    // was NaN, so it missed BOTH branches and returned the fallback -- VDW --
    // with no exception and no log. The user asked for the molecular surface
    // and silently got a different one.
    for (const key of SURFACE_TYPE_KEYS) {
      // The fallback is never the key under test. With SURFACE_TYPE_LEGACY here
      // the VDW iteration would assert 'VDW' against a fallback of 'VDW' and
      // pass on a sanitizer that folded nothing -- measured, not guessed: that
      // is exactly how this row first came out green under the mutation.
      const fallback: SurfaceTypeKey = key === 'VDW' ? 'MS' : 'VDW'
      expect(sanitizeSurfaceTypeLoose(key.toLowerCase(), fallback)).toBe(key)
    }
  })

  it.each([
    ['Ms', 'MS', 'VDW'],
    ['vdW', 'VDW', 'MS'],
    ['sEs', 'SES', 'VDW'],
    ['sas', 'SAS', 'VDW'],
  ])(
    'folds %s to %s rather than guessing at a spelling',
    (raw, expected, fallback) => {
      // Not just lowercase: nothing promises a caller picks one of two cases,
      // and the fix costs the same either way. The third column is the
      // fallback, chosen per row to differ from the expectation for the reason
      // above -- an assertion that coincides with the give-up value proves
      // nothing.
      expect(sanitizeSurfaceTypeLoose(raw, fallback as SurfaceTypeKey)).toBe(expected)
    },
  )

  it('trims, because the numeric branch already tolerates the same padding', () => {
    // The asymmetry the fold would otherwise leave: `Number(' 2 ')` is 2, so a
    // padded NUMBER already worked while a padded KEY still fell to VDW.
    // Same silent bug, one space over.
    expect(sanitizeSurfaceTypeLoose(' ms ', 'VDW')).toBe('MS')
    expect(sanitizeSurfaceTypeLoose('\nSES\t', 'VDW')).toBe('SES')
    expect(sanitizeSurfaceTypeLoose(' 2 ', 'VDW')).toBe('MS')
  })

  it('folds ASCII letters only, so a homoglyph cannot reach a key', () => {
    // `toUpperCase()` is Unicode case MAPPING, not ASCII case folding: U+017F
    // ('long s') upper-cases to 'S', so an unguarded fold accepts 'sas' and
    // 'ms' spelled with it. Accepting homoglyphs is the widening this boundary
    // refuses.
    //
    // Both rows take a fallback that is NOT the key the homoglyph spells, or
    // the assertion cannot tell "the guard refused it" from "the fold accepted
    // it and it happened to equal the give-up value". That mistake has now been
    // made three times in this file's history -- once per new assertion block
    // -- so it is written down rather than left to the next reader's care.
    expect(sanitizeSurfaceTypeLoose('ſaſ', 'VDW')).toBe('VDW') // would fold to SAS
    expect(sanitizeSurfaceTypeLoose('mſ', 'VDW')).toBe('VDW') // would fold to MS
  })

  it.each([
    ['full-width letters, which upper-case to full-width', 'ＭＳ'],
    ['a key with punctuation attached', 'MS!'],
    ['letters with an interior space', 'M S'],
  ])('leaves %s alone', (_label, raw) => {
    // These pin the SHAPE of the accepted set rather than the guard: each was
    // already a fallback before the ASCII restriction, so none of them reds if
    // the guard is removed. Kept because they are the spellings a reader would
    // otherwise have to re-derive, and labelled so nobody mistakes them for
    // proof that the guard works -- the two homoglyph rows above are that.
    expect(sanitizeSurfaceTypeLoose(raw, 'VDW')).toBe('VDW')
  })

  it('says so when it gives up, but stays quiet when nothing was asked', () => {
    // The other half of PT-475: the wrong surface was half the harm, the
    // silence was the rest. A value that was SAID and not understood warns; an
    // absent one does not, because expressing no opinion is ordinary and
    // warning on it would bury the signal.
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(sanitizeSurfaceTypeLoose('molecular surface', 'VDW')).toBe('VDW')
      expect(spy).toHaveBeenCalledOnce()

      spy.mockClear()
      expect(sanitizeSurfaceTypeLoose(undefined, 'VDW')).toBe('VDW')
      expect(sanitizeSurfaceTypeLoose(null, 'VDW')).toBe('VDW')
      expect(spy).not.toHaveBeenCalled()

      // An EMPTY STRING is a value, and an unusable one, so it warns -- the
      // line that separates "said nothing" from "said something I cannot read".
      spy.mockClear()
      expect(sanitizeSurfaceTypeLoose('', 'VDW')).toBe('VDW')
      expect(spy).toHaveBeenCalledOnce()

      // And never on the happy path, or the log becomes noise nobody reads.
      spy.mockClear()
      expect(sanitizeSurfaceTypeLoose('ms', 'VDW')).toBe('MS')
      expect(sanitizeSurfaceTypeLoose(2, 'VDW')).toBe('MS')
      expect(spy).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })

  it('folds only STRINGS -- it does not stringify what is handed to it', () => {
    // `String(raw).toUpperCase()` was the obvious one-liner and is wider than
    // it looks: it drags every non-string through `toString()`, so a shape
    // nothing writes could reach a key. The numeric branch below still handles
    // real numbers; this is about everything else.
    expect(sanitizeSurfaceTypeLoose({ toString: () => 'MS' }, SURFACE_TYPE_LEGACY)).toBe(
      SURFACE_TYPE_LEGACY,
    )
    expect(sanitizeSurfaceTypeLoose(['MS'], SURFACE_TYPE_LEGACY)).toBe(SURFACE_TYPE_LEGACY)
  })

  it('folds case ONLY here -- the stored-blob boundary still refuses it', () => {
    // The two boundaries now disagree on purpose, so state it as one assertion
    // rather than leaving a later reader to "make them consistent". The loose
    // one reads an untrusted caller's spelling; the strict one reads a value this
    // repository wrote itself, where lowercase is not a variant to tolerate but
    // a shape nothing produces.
    expect(sanitizeSurfaceTypeLoose('ms', SURFACE_TYPE_LEGACY)).toBe('MS')
    expect(sanitizeSurfaceType('ms', SURFACE_TYPE_LEGACY)).toBe(SURFACE_TYPE_LEGACY)
  })

  it.each([
    ['out of range', 5],
    ['zero', 0],
    ['negative', -1],
    ['fractional', 2.5],
    ['NaN', Number.NaN],
    ['an empty string', ''],
    ['an unknown name', 'MOLECULAR'],
    ['null', null],
    ['an object', { type: 2 }],
    // The OMITTED key. `cmd.params?.type` is undefined whenever addSurface
    // arrives with no params, and leaving it out draws VDW -- pinned as
    // behaviour here (PR #1806 round 2).
    ['undefined', undefined],
  ])('falls back on %s', (_label, raw) => {
    expect(sanitizeSurfaceTypeLoose(raw, SURFACE_TYPE_LEGACY)).toBe(SURFACE_TYPE_LEGACY)
  })

  it('does not widen the strict boundary the stored blobs use', () => {
    // The stored blob and stored view store a KEY and have never stored a
    // number; if this ever starts passing, a validation boundary got loosened
    // for a shape nothing writes.
    expect(sanitizeSurfaceType(2 as unknown, SURFACE_TYPE_LEGACY)).toBe(SURFACE_TYPE_LEGACY)
  })
})

describe('SURFACE_TYPE_NUMBERS', () => {
  it('matches 3Dmol’s enum', () => {
    expect(SURFACE_TYPE_NUMBERS).toEqual(REAL_ENUM)
  })

  it('is not derived from the chip order, which is free to change', () => {
    // If these are ever equal by INDEX rather than by this table, reordering
    // the chips for a UI reason would silently redefine what a stored 2 means.
    for (const key of SURFACE_TYPE_KEYS) {
      expect(SURFACE_TYPE_NUMBERS[key]).toBe(REAL_ENUM[key as keyof typeof REAL_ENUM])
    }
  })
})

describe('i18n keys the chips build by interpolation', () => {
  // Both the hint and the caveat strings are assembled as
  // `viewer_surface_type_${key.toLowerCase()}_...`, so nothing type-checks that
  // they exist: a missing one paints the raw key into the toolbar at runtime.
  it('has a label and a hint for every surface type, in both locales', () => {
    for (const key of SURFACE_TYPE_KEYS) {
      const k = key.toLowerCase()
      expect(en, `en label for ${key}`).toHaveProperty(`viewer_surface_type_${k}`)
      expect(en, `en hint for ${key}`).toHaveProperty(`viewer_surface_type_${k}_hint`)
      expect(ja, `ja label for ${key}`).toHaveProperty(`viewer_surface_type_${k}`)
      expect(ja, `ja hint for ${key}`).toHaveProperty(`viewer_surface_type_${k}_hint`)
    }
  })

  it('has a caveat string for every type that claims one, in both locales', () => {
    for (const key of SURFACE_TYPES_WITH_CAVEAT) {
      const k = key.toLowerCase()
      expect(en, `en caveat for ${key}`).toHaveProperty(`viewer_surface_type_${k}_caveat`)
      expect(ja, `ja caveat for ${key}`).toHaveProperty(`viewer_surface_type_${k}_caveat`)
    }
  })

  it('names the group itself', () => {
    expect(en).toHaveProperty('viewer_surface_type')
    expect(ja).toHaveProperty('viewer_surface_type')
  })
})

describe('the hover popup spells the abbreviations out', () => {
  /**
   * Owner request 2026-08-29: "show what SAS and SES stand for in the popup".
   *
   * Asserted against the shipped bundles rather than through a rendered `t()`,
   * because that is where the copy actually lives — and because assertions made
   * through `react-i18next` in this repo are execution-order dependent.
   *
   * VDW and MS are here too. They already glossed themselves in prose, but a row
   * where two of four chips name their letters and two do not reads as an
   * oversight, and the whole point of the request was that the letters are
   * opaque until someone tells you.
   */
  const EXPANSIONS: Record<string, { en: RegExp; ja: RegExp }> = {
    vdw: { en: /van der Waals surface/i, ja: /van der Waals surface/i },
    ms: { en: /Molecular Surface/i, ja: /Molecular Surface/i },
    sas: { en: /Solvent-Accessible Surface/i, ja: /Solvent-Accessible Surface/i },
    ses: { en: /Solvent-Excluded Surface/i, ja: /Solvent-Excluded Surface/i },
  }

  for (const [key, patterns] of Object.entries(EXPANSIONS)) {
    it(`names what ${key.toUpperCase()} stands for, in both languages`, () => {
      const name = `viewer_surface_type_${key}_hint`
      expect((en as Record<string, string>)[name]).toMatch(patterns.en)
      expect((ja as Record<string, string>)[name]).toMatch(patterns.ja)
    })
  }

  it('does NOT let the SES expansion turn into a claim about what 3Dmol draws', () => {
    // The trap this module exists for. "SES" means solvent-EXCLUDED surface to
    // every chemist, and 3Dmol's member 4 is not one — it is the probe-eroded
    // solid alone, thinner than the molecule. Spelling the name out without
    // saying so would make the popup assert exactly the thing the header of this
    // file spends thirty lines disproving.
    const enHint = (en as Record<string, string>).viewer_surface_type_ses_hint
    const jaHint = (ja as Record<string, string>).viewer_surface_type_ses_hint
    // English: the expansion is introduced as what the letters STAND FOR, and
    // the sentence goes on to deny it describes the geometry.
    expect(enHint).toMatch(/stands for/i)
    expect(enHint).toMatch(/thinner/i)
    // Japanese: 「の略ですが」 — an explicit "but", followed by the thinning.
    expect(jaHint).toMatch(/の略/)
    expect(jaHint).toMatch(/細く/)
  })

  it('keeps the two caveat chips carrying their caveat as well as their name', () => {
    // The expansion is an addition to the warning, never a replacement: SAS and
    // SES both stay in SURFACE_TYPES_WITH_CAVEAT and both keep a caveat string.
    for (const key of SURFACE_TYPES_WITH_CAVEAT) {
      const name = `viewer_surface_type_${key.toLowerCase()}_caveat`
      expect((en as Record<string, string>)[name]).toBeTruthy()
      expect((ja as Record<string, string>)[name]).toBeTruthy()
    }
  })
})
