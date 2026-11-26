// AgDB in-browser PyMOL — the untrusted-code container.
//
// Runs inside a classic blob: Worker spawned by the opaque-origin
// sandbox="allow-scripts" frame (host.js); inherits the frame CSP
// (default-src 'none'; connect-src <HOST>/vendor/pymol/<ver>/ only). This is
// where Pyodide + Open-Source PyMOL + the untrusted .pse session run. It is
// AgDB-written code; the design it implements is ADR-0049 §4.2 (the verbatim
// copy lives in the handoff TN0110 §4.2). Nothing here can be turned off by a
// message — every defence is unconditional (§4.2-6).
//
// It speaks ONLY the typed protocol of §4.2-4 (plus the heartbeat of ADR-0049
// 注 2):
//   parent/frame -> worker : init, load, setView, command, exportPng,
//                            exportPse, exportMol, exportLook,
//                            restoreSnapshot, runtimeAsset, and the local DOM
//                            input the frame generates (move/button/key/
//                            resize) which never crosses the parent port.
//                            applyLook is the standalone HTML page's only
//                            (frame protocol 4): host.js never forwards it,
//                            nor exportPng's `scale` (the standalone page's
//                            screenshot at 2-4 x the view's pixels).
//   worker -> frame -> parent : ready, log, progress, pick, view18,
//                            png{nonce}, pse{nonce}, mol{nonce}, look{nonce},
//                            snapshot, error{fatal?}, taken{req},
//                            heartbeat{ticks, draws, heapMB, inputMs} (~1 s
//                            from the tick, and on a click/key — relay 2 step
//                            1, ADR-0049 注 2; the parent's watchdog),
//                            uistate{sel, atoms, runs, more, shown, hetero, wizard} (frame
//                            protocol 3, AgDB 2026-11-12: the shown selection
//                            and the wizard, when they change).
//   worker -> standalone page only : guiwidth{px, bw, [lh, tw, ts, cm, ops,
//                            rows, bottom, bh, mode, mv, ct, bm, nf]} (the object panel's width
//                            and the drawing buffer's, device px, when they
//                            change, with the panel's row and button geometry
//                            for the page's hover marks), posted only when `init` carries
//                            guiWidth: true — the standalone HTML page's
//                            bridge; the AgDB frame never sends it, and
//                            host.js would drop the type anyway (OUT);
//                            objects{v, items, more, focus, reps} (the
//                            object list, when it changes), likewise only
//                            when `init` carries objectList: true.
// No other outbound type is ever posted (completion condition 1).
//
// Defences (§4.2-6):
//   - the restricted unpickler is BAKED INTO the wheel (patch 0006): importing
//     pymol swaps pickle.loads/_loads and chempy.pkl.cPickle.loads for an
//     18-name allow-list. The worker ASSERTS it is active and never reinstalls
//     it; it adds the load-format refusal (pkl/model/brick/callback/cgo/cc1)
//     at the five call paths cmd.load alone does not cover; and it strips a
//     foreign session's wizard + movie before set_session.
// Rendering/recovery (§4.2-7): shader warm-up, a stale-GL-error drain before
// each draw and each task (an idle tick makes no GL call),
// one rAF loop that owns every GL call, viewport before each draw,
// refresh_wizard after a parent API call, buffered pre-ready resizes, mousemove
// forwarded with no button pressed, and global error/unhandledrejection hooks
// that classify a C++ std::bad_alloc (which never rejects a pending call) and
// post error{fatal:true} so the parent watchdog recovers at once.
// Start-up and drawing defaults (PT-9554 S2): numpy is unpacked at its first
// import, not at boot (deferNumpy); PyMOL builds only the states on screen
// (defer_builds_mode, but every state in a grid by state) and packs CGO
// colours as bytes (cgo_shader_ub_color) — GL_PY.
'use strict';

// (§4.2-6, unconditional) WebRTC removal in the worker too, not only the frame:
// connect-src does not govern WebRTC ICE/STUN (trap 12), and RTCPeerConnection
// is Window-only in today's target Chrome but a future worker exposure would be
// an untrusted egress channel the frame-side deletion cannot reach.
try { delete self.RTCPeerConnection; } catch (e) {}
try { delete self.webkitRTCPeerConnection; } catch (e) {}
try { self.RTCPeerConnection = undefined; } catch (e) {}
try { self.webkitRTCPeerConnection = undefined; } catch (e) {}

let py, inst, cmd, frame, WEBGL = 0, GLC = null;
let ASSETS = {}, BASE = '';
let CANVAS = null, W = 0, H = 0, DPR = 1;
const HAVE_RAF = (typeof requestAnimationFrame === 'function');
let LOOP_MODE = HAVE_RAF ? 'raf' : 'timer';
const T0 = performance.now();
const MiB = 1024 * 1024;
const SNAPSHOT_CAP = 128 * MiB;   // §4.2-4: snapshot is recovery-only, never persisted

const log = (s) => postMessage({ type: 'log', s: String(s).slice(0, 600) });
// Python's stderr, at most PY_LOG_PER_S lines a second. The parent drops a
// `log` over its rate (200/s, pymolFrameProtocol.ts RATE_PER_SECOND) and stops
// the page at 50,000 drops in 10 s, so a script printing about 5,000 lines a
// second stopped an honest frame (PT-3271 item 14). The rest are counted and
// reported in one line once the second is over (the tick calls flushPyLog).
// The parent's second does not start with this one, so one of its seconds can
// take the end of one of these and the start of the next: twice this, plus
// the note between them, still leaves room under 200 for the worker's other
// logs (PT-4184 item 4).
const PY_LOG_PER_S = 90;
let pyLogSince = -Infinity, pyLogSent = 0, pyLogSkipped = 0;
function flushPyLog(t, force) {
  if (!force && t - pyLogSince < 1000) return;
  if (pyLogSkipped > 0) log('py: ' + pyLogSkipped + ' more line(s) not forwarded');
  pyLogSince = t; pyLogSent = 0; pyLogSkipped = 0;
}
function pyLog(s) {
  flushPyLog(performance.now());
  if (pyLogSent < PY_LOG_PER_S) { pyLogSent++; log('py ' + s); } else pyLogSkipped++;
}
const progress = (phase, extra) => postMessage(Object.assign({ type: 'progress', phase }, extra || {}));

// ---- fatal classification (§4.2-7 / trap 34) ------------------------------
// A std::bad_alloc inside PyMOL reaches Pyodide's API.fatal_error and surfaces
// ONLY as a worker unhandledrejection; the in-flight request never replies.
var FATAL = null;
var FATAL_RE = /bad_alloc|fatal|already fatally|Aborted|abort\(|unreachable|memory access out of bounds|Out of memory|Cannot enlarge|context lost|RangeError/i;
// A wasm trap leaves the runtime unusable whatever its text says, and not every
// engine's wording is in FATAL_RE ('table index is out of bounds', 'integer
// divide by zero', ...). host.js's copy of an uncaught error used to cover
// those, always fatal; it no longer comes (PT-4184 item 2). So does a C++
// exception nobody caught (Pyodide names it "CppException std::length_error"
// and its message is only what(), e.g. "vector") and a side-module symbol
// that did not resolve ("Dynamic linking error: ..."): neither is a
// RuntimeError nor in FATAL_RE's words, and the runtime is dead after either.
const isTrap = (err) => (typeof WebAssembly !== 'undefined' && err instanceof WebAssembly.RuntimeError) ||
  /^CppException\b/.test(String(err && err.name)) || /Dynamic linking error/.test(String(err && err.message));
// A fatal error ends the frame: the page rebuilds it on this message. The count
// of stderr lines held back this second goes out first, while the page still
// listens — the lines before a fatal error are the ones worth knowing about
// (PT-4184 item 5).
function postError(s) {
  if (FATAL) flushPyLog(performance.now(), true);
  postMessage({ type: 'error', s, fatal: !!FATAL });
}
self.addEventListener('error', (ev) => {
  const s = 'worker error: ' + (ev.message || '');
  if (FATAL_RE.test(s) || isTrap(ev.error)) FATAL = FATAL || s.slice(0, 200);
  // Cancelling the event below also drops the browser's own console report,
  // so where it was thrown and the top of its stack go with the message
  // (PT-4184 item 1). Not tested against FATAL_RE: a stack names functions
  // such as fatal_error on its way, fatal or not.
  const at = ev.filename ? ' at ' + String(ev.filename).slice(-120) + ':' + (ev.lineno | 0) + ':' + (ev.colno | 0) : '';
  const stack = ev.error && ev.error.stack ? ' | ' + String(ev.error.stack) : '';
  postError((s + at + stack).slice(0, 600));
  // Handled here, so it does not also reach host.js's worker.onerror: that
  // copy says fatal:true whatever this one says, and every uncaught error,
  // fatal or not, rebuilt the frame (PT-3271 item 8). host.js keeps it for
  // what never reaches this listener, such as a worker script that does not
  // parse.
  ev.preventDefault();
});
self.addEventListener('unhandledrejection', (ev) => {
  const s = 'worker unhandledrejection: ' + String(ev.reason && (ev.reason.stack || ev.reason.message || ev.reason)).slice(0, 400);
  if (FATAL_RE.test(s) || isTrap(ev.reason)) FATAL = FATAL || s.slice(0, 200);
  postError(s);
});

// The core wasm: the fetch shim types it and the preflight below checks the
// network copy against the same value (instantiateStreaming wants it exactly).
const WASM_FILE = 'pyodide.asm.wasm', WASM_TYPE = 'application/wasm';
const assetUrl = (file) => new URL(BASE + file, location.href).href;

// ---- fetch shim: serve the parent-handed, SHA-256-checked executables ------
// The kinds of file the parent hands over (the lock, the stdlib zip, the wasm,
// the wheels). Once it has handed any, one of these kinds that it did NOT hand
// is refused rather than fetched: off the shim nothing checks its bytes
// (PT-3272 item 2 — a key under another version's directory used to fall
// through to the network unchecked). A frame booted with no handover at all
// (the worker tests) still fetches, so the wasm preflight below has a path.
const HANDED_KINDS = new Set(['json', 'zip', 'wasm', 'whl']);
function installFetchShim() {
  const types = { wasm: WASM_TYPE, zip: 'application/zip', whl: 'application/octet-stream',
                  json: 'application/json', mjs: 'text/javascript', js: 'text/javascript' };
  const orig = self.fetch.bind(self);
  const handed = Object.keys(ASSETS).length > 0;
  self.fetch = (input, init) => {
    const url = (input instanceof Request) ? input.url : new URL(String(input), location.href).href;
    const buf = ASSETS[url];
    const path = new URL(url).pathname;
    const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
    if (buf) {
      return Promise.resolve(new Response(buf, { status: 200, headers: { 'Content-Type': types[ext] || 'application/octet-stream' } }));
    }
    if (handed && HANDED_KINDS.has(ext)) {
      return Promise.reject(new TypeError(path.slice(path.lastIndexOf('/') + 1).slice(0, 120) + ' was not handed over by the page; not fetched unchecked'));
    }
    return orig(input, init);
  };
}

// ---- wasm Content-Type preflight (PT-3157) ----------------------------------
// The vendored loader (pyodide.js getInstantiateWasmFunc) instantiates with
// WebAssembly.instantiateStreaming, which rejects any Content-Type other than
// exactly application/wasm; the loader only console.warns, loadPyodide never
// settles, and the parent would see nothing but its watchdog timeout. Check the
// header first and fail init with the cause. A parent-handed wasm needs no
// check: the fetch shim serves it as application/wasm. The parent hands the
// wasm on every boot (pymolAssets.ts), so the extra request this check costs
// is paid only off that path, by a frame booted without it (PT-3252 item 4).
async function preflightWasm() {
  const url = assetUrl(WASM_FILE);
  if (ASSETS[url]) return;
  let r;
  try { r = await self.fetch(url); }
  catch (e) {
    // A network, CORS or CSP refusal is a bare "TypeError: Failed to fetch"
    // with no useful stack: name the file it was for.
    throw new Error(WASM_FILE + ' fetch failed: ' + String((e && e.message) || e).slice(0, 200));
  }
  try {
    if (!r.ok) throw new Error(WASM_FILE + ' fetch failed: HTTP ' + r.status);
    const ct = String(r.headers.get('Content-Type') || '').trim();
    if (ct.toLowerCase() !== WASM_TYPE) {
      throw new Error(WASM_FILE + ' is served as Content-Type "' + ct.slice(0, 80) +
                      '"; WebAssembly.instantiateStreaming needs exactly ' + WASM_TYPE);
    }
  } finally {
    // The loader fetches the wasm itself; drop this body instead of reading it.
    try { if (r.body) r.body.cancel().catch(() => {}); } catch (e) {}
  }
}

// ---- the core's ES module (PT-3535) -----------------------------------------
// loadPyodide would import pyodide.asm.mjs (~1.25 MB) itself, from the network:
// the parent does not hand it over (pymolAssets.ts) and the opaque frame keeps
// no HTTP cache. Import it here instead, before the deadline below starts, so
// a slow line spends the parent's BOOT_TIMEOUT_MS on it, not those 60 s.
// loadPyodide takes the factory as createPyodideModule and then imports
// nothing (pyodide.js loadWasmScript).
const CORE_FILE = 'pyodide.asm.mjs';
// The standalone HTML export (frame protocol 4) runs this file from a file://
// page that cannot be fetched from, and its worker loads no script either:
// WebKit refuses the worker a blob: URL it mints itself (a dynamic import
// fails with "Cross-origin script load denied", measured 2026-11-15; the
// iPhone's PyMOL never started). The page builds the worker's one script with the core in it,
// already evaluated as a classic script, which leaves its factory here
// before init. Nothing in the AgDB frame sets it (no message carries it):
// there the core is always imported from the network URL below.
async function importCore() {
  if (typeof self.__AGDB_CORE_FACTORY === 'function') return self.__AGDB_CORE_FACTORY;
  let mod;
  try { mod = await import(assetUrl(CORE_FILE)); }
  catch (e) {
    // Safari's "Importing a module script failed." names no file.
    throw new Error(CORE_FILE + ' import failed: ' + String((e && e.message) || e).slice(0, 200));
  }
  if (typeof (mod && mod.default) !== 'function') throw new Error(CORE_FILE + ' has no default export to boot from');
  return mod.default;
}

// ---- loadPyodide deadline (PT-3252 item 1) ----------------------------------
// The same console.warn swallows EVERY instantiateStreaming failure, not only a
// wrong Content-Type: a CompileError (a corrupt or cut wasm), a LinkError
// (pyodide.asm.mjs of another version), an out-of-memory on a small device.
// None reaches the hooks above, and loadPyodide never settles. Fail init with a
// pointer to the console instead of leaving the parent its BOOT_TIMEOUT_MS
// (120 s) of silence. What the deadline times is all from memory: the wasm,
// the stdlib and the lock are handed over (pymolAssets.ts) and the core module
// is already imported (importCore), so it is the wasm compile and Python's
// start-up. Measured: the whole first boot draws in 4.4 s with the network
// transfer included (ADR-0049 KT4), so 60 s is over 10x that and still well
// inside the parent's deadline. The text avoids FATAL_RE's words: the parent
// ends a boot on any error before ready, fatal or not.
const LOAD_PYODIDE_TIMEOUT_MS = 60000;
function loadPyodideWithDeadline(opts) {
  let timer = null;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(
      'loadPyodide did not settle in ' + (LOAD_PYODIDE_TIMEOUT_MS / 1000) + ' s; see the console for ' +
      '"wasm instantiation failed" (a corrupt or cut wasm, a pyodide.asm.mjs of another version, or too little memory)')),
      LOAD_PYODIDE_TIMEOUT_MS);
  });
  return Promise.race([self.loadPyodide(opts), deadline]).finally(() => clearTimeout(timer));
}

