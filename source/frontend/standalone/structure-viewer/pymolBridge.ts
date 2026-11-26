/**
 * The offline file's PyMOL: the runtime's `worker.js`, started as a blob Worker
 * on this page (no iframe, no `host.js`), driven through the worker's typed
 * protocol by this small bridge, with nothing that reaches a server.
 *
 * - Boot: the worker is ONE script the page builds (`workerSource`): a
 *   prelude, `pyodide.js`, the core `pyodide.asm.mjs` turned into a classic
 *   script that leaves its factory in `self.__AGDB_CORE_FACTORY`
 *   (`coreAsClassicScript`), then worker.js. The worker loads no script of
 *   its own: from a file:// page Chrome refuses it a blob: URL the page
 *   minted, and WebKit one the worker minted — from a file:// page and from
 *   a sandboxed frame alike (importScripts "Not allowed to load
 *   local resource", import() "Cross-origin script load denied"; measured
 *   2026-11-15 in Playwright's WebKit). The iPhone's PyMOL failed on the
 *   second. Before any of it, a worker's WebGL is probed
 *   (`workerGlAvailable`): a browser that cannot draw PyMOL's view is told
 *   so at once. The five runtime files are handed over keyed under a
 *   never-resolvable base and served by worker.js's own fetch shim.
 * - `ready` must report the restricted unpickler active, or the boot fails.
 * - Timing trap (measured 2026-11-13): a scene applied in the worker's first
 *   tick after `ready` leaves every later draw empty, so the scene waits for
 *   the first heartbeat plus 300 ms.
 * - Requests run one at a time, in order, each matched to the reply that ends
 *   it: a command to `progress{command}`, a load or a look to
 *   `progress{loaded}`, an export to its `png` / `mol` with the request's
 *   nonce; a non-fatal `error` ends the request in flight. Each carries
 *   `req`, and its deadline counts from the worker's `taken{req}` (until
 *   then a longer wait, `TAKE_WAIT_MS`: the tick may still be busy with
 *   earlier work; PT-9108 item 8). A request
 *   that outlives its deadline, a fatal error and Stop end the worker: PyMOL
 *   is started again on the last scene that loaded (a reply can never be
 *   matched to the wrong request, PT-9090 item 6) — except when that scene's
 *   own load ran out of time, which fails PyMOL instead of starting the same
 *   load again for ever, and a look that ran out of time, after which the
 *   plain structure is loaded (PT-9108 item 2). The whole start, the
 *   runtime's blocks included, has a deadline too (PT-9109 item 6).
 * - PyMOL's object panel (internal GUI) is on, but off
 *   from the start in a narrow view (`OBJECT_PANEL_MIN_VIEW_PX`, sent in
 *   `init`, so a phone never sees it come and go). The bridge keeps what it
 *   is (`objectPanel`, the button's pressed state): set by 「オブジェクト一覧」,
 *   by `set internal_gui` and by the menu's toggle; kept through a restart;
 *   and put back after File > Reinitialize, with the prompt off.
 * - The worker writes no recovery snapshots for this page (`snapshots:
 *   false`): nothing here reads them (PT-9090 item 10).
 * - Touch (the phone mode): the worker takes mouse buttons only, so the
 *   canvas turns touch gestures into them (`touchMouse.ts`) — one finger
 *   rotates, a pinch zooms, two fingers move the view; `zoomBy` and
 *   `fitAll` do the same without a gesture (WCAG 2.5.1).
 * - A `.pse` is saved only as PyMOL writes it from the live scene
 *   (`exportPse`, owner 2026-11-14). One the user opens from this computer
 *   (「ファイルを開く」) goes through the worker's restricted unpickler and
 *   RESTORE_PY (no movie, no wizard; PT-3031); `ready` must report that
 *   unpickler, or the boot fails.
 */
import { cancellableKind, type OpKind, type PymolBusy } from '../../src/pages/pymol-viewer/pymolBusy'
import type { MolFormat, RaySettings, UiState } from '../../src/pages/pymol-viewer/pymolFrameProtocol'
import { INTERNAL_GUI_TOGGLE } from '../../src/pages/pymol-viewer/pymolMenuData'
import { RUNTIME_SCRIPT_BLOCKS } from '../../src/pages/structure-html-export/standaloneFormat'
import { objectNameOf, type StructureDoc } from './localFile'
import { workerGlAvailable } from './noGl'
import { panelLayoutOf, type PanelLayout } from './panelGeometry'
import { objectActionCommand, objectsOf, type ObjectAction, type PymolObjects } from './pymolObjects'
import { seqReportOf, type SeqReport } from './pymolSeq'
import { TouchMouse, type MouseOp } from './touchMouse'

export type BridgePhase = 'off' | 'booting' | 'loading' | 'ready' | 'failed'

/** How the file's PyMOL scene came up. */
export type SceneSource = 'look' | 'look-failed' | 'view' | 'plain'

export interface BridgeState {
  phase: BridgePhase
  /** Why the last boot failed (worker text, one line), while `failed`. */
  failure: string | null
  /**
   * What the failure was, when the page words it itself (`failureReason`):
   * set with `failure`, never read from its text (PT-9308 item 5).
   */
  failureCode?: FailureCode | null
  busy: PymolBusy | null
  ui: UiState | null
  scene: SceneSource | null
  /** The look's refusal, when `scene` is `look-failed`. */
  lookError: string | null
  /** Bumped at every (re)start: a preset's note is about one run of PyMOL. */
  generation: number
  /** PyMOL's object panel is shown (「オブジェクト一覧」's pressed state); absent until PyMOL is first started. */
  objectPanel?: boolean
  /**
   * How wide PyMOL draws its object panel, in CSS px, as the worker last
   * reported it (`guiwidth`): its width setting times the display scale, in
   * the drawing buffer's pixels, brought to the canvas's CSS width. Absent
   * until the first report (`objectPanelWidth()` then estimates it).
   */
  objectPanelWidth?: number
  /**
   * The object panel's rows and buttons as the worker last reported them
   * (`guiwidth`'s geometry, device px; `panelGeometry.ts`): the page marks
   * the button under the mouse with it. Absent until the first report.
   */
  objectPanelLayout?: PanelLayout
  /** PyMOL's mouse mode (`button_mode_name`) as the worker last reported it: the 「🖱 マウス操作」 card says another one. */
  mouseMode?: string
  /**
   * What moves the view as the worker last reported it (`guiwidth`'s `rk`
   * and `sp`; owner 2026-11-21, the page's motion button): PyMOL's rock on
   * or off, and the page's steady turn in degrees a second (0: none). A
   * restart clears it: a new PyMOL moves nothing.
   */
  motion?: Motion
  /**
   * The sequence the page shows (`seq`; `pymolSeq.ts`), as the worker last
   * sent it while the page wanted it. A restart clears it.
   */
  seq?: SeqReport
  /**
   * PyMOL's objects and selections as the worker last listed them
   * (`objects`; `pymolObjects.ts`): the phone's object list. Cleared at
   * every (re)start, so no action is sent against a list from an earlier run.
   */
  objects?: PymolObjects
  /**
   * The last generation that reached ready, set by the bridge with that
   * patch: a failure in it is a stop, not a failed start — known even when
   * React never rendered the ready state (PT-9229 item 7).
   */
  readyGeneration?: number
}

export interface BridgeInputs {
  base: string
  /** The runtime files, keyed by name under `base`. */
  handed: readonly string[]
  readBlock: (name: string) => Promise<ArrayBuffer>
  readText: (name: string) => Promise<string>
  /** The structure the file opens on (its embedded mmCIF), or null for a blank file. */
  doc: StructureDoc | null
  /** The PyMOL look (`pymol-look` block), already checked by `parsePymolLook`; for the embedded structure only. */
  lookBytes: ArrayBuffer | null
  /** 18 numbers to open at when there is no look; for the embedded structure only. */
  view: readonly number[] | null
  /**
   * The look's object names, hidden ones too: what the scene holds once the
   * look is applied, so a file added later never lands in one of them as a
   * new state (PT-9220 item 5).
   */
  lookObjects?: readonly string[]
  /**
   * A PyMOL session the file was saved with (`pymol-session`, owner
   * 2026-11-16): what PyMOL loads for `doc` — its own view and look, in place
   * of the structure, `lookBytes` and `view`. `doc` stays the scene's
   * document, so a refused file falls back to the structure the page shows,
   * never to the session (PT-9552 item 1).
   */
  session?: StructureDoc | null
  /** PyMOL's object name for `doc`, the file's own structure (`docObjectName`); `Structure` when unset. */
  docObject?: string
}

/**
 * PyMOL's object name for the file's own structure (owner 2026-11-21:
 * 「『Structure』となっていて分かりにくい」, the label 『Structure_25HN』):
 * `Structure_` and the PDB ID (or the code) it carries, else `Structure`.
 * PyMOL names take no spaces or brackets, and worker.js keeps letters,
 * digits and `_` only (`workerObjectName`), so the tag is cut to those.
 */
