// A background image that is not a readable PNG must not break a ray-traced
// export (design S1-6, patch 0011, layer0/MyPNG.cpp).
//
//   node bg_image_probe.mjs <pyodide-core-dir> <numpy.whl> <pymol.whl> <report.json>
//        [--only=<case>,<case>...] [--jobs=N] [--case-timeout=SECONDS]
//
// The probe checks that a non-PNG, short, truncated or oversize background
// image breaks neither a ray-traced export nor the runtime (patch 0011), set
// directly or restored from a .pse, and that cmd.load_png rejects such input.
// Cases ported from earlier study probes:
//   ray_*       bg_image_filename = <input>, then cmd.png(<file>, w, h, ray=1)
//               as worker.js exportPng{ray} does: no trap, a PNG of the asked
//               size is written, and its pixels equal the same scene ray-traced
//               with no background image (drawn without the background).
//   load_png_*  cmd.load_png(<input>) raises pymol.CmdException (not a trap,
//               not a silent empty image), and the runtime still works.
//   pse_restore_ray  a .pse saved with a garbage data: URI background, restored
//               as worker.js RESTORE_PY restores one, then ray-traced: no trap,
//               the setting survived the restore, the PNG is drawn without it.
//   valid_png_control  a VALID small PNG background is used by the ray tracer
//               (the corner pixel takes the image's colour, the picture differs
//               from the one with no background) and load_png accepts it.
// Each case runs in its own worker thread with its own Pyodide (a trap kills
// the runtime); a case that runs past --case-timeout (default 60 s after boot)
// is stopped and fails. Every thread calls guardHost() before Pyodide loads and
// runs PY_HOST_BLOCK right after (pymol-wasm/bench/README.md, trap 1); no
// thread starts a child process. Files live in Pyodide's in-memory filesystem.
// Exit 0 = every expectation held; 1 = one did not (or the probe itself
// failed); 2 = usage / unreadable input.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { accessSync, constants, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { guardHost, hostCalls, PY_HOST_BLOCK } from '../bench/lib/guard_host.mjs';

const PROBE = 'bg_image_probe';

const START_PY = String.raw`
import pymol, pymol.invocation, pymol2
pymol.invocation.parse_args(['pymol', '-cq'])
_probe_inst = pymol2.SingletonPyMOL(); _probe_inst.start()
from pymol import cmd
`;

// The shipped worker.js RESTORE_PY (PR-2's frontend/public/vendor/pymol/
// 3.2.0a-edcda80f-pyodide-314.0.7/worker.js), copied verbatim; only its last
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
import base64, gc, json, os, struct, zlib
import pymol
from pymol import cmd

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

# ---- PNG bytes (with a colour argument) ----
def _png_chunk(tag, data):
    return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)

BG_RGBA = (200, 30, 40, 255)

def _png(width, height, rgba=BG_RGBA):
    sig = b'\x89PNG\r\n\x1a\n'
    ihdr = _png_chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0))
    row = b'\x00' + bytes(rgba) * width
    return sig + ihdr + _png_chunk(b'IDAT', zlib.compress(row * height, 9)) + _png_chunk(b'IEND', b'')

def _decode(path):
    """(width, height, RGBA rows as bytes) of an 8-bit RGB / RGBA non-interlaced PNG."""
    b = open(path, 'rb').read()
    assert b[:8] == b'\x89PNG\r\n\x1a\n', 'not a PNG'
    i, idat, w, h, ct = 8, b'', 0, 0, None
    while i < len(b):
        n = struct.unpack('>I', b[i:i + 4])[0]
        t = b[i + 4:i + 8]
        if t == b'IHDR':
            w, h, depth, ct, _, _, il = struct.unpack('>IIBBBBB', b[i + 8:i + 21])
            assert depth == 8 and ct in (2, 6) and il == 0, 'unexpected PNG format'
        elif t == b'IDAT':
            idat += b[i + 8:i + 8 + n]
        i += 12 + n
    bpp = 4 if ct == 6 else 3
    raw = zlib.decompress(idat)
    stride = w * bpp
    out = bytearray()
    prev = bytearray(stride)
    for y in range(h):
        f = raw[y * (stride + 1)]
        cur = bytearray(raw[y * (stride + 1) + 1:(y + 1) * (stride + 1)])
        for x in range(stride):
            a = cur[x - bpp] if x >= bpp else 0
            c = prev[x - bpp] if x >= bpp else 0
            up = prev[x]
            if f == 1:
                cur[x] = (cur[x] + a) & 0xff
            elif f == 2:
                cur[x] = (cur[x] + up) & 0xff
            elif f == 3:
                cur[x] = (cur[x] + ((a + up) >> 1)) & 0xff
            elif f == 4:
                p = a + up - c
                pa, pb, pc = abs(p - a), abs(p - up), abs(p - c)
                cur[x] = (cur[x] + (a if pa <= pb and pa <= pc else up if pb <= pc else c)) & 0xff
            else:
                assert f == 0, 'bad filter %d' % f
        if bpp == 3:
            out += b''.join(bytes(cur[k:k + 3]) + b'\xff' for k in range(0, stride, 3))
        else:
            out += cur
        prev = cur
    return w, h, bytes(out)

