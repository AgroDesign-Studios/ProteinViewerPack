// S1-9 regression probe: the wheel's re-pickled chempy data loads to the same objects as the originals.
//
//   node pickle_identity.mjs <pyodide-core-dir> <numpy.whl> <pymol.whl> <report.json> <reference>
//
// <reference> holds the ORIGINAL pickles: a source tree's data/chempy dir (or the tree
// itself), or a wheel built without S1-9 (the shipped one). repickle.mjs rewrote the
// 131 fragments and the two side-chain libraries with protocol 4 at build time; this
// probe loads every .pkl of <pymol.whl> and its original through chempy.io.pkl.fromFile,
// the loader the runtime uses (cmd.fragment, the mutagenesis wizard), in a real Pyodide
// with the wheel installed, and compares the two objects recursively: exact types, dict
// key order, float bit patterns, every attribute, and the shared-reference structure
// (a one-to-one map between the two object graphs). The evidence (2026-11-16-pymol-wasm-
// slim evidence 3.9) found 134 identical pairs in the study; the S1 wheel has 133 (it drops
// sc_library.pkl). Controls: an unchanged deep copy must compare equal, and planted
// differences (a float one ulp off, -0.0 for 0.0, swapped key order, int for bool, str
// for bytes, a shared list made two lists, an extra attribute) must each be caught.
//
// The case runs in a worker_threads Worker that guards the host shell itself
// (bench/lib/guard_host.mjs) and is terminated after LIMIT_MS (a timeout is a failure).
// exit: 0 = every expectation held; 1 = one did not (the report says which, and why);
// 2 = usage / unreadable input.
import path from 'node:path';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { guardHost, hostCalls, PY_HOST_BLOCK } from '../bench/lib/guard_host.mjs';

const PROBE = 'pickle_identity';
const EXPECTED = 133;
const LIMIT_MS = 15 * 60 * 1000;

