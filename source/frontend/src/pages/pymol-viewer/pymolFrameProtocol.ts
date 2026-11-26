/**
 * The typed message protocol between this page and the PyMOL frame — the
 * parent half of ADR-0049 § 分離構成 4, matched to what the merged `host.js` /
 * `worker.js` actually send (TN0113 §4.1).
 *
 * THE FRAME IS UNTRUSTED. Every message that arrives on the port is treated
 * as hostile until this file has checked its shape, its sizes and its type —
 * and what leaves this file is a fresh object holding only checked values,
 * never the original.
 *
 * Three measured traps decide how the checks are written (TN0110 §7-32):
 *  - the type is looked up with `hasOwnProperty` in a null-prototype table.
 *    On an ordinary object, `type in TABLE` would also match `__proto__` /
 *    `constructor`; the null prototype and `hasOwnProperty` each rule that out;
 *  - every field is read from its own DATA descriptor, so an accessor on the
 *    message never runs (a structured clone cannot carry one, but nothing here
 *    relies on the clone to be the only way in);
 *  - an ArrayBuffer is recognised by the engine's own `byteLength` getter,
 *    which brand-checks the internal slot. A fake built on
 *    `ArrayBuffer.prototype` passes `instanceof` and would run its own
 *    `byteLength` getter if that were read; the brand check runs no user code.
 *
 * Caps are this page's own: png 16 MiB; pse 25 MiB, in and out;
 * load 32 MiB; mol 32 MiB (an exported PDB / SDF file; the whole
 * scene can come to more, and the frame then refuses it as too large before the file is read;
 * PT-3816 items 8, 11), look 64 MiB (the scene's look as JSON data
 * for the standalone HTML export, `pymolLook.ts`), snapshot 128 MiB (recovery only — never
 * persisted, never handed to a save API). Strings and arrays are capped too: an error can
 * carry text from a loaded `.pse` (`parsed.err`), so this page bounds it.
 */

export const MiB = 1024 * 1024

export const LIMITS = Object.freeze({
  pngBytes: 16 * MiB,
  pseBytes: 25 * MiB,
  loadBytes: 32 * MiB,
  molBytes: 32 * MiB,
  /** `look`: the scene's look as JSON (`pymolLook.ts`; `worker.js` LOOK_MAX). */
  lookBytes: 64 * MiB,
  snapshotBytes: 128 * MiB,
  /**
   * `log.s` / `error.s` as kept: longer text is cut to this. The worker's own
   * slices stop at ~610 characters (an init error at ~3510, so a long Python
   * traceback keeps its exception line, PT-4047), but `parsed.err` (an
   * exception from a loaded `.pse`) can be longer — and an
   * error that answers a request must not be lost, or the request would hang
   * to its deadline.
   */
  textChars: 4000,
  /** Text longer than this is refused outright rather than cut. */
  textHardChars: 1_000_000,
  nonceChars: 128,
  /**
   * `pick.atoms` as kept. A click names one atom (pk1), but a user can
   * `select pk1, all` and every later click then lists the whole selection, so
   * this bounds the COPY: a longer list keeps its first entries.
   */
  pickAtoms: 1024,
  /**
   * A pick list longer than this is refused outright. `worker.js` sends at
   * most this many (`PICK_SEND_MAX`) — one past what is kept, so the parent
   * can still tell the list was cut — which keeps an honest pick small.
   */
  pickHardAtoms: 1025,
  pickModelChars: 256,
  /** `uistate.sel`: a PyMOL selection name. */
  uiNameChars: 256,
  /** `uistate.runs`: at most this many lines (`worker.js` UI_RUNS_MAX)… */
  uiRuns: 64,
  /** …and this many characters in all. */
  uiRunsChars: 32_768,
  /** A chain id in a run. */
  uiChainChars: 16,
  /** Outbound `command.cmd`. */
  commandChars: 16_384,
  /** Outbound `exportMol.selection`: one PyMOL selection expression. */
  selectionChars: 1000,
  /** Own keys on any message: the largest legitimate one (`ready`) has 10. */
  messageKeys: 16,
  /** Integer pixels on either side of an exported PNG. */
  pngSide: 16_384,
})

/**
 * How `host.js` begins the error it posts, instead of starting the worker,
 * when the handshake's `runtime` is not the directory it was itself loaded
 * from: this page keys the runtime files to one version and the frame
 * document loads another (PT-3272 item 2).
 */
export const RUNTIME_MISMATCH = 'runtime mismatch:'

/**
 * The page <-> frame protocol this page speaks, sent in the handshake. A tab
 * keeps the page code it was opened with, but every frame it builds loads
 * `host.js` and `worker.js` fresh from the same version directory, so an update
 * that changes them in place meets pages from before it. `host.js` refuses a
 * number that is not its own `PROTOCOL` with the {@link RUNTIME_MISMATCH} text,
 * and such a page asks for a reload (PT-3671). Raise both together when a
 * change to those two files alters a message an open page sends or expects;
 * a change that only adds a type or field such a page never sends or reads is
 * not a raise (PT-3816 item 9).
 * 2 added the molecule export (`exportMol` / `mol`, PT-3615).
 * 3 added `uistate` (the shown selection and the wizard) and the frame-local
 * `cursor` (the pointer shape over PyMOL). A page of 2 would refuse
 * `uistate` as an unknown type, so it is told to reload.
 * 4 added the look export (`exportLook` / `look`: per-atom colours,
 * representations and allow-listed settings as JSON data; never a `.pse`,
 * PT-3031).
 */
export const PYMOL_FRAME_PROTOCOL = 4

/**
 * `ready.allowList`: the names the restricted unpickler resolves (patch 0006),
 * as `worker.js` `_allow_list()` writes them — `module.name`, sorted, one a
 * line. The same 18 as ADR-0049 § 分離構成 6; `pymolFrameProtocol.test.ts`
 * reads them out of the pinned wheel's own `chempy/pkl.py`, so a wheel whose
 * list changed fails there before it can fail here.
 */
