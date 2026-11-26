import { readFile } from 'node:fs/promises'
import type { Plugin } from 'vite'

/**
 * For a single-file standalone build: load each
 * `src/i18n/locales/<lng>/<ns>.json` with only the listed keys per namespace
 * (PT-2200, PT-2204).
 *
 * - tools: the keys that start with `gantt_` (a prefix, so keys built at run
 *   time pass too).
 * - common: an explicit list. A new `common:` key in the standalone graph
 *   must be added to COMMON_KEYS, or it renders as its own key name.
 *
 * Fails closed: a locale file of any OTHER namespace that reaches this build
 * stops it, so a namespace imported later cannot ship whole by default.
 * `stringsOnly` takes another build's filters.
 */
const LOCALE_JSON = /[\\/]src[\\/]i18n[\\/]locales[\\/][^\\/]+[\\/]([^\\/]+)\.json$/
export const GANTT_KEY_PREFIX = 'gantt_'
export const COMMON_KEYS: ReadonlySet<string> = new Set(['ok', 'cancel', 'confirm', 'close'])

const NAMESPACE_FILTERS: NamespaceFilters = new Map([
  ['tools', (key: string) => key.startsWith(GANTT_KEY_PREFIX)],
  ['common', (key: string) => COMMON_KEYS.has(key)],
])

/** The namespaces the standalone file may carry, each filtered as above. */
export const STANDALONE_NAMESPACES: readonly string[] = [...NAMESPACE_FILTERS.keys()]

/** Each namespace a standalone file may carry, with the keys of it that it keeps. */
export type NamespaceFilters = ReadonlyMap<string, (key: string) => boolean>

/**
 * Keep the keys `namespace` may ship under `filters`; throws for a namespace
 * with no filter. `fileName` names the standalone file in the error.
 */
export function pickStrings(
  filters: NamespaceFilters,
  namespace: string,
  all: Record<string, unknown>,
  fileName = 'Gantt',
): Record<string, unknown> {
  const keep = filters.get(namespace)
  if (!keep) {
    throw new Error(
      `locale namespace "${namespace}" is not allowed in the standalone ${fileName} file; ` +
        'give it a key filter in its strings-only plugin first',
    )
  }
  return Object.fromEntries(Object.entries(all).filter(([key]) => keep(key)))
}

/** Keep the keys `namespace` may ship; throws for a namespace with no filter. */
export function pickStandaloneStrings(
  namespace: string,
  all: Record<string, unknown>,
): Record<string, unknown> {
  return pickStrings(NAMESPACE_FILTERS, namespace, all)
}

export function ganttStringsOnly(): Plugin {
  return stringsOnly('agdb-gantt-strings-only', NAMESPACE_FILTERS, 'Gantt')
}

/**
 * The generic plugin: every `src/i18n/locales/<lng>/<ns>.json` this build
 * loads keeps only the keys `filters` lets through, and a namespace with no
 * filter fails the build. The structure viewer's offline file uses it too
 * (vite.structure-viewer.config.ts).
 */
export function stringsOnly(name: string, filters: NamespaceFilters, fileName: string): Plugin {
  return {
    name,
    enforce: 'pre',
    async load(id) {
      const file = id.split('?')[0]
      const match = LOCALE_JSON.exec(file)
      if (!match) return null
      const all = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
      return JSON.stringify(pickStrings(filters, match[1], all, fileName))
    },
  }
}
