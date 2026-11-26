// S1-18 (PyMOL WASM slim design §3.2, §8.1): a .pse saved with
// session_compression=1 restores in the frame, on the REAL runtime (node,
// headless PyMOL). Modelled on frame_gl_defaults.mjs; hand-run like it:
//
//   node frame_restore_compressed.mjs <pyodide-core-dir> <numpy-wheel> <pymol-wheel> <worker.js> [report.json]
//
// With session_compression=1 PyMOL pickles zlib.compress(pickle(session)): the
// outer unpickle yields bytes, and a RESTORE_PY without the bytes branch fails
// on them with "AttributeError: 'bytes' object has no attribute 'pop'" (0
// atoms). RESTORE_PY decompresses those bytes and unpickles them again through the SAME
// restricted loader (chempy io.pkl.fromString), once — never recursively.
// The decompression follows desktop PyMOL's set_session (owner ruling); this
// test covers the restore path only.
//
// RESTORE_PY, HARDEN_PY and GL_PY are EXTRACTED from the given worker.js and
// run the worker's way (the .pse bytes at /tmp/sess.pse, RESTORE_PY run in
// the global namespace, its JSON read back). The structure is the wheel's own
// tut/1hpv.pdb; no binary fixture. It checks:
//   1. a .pse of 1hpv saved with session_compression=1 (its outer pickle
//      really is bytes) restores with err None, the same atom count (1,631)
//      and the same object names and atoms (object/chain/resi/resn/name of
//      every atom, as a digest); an uncompressed .pse still restores;
//   2. positive control: RESTORE_PY with its `isinstance(sess, bytes)` branch
//      taken out fails on the same file the base way (the AttributeError,
//      0 atoms) — so a pass in 1 comes from the branch;
//   3. a compressed session whose INNER pickle runs eval (writing a sentinel
//      file in Pyodide's in-memory /tmp — never a host call) is refused by the
//      restricted loader and the sentinel never appears; control: the same
//      inner bytes read without the restricted loader write the sentinel;
//   4. bytes that are not zlib, and a zlib stream whose inner pickle is bytes
//      again (a doubly compressed session), fail cleanly: err set, the runtime
//      still answers, and _agdb_gl_defaults() still ran (trilines 1).
// Exit 0 = every expectation held; 1 = one did not (the report says which);
// 2 = usage / extraction error.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const [coreDir, numpyWheel, pymolWheel, workerPath, reportPath] = process.argv.slice(2);
if (!workerPath) {
  console.error('usage: node frame_restore_compressed.mjs <core-dir> <numpy-wheel> <pymol-wheel> <worker.js> [report.json]');
  process.exit(2);
}

const workerSrc = readFileSync(workerPath, 'utf8');
const harden = workerSrc.match(/const HARDEN_PY = String\.raw`([\s\S]*?)`;/);
const restore = workerSrc.match(/const RESTORE_PY = String\.raw`([\s\S]*?)`;/);
const gl = workerSrc.match(/const GL_PY = String\.raw`([\s\S]*?)`;/);
if (!harden || !restore || !gl) { console.error('could not find HARDEN_PY / RESTORE_PY / GL_PY in ' + workerPath); process.exit(2); }
const RESTORE_PY = restore[1];
// The control: the same RESTORE_PY without the bytes branch (the `if` line
// and its indented body).
const RESTORE_NO_BRANCH = RESTORE_PY.replace(/^    if isinstance\(sess, bytes\):\n(?:        .*\n)+/m, '');

const indexURL = path.resolve(coreDir) + '/';
createRequire(import.meta.url)(path.join(indexURL, 'pyodide.js'));
const py = await globalThis.loadPyodide({ indexURL, stdout: () => {}, stderr: () => {} });
await py.loadPackage([path.resolve(numpyWheel), path.resolve(pymolWheel)], { messageCallback: () => {} });

