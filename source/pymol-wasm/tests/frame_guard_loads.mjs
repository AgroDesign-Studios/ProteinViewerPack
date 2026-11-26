// The frame's load guard must refuse pickles WITHOUT refusing structures.
// pt2891_frame_defences.mjs proves the refusals; this proves the other half,
// which it never checked: every format worker.js allows still loads once the
// guard (HARDEN_PY) is installed. Run all three real-runtime tests on any
// worker.js change: pt2891_frame_defences.mjs, frame_load_formats.mjs, and this.
//
//   node frame_guard_loads.mjs <pyodide-core-dir> <numpy-wheel> <pymol-wheel> <worker.js> [report.json]
//
// Why it exists: guard (4) wraps pymol.internal._load as (…, *a, **kw).
// pymol.importing.load reads its loader's signature and hands a **kwargs loader
// every argument it knows (filename=, fname=, object=, …), which the real _load
// does not take, so every format routed through _load (cif, sdf, mol, mol2,
// xyz, and the map formats) would fail with "_load() got an unexpected keyword
// argument 'filename'" unless the wrapper keeps _load's signature. This test
// checks that every allowed format still loads with the guard installed;
// pt2891 checks only the refusals and never loads a real structure.
//
// HARDEN_PY and FORMATS are EXTRACTED from the shipped worker.js, and each load
// goes the worker's way (bytes at /tmp/in_<obj>.<fmt>, then
// cmd.load(fn, obj, 0, FORMATS[ext])), so this tests the bytes the browser runs.
// A format FORMATS names that this file does not know fails the run, so a new
// allow-list entry without a load check fails here. The control deletes the
// signature fix in the live runtime and shows cif failing again, so a pass
// cannot come from a dead path.
// Exit 0 = every expectation held; 1 = one did not (the report says which).
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const [coreDir, numpyWheel, pymolWheel, workerPath, reportPath] = process.argv.slice(2);
if (!workerPath) {
  console.error('usage: node frame_guard_loads.mjs <core-dir> <numpy-wheel> <pymol-wheel> <worker.js> [report.json]');
  process.exit(2);
}

