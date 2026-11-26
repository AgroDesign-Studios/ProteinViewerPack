/**
 * The offline file's PyMOL bridge against a scripted worker: the boot and its
 * refusals, the scene, one request at a time with each reply matched to its
 * own request, Stop, and a fatal error. The real worker runs in the headless
 * Chrome check, not here.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Script } from 'node:vm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { embeddedDoc, type StructureDoc } from './localFile'
import { workerGlAvailable } from './noGl'
import {
  coreAsClassicScript,
  DocRefused,
  docObjectName,
  estimatedPanelWidth,
  FIT_ALL,
  INTERNAL_PROMPT_OFF,
  INTERNAL_PROMPT_OFF_ORIGINAL,
  mouseGridCommand,
  MOTION_RESET,
  NO_WORKER_GL,
  objectPanelCommand,
  panelCssWidth,
  StandalonePymol,
  workerPrelude,
  workerSource,
  zoomCommand,
  type BridgeInputs,
} from './pymolBridge'
import { PINCH_GAIN } from './touchMouse'
import { PYMOL_RUNTIME_VERSION } from '../../src/pages/pymol-viewer/pymolRuntimeManifest'
import { WORKER_CORE_HOOK } from '../../src/pages/structure-html-export/standaloneFormat'

// The worker-WebGL probe runs a real worker in a browser; here it answers as told.
vi.mock('./noGl', async importOriginal => ({ ...(await importOriginal<typeof import('./noGl')>()), workerGlAvailable: vi.fn(async () => true) }))

/** A core of the vendored one's shape: one factory, `import.meta.url` inside, the export last. */
const FAKE_CORE = 'async function _createPyodideModule(moduleArg={}){return new URL("x.wasm",import.meta.url).href}export default _createPyodideModule;\n'

type Msg = Record<string, unknown> & { type: string }

class FakeWorker {
  static all: FakeWorker[] = []
  sent: Msg[] = []
  terminated = false
  onmessage: ((e: MessageEvent) => void) | null = null
  onerror: ((e: ErrorEvent) => void) | null = null
  constructor(readonly url: string) {
    FakeWorker.all.push(this)
  }
  postMessage(m: Msg) {
    this.sent.push(m)
  }
  terminate() {
    this.terminated = true
  }
  reply(m: Msg) {
    this.onmessage?.({ data: m } as MessageEvent)
  }
  last(type: string): Msg | undefined {
    return [...this.sent].reverse().find(m => m.type === type)
  }
}

const flush = async (n = 8) => {
  for (let i = 0; i < n; i++) await Promise.resolve()
}

function inputs(over: Partial<BridgeInputs> = {}): BridgeInputs {
  return {
    base: 'https://agdb-standalone.invalid/pymol/x/',
    handed: ['a.whl'],
    readBlock: async () => new ArrayBuffer(4),
    readText: async name => (name === 'pyodide-core' ? FAKE_CORE : name === 'pyodide-js' ? 'var loadPyodide = 1;' : 'self.onmessage = () => {}'),
    doc: embeddedDoc('data_x\n', 'x', 'x'),
    lookBytes: null,
    view: null,
    ...over,
  }
}

/** Boots to ready: answers init with `ready`, a heartbeat, then the scene's load. */
async function bootToReady(bridge: StandalonePymol, readyExtra: Msg = { type: 'ready', restricted: true }) {
  const started = bridge.start()
  await vi.waitFor(() => expect(FakeWorker.all[FakeWorker.all.length - 1]?.last('init')).toBeDefined())
  const w = FakeWorker.all[FakeWorker.all.length - 1]!
  w.reply(readyExtra)
  await flush()
  w.reply({ type: 'heartbeat', ticks: 1 })
  await vi.advanceTimersByTimeAsync(300)
  await flush()
  return { w, started }
}

/** Boots to ready, the scene loaded and the page's prompt-off command answered. */
async function readyBridge(bridge: StandalonePymol) {
  const { w, started } = await bootToReady(bridge)
  w.reply({ type: 'progress', phase: 'loaded', atoms: 1 })
  await started
  await flush()
  w.reply({ type: 'progress', phase: 'command' })
  await flush()
  return { w }
}

const pdb = (stem: string, serial: number): StructureDoc => ({ name: `${stem}.pdb`, stem, ext: 'pdb', bytes: new ArrayBuffer(2), text: 'xx', serial })

