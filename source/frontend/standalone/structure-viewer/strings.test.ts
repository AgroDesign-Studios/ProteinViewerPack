/**
 * The offline file carries only the text its components use
 * (`stringFilters.ts`), and every key they name survives the filter and
 * exists in both languages — a key cut by the filter would render as its own
 * name in a handed-out file.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { pickStrings } from '../../vite-plugins/gantt-strings-only'
import { entryGraph } from './entryGraph'
import { PYMOL_WORDS, STANDALONE_NAMESPACES } from './i18n'
import { STRUCTURE_VIEWER_STRING_FILTERS } from './stringFilters'

const ROOT = join(__dirname, '..', '..')
const LOCALES = join(ROOT, 'src', 'i18n', 'locales')
/**
 * The viewer's published source carries each namespace already cut to what
 * the filter keeps (PT-9911; its manifest sits above frontend/). There the
 * check below is that the filter would cut nothing more; before the cut, that
 * it cuts the whole namespace down.
 */
const EXTRACTED = existsSync(join(ROOT, '..', 'EXTRACT.json'))
const load = (lang: string, ns: string) => JSON.parse(readFileSync(join(LOCALES, lang, `${ns}.json`), 'utf8')) as Record<string, unknown>
const NS = STANDALONE_NAMESPACES.join('|')
/** `'ns:key'` literals, and `ns:prefix_${…}` template heads (a key built at run time). */
const LITERAL = new RegExp(`['"\`](${NS}):([A-Za-z0-9_.-]+)(\\$\\{)?`, 'g')
const PLURAL = /_(zero|one|two|few|many|other)$/

const graph = entryGraph(ROOT)
const used = new Map<string, Set<string>>()
const dynamic = new Map<string, Set<string>>()
for (const f of graph.files) {
  for (const m of readFileSync(f, 'utf8').matchAll(LITERAL)) {
    const into = m[3] ? dynamic : used
    if (!into.has(m[1])) into.set(m[1], new Set())
    into.get(m[1])!.add(m[2])
  }
}