export const EXPECTED_ALLOW_LIST: readonly string[] = Object.freeze([
  '_codecs.encode',
  'builtins.bytearray',
  'builtins.bytes',
  'builtins.complex',
  'chempy.Atom',
  'chempy.Bond',
  'chempy.Storage',
  'chempy.models.Connected',
  'chempy.models.Indexed',
  'collections.OrderedDict',
  'copyreg._reconstructor',
  'numpy._core.multiarray._reconstruct',
  'numpy._core.multiarray.scalar',
  'numpy.core.multiarray._reconstruct',
  'numpy.core.multiarray.scalar',
  'numpy.dtype',
  'numpy.ndarray',
  'pymol.Session_Storage',
])
/** `ready.allowCount`: how many names that list has. */
export const EXPECTED_ALLOW_COUNT = EXPECTED_ALLOW_LIST.length
/** `ready.allowList` past this many characters is refused (the 18 names are 375). */
const ALLOW_LIST_CHARS = 4_096
/** `ready.maxThreads`: `cmd.get` answers a Python str, so this is a string. */
export const EXPECTED_MAX_THREADS = '1'

/**
 * Formats `worker.js` loads (its FORMATS keys). `pkl` / `model` never. The
 * three map formats are electron density (TN0113 §8-4):
 * PyMOL's CCP4/MRC reader parses a binary grid and unpickles nothing. No
 * `mae`: the bundled open-source PyMOL's mae loader is incentive-only and
 * always raises (PT-3601).
 */
export const LOAD_FORMATS = Object.freeze([
  'pdb', 'ent', 'cif', 'mmcif', 'sdf', 'mol', 'mol2', 'xyz', 'pse', 'ccp4', 'map', 'mrc',
] as const)
export type LoadFormat = (typeof LOAD_FORMATS)[number]
/** The density-map formats among them (a map has no atoms to count). */
export const MAP_FORMATS = Object.freeze(['ccp4', 'map', 'mrc'] as const)

/**
 * The files `exportMol` writes (PT-3615): PDB or mmCIF for a protein or a
 * complex, SDF or MOL2 for small molecules (mmCIF and MOL2 added 2026-11-14,
 * owner: PyMOL's own file formats) — text formats, never a session or a
 * pickle. What the frame writes into one is its own choice, so this list is
 * not what keeps a file harmless (`checkMolFile` in `pymolExport.ts` says
 * what does; PT-3816 item 4).
 */
export const MOL_FORMATS = Object.freeze(['pdb', 'cif', 'sdf', 'mol2'] as const)
export type MolFormat = (typeof MOL_FORMATS)[number]

/** Every type `host.js` relays to the port (its OUT set). */
export const FRAME_MESSAGE_TYPES = Object.freeze([
  'ready', 'log', 'progress', 'pick', 'view18', 'png', 'pse', 'mol', 'look', 'snapshot', 'snapshot-skipped', 'error', 'heartbeat', 'taken', 'uistate',
] as const)
export type FrameMessageType = (typeof FRAME_MESSAGE_TYPES)[number]

/**
 * Every type `host.js` forwards to the worker (its IN set). Never `applyLook`:
 * `worker.js` takes that from the standalone HTML page only.
 */
export const PARENT_MESSAGE_TYPES = Object.freeze([
  'load', 'setView', 'command', 'exportPng', 'exportPse', 'exportMol', 'exportLook', 'restoreSnapshot', 'runtimeAsset',
] as const)

/**
 * Types `host.js` acts on itself and never forwards to the worker: the pointer
 * shape drawn on its canvas (protocol 3).
 */
export const FRAME_LOCAL_TYPES = Object.freeze(['cursor'] as const)

/** The pointer shapes `host.js` knows (its CURSORS); anything else is the plain arrow there. */
export const FRAME_CURSORS = Object.freeze(['default', 'laser', 'crosshair'] as const)
export type FrameCursor = (typeof FRAME_CURSORS)[number]

/** One run of consecutive residue numbers of a selection, in one object and chain. */
export interface UiRun {
  model: string
  chain: string
  start: number
  end: number
}

/**
 * What PyMOL shows the user, as `worker.js` reads it after a click, a key or
 * a request (protocol 3): the first shown (enabled) selection — null when none
 * is — its atom count, its POLYMER residues as runs (null when it was too
 * large to walk; `more` when the list was cut), how many selections are shown,
 * whether it holds atoms outside the polymer (a ligand, water), and the wizard
 * that is up.
 */
export interface UiState {
  sel: string | null
  atoms: number | null
  runs: UiRun[] | null
  more: boolean
  shown: number
  hetero: boolean
  wizard: 'measurement' | 'other' | null
}

export const BOOT_PHASES = Object.freeze(['boot', 'pyodide', 'packages'] as const)
export type ProgressPhase = 'boot' | 'pyodide' | 'packages' | 'command' | 'loaded' | 'restored'

export interface ReadyInfo {
  webgl: 1 | 2
  maxThreads: string
  allowCount: number
  /** `module.name` lines, sorted — compared with `EXPECTED_ALLOW_LIST`. */
  allowList: string
  restricted: boolean
  heapMB: number | null
  w: number
  h: number
  workerMs: number
}

export type FrameMessage =
  | ({ type: 'ready' } & ReadyInfo)
  | { type: 'log'; s: string }
  | { type: 'progress'; phase: ProgressPhase; atoms: number | null; heapMB: number | null }
  | { type: 'pick'; atoms: Array<{ model: string; index: number }>; truncated: boolean }
  | { type: 'view18'; v: number[] }
  | { type: 'png'; nonce: string; bytes: ArrayBuffer; w: number; h: number }
  | { type: 'pse'; nonce: string; bytes: ArrayBuffer }
  | { type: 'mol'; nonce: string; bytes: ArrayBuffer }
  /** The scene's look as JSON bytes (`parsePymolLook` in `pymolLook.ts` reads them). */
  | { type: 'look'; nonce: string; bytes: ArrayBuffer }
  | { type: 'snapshot'; bytes: ArrayBuffer }
  /** The worker's session save was over `LIMITS.snapshotBytes`, so no snapshot went out (PT-8314 item 1). */
  | { type: 'snapshot-skipped'; bytes: number }
  | { type: 'error'; s: string; fatal: boolean }
  | { type: 'heartbeat'; ticks: number; draws: number; heapMB: number | null; inputMs: number | null }
  /** The worker started the request the page numbered `req` (PT-3271 item 5). */
  | { type: 'taken'; req: number }
  | ({ type: 'uistate' } & UiState)

