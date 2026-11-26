// S1-10 regression probe: the wheel's re-encoded cmyk.png gives PyMOL the same colour table.
//
//   node cmyk_table.mjs <pyodide-core-dir> <numpy.whl> <pymol.whl> <report.json> <reference>
//
// <reference> is the ORIGINAL cmyk.png: the file itself (a source tree's
// data/pymol/cmyk.png) or a wheel built without S1-10 (the shipped one).
// cmyk_refilter.py re-encodes the png at build time (pixels asserted identical,
// gAMA and tEXt kept). A PNG decoder alone cannot say PyMOL builds the same table:
// its reader gamma-corrects only when a gAMA chunk is present (layer0/MyPNG.cpp).
// So this asks PyMOL itself, as an earlier study did (2026-11-16-pymol-wasm-slim
// evidence 3.10): after `space cmyk`,
// the 178 named colours and a 17^3 = 4,913 grid of set_color colours are read
// back with get_color_tuple (the LUT-mapped value) and hashed as float bits.
//
// Three cases, each in its own worker_threads Worker (its own Pyodide and PyMOL,
// guarded against the host shell, terminated after LIMIT_MS = failure):
//   wheel      the cmyk.png <pymol.whl> installed
//   reference  the reference png written over it
//   control    the reference png with every pixel's red channel raised by 1
//              (saturating), re-encoded with cmyk_refilter.py's functions; its
//              table must differ, so equal tables cannot come from a dead path
// The wheel and reference tables must be bit-identical, the wheel's png must be a
// different file from the reference (no vacuous pass), and each case must have
// read the png it was meant to.
// exit: 0 = every expectation held; 1 = one did not (the report says which);
// 2 = usage / unreadable input.
import path from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { guardHost, hostCalls, PY_HOST_BLOCK } from '../bench/lib/guard_host.mjs';

const PROBE = 'cmyk_table';
const LIMIT_MS = 10 * 60 * 1000;
const N_NAMED = 178;
const N_GRID = 17 ** 3;
const REFILTER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'cmyk_refilter.py');

const PY = String.raw`
import hashlib, io, json, struct, sys, zipfile
args = json.load(open('/probe/args.json'))
MEMBER = 'pymol/pymol_path/data/pymol/cmyk.png'
SIG = b'\x89PNG\r\n\x1a\n'

def sha(b):
    return hashlib.sha256(b).hexdigest()

whl = open('/probe/test.whl', 'rb').read()
wheel_png = zipfile.ZipFile(io.BytesIO(whl)).read(MEMBER)
raw = open('/probe/ref.bin', 'rb').read()
ref_png = zipfile.ZipFile(io.BytesIO(raw)).read(MEMBER) if raw[:4] == b'PK\x03\x04' else raw
if ref_png[:8] != SIG:
    raise ValueError('the reference is not a PNG (nor a wheel holding ' + MEMBER + ')')

import pymol, pymol.invocation, pymol2, pymol.constants
pymol.invocation.parse_args(['pymol', '-cq'])
_inst = pymol2.SingletonPyMOL()
_inst.start()
from pymol import cmd
target = cmd.exp_path(pymol.constants.space_dict['cmyk'])
out = {'case': args['case'], 'target': target, 'wheel_png_sha256': sha(wheel_png), 'reference_png_sha256': sha(ref_png)}
if args['case'] == 'reference':
    open(target, 'wb').write(ref_png)
elif args['case'] == 'control':
    sys.path.insert(0, '/probe')
    import cmyk_refilter as cr
    chs, w, h, bpp, pix = cr.decode(ref_png)
    pix2 = bytes(min(v + 1, 255) if i % bpp == 0 else v for i, v in enumerate(pix))
    out['control_pixels_changed'] = sum(1 for a, b in zip(pix, pix2) if a != b)
    ctrl_png = cr.encode_like(chs, w, h, bpp, pix2)
    out['control_png_sha256'] = sha(ctrl_png)
    open(target, 'wb').write(ctrl_png)
out['read_png_sha256'] = sha(open(target, 'rb').read())

# The table ported from an earlier study script, unchanged.
cmd.space('cmyk')
named = sorted(cmd.get_color_indices(), key=lambda t: t[1])
vals = [cmd.get_color_tuple(i) for n, i in named]
grid = []
steps = [k / 16.0 for k in range(17)]
for r in steps:
    for g in steps:
        for b in steps:
            nm = 'zz_%d_%d_%d' % (round(r * 16), round(g * 16), round(b * 16))
            cmd.set_color(nm, [r, g, b])
            grid.append(cmd.get_color_tuple(nm))
def h(xs):
    return hashlib.sha256(b''.join(struct.pack('<3f', *t) for t in xs)).hexdigest()
ident = sum(1 for (r, g, b), t in zip([(r, g, b) for r in steps for g in steps for b in steps], grid)
            if max(abs(r - t[0]), abs(g - t[1]), abs(b - t[2])) < 1e-6)
names = [n for n, i in named]
out.update({'n_named': len(named), 'named_sha': h(vals), 'grid_n': len(grid), 'grid_sha': h(grid),
            'grid_unchanged_by_lut': ident, 'red_cmyk': vals[names.index('red')] if 'red' in names else None,
            'sample': [grid[0], grid[len(grid) // 2], grid[-1]]})
cmd.space('rgb')
out['red_after_rgb'] = cmd.get_color_tuple('red')
json.dumps(out)
`;