const SITE_PACKAGES = '/lib/python3.14/site-packages';

// ---- numpy, unpacked at its first import (S2-2 (2), PT-9554) ----------------
// Nothing the boot runs imports numpy, and no menu or dialog reaches it: only
// cmd.get_coords and its kin, fnab, a session holding numpy arrays and a
// member's own `import numpy` do (evidence §3.22). The lock makes pymol
// depend on it, so loadPackage unpacked the numpy wheel and instantiated its
// side modules at every boot (0.13-0.18 s, and a wasm heap one step larger at
// ready). Here the parsed lock's pymol entry drops that dependency for this
// boot only — in memory: the file's bytes are what the parent checked —, the
// handed numpy wheel is kept, and a meta-path finder (NUMPY_PY) unpacks it
// into site-packages at the first import of numpy or of any numpy.*; Python's
// own import then loads each extension module synchronously (dlopen). With
// no numpy wheel handed over (a frame booted without a handover) or a lock
// not shaped as expected, numpy loads with pymol as before.
let NUMPY_WHEEL = null;
function deferNumpy() {
  const pkgs = py.lockfile && py.lockfile.packages;
  const pm = pkgs && pkgs.pymol, np = pkgs && pkgs.numpy;
  if (!pm || !np || !Array.isArray(pm.depends) || !pm.depends.includes('numpy') || typeof np.file_name !== 'string') return false;
  const buf = ASSETS[assetUrl(np.file_name)];
  if (!buf) return false;
  NUMPY_WHEEL = buf;
  pm.depends = pm.depends.filter((d) => d !== 'numpy');
  return true;
}
function unpackNumpy() {
  if (!NUMPY_WHEEL) throw new Error('the numpy wheel is no longer held');
  py.unpackArchive(NUMPY_WHEEL, 'wheel', { extractDir: SITE_PACKAGES });
  NUMPY_WHEEL = null;   // MEMFS holds it now
}
// The finder steps aside once the wheel is unpacked (the path finder takes it
// from there). Until an unpack succeeds it stays on: a failed one raises an
// ImportError that says why, and the next import tries again, rather than
// leave every later import a bare ModuleNotFoundError (evidence §6.2).
const NUMPY_PY = String.raw`
import sys as _agdb_nsys, importlib as _agdb_nil
import _agdb_numpy
class _AgdbNumpyFinder:
    done = False
    @classmethod
    def find_spec(cls, name, path=None, target=None):
        if cls.done or (name != 'numpy' and not name.startswith('numpy.')):
            return None
        try:
            _agdb_numpy.unpack()
        except Exception as e:
            raise ImportError('numpy could not be unpacked: ' + (str(e)[:300] or type(e).__name__), name=name) from None
        cls.done = True
        _agdb_nil.invalidate_caches()
        return None
_agdb_nsys.meta_path.insert(0, _AgdbNumpyFinder)
`;

// loadPackage instantiated every .so of the wheels it loaded by name and
// import pymol has run, so their MEMFS copies are never read again: length 0,
// not unlink (a reload or a re-import looks the file up). A numpy unpacked
// later at its first import keeps its own: Python loads each of them when it
// first imports that module.
function truncateSideModules() {
  const FS = py.FS;
  const walk = (d) => {
    for (const n of FS.readdir(d)) {
      if (n === '.' || n === '..') continue;
      const p = d + '/' + n, st = FS.stat(p);
      if (FS.isDir(st.mode)) walk(p); else if (n.endsWith('.so')) FS.truncate(p, 0);
    }
  };
  try { walk(SITE_PACKAGES); } catch (e) { log('truncate .so: ' + e); }
}

function makeGL(canvas) {
  const M = py._module;
  for (const v of [2, 1]) {
    const attrs = { majorVersion: v, minorVersion: 0, alpha: false, depth: true, stencil: true,
                    antialias: false, premultipliedAlpha: true, preserveDrawingBuffer: false,
                    enableExtensionsByDefault: true };
    const h = M.GL.createContext(canvas, attrs);
    if (h) { M.GL.makeContextCurrent(h); WEBGL = v; GLC = M.GL.currentContext.GLctx; return true; }
  }
  return false;
}

// ---- §4.2-6: load-format refusal at every path cmd.load does not cover -----
// The restricted unpickler (patch 0006) already guards the pickle BYTES; this
// guards the FILE path, which reaches the UNrestricted chempy cPickle.load /
// pickle._load that patch 0006 leaves for the bundled trusted data. cc1 and
// the script formats (py/pml) are refused here too (PT-2891 1a): cc1 reads a
// file this viewer never needs, and py/pml would run arbitrary code.
const HARDEN_PY = String.raw`
import pickle, chempy.pkl as _ck
import pymol, pymol.internal as _pin
from pymol import cmd as _cmd
from pymol.constants import loadable as _loadable

# The wheel (patch 0006) must have installed the restricted unpickler on import
# pymol; refuse to run if it did not, rather than serve an unguarded session.
assert pickle.loads is _ck.restricted_loads, 'restricted unpickler not active'
assert pickle._loads is _ck.restricted_loads, 'restricted unpickler not active (_loads)'

_BLOCKED_FORMATS = {'pkl', 'model', 'brick', 'callback', 'cgo', 'cc1', 'cc2',
                    'py', 'pml', 'pym'}
# Extensions that reach a pickle file path or a script runner. filename_to_format
# strips .gz/.bz2 first, so the bare stems below cover the compressed variants.
_BLOCKED_EXT = ('.pkl', '.pkla', '.pickle', '.model', '.brick',
                '.cc1', '.cc2', '.py', '.pml', '.pym')

def _ext_is_blocked(fn):
    base = str(fn).lower().strip().split('/')[-1].split('\\')[-1]
    if base.endswith('.gz') or base.endswith('.bz2'):
        base = base.rsplit('.', 1)[0]
    return any(base.endswith(e) for e in _BLOCKED_EXT)

# cmd.load takes the format as a number too (int(format) first, the way
# importing.load reads it), and 8/10/12/13 are model/brick/callback/cgo. Map a
# number back to its loadable name before the name check (PT-4153), so guards
# (1) and (2) refuse it and guard (4) is not the only stop.
def _fmt_is_blocked(fmt):
    try:
        name = _loadable._reverse_lookup(int(fmt))
    except (TypeError, ValueError):
        name = str(fmt or '')
    return name.lower().strip() in _BLOCKED_FORMATS

# (1) cmd.load: keyword OR positional format, and the blocked extensions, through
#     any calling convention.
_orig_load = _cmd.load
def _guarded_load(filename='', object='', state=0, format='', *a, **kw):
    fmt = kw.get('format', format)
    if _fmt_is_blocked(fmt) or _ext_is_blocked(filename):
        raise pymol.CmdException('load of this format is refused by the AgDB viewer')
    return _orig_load(filename, object, state, format, *a, **kw)
_cmd.load = _guarded_load
pymol.cmd.load = _guarded_load
# (2) cmd.do('load ...') resolves through the keyword table captured at import
#     (keywords.py); cmd.extend rebinds that entry so the command line is guarded.
_cmd.extend('load', _guarded_load)

# (3) cmd.load_raw(content, 'model'/'pkl'/'brick'): the pickle path with no
#     filename to sniff.
_orig_load_raw = _cmd.load_raw
def _guarded_load_raw(content, format, object='', *a, **kw):
    if _fmt_is_blocked(format):
        raise pymol.CmdException('load_raw of this format is refused by the AgDB viewer')
    return _orig_load_raw(content, format, object, *a, **kw)
_cmd.load_raw = _guarded_load_raw
pymol.cmd.load_raw = _guarded_load_raw

# (4) data-driven backstop: pymol.importing.load routes every format not in
#     loadfunctions (incl 'model') to pymol.internal._load, whose model/brick
#     branch does chempy.io.pkl.fromFile = the unrestricted pickle._load. Refuse
#     those ftypes however execution arrived (e.g. pymol.importing.load called
#     directly). _load2str text formats are unaffected.
_orig_internal_load = _pin._load
def _guarded_internal_load(oname, finfo, state, ftype, *a, **kw):
    if int(ftype) in (int(_loadable.model), int(_loadable.brick),
                      int(_loadable.callback), int(_loadable.cgo)):
        raise pymol.CmdException('internal load of pickle object type %d refused' % int(ftype))
    return _orig_internal_load(oname, finfo, state, ftype, *a, **kw)
# pymol.importing.load reads its loader's signature and hands a **kwargs
# loader EVERY argument it knows (filename, fname, object, ...), which the real
# _load does not take: without this line every format routed through _load
# (cif, sdf, mol2, the maps) failed with "_load() got an unexpected keyword
# argument 'filename'" (measured on this runtime, relay 2 step 4). The wrapper
# keeps _load's own signature, so it receives exactly what _load would.
import inspect as _inspect
_guarded_internal_load.__signature__ = _inspect.signature(_orig_internal_load)
_pin._load = _guarded_internal_load

def _allow_count():
    return len(_ck.RESTRICTED_GLOBALS)

# The names themselves, sorted, one 'module.name' a line: the parent compares
# them with its pinned list (pymolFrameProtocol.ts EXPECTED_ALLOW_LIST), so a
# list that keeps the count but swaps a name stops the page too (PT-3272 item 3).
def _allow_list():
    return '\n'.join(sorted(m + '.' + n for m, n in _ck.RESTRICTED_GLOBALS))
`;

const START_PY = (w, h, gui) => String.raw`
import pymol, pymol.invocation, pymol2
pymol.invocation.parse_args(['pymol', '-q'])
_o = pymol.invocation.options
_o.external_gui = 0; _o.show_splash = 0; _o.internal_gui = ${gui}; _o.internal_feedback = ${gui}; _o.no_quit = 1
_inst = pymol2.SingletonPyMOL(); _inst.start()
from pymol import cmd
_inst.reshape(${w}, ${h}, True)
# Whether this tick draws; the tick drains and sets the viewport just
# before it calls _inst.draw(). What idle() ran — a command PyMOL had
# queued (its own command line, a pick in its menus), a movie frame's
# commands — may have changed grid_mode, so defer_builds_mode follows
# before that draw (GL_PY, S2-5). Defined in
# GL_PY, which runs before the first tick.
# The page's steady turn (the standalone page's 「回転」, AgDB 2026-11-21):
# degrees a second about the screen's y axis, 0 for none. Each frame turns
# by the time since the last, at most 0.1 s of it (a stalled or hidden tab
# does not jump). PyMOL's own rock swings back and forth; this turns on, and
# touches no movie. The page calls it as /_agdb_spin_set(...) (pymol_names).
import time as _agdb_time
_agdb_spin = [0.0, None]
def _agdb_spin_set(_rate):
    _agdb_spin[0] = max(-720.0, min(720.0, float(_rate)))
    _agdb_spin[1] = None
cmd._pymol._agdb_spin_set = _agdb_spin_set
# The page's rock (the standalone page's 「左右に揺らす」): PyMOL's own rock,
# side to side (sweep_mode 0) at 0.75 × the speed. The member's own
# sweep_mode and sweep_speed are kept and put back once the rock stops —
# by the page, PyMOL's ■, its menu or the command line (_agdb_rock_follow,
# read with the panel's layout) — so neither a session saved after it nor
# the member's next rock carries the page's (PR #10151's review, PT-10647).
# Only while the sweep settings are still the ones the page set: a session
# loaded or reinitialized meanwhile has its own, which stay (PR #10172's
# review).
_agdb_rock = [0.0, None, None]
def _agdb_rock_set(_speed):
    _speed = max(0.0, min(8.0, float(_speed)))
    if _speed > 0:
        if _agdb_rock[1] is None or _agdb_rock_mine() is False:
            _agdb_rock[1] = (cmd.get_setting_int('sweep_mode'), cmd.get_setting_float('sweep_speed'))
        cmd.set('sweep_mode', 0, quiet=1)
        cmd.set('sweep_speed', 0.75 * _speed, quiet=1)
        _agdb_rock[0] = _speed
        _agdb_rock[2] = (0, cmd.get_setting_float('sweep_speed'))
        cmd.rock(1)
    else:
        cmd.rock(0)
        _agdb_rock_follow(False)
# Whether the sweep settings are the page's (None: the page set none).
def _agdb_rock_mine():
    if _agdb_rock[2] is None:
        return None
    return (cmd.get_setting_int('sweep_mode'), cmd.get_setting_float('sweep_speed')) == _agdb_rock[2]
# The rock as it is now: the page's speed while the page's rock runs, else
# 0 — and the member's settings back once it has stopped, if they are still
# the page's.
def _agdb_rock_follow(_on):
    if _on and _agdb_rock_mine() is False:
        _agdb_rock[0] = 0.0
        _agdb_rock[1] = None
        _agdb_rock[2] = None
    if not _on and _agdb_rock[1] is not None:
        _m, _sp = _agdb_rock[1]
        if _agdb_rock_mine():
            cmd.set('sweep_mode', _m, quiet=1)
            cmd.set('sweep_speed', _sp, quiet=1)
        _agdb_rock[1] = None
        _agdb_rock[2] = None
    if not _on:
        _agdb_rock[0] = 0.0
    return _agdb_rock[0]
# After File > Reinitialize (the page's start settings again): no turn, and
# nothing of a rock to put back on the new session.
# A session restored (a .pse opened, the page's snapshot back) brings its own
# sweep settings: the page's rock is forgotten outright, never judged by
# whether the session's values happen to equal the page's (PR #10172's
# review, round 2).
def _agdb_rock_forget():
    _agdb_rock[0] = 0.0
    _agdb_rock[1] = None
    _agdb_rock[2] = None
def _agdb_motion_reset():
    _agdb_spin_set(0)
    _agdb_rock_forget()
cmd._pymol._agdb_rock_set = _agdb_rock_set
cmd._pymol._agdb_motion_reset = _agdb_motion_reset
def _frame():
    _turned = 0
    if _agdb_spin[0]:
        _t = _agdb_time.monotonic()
        if _agdb_spin[1] is not None:
            cmd.turn('y', _agdb_spin[0] * min(0.1, _t - _agdb_spin[1]))
            _turned = 1
        _agdb_spin[1] = _t
    if _inst.idle():
        _agdb_defer_follow()
        return 1
    return 1 if _turned or _inst.getRedisplay() else 0
`;

// ---- restore a session (own or foreign) through the restricted loader ------
// Foreign sessions (restoreSnapshot / a shared .pse) drop wizard + movie BEFORE
// set_session: a nested wizard pickle is a real RCE vector and a movie command
// (mdo) can run python on playback. A load() of a .pse is always treated as
// foreign; the restricted unpickler guards the bytes either way.
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
    # The session brings its own sweep settings: the page's rock is forgotten — only now, once
    # it has been read (a file that could not be read changes nothing; PR #10244's review).
    _agdb_rock_forget()
    cmd.set_session(sess, quiet=1)
    cmd.mstop()
    _atoms = cmd.count_atoms('all')
except Exception as e:
    _err = type(e).__name__ + ': ' + str(e)
