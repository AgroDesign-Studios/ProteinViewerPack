import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import type { Plugin } from 'vite'

/**
 * For a single-file standalone build: put the licence of every open-source
 * package the file actually bundles INTO the file.
 *
 * The standalone file is a redistribution of those packages (React, i18next
 * and their dependencies — MIT-style licences, which require their
 * copyright and permission notice to travel with every copy). A hand-kept
 * list would drift the first time a dependency is bumped or a new import
 * pulls in another package, so the list is derived from the bundle itself:
 * every module id under `node_modules/` is mapped to its package, and that
 * installed package's own name, version, `license` field and LICENSE file are
 * read from disk.
 *
 * A package can also carry OTHER parties' notices inside its code: jsPDF's
 * build embeds ~20 `@license` comments (Adobe's BSD-3 JPEG encoder among
 * them, whose terms require the notice in binary redistributions), and the
 * minifier strips every comment from our bundle. So the legal comments of
 * each bundled module's source — `/*! … *\/` and any block naming `@license`
 * or `@preserve` — are collected as that package's `notices`.
 *
 * The data reaches the page through a virtual module whose default export is
 * a placeholder token; the token is swapped for the JSON in `generateBundle`,
 * once the bundle — and so the package list — is final. (A module cannot
 * list a bundle it is itself part of while that bundle is still being built.)
 * Must run before `inlineSingleFile()` moves the chunk into the HTML. A build
 * that loads the virtual module but whose output lost the token fails, so the
 * licences can never silently go missing from a file that still bundles the
 * packages.
 */
export const LICENSES_MODULE_ID = 'virtual:gantt-third-party-licenses'
const RESOLVED_ID = `\0${LICENSES_MODULE_ID}`
/** Replaced in the emitted chunk; quoted, so the minifier keeps it whole. */
export const LICENSES_TOKEN = '__AGDB_GANTT_THIRD_PARTY_LICENSES__'

export interface BundledPackage {
  name: string
  version: string
  license: string
  text: string
  /** legal comments found in the bundled source files, deduplicated */
  notices: string[]
}

const LICENSE_FILE = /^(licen[cs]e|copying)(\.(md|txt|markdown))?$/i

/**
 * The package directory a module id lives in — the path up to and including
 * the package name after the LAST `node_modules` (a nested copy is its own
 * package) — or null for a module outside node_modules. Query strings and
 * Rollup's `\0` virtual prefix are ignored.
 */
export function packageDirOf(id: string): string | null {
  const path = id.replace(/^\0/, '').split('?')[0]
  const marker = `${sep}node_modules${sep}`
  const norm = sep === '/' ? path : path.replace(/\//g, sep)
  const at = norm.lastIndexOf(marker)
  if (at < 0) return null
  const rest = norm.slice(at + marker.length).split(sep)
  const nameParts = rest[0]?.startsWith('@') ? rest.slice(0, 2) : rest.slice(0, 1)
  if (nameParts.length === 0 || nameParts.some(p => p === '')) return null
  return norm.slice(0, at + marker.length) + nameParts.join(sep)
}

/** Read one installed package's licence record, or null when it has no package.json. */
export function readPackage(dir: string): BundledPackage | null {
  const pkgPath = join(dir, 'package.json')
  if (!existsSync(pkgPath)) return null
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
    name?: unknown
    version?: unknown
    license?: unknown
  }
  const file = readdirSync(dir).find(f => LICENSE_FILE.test(f))
  return {
    name: typeof pkg.name === 'string' ? pkg.name : dirname(pkgPath).split(sep).pop() ?? '',
    version: typeof pkg.version === 'string' ? pkg.version : '',
    license: typeof pkg.license === 'string' ? pkg.license : '',
    text: file ? readFileSync(join(dir, file), 'utf8').trim() : '',
    notices: [],
  }
}

/**
 * Words after which a `/` starts a regular expression rather than a division
 * (`return /x/`), like after an operator or an opening bracket.
 */
const REGEX_AFTER_WORD = new Set([
  'return',
  'typeof',
  'instanceof',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'throw',
  'case',
  'do',
  'else',
  'yield',
  'await',
])

/** The index just past a quoted string starting at `i` (it ends at its quote,
 *  or at a line end, where an unclosed string stops). */
function stringEnd(src: string, i: number): number {
  const quote = src[i]
  let j = i + 1
  while (j < src.length) {
    const c = src[j]
    if (c === '\\') j += 2
    else if (c === quote) return j + 1
    else if (c === '\n') return j
    else j += 1
  }
  return src.length
}

