// The trimmed numpy wheel must import and run as the original does
// (PT-9554 S2-2 (3), numpy_trim.py; evidence §3.22, the safe rule).
//
//   node numpy_import_probe.mjs <pyodide-core-dir> <original numpy.whl> <trimmed numpy.whl> <report.json>
//        [--case-timeout=SECONDS]
//
// numpy_trim.py drops type stubs, C headers, static libraries, Cython / C
// sources, build configuration, numpy/_pyinstaller/, numpy/doc/ and
// numpy/conftest.py. The run2 rule that also dropped numpy/testing/ and
// numpy/f2py/ broke `from numpy import *`, numpy.matlib, help(numpy),
// hasattr(numpy, 'testing') and np.testing.*; this probe pins that the safe
// rule breaks nothing that runs.
//
// Three runs, each in its own worker thread with its own Pyodide (the core's
// own stdlib; no pymol), the wheel unpacked into site-packages with
// unpackArchive(..., 'wheel') as the worker's lazy numpy (worker.js
// unpackNumpy) and loadPackage do:
//   original  the original wheel
//   trimmed   the trimmed wheel
//   control   the trimmed wheel with numpy/matlib.py removed after the unpack:
//             a deliberately over-trimmed wheel this probe must catch
// Each run, in this order: the named checks (from numpy import *,
// numpy.testing and assert_allclose, hasattr(numpy, 'testing'), numpy.f2py,
// numpy.matlib, pydoc.render_doc(numpy) = help(numpy)'s text, get_include,
// linalg / fft / random, a pickled array); then an import of EVERY .py module
// the original carries but the four the rule drops (EXPECTED_DROPPED_PY,
// pinned here so an over-trimmed wheel shows as a failing module; packages
// and submodules, sorted; each result is success or the exception's type);
// then those four (recorded; the trimmed wheel must lack exactly them).
//
// Every thread calls guardHost() before Pyodide loads and runs PY_HOST_BLOCK
// right after (pymol-wasm/bench/README.md, trap 1): importing every module
// runs numpy.f2py.__main__ and the bundled examples, which must not reach the
// host. Each run is time-limited (--case-timeout, default 300 s after boot).
//
// Expectations: every run ran to its end with no host call; per kept module the
// trimmed result equals the original's (success, or the same exception type),
// so nothing that imports with the original fails with the trimmed; every
// named check gives the original's value; help(numpy)'s text differs only in
// the PACKAGE CONTENTS lines of dropped modules (object addresses and the
// set-ordered __all__ masked; sorted __all__ is a named check); the trimmed
// wheel lacks exactly the four pinned .py modules; and the control is caught (a
// module that imports with the original fails, and the numpy.matlib check
// differs). Exit 0 = every expectation held; 1 = one did not (or the probe
// failed); 2 = usage / unreadable input.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { accessSync, constants, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { guardHost, hostCalls, PY_HOST_BLOCK } from '../bench/lib/guard_host.mjs';

const PROBE = 'numpy_import_probe';
const SITE_PACKAGES = '/lib/python3.14/site-packages';   // worker.js SITE_PACKAGES
const CONTROL_DROP = 'numpy/matlib.py';
// The only .py modules numpy_trim.py's rule drops (numpy_drop.json; each
// justified in numpy_trim.py's docstring).
const EXPECTED_DROPPED_PY = ['numpy._pyinstaller', 'numpy._pyinstaller.hook-numpy', 'numpy.conftest', 'numpy.doc.ufuncs'];

