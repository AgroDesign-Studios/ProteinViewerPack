// AgDB in-browser PyMOL — the frame bootstrap.
//
// AgDB-written code loaded by ../pymol-host.html inside an opaque-origin
// sandbox="allow-scripts" iframe (NO allow-same-origin; location.origin is
// 'null'). It is the isolation layer of ADR-0049 §4.2 (verbatim in handoff
// TN0110 §4.2). Steps (§4.2-1):
//   - delete RTCPeerConnection / webkitRTCPeerConnection (STUN is not governed
//     by connect-src — trap 12);
//   - accept the parent's MessageChannel port from a 'port-handshake' message,
//     ONLY when e.source === window.parent and EXACTLY once (§4.2-4);
//   - take the parent-fetched, SHA-256-checked executables from that message
//     — only when the message's `runtime` is this frame's own BASE and its
//     `protocol` is this frame's PROTOCOL — and
//     spawn the classic blob: Worker that runs Pyodide + PyMOL, handing it
//     those bytes and the transferred OffscreenCanvas (WebGL2 -> WebGL1);
//   - forward real DOM input (incl. mousemove with NO button pressed, Qt
//     setMouseTracking — trap 14) to the worker, and relay ONLY the §4.2-4
//     typed messages in each direction (plus, frame -> parent, the heartbeat of
//     ADR-0049 注 2 and the worker's notice that it took a request).
// The loader URL is absolute (an opaque frame's relative URLs do not resolve
// for a blob Worker — trap 11); it is derived from this script's own URL, so
// the version directory is wherever this file lives.
'use strict';

// This script's own URL gives the versioned base, even though the document is
// the version-less ../pymol-host.html. The worker and the Pyodide loader are
// siblings of this file.
const SELF = (document.currentScript && document.currentScript.src) || location.href;
const BASE = new URL('./', SELF).href;                 // /vendor/pymol/<ver>/
const U = (p) => new URL(p, BASE).href;

// The page <-> frame protocol this file and worker.js speak (PT-3671). An open
// tab keeps the page code it was loaded with, but every frame it builds loads
// these two files fresh, from the same version directory. Raise this together
// with PYMOL_FRAME_PROTOCOL (pymolFrameProtocol.ts) when a change alters a
// message such a page sends or expects, so it is told to reload instead of
// failing; the digests pinned in pymolHostHandshake.test.ts make every change
// to the two files face that question. 4 added the look export (exportLook /
// look, the standalone HTML export, AgDB 2026-11-13).
const PROTOCOL = 4;

// (§4.2-1) WebRTC removal — before anything else can reach it.
try { delete self.RTCPeerConnection; } catch (e) {}
try { delete self.webkitRTCPeerConnection; } catch (e) {}
try { self.RTCPeerConnection = undefined; } catch (e) {}
try { self.webkitRTCPeerConnection = undefined; } catch (e) {}

// Relay CSP violations to the parent as log lines (the only §4.2-4 channel for
// them); the Worker's one expected script-src-elem violation on boot is seen
// here or in the worker, and the parent/tests count it as the known one.
document.addEventListener('securitypolicyviolation', (e) => {
  if (PORT) PORT.postMessage({ type: 'log', s: 'csp:' + e.violatedDirective + ':' + String(e.blockedURI).slice(0, 80) });
});

let PORT = null, worker = null, handshakeDone = false, transferred = false;
const canvas = document.getElementById('gl');
let BW = 0, BH = 0, DPR = self.devicePixelRatio || 1;

function cssBox() { const r = canvas.getBoundingClientRect(); return { w: r.width, h: r.height, left: r.left, top: r.top }; }
function wantedBacking(entry) {
  DPR = self.devicePixelRatio || 1;
  if (entry && entry.devicePixelContentBoxSize && entry.devicePixelContentBoxSize[0]) { const s = entry.devicePixelContentBoxSize[0]; return [s.inlineSize, s.blockSize]; }
  const b = cssBox(); return [Math.round(b.w * DPR), Math.round(b.h * DPR)];
}
{ const [w, h] = wantedBacking(null); canvas.width = BW = (w || 800); canvas.height = BH = (h || 600); }

