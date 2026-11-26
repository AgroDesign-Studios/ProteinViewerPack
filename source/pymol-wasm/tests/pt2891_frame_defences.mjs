// PT-2891 — the viewer frame's untrusted-file defences, exercised in a real
// Pyodide runtime (node, headless PyMOL), the way smoke_wheel.mjs exercises the
// baked-in unpickler. This covers what the frame (worker.js) adds ON TOP of
// patch 0006, which smoke_wheel.mjs does not: the refusal of pickle load
// formats for untrusted files, and the behaviour of the allow-listed numpy reconstructors on crafted input.
//
//   node pt2891_frame_defences.mjs <pyodide-core-dir> <numpy-wheel> <pymol-wheel> <worker.js> [report.json]
//
// The guard Python is EXTRACTED from the shipped worker.js (its HARDEN_PY
// string), so this tests the exact bytes the browser runs rather than a copy.
// Every refusal is paired with a positive control that removes the guard and
// shows the same input executing, so a pass cannot come from a dead path.
// Exit 0 = every expectation held; 1 = one did not (the report says which).
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const [coreDir, numpyWheel, pymolWheel, workerPath, reportPath] = process.argv.slice(2);
if (!workerPath) {
  console.error('usage: node pt2891_frame_defences.mjs <core-dir> <numpy-wheel> <pymol-wheel> <worker.js> [report.json]');
  process.exit(2);
}

// Pull HARDEN_PY (the frame's load-format guard) out of the shipped worker.js.
const workerSrc = readFileSync(workerPath, 'utf8');
const m = workerSrc.match(/const HARDEN_PY = String\.raw`([\s\S]*?)`;/);
if (!m) { console.error('could not find HARDEN_PY in ' + workerPath); process.exit(2); }
const HARDEN_PY = m[1];

const indexURL = path.resolve(coreDir) + '/';
createRequire(import.meta.url)(path.join(indexURL, 'pyodide.js'));
const loadPyodide = globalThis.loadPyodide;
const py = await loadPyodide({ indexURL, stdout: () => {}, stderr: () => {} });
await py.loadPackage([path.resolve(numpyWheel), path.resolve(pymolWheel)], { messageCallback: () => {} });

const result = {};
function step(name, code) {
  try { result[name] = JSON.parse(py.runPython(code)); }
  catch (e) { result[name] = { error: String((e && e.message) || e).split('\n').slice(-3).join(' | ').slice(0, 400) }; }
}

step('start', String.raw`
import json, pickle, os, sys
import pymol, pymol.invocation, pymol2
pymol.invocation.parse_args(['pymol', '-cq'])
_inst = pymol2.SingletonPyMOL(); _inst.start()
from pymol import cmd
import chempy.pkl
_unpickler_active = pickle.loads is chempy.pkl.restricted_loads
json.dumps({'unpickler_active': _unpickler_active})
`);

// Install the SHIPPED guard (HARDEN_PY from worker.js). It asserts the baked-in
// unpickler and installs the five-place load refusal.
step('install_guard', 'import json\n' + HARDEN_PY + "\njson.dumps({'allow_count': _allow_count()})");