beforeEach(() => {
  vi.useFakeTimers()
  FakeWorker.all = []
  vi.stubGlobal('Worker', FakeWorker)
  URL.createObjectURL = vi.fn(() => 'blob:x')
  URL.revokeObjectURL = vi.fn()
  HTMLCanvasElement.prototype.transferControlToOffscreen = function () {
    return {} as OffscreenCanvas
  }
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function make(over: Partial<BridgeInputs> = {}) {
  const bridge = new StandalonePymol(inputs(over), () => 'PyMOL view')
  const host = document.createElement('div')
  document.body.appendChild(host)
  bridge.attach(host)
  return bridge
}

describe('docObjectName (owner 2026-11-21: 『Structure_25HN』)', () => {
  it('is Structure_ and the ID, cut to what a PyMOL name and worker.js keep; Structure alone without one', () => {
    expect(docObjectName('25HN')).toBe('Structure_25HN')
    expect(docObjectName('pdb_00001crn')).toBe('Structure_pdb_00001crn')
    expect(docObjectName('A-12 (x)')).toBe('Structure_A_12_x')
    expect(docObjectName('')).toBe('Structure')
    expect(docObjectName(null)).toBe('Structure')
    expect(docObjectName('###')).toBe('Structure')
    expect(docObjectName('X'.repeat(50))).toBe(`Structure_${'X'.repeat(30)}`)
  })
})

describe('StandalonePymol', () => {
  it('loads the file’s own structure as the name the page gives it (docObject)', async () => {
    const bridge = make({ docObject: 'Structure_25HN' })
    const { w } = await bootToReady(bridge)
    expect(w.last('load')).toMatchObject({ format: 'cif', obj: 'Structure_25HN', replace: true })
  })

  it('boots the worker with the prelude, the runtime and no network', async () => {
    const bridge = make()
    const { w, started } = await bootToReady(bridge)
    const init = w.last('init')!
    expect(Object.keys(init.assets as object)).toEqual(['https://agdb-standalone.invalid/pymol/x/a.whl'])
    // PyMOL's object panel (internal GUI) is on; no recovery snapshots nobody reads (PT-9090 item 10).
    expect(init.gui).toBe(1)
    expect(init.snapshots).toBe(false)
    // The scene: the structure as mmCIF, replacing everything.
    const load = w.last('load')!
    expect(load).toMatchObject({ format: 'cif', obj: 'Structure', replace: true })
    // Every request carries its number, for the worker's `taken` (PT-9108 item 8).
    expect(typeof load.req).toBe('number')
    w.reply({ type: 'progress', phase: 'loaded', atoms: 1 })
    await started
    expect(bridge.getState()).toMatchObject({ phase: 'ready', scene: 'plain' })
    // The scripts are in the worker's own script, never handed over to be loaded (WebKit, file://).
    expect(init).not.toHaveProperty('scripts')
    bridge.dispose()
  })

  it('builds the worker as one script: no blob: URL is minted inside it', async () => {
    let parts: BlobPart[] = []
    const RealBlob = Blob
    vi.stubGlobal(
      'Blob',
      class extends RealBlob {
        constructor(p: BlobPart[], o?: BlobPropertyBag) {
          super(p, o)
          parts = p
        }
      },
    )
    const bridge = make()
    await bootToReady(bridge)
    const src = parts.join('')
    expect(src).toContain('var loadPyodide = 1;')
    expect(src).toContain('self.__AGDB_CORE_FACTORY = ')
    expect(src).toContain('https://agdb-standalone.invalid/pymol/x/pyodide.asm.mjs')
    expect(src.trimEnd().endsWith('self.onmessage = () => {}')).toBe(true)
    expect(src).not.toContain('createObjectURL')
    expect(src).not.toContain('import.meta')
    bridge.dispose()
  })

  it('fails at once, with the page-worded reason, when a worker gets no WebGL', async () => {
    vi.mocked(workerGlAvailable).mockResolvedValueOnce(false)
    const readBlock = vi.fn(async () => new ArrayBuffer(4))
    const bridge = make({ readBlock })
    await bridge.start()
    // The page words it by its code, never by matching the text (PT-9308 item 5).
    expect(bridge.getState()).toMatchObject({ phase: 'failed', failure: NO_WORKER_GL, failureCode: 'no-worker-gl' })
    // Nothing read, no worker started for nothing.
    expect(readBlock).not.toHaveBeenCalled()
    expect(FakeWorker.all).toHaveLength(0)
  })

  it('asks again at the next start (Retry), and a failure of another kind carries no code', async () => {
    vi.mocked(workerGlAvailable).mockClear()
    vi.mocked(workerGlAvailable).mockResolvedValueOnce(false)
    const bridge = make()
    await bridge.start()
    expect(bridge.getState().failureCode).toBe('no-worker-gl')
    const started = bridge.start()
    await vi.waitFor(() => expect(FakeWorker.all[0]?.last('init')).toBeDefined())
    expect(workerGlAvailable).toHaveBeenCalledTimes(2)
    expect(bridge.getState()).toMatchObject({ phase: 'booting', failure: null, failureCode: null })
    FakeWorker.all[0].reply({ type: 'ready', restricted: false })
    await started
    expect(bridge.getState()).toMatchObject({ phase: 'failed', failureCode: null })
  })

  it('a dispose while the probe is out starts nothing and charges no failure (PT-9309 item 5)', async () => {
    let answer: (v: boolean | null) => void = () => undefined
    vi.mocked(workerGlAvailable).mockReturnValueOnce(new Promise(r => (answer = r)))
    const readBlock = vi.fn(async () => new ArrayBuffer(4))
    const bridge = make({ readBlock })
    const started = bridge.start()
    await flush()
    expect(bridge.getState().phase).toBe('booting')
    bridge.dispose()
    answer(false)
    await started
    expect(bridge.getState().phase).not.toBe('failed')
    expect(bridge.getState().failure).toBeNull()
    expect(readBlock).not.toHaveBeenCalled()
    expect(FakeWorker.all).toHaveLength(0)
  })

  it('starts when the probe could not tell (null): PyMOL says what it meets', async () => {
    vi.mocked(workerGlAvailable).mockResolvedValueOnce(null)
    const bridge = make()
    const { w, started } = await bootToReady(bridge)
    w.reply({ type: 'progress', phase: 'loaded', atoms: 1 })
    await started
    expect(bridge.getState().phase).toBe('ready')
    bridge.dispose()
  })

  it('refuses a runtime that does not report the restricted unpickler', async () => {
    const bridge = make()
    const started = bridge.start()
    await vi.waitFor(() => expect(FakeWorker.all[FakeWorker.all.length - 1]?.last('init')).toBeDefined())
    FakeWorker.all[0].reply({ type: 'ready', restricted: false })
    await started
    expect(bridge.getState()).toMatchObject({ phase: 'failed', failure: "its runtime is not the restricted build" })
    expect(FakeWorker.all[0].terminated).toBe(true)
  })

  it('applies the exported look, and falls back to the structure when PyMOL refuses it', async () => {
    const bridge = make({ lookBytes: new TextEncoder().encode('{}').buffer as ArrayBuffer, view: Array.from({ length: 18 }, () => 1) })
    const { w, started } = await bootToReady(bridge)
    expect(w.last('applyLook')).toBeDefined()
    w.reply({ type: 'error', s: 'look: not a look file (version)' })
    await flush()
    expect(w.last('load')).toMatchObject({ format: 'cif' })
    w.reply({ type: 'progress', phase: 'loaded' })
    await started
    await flush()
    expect(w.last('setView')).toBeDefined()
    expect(bridge.getState()).toMatchObject({ phase: 'ready', scene: 'look-failed', lookError: 'look: not a look file (version)' })
  })

  it('opens with the object panel hidden in a narrow view, set at the start, and the toggle re-lays the view out', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 360, height: 400 } as DOMRect)
    const bridge = make()
    const { w, started } = await bootToReady(bridge)
    // Off from PyMOL's start: no panel-off command after it (PT-9114 item 6).
    expect(w.last('init')?.gui).toBe(0)
    w.reply({ type: 'progress', phase: 'loaded' })
    await started
    await flush()
    expect(w.sent.filter(m => m.type === 'command').map(m => m.cmd)).toEqual([INTERNAL_PROMPT_OFF])
    expect(bridge.getState().objectPanel).toBe(false)
    w.reply({ type: 'progress', phase: 'command' })
    await flush()
    const resizes = () => w.sent.filter(m => m.type === 'resize').length
    const before = resizes()

    const toggled = bridge.toggleObjectPanel()
    await flush()
    expect(w.last('command')?.cmd).toBe(objectPanelCommand(true))
    w.reply({ type: 'progress', phase: 'command' })
    await toggled
    expect(resizes()).toBe(before + 1)
    expect(w.last('resize')).toMatchObject({ w: 360, h: 400 })
    expect(bridge.getState().objectPanel).toBe(true)
    bridge.dispose()
  })

  it('asks the worker for the panel’s width and keeps it in CSS px: the pull tab sits at its left edge (owner 2026-11-16)', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 900, height: 600 } as DOMRect)
    const bridge = make()
    const { w, started } = await bootToReady(bridge)
    expect(w.last('init')?.guiWidth).toBe(true)
    w.reply({ type: 'progress', phase: 'loaded' })
    await started
    await flush()
    expect(bridge.getState().objectPanelWidth).toBeUndefined()
    // 220 × scale 2 device px of a 1800 px buffer on a 900 px canvas: 220 CSS px.
    w.reply({ type: 'guiwidth', px: 440, bw: 1800 })
    expect(bridge.getState().objectPanelWidth).toBe(440 * 900 / 1800)
    // A report that is not two counts changes nothing.
    w.reply({ type: 'guiwidth', px: 'wide', bw: 900 })
    w.reply({ type: 'guiwidth', px: 300, bw: 0 })
    expect(bridge.getState().objectPanelWidth).toBe(220)
    // With the rows and buttons (owner 2026-11-19: the mark on the button under the mouse).
    expect(bridge.getState().objectPanelLayout).toBeUndefined()
    const geo = { px: 440, bw: 1800, bh: 1200, lh: 36, tw: 34, ts: 32, cm: 4, ops: 5, rows: 3, bottom: 328 }
    w.reply({ type: 'guiwidth', ...geo })
    expect(bridge.getState().objectPanelLayout).toEqual(geo)
    // A geometry with a bad count keeps the last good one.
    w.reply({ type: 'guiwidth', ...geo, rows: 'many' })
    expect(bridge.getState().objectPanelLayout).toEqual(geo)
    // PyMOL's mouse mode rides along (owner 2026-11-19: the 「🖱 マウス操作」 card says another one).
    expect(bridge.getState().mouseMode).toBeUndefined()
    w.reply({ type: 'guiwidth', ...geo, mode: '3-Button Editing' })
    expect(bridge.getState().mouseMode).toBe('3-Button Editing')
    w.reply({ type: 'guiwidth', ...geo, mode: 7 })
    expect(bridge.getState().mouseMode).toBe('3-Button Editing')
    // What moves the view rides along too (owner 2026-11-21: the page's motion button).
    expect(bridge.getState().motion).toBeUndefined()
    w.reply({ type: 'guiwidth', ...geo, rk: 1, rs: 2, sp: 0 })
    expect(bridge.getState().motion).toEqual({ rock: true, rockSpeed: 2, spin: 0 })
    w.reply({ type: 'guiwidth', ...geo, rk: 0, rs: 0, sp: 60 })
    expect(bridge.getState().motion).toEqual({ rock: false, rockSpeed: 0, spin: 60 })
    w.reply({ type: 'guiwidth', ...geo, rk: 'on', sp: 60 })
    w.reply({ type: 'guiwidth', ...geo, rk: 0, sp: 1e9 })
    expect(bridge.getState().motion).toEqual({ rock: false, rockSpeed: 0, spin: 60 })
    // A rock the user started (not the page's): its speed is not the page's to say.
    w.reply({ type: 'guiwidth', ...geo, rk: 1, rs: 'fast', sp: 0 })
    expect(bridge.getState().motion).toEqual({ rock: true, rockSpeed: 0, spin: 0 })
    bridge.dispose()
  })

  it('asks the worker for the object list and keeps a valid report; a restart clears it (owner 2026-11-19: the phone’s own list)', async () => {
    const bridge = make()
    const { w, started } = await bootToReady(bridge)
    expect(w.last('init')?.objectList).toBe(true)
    w.reply({ type: 'progress', phase: 'loaded' })
    await started
    await flush()
    expect(bridge.getState().objects).toBeUndefined()
    w.reply({ type: 'objects', v: 2, items: [['1abc', 'molecule', true], ['sele', 'selection', false]], more: false, focus: null, reps: null })
    expect(bridge.getState().objects).toEqual({
      v: 2,
      items: [
        { name: '1abc', kind: 'molecule', on: true },
        { name: 'sele', kind: 'selection', on: false },
      ],
      more: false,
      focus: null,
      reps: null,
    })
    // Not a list: the last good one stays.
    w.reply({ type: 'objects', v: 'two', items: [] })
    w.reply({ type: 'objects', v: 3, items: [[7, 'molecule', true]] })
    expect(bridge.getState().objects?.v).toBe(2)
    bridge.dispose()
  })

  it('keeps the worker’s sequence report as the page’s 『配列』 shows it, and drops a bad one (owner 2026-11-21)', async () => {
    const bridge = make()
    const { w, started } = await bootToReady(bridge)
    w.reply({ type: 'progress', phase: 'loaded' })
    await started
    await flush()
    expect(bridge.getState().seq).toBeUndefined()
    w.reply({ type: 'seq', v: 1, objs: ['Structure_25HN'], res: [[0, 'A', '1', 'MET']], more: false })
    expect(bridge.getState().seq).toEqual({ v: 1, objs: ['Structure_25HN'], res: [[0, 'A', '1', 'MET']], more: false })
    w.reply({ type: 'seq', v: 2, objs: ['Structure_25HN'], res: [[3, 'A', '1', 'MET']], more: false })
    expect(bridge.getState().seq?.v).toBe(1)
    bridge.dispose()
  })

  it('an action on the list names the entry by index and the list’s version, never by name, and sends nothing without a list', async () => {
    const bridge = make()
    const { w } = await readyBridge(bridge)
    await bridge.objectAction(0, { op: 'zoom' })
    expect(w.sent.filter(m => m.type === 'command' && String(m.cmd).includes('_agdb_obj'))).toHaveLength(0)
    w.reply({ type: 'objects', v: 4, items: [['x); cmd.delete("all', 'molecule', true]], more: false, focus: null, reps: null })
    const done = bridge.objectAction(0, { op: 'show', arg: 'sticks' })
    await flush()
    expect(w.last('command')?.cmd).toBe("_ /_agdb_obj(4, 0, 'show', 'sticks')")
    w.reply({ type: 'progress', phase: 'command' })
    await done
    // Every object (「すべて」) is −1.
    const all = bridge.objectAction(-1, { op: 'off' })
    await flush()
    expect(w.last('command')?.cmd).toBe("_ /_agdb_obj(4, -1, 'off', '')")
    w.reply({ type: 'progress', phase: 'command' })
    await all
    bridge.dispose()
  })

  it('the phone layout hides PyMOL’s object panel and leaving it shows the panel again; started in it, the panel starts hidden (owner 2026-11-19)', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 900, height: 600 } as DOMRect)
    const bridge = make()
    bridge.setDocked(true)
    const { w } = await readyBridge(bridge)
    // A wide view would open with it; the phone layout never shows it.
    expect(w.last('init')?.gui).toBe(0)
    expect(bridge.getState().objectPanel).toBe(false)
    const back = bridge.setDocked(false)
    expect(back).toBeUndefined()
    await flush()
    expect(w.last('command')?.cmd).toBe(objectPanelCommand(true))
    w.reply({ type: 'progress', phase: 'command' })
    await flush()
    expect(bridge.getState().objectPanel).toBe(true)
    bridge.setDocked(true)
    await flush()
    expect(w.last('command')?.cmd).toBe(objectPanelCommand(false))
    w.reply({ type: 'progress', phase: 'command' })
    await flush()
    expect(bridge.getState().objectPanel).toBe(false)
    bridge.dispose()
  })

  it('its start settings put PyMOL’s prompt and its mouse box’s grid away in one quiet Python line (owner 2026-11-19)', () => {
    expect(INTERNAL_PROMPT_OFF).toBe("_ /[cmd.set(n, 0) for n in ('internal_prompt', 'mouse_grid')]")
    expect(INTERNAL_PROMPT_OFF).not.toContain(';')
  })

  it('estimates the panel’s CSS width before the worker says it: 220 × the display scale over the DPR', () => {
    expect(estimatedPanelWidth(1)).toBe(220)
    expect(estimatedPanelWidth(2)).toBe(220)
    // Windows at 125 %: scale 1, so the panel is 176 CSS px.
    expect(estimatedPanelWidth(1.25)).toBe(176)
    // A user's own scale wins over the DPR's.
    expect(estimatedPanelWidth(1, 2)).toBe(440)
    expect(estimatedPanelWidth(0)).toBe(220)
    expect(panelCssWidth(440, 880, 440)).toBe(220)
    expect(panelCssWidth(440, 880, 0)).toBeNull()
    expect(panelCssWidth(-1, 880, 440)).toBeNull()
    expect(panelCssWidth(Number.NaN, 880, 440)).toBeNull()
  })

  it('a wide view starts with the panel shown and sends no panel command (PT-9115 item 1 d)', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 900, height: 600 } as DOMRect)
    const bridge = make()
    const { w, started } = await bootToReady(bridge)
    w.reply({ type: 'progress', phase: 'loaded' })
    await started
    await flush()
    expect(w.last('init')?.gui).toBe(1)
    expect(bridge.getState().objectPanel).toBe(true)
    expect(w.sent.filter(m => m.type === 'command').map(m => m.cmd)).toEqual([INTERNAL_PROMPT_OFF])
    bridge.dispose()
  })

  it('the display scale and the mouse grid re-lay the view out, as the panel does: PyMOL sizes its lower blocks only then (2026-11-20)', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 900, height: 600 } as DOMRect)
    const bridge = make()
    const { w } = await readyBridge(bridge)
    for (const cmd of ['set display_scale_factor, 2', mouseGridCommand(true)]) {
      const mark = w.sent.length
      const done = bridge.runCommand(cmd, { page: true })
      await flush()
      w.reply({ type: 'progress', phase: 'command' })
      await done
      await flush()
      const after = w.sent.slice(mark).filter(m => m.type === 'command' || m.type === 'resize').map(m => (m.type === 'resize' ? 'resize' : m.cmd))
      expect(after).toEqual([cmd, 'resize'])
    }
    bridge.dispose()
  })

  it('「オリジナル表示」 keeps the mouse grid at the start, and switching it while PyMOL is up sets the grid at once (owner 2026-11-20)', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 900, height: 600 } as DOMRect)
    expect(INTERNAL_PROMPT_OFF_ORIGINAL).toBe("_ /[cmd.set(n, v) for n, v in (('internal_prompt', 0), ('mouse_grid', 1))]")
    expect(mouseGridCommand(true)).toBe("_ /cmd.set('mouse_grid', 1)")
    const bridge = make()
    bridge.setOriginalPanel(true)
    const { w, started } = await bootToReady(bridge)
    w.reply({ type: 'progress', phase: 'loaded' })
    await started
    await flush()
    expect(w.sent.filter(m => m.type === 'command').map(m => m.cmd)).toEqual([INTERNAL_PROMPT_OFF_ORIGINAL])
    // Off while up: the grid goes now; the same value again sends nothing.
    w.reply({ type: 'progress', phase: 'command' })
    await flush()
    bridge.setOriginalPanel(false)
    bridge.setOriginalPanel(false)
    await flush()
    expect(w.sent.filter(m => m.type === 'command').map(m => m.cmd)).toEqual([INTERNAL_PROMPT_OFF_ORIGINAL, mouseGridCommand(false)])
    bridge.dispose()
  })

  it('File > Reinitialize, in any form PyMOL takes, puts the page’s start settings back first in line (PT-9116)', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 360, height: 400 } as DOMRect)
    const bridge = make()
    const { w } = await readyBridge(bridge)
    for (const cmd of ['/cmd.reinitialize()', 'reinit', 'reinitialize settings']) {
      const mark = w.sent.length
      const reinit = bridge.runCommand(cmd)
      const next = bridge.runCommand('show sticks')
      await flush()
      w.reply({ type: 'progress', phase: 'command' })
      await reinit
      await flush()
      // The prompt off, the panel as it was (off here), the page's motion forgotten (PT-10648
      // item 7), then the user's next command.
      for (let i = 0; i < 4; i++) {
        w.reply({ type: 'progress', phase: 'command' })
        await flush()
      }
      await next
      const after = w.sent.slice(mark).filter(m => m.type === 'command' || m.type === 'resize').map(m => (m.type === 'resize' ? 'resize' : m.cmd))
      // The start settings touch the mouse grid, which re-lays the view out too (2026-11-20).
      expect(after).toEqual([cmd, INTERNAL_PROMPT_OFF, 'resize', objectPanelCommand(false), 'resize', MOTION_RESET, 'show sticks'])
    }
    bridge.dispose()
  })

  it('the re-layout reaches the worker before the next request (PT-9114 item 5, PT-9117 item 3)', async () => {
    const bridge = make()
    const { w } = await readyBridge(bridge)
    const mark = w.sent.length
    const first = bridge.runCommand('set internal_feedback, 3')
    const second = bridge.runCommand('show sticks')
    await flush()
    w.reply({ type: 'progress', phase: 'command' })
    await first
    w.reply({ type: 'progress', phase: 'command' })
    await second
    expect(w.sent.slice(mark).map(m => (m.type === 'command' ? m.cmd : m.type))).toEqual(['set internal_feedback, 3', 'resize', 'show sticks'])
    // A substring is not a layout setting (PT-9114 item 8).
    const other = bridge.runCommand('set internal_gui_name_color_mode, 1')
    await flush()
    const before = w.sent.filter(m => m.type === 'resize').length
    w.reply({ type: 'progress', phase: 'command' })
    await other
    expect(w.sent.filter(m => m.type === 'resize').length).toBe(before)
    bridge.dispose()
  })

  it('a layout command PyMOL refuses posts no re-layout and rejects (PT-9115 item 1 b, PT-9117 item 1)', async () => {
    const bridge = make()
    const { w } = await readyBridge(bridge)
    const before = w.sent.filter(m => m.type === 'resize').length
    const done = bridge.runCommand('reinitialize settings')
    await flush()
    w.reply({ type: 'error', s: 'Error: reinitialize failed' })
    await expect(done).rejects.toThrow('reinitialize failed')
    await flush()
    expect(w.sent.filter(m => m.type === 'resize').length).toBe(before)
    // Not the start settings either: nothing changed.
    expect(w.last('command')?.cmd).toBe('reinitialize settings')
    bridge.dispose()
  })

  it('a toggle Stop ends neither rejects nor posts a re-layout to any worker, and the reboot keeps the user’s panel (PT-9115 item 1 a, PT-9117 item 2, PT-9114 item 7)', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 360, height: 400 } as DOMRect)
    const bridge = make()
    const { w } = await readyBridge(bridge)
    // The user shows the panel on the narrow view.
    const shown = bridge.toggleObjectPanel()
    await flush()
    w.reply({ type: 'progress', phase: 'command' })
    await shown
    const resizes = () => w.sent.filter(m => m.type === 'resize').length
    const before = resizes()
    const ray = bridge.exportPng({ ray: true, w: 10, h: 10 })
    const queued = bridge.toggleObjectPanel()
    await flush()
    expect(bridge.cancel()).toBe(true)
    await expect(ray).rejects.toThrow('cancelled')
    await expect(queued).resolves.toBeUndefined()
    await flush()
    expect(w.terminated).toBe(true)
    expect(resizes()).toBe(before)
    await vi.waitFor(() => expect(FakeWorker.all.length).toBeGreaterThan(1))
    const w2 = FakeWorker.all[FakeWorker.all.length - 1]!
    await vi.waitFor(() => expect(w2.last('init')).toBeDefined())
    // The panel the user chose, not the width rule.
    expect(w2.last('init')?.gui).toBe(1)
    expect(w2.sent.filter(m => m.type === 'resize')).toHaveLength(0)
    bridge.dispose()
  })

  it('runs one request at a time and matches each reply to its own request', async () => {
    const bridge = make()
    const { w, started } = await bootToReady(bridge)
    w.reply({ type: 'progress', phase: 'loaded' })
    await started
    await flush()
    w.reply({ type: 'progress', phase: 'command' }) // the page's own prompt-off command
    await flush()
    const first = bridge.runCommand('show sticks')
    const second = bridge.runCommand('bogus')
    await flush()
    expect(w.sent.filter(m => m.type === 'command').map(m => m.cmd)).toEqual([INTERNAL_PROMPT_OFF, 'show sticks'])
    expect(bridge.getState().busy).toMatchObject({ kind: 'command', label: 'show sticks', queued: 1, queuedCancels: 1 })
    w.reply({ type: 'progress', phase: 'command' })
    await expect(first).resolves.toBeUndefined()
    await flush()
    expect(w.last('command')?.cmd).toBe('bogus')
    w.reply({ type: 'error', s: 'Error: unknown command' })
    await expect(second).rejects.toThrow('Error: unknown command')
    // An export answers only with its own nonce.
    const mol = bridge.requestExport('mol', { format: 'pdb', selection: 'all' })
    await flush()
    const nonce = w.last('exportMol')!.nonce
    w.reply({ type: 'mol', nonce: 'someone-else', bytes: new ArrayBuffer(1) })
    w.reply({ type: 'mol', nonce, bytes: new ArrayBuffer(7) })
    await expect(mol).resolves.toMatchObject({ kind: 'mol' })
    expect((await mol).bytes.byteLength).toBe(7)
  })

  it('asks the worker for the live session and takes only the reply to its own nonce', async () => {
    const bridge = make()
    const { w, started } = await bootToReady(bridge)
    w.reply({ type: 'progress', phase: 'loaded' })
    await started
    await flush()
    w.reply({ type: 'progress', phase: 'command' }) // the page's own prompt-off command
    await flush()
    const pse = bridge.exportPse()
    await flush()
    const asked = w.last('exportPse')!
    expect(typeof asked.nonce).toBe('string')
    const bytes = new Uint8Array([0x80, 4]).buffer
    w.reply({ type: 'pse', nonce: 'someone-else', bytes: new ArrayBuffer(1) })
    w.reply({ type: 'pse', nonce: asked.nonce, bytes })
    await expect(pse).resolves.toBe(bytes)
    // One waiting behind another request goes unsent when its dialog closes (PT-9127 item 1).
    const running = bridge.runCommand('show sticks')
    await flush()
    const withdraw = new AbortController()
    const waiting = bridge.exportPse(withdraw.signal).catch((e: Error) => e.message)
    withdraw.abort()
    expect(await waiting).toBe('withdrawn')
    w.reply({ type: 'progress', phase: 'command' })
    await running
    await flush()
    expect(w.last('exportPse')!.nonce).toBe(asked.nonce)
  })

  it('shows an opened file instead (its own format and name, the look gone), and adds one as a further object', async () => {
    const bridge = make()
    const { w, started } = await bootToReady(bridge)
    w.reply({ type: 'progress', phase: 'loaded' })
    await started
    await flush()
    w.reply({ type: 'progress', phase: 'command' })
    await flush()
    const opened: StructureDoc = { name: 'lig.sdf', stem: 'lig', ext: 'sdf', bytes: new TextEncoder().encode('M  END\n').buffer as ArrayBuffer, text: 'M  END\n', serial: 7 }
    const shown = bridge.openDocument(opened)
    await flush()
    expect(w.last('load')).toMatchObject({ format: 'sdf', obj: 'lig', replace: true })
    w.reply({ type: 'progress', phase: 'loaded' })
    await shown
    await flush()
    expect(bridge.getState().phase).toBe('ready')
    const added = bridge.addDocument({ ...opened, name: 'lig2.pdb', stem: 'lig2', ext: 'pdb', serial: 8 })
    await flush()
    expect(w.last('load')).toMatchObject({ format: 'pdb', obj: 'lig2', replace: false })
    w.reply({ type: 'progress', phase: 'loaded' })
    await expect(added).resolves.toBeUndefined()
    // A session replaces the scene; it is never added.
    await expect(bridge.addDocument({ ...opened, ext: 'pse', text: null })).rejects.toThrow()
  })

  it('a screenshot asks the worker for its multiple of the view’s pixels; 1 or none asks for the view as it is (owner 2026-11-20)', async () => {
    const bridge = make()
    const { w } = await readyBridge(bridge)
    const bytes = new ArrayBuffer(8)
    const big = bridge.exportPng({ ray: false, scale: 3 })
    await flush()
    const asked = w.last('exportPng')!
    expect(asked).toMatchObject({ type: 'exportPng', scale: 3 })
    expect(asked).not.toHaveProperty('ray')
    w.reply({ type: 'png', nonce: asked.nonce, bytes, w: 2700, h: 1800 })
    await expect(big).resolves.toEqual({ bytes, w: 2700, h: 1800 })
    const same = bridge.exportPng({ ray: false, scale: 1 })
    await flush()
    const plain = w.last('exportPng')!
    expect(plain).not.toHaveProperty('scale')
    w.reply({ type: 'png', nonce: plain.nonce, bytes: new ArrayBuffer(8), w: 900, h: 600 })
    await expect(same).resolves.toMatchObject({ w: 900, h: 600 })
    bridge.dispose()
  })

  it('「オリジナル表示」 switched while a file loads reaches PyMOL once the file is in (PT-10132 items 3, 7)', async () => {
    const bridge = make()
    const { w, started } = await bootToReady(bridge)
    w.reply({ type: 'progress', phase: 'loaded' })
    await started
    await flush()
    w.reply({ type: 'progress', phase: 'command' })
    await flush()
    const opened: StructureDoc = { name: 'lig.sdf', stem: 'lig', ext: 'sdf', bytes: new TextEncoder().encode('M  END\n').buffer as ArrayBuffer, text: 'M  END\n', serial: 7 }
    const shown = bridge.openDocument(opened)
    await flush()
    expect(bridge.getState().phase).toBe('loading')
    bridge.setOriginalPanel(true)
    await flush()
    expect(w.sent.filter(m => m.type === 'command').map(m => m.cmd)).not.toContain(mouseGridCommand(true))
    w.reply({ type: 'progress', phase: 'loaded' })
    await shown
    await flush()
    expect(w.sent.filter(m => m.type === 'command').map(m => m.cmd)).toContain(mouseGridCommand(true))
    bridge.dispose()
  })

  it('a file opened while PyMOL starts is the one it shows; a blank file starts PyMOL empty', async () => {
    const bridge = make({ doc: null })
    const started = bridge.start()
    await vi.waitFor(() => expect(FakeWorker.all[FakeWorker.all.length - 1]?.last('init')).toBeDefined())
    const w = FakeWorker.all[FakeWorker.all.length - 1]!
    void bridge.openDocument({ name: 'a.pdb', stem: 'a', ext: 'pdb', bytes: new ArrayBuffer(3), text: 'END', serial: 3 })
    w.reply({ type: 'ready', restricted: true })
    await flush()
    w.reply({ type: 'heartbeat', ticks: 1 })
    await vi.advanceTimersByTimeAsync(300)
    await flush()
    // The file that arrived before the scene's load is the scene: loaded once, nothing blank before it.
    expect(w.sent.filter(m => m.type === 'load')).toHaveLength(1)
    expect(w.last('load')).toMatchObject({ format: 'pdb', obj: 'a', replace: true })
    w.reply({ type: 'progress', phase: 'loaded' })
    await started
    expect(bridge.getState().phase).toBe('ready')
  })

  it('a file PyMOL cannot load is refused, and PyMOL goes back to the scene it showed (PR #8239 review)', async () => {
    const bridge = make()
    const { w, started } = await bootToReady(bridge)
    w.reply({ type: 'progress', phase: 'loaded', atoms: 1 })
    await started
    await flush()
    w.reply({ type: 'progress', phase: 'command' })
    await flush()
    const bad: StructureDoc = { name: 'bad.pdb', stem: 'model', ext: 'pdb', bytes: new ArrayBuffer(2), text: 'xx', serial: 9 }
    const opened = bridge.openDocument(bad)
    await flush()
    // A stem PyMOL keeps as a word is not used bare.
    expect(w.last('load')).toMatchObject({ format: 'pdb', obj: 'f_model', replace: true })
    w.reply({ type: 'error', s: 'Error: unable to read file' })
    await flush()
    // The file's own structure again, on the same worker.
    expect(w.last('load')).toMatchObject({ format: 'cif', obj: 'Structure', replace: true })
    expect(w.terminated).toBe(false)
    w.reply({ type: 'progress', phase: 'loaded', atoms: 1 })
    await expect(opened).rejects.toThrow('unable to read file')
    expect(bridge.getState().phase).toBe('ready')
  })

  it('a session the worker could not restore is a refusal, with the worker’s reason', async () => {
    const bridge = make()
    const { w, started } = await bootToReady(bridge)
    w.reply({ type: 'progress', phase: 'loaded', atoms: 1 })
    await started
    await flush()
    w.reply({ type: 'progress', phase: 'command' })
    await flush()
    const opened = bridge.openDocument({ name: 's.pse', stem: 's', ext: 'pse', bytes: new ArrayBuffer(2), text: null, serial: 10 })
    await flush()
    expect(w.last('load')).toMatchObject({ format: 'pse' })
    // worker.js's order: loaded with no atom count, then the error.
    w.reply({ type: 'progress', phase: 'loaded', atoms: null })
    await flush()
    w.reply({ type: 'error', s: 'UnpicklingError: global builtins.eval is forbidden' })
    await flush()
    expect(w.last('load')).toMatchObject({ format: 'cif', obj: 'Structure' })
    w.reply({ type: 'progress', phase: 'loaded', atoms: 1 })
    await expect(opened).rejects.toThrow('UnpicklingError')
    expect(bridge.getState().phase).toBe('ready')
  })

  it('a saved session loads in place of the file’s own structure, which stays the document a refused file goes back to (PT-9552 item 1)', async () => {
    const own = embeddedDoc('data_x\n', 'x', 'x')
    const session: StructureDoc = { name: 'x', stem: 'x', ext: 'pse', bytes: new ArrayBuffer(3), text: null, serial: 0 }
    const look = new ArrayBuffer(5)
    const bridge = make({ doc: own, session, lookBytes: look, view: Array(18).fill(1) })
    const { w, started } = await bootToReady(bridge)
    // The session, not the look nor the structure: its own view and look.
    expect(w.last('load')).toMatchObject({ format: 'pse', obj: 'Structure', replace: true })
    expect(w.sent.some(m => m.type === 'applyLook')).toBe(false)
    w.reply({ type: 'progress', phase: 'loaded', atoms: 1 })
    await started
    await flush()
    w.reply({ type: 'progress', phase: 'command' })
    await flush()
    expect(bridge.sceneDoc()).toBe(own)
    // A .pse PyMOL refuses: the refusal names the page's structure as the scene shown, and PyMOL loads the session again.
    const bad: StructureDoc = { name: 'bad.pse', stem: 'bad', ext: 'pse', bytes: new ArrayBuffer(2), text: null, serial: 7 }
    const opened = bridge.openDocument(bad)
    await flush()
    w.reply({ type: 'progress', phase: 'loaded', atoms: null })
    await flush()
    w.reply({ type: 'error', s: 'UnpicklingError: refused' })
    await flush()
    expect(w.last('load')).toMatchObject({ format: 'pse', obj: 'Structure' })
    w.reply({ type: 'progress', phase: 'loaded', atoms: 1 })
    await expect(opened).rejects.toMatchObject({ shown: own })
    expect(bridge.sceneDoc()).toBe(own)
  })

  it('a newer file opened while a refused one loads is the one PyMOL ends on (PR #8239 review)', async () => {
    const bridge = make()
    const { w, started } = await bootToReady(bridge)
    w.reply({ type: 'progress', phase: 'loaded', atoms: 1 })
    await started
    await flush()
    w.reply({ type: 'progress', phase: 'command' })
    await flush()
    const a = bridge.openDocument({ name: 'a.pdb', stem: 'a', ext: 'pdb', bytes: new ArrayBuffer(2), text: 'xx', serial: 21 })
    await flush()
    expect(w.last('load')).toMatchObject({ obj: 'a' })
    const b = bridge.openDocument({ name: 'b.sdf', stem: 'bb', ext: 'sdf', bytes: new ArrayBuffer(2), text: 'xx', serial: 22 })
    w.reply({ type: 'error', s: 'Error: cannot read a' })
    await flush()
    // Not back to the old scene: the newer file is loaded next.
    expect(w.last('load')).toMatchObject({ format: 'sdf', obj: 'bb' })
    w.reply({ type: 'progress', phase: 'loaded', atoms: 3 })
    await expect(a).rejects.toThrow('cannot read a')
    await expect(b).resolves.toBeUndefined()
    await flush()
    expect(bridge.getState().phase).toBe('ready')
  })

  it('a session refused while PyMOL starts is told as refused, and the next start loads the file’s own structure', async () => {
    const bridge = make()
    const started = bridge.start()
    await vi.waitFor(() => expect(FakeWorker.all[FakeWorker.all.length - 1]?.last('init')).toBeDefined())
    const w = FakeWorker.all[FakeWorker.all.length - 1]!
    const opened = bridge.openDocument({ name: 's.pse', stem: 's', ext: 'pse', bytes: new ArrayBuffer(2), text: null, serial: 23 })
    w.reply({ type: 'ready', restricted: true })
    await flush()
    w.reply({ type: 'heartbeat', ticks: 1 })
    await vi.advanceTimersByTimeAsync(300)
    await flush()
    expect(w.last('load')).toMatchObject({ format: 'pse' })
    w.reply({ type: 'progress', phase: 'loaded', atoms: null })
    await flush()
    w.reply({ type: 'error', s: 'UnpicklingError: refused' })
    await expect(opened).rejects.toThrow('UnpicklingError')
    await started
    expect(bridge.getState().phase).toBe('failed')
    // Retry: the file's own structure, not the refused session.
    const again = bridge.start()
    await vi.waitFor(() => expect(FakeWorker.all[FakeWorker.all.length - 1]).not.toBe(w))
    const w2 = FakeWorker.all[FakeWorker.all.length - 1]!
    await vi.waitFor(() => expect(w2.last('init')).toBeDefined())
    w2.reply({ type: 'ready', restricted: true })
    await flush()
    w2.reply({ type: 'heartbeat', ticks: 1 })
    await vi.advanceTimersByTimeAsync(300)
    await flush()
    expect(w2.last('load')).toMatchObject({ format: 'cif', obj: 'Structure' })
    w2.reply({ type: 'progress', phase: 'loaded', atoms: 1 })
    await again
  })

  it('never adds a file under a name already in the scene', async () => {
    const bridge = make()
    const { w, started } = await bootToReady(bridge)
    w.reply({ type: 'progress', phase: 'loaded', atoms: 1 })
    await started
    await flush()
    w.reply({ type: 'progress', phase: 'command' })
    await flush()
    const doc = (stem: string, serial: number): StructureDoc => ({ name: `${stem}.pdb`, stem, ext: 'pdb', bytes: new ArrayBuffer(2), text: 'xx', serial })
    const names: unknown[] = []
    for (const [stem, serial] of [['lig', 31], ['lig', 32], ['structure', 33]] as const) {
      const added = bridge.addDocument(doc(stem, serial))
      await flush()
      names.push(w.last('load')?.obj)
      w.reply({ type: 'progress', phase: 'loaded', atoms: 1 })
      await added
    }
    expect(names).toEqual(['lig', 'lig_2', 'structure_2'])
  })

  it('a file past its deadline is not loaded again by the restart, and its open is told why (PT-9134 items 1, 4)', async () => {
    const bridge = make()
    const { w, started } = await bootToReady(bridge)
    w.reply({ type: 'progress', phase: 'loaded', atoms: 1 })
    await started
    await flush()
    w.reply({ type: 'progress', phase: 'command' })
    await flush()
    const opened = bridge.openDocument({ name: 'big.pdb', stem: 'big', ext: 'pdb', bytes: new ArrayBuffer(2), text: 'xx', serial: 40 })
    await flush()
    expect(w.last('load')).toMatchObject({ obj: 'big' })
    // Handled before the deadline fires, so the rejection is never unhandled.
    const refused = expect(opened).rejects.toThrow('rebuilt')
    w.reply({ type: 'taken', req: w.last('load')!.req })
    await vi.advanceTimersByTimeAsync(120_000)
    await refused
    expect(w.terminated).toBe(true)
    const w2 = FakeWorker.all[FakeWorker.all.length - 1]!
    await vi.waitFor(() => expect(w2.last('init')).toBeDefined())
    w2.reply({ type: 'ready', restricted: true })
    await flush()
    w2.reply({ type: 'heartbeat', ticks: 1 })
    await vi.advanceTimersByTimeAsync(300)
    await flush()
    expect(w2.last('load')).toMatchObject({ format: 'cif', obj: 'Structure' })
  })

  it('a file whose load kills the worker is told as refused, and Retry loads the last scene (PT-9134 items 2, 5)', async () => {
    const bridge = make()
    const { w, started } = await bootToReady(bridge)
    w.reply({ type: 'progress', phase: 'loaded', atoms: 1 })
    await started
    await flush()
    w.reply({ type: 'progress', phase: 'command' })
    await flush()
    const opened = bridge.openDocument({ name: 'huge.pdb', stem: 'huge', ext: 'pdb', bytes: new ArrayBuffer(2), text: 'xx', serial: 41 })
    await flush()
    w.reply({ type: 'error', s: 'worker fatal: bad_alloc', fatal: true })
    await expect(opened).rejects.toThrow('bad_alloc')
    // The refusal names the scene Retry loads, so the page shows that one (PT-9237 item 1).
    const err = await opened.then(
      () => null,
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(DocRefused)
    expect((err as DocRefused).shown?.serial).toBe(0)
    expect(bridge.getState().phase).toBe('failed')
    const again = bridge.start()
    await vi.waitFor(() => expect(FakeWorker.all[FakeWorker.all.length - 1]).not.toBe(w))
    const w2 = FakeWorker.all[FakeWorker.all.length - 1]!
    await vi.waitFor(() => expect(w2.last('init')).toBeDefined())
    w2.reply({ type: 'ready', restricted: true })
    await flush()
    w2.reply({ type: 'heartbeat', ticks: 1 })
    await vi.advanceTimersByTimeAsync(300)
    await flush()
    expect(w2.last('load')).toMatchObject({ format: 'cif', obj: 'Structure' })
    w2.reply({ type: 'progress', phase: 'loaded', atoms: 1 })
    await again
  })

  it('a file PyMOL did not add leaves its name free (PT-9134 item 6)', async () => {
    const bridge = make()
    const { w, started } = await bootToReady(bridge)
    w.reply({ type: 'progress', phase: 'loaded', atoms: 1 })
    await started
    await flush()
    w.reply({ type: 'progress', phase: 'command' })
    await flush()
    const doc = (serial: number): StructureDoc => ({ name: 'lig.pdb', stem: 'lig', ext: 'pdb', bytes: new ArrayBuffer(2), text: 'xx', serial })
    const first = bridge.addDocument(doc(50))
    await flush()
    w.reply({ type: 'error', s: 'Error: unreadable' })
    await expect(first).rejects.toThrow('unreadable')
    const second = bridge.addDocument(doc(51))
    await flush()
    expect(w.last('load')).toMatchObject({ obj: 'lig' })
    w.reply({ type: 'progress', phase: 'loaded', atoms: 1 })
    await second
  })

  it('refuses requests before PyMOL is ready', async () => {
    const bridge = make()
    await expect(bridge.runCommand('zoom')).rejects.toThrow('PyMOL is not ready')
  })

  it('Stop fails the request in flight and what waits, and starts PyMOL again', async () => {
    const bridge = make()
    const { w, started } = await bootToReady(bridge)
    w.reply({ type: 'progress', phase: 'loaded' })
    await started
    await flush()
    w.reply({ type: 'progress', phase: 'command' })
    await flush()
    const ray = bridge.exportPng({ ray: true, w: 100, h: 100 })
    const waiting = bridge.runCommand('zoom')
    await flush()
    expect(bridge.cancel()).toBe(true)
    await expect(ray).rejects.toThrow('cancelled')
    await expect(waiting).rejects.toThrow('cancelled')
    expect(w.terminated).toBe(true)
    await vi.waitFor(() => expect(FakeWorker.all).toHaveLength(2))
    expect(bridge.getState().phase).toBe('booting')
    bridge.dispose()
  })

  it('a fatal worker error stops PyMOL and says why', async () => {
    const bridge = make()
    const { w, started } = await bootToReady(bridge)
    w.reply({ type: 'progress', phase: 'loaded' })
    await started
    w.reply({ type: 'error', s: 'worker fatal: bad_alloc\nstack', fatal: true })
    expect(bridge.getState()).toMatchObject({ phase: 'failed', failure: 'worker fatal: bad_alloc' })
    expect(w.terminated).toBe(true)
  })

  it('turns touch into PyMOL mouse input: one finger rotates, a pinch zooms, and no touch scrolls the page', async () => {
    // A 400 x 300 CSS-pixel view on a 1x screen: the backing store is the same size, y up.
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 400, height: 300 } as DOMRect)
    const bridge = make()
    const { w, started } = await bootToReady(bridge)
    w.reply({ type: 'progress', phase: 'loaded' })
    await started
    // This bridge's canvas: earlier tests' hosts stay in the document.
    const canvas = [...document.querySelectorAll('canvas.sav-gl')].pop()!
    // `targetTouches` are the fingers that started on the canvas; `touches`
    // adds any other on the screen (a thumb on the bar), which the view ignores.
    const touch = (type: string, fingers: [number, number, number][], elsewhere: [number, number, number][] = [], on: Element = canvas) => {
      const e = new Event(type, { bubbles: true, cancelable: true })
      const list = (f: [number, number, number][]) => f.map(([identifier, clientX, clientY]) => ({ identifier, clientX, clientY }))
      Object.defineProperty(e, 'targetTouches', { value: list(fingers) })
      Object.defineProperty(e, 'touches', { value: list([...elsewhere, ...fingers]) })
      on.dispatchEvent(e)
      return e
    }
    const input = () => w.sent.filter(m => m.type === 'move' || m.type === 'button').map(({ type, b, state, x, y }) => ({ type, b, state, x, y }))
    const before = input().length

    // One finger: the left button, at the finger, y counted from the bottom;
    // a thumb resting elsewhere on the screen takes no part (PT-9192 item 1).
    expect(touch('touchstart', [[1, 100, 100]], [[9, 5, 290]]).defaultPrevented).toBe(true)
    expect(touch('touchmove', [[1, 140, 100]], [[9, 5, 290]]).defaultPrevented).toBe(true)
    touch('touchend', [], [[9, 5, 290]])
    expect(input().slice(before)).toEqual([
      { type: 'move', b: undefined, state: undefined, x: 100, y: 200 },
      { type: 'button', b: 0, state: 0, x: 100, y: 200 },
      { type: 'move', b: undefined, state: undefined, x: 140, y: 200 },
      { type: 'button', b: 0, state: 1, x: 140, y: 200 },
    ])

    // A pinch apart: the right button, dragged down the screen (lower y in PyMOL's pixels).
    const mark = input().length
    touch('touchstart', [[2, 150, 150], [3, 250, 150]])
    touch('touchmove', [[2, 130, 150], [3, 270, 150]])
    // A cancel lets go, whatever fingers it still lists.
    touch('touchcancel', [[2, 130, 150]])
    const pinch = input().slice(mark)
    expect(pinch.filter(m => m.type === 'button')).toEqual([
      { type: 'button', b: 2, state: 0, x: 200, y: 150 },
      { type: 'button', b: 2, state: 1, x: 200, y: 150 - PINCH_GAIN * 40 },
    ])
    bridge.dispose()
  })

  it('a finger still down on a canvas a restart replaced sends the new PyMOL nothing (PT-9194 item 2)', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 400, height: 300 } as DOMRect)
    const bridge = make()
    const { w } = await readyBridge(bridge)
    const old = [...document.querySelectorAll('canvas.sav-gl')].pop()!
    const touch = (type: string, fingers: [number, number, number][]) => {
      const e = new Event(type, { bubbles: true, cancelable: true })
      Object.defineProperty(e, 'targetTouches', { value: fingers.map(([identifier, clientX, clientY]) => ({ identifier, clientX, clientY })) })
      old.dispatchEvent(e)
    }
    touch('touchstart', [[1, 100, 100]])
    touch('touchmove', [[1, 140, 100]])
    // Stop mid-gesture: a new worker on a new canvas.
    const ray = bridge.exportPng({ ray: true, w: 10, h: 10 })
    await flush()
    expect(bridge.cancel()).toBe(true)
    await expect(ray).rejects.toThrow('cancelled')
    await vi.waitFor(() => expect(FakeWorker.all[FakeWorker.all.length - 1]).not.toBe(w))
    const w2 = FakeWorker.all[FakeWorker.all.length - 1]!
    await vi.waitFor(() => expect(w2.last('init')).toBeDefined())
    expect([...document.querySelectorAll('canvas.sav-gl')].pop()).not.toBe(old)
    touch('touchmove', [[1, 180, 100]])
    touch('touchend', [])
    expect(w2.sent.filter(m => m.type === 'move' || m.type === 'button')).toEqual([])
    bridge.dispose()
  })

  it('zooms and fits without a gesture, by PyMOL commands of the page’s own', async () => {
    const bridge = make()
    const { w, started } = await bootToReady(bridge)
    w.reply({ type: 'progress', phase: 'loaded' })
    await started
    await flush()
    w.reply({ type: 'progress', phase: 'command' }) // the page's own prompt-off command
    await flush()
    const zoomed = bridge.zoomBy(0.8)
    await flush()
    expect(w.last('command')?.cmd).toBe(zoomCommand(0.8))
    expect(zoomCommand(0.8)).toBe("_ /cmd.move('z', cmd.get_view()[11]*(0.8-1))")
    // The page's own: no busy label, so no Stop offered for it.
    expect(bridge.getState().busy).toMatchObject({ kind: 'command', label: null })
    w.reply({ type: 'progress', phase: 'command' })
    await zoomed
    const fitted = bridge.fitAll()
    await flush()
    expect(w.last('command')?.cmd).toBe(FIT_ALL)
    w.reply({ type: 'progress', phase: 'command' })
    await fitted
    bridge.dispose()
  })

  it('a fatal error between ready and the first heartbeat fails the start and loads nothing (PT-9108 items 1, 6)', async () => {
    const bridge = make()
    const started = bridge.start()
    await vi.waitFor(() => expect(FakeWorker.all[FakeWorker.all.length - 1]?.last('init')).toBeDefined())
    const w = FakeWorker.all[FakeWorker.all.length - 1]!
    w.reply({ type: 'ready', restricted: true })
    await flush()
    w.reply({ type: 'error', s: 'worker fatal: bad_alloc', fatal: true })
    await vi.advanceTimersByTimeAsync(16_000)
    await started
    expect(bridge.getState()).toMatchObject({ phase: 'failed', failure: 'worker fatal: bad_alloc' })
    expect(w.sent.filter(m => m.type === 'load' || m.type === 'applyLook')).toHaveLength(0)
    // Retry starts one PyMOL, not two.
    const again = bridge.start()
    await vi.waitFor(() => expect(FakeWorker.all).toHaveLength(2))
    await vi.advanceTimersByTimeAsync(1000)
    expect(FakeWorker.all).toHaveLength(2)
    bridge.dispose()
    await again
  })

  it('a request’s deadline counts from the worker’s taken, not from when it was sent (PT-9108 item 8)', async () => {
    const bridge = make()
    const { w } = await readyBridge(bridge)
    const cmd = bridge.runCommand('show surface')
    const refused = expect(cmd).rejects.toThrow('rebuilt')
    await flush()
    const req = w.last('command')!.req
    // The tick is still busy: past the command's own 120 s, but not taken yet.
    await vi.advanceTimersByTimeAsync(150_000)
    expect(w.terminated).toBe(false)
    w.reply({ type: 'taken', req })
    await vi.advanceTimersByTimeAsync(119_000)
    expect(w.terminated).toBe(false)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(w.terminated).toBe(true)
    await refused
    bridge.dispose()
  })

  it('the file’s own scene past its deadline fails PyMOL rather than loading it again for ever (PT-9108 item 2)', async () => {
    const bridge = make()
    const started = bridge.start()
    await vi.waitFor(() => expect(FakeWorker.all[FakeWorker.all.length - 1]?.last('init')).toBeDefined())
    const w = FakeWorker.all[0]
    w.reply({ type: 'ready', restricted: true })
    await flush()
    w.reply({ type: 'heartbeat', ticks: 1 })
    await vi.advanceTimersByTimeAsync(300)
    await flush()
    w.reply({ type: 'taken', req: w.last('load')!.req })
    await vi.advanceTimersByTimeAsync(121_000)
    await started
    expect(bridge.getState().phase).toBe('failed')
    expect(bridge.getState().failure).toMatch(/did not load .* in 120 s/)
    // No restart of its own: the Retry is the user's.
    expect(FakeWorker.all).toHaveLength(1)
  })

  it('a look past its deadline is not applied again: PyMOL starts again on the plain structure (PT-9108 item 2)', async () => {
    const bridge = make({ lookBytes: new TextEncoder().encode('{}').buffer as ArrayBuffer })
    const { w } = await bootToReady(bridge)
    w.reply({ type: 'taken', req: w.last('applyLook')!.req })
    await vi.advanceTimersByTimeAsync(121_000)
    expect(w.terminated).toBe(true)
    await vi.waitFor(() => expect(FakeWorker.all).toHaveLength(2))
    const w2 = FakeWorker.all[1]
    await vi.waitFor(() => expect(w2.last('init')).toBeDefined())
    w2.reply({ type: 'ready', restricted: true })
    await flush()
    w2.reply({ type: 'heartbeat', ticks: 1 })
    await vi.advanceTimersByTimeAsync(300)
    await flush()
    expect(w2.last('applyLook')).toBeUndefined()
    expect(w2.last('load')).toMatchObject({ format: 'cif', obj: 'Structure' })
    w2.reply({ type: 'progress', phase: 'loaded', atoms: 1 })
    await flush()
    expect(bridge.getState()).toMatchObject({ phase: 'ready', scene: 'look-failed', lookError: 'look: not applied in 120 s' })
    bridge.dispose()
  })

  it('a runtime block that never arrives fails the start with a Retry (PT-9109 item 6)', async () => {
    const bridge = make({ readBlock: () => new Promise<ArrayBuffer>(() => undefined) })
    void bridge.start()
    await vi.advanceTimersByTimeAsync(180_000)
    await flush()
    expect(bridge.getState()).toMatchObject({ phase: 'failed', failure: 'it did not start in 180 s' })
    expect(FakeWorker.all).toHaveLength(0)
  })

  it('Reset whose load runs out of time fails once, and a late message from the old worker is not the new one’s (PT-9109 item 5, PT-9108 items 3, 7)', async () => {
    const bridge = make()
    const { w } = await readyBridge(bridge)
    const reset = bridge.resetScene()
    await flush()
    w.reply({ type: 'taken', req: w.last('load')!.req })
    await vi.advanceTimersByTimeAsync(121_000)
    await reset
    // The scene's own load ran out: failed once, with its reason — never a second fail over it.
    expect(bridge.getState().phase).toBe('failed')
    expect(bridge.getState().failure).toMatch(/did not load/)
    const again = bridge.start()
    await vi.waitFor(() => expect(FakeWorker.all).toHaveLength(2))
    const w2 = FakeWorker.all[1]
    await vi.waitFor(() => expect(w2.last('init')).toBeDefined())
    w.reply({ type: 'error', s: 'worker fatal: late', fatal: true })
    expect(bridge.getState().phase).toBe('booting')
    w2.reply({ type: 'ready', restricted: true })
    await flush()
    w2.reply({ type: 'heartbeat', ticks: 1 })
    await vi.advanceTimersByTimeAsync(300)
    await flush()
    w2.reply({ type: 'progress', phase: 'loaded', atoms: 1 })
    await again
    expect(bridge.getState().phase).toBe('ready')
    expect(FakeWorker.all).toHaveLength(2)
    bridge.dispose()
  })

  it('a refused session’s error is not taken by a request queued behind it (PT-9132 item 2)', async () => {
    const bridge = make()
    const { w } = await readyBridge(bridge)
    const opened = bridge.openDocument({ name: 's.pse', stem: 's', ext: 'pse', bytes: new ArrayBuffer(2), text: null, serial: 60 })
    await flush()
    const zoom = bridge.zoomBy(0.8)
    w.reply({ type: 'progress', phase: 'loaded', atoms: null })
    await flush()
    // Still the session's request: the queued one is not posted yet.
    expect(w.sent.filter(m => m.type === 'command' && m.cmd === zoomCommand(0.8))).toHaveLength(0)
    w.reply({ type: 'error', s: 'UnpicklingError: refused' })
    await flush()
    expect(w.last('command')?.cmd).toBe(zoomCommand(0.8))
    w.reply({ type: 'progress', phase: 'command' })
    await expect(zoom).resolves.toBeUndefined()
    await flush()
    // Then the file's own structure again.
    expect(w.last('load')).toMatchObject({ obj: 'Structure' })
    w.reply({ type: 'progress', phase: 'loaded', atoms: 1 })
    await expect(opened).rejects.toThrow('UnpicklingError')
    bridge.dispose()
  })

  it('opens made while PyMOL is off settle at once, but the latest (PT-9135 item 1)', async () => {
    const bridge = make()
    const settled: string[] = []
    void bridge.openDocument(pdb('a', 70)).then(() => settled.push('a'))
    void bridge.openDocument(pdb('b', 71)).then(() => settled.push('b'))
    await flush()
    expect(settled).toEqual(['a'])
    bridge.dispose()
  })

  it('a newer file refused during the fallback load leaves PyMOL ready on the last scene (PT-9135 item 4)', async () => {
    const bridge = make()
    const { w } = await readyBridge(bridge)
    const a = bridge.openDocument(pdb('a', 80))
    const aRefused = expect(a).rejects.toThrow('cannot read a')
    await flush()
    w.reply({ type: 'error', s: 'Error: cannot read a' })
    await flush()
    // The fallback load of the file's own structure runs; b arrives during it.
    expect(w.last('load')).toMatchObject({ obj: 'Structure' })
    const b = bridge.openDocument(pdb('bb', 81))
    const bRefused = expect(b).rejects.toThrow('cannot read b')
    w.reply({ type: 'progress', phase: 'loaded', atoms: 1 })
    await flush()
    expect(w.last('load')).toMatchObject({ obj: 'bb' })
    w.reply({ type: 'error', s: 'Error: cannot read b' })
    await flush()
    expect(w.last('load')).toMatchObject({ obj: 'Structure' })
    w.reply({ type: 'progress', phase: 'loaded', atoms: 1 })
    await aRefused
    await bRefused
    await flush()
    expect(bridge.getState().phase).toBe('ready')
    expect(w.terminated).toBe(false)
    bridge.dispose()
  })

  it('names an added file as worker.js does, and keeps a suffix inside 40 characters (PT-9135 item 5)', async () => {
    const bridge = make()
    const { w } = await readyBridge(bridge)
    const long = 'x'.repeat(40)
    const names: unknown[] = []
    for (const [stem, serial] of [['a_b', 90], ['a-b', 91], [long, 92], [long, 93]] as const) {
      const added = bridge.addDocument(pdb(stem, serial))
      await flush()
      names.push(w.last('load')?.obj)
      w.reply({ type: 'progress', phase: 'loaded', atoms: 1 })
      await added
    }
    expect(names).toEqual(['a_b', 'a_b_2', long, `${'x'.repeat(38)}_2`])
    bridge.dispose()
  })

  it('a fatal error while one file loads blames that file and keeps a newer one for the next start (PT-9136, PT-9135 item 6)', async () => {
    const bridge = make()
    const { w } = await readyBridge(bridge)
    const a = bridge.openDocument(pdb('a', 100))
    const aRefused = expect(a).rejects.toThrow('bad_alloc')
    await flush()
    expect(w.last('load')).toMatchObject({ obj: 'a' })
    let bDone = false
    const b = bridge.openDocument(pdb('bb', 101))
    void b.then(
      () => (bDone = true),
      () => (bDone = true),
    )
    w.reply({ type: 'error', s: 'worker fatal: bad_alloc', fatal: true })
    await aRefused
    await flush()
    expect(bridge.getState().phase).toBe('failed')
    expect(bDone).toBe(false)
    // Retry loads b, and b's open settles as opened.
    const again = bridge.start()
    await vi.waitFor(() => expect(FakeWorker.all).toHaveLength(2))
    const w2 = FakeWorker.all[1]
    await vi.waitFor(() => expect(w2.last('init')).toBeDefined())
    w2.reply({ type: 'ready', restricted: true })
    await flush()
    w2.reply({ type: 'heartbeat', ticks: 1 })
    await vi.advanceTimersByTimeAsync(300)
    await flush()
    expect(w2.last('load')).toMatchObject({ obj: 'bb' })
    w2.reply({ type: 'progress', phase: 'loaded', atoms: 1 })
    await again
    await expect(b).resolves.toBeUndefined()
    bridge.dispose()
  })

  it('keeps the wizard PyMOL reports, for the measure chip', async () => {
    const bridge = make()
    const { w } = await bootToReady(bridge)
    w.reply({ type: 'uistate', sel: null, atoms: null, more: false, shown: 1, hetero: false, wizard: 'measurement' })
    expect(bridge.getState().ui?.wizard).toBe('measurement')
    w.reply({ type: 'uistate', wizard: '<script>' })
    expect(bridge.getState().ui?.wizard).toBeNull()
    bridge.dispose()
  })

  it('a fatal error in a ray ahead of a queued scene load does not blame the opened file: it stays the one Retry loads (PT-9220 item 2)', async () => {
    const bridge = make()
    const { w } = await readyBridge(bridge)
    const ray = bridge.exportPng({ ray: true, w: 10, h: 10 })
    await flush()
    let settled: string | null = null
    const opened = bridge.openDocument(pdb('new', 80)).then(
      () => (settled = 'opened'),
      (e: unknown) => (settled = `refused: ${String(e)}`),
    )
    await flush()
    // The load waits behind the ray: never posted.
    expect(w.sent.filter(m => m.type === 'load')).toHaveLength(1)
    w.reply({ type: 'error', s: 'RangeError: out of memory', fatal: true })
    await expect(ray).rejects.toThrow()
    await flush()
    expect(bridge.getState().phase).toBe('failed')
    expect(settled).toBeNull()
    // Retry loads the opened file, and its open settles as opened.
    const again = bridge.start()
    await vi.waitFor(() => expect(FakeWorker.all).toHaveLength(2))
    const w2 = FakeWorker.all[1]
    await vi.waitFor(() => expect(w2.last('init')).toBeDefined())
    w2.reply({ type: 'ready', restricted: true })
    await flush()
    w2.reply({ type: 'heartbeat', ticks: 1 })
    await vi.advanceTimersByTimeAsync(300)
    await flush()
    expect(w2.last('load')).toMatchObject({ obj: 'new' })
    w2.reply({ type: 'progress', phase: 'loaded', atoms: 1 })
    await again
    await opened
    expect(settled).toBe('opened')
    bridge.dispose()
  })

  it('a ray past its deadline ahead of a queued scene load restarts on the opened file, not the old scene (PT-9220 item 2)', async () => {
    const bridge = make()
    const { w } = await readyBridge(bridge)
    const ray = bridge.exportPng({ ray: true, w: 10, h: 10 })
    await flush()
    w.reply({ type: 'taken', req: w.last('exportPng')?.req })
    let settled: string | null = null
    void bridge.openDocument(pdb('new', 81)).then(
      () => (settled = 'opened'),
      () => (settled = 'refused'),
    )
    await flush()
    // Its handler first: the deadline rejects the ray inside the advance.
    const rayEnded = expect(ray).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(300_000)
    await rayEnded
    await vi.waitFor(() => expect(FakeWorker.all).toHaveLength(2))
    const w2 = FakeWorker.all[1]
    await vi.waitFor(() => expect(w2.last('init')).toBeDefined())
    w2.reply({ type: 'ready', restricted: true })
    await flush()
    w2.reply({ type: 'heartbeat', ticks: 1 })
    await vi.advanceTimersByTimeAsync(300)
    await flush()
    expect(w2.last('load')).toMatchObject({ obj: 'new' })
    expect(settled).toBeNull()
    w2.reply({ type: 'progress', phase: 'loaded', atoms: 1 })
    await flush()
    expect(settled).toBe('opened')
    bridge.dispose()
  })

  it('a fatal error in a ray settles quietly a queued file a newer one replaced, and Retry loads the newer (PT-9238 items 1, 4 b)', async () => {
    const bridge = make()
    const { w } = await readyBridge(bridge)
    const ray = bridge.exportPng({ ray: true, w: 10, h: 10 })
    await flush()
    const settled: Record<string, string> = {}
    const track = (name: string, p: Promise<void>) =>
      void p.then(
        () => (settled[name] = 'opened'),
        (e: unknown) => (settled[name] = `refused: ${String(e)}`),
      )
    track('a', bridge.openDocument(pdb('older', 86)))
    await flush()
    // a's load waits behind the ray; b replaces a while it waits.
    track('b', bridge.openDocument(pdb('newer', 87)))
    await flush()
    expect(w.sent.filter(m => m.type === 'load')).toHaveLength(1)
    expect(settled).toEqual({})
    const rayEnded = expect(ray).rejects.toThrow()
    w.reply({ type: 'error', s: 'RangeError: out of memory', fatal: true })
    await rayEnded
    await flush()
    expect(bridge.getState().phase).toBe('failed')
    // a is done waiting (its bytes go), quietly: never told as refused. b waits for Retry.
    expect(settled).toEqual({ a: 'opened' })
    const again = bridge.start()
    await vi.waitFor(() => expect(FakeWorker.all).toHaveLength(2))
    const w2 = FakeWorker.all[1]
    await vi.waitFor(() => expect(w2.last('init')).toBeDefined())
    w2.reply({ type: 'ready', restricted: true })
    await flush()
    w2.reply({ type: 'heartbeat', ticks: 1 })
    await vi.advanceTimersByTimeAsync(300)
    await flush()
    expect(w2.last('load')).toMatchObject({ obj: 'newer' })
    w2.reply({ type: 'progress', phase: 'loaded', atoms: 1 })
    await again
    await flush()
    expect(settled).toEqual({ a: 'opened', b: 'opened' })
    bridge.dispose()
  })

  it('Stop is not offered while a scene load waits behind a ray: the ray runs on and the load follows it (PT-9238 item 4 a)', async () => {
    const bridge = make()
    const { w } = await readyBridge(bridge)
    const ray = bridge.exportPng({ ray: true, w: 10, h: 10 })
    await flush()
    const opened = bridge.openDocument(pdb('new', 88))
    await flush()
    // Opening moves PyMOL to loading, where the busy bar and its Stop are hidden.
    expect(bridge.getState().phase).toBe('loading')
    expect(bridge.cancel()).toBe(false)
    expect(w.terminated).toBe(false)
    w.reply({ type: 'png', nonce: w.last('exportPng')?.nonce, bytes: new ArrayBuffer(1), w: 10, h: 10 })
    await expect(ray).resolves.toMatchObject({ w: 10, h: 10 })
    await flush()
    expect(w.last('load')).toMatchObject({ obj: 'new' })
    w.reply({ type: 'progress', phase: 'loaded', atoms: 1 })
    await expect(opened).resolves.toBeUndefined()
    bridge.dispose()
  })

  it('a heartbeat before a session’s `loaded` in the same tick changes nothing: opened, or refused with the worker’s own error (PT-9238 item 4 c)', async () => {
    const pse = (serial: number): StructureDoc => ({ name: 's.pse', stem: 's', ext: 'pse', bytes: new ArrayBuffer(2), text: null, serial })
    const bridge = make()
    const { w } = await readyBridge(bridge)
    const ok = bridge.openDocument(pse(89))
    await flush()
    w.reply({ type: 'heartbeat', ticks: 2 })
    w.reply({ type: 'progress', phase: 'loaded', atoms: 5 })
    await expect(ok).resolves.toBeUndefined()
    await flush()
    const bad = bridge.openDocument(pse(90))
    const refused = expect(bad).rejects.toThrow('UnpicklingError: refused')
    await flush()
    w.reply({ type: 'heartbeat', ticks: 3 })
    w.reply({ type: 'progress', phase: 'loaded', atoms: null })
    w.reply({ type: 'error', s: 'UnpicklingError: refused' })
    await flush()
    // Back to the session that opened.
    expect(w.last('load')).toMatchObject({ format: 'pse' })
    w.reply({ type: 'progress', phase: 'loaded', atoms: 5 })
    await refused
    bridge.dispose()
  })

  it('an export’s onSent is told when its request is posted, not while it waits behind another (PT-9232 item 2)', async () => {
    const bridge = make()
    const { w } = await readyBridge(bridge)
    const running = bridge.runCommand('show surface')
    await flush()
    const pseSent = vi.fn()
    const molSent = vi.fn()
    const pse = bridge.exportPse(undefined, pseSent)
    const mol = bridge.requestExport('mol', { format: 'pdb', selection: 'all', onSent: molSent })
    await flush()
    expect(pseSent).not.toHaveBeenCalled()
    expect(molSent).not.toHaveBeenCalled()
    w.reply({ type: 'progress', phase: 'command' })
    await running
    await flush()
    expect(w.last('exportPse')).toBeDefined()
    expect(pseSent).toHaveBeenCalledOnce()
    expect(molSent).not.toHaveBeenCalled()
    w.reply({ type: 'pse', nonce: w.last('exportPse')?.nonce, bytes: new ArrayBuffer(3) })
    await expect(pse).resolves.toHaveProperty('byteLength', 3)
    await flush()
    expect(w.last('exportMol')).toBeDefined()
    expect(molSent).toHaveBeenCalledOnce()
    w.reply({ type: 'mol', nonce: w.last('exportMol')?.nonce, bytes: new ArrayBuffer(2) })
    await expect(mol).resolves.toMatchObject({ kind: 'mol' })
    expect(pseSent).toHaveBeenCalledOnce()
    bridge.dispose()
  })

  it('two quick presses of 「オブジェクト一覧」 flip the panel twice, not set it twice (PT-9220 item 3)', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 360, height: 400 } as DOMRect)
    const bridge = make()
    const { w } = await readyBridge(bridge)
    expect(bridge.getState().objectPanel).toBe(false)
    const first = bridge.toggleObjectPanel()
    const second = bridge.toggleObjectPanel()
    await flush()
    expect(w.last('command')?.cmd).toBe(objectPanelCommand(true))
    w.reply({ type: 'progress', phase: 'command' })
    await first
    await flush()
    expect(w.last('command')?.cmd).toBe(objectPanelCommand(false))
    w.reply({ type: 'progress', phase: 'command' })
    await second
    expect(bridge.getState().objectPanel).toBe(false)
    // And the next press reads the panel as it is again.
    const third = bridge.toggleObjectPanel()
    await flush()
    expect(w.last('command')?.cmd).toBe(objectPanelCommand(true))
    w.reply({ type: 'progress', phase: 'command' })
    await third
    expect(bridge.getState().objectPanel).toBe(true)
    bridge.dispose()
  })

  it('two quick swipes the same way set the panel once, against what is already asked for, not the lagging state (PT-9400 item 1)', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 360, height: 400 } as DOMRect)
    const bridge = make()
    const { w } = await readyBridge(bridge)
    expect(bridge.getState().objectPanel).toBe(false)
    const sent = () => w.sent.filter(m => m.type === 'command').length
    const before = sent()
    const first = bridge.setObjectPanel(true)
    // The state still says closed while the first runs: the second asks nothing.
    const second = bridge.setObjectPanel(true)
    await flush()
    expect(w.last('command')?.cmd).toBe(objectPanelCommand(true))
    w.reply({ type: 'progress', phase: 'command' })
    await Promise.all([first, second])
    await flush()
    expect(sent() - before).toBe(1)
    expect(bridge.getState().objectPanel).toBe(true)
    // Already out: asks nothing. Back, then a tap, reads the panel as asked.
    await bridge.setObjectPanel(true)
    expect(sent() - before).toBe(1)
    const back = bridge.setObjectPanel(false)
    const tap = bridge.toggleObjectPanel()
    await flush()
    expect(w.last('command')?.cmd).toBe(objectPanelCommand(false))
    w.reply({ type: 'progress', phase: 'command' })
    await back
    await flush()
    expect(w.last('command')?.cmd).toBe(objectPanelCommand(true))
    w.reply({ type: 'progress', phase: 'command' })
    await tap
    expect(bridge.getState().objectPanel).toBe(true)
    bridge.dispose()
  })

  it('a session refused with no error says so at the next heartbeat, and a late error is never the next request’s (PT-9220 item 4)', async () => {
    const bridge = make()
    const { w } = await readyBridge(bridge)
    const opened = bridge.openDocument({ name: 's.pse', stem: 's', ext: 'pse', bytes: new ArrayBuffer(2), text: null, serial: 82 })
    await flush()
    w.reply({ type: 'progress', phase: 'loaded', atoms: null })
    // No clock decides: long past the old 2 s wait, the request still holds.
    await vi.advanceTimersByTimeAsync(5_000)
    expect(w.last('load')).toMatchObject({ format: 'pse' })
    w.reply({ type: 'heartbeat', ticks: 2 })
    await flush()
    // Back to the file's own structure; the refusal in general words.
    expect(w.last('load')).toMatchObject({ format: 'cif', obj: 'Structure' })
    w.reply({ type: 'progress', phase: 'loaded', atoms: 1 })
    await expect(opened).rejects.toThrow('the session could not be read')
    bridge.dispose()
  })

  it('a refused document says which scene PyMOL went back to (PT-9228 items 3, 4)', async () => {
    const bridge = make()
    const { w } = await readyBridge(bridge)
    const a = bridge.openDocument(pdb('a', 83))
    await flush()
    w.reply({ type: 'progress', phase: 'loaded', atoms: 1 })
    await a
    await flush()
    const b = bridge.openDocument({ name: 's.pse', stem: 's', ext: 'pse', bytes: new ArrayBuffer(2), text: null, serial: 84 })
    await flush()
    w.reply({ type: 'progress', phase: 'loaded', atoms: null })
    w.reply({ type: 'error', s: 'UnpicklingError: refused' })
    await flush()
    expect(w.last('load')).toMatchObject({ obj: 'a' })
    w.reply({ type: 'progress', phase: 'loaded', atoms: 1 })
    const err = await b.then(
      () => null,
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(DocRefused)
    expect((err as DocRefused).shown?.name).toBe('a.pdb')
    bridge.dispose()
  })

  it('after the look, a file added under one of its object names, hidden ones too, is a new object (PT-9220 item 5)', async () => {
    const bridge = make({ lookBytes: new TextEncoder().encode('{}').buffer as ArrayBuffer, lookObjects: ['structure_1', 'lig'] })
    const { w, started } = await bootToReady(bridge)
    expect(w.last('applyLook')).toBeDefined()
    w.reply({ type: 'progress', phase: 'loaded', atoms: 3 })
    await started
    await flush()
    w.reply({ type: 'progress', phase: 'command' })
    await flush()
    const added = bridge.addDocument(pdb('lig', 85))
    await flush()
    expect(w.last('load')).toMatchObject({ obj: 'lig_2', replace: false })
    w.reply({ type: 'progress', phase: 'loaded', atoms: 1 })
    await added
    bridge.dispose()
  })

  it('records the generation that reached ready with that state, so a failure right after it is a stop (PT-9229 item 7)', async () => {
    const bridge = make()
    const seen: (number | undefined)[] = []
    bridge.subscribe(() => seen.push(bridge.getState().readyGeneration))
    await readyBridge(bridge)
    expect(bridge.getState()).toMatchObject({ phase: 'ready', generation: 1, readyGeneration: 1 })
    expect(seen).toContain(1)
    bridge.dispose()
  })
})