export type ValidationResult =
  /** `bytes`: what the message cost to clone, from what validation read. */
  | { ok: true; msg: FrameMessage; bytes: number }
  | { ok: false; reason: string; type: string | null }

// ---- primitive checks --------------------------------------------------------

const hasOwn = (o: object, k: PropertyKey): boolean => Object.prototype.hasOwnProperty.call(o, k)

// Captured once, at module load, from the intrinsics: the engine's brand checks.
const AB_BYTE_LENGTH = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')?.get
// Absent on an engine without resizable buffers, which then has none to send.
const AB_RESIZABLE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')?.get

/**
 * The byte length of a REAL, fixed-length ArrayBuffer, or null for anything
 * else — a view, a SharedArrayBuffer, a fake on `ArrayBuffer.prototype`, or a
 * resizable buffer: its length is not what its clone reserves (up to its
 * `maxByteLength`), and no honest worker sends one (PT-3271 item 19). Runs no
 * user code.
 */
export function arrayBufferByteLength(v: unknown): number | null {
  if (typeof v !== 'object' || v === null || AB_BYTE_LENGTH === undefined) return null
  try {
    const n: unknown = AB_BYTE_LENGTH.call(v)
    if (typeof n !== 'number') return null
    return AB_RESIZABLE !== undefined && AB_RESIZABLE.call(v) === true ? null : n
  } catch {
    return null
  }
}

/** A non-empty real ArrayBuffer of at most `cap` bytes. */
function isBytes(v: unknown, cap: number): v is ArrayBuffer {
  const n = arrayBufferByteLength(v)
  return n !== null && n >= 1 && n <= cap
}

const isText = (v: unknown, cap: number): v is string => typeof v === 'string' && v.length <= cap
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
const isHeap = (v: unknown): v is number | null => v === null || (isFiniteNumber(v) && v >= 0)

type Fields = Map<string, unknown>

/**
 * The message's own fields, read from DATA descriptors only — or the reason
 * the value is refused: not a plain object, an accessor, a symbol key, or a
 * key outside `allowed`.
 */
function readFields(v: unknown, allowed: ReadonlySet<string>): Fields | string {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return 'not-an-object'
  const proto: unknown = Object.getPrototypeOf(v)
  if (proto !== Object.prototype && proto !== null) return 'not-a-plain-object'
  // Count before `getOwnPropertyNames`: the count gives up at the cap, but V8
  // still lists every key (integer ones made strings) before for-in's first
  // step. That costs in proportion to the keys, the same order as the clone
  // (0.3-1.7x, measured), where `getOwnPropertyNames` costs 3-5x. A clone's
  // keys are all enumerable, so for-in sees each.
  let keys = 0
  for (const key in v) {
    if (hasOwn(v, key) && ++keys > LIMITS.messageKeys) return 'too-many-fields'
  }
  if (Object.getOwnPropertySymbols(v).length > 0) return 'symbol-key'
  const names = Object.getOwnPropertyNames(v)
  if (names.length > LIMITS.messageKeys) return 'too-many-fields'
  const out: Fields = new Map()
  for (const name of names) {
    if (!allowed.has(name)) return `unexpected-field:${name.slice(0, 32)}`
    const d = Object.getOwnPropertyDescriptor(v, name)
    if (!d || !('value' in d)) return `accessor-field:${name}`
    out.set(name, d.value)
  }
  return out
}

/**
 * The first `take` elements of a real, dense array of at most `cap` items,
 * copied out of their data descriptors, and its full length. Null for anything
 * else (holes, accessors, extra named properties, an array over `cap`).
 */
function readArray(v: unknown, cap: number, take: number = cap): { items: unknown[]; length: number } | null {
  if (!Array.isArray(v)) return null
  const lengthDesc = Object.getOwnPropertyDescriptor(v, 'length')
  const length: unknown = lengthDesc?.value
  if (!isCount(length) || length > cap) return null
  // Counted first, as in `readFields`: an array of a few items can carry
  // millions of named properties, and `getOwnPropertyNames` would list them
  // all before the comparison refused it. An own enumerable key past `length`
  // is one the array must not have.
  let keys = 0
  for (const key in v) {
    if (hasOwn(v, key) && ++keys > length) return null
  }
  if (Object.getOwnPropertySymbols(v).length > 0) return null
  if (Object.getOwnPropertyNames(v).length !== length + 1) return null
  const items: unknown[] = []
  for (let i = 0; i < Math.min(length, take); i++) {
    const d = Object.getOwnPropertyDescriptor(v, String(i))
    if (!d || !('value' in d)) return null
    items.push(d.value)
  }
  return { items, length }
}

/** Text kept at most `LIMITS.textChars` long; null when it is not text or over the hard cap. */
function boundedText(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > LIMITS.textHardChars) return null
  return v.length <= LIMITS.textChars ? v : v.slice(0, LIMITS.textChars - 1) + '…'
}

// ---- per-type validators -------------------------------------------------------

type Validator = { allowed: ReadonlySet<string>; check: (f: Fields) => FrameMessage | string }

const keys = (...k: string[]): ReadonlySet<string> => new Set(['type', ...k])

function validateReady(f: Fields): FrameMessage | string {
  const webgl = f.get('webgl')
  if (webgl !== 1 && webgl !== 2) return 'ready.webgl'
  const maxThreads = f.get('maxThreads')
  if (!isText(maxThreads, 16)) return 'ready.maxThreads'
  const allowCount = f.get('allowCount')
  if (!isCount(allowCount)) return 'ready.allowCount'
  const allowList = f.get('allowList')
  if (!isText(allowList, ALLOW_LIST_CHARS)) return 'ready.allowList'
  const restricted = f.get('restricted')
  if (typeof restricted !== 'boolean') return 'ready.restricted'
  // `?? null`: Pyodide turns Python None into undefined, and a structured clone
  // keeps an own property whose value is undefined.
  const heapMB = f.get('heapMB') ?? null
  if (!isHeap(heapMB)) return 'ready.heapMB'
  const w = f.get('w'), h = f.get('h'), workerMs = f.get('workerMs')
  if (!isCount(w) || !isCount(h) || !isCount(workerMs)) return 'ready.dimensions'
  return { type: 'ready', webgl, maxThreads, allowCount, allowList, restricted, heapMB, w, h, workerMs }
}