// ---- Python run in every worker --------------------------------------------------
const PROBE_PY = String.raw`
import importlib, json, sys, zipfile
EXPECTED_DROPPED_PY = ${JSON.stringify(EXPECTED_DROPPED_PY)}

def _modname(p):
    parts = p[:-3].split('/')
    if parts[-1] == '__init__':
        parts = parts[:-1]
    return '.'.join(parts)

def _pys(whl):
    with zipfile.ZipFile(whl) as z:
        return sorted(_modname(n) for n in z.namelist() if n.endswith('.py') and '.dist-info/' not in n)

# Every .py module of the original but the ones the rule drops (pinned below,
# not derived from the trimmed wheel: an over-trimmed wheel must show up as a
# module that fails, not as one more "dropped" module).
DROPPED = EXPECTED_DROPPED_PY
KEPT = sorted(set(_pys('/tmp/probe_original.whl')) - set(DROPPED))
TRIM_LACKS = sorted(set(_pys('/tmp/probe_original.whl')) - set(_pys('/tmp/probe_trimmed.whl')))

def _exc(e):
    return type(e).__module__ + '.' + type(e).__qualname__

def _short(e):
    return ' '.join(str(e).split())[:200]

checks = {}
def check(name, f):
    try:
        checks[name] = {'ok': True, 'value': f()}
    except BaseException as e:
        checks[name] = {'ok': False, 'exc': _exc(e), 'msg': _short(e)}

# hasattr first: anything below imports numpy.testing (the star import too)
check("hasattr(numpy, 'testing')", lambda: hasattr(__import__('numpy'), 'testing'))

def _star():
    g = {}
    exec('from numpy import *', g)
    return sorted(k for k in g if not k.startswith('__'))
check('from numpy import *', lambda: len(_star()))
check('from numpy import * has testing', lambda: 'testing' in _star())

def _testing():
    import numpy.testing
    numpy.testing.assert_allclose([1.0, 2.0], [1.0, 2.0 + 1e-12])
    try:
        numpy.testing.assert_allclose([1.0], [1.5])
    except AssertionError:
        return 'equal passes, unequal raises AssertionError'
    return 'unequal did not raise'
check('numpy.testing.assert_allclose', _testing)
check("numpy.__all__ names testing and f2py", lambda: [x in __import__('numpy').__all__ for x in ('testing', 'f2py')])
check('import numpy.f2py', lambda: importlib.import_module('numpy.f2py').__name__)
check('import numpy.matlib', lambda: importlib.import_module('numpy.matlib').eye(2).tolist())

def _doc():
    import pydoc, numpy
    return pydoc.render_doc(numpy)
check('pydoc.render_doc(numpy)', lambda: len(_doc()) > 0)
check('sorted(numpy.__all__)', lambda: sorted(__import__('numpy').__all__))

def _doc_lines():
    # help(numpy)'s text as plain text; object addresses and the order of
    # __all__ (built from a set: string hashing is randomised per run) vary
    # between any two runs, so they are masked (__all__ is compared above)
    import pydoc, re, numpy
    out = []
    for line in pydoc.render_doc(numpy, renderer=pydoc.plaintext).splitlines():
        line = re.sub(r'0x[0-9a-f]+', '0x?', line)
        if line.strip().startswith('__all__ = '):
            line = line[:line.index('__all__ = ')] + '__all__ = <masked>'
        out.append(line)
    return out
try:
    DOC_LINES = _doc_lines()
except BaseException as e:
    DOC_LINES = ['<render_doc failed: %s>' % _exc(e)]

check('numpy.get_include()', lambda: __import__('numpy').get_include())
check('dir(numpy)', lambda: len(dir(__import__('numpy'))))
check('numpy.linalg', lambda: round(float(__import__('numpy').linalg.det(__import__('numpy').eye(3) * 2)), 9))
check('numpy.linalg.solve', lambda: [round(float(x), 9) for x in __import__('numpy').linalg.solve([[3.0, 1.0], [1.0, 2.0]], [9.0, 8.0])])
check('numpy.fft', lambda: __import__('numpy').fft.fft(__import__('numpy').arange(4.0)).real.tolist())
check('numpy.random', lambda: __import__('numpy').random.default_rng(0).random(3).tolist())

def _pickle():
    import pickle, numpy
    a = numpy.arange(12, dtype='f4').reshape(3, 4) * 0.5
    out = []
    for proto in (2, 5):
        b = pickle.loads(pickle.dumps(a, protocol=proto))
        out.append([proto, str(b.dtype), list(b.shape), bool((a == b).all())])
    return out
check('pickled array round trip', _pickle)

def _import_all(names):
    res = {}
    for n in names:
        try:
            importlib.import_module(n)
            res[n] = 'ok'
        except BaseException as e:
            res[n] = _exc(e)
    return res

KEPT_RES = _import_all(KEPT)
DROPPED_RES = _import_all(DROPPED)
json.dumps({'checks': checks, 'doc_lines': DOC_LINES, 'kept': KEPT_RES, 'dropped': DROPPED_RES, 'trim_lacks': TRIM_LACKS,
            'numpy_version': __import__('numpy').__version__}, default=str)
`;

