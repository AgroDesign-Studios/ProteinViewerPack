// The frame's S2 drawing defaults (GL_PY in worker.js, PT-9554 S2) on the REAL
// runtime (node, headless PyMOL). Modelled on frame_gl_defaults.mjs and
// hand-run like it, under the host guard (a node Pyodide reaches the host
// shell otherwise):
//
//   node --import pymol-wasm/bench/lib/guard_preload.mjs pymol-wasm/tests/frame_s2_defaults.mjs \
//        <pyodide-core-dir> <numpy-wheel> <pymol-wheel> <worker.js> [report.json]
//
// GL_PY, RESTORE_PY and the `def _frame():` block of START_PY are EXTRACTED
// from the given worker.js (never copied) and run the worker's way. What it
// checks, each with a positive control that shows the check can fail:
//   1. cgo_shader_ub_color (CGO colours packed as bytes): PyMOL's default 0;
//      GL_PY alone sets nothing; 1 after the boot call _agdb_gl_defaults(); a
//      user's own 0 stands through ordinary work; 1 again after RESTORE_PY
//      of a .pse and of a broken .pse, and after every reinitialize form that
//      puts the settings back (store_defaults / purge_defaults leave it).
//      Control: RESTORE_PY without its _agdb_gl_defaults() line leaves 0.
//   2. defer_builds_mode: PyMOL's default 0; 1 after the boot call; the
//      frame's value follows grid_mode (2 / 3 -> 0, 0 / 1 -> 1) through
//      _agdb_defer_follow(); a user's own 0 or 2 stands through grid
//      toggles and is claimed back by _agdb_gl_defaults(). PyMOL's own
//      auto_defer_builds rule, on real loads of a multi-model PDB (limit
//      lowered to 5): under 0 a load raises it to 1, under 1 it stays 1
//      (control: limit 7 leaves 0). The frame follows that rule in a grid
//      by state whichever comes first (PT-9670): loaded under the frame's 1
//      and then the grid on -> 1 (controls: limit 7, limit -1 and no object
//      loaded give the grid its 0); the grid on first, the load raises it to
//      1, follow leaves that 1 through grid toggles, and _agdb_gl_defaults()
//      (direct, and RESTORE_PY of a broken .pse with the grid on) keeps 1
//      while the object is loaded and claims 0 once it is gone. Control: a
//      grid change without the follow moves nothing.
//   3. the session-save task: get_session writes the frame's own 1 as 0, and
//      keeps the frame's grid 0 and a user's own 2 or 0; with an object of
//      auto_defer_builds states or more loaded it keeps the frame's 1, the
//      value desktop PyMOL would have saved (control: limit 7 -> 0), and
//      desktop PyMOL reads that .pse as 1; a .pse saved by
//      the frame opens with 0 in a second, "desktop" PyMOL (a second Pyodide
//      in this process, PyMOL booted the same way, GL_PY never run).
//      Control: without the task the session carries 1, and desktop reads 1.
//   4. RESTORE_PY: a .pse saved in a grid by state restores 0, one saved with
//      grid 0 restores 1, one saved in a grid by state with a 6-model object
//      and auto_defer_builds 5 restores 1 (and with 7, 0), and the frame owns
//      the value after it (follow still
//      tracks grid toggles). Control: without the _agdb_gl_defaults() line
//      the session's 0 stays and the frame no longer tracks the grid.
//   5. _frame(): with a stub standing in for _inst only (the real cmd, a real
//      grid_mode 2 set with cmd.set, no follow), idle() 1 -> defer 0 and 1
//      returned; idle() 0 -> no follow, getRedisplay() decides. Control: the
//      block without its _agdb_defer_follow() line leaves the value.
//   6. a follow failure (cmd.get_setting_int made to raise for grid_mode)
//      is said once on stderr and does not raise. Control:
//      _agdb_defer_sync() itself raises.
// The objects are made in place (cmd.fab, cmd.create per state; the
// multi-model file for the PyMOL control is saved from that object): no
// structure file is read.
// Exit 0 = every expectation held; 1 = one did not (the report's `failures`
// says which); 2 = usage / extraction error.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const [coreDir, numpyWheel, pymolWheel, workerPath, reportPath] = process.argv.slice(2);
if (!workerPath) {
  console.error('usage: node --import pymol-wasm/bench/lib/guard_preload.mjs frame_s2_defaults.mjs <core-dir> <numpy-wheel> <pymol-wheel> <worker.js> [report.json]');
  process.exit(2);
}