# After the session's settings, failed restore or not (GL_PY).
_agdb_gl_defaults()
json.dumps({'err': _err, 'atoms': _atoms, 'names': cmd.get_names()})
`;

// ---- the settings WebGL needs to draw what desktop PyMOL draws -------------
// trilines: with it off, PyMOL draws `lines` (and the nonbonded crosses) as
// GL_LINES through its line shader, which under WebGL draws NOTHING — 0
// non-black pixels in Chrome on SwiftShader and on a GPU, Windows Chrome and
// iPhone Edge alike (owner report 2026-11-16, measured). With it on, PyMOL
// draws each line as two triangles (its trilines shader), as desktop PyMOL
// does under a core GL profile, and line_width works (WebGL clamps a GL_LINES
// width to 1). Set at boot, and again after whatever puts every setting back:
// a session restore (set_session takes the session's own value, 0 in a .pse
// from desktop PyMOL or from before this fix) and `reinitialize` (back to
// PyMOL's default, 0). A member's own `set trilines, 0` stands until then.
//
// cgo_shader_ub_color (design 2026-11-16 §3.2 "S1 の追加候補", PT-9554 S2):
// each vertex colour of a CGO (cartoon, sphere impostors, CGO objects,
// surfaces) goes to the GPU as 4 bytes instead of 4 floats: 21-25 % less
// vertex memory (evidence §3.41); every picture of the render matrix within
// 1/255 of before (surfaces, dots and mesh; the cartoon alone identical),
// and with it a member's own `cgo_shader_ub_normal 1` no longer loses the
// cartoon and the opaque surface (WebGL refused their vertex layout with
// 0x0502; now drawn as without the setting, within 14/255; measured on this
// runtime, PT-9554 S2). PyMOL keeps it out of a .pse (session blacklist)
// and puts it back to 0 on a restore and on reinitialize, as it does
// trilines, so it is set in the same place. cgo_shader_ub_normal is not
// set: alone it leaves the cartoon out on WebGL.
//
// defer_builds_mode (S2-5): PyMOL's default 0 builds every state of an
// object at once — showing a surface on a 116-model NMR entry took 24.5 s
// where 1 builds only the state on screen, 0.66 s (evidence §3.25), and a
// state shown later is built when it first comes up. 1 is the frame's
// value but in a grid by state (_agdb_defer_want): grid_mode 2 / 3 (Grid >
// By State / By Object-State) draws every state at once, and under 1 all
// cells but the current state's stay empty, so it is 0 there, as PyMOL's
// default — unless an object of auto_defer_builds (500) states or more is
// loaded (_agdb_defer_raised). PyMOL itself raises a 0 to 1 when such an
// object arrives (ExecutiveManageObject; measured on this runtime), so
// desktop PyMOL holds 1 for it in a grid by state too, whichever came
// first, the object or the grid; the frame does the same in either order
// rather than build every one of those states at once (PT-9670). grid_mode
// is looked at after every task, click or key and after idle work
// (_frame), before the draw, and the setting follows when it moved. A
// value the frame did not set (a member's own `set defer_builds_mode`,
// PyMOL's own raise) stands until a restore or reinitialize, as trilines
// does. Unlike the others the setting IS kept in a .pse: _agdb_defer_save
// writes the frame's own 1 as PyMOL's default 0 unless such an object is
// loaded, which is the value desktop PyMOL would have saved, so desktop
// PyMOL opening a session saved here draws its grid by state as it would
// its own.
const GL_PY = String.raw`
import sys as _agdb_sys
import pymol.commanding as _agdb_cm
import pymol.setting as _agdb_st

# The value of defer_builds_mode this frame last set, or None; grid_mode
# when the setting was last looked at.
_agdb_defer_mine = None
_agdb_defer_grid = None
_agdb_defer_err = None
_AGDB_DEFER_INDEX = _agdb_st._get_index('defer_builds_mode')

def _agdb_defer_raised():
    # PyMOL's own auto_defer_builds rule (Executive.cpp ExecutiveManageObject):
    # a load of an object with that many states or more raises a 0 to 1.
    # count_states('all') is the most states of any object, of any type.
    limit = cmd.get_setting_int('auto_defer_builds')
    return limit >= 0 and bool(cmd.get_names('objects')) and cmd.count_states('all') >= limit

def _agdb_defer_want():
    if cmd.get_setting_int('grid_mode') not in (2, 3):
        return 1
    return 1 if _agdb_defer_raised() else 0

def _agdb_defer_sync(claim=False):
    # claim: take the setting over whoever set it (boot, restore, reinitialize).
    global _agdb_defer_mine, _agdb_defer_grid
    _agdb_defer_grid = cmd.get_setting_int('grid_mode')
    cur = cmd.get_setting_int('defer_builds_mode')
    if not claim and cur != _agdb_defer_mine:
        return
    want = _agdb_defer_want()
    if want != cur:
        cmd.set('defer_builds_mode', want, quiet=1)
    _agdb_defer_mine = want

def _agdb_defer_follow():
    # The tick's call, also on every frame of a rock or a sculpt (idle() did
    # work): one read while grid_mode, the one input of the frame's value,
    # has not moved since the last look (a full sync there cost the 1AON
    # rock about 0.05 ms a frame, measured). A failure is said once on
    # stderr, and drawing goes on.
    global _agdb_defer_err
    try:
        if cmd.get_setting_int('grid_mode') == _agdb_defer_grid:
            return
        _agdb_defer_sync()
    except Exception as e:
        m = 'defer_builds_mode: %s: %s' % (type(e).__name__, str(e)[:200])
        if m != _agdb_defer_err:
            _agdb_defer_err = m
            print(m, file=_agdb_sys.stderr)

# A session-save task (pymol.exporting.get_session runs them on the session
# dict, after PyMOL wrote its settings as [index, type, value] lists).
def _agdb_defer_save(session, *, _self=cmd):
    if _agdb_defer_mine == 1 and not _agdb_defer_raised():
        for e in session.get('settings') or ():
            if e and e[0] == _AGDB_DEFER_INDEX and e[2] == 1:
                e[2] = 0
    return 1
cmd._pymol._session_save_tasks.append(_agdb_defer_save)

def _agdb_gl_defaults():
    cmd.set('trilines', 1, quiet=1)
    if cmd.get_setting_int('cgo_shader_ub_color') != 1:
        cmd.set('cgo_shader_ub_color', 1, quiet=1)
    _agdb_defer_sync(True)

# reinitialize everything / settings / original_settings put the settings back;
# store_defaults and purge_defaults leave them as they are. Rebound for
# cmd.reinitialize (the menu's "/cmd.reinitialize()") and, through cmd.extend,
# for the command line's keyword table (captured at import, as HARDEN_PY's load).
_agdb_orig_reinitialize = cmd.reinitialize
def _agdb_reinitialize(what='everything', object='', *a, **kw):
    r = _agdb_orig_reinitialize(what, object, *a, **kw)
    if _agdb_cm.reinit_code[_agdb_cm.reinit_sc.auto_err(str(what), 'option')] in (0, 1, 3):
        _agdb_gl_defaults()
    return r
cmd.reinitialize = _agdb_reinitialize
cmd.extend('reinitialize', _agdb_reinitialize)
`;

// ---- molecule export (PT-3615, ADR-0049 注 5) --------------------------------
// The parent asks for one PDB or SDF file of a selection. The selection arrives
// as a JSON string literal in the call below — Python data, never code and
// never a command line. An unknown or empty selection is an error, not an
// empty file: the parent says why instead of saving nothing. The atoms are
// counted in the state the file is written from, the current one, so a
// selection with no coordinates there is "no atoms", not an empty file; and a
// save that raises answers with its own line, not a traceback cut at its head
// (PT-3816 items 6, 7).
const EXPORT_PY = String.raw`
import json as _json
def _agdb_export_mol(sel, fmt, path):
    try:
        n = cmd.count_atoms(sel, state=-1)
    except Exception as e:
        return _json.dumps({'err': 'export: invalid selection: ' + str(e)[:200]})
    if n is None or n < 0:
        return _json.dumps({'err': 'export: invalid selection'})
    if n == 0:
        return _json.dumps({'err': 'export: no atoms in the selection'})
    try:
        cmd.save(path, sel, -1, fmt)
    except Exception as e:
        return _json.dumps({'err': 'export: could not write the file: ' + (str(e) or type(e).__name__)[:200]})
    return _json.dumps({'err': None, 'atoms': n})
`;
// PyMOL's own text formats the page offers (pymolFrameProtocol.ts MOL_FORMATS; mmCIF and MOL2 since 2026-11-14).
const MOL_FORMATS = new Set(['pdb', 'cif', 'sdf', 'mol2']);
const SELECTION_MAX = 1000;
// The parent's cap on a molecule file (pymolFrameProtocol.ts LIMITS.molBytes):
// a larger one is refused here before it is read, copied and posted, with the
// text the parent already reads as too large (PT-3816 item 8).
const MOL_MAX = 32 * MiB;
// The parent's cap on a session (pymolFrameProtocol.ts LIMITS.pseBytes), refused
// here before the file is read, copied and posted, as MOL_MAX is (PT-9127
// item 2); the offline HTML file's bridge gets the same bound.
const PSE_MAX = 25 * MiB;

// ---- the scene's look as data (frame protocol 4, the standalone HTML export) --
// exportLook writes what the scene looks like as JSON DATA — never a session,
// never a pickle (PT-3031: a .pse is not offered): per molecule object its
// current state as mmCIF written by PyMOL, each atom's colour (0xRRGGBB) and
// representation bitmask in the order the atoms appear in that mmCIF, and the
// allow-listed settings below; plus the view and the background. applyLook
// (sent only by the standalone page; host.js never forwards it) reads that
// JSON with json.loads, checks every field, and rebuilds the scene with fixed
// calls — no string from the data is ever run as code or as a command line,
// a setting is set only when its NAME is in this allow-list, every number is
// finite and every colour 0..0xFFFFFF. `pymolLook.ts` is the page-side copy of
// the format and of these limits; `pymolLook.test.ts` holds the two equal.
//
// Atom order: the mmCIF writer and iterate_state both walk the object's atoms
// in index order, but that is PyMOL's behaviour, not a promise, so the export
// proves it for every object: it reads the written text back into a hidden
// object with retain_order=1 (file order kept) and compares atom by atom (name,
// residue, chain, element, coordinates) with the arrays; any difference is an
// error, never a file with shifted colours. The same check holds the written
// `_atom_site.id` to i + 1 for the i-th atom, so a viewer may key on it.
// applyLook loads with retain_order=1 and checks the atom count, so index i is
// the i-th atom of the text.
//
// Secondary structure: PyMOL's mmCIF writer leaves out helices and strands, and
// a reload would run dss and draw a different cartoon, so the export appends
// _struct_conf / _struct_sheet_range loops built from each residue's ss (its
// CA's: dss marks no other atom), insertion codes included, and applyLook
// loads with auto_dss=0. PyMOL's reader matches no run to a residue whose
// chain is blank (an old PDB file, a structure built in PyMOL), so for such
// an object applyLook reads the loops back itself and sets each atom's ss
// (PT-9210). (3Dmol.js's text CIF parser does not read these
// loops: it assigns secondary structure itself.)
//
// Settings carried (LOOK_SETTINGS; numbers, or [r,g,b] 0..1 for the colour
// ones): global values, and per object the values that differ from the global
// one. A colour setting's "default" value -1 — the atoms' own colours — is
// never carried globally (it is the default); an object that keeps it under a
// fixed global colour carries -1, which applyLook sets back as `default`
// (PT-9090 item 2).
// Atom-level settings, labels' text, measurements, maps, meshes, CGOs and
// groups are not carried; non-molecule objects are listed in `skipped`.
const LOOK_NUM_SETTINGS = ['cartoon_transparency', 'transparency', 'sphere_transparency', 'stick_transparency',
  'stick_radius', 'sphere_scale', 'line_width', 'valence', 'cartoon_tube_radius', 'cartoon_loop_radius',
  'cartoon_fancy_helices', 'cartoon_cylindrical_helices', 'cartoon_flat_sheets', 'cartoon_side_chain_helper',
  'surface_quality', 'ambient', 'specular', 'depth_cue', 'fog', 'orthoscopic', 'field_of_view'];
const LOOK_COLOR_SETTINGS = ['cartoon_color', 'stick_color', 'sphere_color', 'surface_color'];
// The page's cap on a look (pymolFrameProtocol.ts LIMITS.lookBytes), refused
// here before the file is read, as MOL_MAX is.
const LOOK_MAX = 64 * MiB;
// A real ArrayBuffer's length, by the engine's own brand check (no getter of
// the value runs; a view or anything else is -1).
const AB_LENGTH = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength').get;
const bufferLength = (v) => { try { return AB_LENGTH.call(v); } catch (e) { return -1; } };
const LOOK_PY = String.raw`
import json as _lj, math as _lm, re as _lre
_LOOK_NUM = ${JSON.stringify(LOOK_NUM_SETTINGS)}
_LOOK_COLOR = ${JSON.stringify(LOOK_COLOR_SETTINGS)}
_LOOK_NUM_SET = frozenset(_LOOK_NUM); _LOOK_COLOR_SET = frozenset(_LOOK_COLOR)
_LOOK_NAME = _lre.compile(r'[A-Za-z0-9_]{1,64}\Z')
# A chain, residue or atom name that is a JavaScript object's own key (PT-9089
# item 3): the standalone page hands the same mmCIF to 3Dmol.js, whose parser
# keys plain objects by these names. pymolLook.ts refuses the same tokens.
_LOOK_BAD_ID = _lre.compile(r'''(?:^|[\s'"])(?:__proto__|constructor|prototype)(?=$|[\s'"])''', _lre.M)
_LOOK_MAX_OBJECTS = 256; _LOOK_MAX_SKIPPED = 256; _LOOK_MAX_ATOMS = 2000000
_LOOK_REPS_MAX = 0x1FFFFF; _LOOK_SETTING_ABS = 1e6
_LOOK_TRGB = 0x40000000

def _look_rgb(idx, cache):
    # 0xRRGGBB of a PyMOL colour index, or None when it names no fixed colour.
    if idx in cache: return cache[idx]
    v = None
    try:
        t = cmd.get_color_tuple(idx)
        if t and len(t) == 3:
            v = 0
            for c in t: v = (v << 8) | int(round(min(1.0, max(0.0, float(c))) * 255))
    except Exception:
        v = None
    cache[idx] = v
    return v

def _look_setting(name, obj, cache, keep_default=False):
    # A setting as carried: a number, [r, g, b] for a colour, or None (not
    # carried). keep_default: a colour left at -1 (the atoms' own) is -1.
    t, vals = cmd.get_setting_tuple(name, obj)
    if name in _LOOK_COLOR_SET:
        idx = int(vals[0])
        if idx == -1 and keep_default: return -1
        if idx < 0: return None
        rgb = _look_rgb(idx, cache)
        if rgb is None: return None
        return [round(((rgb >> s) & 255) / 255.0, 4) for s in (16, 8, 0)]
    v = vals[0]
    if isinstance(v, float):
        return round(v, 6) if _lm.isfinite(v) else None
    return int(v)

def _look_clean_name(name, used):
    base = (_lre.sub(r'[^A-Za-z0-9_]', '_', str(name)) or 'obj')[:64]
    out = base; k = 2
    while out in used:
        suffix = '_%d' % k; out = base[:64 - len(suffix)] + suffix; k += 1
    used.add(out)
    return out

def _look_cif_value(v):
    v = str(v)
    if v == '': return '.'
    if _lre.match(r'[^\s_#$\'";\[\]][^\s]*\Z', v) and v not in ('.', '?'): return v
    return ("'%s'" % v) if "'" not in v else ('"%s"' % v)