const PROGRESS_PHASES: ReadonlySet<string> = new Set(['boot', 'pyodide', 'packages', 'command', 'loaded', 'restored'])

function validateProgress(f: Fields): FrameMessage | string {
  const phase = f.get('phase')
  if (typeof phase !== 'string' || !PROGRESS_PHASES.has(phase)) return 'progress.phase'
  // Only the two phases that count atoms carry extras (`worker.js` posts
  // `loaded{atoms, heapMB?}` and `restored{atoms}`); `atoms` is null when the
  // session restore itself failed (`parsed.atoms`).
  const counted = phase === 'loaded' || phase === 'restored'
  if (!counted && (f.has('atoms') || f.has('heapMB'))) return 'progress.extras'
  if (phase === 'restored' && f.has('heapMB')) return 'progress.extras'
  const atoms = f.get('atoms') ?? null
  if (atoms !== null && !isCount(atoms)) return 'progress.atoms'
  const heapMB = f.get('heapMB') ?? null
  if (!isHeap(heapMB)) return 'progress.heapMB'
  return { type: 'progress', phase: phase as ProgressPhase, atoms, heapMB }
}

function validatePick(f: Fields): FrameMessage | string {
  // Every entry is checked, not only the ones kept: an unchecked tail would
  // let bulk ride in on an accepted message.
  const list = readArray(f.get('atoms'), LIMITS.pickHardAtoms)
  if (list === null) return 'pick.atoms'
  const atoms: Array<{ model: string; index: number }> = []
  for (const item of list.items) {
    const g = readFields(item, PICK_ATOM_FIELDS)
    if (typeof g === 'string') return 'pick.atom'
    const model = g.get('model'), index = g.get('index')
    if (!isText(model, LIMITS.pickModelChars) || !isCount(index)) return 'pick.atom'
    if (atoms.length < LIMITS.pickAtoms) atoms.push({ model, index })
  }
  return { type: 'pick', atoms, truncated: list.length > atoms.length }
}

const PICK_ATOM_FIELDS: ReadonlySet<string> = new Set(['model', 'index'])
/** A checked pick entry's field names, two bytes a character: it has both. */
const PICK_ATOM_NAME_BYTES = [...PICK_ATOM_FIELDS].reduce((n, k) => n + k.length * 2, 0)
/**
 * One pick entry's clone weight: its field names, its model name at two bytes
 * a character, eight for its index. The one formula for an accepted pick and a
 * refused one alike, so the two cannot drift apart (PT-4165 item 4).
 */
const pickEntryBytes = (modelChars: number): number => PICK_ATOM_NAME_BYTES + modelChars * 2 + 8

function validateView18(f: Fields): FrameMessage | string {
  const v = readArray(f.get('v'), 18)
  if (v === null || v.length !== 18 || !v.items.every(isFiniteNumber)) return 'view18.v'
  return { type: 'view18', v: v.items as number[] }
}

const isNonce = (v: unknown): v is string => isText(v, LIMITS.nonceChars) && v.length > 0

/**
 * The refusal reasons that mean an export reply was a real buffer over its
 * type's cap. Every other refusal of a png/pse/mol is a reply of the wrong
 * shape, which the page must not report as "too large" (PT-3298 item 12).
 */
export const EXPORT_TOO_LARGE_REASONS: ReadonlySet<string> = new Set(['png.too-large', 'pse.too-large', 'mol.too-large', 'look.too-large'])

const overCap = (v: unknown, cap: number): boolean => (arrayBufferByteLength(v) ?? 0) > cap

function validatePng(f: Fields): FrameMessage | string {
  const nonce = f.get('nonce'), bytes = f.get('bytes'), w = f.get('w'), h = f.get('h')
  if (!isNonce(nonce)) return 'png.nonce'
  if (overCap(bytes, LIMITS.pngBytes)) return 'png.too-large'
  if (!isBytes(bytes, LIMITS.pngBytes)) return 'png.bytes'
  if (!isCount(w) || !isCount(h) || w < 1 || h < 1 || w > LIMITS.pngSide || h > LIMITS.pngSide) return 'png.dimensions'
  return { type: 'png', nonce, bytes, w, h }
}

function validatePse(f: Fields): FrameMessage | string {
  const nonce = f.get('nonce'), bytes = f.get('bytes')
  if (!isNonce(nonce)) return 'pse.nonce'
  if (overCap(bytes, LIMITS.pseBytes)) return 'pse.too-large'
  if (!isBytes(bytes, LIMITS.pseBytes)) return 'pse.bytes'
  return { type: 'pse', nonce, bytes }
}

function validateMol(f: Fields): FrameMessage | string {
  const nonce = f.get('nonce'), bytes = f.get('bytes')
  if (!isNonce(nonce)) return 'mol.nonce'
  if (overCap(bytes, LIMITS.molBytes)) return 'mol.too-large'
  if (!isBytes(bytes, LIMITS.molBytes)) return 'mol.bytes'
  return { type: 'mol', nonce, bytes }
}

function validateLook(f: Fields): FrameMessage | string {
  const nonce = f.get('nonce'), bytes = f.get('bytes')
  if (!isNonce(nonce)) return 'look.nonce'
  if (overCap(bytes, LIMITS.lookBytes)) return 'look.too-large'
  if (!isBytes(bytes, LIMITS.lookBytes)) return 'look.bytes'
  return { type: 'look', nonce, bytes }
}

function validateSnapshot(f: Fields): FrameMessage | string {
  const bytes = f.get('bytes')
  if (!isBytes(bytes, LIMITS.snapshotBytes)) return 'snapshot.bytes'
  return { type: 'snapshot', bytes }
}

function validateSnapshotSkipped(f: Fields): FrameMessage | string {
  const bytes = f.get('bytes')
  if (!isCount(bytes)) return 'snapshot-skipped.bytes'
  return { type: 'snapshot-skipped', bytes }
}

function validateError(f: Fields): FrameMessage | string {
  const s = boundedText(f.get('s'))
  if (s === null) return 'error.s'
  // Most worker errors carry no `fatal` at all; absent means not fatal here, and
  // the caller still treats every error before `ready` as fatal.
  const fatal = f.get('fatal') ?? false
  if (typeof fatal !== 'boolean') return 'error.fatal'
  return { type: 'error', s, fatal }
}

