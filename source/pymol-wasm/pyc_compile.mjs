// S1-11: compile the .pyc targets with the RUNTIME's own CPython (the pinned Pyodide core
// under node), in a NEW process per kind that imports nothing of PyMOL (design
// 2026-11-16-pymol-wasm-slim §3.2 S1-11, evidence §3.11: a fresh process gives the same
// bytes run after run; one that imported pymol first, or the host CPython, does not).
//
//   node pyc_compile.mjs <pyodide-core-dir> <std|site> <archive> <pyc_targets.json> <out-dir>
//
//   std   the targets' `stdlib` list, read from <archive> = the core's python_stdlib.zip;
//         compiled WITHOUT the column table (PYTHONNODEBUGRANGES=1), co_filename
//         /lib/python3NN.zip/<member>                 -> <out-dir>/<member>c
//   site  the targets' `wheel` list, read from <archive> = the source wheel (wheel.sh);
//         compiled WITH the column table, co_filename
//         /lib/python3.N/site-packages/<member>        -> <out-dir>/<member>c
// Every .pyc: py_compile, optimize=0 (docstrings kept), PycInvalidationMode.UNCHECKED_HASH
// (PEP 552). <out-dir> must be absent or empty; it also gets _summary.json (kind, CPython
// version, magic, cache tag, dfile prefix, per-file sizes and sha256, the tree hash) which
// pyc_assemble.py checks. The runtime paths are the __file__ values the real Chrome worker
// reports (pyc_targets.json's dumps); the run fails unless the compiling interpreter has
// the same paths on sys.path and is the CPython the core's pyodide-lock.json names.
// The host shell is fenced off (bench/lib/guard_host.mjs, trap 1); no child process is
// started. Ported from the study's exp3/v11/scripts/py/mkpyc_s1.mjs.
// Exit 0 = compiled and checked; 1 = a check or the compile failed; 2 = usage / unreadable input.
import path from 'node:path';
import crypto from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { PY_HOST_BLOCK, guardHost, hostCalls } from './bench/lib/guard_host.mjs';

const USAGE = 'usage: node pyc_compile.mjs <pyodide-core-dir> <std|site> <archive> <pyc_targets.json> <out-dir>';
const KEY = { std: 'stdlib', site: 'wheel' };
const PKL = 'chempy/pkl.py';

function usage(msg) {
  console.error(`pyc_compile: ${msg}\n${USAGE}`);
  process.exit(2);
}

const args = process.argv.slice(2);
if (args.length !== 5) usage('expected 5 arguments');
const [coreDir, kind, archive, targetsPath, outDir] = args;
if (!(kind in KEY)) usage(`kind must be std or site, not ${JSON.stringify(kind)}`);
for (const f of [path.join(coreDir, 'pyodide.mjs'), path.join(coreDir, 'pyodide-lock.json'), archive, targetsPath]) {
  if (!existsSync(f)) usage(`no such file: ${f}`);
}
try {
  if (existsSync(outDir) && readdirSync(outDir).length) usage(`out dir ${outDir} is not empty (a stale .pyc would be assembled)`);
} catch (e) {
  usage(`out dir ${outDir} is not a directory: ${e.message}`);
}

let list;
let lockPython;
try {
  const t = JSON.parse(readFileSync(targetsPath, 'utf8'));
  if (t === null || typeof t !== 'object' || t.schema !== 1) throw new Error('schema is not 1');
  list = t[KEY[kind]];
  if (!Array.isArray(list) || !list.length || !list.every((x) => typeof x === 'string' && x.endsWith('.py'))) {
    throw new Error(`${KEY[kind]} is not a non-empty list of .py paths`);
  }
  if (new Set(list).size !== list.length) throw new Error(`${KEY[kind]} lists a path twice`);
  if (kind === 'site' && list.includes(PKL)) throw new Error(`${PKL} may not be compiled (patch 0006 stays source)`);
  lockPython = JSON.parse(readFileSync(path.join(coreDir, 'pyodide-lock.json'), 'utf8')).info.python;
  if (typeof lockPython !== 'string') throw new Error('pyodide-lock.json has no info.python');
} catch (e) {
  usage(`cannot read the inputs: ${e.message}`);
}

