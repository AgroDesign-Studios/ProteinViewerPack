// Patch 0014 regression probe: the bundled pickles take the C unpickler, load to the same
// objects as the pure-Python path, and no session reaches that path.
//
//   node bundled_pkl_probe.mjs <pyodide-core-dir> <numpy.whl> <pymol.whl> <report.json>
//
// Patch 0014 makes chempy.pkl.PKL.fromFile read a file whose realpath lies inside the
// realpath of $PYMOL_DATA with the stdlib C unpickler, and every other file with
// cPickle.load (pure Python) as before. On the built wheel, in a real Pyodide with the
// wheel installed and headless PyMOL started, three cases each in their own worker:
//   bundled    every .pkl the wheel installs under $PYMOL_DATA (133 in the S1 wheel), named
//              as the runtime names them (PYMOL_DATA + '/chempy/...'): chempy.io.pkl.fromFile,
//              the C unpickler and cPickle.load give recursively identical objects (exact
//              types, dict key order, float bit patterns, attributes, shared references);
//              and fromFile takes the C path for that exact path, told by effect: the file
//              is swapped for a protocol-0 STRING with a byte below 9 (the C unpickler gives
//              str, chempy's _decode_string gives bytes), then restored byte for byte. The
//              boundary on the built bytes: outside, a ".." escape, a symlink inside pointing
//              out, $PYMOL_DATA unset or empty all keep the Python path. After import pymol
//              pickle.loads is chempy.pkl.restricted_loads, and a crafted .pse (top-level
//              builtins.exec) is refused by cmd.load whether it lies inside $PYMOL_DATA or
//              not, without one PKL.fromFile call; the same file runs its payload with the
//              restricted loader swapped out (live control).
//   wizard_c   the mutagenesis wizard on the shipped tut/1hpv.pdb (backbone-dependent and
//              -independent libraries), then cmd.fragment and cmd.fab, as shipped: no file
//              may be read through cPickle.load.
//   wizard_py  the same with PKL.fromFile replaced by today's body (cPickle.load always):
//              the side-chain libraries must be read through cPickle.load.
// wizard_c and wizard_py must give identical rotamer counts, bump scores, per-state
// coordinates and titles, final coordinates and sequence, and fragment / fab coordinates.
// (nucmutagenesis reads no .pkl, so it is not a case.) Controls: the comparator passes an
// unchanged deep copy and catches each planted difference. No timing is taken.
//
// Each case runs in a worker_threads Worker that guards the host shell itself
// (bench/lib/guard_host.mjs) and is terminated after LIMIT_MS (a timeout is a failure).
// Payloads only write marker files inside Pyodide's in-memory filesystem.
// exit: 0 = every expectation held; 1 = one did not (the report says which, and why);
// 2 = usage / unreadable input.
import path from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { guardHost, hostCalls, PY_HOST_BLOCK } from '../bench/lib/guard_host.mjs';

const PROBE = 'bundled_pkl_probe';
const EXPECTED = 133;
const LIMIT_MS = 10 * 60 * 1000;
const SIDECHAINS = ['chempy/sidechains/sc_bb_dep.pkl', 'chempy/sidechains/sc_bb_ind.pkl'];

