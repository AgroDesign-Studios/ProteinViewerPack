// Labels in a label_font_id the wasm build does not embed must draw in Sans,
// not vanish (design S2-1 option (2), patch 0012, layer1/Text.cpp).
//
//   node font_fallback_probe.mjs <pyodide-core-dir> <numpy.whl> <pymol.whl> <report.json>
//        [--only=<case>,<case>...] [--jobs=N] [--case-timeout=SECONDS]
//
// Patch 0012 registers only the four DejaVu Sans faces (ids 5-8) in the wasm
// build and makes CText::getFont draw every other id >= 5 with font 5. Without
// that fallback a label in an id with no font is drawn as nothing, with no
// error, on the screen and in the ray tracer alike (evidence 2026-11-16
// pymol-wasm-slim §3.21); SettingCheckFontID is not on the ray path, so the
// ray tracer is where a fallback in the wrong place shows. Every picture here
// is ray-traced, as worker.js exportPng{ray} does (cmd.png(..., ray=1)), and
// compared as DECODED RGBA (the PNG is decoded in this thread, node's zlib):
//   labels_ray     an earlier study's label scene (two pseudoatom labels, black
//                  background, 480x360) at label
//                  sizes 14, 24 and -0.8 for label_font_id 5-18, 19, 99,
//                  1000000 and 2147483647, plus the same scene with no label.
//   measures_ray   a distance label and a dihedral label (cmd.fab peptide),
//                  each with label_font_id 5, 15, and its labels hidden.
//   session_ray    an object whose own label_font_id is 15, brought back by
//                  cmd.get_session() -> cmd.reinitialize() -> cmd.set_session()
//                  and by a .pse written with cmd.save and read with cmd.load,
//                  against the same scene with the object's id 5 restored the
//                  same way, and with its labels hidden.
// Expectations (all true on a wheel built with patch 0012):
//   - positive control: at every size id 5 differs from no label;
//   - ids 6, 7, 8 each differ from id 5, and every id draws something;
//   - ids 9-18 and 19, 99, 1000000, 2147483647 are pixel-identical to id 5;
//   - each id reads back as set (the fallback is in getFont, not the setting);
//   - the distance and dihedral labels draw something, and in id 15 equal id 5;
//   - the session-restored object keeps its id 15, draws something, and equals
//     the same object drawn in id 5 (both restore routes);
//   - every case ran to its end: no trap, no hang, no step error, no host call.
// On a wheel with all 14 faces (S1) the "equal id 5" expectations are false
// and ids >= 19 draw nothing: that is this probe's detection power.
//
// Each case runs in its own worker thread with its own Pyodide (a trap kills
// the runtime), and the main thread stops a case that runs longer than
// --case-timeout (default 180 s after its boot): a hang counts as a failure.
// Every thread calls guardHost() before Pyodide loads and runs PY_HOST_BLOCK
// right after (pymol-wasm/bench/README.md, trap 1); no thread starts a child
// process. Files live in Pyodide's in-memory filesystem.
// Exit 0 = every expectation held; 1 = one did not (or the probe itself
// failed); 2 = usage / unreadable input.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { accessSync, constants, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { guardHost, hostCalls, PY_HOST_BLOCK } from '../bench/lib/guard_host.mjs';

const PROBE = 'font_fallback_probe';

// The label_font_id values the labels_ray case draws, and the sizes.
const SIZES = ['14', '24', '-0.8'];
const KEPT = [5, 6, 7, 8];
const DROPPED = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
const BEYOND = [19, 99, 1000000, 2147483647];
const IDS = [...KEPT, ...DROPPED, ...BEYOND];

const START_PY = String.raw`
import pymol, pymol.invocation, pymol2
pymol.invocation.parse_args(['pymol', '-cq'])
_probe_inst = pymol2.SingletonPyMOL(); _probe_inst.start()
from pymol import cmd
`;