const workerSrc = readFileSync(workerPath, 'utf8');
const harden = workerSrc.match(/const HARDEN_PY = String\.raw`([\s\S]*?)`;/);
const formatsSrc = workerSrc.match(/const FORMATS = (\{[^}]*\});/);
if (!harden || !formatsSrc) { console.error('could not find HARDEN_PY / FORMATS in ' + workerPath); process.exit(2); }
const HARDEN_PY = harden[1];
// An object literal of identifier keys and quoted string values: parsed, never evaluated.
const FORMATS = JSON.parse(formatsSrc[1].replace(/(\w+):/g, '"$1":').replace(/'/g, '"'));

// How each PyMOL format is checked. 'molecule' formats get a fixture saved from a
// fab peptide; 'map' formats get a CCP4 grid (map/mrc are the same reader).
// pse goes to RESTORE_PY, never cmd.load; mae is the incentive-only format this
// OSS build cannot read with or without the guard — both are out of scope here.
const KINDS = { pdb: 'molecule', cif: 'molecule', sdf: 'molecule', mol: 'molecule', mol2: 'molecule', xyz: 'molecule',
  ccp4: 'map', map: 'map', mrc: 'map', pse: 'skip', mae: 'skip' };
const unknown = [...new Set(Object.values(FORMATS))].filter((f) => !(f in KINDS));

const indexURL = path.resolve(coreDir) + '/';
createRequire(import.meta.url)(path.join(indexURL, 'pyodide.js'));
const py = await globalThis.loadPyodide({ indexURL, stdout: () => {}, stderr: () => {} });
await py.loadPackage([path.resolve(numpyWheel), path.resolve(pymolWheel)], { messageCallback: () => {} });

const result = {};
function step(name, code) {
  try { result[name] = JSON.parse(py.runPython(code)); }
  catch (e) { result[name] = { error: String((e && e.message) || e).split('\n').slice(-3).join(' | ').slice(0, 400) }; }
}

// Fixtures are written BEFORE the guard goes in, so a guard bug cannot hide behind
// a fixture that failed to save.
step('start', String.raw`
import json
import pymol, pymol.invocation, pymol2
pymol.invocation.parse_args(['pymol', '-cq'])
_inst = pymol2.SingletonPyMOL(); _inst.start()
from pymol import cmd
cmd.fab('AAAA', 'pep')
_saved = {}
for _f in ('pdb', 'cif', 'sdf', 'mol', 'mol2', 'xyz'):
    try:
        cmd.save('/tmp/fx.' + _f, 'pep')
        _saved[_f] = len(open('/tmp/fx.' + _f, 'rb').read())
    except Exception as e:
        _saved[_f] = 'error: ' + type(e).__name__
# A CCP4/MRC grid written by hand (map_new needs a live renderer here): an 8^3
# float32 grid, 1 A spacing, a 1024-byte header of 256 little-endian words.
import struct
_n = 8
_vals = [((i * 7 + j * 3 + k) % 11) / 10.0 for k in range(_n) for j in range(_n) for i in range(_n)]
_mean = sum(_vals) / len(_vals)
_rms = (sum((v - _mean) ** 2 for v in _vals) / len(_vals)) ** 0.5
_hdr = bytearray(1024)
struct.pack_into('<10i', _hdr, 0, _n, _n, _n, 2, 0, 0, 0, _n, _n, _n)      # NC NR NS MODE start NX NY NZ
struct.pack_into('<6f', _hdr, 40, float(_n), float(_n), float(_n), 90.0, 90.0, 90.0)
struct.pack_into('<3i3f2i', _hdr, 64, 1, 2, 3, min(_vals), max(_vals), _mean, 1, 0)  # MAPC MAPR MAPS DMIN DMAX DMEAN ISPG NSYMBT
_hdr[208:212] = b'MAP '
_hdr[212:216] = bytes((0x44, 0x41, 0, 0))                                       # little-endian machine stamp
struct.pack_into('<f', _hdr, 216, _rms)
open('/tmp/fx.ccp4', 'wb').write(bytes(_hdr) + struct.pack('<%df' % len(_vals), *_vals))
_saved['ccp4'] = len(open('/tmp/fx.ccp4', 'rb').read())
cmd.delete('all')
json.dumps({'saved': _saved})
`);

step('install_guard', 'import json\n' + HARDEN_PY + "\njson.dumps({'allow_count': _allow_count()})");

// Every allowed format, the worker's way.
step('loads', String.raw`
import json, shutil, inspect
import pymol.internal as _pin2
_formats = json.loads(${JSON.stringify(JSON.stringify(FORMATS))})
_kinds = json.loads(${JSON.stringify(JSON.stringify(KINDS))})
_src = {'pdb': 'pdb', 'cif': 'cif', 'sdf': 'sdf', 'mol': 'mol', 'mol2': 'mol2', 'xyz': 'xyz', 'ccp4': 'ccp4', 'map': 'ccp4', 'mrc': 'ccp4'}
_r = {}
for _ext, _fmt in sorted(_formats.items()):
    if _kinds.get(_fmt) == 'skip':
        continue
    _obj = 'o_' + _ext
    _fn = '/tmp/in_%s.%s' % (_obj, _fmt)
    try:
        shutil.copyfile('/tmp/fx.' + _src[_fmt], _fn)
        cmd.load(_fn, _obj, 0, _fmt)
        _t = cmd.get_type(_obj) if _obj in cmd.get_names() else None
        _r[_ext] = {'ok': _t is not None, 'type': _t,
                    'atoms': cmd.count_atoms(_obj) if _t == 'object:molecule' else None}
    except Exception as e:
        _r[_ext] = {'ok': False, 'error': (type(e).__name__ + ': ' + str(e))[:200]}
# The command-line and direct-call routes reach the same guarded _load.
_before = set(cmd.get_names())
cmd.do('load /tmp/fx.cif, via_do')
_r['cmd_do_cif'] = {'ok': 'via_do' in set(cmd.get_names()) - _before}
try:
    import pymol.importing as _imp
    _imp.load('/tmp/fx.sdf', 'via_importing')
    _r['importing_load_sdf'] = {'ok': 'via_importing' in cmd.get_names()}
except Exception as e:
    _r['importing_load_sdf'] = {'ok': False, 'error': (type(e).__name__ + ': ' + str(e))[:200]}
_sig = inspect.signature(_pin2._load, follow_wrapped=False)
_r['signature_has_var_keyword'] = any(p.kind == inspect.Parameter.VAR_KEYWORD for p in _sig.parameters.values())
json.dumps(_r)
`);

// The refusal the guard exists for still holds with the signature fix in place:
// a pickle ftype reaching pymol.internal._load (positionally or by keyword, the
// way importing.load now passes it) is refused and runs nothing.
step('refusals', String.raw`
import json, os, pickle, builtins
from pymol.constants import loadable
import pymol.internal as _pin3
class _E:
    def __reduce__(self): return (builtins.eval, ("open('/tmp/pwned_fgl','w').write('x')",))
open('/tmp/evil.model', 'wb').write(pickle.dumps([_E()], 2))
_r = {}
def _probe(label, fn):
    try: os.remove('/tmp/pwned_fgl')
    except Exception: pass
    msg = None
    try: fn()
    except Exception as e: msg = type(e).__name__ + ': ' + str(e)
    _r[label] = {'refused': bool(msg) and 'internal load of pickle object type' in msg,
                 'sentinel': os.path.exists('/tmp/pwned_fgl'), 'raised': (msg or '')[:160]}
for _nm in ('model', 'brick', 'callback', 'cgo'):
    _ft = int(getattr(loadable, _nm))
    _probe(_nm + '_positional', lambda _ft=_ft: _pin3._load('z_' + _nm, '/tmp/evil.model', 0, _ft, 1, 0))
    _probe(_nm + '_keyword', lambda _ft=_ft: _pin3._load(oname='k_' + _nm, finfo='/tmp/evil.model', state=0, ftype=_ft, finish=1, discrete=0))
json.dumps(_r)
`);

// Control: delete the signature fix in the live runtime and cif must fail with
// the unexpected-keyword error again. It is written for the fix's current shape, the
// __signature__ line; a later fix of another shape (e.g. dropping **kw from the
// wrapper) fails the run below until the control is rewritten for it, so the
// control can never be skipped silently.
const controlApplies = /_guarded_internal_load\.__signature__\s*=/.test(HARDEN_PY);
if (controlApplies) {
  step('control', String.raw`
import json, shutil
del _guarded_internal_load.__signature__
shutil.copyfile('/tmp/fx.cif', '/tmp/in_ctl.cif')
_err = None
try: cmd.load('/tmp/in_ctl.cif', 'ctl', 0, 'cif')
except Exception as e: _err = type(e).__name__ + ': ' + str(e)
json.dumps({'error': (_err or '')[:200], 'loaded': 'ctl' in cmd.get_names()})
`);
}

const report = { ok: false, formats: FORMATS, result };
const failures = [];
function expect(cond, why) { if (!cond) failures.push(why); }

expect(unknown.length === 0, 'worker.js allows a format this test has no load check for: ' + unknown.join(', '));
const saved = (result.start && result.start.saved) || {};
// Only the fixtures the allow-list actually loads must exist (map, mrc reuse ccp4).
const needed = new Set(Object.values(FORMATS).filter((f) => KINDS[f] && KINDS[f] !== 'skip').map((f) => (KINDS[f] === 'map' ? 'ccp4' : f)));
for (const f of needed) expect(typeof saved[f] === 'number' && saved[f] > 0, 'fixture ' + f + ' was not written: ' + saved[f]);
expect(result.install_guard && result.install_guard.allow_count === 18, 'guard install / allow-list count != 18: ' + JSON.stringify(result.install_guard));
const loads = result.loads || {};
expect(!loads.error, 'the load step itself failed: ' + loads.error);
for (const [ext, fmt] of Object.entries(FORMATS)) {
  if (KINDS[fmt] === 'skip' || !(fmt in KINDS)) continue;
  const r = loads[ext] || {};
  const want = KINDS[fmt] === 'map' ? 'object:map' : 'object:molecule';
  expect(r.ok === true && r.type === want && (want !== 'object:molecule' || r.atoms > 0),
    `format ${ext} (${fmt}) did not load through the guard: ` + JSON.stringify(r));
}
expect(loads.cmd_do_cif && loads.cmd_do_cif.ok === true, "cmd.do('load x.cif') did not load: " + JSON.stringify(loads.cmd_do_cif));
expect(loads.importing_load_sdf && loads.importing_load_sdf.ok === true, 'pymol.importing.load(sdf) did not load: ' + JSON.stringify(loads.importing_load_sdf));
expect(loads.signature_has_var_keyword === false, 'the guarded _load still advertises **kwargs to importing.load');
const refusals = result.refusals || {};
expect(!refusals.error, 'the refusal step itself failed: ' + refusals.error);
for (const [label, r] of Object.entries(refusals)) {
  if (label === 'error') continue;
  expect(r.refused === true && r.sentinel === false, `pickle ftype not refused (${label}): ` + JSON.stringify(r));
}
expect(Object.keys(refusals).length === 8, 'expected 8 refusal probes, got ' + Object.keys(refusals).length);
expect(controlApplies, 'control: HARDEN_PY no longer sets _guarded_internal_load.__signature__; rewrite the control for the new fix shape');
if (controlApplies) {
  expect(result.control && /unexpected keyword argument 'filename'/.test(result.control.error) && result.control.loaded === false,
    'control: removing the signature fix did not bring the unexpected-keyword error back (dead path?): ' + JSON.stringify(result.control));
}

report.failures = failures;
report.control_applied = controlApplies;
report.ok = failures.length === 0;
if (reportPath) writeFileSync(reportPath, JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1));
process.exit(report.ok ? 0 : 1);