function validateLog(f: Fields): FrameMessage | string {
  const s = boundedText(f.get('s'))
  if (s === null) return 'log.s'
  return { type: 'log', s }
}

function validateHeartbeat(f: Fields): FrameMessage | string {
  const ticks = f.get('ticks'), draws = f.get('draws')
  if (!isCount(ticks) || !isCount(draws)) return 'heartbeat.counters'
  const heapMB = f.get('heapMB') ?? null
  if (!isHeap(heapMB)) return 'heartbeat.heapMB'
  // Milliseconds since the worker last received a click or a key from the
  // frame (null before the first): PyMOL's own menus and command line start
  // work the parent never asked for, which the watchdog must wait out.
  const inputMs = f.get('inputMs') ?? null
  if (inputMs !== null && !isCount(inputMs)) return 'heartbeat.inputMs'
  return { type: 'heartbeat', ticks, draws, heapMB, inputMs }
}

const RESIDUE_NUMBER = /^-?\d{1,7}$/

/** `uistate.runs`: "model<TAB>chain<TAB>start<TAB>end" lines, every one checked. */
function parseRuns(text: string): UiRun[] | null {
  if (text === '') return []
  const lines = text.split('\n')
  if (lines.length > LIMITS.uiRuns) return null
  const runs: UiRun[] = []
  for (const line of lines) {
    const parts = line.split('\t')
    if (parts.length !== 4) return null
    const [model, chain, a, b] = parts
    if (model.length === 0 || model.length > LIMITS.pickModelChars || chain.length > LIMITS.uiChainChars) return null
    if (!RESIDUE_NUMBER.test(a) || !RESIDUE_NUMBER.test(b)) return null
    const start = Number(a), end = Number(b)
    if (end < start) return null
    runs.push({ model, chain, start, end })
  }
  return runs
}

const UI_WIZARDS: ReadonlySet<string> = new Set(['measurement', 'other'])

function validateUiState(f: Fields): FrameMessage | string {
  const sel = f.get('sel') ?? null
  if (sel !== null && (!isText(sel, LIMITS.uiNameChars) || sel.length === 0)) return 'uistate.sel'
  const atoms = f.get('atoms') ?? null
  if (atoms !== null && !isCount(atoms)) return 'uistate.atoms'
  const rawRuns = f.get('runs') ?? null
  let runs: UiRun[] | null = null
  if (rawRuns !== null) {
    if (!isText(rawRuns, LIMITS.uiRunsChars)) return 'uistate.runs'
    runs = parseRuns(rawRuns)
    if (runs === null) return 'uistate.runs'
  }
  const more = f.get('more') ?? false
  if (typeof more !== 'boolean') return 'uistate.more'
  const shown = f.get('shown') ?? (sel === null ? 0 : 1)
  if (!isCount(shown)) return 'uistate.shown'
  const hetero = f.get('hetero') ?? false
  if (typeof hetero !== 'boolean') return 'uistate.hetero'
  const wizard = f.get('wizard') ?? null
  if (wizard !== null && (typeof wizard !== 'string' || !UI_WIZARDS.has(wizard))) return 'uistate.wizard'
  // No selection, nothing about one; a selection named is one shown.
  if (sel === null && (atoms !== null || runs !== null || more || hetero || shown !== 0)) return 'uistate.sel'
  if (sel !== null && shown === 0) return 'uistate.shown'
  return { type: 'uistate', sel, atoms, runs, more, shown, hetero, wizard: wizard as UiState['wizard'] }
}

function validateTaken(f: Fields): FrameMessage | string {
  const req = f.get('req')
  if (!isCount(req)) return 'taken.req'
  return { type: 'taken', req }
}

/** Every inbound type, in a table that has no prototype to fall through to. */
const VALIDATORS: Readonly<Record<string, Validator>> = Object.freeze(
  Object.assign(Object.create(null) as Record<string, Validator>, {
    ready: { allowed: keys('webgl', 'maxThreads', 'allowCount', 'allowList', 'restricted', 'heapMB', 'w', 'h', 'workerMs'), check: validateReady },
    log: { allowed: keys('s'), check: validateLog },
    progress: { allowed: keys('phase', 'atoms', 'heapMB'), check: validateProgress },
    pick: { allowed: keys('atoms'), check: validatePick },
    view18: { allowed: keys('v'), check: validateView18 },
    png: { allowed: keys('nonce', 'bytes', 'w', 'h'), check: validatePng },
    pse: { allowed: keys('nonce', 'bytes'), check: validatePse },
    mol: { allowed: keys('nonce', 'bytes'), check: validateMol },
    look: { allowed: keys('nonce', 'bytes'), check: validateLook },
    snapshot: { allowed: keys('bytes'), check: validateSnapshot },
    'snapshot-skipped': { allowed: keys('bytes'), check: validateSnapshotSkipped },
    error: { allowed: keys('s', 'fatal'), check: validateError },
    heartbeat: { allowed: keys('ticks', 'draws', 'heapMB', 'inputMs'), check: validateHeartbeat },
    taken: { allowed: keys('req'), check: validateTaken },
    uistate: { allowed: keys('sel', 'atoms', 'runs', 'more', 'shown', 'hetero', 'wizard'), check: validateUiState },
  }),
)

/** The field names a type may carry (`type` included) — for tests that read worker.js. */
export function allowedFields(type: FrameMessageType): string[] {
  return [...VALIDATORS[type].allowed].sort()
}

/** An own data property's value, or undefined. Runs no getter. */
function ownValue(v: unknown, key: string): unknown {
  if (typeof v !== 'object' || v === null) return undefined
  const d = Object.getOwnPropertyDescriptor(v, key)
  return d && 'value' in d ? d.value : undefined
}

/** The `type` of a message, from its own data descriptor, or null. */
function messageType(v: unknown): string | null {
  const t = ownValue(v, 'type')
  return typeof t === 'string' ? t : null
}

/**
 * The raw `nonce` of a message that FAILED validation, if it is a short
 * string — so a reply refused for its size can still end the request it
 * answers instead of leaving it to its deadline. Runs no getter.
 */