// ---- DOM input -> worker (pmg_qt button mapping; y flipped) ----------------
const mods = (e, noAlt) => (e.shiftKey ? 1 : 0) | ((e.ctrlKey || e.metaKey) ? 2 : 0) | (e.altKey && !noAlt ? 4 : 0);
const xy = (e) => { const b = cssBox(); return [Math.round((e.clientX - b.left) * BW / b.w), Math.round(BH - (e.clientY - b.top) * BH / b.h)]; };
const btn = (e) => (e.button === 1 ? 1 : e.button === 2 ? 2 : 0);
let down = 0;
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('mousedown', (e) => { if (!worker) return; canvas.focus(); down++; const [x, y] = xy(e); worker.postMessage({ type: 'move', x, y, mods: mods(e) }); worker.postMessage({ type: 'button', b: btn(e), state: 0, x, y, mods: mods(e) }); e.preventDefault(); });
self.addEventListener('mouseup', (e) => { if (!worker || !down) return; down = Math.max(0, down - 1); const [x, y] = xy(e); worker.postMessage({ type: 'button', b: btn(e), state: 1, x, y, mods: mods(e) }); });
// THE M6 behaviour (trap 14): forward motion with or without a pressed button,
// so PyMOL's internal menus highlight and run on an ordinary click.
canvas.addEventListener('mousemove', (e) => { if (!worker) return; const [x, y] = xy(e); worker.postMessage({ type: 'move', x, y, mods: mods(e) }); });
canvas.addEventListener('wheel', (e) => { if (!worker || e.deltaY === 0) return; const [x, y] = xy(e); const b = e.deltaY < 0 ? 3 : 4; worker.postMessage({ type: 'button', b, state: 0, x, y, mods: mods(e) }); worker.postMessage({ type: 'button', b, state: 1, x, y, mods: mods(e) }); e.preventDefault(); }, { passive: false });
// GLUT special-key codes (state -2). F1-F12 recall PyMOL's scenes.
const SPECIAL = { ArrowLeft: 100, ArrowUp: 101, ArrowRight: 102, ArrowDown: 103, PageUp: 104, PageDown: 105, Home: 106, End: 107, Insert: 108,
                  F1: 1, F2: 2, F3: 3, F4: 4, F5: 5, F6: 6, F7: 7, F8: 8, F9: 9, F10: 10, F11: 11, F12: 12 };
// No Tab here (PT-3273 item 1, WCAG 2.1.2): Tab / Shift+Tab are not PyMOL's,
// so the browser moves focus out of the frame and a keyboard user is never
// trapped in the canvas. Escape stays PyMOL's (it toggles the text panel).
const CTRLK = { Enter: 13, Backspace: 8, Escape: 27, Delete: 127 };
// PyMOL's default shortcuts that Chrome on Windows keeps for itself — the page
// never sees the keydown (new tab, close tab, switch tab, DevTools). Pressed
// with Alt added (Ctrl+Alt+T for Ctrl+T), they reach PyMOL as the original.
// The parent's help lists the same ids (pymolKeys.ts; a test holds the two
// equal). Names follow PyMOL's shortcut_dict: CTRL- / CTSH- + key.
const CHROME_RESERVED = new Set(['CTRL-T', 'CTSH-N', 'CTSH-T', 'CTSH-W', 'CTSH-I', 'CTSH-J', 'CTSH-C',
                                 'CTRL-F4', 'CTRL-pgup', 'CTRL-pgdn', 'CTSH-pgup', 'CTSH-pgdn']);
