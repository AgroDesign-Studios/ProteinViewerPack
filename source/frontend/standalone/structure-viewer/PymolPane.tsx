import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type MutableRefObject, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import ToolbarPopover from '../../src/components/structure-viewer/ToolbarPopover'
import ViewerAnnotationLayer from '../../src/components/structure-viewer/ViewerAnnotationLayer'
import ViewerToolChips from '../../src/components/structure-viewer/ViewerToolChips'
import { useViewerAnnotation } from '../../src/components/structure-viewer/useViewerAnnotation'
import { PymolAboutDialog } from '../../src/pages/pymol-viewer/PymolAboutDialog'
import { PymolBusyBar } from '../../src/pages/pymol-viewer/PymolBusyBar'
import { PymolCommandLine } from '../../src/pages/pymol-viewer/PymolCommandLine'
import { PymolMeasureChip } from '../../src/pages/pymol-viewer/PymolMeasureChip'
import { PymolMenuBar } from '../../src/pages/pymol-viewer/PymolMenuBar'
import { PymolMenuMessage } from '../../src/pages/pymol-viewer/PymolMenuMessage'
import { PymolObjectDrawerTab, useDrawerReveal, type DrawerZoom } from '../../src/pages/pymol-viewer/PymolObjectDrawerTab'
import { appMenu, pageMenuLabels, withoutMenuPaths, type LocalAction, type MenuNode } from '../../src/pages/pymol-viewer/pymolMenuData'
import { presetMenuLabels, presetOf, usePresetRunner, type BColumn, type PresetId } from '../../src/pages/pymol-viewer/pymolPresets'
import { PymolKeysDialog, PymolSettingsDialog } from '../../src/pages/pymol-viewer/PymolSettingsDialog'
import { autoDisplayScale, useDisplayScale } from '../../src/pages/pymol-viewer/pymolDisplayScale'
import { usePymolInkRegister } from '../../src/pages/structure-detail/usePymolInkRegister'
import { useMovableHost } from './movableHost'
import { OriginalPanelSetting } from './OriginalPanelSetting'
import { useOriginalPanel } from './originalPanel'
import { controlTailRect, FRAME_BUTTONS, mouseBoxEstimate, mouseBoxRect, mouseBoxTabRoom, panelSpotAt, TAIL_CONTROLS, type ControlButton, type PanelButton, type PanelLayout, type PanelSpot } from './panelGeometry'
import { estimatedPanelWidth, failureReason, type StandalonePymol } from './pymolBridge'
import { MEASURE_ON_QUIET, PymolMeasureCard } from './PymolMeasureCard'
import { isMacLike, PymolMouseGuide } from './PymolMouseGuide'
import { MOTION_SPIN_STOP, MOTION_STOP, PymolControlTail, runningOf } from './PymolControlTail'
import { seqHighlightCommand, seqWantCommand } from './pymolSeq'
import { PymolSeqStrip, SEQ_STRIP_H } from './PymolSeqStrip'
import { LID_TAB_H, PymolMouseLid } from './PymolMouseLid'
import { PymolObjectSheet } from './PymolObjectSheet'
import { inkOntoPng, inkSceneKey, type PymolInkHandle } from './pymolInk'

/**
 * The PyMOL menu tree this file shows: the shared one (`appMenu`, with the
 * labels `pageMenuLabels` gives) without the entries this file cannot carry
 * out, and everything else as it is (owner 2026-11-14: what this file cannot do
 * is not shown), plus the file's own File 「開く…（追加）」 — a structure file
 * from this computer, added as an object (`standaloneMenu.test.ts` holds the
 * two equal but for those).
 */
export function standaloneMenu(t: Parameters<typeof pageMenuLabels>[0], bColumn: BColumn) {
  return appMenu({ ...pageMenuLabels(t, { exportHtml: false, openAgdb: false }), openFile: t('htmlExport:sa_open_menu') }, presetMenuLabels(t, bColumn))
}

/**
 * The phone's menu (owner 2026-11-19, PyMOL mode on a phone rebuilt): the
 * file's menu without what needs PyMOL's object panel or a mouse — Build
 * (modifier keys and drags), Mouse (the touch mapping assumes 3-Button
 * Viewing), Wizard (each wizard's controls are in the panel; measuring has
 * its own button and card) and Display > Internal GUI — and without
 * 創薬表示, whose presets are buttons of their own on a phone.
 */
export function phoneMenu(menu: readonly MenuNode[], presetsTitle: string): readonly MenuNode[] {
  return withoutMenuPaths(menu, new Set(['Build', 'Mouse', 'Wizard', 'Display > Internal GUI', presetsTitle]))
}

/** The presets a phone shows as buttons: of the two B-factor colourings, the one that fits the structure (`presetMenuLabels`). */
export const phonePresets = (bColumn: BColumn): readonly PresetId[] => ['ligand-site', 'pocket', bColumn === 'plddt' ? 'plddt' : 'bfactor', 'publication', 'reset']