const START_PY = String.raw`
import builtins, copy, hashlib, json, math, os, pickle, _pickle, struct, sys, zipfile
import pymol, pymol.invocation, pymol2
pymol.invocation.parse_args(['pymol', '-cq'])
_inst = pymol2.SingletonPyMOL()
_inst.start()
from pymol import cmd
import chempy, chempy.pkl
from chempy import io as cio
DATA = os.environ['PYMOL_DATA']
args = json.load(open('/probe/args.json'))
LEAF = (type(None), bool, int, str, bytes)

def first_diff(a, b, root):
    """The first difference between two object graphs, or None (iterative, depth first)."""
    ab, ba = {}, {}
    stack = [(a, b, root)]
    while stack:
        x, y, where = stack.pop()
        t = type(x)
        if t is not type(y):
            return '%s: type %s vs %s' % (where, t.__name__, type(y).__name__)
        if t is float:
            if struct.pack('<d', x) != struct.pack('<d', y):
                return '%s: float %r vs %r' % (where, x, y)
            continue
        if t is complex:
            if struct.pack('<dd', x.real, x.imag) != struct.pack('<dd', y.real, y.imag):
                return '%s: complex %r vs %r' % (where, x, y)
            continue
        if t in LEAF:
            if x != y:
                return '%s: %r vs %r' % (where, x, y)
            continue
        ix, iy = id(x), id(y)
        if ix in ab or iy in ba:
            if ab.get(ix) != iy or ba.get(iy) != ix:
                return '%s: shared-reference structure differs' % where
            continue
        ab[ix] = iy
        ba[iy] = ix
        if t in (list, tuple):
            if len(x) != len(y):
                return '%s: length %d vs %d' % (where, len(x), len(y))
            for i in range(len(x) - 1, -1, -1):
                stack.append((x[i], y[i], '%s[%d]' % (where, i)))
        elif t is dict:
            kx, ky = list(x), list(y)
            if len(kx) != len(ky) or any(type(p) is not type(q) or p != q for p, q in zip(kx, ky)):
                return '%s: dict keys differ in set or order' % where
            for k in reversed(kx):
                stack.append((x[k], y[k], '%s[%r]' % (where, k)))
        elif hasattr(x, '__dict__'):
            stack.append((vars(x), vars(y), '%s<%s>' % (where, t.__name__)))
        elif x != y:
            return '%s: %r vs %r (%s)' % (where, x, y, t.__name__)
    return None

def sha(xyz):
    return None if xyz is None else hashlib.sha256(xyz.tobytes()).hexdigest()
`;

const CASES = {};