const result = {};
function step(name, code) {
  try { result[name] = JSON.parse(py.runPython(code)); }
  catch (e) { result[name] = { error: String((e && e.message) || e).split('\n').slice(-3).join(' | ').slice(0, 400) }; }
}
// RESTORE_PY the worker's way, on given bytes, from a trilines-0 start so a
// trilines of 1 afterwards shows _agdb_gl_defaults() ran.
function restoreWith(code, file) {
  try {
    py.runPython("cmd.delete('all'); cmd.set('trilines', 0)");
    py.FS.writeFile('/tmp/sess.pse', py.FS.readFile(file));
    let parsed;
    try { parsed = JSON.parse(py.runPython(code)); } finally { try { py.FS.unlink('/tmp/sess.pse'); } catch (e) {} }
    parsed.trilines = Number(py.runPython("cmd.get_setting_int('trilines')"));
    parsed.count_all = Number(py.runPython("cmd.count_atoms('all')"));
    parsed.atom_ids = String(py.runPython('_agdb_test_atom_ids()'));
    parsed.alive = Number(py.runPython('2 + 2'));
    return parsed;
  } catch (e) {
    return { error: String((e && e.message) || e).split('\n').slice(-3).join(' | ').slice(0, 400) };
  }
}

step('boot', String.raw`
import json, os, pickle, zlib, io as _bio, builtins
import pymol, pymol.invocation, pymol2
pymol.invocation.parse_args(['pymol', '-cq'])
_inst = pymol2.SingletonPyMOL(); _inst.start()
from pymol import cmd
import hashlib
from pymol import stored
# Every atom's (object, chain, resi, resn, name), in order, as one digest.
def _agdb_test_atom_ids():
    stored._agdb_ids = []
    cmd.iterate('all', 'stored._agdb_ids.append((model, chain, resi, resn, name))')
    return '%d:%s' % (len(stored._agdb_ids), hashlib.sha256(repr(stored._agdb_ids).encode()).hexdigest()[:16])
_pdb = os.path.join(os.path.dirname(pymol.__file__), 'pymol_path', 'data', 'tut', '1hpv.pdb')
json.dumps({'pdb': _pdb, 'exists': os.path.exists(_pdb)})
`);
step('guard', 'import json\n' + harden[1] + '\n' + gl[1] + "\n_agdb_gl_defaults()\njson.dumps({'allow_count': _allow_count(), 'trilines': cmd.get_setting_int('trilines')})");

// Fixtures, written by PyMOL itself.
step('fixtures', String.raw`
from chempy import io as _cio
cmd.load(_pdb, '1hpv')
_n = cmd.count_atoms('all'); _names = cmd.get_names()
cmd.set('session_compression', 0); cmd.save('/tmp/plain.pse')
cmd.set('session_compression', 1); cmd.save('/tmp/comp.pse')
cmd.set('session_compression', 0)
_outer = _cio.pkl.fromString(open('/tmp/comp.pse', 'rb').read())
# A doubly compressed session: zlib of a pickle whose content is zlib bytes again.
open('/tmp/double.pse', 'wb').write(pickle.dumps(zlib.compress(pickle.dumps(_outer))))
# Not zlib at all.
open('/tmp/notzlib.pse', 'wb').write(pickle.dumps(b'this is not a zlib stream'))
# A compressed session whose inner pickle runs eval if anything unpickles it
# without the allow-list. The sentinel is a file in Pyodide's in-memory /tmp.
class _E:
    def __reduce__(self):
        return (builtins.eval, ("open('/tmp/pwned_s18', 'w').write('x')",))
_evil_inner = pickle.dumps({'names': [None], 'x': _E()}, 2)
open('/tmp/evil.pse', 'wb').write(pickle.dumps(zlib.compress(_evil_inner)))
json.dumps({'atoms': _n, 'names': _names, 'atom_ids': _agdb_test_atom_ids(), 'comp_outer_is_bytes': isinstance(_outer, bytes),
            'plain_outer_is_dict': isinstance(_cio.pkl.fromString(open('/tmp/plain.pse', 'rb').read()), dict),
            'comp_bytes': os.path.getsize('/tmp/comp.pse'), 'plain_bytes': os.path.getsize('/tmp/plain.pse')})
`);

result.compressed = restoreWith(RESTORE_PY, '/tmp/comp.pse');
result.plain = restoreWith(RESTORE_PY, '/tmp/plain.pse');
result.control_branch_removed = RESTORE_NO_BRANCH !== RESTORE_PY;
result.control_compressed = restoreWith(RESTORE_NO_BRANCH, '/tmp/comp.pse');

