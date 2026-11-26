// What the frame's `load` message does on the REAL runtime
// (node, headless PyMOL), now that the allow-list carries the three density
// map formats. Modelled on pt2891_frame_defences.mjs, which it does not replace
// (run both on a worker.js change):
//
//   node frame_load_formats.mjs <pyodide-core-dir> <numpy-wheel> <pymol-wheel> <worker.js> [report.json]
//
// Everything the frame runs is EXTRACTED from the shipped worker.js — the
// guard (HARDEN_PY) and the allow-list (FORMATS) — and every load goes the
// worker's way: the bytes written to /tmp/in_<obj>.<fmt>, then
// cmd.load(fn, obj, 0, FORMATS[ext]). It checks:
//   1. the allow-list never names a pickle or script format;
//   2. every allowed format (but pse / mae, which have their own paths) loads
//      through the guard — the regression the guard's signature line fixes,
//      with a positive control that drops that line and shows cif failing;
//   3. the map formats load as map objects, normalised to sigma, and isomesh
//      draws from them;
//   4. a pickle disguised as a map runs nothing, under any of the three names;
//   5. pkl/model is still refused after the signature change at the four
//      guard places this runtime reaches — cmd.load (by name and by format),
//      cmd.do('load ...'), cmd.load_raw and pymol.internal._load through
//      pymol.importing.load — each by the guard's OWN message where the call
//      raises (cmd.do's parser catches it and prints it, so that one is
//      judged by the printed message).
//      The fifth place, the frame's format list, is the vitest
//      pymolWorkerLoad / pymolFrameProtocol tests'.
// Exit 0 = every expectation held; 1 = one did not (the report says which).
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const [coreDir, numpyWheel, pymolWheel, workerPath, reportPath] = process.argv.slice(2);
if (!workerPath) {
  console.error('usage: node frame_load_formats.mjs <core-dir> <numpy-wheel> <pymol-wheel> <worker.js> [report.json]');
  process.exit(2);
}

