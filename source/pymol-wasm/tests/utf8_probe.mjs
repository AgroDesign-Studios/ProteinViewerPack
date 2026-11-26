// UTF-8 text in wizard prompts and scene messages (patch 0010, upstream #522).
//
//   node utf8_probe.mjs <pyodide-core-dir> <numpy.whl> <pymol.whl> <report.json>
//        [--only=<case>,<case>...] [--jobs=N] [--case-timeout=SECONDS]
//
// Six UTF-8 cases, plus one ASCII control that runs the same flows with ASCII
// text, ported from earlier study probes.
//
// Each case runs in its own worker thread with its own Pyodide (a trap kills
// the runtime), and the main thread terminates a case that runs longer than
// --case-timeout (default 60 s after its boot): a hang counts as a failure.
// Every thread calls guardHost() before Pyodide loads and runs PY_HOST_BLOCK
// right after (pymol-wasm/bench/README.md, trap 1); no thread starts a child
// process. Everything stays inside Pyodide's in-memory filesystem.
//
// Expectations: every case ran to its end with no trap, no hang, no step
// error and its checks true, and the runtime still answers afterwards.
// Exit 0 = every expectation held; 1 = one did not (or the probe itself
// failed); 2 = usage / unreadable input.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { accessSync, constants, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { guardHost, hostCalls, PY_HOST_BLOCK } from '../bench/lib/guard_host.mjs';

const PROBE = 'utf8_probe';

// ---- Python shared by every case ---------------------------------------------
const START_PY = String.raw`
import pymol, pymol.invocation, pymol2
pymol.invocation.parse_args(['pymol', '-cq'])
_probe_inst = pymol2.SingletonPyMOL(); _probe_inst.start()
from pymol import cmd
`;

// The shipped worker.js RESTORE_PY (PR-2's runtime build
// 3.2.0a-edcda80f-pyodide-314.0.7), copied verbatim; only its last
// line (the JSON answer) is dropped because it runs under exec() here.
const RESTORE_PY = String.raw`
import json
from chempy import io
_err = None; _atoms = None
try:
    sess = io.pkl.fromString(open('/tmp/sess.pse', 'rb').read())
    if isinstance(sess, bytes):
        # session_compression=1: a zlib-compressed pickle inside the pickle,
        # opened by the same restricted loader.
        import zlib
        sess = io.pkl.fromString(zlib.decompress(sess))
    for k in ('movie', 'wizard'):
        sess.pop(k, None)
    cmd.set_session(sess, quiet=1)
    cmd.mstop()
    _atoms = cmd.count_atoms('all')
except Exception as e:
    _err = type(e).__name__ + ': ' + str(e)
# After the session's settings, failed restore or not (GL_PY).
_agdb_gl_defaults()
`;