const PRELUDE_PY = String.raw`
import gc, os
import pymol
from pymol import cmd

_steps = []
_errors = []
_checks = {}
_shots = []      # [key, MEMFS path, key of the picture it is compared with for "draws something"]
_detail = {}

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

W, H = 480, 360

def shot(key, ref=None, w=W, h=H):
    """worker.js exportPng{ray}: PyMOL ray-traces and writes the PNG itself."""
    p = '/tmp/shot_%d.png' % len(_shots)
    def go():
        cmd.png(p, width=w, height=h, ray=1, quiet=1)
        if not os.path.exists(p):
            raise RuntimeError('no PNG written')
    st('ray ' + key, go)
    _shots.append([key, p, ref])

def _black():
    cmd.set('ray_opaque_background', 1)
    cmd.bg_color('black')

def labels_ray(ids, sizes):
    # The earlier study's scene: the same labels and picture size.
    _black()
    st('pseudoatoms', lambda: (cmd.pseudoatom('pa1', pos=[0, 0, 0]), cmd.pseudoatom('pa2', pos=[8, 3, 0])))
    cmd.hide('everything'); cmd.orient('all'); cmd.zoom('all', 6)
    shot('nolabel')
    st('label', lambda: (cmd.label('pa1', '"AVAToyo WA fi Lys-123 3.45"'),
                         cmd.label('pa2', '"Å α β → ° é"')))
    cmd.show('labels')
    readback = {}
    for size in sizes:
        st('label_size %s' % size, lambda: cmd.set('label_size', float(size)))
        for fid in ids:
            st('label_font_id %d' % fid, lambda: cmd.set('label_font_id', fid))
            shot('%s/%d' % (size, fid), ref='nolabel')
            readback['%s/%d' % (size, fid)] = cmd.get('label_font_id')
    _detail['readback'] = readback
    check('every id reads back as set after its ray',
          all(int(v) == int(k.split('/')[1]) for k, v in readback.items()))

def measures_ray():
    _black()
    st('fab', lambda: cmd.fab('AAA', 'pep'))
    cmd.hide('everything')
    st('distance', lambda: cmd.distance('d1', 'pep///1/CA', 'pep///3/CA'))
    st('dihedral', lambda: cmd.dihedral('dh1', 'pep///1/N', 'pep///1/CA', 'pep///1/C', 'pep///2/N'))
    cmd.orient('pep')
    cmd.set('label_size', 24)
    for obj, other in (('d1', 'dh1'), ('dh1', 'd1')):
        cmd.enable(obj); cmd.disable(other)
        cmd.show('labels', obj)
        for fid in (5, 15):
            cmd.set('label_font_id', fid)
            shot('%s/%d' % (obj, fid), ref=obj + '/nolabel')
        cmd.hide('labels', obj)
        shot(obj + '/nolabel')
        cmd.show('labels', obj)
    cmd.set('label_font_id', 5)

def _session_scene(fid):
    _black()
    cmd.set('label_size', 24)
    cmd.set('label_font_id', 5)
    st('pseudoatoms', lambda: (cmd.pseudoatom('p1', pos=[0, 0, 0], label='Object id ABC xyz 123'),
                               cmd.pseudoatom('p2', pos=[0, -3, 0], label='Global id 5 Qg 4.56')))
    cmd.hide('everything'); cmd.show('labels'); cmd.zoom('all', 6)
    st('object label_font_id %d' % fid, lambda: cmd.set('label_font_id', fid, 'p1'))

def _restored(route, fid):
    """A fresh runtime state, the scene with p1's own label_font_id = fid, through one restore route.

    The id-5 reference is restored the same way rather than set on the restored
    object: changing an object's label_font_id between two rays drops or
    repeats the other object's label in the second picture on the S1 wheel
    too (seen in this probe's first version), so each picture is made from its
    own restore."""
    tag = '%s/%d' % (route, fid)
    st(tag + ' reinitialize', lambda: cmd.reinitialize())
    _session_scene(fid)
    if route == 'get_set':
        sess = st(tag + ' get_session', lambda: cmd.get_session())
        st(tag + ' reinitialize after', lambda: cmd.reinitialize())
        check(tag + ': reinitialize cleared the object', 'p1' not in cmd.get_names('all'))
        st(tag + ' set_session', lambda: cmd.set_session(sess))
    else:
        st(tag + ' save', lambda: cmd.save('/tmp/s_%d.pse' % fid))
        st(tag + ' reinitialize after', lambda: cmd.reinitialize())
        check(tag + ': reinitialize cleared the object', 'p1' not in cmd.get_names('all'))
        st(tag + ' load', lambda: cmd.load('/tmp/s_%d.pse' % fid))
    got = st(tag + ' read object id', lambda: cmd.get('label_font_id', 'p1'))
    _detail[tag + ' object id'] = got
    check(tag + ': the object keeps its label_font_id', got is not None and int(got) == fid)
    shot(tag, ref=route + '/nolabel')

def session_ray():
    for route in ('get_set', 'pse'):
        _restored(route, 15)
        _restored(route, 5)
        cmd.hide('labels')
        shot(route + '/nolabel')
    gc.collect()

def _result():
    return {'steps': _steps, 'errors': _errors, 'checks': _checks, 'shots': _shots, 'detail': _detail}
`;

const CASES = {
  labels_ray: `labels_ray(${JSON.stringify(IDS)}, ${JSON.stringify(SIZES)})`,
  measures_ray: 'measures_ray()',
  session_ray: 'session_ray()',
};