export function docObjectName(tag: string | null | undefined): string {
  const t = (tag ?? '').replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30)
  return t === '' ? 'Structure' : `Structure_${t}`
}

/**
 * Shown in the command line's place while PyMOL is not ready (the controller's own words).
 * This one and the teardown reasons (`the PyMOL frame was …`) stay PyMOL's: they are the
 * shared controller's codes, which the command line and dialogs match to their own words
 * (`pymolCommandText.ts`, `PymolCommandLine`'s FRAME_GONE), never shown as they are.
 */
const NOT_READY = 'PyMOL is not ready'
/** A failure the page words itself: `no-worker-gl`, a worker got no WebGL (`workerGlAvailable` said false). */
export type FailureCode = 'no-worker-gl'

/** The `no-worker-gl` failure's own text (the probe's log, a page without the page's words). */
export const NO_WORKER_GL = 'this browser gives a worker no WebGL (OffscreenCanvas), which this mode draws with'

/** A boot that stopped for a failure the page words itself. */
class CodedFailure extends Error {
  constructor(
    readonly code: FailureCode,
    message: string,
  ) {
    super(message)
  }
}

/** A failure's reason as the page shows it: a coded one in the page's words, any other as PyMOL gave it. */
export const failureReason = (state: Pick<BridgeState, 'failure' | 'failureCode'>, t: (key: string) => string): string =>
  state.failureCode === 'no-worker-gl' ? t('htmlExport:sa_pymol_reason_no_worker_gl') : (state.failure ?? '')

const BOOT_TIMEOUT_MS = 180_000
const LOAD_TIMEOUT_MS = 120_000
const COMMAND_TIMEOUT_MS = 120_000
/** A ray at 4096 px with shadows takes minutes in wasm. */
const EXPORT_TIMEOUT_MS = 300_000
/**
 * How long a request may wait for the worker's `taken`: the tick runs one
 * task at a time and may still be busy with earlier work (a deferred surface
 * build, what PyMOL's own menus started), so the request's own deadline
 * counts from `taken`; the same grace as `POST_OP_GRACE_MS`.
 */
const TAKE_WAIT_MS = 300_000
/** `log.s` / `error.s` as kept, as the frame protocol's `LIMITS.textChars`. */
const TEXT_CHARS = 4000
/** Errors from the worker's own loop or hooks, never charged to the request in flight. */
const UNSOLICITED_ERROR = /^(tick: |worker error: |worker unhandledrejection: )/

/**
 * The page's start settings, sent once PyMOL has loaded and again after File >
 * Reinitialize: PyMOL's own prompt (the line inside the view) away, and its
 * mouse box's grid of buttons (owner 2026-11-19:
 * 「Mouse Modeの行からDblClkまでは不要」; the page's 「🖱 マウス操作」 says
 * it in words). The `_ ` prefix keeps PyMOL from echoing a command into the
 * view's feedback line (PT-9116 item 2); one Python line, no `;`, and
 * `cmd.set` is quiet. Neither setting is saved into a `.pse` (PyMOL's session
 * blacklist), so a session taken to desktop PyMOL keeps its own.
 */
export const INTERNAL_PROMPT_OFF = "_ /[cmd.set(n, 0) for n in ('internal_prompt', 'mouse_grid')]"

/**
 * The start settings in 「オリジナル表示」 (owner 2026-11-20: the object panel
 * as v1.0.0 had it): the prompt away as ever, the mouse box's grid kept.
 */
export const INTERNAL_PROMPT_OFF_ORIGINAL = "_ /[cmd.set(n, v) for n, v in (('internal_prompt', 0), ('mouse_grid', 1))]"

/** What moves the view, as the worker reports it (`PymolControlTail` shows it). */
export interface Motion {
  /** PyMOL's rock is on (the page's, or the user's own). */
  rock: boolean
  /** The page's rock speed (1, 2 or 4) while the rock is the page's; 0 otherwise. */
  rockSpeed: number
  /** The page's steady turn, degrees a second (0: none). */
  spin: number
}

/**
 * What moves the view in a `guiwidth` report (`rk` 0 or 1, `rs` the page's
 * rock speed, `sp` degrees a second), or null when it says nothing sane. A
 * worker before `rs` says the rock speed is unknown: 0.
 */
export function motionOf(m: Record<string, unknown>): Motion | null {
  const { rk, rs, sp } = m
  if ((rk !== 0 && rk !== 1) || typeof sp !== 'number' || !Number.isFinite(sp) || Math.abs(sp) > 720) return null
  const rockSpeed = typeof rs === 'number' && Number.isFinite(rs) && rs >= 0 && rs <= 8 ? rs : 0
  return { rock: rk === 1, rockSpeed, spin: sp }
}

/** The page's motion stopped and forgotten after File > Reinitialize: no turn, no rock settings to put back (PT-10648 item 7). */
export const MOTION_RESET = '_ /_agdb_motion_reset()'

/** The mouse box's grid shown (「オリジナル表示」) or not, quiet and not echoed. */
export const mouseGridCommand = (on: boolean): string => `_ /cmd.set('mouse_grid', ${on ? 1 : 0})`

/**
 * Shows (`true`) or hides PyMOL's object panel (the internal GUI right of the
 * view), not echoed. A set, not a flip, so the bridge always knows which it
 * is (PT-9113 items 1, 4).
 */
export const objectPanelCommand = (shown: boolean): string => `_ set internal_gui, ${shown ? 1 : 0}`

/**
 * Below this view width (CSS px) PyMOL opens with its object panel hidden:
 * the panel keeps 220 px × the display scale, which on a phone leaves almost
 * nothing of the view (「オブジェクト一覧」 brings it back).
 */
export const OBJECT_PANEL_MIN_VIEW_PX = 640

/** PyMOL's own `internal_gui_width` default, in its device-independent pixels. */
export const OBJECT_PANEL_DEFAULT_WIDTH = 220

/**
 * The object panel's width in CSS px before the worker has said it (or if it
 * never does): PyMOL's default width times the display scale, which is DPR
 * rounded unless the user chose one, over the DPR (the backing store is
 * CSS px × DPR).
 */
export function estimatedPanelWidth(dpr: number, scale?: number): number {
  const d = dpr > 0 && Number.isFinite(dpr) ? dpr : 1
  const dsf = scale !== undefined && scale >= 1 ? scale : Math.max(1, Math.round(d))
  return (OBJECT_PANEL_DEFAULT_WIDTH * dsf) / d
}

/**
 * The panel's CSS width from the worker's report: `px` device pixels of a
 * buffer `bw` wide, drawn on a canvas `cssWidth` CSS px wide. Null for a
 * report that is not two finite counts.
 */
export function panelCssWidth(px: unknown, bw: unknown, cssWidth: number): number | null {
  if (typeof px !== 'number' || typeof bw !== 'number' || !Number.isFinite(px) || !Number.isFinite(bw) || px < 0 || bw < 1) return null
  if (!(cssWidth > 0)) return null
  return (px * cssWidth) / bw
}

/**
 * The camera brought to `factor` times its distance (below 1 zooms in):
 * view[11] is the camera's z, negative, and `move z` by a positive amount
 * brings it closer (measured in headless Chrome, 2026-11-14).
 */
export const zoomCommand = (factor: number): string => `_ /cmd.move('z', cmd.get_view()[11]*(${factor}-1))`
/** Everything in view again, centred (「全体表示」). */
export const FIT_ALL = '_ zoom'

/**
 * A command that changes the view's layout — the object panel or the
 * feedback lines (`internal_gui`, `internal_feedback`, whole words) — is
 * followed by a re-layout (ADR-0049: reshape after a GUI switch); PT-9114
 * item 8. So are the display scale and the mouse box's grid (2026-11-20,
 * measured in headless Chrome): PyMOL sizes the panel's lower blocks only
 * when it lays the view out, so after either alone the mouse box kept its
 * old place under text of the new size, overlapping. A setting given by its
 * number (`set 4, 0`) is not recognised: the view is then laid out at the
 * next resize.
 */
const LAYOUT_SETTING = /\binternal_(?:gui|feedback)\b|\bdisplay_scale_factor\b|\bmouse_grid\b/
/**
 * File > Reinitialize, as PyMOL's parser takes it: any prefix of the command
 * word down to `reini` (PT-9116 item 8). It may put settings back to PyMOL's
 * defaults, so the page's start settings — the prompt off, the panel as it
 * was — are sent again after it (PT-9116 items 1, 5, 7).
 */
const REINITIALIZE = /(?:^|[;\s/.(])reini(?:t(?:i(?:a(?:l(?:i(?:z(?:e)?)?)?)?)?)?)?(?![A-Za-z0-9_])/
/** `set internal_gui, N` as typed: the panel's new state, read off the command. */
const SET_PANEL = /^\s*_?\s*set\s+internal_gui\s*,\s*([01])\s*$/

const toError = (e: unknown): Error => (e instanceof Error ? e : new Error(String(e)))

/** The object name worker.js gives a load (`load`'s `obj`, sanitised and cut at 40 characters). */
export const workerObjectName = (name: string): string => name.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 40) || 'mol'