const PRELUDE_PY = String.raw`
import gc, json
from pymol import cmd
from pymol.wizard import Wizard

RESTORE_PY = ${JSON.stringify(RESTORE_PY)}

def _agdb_gl_defaults():
    # worker.js GL_PY's function, the only part RESTORE_PY calls
    cmd.set('trilines', 1, quiet=1)

_steps = []
_errors = []
_checks = {}

def st(label, f):
    """Run one step; record ok or the Python exception (a trap never returns here)."""
    print('[probe-step] ' + label, flush=True)  # the last one names the step a trap hit
    try:
        v = f()
        _steps.append(label + ':ok')
        return v
    except BaseException as e:
        _steps.append(label + ':' + type(e).__name__)
        _errors.append('%s: %s: %s' % (label, type(e).__name__, ' '.join(str(e).split())[:160]))
        return None

def check(name, cond):
    _checks[name] = bool(cond)

def _follow(tag):
    # keep using the heap after the text went through C (follow-up steps)
    st(tag + ' fab', lambda: cmd.fab('ACDEFGHIKL', 'q'))
    st(tag + ' alloc', lambda: [bytearray(k * 7 + 1) for k in range(2000)])
    st(tag + ' ray', lambda: cmd.ray(120, 90))
    st(tag + ' wizard2', lambda: (cmd.wizard('message', 'plain ascii'), cmd.wizard()))
    st(tag + ' delete', lambda: cmd.delete('all'))
    gc.collect()

def flow_wizard(tag, txt):
    """The message wizard set from Python."""
    st(tag + ' wizard', lambda: cmd.wizard('message', txt))
    st(tag + ' refresh', lambda: cmd.refresh_wizard())
    p = st(tag + ' prompt', lambda: cmd.get_wizard().get_prompt())
    check(tag + ' prompt kept', p == [txt])
    st(tag + ' dismiss', lambda: cmd.wizard())
    _follow(tag)

def flow_cmdline(tag, sentence):
    """'wizard message, ...' typed on the command line."""
    st(tag + ' do wizard', lambda: cmd.do('wizard message, ' + sentence))
    w = cmd.get_wizard()
    check(tag + ' prompt kept', w is not None and w.get_prompt() == [sentence])
    st(tag + ' refresh', lambda: cmd.refresh_wizard())
    st(tag + ' dismiss', lambda: cmd.wizard())
    _follow(tag)

def flow_scene(tag, msg):
    """A scene stored with a message, then recalled."""
    st(tag + ' fab', lambda: cmd.fab('ACDEFG', 'p'))
    st(tag + ' store F1', lambda: cmd.scene('F1', 'store', message=msg))
    st(tag + ' store F2', lambda: cmd.scene('F2', 'store'))
    check(tag + ' message stored', st(tag + ' get message', lambda: cmd.get_scene_message('F1')) == msg)
    st(tag + ' recall F2', lambda: cmd.scene('F2', 'recall'))
    st(tag + ' recall F1', lambda: cmd.scene('F1', 'recall'))
    w = cmd.get_wizard()
    check(tag + ' recall shows message', w is not None and getattr(w, 'message', None) == [msg])
    st(tag + ' refresh', lambda: cmd.refresh_wizard())
    st(tag + ' next', lambda: cmd.scene('', 'next'))
    st(tag + ' recall F1 again', lambda: cmd.scene('F1', 'recall'))
    st(tag + ' dismiss', lambda: cmd.wizard())
    _follow(tag)

def flow_pse(tag, msg):
    """A .pse whose scene carries a message, restored as the worker restores one, then recalled."""
    st(tag + ' fab', lambda: cmd.fab('ACDEFG', 'p'))
    st(tag + ' store F1', lambda: cmd.scene('F1', 'store', message=msg))
    n0 = cmd.count_atoms('all')
    scenes0 = cmd.get_scene_list()
    st(tag + ' save', lambda: cmd.save('/tmp/sess.pse'))
    st(tag + ' reinitialize', lambda: cmd.reinitialize())
    g = {'cmd': cmd, '_agdb_gl_defaults': _agdb_gl_defaults}
    st(tag + ' restore', lambda: exec(compile(RESTORE_PY, '<RESTORE_PY>', 'exec'), g))
    check(tag + ' restore no error', 'cmd' in g and g.get('_err', 'unset') is None)
    check(tag + ' restore atoms', g.get('_atoms') == n0 and n0 > 0)
    check(tag + ' restore scenes', 'F1' in scenes0 and cmd.get_scene_list() == scenes0)
    # the app menu's Scene > Recall > F1 ("/cmd.scene('F1', 'recall')")
    st(tag + ' menu recall F1', lambda: cmd.scene('F1', 'recall'))
    check(tag + ' message restored', st(tag + ' get message', lambda: cmd.get_scene_message('F1')) == msg)
    w = cmd.get_wizard()
    check(tag + ' recall shows message', w is not None and getattr(w, 'message', None) == [msg])
    st(tag + ' refresh', lambda: cmd.refresh_wizard())
    st(tag + ' dismiss', lambda: cmd.wizard())
    _follow(tag)

def flow_custom(tag, prompt, panel):
    """A user's own Python wizard whose prompt and panel carry the text."""
    class W(Wizard):
        def get_prompt(self):
            return [prompt, panel]
        def get_panel(self):
            return [[1, panel, ''], [2, panel[:2], 'cmd.set_wizard()'], [3, 'Mode', 'mode']]
    st(tag + ' set_wizard', lambda: cmd.set_wizard(W()))
    st(tag + ' refresh', lambda: cmd.refresh_wizard())
    check(tag + ' wizard set', type(cmd.get_wizard()).__name__ == 'W')
    st(tag + ' dismiss', lambda: cmd.set_wizard())
    _follow(tag)

def _result():
    return {'steps': _steps, 'errors': _errors, 'checks': _checks}
`;