export function rawNonce(data: unknown): string | null {
  const n = ownValue(data, 'nonce')
  return isNonce(n) ? n : null
}


/**
 * What a REFUSED message is charged: for every top-level field, its name at
 * two bytes a character plus its value's weight.
 * Each value must be one the parent can weigh without walking it: text (two
 * bytes a character), a number, boolean, null or undefined (eight), a real
 * fixed-length ArrayBuffer (its length), a list of up to 18 numbers (a
 * `view18` refused only for a non-finite number), or — as a pick's `atoms`
 * and nowhere else — up to `LIMITS.pickHardAtoms` `{model, index}` entries,
 * read as `validatePick` reads an accepted pick's: one list a message, so it
 * costs what validating one does, and a pick refused for a model name past
 * `LIMITS.pickModelChars` is a dropped click, not a stopped page (PT-3271
 * item 17).
 *
 * Null when it carries anything else — a nested object or longer list, a
 * typed-array view, a Map, more than `LIMITS.messageKeys` fields — or is not a
 * plain object. Weighing that would mean walking it, the very cost a hostile
 * frame wants the parent to pay (four review rounds of #3257), and no message
 * an honest worker sends looks like it, so the controller stops the page on
 * it instead. Reads own enumerable data properties only (all a structured
 * clone makes); runs no getter.
 */
export function refusedBytes(data: unknown): number | null {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null
  const proto: unknown = Object.getPrototypeOf(data)
  if (proto !== Object.prototype && proto !== null) return null
  const pick = messageType(data) === 'pick'
  let keys = 0
  let total = 0
  for (const key in data) {
    if (!hasOwn(data, key)) continue
    if (++keys > LIMITS.messageKeys) return null
    const d = Object.getOwnPropertyDescriptor(data, key)
    if (!d || !('value' in d)) return null
    // A pick's `atoms` that is not a list of entries (null, text, a few
    // numbers) is weighed as any other field's value is (PT-4165 item 1).
    const weight = topLevelBytes(d.value) ?? (pick && key === 'atoms' ? pickAtomsBytes(d.value) : null)
    if (weight === null) return null
    total += key.length * 2 + weight
  }
  return total
}

function topLevelBytes(v: unknown): number | null {
  if (typeof v === 'string') return v.length * 2
  if (typeof v === 'number' || typeof v === 'boolean' || v === null || v === undefined) return 8
  const buffer = arrayBufferByteLength(v)
  if (buffer !== null) return buffer
  const list = readArray(v, 18)
  if (list !== null && list.items.every(x => typeof x === 'number')) return 8 + 8 * list.length
  return null
}

/** A refused pick's `atoms` (see `refusedBytes`), or null when it is not a list of entries. */
function pickAtomsBytes(v: unknown): number | null {
  const list = readArray(v, LIMITS.pickHardAtoms)
  if (list === null) return null
  let total = 8
  for (const item of list.items) {
    const g = readFields(item, PICK_ATOM_FIELDS)
    if (typeof g === 'string') return null
    const model = g.get('model'), index = g.get('index')
    if (typeof model !== 'string' || typeof index !== 'number') return null
    total += pickEntryBytes(model.length)
  }
  return total
}

/**
 * What an ACCEPTED message cost to clone, from the fields validation already
 * read — its shape is known by now, so nothing here reads further than the
 * validator did: two bytes a character (of the text as it arrived, not as
 * kept), a real buffer's length, eight for anything else, and a pick's entries
 * by their field names and checked model names (the one entry past what is
 * kept at its most).
 */
function acceptedBytes(fields: Fields, msg: FrameMessage): number {
  let total = 0
  for (const v of fields.values()) total += typeof v === 'string' ? v.length * 2 : arrayBufferByteLength(v) ?? 8
  if (msg.type === 'pick') {
    for (const a of msg.atoms) total += pickEntryBytes(a.model.length)
    if (msg.truncated) total += pickEntryBytes(LIMITS.pickModelChars)
  }
  if (msg.type === 'view18') total += msg.v.length * 8
  return total
}

/**
 * Check one message from the frame. On success the result holds a NEW object
 * built from checked values only; on failure, a reason for the drop counter.
 */
export function validateFrameMessage(data: unknown): ValidationResult {
  const type = messageType(data)
  if (type === null) return { ok: false, reason: 'no-type', type: null }
  if (!hasOwn(VALIDATORS, type)) return { ok: false, reason: 'unknown-type', type: type.slice(0, 32) }
  const spec = VALIDATORS[type]
  const fields = readFields(data, spec.allowed)
  if (typeof fields === 'string') return { ok: false, reason: fields, type }
  const checked = spec.check(fields)
  if (typeof checked === 'string') return { ok: false, reason: checked, type }
  return { ok: true, msg: checked, bytes: acceptedBytes(fields, checked) }
}

/**
 * Why a `ready` must stop the boot, or null when the frame reports the runtime
 * this page was built for: the restricted unpickler active, resolving exactly
 * the names of `EXPECTED_ALLOW_LIST`, and one thread. This is the worker's own
 * report of what booted — it catches a runtime that came up other than
 * pinned, it does not vouch for any byte: the wheel's SHA-256 pin
 * (`PYMOL_ASSET_DIGESTS`) is what makes the unpickler the reviewed one. A frame
 * that fails this is not recovered — a rebuild would come up the same — it is
 * stopped.
 */
export function readyRefusal(r: ReadyInfo): string | null {
  if (r.restricted !== true) return 'the restricted unpickler is not active'
  if (r.allowCount !== EXPECTED_ALLOW_COUNT) return `the unpickler allow-list has ${r.allowCount} names, expected ${EXPECTED_ALLOW_COUNT}`
  const names = r.allowList.split('\n')
  if (names.join('\n') !== EXPECTED_ALLOW_LIST.join('\n')) {
    const pinned = new Set(EXPECTED_ALLOW_LIST)
    const got = new Set(names)
    const extra = names.filter(n => !pinned.has(n))
    const missing = EXPECTED_ALLOW_LIST.filter(n => !got.has(n))
    const diff = [...extra.map(n => `+${n}`), ...missing.map(n => `-${n}`)].join(' ').slice(0, 200)
    return `the unpickler allow-list is not the pinned one (${diff || 'order'})`
  }
  if (r.maxThreads !== EXPECTED_MAX_THREADS) return `max_threads is ${JSON.stringify(r.maxThreads)}, expected "1"`
  return null
}