/**
 * A document PyMOL refused (`openDocument`'s rejection): `shown` is the
 * scene PyMOL went back to, so the page can show the same one (PT-9228
 * items 3, 4).
 */
export class DocRefused extends Error {
  constructor(
    message: string,
    readonly shown: StructureDoc | null,
  ) {
    super(message)
  }
}

/**
 * A request a teardown took out of the queue before it was posted: the worker
 * never saw it, so it says nothing about what it carried (PT-9220 item 2).
 * The message is the teardown's, as for the request in flight.
 */
class NotSent extends Error {}

/** A refused scene: `fallback` when it was the last scene that loaded, so nothing is left to go back to. */
class SceneRefused extends Error {
  constructor(
    message: string,
    readonly fallback: boolean,
  ) {
    super(message)
  }
}

type WorkerMsg = { type: string; [k: string]: unknown }

/** Posts one message for the request in flight, `req` added. */
type Post = (msg: Record<string, unknown>, transfer?: Transferable[]) => void

interface Op {
  kind: OpKind
  label: string | null
  mine: boolean
  timeoutMs: number
  /** Posts the request; the nonce is the request's own. */
  post: (post: Post, nonce: string) => void
  /** `done` with a value ends it, `error` fails it, null is not its reply. */
  match: (m: WorkerMsg, nonce: string) => { done: unknown } | { error: Error } | null
  /** Runs when it succeeds, before the next request is posted (a re-layout must reach the worker first). */
  before?: () => void
  /** The scene's look: one that runs out of time is not applied again. */
  look?: boolean
  /** A request of the scene load (`loadScene`): only one posted is charged to the document it loads (PT-9220 item 2). */
  scene?: boolean
  /** Told once the request is posted to the worker: Stop acts on it from then on (an export dialog, PT-9232 item 2). */
  onSent?: () => void
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  signal?: AbortSignal
}

/** A runtime script's file name, from the table the exporter embeds them by (`RUNTIME_SCRIPT_BLOCKS`). */
function scriptFile(block: string): string {
  const hit = RUNTIME_SCRIPT_BLOCKS.find(([, b]) => b === block)
  if (hit === undefined) throw new Error(`no runtime script is embedded as ${block}`)
  return hit[0]
}
const PYODIDE_JS_FILE = scriptFile('pyodide-js')
const CORE_FILE = scriptFile('pyodide-core')

/**
 * Runs first in the worker: `pyodide.js` is already in the worker's script,
 * so worker.js's `importScripts` of it loads nothing (see the header).
 * Internal to `workerSource`; exported for its test only.
 */
export function workerPrelude(base: string): string {
  return (
    '(function () {\n' +
    '  var orig = self.importScripts.bind(self), INLINE = ' + JSON.stringify(base + PYODIDE_JS_FILE) + ';\n' +
    // Pyodide probes for a classic worker with importScripts("data:...") and
    // refuses to run in one; refusing the probe makes it take the module
    // worker's path, where the core comes from createPyodideModule.
    '  self.importScripts = function () {\n' +
    '    var urls = Array.prototype.filter.call(arguments, function (u) { u = String(u); if (u.indexOf("data:") === 0) throw new Error("data: scripts are refused here"); return u !== INLINE; });\n' +
    '    if (urls.length > 0) return orig.apply(self, urls);\n' +
    '  };\n' +
    '})();\n'
  )
}

/** The core's one export, as its last statement: what `coreAsClassicScript` turns into a value. */
const CORE_EXPORT = 'export default _createPyodideModule;'

/**
 * The core (`pyodide.asm.mjs`, an Emscripten ES module) as a classic script
 * that leaves its factory in `self.__AGDB_CORE_FACTORY`, for worker.js's
 * `importCore`. Its one export is its last statement and `import.meta.url`
 * its only other module-only syntax: the URL becomes `coreUrl`, the core's
 * own address. Strict, as a module is. Throws on a core of
 * another shape (a runtime bump is caught by `pymolBridge.test.ts`, which
 * converts the vendored core).
 */
export function coreAsClassicScript(core: string, coreUrl: string): string {
  const body = core.trimEnd()
  if (!body.endsWith(CORE_EXPORT)) throw new Error("its core does not end with its export")
  const src = body.slice(0, -CORE_EXPORT.length).split('import.meta.url').join(JSON.stringify(coreUrl))
  if (/\bimport\.meta\b|\bexport\s+default\b/.test(src)) throw new Error("its core has module syntax this page cannot convert")
  return `self.__AGDB_CORE_FACTORY = (function () {\n'use strict';\n${src}\nreturn _createPyodideModule;\n})();\n`
}

/** A source-map comment: one that ends a part would sit inside the joined script, pointing at no map. */
const SOURCE_MAP_LINE = /^\/\/# sourceMappingURL=.*$/gm

/**
 * The worker's whole script: the prelude, `pyodide.js` (strict in its own
 * function, as when it is loaded on its own; it sets `loadPyodide` on the
 * global itself), the converted core, then worker.js.
 */
export function workerSource(base: string, pyodideJs: string, core: string, workerJs: string): string {
  return [
    workerPrelude(base),
    `(function () {\n${pyodideJs.replace(SOURCE_MAP_LINE, '')}\n}).call(self);\n`,
    coreAsClassicScript(core, base + CORE_FILE),
    workerJs,
  ].join('\n')
}

const text = (v: unknown): string => String(v ?? '').slice(0, TEXT_CHARS)
const SPECIAL: Readonly<Record<string, number>> = { ArrowLeft: 100, ArrowUp: 101, ArrowRight: 102, ArrowDown: 103, PageUp: 104, PageDown: 105, Home: 106, End: 107, Insert: 108 }
const CTRL_KEYS: Readonly<Record<string, number>> = { Enter: 13, Backspace: 8, Escape: 27, Delete: 127 }
const own = (o: Readonly<Record<string, number>>, k: string): number | undefined => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined)

function uiStateOf(m: WorkerMsg): UiState {
  const wizard = m.wizard === 'measurement' || m.wizard === 'other' ? m.wizard : null
  return {
    sel: typeof m.sel === 'string' ? m.sel.slice(0, 200) : null,
    atoms: typeof m.atoms === 'number' && Number.isFinite(m.atoms) ? m.atoms : null,
    runs: null,
    more: m.more === true,
    shown: typeof m.shown === 'number' ? m.shown | 0 : 0,
    hetero: m.hetero === true,
    wizard,
  }
}

export class StandalonePymol {
  private state: BridgeState = { phase: 'off', failure: null, busy: null, ui: null, scene: null, lookError: null, generation: 0 }
  private listeners = new Set<() => void>()
  private worker: Worker | null = null
  private canvas: HTMLCanvasElement | null = null
  private resizeObserver: ResizeObserver | null = null
  private backing = { w: 0, h: 0, dpr: 1 }
  private transferred = false
  private buttonsDown = 0
  private queue: Op[] = []
  private inflight: { op: Op; nonce: string; req: number; taken: boolean; timer: ReturnType<typeof setTimeout>; startedAt: number } | null = null
  private reqSeq = 0
  /** One-shot waits of the boot (ready, the first heartbeat). */
  private waiters: { pred: (m: WorkerMsg) => boolean; resolve: (m: WorkerMsg) => void; reject: (e: Error) => void }[] = []
  private nonceSeq = 0
  private disposed = false
  private lastView: number[] | null = null
  private readonly onWindowMouseUp = (e: MouseEvent) => {
    if (!this.worker || this.buttonsDown === 0) return
    this.buttonsDown = Math.max(0, this.buttonsDown - 1)
    const [x, y] = this.xy(e)
    this.worker.postMessage({ type: 'button', b: this.button(e), state: 1, x, y, mods: this.mods(e) })
  }

  private host: HTMLElement | null = null

  /** The scene PyMOL (re)loads: the file's own at first, then the last file opened with 「ファイルを開く」. */
  private doc: StructureDoc | null
  private lookBytes: ArrayBuffer | null
  private view: readonly number[] | null
  /** A document arrived while PyMOL was starting: loaded again once the start's own load is done. */
  private docChanged = false
  /** The last scene PyMOL loaded: what a refused document falls back to. */
  private loaded: { doc: StructureDoc | null; lookBytes: ArrayBuffer | null; view: readonly number[] | null } | null = null
  /** `openDocument` calls waiting for their document to load or be refused. */
  private docWaiters: { doc: StructureDoc; resolve: () => void; reject: (e: Error) => void }[] = []
  /** Object names this page gave PyMOL since the last scene load (`addDocument`), as worker.js names them, lower-cased. */
  private objectNames = new Set<string>()
  /** The document the running scene load is loading, or null when none runs. */
  private loadTarget: StructureDoc | null = null
  /** Why the file's look is no longer applied (it ran out of time), or null. */
  private lookSkipped: string | null = null
  /** The object panel as the user last left it, or null: the width rule decides. */
  private panelWanted: boolean | null = null
  /** 「オリジナル表示」: the mouse box keeps its grid (`setOriginalPanel`). */
  private original = false
  /** The grid as last sent to this PyMOL (null before its start settings): a switch while it loads is sent after. */
  private gridSent: boolean | null = null
  /** The page is in its phone layout (`setDocked`): PyMOL's object panel stays hidden. */
  private docked = false
  /** The phone layout hid a panel the desktop layout showed: leaving it shows the panel again. */
  private dockHid = false
  /**
   * The panel as the last 「オブジェクト一覧」 still waiting in the queue
   * leaves it, or null when none waits: a second press flips that, not the
   * state the first has not changed yet (PT-9220 item 3).
   */
  private panelNext: boolean | null = null
  private panelSeq = 0