describe('the worker prelude’s importScripts (PT-9308 item 4)', () => {
  const base = 'https://agdb-standalone.invalid/pymol/x/'
  function prelude() {
    const calls: string[][] = []
    const self: Record<string, unknown> = {
      importScripts: (...urls: string[]) => {
        calls.push(urls)
      },
    }
    new Script(workerPrelude(base)).runInNewContext({ self })
    return { importScripts: self.importScripts as (...urls: string[]) => void, calls }
  }

  it('loads nothing for pyodide.js alone: it is already in the worker’s script', () => {
    const { importScripts, calls } = prelude()
    importScripts(base + 'pyodide.js')
    expect(calls).toEqual([])
  })

  it('passes any other script through, without pyodide.js', () => {
    const { importScripts, calls } = prelude()
    importScripts(base + 'pyodide.js', 'https://example.invalid/other.js')
    importScripts('https://example.invalid/b.js')
    expect(calls).toEqual([['https://example.invalid/other.js'], ['https://example.invalid/b.js']])
  })

  it('refuses a data: script, so Pyodide takes the module worker’s path', () => {
    const { importScripts, calls } = prelude()
    expect(() => importScripts('data:text/javascript,1')).toThrow(/data: scripts are refused/)
    expect(calls).toEqual([])
  })
})