// ---- worker thread -----------------------------------------------------------------
function errInfo(e) {
  const msg = String((e && e.message) || e);
  return {
    js_error: (e && e.constructor && e.constructor.name) || typeof e,
    is_wasm_trap: e instanceof WebAssembly.RuntimeError,
    msg: msg.split('\n').map((x) => x.trim()).filter(Boolean).slice(-4).join(' | ').slice(0, 500),
  };
}

function arrayBuffer(p) {
  const b = readFileSync(p);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);   // unpackArchive refuses a node Buffer
}

async function workerMain() {
  guardHost();
  const { core, install, original, trimmed, removeAfter } = workerData;
  const post = (m) => parentPort.postMessage(m);
  const res = { status: 'harness_error' };
  try {
    const indexURL = path.resolve(core) + '/';
    const { loadPyodide } = await import(pathToFileURL(path.join(indexURL, 'pyodide.mjs')).href);
    const out = [];
    const py = await loadPyodide({ indexURL, stdout: (s) => out.push(s), stderr: (s) => out.push(s) });
    py.runPython(PY_HOST_BLOCK);
    py.unpackArchive(arrayBuffer(install), 'wheel', { extractDir: SITE_PACKAGES });
    res.removed = [];
    for (const rel of removeAfter || []) {
      // a wheel that already lacks it (an over-trimmed input) leaves nothing to remove
      if (py.FS.analyzePath(SITE_PACKAGES + '/' + rel).exists) {
        py.FS.unlink(SITE_PACKAGES + '/' + rel);
        res.removed.push(rel);
      }
    }
    py.FS.writeFile('/tmp/probe_original.whl', new Uint8Array(readFileSync(original)));
    py.FS.writeFile('/tmp/probe_trimmed.whl', new Uint8Array(readFileSync(trimmed)));
    post({ type: 'booted' });
    try {
      Object.assign(res, JSON.parse(py.runPython(PROBE_PY)));
      res.status = 'ran';
    } catch (e) {
      res.status = 'fatal';
      Object.assign(res, errInfo(e));
    }
    try {
      res.alive = py.runPython('1+1') === 2;
    } catch (e) {
      res.alive = false;
    }
    res.output_lines = out.length;
  } catch (e) {
    res.status = 'harness_error';
    Object.assign(res, errInfo(e));
  }
  res.host_calls = hostCalls.slice();
  post({ type: 'done', res });
}

// ---- main thread ---------------------------------------------------------------------
function runCase(inputs, caseTimeoutMs, bootTimeoutMs) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let settled = false;
    let timer = null;
    const w = new Worker(fileURLToPath(import.meta.url), { workerData: inputs });
    const finish = (res) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      res.ms = Date.now() - t0;
      w.terminate().finally(() => resolve(res));
    };
    const arm = (ms, status) => {
      clearTimeout(timer);
      timer = setTimeout(() => finish({ status, limit_s: ms / 1000 }), ms);
    };
    arm(bootTimeoutMs, 'boot_timeout');
    w.on('message', (m) => {
      if (m && m.type === 'booted') arm(caseTimeoutMs, 'timeout');
      else if (m && m.type === 'done') finish(m.res);
    });
    w.on('error', (e) => finish({ status: 'worker_error', ...errInfo(e) }));
    w.on('exit', (c) => finish({ status: 'worker_exit', exit_code: c }));
  });
}

