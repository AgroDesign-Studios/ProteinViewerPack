// S1-16 (PyMOL WASM slim design §3.2, §8.1): a C++ exception nobody caught
// must end the frame on the FIRST request that hits it, through the `load`
// message AND through the command line, on the REAL runtime (node, headless
// PyMOL). Modelled on frame_load_formats.mjs; hand-run like it:
//
//   node frame_fatal_cpp_exception.mjs <pyodide-core-dir> <numpy-wheel> <pymol-wheel> <worker.js> [report.json]
//
// The test checks that an uncaught C++ exception (a CppException, which is not
// a WebAssembly.RuntimeError) is reported as fatal, so the page does not keep
// a runtime that has stopped working. The input is a malformed CCP4 map on
// which the map reader throws one, built here from a valid 8x8x8 float32
// map; no binary fixture.
//
// Everything judged is EXTRACTED from the given worker.js and evaluated, not
// copied: FATAL_RE, isTrap, postError, the `command` reply's catch body and
// the onmessage handler's outer catch body (where a `load` failure lands: the
// load branch has only try/finally and runInTick rejects with the error as
// thrown). Each catch body is run against the real error object with a stub
// postMessage, and the verdict is the `fatal` flag of the error message it
// posts. The runtime side runs the worker's way: HARDEN_PY installed as at
// boot, the bytes written to /tmp/in_<obj>.ccp4 from JS, then
// cmd.load(fn, obj, 0, 'ccp4') on the PyProxy `cmd` (load) or
// cmd.do('load <fn>, bad') (command line). Each path gets its own Pyodide:
// the first exception kills the runtime it happened in. It checks:
//   1. the valid map loads as a map (the fixture is valid; the malformed
//      copy is what breaks it), and a missing file is NOT judged fatal (the
//      wider predicate does not swallow ordinary Python errors);
//   2. load path: the error is a CppException, and the worker's own catch
//      posts it with fatal: true;
//   3. command path: the same, through the command catch; and worker.js's
//      command catch carries `FATAL_RE.test(s) || isTrap(err)` (regex);
//   4. positive control: the BASE predicate (`instanceof
//      WebAssembly.RuntimeError` only) and the BASE command catch (posts the
//      text, judges nothing) judge the same two errors NOT fatal — so a pass
//      above comes from the new predicate, not from the error's wording;
//   5. "Dynamic linking error" in a message is fatal too (synthetic error:
//      no real side module is broken here), not under the base predicate;
//   6. the runtime is dead after the exception (observation recorded: what
//      the next cmd.do and runPython calls throw, and how the base and new
//      catches judge that next error).
// Exit 0 = every expectation held; 1 = one did not (the report says which);
// 2 = usage / extraction error.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const [coreDir, numpyWheel, pymolWheel, workerPath, reportPath] = process.argv.slice(2);
if (!workerPath) {
  console.error('usage: node frame_fatal_cpp_exception.mjs <core-dir> <numpy-wheel> <pymol-wheel> <worker.js> [report.json]');
  process.exit(2);
}

// ---- extraction ----------------------------------------------------------------
const workerSrc = readFileSync(workerPath, 'utf8');
const harden = workerSrc.match(/const HARDEN_PY = String\.raw`([\s\S]*?)`;/);
const fatalRe = workerSrc.match(/\nvar FATAL_RE = (\/[^\n]*\/[a-z]*);\n/);
const isTrapSrc = workerSrc.match(/\nconst isTrap = (\(err\) => [\s\S]*?);\n/);
const postErrorSrc = workerSrc.match(/\nfunction postError\(s\) \{\n[\s\S]*?\n\}\n/);
const onmsg = workerSrc.slice(workerSrc.indexOf('self.onmessage = async (e) => {'));
const commandCatch = onmsg.match(/if \(m\.type === 'command'\) \{\n\s*try \{ await runInTick\(req, \(\) => cmd\.do\(String\(m\.cmd\)\)\);[^\n]*\n\s*catch \(err\) \{([\s\S]*?)\}\n\s*return;/);
const outerCatch = onmsg.match(/\n  \} catch \(err\) \{\n([\s\S]*?)\n  \}\n\};/);
const missing = Object.entries({ HARDEN_PY: harden, FATAL_RE: fatalRe, isTrap: isTrapSrc, postError: postErrorSrc, 'command catch': commandCatch, 'onmessage outer catch': outerCatch })
  .filter(([, v]) => !v).map(([k]) => k);