/** The index just past a regular-expression literal starting at `i`, or -1
 *  when none closes on its line (it was a division after all). */
function regexEnd(src: string, i: number): number {
  let inClass = false
  let j = i + 1
  while (j < src.length) {
    const c = src[j]
    if (c === '\n') return -1
    if (c === '\\') j += 2
    else {
      if (c === '[') inClass = true
      else if (c === ']') inClass = false
      else if (c === '/' && !inClass) return j + 1
      j += 1
    }
  }
  return -1
}

/**
 * The block comments of a script, in source order. Code is walked as code:
 * string, template and regular-expression literals are stepped over, so text
 * like `"/*"` or `/[/*]/` in them is never read as the start of a comment
 * (matching `/*…*\/` over the raw text took such a literal, the code after it
 * and the next real comment as one "comment", PT-2223). A `/` opens a
 * regular expression where a value is expected — after an operator, an
 * opening bracket or a word such as `return` — the usual heuristic, which
 * is a guess: after `)` a `/` is read as a division, so `if (a) /"/.test(b)`
 * walks the pattern as code, and the quote (or backtick) in it then swallows
 * code up to wherever a matching one stands — a real comment there included.
 * (After `++` / `--` a `/` is always a division, so that case is exact.)
 * A misread can hide any comment after it, so collectPackages checks the walk
 * against a plain scan (unreadNotices) and fails the build when they differ.
 */