const failures = [];
const results = [];
const measured = {};
const notes = [];
function finish(code) {
  const ok = code === 0 && failures.length === 0;
  const report = { ok, failures, results, measured, notes, worker: path.resolve(workerPath) };
  if (reportPath) writeFileSync(reportPath, JSON.stringify(report, null, 1));
  for (const r of results) console.log((r.ok ? 'ok   ' : 'FAIL ') + r.name + ': ' + JSON.stringify(r.got) + (r.ok ? '' : ' (want ' + JSON.stringify(r.want) + ')'));
  for (const n of notes) console.log('note ' + n);
  console.log(JSON.stringify({ ok, failures: failures.length, results: results.length }));
  process.exit(code !== 0 ? code : (ok ? 0 : 1));
}

// ---- extraction ----------------------------------------------------------------
const workerSrc = readFileSync(workerPath, 'utf8');
const gl = workerSrc.match(/const GL_PY = String\.raw`([\s\S]*?)`;/);
const restore = workerSrc.match(/const RESTORE_PY = String\.raw`([\s\S]*?)`;/);
const startTpl = workerSrc.match(/const START_PY = \(w, h, gui\) => String\.raw`([\s\S]*?)`;/);
// The `def _frame():` block: its line and the indented lines after it.
let FRAME_PY = null;
if (startTpl) {
  const lines = startTpl[1].split('\n');
  const i = lines.findIndex((l) => l.startsWith('def _frame():'));
  if (i >= 0) {
    let j = i + 1;
    while (j < lines.length && /^\s+\S/.test(lines[j])) j++;
    FRAME_PY = lines.slice(i, j).join('\n') + '\n';
  }
}
const extractErr = [];
if (!gl) extractErr.push('GL_PY not found');
if (!restore) extractErr.push('RESTORE_PY not found');
if (!startTpl) extractErr.push('START_PY template not found');
if (startTpl && !FRAME_PY) extractErr.push('START_PY has no `def _frame():` block');
if (FRAME_PY && FRAME_PY.includes('${')) extractErr.push('the _frame block holds a template placeholder');
// The boot call, as init makes it.
if (!workerSrc.includes("py.runPython('_agdb_gl_defaults()');")) extractErr.push('init does not call _agdb_gl_defaults()');
if (extractErr.length) {
  for (const e of extractErr) failures.push('extraction: ' + e);
  console.error('extraction failed in ' + workerPath + ': ' + extractErr.join('; '));
  finish(2);
}
const GL_PY = gl[1];
const RESTORE = restore[1];
// Controls built from the extracted code (never a copy of it).
const RESTORE_BARE = RESTORE.replace(/^_agdb_gl_defaults\(\)$/m, 'pass');
const FRAME_NOFOLLOW = FRAME_PY.replace(/^[ \t]+_agdb_defer_follow\(\)\n/m, '').replace('def _frame():', 'def _t_frame_nofollow():');

// ---- runtime -------------------------------------------------------------------
const indexURL = path.resolve(coreDir) + '/';
createRequire(import.meta.url)(path.join(indexURL, 'pyodide.js'));

// PyMOL booted headless, as frame_gl_defaults does, plus the test's helpers
// (prefixed _t_, none of them the worker's).
const BOOT = String.raw`
import json
import pymol, pymol.invocation, pymol2
pymol.invocation.parse_args(['pymol', '-cq'])
_inst = pymol2.SingletonPyMOL(); _inst.start()
from pymol import cmd
import pymol.setting as _t_st
_T_DEFER = _t_st._get_index('defer_builds_mode')
def _t_session_defer(sess=None):
    s = cmd.get_session() if sess is None else sess
    v = [e[2] for e in (s.get('settings') or ()) if e and e[0] == _T_DEFER]
    return v[0] if len(v) == 1 else ('missing' if not v else v)
def _t_put(src):
    open('/tmp/sess.pse', 'wb').write(open(src, 'rb').read())
def _t_multistate(name, n):
    # n states of a peptide, made one state at a time with cmd.create, which
    # does not trip PyMOL's own auto_defer_builds (a load does).
    cmd.fab('AAAA', '_t_src')
    for i in range(1, n + 1):
        cmd.create(name, '_t_src', 1, i)
    cmd.delete('_t_src')
    return cmd.count_states(name)
`;

async function bootPyMOL(stderrSink) {
  const py = await globalThis.loadPyodide({ indexURL, stdout: () => {}, stderr: (s) => stderrSink.push(String(s)) });
  await py.loadPackage([path.resolve(numpyWheel), path.resolve(pymolWheel)], { messageCallback: () => {} });
  py.runPython(BOOT);
  return py;
}