const KEY_NAMES = { PageUp: 'pgup', PageDown: 'pgdn' };
function reservedId(e) {
  if (!(e.ctrlKey || e.metaKey)) return null;
  // The physical key, not e.key: with Ctrl+Alt some layouts type a third character.
  const letter = /^Key([A-Z])$/.exec(e.code || '');
  const name = letter ? letter[1] : (KEY_NAMES[e.key] || e.key);
  const id = (e.shiftKey ? 'CTSH-' : 'CTRL-') + name;
  return CHROME_RESERVED.has(id) ? { id, letter: letter ? letter[1] : null } : null;
}
canvas.addEventListener('keydown', (e) => {
  if (!worker || e.key === 'Tab') return;
  const remap = e.altKey ? reservedId(e) : null;
  let k, st = -1;
  // What the original chord sends: Ctrl+letter as its control code, Ctrl+Shift+letter as the capital.
  if (remap && remap.letter) k = e.shiftKey ? remap.letter.charCodeAt(0) : remap.letter.toLowerCase().charCodeAt(0) - 96;
  else if (e.key in SPECIAL) { k = SPECIAL[e.key]; st = -2; }
  else if (e.key in CTRLK) k = CTRLK[e.key];
  else if (e.key.length === 1) { k = e.key.charCodeAt(0); if (e.ctrlKey && k >= 97 && k <= 122) k -= 96; }
  if (k === undefined || k > 255) return;
  worker.postMessage({ type: 'key', code: k, state: st, mods: mods(e, !!remap) }); e.preventDefault();
});

// ---- resize: size the backing store to CSS x DPR, follow resizes -----------
function postResize(entry) {
  const [w, h] = wantedBacking(entry);
  if (w < 1 || h < 1 || (w === BW && h === BH)) return;
  BW = w; BH = h;
  if (!transferred) { canvas.width = w; canvas.height = h; }   // a cached re-open runs before layout (trap 35)
  if (worker) worker.postMessage({ type: 'resize', w, h, dpr: DPR });
}
try { const ro = new ResizeObserver((ents) => postResize(ents[0])); try { ro.observe(canvas, { box: 'device-pixel-content-box' }); } catch (e) { ro.observe(canvas); } } catch (e) {}
function watchDpr() { try { matchMedia('(resolution: ' + (self.devicePixelRatio || 1) + 'dppx)').addEventListener('change', () => { postResize(null); watchDpr(); }, { once: true }); } catch (e) {} }
watchDpr();

// ---- spawn the classic blob: Worker ----------------------------------------
// Relay ONLY the §4.2-4 worker->parent types, plus the heartbeat the parent's
// watchdog judges (relay 2 step 1) and `taken`, which starts a request's
// deadline (PT-3271 item 5); drop anything else so the parent port never
// carries an unmodelled message (completion condition 1). The parent validates
// every field of every type (pymolFrameProtocol.ts) — this set is only a filter.
const OUT = new Set(['ready', 'log', 'progress', 'pick', 'view18', 'png', 'pse', 'mol', 'look', 'snapshot', 'snapshot-skipped', 'error', 'heartbeat', 'taken', 'uistate']);
function spawnWorker(assets, opts) {
  return fetch(U('worker.js')).then((r) => { if (!r.ok) throw new Error('worker.js fetch ' + r.status); return r.text(); }).then((src) => {
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    worker = new Worker(url);   // classic blob: Worker, inherits the frame CSP
    worker.onmessage = (m) => {
      const d = m.data; if (!d || !OUT.has(d.type)) return;
      if ((d.type === 'png' || d.type === 'pse' || d.type === 'mol' || d.type === 'look' || d.type === 'snapshot') && d.bytes instanceof ArrayBuffer) { PORT.postMessage(d, [d.bytes]); return; }
      PORT.postMessage(d);
    };
    worker.onerror = (er) => { if (PORT) PORT.postMessage({ type: 'error', s: 'worker error: ' + String(er.message || er), fatal: true }); };
    { const [w0, h0] = wantedBacking(null); if (w0 >= 1 && h0 >= 1) { BW = w0; BH = h0; canvas.width = BW; canvas.height = BH; } }
    const off = canvas.transferControlToOffscreen(); transferred = true;
    const transfer = [off]; for (const k in assets) transfer.push(assets[k]);
    worker.postMessage({ type: 'init', canvas: off, base: BASE, assets, dpr: DPR, w: BW, h: BH, gui: opts.gui ? 1 : 0, loopMode: opts.loopMode }, transfer);
  });
}