  constructor(
    private readonly inputs: BridgeInputs,
    private readonly canvasLabel: () => string,
  ) {
    this.doc = inputs.doc
    this.lookBytes = inputs.lookBytes
    this.view = inputs.view
    window.addEventListener('mouseup', this.onWindowMouseUp)
  }

  /**
   * Shows `doc` instead of what PyMOL shows now (「ファイルを開く」): the
   * exported look and view belong to the file's own structure and go with it.
   * A `.pse` replaces the whole session. Kept for a restart (Stop) too.
   */
  openDocument = (doc: StructureDoc): Promise<void> => {
    this.doc = doc
    this.lookBytes = null
    this.view = null
    // Settles when PyMOL has this document — at once if ready, after the
    // load in progress if starting or loading, at the next start if off —
    // and rejects with PyMOL's reason when it refuses it. One a newer
    // document replaced before it loaded resolves quietly (PR #8239 review).
    const settled = new Promise<void>((resolve, reject) => this.docWaiters.push({ doc, resolve, reject }))
    if (this.state.phase === 'ready') void this.reloadScene().catch(() => undefined)
    else if (this.state.phase === 'booting' || this.state.phase === 'loading') this.docChanged = true
    // The documents this one replaced are settled now, but the one a running
    // load is loading — none while PyMOL is off or failed — so no waiter
    // keeps an earlier file's bytes alive until PyMOL next starts (PT-9135 item 1).
    this.resolveReplaced(this.loadTarget)
    return settled
  }

  /** Resolves, quietly, the waiters of every document but `this.doc` and `keep`. */
  private resolveReplaced(keep: StructureDoc | null): void {
    const left: typeof this.docWaiters = []
    for (const w of this.docWaiters) {
      if (w.doc === this.doc || w.doc === keep) left.push(w)
      else w.resolve()
    }
    this.docWaiters = left
  }

  /** Settles the `openDocument` calls for `doc` (with `err` when refused), and those a newer document replaced. */
  private settleDocs(doc: StructureDoc | null, err: Error | null): void {
    const keep: typeof this.docWaiters = []
    for (const w of this.docWaiters) {
      if (w.doc === doc) {
        if (err === null) w.resolve()
        else w.reject(err)
      } else if (w.doc !== this.doc) w.resolve()
      else keep.push(w)
    }
    this.docWaiters = keep
  }

  /**
   * Adds `doc` to what PyMOL shows, as one more object (PyMOL's File > Open):
   * not kept for a restart, which goes back to the last document opened.
   */
  addDocument = (doc: StructureDoc): Promise<void> => {
    if (doc.ext === 'pse') return Promise.reject(new Error('a session replaces the scene'))
    const bytes = doc.bytes.slice(0)
    // Never an object already there: PyMOL would add the file as a state of
    // it. Compared as worker.js names it — `a-b` and `a_b` are one object, and
    // a suffix is kept inside its 40 characters (PT-9135 item 5).
    const base = workerObjectName(objectNameOf(doc.stem))
    let obj = base
    for (let n = 2; this.objectNames.has(obj.toLowerCase()); n++) obj = `${base.slice(0, 40 - `_${n}`.length)}_${n}`
    const key = obj.toLowerCase()
    this.objectNames.add(key)
    const names = this.objectNames
    return this.enqueue<void>({
      kind: 'load',
      label: null,
      mine: true,
      timeoutMs: LOAD_TIMEOUT_MS,
      post: post => post({ type: 'load', format: doc.ext, obj, bytes, replace: false }, [bytes]),
      match: m => (m.type === 'progress' && m.phase === 'loaded' ? { done: undefined } : null),
    }).catch((e: unknown) => {
      // A file PyMOL did not add leaves its name free (PT-9134 item 6).
      names.delete(key)
      throw e
    })
  }

  /** Where the canvas goes (the PyMOL pane's stage); needed before `start`. */
  attach(host: HTMLElement): void {
    this.host = host
  }

  // ---- state ------------------------------------------------------------------

  getState = (): BridgeState => this.state
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  private patch(p: Partial<BridgeState>): void {
    this.state = { ...this.state, ...p }
    for (const fn of this.listeners) fn()
  }
  private patchBusy(): void {
    const f = this.inflight
    const queued = this.queue.length
    const busy: PymolBusy | null =
      f === null
        ? null
        : {
            kind: f.op.kind,
            label: f.op.label,
            startedAt: f.startedAt,
            queued,
            queuedCancels: this.queue.filter(o => o.mine).length,
          }
    this.patch({ busy })
  }

  /** The last 18-number view PyMOL reported. */
  currentView(): number[] | null {
    return this.lastView === null ? null : this.lastView.slice()
  }

  /** The view's size in device pixels (the ray dialog's multiples). */
  viewSize(): { w: number; h: number } | null {
    const r = this.canvas?.getBoundingClientRect()
    if (!r || r.width < 1 || r.height < 1) return null
    const dpr = window.devicePixelRatio || 1
    return { w: Math.round(r.width * dpr), h: Math.round(r.height * dpr) }
  }

  // ---- requests ------------------------------------------------------------------

  private enqueue<T>(op: Omit<Op, 'resolve' | 'reject'>): Promise<T> {
    if (this.state.phase !== 'ready' && op.mine) return Promise.reject(new Error(NOT_READY))
    return new Promise<T>((resolve, reject) => {
      const full: Op = { ...op, resolve: v => resolve(v as T), reject }
      if (op.signal) {
        if (op.signal.aborted) {
          reject(new Error('withdrawn'))
          return
        }
        op.signal.addEventListener(
          'abort',
          () => {
            const i = this.queue.indexOf(full)
            if (i >= 0) {
              this.queue.splice(i, 1)
              reject(new Error('withdrawn'))
              this.patchBusy()
            }
          },
          { once: true },
        )
      }
      this.queue.push(full)
      this.pump()
    })
  }

  private pump(): void {
    if (this.inflight !== null || this.worker === null) {
      this.patchBusy()
      return
    }
    const op = this.queue.shift()
    if (op === undefined) {
      this.patchBusy()
      return
    }

    const nonce = `n${++this.nonceSeq}`
    const req = ++this.reqSeq
    // Until the worker takes it, the longer of its own deadline and the take wait.
    const timer = setTimeout(() => this.deadline(op), Math.max(op.timeoutMs, TAKE_WAIT_MS))
    this.inflight = { op, nonce, req, taken: false, timer, startedAt: Date.now() }
    this.patchBusy()
    const worker = this.worker
    try {
      op.post((msg, transfer) => worker.postMessage({ ...msg, req }, transfer ?? []), nonce)
    } catch (e) {
      this.finish(null, toError(e))
      return
    }
    try {
      op.onSent?.()
    } catch {
      // A caller's notice must not stop the queue.
    }
  }

  private finish(value: unknown, error: Error | null): void {
    const f = this.inflight
    if (f === null) return
    clearTimeout(f.timer)
    this.inflight = null
    if (error === null) {
      try {
        f.op.before?.()
      } catch {
        // A re-layout that could not be posted changes nothing the request did.
      }
      f.op.resolve(value)
    } else f.op.reject(error)
    this.pump()
  }

  /**
   * A request past its deadline. The worker is ended and PyMOL started again
   * on the last scene that loaded — unless the load that ran out of time is
   * that scene itself, which would only run out again: PyMOL is failed with
   * the reason, and Retry is the user's (PT-9108 item 2). A look that ran
   * out of time is not applied again: the plain structure is loaded.
   */
  private deadline(op: Op): void {
    if (this.inflight?.op !== op) return
    const s = Math.round(op.timeoutMs / 1000)
    if (op.look === true) {
      this.lookSkipped = `look: not applied in ${s} s`
      this.restart('timeout')
      return
    }
    const target = this.loadTarget
    if (op.kind === 'load' && !op.mine && target !== null && target === this.fallbackDoc()) {
      this.fail(`it did not load ${target.name} in ${s} s`)
      return
    }
    this.restart('timeout')
  }

  /** The document a refused one falls back to: the last scene that loaded, or the file's own. */
  private fallbackDoc(): StructureDoc | null {
    return this.loaded !== null ? this.loaded.doc : this.inputs.doc
  }