describe('the vendored runtime as the worker script', () => {
  const dir = join(__dirname, '../../public/vendor/pymol', PYMOL_RUNTIME_VERSION)
  const read = (f: string) => readFileSync(join(dir, f), 'utf8')
  const base = 'https://agdb-standalone.invalid/pymol/x/'

  it('the core converts to a classic script that leaves its factory, at the URL the core is imported from', () => {
    const script = coreAsClassicScript(read('pyodide.asm.mjs'), base + 'pyodide.asm.mjs')
    expect(script).not.toMatch(/\bimport\.meta\b/)
    expect(script).toContain(JSON.stringify(base + 'pyodide.asm.mjs'))
    // Evaluated as a classic script (no module syntax left), it only defines the factory: nothing runs.
    const self: Record<string, unknown> = {}
    new Script(script).runInNewContext({ self })
    expect(typeof self.__AGDB_CORE_FACTORY).toBe('function')
  })

  it('the whole worker script parses as one classic script, worker.js last with its core hook', () => {
    const workerJs = read('worker.js')
    const src = workerSource(base, read('pyodide.js'), read('pyodide.asm.mjs'), workerJs)
    expect(() => new Script(src)).not.toThrow()
    expect(src.endsWith(workerJs)).toBe(true)
    expect(workerJs).toContain(WORKER_CORE_HOOK)
  })

  it('drops pyodide.js’s source-map comment, which would sit inside the joined script', () => {
    const src = workerSource(base, 'var loadPyodide = 1;\n//# sourceMappingURL=pyodide.js.map', FAKE_CORE, 'self.onmessage = () => {}')
    expect(src).not.toContain('sourceMappingURL')
    expect(src).toContain('var loadPyodide = 1;')
  })

  it('refuses a core of another shape', () => {
    expect(() => coreAsClassicScript('export default 1;', 'u')).toThrow(/does not end with its export/)
    expect(() => coreAsClassicScript('const u = import.meta.resolve("x");\nexport default _createPyodideModule;', 'u')).toThrow(/module syntax/)
  })
})