const PY = String.raw`
import copy, json, math, os, struct, sys, zipfile
import chempy
from chempy import io as cio

args = json.load(open('/probe/args.json'))
SITE = os.path.dirname(os.path.dirname(chempy.__file__))
PFX = 'pymol/pymol_path/data/chempy/'
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

def sharing(o):
    """How many containers the graph reaches more than once (the study's measure)."""
    cnt, st = {}, [o]
    while st:
        x = st.pop()
        if isinstance(x, (list, tuple, dict)) or hasattr(x, '__dict__'):
            k = id(x)
            cnt[k] = cnt.get(k, 0) + 1
            if cnt[k] > 1:
                continue
            st.extend(x.values() if isinstance(x, dict) else x if isinstance(x, (list, tuple)) else vars(x).values())
    return sum(1 for v in cnt.values() if v > 1)

z = zipfile.ZipFile('/probe/test.whl')
pk = sorted(n for n in z.namelist() if n.endswith('.pkl'))
out = {'wheel_pkl': len(pk), 'wheel_protocol4': sum(1 for n in pk if z.read(n)[:2] == b'\x80\x04'),
       'outside_data_chempy': [n for n in pk if not n.startswith(PFX)],
       'installed_differs': [n for n in pk if open(os.path.join(SITE, n), 'rb').read() != z.read(n)]}

REF = '/probe/ref/'
if args['ref_kind'] == 'wheel':
    rz = zipfile.ZipFile('/probe/ref.whl')
    for n in rz.namelist():
        if n.startswith(PFX) and n.endswith('.pkl'):
            os.makedirs(os.path.dirname(REF + n[len(PFX):]), exist_ok=True)
            with open(REF + n[len(PFX):], 'wb') as fh:
                fh.write(rz.read(n))
ref = sorted(os.path.relpath(os.path.join(d, f), REF) for d, _, fs in os.walk(REF) for f in fs if f.endswith('.pkl'))
rels = [n[len(PFX):] for n in pk if n.startswith(PFX)]
out['reference_pkl'] = len(ref)
out['reference_only'] = sorted(set(ref) - set(rels))
out['missing_in_reference'] = sorted(set(rels) - set(ref))
out['reference_protocols'] = {}
pairs, same_bytes, diffs, errors, kinds, share = 0, [], {}, {}, {}, {}
for rel in rels:
    if rel not in ref:
        continue
    raw_ref = open(REF + rel, 'rb').read()
    proto = str(raw_ref[1] if raw_ref[:1] == b'\x80' else 0)
    out['reference_protocols'][proto] = out['reference_protocols'].get(proto, 0) + 1
    if raw_ref == z.read(PFX + rel):
        same_bytes.append(rel)
    try:
        a = cio.pkl.fromFile(REF + rel)
        b = cio.pkl.fromFile(os.path.join(SITE, PFX + rel))
    except Exception as e:
        errors[rel] = '%s: %s' % (type(e).__name__, str(e)[:200])
        continue
    pairs += 1
    d = first_diff(a, b, rel)
    if d:
        diffs[rel] = d
    sa, sb = sharing(a), sharing(b)
    if sa:
        share[rel] = [sa, sb]
    kinds[type(a).__module__ + '.' + type(a).__name__] = kinds.get(type(a).__module__ + '.' + type(a).__name__, 0) + 1
out.update({'pairs': pairs, 'pairs_with_same_bytes': same_bytes, 'diffs': diffs, 'load_errors': errors, 'kinds': kinds,
            'shared_containers': share, 'shared_counts_differ': {k: v for k, v in share.items() if v[0] != v[1]}})

# Controls: the comparator must pass an unchanged copy and catch each planted difference.
ctrl = {}
if rels and rels[0] in ref:
    base = cio.pkl.fromFile(REF + rels[0])
    ctrl['unchanged deep copy'] = first_diff(base, copy.deepcopy(base), 'copy')
    nudged = copy.deepcopy(base)
    def nudge(o):
        st = [o]
        seen = set()
        while st:
            x = st.pop()
            if id(x) in seen:
                continue
            seen.add(id(x))
            slots = list(enumerate(x)) if isinstance(x, list) else list(x.items()) if isinstance(x, dict) else list(vars(x).items()) if hasattr(x, '__dict__') else []
            for k, v in slots:
                if type(v) is tuple and any(type(e) is float for e in v):
                    i = next(i for i, e in enumerate(v) if type(e) is float)
                    v = v[:i] + (math.nextafter(v[i], math.inf),) + v[i + 1:]
                elif type(v) is float:
                    v = math.nextafter(v, math.inf)
                else:
                    st.append(v)
                    continue
                if isinstance(x, (list, dict)):
                    x[k] = v
                else:
                    setattr(x, k, v)
                return True
        return False
    ctrl['real data, one float one ulp off'] = first_diff(base, nudged, 'nudged') if nudge(nudged) else 'no float found'
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
# chempy.io imports chempy.mol, which imports pymol, as at run time
out['pymol_imported'] = 'pymol' in sys.modules
json.dumps(out)
`;

function usage(msg) {
  console.error(`${PROBE}: ${msg}\nusage: node pickle_identity.mjs <pyodide-core-dir> <numpy.whl> <pymol.whl> <report.json> <reference data/chempy dir, source tree or wheel>`);
  process.exit(2);
}

