// Owner ruling 7 (PyMOL WASM slim design §10.1, evidence B11): the frame's
// shader warm-up must not change the default colours of the user's first
// structures. On the REAL runtime (node, headless PyMOL); modelled on
// frame_gl_defaults.mjs and hand-run like it:
//
//   node frame_auto_color.mjs <pyodide-core-dir> <numpy-wheel> <pymol-wheel> <worker.js> [report.json]
//
// The warm-up's cmd.fab('AAAA','_warm') moves PyMOL's automatic colour cycle
// (the auto_color_next setting) on, so the first structure loaded after boot
// had salmon carbons (colour 9) and the second grey (29), where desktop PyMOL
// gives green (26) and cyan (5). init now resets the cycle after the warm-up:
//
//   try { py.runPython("cmd.set('auto_color_next', 0)"); } catch (e) { log('auto_color_next: ' + e); }
//
// The warm-up's Python (the fab/show/orient call and cmd.delete('_warm')) and
// that line are EXTRACTED from `async function init` in the given worker.js,
// which must hold them in that order before the `ready` message. The warm-up's
// GL draws are not run (no GL in node; they draw, they do not colour). Boot
// runs HARDEN_PY and GL_PY (extracted) as init does; EXPORT_PY, LOOK_PY and
// UI_PY only define functions and are not run. Each run is its own Pyodide (a
// fresh boot), and loads the wheel's own tut/1hpv.pdb twice the worker's way
// (bytes to /tmp/in_<obj>.pdb, cmd.load(fn, obj, 0, 'pdb') on the PyProxy
// cmd). It checks:
//   1. init carries the reset line after cmd.delete('_warm'), before `ready`;
//   2. warm-up + reset: auto_color_next is 0, and the two objects' carbons are
//      26 (green) and 5 (cyan), the same as a boot with no warm-up at all;
//   3. positive control: warm-up without the reset gives 9 (salmon) and 29
//      (grey), the colours before the fix, so a pass in 2 comes from the
//      reset; the warm-up's advance of the cycle is measured and reported.
// Exit 0 = every expectation held; 1 = one did not (the report says which);
// 2 = usage / extraction error.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const [coreDir, numpyWheel, pymolWheel, workerPath, reportPath] = process.argv.slice(2);
if (!workerPath) {
  console.error('usage: node frame_auto_color.mjs <core-dir> <numpy-wheel> <pymol-wheel> <worker.js> [report.json]');
  process.exit(2);
}