const workerSrc = readFileSync(workerPath, 'utf8');
const harden = workerSrc.match(/const HARDEN_PY = String\.raw`([\s\S]*?)`;/);
const formatsSrc = workerSrc.match(/const FORMATS = (\{[^}]*\});/);
const mapsSrc = workerSrc.match(/const MAP_FORMATS = new Set\((\[[^\]]*\])\);/);
if (!harden || !formatsSrc || !mapsSrc) { console.error('could not find HARDEN_PY / FORMATS / MAP_FORMATS in ' + workerPath); process.exit(2); }
const HARDEN_PY = harden[1];
// An object literal of string keys and string values; parsed, not evaluated.
const FORMATS = JSON.parse(formatsSrc[1].replace(/(\w+):/g, '"$1":').replace(/'/g, '"'));
const MAP_FORMATS = JSON.parse(mapsSrc[1].replace(/'/g, '"'));

const indexURL = path.resolve(coreDir) + '/';
createRequire(import.meta.url)(path.join(indexURL, 'pyodide.js'));
const py = await globalThis.loadPyodide({ indexURL, stdout: () => {}, stderr: () => {} });
await py.loadPackage([path.resolve(numpyWheel), path.resolve(pymolWheel)], { messageCallback: () => {} });

const result = {};
function step(name, code, opts) {
  try { result[name] = JSON.parse(py.runPython(code, opts)); }
  catch (e) { result[name] = { error: String((e && e.message) || e).split('\n').slice(-3).join(' | ').slice(0, 400) }; }
}

// Fixtures, made by PyMOL itself before the guard goes in: a peptide in each
// molecular format, and a CCP4/MRC map written by hand (mode 2, float32) with
// a gaussian at every atom, deliberately NOT normalised (mean 0.42, sd 0.72).
step('fixtures', String.raw`
import json, struct, os
import numpy as np
import pymol, pymol.invocation, pymol2
pymol.invocation.parse_args(['pymol', '-cq'])
_inst = pymol2.SingletonPyMOL(); _inst.start()
from pymol import cmd
cmd.fab('AAAAAAAA', 'pep')
for ext in ('cif', 'pdb', 'sdf', 'mol', 'mol2', 'xyz'):
    cmd.save('/tmp/fx.' + ext, 'pep')
m = cmd.get_model('pep')
xyz = np.array([a.coord for a in m.atom])
lo = np.floor(xyz.min(0) - 4.0)
n = 24
grid = np.zeros((n, n, n), dtype=np.float32)
pts = np.indices((n, n, n)).reshape(3, -1).T + lo
for c in xyz:
    grid.reshape(-1)[:] += np.exp(-((pts - c) ** 2).sum(1)).astype(np.float32)
grid = grid * 5.0 + 0.3
hdr = bytearray(1024)
struct.pack_into('<3i', hdr, 0, n, n, n)
struct.pack_into('<i', hdr, 12, 2)
struct.pack_into('<3i', hdr, 16, *[int(v) for v in lo])
struct.pack_into('<3i', hdr, 28, n, n, n)
struct.pack_into('<3f', hdr, 40, float(n), float(n), float(n))
struct.pack_into('<3f', hdr, 52, 90.0, 90.0, 90.0)
struct.pack_into('<3i', hdr, 64, 1, 2, 3)
data = np.ascontiguousarray(grid.transpose(2, 1, 0)).astype('<f4')
struct.pack_into('<3f', hdr, 76, float(data.min()), float(data.max()), float(data.mean()))
struct.pack_into('<i', hdr, 88, 1)
hdr[208:212] = b'MAP '
hdr[212:216] = bytes([0x44, 0x41, 0, 0])
struct.pack_into('<f', hdr, 216, float(data.std()))
open('/tmp/fx.map', 'wb').write(bytes(hdr) + data.tobytes())
cmd.delete('all')
json.dumps({'map_bytes': os.path.getsize('/tmp/fx.map'), 'raw_mean': round(float(data.mean()), 3), 'raw_sd': round(float(data.std()), 3)})
`);

step('install_guard', 'import json\n' + HARDEN_PY + "\njson.dumps({'allow_count': _allow_count()})");

// The worker's load, verbatim in shape.
const WORKER_LOAD = String.raw`
def _worker_load(src, obj, fmt):
    fn = '/tmp/in_' + obj + '.' + fmt
    open(fn, 'wb').write(open(src, 'rb').read())
    err = None
    try:
        cmd.load(fn, obj, 0, fmt)
    except Exception as e:
        err = type(e).__name__ + ': ' + str(e)[:200]
    finally:
        try: os.remove(fn)
        except Exception: pass
    return err
`;

const fixtureFor = (ext) => (MAP_FORMATS.includes(ext) ? '/tmp/fx.map' : '/tmp/fx.' + FORMATS[ext]);
const loadable = Object.keys(FORMATS).filter((ext) => ext !== 'pse' && ext !== 'mae');
step('allowed_formats_load', String.raw`
import json, os
${WORKER_LOAD}
_r = {}
for ext, fmt, src in ${JSON.stringify(loadable.map((ext) => [ext, FORMATS[ext], fixtureFor(ext)]))}:
    obj = 'o_' + ext
    err = _worker_load(src, obj, fmt)
    ok = obj in cmd.get_names()
    _r[ext] = {'err': err, 'loaded': ok, 'type': cmd.get_type(obj) if ok else None}
json.dumps(_r)
`);

step('maps', String.raw`
import json
_r = {}
for ext in ${JSON.stringify(MAP_FORMATS)}:
    obj = 'o_' + ext
    if obj in cmd.get_names():
        h = list(cmd.get_volume_histogram(obj))[:4]
        _r[ext] = {'min_max_mean_sd': [round(x, 3) for x in h]}
cmd.load('/tmp/fx.cif', 'rec', 0, 'cif')
cmd.do('isomesh mesh_pos, o_ccp4, 1.0, rec, buffer=2.0, carve=2.0')
cmd.do('isomesh mesh_neg, o_ccp4, -3.0, rec, buffer=5.0, carve=5.0')
_r['isomesh'] = {'pos': 'mesh_pos' in cmd.get_names(), 'neg': 'mesh_neg' in cmd.get_names(),
                 'pos_type': cmd.get_type('mesh_pos') if 'mesh_pos' in cmd.get_names() else None}
json.dumps(_r)
`);

// A pickle that writes a sentinel if anything ever unpickles it, handed over
// under each map name. The map reader parses a binary header; nothing may run.
step('pickle_as_map', String.raw`
import json, os, pickle, builtins
${WORKER_LOAD}
class _E:
    def __reduce__(self): return (builtins.eval, ("open('/tmp/pwned_map','w').write('x')",))
open('/tmp/evil.bin', 'wb').write(pickle.dumps([_E()], 2))
_r = {}
for fmt in ${JSON.stringify(MAP_FORMATS)}:
    try: os.remove('/tmp/pwned_map')
    except Exception: pass
    obj = 'evil_' + fmt
    err = _worker_load('/tmp/evil.bin', obj, fmt)
    _r[fmt] = {'err': (err or '')[:120], 'created': obj in cmd.get_names(), 'sentinel': os.path.exists('/tmp/pwned_map')}
json.dumps(_r)
`);

// The guard's refusals after the signature change (the full set, with
// controls, is pt2891_frame_defences.mjs). Each raising probe keeps its
// message, so a pass needs the guard's own refusal, not any exception. The
// importing.load probes use a .pkl name and format='model': a .model name is
// turned away by PyMOL's own filename_to_format ("unsupported file type")
// before pymol.internal._load, so it never reached guard (4) (PT-3609).
step('refusals', String.raw`
import json, os, pickle, builtins, io, contextlib
import pymol.importing as _imp
class _E:
    def __reduce__(self): return (builtins.eval, ("open('/tmp/pwned_ref','w').write('x')",))
open('/tmp/r.pkl', 'wb').write(pickle.dumps([_E()], 2))
_r = {}
for label, fn in (('cmd_load_pkl', lambda: cmd.load('/tmp/r.pkl', 'r1')),
                  ('cmd_load_fmt_model', lambda: cmd.load('/tmp/r.pkl', 'r2', 0, 'model')),
                  ('do_load_pkl', lambda: cmd.do('load /tmp/r.pkl, r3')),
                  ('load_raw_model', lambda: cmd.load_raw(open('/tmp/r.pkl', 'rb').read(), 'model', 'r4')),
                  ('importing_load_pkl', lambda: _imp.load('/tmp/r.pkl', 'r5')),
                  ('importing_load_fmt_model', lambda: _imp.load('/tmp/r.pkl', 'r6', 0, 'model'))):
    before = set(cmd.get_names())
    try: os.remove('/tmp/pwned_ref')
    except Exception: pass
    err = None
    out = io.StringIO()
    try:
        with contextlib.redirect_stdout(out): fn()
    except Exception as e: err = type(e).__name__ + ': ' + str(e)[:200]
    _r[label] = {'new': [o for o in cmd.get_names() if o not in before], 'sentinel': os.path.exists('/tmp/pwned_ref'), 'err': err, 'printed': out.getvalue()[:200]}
_r['all_blocked'] = all(not v['new'] and not v['sentinel'] for v in _r.values())
json.dumps(_r)
`);

// Positive control for check 2: the same guard with the signature line taken
// out, wrapped over the live one, and a cif load fails the way it did before.
// In a namespace of its own: the guard keeps its originals in module globals
// (_orig_load, ...), so a second copy in the SAME namespace would rebind the
// first copy's original to itself and recurse.
const withoutSignature = HARDEN_PY.replace(/^_guarded_internal_load\.__signature__ = .*$/m, '');
step('control_without_signature', 'import json, os\nfrom pymol import cmd\n' + withoutSignature + '\n' + WORKER_LOAD + String.raw`
err = _worker_load('/tmp/fx.cif', 'ctl_cif', 'cif')
json.dumps({'err': err, 'loaded': 'ctl_cif' in cmd.get_names(), 'line_removed': ${withoutSignature !== HARDEN_PY ? 'True' : 'False'}})
`, { globals: py.globals.get('dict')() });

const report = { ok: false, formats: FORMATS, map_formats: MAP_FORMATS, result };
const failures = [];
const expect = (cond, why) => { if (!cond) failures.push(why); };

const BANNED = ['pkl', 'pkla', 'pickle', 'model', 'brick', 'callback', 'cgo', 'cc1', 'cc2', 'py', 'pml', 'pym', 'psw', 'pze'];
for (const b of BANNED) expect(!(b in FORMATS) && !Object.values(FORMATS).includes(b), 'the allow-list names a banned format: ' + b);
expect(JSON.stringify([...MAP_FORMATS].sort()) === JSON.stringify(['ccp4', 'map', 'mrc']), 'MAP_FORMATS is not ccp4/map/mrc: ' + JSON.stringify(MAP_FORMATS));
expect(result.install_guard && result.install_guard.allow_count === 18, 'guard install / allow-list count != 18');
for (const ext of loadable) {
  const r = result.allowed_formats_load && result.allowed_formats_load[ext];
  const want = MAP_FORMATS.includes(ext) ? 'object:map' : 'object:molecule';
  expect(r && r.loaded === true && r.err === null && r.type === want, `allowed format ${ext} did not load as ${want}: ` + JSON.stringify(r));
}
for (const ext of MAP_FORMATS) {
  const h = result.maps && result.maps[ext] && result.maps[ext].min_max_mean_sd;
  expect(h && Math.abs(h[2]) < 0.01 && Math.abs(h[3] - 1) < 0.01, `map ${ext} was not normalised to sigma: ` + JSON.stringify(h));
}
expect(result.maps && result.maps.isomesh && result.maps.isomesh.pos === true && result.maps.isomesh.neg === true,
  'isomesh drew nothing from a loaded map: ' + JSON.stringify(result.maps && result.maps.isomesh));
for (const fmt of MAP_FORMATS) {
  const r = result.pickle_as_map && result.pickle_as_map[fmt];
  expect(r && r.sentinel === false, `a pickle loaded as ${fmt} ran: ` + JSON.stringify(r));
}
expect(result.refusals && result.refusals.all_blocked === true, 'a pkl/model path was not refused: ' + JSON.stringify(result.refusals));
// Which guard place must answer each raising probe, by its own message.
// do_load_pkl is in PRINTED_BY instead: cmd.do's parser catches the refusal
// and prints it.
const REFUSED_BY = {
  cmd_load_pkl: 'refused by the AgDB viewer',
  cmd_load_fmt_model: 'refused by the AgDB viewer',
  load_raw_model: 'refused by the AgDB viewer',
  importing_load_pkl: 'internal load of pickle object type',
  importing_load_fmt_model: 'internal load of pickle object type',
};
for (const [label, msg] of Object.entries(REFUSED_BY)) {
  const r = result.refusals && result.refusals[label];
  expect(r && String(r.err).includes(msg), `${label} was not refused by the guard itself ("${msg}"): ` + JSON.stringify(r));
}
// Without cmd.extend('load') the command line keeps the unguarded load and
// guard (4) stops it with its own text, so only the printed refusal shows
// that the command-line guard answered.
const PRINTED_BY = { do_load_pkl: 'refused by the AgDB viewer' };
for (const [label, msg] of Object.entries(PRINTED_BY)) {
  const r = result.refusals && result.refusals[label];
  expect(r && String(r.printed).includes(msg), `${label} did not print the guard's refusal ("${msg}"): ` + JSON.stringify(r));
}
const ctl = result.control_without_signature;
expect(ctl && ctl.line_removed === true && ctl.loaded === false && String(ctl.err).includes("unexpected keyword argument 'filename'"),
  'positive control: without the signature line a cif load should fail with the _load TypeError: ' + JSON.stringify(ctl));

report.failures = failures;
report.ok = failures.length === 0;
if (reportPath) writeFileSync(reportPath, JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1));
process.exit(report.ok ? 0 : 1);