  /**
   * The document PyMOL's scene is of: the last one loaded, or — before any
   * loaded — the one it will load. The save dialog offers PyMOL's session
   * only while this is the page's own document (PT-9552 item 2).
   */
  sceneDoc(): StructureDoc | null {
    return this.loaded !== null ? this.loaded.doc : this.doc
  }

  /** A command, as the command line, the menu and the presets send it. */
  runCommand = (cmd: string, opts?: { label?: string; page?: boolean }): Promise<void> =>
    this.enqueue<void>({
      kind: 'command',
      label: opts?.label ?? (opts?.page ? null : cmd.slice(0, 200)),
      mine: !opts?.page,
      timeoutMs: COMMAND_TIMEOUT_MS,
      post: post => post({ type: 'command', cmd }),
      match: m => (m.type === 'progress' && m.phase === 'command' ? { done: undefined } : null),
      before: this.afterCommand(cmd),
    })

  /**
   * What follows a command before the next request goes: the object panel's
   * state as the command left it, then a re-layout when it changed the
   * view's layout (posted ahead of the next request, PT-9114 item 5). After
   * a reinitialize, the page's start settings again, first in the queue.
   */
  private afterCommand(cmd: string): (() => void) | undefined {
    if (REINITIALIZE.test(cmd)) return () => this.restoreStart()
    const set = SET_PANEL.exec(cmd)
    const panel = set !== null ? set[1] === '1' : cmd === INTERNAL_GUI_TOGGLE ? 'flip' : null
    const layout = LAYOUT_SETTING.test(cmd)
    if (panel === null && !layout) return undefined
    return () => {
      if (panel !== null) {
        const shown = panel === 'flip' ? this.state.objectPanel !== true : panel
        this.panelWanted = shown
        this.patch({ objectPanel: shown })
      }
      if (layout) this.reshape()
    }
  }

  /** The page's start settings again (after File > Reinitialize): the prompt off, the panel as it was. */
  private restoreStart(): void {
    const shown = this.state.objectPanel !== false
    // First in line, so nothing queued meanwhile runs on PyMOL's defaults;
    // the panel's command re-lays the view out.
    this.queue.unshift(this.pageCommandOp(this.startCommand()), this.pageCommandOp(objectPanelCommand(shown)), this.pageCommandOp(MOTION_RESET))
  }

  /** A page command no caller waits for (its failure says nothing to anyone). */
  private pageCommandOp(cmd: string): Op {
    return {
      kind: 'command',
      label: null,
      mine: false,
      timeoutMs: COMMAND_TIMEOUT_MS,
      post: post => post({ type: 'command', cmd }),
      match: m => (m.type === 'progress' && m.phase === 'command' ? { done: undefined } : null),
      before: this.afterCommand(cmd),
      resolve: () => undefined,
      reject: () => undefined,
    }
  }

  /**
   * Shows or hides PyMOL's object panel (「オブジェクト一覧」). Never rejects:
   * a Stop or a restart that ends it leaves the panel as the restart sets it
   * (PT-9114 item 4, PT-9116 item 6).
   */
  toggleObjectPanel = (): Promise<void> => this.setObjectPanel(!this.panelIntended())

  /**
   * Shows (`true`) or hides PyMOL's object panel, whatever it is now: the
   * drawer tab's swipe, which says which way it wants the panel rather than
   * flipping it. Against the panel as already asked for (a command still
   * queued counts), so two quick swipes the same way change it once
   * (PT-9400 item 1). Never rejects, as `toggleObjectPanel`.
   */
  setObjectPanel = (shown: boolean): Promise<void> => {
    if (shown === this.panelIntended()) return Promise.resolve()
    this.panelNext = shown
    const seq = ++this.panelSeq
    return this.runCommand(objectPanelCommand(shown), { page: true })
      .catch(() => undefined)
      .finally(() => {
        if (this.panelSeq === seq) this.panelNext = null
      })
  }

  /**
   * The page's layout: the phone layout (`true`) hides PyMOL's object panel
   * and lists the objects itself (owner 2026-11-19); leaving it shows the
   * panel again if the phone layout hid it. Read again at every start.
   */
  setDocked = (docked: boolean): void => {
    if (this.docked === docked) return
    this.docked = docked
    if (this.state.phase === 'off') return
    if (docked) {
      if (!this.panelIntended()) return
      this.dockHid = true
      void this.setObjectPanel(false)
    } else if (this.dockHid) {
      this.dockHid = false
      void this.setObjectPanel(true)
    }
  }

  /**
   * Does `action` to entry `index` of the object list (−1: every object),
   * against the list the page has; resolves once PyMOL ran it, and the list
   * it reports then is already in `objects`. Nothing is sent without a list,
   * and the worker refuses a list that changed meanwhile. Never rejects.
   */
  objectAction = (index: number, action: ObjectAction): Promise<void> => {
    const list = this.state.objects
    const cmd = list === undefined ? null : objectActionCommand(list.v, index, action)
    if (cmd === null) return Promise.resolve()
    return this.runCommand(cmd, { page: true }).catch(() => undefined)
  }

  /**
   * 「オリジナル表示」 (owner 2026-11-20: the object panel as v1.0.0 had it):
   * PyMOL's mouse box keeps its grid of buttons, at the start and after File >
   * Reinitialize too, and sets it now when PyMOL is up. The phone layout's
   * object panel itself follows `setDocked`, which the page calls with
   * docked only where its own list replaces the panel.
   */
  setOriginalPanel = (on: boolean): void => {
    if (this.original === on) return
    this.original = on
    if (this.state.phase === 'ready') this.sendGrid()
  }

  /** The grid as 「オリジナル表示」 has it, when PyMOL has the other (after a switch while a file loaded: PT-10132 items 3, 7). */
  private sendGrid(): void {
    if (this.gridSent === null || this.gridSent === this.original) return
    this.gridSent = this.original
    void this.runCommand(mouseGridCommand(this.original), { page: true }).catch(() => undefined)
  }

  /** The page's start settings: the prompt away, and the mouse grid as 「オリジナル表示」 has it. */
  private startCommand(): string {
    this.gridSent = this.original
    return this.original ? INTERNAL_PROMPT_OFF_ORIGINAL : INTERNAL_PROMPT_OFF
  }

  /** The object panel as last asked for: a press still queued, else as PyMOL has it. */
  private panelIntended(): boolean {
    return this.panelNext ?? this.state.objectPanel === true
  }

  /** Zooms in (`factor` below 1) or out without a gesture (the phone's buttons). */
  zoomBy = (factor: number): Promise<void> => this.runCommand(zoomCommand(factor), { page: true })

  /** Everything in view again, centred. */
  fitAll = (): Promise<void> => this.runCommand(FIT_ALL, { page: true })

  /** Lays the view out again at its current size (after the object panel came or went). */
  private reshape(): void {
    const b = this.backing
    if (this.worker !== null && b.w > 0 && b.h > 0) this.worker.postMessage({ type: 'resize', w: b.w, h: b.h, dpr: b.dpr })
  }

  /**
   * The view as PyMOL draws it (the screenshot), `scale` times its pixels on
   * a side (2–4; the worker lays the view out that much larger for the read
   * and back: owner 2026-11-20), or the ray-traced picture.
   */
  exportPng = (opts: { ray: boolean; w?: number; h?: number; settings?: RaySettings; scale?: number }): Promise<{ bytes: ArrayBuffer; w: number; h: number }> =>
    this.enqueue({
      kind: 'export',
      label: null,
      mine: true,
      timeoutMs: EXPORT_TIMEOUT_MS,
      post: (post, nonce) =>
        post(
          opts.ray
            ? { type: 'exportPng', nonce, ray: true, w: opts.w, h: opts.h, settings: opts.settings }
            : opts.scale !== undefined && opts.scale > 1
              ? { type: 'exportPng', nonce, scale: opts.scale }
              : { type: 'exportPng', nonce },
        ),
      match: (m, nonce) =>
        m.type === 'png' && m.nonce === nonce && m.bytes instanceof ArrayBuffer
          ? { done: { bytes: m.bytes, w: Number(m.w) || 0, h: Number(m.h) || 0 } }
          : null,
    })

  /**
   * The molecule file of a selection — the shape `PymolExportDialog` asks its
   * controller for (`requestExport('mol', …)`), so the dialog is used
   * unchanged. `onSent` is told when the request is posted (PT-9232 item 2).
   */
  requestExport = (
    kind: 'mol',
    opts: { format: MolFormat; selection: string; signal?: AbortSignal; onSent?: () => void },
  ): Promise<{ kind: 'mol'; bytes: ArrayBuffer }> => {
    if (kind !== 'mol') return Promise.reject(new Error('export: not offered in this file'))
    return this.enqueue<ArrayBuffer>({
      kind: 'export',
      label: null,
      mine: true,
      timeoutMs: EXPORT_TIMEOUT_MS,
      signal: opts.signal,
      onSent: opts.onSent,
      post: (post, nonce) => post({ type: 'exportMol', nonce, format: opts.format, selection: opts.selection }),
      match: (m, nonce) => (m.type === 'mol' && m.nonce === nonce && m.bytes instanceof ArrayBuffer ? { done: m.bytes } : null),
    }).then(bytes => ({ kind: 'mol' as const, bytes }))
  }