class _LookRes:
    # One residue of _look_ss_loops: its name, its insertion code, and the ss
    # of its first CA that has one, else of its first other atom that has one.
    __slots__ = ('resn', 'ins', 'ca_ss', 'any_ss')
    def __init__(self, resn, ins):
        self.resn = resn; self.ins = ins; self.ca_ss = ''; self.any_ss = ''

def _look_ss_loops(rows):
    # Residue runs of helix (H) and strand (S), as mmCIF loops.
    # A residue's ss is its CA's: dss (a predicted model, any file without
    # HELIX/SHEET records) marks only the CA, so the residue's first atom (N)
    # has none, and reading that one dropped every helix and strand (owner
    # report 2026-11-14). The first CA with an ss counts (an alt-loc's second
    # CA may be the one marked); with none, the first other atom that has one
    # (a hand-made alter on some atoms; PT-9148 item 2, PT-9149 item 2).
    # Residues are taken in the order their first atom comes — a residue whose
    # atoms are not together (retain_order, an unsorted create) is still one
    # residue (PT-9149 item 1) — and keyed by segi, chain, resv and resi, the
    # last carrying the insertion code, which the loops write too (82A..82C is
    # not 82..82; PT-9148 item 1). The label columns hold segi and resv, as the
    # _atom_site rows PyMOL's own writer puts above them do (its label_asym_id
    # is segi and its label_seq_id resv): the loops name residues the way that
    # text does (PT-9149 item 3).
    res = {}
    for r in rows:
        color, reps, segi, chain, resv, resi, resn, name, ss = r[:9]
        e = res.get((segi, chain, resv, resi))
        if e is None:
            m = _lre.match(r'-?\d+(.*)\Z', str(resi))
            e = res[(segi, chain, resv, resi)] = _LookRes(resn, m.group(1) if m else '')
        if not ss: continue
        if name == 'CA':
            if not e.ca_ss: e.ca_ss = ss
        elif not e.any_ss: e.any_ss = ss
    runs = []; cur = None
    for key, e in res.items():
        ss = e.ca_ss or e.any_ss
        if cur is not None and ss == cur['ss'] and key[:2] == cur['beg'][0][:2]:
            cur['end'] = (key, e); continue
        if cur is not None and cur['ss'] in ('H', 'S'): runs.append(cur)
        cur = {'ss': ss, 'beg': (key, e), 'end': (key, e)}
    if cur is not None and cur['ss'] in ('H', 'S'): runs.append(cur)
    out = []
    for kind, cat, typ in (('H', '_struct_conf', 'HELX_P'), ('S', '_struct_sheet_range', None)):
        sel = [x for x in runs if x['ss'] == kind]
        if not sel: continue
        cols = (['conf_type_id'] if typ else ['sheet_id']) + ['id', 'beg_label_comp_id', 'beg_label_asym_id', 'beg_label_seq_id',
                'end_label_comp_id', 'end_label_asym_id', 'end_label_seq_id', 'beg_auth_asym_id', 'beg_auth_seq_id',
                'end_auth_asym_id', 'end_auth_seq_id', 'pdbx_beg_PDB_ins_code', 'pdbx_end_PDB_ins_code']
        out.append('loop_')
        out.extend(cat + '.' + c for c in cols)
        for i, x in enumerate(sel, 1):
            (b, be), (e, ee) = x['beg'], x['end']
            vals = ([typ, typ + str(i)] if typ else ['S%d' % i, '1']) + [be.resn, b[0], b[2], ee.resn, e[0], e[2], b[1], b[2], e[1], e[2]]
            # A blank insertion code is '?' (unknown), never the quoted text.
            out.append(' '.join([_look_cif_value(v) for v in vals] + [_look_cif_value(be.ins) if be.ins else '?', _look_cif_value(ee.ins) if ee.ins else '?']))
        out.append('#')
    return '\n'.join(out) + '\n' if out else ''

# A loop value as _look_cif_value writes it: quoted (no escapes, closed before
# a blank), or a bare word.
_LOOK_SS_TOKEN = _lre.compile(r'''\'[^\']*\'(?=\s|$)|"[^"]*"(?=\s|$)|\S+''')

def _look_ss_value(v):
    if len(v) >= 2 and v[0] == v[-1] and v[0] in ('"', "'"): return v[1:-1]
    return '' if v in ('.', '?') else v

def _look_ss_runs(text):
    # The helix and strand runs of the loops _look_ss_loops appended to an
    # object's text, read back: [(ss, (segi, chain, resi) begin, (segi, chain,
    # resi) end)], resi carrying the insertion code. segi is the label asym id
    # as _look_ss_loops writes it (PT-9236 item 1): a bare '.' is the blank
    # one, a quoted '.' or '?' a segment named so (PT-9303 item 3). Only
    # the last loop of each category (the appended one); a row that does not
    # fit its columns is skipped.
    runs = []
    for ss, cat in (('H', '_struct_conf'), ('S', '_struct_sheet_range')):
        at = text.rfind('loop_\n' + cat + '.')
        if at < 0: continue
        cols = []; rows = []
        for line in text[at:].split('\n')[1:]:
            if line.startswith(cat + '.'):
                cols.append(line[len(cat) + 1:].strip()); continue
            if not line or line.startswith(('#', 'loop_', '_', 'data_')): break
            vals = [_look_ss_value(v) for v in _LOOK_SS_TOKEN.findall(line)]
            if len(vals) == len(cols): rows.append(dict(zip(cols, vals)))
        for r in rows:
            try:
                b = (r['beg_label_asym_id'], r['beg_auth_asym_id'], r['beg_auth_seq_id'] + r.get('pdbx_beg_PDB_ins_code', ''))
                e = (r['end_label_asym_id'], r['end_auth_asym_id'], r['end_auth_seq_id'] + r.get('pdbx_end_PDB_ins_code', ''))
            except KeyError:
                continue
            runs.append((ss, b, e))
    return runs

def _look_ss_of(text, atoms):
    # Each atom's ss from the object's own loops, for an object PyMOL's mmCIF
    # reader matched no run of: one whose chain is blank, where no spelling of
    # a blank asym id ('.', '?', '', ' ') finds its residues (PT-9210). atoms:
    # (segi, chain, resi) in the object's order. Residues are taken in the
    # order their first atom comes, as _look_ss_loops writes them, and a run is
    # matched by segi, chain and resi (the loops' label asym id and auth
    # columns), so two segments that share a blank chain and their numbering
    # each keep their own runs (PT-9236 item 1). A run covers its begin residue
    # up to its end residue, both in one segment and chain; it stops at a
    # residue of another segment or chain, or one an earlier run took, so no
    # run spills over and each residue is walked at most once whatever the
    # look's text says (a crafted file; PT-9237 item 2).
    runs = _look_ss_runs(text)
    if not runs: return None
    # Segments are compared as written: PyMOL's mmCIF reader gives a bare '.'
    # or '?' back as '' and a quoted one as itself, and its writer quotes a
    # literal one (measured on this runtime, 2026-11-15), so a blank segment
    # and one named '.' that share a blank chain keep their own runs (PT-9303
    # item 3; PT-9248 had read them as one).
    order = []; pos = {}
    for k in atoms:
        if k not in pos:
            pos[k] = len(order); order.append(k)
    res_ss = [''] * len(order)
    for ss, b, e in runs:
        i = pos.get(b); j = pos.get(e)
        if i is None or j is None or j < i or b[:2] != e[:2]: continue
        for x in range(i, j + 1):
            if res_ss[x] or order[x][:2] != b[:2]: break
            res_ss[x] = ss
    return [res_ss[pos[k]] for k in atoms]

_LOOK_ROW = '_r.append((color, reps, segi, chain, resv, resi, resn, name, ss, elem, x, y, z, ID))'

def _look_rows(sel, state):
    rows = []
    cmd.iterate_state(state, sel, _LOOK_ROW, space={'_r': rows})
    return rows

def _look_same_order(name, text, rows):
    # Read the written text back with file order kept, and compare it atom by
    # atom — into a name no object of the scene has (PT-9090 item 1).
    chk = cmd.get_unused_name('_agdb_look_chk')
    prev = cmd.get_setting_tuple('retain_order')[1][0]
    try:
        cmd.set('retain_order', 1, quiet=1)
        cmd.load_raw(text, 'cif', chk, 1, zoom=0, quiet=1)
        back = _look_rows(chk, 1)
    finally:
        cmd.set('retain_order', prev, quiet=1)
        cmd.delete(chk)
    if len(back) != len(rows): return False
    for i, (a, b) in enumerate(zip(rows, back)):
        # The written _atom_site.id is the row number too (a viewer may key on it).
        if b[13] != i + 1: return False
        if (a[3], a[4], a[7], a[9].upper()) != (b[3], b[4], b[7], b[9].upper()): return False
        if abs(a[10] - b[10]) > 0.002 or abs(a[11] - b[11]) > 0.002 or abs(a[12] - b[12]) > 0.002: return False
    return True

def _agdb_export_look(path):
    cache = {}
    names = cmd.get_names('public_objects', enabled_only=0) or []
    shown = set(cmd.get_names('public_objects', enabled_only=1) or [])
    gset = {}
    for n in _LOOK_NUM + _LOOK_COLOR:
        v = _look_setting(n, '', cache)
        if v is not None: gset[n] = v
    bg = _look_rgb(cmd.get_setting_tuple('bg_rgb')[1][0], cache)
    if bg is None: bg = 0
    used = set(); objects = []; skipped = []; total = 0
    for name in names:
        typ = str(cmd.get_type(name) or '')
        if typ != 'object:molecule':
            if len(skipped) < _LOOK_MAX_SKIPPED:
                kind = _lre.sub(r'[^A-Za-z0-9_]', '_', typ.split(':')[-1])[:32] or 'unknown'
                skipped.append({'name': _look_clean_name(name, used), 'type': kind})
            continue
        if len(objects) >= _LOOK_MAX_OBJECTS:
            return _lj.dumps({'err': 'export: more than %d molecule objects' % _LOOK_MAX_OBJECTS})
        rows = _look_rows(name, -1)
        if not rows:
            # No atoms with coordinates in the current state: nothing to draw.
            if len(skipped) < _LOOK_MAX_SKIPPED:
                skipped.append({'name': _look_clean_name(name, used), 'type': 'empty'})
            continue
        total += len(rows)
        if total > _LOOK_MAX_ATOMS:
            return _lj.dumps({'err': 'export-too-large'})
        try:
            text = cmd.get_str('cif', name, -1)
        except Exception as e:
            return _lj.dumps({'err': 'export: could not write %s: %s' % (name, (str(e) or type(e).__name__)[:200])})
        if not _look_same_order(name, text, rows):
            return _lj.dumps({'err': 'export: the atom order of %s could not be kept' % name})
        oset = {}
        for n in _LOOK_NUM + _LOOK_COLOR:
            v = _look_setting(n, name, cache, n in gset)
            if v is not None and v != gset.get(n): oset[n] = v
        color = []
        for r in rows:
            c = _look_rgb(r[0], cache)
            color.append(0xBFBFBF if c is None else c)
        objects.append({'name': _look_clean_name(name, used), 'enabled': name in shown,
                        'text': text + _look_ss_loops(rows), 'atoms': len(rows), 'color': color,
                        'reps': [int(r[1]) & _LOOK_REPS_MAX for r in rows], 'settings': oset})
    view = [float(v) for v in cmd.get_view()]
    look = {'v': 1, 'view': view, 'bg': [round(((bg >> s) & 255) / 255.0, 4) for s in (16, 8, 0)],
            'settings': gset, 'objects': objects, 'skipped': skipped}
    with open(path, 'w', encoding='utf-8') as fh:
        _lj.dump(look, fh, separators=(',', ':'), allow_nan=False)
    return _lj.dumps({'err': None, 'objects': len(objects), 'atoms': total})

def _look_fail(why):
    raise ValueError(why)

def _look_num(v, why):
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not _lm.isfinite(v): _look_fail(why)
    return v

def _look_int(v, lo, hi, why):
    if isinstance(v, bool) or not isinstance(v, int) or v < lo or v > hi: _look_fail(why)
    return v

def _look_settings_of(d, why):
    if not isinstance(d, dict) or len(d) > len(_LOOK_NUM) + len(_LOOK_COLOR): _look_fail(why)
    out = []
    for k, v in d.items():
        if k in _LOOK_NUM_SET:
            if abs(_look_num(v, why + '.' + k)) > _LOOK_SETTING_ABS: _look_fail(why + '.' + k)
            out.append((k, v))
        elif k in _LOOK_COLOR_SET:
            # -1: the atoms' own colours, under a fixed global one (PT-9090 item 2).
            if type(v) is int and v == -1:
                out.append((k, 'default')); continue
            if not isinstance(v, list) or len(v) != 3: _look_fail(why + '.' + k)
            for c in v:
                if not 0 <= _look_num(c, why + '.' + k) <= 1: _look_fail(why + '.' + k)
            out.append((k, '0x%02x%02x%02x' % tuple(int(round(c * 255)) for c in v)))
        else:
            _look_fail(why + ': not an allowed setting')
    return out

def _look_check(look):
    # Every field, before anything in the scene changes.
    if not isinstance(look, dict) or type(look.get('v')) is not int or look['v'] != 1: _look_fail('version')
    if set(look) != {'v', 'view', 'bg', 'settings', 'objects', 'skipped'}: _look_fail('fields')
    view = look['view']
    if not isinstance(view, list) or len(view) != 18: _look_fail('view')
    for x in view: _look_num(x, 'view')
    bg = look['bg']
    if not isinstance(bg, list) or len(bg) != 3: _look_fail('bg')
    for c in bg:
        if not 0 <= _look_num(c, 'bg') <= 1: _look_fail('bg')
    gset = _look_settings_of(look['settings'], 'settings')
    objs = look['objects']
    if not isinstance(objs, list) or len(objs) > _LOOK_MAX_OBJECTS: _look_fail('objects')
    if not isinstance(look['skipped'], list) or len(look['skipped']) > _LOOK_MAX_SKIPPED: _look_fail('skipped')
    names = set(); total = 0; out = []
    for o in objs:
        if not isinstance(o, dict) or set(o) != {'name', 'enabled', 'text', 'atoms', 'color', 'reps', 'settings'}: _look_fail('object')
        name = o['name']
        if not isinstance(name, str) or not _LOOK_NAME.match(name) or name in names: _look_fail('object.name')
        names.add(name)
        if not isinstance(o['enabled'], bool): _look_fail('object.enabled')
        if not isinstance(o['text'], str) or not o['text']: _look_fail('object.text')
        if _LOOK_BAD_ID.search(o['text']): _look_fail('object.text: a reserved identifier')
        n = _look_int(o['atoms'], 1, _LOOK_MAX_ATOMS, 'object.atoms')
        total += n
        if total > _LOOK_MAX_ATOMS: _look_fail('atoms')
        color, reps = o['color'], o['reps']
        if not isinstance(color, list) or not isinstance(reps, list) or len(color) != n or len(reps) != n: _look_fail('object.arrays')
        for c in color: _look_int(c, 0, 0xFFFFFF, 'object.color')
        for r in reps: _look_int(r, 0, _LOOK_REPS_MAX, 'object.reps')
        out.append((o, _look_settings_of(o['settings'], 'object.settings')))
    return view, bg, gset, out

def _look_reject_constant(c):
    raise ValueError('not a finite number: ' + c[:16])