// ---- PT-2891 1(a)/1(c): every untrusted-file pickle load path refused -------
// A pickle that writes a sentinel via eval if it is ever unpickled. Each load
// path below must be refused by the frame's load guard for an untrusted
// .pkl/.model/.cc1, and the sentinel must stay absent.
step('load_paths', String.raw`
import json, os
_mk = r'''
import pickle, builtins
class _E:
    def __reduce__(self):
        return (builtins.eval, ("open('/tmp/pwned_g4','w').write('x')",))
_EVIL = pickle.dumps([_E()], 2)
'''
exec(_mk)
for nm in ('evil.pkl','evil.PKL','evil.pkl.gz','evil.pkla','evil.pickle','evil.model','evil.cc1','evil.pdb'):
    open('/tmp/'+nm,'wb').write(_EVIL)

import pymol.importing as _imp
import io, contextlib
_r = {}
def _probe(label, fn):
    before = set(cmd.get_names())
    try: os.remove('/tmp/pwned_g4')
    except Exception: pass
    raised = None
    out = io.StringIO()
    try:
        with contextlib.redirect_stdout(out): fn()
    except Exception as e: raised = type(e).__name__ + ': ' + str(e)[:200]
    new = [o for o in cmd.get_names() if o not in before]
    sentinel = os.path.exists('/tmp/pwned_g4')
    _r[label] = {'blocked': (not new) and (not sentinel), 'raised': raised, 'printed': out.getvalue()[:200], 'loaded': new, 'sentinel': sentinel}

_probe('ext_pkl',     lambda: cmd.load('/tmp/evil.pkl', 'a1'))
_probe('ext_PKL',     lambda: cmd.load('/tmp/evil.PKL', 'a2'))
_probe('ext_pkl_gz',  lambda: cmd.load('/tmp/evil.pkl.gz', 'a3'))
_probe('ext_pkla',    lambda: cmd.load('/tmp/evil.pkla', 'a4'))
_probe('ext_pickle',  lambda: cmd.load('/tmp/evil.pickle', 'a5'))
_probe('ext_model',   lambda: cmd.load('/tmp/evil.model', 'a6'))
_probe('ext_cc1',     lambda: cmd.load('/tmp/evil.cc1', 'a7'))
_probe('fmt_kw_pkl',  lambda: cmd.load('/tmp/evil.pkl', 'b1', format='pkl'))
_probe('fmt_pos_pkl', lambda: cmd.load('/tmp/evil.pkl', 'b2', 0, 'pkl'))
_probe('fmt_model',   lambda: cmd.load('/tmp/evil.pkl', 'b3', format='model'))
_probe('do_load',     lambda: cmd.do('load /tmp/evil.pkl, c1'))
_probe('do_load_fmt', lambda: cmd.do('load /tmp/evil.pkl, c2, format=pkl'))
# PT-4153: a numeric format (cmd.load reads int(format) first) is the same
# pickle type by number: 8 model, 10 brick, 12 callback, 13 cgo. The file is
# named .pdb so the extension check cannot be what refuses it.
_probe('fmt_num_model',    lambda: cmd.load('/tmp/evil.pdb', 'f1', format=8))
_probe('fmt_num_str',      lambda: cmd.load('/tmp/evil.pdb', 'f2', format=' 8 '))
_probe('fmt_pos_brick',    lambda: cmd.load('/tmp/evil.pdb', 'f3', 0, 10))
_probe('fmt_num_callback', lambda: cmd.load('/tmp/evil.pdb', 'f4', format=12))
_probe('fmt_num_cgo',      lambda: cmd.load('/tmp/evil.pdb', 'f5', format=13))
_probe('do_load_num',      lambda: cmd.do('load /tmp/evil.pdb, c3, format=8'))
_probe('do_load_pos_num',  lambda: cmd.do('load /tmp/evil.pdb, c4, 0, 10'))
_probe('load_raw_model', lambda: cmd.load_raw(open('/tmp/evil.pkl','rb').read(), 'model', 'd1'))
_probe('load_raw_pkl',   lambda: cmd.load_raw(open('/tmp/evil.pkl','rb').read(), 'pkl', 'd2'))
_probe('importing_load', lambda: _imp.load('/tmp/evil.model', 'e1'))
# A .model name never reaches pymol.internal._load: PyMOL's filename_to_format
# turns it away first ("unsupported file type"). These two do reach guard (4).
_probe('importing_load_pkl', lambda: _imp.load('/tmp/evil.pkl', 'e2'))
_probe('importing_load_fmt_model', lambda: _imp.load('/tmp/evil.pkl', 'e3', 0, 'model'))
_r['all_blocked'] = all(v['blocked'] for v in _r.values() if isinstance(v, dict))
_r['any_sentinel'] = os.path.exists('/tmp/pwned_g4')
json.dumps(_r)
`);

// Positive control (PT-2891 1(a)): the same payload, read without the frame's
// cmd.* guards, writes the sentinel, so the refusals above come from the
// guards and not from a payload that never runs.
step('load_control', String.raw`
import json, os, builtins, pickle
from chempy import io as _cio
try: os.remove('/tmp/pwned_ctl')
except Exception: pass
class _E:
    def __reduce__(self): return (builtins.eval, ("open('/tmp/pwned_ctl','w').write('x')",))
open('/tmp/ctl.model','wb').write(pickle.dumps([_E()], 2))
_ran = None
try: _cio.pkl.fromFile('/tmp/ctl.model')      # read without the cmd.* guards
except Exception as e: _ran = type(e).__name__
json.dumps({'sentinel_without_guard': os.path.exists('/tmp/pwned_ctl'), 'raised': _ran})
`);