CASES.bundled = String.raw`
out = {'restricted': pickle.loads is chempy.pkl.restricted_loads and pickle._loads is chempy.pkl.restricted_loads,
       'cpickle_load_is_pure_python': chempy.pkl.cPickle.load is pickle._load,
       'pickle_load_is_c': pickle.load is _pickle.load}
C_LOAD, PY_LOAD = _pickle.load, chempy.pkl.cPickle.load
CANARY = b"S'\\x01ab'\n."

def via(fname):
    got = cio.pkl.fromFile(fname)
    if type(got) is str and got == '\x01ab':
        return 'C'
    if type(got) is bytes and got == b'\x01ab':
        return 'Python'
    return 'other: %r' % (got,)

z = zipfile.ZipFile('/probe/test.whl')
PFX = 'pymol/pymol_path/data/'
wheel_pkl = sorted(n[len(PFX):] for n in z.namelist() if n.startswith(PFX) and n.endswith('.pkl'))
installed = sorted(os.path.relpath(os.path.join(d, f), DATA) for d, _, fs in os.walk(DATA) for f in fs if f.endswith('.pkl'))
out.update({'wheel_pkl': len(wheel_pkl), 'installed_pkl': len(installed), 'installed_is_wheel_set': installed == wheel_pkl,
            'wheel_pkl_outside_data': [n for n in z.namelist() if n.endswith('.pkl') and not n.startswith(PFX)]})

paths, diffs_ff, diffs_c, share_differ, errors, not_restored = {}, {}, {}, {}, {}, []
for rel in installed:
    fname = DATA + '/' + rel
    raw = open(fname, 'rb').read()
    try:
        a = cio.pkl.fromFile(fname)
        with open(fname, 'rb') as fh:
            b = PY_LOAD(fh)
        with open(fname, 'rb') as fh:
            c = C_LOAD(fh)
        d = first_diff(a, b, rel)
        if d:
            diffs_ff[rel] = d
        d = first_diff(c, b, rel)
        if d:
            diffs_c[rel] = d
    except Exception as e:
        errors[rel] = '%s: %s' % (type(e).__name__, str(e)[:200])
    with open(fname, 'wb') as fh:
        fh.write(CANARY)
    try:
        paths[rel] = via(fname)
    except Exception as e:
        paths[rel] = 'error: %s: %s' % (type(e).__name__, str(e)[:120])
    finally:
        with open(fname, 'wb') as fh:
            fh.write(raw)
    if open(fname, 'rb').read() != raw:
        not_restored.append(rel)
out.update({'not_c_path': {r: v for r, v in paths.items() if v != 'C'},
            'c_path_count': sum(1 for v in paths.values() if v == 'C'), 'checked': len(paths),
            'fromFile_vs_python_diffs': diffs_ff, 'c_vs_python_diffs': diffs_c, 'load_errors': errors, 'not_restored': not_restored})

# the boundary on the built bytes
os.makedirs('/probe/out', exist_ok=True)
with open('/probe/out/canary.pkl', 'wb') as fh:
    fh.write(CANARY)
inside = DATA + '/chempy/fragments/zz_canary.pkl'
link = DATA + '/chempy/fragments/zz_link.pkl'
with open(inside, 'wb') as fh:
    fh.write(CANARY)
os.symlink('/probe/out/canary.pkl', link)
bnd = {'inside': via(inside), 'outside': via('/probe/out/canary.pkl'),
       'dotdot_escape': via(DATA + '/chempy/fragments/' + os.path.relpath('/probe/out/canary.pkl', DATA + '/chempy/fragments')),
       'symlink_inside_pointing_out': via(link)}
saved = os.environ.pop('PYMOL_DATA')
try:
    bnd['pymol_data_unset'] = via(inside)
    os.environ['PYMOL_DATA'] = ''
    bnd['pymol_data_empty'] = via(inside)
finally:
    os.environ['PYMOL_DATA'] = saved
os.remove(inside)
os.remove(link)
out['boundary'] = bnd

# a crafted session through the .pse load path, inside $PYMOL_DATA and outside
class _Evil:
    def __reduce__(self):
        return (builtins.exec, ("open('/tmp/pse_marker', 'w').write('x')",))
payload = _pickle.dumps(_Evil(), 1)
pse = {'inside_pymol_data': DATA + '/chempy/fragments/zz_evil.pse', 'outside': '/probe/out/evil.pse'}
ff_calls = []
_ff = chempy.pkl.PKL.fromFile
def _ff_spy(self, fname, **params):
    ff_calls.append(fname)
    return _ff(self, fname, **params)
chempy.pkl.PKL.fromFile = _ff_spy
res = {}
try:
    for where, p in pse.items():
        with open(p, 'wb') as fh:
            fh.write(payload)
        try:
            cmd.load(p, 'evil')
            r = 'loaded'
        except Exception as e:
            r = 'refused: %s: %s' % (type(e).__name__, str(e)[:160])
        res[where] = {'load': r, 'payload_ran': os.path.exists('/tmp/pse_marker')}
finally:
    chempy.pkl.PKL.fromFile = _ff
res['fromFile_calls'] = ff_calls
_loads = chempy.pkl.cPickle.loads
chempy.pkl.cPickle.loads = staticmethod(_pickle.loads)
try:
    try:
        cmd.load(pse['inside_pymol_data'], 'evil')
    except Exception:
        pass
finally:
    chempy.pkl.cPickle.loads = _loads
res['control_payload_ran'] = os.path.exists('/tmp/pse_marker')
res['restriction_back'] = (chempy.pkl.cPickle.loads is _loads and pickle.loads is chempy.pkl.restricted_loads
                           and chempy.pkl.PKL.fromFile is _ff)
os.remove(pse['inside_pymol_data'])
out['pse'] = res

# controls: the comparator must pass an unchanged copy and catch each planted difference
base = cio.pkl.fromFile(DATA + '/' + SIDECHAIN_IND)
ctrl = {'unchanged deep copy': first_diff(base, copy.deepcopy(base), 'copy')}
s = [1.0]
atom_a, atom_b = chempy.Atom(), chempy.Atom()
atom_a.name = atom_b.name = 'CA'
atom_b.chain = 'B'
planted = {
    'float one ulp off': ([0.1], [math.nextafter(0.1, 1.0)]),
    '-0.0 for 0.0': ([0.0], [-0.0]),
    'dict key order': ({'a': 1, 'b': 2}, {'b': 2, 'a': 1}),
    'bool for int': ([1], [True]),
    'bytes for str': (['x'], [b'x']),
    'two lists for one shared list': ([s, s], [[1.0], [1.0]]),
    'extra attribute': ([atom_a], [atom_b]),
}
for k, (x, y) in planted.items():
    ctrl[k] = first_diff(x, y, k)
out['controls'] = ctrl
json.dumps(out)
`.replace('SIDECHAIN_IND', `'${SIDECHAINS[1]}'`);