def _agdb_apply_look(path):
    try:
        with open(path, 'rb') as fh:
            look = _lj.loads(fh.read().decode('utf-8'), parse_constant=_look_reject_constant)
        view, bg, gset, objs = _look_check(look)
    except Exception as e:
        return _lj.dumps({'err': 'look: not a look file (' + str(e)[:200] + ')'})
    prev = [(k, cmd.get_setting_tuple(k)[1][0]) for k in ('retain_order', 'auto_dss')]
    total = 0
    try:
        cmd.set('retain_order', 1, quiet=1); cmd.set('auto_dss', 0, quiet=1)
        cmd.delete('all')
        for o, oset in objs:
            name = o['name']
            cmd.load_raw(o['text'], 'cif', name, 1, zoom=0, quiet=1)
            n = cmd.count_atoms(name)
            if n != o['atoms']:
                cmd.delete(name)
                return _lj.dumps({'err': 'look: %s has %d atoms, the look %d' % (name, n, o['atoms'])})
            it = iter(zip(o['color'], o['reps']))
            cmd.alter(name, '(color, reps) = _n()', space={'_n': lambda: (lambda c, r: (_LOOK_TRGB | c, r))(*next(it))})
            # A blank chain: PyMOL's reader matched none of the ss loops, so
            # the object's own loops set each atom's ss here (PT-9210).
            keys = []
            cmd.iterate(name, '_k.append((segi, chain, resi))', space={'_k': keys})
            if any(k[1] == '' for k in keys):
                ss = _look_ss_of(o['text'], keys)
                if ss is not None:
                    its = iter(ss)
                    cmd.alter(name, 'ss = _s()', space={'_s': lambda: next(its)})
            for k, v in oset: cmd.set(k, v, name, quiet=1)
            if not o['enabled']: cmd.disable(name)
            total += n
        for k, v in gset: cmd.set(k, v, quiet=1)
        cmd.set('bg_rgb', [float(c) for c in bg], quiet=1)
        cmd.recolor(); cmd.rebuild()
        cmd.set_view(view)
    except Exception as e:
        return _lj.dumps({'err': 'look: could not apply: ' + (str(e) or type(e).__name__)[:200]})
    finally:
        for k, v in prev: cmd.set(k, v, quiet=1)
    return _lj.dumps({'err': None, 'atoms': total})
`;

// ---------------------------------------------------------------- loop state
const inputQ = [];
const taskQ = [];
const live = { draws: 0, ticks: 0, lastPost: performance.now() };
let dragging = false, lastViewPosted = '';
// A key or a wheel turn can start a camera move PyMOL draws over later frames
// of its own (a scene recalled with scene_animation on): its view goes out on
// each drawn frame after one, until the camera has held still for
// SETTLE_IDLE_MS, and at most for SETTLE_MAX_MS from the key or the turn, so
// the page's copy of the camera is the one the move ends at (PT-8779 item 5).
// Counted in time, not in frames: PyMOL steps such a move about 30 times a
// second whatever the display's rate, so at 120 Hz or more each step stays
// on screen for 4 or more drawn frames, and a count of 3 still frames ended
// the watch at the first step (PT-9523). 250 ms is several of those steps;
// 10 s is longer than any default animation. The view is read (a Python
// get_view) on drawn frames only: a tick that draws nothing only compares
// the clock, and makes no GL call.
const SETTLE_MAX_MS = 10000, SETTLE_IDLE_MS = 250;
let settling = false, settleEnd = 0, settleMovedAt = 0;
function settleView() { settling = true; settleMovedAt = performance.now(); settleEnd = settleMovedAt + SETTLE_MAX_MS; }
// The shown selection and the wizard may have changed (a click, a key, a task):
// read them again at the end of the tick, outside a drag (frame protocol 3).
// PyMOL applies some clicks a frame or more after the release (a click on the
// background deselects ~0.1-0.4 s later, measured in the real frame), so a
// click or a key is read again at UI_RECHECK_MS too; an unchanged report is
// never re-posted.
let uiDirty = false, lastUiPosted = '';
const UI_RECHECK_MS = [150, 500];
let uiRecheck = [];
function uiAfterInput() { uiDirty = true; seqEpoch++; const t = performance.now(); uiRecheck = UI_RECHECK_MS.map((d) => t + d); }
let loopStarted = false, tickBusy = false, forceDraw = false;
let lastTickErr = '';   // dedupe a persistent identical tick throw: surface it once, not every frame
// PyMOL's display_scale_factor is an integer that scales its text and panels;
// the backing store is CSS px x DPR. Desktop PyMOL takes int(DPR), which on a
// Windows laptop at 125 % / 150 % leaves text at 80 % / 67 % of its size. The
// nearest integer instead (125 % -> 1, 150 % -> 2): at Windows' own scales,
// 100 % to 300 % in 25 % steps, never below 80 % nor above 133 % of the size
// meant. Between them — a browser zoom on top of the scale — it reaches 67 %
// just under 150 %, and under 100 % the floor of 1 draws it larger
// (PT-3291 item 15). Set here once, at boot; after that the parent is its
// only writer, re-sending the member's choice or this same rule after a DPR
// change and after every rebuild. Following the DPR here as well raced the
// parent's re-send of a pinned value, and either could be the value left
// (relay 2 step 2; PT-3291 item 14; the parent's copy of this rule is
// pymolDisplayScale.ts).
const displayScale = (dpr) => Math.max(1, Math.round(+dpr || 1));
// Autonomous watchdog snapshot (§4.2-4/7): there is no parent-request type for
// a snapshot, so the worker emits one itself after a state change, debounced.
// A page that never reads them (the standalone HTML file's bridge) says so in
// `init` (snapshots: false): no .pse is written every few seconds for nobody
// (PT-9090 item 10). The AgDB frame never sends the field.
const SNAPSHOT_MIN_MS = 5000;
let snapDirty = false, snapPending = false, lastSnapAt = 0, SNAPSHOTS = true;
// The object panel's width for a page that asked (`init` guiWidth: true, the
// standalone page: its pull tab sits at the panel's left edge, owner
// 2026-11-16). PyMOL draws the panel internal_gui_width x display_scale_factor
// device px wide at the buffer's right edge; both are settings the member can
// change (the settings dialog, the command line, a session), so it is read
// from PyMOL with each uistate read, after a resize and after every task,
// and posted only when it or the buffer's width changed.
let GUI_WIDTH = false, lastGuiPosted = '';
function emitGuiWidth() {
  if (!GUI_WIDTH) return;
  try {
    const px = Number(guiWidthFn());
    if (!Number.isFinite(px) || px < 0) return;
    // The rows and buttons as PyMOL lays them out (_agdb_guilayout); a page
    // without them still has the width.
    let layout = null;
    try {
      const l = JSON.parse(String(guiLayoutFn()));
      if (['lh', 'tw', 'ts', 'cm', 'ops', 'rows', 'bottom'].every(k => Number.isFinite(l[k]) && l[k] >= 0)) layout = l;
    } catch (e) {}
    const key = px + ',' + W + ',' + H + (layout === null ? '' : ',' + [layout.lh, layout.tw, layout.ts, layout.cm, layout.ops, layout.rows, layout.bottom, layout.mode, layout.mv, layout.ct, layout.bm, layout.nf, layout.rk, layout.rs, layout.sp].join(','));
    if (key === lastGuiPosted) return;
    lastGuiPosted = key;
    if (layout === null) postMessage({ type: 'guiwidth', px, bw: W });
    else postMessage({ type: 'guiwidth', px, bw: W, bh: H, lh: layout.lh, tw: layout.tw, ts: layout.ts, cm: layout.cm, ops: layout.ops, rows: layout.rows, bottom: layout.bottom, mode: String(layout.mode || '').slice(0, 40), mv: layout.mv, ct: layout.ct, bm: layout.bm, nf: layout.nf, rk: layout.rk, rs: layout.rs, sp: layout.sp });
  } catch (e) {}
}
// Heartbeat (ADR-0049 §4.2-7; TN0113 §2.2-1 / §4.1-6): a light liveness signal
// for the parent's watchdog, posted from the tick so it stops exactly when the
// loop does — after FATAL, and while a long synchronous section (a load, a
// surface build in idle(), a ray, the snapshot's cmd.save) blocks the tick. The
// parent judges an outage only while idle and visible, for that reason. It also
// goes out (throttled) the moment a click or key ARRIVES, before the tick that
// applies it: PyMOL's own menus and command line start long work the parent
// never requested, and `inputMs` is how the parent learns to wait for it.
// Neither goes out while the latest tick threw: a tick that throws every time
// draws nothing and drops all input, and must not look alive (PT-3271 item 12).
// One throw only delays the beat to the next tick that runs to the end.
const HEARTBEAT_MS = 1000, INPUT_BEAT_MS = 200;
let lastInputAt = null, lastInputBeat = -Infinity, tickOk = true;
function postHeartbeat(t) {
  live.lastPost = t;
  postMessage({ type: 'heartbeat', ticks: live.ticks, draws: live.draws, heapMB: heapMB(),
                inputMs: lastInputAt === null ? null : Math.max(0, Math.round(t - lastInputAt)) });
}
function noteInput() {
  const t = performance.now(); lastInputAt = t;
  if (loopStarted && !FATAL && tickOk && t - lastInputBeat >= INPUT_BEAT_MS) { lastInputBeat = t; postHeartbeat(t); }
}

function schedule() {
  if (LOOP_MODE === 'raf' && HAVE_RAF) requestAnimationFrame(tick);
  else setTimeout(() => tick(performance.now()), 0);
}
const fullViewport = () => { if (GLC) GLC.viewport(0, 0, W, H); };
// Drain stale GL errors so a 1282 left in the queue cannot make the NEXT
// representation's GLGenBuffer bail and render black (patch 0003 at loop level).
function drainGlErrors() { if (!GLC) return; let n = 0; while (GLC.getError() !== 0 && n < 32) n++; }

function postViewIfChanged() {
  try {
    const v = cmd.get_view().toJs();
    const key = v.map((x) => x.toFixed(3)).join(',');
    if (key !== lastViewPosted) { lastViewPosted = key; postMessage({ type: 'view18', v: Array.from(v).slice(0, 18) }); return true; }
  } catch (e) {}
  return false;
}

function applyInput() {
  for (let i = 0; i < inputQ.length; i++) {
    const ev = inputQ[i];
    if (ev.k === 'move') { const nx = inputQ[i + 1]; if (nx && nx.k === 'move') continue; inst.drag(ev.x, ev.y, ev.mods); }
    else if (ev.k === 'button') {
      inst.button(ev.b, ev.state, ev.x, ev.y, ev.mods);
      if (ev.b <= 2) { if (ev.state === 0) dragging = true; else { dragging = false; postViewIfChanged(); emitPick(); uiAfterInput(); } }
      // The wheel (buttons 3 and 4) moves the camera too: its view goes out on
      // the release, so the page's copy is the camera on screen (AgDB 2026-11-11).
      else if (ev.state === 1) { postViewIfChanged(); settleView(); }
    }
    else if (ev.k === 'key') { inst.button(ev.code, ev.state, 0, 0, ev.mods); postViewIfChanged(); settleView(); uiAfterInput(); }
    else if (ev.k === 'resize') {
      if (inputQ.slice(i + 1).some((e2) => e2.k === 'resize')) continue;
      CANVAS.width = ev.w; CANVAS.height = ev.h; W = ev.w; H = ev.h; DPR = ev.dpr;
      inst.reshape(ev.w, ev.h, true); forceDraw = true;
      // The buffer's new width goes out with the next read (emitGuiWidth).
      if (GUI_WIDTH) uiDirty = true;
    }
  }
  inputQ.length = 0;
}

// Best-effort pick: after a click, if PyMOL set the pk1 selection, name it.
// At most PICK_SEND_MAX entries — one past what the parent keeps, so it can
// tell the list was cut; a longer list is refused there. A pk1 larger than
// that (`select pk1, all`) is not named at all: cmd.index builds the whole
// list before any cut, which blocked every release on a large structure for
// O(atoms) (PT-3271 item 16), and a click picks one atom.
const PICK_SEND_MAX = 1025;
function emitPick() {
  try {
    const n = cmd.count_atoms('pk1');
    if (n > 0 && n <= PICK_SEND_MAX) {
      const info = pickFn();
      postMessage({ type: 'pick', atoms: JSON.parse(info) });
    }
  } catch (e) {}
}

// What the page mirrors (frame protocol 3, AgDB 2026-11-12): the first shown
// (enabled) selection — its name, its atom count, how many selections are
// shown (`shown`), whether it holds atoms outside the polymer (`hetero`: a
// ligand, water — its residue number can be a protein residue's, PR #7914
// review), and its POLYMER residues as runs of consecutive residue numbers per
// object and chain, one "model<TAB>chain<TAB>start<TAB>end" line each — and
// whether the Measurement wizard is up. The parent validates every field
// (pymolFrameProtocol.ts). A selection over UI_ATOMS_MAX atoms is named and
// counted but not walked; at most UI_RUNS_MAX runs go out, `more` saying the
// list was cut.
//
// When: a `command` is read right after it ran, before its reply is posted —
// so the page always has the report of what a command changed before that
// command's reply (the strip tells its own pick's report from an older one by
// this order, and 「📏 測定」 reads the wizard on it). Commands come one at a
// time, each after the parent's round trip, which bounds that rate; the parent
// caps it (RATE_PER_SECOND.uistate) well above. A click, a key or any other
// task is read at the end of a tick at most every UI_MIN_MS (a key held down),
// never during a drag (a walk is synchronous in the tick). No timer, no
// waiting: the order is structural (PR #7914 review, rounds 3-5 — a floor and
// a reply that waited for a held read each left a path out of order).
const UI_ATOMS_MAX = 50000, UI_RUNS_MAX = 64, UI_MIN_MS = 100;
// The object list's cap (the standalone page's `objects`; emitObjects below).
const OBJECTS_MAX = 300;
// The page's sequence: at most this many residues (the page checks it again).
const SEQ_MAX = 20000;
let lastUiAt = -Infinity, uiErr = '';
const UI_PY = `
import json as _j
def _agdb_ui(_c):
    _names = [n for n in (_c.get_names('selections', enabled_only=1) or []) if not n.startswith('_')]
    _sel = None; _atoms = None; _runs = None; _more = False; _het = False
    if _names:
        _sel = _names[0]
        _atoms = _c.count_atoms(_sel)
        _het = _c.count_atoms('(%s) and not polymer' % _sel) > 0
        if _atoms <= ${UI_ATOMS_MAX}:
            _seen = set()
            _c.iterate('(%s) and polymer' % _sel, '_seen.add((model, chain, resv))', space={'_seen': _seen})
            _by = {}
            for _m, _ch, _r in _seen: _by.setdefault((_m, _ch), []).append(_r)
            _out = []
            for (_m, _ch) in sorted(_by):
                _rs = sorted(set(_by[(_m, _ch)])); _a = _rs[0]; _b = _a
                for _r in _rs[1:] + [None]:
                    if _r is not None and _r == _b + 1: _b = _r; continue
                    _out.append('%s\\t%s\\t%d\\t%d' % (_m, _ch, _a, _b))
                    if _r is not None: _a = _b = _r
            _more = len(_out) > ${UI_RUNS_MAX}
            _runs = '\\n'.join(_out[:${UI_RUNS_MAX}])
    _w = _c.get_wizard()
    _wiz = None if _w is None else ('measurement' if type(_w).__name__ == 'Measurement' else 'other')
    return _j.dumps({'sel': _sel, 'atoms': _atoms, 'runs': _runs, 'more': _more, 'shown': len(_names), 'hetero': _het, 'wizard': _wiz})
