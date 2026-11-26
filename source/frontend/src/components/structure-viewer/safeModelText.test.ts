/**
 * `safeModelText` (PT-9131): the text checks, the INSTALLED 3Dmol.js reading
 * a crafted mmCIF through it, and every `addModel` in this source going
 * through it.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  INHERITED_NAMES,
  mayReadAsSdf,
  safeModelText,
  withoutInheritedNames,
  withoutSdStyleItems,
} from './safeModelText'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let lib: any

beforeAll(async () => {
  const umd = '3dmol/build/3Dmol.js' // registers window.$3Dmol; a variable, so tsc does not look for a .d.ts
  await import(/* @vite-ignore */ umd)
  lib = (window as any).$3Dmol // eslint-disable-line @typescript-eslint/no-explicit-any
})

/** A two-atom mmCIF whose first atom has chain `chain` and residue id `residue`. */
function crafted(chain: string, residue: string): string {
  return [
    'data_poc',
    'loop_',
    '_atom_site.group_PDB',
    '_atom_site.id',
    '_atom_site.type_symbol',
    '_atom_site.label_atom_id',
    '_atom_site.label_comp_id',
    '_atom_site.label_asym_id',
    '_atom_site.label_seq_id',
    '_atom_site.auth_asym_id',
    '_atom_site.Cartn_x',
    '_atom_site.Cartn_y',
    '_atom_site.Cartn_z',
    `ATOM 1 N N GLY A ${residue} ${chain} 0.000 0.000 0.000`,
    'ATOM 2 O O GLY B 10 B 0.000 0.000 2.900',
    '',
  ].join('\n')
}

/** One V2000 record of two bonded atoms titled `title`, with a style item after its M  END. */
function sdRecord(title: string): string {
  return [
    title,
    '  RDKit          3D',
    '',
    '  2  1  0  0  0  0  0  0  0  0999 V2000',
    '    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0',
    '    1.5000    0.0000    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0',
    '  1  2  1  0',
    'M  END',
    '> <3DMOL_STYLE>',
    '{"__proto__":{"pt9223":1}}',
    '',
    '$$$$',
    '',
  ].join('\n')
}

/**
 * Parses `text` with the installed 3Dmol.js and reports what the reader left
 * on `owner[key]`, put back at once whatever happened (a test runner with no
 * `Object.keys` cannot report anything).
 */
function readAndRestore(text: string, owner: object, key: string): { after: unknown; atoms: { chain: string }[] | null } {
  // Undefined for a key `owner` only inherits: put back means deleted again.
  const saved = Object.getOwnPropertyDescriptor(owner, key)
  let after: unknown
  let atoms: { chain: string }[] | null = null
  try {
    const model = new lib.GLModel(0)
    model.addMolData(text, 'cif')
    after = (owner as Record<string, unknown>)[key]
    atoms = model.selectedAtoms({}).map((a: { chain: string }) => ({ chain: a.chain }))
  } catch {
    after = (owner as Record<string, unknown>)[key]
  } finally {
    if (saved) Object.defineProperty(owner, key, saved)
    else delete (owner as Record<string, unknown>)[key]
  }
  return { after, atoms }
}

