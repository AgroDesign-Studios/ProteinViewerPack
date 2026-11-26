// numpy unpacked at its first import (worker.js deferNumpy / unpackNumpy /
// NUMPY_PY, PT-9554 S2-2 (2)) on the REAL runtime (node, headless PyMOL).
// Modelled on frame_gl_defaults.mjs and hand-run like it, under the host
// guard (a node Pyodide reaches the host shell otherwise):
//
//   node --import pymol-wasm/bench/lib/guard_preload.mjs pymol-wasm/tests/frame_lazy_numpy.mjs \
//        <pyodide-core-dir> <numpy-wheel> <pymol-wheel> <worker.js> [report.json]
//
// The runtime's lock is NOT an argument: it is <dir of the pymol wheel>/
// pyodide-lock.json, the version dir's own, and the numpy wheel must sit in
// that same dir (it is the packageBaseUrl, as the worker's BASE is). Every
// Pyodide here boots through that lock as the worker does:
//   loadPyodide({ indexURL: <core>/, lockFileContents, packageBaseUrl: <wheel dir>/ })
//   ... deferNumpy() ... py.loadPackage(['pymol'])
// The worker's OWN JS is run: the source from `let NUMPY_WHEEL = null;`
// through the end of `function unpackNumpy() {...}` is EXTRACTED and
// evaluated with py, ASSETS, assetUrl and SITE_PACKAGES (extracted too) as
// its free names; ASSETS holds the numpy wheel as an ArrayBuffer under
// assetUrl(<its lock file_name>) (a node Buffer is refused by unpackArchive).
// Then, as init does when deferNumpy() said yes, `_agdb_numpy` is registered
// with {unpack} (wrapped here only to count the calls) and NUMPY_PY runs;
// PyMOL boots headless (as frame_gl_defaults) and HARDEN_PY, GL_PY and the
// boot call _agdb_gl_defaults() run, all extracted. Six boots, each its own
// Pyodide in this process:
//   lazy     the handed wheel; checks 1, 2
//   eager    no wheel handed (ASSETS {}): the fallback, check 5; and the
//            reference fnab coordinates, a numpy pickle and a .pse holding a
//            numpy array in pymol.session (made with numpy loaded eagerly)
//   pickle   a fresh lazy boot: check 3, the restricted unpickler's import
//   pse      a fresh lazy boot: check 3, RESTORE_PY of that .pse
//   corrupt  a lazy boot handed a truncated copy of the wheel: check 4
//   nofinder control: the lock mutated, NUMPY_PY never run: check 6
// Checks:
//   1. deferNumpy() true; the parsed lock's pymol.depends lacks numpy;
//      loadPackage loaded only pymol; after the boot no site-packages/numpy
//      and no 'numpy' in sys.modules, nothing unpacked, the wheel still held.
//   2. the first cmd.get_coords works and unpacks exactly once, the wheel is
//      let go, a second one unpacks nothing; numpy is the lock's version;
//      linalg / fft / random work; fnab ATGC has 164 atoms at exactly the
//      eager boot's coordinates.
//   3. a numpy array pickled with protocol 2 comes back equal through
//      chempy.pkl.restricted_loads in a boot where nothing imported numpy
//      (that import unpacks it); RESTORE_PY of a .pse whose pymol.session
//      holds a numpy array restores it.
//   4. a corrupt wheel: `import numpy` raises ImportError (not a bare
//      ModuleNotFoundError) starting 'numpy could not be unpacked', again on
//      the second try; cmd.fab still works.
//   5. ASSETS without numpy: deferNumpy() false, depends unchanged,
//      loadPackage loads numpy too.
//   6. controls: without the finder `import numpy` is ModuleNotFoundError and
//      get_coords, the numpy pickle and the .pse restore all fail (the finder
//      is what makes them work); in init's source deferNumpy() comes before
//      loadPackage( and the registerJsModule('_agdb_numpy' / NUMPY_PY lines
//      after `ASSETS = {};` and before START_PY (with a control showing the
//      order check fails on a reordered copy).
// The eager boot is the positive control of check 1 (numpy dir present,
// numpy loaded), the lazy boot after get_coords of the sys.modules probe.
// Recorded, not judged (timings vary from run to run; the parent times things alone): the
// unpack ms and the first get_coords ms.
// Exit 0 = every expectation held; 1 = one did not (the report's `failures`
// says which); 2 = usage / extraction error.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const [coreDir, numpyWheel, pymolWheel, workerPath, reportPath] = process.argv.slice(2);
if (!workerPath) {
  console.error('usage: node --import pymol-wasm/bench/lib/guard_preload.mjs frame_lazy_numpy.mjs <core-dir> <numpy-wheel> <pymol-wheel> <worker.js> [report.json]');
  console.error('       (the lock is <dir of pymol-wheel>/pyodide-lock.json; the numpy wheel must be in the same dir)');
  process.exit(2);
}