// ---- PNG -> RGBA (8-bit RGB / RGBA, non-interlaced; anything else is refused) ----
function decodePng(buf, what) {
  const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buf.length < 8 || SIG.some((b, i) => buf[i] !== b)) throw new Error(`${what}: not a PNG`);
  let p = 8, ihdr = null;
  const idat = [];
  for (;;) {
    if (p + 12 > buf.length) throw new Error(`${what}: truncated`);
    const len = buf.readUInt32BE(p), type = buf.toString('latin1', p + 4, p + 8);
    if (p + 12 + len > buf.length) throw new Error(`${what}: truncated ${type}`);
    const d = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') ihdr = { w: d.readUInt32BE(0), h: d.readUInt32BE(4), depth: d[8], ctype: d[9], il: d[12] };
    else if (type === 'IDAT') idat.push(d);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (!ihdr || ihdr.depth !== 8 || ![2, 6].includes(ihdr.ctype) || ihdr.il !== 0) throw new Error(`${what}: unsupported PNG ${JSON.stringify(ihdr)}`);
  const { w, h } = ihdr, bpp = ihdr.ctype === 6 ? 4 : 3, stride = w * bpp;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  if (raw.length !== h * (stride + 1)) throw new Error(`${what}: ${raw.length} bytes of image data, expected ${h * (stride + 1)}`);
  const px = new Uint8Array(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], s = y * (stride + 1) + 1, o = y * stride, u = o - stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[s + i], a = i >= bpp ? px[o + i - bpp] : 0, b = y > 0 ? px[u + i] : 0, c = i >= bpp && y > 0 ? px[u + i - bpp] : 0;
      let v;
      if (f === 0) v = x;
      else if (f === 1) v = x + a;
      else if (f === 2) v = x + b;
      else if (f === 3) v = x + ((a + b) >> 1);
      else if (f === 4) { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
      else throw new Error(`${what}: bad filter ${f}`);
      px[o + i] = v & 255;
    }
  }
  if (bpp === 4) return { w, h, rgba: px };
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) { rgba[4 * i] = px[3 * i]; rgba[4 * i + 1] = px[3 * i + 1]; rgba[4 * i + 2] = px[3 * i + 2]; rgba[4 * i + 3] = 255; }
  return { w, h, rgba };
}

