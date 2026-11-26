// Probe for patch 0009 (S1-4, layer0/Map.cpp MapSetupExpress): with PyMOL's interrupt flag
// (G->Interrupt) set before distance work, each condition below must give the shipped result
// (SHIPPED) without a wasm trap.
//
// usage:
//   node pymol-wasm/tests/interrupt_probe.mjs <pyodide-core-dir> <numpy.whl> <pymol.whl> <report.json>
//        [--parallel 4] [--timeout 300]
//
// 17 conditions on 1HPV (the wheel's own pymol_path/data/tut/1hpv.pdb, sha256 checked), each in a
// fresh Pyodide in its own worker thread (a trap cannot hide behind or spill into another), each
// with a wall-clock limit (--timeout seconds; a timeout fails that condition). Start-up: headless
// (-cq) with no_quit = 1, as the app worker sets it (worker.js), and no GL context.
//
// Expectations per condition: no trap (runPython raised no JS error, the interpreter still answers
// afterwards, no timeout) and the result equal to SHIPPED below. Plus: the input file is the
// recorded one, and no host process start was attempted.
//
// exit: 0 = every expectation held; 1 = one did not (or the probe itself failed); 2 = usage /
// unreadable input.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { readZipEntry } from '../bench/render/lib_inputs.mjs';
import { runJobs } from './map_worker.mjs';

const USAGE = 'usage: node interrupt_probe.mjs <pyodide-core-dir> <numpy.whl> <pymol.whl> <report.json> [--parallel N] [--timeout S]';
const PDB_MEMBER = 'pymol/pymol_path/data/tut/1hpv.pdb';
const PDB_SHA256 = '5e4a3e559491dcde705665959e34f52b51582c5104d933732a25db92804ba153';

// The 17 conditions of the 2026-11-16 study (evidence section 3.4): 4 command lines through cmd.do
// (doq-*), 9 runs after cmd.interrupt() (int-*), 4 runs after `quit` (quit-*).
const CONDITIONS = [
  'doq-within', 'doq-surface', 'doq-load', 'doq-polar',
  'int-within', 'int-around', 'int-dss', 'int-area', 'int-load', 'int-surface', 'int-mesh', 'int-polar',
  'int-idle-then-within', 'quit-within', 'quit-surface', 'quit-load', 'quit-rock-idle-then-within',
];

// Measured on the SHIPPED wheel (frontend/public/vendor/pymol/3.2.0a-edcda80f-pyodide-314.0.7/,
// pymol-3.2.0a-cp314-cp314-pyemscripten_2026_0_wasm32.whl, sha256 dc6b5278...c7a8) with this
// probe on 2026-11-17. The probe checks that every condition runs with no trap and gives the
// same values as the shipped wheel, which patch 0009 leaves unchanged on purpose (evidence
// section 3.4, last bullet): "no trap, no new behaviour".
const SHIPPED = {
  "doq-within": {"after": 0, "before": 67},
  "doq-surface": {"after": [235, 0], "before": 67},
  "doq-load": {"after": 37, "before": 67},
  "doq-polar": {"after": 1, "before": 67},
  "int-within": {"after": 0, "before": 67},
  "int-around": {"after": 0, "before": 67},
  "int-dss": {"after": "LLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLL", "before": 67},
  "int-area": {"before": 67, "exc": "CmdException:  Error: Can't get dot representation."},
  "int-load": {"after": 37, "before": 67},
  "int-surface": {"after": [235, 0], "before": 67},
  "int-mesh": {"after": [235], "before": 67},
  "int-polar": {"after": 0, "before": 67},
  "int-idle-then-within": {"after": 67, "before": 67, "idle": 0},
  "quit-within": {"after": 0, "before": 67},
  "quit-surface": {"after": [235, 0], "before": 67},
  "quit-load": {"after": 37, "before": 67},
  "quit-rock-idle-then-within": {"after": 67, "before": 67, "idle": [1, 0, 0]},
};

const START = String.raw`
import pymol, pymol.invocation, pymol2, json
pymol.invocation.parse_args(['pymol', '-cq'])
_o = pymol.invocation.options
_o.no_quit = 1
_inst = pymol2.SingletonPyMOL(); _inst.start()
from pymol import cmd
cmd.load('/tmp/1hpv.pdb', 'm')
`;