/**
 * The file's PyMOL pane (full edition): the shared PyMOL menu bar, command line,
 * busy bar, the end of a measurement and dialogs (settings, keyboard, about), driving
 * the file's own PyMOL (`pymolBridge.ts`). Saving — pictures, the ray-traced
 * picture, molecule files and the session (`.pse`, for desktop PyMOL) — is
 * the page's one 「エクスポート」 in the header (`ExportHub`, owner
 * 2026-11-14), which File's export entries open too. Docked (the phone
 * mode) the menu row (「初期表示」 and the menu bar) and the command line are drawn in
 * `toolsHost` — the 「表示」 sheet — while it is open; the status, the busy
 * bar and the measurement chip stay by the view, which turns touch into
 * PyMOL's mouse (`touchMouse.ts`). The command line is the one element that
 * moves (`useMovableHost`): never unmounted, so its queue, history and draft
 * survive the sheet closing and the 640 px crossing. 「初期表示」 (the file's
 * own scene again) sits left of File, in one row with the menu bar (owner
 * 2026-11-15), in both layouts. A measurement is PyMOL's own Wizard >
 * Measurement (or the command line): the page has no 「📏 測定」 button of its
 * own (owner 2026-11-15: the same thing need not be offered twice), but while
 * one runs, however it started, a 「測定中・終了」 chip ends it — in the button
 * row, or by the view on a phone — since the wizard's Done is in PyMOL's
 * object panel, which may be hidden. Settings, keys and
 * About opened from the sheet's menu close the sheet first (`onDialog`):
 * both are fixed at the same z-index, and the sheet came later in the page
 * (PT-9192 item 4). PyMOL's own object panel
 * (the internal GUI, right of the view) is on wider than a phone and off on
 * one, as the bridge starts it; a pull tab laid over the view
 * (`PymolObjectDrawerTab`, owner 2026-11-15/16) shows or hides it, by a tap
 * or a swipe on the tab, in both layouts: closed at the view's right edge,
 * open just left of the panel — as wide as the worker says
 * (`objectPanelWidth`), estimated until it has — and seen only while the
 * mouse is over the panel or the tab, the keyboard's focus is on it, or on
 * a touch screen (`useDrawerReveal`). What the user chose holds for the
 * visit (the bridge's `panelWanted`), never stored.
 *
 * A phone (owner 2026-11-19: 「スマホモードでオブジェクトをPyMOLのまま残すのは
 * 無理」) has no PyMOL object panel at all (`bridge.setDocked`): an
 * 「オブジェクト」 button at the view's top right opens the 表示ツール sheet
 * on its 「オブジェクト」 tab, the page's own list (`PymolObjectSheet`). The
 * sheet's 「表示・操作」 tab has 「初期表示」, 「📏 測定」, the 創薬表示
 * presets as buttons and, folded, PyMOL's menu (`phoneMenu`) and command
 * line. Measuring, a card by the view chooses distances, angles or
 * dihedrals, deletes the last and ends (`PymolMeasureCard`): the wizard's
 * own panel is not there.
 *
 * Owner 2026-11-20 (UI consult, Opus 5.5 and Codex astra): the computer's
 * marks reach the panel's lower blocks — the movie buttons and the mouse box
 * (`panelGeometry.ts`), a button that does nothing here dashed with the
 * reason; the open panel's tab pulled sideways sizes the panel (pull to
 * zoom, `DrawerZoom`): each size is a display scale, the same value the
 * settings dialog keeps; and 「オリジナル表示」 (`originalPanel.ts`) gives the
 * panel as v1.0.0 had it — the mouse grid on a computer, and on a phone
 * PyMOL's own panel and its tab instead of the page's list. Its switch is in
 * the settings dialog (a computer) and at the head of the phone's
 * 「オブジェクト」 tab.
 *
 * Owner 2026-11-21 (UI consult, Opus 5.5 and Codex astra): PyMOL's mouse box
 * — the "Mouse Mode" lines under the rows, which PyMOL draws even with its
 * grid off — lies under a lid (`PymolMouseLid`): on a computer its tab lifts
 * the lid, open from the start in 「オリジナル表示」 (the grid there); on a
 * phone it stays shut and the grid is off even in 「オリジナル表示」
 * (「スマホ版では意味がないので完全に消す」). The lid steps aside while a
 * PyMOL menu is up and lets a drag from the view through (PR #10057's review,
 * PT-10470, PT-10471). The pull to zoom can always come back to the screen's
 * own scale (`zoomSteps`' home).
 */
/** What each of PyMOL's panel buttons does, as the desktop's mark says it. */
const PANEL_BUTTON_TEXT: Readonly<Record<PanelButton, string>> = {
  A: 'htmlExport:sa_pymol_panel_btn_a',
  S: 'htmlExport:sa_pymol_panel_btn_s',
  H: 'htmlExport:sa_pymol_panel_btn_h',
  L: 'htmlExport:sa_pymol_panel_btn_l',
  C: 'htmlExport:sa_pymol_panel_btn_c',
  M: 'htmlExport:sa_pymol_panel_btn_m',
}

/** What each of the movie buttons under the panel does (owner 2026-11-20: 下側のボタンにも). */
const CONTROL_TEXT: Readonly<Record<ControlButton, string>> = {
  rewind: 'htmlExport:sa_pymol_panel_ctl_rewind',
  back: 'htmlExport:sa_pymol_panel_ctl_back',
  stop: 'htmlExport:sa_pymol_panel_ctl_stop',
  play: 'htmlExport:sa_pymol_panel_ctl_play',
  forward: 'htmlExport:sa_pymol_panel_ctl_forward',
  end: 'htmlExport:sa_pymol_panel_ctl_end',
  seq: 'htmlExport:sa_pymol_panel_ctl_seq',
  rock: 'htmlExport:sa_pymol_panel_ctl_rock',
  full: 'htmlExport:sa_pymol_panel_ctl_full',
}

/**
 * A spot whose press does nothing here: PyMOL's own full screen (the page
 * runs PyMOL in a worker: measured, a press changes nothing; the header's
 * 「全画面」 does it), or a frame button where there is one frame only. Its
 * mark is dashed and its words say why (locked, not hidden).
 */
export function spotIsOff(s: PanelSpot, layout: PanelLayout | undefined): boolean {
  if (s.kind !== 'control' || s.control === null) return false
  return s.control === 'full' || (FRAME_BUTTONS.has(s.control) && (layout?.lower?.nf ?? 0) <= 1)
}

/** The mark's words for a spot (i18n keys, and the reason when it does nothing). */
export function spotTextKeys(s: PanelSpot, layout: PanelLayout | undefined): string[] {
  if (s.kind === 'button' && s.button !== null) return [PANEL_BUTTON_TEXT[s.button]]
  if (s.kind === 'mouse-mode') return ['htmlExport:sa_pymol_panel_mouse_mode']
  if (s.kind === 'mouse-select') return ['htmlExport:sa_pymol_panel_mouse_select']
  if (s.kind === 'control' && s.control !== null) {
    const keys = [CONTROL_TEXT[s.control]]
    if (s.control !== 'full' && spotIsOff(s, layout)) keys.push('htmlExport:sa_pymol_panel_ctl_single')
    return keys
  }
  return ['htmlExport:sa_pymol_panel_name']
}

/** A phone's sequence row and 『配列』 tag start this far down: under the 「オブジェクト」 button (8 + 44 px, .sav-objs-fab). */
export const SEQ_BELOW_OBJECTS_PX = 58

/** A right press let go within this many CSS px is a click (PyMOL's menu), not a drag (its zoom). */
export const RIGHT_CLICK_SLOP_PX = 4

/** The display scales the pull to zoom steps through (the settings dialog's 1–3; more where the screen's own scale is higher). */
export const ZOOM_SCALES = [1, 2, 3] as const

/** The view keeps at least this much (CSS px), and 40 % of itself, left of a larger panel (UI consult: Opus 320, astra 280 / 40 %). */
export const ZOOM_VIEW_MIN_PX = 280

/**
 * The pull to zoom's sizes for a panel `width` CSS px wide at display scale
 * `scale`, in a view `viewWidth` wide: one per display scale from 1, as wide
 * as the panel would be at it (the width scales with the display scale). Up
 * to the larger of now and `home` — the screen's own scale, where the panel
 * started — is always allowed, so a panel made smaller can always be pulled
 * back (owner 2026-11-21: on a phone, shrunk to 1/3 it said the view was too
 * narrow and never came back); a larger one only while the view keeps
 * `ZOOM_VIEW_MIN_PX` and 40 % of itself.
 */
export function zoomSteps(width: number, scale: number, viewWidth: number, home: number = scale): { width: number; allowed: boolean }[] {
  const top = Math.max(ZOOM_SCALES[ZOOM_SCALES.length - 1], scale, home)
  const free = Math.max(scale, home)
  const out: { width: number; allowed: boolean }[] = []
  for (let s = 1; s <= top; s++) {
    const w = (width * s) / scale
    out.push({ width: w, allowed: s <= free || viewWidth - w >= Math.max(ZOOM_VIEW_MIN_PX, viewWidth * 0.4) })
  }
  return out
}