describe('withoutInheritedNames', () => {
  it('lists every name a plain object inherits here', () => {
    const own = Object.getOwnPropertyNames(Object.prototype).filter(n => /^[A-Za-z_$][\w$]*$/.test(n))
    expect([...INHERITED_NAMES].sort()).toEqual(expect.arrayContaining(own.sort()))
  })

  it('alters each occurrence, in any case, keeping the length', () => {
    const text = "ATOM 1 N N GLY A toString __proto__ 0 0 0\n_x 'constructor'\n<VALUEOF> __PROTO__\n"
    const out = withoutInheritedNames(text)
    expect(out.length).toBe(text.length)
    expect(out).toBe("ATOM 1 N N GLY A toStrin0 __proto_0 0 0 0\n_x 'constructo0'\n<VALUEO0> __PROTO_0\n")
    for (const word of out.split(/[^A-Za-z0-9_$]+/)) {
      expect(word in {}).toBe(false)
      expect(word.toLowerCase() in {}).toBe(false)
    }
  })

  it('alters a name inside a longer word, read with a `.` as `_`, or with quotes in it (PR #8297 review)', () => {
    // A name inside a longer token, with `.` for `_`, and with quotes inside.
    const text = 'x_atom_site_auth_asym_id__proto__ xtoStringy $valueOf\n_.proto__ 1\ncon"struc"tor\n__proto__proto__\n'
    const out = withoutInheritedNames(text)
    expect(out.length).toBe(text.length)
    expect(out).toBe('x_atom_site_auth_asym_id__proto_0 xtoStrin0y $valueO0\n_.proto_0 1\ncon"struc"to0\n__proto_0proto__\n')
    const lower = out.toLowerCase()
    for (const name of INHERITED_NAMES) {
      const n = name.toLowerCase()
      expect(lower.includes(n), name).toBe(false)
      expect(lower.replace(/\./g, '_').includes(n), `${name} with . as _`).toBe(false)
      expect(lower.replace(/["']/g, '').includes(n), `${name} without quotes`).toBe(false)
    }
  })

  it('keeps other words, and a clean text itself', () => {
    const text = 'prototype foamy virus, construct, value of\n'
    expect(withoutInheritedNames(text)).toBe(text)
    const clean = readFileSync(path.join(import.meta.dirname, '../../pages/structure-html-export/__fixtures__/1crn.cif'), 'utf8')
    expect(withoutInheritedNames(clean)).toBe(clean)
  })
})

describe('withoutSdStyleItems', () => {
  it('renames every 3DMOL_STYLE, in any case, keeping every line and its length, whatever the line ends', () => {
    expect(withoutSdStyleItems('M  END\n> <3DMOL_STYLE>\n{"x":1}\n$$$$\nnext')).toBe('M  END\n> <3DMOL_STYL0>\n{"x":1}\n$$$$\nnext')
    const cr = 't\r\r\r  1  0  0  0  0  0  0  0  0  0999 V2000\rM  END\r> <3DMOL_STYLE>\r{"a":1}\r$$$$'
    expect(withoutSdStyleItems(cr)).toBe(cr.replace('3DMOL_STYLE', '3DMOL_STYL0'))
    const mixed = 'M  END\r> <A>\r> < 3dmol_style >\r{"a":1}\n> <B>\r\nv 3Dmol_Style'
    expect(withoutSdStyleItems(mixed)).toBe('M  END\r> <A>\r> < 3dmol_styl0 >\r{"a":1}\n> <B>\r\nv 3Dmol_Styl0')
    expect(withoutSdStyleItems('no item here\n')).toBe('no item here\n')
  })

  /** Reads `text` as SDF with the installed 3Dmol.js: each atom's element and whether it carries a stick style. */
  function readSd(text: string): { elem: string; stick: boolean }[] {
    const model = new lib.GLModel(0)
    model.addMolData(text, 'sdf')
    return model.selectedAtoms({}).map((a: { elem: string; style?: { stick?: unknown } }) => ({ elem: a.elem, stick: a.style?.stick !== undefined }))
  }

  it('keeps 3Dmol.js from styling from the item', () => {
    const text = sdRecord('t').replace('{"__proto__":{"pt9223":1}}', '{"stick":{"radius":0.31}}')
    // Control: the raw text first, then the same text through safeModelText.
    expect(readSd(text)).toEqual([{ elem: 'C', stick: true }, { elem: 'O', stick: true }])
    expect(readSd(safeModelText(text, 'sdf'))).toEqual([{ elem: 'C', stick: false }, { elem: 'O', stick: false }])
  })

  it('keeps every header line, a title equal to the item header or starting M  END included, in every record (PT-9223 item 1, PT-9244 item 5)', () => {
    for (const [title, second] of [
      ['> <3DMOL_STYLE>', '  RDKit          3D'],
      ['M  END', '> <3DMOL_STYLE>'],
      ['M  END  > <3DMOL_STYLE>', '> <3DMOL_STYLE>'],
    ]) {
      const one = sdRecord(title).replace('  RDKit          3D', second).replace('{"__proto__":{"pt9223":1}}', '{"stick":{"radius":0.31}}')
      const text = one + one
      const out = withoutSdStyleItems(text)
      expect(out.length, title).toBe(text.length)
      expect(out.split(/\r?\n|\r/).length, title).toBe(text.split(/\r?\n|\r/).length)
      expect(out, title).not.toMatch(/3DMOL_STYLE/i)
      // Read by the installed 3Dmol.js: both atoms of the record, unstyled.
      expect(readSd(safeModelText(text, 'sdf')), title).toEqual([{ elem: 'C', stick: false }, { elem: 'O', stick: false }])
    }
  })

  it('applies to every format 3Dmol.js may read as SDF, and to no other', () => {
    for (const f of ['sdf', 'SDF', 'mol', 'MOL', 'x.sdf', 'unknown', '']) expect(mayReadAsSdf(f), f).toBe(true)
    for (const f of ['cif', 'mcif', 'pdb', 'pdbqt', 'mol2', 'xyz', 'pqr', 'x.pdb']) expect(mayReadAsSdf(f), f).toBe(false)
    const item = 'm\n  RDKit\n\n  0  0  0  0  0  0  0  0  0  0999 V2000\nM  END\n> <3DMOL_STYLE>\n{"x":1}\n\n$$$$\n'
    expect(safeModelText(item, 'mol')).not.toContain('3DMOL_STYLE')
    expect(safeModelText(item, 'pdb')).toBe(item)
  })
})

describe('safeModelText before 3Dmol.js reads an mmCIF with inherited names', () => {
  it('leaves Object.prototype.toString as it was (chain `__proto__`)', () => {
    const text = crafted('__proto__', 'toString')
    // Control: the raw text first, then the same text through safeModelText.
    expect(typeof readAndRestore(text, Object.prototype, 'toString').after).toBe('string')
    const safe = readAndRestore(safeModelText(text, 'cif'), Object.prototype, 'toString')
    expect(safe.after).toBe(Object.prototype.toString)
    expect(safe.atoms?.map(a => a.chain)).toEqual(['__proto_0', 'B'])
  })

  it('leaves Object.keys as it was (chain `constructor`)', () => {
    const text = crafted('constructor', 'keys')
    expect(typeof readAndRestore(text, Object, 'keys').after).toBe('string')
    const safe = readAndRestore(safeModelText(text, 'cif'), Object, 'keys')
    expect(safe.after).toBe(Object.keys)
    expect(safe.atoms?.map(a => a.chain)).toEqual(['constructo0', 'B'])
  })

  it('leaves Object.prototype.toString.apply as it was (chain `toString`)', () => {
    // Checks a key on the toString function itself.
    const fn = Object.prototype.toString
    const text = crafted('toString', 'apply')
    expect(typeof readAndRestore(text, fn, 'apply').after).toBe('string')
    const safe = readAndRestore(safeModelText(text, 'cif'), fn, 'apply')
    expect(safe.after).toBe(Function.prototype.apply)
    expect(safe.atoms?.map(a => a.chain)).toEqual(['toStrin0', 'B'])
  })

  it('leaves Object.prototype.toString as it was (a chain name inside a longer token; PR #8297 review)', () => {
    // Single items, not a loop, with the chain name inside a longer token.
    const text = [
      'data_poc',
      '_atom_site.group_pdb ATOM',
      '_atom_site.group_pdb ATOM',
      '_atom_site.id 1',
      '_atom_site.id 2',
      '_atom_site.type_symbol N',
      '_atom_site.type_symbol O',
      '_atom_site.label_atom_id N',
      '_atom_site.label_atom_id O',
      '_atom_site.label_comp_id GLY',
      '_atom_site.label_comp_id GLY',
      '_Atom_site.label_seq_id x_atom_site_label_seq_idtoString',
      '_atom_site.label_seq_id 10',
      '_Atom_site.auth_asym_id x_atom_site_auth_asym_id__proto__',
      '_atom_site.auth_asym_id B',
      '_atom_site.cartn_x 0.000',
      '_atom_site.cartn_x 0.000',
      '_atom_site.cartn_y 0.000',
      '_atom_site.cartn_y 0.000',
      '_atom_site.cartn_z 0.000',
      '_atom_site.cartn_z 2.900',
      '',
    ].join('\n')
    expect(typeof readAndRestore(text, Object.prototype, 'toString').after).toBe('string')
    const safe = readAndRestore(safeModelText(text, 'cif'), Object.prototype, 'toString')
    expect(safe.after).toBe(Object.prototype.toString)
    expect(safe.atoms?.map(a => a.chain)).toEqual(['__proto_0', 'B'])
  })
})

/** Every `.ts`/`.tsx` under `dir`, tests and generated types aside. */
function sources(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name)
    if (statSync(p).isDirectory()) {
      if (name !== 'node_modules' && name !== '__mocks__' && name !== 'test') out.push(...sources(p))
    } else if (/\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name) && name !== 'openapi-generated.ts') out.push(p)
  }
  return out
}

