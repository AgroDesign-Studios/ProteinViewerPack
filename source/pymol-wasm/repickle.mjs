// S1-9: re-pickle the wheel's chempy fragments and side-chain libraries with protocol 4, in the stage dir.
//
//   node repickle.mjs <pyodide-core-dir> <stage-dir>
//
// wheel.sh runs it with emsdk's node on the pinned Pyodide core ($W/dl/core/pyodide)
// after make_wheel.py --drop (which removes sidechains/sc_library.pkl, a D-group file).
// The stage must then hold exactly 133 .pkl files: the 131 fragments under
// pymol/pymol_path/data/chempy/fragments/ and sidechains/sc_bb_dep.pkl, sc_bb_ind.pkl.
// Each one is loaded by the runtime's own CPython (3.14.2 in the core) with
// _pickle.loads, which finds the classes in the STAGE's chempy package (copied
// into the in-memory filesystem; pymol is not imported and must not be), dumped
// again with protocol 4, and checked to be a fixed point: dumps(loads(new), 4) == new.
// The new bytes replace the files in the stage. The bundled pickles mix protocols
// 0-2 with Python 2 strings; protocol 4 is about 126 KB smaller in the wheel
// (design 2026-11-16-pymol-wasm-slim S1-9, evidence 3.9). That the objects load
// back identical through chempy.io.pkl.fromFile is tests/pickle_identity.mjs's check.
//
// Python never touches the host filesystem: node copies the inputs into Pyodide's
// MEMFS and writes the outputs back. The host shell is fenced off first (guardHost,
// then PY_HOST_BLOCK; bench/lib/guard_host.mjs), and a blocked call fails the run.
//
// Prints one JSON line. exit: 0 = all 133 rewritten; 1 = the stage does not hold
// exactly the expected pickles, a pickle is not a fixed point, pymol was imported,
// or a host call was attempted; 2 = usage / unreadable input.
//
// Ported from the study's exp3/v11 scripts/py/repickle.mjs (v9). Changes: it works
// on the stage dir instead of a built wheel, counts the files, takes chempy from the
// stage only (asserted), and uses the shared host guard.
import path from 'node:path';
import { existsSync, lstatSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { guardHost, hostCalls, PY_HOST_BLOCK } from './bench/lib/guard_host.mjs';

const DATA = 'pymol/pymol_path/data/chempy';
const SIDECHAINS = ['sc_bb_dep.pkl', 'sc_bb_ind.pkl'];
const N_FRAGMENTS = 131;
const N_EXPECTED = N_FRAGMENTS + SIDECHAINS.length;

function usage(msg) {
  console.error(`repickle.mjs: ${msg}\nusage: node repickle.mjs <pyodide-core-dir> <stage-dir>`);
  process.exit(2);
}
function fail(msg, extra = {}) {
  console.log(JSON.stringify({ tool: 'repickle', ok: false, error: msg, ...extra }));
  console.error(`repickle.mjs: ${msg}`);
  process.exit(1);
}

// Every regular file under root, as root-relative POSIX paths; refuses links.
function walk(root, rel = '') {
  const out = [];
  for (const e of readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isSymbolicLink()) throw new Error(`refusing a symbolic link in the stage: ${r}`);
    if (e.isDirectory()) out.push(...walk(root, r));
    else if (e.isFile()) out.push(r);
    else throw new Error(`refusing a non-regular file in the stage: ${r}`);
  }
  return out.sort();
}

const [coreArg, stageArg] = process.argv.slice(2);
if (!coreArg || !stageArg || process.argv.length !== 4) usage('two arguments needed');
const core = path.resolve(coreArg);
const stage = path.resolve(stageArg);
if (!existsSync(path.join(core, 'pyodide.mjs'))) usage(`${core} holds no pyodide.mjs`);
if (!existsSync(path.join(stage, 'chempy', '__init__.py'))) usage(`${stage} holds no chempy package`);