const failures = [];
const results = [];
const measured = {};
function finish(code) {
  const ok = code === 0 && failures.length === 0;
  const report = { ok, failures, results, measured, worker: path.resolve(workerPath) };
  if (reportPath) writeFileSync(reportPath, JSON.stringify(report, null, 1));
  for (const r of results) console.log((r.ok ? 'ok   ' : 'FAIL ') + r.name + ': ' + JSON.stringify(r.got) + (r.ok ? '' : ' (want ' + JSON.stringify(r.want) + ')'));
  if (measured.info_only) console.log('info (not judged): ' + JSON.stringify(measured.info_only));
  console.log(JSON.stringify({ ok, failures: failures.length, results: results.length }));
  process.exit(code !== 0 ? code : (ok ? 0 : 1));
}
function expect(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  results.push({ name, got, want, ok });
  if (!ok) failures.push(name + ': got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}

// ---- extraction ----------------------------------------------------------------
const workerSrc = readFileSync(workerPath, 'utf8');
const extractErr = [];
const sp = workerSrc.match(/const SITE_PACKAGES = '([^']+)';/);
const jsStart = workerSrc.indexOf('let NUMPY_WHEEL = null;');
const unpackAt = jsStart < 0 ? -1 : workerSrc.indexOf('\nfunction unpackNumpy() {', jsStart);
const unpackEnd = unpackAt < 0 ? -1 : workerSrc.indexOf('\n}\n', unpackAt);
const JS_SRC = unpackEnd < 0 ? null : workerSrc.slice(jsStart, unpackEnd + 2);
const numpyPy = workerSrc.match(/const NUMPY_PY = String\.raw`([\s\S]*?)`;/);
const harden = workerSrc.match(/const HARDEN_PY = String\.raw`([\s\S]*?)`;/);
const gl = workerSrc.match(/const GL_PY = String\.raw`([\s\S]*?)`;/);
const restore = workerSrc.match(/const RESTORE_PY = String\.raw`([\s\S]*?)`;/);
const initAt = workerSrc.indexOf('\nasync function init(m) {\n');
const initSrc = initAt < 0 ? '' : workerSrc.slice(initAt, workerSrc.indexOf('\n}\n', initAt) + 3);
if (!sp) extractErr.push('SITE_PACKAGES not found');
if (!JS_SRC) extractErr.push('the block from `let NUMPY_WHEEL = null;` to the end of `function unpackNumpy()` not found');
if (JS_SRC && !JS_SRC.includes('function deferNumpy()')) extractErr.push('deferNumpy() is not inside that block');
if (!numpyPy) extractErr.push('NUMPY_PY not found');
if (!harden) extractErr.push('HARDEN_PY not found');
if (!gl) extractErr.push('GL_PY not found');
if (!restore) extractErr.push('RESTORE_PY not found');
if (!initSrc) extractErr.push('async function init not found');
if (!workerSrc.includes("py.runPython('_agdb_gl_defaults()');")) extractErr.push('init does not call _agdb_gl_defaults()');

const wheelDir = path.dirname(path.resolve(pymolWheel));
const lockPath = path.join(wheelDir, 'pyodide-lock.json');
let lockText = null, lock = null;
try { lockText = readFileSync(lockPath, 'utf8'); lock = JSON.parse(lockText); } catch (e) { extractErr.push('no readable lock at ' + lockPath + ': ' + String(e.message || e).slice(0, 120)); }
if (path.dirname(path.resolve(numpyWheel)) !== wheelDir) extractErr.push('the numpy wheel is not in the pymol wheel\'s dir (the packageBaseUrl)');
const NP = lock && lock.packages && lock.packages.numpy, PM = lock && lock.packages && lock.packages.pymol;
if (lock && (!NP || NP.file_name !== path.basename(numpyWheel))) extractErr.push('the lock\'s numpy file_name is not ' + path.basename(numpyWheel));
if (lock && (!PM || PM.file_name !== path.basename(pymolWheel))) extractErr.push('the lock\'s pymol file_name is not ' + path.basename(pymolWheel));
if (PM && !(Array.isArray(PM.depends) && PM.depends.includes('numpy'))) extractErr.push('the lock\'s pymol entry does not depend on numpy (nothing to defer)');
if (extractErr.length) {
  for (const e of extractErr) failures.push('extraction: ' + e);
  console.error('extraction failed: ' + extractErr.join('; '));
  finish(2);
}
const SITE_PACKAGES = sp[1];
const NUMPY_PY = numpyPy[1], HARDEN_PY = harden[1], GL_PY = gl[1], RESTORE_PY = restore[1];
measured.lock = { path: lockPath, pymol_depends_in_file: PM.depends, numpy_version: NP.version };

// ---- runtime -------------------------------------------------------------------
const indexURL = path.resolve(coreDir) + '/';
createRequire(import.meta.url)(path.join(indexURL, 'pyodide.js'));
const BASE_URL = pathToFileURL(wheelDir + '/').href;
const assetUrl = (file) => new URL(file, BASE_URL).href;    // the worker's: new URL(BASE + file, location.href).href
const npBytes = readFileSync(path.resolve(numpyWheel));
const npBuffer = () => npBytes.buffer.slice(npBytes.byteOffset, npBytes.byteOffset + npBytes.byteLength);
const errText = (e) => String((e && e.message) || e).trim().split('\n').slice(-2).join(' | ').slice(0, 300);
const toJs = (v) => (v && typeof v.toJs === 'function' ? v.toJs({ dict_converter: Object.fromEntries }) : v);

// The test's helpers (prefixed _t_; they import nothing that imports numpy).
const HELPERS_PY = String.raw`
import json as _t_json, os as _t_os, sys as _t_sys
def _t_state():
    return _t_json.dumps({'numpy_in_modules': 'numpy' in _t_sys.modules,
                          'numpy_dir': _t_os.path.isdir('${SITE_PACKAGES}/numpy')})
def _t_attempt(src):
    # Run src; say what it raised (the exact type), or None.
    try:
        exec(src, globals())
        return _t_json.dumps({'raised': None})
    except BaseException as e:
        return _t_json.dumps({'raised': type(e).__name__, 'msg': str(e)[:400]})
`;
// PyMOL headless, as frame_gl_defaults boots it.
const BOOT_PY = String.raw`
import json
import pymol, pymol.invocation, pymol2
pymol.invocation.parse_args(['pymol', '-cq'])
_inst = pymol2.SingletonPyMOL(); _inst.start()
from pymol import cmd
`;

// One boot, the worker's way up to START_PY. assets: 'good' | 'corrupt' | 'none'.
async function boot(label, assets, finder) {
  const out = { label, stderr: [], unpack: { calls: 0, ms: [], errors: [] } };
  const py = await globalThis.loadPyodide({ indexURL, lockFileContents: lockText, packageBaseUrl: wheelDir + '/',
    stdout: () => {}, stderr: (s) => out.stderr.push(String(s)) });
  const ASSETS = {};
  if (assets === 'good') ASSETS[assetUrl(NP.file_name)] = npBuffer();
  if (assets === 'corrupt') ASSETS[assetUrl(NP.file_name)] = npBuffer().slice(0, Math.floor(npBytes.byteLength / 2));
  const w = new Function('py', 'ASSETS', 'assetUrl', 'SITE_PACKAGES',
    JS_SRC + '\n; return { deferNumpy, unpackNumpy, held: () => NUMPY_WHEEL };')(py, ASSETS, assetUrl, SITE_PACKAGES);
  out.deferred = w.deferNumpy();
  out.depends = Array.from(py.lockfile.packages.pymol.depends);
  await py.loadPackage(['pymol'], { messageCallback: () => {} });
  out.loaded = Object.keys(py.loadedPackages).sort();
  out.numpy_dir_after_loadPackage = py.FS.analyzePath(SITE_PACKAGES + '/numpy').exists;
  if (finder && out.deferred) {     // init: `if (lazyNumpy) { registerJsModule; runPython(NUMPY_PY) }`
    py.registerJsModule('_agdb_numpy', { unpack: () => {
      out.unpack.calls++;
      const t = performance.now();
      try { return w.unpackNumpy(); }
      catch (e) { out.unpack.errors.push(String((e && e.message) || e).slice(0, 200)); throw e; }
      finally { out.unpack.ms.push(+(performance.now() - t).toFixed(1)); }
    } });
    py.runPython(NUMPY_PY);
    out.finder = true;
  } else out.finder = false;
  py.runPython(HELPERS_PY);
  const R = (code) => { try { return toJs(py.runPython(code)); } catch (e) { return { error: errText(e) }; } };
  const J = (code) => { const v = R(code); return typeof v === 'string' ? JSON.parse(v) : v; };
  const attempt = (src) => JSON.parse(py.globals.get('_t_attempt')(src));
  const bootPyMOL = () => {
    try {
      py.runPython(BOOT_PY); py.runPython(HARDEN_PY); py.runPython(GL_PY); py.runPython('_agdb_gl_defaults()');
      return null;
    } catch (e) { failures.push(label + ': PyMOL boot raised ' + errText(e)); return errText(e); }
  };
  return { py, w, out, R, J, attempt, bootPyMOL };
}
const tail = (b) => ({ deferred: b.out.deferred, finder: b.out.finder, loaded: b.out.loaded, unpack: b.out.unpack, stderr_tail: b.out.stderr.slice(-5) });
const info = {};
measured.info_only = info;

// ---- lazy: checks 1, 2 ---------------------------------------------------------
const A = await boot('lazy', 'good', true);
expect('1. deferNumpy() with the wheel handed', A.out.deferred, true);
expect("1. the parsed lock's pymol.depends after deferNumpy() lacks numpy", A.out.depends.includes('numpy'), false);
expect("1. loadPackage(['pymol']) loaded", A.out.loaded, ['pymol']);
expect('1. after loadPackage: no site-packages/numpy', A.out.numpy_dir_after_loadPackage, false);
A.bootPyMOL();
const aBoot = A.J('_t_state()');
expect('1. after the boot (pymol, HARDEN_PY, GL_PY): no site-packages/numpy', aBoot.numpy_dir, false);
expect("1. after the boot: 'numpy' not in sys.modules", aBoot.numpy_in_modules, false);
expect('1. after the boot: nothing unpacked', A.out.unpack.calls, 0);
expect('1. after the boot: the wheel is still held', A.w.held() !== null, true);

A.R("cmd.fab('AGK', 'pep')");
const tc = performance.now();
const first = A.J("json.dumps([list(cmd.get_coords('pep').shape), cmd.count_atoms('pep')])");
info.first_get_coords_ms = +(performance.now() - tc).toFixed(1);
info.unpack_ms = A.out.unpack.ms[0] === undefined ? null : A.out.unpack.ms[0];
expect('2. the first cmd.get_coords: shape is (atoms, 3)', Array.isArray(first) ? JSON.stringify(first[0]) === JSON.stringify([first[1], 3]) : first, true);
expect('2. the first cmd.get_coords unpacked numpy exactly once', A.out.unpack.calls, 1);
expect('2. the wheel is let go after the unpack', A.w.held(), null);
const second = A.J("json.dumps(list(cmd.get_coords('pep').shape))");
expect('2. a second cmd.get_coords works', Array.isArray(second) && second[1] === 3, true);
expect('2. a second cmd.get_coords unpacks nothing', A.out.unpack.calls, 1);
const aAfter = A.J('_t_state()');
expect("2. control of check 1's probes: after it 'numpy' is in sys.modules and site-packages/numpy exists", [aAfter.numpy_in_modules, aAfter.numpy_dir], [true, true]);
expect("2. import numpy: the lock's version", A.R('import numpy\nnumpy.__version__'), NP.version);
measured.numpy_version_lock = NP.version;
expect('2. numpy.linalg', A.R('round(float(numpy.linalg.det(numpy.eye(3) * 2)), 9)'), 8);
expect('2. numpy.fft', A.J('json.dumps(numpy.fft.fft(numpy.arange(4.0)).real.tolist())'), [6, -2, -2, -2]);
expect('2. numpy.random', A.J('_r = numpy.random.default_rng(0).random(3)\njson.dumps([len(_r), bool(((_r >= 0) & (_r < 1)).all())])'), [3, true]);
expect('2. fnab ATGC: atoms', A.R("cmd.fnab('ATGC', 'dna'); cmd.count_atoms('dna')"), 164);
const lazyXyz = A.J("json.dumps(cmd.get_coords('dna').tolist())");

// ---- eager: check 5, and the references ---------------------------------------
const B = await boot('eager', 'none', true);
expect('5. deferNumpy() with no wheel handed', B.out.deferred, false);
expect("5. the parsed lock's pymol.depends unchanged", B.out.depends, PM.depends);
expect("5. loadPackage(['pymol']) loaded numpy too", B.out.loaded, ['numpy', 'pymol']);
expect('5. no finder installed (init installs it only when deferNumpy() said yes)', B.out.finder, false);
expect("1. control: the eager boot's site-packages/numpy exists after loadPackage", B.out.numpy_dir_after_loadPackage, true);
B.bootPyMOL();
// The lazy boot's commands before its fnab, in the same order: fab places
// the view's origin, and fnab builds there.
B.R("cmd.fab('AGK', 'pep'); cmd.get_coords('pep'); cmd.get_coords('pep')");
expect('5. eager fnab ATGC: atoms', B.R("cmd.fnab('ATGC', 'dna'); cmd.count_atoms('dna')"), 164);
const eagerXyz = B.J("json.dumps(cmd.get_coords('dna').tolist())");
const maxDiff = (a, b) => {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 'shape differs';
  let m = 0;
  for (let i = 0; i < a.length; i++) for (let k = 0; k < 3; k++) m = Math.max(m, Math.abs(a[i][k] - b[i][k]));
  return m;
};
measured.fnab_max_abs_diff = maxDiff(lazyXyz, eagerXyz);
expect('2. fnab ATGC: the lazy boot\'s coordinates equal the eager boot\'s (max abs diff)', measured.fnab_max_abs_diff, 0);
const nudged = Array.isArray(eagerXyz) ? eagerXyz.map((r, i) => (i === 7 ? [r[0] + 0.001, r[1], r[2]] : r)) : null;
expect('2. control: the comparison sees a 0.001 A shift of one atom', maxDiff(lazyXyz, nudged) > 0, true);
// A numpy pickle (protocol 2) and a .pse holding a numpy array, made with numpy loaded.
const fx = B.attempt(String.raw`
import pickle, numpy
_t_a = numpy.arange(6, dtype='f4').reshape(2, 3)
open('/tmp/t_np.pkl', 'wb').write(pickle.dumps({'a': _t_a}, protocol=2))
cmd._pymol.session.agdb_np = _t_a
cmd.fab('AAAA', 'fixpep')
cmd.save('/tmp/t_np.pse')
`);
if (fx.raised) failures.push('fixtures (eager boot): raised ' + fx.raised + ': ' + fx.msg);
const readOr = (p) => { try { return B.py.FS.readFile(p); } catch (e) { return new Uint8Array(0); } };
const npPkl = readOr('/tmp/t_np.pkl');
const npPse = readOr('/tmp/t_np.pse');
measured.fixtures = { pickle_bytes: npPkl.byteLength, pse_bytes: npPse.byteLength };
expect('3. fixtures: a numpy pickle and a .pse were made in the eager boot', npPkl.byteLength > 0 && npPse.byteLength > 0, true);
const WANT_ARRAY = { type: 'ndarray', dtype: 'float32', shape: [2, 3], values: [[0, 1, 2], [3, 4, 5]] };
const DESCRIBE = (expr) => `_t_v = ${expr}\njson.dumps({'type': type(_t_v).__name__, 'dtype': str(getattr(_t_v, 'dtype', '')), 'shape': list(getattr(_t_v, 'shape', ())), 'values': _t_v.tolist() if hasattr(_t_v, 'tolist') else None})`;

// ---- pickle: check 3 (a fresh lazy boot) ---------------------------------------
const C = await boot('pickle', 'good', true);
C.bootPyMOL();
C.py.FS.writeFile('/tmp/t_np.pkl', npPkl);
expect('3. fresh lazy boot: nothing imported numpy yet', [C.J('_t_state()').numpy_in_modules, C.out.unpack.calls], [false, 0]);
const cLoad = C.attempt("from chempy import pkl as _t_pkl\n_t_r = _t_pkl.restricted_loads(open('/tmp/t_np.pkl', 'rb').read())");
expect('3. chempy.pkl.restricted_loads of a protocol-2 numpy pickle raises nothing', cLoad.raised, null);
expect("3. the restricted unpickler's own import unpacked numpy (once)", C.out.unpack.calls, 1);
expect('3. the array comes back equal', C.J(DESCRIBE("_t_r['a']")), WANT_ARRAY);

// ---- pse: check 3 (a fresh lazy boot) ------------------------------------------
const D = await boot('pse', 'good', true);
D.bootPyMOL();
D.py.FS.writeFile('/tmp/sess.pse', npPse);
expect('3. fresh lazy boot: nothing imported numpy yet', [D.J('_t_state()').numpy_in_modules, D.out.unpack.calls], [false, 0]);
const dRes = D.J(RESTORE_PY);
expect('3. RESTORE_PY of a .pse holding a numpy array in pymol.session: no error', dRes && dRes.err, null);
expect('3. RESTORE_PY of that .pse: atoms restored', dRes && typeof dRes.atoms === 'number' && dRes.atoms > 0, true);
expect('3. that restore unpacked numpy (once)', D.out.unpack.calls, 1);
expect('3. the array in pymol.session comes back equal', D.J(DESCRIBE('cmd._pymol.session.agdb_np')), WANT_ARRAY);

// ---- corrupt: check 4 ----------------------------------------------------------
const E = await boot('corrupt', 'corrupt', true);
expect('4. deferNumpy() with a truncated wheel handed (it is not checked here; the parent checks SHA-256)', E.out.deferred, true);
E.bootPyMOL();
const e1 = E.attempt('import numpy');
const e2 = E.attempt('import numpy');
measured.corrupt = { first: e1, second: e2 };
expect('4. import numpy with a corrupt wheel raises ImportError (exactly)', e1.raised, 'ImportError');
expect("4. ... whose message starts 'numpy could not be unpacked'", typeof e1.msg === 'string' && e1.msg.startsWith('numpy could not be unpacked'), true);
expect('4. a second import numpy raises ImportError again (not a bare ModuleNotFoundError)', e2.raised, 'ImportError');
expect("4. ... with the same message start", typeof e2.msg === 'string' && e2.msg.startsWith('numpy could not be unpacked'), true);
expect('4. each import tried the unpack again', E.out.unpack.calls, 2);
expect('4. the (corrupt) wheel is still held after the failures', E.w.held() !== null, true);
expect('4. cmd.fab still works', E.R("cmd.fab('AAAA', 'p'); cmd.count_atoms('p') > 0"), true);
measured.corrupt.get_coords = E.attempt("cmd.get_coords('p')");
measured.corrupt.numpy_dir_after = E.J('_t_state()').numpy_dir;

// ---- nofinder: check 6 controls ------------------------------------------------
const F = await boot('nofinder', 'good', false);
expect('6. control: deferNumpy() said yes (the lock is mutated)', [F.out.deferred, F.out.loaded], [true, ['pymol']]);
const f1 = F.attempt('import numpy');
expect('6. control: without NUMPY_PY, import numpy is ModuleNotFoundError', f1.raised, 'ModuleNotFoundError');
F.bootPyMOL();
F.R("cmd.fab('AGK', 'pep')");
expect('6. control: without NUMPY_PY, cmd.get_coords fails', F.attempt("cmd.get_coords('pep')").raised !== null, true);
F.py.FS.writeFile('/tmp/t_np.pkl', npPkl);
const fPkl = F.attempt("from chempy import pkl as _t_pkl\n_t_r = _t_pkl.restricted_loads(open('/tmp/t_np.pkl', 'rb').read())");
measured.nofinder_pickle = fPkl;
expect('6. control: without NUMPY_PY, the numpy pickle does not load', fPkl.raised !== null, true);
F.py.FS.writeFile('/tmp/sess.pse', npPse);
const fRes = F.J(RESTORE_PY);
measured.nofinder_restore_err = fRes && fRes.err;
expect('6. control: without NUMPY_PY, RESTORE_PY of the numpy .pse fails', !!(fRes && fRes.err), true);

// ---- 6. init order in the worker's source --------------------------------------
function order(src) {
  const at = (s) => src.indexOf(s);
  const dn = at('deferNumpy()'), lp = at('loadPackage('), cleared = at('ASSETS = {};');
  const reg = at("py.registerJsModule('_agdb_numpy'"), npy = at('py.runPython(NUMPY_PY)'), start = at('py.runPython(START_PY(');
  return {
    deferNumpy_before_loadPackage: dn >= 0 && lp >= 0 && dn < lp,
    register_after_assets_cleared: cleared >= 0 && reg > cleared,
    numpy_py_after_assets_cleared: cleared >= 0 && npy > cleared,
    register_before_numpy_py: reg >= 0 && npy > reg,
    numpy_py_before_start: npy >= 0 && start > npy,
  };
}
const allTrue = (o) => Object.values(o).every((v) => v === true);
measured.init_order = order(initSrc);
expect("6. init: deferNumpy() < loadPackage( ; ASSETS = {}; < registerJsModule('_agdb_numpy' < py.runPython(NUMPY_PY) < py.runPython(START_PY(", allTrue(measured.init_order), true);
const late = initSrc.replace('py.runPython(NUMPY_PY)', 'void 0') + '\npy.runPython(NUMPY_PY);';
const deferLate = initSrc.replace('deferNumpy()', 'false') + '\ndeferNumpy();';
expect('6. control: the order check fails with NUMPY_PY moved after START_PY', allTrue(order(late)), false);
expect('6. control: the order check fails with deferNumpy() moved after loadPackage', allTrue(order(deferLate)), false);

measured.boots = [A, B, C, D, E, F].map(tail);
finish(0);
