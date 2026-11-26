import postcss, { type AtRule, type Container, type Node, type Rule } from 'postcss'
import type { Plugin } from 'vite'

/**
 * For a single-file standalone build: drop the CSS rules the bundle can
 * never match (PT-2204).
 *
 * The standalone entry imports `src/index.css` whole, a shared design system
 * most of which styles elements the bundle never renders. This plugin keeps
 * one stylesheet source (no fork) and removes, from the built CSS only, every
 * rule whose selectors all name a class the bundle never mentions.
 *
 * "Mentions" is decided on the built JS + HTML text, and errs toward keeping:
 *   - a class is used when it appears there as a whole token (`gantt-grid`,
 *     `active`), or when a token that could begin it does: any token right
 *     before a template slot (`gantt-row${sel ? '-sel' : ''}`, `bar${x}` for
 *     `barActive`), or one ending in `-` right before a quote
 *     (`"gantt-weekend-"+d`). The same goes for a custom property the code
 *     names (`--gantt-day`, `--gantt-${k}`). A token of dashes alone (`-${x}`),
 *     a single character (`b${i}`, `${w}x${h}`) and an escape (`\n${`) begin
 *     nothing. So a name built at run time must start with such a
 *     literal — one assembled from bare variables alone would be pruned;
 *   - tokens are ASCII words (`[A-Za-z0-9_-]+`), so a name holding any other
 *     character once unescaped (`md:flex`, `w-1/2`, `w-0.5`, `ガント`) can
 *     never be looked up whole; it always counts as used (PT-4072);
 *   - selectors are read token by token, so a `.` inside an attribute value
 *     or a string (`a[href$=".pdf"]`) is no class. A class inside `:not()` or
 *     `:nth-child(… of …)` is never required (it can only narrow a match);
 *     `:is()` / `:where()` / `:has()` need one used alternative, and lose the
 *     unused ones — unless that would lower the selector's specificity;
 *   - a selector without classes (`:root`, `html`, `[hidden]`) always stays,
 *     and so do `@keyframes` still named by a kept rule (directly or through a
 *     custom property, `animation: var(--spin)`) or by the code, and the
 *     layer order an emptied `@layer x {}` declared (kept as `@layer x;`).
 */

const WORD = /[A-Za-z0-9_-]+/g
/** A character no WORD token holds. */
const NOT_WORD = /[^A-Za-z0-9_-]/

export interface ClassUsage {
  (cls: string): boolean
}