// ---- the cases (Python, run after PRELUDE_PY) --------------------------------
// Parameters are ones that failed without the patch in earlier probes (evidence
// section 3.5) and in this probe's own runs.
const JA_SENTENCE = 'この構造は活性部位のリガンド結合ポケットを示します';
const CASES = {
  wizard_hiragana: `flow_wizard('wizard', 'あ' * 20)`,
  wizard_two_byte: `flow_wizard('wizard', 'Å' * 16)`,
  wizard_command_line: `flow_cmdline('cmdline', ${JSON.stringify(JA_SENTENCE)})`,
  scene_message_recall: `flow_scene('scene', '活性部位のリガンド結合ポケットを表示しています')`,
  pse_restore_scene_recall: `flow_pse('pse', '活性部位のリガンド結合ポケットを表示しています')`,
  python_wizard_prompt_panel: `flow_custom('custom', 'あ' * 20, '日本語のパネル見出し')`,
  // The control: every flow above, in one runtime, with ASCII text only.
  ascii_control: [
    `flow_wizard('wizard', 'a' * 20)`,
    `flow_cmdline('cmdline', 'this structure shows the ligand binding pocket of the active site')`,
    `flow_scene('scene', 'binding site figure')`,
    `flow_pse('pse', 'ligand binding pocket of the active site')`,
    `flow_custom('custom', 'click the atoms to measure', 'Panel heading')`,
  ].join('\n'),
};
const BUG_CASES = Object.keys(CASES).filter((n) => n !== 'ascii_control');

// ---- worker thread: one case in one fresh runtime ----------------------------
function wrapCase(code) {
  return [
    'import json as _json',
    'def _case():',
    ...code.split('\n').map((l) => '    ' + l),
    '    return _result()',
    'try:',
    "    _o = {'returned': True, 'value': _case()}",
    'except BaseException as _e:',
    "    _o = {'returned': False, 'exc': type(_e).__module__ + '.' + type(_e).__name__, 'msg': ' '.join(str(_e).split())[:300]}",
    '_json.dumps(_o, default=str)',
  ].join('\n');
}

function errInfo(e) {
  const msg = String((e && e.message) || e);
  return {
    js_error: (e && e.constructor && e.constructor.name) || typeof e,
    is_wasm_trap: e instanceof WebAssembly.RuntimeError,
    msg: msg.split('\n').map((x) => x.trim()).filter(Boolean).slice(-4).join(' | ').slice(0, 500),
  };
}

async function workerMain() {
  guardHost();
  const { core, numpy, pymol, code } = workerData;
  const post = (m) => parentPort.postMessage(m);
  const res = { status: 'harness_error' };
  try {
    const indexURL = path.resolve(core) + '/';
    const { loadPyodide } = await import(pathToFileURL(path.join(indexURL, 'pyodide.mjs')).href);
    const out = [];
    const onLine = (s) => {
      out.push(s);
      // the main thread keeps the last step even when it has to stop a hung case
      if (s.startsWith('[probe-step] ')) post({ type: 'step', s: s.slice(13) });
    };
    const py = await loadPyodide({ indexURL, stdout: onLine, stderr: onLine });
    await py.loadPackage([numpy, pymol], { messageCallback: () => {} });
    py.runPython(PY_HOST_BLOCK);
    py.runPython(START_PY);
    py.runPython(PRELUDE_PY);
    post({ type: 'booted' });
    try {
      const o = JSON.parse(py.runPython(wrapCase(code)));
      res.status = 'ran';
      Object.assign(res, o);
    } catch (e) {
      // runPython threw a JS error: the runtime failed below Python (a trap or an abort).
      res.status = 'fatal';
      Object.assign(res, errInfo(e));
    }
    try {
      res.alive = py.runPython('1+1') === 2;
    } catch (e) {
      res.alive = false;
      res.dead_msg = String((e && e.message) || e).split('\n')[0].slice(0, 200);
    }
    res.output_tail = out.filter((s) => !s.startsWith('[probe-step] ')).slice(-6).map((s) => s.slice(0, 200));
  } catch (e) {
    res.status = 'harness_error';
    Object.assign(res, errInfo(e));
  }
  res.host_calls = hostCalls.slice();
  post({ type: 'done', res });
}

// ---- main thread ---------------------------------------------------------------
function runCase(name, inputs, caseTimeoutMs, bootTimeoutMs) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let settled = false;
    let timer = null;
    let lastStep = null;
    const w = new Worker(fileURLToPath(import.meta.url), { workerData: { ...inputs, code: CASES[name] } });
    const finish = (res) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      res.ms = Date.now() - t0;
      res.last_step = lastStep;
      w.terminate().finally(() => resolve(res));
    };
    const arm = (ms, status) => {
      clearTimeout(timer);
      timer = setTimeout(() => finish({ status, limit_s: ms / 1000 }), ms);
    };
    arm(bootTimeoutMs, 'boot_timeout');
    w.on('message', (m) => {
      if (m && m.type === 'step') lastStep = m.s;
      else if (m && m.type === 'booted') arm(caseTimeoutMs, 'timeout');
      else if (m && m.type === 'done') finish(m.res);
    });
    w.on('error', (e) => finish({ status: 'worker_error', ...errInfo(e) }));
    w.on('exit', (c) => finish({ status: 'worker_exit', exit_code: c }));
  });
}