const workerSrc = readFileSync(workerPath, 'utf8');
const harden = workerSrc.match(/const HARDEN_PY = String\.raw`([\s\S]*?)`;/);
const gl = workerSrc.match(/const GL_PY = String\.raw`([\s\S]*?)`;/);
const initAt = workerSrc.indexOf('\nasync function init(m) {\n');
const initSrc = initAt < 0 ? '' : workerSrc.slice(initAt, workerSrc.indexOf('\n}\n', initAt) + 3);
const warm = initSrc.match(/py\.runPython\("(cmd\.fab\('AAAA','_warm'\);[^"]*)"\);/);
const warmDelete = initSrc.match(/py\.runPython\("(cmd\.delete\('_warm'\))"\);/);
const readyAt = initSrc.indexOf("postMessage({ type: 'ready'");
if (!harden || !gl || !initSrc || !warm || !warmDelete || readyAt < 0) {
  console.error('could not find HARDEN_PY / GL_PY / init / its warm-up / its ready message in ' + workerPath);
  process.exit(2);
}
const RESET_LINE = `  try { py.runPython("cmd.set('auto_color_next', 0)"); } catch (e) { log('auto_color_next: ' + e); }`;
const resetAt = initSrc.indexOf('\n' + RESET_LINE + '\n');
const resetPy = (RESET_LINE.match(/py\.runPython\("([^"]*)"\)/) || [])[1];
const order = {
  reset_line_present: resetAt >= 0,
  after_warm_delete: resetAt > warmDelete.index,
  before_ready: resetAt >= 0 && resetAt < readyAt,
  warm_before_delete: warm.index < warmDelete.index,
};

const indexURL = path.resolve(coreDir) + '/';
createRequire(import.meta.url)(path.join(indexURL, 'pyodide.js'));

const BOOT = String.raw`
import json, os
import pymol, pymol.invocation, pymol2
pymol.invocation.parse_args(['pymol', '-cq'])
_inst = pymol2.SingletonPyMOL(); _inst.start()
from pymol import cmd, stored
_pdb = os.path.join(os.path.dirname(pymol.__file__), 'pymol_path', 'data', 'tut', '1hpv.pdb')
def _agdb_test_carbons(obj):
    stored._agdb_c = set()
    cmd.iterate('%s and elem C' % obj, 'stored._agdb_c.add(color)')
    return sorted(stored._agdb_c)
`;
const acn = (py) => Number(py.runPython("cmd.get_setting_int('auto_color_next')"));

// One fresh boot: init's Python up to the warm-up, then `steps`, then two
// loads of 1hpv. Returns the cycle position along the way and the colours.
async function run(steps) {
  const py = await globalThis.loadPyodide({ indexURL, stdout: () => {}, stderr: () => {} });
  await py.loadPackage([path.resolve(numpyWheel), path.resolve(pymolWheel)], { messageCallback: () => {} });
  const out = { acn: {} };
  try {
    py.runPython(BOOT);
    py.runPython(harden[1]);
    py.runPython(gl[1]);
    py.runPython("cmd.set('max_threads', 1)");
    py.runPython('_agdb_gl_defaults()');
    out.acn.boot = acn(py);
    for (const [label, code] of steps) { py.runPython(code); out.acn[label] = acn(py); }
    const cmd = py.globals.get('cmd');
    const pdb = py.FS.readFile(String(py.runPython('_pdb')));
    for (const obj of ['obj1', 'obj2']) {      // the load branch's tick task (not 'first': a selection keyword)
      const fn = '/tmp/in_' + obj + '.pdb';
      py.FS.writeFile(fn, pdb);
      try { cmd.load(fn, obj, 0, 'pdb'); } finally { try { py.FS.unlink(fn); } catch (e) {} }
    }
    out.acn.after_loads = acn(py);
    out.names = py.runPython('cmd.get_names()').toJs();
    out.carbons = {
      obj1: py.runPython("_agdb_test_carbons('obj1')").toJs(),
      obj2: py.runPython("_agdb_test_carbons('obj2')").toJs(),
    };
    // For the report only. An index can carry several names; the first listed
    // is kept (26 lists as "carbon", the green; 29 as "hydrogen", the grey).
    const idx = {};
    for (const [n, i] of py.runPython('cmd.get_color_indices()').toJs()) if (!(i in idx)) idx[i] = n;
    out.colour_names = { obj1: out.carbons.obj1.map((i) => idx[i] || '?'), obj2: out.carbons.obj2.map((i) => idx[i] || '?') };
  } catch (e) {
    out.error = String((e && e.message) || e).split('\n').slice(-3).join(' | ').slice(0, 400);
  }
  return out;
}

const WARM = [['after_warm_fab', warm[1]], ['after_warm_delete', warmDelete[1]]];
const result = { order, warm_py: warm[1], reset_py: resetPy };
result.no_warmup = await run([]);
result.warmup_no_reset = await run(WARM);
result.warmup_reset = order.reset_line_present ? await run([...WARM, ['after_reset', resetPy]]) : { skipped: 'the reset line is not in init' };
const w = result.warmup_no_reset.acn;
result.warmup_advance = Number.isFinite(w.after_warm_delete - w.boot) ? w.after_warm_delete - w.boot : null;

// ---- expectations --------------------------------------------------------------
const failures = [];
const expect = (cond, why) => { if (!cond) failures.push(why); };
const cols = (r) => JSON.stringify(r && r.carbons ? [r.carbons.obj1, r.carbons.obj2] : null);

expect(order.warm_before_delete, "init: the warm-up's fab no longer comes before cmd.delete('_warm')");
expect(order.reset_line_present, 'init does not carry the reset line: ' + RESET_LINE.trim());
expect(order.after_warm_delete && order.before_ready, "init: the reset line is not after cmd.delete('_warm') and before the ready message: " + JSON.stringify(order));

const nw = result.no_warmup;
expect(!nw.error && cols(nw) === '[[26],[5]]', 'no warm-up: want carbons 26 (green) then 5 (cyan): ' + JSON.stringify(nw));
const wr = result.warmup_reset;
if (!wr.skipped) {   // a missing line is already a failure above
  expect(!wr.error && wr.acn.after_reset === 0, 'warm-up + reset: auto_color_next is not 0 after the reset: ' + JSON.stringify(wr));
  expect(!wr.error && cols(wr) === '[[26],[5]]' && cols(wr) === cols(nw),
    'warm-up + reset: want carbons 26 then 5, as a boot with no warm-up: ' + JSON.stringify(wr));
}
// Positive control.
const wn = result.warmup_no_reset;
expect(!wn.error && cols(wn) === '[[9],[29]]', 'control: warm-up without the reset should give carbons 9 (salmon) then 29 (grey): ' + JSON.stringify(wn));
expect(result.warmup_advance !== null && result.warmup_advance > 0, 'control: the warm-up did not move the colour cycle (the reset would be a no-op): ' + JSON.stringify(wn.acn));

const report = { ok: failures.length === 0, failures, result };
if (reportPath) writeFileSync(reportPath, JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1));
process.exit(report.ok ? 0 : 1);