py.runPython("import os\nif os.path.exists('/tmp/pwned_s18'): os.remove('/tmp/pwned_s18')");
result.evil = restoreWith(RESTORE_PY, '/tmp/evil.pse');
result.evil.sentinel = py.runPython("os.path.exists('/tmp/pwned_s18')") === true;
// Control: the same inner bytes, read without the restricted loader, so a
// refusal above comes from that loader. Its eval only writes the file.
step('evil_control', String.raw`
_r = {'sentinel_before': os.path.exists('/tmp/pwned_s18')}
try:
    pickle._load(_bio.BytesIO(zlib.decompress(pickle._load(_bio.BytesIO(open('/tmp/evil.pse', 'rb').read())))))
    _r['err'] = None
except Exception as e:
    _r['err'] = type(e).__name__ + ': ' + str(e)[:200]
_r['sentinel_after'] = os.path.exists('/tmp/pwned_s18')
if _r['sentinel_after']: os.remove('/tmp/pwned_s18')
json.dumps(_r)
`);

result.not_zlib = restoreWith(RESTORE_PY, '/tmp/notzlib.pse');
result.double = restoreWith(RESTORE_PY, '/tmp/double.pse');

// ---- expectations --------------------------------------------------------------
const failures = [];
const expect = (cond, why) => { if (!cond) failures.push(why); };
const fx = result.fixtures || {};
const sameNames = (r) => JSON.stringify(r && r.names) === JSON.stringify(fx.names);

expect(result.boot && result.boot.exists === true, 'the wheel has no pymol_path/data/tut/1hpv.pdb: ' + JSON.stringify(result.boot));
expect(result.guard && result.guard.allow_count === 18 && result.guard.trilines === 1, 'HARDEN_PY / GL_PY did not install: ' + JSON.stringify(result.guard));
expect(fx.atoms === 1631 && JSON.stringify(fx.names) === '["1hpv"]', 'fixture: 1hpv is not 1,631 atoms in one object: ' + JSON.stringify(fx));
expect(fx.comp_outer_is_bytes === true && fx.plain_outer_is_dict === true,
  'fixture: session_compression=1 did not give a bytes outer pickle (or 0 a dict): ' + JSON.stringify(fx));

const c = result.compressed;
expect(c.err === null && c.atoms === fx.atoms && c.count_all === fx.atoms && sameNames(c) && c.atom_ids === fx.atom_ids && c.trilines === 1,
  'a session_compression=1 .pse did not restore (want err null, ' + fx.atoms + ' atoms, the same object and atom names, trilines 1): ' + JSON.stringify(c));
const p = result.plain;
expect(p.err === null && p.atoms === fx.atoms && sameNames(p) && p.atom_ids === fx.atom_ids && p.trilines === 1, 'an uncompressed .pse no longer restores: ' + JSON.stringify(p));

expect(result.control_branch_removed === true, 'control: RESTORE_PY has no `if isinstance(sess, bytes):` branch to take out');
const k = result.control_compressed;
expect(String(k.err).startsWith("AttributeError: 'bytes' object has no attribute 'pop'") && k.atoms === null && k.count_all === 0,
  'control: without the bytes branch the compressed .pse should fail the base way (AttributeError, 0 atoms): ' + JSON.stringify(k));

const ev = result.evil;
expect(ev.err !== null && ev.err !== undefined && ev.sentinel === false && ev.count_all === 0 && ev.trilines === 1 && ev.alive === 4,
  'a compressed session with a malicious inner pickle was not refused cleanly (or its payload ran): ' + JSON.stringify(ev));
const ec = result.evil_control || {};
expect(ec.sentinel_before === false && ec.sentinel_after === true,
  'control: the malicious inner pickle did not run under the unrestricted loader (the refusal above may be a dead path): ' + JSON.stringify(ec));

for (const [label, r, want] of [['not zlib', result.not_zlib, /^error: /], ['doubly compressed', result.double, /^AttributeError: 'bytes' object has no attribute 'pop'/]]) {
  expect(r && typeof r.err === 'string' && want.test(r.err) && r.atoms === null && r.trilines === 1 && r.alive === 4,
    `${label}: want err matching ${want}, no atoms, trilines 1 (_agdb_gl_defaults ran), the runtime alive: ` + JSON.stringify(r));
}

const report = { ok: failures.length === 0, failures, result };
if (reportPath) writeFileSync(reportPath, JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1));
process.exit(report.ok ? 0 : 1);