def _agdb_guiwidth():
    return int(float(cmd.get('internal_gui_width'))) * int(float(cmd.get('display_scale_factor')))
def _agdb_guilayout():
    # The object panel's rows and buttons, device px, as PyMOL's Executive
    # lays them out (layer3/Executive.cpp: a row is internal_gui_control_size
    # high, a button 17 wide (16 drawn), from the panel's right edge, a click
    # 2 below the row's top; layer1/Ortho.cpp OrthoLayoutPanel: under the
    # rows, the wizard's lines + 4, the mouse box (124, or 40 without the
    # grid), the movie controls (20) and the movie panel). 'rows' counts the
    # 'all' row and every name the panel lists; a closed group's members are
    # counted too (no setting says it is closed), so a hover mark may show
    # under the last row there.
    _s = int(float(cmd.get('display_scale_factor')))
    _lh = int(float(cmd.get('internal_gui_control_size'))) * _s
    # A boolean setting reads 'on' / 'off' (float() of it fails).
    _on = lambda _n: str(cmd.get(_n)).strip().lower() in ('on', '1', '1.0', 'true')
    _hide = _on('hide_underscore_names')
    _names = [n for n in (cmd.get_names('all', enabled_only=0) or []) if not (_hide and n.startswith('_'))]
    _wiz = 0
    _w = cmd.get_wizard()
    if _w is not None:
        try:
            _p = _w.get_panel()
            _wiz = _lh * len(_p) + 4 if _p else 0
        except Exception:
            _wiz = 0
    _movie = 0
    try:
        if int(float(cmd.get('movie_panel'))) and cmd.count_frames() > 1:
            _movie = int(float(cmd.get('movie_panel_row_height'))) * _s
    except Exception:
        _movie = 0
    _grid = _on('mouse_grid')
    _mode = str(cmd.get('button_mode_name'))
    # The blocks under the rows from the canvas's foot up, for the page's marks
    # on them (AgDB 2026-11-20): the movie panel, the movie buttons' row
    # (layer1/Control.cpp, 20) and the mouse box (layer1/ButMode.cpp), with
    # how many frames the movie buttons step through.
    try:
        _nf = int(cmd.count_frames())
    except Exception:
        _nf = 0
    _bm = (124 if _grid else 40) * _s
    # What moves the view (AgDB 2026-11-21, the page's motion button): PyMOL's
    # rock on or off, the page's rock speed (0 while the rock is not the
    # page's; reading it puts the member's sweep settings back once the
    # page's rock has stopped), and the page's steady turn in degrees a second.
    return _j.dumps({'lh': _lh, 'tw': 17 * _s, 'ts': 16 * _s, 'cm': 2 * _s, 'mode': _mode[:40],
                     'ops': 6 if _mode == '3-Button Motions' else 5,
                     'rows': 1 + len(_names), 'bottom': 20 * _s + _bm + _wiz + _movie,
                     'mv': _movie, 'ct': 20 * _s, 'bm': _bm, 'nf': max(0, _nf),
                     'rk': 1 if _on('rock') else 0, 'rs': _agdb_rock_follow(_on('rock')), 'sp': _agdb_spin[0]})
def _agdb_pick():
    return _j.dumps([{'model': m, 'index': i} for m, i in cmd.index('pk1')])