# ---- inputs that are not a readable PNG ----
BAD_FILE = '/tmp/bg.txt'
GARBAGE_URI = 'data:image/png;base64,QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo='
SHORT_URI = 'data:image/png;base64,iVBORw=='                                # 4 bytes
_full = _png(64, 48)
TRUNC_URI = 'data:image/png;base64,' + base64.b64encode(_full[:len(_full) // 2]).decode()
VALID_FILE = '/tmp/bg_valid.png'
open(BAD_FILE, 'wb').write(b'this is not a png, it is a text file\n' * 10)
open(VALID_FILE, 'wb').write(_full)
WRAP_FILE = '/tmp/bg_size_wrap.png'
WRAP_W, WRAP_H, WRAP_ROWS = 32769, 32768, 2048
INPUTS = {'file': BAD_FILE, 'datauri_garbage': GARBAGE_URI, 'datauri_short': SHORT_URI, 'datauri_truncated': TRUNC_URI,
          'size_wrap': WRAP_FILE}

def _make_size_wrap():
    """An oversize PNG background (patch 0011's size check)."""
    if os.path.exists(WRAP_FILE):
        return
    ihdr = _png_chunk(b'IHDR', struct.pack('>IIBBBBB', WRAP_W, WRAP_H, 8, 6, 0, 0, 0))
    co = zlib.compressobj(1)
    row = b'\x00' + b'\x5a' * (4 * WRAP_W)   # filter byte 0, then the pixels
    idat = b''.join([co.compress(row) for _ in range(WRAP_ROWS)] + [co.flush()])
    with open(WRAP_FILE, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n' + ihdr + _png_chunk(b'IDAT', idat) + _png_chunk(b'IEND', b''))

def _input(key):
    if key == 'size_wrap':
        st('make size-wrap PNG', _make_size_wrap)
    return INPUTS[key]

W, H = 160, 120

def _scene():
    st('fab', lambda: cmd.fab('ACD', 'p'))
    st('orient', lambda: cmd.orient('p'))

def _ray(path):
    """worker.js exportPng{ray}: PyMOL writes the ray-traced PNG itself."""
    try:
        os.remove(path)
    except OSError:
        pass
    cmd.png(path, width=W, height=H, ray=1, quiet=1)
    return os.path.exists(path)

def _still_works(tag):
    st(tag + ' fab after', lambda: cmd.fab('ACDEFG', 'q'))
    check(tag + ' runtime still renders', st(tag + ' ray after', lambda: _ray('/tmp/after.png')) is True)
    st(tag + ' delete', lambda: cmd.delete('all'))
    gc.collect()

def ray_with_bad_background(key):
    bg = _input(key)
    _scene()
    st('ray no background', lambda: _ray('/tmp/nobg.png'))
    base = st('decode no background', lambda: _decode('/tmp/nobg.png'))
    st('set bg_image_filename', lambda: cmd.set('bg_image_filename', bg))
    check('setting holds the input', cmd.get('bg_image_filename') == bg)
    wrote = st('ray with bad background', lambda: _ray('/tmp/o.png'))
    check('png written', wrote is True)
    d = st('decode', lambda: _decode('/tmp/o.png'))
    check('png size', d is not None and d[:2] == (W, H))
    check('drawn without background', d is not None and base is not None and d[2] == base[2])
    st('ray again', lambda: _ray('/tmp/o2.png'))
    st('unset bg_image_filename', lambda: cmd.set('bg_image_filename', ''))
    _still_works('bad bg')

def load_png_bad(key):
    src = _input(key)
    try:
        print('[probe-step] load_png', flush=True)
        cmd.load_png(src, quiet=0)
        got = 'no error'
    except BaseException as e:
        got = type(e).__module__ + '.' + type(e).__name__
        check('raises pymol.CmdException', isinstance(e, pymol.CmdException))
    else:
        check('raises pymol.CmdException', False)
    _checks_detail['load_png'] = got
    _still_works('load_png')

_checks_detail = {}

def pse_restore_ray():
    _scene()
    st('set bg_image_filename', lambda: cmd.set('bg_image_filename', GARBAGE_URI))
    n0 = cmd.count_atoms('all')
    st('save', lambda: cmd.save('/tmp/sess.pse'))
    st('reinitialize', lambda: cmd.reinitialize())
    check('reinitialize cleared it', cmd.get('bg_image_filename') == '')
    g = {'cmd': cmd, '_agdb_gl_defaults': _agdb_gl_defaults}
    st('restore', lambda: exec(compile(RESTORE_PY, '<RESTORE_PY>', 'exec'), g))
    check('restore no error', g.get('_err', 'unset') is None)
    check('restore atoms', g.get('_atoms') == n0 and n0 > 0)
    check('setting survived the restore', cmd.get('bg_image_filename') == GARBAGE_URI)
    wrote = st('ray restored session', lambda: _ray('/tmp/o.png'))
    check('png written', wrote is True)
    d = st('decode', lambda: _decode('/tmp/o.png'))
    check('png size', d is not None and d[:2] == (W, H))
    st('unset bg_image_filename', lambda: cmd.set('bg_image_filename', ''))
    st('ray no background', lambda: _ray('/tmp/nobg.png'))
    base = st('decode no background', lambda: _decode('/tmp/nobg.png'))
    check('drawn without background', d is not None and base is not None and d[2] == base[2])
    _still_works('pse')

def valid_png_control():
    _scene()
    st('ray no background', lambda: _ray('/tmp/nobg.png'))
    base = st('decode no background', lambda: _decode('/tmp/nobg.png'))
    st('set bg_image_filename', lambda: cmd.set('bg_image_filename', VALID_FILE))
    wrote = st('ray with valid background', lambda: _ray('/tmp/o.png'))
    check('png written', wrote is True)
    d = st('decode', lambda: _decode('/tmp/o.png'))
    check('png size', d is not None and d[:2] == (W, H))
    check('differs from no background', d is not None and base is not None and d[2] != base[2])
    corner = list(d[2][0:4]) if d is not None else None
    _checks_detail['corner_rgba'] = corner
    _checks_detail['corner_rgba_no_background'] = list(base[2][0:4]) if base is not None else None
    check('corner pixel is the background colour',
          corner is not None and all(abs(corner[k] - BG_RGBA[k]) <= 8 for k in range(3)))
    st('unset bg_image_filename', lambda: cmd.set('bg_image_filename', ''))
    st('load_png valid', lambda: cmd.load_png(VALID_FILE, quiet=1))
    check('load_png accepts a valid PNG', _errors == [])
    _still_works('control')

def _result():
    return {'steps': _steps, 'errors': _errors, 'checks': _checks, 'detail': _checks_detail}
`;

const CASES = {
  ray_file: `ray_with_bad_background('file')`,
  ray_datauri_garbage: `ray_with_bad_background('datauri_garbage')`,
  ray_datauri_short: `ray_with_bad_background('datauri_short')`,
  ray_datauri_truncated: `ray_with_bad_background('datauri_truncated')`,
  load_png_file: `load_png_bad('file')`,
  load_png_datauri_garbage: `load_png_bad('datauri_garbage')`,
  load_png_datauri_short: `load_png_bad('datauri_short')`,
  load_png_datauri_truncated: `load_png_bad('datauri_truncated')`,
  ray_size_wrap: `ray_with_bad_background('size_wrap')`,
  load_png_size_wrap: `load_png_bad('size_wrap')`,
  pse_restore_ray: `pse_restore_ray()`,
  valid_png_control: `valid_png_control()`,
};

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
    console.error(`${PROBE}: ${why}\nusage: node bg_image_probe.mjs <pyodide-core-dir> <numpy.whl> <pymol.whl> <report.json> `
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
  for (const n of names) expectations[n] = casePassed(results[n]);
  const fatal = names.filter((n) => results[n].status !== 'ran' || results[n].alive === false);
  const report = {
    probe: PROBE,
    ok: Object.keys(expectations).length > 0 && Object.values(expectations).every((x) => x === true),
    expectations,
    failures: Object.entries(expectations).filter(([, v]) => !v).map(([k]) => k),
    summary: { cases: names.length, trapped_or_hung: fatal.length, trapped_or_hung_cases: fatal },
    case_timeout_s: caseTimeoutMs / 1000,
    inputs: { pymol_wheel: path.basename(inputs.pymol), pymol_wheel_sha256: sha256(inputs.pymol) },
    cases: results,
  };
  writeFileSync(reportPath, JSON.stringify(report, null, 1) + '\n');
  console.log(`${PROBE}: ${report.ok ? 'PASS' : 'FAIL'} - trapped or hung: ${fatal.length}/${names.length}`
    + (fatal.length ? ` (${fatal.join(', ')})` : '') + `; failed: ${report.failures.length}/${names.length}`);
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