/** Room under the sequence row for its residue box at two lines (12 px text, 6 px padding), before the pen's note. */
const SEQ_INFO_ROOM = 64

export function PymolPane(props: {
  bridge: StandalonePymol
  bColumn: BColumn
  onOpenLicences: () => void
  /** File 「開く…（追加）」: the page's open dialog, set to add to PyMOL. */
  onOpenFile: () => void
  /** File's export entries: the page's export form for that format. */
  onExport: (form: 'mol' | 'pse') => void
  /** The phone mode: the menus, buttons and command line live in `toolsHost`. */
  docked?: boolean
  /** The open 「表示」 sheet's slot for them, or null (closed, or the other engine's). */
  toolsHost?: HTMLElement | null
  /** One of PyMOL's own dialogs is opening: the page closes the sheet over it. */
  onDialog?: () => void
  /** The open sheet's 「オブジェクト」 tab's slot, or null (closed, or the other engine's). */
  objectsHost?: HTMLElement | null
  /** The view's 「オブジェクト」 button: the page opens the sheet on that tab. */
  onObjects?: () => void
  /** A phone's 「📏 測定」 started measuring: the page closes the sheet so atoms can be tapped. */
  onCloseSheet?: () => void
  /**
   * The page's company logo (a data: URI, the header's), or null. Drawn before
   * 創薬表示 (owner 2026-11-16); none, or
   * one the browser cannot draw: the label alone.
   */
  logo?: string | null
  /** This pane is the one on screen (default true): out of sight, the pen and the pointer shapes are put away. */
  shown?: boolean
  /** Filled while mounted: the page's screenshot draws the pen's lines in through it (`pictureSave`). */
  inkRef?: MutableRefObject<PymolInkHandle | null>
}) {
  const { bridge, bColumn, onOpenLicences, onOpenFile, onExport, docked = false, toolsHost = null, onDialog, logo = null } = props
  const { objectsHost = null, onObjects, onCloseSheet, shown = true, inkRef } = props
  const [logoBroken, setLogoBroken] = useState(false)
  // Where the command line is: the pane's foot, the sheet's, or nowhere (sheet closed).
  const [footSlot, setFootSlot] = useState<HTMLDivElement | null>(null)
  const [sheetSlot, setSheetSlot] = useState<HTMLDivElement | null>(null)
  const cmdHost = useMovableHost(docked ? (toolsHost !== null ? sheetSlot : null) : footSlot)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const stageId = useId()
  // The bridge draws into this pane's stage.
  useLayoutEffect(() => {
    if (stageRef.current) bridge.attach(stageRef.current)
  }, [bridge])
  const { t, i18n } = useTranslation(['pymol', 'htmlExport', 'pymolNotice'])
  const state = useSyncExternalStore(bridge.subscribe, bridge.getState)
  const ready = state.phase === 'ready'
  const [dialog, setDialog] = useState<'settings' | 'keys' | 'about' | null>(null)
  const [menuMessage, setMenuMessage] = useState('')
  const [cmdHeld, setCmdHeld] = useState(0)
  const cmdInput = useRef<HTMLInputElement | null>(null)
  // The command line is out of the document while the phone's sheet is
  // closed, and goes on sending: what it says meanwhile (a paste stopped, a
  // line that failed) is said by the view instead (PT-9229 item 5). Only
  // what it says while out: the line it showed before is not news.
  const detached = docked && toolsHost === null
  const detachedRef = useRef(detached)
  detachedRef.current = detached
  const [cmdEcho, setCmdEcho] = useState('')
  useEffect(() => setCmdEcho(''), [detached])
  const onCmdMessage = useCallback((text: string) => {
    if (detachedRef.current) setCmdEcho(text)
  }, [])
  const run = useCallback((cmd: string, opts?: { page?: boolean; label?: string }) => bridge.runCommand(cmd, opts), [bridge])
  const [scale, setScale] = useDisplayScale({ ready, generation: state.generation, run })
  // 「オリジナル表示」 (owner 2026-11-20): the panel as v1.0.0 had it — the mouse grid on a
  // computer, and on a phone PyMOL's own panel with its tab instead of the page's list.
  const { original } = useOriginalPanel()
  // The mouse grid with it on a computer only: a phone's mouse box stays shut (owner 2026-11-21).
  useEffect(() => bridge.setOriginalPanel(original && !docked), [bridge, original, docked])
  // The phone layout has no PyMOL object panel (its own list instead), unless 「オリジナル表示」: the bridge keeps it hidden there.
  const ownList = docked && !original
  useEffect(() => bridge.setDocked(ownList), [bridge, ownList])
  const { runPreset, runMenuCommand, send, clear } = usePresetRunner({ run, say: setMenuMessage, t, epoch: String(state.generation) })
  const menu = useMemo(() => standaloneMenu(t, bColumn), [t, bColumn])
  const menuOnPhone = useMemo(() => phoneMenu(menu, t('pymol:menu_presets')), [menu, t])
  // A computer's 「🖱 マウス操作」 (owner 2026-11-19: PyMOL's mouse grid goes; the card says it in words).
  const [guideOpen, setGuideOpen] = useState(false)
  const guideId = useId()
  const guideButton = useRef<HTMLButtonElement | null>(null)
  const mac = useMemo(() => isMacLike(navigator.platform ?? '', navigator.userAgent ?? ''), [])
  const presetLabels = useMemo(() => presetMenuLabels(t, bColumn), [t, bColumn])
  // The open panel's width (CSS px): the worker's report, else PyMOL's default at this scale.
  const panelWidth = state.objectPanelWidth ?? estimatedPanelWidth(window.devicePixelRatio || 1, scale === 'auto' ? undefined : scale)
  const reveal = useDrawerReveal(panelWidth)
  // Pull to zoom (owner 2026-11-20): the open panel's tab pulled sideways picks a display
  // scale — the panel's words and A S H L C buttons grow with it — kept as the settings
  // dialog's choice is (the same value), and said in words once set.
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [viewWidth, setViewWidth] = useState(0)
  useEffect(() => {
    const el = wrapRef.current
    if (el === null) return
    setViewWidth(el.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setViewWidth(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  // The canvas's place and size in the stage (CSS px): where the lid over PyMOL's mouse box goes.
  const [hostBox, setHostBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  useEffect(() => {
    const host = stageRef.current
    const wrap = wrapRef.current
    if (host === null || wrap === null) return
    const read = () => {
      const r = host.getBoundingClientRect()
      const w = wrap.getBoundingClientRect()
      const next = { x: r.left - w.left, y: r.top - w.top, w: r.width, h: r.height }
      setHostBox(prev => (prev !== null && prev.x === next.x && prev.y === next.y && prev.w === next.w && prev.h === next.h ? prev : next))
    }
    read()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(read)
    ro.observe(host)
    ro.observe(wrap)
    return () => ro.disconnect()
    // Measured again on each layout the worker reports: the canvas is laid out by then.
  }, [state.objectPanelLayout])
  // PyMOL's mouse box (owner 2026-11-21): shut by default, open in 「オリジナル表示」 on a computer, never on a phone.
  const [mouseBoxOpen, setMouseBoxOpen] = useState(false)
  useEffect(() => setMouseBoxOpen(original && !docked), [original, docked])
  const lidOpen = !docked && mouseBoxOpen
  const layoutNow = state.objectPanelLayout
  const dpr = window.devicePixelRatio || 1
  const scaleNow = scale === 'auto' ? autoDisplayScale(dpr) : scale
  // From the worker's layout; until it has said, PyMOL's defaults (PT-10470 item 6). None over
  // a PyMOL that failed: its canvas is gone or frozen (PT-10471 item 4).
  const lidRect =
    ownList || state.objectPanel !== true || hostBox === null || state.phase === 'failed'
      ? null
      : layoutNow?.lower !== undefined
        ? mouseBoxRect(layoutNow, hostBox.w, hostBox.h)
        : mouseBoxEstimate(hostBox.w, hostBox.h, panelWidth, scaleNow, dpr, original && !docked)
  // 「Seq」 and ▼ over PyMOL's S, ▼ and F (owner 2026-11-21): only where the worker said where they are.
  const tailRect =
    ownList || state.objectPanel !== true || hostBox === null || state.phase === 'failed' || layoutNow?.lower === undefined ? null : controlTailRect(layoutNow, hostBox.w, hostBox.h)
  // The page's sequence (owner 2026-11-21: the 『配列』 tag at the view's top right, and
  // 「Seq」): shown or not, and the residue lit, which PyMOL shows for the moment.
  const [seqOpen, setSeqOpen] = useState(false)
  // The residue lit, with the list's version it was lit in: an index of an older list lights
  // nothing in a newer one (PR #10172's review).
  const [litAt, setLitAt] = useState<{ v: number; i: number } | null>(null)
  const seqV = state.seq?.v
  const lit = litAt !== null && litAt.v === seqV ? litAt.i : null
  const setLit = (i: number | null) => setLitAt(i === null || seqV === undefined ? null : { v: seqV, i })
  // The worker sends the sequence while the page wants it — again after a restart.
  const seqSent = useRef<{ on: boolean; gen: number } | null>(null)
  useEffect(() => {
    if (!ready) return
    const was = seqSent.current
    if (was !== null && was.on === seqOpen && was.gen === state.generation) return
    seqSent.current = { on: seqOpen, gen: state.generation }
    // Nothing to stop in a PyMOL that never sent it.
    if (!seqOpen && (was === null || !was.on || was.gen !== state.generation)) return
    void run(seqWantCommand(seqOpen), { page: true }).catch(() => undefined)
  }, [ready, state.generation, seqOpen, run])
  // The residue lit, sent one at a time, the latest only: a mouse sweeping the row sends no queue.
  const hlWant = useRef<{ v: number; i: number } | null>(null)
  const hlBusy = useRef(false)
  // A residue is named by its index in one version of the list: a new list lights none. Closed,
  // or a new PyMOL: nothing still waiting is sent (it would light a residue again after the
  // close; the worker refuses one then too — PR #10172's review).
  useEffect(() => {
    setLitAt(null)
    if (!seqOpen) hlWant.current = null
  }, [seqV, seqOpen])
  useEffect(() => {
    hlWant.current = null
  }, [state.generation])
  const pumpHl = useCallback(() => {
    const w = hlWant.current
    if (hlBusy.current || w === null) return
    hlWant.current = null
    hlBusy.current = true
    void run(seqHighlightCommand(w.v, w.i), { page: true })
      .catch(() => undefined)
      .finally(() => {
        hlBusy.current = false
        pumpHl()
      })
  }, [run])
  useEffect(() => {
    if (!ready || !seqOpen || seqV === undefined) return
    hlWant.current = { v: seqV, i: lit ?? -1 }
    pumpHl()
  }, [lit, ready, seqOpen, seqV, pumpHl])
  // The band over the view the row lies in: left of PyMOL's panel where it shows; on a phone
  // with the page's own list, under its 「オブジェクト」 button at the top right.
  const panelShown = !ownList && state.objectPanel === true
  const seqBand =
    hostBox === null || state.phase === 'failed'
      ? null
      : { x: hostBox.x, y: hostBox.y + (ownList ? SEQ_BELOW_OBJECTS_PX : 0), w: Math.max(0, hostBox.w - (panelShown ? panelWidth : 0)) }
  // The pen (owner 2026-11-21: 「Protein Viewer Packの『描画』をPyMOLにも加える」; UI consult, Opus 5.5
  // and Codex astra): 3Dmol.js mode's lines, chips and pointer shapes, over PyMOL's whole canvas —
  // its object panel too, as a screenshot has it. PyMOL's camera says when the lines no longer sit
  // on their atoms (its view, the panel's width, the canvas's size), not the stage's drags: a drag
  // in the panel moves no camera.
  const annotation = useViewerAnnotation()
  const { setTool, setCursorMode } = annotation
  // The camera, and what it looks at: an object hidden, shown or deleted moves no camera, yet the
  // lines drawn over it no longer match (each object drawn or not; a new PyMOL; PR #10244's and
  // #10261's reviews).
  const inkGeom = useRef('')
  inkGeom.current = `${hostBox?.w ?? 0}x${hostBox?.h ?? 0}|${state.objectPanel === true ? panelWidth : 0}|${state.generation}|${inkSceneKey(state.objects)}`
  const viewToken = useCallback(() => {
    if (bridge.getState().phase !== 'ready') return null
    const v = bridge.currentView()
    return v === null ? null : `${v.join(',')}|${inkGeom.current}`
  }, [bridge])
  const outOfRegister = usePymolInkRegister(annotation, viewToken)
  const motionRunning = runningOf(state.motion) !== null
  const armedTool = annotation.tool !== 'none'
  // A pen or an eraser taken up stops the turn or the rock: a line drawn on a moving view is off at once.
  useEffect(() => {
    if (armedTool && runningOf(bridge.getState().motion) !== null) void run(MOTION_STOP, { page: true }).catch(() => undefined)
  }, [armedTool, bridge, run])
  // Out of sight (the other engine shown), the pen and the pointer shapes are put away.
  useEffect(() => {
    if (shown) return
    setTool('none')
    setCursorMode('default')
  }, [shown, setTool, setCursorMode])
  const [drawOpen, setDrawOpen] = useState(false)
  const drawRef = useRef<HTMLDivElement | null>(null)
  const drawId = useId()
  const toolName = annotation.tool === 'pen' ? t('proteindb:viewer_pen') : annotation.tool === 'eraser' ? t('proteindb:viewer_eraser') : ''
  const staleCapture = t('proteindb:viewer_ink_stale_capture')
  // The page's screenshot reaches the lines through the handle: the latest closures each render.
  useEffect(() => {
    if (inkRef === undefined) return
    inkRef.current = {
      ink: () => ({ lines: annotation.strokes.length, stale: annotation.stale || outOfRegister() }),
      take: () => {
        const strokes = annotation.strokes
        if (strokes.length === 0) return null
        // A move the layer's poll has not seen yet still captions the picture.
        const moved = outOfRegister()
        if (moved) annotation.markStale()
        const box = wrapRef.current
        const rect = box?.getBoundingClientRect() ?? null
        const ink = { strokes, stale: annotation.stale || moved }
        // The view the picture is asked at. PyMOL may make it only after another long task (a
        // surface, a load), and the view can be moved meanwhile: the picture is of the view PyMOL
        // has when it makes it, which the page has heard by the time the picture arrives (PR #10261's
        // review). Lines over another view are captioned, as on screen.
        const at = viewToken()
        return {
          lines: strokes.length,
          onto: (png, image) => {
            const since = at !== null && viewToken() !== at
            if (since) annotation.markStale()
            return inkOntoPng(png, image, box, since ? { ...ink, stale: true } : ink, staleCapture, rect)
          },
        }
      },
    }
  })
  useEffect(
    () => () => {
      if (inkRef !== undefined) inkRef.current = null
    },
    [inkRef],
  )
  // The pen's note (the tool up, the way back) under the sequence row and its box while they
  // show, not under them (PR #10244's review). Both are the stage's children, so the row's place
  // is the note's own (PR #10261's review); room for the box at two lines, which a long name or a
  // narrow window gives a computer too.
  const inkNoteTop = seqOpen && ready && seqBand !== null ? seqBand.y + SEQ_STRIP_H + SEQ_INFO_ROOM : null
  // The open box's tab sits above it only where PyMOL draws nothing (PT-10470 item 2).
  const lidTabAbove = layoutNow !== undefined && hostBox !== null && mouseBoxTabRoom(layoutNow, hostBox.h, LID_TAB_H)
  const steps = useMemo(() => zoomSteps(panelWidth, scaleNow, viewWidth, autoDisplayScale(dpr)), [panelWidth, scaleNow, viewWidth, dpr])
  const [zoomPreviewAt, setZoomPreviewAt] = useState<number | 'close' | null>(null)
  const [zoomSaid, setZoomSaid] = useState('')
  const zoom: DrawerZoom | undefined =
    viewWidth > 0 && ready
      ? {
          steps,
          current: scaleNow - 1,
          onStep: i => {
            const s = i + 1
            setScale(s === autoDisplayScale(dpr) || s > 3 ? 'auto' : (s as 1 | 2 | 3))
            setZoomSaid(t('htmlExport:sa_pymol_zoom_said', { n: s, max: steps.length }))
          },
          onPreview: setZoomPreviewAt,
          hint: t('htmlExport:sa_pymol_zoom_hint'),
        }
      : undefined
  // The desktop's mark on the panel's button (or name) under the mouse (owner 2026-11-19:
  // マウスオーバーで光らせる), from PyMOL's own layout (panelGeometry.ts). A press on a button
  // opens PyMOL's menu over the panel: no mark until the next press.
  const [spot, setSpot] = useState<(PanelSpot & { ox: number; oy: number }) | null>(null)
  // A PyMOL menu is up: a press on a row's button, or a right click (pressed and let go in
  // place) on the canvas, opens one; the next press anywhere closes it. No mark meanwhile, and
  // the mouse box's lid steps aside so a menu PyMOL draws over the box is seen (PT-10470 item 1).
  const [pyMenu, setPyMenu] = useState(false)
  // Where the press that may open or close a menu began: a right press (its release in place
  // opens one), or the left press on a row's button that opened one (let go after a drag, it
  // chose an item and the menu closed — PT-10596).
  const rightAt = useRef<{ x: number; y: number } | null>(null)
  const menuPressAt = useRef<{ x: number; y: number } | null>(null)
  // A left press on PyMOL's ■: its release there stops the page's turn too.
  const stopPressed = useRef(false)
  useEffect(() => setPyMenu(false), [state.generation, ownList])
  // A press held that began on the canvas: the lid lets its drag through (PT-10471 item 1).
  const [canvasHeld, setCanvasHeld] = useState(false)
  useEffect(() => {
    if (!canvasHeld) return
    const up = () => setCanvasHeld(false)
    window.addEventListener('pointerup', up, true)
    window.addEventListener('pointercancel', up, true)
    return () => {
      window.removeEventListener('pointerup', up, true)
      window.removeEventListener('pointercancel', up, true)
    }
  }, [canvasHeld])
  const spotKey = (v: typeof spot) => (v === null ? '' : `${v.kind}${v.button}${v.row}${v.x}${v.y}${v.w}${v.panelX}${v.ox}${v.oy}`)
  const markSpot = (e: PointerEvent<HTMLDivElement>) => {
    const layout = state.objectPanelLayout
    const host = stageRef.current
    let next: typeof spot = null
    // Only a pointer on PyMOL's canvas, not on one of the page's own overlays (▼'s choices,
    // the sequence: PT-10648 item 2).
    const onCanvas = host !== null && e.target instanceof Node && host.contains(e.target)
    if (onCanvas && !ownList && !pyMenu && e.pointerType === 'mouse' && e.buttons === 0 && layout !== undefined && state.objectPanel === true && host !== null) {
      const r = host.getBoundingClientRect()
      const w = e.currentTarget.getBoundingClientRect()
      const at = panelSpotAt(layout, e.clientX - r.left, e.clientY - r.top, r.width, r.height)
      // Under the shut lid the mouse box is not there to press.
      const lidded = !lidOpen && at !== null && (at.kind === 'mouse-mode' || at.kind === 'mouse-select')
      // PyMOL's S, ▼ and F are under the page's own buttons, which say what they do.
      const tailed = tailRect !== null && at !== null && at.kind === 'control' && at.control !== null && TAIL_CONTROLS.has(at.control)
      if (at !== null && !lidded && !tailed) next = { ...at, ox: r.left - w.left, oy: r.top - w.top }
    }
    if (spotKey(next) !== spotKey(spot)) setSpot(next)
  }
  // What of PyMOL's panel a press or release at the event's point is on (null: off the panel, or not on the canvas).
  const panelSpotFor = (e: PointerEvent<HTMLDivElement>, onCanvas: boolean): PanelSpot | null => {
    const host = stageRef.current
    const layout = state.objectPanelLayout
    if (!onCanvas || ownList || state.objectPanel !== true || layout === undefined || host === null) return null
    const r = host.getBoundingClientRect()
    return panelSpotAt(layout, e.clientX - r.left, e.clientY - r.top, r.width, r.height)
  }
  // Left of PyMOL's panel (in the view itself), for a release at the event's point.
  const inView = (e: PointerEvent<HTMLDivElement>): boolean => {
    const host = stageRef.current
    const layout = state.objectPanelLayout
    if (host === null) return false
    const r = host.getBoundingClientRect()
    const x = e.clientX - r.left
    if (x < 0 || x >= r.width) return false
    if (ownList || state.objectPanel !== true || layout === undefined || !(r.width > 0)) return true
    return x < ((layout.bw - layout.px) * r.width) / layout.bw
  }
  const stageHandlers = {
    onPointerMove: (e: PointerEvent<HTMLDivElement>) => {
      reveal.handlers.onPointerMove(e)
      markSpot(e)
    },
    onPointerDown: (e: PointerEvent<HTMLDivElement>) => {
      reveal.handlers.onPointerDown(e)
      const host = stageRef.current
      const onCanvas = host !== null && e.target instanceof Node && host.contains(e.target)
      if (onCanvas) setCanvasHeld(true)
      // A row's button opens PyMOL's menu on the press; a press while one is up closes it.
      // PyMOL's ■ stops its rock on the release there, and the page's steady turn with it
      // (owner 2026-11-21; PT-10647 item 3, PT-10648 item 8).
      const at = e.button === 0 && !pyMenu ? panelSpotFor(e, onCanvas) : null
      stopPressed.current = at?.kind === 'control' && at.control === 'stop'
      // Only a press PyMOL gets changes its menu: one on the page's own overlays leaves it as it
      // is (PT-10597 items 1, 7). A press while a menu is up is PyMOL's menu's — it chooses or
      // dismisses — and the menu is gone; else a press on a row's button opens one.
      if (onCanvas) {
        const opens = !pyMenu && at?.kind === 'button'
        setPyMenu(opens)
        menuPressAt.current = opens ? { x: e.clientX, y: e.clientY } : null
      }
      rightAt.current = onCanvas && e.button === 2 ? { x: e.clientX, y: e.clientY } : null
      setSpot(null)
    },
    onPointerUp: (e: PointerEvent<HTMLDivElement>) => {
      const moved = (from: { x: number; y: number }) => Math.hypot(e.clientX - from.x, e.clientY - from.y) >= RIGHT_CLICK_SLOP_PX
      const host = stageRef.current
      const onCanvas = host !== null && e.target instanceof Node && host.contains(e.target)
      // ■ pressed and let go on ■: PyMOL stops its rock; the page's turn stops with it.
      const stop = stopPressed.current
      stopPressed.current = false
      if (e.button === 0 && stop) {
        const there = panelSpotFor(e, onCanvas)
        if (there?.kind === 'control' && there.control === 'stop' && (state.motion?.spin ?? 0) !== 0) void run(MOTION_SPIN_STOP, { page: true }).catch(() => undefined)
      }
      // The row's menu pressed open, dragged and let go: PyMOL chose the item there and closed it.
      const opened = menuPressAt.current
      menuPressAt.current = null
      if (e.button === 0 && opened !== null && moved(opened)) setPyMenu(false)
      // A right click let go where it was pressed opens PyMOL's menu, except on the mouse box and
      // the movie buttons, which act on it themselves (PT-10597 item 2); a right drag zooms.
      const right = rightAt.current
      rightAt.current = null
      if (e.button !== 2 || right === null || moved(right)) return
      // In the view, or on a row's name or button: PyMOL's menu. Anywhere else in the panel (the
      // wizard's lines, the movie row's gaps, rows' empty space) opens none (PT-10648 item 5).
      const spot = panelSpotFor(e, true)
      if (spot !== null ? spot.kind === 'button' || spot.kind === 'name' : inView(e)) setPyMenu(true)
    },
    onPointerLeave: (e: PointerEvent<HTMLDivElement>) => {
      reveal.handlers.onPointerLeave(e)
      setSpot(null)
    },
  }

  const onMenuLocal = useCallback(
    (action: LocalAction) => {
      if (action === 'settings' || action === 'keys' || action === 'about') {
        onDialog?.()
        setDialog(action)
      } else if (action === 'export-mol') onExport('mol')
      else if (action === 'export-pse') onExport('pse')
      else if (action === 'open-file') onOpenFile()
      else {
        const preset = presetOf(action)
        if (preset !== null) runPreset(preset)
      }
      // 'open-agdb' and 'export-html' are not in this file's menu.
    },
    [runPreset, onOpenFile, onExport, onDialog],
  )

  const stop = useCallback(() => {
    cmdInput.current?.focus()
    bridge.cancel()
  }, [bridge])

  // The bridge re-labels its canvas when the language changes.
  useEffect(() => bridge.relabel(), [bridge, i18n.language])

  const failed = state.phase === 'failed'
  const statusText =
    state.phase === 'booting'
      ? t('htmlExport:sa_status_pymol_booting')
      : state.phase === 'loading'
        ? t('htmlExport:sa_status_pymol_loading')
        : failed
          ? t('htmlExport:sa_status_pymol_failed', { reason: failureReason(state, key => t(key)) })
          : state.scene === 'look-failed'
            ? t('htmlExport:sa_status_pymol_look_failed', { reason: state.lookError ?? '' })
            : ''

  // `aria-disabled`, never `disabled`: Reset sets the phase to 'loading' at
  // once, and a native disabled would drop the focus the press left on the
  // button to <body> (PT-9220 item 1); a press while not ready does nothing.
  const reset = (
    <button
      type="button"
      className="btn btn-secondary btn-sm"
      aria-disabled={ready ? undefined : true}
      onClick={() => {
        if (ready) void bridge.resetScene()
      }}
    >
      {t('htmlExport:sa_view_exported')}
    </button>
  )
  // The measurement's state is PyMOL's own wizard (`ui.wizard`).
  const measuring = state.ui?.wizard === 'measurement'
  // A measurement takes the clicks on atoms: the pen is put away.
  useEffect(() => {
    if (measuring) setTool('none')
  }, [measuring, setTool])
  // The tab stays reachable while PyMOL starts or is stopped, and says why it does nothing.
  const tabReason = ready
    ? null
    : state.phase === 'booting' || state.phase === 'loading'
      ? t('htmlExport:sa_pymol_objects_wait')
      : t('htmlExport:sa_pymol_objects_off')
  // 「初期表示」 left of File: one row, the button outside the menubar's own role (a phone: 「初期表示」 is above).
  const menuBar = (items: readonly MenuNode[]) => (
    <PymolMenuBar
      menu={items}
      disabled={!ready}
      // The app's own words (owner 2026-11-18: the engine is "Includes PyMOL™" mode).
      disabledNote={t('htmlExport:sa_pymol_menu_not_ready')}
      label={t('htmlExport:sa_pymol_menubar')}
      toggleHint={t('pymol:menu_toggle_hint')}
      onCommand={runMenuCommand}
      onLocal={onMenuLocal}
      brandLogo={{ src: logo === null || logoBroken ? null : logo, onError: () => setLogoBroken(true) }}
    />
  )
  const menuRow = (
    <div className="sav-pymol-menurow">
      {reset}
      {menuBar(menu)}
      {/* 「描画」 after PyMOL's menus (owner 2026-11-21): 3Dmol.js mode's drop-down; a tool up, the way back beside it. */}
      <div ref={drawRef} className="sv3d sav-pymol-draw">
        <ToolbarPopover id={drawId} label={t('proteindb:viewer_bar_draw')} summary={toolName} open={drawOpen} onOpen={setDrawOpen}>
          <ViewerToolChips annotation={annotation} />
        </ToolbarPopover>
        {armedTool && (
          <button
            type="button"
            className="sv3d-chip"
            onClick={() => {
              // The button goes with the tool: the focus moves to 「描画」 first, not to <body>.
              drawRef.current?.querySelector<HTMLElement>('.sv3d-pop-btn')?.focus()
              setTool('none')
            }}
          >
            {t('proteindb:viewer_navigate')}
          </button>
        )}
      </div>
      {!docked && (
        <button
          ref={guideButton}
          type="button"
          className="btn btn-secondary btn-sm sav-mouse-btn"
          aria-expanded={guideOpen}
          aria-controls={guideOpen ? guideId : undefined}
          onClick={() => setGuideOpen(o => !o)}
        >
          <span aria-hidden="true">🖱 </span>
          {t('htmlExport:sa_mouse_button')}
        </button>
      )}
    </div>
  )
  const objectCount = state.objects?.items.filter(it => it.kind !== 'selection').length ?? 0
  // While a measurement runs (begun from the Wizard menu or the command line): the way to end it.
  const measureEnd = <PymolMeasureChip ui={state.ui} ready={ready} run={cmd => run(cmd)} onLabel={t('htmlExport:sa_pymol_measure_end')} />
  // A preset's note with its 「詳しく」 and × (owner 2026-11-19). × leaves the focus on the command line
  // when it is in the document (the sheet's, or the foot's), else on the stage's pull tab.
  const note = (
    <PymolMenuMessage
      message={menuMessage}
      onDismiss={() => {
        clear()
        if (detached) stageRef.current?.parentElement?.querySelector<HTMLElement>('.sav-objs-fab')?.focus()
        else cmdInput.current?.focus()
      }}
    />
  )
  return (
    <div className="pymolv pymolv--card sav-pymol">
      {createPortal(<PymolCommandLine run={send} disabled={!ready} inputRef={cmdInput} onHeldChange={setCmdHeld} onMessage={onCmdMessage} />, cmdHost)}
      {docked &&
        toolsHost !== null &&
        createPortal(
          <div className="sav-sheet-pymol">
            <div className="sav-pymol-quick">
              {reset}
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                aria-disabled={!ready || measuring ? true : undefined}
                onClick={() => {
                  if (!ready || measuring) return
                  onCloseSheet?.()
                  void run(MEASURE_ON_QUIET).catch(() => undefined)
                }}
              >
                <span aria-hidden="true">📏 </span>
                {measuring ? t('pymol:measure_on') : t('pymol:measure')}
              </button>
            </div>
            <div className="sav-pymol-presets" role="group" aria-label={presetLabels.title}>
              <span className="sav-pymol-presets-title" aria-hidden="true">
                {presetLabels.title}
              </span>
              {phonePresets(bColumn).map(id => (
                <button
                  key={id}
                  type="button"
                  className="btn btn-secondary btn-sm"
                  aria-disabled={ready ? undefined : true}
                  onClick={() => {
                    if (ready) runPreset(id)
                  }}
                >
                  {presetLabels.items[id]}
                </button>
              ))}
            </div>
            {/* 「描画」 (owner 2026-11-21): the chips 3Dmol.js mode's sheet has. */}
            <div className="sv3d sav-pymol-presets sav-pymol-draw-sheet" role="group" aria-label={t('proteindb:viewer_bar_draw')}>
              <span className="sav-pymol-presets-title" aria-hidden="true">
                {t('proteindb:viewer_bar_draw')}
              </span>
              <ViewerToolChips annotation={annotation} />
            </div>
            {/* PyMOL's menu and command line, for those who know them: folded. */}
            <details className="sav-pymol-more">
              <summary>{t('htmlExport:sa_pymol_more')}</summary>
              <div className="sav-pymol-menurow">{menuBar(menuOnPhone)}</div>
              <div ref={setSheetSlot} className="pymolv-foot" />
            </details>
          </div>,
          toolsHost,
        )}
      {docked &&
        objectsHost !== null &&
        createPortal(
          <>
            {/* 「オリジナル表示」 first (owner 2026-11-20): on, PyMOL's own panel replaces the list (the switch's note says where it is). */}
            <OriginalPanelSetting phone />
            {!original && <PymolObjectSheet objects={state.objects} ready={ready} act={bridge.objectAction} />}
          </>,
          objectsHost,
        )}
      <div className="pymolv-bar">
        {!docked && measuring && measureEnd}
        <p role="status" className="pymolv-status">
          {failed ? '' : statusText}
        </p>
        <p role="alert" className="pymolv-error">
          {failed ? statusText : ''}
        </p>
        {failed && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void bridge.start()}>
            {t('htmlExport:sa_retry')}
          </button>
        )}
      </div>
      {!docked && menuRow}
      <div
        ref={wrapRef}
        className={`pymolv-stage-wrap sav-pymol-stage sv3d sv3d-stage sv3d-cursor-${annotation.cursorMode}${spot !== null ? ' is-panel-spot' : ''}${docked && (menuMessage !== '' || measuring) ? ' has-note' : ''}`}
        style={inkNoteTop === null ? undefined : ({ '--sav-ink-note-top': `${inkNoteTop}px` } as CSSProperties)}
        {...stageHandlers}
      >
        {/* The panel's button, name, movie button or mouse box under the mouse, and what it does: decoration over the canvas, taking no pointer. */}
        {spot !== null && (
          <>
            <div
              className={`sav-panel-mark${spotIsOff(spot, state.objectPanelLayout) ? ' sav-panel-mark--off' : ''}`}
              aria-hidden="true"
              style={{ left: spot.ox + spot.x, top: spot.oy + spot.y, width: spot.w, height: spot.h }}
            />
            <div className="sav-panel-tip" aria-hidden="true" style={{ left: spot.ox + spot.panelX, top: spot.oy + spot.y + spot.h / 2 }}>
              {spotTextKeys(spot, state.objectPanelLayout)
                .map(k => t(k))
                .join(' ')}
            </div>
          </>
        )}
        {/* PyMOL's mouse box under its lid (owner 2026-11-21): a computer's tab lifts it; a phone's stays shut. */}
        {lidRect !== null && hostBox !== null && (
          <PymolMouseLid
            rect={{ x: hostBox.x + lidRect.x, y: hostBox.y + lidRect.y, w: lidRect.w, h: lidRect.h }}
            open={lidOpen}
            tabAbove={lidTabAbove}
            aside={pyMenu}
            through={canvasHeld}
            onToggle={docked ? undefined : () => setMouseBoxOpen(o => !o)}
            label={t('htmlExport:sa_pymol_mouse_box_tab')}
            hint={t('htmlExport:sa_pymol_mouse_box_hint')}
          />
        )}
        {/* 「Seq」 and ▼ over PyMOL's S, ▼ and F (owner 2026-11-21): F, which does nothing here, is gone. */}
        {tailRect !== null && hostBox !== null && (
          <PymolControlTail
            rect={{ x: hostBox.x + tailRect.x, y: hostBox.y + tailRect.y, w: tailRect.w, h: tailRect.h }}
            ready={ready}
            motion={state.motion}
            run={cmd => void run(cmd, { page: true }).catch(() => undefined)}
            onSeq={() => setSeqOpen(o => !o)}
            seqShown={seqOpen}
            aside={pyMenu}
            through={canvasHeld}
          />
        )}
        {/* The page's sequence over the view's top, and its 『配列』 tag at the top right (owner 2026-11-21). */}
        {seqBand !== null && (
          <button
            type="button"
            className="sav-seq-tag"
            style={{ left: seqBand.x + seqBand.w - 6, top: seqBand.y + (seqOpen && ready ? SEQ_STRIP_H : 0) }}
            aria-expanded={seqOpen}
            aria-disabled={ready ? undefined : true}
            title={t('htmlExport:sa_pymol_seq_hint')}
            onClick={() => {
              if (ready) setSeqOpen(o => !o)
            }}
          >
            {t('htmlExport:sa_pymol_seq_tag')}
            <svg viewBox="0 0 10 10" width="9" height="9" aria-hidden="true" focusable="false">
              <path d={seqOpen ? 'M1 7l4-4 4 4' : 'M1 3l4 4 4-4'} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
        {/* The row after its tag in the document: the tag that opens it comes first in the Tab order. */}
        {seqOpen && ready && seqBand !== null && <PymolSeqStrip rect={seqBand} report={state.seq} lit={lit} onHover={setLit} />}
        {/* Pull to zoom, while the tab is dragged: where each size's left edge would be, the one a release chooses marked. */}
        {zoomPreviewAt !== null && zoom !== undefined && (
          <div className="sav-zoom-guides" aria-hidden="true">
            {steps.map((s, i) => (
              <div
                key={i}
                className={`sav-zoom-guide${i === zoomPreviewAt ? ' is-chosen' : ''}${s.allowed ? '' : ' is-off'}`}
                style={{ right: Math.min(s.width, Math.max(0, viewWidth - 2)) }}
              >
                <span className="sav-zoom-guide-num">{i + 1}</span>
              </div>
            ))}
            <div className="sav-zoom-chip" style={{ right: typeof zoomPreviewAt === 'number' ? Math.min(steps[zoomPreviewAt].width, viewWidth - 2) + 8 : panelWidth + 36 }}>
              {zoomPreviewAt === 'close'
                ? t('htmlExport:sa_pymol_zoom_close')
                : t('htmlExport:sa_pymol_zoom_chip', { n: zoomPreviewAt + 1, max: steps.length })}
              {steps.some(s => !s.allowed) && <span className="sav-zoom-chip-note">{t('htmlExport:sa_pymol_zoom_narrow')}</span>}
            </div>
          </div>
        )}
        {/* The mouse controls, over the view's top right, clear of PyMOL's object panel. */}
        {!docked && guideOpen && (
          <PymolMouseGuide
            id={guideId}
            mode={state.mouseMode ?? null}
            mac={mac}
            run={cmd => void run(cmd, { page: true }).catch(() => undefined)}
            style={{ right: (state.objectPanel === true ? panelWidth : 0) + 8 }}
            onClose={() => {
              setGuideOpen(false)
              guideButton.current?.focus()
            }}
          />
        )}
        {/* The pen's lines, beside PyMOL's canvas (never in it): they take no pointer until a tool is up. */}
        <ViewerAnnotationLayer stageRef={wrapRef} annotation={annotation} cameraMoving={motionRunning} viewToken={viewToken} />
        {/* The bridge appends its canvas here; React renders nothing inside. */}
        <div ref={stageRef} id={stageId} className="pymolv-stage sav-pymol-host" data-phase={state.phase} />
        {/* A phone measuring: what it measures, the last one away and the end, by the view (the sheet closed so atoms can be tapped). */}
        {docked && measuring && (
          <div className="sav-measure-float">
            <PymolMeasureCard run={cmd => run(cmd)} />
          </div>
        )}
        {/* A phone: the note floats over the view's foot, so a long one never shrinks the view (UI consult, Opus). */}
        {docked && <div className={`sav-note-float${measuring ? ' sav-note-float--above' : ''}`}>{note}</div>}
        {/* The pull to zoom's size, said once set (the guides are for the eye only). */}
        <p role="status" className="sr-only">
          {zoomSaid}
        </p>
        {ownList ? (
          // A phone: the page's own object list, in the 表示ツール sheet (owner 2026-11-19).
          <button type="button" className="sav-objs-fab" aria-haspopup="dialog" onClick={() => onObjects?.()}>
            {t('htmlExport:sa_objs_button')}
            {objectCount > 0 && (
              <>
                {' '}
                <span className="sav-objs-count">{objectCount}</span>
              </>
            )}
          </button>
        ) : (
          // Its promise never rejects (PT-9114 item 4).
          <PymolObjectDrawerTab
            open={state.objectPanel === true}
            onToggle={() => void bridge.toggleObjectPanel()}
            onSwipe={shown => void bridge.setObjectPanel(shown)}
            label={t('htmlExport:sa_pymol_objects_tab')}
            name={t('htmlExport:sa_pymol_objects_name')}
            controls={stageId}
            disabledReason={tabReason}
            panelWidth={panelWidth}
            revealed={reveal.revealed}
            zoom={zoom}
          />
        )}
      </div>
      <div className="pymolv-foot">
        <PymolBusyBar busy={ready ? state.busy : null} held={cmdHeld} onCancel={stop} />
        <p role="status" className="pymolv-cmd-message sav-cmd-echo">
          {cmdEcho}
        </p>
        {/* The command line, wider than a phone (`cmdHost` moves into it). */}
        <div ref={setFootSlot} className="sav-pymol-cmd" />
        {!docked && note}
      </div>
      {dialog === 'settings' && (
        <PymolSettingsDialog
          onClose={() => setDialog(null)}
          onCommand={send}
          scale={scale}
          autoScale={autoDisplayScale(window.devicePixelRatio || 1)}
          onScale={setScale}
          extra={
            <>
              <p className="pymolv-dialog-note">{t('htmlExport:sa_pymol_zoom_settings_note')}</p>
              <OriginalPanelSetting phone={false} />
            </>
          }
        />
      )}
      {dialog === 'keys' && <PymolKeysDialog onClose={() => setDialog(null)} />}
      {dialog === 'about' && (
        <PymolAboutDialog
          onClose={() => setDialog(null)}
          onLicences={() => {
            setDialog(null)
            onOpenLicences()
          }}
        />
      )}
    </div>
  )
}