  /**
   * PyMOL's session as a `.pse` (`PymolPseExportDialog`, owner 2026-11-14):
   * written fresh by PyMOL from the live scene, for desktop PyMOL. `signal`,
   * aborted while the request still waits, takes it out unsent — the dialog
   * closed before its turn (PT-9127 item 1), as a molecule export's does.
   * `onSent` is told when the request is posted: the dialog offers Stop only
   * from then on (PT-9232 item 2).
   */
  exportPse = (signal?: AbortSignal, onSent?: () => void): Promise<ArrayBuffer> =>
    this.enqueue<ArrayBuffer>({
      kind: 'export',
      label: null,
      mine: true,
      timeoutMs: EXPORT_TIMEOUT_MS,
      signal,
      onSent,
      post: (post, nonce) => post({ type: 'exportPse', nonce }),
      match: (m, nonce) => (m.type === 'pse' && m.nonce === nonce && m.bytes instanceof ArrayBuffer ? { done: m.bytes } : null),
    })

  setView = (v: readonly number[]): void => {
    if (this.worker === null || v.length !== 18) return
    // Through the queue, so it lands after what was asked before it; the
    // worker answers it with nothing but a view18.
    void this.enqueue<void>({
      kind: 'command',
      label: null,
      mine: false,
      timeoutMs: COMMAND_TIMEOUT_MS,
      post: post => {
        post({ type: 'setView', v: Array.from(v) })
        queueMicrotask(() => this.finish(undefined, null))
      },
      match: () => null,
    }).catch(() => undefined)
  }

  private loadOp(msg: Record<string, unknown>, transfer: Transferable[], look = false): Promise<void> {
    return this.enqueue<void>({
      kind: 'load',
      label: null,
      mine: false,
      timeoutMs: LOAD_TIMEOUT_MS,
      look,
      scene: true,
      post: post => post(msg, transfer),
      match: m => (m.type === 'progress' && m.phase === 'loaded' ? { done: undefined } : null),
    })
  }

  /** Stop: the request in flight and every one waiting fail, and PyMOL starts again on the file's scene. */
  cancel = (): boolean => {
    if (this.state.phase !== 'ready' || this.inflight === null || !cancellableKind(this.inflight.op.kind)) return false
    this.restart('cancelled')
    return true
  }

  // ---- worker messages ----------------------------------------------------------

  private onMessage = (e: MessageEvent): void => {
    const m = e.data as WorkerMsg | null
    if (!m || typeof m.type !== 'string') return
    switch (m.type) {
      case 'heartbeat':
        break
      case 'taken': {
        // The request's own deadline from now (PT-9108 item 8).
        const f = this.inflight
        if (f !== null && !f.taken && m.req === f.req) {
          f.taken = true
          clearTimeout(f.timer)
          const op = f.op
          f.timer = setTimeout(() => this.deadline(op), op.timeoutMs)
        }
        return
      }
      case 'uistate':
        this.patch({ ui: uiStateOf(m) })
        break
      case 'objects': {
        const o = objectsOf(m as Record<string, unknown>)
        if (o !== null) this.patch({ objects: o })
        break
      }
      case 'seq': {
        const q = seqReportOf(m as Record<string, unknown>)
        if (q !== null) this.patch({ seq: q })
        break
      }
      case 'guiwidth': {
        // The buffer's CSS width is the backing it was sized for (CSS px × DPR).
        const b = this.backing
        const css = panelCssWidth(m.px, m.bw, b.dpr > 0 ? b.w / b.dpr : 0)
        if (css !== null && css !== this.state.objectPanelWidth) this.patch({ objectPanelWidth: css })
        const layout = panelLayoutOf(m as Record<string, unknown>)
        if (layout !== null && JSON.stringify(layout) !== JSON.stringify(this.state.objectPanelLayout)) this.patch({ objectPanelLayout: layout })
        const mode = typeof m.mode === 'string' && m.mode !== '' ? m.mode.slice(0, 40) : undefined
        if (mode !== undefined && mode !== this.state.mouseMode) this.patch({ mouseMode: mode })
        const motion = motionOf(m as Record<string, unknown>)
        const was = this.state.motion
        if (motion !== null && (was === undefined || was.rock !== motion.rock || was.rockSpeed !== motion.rockSpeed || was.spin !== motion.spin)) this.patch({ motion })
        break
      }
      case 'view18':
        if (Array.isArray(m.v) && m.v.length === 18 && m.v.every(x => typeof x === 'number' && Number.isFinite(x))) this.lastView = (m.v as number[]).slice()
        break
      case 'error':
        if (m.fatal === true) {
          this.fail(text(m.s))
          return
        }
        if (UNSOLICITED_ERROR.test(text(m.s))) break
        if (this.inflight !== null) {
          this.finish(null, new Error(text(m.s)))
          return
        }
        break
      default:
        break
    }
    for (let i = this.waiters.length - 1; i >= 0; i--) {
      if (this.waiters[i].pred(m)) this.waiters.splice(i, 1)[0].resolve(m)
    }
    const f = this.inflight
    if (f !== null) {
      const hit = f.op.match(m, f.nonce)
      if (hit !== null) {
        if ('error' in hit) this.finish(null, hit.error)
        else this.finish(hit.done, null)
      }
    }
  }

  private waitFor(pred: (m: WorkerMsg) => boolean, ms: number): Promise<WorkerMsg> {
    return new Promise((resolve, reject) => {
      const w = { pred, resolve, reject }
      this.waiters.push(w)
      setTimeout(() => {
        const i = this.waiters.indexOf(w)
        if (i >= 0) {
          this.waiters.splice(i, 1)
          reject(new Error('timeout'))
        }
      }, ms)
    })
  }

  // ---- canvas + input -----------------------------------------------------------

  private mods = (e: MouseEvent | KeyboardEvent): number => (e.shiftKey ? 1 : 0) | (e.ctrlKey || e.metaKey ? 2 : 0) | (e.altKey ? 4 : 0)
  private button = (e: MouseEvent): number => (e.button === 1 ? 1 : e.button === 2 ? 2 : 0)
  private xy(e: MouseEvent): [number, number] {
    return this.xyAt(e.clientX, e.clientY)
  }
  /** A page (client) point in PyMOL's device pixels, y up. */
  private xyAt(clientX: number, clientY: number): [number, number] {
    const c = this.canvas
    if (c === null) return [0, 0]
    const b = c.getBoundingClientRect()
    const { w, h } = this.backing
    return [Math.round(((clientX - b.left) * w) / (b.width || 1)), Math.round(h - ((clientY - b.top) * h) / (b.height || 1))]
  }
  private wanted(): { w: number; h: number; dpr: number } {
    const r = this.canvas?.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    return { w: Math.round((r?.width ?? 0) * dpr), h: Math.round((r?.height ?? 0) * dpr), dpr }
  }