function casePassed(r) {
  if (!r || r.status !== 'ran' || r.returned !== true || r.alive !== true) return false;
  const v = r.value || {};
  const checks = Object.values(v.checks || {});
  return Array.isArray(v.errors) && v.errors.length === 0 && checks.length > 0 && checks.every((x) => x === true)
    && Array.isArray(r.host_calls) && r.host_calls.length === 0;
}

function sha256(p) {
  return createHash('sha256').update(readFileSync(p)).digest('hex');
}

async function main() {
  const argv = process.argv.slice(2);
  const pos = argv.filter((a) => !a.startsWith('--'));
  const opts = Object.fromEntries(argv.filter((a) => a.startsWith('--')).map((a) => {
    const i = a.indexOf('=');
    return i < 0 ? [a.slice(2), ''] : [a.slice(2, i), a.slice(i + 1)];
  }));
  const usage = (why) => {
    console.error(`${PROBE}: ${why}\nusage: node utf8_probe.mjs <pyodide-core-dir> <numpy.whl> <pymol.whl> <report.json> `
      + '[--only=<case>,...] [--jobs=N] [--case-timeout=SECONDS]');
    process.exit(2);
  };
  if (pos.length !== 4) usage('expected 4 positional arguments');
  const [coreDir, numpyWhl, pymolWhl, reportPath] = pos;
  for (const k of Object.keys(opts)) if (!['only', 'jobs', 'case-timeout'].includes(k)) usage(`unknown option --${k}`);
  const core = path.resolve(coreDir);
  try {
    for (const p of [path.join(core, 'pyodide.mjs'), numpyWhl, pymolWhl]) accessSync(p, constants.R_OK);
  } catch (e) {
    usage(`unreadable input: ${e.message}`);
  }
  const names = opts.only ? [...new Set(opts.only.split(',').filter(Boolean))] : Object.keys(CASES);
  for (const n of names) if (!(n in CASES)) usage(`no case ${n} (cases: ${Object.keys(CASES).join(', ')})`);
  const jobs = Math.max(1, Math.min(8, parseInt(opts.jobs || '3', 10) || 3));
  const caseTimeoutMs = Math.round(1000 * (parseFloat(opts['case-timeout'] || '60') || 60));
  const bootTimeoutMs = 300000;

  guardHost();
  const inputs = { core, numpy: path.resolve(numpyWhl), pymol: path.resolve(pymolWhl) };
  const results = {};
  const queue = names.slice();
  await Promise.all(Array.from({ length: Math.min(jobs, queue.length) }, async () => {
    while (queue.length) {
      const n = queue.shift();
      results[n] = await runCase(n, inputs, caseTimeoutMs, bootTimeoutMs);
      const r = results[n];
      const what = r.status === 'ran' ? (casePassed(r) ? 'pass' : 'FAIL (ran; errors or checks)') : `FAIL (${r.status})`;
      console.log(`${PROBE}: ${n}: ${what}${r.msg ? ' - ' + r.msg.slice(0, 160) : ''}${r.status !== 'ran' && r.last_step ? ' (at step: ' + r.last_step + ')' : ''} [${(r.ms / 1000).toFixed(1)} s]`);
    }
  }));

  const expectations = {};
  for (const n of names) expectations[n === 'ascii_control' ? 'ascii_control_works' : `${n}_no_trap_no_hang`] = casePassed(results[n]);
  const ran = names.filter((n) => BUG_CASES.includes(n));
  const report = {
    probe: PROBE,
    ok: Object.keys(expectations).length > 0 && Object.values(expectations).every((x) => x === true),
    expectations,
    failures: Object.entries(expectations).filter(([, v]) => !v).map(([k]) => k),
    summary: {
      utf8_cases: ran.length,
      utf8_cases_trap_or_hang: ran.filter((n) => ['fatal', 'timeout', 'worker_error', 'worker_exit'].includes(results[n].status)
        || results[n].alive === false).length,
      utf8_cases_failed: ran.filter((n) => !casePassed(results[n])).length,
    },
    case_timeout_s: caseTimeoutMs / 1000,
    inputs: { pymol_wheel: path.basename(inputs.pymol), pymol_wheel_sha256: sha256(inputs.pymol) },
    cases: results,
  };
  writeFileSync(reportPath, JSON.stringify(report, null, 1) + '\n');
  console.log(`${PROBE}: ${report.ok ? 'PASS' : 'FAIL'} - UTF-8 cases trapped or hung: ${report.summary.utf8_cases_trap_or_hang}/${report.summary.utf8_cases}, `
    + `failed: ${report.summary.utf8_cases_failed}/${report.summary.utf8_cases}; ascii control: ${expectations.ascii_control_works ?? 'not run'}`);
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