function usage(msg) {
  console.error(`${PROBE}: ${msg}\nusage: node cmyk_table.mjs <pyodide-core-dir> <numpy.whl> <pymol.whl> <report.json> <reference cmyk.png or wheel>`);
  process.exit(2);
}

async function runCase(data) {
  guardHost();
  const indexURL = path.resolve(data.core) + '/';
  const { loadPyodide } = await import(pathToFileURL(path.join(indexURL, 'pyodide.mjs')).href);
  const py = await loadPyodide({ indexURL, stdout: () => {}, stderr: () => {} });
  py.runPython(PY_HOST_BLOCK);
  await py.loadPackage([data.numpy, data.pymol], { messageCallback: () => {} });
  py.FS.mkdirTree('/probe');
  py.FS.writeFile('/probe/test.whl', new Uint8Array(readFileSync(data.pymol)));
  py.FS.writeFile('/probe/ref.bin', new Uint8Array(readFileSync(data.ref)));
  py.FS.writeFile('/probe/cmyk_refilter.py', readFileSync(REFILTER, 'utf8'));
  py.FS.writeFile('/probe/args.json', JSON.stringify({ case: data.case }));
  const r = JSON.parse(py.runPython(PY));
  r.hostCalls = [...hostCalls];
  return r;
}

function runWorker(data) {
  return new Promise((resolve) => {
    const w = new Worker(new URL(import.meta.url), { workerData: data });
    const timer = setTimeout(() => {
      w.terminate();
      resolve({ ok: false, error: `timed out after ${LIMIT_MS} ms` });
    }, LIMIT_MS);
    w.once('message', (m) => { clearTimeout(timer); w.terminate(); resolve(m); });
    w.once('error', (e) => { clearTimeout(timer); resolve({ ok: false, error: String((e && e.message) || e).slice(0, 1200) }); });
    w.once('exit', (code) => { clearTimeout(timer); resolve({ ok: false, error: `worker exited (${code}) without a result` }); });
  });
}

if (!isMainThread) {
  try {
    parentPort.postMessage({ ok: true, result: await runCase(workerData) });
  } catch (e) {
    parentPort.postMessage({ ok: false, error: String((e && e.message) || e).split('\n').filter((l) => l.trim()).slice(-4).join(' | ').slice(0, 1200) });
  }
} else {
  const argv = process.argv.slice(2);
  if (argv.length !== 5) usage('five arguments needed');
  const [core, numpy, pymol, report, ref] = argv.map((a) => path.resolve(a));
  for (const [what, p] of [['core', path.join(core, 'pyodide.mjs')], ['numpy wheel', numpy], ['pymol wheel', pymol], ['reference', ref], ['cmyk_refilter.py', REFILTER]]) {
    if (!existsSync(p)) usage(`${what} not found: ${p}`);
  }
  guardHost();
  const t0 = Date.now();
  const cases = {};
  for (const c of ['wheel', 'reference', 'control']) {
    cases[c] = await runWorker({ core, numpy, pymol, ref, case: c });
  }
  const R = Object.fromEntries(Object.entries(cases).map(([k, v]) => [k, v.ok ? v.result : { error: v.error }]));
  const { wheel: W, reference: F, control: C } = R;
  const sized = (x) => x.n_named === N_NAMED && x.grid_n === N_GRID;
  const expect = [
    ['all three cases ran to the end', Object.values(cases).every((v) => v.ok === true)],
    [`each table has ${N_NAMED} named and ${N_GRID} grid colours`, [W, F, C].every(sized)],
    ['each case read the png it was meant to',
      W.read_png_sha256 === W.wheel_png_sha256 && F.read_png_sha256 === F.reference_png_sha256 &&
      typeof C.control_png_sha256 === 'string' && C.read_png_sha256 === C.control_png_sha256],
    ["the wheel's cmyk.png is a different file from the reference (no vacuous pass)",
      typeof W.wheel_png_sha256 === 'string' && W.wheel_png_sha256 !== W.reference_png_sha256],
    ['space cmyk maps colours at all (the grid is not the identity)', sized(W) && W.grid_unchanged_by_lut < N_GRID],
    ['named colours are bit-identical (wheel vs reference)', typeof W.named_sha === 'string' && W.named_sha === F.named_sha],
    ['grid colours are bit-identical (wheel vs reference)', typeof W.grid_sha === 'string' && W.grid_sha === F.grid_sha],
    ['control: perturbed pixels give a different grid', C.control_pixels_changed > 0 && typeof C.grid_sha === 'string' && C.grid_sha !== F.grid_sha],
    ['no host process start was attempted', [W, F, C].every((x) => Array.isArray(x.hostCalls) && x.hostCalls.length === 0)],
  ];
  const expectations = Object.fromEntries(expect.map(([k, v]) => [k, Boolean(v)]));
  const ok = Object.values(expectations).every(Boolean);
  const rep = { probe: PROBE, ok, expectations, wheel: pymol, reference: ref, elapsed_s: Math.round((Date.now() - t0) / 100) / 10, cases: R };
  writeFileSync(report, JSON.stringify(rep, null, 1) + '\n');
  for (const [k, v] of Object.entries(expectations)) console.log(`${v ? 'ok  ' : 'FAIL'} ${k}`);
  if (!ok) console.log(JSON.stringify(R, null, 1).slice(0, 4000));
  process.exit(ok ? 0 : 1);
}