/** 3Dmol.js's methods that read a model from text. */
const MODEL_METHODS: ReadonlySet<string> = new Set(['addModelsAsFrames', 'addModels', 'addModel', 'addAsOneMolecule'])

/** The name a property or binding is spelt with (`addModel`, `'addModel'`, `['addModel']`), or null. */
function staticName(name: ts.PropertyName | ts.BindingName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text
  if (ts.isComputedPropertyName(name) && ts.isStringLiteralLike(name.expression)) return name.expression.text
  return null
}

/**
 * Whether an object or array literal is a destructuring assignment's target
 * (`({ addModel } = v)`, `[{ addModel }] = list`, `for ({ addModel } of list)`),
 * where its properties take values OFF the right-hand side.
 */
function isDestructuringTarget(literal: ts.Node): boolean {
  let child = literal
  for (let parent = literal.parent; parent !== undefined; child = parent, parent = parent.parent) {
    if (ts.isParenthesizedExpression(parent) || ts.isArrayLiteralExpression(parent) || ts.isObjectLiteralExpression(parent)) continue
    if (ts.isSpreadElement(parent) || ts.isSpreadAssignment(parent)) continue
    // `{ inner: { addModel } }`: a nested pattern is a property's value.
    if (ts.isPropertyAssignment(parent) && parent.initializer === child) continue
    if (ts.isBinaryExpression(parent)) return parent.operatorToken.kind === ts.SyntaxKind.EqualsToken && parent.left === child
    if (ts.isForOfStatement(parent) || ts.isForInStatement(parent)) return parent.initializer === child
    return false
  }
  return false
}

