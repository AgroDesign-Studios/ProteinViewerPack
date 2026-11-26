// The frame's WebGL drawing defaults (GL_PY in worker.js, owner report
// 2026-11-16: "PyMOL's lines do not show") on the REAL runtime (node,
// headless PyMOL). Modelled on frame_load_formats.mjs; hand-run like it:
//
//   node frame_gl_defaults.mjs <pyodide-core-dir> <numpy-wheel> <pymol-wheel> <worker.js> [report.json]
//
// GL_PY and RESTORE_PY are EXTRACTED from the shipped worker.js and run the
// worker's way. It checks that `trilines` (without which WebGL draws no
// `lines` at all — the pixels are measured in a browser, not here) is:
//   1. 0 by PyMOL's own default, and 1 once the worker's boot call has run;
//   2. left at a user's own `set trilines, 0` by everything else the frame
//      does — so the boot call is not a loop that fights the user;
//   3. 1 again after RESTORE_PY restores a .pse saved with trilines 0 (a
//      desktop PyMOL session, or one this viewer saved before the fix), and
//      after a .pse that fails to restore;
//   4. 1 again after `reinitialize` everything / settings / original_settings,
//      by the command line, by cmd.reinitialize and by a shortcut name; and
//      left as it was by store_defaults / purge_defaults, which change no
//      setting.
// Exit 0 = every expectation held; 1 = one did not (the report says which).
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const [coreDir, numpyWheel, pymolWheel, workerPath, reportPath] = process.argv.slice(2);
if (!workerPath) {
  console.error('usage: node frame_gl_defaults.mjs <core-dir> <numpy-wheel> <pymol-wheel> <worker.js> [report.json]');
  process.exit(2);
}

const workerSrc = readFileSync(workerPath, 'utf8');
const gl = workerSrc.match(/const GL_PY = String\.raw`([\s\S]*?)`;/);
const restore = workerSrc.match(/const RESTORE_PY = String\.raw`([\s\S]*?)`;/);
if (!gl || !restore) { console.error('could not find GL_PY / RESTORE_PY in ' + workerPath); process.exit(2); }
// The boot call, as init makes it.
if (!workerSrc.includes("py.runPython('_agdb_gl_defaults()');")) { console.error('init does not call _agdb_gl_defaults() in ' + workerPath); process.exit(2); }

const indexURL = path.resolve(coreDir) + '/';
createRequire(import.meta.url)(path.join(indexURL, 'pyodide.js'));
const py = await globalThis.loadPyodide({ indexURL, stdout: () => {}, stderr: () => {} });
await py.loadPackage([path.resolve(numpyWheel), path.resolve(pymolWheel)], { messageCallback: () => {} });

const trilines = () => Number(py.runPython("cmd.get_setting_int('trilines')"));
const results = [];
function expect(name, got, want) {
  results.push({ name, got, want, ok: got === want });
}

py.runPython(String.raw`
import pymol, pymol.invocation, pymol2
pymol.invocation.parse_args(['pymol', '-cq'])
_inst = pymol2.SingletonPyMOL(); _inst.start()
from pymol import cmd
`);
expect('PyMOL default', trilines(), 0);
py.runPython(gl[1]);
expect('GL_PY alone sets nothing', trilines(), 0);
py.runPython('_agdb_gl_defaults()');
expect('after the boot call', trilines(), 1);

// 2. a user's own value stands through ordinary work.
py.runPython("cmd.set('trilines', 0)");
py.runPython("cmd.fab('AAAA', 'p'); cmd.show('lines'); cmd.do('color red'); cmd.do('reinitialize store_defaults'); cmd.do('reinitialize purge_defaults')");
expect('member set 0, then work + store/purge_defaults', trilines(), 0);

// 3. a session saved with trilines 0, restored the worker's way.
py.runPython("cmd.set('trilines', 0); cmd.save('/tmp/off.pse')");
py.runPython("cmd.set('trilines', 0); open('/tmp/sess.pse', 'wb').write(open('/tmp/off.pse', 'rb').read())");
const restored = JSON.parse(py.runPython(restore[1]));
expect('RESTORE_PY of a trilines-0 .pse: no error', restored.err, null);
expect('RESTORE_PY of a trilines-0 .pse', trilines(), 1);
// Control: without its _agdb_gl_defaults() line, the same restore takes the
// session's 0 over a current 1 — why the boot call alone is not enough.
const bare = restore[1].replace(/^_agdb_gl_defaults\(\)$/m, 'pass');
expect('control: RESTORE_PY has its _agdb_gl_defaults() line', bare !== restore[1], true);
py.runPython("cmd.set('trilines', 1); open('/tmp/sess.pse', 'wb').write(open('/tmp/off.pse', 'rb').read())");
py.runPython(bare);
expect('control: set_session alone takes the session\'s 0', trilines(), 0);
py.runPython("cmd.set('trilines', 0); open('/tmp/sess.pse', 'wb').write(b'not a session')");
const failed = JSON.parse(py.runPython(restore[1]));
expect('RESTORE_PY of a broken .pse reports an error', failed.err !== null, true);
expect('RESTORE_PY of a broken .pse', trilines(), 1);

// 4. reinitialize, every way the frame can reach it.
for (const [label, call, want] of [
  ['cmd.do reinitialize', "cmd.do('reinitialize')", 1],
  ['cmd.reinitialize()', 'cmd.reinitialize()', 1],
  ['cmd.do reinitialize settings', "cmd.do('reinitialize settings')", 1],
  ['cmd.do reinitialize original_settings', "cmd.do('reinitialize original_settings')", 1],
  ['cmd.reinitialize shortcut orig', "cmd.reinitialize('orig')", 1],
  ['cmd.do /cmd.reinitialize() (the menu)', "cmd.do('/cmd.reinitialize()')", 1],
  ['cmd.reinitialize store_defaults', "cmd.reinitialize('store_defaults')", 0],
  ['cmd.reinitialize purge_defaults', "cmd.reinitialize('purge_defaults')", 0],
]) {
  py.runPython("cmd.set('trilines', 0)");
  py.runPython(call);
  expect(label, trilines(), want);
}

const ok = results.every(r => r.ok);
for (const r of results) console.log((r.ok ? 'ok   ' : 'FAIL ') + r.name + ': ' + JSON.stringify(r.got) + (r.ok ? '' : ' (want ' + JSON.stringify(r.want) + ')'));
if (reportPath) writeFileSync(reportPath, JSON.stringify({ ok, results }, null, 2));
process.exit(ok ? 0 : 1);