function differing(a, b) {
  if (!a || !b || a.w !== b.w || a.h !== b.h) return null;
  let n = 0;
  for (let i = 0; i < a.rgba.length; i += 4) {
    if (a.rgba[i] !== b.rgba[i] || a.rgba[i + 1] !== b.rgba[i + 1] || a.rgba[i + 2] !== b.rgba[i + 2] || a.rgba[i + 3] !== b.rgba[i + 3]) n++;
  }
  return n;
}

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
      res.status = 'fatal';
      Object.assign(res, errInfo(e));
    }
    try {
      res.alive = py.runPython('1+1') === 2;
    } catch (e) {
      res.alive = false;
      res.dead_msg = String((e && e.message) || e).split('\n')[0].slice(0, 200);
    }
    // Decode every picture the case wrote, and compare each with its reference.
    if (res.status === 'ran' && res.returned) {
      const shots = res.value.shots || [];
      const img = {};
      const pics = {};
      res.decode_errors = [];
      for (const [key, file] of shots) {
        try {
          img[key] = decodePng(Buffer.from(py.FS.readFile(file)), key);
          pics[key] = { w: img[key].w, h: img[key].h, sha256: createHash('sha256').update(img[key].rgba).digest('hex') };
        } catch (e) {
          res.decode_errors.push(`${key}: ${String((e && e.message) || e).slice(0, 200)}`);
        }
      }
      for (const [key, , ref] of shots) {
        if (ref && pics[key]) pics[key].differs_from_ref = differing(img[key], img[ref]);
      }
      res.pictures = pics;
      delete res.value.shots;
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

/** The case ran to its end: no trap or hang, no step error, its own checks true, no host call, every picture decoded. */
function caseClean(r) {
  if (!r || r.status !== 'ran' || r.returned !== true || r.alive !== true) return false;
  const v = r.value || {};
  const checks = Object.values(v.checks || {});
  return Array.isArray(v.errors) && v.errors.length === 0 && checks.every((x) => x === true)
    && Array.isArray(r.host_calls) && r.host_calls.length === 0
    && Array.isArray(r.decode_errors) && r.decode_errors.length === 0;
}

function sha256(p) {
  return createHash('sha256').update(readFileSync(p)).digest('hex');
}

/** Expectations over the decoded pictures (a missing picture makes its expectation false). */
function judge(results) {
  const pic = (c, k) => (results[c] && results[c].pictures && results[c].pictures[k]) || null;
  const same = (c, a, b) => { const x = pic(c, a), y = pic(c, b); return !!(x && y && x.sha256 === y.sha256); };
  const drawn = (c, k) => { const x = pic(c, k); return !!(x && typeof x.differs_from_ref === 'number' && x.differs_from_ref > 0); };
  const L = 'labels_ray', M = 'measures_ray', S = 'session_ray';
  const table = {};
  for (const s of SIZES) {
    table[s] = {};
    for (const id of IDS) {
      const p = pic(L, `${s}/${id}`);
      table[s][id] = p ? { sha16: p.sha256.slice(0, 16), non_background: p.differs_from_ref, equals_id5: same(L, `${s}/${id}`, `${s}/5`) } : null;
    }
  }
  const every = (ids, f) => SIZES.every((s) => ids.every((id) => f(s, id)));
  const checksOf = (c) => (results[c] && results[c].value && results[c].value.checks) || {};
  const e = {
    every_case_ran_clean: Object.keys(CASES).every((c) => caseClean(results[c])),
    positive_control_id5_differs_from_no_label: every([5], (s) => drawn(L, `${s}/5`)),
    every_id_draws_something: every(IDS, (s, id) => drawn(L, `${s}/${id}`)),
    every_id_reads_back_as_set: checksOf(L)['every id reads back as set after its ray'] === true,
    ids_6_7_8_each_differ_from_id5: every([6, 7, 8], (s, id) => !!pic(L, `${s}/${id}`) && !same(L, `${s}/${id}`, `${s}/5`)),
    ids_9_to_18_equal_id5: every(DROPPED, (s, id) => same(L, `${s}/${id}`, `${s}/5`)),
    ids_19_99_1000000_2147483647_equal_id5: every(BEYOND, (s, id) => same(L, `${s}/${id}`, `${s}/5`)),
    distance_label_draws_something: drawn(M, 'd1/5') && drawn(M, 'd1/15'),
    dihedral_label_draws_something: drawn(M, 'dh1/5') && drawn(M, 'dh1/15'),
    distance_label_id15_equals_id5: same(M, 'd1/15', 'd1/5'),
    dihedral_label_id15_equals_id5: same(M, 'dh1/15', 'dh1/5'),
    get_set_session_object_keeps_id15: checksOf(S)['get_set/15: the object keeps its label_font_id'] === true,
    get_set_session_label_draws_something: drawn(S, 'get_set/15'),
    get_set_session_id15_equals_id5: same(S, 'get_set/15', 'get_set/5'),
    pse_load_object_keeps_id15: checksOf(S)['pse/15: the object keeps its label_font_id'] === true,
    pse_load_label_draws_something: drawn(S, 'pse/15'),
    pse_load_id15_equals_id5: same(S, 'pse/15', 'pse/5'),
  };
  return { expectations: e, table };
}

async function main() {
  const argv = process.argv.slice(2);
  const pos = argv.filter((a) => !a.startsWith('--'));
  const opts = Object.fromEntries(argv.filter((a) => a.startsWith('--')).map((a) => {
    const i = a.indexOf('=');
    return i < 0 ? [a.slice(2), ''] : [a.slice(2, i), a.slice(i + 1)];
  }));
  const usage = (why) => {
    console.error(`${PROBE}: ${why}\nusage: node font_fallback_probe.mjs <pyodide-core-dir> <numpy.whl> <pymol.whl> <report.json> `
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
  const caseTimeoutMs = Math.round(1000 * (parseFloat(opts['case-timeout'] || '180') || 180));
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
      const what = r.status === 'ran' ? (caseClean(r) ? 'ran clean' : 'FAIL (ran; errors, checks or decode)') : `FAIL (${r.status})`;
      console.log(`${PROBE}: ${n}: ${what}${r.msg ? ' - ' + r.msg.slice(0, 160) : ''}${r.status !== 'ran' && r.last_step ? ' (at step: ' + r.last_step + ')' : ''} [${(r.ms / 1000).toFixed(1)} s]`);
    }
  }));

  // --only runs a subset: the expectations still name every case, so a partial run cannot pass.
  const { expectations, table } = judge(results);
  const report = {
    probe: PROBE,
    ok: Object.keys(expectations).length > 0 && Object.values(expectations).every((x) => x === true),
    expectations,
    failures: Object.entries(expectations).filter(([, v]) => !v).map(([k]) => k),
    labels_ray_table: table,
    case_timeout_s: caseTimeoutMs / 1000,
    inputs: { pymol_wheel: path.basename(inputs.pymol), pymol_wheel_sha256: sha256(inputs.pymol) },
    cases: results,
  };
  writeFileSync(reportPath, JSON.stringify(report, null, 1) + '\n');
  for (const [k, v] of Object.entries(expectations)) console.log(`${PROBE}:   ${v ? 'true ' : 'FALSE'} ${k}`);
  console.log(`${PROBE}: ${report.ok ? 'PASS' : 'FAIL'} - ${report.failures.length}/${Object.keys(expectations).length} expectations false`);
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
