// Smoke test of the BUILT wheel in a real Pyodide runtime (node, headless PyMOL).
//
//   node smoke_wheel.mjs <pyodide-core-dir> <numpy-wheel> <pymol-wheel> [report.json]
//
// build.sh runs it on its own output with emsdk's node. Where
// test_restricted_unpickler.py checks patch 0006 in the source, this checks
// that the shipped wheel imports, that `import pymol` really installs the
// restriction, and that it holds on the two session paths a .pse reaches inside
// PyMOL itself: the nested session['wizard'] pickle and the C++ ObjectCallback
// restore (PConvPickleLoads -> the pickle module's loads). Each refusal is
// paired with a control that swaps the unrestricted loader back in and must
// see the payload run, so a refusal cannot pass because the path was dead.
// Payloads only write marker files inside Pyodide's in-memory filesystem.
// Exit 0 = every expectation held; 1 = one did not (the report says which).
import path from 'node:path';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const [coreDir, numpyWheel, pymolWheel, reportPath] = process.argv.slice(2);
if (!pymolWheel) {
  console.error('usage: node smoke_wheel.mjs <pyodide-core-dir> <numpy-wheel> <pymol-wheel> [report.json]');
  process.exit(2);
}
const indexURL = path.resolve(coreDir) + '/';
const { loadPyodide } = await import(pathToFileURL(path.join(indexURL, 'pyodide.mjs')).href);
const py = await loadPyodide({ indexURL, stdout: () => {}, stderr: () => {} });
await py.loadPackage([path.resolve(numpyWheel), path.resolve(pymolWheel)], { messageCallback: () => {} });

const result = {};
function step(name, code) {
  try {
    result[name] = JSON.parse(py.runPython(code));
  } catch (e) {
    result[name] = { error: String((e && e.message) || e).split('\n').slice(-3).join(' | ').slice(0, 400) };
  }
}

step('start', String.raw`
import json, os, pickle, builtins, _pickle, sys
# Capture the state BEFORE anything PyMOL is imported, then after import pymol
# alone (no explicit chempy import), so the check proves import pymol itself
# installs the restriction rather than a later chempy import in this script.
_before = (pickle.loads.__module__, pickle.loads.__qualname__, 'chempy.pkl' in sys.modules)
import pymol
_installed_by_import_pymol = ('chempy.pkl' in sys.modules
                              and pickle.loads.__module__ == 'chempy.pkl'
                              and pickle.loads.__qualname__ == 'restricted_loads'
                              and pickle._loads is pickle.loads)
import pymol.invocation, pymol2
pymol.invocation.parse_args(['pymol', '-cq'])
_inst = pymol2.SingletonPyMOL()
_inst.start()
from pymol import cmd
import chempy.pkl

def _load(p):
    try:
        cmd.load(p)
        return 'loaded'
    except Exception as e:
        return 'refused: %s: %s' % (type(e).__name__, str(e)[:160])

json.dumps({'restricted': pickle.loads is chempy.pkl.restricted_loads and pickle._loads is chempy.pkl.restricted_loads,
            'before_pristine': _before == ('_pickle', 'loads', False),
            'installed_by_import_pymol': _installed_by_import_pymol,
            'version': cmd.get_version()[0]})
`);
step('session', String.raw`
cmd.fab('AAAAK', 'pep', ss=1); cmd.show_as('cartoon', 'pep'); cmd.show('sticks', 'resn LYS')
cmd.color('red', 'pep and name CA'); cmd.set('cartoon_transparency', 0.3)
cmd.select('sele1', 'resi 2'); cmd.label('pep and name CA and resi 1', '"N-term"')
cmd.pseudoatom('marker1', pos=[1, 2, 3])
cmd.distance('d1', 'pep and resi 1 and name CA', 'pep and resi 3 and name CA')
cmd.scene('s1', 'store'); cmd.view('v1', 'store')
n0, names0 = cmd.count_atoms('all'), cmd.get_names('all')
cmd.save('/tmp/session.pse'); cmd.delete('all')
json.dumps({'load': _load('/tmp/session.pse'), 'same_atoms': cmd.count_atoms('all') == n0,
            'same_names': cmd.get_names('all') == names0, 'scenes': cmd.get_scene_list()})
`);
step('numpy', String.raw`
import numpy as np
xyz = cmd.get_coords('pep')
ref = np.array(cmd.get_model('pep').get_coord_list(), dtype=np.float32)
json.dumps({'get_coords_matches_model': bool(xyz is not None and xyz.shape == ref.shape and np.allclose(xyz, ref))})
`);
step('binary_dump', String.raw`
cmd.delete('all'); cmd.set('pse_binary_dump', 1)
cmd.fab('AAA', 'p2'); cmd.save('/tmp/bonds.pse'); cmd.delete('all')
with_bonds = _load('/tmp/bonds.pse')
# a bond-less object's zero-length bond blob pickles as builtins.bytes() at
# proto 1; now allow-listed (decision 2), so it loads
cmd.delete('all'); cmd.pseudoatom('ion1'); cmd.save('/tmp/nobonds.pse'); cmd.delete('all')
no_bonds = _load('/tmp/nobonds.pse') + ' atoms=%d' % cmd.count_atoms('all')
cmd.set('pse_binary_dump', 0); cmd.delete('all')
json.dumps({'with_bonds': with_bonds, 'no_bonds': no_bonds})
`);
step('ndarray_direct_call', String.raw`
import numpy as np
# A legitimate numpy array (object dtype) round-trips at the protocol PyMOL
# saves with; it reaches numpy via _reconstruct, with ndarray only an argument.
obj = np.array([1, 'a', None], dtype=object)
legit = bool((pickle.loads(pickle.dumps(obj, 1)) == obj).all())
flt = bool((pickle.loads(pickle.dumps(np.arange(6.0).reshape(2, 3), 1)) == np.arange(6.0).reshape(2, 3)).all())
# A pickle that calls numpy.ndarray directly is refused: the restriction must
# raise a clean UnpicklingError (no crash).
class _DirectCall:
    def __reduce__(self):
        return (np.ndarray, ((2,), np.dtype('O'), b'\x00\x10\x00\x00\x00\x20\x00\x00'))
raw = _pickle.dumps(_DirectCall(), 2)
try:
    pickle.loads(raw)
    refused = 'NOT REFUSED'
except pickle.UnpicklingError as e:
    refused = 'refused' if 'numpy.ndarray' in str(e) else 'refused (other): ' + str(e)[:120]
except Exception as e:
    refused = 'wrong error: %s: %s' % (type(e).__name__, str(e)[:120])
json.dumps({'object_array_round_trip': legit, 'float_array_round_trip': flt, 'direct_ndarray_call': refused})
`);
step('nested_wizard', String.raw`
class _Wiz:
    def __reduce__(self):
        return (builtins.exec, ("open('/tmp/wizard_marker', 'w').write('x')",))
cmd.delete('all'); cmd.fab('A', 'w1')
_s = cmd.get_session(); _s['wizard'] = pickle.dumps([_Wiz()], 1)
cmd.delete('all'); cmd.set_session(_s)
_restricted = os.path.exists('/tmp/wizard_marker')
_orig = chempy.pkl.cPickle.loads
chempy.pkl.cPickle.loads = staticmethod(_pickle.loads)
try:
    cmd.delete('all'); cmd.set_session(_s)
finally:
    chempy.pkl.cPickle.loads = _orig
json.dumps({'payload_ran_restricted': _restricted, 'payload_ran_control': os.path.exists('/tmp/wizard_marker')})
`);
step('callback_cpp_path', String.raw`
class _Cb:
    def __call__(self):
        pass
    def __reduce__(self):
        return (builtins.exec, ("open('/tmp/callback_marker', 'w').write('x')",))
cmd.delete('all'); cmd.load_callback(_Cb(), 'cb1')
_s = cmd.get_session(); cmd.delete('all')
cmd.set_session(_s)
_restricted = os.path.exists('/tmp/callback_marker')
_saved = pickle.loads
pickle.loads = _pickle.loads
try:
    cmd.delete('all'); cmd.set_session(_s)
finally:
    pickle.loads = _saved
cmd.delete('all')
json.dumps({'payload_ran_restricted': _restricted, 'payload_ran_control': os.path.exists('/tmp/callback_marker'),
            'restriction_back': pickle.loads is chempy.pkl.restricted_loads})
`);