const sha256 = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const ran = (r) => r && r.status === 'ran' && r.alive === true && Array.isArray(r.host_calls) && r.host_calls.length === 0;

function compare(base, other) {
  const names = Object.keys(base.kept || {});
  const differ = names.filter((n) => base.kept[n] !== (other.kept || {})[n]);
  const newlyFailing = names.filter((n) => base.kept[n] === 'ok' && (other.kept || {})[n] !== 'ok');
  const checkDiff = Object.keys(base.checks || {}).filter((k) => !same(base.checks[k], (other.checks || {})[k]));
  return { differ, newlyFailing, checkDiff };
}

async function main() {
  const argv = process.argv.slice(2);
  const pos = argv.filter((a) => !a.startsWith('--'));
  const opts = Object.fromEntries(argv.filter((a) => a.startsWith('--')).map((a) => {
    const i = a.indexOf('=');
    return i < 0 ? [a.slice(2), ''] : [a.slice(2, i), a.slice(i + 1)];
  }));
  const usage = (why) => {
    console.error(`${PROBE}: ${why}\nusage: node numpy_import_probe.mjs <pyodide-core-dir> <original numpy.whl> <trimmed numpy.whl> <report.json> [--case-timeout=SECONDS]`);
    process.exit(2);
  };
  if (pos.length !== 4) usage('expected 4 positional arguments');
  for (const k of Object.keys(opts)) if (!['case-timeout'].includes(k)) usage(`unknown option --${k}`);
  const [coreDir, origWhl, trimWhl, reportPath] = pos;
  const core = path.resolve(coreDir);
  try {
    for (const p of [path.join(core, 'pyodide.mjs'), origWhl, trimWhl]) accessSync(p, constants.R_OK);
  } catch (e) {
    usage(`unreadable input: ${e.message}`);
  }
  const caseTimeoutMs = Math.round(1000 * (parseFloat(opts['case-timeout'] || '300') || 300));
  const bootTimeoutMs = 300000;

  guardHost();
  const original = path.resolve(origWhl), trimmed = path.resolve(trimWhl);
  const RUNS = {
    original: { core, install: original, original, trimmed, removeAfter: [] },
    trimmed: { core, install: trimmed, original, trimmed, removeAfter: [] },
    control: { core, install: trimmed, original, trimmed, removeAfter: [CONTROL_DROP] },
  };
  const results = Object.fromEntries(await Promise.all(Object.entries(RUNS).map(async ([n, inp]) => {
    const r = await runCase(inp, caseTimeoutMs, bootTimeoutMs);
    console.log(`${PROBE}: ${n}: ${r.status}${r.msg ? ' - ' + r.msg.slice(0, 160) : ''} [${(r.ms / 1000).toFixed(1)} s]`);
    return [n, r];
  })));
  const O = results.original, T = results.trimmed, C = results.control;

  const ok3 = ran(O) && ran(T) && ran(C);
  const t = ok3 ? compare(O, T) : null;
  const c = ok3 ? compare(O, C) : null;
  const kept = ok3 ? Object.keys(O.kept) : [];
  const dropDoc = (lines, other) => lines.filter((l) => !other.includes(l));
  const docOnlyO = ok3 ? dropDoc(O.doc_lines, T.doc_lines) : null;
  const docOnlyT = ok3 ? dropDoc(T.doc_lines, O.doc_lines) : null;
  const droppedTop = ok3 ? Object.keys(O.dropped).map((m) => m.split('.').slice(0, 2).join('.')) : [];
  const docDiffOnlyDropped = ok3 && docOnlyT.length === 0
    && docOnlyO.every((l) => droppedTop.some((m) => l.trim().split(' ')[0] === m.split('.')[1]));

  const expectations = {
    all_runs_ran_without_host_calls: ok3,
    kept_py_modules_tried: ok3 && kept.length > 100,
    every_kept_module_same_result_as_original: ok3 && t.differ.length === 0,
    nothing_newly_failing: ok3 && t.newlyFailing.length === 0,
    named_checks_same_as_original: ok3 && t.checkDiff.length === 0,
    named_checks_succeed: ok3 && Object.values(T.checks).every((x) => x.ok === true),
    star_import_and_testing_work: ok3 && T.checks['from numpy import *'].ok && T.checks['from numpy import * has testing'].value === true
      && T.checks['numpy.testing.assert_allclose'].value === 'equal passes, unequal raises AssertionError'
      && T.checks["hasattr(numpy, 'testing')"].value === true,
    help_numpy_differs_only_in_dropped_package_contents: docDiffOnlyDropped,
    trimmed_wheel_lacks_exactly_the_pinned_dropped_py: ok3 && same(T.trim_lacks, EXPECTED_DROPPED_PY)
      && Object.values(T.dropped).every((v) => v !== 'ok'),
    same_numpy_version: ok3 && O.numpy_version === T.numpy_version,
    control_overtrim_caught: ok3 && c.newlyFailing.includes('numpy.matlib') && c.checkDiff.includes('import numpy.matlib'),
  };
  const count = (r, f) => Object.values(r.kept || {}).filter(f).length;
  const report = {
    probe: PROBE,
    ok: Object.values(expectations).every((x) => x === true),
    expectations,
    failures: Object.entries(expectations).filter(([, v]) => !v).map(([k]) => k),
    summary: ok3 ? {
      kept_py_modules: kept.length,
      import_ok: { original: count(O, (v) => v === 'ok'), trimmed: count(T, (v) => v === 'ok') },
      import_fail_same_type_both: kept.filter((n) => O.kept[n] !== 'ok' && O.kept[n] === T.kept[n]).map((n) => `${n}: ${O.kept[n]}`),
      differing_modules: t.differ.map((n) => `${n}: ${O.kept[n]} -> ${T.kept[n]}`),
      newly_failing: t.newlyFailing,
      named_checks: Object.keys(T.checks).length,
      named_checks_differing: t.checkDiff,
      help_numpy_lines_only_in_original: docOnlyO,
      help_numpy_lines_only_in_trimmed: docOnlyT,
      trimmed_wheel_lacks_py: T.trim_lacks,
      dropped_py_modules: Object.fromEntries(Object.keys(O.dropped).map((n) => [n, { original: O.dropped[n], trimmed: T.dropped[n] }])),
      control: { removed: C.removed, newly_failing: c.newlyFailing, named_checks_differing: c.checkDiff },
    } : null,
    case_timeout_s: caseTimeoutMs / 1000,
    inputs: {
      core,
      original: { name: path.basename(original), sha256: sha256(original) },
      trimmed: { name: path.basename(trimmed), sha256: sha256(trimmed) },
    },
    runs: Object.fromEntries(Object.entries(results).map(([n, r]) => [n, {
      status: r.status, alive: r.alive, host_calls: r.host_calls, ms: r.ms, msg: r.msg, removed: r.removed,
      numpy_version: r.numpy_version, checks: r.checks, kept: r.kept, dropped: r.dropped,
    }])),
  };
  writeFileSync(reportPath, JSON.stringify(report, null, 1) + '\n');
  const s = report.summary;
  console.log(`${PROBE}: ${report.ok ? 'PASS' : 'FAIL'} - ` + (s
    ? `kept modules ${s.kept_py_modules} (import ok: original ${s.import_ok.original}, trimmed ${s.import_ok.trimmed}; differing ${s.differing_modules.length}; `
      + `newly failing ${s.newly_failing.length}); named checks ${s.named_checks} (differing ${s.named_checks_differing.length}); `
      + `control caught: ${expectations.control_overtrim_caught}`
    : 'a run did not finish') + (report.failures.length ? `; failed: ${report.failures.join(', ')}` : ''));
  return report.ok ? 0 : 1;
}

if (isMainThread) {
  main().then((code) => process.exit(code), (e) => {
    console.error(`${PROBE}: probe error: ${(e && e.stack) || e}`);
    process.exit(1);
  });
} else {
  await workerMain();
}