# The phone's object list (the standalone page's, init objectList: true; owner
# 2026-11-19: no PyMOL object panel on a phone). Every name PyMOL lists but
# the hidden _ ones, in its order, with a kind and whether it is enabled; the
# list's version moves only when the names do, so a switch pressed twice in a
# row is not refused. The page names a target by its index in the list it was
# sent and that version, never by name: _agdb_obj resolves the name here and
# hands it to PyMOL as a name (%name in a selection), so no name is parsed as
# a command or a selection expression.
_agdb_objsnap = {'v': 0, 'names': None, 'focus': None}
_AGDB_REPS = ('cartoon', 'sticks', 'lines', 'spheres', 'surface', 'mesh')
_AGDB_COLORS = ('red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'magenta', 'white', 'grey70')
_AGDB_KINDS = {'selection': 'selection', 'object:molecule': 'molecule', 'object:group': 'group',
               'object:measurement': 'distance', 'object:map': 'map', 'object:mesh': 'map',
               'object:volume': 'map', 'object:surface': 'map', 'object:slice': 'map'}
def _agdb_kind(_n):
    try:
        return _AGDB_KINDS.get(str(cmd.get_type(_n)), 'other')
    except Exception:
        return 'other'
def _agdb_objects():
    _all = [n for n in (cmd.get_names('all', enabled_only=0) or []) if not n.startswith('_')]
    _on = set(cmd.get_names('all', enabled_only=1) or [])
    _more = len(_all) > ${OBJECTS_MAX}
    _all = _all[:${OBJECTS_MAX}]
    _s = _agdb_objsnap
    if _all != _s['names']:
        _s['v'] += 1
        _s['names'] = _all
        if _s['focus'] is not None and _s['focus'] != '' and _s['focus'] not in _all:
            _s['focus'] = None
    _f = _s['focus']
    _reps = None
    # Only an entry made of atoms has representations (a map's or a measurement's name is no atom
    # selection, and count_atoms would raise on it); a read that fails reads none, never the list.
    if _f is not None and (_f == '' or _agdb_kind(_f) in ('molecule', 'selection', 'group')):
        try:
            _sel = 'all' if _f == '' else '%' + _f
            _reps = [r for r in _AGDB_REPS if cmd.count_atoms('(%s) and rep %s' % (_sel, r)) > 0]
        except Exception:
            _reps = None
    return _j.dumps({'v': _s['v'], 'items': [[n, _agdb_kind(n), n in _on] for n in _all], 'more': _more,
                     'focus': None if _f is None else (-1 if _f == '' else _all.index(_f)), 'reps': _reps})
def _agdb_obj(_v, _i, _op, _arg=''):
    from pymol import util
    _s = _agdb_objsnap
    # Stopping the representations' reading never depends on the list (a stale page must still stop it).
    if _op == 'unfocus':
        _s['focus'] = None
        return
    _names = _s['names'] or []
    if _v != _s['v'] or not isinstance(_i, int) or _i < -1 or _i >= len(_names):
        print(' Viewer Pack: the object list changed; nothing was done.')
        return
    _n = None if _i == -1 else _names[_i]
    # Atoms are selected by name (%name); a map, a measurement or a CGO is named as itself.
    _sel = 'all' if _n is None else ('%' + _n if _agdb_kind(_n) in ('molecule', 'selection', 'group') else _n)
    if _op == 'on': cmd.enable('all' if _n is None else _n)
    elif _op == 'off': cmd.disable('all' if _n is None else _n)
    elif _op == 'show' and _arg in _AGDB_REPS: cmd.show(_arg, _sel)
    elif _op == 'hide' and _arg in _AGDB_REPS: cmd.hide(_arg, _sel)
    elif _op == 'hideall': cmd.hide('everything', _sel)
    elif _op == 'color' and _arg == 'element': util.cnc(_sel)
    elif _op == 'color' and _arg == 'chain': util.cbc(_sel)
    elif _op == 'color' and _arg == 'rainbow': util.chainbow(_sel)
    elif _op == 'color' and _arg == 'ss': util.cbss(_sel, 'red', 'yellow', 'green')
    elif _op == 'color' and _arg == 'b': cmd.spectrum('b', 'blue_white_red', _sel)
    elif _op == 'color' and _arg in _AGDB_COLORS: cmd.color(_arg, _sel)
    elif _op == 'label' and _arg == 'residue': cmd.label('(%s) and name CA' % _sel, '"%s %s" % (resn, resi)')
    elif _op == 'label' and _arg == 'atom': cmd.label(_sel, 'name')
    elif _op == 'label' and _arg == 'clear': cmd.label(_sel, '')
    elif _op == 'zoom': cmd.zoom(_sel, animate=-1)
    elif _op == 'center': cmd.center(_sel, animate=-1)
    elif _op == 'orient': cmd.orient(_sel, animate=-1)
    elif _op == 'delete' and _n is not None: cmd.delete(_n)
    elif _op == 'focus': _s['focus'] = '' if _n is None else _n
    elif _op == 'unfocus': _s['focus'] = None
# A command's Python (/...) runs in the pymol module's namespace (parser.py:
# pymol_names), not this one: the page's /_agdb_obj(...) finds it there.
cmd._pymol._agdb_obj = _agdb_obj
# The page's sequence (the standalone page's 「配列」, AgDB 2026-11-21): while
# the page wants it (_agdb_seq_want), every polymer residue of the molecules
# shown — the molecule, chain, residue number and name — in PyMOL's order,
# one a residue (its CA, or P for a nucleotide; an alternate location once),
# at most ${SEQ_MAX}, the reading itself bounded too; read again when the
# molecules shown change or anything else ran (_epoch: the worker counts
# every request but these, and every click and key — an edit of the same
# size included; PR #10172's review). The page names a residue back by its
# index in the version it was sent (_agdb_seq_hl), never by a name.
_agdb_seqsnap = {'want': False, 'key': None, 'v': 0, 'res': [], 'json': '', 'objs': None, 'more': False}
def _agdb_seq_want(_on):
    _agdb_seqsnap['want'] = bool(_on)
    _agdb_seqsnap['key'] = None
    if not _on:
        _agdb_seq_hl(-1, -1)
def _agdb_seq(_epoch=0, _have=-1):
    _s = _agdb_seqsnap
    if not _s['want']:
        return ''
    _names = [n for n in (cmd.get_names('objects', enabled_only=1) or []) if not n.startswith('_') and _agdb_kind(n) == 'molecule']
    _cut = len(_names) > ${OBJECTS_MAX}
    _names = _names[:${OBJECTS_MAX}]
    _key = (tuple(_names), _epoch)
    if _key != _s['key']:
        _s['key'] = _key
        _res = []
        _more = False
        for _k, _n in enumerate(_names):
            # Each residue once (its first CA or P: an alternate location is not another
            # residue), kept while the list has room and one past it, which says there is
            # more. PyMOL's iterate cannot stop early; past the room each atom costs one
            # call that keeps nothing. Every call is None: iterate compiles its expression
            # as an interactive line, and PyMOL would print any other value in its output
            # (PR #10172's review, round 2).
            _room = ${SEQ_MAX} - len(_res)
            _got = []
            _last = [None]
            def _take(c, r, rn, ix, _got=_got, _last=_last, _room=_room):
                if (c, r) != _last[0]:
                    _last[0] = (c, r)
                    if len(_got) <= _room:
                        _got.append((c, r, rn, ix))
            cmd.iterate('%%%s and polymer and (name CA or name P)' % _n, '_take(chain, resi, resn, index)', space={'_take': _take})
            for _c, _r, _rn, _ix in _got[:_room]:
                _res.append((_k, _n, str(_c)[:8], str(_r)[:16], str(_rn)[:8], int(_ix)))
            if len(_got) > _room:
                _more = True
                break
        # A new version only when the list changed: a residue the page has lit stays its index.
        _more = _more or _cut
        if _res != _s['res'] or _s['json'] == '' or _s.get('objs') != _names or _s.get('more') != _more:
            _s['v'] += 1
            _s['res'] = _res
            _s['objs'] = _names
            _s['more'] = _more
            _s['json'] = _j.dumps({'v': _s['v'], 'objs': _names, 'res': [[k, c, r, rn] for k, n, c, r, rn, ix in _res], 'more': _more})
    # The page has this version already: nothing crosses (PR #10172's review).
    return '=' if _s['v'] == _have else _s['json']
# The residue the page points at, shown for the moment: a copy of it as thick
# yellow sticks in a hidden object (_agdb_seqhl, never listed: its name
# begins with _), gone with the next call. None while the page does not want
# the sequence (a call that arrives after it closed), for an index out of
# date or range, or when the atom there is no longer the residue listed — the
# list is read again then (PR #10172's review).
def _agdb_seq_hl(_v, _i):
    if '_agdb_seqhl' in (cmd.get_names('objects') or []):
        cmd.delete('_agdb_seqhl')
    _s = _agdb_seqsnap
    if not _s['want'] or _v != _s['v'] or not isinstance(_i, int) or _i < 0 or _i >= len(_s['res']):
        return
    _k, _n, _c, _r, _rn, _ix = _s['res'][_i]
    _now = []
    try:
        cmd.iterate('%%%s and index %d' % (_n, _ix), '_now.append((str(chain)[:8], str(resi)[:16], str(resn)[:8]))', space={'_now': _now})
    except Exception:
        # The molecule is gone (deleted, or replaced by a load) before the list was read again.
        _now = None
    if _now != [(_c, _r, _rn)]:
        _s['key'] = None
        return
    try:
        cmd.create('_agdb_seqhl', 'byres (%%%s and index %d)' % (_n, _ix), zoom=0)
        cmd.show_as('sticks', '_agdb_seqhl')
        cmd.color('yellow', '_agdb_seqhl')
        cmd.set('stick_radius', 0.4, '_agdb_seqhl')
    except Exception:
        pass
cmd._pymol._agdb_seq_want = _agdb_seq_want
cmd._pymol._agdb_seq_hl = _agdb_seq_hl
`;
// Defined once at boot (init), called through these proxies (deferFn: GL_PY's
// _agdb_defer_follow).
let uiFn = null, guiWidthFn = null, guiLayoutFn = null, pickFn = null, deferFn = null, objectsFn = null, seqFn = null;
// The object list for a page that asked (`init` objectList: true, the
// standalone page's phone layout, owner 2026-11-19): read with each uistate
// read, posted only when it changed. At most OBJECTS_MAX names go out, `more`
// saying the list was cut; `reps` are the representations shown for the one
// entry the page opened (`focus`), else null.
let OBJECT_LIST = false, lastObjectsPosted = '', objectsErr = '';
function emitObjects() {
  if (!OBJECT_LIST || objectsFn === null) return;
  try {
    const s = String(objectsFn());
    objectsErr = '';
    if (s === lastObjectsPosted) return;
    lastObjectsPosted = s;
    const o = JSON.parse(s);
    postMessage({ type: 'objects', v: o.v | 0, items: o.items, more: !!o.more, focus: o.focus, reps: o.reps });
  } catch (e) {
    const m = 'objects: ' + String((e && e.message) || e).slice(0, 200);
    if (m !== objectsErr) { objectsErr = m; log(m); }
  }
}
// The page's sequence (`_agdb_seq`, standalone page only: objectList), posted
// when it changed while the page wants it; nothing while it does not. It is
// read again whenever `seqEpoch` moved: every request but the page's own
// sequence commands, and every click and key, counts (an edit that keeps the
// atom count must not leave a stale list).
let lastSeqPosted = '', lastSeqV = -1, seqErr = '', seqEpoch = 0;
function emitSeq() {
  if (!OBJECT_LIST || seqFn === null) return;
  try {
    const s = String(seqFn(seqEpoch, lastSeqPosted === '' ? -1 : lastSeqV));
    seqErr = '';
    if (s === '=' || s === lastSeqPosted) return;
    lastSeqPosted = s;
    if (s === '') return;
    const o = JSON.parse(s);
    lastSeqV = o.v | 0;
    postMessage({ type: 'seq', v: o.v | 0, objs: o.objs, res: o.res, more: !!o.more });
  } catch (e) {
    const m = 'seq: ' + String((e && e.message) || e).slice(0, 200);
    if (m !== seqErr) { seqErr = m; log(m); }
  }
}
function emitUi() {
  lastUiAt = performance.now();
  emitGuiWidth();
  emitObjects();
  emitSeq();
  try {
    const s = String(uiFn(cmd));
    uiErr = '';
    if (s === lastUiPosted) return;
    lastUiPosted = s;
    const u = JSON.parse(s);
    postMessage({ type: 'uistate', sel: u.sel, atoms: u.atoms, runs: u.runs, more: !!u.more, shown: u.shown | 0, hetero: !!u.hetero, wizard: u.wizard });
  } catch (e) {
    // Said once per distinct failure, not every tick: the page then keeps its
    // last report, and the log says why.
    const m = 'uistate: ' + String((e && e.message) || e).slice(0, 200);
    if (m !== uiErr) { uiErr = m; log(m); }
  }
}

function tick() {
  if (tickBusy) { schedule(); return; }
  tickBusy = true;
  try {
    // GL only on a tick with something to do: before a task, a pending
    // redraw, a drag, a click / key / resize, and right before a draw. An
    // idle or hover-only tick makes no GL call (no getError round trip).
    const act = taskQ.length > 0 || forceDraw || dragging || inputQ.some((ev) => ev.k !== 'move');
    // A task, a click or a key can change grid_mode (a command runs in
    // its task; PyMOL's own menus act on the click):
    // defer_builds_mode follows before this tick draws (GL_PY, S2-5).
    const follow = taskQ.length > 0 || inputQ.some((ev) => ev.k === 'button' || ev.k === 'key');
    if (act) { drainGlErrors(); fullViewport(); }
    applyInput();
    if (act) fullViewport();
    while (taskQ.length) { const t = taskQ.shift(); uiDirty = true; try { t(); } catch (e) { log('task error ' + e); } }
    if (follow) deferFn();
    if (forceDraw) { try { cmd.refresh_wizard(); } catch (e) {} forceDraw = false; }
    const drew = frame() ? (fullViewport(), drainGlErrors(), inst.draw(), 1) : 0;
    live.ticks++;
    if (drew) {
      live.draws++;
      if (dragging) postViewIfChanged();
      else if (settling && postViewIfChanged()) settleMovedAt = performance.now();
    }
    // The settle watch ends on time, on a tick that drew or not.
    if (settling) { const t = performance.now(); if (t - settleMovedAt >= SETTLE_IDLE_MS || t >= settleEnd) settling = false; }
    if (!dragging && uiRecheck.length && performance.now() >= uiRecheck[0]) { uiRecheck.shift(); uiDirty = true; }
    if (uiDirty && !dragging && performance.now() - lastUiAt >= UI_MIN_MS) { uiDirty = false; emitUi(); }
    const now = performance.now();
    // Emit a debounced recovery snapshot when state changed and nothing is in
    // flight — never while dragging, so an interactive rotate is not stalled.
    if (SNAPSHOTS && snapDirty && !snapPending && !dragging && now - lastSnapAt >= SNAPSHOT_MIN_MS) emitSnapshot();
    lastTickErr = '';   // a fully successful tick clears the dedupe so a later recurrence re-surfaces
    tickOk = true;
  } catch (e) {
    tickOk = false;
    // A throw from applyInput()/frame() (e.g. a menu callback error on click)
    // must not kill the loop: without this it skips schedule() below, freezes
    // the viewer, and strands every queued runInTick promise. Classify, drop the
    // stale input, and keep ticking unless the runtime is fatal. Surface a
    // persistent IDENTICAL throw only once (not ~60/s) so it cannot flood the
    // parent; a fatal flip or a different message always re-posts.
    inputQ.length = 0;
    const s = 'tick: ' + String((e && e.message) || e).slice(0, 300);
    if (FATAL_RE.test(s) || isTrap(e)) FATAL = FATAL || s;
    if (FATAL || s !== lastTickErr) postError(s);
    lastTickErr = s;
  } finally { tickBusy = false; }
  if (FATAL) return;
  // After the try, not in it, so a throw cannot skip schedule().
  const t = performance.now();
  if (tickOk && t - live.lastPost >= HEARTBEAT_MS) postHeartbeat(t);
  flushPyLog(t);
  schedule();
}

function emitSnapshot() {
  snapPending = true; snapDirty = false; lastSnapAt = performance.now();
  try {
    py.runPython("cmd.save('/tmp/snap.pse')");
    const b = py.FS.readFile('/tmp/snap.pse'); py.FS.unlink('/tmp/snap.pse');
    if (b.byteLength <= SNAPSHOT_CAP) { const buf = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); postMessage({ type: 'snapshot', bytes: buf }, [buf]); }
    // Over the cap the parent keeps an older snapshot: say so, so the page can
    // tell the member a rebuild would go back further (PT-8314 item 1).
    else postMessage({ type: 'snapshot-skipped', bytes: b.byteLength });
  } catch (e) { log('snapshot: ' + e); }
  finally { snapPending = false; }
}

const heapMB = () => { try { return +(py._module.HEAP8.buffer.byteLength / MiB).toFixed(1); } catch (e) { return null; } };
// A parent request may carry `req`, the page's number for it. When its task
// starts in the tick, the worker posts taken{req}: the page counts the
// request's deadline from then, not from when it was sent while the tick was
// still busy with earlier work — a deferred surface build, the work PyMOL's own
// menus started (PT-3271 item 5). A request without one (a page from before
// this) gets no notice and is judged as before.
const reqOf = (m) => (Number.isSafeInteger(m.req) && m.req >= 0 ? m.req : null);
const runInTick = (req, fn) => new Promise((resolve, reject) => {
  if (FATAL) return reject(new Error('worker fatal: ' + FATAL));
  taskQ.push(() => {
    if (req !== null) postMessage({ type: 'taken', req });
    forceDraw = true; try { resolve(fn()); } catch (e) { reject(e); }
  });
});

// The settings an exportPng{ray} may carry (pymolFrameProtocol.ts RAY_SETTING_NAMES).
const RAY_SETTINGS = ['ray_trace_mode', 'antialias', 'ray_shadows', 'ray_opaque_background', 'two_sided_lighting', 'image_dots_per_inch'];

// The non-ray PNG never goes through a Blob: WebKit refuses every Blob read
// in a worker that a file:// page started (NotReadableError "The I/O read
// operation failed.": the HTMLapp on iPhone, 2026-11-17), and the Blob
// convertToBlob makes can only be had by reading it. So the pixels are read
// here, in the task that drew them (preserveDrawingBuffer stays false: after
// the task returns the buffer is empty or an older frame), and pngEncode
// builds the file after the task.
function pngFromFramebuffer() {
  const gl = GLC; fullViewport(); inst.draw(); inst.draw();
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  const px = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return { w, h, px };
}

// The standalone page's screenshot k times the view's pixels on a side (owner
// 2026-11-20: 「スクリーンショットでも解像度が選べるようにする」): the same
// picture, the object panel and every word in it k times as large, so they
// keep their share of it. display_scale_factor goes up BEFORE the canvas
// grows and the view is laid out at the new size (the other order lays the
// panel out for the old scale; W and H follow the canvas, as the viewport each
// draw sets reads them), the picture is read, and scale, canvas and
// layout go back in this same task: the large layout is never on screen
// (measured in headless Chrome, 2026-11-20: an exact replica at 2880 x 1512).
// Bounded by the page's limit and by what this GPU draws; a buffer the
// browser made smaller than asked is refused, never read.
const SHOT_SCALE_MAX = 4, SHOT_SIDE_MAX = 8192, SHOT_PIXELS_MAX = 40e6;
function pngScaled(k) {
  const gl = GLC, w0 = W, h0 = H, w = w0 * k, h = h0 * k;
  const dims = gl.getParameter(gl.MAX_VIEWPORT_DIMS) || [0, 0];
  const lim = Math.min(SHOT_SIDE_MAX, gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) || 0, dims[0] || 0, dims[1] || 0);
  if (w > lim || h > lim || w * h > SHOT_PIXELS_MAX) return { err: 'export: ' + w + ' x ' + h + ' px is larger than this device draws (' + lim + ' px a side)' };
  const s0 = py.runPython("cmd.get_setting_int('display_scale_factor')") | 0 || 1;
  try {
    py.runPython("cmd.set('display_scale_factor', " + (s0 * k) + ', quiet=1)');
    CANVAS.width = w; CANVAS.height = h; W = w; H = h;
    inst.reshape(w, h, true);
    if (gl.drawingBufferWidth !== w || gl.drawingBufferHeight !== h) return { err: 'export: this device made the picture smaller than ' + w + ' x ' + h + ' px' };
    return pngFromFramebuffer();
  } finally {
    py.runPython("cmd.set('display_scale_factor', " + s0 + ', quiet=1)');
    CANVAS.width = w0; CANVAS.height = h0; W = w0; H = h0;
    inst.reshape(w0, h0, true); fullViewport(); inst.draw();
  }
}

const PNG_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
const pngCrc = (c, u8) => { for (let i = 0; i < u8.length; i++) c = PNG_CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return c; };
// About 256 KiB of rows per write into the deflate stream.
const PNG_BATCH = 1 << 18;

// readPixels' bottom-up RGBA as an RGB PNG (the context has no alpha, so
// every alpha byte is 255), top row first, filter 0 on every row. The rows go
// into CompressionStream('deflate') (zlib, what IDAT holds) a batch at a time,
// each write awaited, so no second whole-picture buffer is made; the
// compressed parts become one IDAT. Returns an ArrayBuffer to transfer.
async function pngEncode(px, w, h) {
  const cs = new CompressionStream('deflate');
  const writer = cs.writable.getWriter(), reader = cs.readable.getReader();
  const parts = []; let n = 0;
  const drained = (async () => { for (;;) { const r = await reader.read(); if (r.done) return; parts.push(r.value); n += r.value.byteLength; } })();
  const stride = w * 3 + 1, rows = Math.max(1, Math.floor(PNG_BATCH / stride));
  try {
    for (let y0 = 0; y0 < h; y0 += rows) {
      const k = Math.min(rows, h - y0), b = new Uint8Array(k * stride);
      for (let j = 0; j < k; j++) {
        for (let s = (h - 1 - y0 - j) * w * 4, o = j * stride + 1, e = o + w * 3; o < e; s += 4, o += 3) {
          b[o] = px[s]; b[o + 1] = px[s + 1]; b[o + 2] = px[s + 2];
        }
      }
      await writer.write(b);
    }
    await writer.close();
  } catch (e) {
    writer.abort(e).catch(() => {});
    await drained.catch(() => {});
    throw e;
  }
  await drained;
  const out = new Uint8Array(n + 57), v = new DataView(out.buffer);
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  // One chunk: length, type, data (written by fill), CRC over type + data.
  const chunk = (at, type, len, fill) => {
    v.setUint32(at, len);
    for (let i = 0; i < 4; i++) out[at + 4 + i] = type.charCodeAt(i);
    fill(at + 8);
    v.setUint32(at + 8 + len, (pngCrc(0xffffffff, out.subarray(at + 4, at + 8 + len)) ^ 0xffffffff) >>> 0);
    return at + 12 + len;
  };
  // IHDR: w, h, 8 bits, colour type 2 (RGB), deflate, adaptive filtering, no interlace.
  let at = chunk(8, 'IHDR', 13, (d) => { v.setUint32(d, w); v.setUint32(d + 4, h); out[d + 8] = 8; out[d + 9] = 2; });
  at = chunk(at, 'IDAT', n, (d) => { for (const p of parts) { out.set(p, d); d += p.byteLength; } });
  chunk(at, 'IEND', 0, () => {});
  return out.buffer;
}

async function init(m) {
  BASE = m.base; ASSETS = m.assets || {}; CANVAS = m.canvas; DPR = m.dpr || 1;
  if ((CANVAS.width < 1 || CANVAS.height < 1) && m.w >= 1 && m.h >= 1) { CANVAS.width = m.w | 0; CANVAS.height = m.h | 0; }
  W = CANVAS.width; H = CANVAS.height;
  if (m.loopMode) LOOP_MODE = m.loopMode;
  if (m.snapshots === false) SNAPSHOTS = false;
  if (m.guiWidth === true) GUI_WIDTH = true;
  if (m.objectList === true) OBJECT_LIST = true;
  installFetchShim();
  progress('boot');
  await preflightWasm();
  importScripts(BASE + 'pyodide.js');
  const createPyodideModule = await importCore();
  py = await loadPyodideWithDeadline({ indexURL: BASE, lockFileURL: BASE + 'pyodide-lock.json', createPyodideModule, stdout: () => {}, stderr: pyLog });
  progress('pyodide');
  // numpy waits for its first import (deferNumpy), else it comes in by
  // depends. The lock's sha256 becomes the fetch's `integrity`, which the
  // shim above ignores: the parent's SHA-256 (pymolAssets.ts) is the check on
  // these bytes, not this call.
  let lazyNumpy = deferNumpy();
  await py.loadPackage(['pymol'], { messageCallback: () => {} });
  progress('packages');
  // Nothing reads the handed copies again but NUMPY_WHEEL: the shim refuses a
  // handed kind from here on (`handed` was fixed at install), and Stop / Retry
  // and a rebuild give a new worker new copies.
  ASSETS = {};
  if (lazyNumpy && py.loadedPackages && py.loadedPackages.numpy) { lazyNumpy = false; NUMPY_WHEEL = null; }   // loaded after all: nothing to defer
  if (lazyNumpy) {
    py.registerJsModule('_agdb_numpy', { unpack: unpackNumpy });
    py.runPython(NUMPY_PY);                      // before import pymol, so any import of numpy finds it
  }
  if (!makeGL(CANVAS)) throw new Error('GL.createContext failed (webgl2+webgl1)');
  try { CANVAS.addEventListener('webglcontextlost', () => { FATAL = FATAL || 'webgl context lost'; postError('webgl context lost'); }); } catch (e) {}
  py.runPython(START_PY(W, H, m.gui ? 1 : 0));
  truncateSideModules();
  py.runPython(HARDEN_PY);                       // unconditional; asserts the baked-in unpickler
  py.runPython(EXPORT_PY);
  py.runPython(LOOK_PY);
  py.runPython(GL_PY);
  py.runPython(UI_PY);
  frame = py.globals.get('_frame'); inst = py.globals.get('_inst'); cmd = py.globals.get('cmd');
  uiFn = py.globals.get('_agdb_ui'); guiWidthFn = py.globals.get('_agdb_guiwidth'); guiLayoutFn = py.globals.get('_agdb_guilayout'); pickFn = py.globals.get('_agdb_pick');
  objectsFn = py.globals.get('_agdb_objects');
  seqFn = py.globals.get('_agdb_seq');
  deferFn = py.globals.get('_agdb_defer_follow');
  py.runPython("cmd.set('max_threads', 1)");     // trap 3
  py.runPython('_agdb_gl_defaults()');           // trilines: lines draw under WebGL; ub_color, defer_builds_mode (GL_PY)
  try { py.runPython(`cmd.set('display_scale_factor', ${displayScale(DPR)})`); } catch (e) {}
  // Shader warm-up (trap 7/26): compile every representation's shaders once on a
  // throwaway peptide so the first real render is deterministic, not black.
  // Lines after trilines is on, so it is the trilines shader that compiles.
  try {
    py.runPython("cmd.fab('AAAA','_warm'); cmd.hide('everything','_warm'); cmd.show('cartoon','_warm'); cmd.show('sticks','_warm'); cmd.show('surface','_warm'); cmd.show('spheres','_warm'); cmd.show('lines','_warm'); cmd.orient('_warm')");
    for (let i = 0; i < 10; i++) { drainGlErrors(); fullViewport(); inst.draw(); }
    py.runPython("cmd.delete('_warm')");
    drainGlErrors(); for (let i = 0; i < 3; i++) { fullViewport(); inst.draw(); }
  } catch (e) { log('warmup: ' + e); }
  // The warm-up's fab moved PyMOL's automatic colour cycle on; desktop PyMOL
  // starts it at 0, so the member's first structure is green and the second
  // cyan (owner ruling 7, 2026-11-17). Outside the warm-up's try, so a
  // warm-up that threw after its fab is undone too.
  try { py.runPython("cmd.set('auto_color_next', 0)"); } catch (e) { log('auto_color_next: ' + e); }
  postMessage({ type: 'ready', webgl: WEBGL, maxThreads: py.runPython("cmd.get('max_threads')"),
                allowCount: py.runPython('_allow_count()'), allowList: py.runPython('_allow_list()'), restricted: py.runPython("__import__('pickle').loads.__qualname__ == 'restricted_loads'"),
                heapMB: heapMB(), w: W, h: H, workerMs: Math.round(performance.now() - T0) });
  loopStarted = true; schedule();
}

// The load allow-list: message format -> PyMOL format. Never pkl / model
// (§4.2-4/6). The three map formats (relay 2 step 4, TN0113 §8-4) are read by
// PyMOL's own CCP4/MRC reader — binary grids, nothing unpickled — and are
// normalised to sigma units on load (normalize_ccp4_maps, measured). No mae:
// this open-source build's mae loader is incentive-only and always raises
// (PT-3601).
const FORMATS = { pdb: 'pdb', ent: 'pdb', cif: 'cif', mmcif: 'cif', sdf: 'sdf', mol: 'mol', mol2: 'mol2', xyz: 'xyz', pse: 'pse', ccp4: 'ccp4', map: 'map', mrc: 'mrc' };
const MAP_FORMATS = new Set(['ccp4', 'map', 'mrc']);
// Own keys only: `__proto__` / `constructor` must not find Object.prototype's.
const formatFor = (ext) => (Object.prototype.hasOwnProperty.call(FORMATS, ext) ? FORMATS[ext] : undefined);

// An init failure as the parent reads it: the message, then the stack. The
// parent shows the first line and logs the rest; Firefox's and Safari's
// `stack` holds only the frames, so the message is put first when it is not.
function initErrorText(err) {
  const text = String(err);
  const stack = err && typeof err.stack === 'string' ? err.stack : '';
  return stack === '' ? text : stack.startsWith(text) ? stack : text + '\n' + stack;
}
// How much of that text is sent. A Python error's message is its traceback,
// whose exception line comes last — after Pyodide's own frames, which alone
// take ~400 characters — and that line is what the parent shows (PT-4047).
// Kept inside the parent's LIMITS.textChars (4000), which would cut it again.
const INIT_ERROR_CHARS = 3500;

self.onmessage = async (e) => {
  const m = e.data; if (!m || !m.type) return;
  const req = reqOf(m);
  try {
    if (m.type === 'init') { try { await init(m); } catch (err) { postMessage({ type: 'error', s: 'init: ' + initErrorText(err).slice(0, INIT_ERROR_CHARS), fatal: FATAL_RE.test(String(err)) }); } return; }
    // local DOM input from the frame (never a parent-port message)
    if (m.type === 'move') { inputQ.push({ k: 'move', x: m.x | 0, y: m.y | 0, mods: m.mods | 0 }); return; }
    if (m.type === 'button') { inputQ.push({ k: 'button', b: m.b | 0, state: m.state | 0, x: m.x | 0, y: m.y | 0, mods: m.mods | 0 }); noteInput(); return; }
    if (m.type === 'key') { inputQ.push({ k: 'key', code: m.code | 0, state: m.state | 0, mods: m.mods | 0 }); noteInput(); return; }
    if (m.type === 'resize') { inputQ.push({ k: 'resize', w: Math.max(1, m.w | 0), h: Math.max(1, m.h | 0), dpr: +m.dpr || 1 }); return; }
    if (!loopStarted) { postMessage({ type: 'error', s: 'not ready for ' + m.type }); return; }
    // Anything but the page's own sequence commands may change what the sequence lists.
    if (!(m.type === 'command' && String(m.cmd).startsWith('_ /_agdb_seq_'))) seqEpoch++;

    if (m.type === 'setView') {
      const v = m.v;
      if (!Array.isArray(v) || v.length !== 18 || !v.every((x) => Number.isFinite(x))) { postMessage({ type: 'error', s: 'setView needs 18 finite floats' }); return; }
      await runInTick(req, () => { cmd.set_view(v); }); postViewIfChanged(); return;
    }
    if (m.type === 'command') {
      try { await runInTick(req, () => cmd.do(String(m.cmd))); if (!FATAL) emitUi(); snapDirty = true; progress('command'); postViewIfChanged(); }
      catch (err) {
        const s = String(err).slice(0, 300);
        if (FATAL_RE.test(s) || isTrap(err)) FATAL = FATAL || s;
        postError(s);
      }
      return;
    }
    if (m.type === 'runtimeAsset') {
      if (m.name && m.bytes instanceof ArrayBuffer) ASSETS[new URL(String(m.name), BASE).href] = m.bytes;
      return;
    }
    if (m.type === 'load') {
      const ext = String(m.format || '').toLowerCase();
      const fmt = formatFor(ext);
      if (!fmt) { postMessage({ type: 'error', s: 'format not allowed: ' + ext }); return; }   // enum excludes pkl/model/cc1/brick (§4.2-4/6)
      if (ext === 'pse') {
        // Write + read in ONE tick task (and unlink after) so a second load or
        // restoreSnapshot arriving before the tick cannot overwrite the shared
        // path and make this task read the other's bytes, and so the file does
        // not accumulate in MEMFS for the worker's lifetime.
        const bytes = new Uint8Array(m.bytes);
        const r = await runInTick(req, () => { py.FS.writeFile('/tmp/sess.pse', bytes); try { return py.runPython(RESTORE_PY); } finally { try { py.FS.unlink('/tmp/sess.pse'); } catch (e) {} } });
        const parsed = JSON.parse(r);
        snapDirty = true; progress('loaded', { atoms: parsed.atoms });
        if (parsed.err) postMessage({ type: 'error', s: parsed.err });
        postViewIfChanged(); return;
      }
      const obj = String(m.obj || 'mol').replace(/[^A-Za-z0-9_]/g, '_').slice(0, 40) || 'mol';
      const fn = '/tmp/in_' + obj + '.' + fmt;
      const bytes = new Uint8Array(m.bytes);
      await runInTick(req, () => {
        py.FS.writeFile(fn, bytes);
        try {
          if (m.replace) cmd.delete('all');
          cmd.load(fn, obj, 0, fmt);
        } finally { try { py.FS.unlink(fn); } catch (e) {} }
      });
      snapDirty = true;
      // A map is not a selection (count_atoms raises "Invalid selection name"
      // on one), and it has no atoms to count.
      const atoms = MAP_FORMATS.has(fmt) ? 0 : py.runPython(`cmd.count_atoms(${JSON.stringify(obj)})`);
      progress('loaded', { atoms, heapMB: heapMB() });
      postViewIfChanged(); return;
    }
    if (m.type === 'restoreSnapshot') {
      const bytes = new Uint8Array(m.bytes);
      const r = await runInTick(req, () => { py.FS.writeFile('/tmp/sess.pse', bytes); try { return py.runPython(RESTORE_PY); } finally { try { py.FS.unlink('/tmp/sess.pse'); } catch (e) {} } });
      const parsed = JSON.parse(r);
      progress('restored', { atoms: parsed.atoms });
      if (parsed.err) postMessage({ type: 'error', s: parsed.err });
      postViewIfChanged(); return;
    }
    if (m.type === 'exportPng' && m.ray) {
      // The ray-traced image is written by PyMOL itself (cmd.png with ray=1)
      // and read back from the file: reading the drawing buffer after
      // cmd.ray returned the plain GL picture, because the draw before the
      // read repaints the scene (owner 2026-11-09, measured). Clamp the
      // dimensions: an unbounded w/h reaches the ray tracer as a wasm32
      // single allocation and can bad_alloc the runtime. The dpi is the
      // image_dots_per_inch setting (cmd.png's dpi=-1).
      const rw = Math.min(Math.max((m.w | 0) || W, 1), 4096), rh = Math.min(Math.max((m.h | 0) || H, 1), 4096);
      // The page's ray settings live only inside this one task: set, ray, and
      // the scene's own values back in a finally, so no snapshot, no command
      // queued behind the ray and no rebuild ever sees them (PT-8382). Only
      // the listed names, only finite numbers: the literal below is JSON of
      // [name, number] pairs, which Python reads as a list of tuples-as-lists.
      const S = m.settings && typeof m.settings === 'object' ? m.settings : {};
      const pairs = RAY_SETTINGS.filter((k) => typeof S[k] === 'number' && Number.isFinite(S[k])).map((k) => [k, S[k]]);
      let buf;
      try {
        buf = await runInTick(req, () => {
          try { py.FS.unlink('/tmp/ray.png'); } catch (e) {}
          py.runPython(`_agdb_ray = ${JSON.stringify(pairs)}
_agdb_ray_prev = [(k, cmd.get(k)) for k, _ in _agdb_ray]
try:
    for k, v in _agdb_ray: cmd.set(k, v, quiet=1)
    cmd.png('/tmp/ray.png', width=${rw}, height=${rh}, ray=1, quiet=1)
finally:
    for k, v in _agdb_ray_prev: cmd.set(k, v, quiet=1)
    del _agdb_ray, _agdb_ray_prev`);
          // cmd.png can return without writing a file: that is "not written",
          // not a filesystem error (PT-8372 item 6).
          if (!py.FS.analyzePath('/tmp/ray.png').exists) return null;
          const b = py.FS.readFile('/tmp/ray.png'); py.FS.unlink('/tmp/ray.png');
          return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
        });
      } catch (err) {
        // A runtime that broke goes to the outer handler, which marks it fatal.
        if (FATAL_RE.test(String(err)) || isTrap(err)) throw err;
        // A Python error's message is its whole traceback; the member is
        // shown its last line, the exception, as init's errors are (PT-4047,
        // PT-8372 item 6).
        const lines = String(err && err.message || err).trim().split('\n');
        postError('export: ray failed: ' + lines[lines.length - 1].slice(0, 300));
        return;
      } finally {
        // The ray leaves PyMOL's "Image size = W x H" line over the view until
        // the scene changes: a refresh clears it, also after a failed ray.
        try { await runInTick(null, () => { py.runPython('cmd.refresh()'); }); } catch (e) {}
      }
      if (buf === null || buf.byteLength < 24) { postMessage({ type: 'error', s: 'export: the ray-traced image was not written' }); return; }
      const v = new DataView(buf, 0, 24), w = v.getUint32(16), h = v.getUint32(20);
      // The camera the picture was drawn at, ahead of the picture: the page
      // stores the last one it heard with the shot (PR #7441 review), and
      // input applied in this task may have moved it.
      postViewIfChanged();
      postMessage({ type: 'png', nonce: m.nonce, bytes: buf, w, h }, [buf]); return;
    }
    if (m.type === 'exportPng') {
      const k = Number.isInteger(m.scale) && m.scale > 1 && m.scale <= SHOT_SCALE_MAX ? m.scale : 1;
      const r = await runInTick(req, () => (k === 1 ? pngFromFramebuffer() : pngScaled(k)));
      if (r.err) { postMessage({ type: 'error', s: r.err.slice(0, 300) }); return; }
      const buf = await pngEncode(r.px, r.w, r.h);
      postViewIfChanged();
      postMessage({ type: 'png', nonce: m.nonce, bytes: buf, w: r.w, h: r.h }, [buf]); return;
    }
    if (m.type === 'exportPse') {
      const r = await runInTick(req, () => {
        try {
          py.runPython("cmd.save('/tmp/out.pse')");
          if (py.FS.stat('/tmp/out.pse').size > PSE_MAX) return { err: 'export-too-large' };
          const b = py.FS.readFile('/tmp/out.pse');
          return { buf: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
        } finally { try { py.FS.unlink('/tmp/out.pse'); } catch (e) {} }
      });
      if (r.err) { postMessage({ type: 'error', s: r.err }); return; }
      postMessage({ type: 'pse', nonce: m.nonce, bytes: r.buf }, [r.buf]); return;
    }
    if (m.type === 'exportMol') {
      const fmt = String(m.format || '');
      const sel = typeof m.selection === 'string' ? m.selection : '';
      if (!MOL_FORMATS.has(fmt) || sel.length < 1 || sel.length > SELECTION_MAX) { postMessage({ type: 'error', s: 'export: not a molecule export request' }); return; }
      const path = '/tmp/out.' + fmt;
      // Write, read and unlink in ONE tick task, as exportPse does.
      const r = await runInTick(req, () => {
        try {
          const res = JSON.parse(py.runPython('_agdb_export_mol(' + JSON.stringify(sel) + ', ' + JSON.stringify(fmt) + ', ' + JSON.stringify(path) + ')'));
          if (res.err) return { err: String(res.err) };
          if (py.FS.stat(path).size > MOL_MAX) return { err: 'export-too-large' };
          const b = py.FS.readFile(path);
          return { buf: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
        } finally { try { py.FS.unlink(path); } catch (e) {} }
      });
      if (r.err) { postMessage({ type: 'error', s: r.err.slice(0, 300) }); return; }
      postMessage({ type: 'mol', nonce: m.nonce, bytes: r.buf }, [r.buf]); return;
    }
    if (m.type === 'exportLook') {
      // The scene's look as JSON data (see LOOK_PY). Written, size-checked,
      // read and unlinked in ONE tick task, as exportMol is.
      const path = '/tmp/look.json';
      const r = await runInTick(req, () => {
        try {
          const res = JSON.parse(py.runPython('_agdb_export_look(' + JSON.stringify(path) + ')'));
          if (res.err) return { err: String(res.err) };
          if (py.FS.stat(path).size > LOOK_MAX) return { err: 'export-too-large' };
          const b = py.FS.readFile(path);
          return { buf: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
        } finally { try { py.FS.unlink(path); } catch (e) {} }
      });
      if (r.err) { postMessage({ type: 'error', s: r.err.slice(0, 300) }); return; }
      postMessage({ type: 'look', nonce: m.nonce, bytes: r.buf }, [r.buf]); return;
    }
    if (m.type === 'applyLook') {
      // The standalone page's scene (host.js never forwards this type). The
      // bytes are data for LOOK_PY's fixed code, which checks every field.
      const n = bufferLength(m.bytes);
      if (n < 1 || n > LOOK_MAX) { postMessage({ type: 'error', s: 'look: not a look file' }); return; }
      const bytes = new Uint8Array(m.bytes);
      const path = '/tmp/look_in.json';
      const r = await runInTick(req, () => { py.FS.writeFile(path, bytes); try { return py.runPython('_agdb_apply_look(' + JSON.stringify(path) + ')'); } finally { try { py.FS.unlink(path); } catch (e) {} } });
      const parsed = JSON.parse(r);
      snapDirty = true;
      if (parsed.err) { postMessage({ type: 'error', s: String(parsed.err).slice(0, 300) }); return; }
      progress('loaded', { atoms: parsed.atoms, heapMB: heapMB() });
      postViewIfChanged(); return;
    }
    postMessage({ type: 'error', s: 'unknown message type ' + m.type });
  } catch (err) {
    const s = String(err && err.message || err).slice(0, 400);
    if (FATAL_RE.test(s) || isTrap(err)) FATAL = FATAL || s;
    postError(s);
  }
};