  private newCanvas(): HTMLCanvasElement {
    const host = this.host
    if (host === null) throw new Error('no place for it on the page')
    this.resizeObserver?.disconnect()
    host.textContent = ''
    const c = document.createElement('canvas')
    c.className = 'sav-gl'
    c.tabIndex = 0
    c.setAttribute('aria-label', this.canvasLabel())
    host.appendChild(c)
    this.canvas = c
    this.transferred = false
    // Input on a canvas a restart replaced (a finger still down on it) is not
    // the new PyMOL's: it never had the press (PT-9194 item 2).
    const post = (msg: Record<string, unknown>) => {
      if (this.canvas === c) this.worker?.postMessage(msg)
    }
    // The view takes the keys, without scrolling the page back to it (PT-9195 item 2).
    const focusView = () => c.focus({ preventScroll: true })
    c.addEventListener('contextmenu', e => e.preventDefault())
    c.addEventListener('mousedown', e => {
      if (!this.worker) return
      focusView()
      this.buttonsDown++
      const [x, y] = this.xy(e)
      post({ type: 'move', x, y, mods: this.mods(e) })
      post({ type: 'button', b: this.button(e), state: 0, x, y, mods: this.mods(e) })
      e.preventDefault()
    })
    c.addEventListener('mousemove', e => {
      const [x, y] = this.xy(e)
      post({ type: 'move', x, y, mods: this.mods(e) })
    })
    c.addEventListener(
      'wheel',
      e => {
        if (!this.worker || e.deltaY === 0) return
        const [x, y] = this.xy(e)
        const b = e.deltaY < 0 ? 3 : 4
        post({ type: 'button', b, state: 0, x, y, mods: this.mods(e) })
        post({ type: 'button', b, state: 1, x, y, mods: this.mods(e) })
        e.preventDefault()
      },
      { passive: false },
    )
    // Touch: gestures as the mouse buttons PyMOL takes (`touchMouse.ts`). Not
    // passive, so the browser neither scrolls nor makes mouse events of them.
    const gestures = new TouchMouse()
    const sendMouse = (op: MouseOp) => {
      const [x, y] = this.xyAt(op.x, op.y)
      if (op.kind === 'move') post({ type: 'move', x, y, mods: 0 })
      else post({ type: 'button', b: op.button, state: op.kind === 'down' ? 0 : 1, x, y, mods: 0 })
    }
    // The fingers that started on this canvas only: a thumb resting on the
    // phone's bar or header is no part of the gesture (PT-9192 item 1).
    const onTouch = (e: TouchEvent) => {
      e.preventDefault()
      if (!this.worker) return
      if (e.type === 'touchstart') focusView()
      const ops =
        e.type === 'touchcancel'
          ? gestures.cancel()
          : gestures.update(Array.from(e.targetTouches, t => ({ id: t.identifier, x: t.clientX, y: t.clientY })))
      for (const op of ops) sendMouse(op)
    }
    for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel'] as const) c.addEventListener(type, onTouch, { passive: false })
    c.addEventListener('keydown', e => {
      if (!this.worker || e.key === 'Tab') return
      let code: number | undefined
      let state = -1
      const special = own(SPECIAL, e.key)
      if (special !== undefined) {
        code = special
        state = -2
      } else if (own(CTRL_KEYS, e.key) !== undefined) code = own(CTRL_KEYS, e.key)
      else if (e.key.length === 1) {
        code = e.key.charCodeAt(0)
        if (e.ctrlKey && code >= 97 && code <= 122) code -= 96
      }
      if (code === undefined || code > 255) return
      post({ type: 'key', code, state, mods: this.mods(e) })
      e.preventDefault()
    })
    try {
      this.resizeObserver = new ResizeObserver(() => {
        const s = this.wanted()
        if (s.w < 1 || s.h < 1 || (s.w === this.backing.w && s.h === this.backing.h)) return
        this.backing = s
        if (!this.transferred) {
          c.width = s.w
          c.height = s.h
        }
        post({ type: 'resize', w: s.w, h: s.h, dpr: s.dpr })
      })
      this.resizeObserver.observe(c)
    } catch {
      // No ResizeObserver: the first size stays.
    }
    return c
  }

  /** Re-labels the canvas after a language switch. */
  relabel(): void {
    this.canvas?.setAttribute('aria-label', this.canvasLabel())
  }

  // ---- boot -----------------------------------------------------------------------

  /** Starts PyMOL (or does nothing while it runs). Resolves once it is ready or failed. */
  start = async (): Promise<void> => {
    if (this.disposed || this.state.phase === 'booting' || this.state.phase === 'loading' || this.state.phase === 'ready') return
    const gen = this.state.generation + 1
    this.patch({ phase: 'booting', failure: null, failureCode: null, ui: null, scene: null, lookError: null, generation: gen, objects: undefined, motion: undefined, seq: undefined })
    // The whole start, the runtime's blocks included, has a deadline: a read
    // that never settles fails it with a Retry (PT-9109 item 6).
    const timer = setTimeout(() => {
      if (!this.disposed && this.state.generation === gen && this.state.phase === 'booting') this.fail(`it did not start in ${BOOT_TIMEOUT_MS / 1000} s`)
    }, BOOT_TIMEOUT_MS)
    try {
      await this.boot(gen)
    } catch (e) {
      // A boot a Stop, a deadline or a fatal error already replaced says nothing.
      if (this.disposed || this.state.generation !== gen || this.state.phase === 'failed') return
      this.fail(toError(e).message, e instanceof CodedFailure ? e.code : null)
    } finally {
      clearTimeout(timer)
    }
  }

  private async boot(gen: number): Promise<void> {
    let mine: Worker | null = null
    // This boot is still the one running: not disposed, not replaced by a
    // restart, not failed — a fatal error between `ready` and the first
    // heartbeat fails it without a new generation — and its worker is still
    // the bridge's (PT-9108 items 1, 6).
    const current = () => !this.disposed && this.state.generation === gen && this.state.phase !== 'failed' && (mine === null || this.worker === mine)
    // A worker with no WebGL fails at once, before the runtime is read and
    // Python started for nothing (the iPhone's Safari before 17).
    const gl = await workerGlAvailable()
    if (!current()) return
    if (gl === false) throw new CodedFailure('no-worker-gl', NO_WORKER_GL)
    const { base, handed, readBlock, readText } = this.inputs
    const assets: Record<string, ArrayBuffer> = {}
    const transfer: Transferable[] = []
    for (const name of handed) {
      const buf = await readBlock(`rt-${name}`)
      assets[base + name] = buf
      transfer.push(buf)
    }
    const source = workerSource(base, await readText('pyodide-js'), await readText('pyodide-core'), await readText('worker'))
    if (!current()) return
    const c = this.newCanvas()
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
    const worker = new Worker(url)
    URL.revokeObjectURL(url)
    this.worker = worker
    mine = worker
    // Only this boot's worker speaks to the bridge: a superseded one's late
    // messages and errors are not charged to the next (PT-9108 item 3).
    worker.onmessage = e => {
      if (this.worker === worker) this.onMessage(e)
    }
    worker.onerror = ev => {
      if (this.worker === worker) this.fail(`worker: ${text(ev.message || 'error')}`)
    }
    const s = this.wanted()
    this.backing = { w: s.w || 800, h: s.h || 600, dpr: s.dpr }
    c.width = this.backing.w
    c.height = this.backing.h
    const off = c.transferControlToOffscreen()
    this.transferred = true
    transfer.push(off)
    // The panel as the user left it, else off in a narrow view: set at
    // PyMOL's start, so a phone never shows it first (PT-9114 items 6, 7).
    // The phone layout never shows it (its own object list instead, owner 2026-11-19); what the
    // desktop layout would show comes back when the page leaves the phone layout.
    const wanted = this.panelWanted ?? this.backing.w / (this.backing.dpr || 1) >= OBJECT_PANEL_MIN_VIEW_PX
    const panel = wanted && !this.docked
    if (this.docked && wanted) this.dockHid = true
    this.patch({ objectPanel: panel })
    const ready = this.waitFor(m => m.type === 'ready' || m.type === 'error', BOOT_TIMEOUT_MS)
    worker.postMessage(
      { type: 'init', canvas: off, base, assets, dpr: this.backing.dpr, w: this.backing.w, h: this.backing.h, gui: panel ? 1 : 0, snapshots: false, guiWidth: true, objectList: true },
      transfer,
    )
    const r = await ready
    if (r.type !== 'ready') throw new Error(text(r.s).split('\n')[0].slice(0, 300))
    // The restricted unpickler is baked into the wheel; worker.js asserts it
    // too. This page refuses a runtime that does not report it.
    if (r.restricted !== true) throw new Error("its runtime is not the restricted build")
    // The timing trap (header): the first heartbeat, then 300 ms more. Only
    // the wait's own timeout is let through: a teardown ends the boot.
    const beat = await this.waitFor(m => m.type === 'heartbeat', 15_000).then(
      () => true,
      (e: unknown) => toError(e).message === 'timeout',
    )
    if (!beat || !current()) return this.drop(worker)
    await new Promise(res => setTimeout(res, 300))
    if (!current()) return this.drop(worker)
    this.patch({ phase: 'loading' })
    // A file PyMOL cannot load fails the start, and its Retry loads the last scene that did.
    await this.loadLatest(current)
    if (!current()) return this.drop(worker)
    void this.runCommand(this.startCommand(), { page: true }).catch(() => undefined)
    this.patch({ phase: 'ready', readyGeneration: gen })
  }

  /** Ends a worker a superseded boot started, unless it is the bridge's own. */
  private drop(worker: Worker): void {
    if (this.worker === worker) return
    try {
      worker.terminate()
    } catch {
      // Already gone.
    }
  }