let pkls, chempyFiles;
try {
  const all = walk(stage);
  pkls = all.filter((f) => f.endsWith('.pkl'));
  chempyFiles = walk(path.join(stage, 'chempy')).filter((f) => !f.split('/').includes('__pycache__'));
} catch (e) {
  usage(String(e.message || e));
}
const frags = pkls.filter((f) => f.startsWith(`${DATA}/fragments/`) && !f.slice(`${DATA}/fragments/`.length).includes('/'));
const scs = pkls.filter((f) => f.startsWith(`${DATA}/sidechains/`));
const other = pkls.filter((f) => !frags.includes(f) && !scs.includes(f));
const scNames = scs.map((f) => f.slice(`${DATA}/sidechains/`.length)).sort();
if (pkls.length !== N_EXPECTED || frags.length !== N_FRAGMENTS || JSON.stringify(scNames) !== JSON.stringify(SIDECHAINS) || other.length) {
  fail(`the stage holds ${pkls.length} .pkl files (${frags.length} fragments, sidechains ${JSON.stringify(scNames)}, ` +
    `elsewhere ${JSON.stringify(other)}); expected ${N_FRAGMENTS} fragments + ${SIDECHAINS.join(', ')} = ${N_EXPECTED}`);
}

guardHost();
const { loadPyodide } = await import(pathToFileURL(path.join(core, 'pyodide.mjs')).href);
const pyOut = [];
const py = await loadPyodide({ indexURL: core + '/', stdout: (s) => pyOut.push(s), stderr: (s) => pyOut.push(s) });
py.runPython(PY_HOST_BLOCK);

const put = (p, data) => {
  py.FS.mkdirTree(path.posix.dirname(p));
  py.FS.writeFile(p, data);
};
for (const f of chempyFiles) put(`/src/chempy/${f}`, new Uint8Array(readFileSync(path.join(stage, 'chempy', f))));
for (const f of pkls) put(`/pkl/${f}`, new Uint8Array(readFileSync(path.join(stage, f))));
put('/pkl/list.json', JSON.stringify(pkls));

let res;
try {
  res = JSON.parse(py.runPython(String.raw`
import json, os, sys, _pickle
sys.path.insert(0, '/src')
rels = json.load(open('/pkl/list.json'))
tot = {'files': 0, 'in_bytes': 0, 'out_bytes': 0, 'protocols_in': {}}
for rel in rels:
    raw = open('/pkl/' + rel, 'rb').read()
    # protocols 0 and 1 carry no PROTO opcode; both count as 0 here
    proto = str(raw[1] if raw[:1] == b'\x80' else 0)
    tot['protocols_in'][proto] = tot['protocols_in'].get(proto, 0) + 1
    new = _pickle.dumps(_pickle.loads(raw), 4)
    if _pickle.dumps(_pickle.loads(new), 4) != new:
        raise AssertionError('not a fixed point: ' + rel)
    os.makedirs(os.path.dirname('/out/' + rel), exist_ok=True)
    with open('/out/' + rel, 'wb') as fh:
        fh.write(new)
    tot['files'] += 1
    tot['in_bytes'] += len(raw)
    tot['out_bytes'] += len(new)
import chempy
tot.update({'chempy': chempy.__file__, 'chempy_from_stage': chempy.__file__.startswith('/src/chempy/'),
            'pymol_loaded': any(m == 'pymol' or m.startswith('pymol.') for m in sys.modules),
            'numpy_loaded': 'numpy' in sys.modules, 'python': sys.version.split()[0]})
json.dumps(tot)
`));
} catch (e) {
  fail('Python failed: ' + String((e && e.message) || e).split('\n').filter((l) => l.trim()).slice(-3).join(' | ').slice(0, 600));
}
if (hostCalls.length) fail('a host process start was attempted', { hostCalls });
if (!res.chempy_from_stage) fail(`chempy was not the stage's: ${res.chempy}`);
if (res.pymol_loaded) fail('pymol was imported while re-pickling');
if (res.files !== N_EXPECTED) fail(`re-pickled ${res.files} files, expected ${N_EXPECTED}`);

let written = 0;
for (const f of pkls) {
  const data = py.FS.readFile(`/out/${f}`);
  if (data[0] !== 0x80 || data[1] !== 4) fail(`${f}: the new pickle is not protocol 4`);
  const dst = path.join(stage, f);
  if (!lstatSync(dst).isFile()) fail(`${f}: no longer a regular file in the stage`);
  writeFileSync(dst, data);
  written++;
}
console.log(JSON.stringify({ tool: 'repickle', ok: true, written, ...res, hostCalls }));