// ---- PT-2891 1(b): a foreign session is opened with wizard/movie stripped ---
// The frame's RESTORE path pops 'wizard' and 'movie' before set_session. Build
// a session carrying a wizard whose nested pickle would run eval, restore it
// the frame's way, and show the sentinel is never written.
step('foreign_wizard', String.raw`
import json, os, pickle, builtins
try: os.remove('/tmp/pwned_wiz')
except Exception: pass
cmd.reinitialize()
cmd.fab('AAAA', 'w'); cmd.show('cartoon', 'w')
sess = cmd.get_session()
class _E:
    def __reduce__(self): return (builtins.eval, ("open('/tmp/pwned_wiz','w').write('x')",))
_payload = pickle.dumps([_E()], 2)
sess['wizard'] = _payload
# the frame's restore path: strip wizard+movie BEFORE set_session.
import copy
stripped = copy.copy(sess)
for k in ('movie', 'wizard'):
    stripped.pop(k, None)
_err = None
try: cmd.set_session(stripped, quiet=1)
except Exception as e: _err = type(e).__name__
_strip_sentinel = os.path.exists('/tmp/pwned_wiz')
# Second layer (control): restore the UNstripped session. The nested wizard
# pickle is unpickled through the baked-in restricted loader, so eval is still
# refused even if a future change forgot to strip -- the sentinel stays absent.
cmd.reinitialize()
_ctl_err = None
try: cmd.set_session(sess, quiet=1)
except Exception as e: _ctl_err = type(e).__name__
json.dumps({'stripped_restore_ran': _err is None, 'sentinel': _strip_sentinel,
            'unstripped_sentinel': os.path.exists('/tmp/pwned_wiz'), 'unstripped_err': _ctl_err})
`);

// ---- PT-2891 2(i): a spoofed-dtype setstate is refused or rejected, not OOB -
step('numpy_dtype_setstate', String.raw`
import json, pickle, numpy
# A reduce whose BUILD state is a crafted "version 3" dtype state. numpy.dtype
# is allow-listed and not in _NEVER_CALLED_DIRECTLY, so REDUCE runs dtype('f8');
# BUILD then calls dtype.__setstate__ with this state.
class _Spoof:
    def __reduce__(self):
        bad = (3, '<', None, None, {'f0': (numpy.dtype('O'), 0), 'x': (numpy.dtype('O'), 1<<40)}, -1, -1, 0)
        return (numpy.dtype, ('f8',), bad)
blob = pickle.dumps(_Spoof(), 2)
outcome = 'unexpected'
try:
    d = pickle.loads(blob)           # restricted unpickler
    outcome = 'loaded:' + repr(str(d))[:40]
except Exception as e:
    outcome = 'rejected:' + type(e).__name__
# the runtime is still alive after the attempt
alive = int(numpy.arange(4).sum())
json.dumps({'outcome': outcome, 'alive': alive})
`);

// ---- PT-2891 2(ii): scalar() checks its buffer length ----------------------
step('numpy_scalar_buflen', String.raw`
import json, pickle, numpy
scalar = numpy.core.multiarray.scalar
# scalar(dtype, data): a void/structured dtype 16 bytes wide from 1 byte must
# not read 15 bytes past the buffer.
class _S:
    def __reduce__(self):
        return (scalar, (numpy.dtype('V16'), b'\x00'))
blob = pickle.dumps(_S(), 2)
outcome = 'unexpected'
try:
    v = pickle.loads(blob)
    # force materialisation of the bytes
    outcome = 'loaded:' + repr(bytes(v))[:40]
except Exception as e:
    outcome = 'rejected:' + type(e).__name__
alive = int(numpy.arange(4).sum())
json.dumps({'outcome': outcome, 'alive': alive})
`);

// ---- PT-2891 2(iii): a huge-allocation REDUCE raises, it does not abort -----
step('numpy_huge_alloc', String.raw`
import json, pickle, builtins, numpy
_r = {}
# (a) builtins.bytes(huge_int) — allow-listed, a bounded single allocation.
class _B:
    def __reduce__(self): return (builtins.bytes, (1 << 40,))
try:
    pickle.loads(pickle.dumps(_B(), 2)); _r['bytes'] = 'loaded'
except Exception as e: _r['bytes'] = 'raised:' + type(e).__name__
# (b) _reconstruct(ndarray, huge_shape, dtype) via a REDUCE.
recon = numpy.core.multiarray._reconstruct
class _R:
    def __reduce__(self): return (recon, (numpy.ndarray, (1 << 40,), b'b'))
try:
    pickle.loads(pickle.dumps(_R(), 2)); _r['reconstruct'] = 'loaded'
except Exception as e: _r['reconstruct'] = 'raised:' + type(e).__name__
_r['alive'] = int(numpy.arange(4).sum())
json.dumps(_r)
`);