// The mutagenesis wizard on the shipped 1HPV, then cmd.fragment / cmd.fab. args.today
// swaps PKL.fromFile for today's body (the 0006 tree's, cPickle.load for every file).
CASES.wizard = String.raw`
py_reads, ff_names = [], []
_py_load = chempy.pkl.cPickle.load
def _py_spy(fp, *a, **k):
    name = getattr(fp, 'name', None)
    py_reads.append(os.path.relpath(name, DATA) if isinstance(name, str) else repr(name))
    return _py_load(fp, *a, **k)
chempy.pkl.cPickle.load = _py_spy
_ff = chempy.pkl.PKL.fromFile
if args['today']:
    def _ff(self, fname, **params):
        fp = self.my_open(fname, 'rb')
        result = chempy.pkl.cPickle.load(fp)
        fp.close()
        return result
def _ff_rec(self, fname, **params):
    ff_names.append(os.path.relpath(fname, DATA))
    return _ff(self, fname, **params)
chempy.pkl.PKL.fromFile = _ff_rec

MUTS = [('A/10/', 'TRP', 'dep'), ('A/25/', 'GLU', 'dep'), ('A/50/', 'LEU', 'dep'), ('A/82/', 'PHE', 'dep'),
        ('B/30/', 'ARG', 'dep'), ('A/1/', 'LYS', 'dep'), ('A/63/', 'MET', 'ind'), ('B/84/', 'TYR', 'ind')]
cmd.load(DATA + '/tut/1hpv.pdb', 'm')
n0 = cmd.count_atoms('m')
cmd.wizard('mutagenesis')
w = cmd.get_wizard()
cmd.refresh_wizard()
muts = []
for sele, mode, dep in MUTS:
    w.set_dep(dep)
    w.set_mode(mode)
    w.do_select('/m//' + sele)
    n = cmd.count_states('mutation')
    muts.append({'sele': sele, 'mode': mode, 'dep': dep, 'states': n,
                 'bump_scores': [repr(x) for x in w.bump_scores],
                 'atoms': cmd.count_atoms('mutation'),
                 'state_coords': [sha(cmd.get_coords('mutation', st)) for st in range(1, n + 1)],
                 'state_titles': [cmd.get_title('mutation', st) for st in range(1, n + 1)]})
    w.apply()
cmd.set_wizard()
final = {'atoms_before': n0, 'atoms': cmd.count_atoms('m'), 'coords': sha(cmd.get_coords('m')), 'fasta': cmd.get_fastastr('m')}
cmd.fragment('benzene', 'frag1')
cmd.fab('ACDEFGHIKLMNPQRSTVWY', 'pep', ss=1)
frag = {'benzene': sha(cmd.get_coords('frag1')), 'benzene_atoms': cmd.count_atoms('frag1'),
        'pep': sha(cmd.get_coords('pep')), 'pep_atoms': cmd.count_atoms('pep')}
json.dumps({'mutations': muts, 'final': final, 'fragments': frag, 'py_reads': sorted(set(py_reads)), 'py_read_count': len(py_reads),
            'fromFile_names': sorted(set(ff_names)), 'restricted': pickle.loads is chempy.pkl.restricted_loads})
`;

function usage(msg) {
  console.error(`${PROBE}: ${msg}\nusage: node bundled_pkl_probe.mjs <pyodide-core-dir> <numpy.whl> <pymol.whl> <report.json>`);
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
  py.FS.writeFile('/probe/args.json', JSON.stringify({ today: data.today }));
  py.runPython(START_PY);
  const r = JSON.parse(py.runPython(CASES[data.kind]));
  r.hostCalls = [...hostCalls];
  return r;
}