  /** The file's own scene: its saved session, the PyMOL look, or the structure at the exported view. */
  private async loadScene(): Promise<void> {
    const { doc } = this
    // The file's own structure with a saved session: PyMOL loads the session
    // for it, and neither the exported look nor its view.
    const session = doc !== null && doc === this.inputs.doc ? (this.inputs.session ?? null) : null
    const lookBytes = session !== null ? null : this.lookBytes
    const view = session !== null ? null : this.view
    // This load takes the latest document: one that arrives from here on loads again after it.
    this.docChanged = false
    if (lookBytes !== null && this.lookSkipped !== null) this.patch({ scene: 'look-failed', lookError: this.lookSkipped })
    else if (lookBytes !== null) {
      const copy = lookBytes.slice(0)
      try {
        await this.loadOp({ type: 'applyLook', bytes: copy }, [copy], true)
        this.patch({ scene: 'look', lookError: null })
        // The look replaces the scene with its own objects (`_agdb_apply_look` deletes all first).
        this.sceneLoaded(doc, lookBytes, view, this.inputs.lookObjects ?? [])
        return
      } catch (e) {
        this.patch({ scene: 'look-failed', lookError: toError(e).message.slice(0, 200) })
        if (this.worker === null) throw e
      }
    }
    if (doc === null) {
      // A blank file: PyMOL starts empty.
      this.patch({ scene: 'plain' })
      this.sceneLoaded(doc, lookBytes, view, [])
      return
    }
    const source = session ?? doc
    const bytes = source.bytes.slice(0)
    // The file's own structure is `Structure_<PDB ID>` (`docObjectName`); an opened one is named after its file.
    const obj = doc.serial === 0 ? (this.inputs.docObject ?? docObjectName(null)) : objectNameOf(doc.stem)
    if (source.ext === 'pse') {
      // worker.js answers a session it could not restore — the restricted
      // unpickler's refusal among them — with `loaded` and no atom count,
      // then the error: told as a refusal, never as opened (PR #8239 review).
      // The request stays in flight until that error comes, so no request
      // queued behind it is posted and takes the error as its own (PT-9132
      // item 2); the worker's replies are read in the order it sends them.
      // worker.js posts the error in the same task as `loaded`, and its
      // heartbeat comes from a later tick: a heartbeat after a `loaded` with
      // no atoms means no error is coming, and the refusal is said in general
      // words then — never on a clock, after which a late error would fail
      // the next request instead (PT-9220 item 4).
      let refused = false
      await this.enqueue<void>({
        kind: 'load',
        label: null,
        mine: false,
        timeoutMs: LOAD_TIMEOUT_MS,
        scene: true,
        post: post => post({ type: 'load', format: 'pse', obj, bytes, replace: true }, [bytes]),
        match: m => {
          if (refused && m.type === 'heartbeat') return { error: new Error('the session could not be read') }
          if (m.type !== 'progress' || m.phase !== 'loaded') return null
          if (typeof m.atoms === 'number') return { done: undefined }
          // No atoms: the error follows.
          refused = true
          return null
        },
      })
    } else await this.loadOp({ type: 'load', format: doc.ext, obj, bytes, replace: true }, [bytes])
    if (view !== null) this.setView(view)
    if (lookBytes === null) this.patch({ scene: view !== null ? 'view' : 'plain' })
    // A session's own object names are not known here: only ours are kept apart.
    this.sceneLoaded(doc, lookBytes, view, source.ext === 'pse' ? [] : [obj])
  }

  /** `objects`: the scene's object names as this page knows them. */
  private sceneLoaded(doc: StructureDoc | null, lookBytes: ArrayBuffer | null, view: readonly number[] | null, objects: readonly string[]): void {
    this.loaded = { doc, lookBytes, view }
    this.objectNames = new Set(objects.map(o => workerObjectName(o).toLowerCase()))
    this.settleDocs(doc, null)
  }

  /**
   * Loads the current document, then any opened during that load, until
   * PyMOL has the latest. One PyMOL refuses is settled as refused; if a newer
   * one arrived meanwhile, that one is tried next. Otherwise the scene goes
   * back to the last one that loaded — or, when none has, the file's own —
   * so a restart (Stop, Retry) does not load the refused file again, and the
   * refusal is thrown (PR #8239 review).
   */
  private async loadLatest(alive: () => boolean): Promise<void> {
    for (;;) {
      const target = this.doc
      this.loadTarget = target
      try {
        await this.loadScene()
      } catch (e) {
        const err = toError(e)
        // A teardown took the load out of the queue before it was posted (a
        // ray's fatal error or deadline ahead of it): the document stays the
        // one the next start loads, its open still waiting (PT-9220 item 2).
        // An earlier one a newer document replaced while its load waited is
        // done waiting: settled quietly, so its bytes are not kept until the
        // next start (PT-9238 item 1, as PT-9135 item 1).
        if (err instanceof NotSent) {
          this.resolveReplaced(null)
          throw err
        }
        // Refused: the open is told, with the scene PyMOL goes back to (PT-9228 item 3).
        if (target !== null) this.settleDocs(target, this.doc !== target ? err : new DocRefused(err.message, this.fallbackDoc()))
        // A newer document arrived during the load: tried next on a live
        // worker, kept for the next start on a dead one (PT-9134 item 3).
        if (this.doc !== target) {
          if (alive() && this.worker !== null) continue
          throw err
        }
        // The refused document is never loaded again — not by this load, a
        // deadline's restart or a Retry (PT-9134 items 1, 2, 4).
        const fallback = target === this.fallbackDoc()
        this.backToLoaded()
        throw new SceneRefused(err.message, fallback)
      } finally {
        this.loadTarget = null
      }
      if (!alive() || !this.docChanged) return
    }
  }

  private backToLoaded(): void {
    const back = this.loaded ?? { doc: this.inputs.doc, lookBytes: this.inputs.lookBytes, view: this.inputs.view }
    this.doc = back.doc
    this.lookBytes = back.lookBytes
    this.view = back.view
    this.docChanged = false
  }

  /** The file's own scene again, at its exported view (Reset). */
  resetScene = async (): Promise<void> => {
    try {
      await this.reloadScene()
    } catch {
      // reloadScene has said why (the phase is 'failed' or back at 'ready').
    }
  }

  /**
   * Loads the current document again while PyMOL is ready, and any opened
   * during the load. A document PyMOL refuses — a file it cannot read, a
   * session the restricted unpickler stops — rejects with PyMOL's reason;
   * the last scene that loaded is put back when the worker lives on, and
   * PyMOL is failed only when that cannot load either.
   */
  private reloadScene = async (): Promise<void> => {
    if (this.state.phase !== 'ready') return
    const gen = this.state.generation
    // Ours while the generation stands: a Stop or a deadline restart has started PyMOL again on its own.
    const ours = () => !this.disposed && this.state.generation === gen
    const alive = () => ours() && this.worker !== null
    this.patch({ phase: 'loading' })
    // The first refusal is what the caller is told.
    let first: Error | null = null
    for (;;) {
      try {
        await this.loadLatest(alive)
      } catch (e) {
        const err = toError(e)
        first ??= err
        if (!ours()) throw first
        // Refused on a live worker: the last scene that loaded, on the same
        // worker — again after a newer file opened meanwhile is refused too
        // (PT-9135 item 4). PyMOL is failed only when that scene itself is
        // refused, or the worker is gone.
        if (alive() && this.getState().phase === 'loading' && !(err instanceof SceneRefused && err.fallback)) continue
        if (this.getState().phase !== 'failed') this.fail(err.message)
        throw first
      }
      if (ours()) {
        this.patch({ phase: 'ready' })
        this.sendGrid()
      }
      if (first !== null) throw first
      return
    }
  }

  private teardown(reason: string): void {
    const err = new Error(reason)
    if (this.inflight !== null) {
      clearTimeout(this.inflight.timer)
      const op = this.inflight.op
      this.inflight = null
      op.reject(err)
    }
    for (const op of this.queue.splice(0)) op.reject(new NotSent(reason))
    this.panelNext = null
    for (const w of this.waiters.splice(0)) w.reject(err)
    try {
      this.worker?.terminate()
    } catch {
      // Already gone.
    }
    this.worker = null
    this.buttonsDown = 0
    // The next PyMOL gets the grid with its own start settings.
    this.gridSent = null
  }

  private fail(reason: string, code: FailureCode | null = null): void {
    // Only a scene load the worker had been sent is charged with the failure:
    // one still queued behind another request (a ray) never reached PyMOL
    // and stays the document the next start loads (PT-9220 item 2).
    const charged = this.inflight?.op.scene === true
    this.teardown('the PyMOL frame was stopped')
    // The document whose load was running is told why it did not open, and
    // the Retry goes back to the last scene that loaded (PT-9134 item 5) —
    // but a newer one opened meanwhile stays the document the next start
    // loads, its open still waiting (PT-9136, PT-9135 item 6). The refusal
    // names the scene Retry loads, as a refusal on a live worker does, so the
    // page shows that one and not an older document (PT-9237 item 1).
    const target = charged ? this.loadTarget : null
    if (target !== null) {
      this.settleDocs(target, this.doc === target ? new DocRefused(reason, this.fallbackDoc()) : new Error(reason))
      if (this.doc === target) this.backToLoaded()
    }
    this.patch({ phase: 'failed', failure: reason.split('\n')[0].slice(0, 300), failureCode: code, busy: null, ui: null })
  }

  /** Ends this worker and starts PyMOL again (Stop, a request past its deadline). */
  private restart(why: 'cancelled' | 'timeout'): void {
    this.teardown(why === 'cancelled' ? 'cancelled' : 'the PyMOL frame was rebuilt')
    this.patch({ phase: 'off', busy: null, ui: null })
    void this.start()
  }

  dispose(): void {
    this.disposed = true
    for (const w of this.docWaiters.splice(0)) w.resolve()
    this.teardown('the PyMOL frame was closed')
    this.resizeObserver?.disconnect()
    window.removeEventListener('mouseup', this.onWindowMouseUp)
  }
}