async function runCase(data) {
  guardHost();
  const indexURL = path.resolve(data.core) + '/';
  const { loadPyodide } = await import(pathToFileURL(path.join(indexURL, 'pyodide.mjs')).href);
  const py = await loadPyodide({ indexURL, stdout: () => {}, stderr: () => {} });
  py.runPython(PY_HOST_BLOCK);
  await py.loadPackage([data.numpy, data.pymol], { messageCallback: () => {} });
  py.FS.mkdirTree('/probe/ref');
  py.FS.writeFile('/probe/test.whl', new Uint8Array(readFileSync(data.pymol)));
  if (data.refKind === 'wheel') {
    py.FS.writeFile('/probe/ref.whl', new Uint8Array(readFileSync(data.ref)));
  } else {
    for (const sub of ['fragments', 'sidechains']) {
      const dir = path.join(data.ref, sub);
      if (!existsSync(dir)) continue;
      py.FS.mkdirTree(`/probe/ref/${sub}`);
      for (const f of readdirSync(dir).filter((n) => n.endsWith('.pkl')).sort()) {
        py.FS.writeFile(`/probe/ref/${sub}/${f}`, new Uint8Array(readFileSync(path.join(dir, f))));
      }
    }
  }
  py.FS.writeFile('/probe/args.json', JSON.stringify({ ref_kind: data.refKind }));
  const r = JSON.parse(py.runPython(PY));
  r.hostCalls = [...hostCalls];
  return r;
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
  const [core, numpy, pymol, report, refArg] = argv.map((a) => path.resolve(a));
  for (const [what, p] of [['core', path.join(core, 'pyodide.mjs')], ['numpy wheel', numpy], ['pymol wheel', pymol], ['reference', refArg]]) {
    if (!existsSync(p)) usage(`${what} not found: ${p}`);
  }
  let ref = refArg;
  let refKind = 'wheel';
  if (statSync(refArg).isDirectory()) {
    refKind = 'dir';
    if (!existsSync(path.join(ref, 'fragments')) && existsSync(path.join(ref, 'data', 'chempy', 'fragments'))) ref = path.join(ref, 'data', 'chempy');
    if (!existsSync(path.join(ref, 'fragments'))) usage(`reference dir ${refArg} has no fragments/ (give data/chempy, the source tree or a wheel)`);
  }
  guardHost();
  const t0 = Date.now();
  const outcome = await new Promise((resolve) => {
    const w = new Worker(new URL(import.meta.url), { workerData: { core, numpy, pymol, ref, refKind } });
    const timer = setTimeout(() => {
      w.terminate();
      resolve({ ok: false, error: `timed out after ${LIMIT_MS} ms` });
    }, LIMIT_MS);
    w.once('message', (m) => { clearTimeout(timer); w.terminate(); resolve(m); });
    w.once('error', (e) => { clearTimeout(timer); resolve({ ok: false, error: String((e && e.message) || e).slice(0, 1200) }); });
    w.once('exit', (code) => { clearTimeout(timer); resolve({ ok: false, error: `worker exited (${code}) without a result` }); });
  });
  const r = outcome.ok ? outcome.result : {};
  const ctrl = r.controls || {};
  const planted = Object.entries(ctrl).filter(([k]) => k !== 'unchanged deep copy');
  const expect = [
    ['the probe ran to the end', outcome.ok === true],
    [`the wheel holds exactly ${EXPECTED} .pkl members`, r.wheel_pkl === EXPECTED],
    ['every .pkl in the wheel is protocol 4', r.wheel_pkl > 0 && r.wheel_protocol4 === r.wheel_pkl],
    ['every .pkl lies under pymol_path/data/chempy', Array.isArray(r.outside_data_chempy) && r.outside_data_chempy.length === 0],
    ['the installed files are the wheel members', Array.isArray(r.installed_differs) && r.installed_differs.length === 0],
    ['every wheel .pkl has its original in the reference', Array.isArray(r.missing_in_reference) && r.missing_in_reference.length === 0],
    ['every pair compares two encodings (the reference is not the wheel itself)', r.pairs === EXPECTED && Array.isArray(r.pairs_with_same_bytes) && r.pairs_with_same_bytes.length === 0],
    [`${EXPECTED} pairs load through chempy.io.pkl.fromFile, recursively identical`,
      r.pairs === EXPECTED && r.load_errors && Object.keys(r.load_errors).length === 0 && r.diffs && Object.keys(r.diffs).length === 0],
    ['shared-container counts agree (the study measure)', r.shared_counts_differ && Object.keys(r.shared_counts_differ).length === 0],
    ['control: an unchanged deep copy compares equal', 'unchanged deep copy' in ctrl && ctrl['unchanged deep copy'] === null],
    ['controls: every planted difference is caught', planted.length === 8 && planted.every(([, v]) => typeof v === 'string' && v !== 'no float found')],
    ['no host process start was attempted', Array.isArray(r.hostCalls) && r.hostCalls.length === 0],
  ];
  const expectations = Object.fromEntries(expect.map(([k, v]) => [k, Boolean(v)]));
  const ok = Object.values(expectations).every(Boolean);
  const rep = { probe: PROBE, ok, expectations, wheel: pymol, reference: refArg, reference_kind: refKind,
    elapsed_s: Math.round((Date.now() - t0) / 100) / 10, error: outcome.ok ? undefined : outcome.error, result: r };
  writeFileSync(report, JSON.stringify(rep, null, 1) + '\n');
  for (const [k, v] of Object.entries(expectations)) console.log(`${v ? 'ok  ' : 'FAIL'} ${k}`);
  if (!ok) console.log(JSON.stringify({ error: rep.error, diffs: r.diffs, load_errors: r.load_errors, missing: r.missing_in_reference }, null, 1).slice(0, 4000));
  process.exit(ok ? 0 : 1);
}