/** The method a node names (`v.addModel`, `v?.addModel`, `v['addModel']`, or one destructured off a viewer), or null. */
function modelMethodOf(node: ts.Node): string | null {
  if (ts.isPropertyAccessExpression(node) && MODEL_METHODS.has(node.name.text)) return node.name.text
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression) && MODEL_METHODS.has(node.argumentExpression.text)) {
    return node.argumentExpression.text
  }
  // `const { addModel } = v`, `const { 'addModel': f } = v`: the method taken off the viewer.
  if (ts.isBindingElement(node)) {
    const name = staticName(node.propertyName ?? node.name)
    return name !== null && MODEL_METHODS.has(name) ? name : null
  }
  // `({ addModel } = v)`, `({ addModel: f } = v)`: the same, by assignment (PT-9244 item 7).
  if ((ts.isShorthandPropertyAssignment(node) || ts.isPropertyAssignment(node)) && isDestructuringTarget(node.parent)) {
    const name = staticName(node.name)
    return name !== null && MODEL_METHODS.has(name) ? name : null
  }
  return null
}

/**
 * Every use of a model method in `source`, read from its syntax tree (PT-9223
 * item 2): comments are no part of it, and spacing, `?.(`, bracket access, a
 * `.bind` / `.call` / `.apply` or the method passed on are all seen. A use is
 * bare unless it is a call whose first argument is `safeModelText(…)`, or that
 * has none.
 */