function runWorker(inputs) {
  return new Promise((resolve) => {
    const w = new Worker(new URL(import.meta.url), { workerData: inputs });
    const timer = setTimeout(() => {
      w.terminate();
      resolve({ ok: false, error: `timed out after ${LIMIT_MS} ms` });
    }, LIMIT_MS);
    w.once('message', (m) => { clearTimeout(timer); w.terminate(); resolve(m); });
    w.once('error', (e) => { clearTimeout(timer); resolve({ ok: false, error: String((e && e.message) || e).slice(0, 1200) }); });
    w.once('exit', (code) => { clearTimeout(timer); resolve({ ok: false, error: `worker exited (${code}) without a result` }); });
  });
}

function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

if (!isMainThread) {
  try {
    parentPort.postMessage({ ok: true, result: await runCase(workerData) });
  } catch (e) {
    parentPort.postMessage({ ok: false, error: String((e && e.message) || e).split('\n').filter((l) => l.trim()).slice(-4).join(' | ').slice(0, 1200) });
  }
} else {
  const argv = process.argv.slice(2);
  if (argv.length !== 4) usage('four arguments needed');
  const [core, numpy, pymol, report] = argv.map((a) => path.resolve(a));
  for (const [what, p] of [['core', path.join(core, 'pyodide.mjs')], ['numpy wheel', numpy], ['pymol wheel', pymol]]) {
    if (!existsSync(p)) usage(`${what} not found: ${p}`);
  }
  guardHost();
  const t0 = Date.now();
  const outcomes = {};
  for (const [name, kind, today] of [['bundled', 'bundled', false], ['wizard_c', 'wizard', false], ['wizard_py', 'wizard', true]]) {
    outcomes[name] = await runWorker({ core, numpy, pymol, kind, today });
  }
  const r = Object.fromEntries(Object.entries(outcomes).map(([k, v]) => [k, v.ok ? v.result : {}]));
  const b = r.bundled;
  const bnd = b.boundary || {};
  const pse = b.pse || {};
  const ctrl = b.controls || {};
  const planted = Object.entries(ctrl).filter(([k]) => k !== 'unchanged deep copy');
  const wc = r.wizard_c;
  const wp = r.wizard_py;
  const strip = (x) => ({ mutations: x.mutations, final: x.final, fragments: x.fragments });
  const empty = (o) => o && typeof o === 'object' && Object.keys(o).length === 0;
  const expect = [
    ['every case ran to the end', Object.values(outcomes).every((o) => o.ok === true)],
    ['after import pymol, pickle.loads and pickle._loads are chempy.pkl.restricted_loads', b.restricted === true && wc.restricted === true && wp.restricted === true],
    ['cPickle.load is still the pure-Python pickle._load, pickle.load the C one', b.cpickle_load_is_pure_python === true && b.pickle_load_is_c === true],
    [`the wheel installs exactly ${EXPECTED} .pkl, all under pymol_path/data`,
      b.wheel_pkl === EXPECTED && b.installed_pkl === EXPECTED && b.installed_is_wheel_set === true && Array.isArray(b.wheel_pkl_outside_data) && b.wheel_pkl_outside_data.length === 0],
    [`all ${EXPECTED} bundled .pkl take the C path through chempy.io.pkl.fromFile (by effect)`, b.checked === EXPECTED && b.c_path_count === EXPECTED],
    [`all ${EXPECTED} load through fromFile identical to the pure-Python path (types, key order, float bits, shared references)`,
      b.checked === EXPECTED && empty(b.load_errors) && empty(b.fromFile_vs_python_diffs)],
    [`all ${EXPECTED} load through the C unpickler identical to the pure-Python path`, b.checked === EXPECTED && empty(b.load_errors) && empty(b.c_vs_python_diffs)],
    ['every swapped file was restored byte for byte', Array.isArray(b.not_restored) && b.not_restored.length === 0],
    ['boundary: a file inside $PYMOL_DATA takes the C path', bnd.inside === 'C'],
    ['boundary: outside, a ".." escape and a symlink pointing out keep the Python path',
      bnd.outside === 'Python' && bnd.dotdot_escape === 'Python' && bnd.symlink_inside_pointing_out === 'Python'],
    ['boundary: $PYMOL_DATA unset or empty keeps the Python path', bnd.pymol_data_unset === 'Python' && bnd.pymol_data_empty === 'Python'],
    ['a crafted .pse is refused by cmd.load inside $PYMOL_DATA and outside, its payload not run',
      String(pse.inside_pymol_data?.load).startsWith('refused') && pse.inside_pymol_data?.payload_ran === false
      && String(pse.outside?.load).startsWith('refused') && pse.outside?.payload_ran === false],
    ['the .pse load path made no PKL.fromFile call', Array.isArray(pse.fromFile_calls) && pse.fromFile_calls.length === 0],
    ['control: the same .pse runs its payload with the restricted loader swapped out', pse.control_payload_ran === true],
    ['the restriction and fromFile are back after the control swap', pse.restriction_back === true],
    ['comparator control: an unchanged deep copy compares equal', 'unchanged deep copy' in ctrl && ctrl['unchanged deep copy'] === null],
    ['comparator controls: every planted difference is caught', planted.length === 7 && planted.every(([, v]) => typeof v === 'string')],
    ['wizard_c: the shipped fromFile read the side-chain libraries and fragments, none through cPickle.load',
      Array.isArray(wc.fromFile_names) && SIDECHAINS.every((s) => wc.fromFile_names.includes(s))
      && wc.fromFile_names.some((n) => n.startsWith('chempy/fragments/')) && wc.py_read_count === 0],
    ['wizard_py: today\'s fromFile read the side-chain libraries through cPickle.load',
      Array.isArray(wp.py_reads) && SIDECHAINS.every((s) => wp.py_reads.includes(s)) && wp.py_read_count > 0],
    ['the wizard found rotamers (backbone-dependent and -independent) and mutated the structure',
      Array.isArray(wc.mutations) && wc.mutations.length === 8 && wc.mutations.filter((m) => m.states > 1).length >= 6
      && wc.mutations.some((m) => m.dep === 'ind' && m.states > 1) && wc.final?.coords && wc.final?.fasta],
    ['mutagenesis: identical rotamer counts, bump scores, per-state coordinates and titles on both paths',
      Array.isArray(wc.mutations) && same(wc.mutations, wp.mutations)],
    ['mutagenesis: identical final atoms, coordinates and sequence on both paths', wc.final?.coords && same(wc.final, wp.final)],
    ['cmd.fragment and cmd.fab: identical coordinates on both paths', wc.fragments?.pep && wc.fragments?.benzene && same(wc.fragments, wp.fragments)],
    ['no host process start was attempted', Object.values(r).every((x) => Array.isArray(x.hostCalls) && x.hostCalls.length === 0)],
  ];
  const expectations = Object.fromEntries(expect.map(([k, v]) => [k, Boolean(v)]));
  const ok = Object.values(expectations).every(Boolean);
  const errors = Object.fromEntries(Object.entries(outcomes).filter(([, o]) => !o.ok).map(([k, o]) => [k, o.error]));
  const rep = { probe: PROBE, ok, expectations, wheel: pymol, elapsed_s: Math.round((Date.now() - t0) / 100) / 10,
    errors: Object.keys(errors).length ? errors : undefined, result: { ...r, wizard_same: wc.mutations ? same(strip(wc), strip(wp)) : false } };
  writeFileSync(report, JSON.stringify(rep, null, 1) + '\n');
  for (const [k, v] of Object.entries(expectations)) console.log(`${v ? 'ok  ' : 'FAIL'} ${k}`);
  if (!ok) {
    console.log(JSON.stringify({ errors, not_c_path: Object.keys(b.not_c_path || {}).length, boundary: bnd, pse, diffs: b.fromFile_vs_python_diffs, c_diffs: b.c_vs_python_diffs,
      load_errors: b.load_errors, py_reads_c: wc.py_reads }, null, 1).slice(0, 4000));
  }
  process.exit(ok ? 0 : 1);
}