/** Index `code` once; the returned predicate answers "might this class (or custom property) be used?". */
export function classUsage(code: string): ClassUsage {
  const words = new Set<string>()
  const prefixes = new Set<string>()
  for (const m of code.matchAll(WORD)) {
    const word = m[0]
    words.add(word)
    const end = (m.index ?? 0) + word.length
    const next = code.slice(end, end + 2)
    if (/^-+$/.test(word)) continue
    // An escape (`\n${` in a template literal) is no token, and a single
    // character before a slot (`b${i}`, `${w}x${h}`) is a key or a format,
    // not a class family: as a prefix it would keep every class starting
    // with that letter (PT-11072).
    if (code[(m.index ?? 0) - 1] === '\\' || word.length < 2) continue
    if (next === '${' || (word.endsWith('-') && /^["'`]/.test(next))) prefixes.add(word)
  }
  const cache = new Map<string, boolean>()
  return name => {
    let hit = cache.get(name)
    if (hit === undefined) {
      // No token can spell a name holding a non-word character: keep it.
      hit = NOT_WORD.test(name) || words.has(name)
      for (let i = 1; !hit && i < name.length; i++) hit = prefixes.has(name.slice(0, i))
      cache.set(name, hit)
    }
    return hit
  }
}

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

type Specificity = readonly [number, number, number]

const ZERO: Specificity = [0, 0, 0]
const ONE_CLASS: Specificity = [0, 1, 0]

function plus(a: Specificity, b: Specificity): Specificity {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

function compare(a: Specificity, b: Specificity): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
}

function highest(list: Specificity[]): Specificity {
  return list.reduce((best, s) => (compare(s, best) > 0 ? s : best), ZERO)
}

/**
 * Pseudo-classes that match only when one of their argument selectors does,
 * by what they weigh: their most specific argument, nothing, or one class.
 */
const MATCHES_IF_ANY = new Map<string, 'highest' | 'zero' | 'one'>([
  ['is', 'highest'],
  ['matches', 'highest'],
  ['has', 'highest'],
  ['where', 'zero'],
  ['-webkit-any', 'one'],
  ['-moz-any', 'one'],
])

/** Pseudo-elements that may be written with one colon; they weigh as a type. */
const LEGACY_PSEUDO_ELEMENTS = new Set(['before', 'after', 'first-line', 'first-letter'])

const IDENT_CHAR = /[\w -￿-]/

/** End of the identifier (escapes included) that starts at `i`. */
function identEnd(s: string, i: number): number {
  while (i < s.length) {
    if (s[i] === '\\') {
      const hex = /^[0-9a-fA-F]{1,6}\s?/.exec(s.slice(i + 1, i + 8))
      i += 1 + (hex ? hex[0].length : 1)
    } else if (IDENT_CHAR.test(s[i])) {
      i += 1
    } else {
      break
    }
  }
  return Math.min(i, s.length)
}

function unescapeIdent(raw: string): string {
  return raw.replace(/\\([0-9a-fA-F]{1,6})\s?|\\([\s\S])/g, (_m, hex: string | undefined, ch: string | undefined) =>
    hex ? String.fromCodePoint(Math.min(parseInt(hex, 16), 0x10ffff) || 0xfffd) : (ch ?? ''),
  )
}

/**
 * End (one past) of the string, `[…]` or `(…)` that opens at `i`. Strings and
 * escapes inside are skipped, and so are the blocks nested in a `(…)`.
 */
function blockEnd(s: string, i: number): number {
  const open = s[i]
  if (open === '"' || open === "'") {
    let j = i + 1
    while (j < s.length && s[j] !== open) j += s[j] === '\\' ? 2 : 1
    return Math.min(j + 1, s.length)
  }
  const close = open === '[' ? ']' : ')'
  let j = i + 1
  while (j < s.length && s[j] !== close) {
    if (s[j] === '\\') j += 2
    else if (s[j] === '"' || s[j] === "'" || (open === '(' && (s[j] === '(' || s[j] === '['))) j = blockEnd(s, j)
    else j += 1
  }
  return Math.min(j + 1, s.length)
}

/** Split at the commas that are not inside parentheses, brackets or strings. */
function splitTopLevel(list: string): string[] {
  const parts: string[] = []
  let start = 0
  let i = 0
  while (i < list.length) {
    const ch = list[i]
    if (ch === '\\') i += 2
    else if (ch === '"' || ch === "'" || ch === '(' || ch === '[') i = blockEnd(list, i)
    else {
      if (ch === ',') {
        parts.push(list.slice(start, i))
        start = i + 1
      }
      i += 1
    }
  }
  parts.push(list.slice(start))
  return parts
}

const EVERY_CLASS: ClassUsage = () => true

interface Walked {
  text: string
  specificity: Specificity
}

/**
 * `selector` as it stays, or null when no element of the bundle can match
 * it: a class outside every functional pseudo-class is unused, or no
 * alternative of an `:is()`-like argument can match. The text is copied as
 * written but for the unused alternatives dropped from those arguments.
 */
function walkSelector(s: string, used: ClassUsage): Walked | null {
  let text = ''
  let spec: Specificity = ZERO
  let i = 0
  while (i < s.length) {
    const ch = s[i]
    if (ch === '.' || ch === '#') {
      const end = identEnd(s, i + 1)
      const raw = s.slice(i + 1, end)
      if (ch === '.' && raw !== '' && !used(unescapeIdent(raw))) return null
      spec = plus(spec, ch === '#' ? [1, 0, 0] : ONE_CLASS)
      text += s.slice(i, end)
      i = end
    } else if (ch === '[' || ch === '"' || ch === "'") {
      const end = blockEnd(s, i)
      if (ch === '[') spec = plus(spec, ONE_CLASS)
      text += s.slice(i, end)
      i = end
    } else if (ch === ':') {
      const element = s[i + 1] === ':'
      const nameStart = i + (element ? 2 : 1)
      const nameEnd = identEnd(s, nameStart)
      const name = s.slice(nameStart, nameEnd).toLowerCase()
      if (s[nameEnd] !== '(') {
        spec = plus(spec, element || LEGACY_PSEUDO_ELEMENTS.has(name) ? [0, 0, 1] : ONE_CLASS)
        text += s.slice(i, nameEnd)
        i = nameEnd
        continue
      }
      const end = blockEnd(s, nameEnd)
      const arg = s.slice(nameEnd + 1, end - 1)
      const weigh = MATCHES_IF_ANY.get(name)
      if (element || !weigh) {
        // ::slotted(), :not(), :nth-child(… of …), :lang() …: nothing in the
        // argument is required, so it is copied as written.
        spec = plus(spec, element ? [0, 0, 1] : argumentWeight(name, arg))
        text += s.slice(i, end)
        i = end
        continue
      }
      const alternatives = splitTopLevel(arg)
      const walked = alternatives.map(alt => walkSelector(alt, used))
      const kept = walked.filter((w): w is Walked => w !== null)
      if (kept.length === 0) return null
      const all = highest(alternatives.map(specificityOf))
      let keptArg = arg
      if (walked.some((w, n) => w?.text !== alternatives[n])) {
        // Dropping the most specific alternative of :is() / :has() would
        // change which rule wins; keep the argument whole then.
        const lowers = weigh === 'highest' && compare(highest(kept.map(w => w.specificity)), all) < 0
        if (!lowers) keptArg = kept.map(w => w.text.trim()).join(',')
      }
      spec = plus(spec, weigh === 'highest' ? all : weigh === 'one' ? ONE_CLASS : ZERO)
      text += `${s.slice(i, nameEnd)}(${keptArg})`
      i = end
    } else if (ch === '\\' || /[A-Za-z_ -￿-]/.test(ch)) {
      // A type selector, or the namespace prefix of one (`svg|a`).
      const end = identEnd(s, i)
      if (s[end] !== '|') spec = plus(spec, [0, 0, 1])
      text += s.slice(i, end)
      i = end
    } else {
      text += ch
      i += 1
    }
  }
  return { text, specificity: spec }
}

function specificityOf(selector: string): Specificity {
  return walkSelector(selector, EVERY_CLASS)?.specificity ?? ZERO
}

/** What a functional pseudo-class outside MATCHES_IF_ANY weighs. */
function argumentWeight(name: string, arg: string): Specificity {
  if (name === 'not') return highest(splitTopLevel(arg).map(specificityOf))
  const of = /^nth-(last-)?child$/.test(name) ? /\sof\s/i.exec(arg) : null
  if (of) return plus(ONE_CLASS, highest(splitTopLevel(arg.slice(of.index + of[0].length)).map(specificityOf)))
  return ONE_CLASS
}

/** `selector` without its unused alternatives, or null when no element of the bundle can match it. */
export function pruneSelector(selector: string, used: ClassUsage): string | null {
  return walkSelector(selector, used)?.text ?? null
}

// ---------------------------------------------------------------------------
// Stylesheet
// ---------------------------------------------------------------------------

function isKeyframes(node: Node | undefined): boolean {
  return node?.type === 'atrule' && /keyframes$/i.test((node as AtRule).name)
}

/** Remove the at-rules and rules a pass left without content, innermost first. */
function dropEmpty(container: Container): void {
  container.each(node => {
    if ((node.type !== 'atrule' && node.type !== 'rule') || !node.nodes) return
    dropEmpty(node)
    if (node.nodes.length > 0) return
    // `@layer x {}` still puts layer x in the cascade order, empty or not.
    if (node.type === 'atrule' && node.name.toLowerCase() === 'layer' && node.params.trim() !== '') {
      node.replaceWith(postcss.atRule({ name: node.name, params: node.params }))
    } else {
      node.remove()
    }
  })
}

const VAR_REF = /var\(\s*(--[\w-]+)/g

function varRefs(value: string): string[] {
  return [...value.matchAll(VAR_REF)].map(m => m[1])
}

/** `@keyframes "spin"` is named `spin`. */
function unquote(name: string): string {
  return name.trim().replace(/^(["'])(.*)\1$/s, '$2')
}

/** `css` without the rules `used` says no element of the bundle can match. */
export function pruneCss(css: string, used: ClassUsage): string {
  const root = postcss.parse(css)
  root.walkRules((rule: Rule) => {
    if (isKeyframes(rule.parent)) return
    const selectors = rule.selectors
    const kept = selectors.map(s => pruneSelector(s, used)).filter((s): s is string => s !== null)
    if (kept.length === 0) rule.remove()
    else if (kept.length !== selectors.length || kept.some((s, n) => s !== selectors[n])) rule.selectors = kept
  })
  dropEmpty(root)

  // Keyframes that no kept rule (nor the code) names any more. A rule may
  // name one through a custom property (`animation: var(--spin)`), and so may
  // the code through a custom property it names.
  const values = new Map<string, string[]>()
  root.walkDecls(/^--/, decl => {
    values.set(decl.prop, [...(values.get(decl.prop) ?? []), decl.value])
  })
  const naming: string[] = []
  root.walkDecls(/^animation(-name)?$/i, decl => {
    if (!isKeyframes(decl.parent?.parent)) naming.push(decl.value)
  })
  for (const [prop, given] of values) if (used(prop)) naming.push(...given)
  const followed = new Set<string>()
  for (let n = 0; n < naming.length; n++) {
    for (const ref of varRefs(naming[n])) {
      if (followed.has(ref)) continue
      followed.add(ref)
      naming.push(...(values.get(ref) ?? []))
    }
  }
  const named = new Set(naming.flatMap(v => [...v.matchAll(WORD)].map(m => m[0])))
  root.walkAtRules(/keyframes$/i, at => {
    const name = unquote(at.params)
    if (!named.has(name) && !used(name)) at.remove()
  })

  // Custom properties (the :root tokens) that nothing left reads. A token
  // read by another token stays as long as that one does; the code may also
  // read or set one by name (getComputedStyle, style.setProperty).
  const definitions = new Map<string, string[]>()
  const live = new Set<string>()
  root.walkDecls(decl => {
    const refs = varRefs(decl.value)
    if (decl.prop.startsWith('--')) {
      definitions.set(decl.prop, [...(definitions.get(decl.prop) ?? []), ...refs])
      if (used(decl.prop)) live.add(decl.prop)
    } else {
      refs.forEach(r => live.add(r))
    }
  })
  const pending = [...live]
  while (pending.length > 0) {
    for (const ref of definitions.get(pending.pop() as string) ?? []) {
      if (!live.has(ref)) {
        live.add(ref)
        pending.push(ref)
      }
    }
  }
  root.walkDecls(/^--/, decl => {
    if (!live.has(decl.prop)) decl.remove()
  })
  dropEmpty(root)
  // A statement the removals left last (`@layer x;`) still ends in ";", in
  // case anything is ever appended after it.
  if (root.last?.type === 'atrule' && !root.last.nodes) root.raws.semicolon = true
  return root.toString()
}

export function ganttCssPrune(): Plugin {
  return {
    name: 'agdb-gantt-css-prune',
    // 'post': Vite emits the CSS asset in its own generateBundle, which runs
    // before every 'post' plugin. List this one BEFORE inlineSingleFile (also
    // 'post'), which moves the CSS into the HTML.
    enforce: 'post',
    generateBundle(_options, bundle) {
      const outputs = Object.values(bundle)
      const code = outputs
        .map(o =>
          o.type === 'chunk'
            ? o.code
            : o.fileName.endsWith('.html')
              ? String(o.source)
              : '',
        )
        .join('\n')
      const used = classUsage(code)
      for (const o of outputs) {
        if (o.type !== 'asset' || !o.fileName.endsWith('.css')) continue
        const css = typeof o.source === 'string' ? o.source : Buffer.from(o.source).toString()
        o.source = pruneCss(css, used)
      }
    },
  }
}