// ---- rate / count budget ---------------------------------------------------------

/**
 * Per-type message rate, per one-second window. What the worker sends: a
 * `view18` per drawn frame while dragging (the display's refresh rate — 240 Hz
 * panels exist), a snapshot at most every 5 s, a heartbeat every second plus
 * one per click or key (at most 5/s), a `taken` per request (requests go one
 * at a time; a dropped one only leaves its request on the deadline it had
 * before it was taken). Over the rate a message is dropped, but
 * a well-formed message is not a violation for being frequent: the shape,
 * nonce and state refusals are what count toward stopping the page, and drops
 * have only their own far larger ceiling (`MAX_RATE_DROPS_IN_WINDOW`). `ready`
 * is not here: the state machine accepts it once per frame.
 */
export const RATE_PER_SECOND: Readonly<Record<string, number>> = Object.freeze(
  Object.assign(Object.create(null) as Record<string, number>, {
    log: 200, progress: 20, pick: 20, view18: 600, png: 4, pse: 4, mol: 4, look: 4, snapshot: 2, 'snapshot-skipped': 2, error: 50, heartbeat: 10, taken: 100, uistate: 120,
  }),
)

export class MessageBudget {
  private windowStart = -Infinity
  private counts = new Map<string, number>()

  /** True when one more `type` fits in the current window. */
  admit(type: string, now: number): boolean {
    // A wall clock that stepped backward opens a new window too: otherwise
    // every cap already reached would hold for the whole step.
    if (now - this.windowStart >= 1000 || now < this.windowStart) {
      this.windowStart = now
      this.counts.clear()
    }
    const cap = hasOwn(RATE_PER_SECOND, type) ? RATE_PER_SECOND[type] : 0
    const n = (this.counts.get(type) ?? 0) + 1
    if (n > cap) return false
    this.counts.set(type, n)
    return true
  }
}

// ---- outbound builders -------------------------------------------------------------
//
// `runtimeAsset` is deliberately not built here: a sender would need the same
// SHA-256 discipline as `PYMOL_ASSET_DIGESTS`, and nothing in this page needs one.

export interface Outbound {
  message: Record<string, unknown>
  transfer: ArrayBuffer[]
}

const OBJECT_NAME = /^[A-Za-z0-9_]{1,40}$/

/** `cursor{mode}`: the pointer shape `host.js` draws on its canvas (protocol 3). */
export function buildCursor(mode: FrameCursor): Outbound {
  if (!(FRAME_CURSORS as readonly string[]).includes(mode)) throw new RangeError(`cursor ${String(mode)} is not one the frame knows`)
  return { message: { type: 'cursor', mode }, transfer: [] }
}

/** A PyMOL object name the worker will not rewrite: `[A-Za-z0-9_]{1,40}`. */
export function pymolObjectName(raw: string, fallback: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 40)
  return OBJECT_NAME.test(cleaned) && /[A-Za-z0-9]/.test(cleaned) ? cleaned : fallback
}

/**
 * `load{format, bytes, obj, replace}`. `pse` is loaded as an untrusted
 * session (wizard + movie stripped; obj / replace ignored) and is capped at
 * the session ceiling; everything else at 32 MiB.
 */
export function buildLoad(a: { format: LoadFormat; bytes: ArrayBuffer; obj: string; replace: boolean }): Outbound {
  if (!(LOAD_FORMATS as readonly string[]).includes(a.format)) throw new RangeError(`format ${a.format} is not loadable`)
  const cap = a.format === 'pse' ? LIMITS.pseBytes : LIMITS.loadBytes
  if (!isBytes(a.bytes, cap)) throw new RangeError(`load bytes must be a real ArrayBuffer of 1..${cap} bytes`)
  if (!OBJECT_NAME.test(a.obj)) throw new RangeError('load obj must match [A-Za-z0-9_]{1,40}')
  return { message: { type: 'load', format: a.format, bytes: a.bytes, obj: a.obj, replace: a.replace }, transfer: [a.bytes] }
}

export function buildSetView(v: readonly number[]): Outbound {
  if (v.length !== 18 || !v.every(isFiniteNumber)) throw new RangeError('setView needs 18 finite numbers')
  return { message: { type: 'setView', v: Array.from(v) }, transfer: [] }
}

export function buildCommand(cmd: string): Outbound {
  if (typeof cmd !== 'string' || cmd.length === 0 || cmd.length > LIMITS.commandChars) {
    throw new RangeError(`command must be 1..${LIMITS.commandChars} characters`)
  }
  return { message: { type: 'command', cmd }, transfer: [] }
}

export function buildRestoreSnapshot(bytes: ArrayBuffer): Outbound {
  if (!isBytes(bytes, LIMITS.snapshotBytes)) throw new RangeError('snapshot bytes must be a real ArrayBuffer within 128 MiB')
  return { message: { type: 'restoreSnapshot', bytes }, transfer: [bytes] }
}

/**
 * The PyMOL settings a ray may carry (`exportPng{settings}`): the worker sets
 * them, ray-traces and puts the scene's own values back in ONE task, so no
 * snapshot, user command or rebuild ever sees them (PT-8382). It sets only
 * these names, and only finite numbers.
 */
export const RAY_SETTING_NAMES = ['ray_trace_mode', 'antialias', 'ray_shadows', 'ray_opaque_background', 'two_sided_lighting', 'image_dots_per_inch'] as const
export type RaySettingName = (typeof RAY_SETTING_NAMES)[number]
export type RaySettings = Partial<Record<RaySettingName, number>>

export function buildExportPng(a: { nonce: string; ray: boolean; w: number; h: number; settings?: RaySettings }): Outbound {
  if (!isNonce(a.nonce)) throw new RangeError('bad nonce')
  const message: Record<string, unknown> = { type: 'exportPng', nonce: a.nonce, ray: a.ray, w: a.w | 0, h: a.h | 0 }
  if (a.ray && a.settings !== undefined) {
    const settings: RaySettings = {}
    for (const name of RAY_SETTING_NAMES) {
      const v = a.settings[name]
      if (v === undefined) continue
      if (typeof v !== 'number' || !Number.isFinite(v)) throw new RangeError(`ray setting ${name} must be a finite number`)
      settings[name] = v
    }
    message.settings = settings
  }
  return { message: message as Outbound['message'], transfer: [] }
}