const r = result;
const expect = [
  ['pickle.loads is unrestricted before import pymol', r.start?.before_pristine === true],
  ['import pymol alone installs the restricted loads', r.start?.installed_by_import_pymol === true],
  ['restricted loads still in place at the end', r.start?.restricted === true],
  ['a normal session loads back unchanged', r.session?.load === 'loaded' && r.session?.same_atoms && r.session?.same_names && r.session?.scenes?.[0] === 's1'],
  ['numpy C API agrees with the model (D13)', r.numpy?.get_coords_matches_model === true],
  ['binary-dump session with bonds loads', r.binary_dump?.with_bonds === 'loaded'],
  ['binary-dump object without bonds loads (builtins.bytes allowed)', String(r.binary_dump?.no_bonds).startsWith('loaded')],
  ['legit object + float numpy arrays round-trip', r.ndarray_direct_call?.object_array_round_trip === true && r.ndarray_direct_call?.float_array_round_trip === true],
  ['direct numpy.ndarray(buffer) call refused, not a crash', r.ndarray_direct_call?.direct_ndarray_call === 'refused'],
  ['nested wizard payload refused', r.nested_wizard?.payload_ran_restricted === false],
  ['nested wizard payload runs without the restriction (control)', r.nested_wizard?.payload_ran_control === true],
  ['ObjectCallback C++ path payload refused', r.callback_cpp_path?.payload_ran_restricted === false],
  ['ObjectCallback C++ path payload runs without the restriction (control)', r.callback_cpp_path?.payload_ran_control === true],
  ['pickle.loads restored after the control swap', r.callback_cpp_path?.restriction_back === true],
];
const report = { result: r, expectations: Object.fromEntries(expect.map(([k, v]) => [k, Boolean(v)])) };
if (reportPath) writeFileSync(reportPath, JSON.stringify(report, null, 1) + '\n');
let failed = 0;
for (const [k, v] of expect) {
  console.log(`${v ? 'ok  ' : 'FAIL'} ${k}`);
  if (!v) failed++;
}
if (failed) console.log(JSON.stringify(r, null, 1));
process.exit(failed ? 1 : 0);