export function blockComments(src: string): string[] {
  const out: string[] = []
  // Open template literals: the brace depth at which each `${` began.
  const templates: number[] = []
  let depth = 0
  // The last significant character, and the last word (kept across the
  // spaces after it): does a `/` here start a regex?
  let prev = ''
  let word = ''
  let inWord = false
  // How many `+` (or `-`) stand in a row, with no space between, at the last
  // one read: when prev is that sign, an even run ends in `++` / `--`, after
  // which a `/` can only divide (a prefix `++` cannot take a regex).
  let signRun = 0
  let i = 0
  const scanTemplate = () => {
    // Inside a template's text, from i: up to its closing backtick or `${`.
    while (i < src.length) {
      const c = src[i]
      if (c === '\\') i += 2
      else if (c === '`') {
        i += 1
        prev = ')'
        return
      } else if (c === '$' && src[i + 1] === '{') {
        i += 2
        templates.push(depth)
        depth += 1
        prev = '('
        return
      } else i += 1
    }
  }
  while (i < src.length) {
    const c = src[i]
    const next = src[i + 1]
    if (c === '/' && next === '*') {
      // An unclosed comment runs to the end and is no comment to collect.
      const end = src.indexOf('*/', i + 2)
      if (end < 0) break
      out.push(src.slice(i, end + 2))
      i = end + 2
      inWord = false
      continue
    }
    if (c === '/' && next === '/') {
      const end = src.indexOf('\n', i)
      i = end < 0 ? src.length : end
      inWord = false
      continue
    }
    if (/\s/.test(c)) {
      i += 1
      inWord = false
      continue
    }
    if (/[\w$]/.test(c)) {
      word = inWord ? word + c : c
      inWord = true
      prev = c
      i += 1
      continue
    }
    // Any other character ends the word; the regex check reads it first.
    const lastWord = word
    word = ''
    inWord = false
    if (c === '"' || c === "'") {
      i = stringEnd(src, i)
      prev = ')'
      continue
    }
    if (c === '`') {
      i += 1
      scanTemplate()
      continue
    }
    if (c === '+' || c === '-') signRun = src[i - 1] === c ? signRun + 1 : 1
    if (c === '/') {
      const postfix = (prev === '+' || prev === '-') && signRun % 2 === 0
      const valueExpected =
        !postfix &&
        (prev === '' || /[(,=:[!&|?{};+\-*%<>~^]/.test(prev) || REGEX_AFTER_WORD.has(lastWord))
      const end = valueExpected ? regexEnd(src, i) : -1
      if (end > 0) {
        i = end
        prev = ')'
      } else {
        i += 1
        prev = '/'
      }
      continue
    }
    if (c === '{') depth += 1
    else if (c === '}') {
      depth -= 1
      if (templates.length > 0 && templates[templates.length - 1] === depth) {
        // The `}` closing a template's `${`: back into its text.
        templates.pop()
        i += 1
        scanTemplate()
        continue
      }
    }
    prev = c
    i += 1
  }
  return out
}

/**
 * The legal comments of one source text: block comments that open with `/*!`
 * or mention `@license` / `@preserve` — the conventions minifiers themselves
 * use for "keep this". Trimmed, in source order.
 */
export function legalComments(source: string): string[] {
  return blockComments(source).filter(isLegal).map(c => c.trim())
}

function isLegal(comment: string): boolean {
  return comment.startsWith('/*!') || /@license|@preserve/.test(comment)
}

/**
 * The legal comments a plain `/*…*\/` scan of `source` finds and
 * legalComments does not (PT-4094). Empty for every bundled source today; a
 * non-empty answer means one of the two misread the text — the walk a
 * regex after `)` (blockComments), or the plain scan a comment-like literal —
 * and only a person can tell which, so the build stops on it rather than
 * ship a file that may be missing a notice.
 */
export function unreadNotices(source: string): string[] {
  const read = new Set(legalComments(source))
  return Array.from(source.matchAll(/\/\*[\s\S]*?\*\//g), m => m[0])
    .filter(isLegal)
    .map(c => c.trim())
    .filter(c => !read.has(c))
}

/** A module id as a file path on disk (Rollup's `\0` prefix and queries removed). */
function idPath(id: string): string {
  return id.replace(/^\0/, '').split('?')[0]
}

/**
 * The packages behind a set of module ids, deduplicated, sorted by name.
 * Throws — failing the build — when a module's notices cannot be read for
 * sure (unreadNotices).
 */
export function collectPackages(moduleIds: Iterable<string>): BundledPackage[] {
  const filesByDir = new Map<string, string[]>()
  for (const id of moduleIds) {
    const dir = packageDirOf(id)
    if (dir === null) continue
    const files = filesByDir.get(dir) ?? []
    files.push(idPath(id))
    filesByDir.set(dir, files)
  }
  const byKey = new Map<string, BundledPackage>()
  for (const [dir, files] of filesByDir) {
    const pkg = readPackage(dir)
    if (!pkg) continue
    const notices = new Set<string>()
    for (const file of files) {
      if (!existsSync(file)) continue
      const source = readFileSync(file, 'utf8')
      const unread = unreadNotices(source)
      if (unread.length > 0) {
        throw new Error(
          `${file}: a plain scan finds ${unread.length} legal comment(s) the code walk does not, ` +
            `so its notices may be incomplete; first: ${unread[0].slice(0, 200)}`,
        )
      }
      for (const c of legalComments(source)) notices.add(c)
    }
    const key = `${pkg.name}@${pkg.version}`
    const prior = byKey.get(key)
    const merged = new Set([...(prior?.notices ?? []), ...notices])
    byKey.set(key, { ...pkg, notices: Array.from(merged) })
  }
  return Array.from(byKey.values()).sort((a, b) =>
    a.name === b.name ? a.version.localeCompare(b.version) : a.name.localeCompare(b.name),
  )
}

/**
 * A JS string literal holding `packages` as JSON. `<` is escaped so no licence
 * text can open `<!--` or close `</script` once the chunk is inlined into the
 * HTML (inlineSingleFile fails the build on the former).
 */
export function licensesLiteral(packages: readonly BundledPackage[]): string {
  return JSON.stringify(JSON.stringify(packages)).replace(/</g, '\\u003c')
}

export function ganttLicenses(): Plugin {
  let loaded = false
  return {
    name: 'agdb-gantt-licenses',
    resolveId(id) {
      return id === LICENSES_MODULE_ID ? RESOLVED_ID : null
    },
    load(id) {
      if (id !== RESOLVED_ID) return null
      loaded = true
      return `export default ${JSON.stringify(LICENSES_TOKEN)}`
    },
    generateBundle(_options, bundle) {
      if (!loaded) return
      const ids = new Set<string>()
      for (const chunk of Object.values(bundle)) {
        if (chunk.type === 'chunk') for (const id of Object.keys(chunk.modules)) ids.add(id)
      }
      const literal = licensesLiteral(collectPackages(ids))
      const token = new RegExp(`(["'\`])${LICENSES_TOKEN}\\1`, 'g')
      let replaced = 0
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue
        chunk.code = chunk.code.replace(token, () => {
          replaced += 1
          return literal
        })
      }
      if (replaced === 0) {
        this.error(`${LICENSES_MODULE_ID} was bundled but its placeholder is gone from the output`)
      }
    },
  }
}