describe('the offline file’s strings', () => {
  it('has a filter for every namespace it loads, and for no other', () => {
    expect([...STRUCTURE_VIEWER_STRING_FILTERS.keys()].sort()).toEqual([...STANDALONE_NAMESPACES].sort())
    expect(() => pickStrings(STRUCTURE_VIEWER_STRING_FILTERS, 'tools', { a: 'b' }, 'structure viewer')).toThrow(/not allowed/)
  })

  it.each(['en', 'ja'])('keeps every key the bundled components name (%s)', lang => {
    for (const [ns, keys] of used) {
      const kept = pickStrings(STRUCTURE_VIEWER_STRING_FILTERS, ns, load(lang, ns))
      // A key used with a count ships as its plural forms (`busy_queued_one`, …).
      const keptKeys = new Set([...Object.keys(kept), ...Object.keys(kept).map(k => k.replace(PLURAL, ''))])
      for (const key of keys) expect(keptKeys.has(key), `${lang} ${ns}:${key}`).toBe(true)
    }
    for (const [ns, heads] of dynamic) {
      const kept = Object.keys(pickStrings(STRUCTURE_VIEWER_STRING_FILTERS, ns, load(lang, ns)))
      for (const head of heads) expect(kept.some(k => k.startsWith(head)), `${lang} ${ns}:${head}…`).toBe(true)
    }
  })

  it('carries a small part of the big namespaces, not all of them', () => {
    for (const ns of ['common', 'proteindb', 'pymol']) {
      const all = load('en', ns)
      const kept = pickStrings(STRUCTURE_VIEWER_STRING_FILTERS, ns, all)
      if (EXTRACTED) expect(kept, ns).toEqual(all)
      else expect(Object.keys(kept).length, ns).toBeLessThan(Object.keys(all).length)
    }
    // Words of features this file does not have never travel (no `session_` key).
    const pymol = pickStrings(STRUCTURE_VIEWER_STRING_FILTERS, 'pymol', load('en', 'pymol'))
    expect(Object.keys(pymol).filter(k => k.startsWith('session_'))).toEqual([])
  })

  // Owner 2026-11-17: PyMOL's name only as its licence allows — Includes
  // PyMOL™, Based on PyMOL™ technology, Contains PyMOL™ source code, Built
  // using PyMOL™. The app's own words call the engine "Includes PyMOL™" mode
  // (owner 2026-11-18; the Heavy viewer before); PyMOL™ is left only where
  // the words name PyMOL itself: the licence's heading and
  // repository link, and desktop PyMOL™, the program a .pse is for. The
  // citation's lead-in uses "Built using PyMOL™" (owner 2026-11-17); the
  // citation itself (`PYMOL_CITATION`) is Schrödinger's own form, not one of
  // these strings.
  it.each(['en', 'ja'])('names PyMOL in its own words only as the licence allows (%s)', lang => {
    const ALLOWED = /Includes PyMOL™|Based on PyMOL™ technology|Contains PyMOL™ source code|Built using PyMOL™/g
    const NAMES_PYMOL: Readonly<Record<string, RegExp>> = {
      sa_lic_pymol: /^Open-Source PyMOL™/,
      sa_lic_pymol_github: /^Open-Source PyMOL™ \(GitHub\)$/,
      sa_export_pse_note: /(desktop|デスクトップ版) PyMOL™/,
      sa_app_state_pse_hint: /(desktop|パソコン版の) PyMOL™/,
      // 「改良点」 names the upstream program the mode is built from (owner 2026-11-18), as the licence's heading does.
      sa_chg_intro: /Open-Source PyMOL(?!™)/,
    }
    const words = load(lang, 'htmlExport')
    for (const key of used.get('htmlExport') ?? []) {
      const text = String(words[key] ?? '')
      const named = NAMES_PYMOL[key]
      const rest = (named ? text.replace(named, '') : text).replace(ALLOWED, '')
      expect(rest, `${lang} htmlExport:${key}`).not.toMatch(/PyMOL/)
      if (named) expect(text, `${lang} htmlExport:${key}`).toMatch(named)
    }
    // The citation's lead-in: the licence's form, kept in English in ja too,
    // and no version (the citation's "Version 3.2" carries it).
    expect(String(words.sa_cite_pymol_ask)).toMatch(/^"Includes PyMOL™" (mode|モード)(: |：)Built using PyMOL™\. /)
    expect(String(words.sa_cite_pymol_ask)).not.toMatch(/\d|\{\{/)
  })

  // The same rule for the `pymol` strings of AgDB's shared PyMOL components
  // the file ships (PT-9630): `PYMOL_WORDS` lays this file's words over the
  // ones that name PyMOL bare. Left bare: the key table's column heads, which
  // name PyMOL's own keys and commands; and desktop PyMOL™, the program a
  // .pse opens in.
  it.each(['en', 'ja'] as const)('names PyMOL in the shared PyMOL components only as the licence allows (%s)', lang => {
    const ALLOWED = /Includes PyMOL™|Based on PyMOL™ technology|Contains PyMOL™ source code|Built using PyMOL™/g
    const DESKTOP = /([Dd]esktop|デスクトップ版の) PyMOL™/g
    const PYMOL_OWN = new Set(['keys_col_pymol', 'keys_col_command'])
    const base = load(lang, 'pymol')
    const shipped = pickStrings(STRUCTURE_VIEWER_STRING_FILTERS, 'pymol', { ...base, ...PYMOL_WORDS[lang] })
    for (const [key, value] of Object.entries(shipped)) {
      if (PYMOL_OWN.has(key)) continue
      const rest = String(value).replace(DESKTOP, '').replace(ALLOWED, '')
      expect(rest, `${lang} pymol:${key}`).not.toMatch(/PyMOL/)
    }
    // Every overlay key is a shipped `pymol` key with the same placeholders.
    const holes = (s: unknown) => [...String(s).matchAll(/\{\{\s*(\w+)/g)].map(m => m[1]).sort()
    for (const [key, value] of Object.entries(PYMOL_WORDS[lang])) {
      expect(key in base, `${lang} pymol:${key} is not a pymol key`).toBe(true)
      expect(STRUCTURE_VIEWER_STRING_FILTERS.get('pymol')!(key), `${lang} pymol:${key} does not ship`).toBe(true)
      expect(holes(value), `${lang} pymol:${key}`).toEqual(holes(base[key]))
    }
    // AgDB's own page keeps its words: the overlay is this file's only.
    expect(String(base.settings_title)).toMatch(/PyMOL/)
  })

  it('rewords the same shared PyMOL strings in both languages', () => {
    expect(Object.keys(PYMOL_WORDS.ja).sort()).toEqual(Object.keys(PYMOL_WORDS.en).sort())
  })

  it('names this file’s own words the same in both languages', () => {
    const en = Object.keys(load('en', 'htmlExport')).filter(k => k.startsWith('sa_')).sort()
    const ja = Object.keys(load('ja', 'htmlExport')).filter(k => k.startsWith('sa_')).sort()
    expect(ja).toEqual(en)
    for (const k of en) expect(used.get('htmlExport')?.has(k), `htmlExport:${k} is not used`).toBe(true)
  })
})
