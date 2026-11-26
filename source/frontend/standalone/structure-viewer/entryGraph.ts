/**
 * The static import graph of the offline structure file, from its entry —
 * what the build bundles, read from the sources (tests only: the boundary
 * test and the strings test walk it). Type-only imports are skipped (erased
 * from the bundle); the build's own aliases (`STANDALONE_ALIASES`) are
 * applied; a bare specifier is a package and is recorded, not walked.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import ts from 'typescript'
import { STANDALONE_ALIASES } from './aliases'

export interface EntryGraph {
  /** Absolute paths of every source module reached. */
  files: string[]
  /** Package specifiers imported (`react`, `i18next`, …). */
  packages: string[]
}

const EXTS = ['', '.ts', '.tsx', '.js', '/index.ts', '/index.tsx']

function resolveLocal(from: string, spec: string): string | null {
  const base = resolve(dirname(from), spec.split('?')[0])
  for (const ext of EXTS) {
    const p = base + ext
    if (existsSync(p) && !p.endsWith('/')) {
      try {
        readFileSync(p)
        return p
      } catch {
        // a directory
      }
    }
  }
  return null
}

/** Value imports and re-exports of one module (not `import type` / `export type`). */
export function valueImports(file: string, text: string): string[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const out: string[] = []
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause
      const typeOnly =
        clause !== undefined &&
        (clause.isTypeOnly ||
          (clause.name === undefined &&
            clause.namedBindings !== undefined &&
            ts.isNamedImports(clause.namedBindings) &&
            clause.namedBindings.elements.length > 0 &&
            clause.namedBindings.elements.every(e => e.isTypeOnly)))
      if (!typeOnly) out.push(node.moduleSpecifier.text)
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const typeOnly =
        node.isTypeOnly ||
        (node.exportClause !== undefined && ts.isNamedExports(node.exportClause) && node.exportClause.elements.every(e => e.isTypeOnly))
      if (!typeOnly) out.push(node.moduleSpecifier.text)
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const arg = node.arguments[0]
      if (arg && ts.isStringLiteral(arg)) out.push(arg.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

export function entryGraph(frontendRoot: string): EntryGraph {
  const entry = join(frontendRoot, 'standalone', 'structure-viewer', 'main.tsx')
  const aliases = new Map(STANDALONE_ALIASES.map(a => [resolve(frontendRoot, a.find), resolve(frontendRoot, a.replacement)]))
  const seen = new Set<string>()
  const packages = new Set<string>()
  const queue = [entry]
  while (queue.length > 0) {
    const file = queue.pop()!
    if (seen.has(file)) continue
    seen.add(file)
    if (!/\.(tsx?|js)$/.test(file)) continue
    for (const spec of valueImports(file, readFileSync(file, 'utf8'))) {
      if (spec.startsWith('.') || spec.startsWith('/')) {
        // An aliased module by its path first, as the build does: the
        // published source has the stub but not the module (PT-9911).
        let target = aliases.get(resolve(dirname(file), spec.split('?')[0])) ?? resolveLocal(file, spec)
        if (target === null) throw new Error(`${file}: cannot resolve ${spec}`)
        const stripped = target.replace(/\.(tsx?|js)$/, '')
        target = aliases.get(stripped) ?? aliases.get(target) ?? target
        queue.push(target)
      } else {
        packages.add(spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0])
      }
    }
  }
  return { files: [...seen].sort(), packages: [...packages].sort() }
}