const report = { ok: false, result };
function expect(cond, why) { report.failures = report.failures || []; if (!cond) report.failures.push(why); }

expect(result.start && result.start.unpickler_active === true, 'baked-in unpickler not active on import pymol');
expect(result.install_guard && result.install_guard.allow_count === 18, 'guard install / allow-list count != 18');
expect(result.load_paths && result.load_paths.all_blocked === true && result.load_paths.any_sentinel === false,
  'a .pkl/model/cc1 load path was not blocked: ' + JSON.stringify(result.load_paths));
// "Blocked" alone counts ANY exception, so each raising probe must also carry
// the refusal of the guard place it targets (PT-3600 item 2). do_load and
// do_load_fmt are in PRINTED_BY instead: cmd.do's parser catches the refusal
// and prints it (pymol/parser.py, colorprinting.error = print).
const GUARD_1_3 = 'refused by the AgDB viewer';
const GUARD_4 = 'internal load of pickle object type';
const REFUSED_BY = {
  ext_pkl: GUARD_1_3, ext_PKL: GUARD_1_3, ext_pkl_gz: GUARD_1_3, ext_pkla: GUARD_1_3,
  ext_pickle: GUARD_1_3, ext_model: GUARD_1_3, ext_cc1: GUARD_1_3,
  fmt_kw_pkl: GUARD_1_3, fmt_pos_pkl: GUARD_1_3, fmt_model: GUARD_1_3,
  fmt_num_model: GUARD_1_3, fmt_num_str: GUARD_1_3, fmt_pos_brick: GUARD_1_3,
  fmt_num_callback: GUARD_1_3, fmt_num_cgo: GUARD_1_3,
  load_raw_model: GUARD_1_3, load_raw_pkl: GUARD_1_3,
  importing_load_pkl: GUARD_4, importing_load_fmt_model: GUARD_4,
  // PyMOL's own refusal, kept so the report says this probe never tested guard (4).
  importing_load: 'unsupported file type',
};
for (const [label, msg] of Object.entries(REFUSED_BY)) {
  const r = result.load_paths && result.load_paths[label];
  expect(r && String(r.raised).includes(msg), `${label} was not refused with "${msg}": ` + JSON.stringify(r));
}
// Without guard (2)'s cmd.extend the keyword table keeps the unguarded load,
// and these still load nothing — guard (4) stops them with its own text.
// So the printed refusal, not the outcome, is what shows guard (2) answered.
const PRINTED_BY = { do_load: GUARD_1_3, do_load_fmt: GUARD_1_3, do_load_num: GUARD_1_3, do_load_pos_num: GUARD_1_3 };
for (const [label, msg] of Object.entries(PRINTED_BY)) {
  const r = result.load_paths && result.load_paths[label];
  expect(r && String(r.printed).includes(msg), `${label} did not print the refusal "${msg}": ` + JSON.stringify(r));
}
expect(result.load_control && result.load_control.sentinel_without_guard === true,
  'positive control did not execute without the guard (path may be dead): ' + JSON.stringify(result.load_control));
expect(result.foreign_wizard && result.foreign_wizard.stripped_restore_ran === true
  && result.foreign_wizard.sentinel === false && result.foreign_wizard.unstripped_sentinel === false,
  'foreign session wizard not stripped / nested pickle ran: ' + JSON.stringify(result.foreign_wizard));
// 2(i): the security invariant is no OOB abort. numpy either rejects the state
// or validates/ignores it for a scalar dtype; both are safe. A crash would have
// killed the runtime (alive would be absent, caught as .error).
expect(result.numpy_dtype_setstate && result.numpy_dtype_setstate.alive === 6,
  'spoofed dtype setstate aborted the runtime (OOB): ' + JSON.stringify(result.numpy_dtype_setstate));
expect(result.numpy_scalar_buflen && String(result.numpy_scalar_buflen.outcome).startsWith('rejected') && result.numpy_scalar_buflen.alive === 6,
  'scalar() buffer-length not checked / runtime unusable: ' + JSON.stringify(result.numpy_scalar_buflen));
expect(result.numpy_huge_alloc && String(result.numpy_huge_alloc.bytes).startsWith('raised')
  && String(result.numpy_huge_alloc.reconstruct).startsWith('raised') && result.numpy_huge_alloc.alive === 6,
  'a huge allocation aborted instead of raising: ' + JSON.stringify(result.numpy_huge_alloc));

report.ok = !report.failures || report.failures.length === 0;
if (reportPath) writeFileSync(reportPath, JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1));
process.exit(report.ok ? 0 : 1);