const errText = (e) => String((e && e.message) || e).trim().split('\n').slice(-2).join(' | ').slice(0, 300);
const toJs = (v) => (v && typeof v.toJs === 'function' ? v.toJs({ dict_converter: Object.fromEntries }) : v);
const frameErr = [];
const py = await bootPyMOL(frameErr);
// A Python value (number / string / JSON-able), or {error} when it raised.
function R(code) {
  try { return toJs(py.runPython(code)); } catch (e) { return { error: errText(e) }; }
}
// A setup step: its failure is a failure of the run, said by its label.
function step(label, code) {
  try { py.runPython(code); return true; } catch (e) { failures.push(label + ': raised ' + errText(e)); return false; }
}
function expect(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  results.push({ name, got, want, ok });
  if (!ok) failures.push(name + ': got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}
const S = (k) => R(`cmd.get_setting_int('${k}')`);
const UB = 'cgo_shader_ub_color', DEFER = 'defer_builds_mode';
const follow = (label) => step(label + ' (_agdb_defer_follow)', '_agdb_defer_follow()');
const grid = (g, label) => { step(label + ' (grid_mode ' + g + ')', `cmd.set('grid_mode', ${g})`); return follow(label); };
const restoreWith = (code) => { const r = R(code); return (r && typeof r === 'string') ? JSON.parse(r) : { err: 'RESTORE_PY raised: ' + JSON.stringify(r) }; };

// ---- boot ----------------------------------------------------------------------
expect('1. cgo_shader_ub_color: PyMOL default', S(UB), 0);
expect('2. defer_builds_mode: PyMOL default', S(DEFER), 0);
measured.auto_defer_builds_default = S('auto_defer_builds');
step('GL_PY', GL_PY);
expect('1. GL_PY alone sets nothing (cgo_shader_ub_color)', S(UB), 0);
expect('2. GL_PY alone sets nothing (defer_builds_mode)', S(DEFER), 0);
step('boot call', '_agdb_gl_defaults()');
expect('1. after the boot call (cgo_shader_ub_color)', S(UB), 1);
expect('2. after the boot call (defer_builds_mode)', S(DEFER), 1);

// ---- 1. cgo_shader_ub_color ----------------------------------------------------
step('1. member sets 0', `cmd.set('${UB}', 0)`);
step('1. ordinary work', "cmd.fab('AAAA', 'p'); cmd.show('cartoon'); cmd.show('sticks'); cmd.do('color red'); cmd.do('reinitialize store_defaults'); cmd.do('reinitialize purge_defaults')");
grid(2, '1. grid toggle'); grid(0, '1. grid toggle');
expect("1. a member's own 0 stands through work, store/purge_defaults and grid follows", S(UB), 0);

step('1. a .pse saved with cgo_shader_ub_color 0', `cmd.set('${UB}', 0); cmd.save('/tmp/t_ub0.pse'); _t_put('/tmp/t_ub0.pse')`);
const ubRestored = restoreWith(RESTORE);
expect('1. RESTORE_PY of a .pse: no error', ubRestored.err, null);
expect('1. RESTORE_PY of a .pse (cgo_shader_ub_color)', S(UB), 1);
// Control: the setting is session-blacklisted, yet set_session puts it back
// to PyMOL's 0: why RESTORE_PY needs its _agdb_gl_defaults() line.
expect('1. control: RESTORE_PY has its _agdb_gl_defaults() line', RESTORE_BARE !== RESTORE, true);
step('1. control setup', `cmd.set('${UB}', 1); _t_put('/tmp/t_ub0.pse')`);
restoreWith(RESTORE_BARE);
expect('1. control: RESTORE_PY without that line leaves cgo_shader_ub_color 0', S(UB), 0);
step('1. a broken .pse', `cmd.set('${UB}', 0); open('/tmp/sess.pse', 'wb').write(b'not a session')`);
const ubBroken = restoreWith(RESTORE);
expect('1. RESTORE_PY of a broken .pse reports an error', ubBroken.err !== null && ubBroken.err !== undefined, true);
expect('1. RESTORE_PY of a broken .pse (cgo_shader_ub_color)', S(UB), 1);

// Every way the frame can reach reinitialize. Before each: a user's own
// cgo_shader_ub_color 0 and defer_builds_mode 2.
for (const [label, call, wantUb, wantDefer] of [
  ['cmd.do reinitialize', "cmd.do('reinitialize')", 1, 1],
  ['cmd.reinitialize()', 'cmd.reinitialize()', 1, 1],
  ['cmd.do reinitialize settings', "cmd.do('reinitialize settings')", 1, 1],
  ['cmd.do reinitialize original_settings', "cmd.do('reinitialize original_settings')", 1, 1],
  ['cmd.reinitialize shortcut orig', "cmd.reinitialize('orig')", 1, 1],
  ['cmd.do /cmd.reinitialize() (the menu)', "cmd.do('/cmd.reinitialize()')", 1, 1],
  ['cmd.reinitialize store_defaults', "cmd.reinitialize('store_defaults')", 0, 2],
  ['cmd.reinitialize purge_defaults', "cmd.reinitialize('purge_defaults')", 0, 2],
]) {
  step('1. reinit setup ' + label, `cmd.set('${UB}', 0); cmd.set('${DEFER}', 2)`);
  step('1. ' + label, call);
  expect('1. ' + label + ' (cgo_shader_ub_color)', S(UB), wantUb);
  expect('1. ' + label + ' (defer_builds_mode)', S(DEFER), wantDefer);
}

// ---- 2. defer_builds_mode follows grid_mode ------------------------------------
step('2. reinitialize', 'cmd.reinitialize()');
expect("2. after reinitialize: the frame's 1", S(DEFER), 1);
step('2. control: grid_mode 2 without a follow', "cmd.set('grid_mode', 2)");
expect('2. control: a grid change alone does not move defer_builds_mode', S(DEFER), 1);
for (const [g, want] of [[2, 0], [3, 0], [1, 1], [0, 1]]) {
  grid(g, '2. grid ' + g);
  expect(`2. grid_mode ${g} then follow`, S(DEFER), want);
}
for (const own of [0, 2]) {
  grid(0, `2. own ${own} setup`);
  step(`2. a member sets defer_builds_mode ${own}`, `cmd.set('${DEFER}', ${own})`);
  const seen = [];
  for (const g of [2, 0, 3, 1]) { grid(g, `2. own ${own}`); seen.push(S(DEFER)); }
  expect(`2. a member's own ${own} stands through grid 2/0/3/1 and follows`, seen, [own, own, own, own]);
  step(`2. claim after own ${own}`, '_agdb_gl_defaults()');
  expect(`2. a member's own ${own} is claimed back by _agdb_gl_defaults() (grid 1)`, S(DEFER), 1);
}

// auto_defer_builds: PyMOL's own rule. Loading an object of auto_defer_builds
// states or more raises a 0 to 1 and leaves a nonzero value (measured); in a
// grid by state the frame takes the same rule (_agdb_defer_raised, PT-9670).
// A 6-model PDB, saved from an object built state by state, loaded the
// worker's way with auto_defer_builds 5.
measured.states_made = R("_t_multistate('ms', 6)");
step('2. a 6-model file', "cmd.save('/tmp/t_ms6.pdb', 'ms', 0); cmd.delete('ms')");
const load6 = (label) => step(label + ' (load the 6-model file)', "cmd.delete('m6'); cmd.load('/tmp/t_ms6.pdb', 'm6', 0, 'pdb')");
// (c) PyMOL's own rule, judged: under 0 it raises to 1; under 1 it stays 1.
step('2. PyMOL control setup', `cmd.reinitialize(); cmd.set('auto_defer_builds', 5); cmd.set('${DEFER}', 0)`);
load6('2. PyMOL control under 0');
measured.pymol_load_states = R("cmd.count_states('m6')");
measured.pymol_auto_defer_raise_from_0 = S(DEFER);
expect('2. PyMOL: under 0, a 6-model load (auto_defer_builds 5) raises defer_builds_mode to', measured.pymol_auto_defer_raise_from_0, 1);
step('2. PyMOL control: auto_defer_builds above the model count', `cmd.set('auto_defer_builds', 7); cmd.set('${DEFER}', 0)`);
load6('2. PyMOL control under 0, auto 7');
expect('2. control: under 0 with auto_defer_builds 7, the same load leaves 0 (the raise is the auto_defer_builds rule)', S(DEFER), 0);
step('2. PyMOL control under 1 setup', `cmd.set('auto_defer_builds', 5); cmd.set('${DEFER}', 1)`);
load6('2. PyMOL control under 1');
expect('2. PyMOL: under 1, a 6-model load leaves defer_builds_mode', S(DEFER), 1);
// (a) Under the frame's 1 the raise is a no-op: the load leaves 1, follow
// keeps 1, and the frame still owns the value; turning the grid on then
// keeps 1, as PyMOL's rule would have raised it at the load.
step('2. frame 1 setup', "cmd.reinitialize(); cmd.set('auto_defer_builds', 5)");
expect("2. frame 1 setup: the frame's 1", S(DEFER), 1);
load6('2. frame 1');
expect("2. under the frame's 1, a 6-model load leaves defer_builds_mode 1", S(DEFER), 1);
follow('2. frame 1 after the load');
expect("2. under the frame's 1, follow after the load keeps 1", S(DEFER), 1);
grid(2, '2. frame 1 after the load');
expect("2. ... then grid 2 and follow -> 1 (PyMOL's rule: the 6-model object, auto_defer_builds 5; PT-9670)", S(DEFER), 1);
// Controls: the rule's own inputs decide it.
step('2. control: auto_defer_builds 7', "cmd.set('auto_defer_builds', 7)");
grid(0, '2. control auto 7'); grid(2, '2. control auto 7');
expect('2. control: auto_defer_builds 7 (above the 6 states): grid 2 then follow -> 0', S(DEFER), 0);
step('2. control: auto_defer_builds -1', "cmd.set('auto_defer_builds', -1)");
grid(0, '2. control auto -1'); grid(2, '2. control auto -1');
expect('2. control: auto_defer_builds -1 (off): grid 2 then follow -> 0', S(DEFER), 0);
step('2. auto_defer_builds 5 again', "cmd.set('auto_defer_builds', 5)");
grid(0, '2. auto 5 again'); grid(2, '2. auto 5 again');
expect('2. auto_defer_builds 5 again: grid 2 then follow -> 1', S(DEFER), 1);
measured.count_states_all = R("cmd.count_states('all')");
step('2. control: the object goes', "cmd.delete('m6')");
grid(0, '2. control no object'); grid(2, '2. control no object');
expect('2. control: no object loaded: grid 2 then follow -> 0', S(DEFER), 0);
grid(0, '2. end of (a)');
// (b) In a grid by state (the frame's 0) the load raises it to 1; follow
// leaves that 1 (PyMOL's value, as desktop PyMOL would show it), through
// grid toggles too; _agdb_gl_defaults() (the restore / reinitialize call)
// keeps 1 while the object is loaded and claims 0 once it is gone.
step('2. grid setup', "cmd.reinitialize(); cmd.set('auto_defer_builds', 5)");
grid(2, '2. grid setup');
expect("2. grid by state: the frame's 0", S(DEFER), 0);
load6('2. grid');
expect("2. in a grid by state (the frame's 0), a 6-model load raises defer_builds_mode to", S(DEFER), 1);
follow('2. grid after the load');
expect("2. follow then leaves PyMOL's 1 (not the frame's 0)", S(DEFER), 1);
const seenRaised = [];
for (const g of [0, 3, 2]) { grid(g, '2. raised'); seenRaised.push(S(DEFER)); }
expect("2. PyMOL's 1 stands through grid 0/3/2 and follows", seenRaised, [1, 1, 1]);
step('2. claim with the grid on', '_agdb_gl_defaults()');
expect("2. _agdb_gl_defaults() with grid 2 on and the 6-model object loaded: PyMOL's rule, 1", S(DEFER), 1);
grid(0, '2. after the claim');
expect('2. after the claim, follow tracks again: grid 0 -> 1', S(DEFER), 1);
grid(2, '2. grid again');
expect('2. grid 2 again with the object loaded -> 1', S(DEFER), 1);
load6('2. reload');
follow('2. reload');
expect('2. reloaded in grid 2, follow leaves', S(DEFER), 1);
step('2. a broken .pse with the grid on', "open('/tmp/sess.pse', 'wb').write(b'not a session')");
const gridBroken = restoreWith(RESTORE);
expect('2. RESTORE_PY of a broken .pse (grid 2 stays): reports an error', gridBroken.err !== null && gridBroken.err !== undefined, true);
expect('2. ... grid_mode is still', S('grid_mode'), 2);
expect('2. ... the object is still loaded', R("cmd.count_states('m6')"), 6);
expect("2. ... and its _agdb_gl_defaults() keeps PyMOL's rule: defer_builds_mode", S(DEFER), 1);
step('2. the object goes; a broken .pse again', "cmd.delete('m6'); open('/tmp/sess.pse', 'wb').write(b'not a session')");
restoreWith(RESTORE);
expect('2. ... with no object, its _agdb_gl_defaults() claims defer_builds_mode to', S(DEFER), 0);
grid(0, '2. end');

// ---- 3. the session-save task --------------------------------------------------
step('3. setup', "cmd.reinitialize(); cmd.fab('AAAA', 'p')");
expect("3. the frame's own 1 (live)", S(DEFER), 1);
expect("3. the frame's own 1: get_session()['settings'] carries", R('_t_session_defer()'), 0);
expect('3. the live value stays 1 after get_session', S(DEFER), 1);
grid(2, '3. grid 2');
expect("3. grid by state (the frame's 0): the session carries", R('_t_session_defer()'), 0);
grid(0, '3. grid 0');
step("3. a member's own 2", `cmd.set('${DEFER}', 2)`);
expect("3. a member's own 2: the session carries", R('_t_session_defer()'), 2);
step("3. a member's own 0", `cmd.set('${DEFER}', 0)`);
expect("3. a member's own 0: the session carries", R('_t_session_defer()'), 0);
// An object of auto_defer_builds states or more: desktop PyMOL would have
// raised its 0 to 1 at the load, so the session keeps the frame's 1.
step('3. a 6-model object, auto_defer_builds 5', "_agdb_gl_defaults(); cmd.set('auto_defer_builds', 5); cmd.load('/tmp/t_ms6.pdb', 'm6', 0, 'pdb')");
expect("3. the frame's own 1 with that object (live)", S(DEFER), 1);
expect("3. the frame's own 1 with that object: the session carries", R('_t_session_defer()'), 1);
step('3. a .pse saved with that object', "cmd.save('/tmp/t_frame_big.pse')");
step('3. control: auto_defer_builds 7', "cmd.set('auto_defer_builds', 7)");
expect('3. control: auto_defer_builds 7 (above the 6 states): the session carries', R('_t_session_defer()'), 0);
step('3. the object goes', "cmd.delete('m6'); cmd.set('auto_defer_builds', 500)");
step('3. claim', '_agdb_gl_defaults()');
step('3. the frame saves a .pse', "cmd.save('/tmp/t_frame.pse')");
// Control: the same session without the task.
step('3. control: remove the task', '_t_tasks = list(cmd._pymol._session_save_tasks); cmd._pymol._session_save_tasks.remove(_agdb_defer_save)');
expect('3. control: without the save task the session carries', R('_t_session_defer()'), 1);
step('3. control: a .pse saved without the task', "cmd.save('/tmp/t_frame_notask.pse')");
step('3. put the task back', 'cmd._pymol._session_save_tasks[:] = _t_tasks');
expect("3. the frame's .pse file carries", R("from chempy import io as _t_io\n_t_session_defer(_t_io.pkl.fromString(open('/tmp/t_frame.pse', 'rb').read()))"), 0);

// "Desktop" PyMOL: a second Pyodide, PyMOL booted the same way, no GL_PY.
// Its value is set to 2 first, so what it reads after the load is the
// session's own value.
const desktopErr = [];
let desk = null;
try { desk = await bootPyMOL(desktopErr); } catch (e) { failures.push('3. desktop boot: ' + errText(e)); }
const deskRead = (file) => {
  if (!desk) return { error: 'no desktop PyMOL' };
  try {
    desk.FS.writeFile('/tmp/in.pse', py.FS.readFile(file));
    desk.runPython(`cmd.delete('all'); cmd.set('${DEFER}', 2); cmd.load('/tmp/in.pse')`);
    return toJs(desk.runPython(`cmd.get_setting_int('${DEFER}')`));
  } catch (e) { return { error: errText(e) }; }
};
expect("3. desktop PyMOL (no GL_PY) opens the frame's .pse: defer_builds_mode", deskRead('/tmp/t_frame.pse'), 0);
expect('3. control: desktop PyMOL opens a .pse saved without the task: defer_builds_mode', deskRead('/tmp/t_frame_notask.pse'), 1);
expect("3. desktop PyMOL opens the frame's .pse with the 6-model object (auto_defer_builds 5): defer_builds_mode", deskRead('/tmp/t_frame_big.pse'), 1);
measured.desktop_has_gl_py = desk ? toJs(desk.runPython("'_agdb_gl_defaults' in globals()")) : null;
expect('3. desktop PyMOL never ran GL_PY', measured.desktop_has_gl_py, false);

// ---- 4. RESTORE_PY -------------------------------------------------------------
step('4. setup', "cmd.reinitialize(); cmd.fab('AAAA', 'p')");
grid(2, '4. grid 2');
step('4. a .pse saved in a grid by state', "cmd.save('/tmp/t_g2.pse')");
grid(0, '4. grid 0');
step('4. a .pse saved with grid 0', "cmd.save('/tmp/t_g0.pse')");
step('4. restore the grid-2 .pse', "_t_put('/tmp/t_g2.pse')");
const g2 = restoreWith(RESTORE);
expect('4. RESTORE_PY of the grid-2 .pse: no error', g2.err, null);
expect('4. RESTORE_PY of the grid-2 .pse: grid_mode', S('grid_mode'), 2);
expect('4. RESTORE_PY of the grid-2 .pse: defer_builds_mode', S(DEFER), 0);
grid(0, '4. after the grid-2 restore');
expect('4. after the grid-2 restore, follow still tracks: grid 0 -> 1', S(DEFER), 1);
grid(2, '4. before the grid-0 restore');
step('4. restore the grid-0 .pse', "_t_put('/tmp/t_g0.pse')");
const g0 = restoreWith(RESTORE);
expect('4. RESTORE_PY of the grid-0 .pse: no error', g0.err, null);
expect('4. RESTORE_PY of the grid-0 .pse: grid_mode', S('grid_mode'), 0);
expect('4. RESTORE_PY of the grid-0 .pse: defer_builds_mode', S(DEFER), 1);
grid(2, '4. after the grid-0 restore');
expect('4. after the grid-0 restore, follow still tracks: grid 2 -> 0', S(DEFER), 0);
// A grid by state with a 6-model object: PyMOL's rule (auto_defer_builds 5)
// gives 1, and 7 gives 0; each restores to what was saved. Loaded under the
// frame's 1 (grid 0), so the 1 in the grid is the frame's, not PyMOL's raise.
grid(0, '4. big setup');
expect("4. big setup: the frame's 1", S(DEFER), 1);
step('4. a 6-model object, auto_defer_builds 5', "cmd.set('auto_defer_builds', 5); cmd.load('/tmp/t_ms6.pdb', 'm6', 0, 'pdb')");
grid(0, '4. big'); grid(2, '4. big');
expect('4. a grid by state with the 6-model object: the frame holds', S(DEFER), 1);
step('4. a .pse saved so', "cmd.save('/tmp/t_g2big.pse')");
step('4. the same with auto_defer_builds 7', "cmd.set('auto_defer_builds', 7)");
grid(0, '4. big, auto 7'); grid(2, '4. big, auto 7');
expect('4. ... with auto_defer_builds 7 the frame holds', S(DEFER), 0);
step('4. a .pse saved so (auto 7)', "cmd.save('/tmp/t_g2big7.pse')");
step('4. reset', "cmd.reinitialize(); cmd.fab('AAAA', 'p')");
step('4. restore the big grid-2 .pse', "_t_put('/tmp/t_g2big.pse')");
const gb5 = restoreWith(RESTORE);
expect('4. RESTORE_PY of the big grid-2 .pse: no error', gb5.err, null);
expect('4. RESTORE_PY of the big grid-2 .pse: grid_mode', S('grid_mode'), 2);
expect('4. RESTORE_PY of the big grid-2 .pse (auto_defer_builds 5): defer_builds_mode', S(DEFER), 1);
step('4. restore the big grid-2 .pse (auto 7)', "_t_put('/tmp/t_g2big7.pse')");
const gb7 = restoreWith(RESTORE);
expect('4. RESTORE_PY of the big grid-2 .pse (auto 7): no error', gb7.err, null);
expect('4. RESTORE_PY of the big grid-2 .pse (auto_defer_builds 7): defer_builds_mode', S(DEFER), 0);
step('4. reset after the big cases', "cmd.reinitialize(); cmd.fab('AAAA', 'p')");
grid(0, '4. broken setup');
step("4. a broken .pse over a member's own 2", `cmd.set('${DEFER}', 2); open('/tmp/sess.pse', 'wb').write(b'not a session')`);
const brk = restoreWith(RESTORE);
expect('4. RESTORE_PY of a broken .pse reports an error', brk.err !== null && brk.err !== undefined, true);
expect('4. RESTORE_PY of a broken .pse: defer_builds_mode claimed', S(DEFER), 1);
// Control: without the line, the session's 0 stays and the frame loses it.
step('4. control: restore the grid-0 .pse bare', "_t_put('/tmp/t_g0.pse')");
restoreWith(RESTORE_BARE);
expect("4. control: RESTORE_PY without _agdb_gl_defaults() leaves the session's 0", S(DEFER), 0);
grid(2, '4. control'); grid(0, '4. control');
expect('4. control: after that, follow no longer tracks (grid 2, 0 -> still 0)', S(DEFER), 0);
step('4. claim back', '_agdb_gl_defaults()');

// ---- 5. _frame() ---------------------------------------------------------------
step('5. the _frame block', FRAME_PY);
const FOLLOW_LINE = /^[ \t]+_agdb_defer_follow\(\)$/m;
expect('5. control: the _frame block has its _agdb_defer_follow() line (and the control block not)',
  FOLLOW_LINE.test(FRAME_PY) && FRAME_NOFOLLOW.includes('def _t_frame_nofollow():') && !FOLLOW_LINE.test(FRAME_NOFOLLOW), true);
step('5. the control block', FRAME_NOFOLLOW);
step('5. the stub', String.raw`
class _T_Stub:
    def __init__(self, idle, redisplay):
        self._i, self._r = idle, redisplay
    def idle(self):
        return self._i
    def getRedisplay(self):
        return self._r
_t_real_inst = _inst
def _t_frame(idle, redisplay, fn='_frame'):
    # Only _inst is a stand-in; cmd and the settings are the real ones.
    global _inst
    _inst = _T_Stub(idle, redisplay)
    try:
        return globals()[fn]()
    finally:
        _inst = _t_real_inst
`);
step('5. setup', "cmd.reinitialize(); cmd.fab('AAAA', 'p')");
expect("5. setup: the frame's 1", S(DEFER), 1);
step('5. grid_mode 2 set directly', "cmd.set('grid_mode', 2)");
expect('5. idle() 1: _frame() returns', R('_t_frame(1, 0)'), 1);
expect('5. idle() 1: defer_builds_mode followed the grid', S(DEFER), 0);
step('5. grid_mode 0 set directly', "cmd.set('grid_mode', 0)");
expect('5. idle() 0, getRedisplay() 0: _frame() returns', R('_t_frame(0, 0)'), 0);
expect('5. idle() 0: no follow (defer_builds_mode stays 0 under grid 0)', S(DEFER), 0);
expect('5. idle() 0, getRedisplay() 1: _frame() returns', R('_t_frame(0, 1)'), 1);
expect('5. idle() 0, getRedisplay() 1: still no follow', S(DEFER), 0);
expect('5. idle() 1 again: _frame() returns', R('_t_frame(1, 0)'), 1);
expect('5. idle() 1 again: follows to 1', S(DEFER), 1);
step('5. control: grid_mode 2 set directly', "cmd.set('grid_mode', 2)");
expect('5. control: the block without the follow line returns', R("_t_frame(1, 0, '_t_frame_nofollow')"), 1);
expect('5. control: the block without the follow line leaves defer_builds_mode 1', S(DEFER), 1);
follow('5. resync');
expect('5. resync after the control', S(DEFER), 0);
grid(0, '5. end');

// ---- 6. a follow failure -------------------------------------------------------
// The failure is put where the frame's own work starts: reading grid_mode,
// after the ownership check (which reads defer_builds_mode) has passed.
step('6. setup', String.raw`
_t_get_setting_int = cmd.get_setting_int
def _t_boom(name, *a, **k):
    if name == 'grid_mode':
        raise RuntimeError('t-boom')
    return _t_get_setting_int(name, *a, **k)
`);
expect("6. setup: the frame's 1", S(DEFER), 1);
const errAt = frameErr.length;
const thrown = R(String.raw`
cmd.get_setting_int = _t_boom
try:
    _t_raised = None
    for _t_i in range(3):
        _agdb_defer_follow()
except Exception as e:
    _t_raised = type(e).__name__ + ': ' + str(e)
finally:
    cmd.get_setting_int = _t_get_setting_int
_t_raised
`);
const said = frameErr.slice(errAt).filter((l) => l.startsWith('defer_builds_mode:'));
measured.follow_failure_stderr = frameErr.slice(errAt);
expect('6. a follow failure does not raise (3 calls)', thrown === undefined || thrown === null ? null : thrown, null);
expect('6. a follow failure is said once on stderr (3 calls)', said.length, 1);
expect('6. what it says names the failure', said.length === 1 && said[0].includes('RuntimeError') && said[0].includes('t-boom'), true);
const direct = R(String.raw`
cmd.get_setting_int = _t_boom
try:
    _agdb_defer_sync()
    _t_r = 'no raise'
except Exception as e:
    _t_r = type(e).__name__
finally:
    cmd.get_setting_int = _t_get_setting_int
_t_r
`);
expect('6. control: _agdb_defer_sync() itself raises on the same failure', direct, 'RuntimeError');
grid(2, '6. after the failure');
expect('6. after the failure, follow works again: grid 2 -> 0', S(DEFER), 0);

measured.frame_stderr_tail = frameErr.slice(-10);
finish(0);