const RUN = String.raw`
r = {}
r['before'] = cmd.count_atoms('m within 4 of (m and resi 5)')
if SC.startswith('doq'):
    # ONE command line, run through cmd.do
    line = {'doq-within': 'quit; select s1, m within 4 of (m and resi 5)',
            'doq-surface': 'quit; hide everything; show surface, m',
            'doq-load': 'quit; load /tmp/1hpv.pdb, m2',
            'doq-polar': 'quit; distance hb, m, m, mode=2'}[SC]
    try:
        cmd.do(line)
    except BaseException as e:
        r['do_exc'] = type(e).__name__ + ': ' + str(e)[:160]
    try:
        if SC == 'doq-within': r['after'] = cmd.count_atoms('s1')
        elif SC == 'doq-surface': w = cmd.get_vrml(); r['after'] = [len(w), w.count(' -1,')]
        elif SC == 'doq-load': r['after'] = len(cmd.get_model('m2').bond)
        elif SC == 'doq-polar': r['after'] = cmd.count_states('hb') if 'hb' in cmd.get_names() else 'no hb object'
    except BaseException as e:
        r['exc'] = type(e).__name__ + ': ' + str(e)[:160]
    what = None
elif SC.startswith('quit'):
    try:
        cmd.do('quit')            # refused by no_quit
    except BaseException as e:
        r['quit_exc'] = type(e).__name__ + ': ' + str(e)[:100]
    what = SC.split('-', 1)[1]
else:
    cmd.interrupt()
    what = SC.split('-', 1)[1]
try:
    if what == 'within':
        r['after'] = cmd.count_atoms('m within 4 of (m and resi 5)')
    elif what == 'around':
        r['after'] = cmd.count_atoms('(m and resi 5) around 6')
    elif what == 'dss':
        cmd.alter('m', "ss=''"); cmd.dss('m')
        st = []; cmd.iterate('m and name CA', 'st.append(ss)', space={'st': st}); r['after'] = ''.join(x or '-' for x in st)[:60]
    elif what == 'area':
        r['after'] = round(cmd.get_area('m'), 2)
    elif what == 'load':
        cmd.load('/tmp/1hpv.pdb', 'm2'); r['after'] = len(cmd.get_model('m2').bond)
    elif what == 'surface':
        cmd.hide('everything'); cmd.show('surface', 'm'); w = cmd.get_vrml(); r['after'] = [len(w), w.count(' -1,')]
    elif what == 'mesh':
        cmd.hide('everything'); cmd.show('mesh', 'm'); w = cmd.get_vrml(); r['after'] = [len(w)]
    elif what == 'polar':
        v = cmd.distance('d', 'm', 'm', mode=2); r['after'] = round(float(v), 3)
    elif what == 'idle-then-within':
        r['idle'] = _inst.idle()
        r['after'] = cmd.count_atoms('m within 4 of (m and resi 5)')
    elif what == 'rock-idle-then-within':
        cmd.rock(1)
        r['idle'] = [_inst.idle(), _inst.idle(), _inst.idle()]
        r['after'] = cmd.count_atoms('m within 4 of (m and resi 5)')
except BaseException as e:
    r['exc'] = type(e).__name__ + ': ' + str(e)[:160]
json.dumps(r, sort_keys=True)
`;

const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x));

function usage(msg) {
  console.error(`interrupt_probe: ${msg}\n${USAGE}`);
  process.exit(2);
}

async function main() {
  const argv = process.argv.slice(2);
  const pos = [];
  const opt = { parallel: 4, timeout: 300 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--parallel' || argv[i] === '--timeout') {
      const v = Number(argv[++i]);
      if (!Number.isInteger(v) || v < 1) usage(`${argv[i - 1]} needs a positive integer`);
      opt[argv[i - 1].slice(2)] = v;
    } else if (argv[i].startsWith('--')) {
      usage(`unknown option ${argv[i]}`);
    } else {
      pos.push(argv[i]);
    }
  }
  if (pos.length !== 4) usage('expected 4 positional arguments');
  const [core, numpy, pymol, reportPath] = pos;
  let pdb;
  try {
    for (const f of [path.join(core, 'pyodide.mjs'), numpy, pymol]) if (!existsSync(f)) throw new Error(`missing ${f}`);
    pdb = readZipEntry(pymol, PDB_MEMBER);
  } catch (e) {
    usage(String(e.message || e));
  }

  const report = { probe: 'interrupt_probe', ok: false, expectations: {}, wheel: path.resolve(pymol),
    wheelSha256: sha256(readFileSync(pymol)), input: { member: PDB_MEMBER, sha256: sha256(pdb) }, conditions: {} };
  const ex = report.expectations;
  ex['input 1hpv.pdb is the recorded file'] = report.input.sha256 === PDB_SHA256;

  const jobs = CONDITIONS.map((sc) => ({ name: sc, core, wheels: [numpy, pymol], files: { '/tmp/1hpv.pdb': pdb },
    globals: { SC: sc }, code: START + RUN }));
  const results = await runJobs(jobs, { parallel: opt.parallel, timeoutMs: opt.timeout * 1000 });
  let hostCallCount = 0;
  for (const r of results) {
    hostCallCount += (r.hostCalls || []).length;
    const trapped = !!(r.jsError || r.setupError || r.workerError || r.timedOut) || r.alive !== true;
    report.conditions[r.name] = { value: r.value ?? null, expected: SHIPPED[r.name] ?? null, trap: trapped,
      jsError: r.jsError, setupError: r.setupError, workerError: r.workerError, timedOut: r.timedOut || undefined,
      alive: r.alive, ms: r.ms, heapMB: r.heapMB };
    ex[`${r.name}: no trap`] = !trapped;
    ex[`${r.name}: same as the shipped wheel`] = !trapped && SHIPPED[r.name] !== undefined && canon(r.value) === canon(SHIPPED[r.name]);
  }
  ex['no host process start attempted'] = hostCallCount === 0;
  report.summary = {
    conditions: results.length,
    traps: Object.values(report.conditions).filter((c) => c.trap).length,
    sameAsShipped: CONDITIONS.filter((c) => ex[`${c}: same as the shipped wheel`]).length,
  };
  report.ok = Object.keys(ex).length > 0 && Object.values(ex).every((v) => v === true);
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  const bad = Object.entries(ex).filter(([, v]) => !v).map(([k]) => k);
  console.log(`interrupt_probe: ${report.summary.sameAsShipped}/${results.length} same as shipped, ${report.summary.traps} traps`
    + (bad.length ? ` | FAILED: ${bad.join('; ')}` : ' | ok'));
  return report.ok;
}

main().then((ok) => process.exit(ok ? 0 : 1), (e) => {
  console.error(`interrupt_probe: probe failed: ${(e && e.stack) || e}`);
  process.exit(1);
});