export function buildExportPse(a: { nonce: string }): Outbound {
  if (!isNonce(a.nonce)) throw new RangeError('bad nonce')
  return { message: { type: 'exportPse', nonce: a.nonce }, transfer: [] }
}

/**
 * A PyMOL selection expression this page will send: printable ASCII on one
 * line, not blank, at most `LIMITS.selectionChars`. The worker hands it to
 * Python as a JSON string literal, never as code or a command line.
 */
export function isSelectionExpression(v: unknown): v is string {
  return typeof v === 'string' && v.length <= LIMITS.selectionChars && /^[\x20-\x7e]+$/.test(v) && v.trim() !== ''
}

/**
 * `exportMol{nonce, format, selection}`: write the atoms of `selection`, in
 * their current state, as one PDB or SDF file and answer with its bytes
 * (PT-3615). The reply comes through the export gate like a png or a pse.
 */
export function buildExportMol(a: { nonce: string; format: MolFormat; selection: string }): Outbound {
  if (!isNonce(a.nonce)) throw new RangeError('bad nonce')
  if (!(MOL_FORMATS as readonly string[]).includes(a.format)) throw new RangeError(`format ${a.format} is not exportable`)
  if (!isSelectionExpression(a.selection)) throw new RangeError('not a selection expression')
  return { message: { type: 'exportMol', nonce: a.nonce, format: a.format, selection: a.selection }, transfer: [] }
}

/**
 * `exportLook{nonce}`: the scene's look — per molecule object its current
 * state as mmCIF with each atom's colour and representations, the view, the
 * background and the allow-listed settings — as JSON bytes (`pymolLook.ts`),
 * for the standalone HTML export. The reply comes through the export gate.
 */
export function buildExportLook(a: { nonce: string }): Outbound {
  if (!isNonce(a.nonce)) throw new RangeError('bad nonce')
  return { message: { type: 'exportLook', nonce: a.nonce }, transfer: [] }
}

// ---- the save gate's correlation primitive ---------------------------------------

export type ExportKind = 'png' | 'pse' | 'mol' | 'look'
export type ExportVerdict =
  | { ok: true; kind: ExportKind; nonce: string }
  | { ok: false; reason: 'unsolicited' | 'nonce-mismatch' | 'kind-mismatch' | 'replay' | 'expired' }

/**
 * Click-scoped nonces for `exportPng` / `exportPse` / `exportMol` /
 * `exportLook` (ADR-0049 § 分離構成 5; the molecule export is its 注 5, the
 * look export frame protocol 4).
 *
 * A reply is accepted only if it carries a nonce this page issued, of the kind
 * it was issued for, before its deadline, and only once. The kind the caller
 * saves is the ISSUED kind, never the reply's own `type`. A nonce answered
 * with the wrong kind is voided rather than kept open: the frame has shown it
 * is not answering honestly. The frame echoes the nonce without checking its
 * type, hence the strict string comparison. Failures arrive as a nonce-less
 * `error`, so `expire()` is what ends a request nobody answers.
 *
 * `navigator.userActivation` is deliberately not consulted: a gesture inside
 * the frame activates the parent too.
 */
export class ExportGate {
  private pending = new Map<string, { kind: ExportKind; deadline: number }>()
  private spent: string[] = []

  /** Open a request; returns its nonce. */
  issue(kind: ExportKind, now: number, timeoutMs: number, nonce: string = randomNonce()): string {
    if (!isNonce(nonce) || this.pending.has(nonce) || this.spent.includes(nonce)) throw new RangeError('nonce reuse')
    this.pending.set(nonce, { kind, deadline: now + timeoutMs })
    return nonce
  }

  /** Judge a validated png/pse/mol/look reply. A verdict of ok consumes the nonce. */
  accept(msg: { type: ExportKind; nonce: string }, now: number): ExportVerdict {
    const entry = this.pending.get(msg.nonce)
    if (entry === undefined) {
      if (this.spent.includes(msg.nonce)) return { ok: false, reason: 'replay' }
      return { ok: false, reason: this.pending.size > 0 ? 'nonce-mismatch' : 'unsolicited' }
    }
    this.settle(msg.nonce)
    if (now > entry.deadline) return { ok: false, reason: 'expired' }
    if (entry.kind !== msg.type) return { ok: false, reason: 'kind-mismatch' }
    return { ok: true, kind: entry.kind, nonce: msg.nonce }
  }

  /** Close every request past its deadline and return them. */
  expire(now: number): Array<{ nonce: string; kind: ExportKind }> {
    const out: Array<{ nonce: string; kind: ExportKind }> = []
    for (const [nonce, entry] of this.pending) {
      if (now > entry.deadline) out.push({ nonce, kind: entry.kind })
    }
    for (const o of out) this.settle(o.nonce)
    return out
  }

  /**
   * Move an open request's deadline: the page counts it from when the worker
   * took the request, which it learns only later (PT-3271 item 5).
   */
  setDeadline(nonce: string, deadline: number): void {
    const entry = this.pending.get(nonce)
    if (entry !== undefined) entry.deadline = deadline
  }

  /** Close one request without a reply (it ended by error or by deadline). */
  revoke(nonce: string): void {
    if (this.pending.has(nonce)) this.settle(nonce)
  }

  /** Close every open request (the frame is being torn down). */
  cancelAll(): Array<{ nonce: string; kind: ExportKind }> {
    const out = [...this.pending].map(([nonce, e]) => ({ nonce, kind: e.kind }))
    for (const o of out) this.settle(o.nonce)
    return out
  }

  get openCount(): number {
    return this.pending.size
  }

  private settle(nonce: string): void {
    this.pending.delete(nonce)
    this.spent.push(nonce)
    if (this.spent.length > 256) this.spent.shift()
  }
}

/** 128 bits from the platform CSPRNG, as hex. */
export function randomNonce(): string {
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  return Array.from(b, x => x.toString(16).padStart(2, '0')).join('')
}