if (onmsg.length === workerSrc.length || missing.length) {
  console.error('could not find ' + (missing.join(', ') || 'self.onmessage') + ' in ' + workerPath);
  process.exit(2);
}
const HARDEN_PY = harden[1];

// The shape that carries a load failure to the outer catch, as read in worker.js:
// the load branch's tick task has try/finally only, and runInTick rejects with
// the error as thrown.
const LOAD_SHAPE = /const fn = '\/tmp\/in_' \+ obj \+ '\.' \+ fmt;\n\s*const bytes = new Uint8Array\(m\.bytes\);\n\s*await runInTick\(req, \(\) => \{\n\s*py\.FS\.writeFile\(fn, bytes\);\n\s*try \{\n\s*if \(m\.replace\) cmd\.delete\('all'\);\n\s*cmd\.load\(fn, obj, 0, fmt\);\n\s*\} finally \{/;
const RUNINTICK_SHAPE = /try \{ resolve\(fn\(\)\); \} catch \(e\) \{ reject\(e\); \}/;
// The fix, as the design writes it (S1-16, command reply).
const COMMAND_PREDICATE = /const s = String\(err\)\.slice\(0, 300\);\s*if \(FATAL_RE\.test\(s\) \|\| isTrap\(err\)\) FATAL = FATAL \|\| s;\s*postError\(s\);/;

// A judge: the given catch body run against an error with the worker's FATAL,
// postMessage and postError around it; returns what it posted and FATAL.
function makeJudge(isTrapExpr, catchBody) {
  const src = `
let FATAL = null; const sent = [];
const postMessage = (m) => { sent.push(m); };
const flushPyLog = () => {};
const FATAL_RE = ${fatalRe[1]};
const isTrap = ${isTrapExpr};
${postErrorSrc[0]}
return (err) => {
  FATAL = null; sent.length = 0;
  let threw = null;
  try { ${catchBody} } catch (e) { threw = String(e); }
  const last = sent[sent.length - 1] || null;
  return { FATAL, posted: last, fatal: !!(last && last.fatal === true), threw };
};`;
  return new Function(src)();
}
const judge = {
  load: makeJudge(isTrapSrc[1], outerCatch[1]),
  command: makeJudge(isTrapSrc[1], commandCatch[1]),
  // Positive control: the base worker's predicate and command catch
  // (c59f84929e), the onmessage outer catch being unchanged apart from isTrap.
  base_load: makeJudge("(err) => typeof WebAssembly !== 'undefined' && err instanceof WebAssembly.RuntimeError", outerCatch[1]),
  base_command: makeJudge("(err) => typeof WebAssembly !== 'undefined' && err instanceof WebAssembly.RuntimeError",
    "postMessage({ type: 'error', s: String(err).slice(0, 300) });"),
};
const isTrapNew = new Function('return ' + isTrapSrc[1])();

// ---- runtime -------------------------------------------------------------------
const indexURL = path.resolve(coreDir) + '/';
createRequire(import.meta.url)(path.join(indexURL, 'pyodide.js'));

const BOOT = String.raw`
import struct
import numpy as np
import pymol, pymol.invocation, pymol2
pymol.invocation.parse_args(['pymol', '-cq'])
_inst = pymol2.SingletonPyMOL(); _inst.start()
from pymol import cmd
`;
// A valid CCP4 map (mode 2, float32, 8^3, 1 A cell), and a malformed copy of
// it (the study's fixture).
const MAKE_MAPS = String.raw`
def _agdb_test_maps():
    n = 8
    hdr = bytearray(1024)
    struct.pack_into('<3i', hdr, 0, n, n, n)
    struct.pack_into('<i', hdr, 12, 2)
    struct.pack_into('<3i', hdr, 16, 0, 0, 0)
    struct.pack_into('<3i', hdr, 28, n, n, n)
    struct.pack_into('<3f', hdr, 40, float(n), float(n), float(n))
    struct.pack_into('<3f', hdr, 52, 90.0, 90.0, 90.0)
    struct.pack_into('<3i', hdr, 64, 1, 2, 3)
    data = (np.arange(n ** 3, dtype='<f4') / n ** 3).astype('<f4')
    struct.pack_into('<3f', hdr, 76, float(data.min()), float(data.max()), float(data.mean()))
    struct.pack_into('<i', hdr, 88, 1)
    hdr[208:212] = b'MAP '
    hdr[212:216] = bytes([0x44, 0x41, 0, 0])
    struct.pack_into('<f', hdr, 216, float(data.std()))
    good = bytes(hdr) + data.tobytes()
    bad = bytearray(good)
    bad[0:12] = struct.pack('<3i', -1, -1, -1)
    return good, bytes(bad)
`;

async function bootRuntime() {
  const py = await globalThis.loadPyodide({ indexURL, stdout: () => {}, stderr: () => {} });
  await py.loadPackage([path.resolve(numpyWheel), path.resolve(pymolWheel)], { messageCallback: () => {} });
  py.runPython(BOOT);
  py.runPython(HARDEN_PY);                    // as init installs it
  py.runPython(MAKE_MAPS);
  const pair = py.runPython('_agdb_test_maps()').toJs();
  return { py, cmd: py.globals.get('cmd'), good: new Uint8Array(pair[0]), bad: new Uint8Array(pair[1]) };
}

const errInfo = (e) => (e == null ? null : {
  ctor: e.constructor && e.constructor.name, name: String(e.name), message: String(e.message).slice(0, 200),
  string: String(e).slice(0, 200), webassembly_runtime_error: e instanceof WebAssembly.RuntimeError,
  pyodide_fatal_error: e.pyodide_fatal_error === true,
});
// Pyodide reports a fatal error on console.error; keep its first lines for the
// report instead of the log.
function capturingConsole(fn) {
  const lines = [];
  const orig = console.error;
  console.error = (...a) => { lines.push(a.map((x) => String(x && x.stack ? x.message : x)).join(' ').split('\n')[0].slice(0, 200)); };
  try { return { value: fn(), lines }; } finally { console.error = orig; }
}
function call(fn) {
  try { return { threw: null, value: fn() }; } catch (e) { return { threw: e }; }
}
const verdicts = (err) => ({
  new_load: judge.load(err), new_command: judge.command(err),
  base_load: judge.base_load(err), base_command: judge.base_command(err),
});
function nextCalls(rt) {
  const cmd = rt.cmd;   // named as in worker.js, so the TypeError reads as the worker's would
  const nextDo = capturingConsole(() => call(() => cmd.do('color red')));
  const nextPy = capturingConsole(() => call(() => rt.py.runPython('1 + 1')));
  return {
    cmd_do: { error: errInfo(nextDo.value.threw), console: nextDo.lines.slice(0, 3), verdicts: nextDo.value.threw ? verdicts(nextDo.value.threw) : null },
    run_python: { error: errInfo(nextPy.value.threw), value: nextPy.value.threw ? undefined : String(nextPy.value.value) },
  };
}

const result = {};

// (a) the `load` message's path.
{
  const rt = await bootRuntime();
  const objOf = (o) => String(o).replace(/[^A-Za-z0-9_]/g, '_').slice(0, 40) || 'mol';
  const workerLoad = (obj, bytes) => {      // the load branch's tick task
    const fn = '/tmp/in_' + objOf(obj) + '.ccp4';
    rt.py.FS.writeFile(fn, bytes);
    try { rt.cmd.load(fn, objOf(obj), 0, 'ccp4'); } finally { try { rt.py.FS.unlink(fn); } catch (e) {} }
  };
  const good = call(() => workerLoad('good', rt.good));
  result.good_map = { error: errInfo(good.threw), type: good.threw ? null : String(rt.py.runPython("cmd.get_type('good') if 'good' in cmd.get_names() else ''")) };
  // An ordinary Python error through the same call: not fatal.
  const nofile = call(() => rt.cmd.load('/tmp/in_nofile.ccp4', 'nofile', 0, 'ccp4'));
  result.missing_file = { error: errInfo(nofile.threw), verdicts: nofile.threw ? verdicts(nofile.threw) : null };
  const bad = capturingConsole(() => call(() => workerLoad('bad', rt.bad)));
  result.load_path = { error: errInfo(bad.value.threw), console: bad.lines.slice(0, 3), verdicts: bad.value.threw ? verdicts(bad.value.threw) : null };
  result.load_path_next = nextCalls(rt);
}

// (b) the command line's path: cmd.do(String(m.cmd)) on the PyProxy cmd.
{
  const rt = await bootRuntime();
  rt.py.FS.writeFile('/tmp/cmdline_bad.ccp4', rt.bad);
  const bad = capturingConsole(() => call(() => rt.cmd.do(String('load /tmp/cmdline_bad.ccp4, bad'))));
  result.command_path = { error: errInfo(bad.value.threw), console: bad.lines.slice(0, 3), verdicts: bad.value.threw ? verdicts(bad.value.threw) : null };
  result.command_path_next = nextCalls(rt);
}

// Synthetic: a side-module symbol that did not resolve.
const dyn = new Error('Dynamic linking error: cannot resolve symbol _ZN5pymol3fooEv');
result.dynamic_linking = { new_is_trap: isTrapNew(dyn), new_load: judge.load(dyn).fatal, new_command: judge.command(dyn).fatal, base_load: judge.base_load(dyn).fatal };

result.shape = {
  command_catch_has_predicate: COMMAND_PREDICATE.test(commandCatch[1]),
  load_branch_try_finally_only: LOAD_SHAPE.test(onmsg),
  runintick_rejects_with_error: RUNINTICK_SHAPE.test(workerSrc),
};

// ---- expectations --------------------------------------------------------------
const failures = [];
const expect = (cond, why) => { if (!cond) failures.push(why); };
const isCpp = (e) => e && /^CppException\b/.test(e.name) && e.webassembly_runtime_error === false;

expect(result.shape.load_branch_try_finally_only, 'shape: the load branch no longer runs cmd.load(fn, obj, 0, fmt) in a try/finally tick task (the error may not reach the outer catch)');
expect(result.shape.runintick_rejects_with_error, 'shape: runInTick no longer rejects with the error as thrown');
expect(result.shape.command_catch_has_predicate, "shape: the command catch does not carry `const s = String(err).slice(0, 300); if (FATAL_RE.test(s) || isTrap(err)) FATAL = FATAL || s; postError(s);`: " + JSON.stringify(commandCatch[1].trim()));

expect(result.good_map.error === null && result.good_map.type === 'object:map', 'fixture: the unpatched map did not load as a map: ' + JSON.stringify(result.good_map));
const nf = result.missing_file;
expect(nf.error && !isCpp(nf.error) && nf.verdicts && !nf.verdicts.new_load.fatal && !nf.verdicts.new_command.fatal,
  'an ordinary Python error (missing file) was judged fatal, or did not raise: ' + JSON.stringify(nf));

for (const [label, r] of [['load', result.load_path], ['command', result.command_path]]) {
  expect(r.error && isCpp(r.error), `${label} path: the broken map did not raise a CppException: ` + JSON.stringify(r.error));
  if (!r.verdicts) continue;
  const v = r.verdicts[label === 'load' ? 'new_load' : 'new_command'];
  expect(v.fatal === true && v.FATAL !== null && v.threw === null, `${label} path: the worker's catch did not post fatal: true on the first request: ` + JSON.stringify(v));
  // Positive control.
  const b = r.verdicts[label === 'load' ? 'base_load' : 'base_command'];
  expect(b.fatal === false && b.threw === null, `control: the base ${label} catch judged the CppException fatal (the pass above may not come from the fix): ` + JSON.stringify(b));
}
const d = result.dynamic_linking;
expect(d.new_is_trap === true && d.new_load === true && d.new_command === true, 'a "Dynamic linking error" is not judged fatal: ' + JSON.stringify(d));
expect(d.base_load === false, 'control: the base predicate judged a "Dynamic linking error" fatal: ' + JSON.stringify(d));
for (const [label, n] of [['load', result.load_path_next], ['command', result.command_path_next]]) {
  expect(n.run_python.error !== null, `${label} path: the runtime still runs Python after the exception (the premise of "fatal" does not hold): ` + JSON.stringify(n.run_python));
}

const report = { ok: failures.length === 0, failures, result };
if (reportPath) writeFileSync(reportPath, JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1));
process.exit(report.ok ? 0 : 1);