function modelMethodUses(source: string, fileName: string): { line: number; bare: boolean }[] {
  const kind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind)
  const uses: { line: number; bare: boolean }[] = []
  const visit = (node: ts.Node): void => {
    if (modelMethodOf(node) !== null) {
      const call = node.parent
      const called = ts.isCallExpression(call) && call.expression === node
      const first = called ? call.arguments[0] : undefined
      const safe =
        called &&
        (first === undefined ||
          (ts.isCallExpression(first) && ts.isIdentifier(first.expression) && first.expression.text === 'safeModelText'))
      uses.push({ line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1, bare: !safe })
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return uses
}

describe('every model 3Dmol.js reads from text', () => {
  it('is handed through safeModelText (every page in this source)', () => {
    const root = path.resolve(import.meta.dirname, '../../..')
    const bare: string[] = []
    let calls = 0
    for (const file of [...sources(path.join(root, 'src')), ...sources(path.join(root, 'standalone'))]) {
      const text = readFileSync(file, 'utf8')
      if (![...MODEL_METHODS].some(m => text.includes(m))) continue
      for (const use of modelMethodUses(text, file)) {
        calls++
        if (use.bare) bare.push(`${path.relative(root, file)}:${use.line}`)
      }
    }
    // Vacuity guard: at least two calls where EXTRACT.json sits above
    // frontend/ (PT-9911), twelve otherwise.
    expect(calls).toBeGreaterThanOrEqual(existsSync(path.join(root, '..', 'EXTRACT.json')) ? 2 : 12)
    expect(bare).toEqual([])
  })

  it('sees each shape of call the line scan missed, and passes the wrapped ones (PT-9223 item 2)', () => {
    const fixture = [
      'v.addModel(safeModelText(t, f), f)', // 1 ok
      'v.addModel()', // 2 ok
      'v?.addModel?.(safeModelText(t, f), f)', // 3 ok
      'v.addModel (t, f)', // 4
      'v?.addModel?.(t, f)', // 5
      "v['addModels'](t, f)", // 6
      'v.addModelsAsFrames.bind(v)(t, f)', // 7
      'v.addAsOneMolecule.call(v, t, f)', // 8
      'v.addModel.apply(v, [t, f])', // 9
      '/* note */ v.addModel(t, f)', // 10: code on a line starting with `/*`
      'const n = 2', // 11
      '  * v.addModel(t, f)', // 12: code on a line starting with `*`
      'const { addModel } = v', // 13
      'run(v.addModel, t)', // 14
      'v.addModel(', // 15: a call split over lines
      '  t, f)',
      // PT-9244 item 7: destructuring assignments, and a quoted binding name.
      ';({ addModel } = v)', // 17
      ';({ addModel: load = f } = v)', // 18
      ";({ 'addModels': load } = v)", // 19
      ';({ inner: { addAsOneMolecule } } = page)', // 20
      ';[{ addModel }] = [v]', // 21
      'for ({ addModelsAsFrames } of viewers) run()', // 22
      "const { 'addModelsAsFrames': frames } = v", // 23
      // Not uses: an object literal built from a name, a property named so.
      'run({ addModel })', // 24
      'const o = { addModel: f }', // 25
      'x = { inner: { addModel } }', // 26
      ';({ x: addModel } = v)', // 27: v.x into a variable
    ].join('\n')
    const uses = modelMethodUses(fixture, 'fixture.ts')
    expect(uses.filter(u => !u.bare).map(u => u.line)).toEqual([1, 2, 3])
    expect(uses.filter(u => u.bare).map(u => u.line)).toEqual([4, 5, 6, 7, 8, 9, 10, 12, 13, 14, 15, 17, 18, 19, 20, 21, 22, 23])
    // A method named only in comments or a string is no use.
    expect(modelMethodUses('/**\n * v.addModel(t, f)\n */\n// v.addModel(t)\nconst s = "v.addModel(t)"\n', 'c.ts')).toEqual([])
  })
})