async function main() {
  guardHost();
  const indexURL = path.resolve(coreDir) + '/';
  const { loadPyodide } = await import(pathToFileURL(path.join(indexURL, 'pyodide.mjs')).href);
  // The column table is a compile-time interpreter setting: only the env at start-up sets it.
  const env = kind === 'std' ? { PYTHONNODEBUGRANGES: '1' } : {};
  const py = await loadPyodide({ indexURL, stdout: () => {}, stderr: () => {}, env });
  py.runPython(PY_HOST_BLOCK);
  py.FS.mkdirTree('/src');
  py.FS.writeFile('/src/a.zip', new Uint8Array(readFileSync(archive)));
  py.globals.set('LIST_JSON', JSON.stringify(list));
  py.globals.set('KIND', kind);
  const res = JSON.parse(py.runPython(String.raw`
import json, os, py_compile, zipfile, sys, importlib.util
lst = json.loads(LIST_JSON)
ver = sys.version_info
std_root = '/lib/python%d%d.zip' % (ver.major, ver.minor)
site_root = '/lib/python%d.%d/site-packages' % (ver.major, ver.minor)
prefix = (std_root if KIND == 'std' else site_root) + '/'
zf = zipfile.ZipFile('/src/a.zip')
names = set(zf.namelist())
missing = sorted(set(lst) - names)
if missing:
    raise ValueError('not in the archive: %r' % missing[:5])
rows = []
for n in lst:
    src = '/src/x/' + n
    os.makedirs(os.path.dirname(src), exist_ok=True)
    with open(src, 'wb') as fh:
        fh.write(zf.read(n))
    dst = '/out/' + n + 'c'
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    py_compile.compile(src, cfile=dst, dfile=prefix + n, doraise=True, optimize=0,
                       invalidation_mode=py_compile.PycInvalidationMode.UNCHECKED_HASH)
    rows.append([n, os.path.getsize(src), os.path.getsize(dst)])
def _probe():
    return 1 / 0
json.dumps({'rows': rows, 'version': '%d.%d.%d' % ver[:3], 'releaselevel': ver.releaselevel,
            'implementation': sys.implementation.name, 'cache_tag': sys.implementation.cache_tag,
            'magic': importlib.util.MAGIC_NUMBER.hex(), 'dfile_prefix': prefix,
            'root_on_sys_path': (std_root if KIND == 'std' else site_root) in sys.path,
            'no_debug_ranges_env': os.environ.get('PYTHONNODEBUGRANGES'),
            'positions_probe': [list(p) for p in _probe.__code__.co_positions()][:3],
            'pymol_imported': any(m == 'pymol' or m.startswith(('pymol.', 'chempy', 'pymol2')) for m in sys.modules),
            'modules': len(sys.modules)})
`));

  // Fail closed on everything the .pyc bytes depend on.
  const fails = [];
  if (res.implementation !== 'cpython' || res.releaselevel !== 'final') fails.push(`interpreter ${res.implementation} ${res.releaselevel}`);
  if (res.version !== lockPython) fails.push(`interpreter CPython ${res.version}, pyodide-lock.json says ${lockPython}`);
  if (!/^[0-9a-f]{4}0d0a$/.test(res.magic)) fails.push(`magic ${res.magic} is not a pyc magic`);
  const [maj, min] = res.version.split('.');
  if (res.cache_tag !== `cpython-${maj}${min}`) fails.push(`cache tag ${res.cache_tag}`);
  if (!res.root_on_sys_path) fails.push(`${res.dfile_prefix} is not on the compiling interpreter's sys.path`);
  if (res.pymol_imported) fails.push('a PyMOL module is imported in the compiling process');
  // The column table: std must have none (PYTHONNODEBUGRANGES took effect), site must have it.
  const cols = res.positions_probe.map((p) => p[2]);
  const probe = JSON.stringify(res.positions_probe);
  if (kind === 'std' && (res.no_debug_ranges_env !== '1' || cols.some((c) => c !== null))) fails.push(`std: column table not off (probe ${probe})`);
  if (kind === 'site' && (res.no_debug_ranges_env !== null || cols.some((c) => c === null))) fails.push(`site: column table not on (probe ${probe})`);
  if (res.rows.length !== list.length) fails.push(`compiled ${res.rows.length} of ${list.length}`);
  if (hostCalls.length) fails.push(`host process start attempted: ${hostCalls.slice(0, 3).join(' | ')}`);
  if (fails.length) throw new Error(fails.join('; '));

  mkdirSync(outDir, { recursive: true });
  const sums = {};
  for (const [n] of res.rows) {
    const data = py.FS.readFile('/out/' + n + 'c');
    const dst = path.join(outDir, n + 'c');
    mkdirSync(path.dirname(dst), { recursive: true });
    writeFileSync(dst, data);
    sums[n + 'c'] = crypto.createHash('sha256').update(data).digest('hex');
  }
  const tree = crypto.createHash('sha256').update(Object.keys(sums).sort().map((k) => k + ' ' + sums[k]).join('\n')).digest('hex');
  const summary = {
    tool: 'pyc_compile', kind, targets_key: KEY[kind], archive: path.basename(archive),
    archive_sha256: crypto.createHash('sha256').update(readFileSync(archive)).digest('hex'),
    lock_python: lockPython, ...res, sha256: sums, tree,
  };
  writeFileSync(path.join(outDir, '_summary.json'), JSON.stringify(summary, null, 1) + '\n');
  const pyBytes = res.rows.reduce((a, r) => a + r[1], 0);
  const pycBytes = res.rows.reduce((a, r) => a + r[2], 0);
  console.log(`pyc_compile: ${kind}: ${res.rows.length} .pyc (source ${pyBytes} B -> pyc ${pycBytes} B), `
    + `CPython ${res.version} ${res.cache_tag}, magic ${res.magic}, dfile ${res.dfile_prefix}, `
    + `column table ${kind === 'std' ? 'off' : 'on'}, tree ${tree.slice(0, 16)}`);
}

try {
  await main();
  process.exit(0);
} catch (e) {
  console.error(`pyc_compile: ${kind}: FAILED: ${String((e && e.message) || e).split('\n').slice(-4).join(' | ')}`);
  process.exit(1);
}