// ---- handshake: parent only, once (§4.2-4) ---------------------------------
self.addEventListener('message', async (e) => {
  if (!e.data || e.data.type !== 'port-handshake') return;
  if (e.source !== self.parent) return;                 // only the parent frame
  if (!e.ports || !e.ports[0]) return;
  if (handshakeDone) return;                             // exactly once
  handshakeDone = true;
  PORT = e.ports[0]; PORT.start && PORT.start(); PORT.onmessage = onParent;
  // The parent keys every file it hands over to ITS runtime base, and the
  // worker's shim finds a file only under this frame's BASE. A page and a frame
  // document of different versions (a tab opened before a version bump) would
  // miss every key, so refuse before the worker exists (PT-3272 item 2). The
  // parent matches this text's start (pymolFrameProtocol.ts RUNTIME_MISMATCH).
  // A page from before that check sends no runtime and does not know the
  // prefix: it shows this text as a failed start, so the text says what helps.
  if (e.data.runtime === undefined) {
    PORT.postMessage({ type: 'error', s: 'runtime mismatch: this page was loaded before PyMOL was updated. Reload the page (このページを再読み込みしてください). This frame runs ' + BASE, fatal: true });
    return;
  }
  if (e.data.runtime !== BASE) {
    PORT.postMessage({ type: 'error', s: 'runtime mismatch: the page keys its files to ' + String(e.data.runtime).slice(0, 120) + ', this frame runs ' + BASE, fatal: true });
    return;
  }
  // A page from before the protocol number (#3466) speaks protocol 1.
  const protocol = e.data.protocol === undefined ? 1 : e.data.protocol;
  if (protocol !== PROTOCOL) {
    PORT.postMessage({ type: 'error', s: 'runtime mismatch: the page speaks frame protocol ' + String(protocol).slice(0, 20) + ', this frame ' + PROTOCOL + ' (' + BASE + ')', fatal: true });
    return;
  }
  // A spawn failure (worker.js fetch blocked/failed, a bad assets map) must
  // reach the parent as a fatal error, not a silent unhandled rejection that
  // the parent can only diagnose as a watchdog timeout.
  try { await spawnWorker(e.data.assets || {}, e.data.opts || {}); }
  catch (err) { PORT.postMessage({ type: 'error', s: 'spawn: ' + String((err && err.message) || err).slice(0, 200), fatal: true }); }
});

// ---- parent -> worker relay: ONLY the §4.2-4 parent types ------------------
// The frame does not re-validate shape/size — the parent gate (relay 2) does,
// and the worker enforces its own format enum and finite-float checks (its
// size bounds: the outbound snapshot and molecule-file caps, the ray-dimension
// clamp and the selection length — PT-3816 items 8, 10).
// Never `applyLook`: worker.js rebuilds a scene from it for the standalone
// HTML page only (frame protocol 4); no page message may reach it here.
const IN = new Set(['load', 'setView', 'command', 'exportPng', 'exportPse', 'exportMol', 'exportLook', 'restoreSnapshot', 'runtimeAsset']);
// `cursor{mode}` (frame protocol 3, AgDB 2026-11-12) stays in the frame: the
// pointer shape the page's 「ポインタの形」 chips chose, drawn on this canvas
// by the browser, so PyMOL keeps every click, drag and wheel. Only the three
// names below; anything else is the plain arrow. The laser is the page's red
// dot as an image cursor (img-src data: is in the frame CSP).
const LASER = 'url("data:image/svg+xml,' + encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24'>" +
  "<circle cx='12' cy='12' r='10' fill='rgba(255,45,45,0.3)'/>" +
  "<circle cx='12' cy='12' r='5' fill='#ff2d2d' stroke='#ffffff' stroke-width='1.5'/></svg>") + '") 12 12, crosshair';
const CURSORS = { default: '', crosshair: 'crosshair', laser: LASER };
function onParent(e) {
  const d = e.data;
  if (d && d.type === 'cursor') {
    canvas.style.cursor = Object.prototype.hasOwnProperty.call(CURSORS, d.mode) ? CURSORS[d.mode] : '';
    return;
  }
  if (!d || !worker || !IN.has(d.type)) return;
  const transfer = []; if (d.bytes instanceof ArrayBuffer) transfer.push(d.bytes);
  worker.postMessage(d, transfer);
}
