import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type DragEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { anyDialogOpen, announceInTopDialog } from '../../src/components/modalStack'
import type { PymolLook } from '../../src/pages/pymol-viewer/pymolLook'
import { EngineSwitch, type PymolLoadState } from '../../src/pages/structure-detail/Viewer3dHeader'
import type { Mol3dLook } from '../../src/pages/structure-html-export/mol3dLook'
import { formatSI } from '../../src/utils/formatSI'
import { bytesOf, load3dmolFromBlock, textOf, type PageConfig } from './blocks'
import { DocOpener } from './docOpener'
import { ExportHub, type ExportView, type PageMessage } from './ExportHub'
import { HelpDialog, type HelpTab } from './HelpDialog'
import type { CopySource } from './latestUpdate'
import type { BundledLicence, RuntimeLicence, RuntimeLoad } from './LicenceDialog'
import { capOf, DMOL_FORMAT, embeddedDoc, textFor3dmol, type StructureDoc } from './localFile'
import { HeadDetails } from './HeadDetails'
import { imageItems, type ImageItemId } from './exportItems'
import { ImageOutput } from './ImageOutput'
import { EngineSheet, MobileBar, ViewSheet, type Engine, type MobileSheet, type ViewTab } from './MobileBar'
import { FirstRunGuide, GUIDE_TARGETS_FULL, GUIDE_TARGETS_LIGHT, useFirstRunGuide } from './FirstRunGuide'
import { NoticeBanner } from './NoticeBanner'
import { rcsbEntryUrl, shownPdbId } from './pdbLink'
import { usePictureSave } from './pictureSave'
import { Mol3dPane, type Mol3dHandle } from './Mol3dPane'
import { cifSummary, pymolBlocker, webglAvailable, workerGlAvailable, type PymolBlocker } from './noGl'
import { OpenDialog, type OpenMode } from './OpenDialog'
import { DesktopIcon, FlagJapan, FlagUk, FullscreenIcon, PhoneIcon } from './pageIcons'
import { probe } from './probe'
import { docObjectName, failureReason, StandalonePymol, type BridgeState } from './pymolBridge'
import { CRASH_MARK_RENEW_MS, markPymolStarting } from './pymolCrashMark'
import { PymolLoadOverlay } from './PymolLoadOverlay'
import { PymolPane } from './PymolPane'
import type { PymolInkHandle } from './pymolInk'
import { SaveDialog } from './SaveStep'
import { useFullscreen } from './useFullscreen'
import { isMobileNow, isNarrowNow, setMobileOverride, useMobile, usePhoneColumn } from './useMobile'

/** The app's name (owner 2026-11-14), the same in both languages: a product name. */
export const BRAND_ORG = 'AgroDesign'
export const BRAND_APP = 'Protein Viewer Pack (HTMLapp)'
/** The camera's distance after one press of the phone's zoom buttons (PyMOL). */
const ZOOM_IN = 0.8
const ZOOM_OUT = 1.25
/** What the browser tab says after the structure's name. */
export const TITLE_SUFFIX = 'AgroDesign Protein Viewer Pack'

const OFF: BridgeState = { phase: 'off', failure: null, busy: null, ui: null, scene: null, lookError: null, generation: 0 }
const noSubscribe = () => () => undefined
const offState = () => OFF
const MiB = 1024 * 1024

/** What a page that closed while PyMOL was starting says when it opens again (`pymolCrashMark.ts`). */
const CRASH_MESSAGE: PageMessage = { key: 'htmlExport:sa_pymol_crashed', error: true }

/** A failure's reason inside a sentence that ends with its own full stop: none of its own ('..', PT-9194 item 3). */
const reasonOf = (failure: string | null) => (failure ?? '').trim().replace(/[.。]+$/, '')

/**
 * What the page says when PyMOL failed: that it could not start, or — when
 * it had been ready in this run — that it stopped (a crash after it ran is
 * no failed start, PT-9194 item 3). The phone's wording says the view went
 * back to 3Dmol.js, and adds that a `.pse` has no stand-in there only while
 * a `.pse` is open.
 */
export function pymolFailureMessage(opts: { mobile: boolean; ranBefore: boolean; pse: boolean; failure: string | null }): PageMessage {
  const { mobile, ranBefore, pse, failure } = opts
  const vars = { reason: reasonOf(failure) }
  if (!mobile) return { key: ranBefore ? 'htmlExport:sa_status_pymol_stopped' : 'htmlExport:sa_status_pymol_failed', vars, error: true }
  const key = ranBefore ? (pse ? 'htmlExport:sa_m_engine_stopped_pse' : 'htmlExport:sa_m_engine_stopped') : pse ? 'htmlExport:sa_m_engine_failed_pse' : 'htmlExport:sa_m_engine_failed'
  return { key, vars, error: true }
}

/** The file's name stem for what it saves: the code or the structure ID, ASCII. */
function stemOf(config: PageConfig): string {
  const cleaned = (config.code ?? '').replace(/[^A-Za-z0-9_-]+/g, '').slice(0, 40)
  return cleaned || `structure-${config.structureId}`
}

function formatDate(config: PageConfig, lang: string): string {
  const d = new Date(config.exportedAt)
  if (!Number.isFinite(d.getTime())) return ''
  const o: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }
  const locale = lang === 'ja' ? 'ja-JP' : 'en-GB'
  try {
    return new Intl.DateTimeFormat(locale, config.timeZone ? { ...o, timeZone: config.timeZone } : o).format(d)
  } catch {
    try {
      return new Intl.DateTimeFormat(locale, o).format(d)
    } catch {
      return d.toISOString()
    }
  }
}

/**
 * The offline structure file (the 「HTMLで保存」 export), AgroDesign's Protein
 * Viewer Pack. The header (owner 2026-11-16): the company logo, unframed,
 * beside two lines — the app's name over the structure's name (the page's
 * h1, cut with …, its whole text its title); then small buttons in two
 * rows, the actions above (「開く」, 「エクスポート」, 「詳細」 — what it is,
 * when and by whom — and HELP) and the display settings below (the layout,
 * full screen, the language); and at the right end, at its own size, the
 * engine switch (`EngineSwitch`, full edition, its compact variant).
 * Then 3Dmol.js and (full edition) PyMOL in one cell, each with its shared
 * controls. There is no footer: HELP's 「このアプリについて」 tab holds what it
 * said, with every licence and trademark notice (`HelpDialog`).
 * Nothing here reaches the network but the modules `boundary.test.ts` names.
 *
 * 「開く」 (`OpenDialog`): a structure file from this computer (picked or
 * dropped) or a PDB entry downloaded from RCSB by its ID — one of the file's two
 * network calls (the other is HELP's latest-version check). It shows instead in both
 * engines (a `.pse` in PyMOL only), or — while PyMOL is up — is added to
 * PyMOL as one more object; PyMOL's File 「開く…（追加）」 opens the dialog
 * set to add. A file dropped anywhere on the page opens the dialog with that
 * file chosen. A file exported blank (`cif` null) opens on an empty panel
 * that offers the same.
 *
 * 「エクスポート」 (`ExportHub`): one place to save files from either engine;
 * 「画像出力」 (`ImageOutput`, owner 2026-11-16): the pictures — the engine
 * on screen's screenshot and PyMOL's ray trace — in the lower row between
 * 全画面 and the language.
 *
 * Phone mode (`useMobile`, 640 px and narrower; owner 2026-11-14): the
 * header is the logo and the same two lines, then 「詳細」 (the source, the
 * export date and the exporter), 「画像出力」 as its camera alone (UI consult,
 * Claude Opus), the language and 「PC」, the desktop layout again, at the
 * right end (owner 2026-11-16: it changed places with HELP, which is now in
 * the 表示ツール sheet beside 「全画面」).
 * Open, Export, the viewers' controls (「表示ツール」, a bottom sheet with
 * HELP, full screen, zoom buttons and the engine's toolbar or menus) and the engine (full
 * edition) move to a bar fixed at the bottom (`MobileBar`). The viewer
 * fills the screen between the header and the bar, and the page fits the
 * screen with nothing below to scroll to. A phone
 * starts on 3Dmol.js whatever engine the file was exported with: PyMOL is
 * heavy, and is started only when chosen.
 */
/** The longest the notice waits for the press that closed the guide to end (a press held down, or one the page never sees end). */
const NOTICE_WAIT_MAX_MS = 3000

export function StandaloneApp(props: {
  config: PageConfig
  /** The embedded structure, or null for a blank file. */
  cif: string | null
  /** The embedded structure when it is not mmCIF (a copy the app made of itself), else null. */
  initialDoc?: StructureDoc | null
  /**
   * A PyMOL session the file was saved with (`pymol-session`, owner
   * 2026-11-16): PyMOL opens it instead of the structure — its own view and
   * look, not the file's — while 3Dmol.js shows the structure.
   */
  pymolSession?: StructureDoc | null
  mol3d: Mol3dLook | null
  pymolLook: PymolLook | null
  pymolLookBytes: ArrayBuffer | null
  /** Set when the file carried a look this page refused. */
  lookRefused: boolean
  /** The exporter's company logo (a data: URI), or null: the header shows the name alone. */
  logo: string | null
  bundledLicences: readonly BundledLicence[]
  /**
   * The page closed while PyMOL was starting or loading, and opened again
   * (`pymolCrashMark.ts`, read once by main.tsx): said, and the view starts
   * on 3Dmol.js.
   */
  pymolCrashed?: boolean
}) {
  const { config, cif, mol3d, pymolLook, pymolLookBytes, lookRefused, logo, bundledLicences } = props
  const { t, i18n } = useTranslation(['htmlExport', 'pymolNotice'])
  const full = config.edition === 'full' && config.runtime !== null
  const lang = i18n.language === 'en' ? 'en' : 'ja'
  const mobile = useMobile()
  /** The phone layout chosen on a computer: drawn as a phone-wide column. */
  const phoneColumn = usePhoneColumn()
  const fullscreen = useFullscreen()
  const fsButtonRef = useRef<HTMLButtonElement | null>(null)
  const exitRef = useRef<HTMLButtonElement | null>(null)
  // The page's expanded view hides the header and the bar whose button
  // started it: the focus goes to its way out, and back to 全画面 (or the
  // structure's name on a phone) when it ends — unless a dialog holds the
  // focus (the 表示 sheet's own button) (PT-9260 item 6).
  const wasExpanded = useRef(false)
  useEffect(() => {
    if (fullscreen.expanded === wasExpanded.current) return
    wasExpanded.current = fullscreen.expanded
    if (anyDialogOpen()) return
    const id = requestAnimationFrame(() => {
      if (fullscreen.expanded) exitRef.current?.focus()
      else (fsButtonRef.current ?? headingRef.current)?.focus()
    })
    return () => cancelAnimationFrame(id)
  }, [fullscreen.expanded])
  const [doc, setDoc] = useState<StructureDoc | null>(() =>
    props.initialDoc ? props.initialDoc : cif === null ? null : embeddedDoc(cif, stemOf(config), config.title || stemOf(config)),
  )
  const embedded = doc !== null && doc.serial === 0
  const fileStem = doc?.stem ?? 'structure'
  const [libReady, setLibReady] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [gl] = useState(webglAvailable)
  const [status, setStatus] = useState<{ key: string; vars?: Record<string, string> } | null>(
    lookRefused ? { key: 'htmlExport:sa_status_look_mismatch' } : null,
  )
  const crashed = full && props.pymolCrashed === true
  /** What the last open or save did: said in the page's live regions (an error, or not), in the language shown. */
  const [message, setMessageNow] = useState<PageMessage | null>(null)
  /** sayAgain's frame, while its sentence still waits to be said. */
  const againFrame = useRef<number | null>(null)
  // The crash is said a frame after the page is drawn, into the alert region
  // already there empty: a role=alert drawn with its text in it is not
  // announced by every screen reader (PT-9308 item 7). A newer message
  // cancels it as it cancels sayAgain's.
  useEffect(() => {
    if (!crashed) return
    againFrame.current = requestAnimationFrame(() => {
      againFrame.current = null
      setMessageNow(CRASH_MESSAGE)
    })
    // Read once, at the page's start.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  /**
   * Sets the page's message. A newer one (an open, a save) cancels a refusal
   * sayAgain has not yet put back, so the older sentence never overwrites it
   * a frame later (PT-9236 item 2).
   */
  const setMessage = useCallback((next: PageMessage | null) => {
    if (againFrame.current !== null) cancelAnimationFrame(againFrame.current)
    againFrame.current = null
    setMessageNow(next)
  }, [])
  useEffect(() => () => {
    if (againFrame.current !== null) cancelAnimationFrame(againFrame.current)
  }, [])
  const [dragging, setDragging] = useState(false)
  // A phone starts on 3Dmol.js: PyMOL takes 0.5–1.5 GB (owner 2026-11-14).
  // So does a page that closed while PyMOL was starting: no start runs into
  // the same wall again by itself.
  const [wanted, setWanted] = useState<Engine>(() => (isMobileNow() || crashed ? '3dmol' : config.initialEngine))
  const [sheet, setSheet] = useState<MobileSheet | null>(null)
  /** Where the engine on screen draws its controls while 「表示」 is open (phone mode). */
  const [toolsHost, setToolsHost] = useState<HTMLDivElement | null>(null)
  /** PyMOL's sheet: which tab is shown, and where the object list draws itself (owner 2026-11-19). */
  const [viewTab, setViewTab] = useState<ViewTab>('tools')
  const [objectsHost, setObjectsHost] = useState<HTMLDivElement | null>(null)
  const [licences, setLicences] = useState<RuntimeLicence[] | null>(null)
  /** The `licenses` block's read: not asked yet (null), under way, failed or done (PT-9446 item 1). */
  const [licencesLoad, setLicencesLoad] = useState<RuntimeLoad | null>(null)
  /** A read is under way: never a second one beside it (a quick reopen, a Retry pressed twice). */
  const licencesReading = useRef(false)
  /** HELP is open, on this tab. */
  const [help, setHelp] = useState<HelpTab | null>(null)
  const [openDlg, setOpenDlg] = useState<{ mode: OpenMode; staged: File | null } | null>(null)
  const [exportView, setExportView] = useState<ExportView>(null)
  const headingRef = useRef<HTMLHeadingElement | null>(null)
  const dmolRef = useRef<Mol3dHandle | null>(null)
  const pymolInkRef = useRef<PymolInkHandle | null>(null)

  const bridge = useMemo(
    () =>
      full && config.runtime !== null
        ? new StandalonePymol(
            {
              base: config.runtime.base,
              handed: config.runtime.handed,
              readBlock: bytesOf,
              readText: textOf,
              doc,
              lookBytes: pymolLookBytes,
              view: config.pymolView,
              lookObjects: pymolLook?.objects.map(o => o.name) ?? [],
              session: props.pymolSession ?? null,
              // 『Structure_25HN』 (owner 2026-11-21): the PDB ID the header shows for it, else its code.
              docObject: docObjectName(shownPdbId({ embedded: true, structureId: config.structureId, code: config.code, docPdbId: undefined }) ?? config.code),
            },
            () => i18n.t('htmlExport:sa_canvas_pymol'),
          )
        : null,
    // One PyMOL for the life of the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  useEffect(() => () => bridge?.dispose(), [bridge])
  const py = useSyncExternalStore(bridge?.subscribe ?? noSubscribe, bridge?.getState ?? offState)
  /** The pictures 「画像出力」 saves, and the ray-trace form's (`ExportHub`). */
  const pictures = usePictureSave({ bridge, fileStem, dmol: dmolRef, pymolInk: pymolInkRef, onMessage: setMessage })
  /**
   * PyMOL's generation that last reached ready, as the bridge recorded it: a
   * failure in it is a stop, not a failed start, even when the ready state
   * and the failure came in one tick and React never drew the first
   * (PT-9229 item 7).
   */
  const readyGen = py.readyGeneration ?? null

  // Why this browser cannot run PyMOL: probed once, when the phone's engine
  // choice may first show it, and kept — a probe makes a WebGL2 context, and
  // one more beside two running viewers can fail and disable a PyMOL that
  // already runs (PT-9194 item 4). A PyMOL that reached ready can run here.
  const probed = useRef<PymolBlocker | null | undefined>(undefined)
  const pageBlocker = useMemo(() => {
    if (!full || !mobile || readyGen !== null) return null
    if (probed.current === undefined) probed.current = pymolBlocker()
    return probed.current
  }, [full, mobile, readyGen])
  // Past the page's own checks, whether a worker gets WebGL, so the engine
  // choice can say it before PyMOL is chosen — the iPhone's Safari before 17
  // hands the canvas over but draws nothing in a worker. Asked when the
  // choice opens, not at the page's load: a phone that never opens it makes
  // no extra WebGL context while 3Dmol.js starts (PT-9308 item 3, PT-9309
  // item 2). Only while PyMOL is off or failed, before it makes a context of
  // its own (PT-9194 item 4). A `true` is kept (`workerGlAvailable`); any
  // other answer is asked again at the next opening, so a passing failure
  // does not keep PyMOL from this page (PT-9307 item 2).
  const [workerGl, setWorkerGl] = useState<boolean | null>(null)
  const askWorkerGl = full && mobile && sheet === 'engine' && readyGen === null && pageBlocker === null && (py.phase === 'off' || py.phase === 'failed')
  useEffect(() => {
    if (!askWorkerGl) return
    let live = true
    void workerGlAvailable().then(v => {
      if (live) setWorkerGl(v)
    })
    return () => {
      live = false
    }
  }, [askWorkerGl])
  const blocker: PymolBlocker | null = pageBlocker ?? (full && mobile && readyGen === null && workerGl === false ? 'no-worker-gl' : null)
  /**
   * Retry can act: there is something for PyMOL to load (PT-9250 item 2),
   * and nothing keeps PyMOL from this browser — `choose` refuses PyMOL then
   * (PT-9313 item 1). Both Retry buttons read it.
   */
  const canRetry = doc !== null && blocker === null

  // The crash mark (`pymolCrashMark.ts`): set while PyMOL starts or loads,
  // its time renewed while it does, cleared otherwise, when the page is left
  // on purpose or hidden (iOS does not reliably fire pagehide on an app
  // switch, PT-9309 item 1) and when it closes.
  const pyBusy = useRef(false)
  useEffect(() => {
    if (bridge === null) return
    pyBusy.current = py.phase === 'booting' || py.phase === 'loading'
    markPymolStarting(pyBusy.current)
    if (!pyBusy.current) return
    const renew = setInterval(() => {
      if (document.visibilityState !== 'hidden') markPymolStarting(true)
    }, CRASH_MARK_RENEW_MS)
    return () => clearInterval(renew)
  }, [bridge, py.phase])
  useEffect(() => {
    if (bridge === null) return
    const hide = () => markPymolStarting(false)
    // Back from the browser's page cache or in sight again: the start may still be running.
    const show = () => markPymolStarting(pyBusy.current)
    const visibility = () => (document.visibilityState === 'hidden' ? hide() : show())
    window.addEventListener('pagehide', hide)
    window.addEventListener('pageshow', show)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      window.removeEventListener('pagehide', hide)
      window.removeEventListener('pageshow', show)
      document.removeEventListener('visibilitychange', visibility)
      markPymolStarting(false)
    }
  }, [bridge])

  // 3Dmol.js runs from its block.
  useEffect(() => {
    if (!gl) {
      probe.dmol = 'nogl'
      return
    }
    load3dmolFromBlock().then(
      () => setLibReady(true),
      (e: unknown) => setLoadError(e instanceof Error ? e.message : String(e)),
    )
  }, [gl])

  const heading = embedded ? config.title || t('htmlExport:sa_doc_title') : doc !== null ? doc.name : t('htmlExport:sa_blank_title')
  useEffect(() => {
    document.documentElement.lang = lang
    document.title = doc === null ? TITLE_SUFFIX : `${heading} — ${TITLE_SUFFIX}`
  }, [lang, heading, doc])

  // PyMOL starts at once when the file opened on it, or when a file arrives
  // while it is the engine asked for (its pane is mounted by then).
  useEffect(() => {
    if (bridge !== null && gl && doc !== null && wanted === 'pymol' && bridge.getState().phase === 'off') void bridge.start()
  }, [bridge, gl, doc, wanted])

  // Nothing open (a session PyMOL refused on a blank page): nothing to export either.
  useEffect(() => {
    if (doc === null) setExportView(null)
  }, [doc])

  // A failed start puts the view back on 3Dmol.js.
  const [pyShownOnce, setPyShownOnce] = useState(false)
  useEffect(() => {
    probe.py = py.phase
    if (py.phase === 'failed') setWanted('3dmol')
    if (py.phase === 'ready') setPyShownOnce(true)
    else if (py.phase === 'failed') setPyShownOnce(false)
    // PyMOL chosen again after the page closed on it: the crash's alert (it
    // says the structure is in 3Dmol.js) has had its say (PT-9307 item 1).
    if (py.phase === 'booting' || py.phase === 'ready') setMessageNow(m => (m === CRASH_MESSAGE ? null : m))
  }, [py.phase, py.generation])

  // Wider than a phone again (turned, resized): the sheets are the phone's.
  useEffect(() => {
    if (!mobile) setSheet(null)
  }, [mobile])

  const choose = (engine: Engine) => {
    if (engine === 'pymol' && blocker !== null) return
    setWanted(engine)
    if (engine === 'pymol' && bridge !== null && doc !== null && (py.phase === 'off' || py.phase === 'failed')) void bridge.start()
  }
  const dmolFormat = doc === null ? null : DMOL_FORMAT[doc.ext]
  // A session has no 3Dmol.js reader: opening one asks for PyMOL (applyDoc), and 3Dmol.js says so if chosen.
  // Once up, PyMOL stays on screen while it reloads or starts again (Reset,
  // Stop, a deadline): only a failure or the user's choice moves the page
  // to 3Dmol.js, so the focus stays in the pane (PT-9108 item 5).
  const shown: Engine = wanted === 'pymol' && (py.phase === 'ready' || (pyShownOnce && py.phase !== 'failed')) ? 'pymol' : '3dmol'
  const pymolLoad: PymolLoadState = py.phase === 'booting' || py.phase === 'loading' ? 'loading' : py.phase === 'failed' ? 'failed' : py.phase === 'ready' ? 'ready' : 'idle'
  const say = (key: string, vars: Record<string, string> | undefined, error: boolean) => setMessage({ key, vars, error })
  /**
   * The same sentence again, announced again: the live region is emptied
   * first and filled a frame later, or React would leave the identical text
   * in place and a screen reader would say nothing at the second press
   * (PT-9230 item 4).
   */
  const sayAgain = (key: string, error: boolean) => {
    setMessage(null)
    againFrame.current = requestAnimationFrame(() => {
      againFrame.current = null
      setMessageNow({ key, error })
    })
  }

  /** The phone's zoom buttons, on the engine on screen. */
  const zoom = (how: 'in' | 'out' | 'fit') => {
    if (shown === 'pymol' && bridge !== null) {
      void (how === 'fit' ? bridge.fitAll() : bridge.zoomBy(how === 'in' ? ZOOM_IN : ZOOM_OUT)).catch(() => undefined)
    } else dmolRef.current?.zoom(how)
  }

  /** The latest open wins (`docOpener.ts`). */
  const [opener] = useState(() => new DocOpener())

  /** A document the open dialog accepted: shown instead, or added to PyMOL. */
  const applyDoc = (next: StructureDoc, mode: OpenMode) => {
    closeOpen()
    void opener.open(next, mode, {
      bridge,
      before: doc,
      show: setDoc,
      say: setMessage,
      startPymol: () => choose('pymol'),
      replaced: () => {
        // The exported look belongs to the file's own structure; an export
        // form belongs to the document it was opened for (PT-9188 item 1).
        setStatus(null)
        setExportView(null)
        // The new structure's name is the page's heading: the focus goes there.
        requestAnimationFrame(() => headingRef.current?.focus())
      },
    })
  }

  const showOpen = (mode: OpenMode) => setOpenDlg({ mode, staged: null })
  /**
   * Closes 「開く」. A drag that ended on its drop area never reached the
   * page's own drop or leave (the dialog is inside the page, and the area
   * stops the drop): the page's drag state ends here too, or the overlay
   * would show once the dialog is gone (PT-9228 item 1).
   */
  const closeOpen = () => {
    setOpenDlg(null)
    setDragging(false)
  }

  /**
   * Another dialog than 「開く」 is open: a file dropped on the page waits
   * for it to close. PyMOL's own Settings, Keys and About are the pane's, so
   * any dialog in the stack counts while 「開く」 is closed (PT-9229 item 3).
   */
  const otherDialog = () => exportView !== null || help !== null || sheet !== null || (openDlg === null && anyDialogOpen())

  // A file dragged over the page: dropped, it opens the dialog with that file chosen.
  const onDragOver = (e: DragEvent) => {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDragging(true)
  }
  // Leaving the page, not moving onto one of its own parts: the overlay
  // would flicker on every child's dragleave (PT-9133 item 5).
  const onDragLeave = (e: DragEvent) => {
    const to = e.relatedTarget
    if (to instanceof Node && e.currentTarget.contains(to)) return
    setDragging(false)
  }
  const onDrop = (e: DragEvent) => {
    if (e.dataTransfer.files.length === 0) return
    // Always: a file dropped and not taken would be opened by the browser in place of the page.
    e.preventDefault()
    setDragging(false)
    // Never a second dialog over an open one (PT-9188 item 1): said, and the
    // drop waits. Said inside that dialog too: its aria-modal hides the
    // page's own alert from a screen reader (PT-9228 item 2).
    if (otherDialog()) {
      announceInTopDialog(t('htmlExport:sa_drop_blocked'))
      sayAgain('htmlExport:sa_drop_blocked', true)
      return
    }
    const file = e.dataTransfer.files[0]
    setOpenDlg(cur => ({ mode: cur?.mode ?? 'replace', staged: file }))
  }

  // 「エクスポート」 with nothing open stays reachable and says why (PT-9188 item 7, PT-9189 item 2).
  const exportOrSay = () => {
    if (doc === null) sayAgain('htmlExport:sa_export_none', true)
    else setExportView('chooser')
  }

  /**
   * Reads the runtimes' licences from the `licenses` block, once at a time:
   * the tab says it is reading meanwhile, and that it could not, with Retry,
   * when the read fails (PT-9446 item 1).
   */
  const readLicences = () => {
    if (licences !== null || licencesReading.current) return
    licencesReading.current = true
    setLicencesLoad('loading')
    textOf('licenses')
      .then(text => {
        const raw: unknown = JSON.parse(text)
        const list = Array.isArray(raw) ? raw : []
        setLicences(
          list.map(l => {
            const e = l as { title?: unknown; text?: unknown; group?: unknown }
            const group = e.group === '3dmol' || e.group === 'pymol' || e.group === 'pymol-change' ? e.group : undefined
            return { title: String(e.title ?? ''), text: String(e.text ?? ''), group }
          }),
        )
        setLicencesLoad('ready')
      })
      .catch((e: unknown) => {
        probe.errors.push(`licences: ${String(e)}`)
        setLicencesLoad('failed')
      })
      .finally(() => {
        licencesReading.current = false
      })
  }
  /**
   * HELP, on the tab asked for: 「使い方」 from its button, 「ライセンス表記」
   * from PyMOL's About. It opens at once, whatever is loaded or running; the
   * runtimes' licences are read the first time (`readLicences`) and fill
   * their groups when read (the app's own and its packages' need no read).
   * A read that failed is tried again at the next opening.
   */
  const openHelp = (tab: HelpTab) => {
    setHelp(tab)
    readLicences()
  }
  const dmolText = useMemo(
    () => (doc === null || doc.text === null || dmolFormat === null ? null : embedded && doc.ext === 'cif' ? doc.text : textFor3dmol(doc.text, dmolFormat)),
    [doc, dmolFormat, embedded],
  )

  const failure =
    py.phase === 'failed'
      ? pymolFailureMessage({ mobile, ranBefore: readyGen === py.generation, pse: doc?.ext === 'pse', failure: failureReason(py, key => t(key)) })
      : null
  const failureText = failure === null ? null : t(failure.key, failure.vars)
  const statusText =
    loadError !== null
      ? t('htmlExport:sa_error_load', { reason: loadError })
      : py.phase === 'booting' && shown === '3dmol'
        ? t('htmlExport:sa_status_pymol_booting')
        : failureText !== null
          ? failureText
          : status !== null
            ? t(status.key, status.vars)
            : ''
  const meta: string[] = []
  // A copy the app made of itself has structure ID 0: its code is the PDB ID it came from, if any.
  if (embedded && config.structureId === 0) {
    if (config.code) meta.push(t('htmlExport:sa_meta_rcsb', { id: config.code }))
  } else if (embedded) {
    meta.push([t('htmlExport:sa_meta_id', { id: String(config.structureId) }), ...(config.code ? [t('htmlExport:sa_meta_code', { code: config.code })] : [])].join(' · '))
  } else if (doc?.pdbId !== undefined) meta.push(t('htmlExport:sa_meta_rcsb', { id: doc.pdbId }))
  else if (doc !== null) meta.push(t('htmlExport:sa_meta_local'))
  const pdbId = shownPdbId({ embedded, structureId: config.structureId, code: config.code, docPdbId: doc?.pdbId })
  /**
   * The first-run guide (owner 2026-11-19), once a structure is on screen
   * and while no dialog, sheet or expanded view covers what it points at;
   * the opening notice waits under the header meanwhile.
   */
  const guide = useFirstRunGuide()
  const guideShown =
    guide.pending && doc !== null && exportView === null && openDlg === null && help === null && sheet === null && pictures.made === null && !fullscreen.expanded
  // The press (or key) that closed the guide ends before the notice comes: in the page's
  // flow, it would move everything under the header while the press is still down, and
  // the release would land elsewhere (PT-9918 item 1).
  const [noticeWait, setNoticeWait] = useState(false)
  const { dismiss: dismissGuideNow } = guide
  const dismissGuide = useCallback(() => {
    setNoticeWait(true)
    const events = ['pointerup', 'pointercancel', 'keyup'] as const
    let fallback: ReturnType<typeof setTimeout> | undefined
    const done = () => {
      for (const ev of events) document.removeEventListener(ev, done, true)
      clearTimeout(fallback)
      setTimeout(() => setNoticeWait(false), 0)
    }
    for (const ev of events) document.addEventListener(ev, done, true)
    fallback = setTimeout(done, NOTICE_WAIT_MAX_MS)
    dismissGuideNow()
  }, [dismissGuideNow])
  const summary = useMemo(() => (gl || doc === null || doc.ext !== 'cif' || doc.text === null ? null : cifSummary(doc.text)), [gl, doc])
  const limitMiB = formatSI(capOf('pdb') / MiB, { fractionDigits: 0 })
  const pseMiB = formatSI(capOf('pse') / MiB, { fractionDigits: 0 })
  const dmolView = gl && doc !== null && dmolFormat !== null && doc.text !== null
  /** 3Dmol.js itself ran (its block): without it no pane draws, whatever the format (PT-9188 item 6). */
  const dmolReady = libReady && loadError === null
  const zoomDisabled = shown === 'pymol' ? py.phase !== 'ready' : !dmolView || !dmolReady
  const exportWhyId = useId()
  /** Why a `.pse` cannot open on this phone (PT-9192 items 2, 7): PyMOL alone reads one. */
  const pseRefusal = blocker === null ? null : t('htmlExport:sa_open_err_pse_no_pymol')
  const exported = <span>{t('htmlExport:sa_meta_exported', { date: formatDate(config, lang) })}</span>
  const by = config.exporterName ? <span>{t('htmlExport:sa_meta_by', { name: config.exporterName })}</span> : null
  /**
   * 「スマホ表示」 / 「PC」 (owner 2026-11-15/16): the other layout than the one
   * shown, for this visit; back to what the width gives when that is the one
   * asked for.
   */
  const switchLayout = (toPhone: boolean) => {
    setMobileOverride(toPhone === isNarrowNow() ? null : toPhone)
    // The pressed control is gone with the layout it belonged to: the focus
    // goes to the structure's name, first in the new one (PT-9260 item 6).
    requestAnimationFrame(() => headingRef.current?.focus())
  }
  const fullscreenButton = (
    <button
      ref={fsButtonRef}
      type="button"
      className="btn btn-secondary sav-fs"
      aria-pressed={fullscreen.on}
      aria-label={t('htmlExport:sa_fullscreen')}
      title={t('htmlExport:sa_fullscreen')}
      onClick={fullscreen.toggle}
    >
      <FullscreenIcon /> <span className="sav-btn-text">{t('htmlExport:sa_fullscreen')}</span>
    </button>
  )
  /**
   * The logo, unframed, and two lines beside it (owner 2026-11-16): the
   * product's name and its maker, small, over the structure's name. Either
   * line is cut with … where the header has no room for it, its whole text
   * its title.
   */
  const ident = (
    <div className="sav-ident">
      {/* Decoration beside the names: the names say it all. */}
      {logo !== null && <img className="sav-brand-logo" src={logo} alt="" width={24} height={24} />}
      <div className="sav-names">
        <p className="sav-brand-name" title={`${BRAND_ORG} - ${BRAND_APP}`}>
          <span className="sav-brand-org">{BRAND_ORG}</span>
          <span className="sav-brand-sep"> - </span>
          <span className="sav-brand-app">{BRAND_APP}</span>
        </p>
        {/* The PDB ID before the name, a link to its RCSB PDB page (owner 2026-11-19): outside the h1, so the heading's name stays the name. */}
        <div className="sav-title-row">
          {pdbId !== null && (
            <a className="sav-pdb-link" href={rcsbEntryUrl(pdbId)} target="_blank" rel="noopener noreferrer" title={t('htmlExport:sa_pdb_link_title', { id: pdbId })}>
              {pdbId}
              <span aria-hidden="true"> ↗</span>
              <span className="sr-only">{t('htmlExport:sa_pdb_link_sr')}</span>
            </a>
          )}
          <h1 ref={headingRef} tabIndex={-1} title={heading}>
            {heading}
          </h1>
        </div>
      </div>
    </div>
  )
  const details = (
    <HeadDetails summary={t('htmlExport:sa_m_details')}>
      <p className="sav-meta">
        {meta.map(m => (
          <span key={m}>{m}</span>
        ))}
        {exported}
        {by}
        <span>{t('htmlExport:sa_footer_made')}</span>
      </p>
    </HeadDetails>
  )
  /**
   * A picture 「画像出力」 asked for, each by its form: the screenshot's
   * resolution (owner 2026-11-20), from the engine on screen; the ray trace
   * by PyMOL's form, after switching to PyMOL when the person agreed to (the
   * form waits for it).
   */
  const pickImage = (id: ImageItemId, switchFirst: boolean) => {
    if (switchFirst) choose('pymol')
    setExportView(id === 'ray' ? 'ray' : 'shot')
  }
  const imageOutput = (
    <ImageOutput
      items={imageItems({
        full,
        shown,
        gl,
        dmolView,
        dmolReady,
        dmolLoading: gl && !libReady && loadError === null,
        pymolBlocked: blocker !== null,
        pymolSaving: pictures.saving,
      })}
      noDoc={doc === null ? t('htmlExport:sa_export_none') : null}
      onNoDoc={() => sayAgain('htmlExport:sa_export_none', true)}
      iconOnly={mobile}
      onPick={pickImage}
    />
  )
  /**
   * What HELP's latest version is made with (owner 2026-11-17): what
   * 「HTMLappとして出力」 keeps — the structure, the Light viewer's view frozen
   * at the press, the Heavy viewer's session written fresh while it shows this
   * structure (as `ExportHub` gives `AppCopyDialog`).
   */
  const helpCopy: CopySource = {
    config,
    doc,
    lang,
    engine: shown,
    dmolLook: dmolView && dmolReady ? () => dmolRef.current?.look() ?? null : null,
    pymolSession: full && bridge !== null && py.phase === 'ready' && doc !== null && bridge.sceneDoc() === doc ? signal => bridge.exportPse(signal) : null,
  }
  /** HELP: 「このアプリについて」, 「使い方」 and 「最新版ダウンロード」, whatever is open or running; the desktop header's (a phone's is in the 表示ツール sheet). */
  const helpButton = (
    <button type="button" className="btn btn-secondary sav-help-btn" aria-haspopup="dialog" onClick={() => openHelp('usage')}>
      {t('htmlExport:sa_help_button')}
    </button>
  )
  /**
   * 「PC」, the phone layout's right end: the desktop layout again (owner
   * 2026-11-16, in 「PC表示」's place). Its name says what it does and
   * starts with the word it shows (WCAG 2.5.3); a very narrow header drops
   * the icon, never the word.
   */
  const pcButton = (
    <button type="button" className="btn btn-secondary sav-pc-btn" aria-label={t('htmlExport:sa_pc_back_aria')} onClick={() => switchLayout(false)}>
      <DesktopIcon /> <span className="sav-pc-word">{t('htmlExport:sa_pc_button')}</span>
    </button>
  )
  /**
   * The language switch: the other language's name, with its flag before it
   * (owner 2026-11-17: 英国国旗と日の丸) — drawn by the page, not an emoji,
   * which Windows shows as the letters 「GB」. The flag is decoration
   * (`aria-hidden`). A computer shows the name too, and a header too narrow
   * for both keeps the name; the phone layout shows the flag alone (owner
   * 2026-11-19: 国旗だけで文字無しでOK), round in a button 32 px wide (owner
   * 2026-11-21: 丸型の国旗アイコン、横スペースを節約). Its name is the
   * sentence in the language on screen, read in that language's voice: the
   * other language's `lang` is on the visible word only (it made a Japanese
   * voice read 「言語: English に切り替える」 as English; UI consult, Opus).
   */
  const langButton = (
    <button
      type="button"
      className="btn btn-secondary sav-lang"
      aria-label={t('htmlExport:sa_lang_aria', { lang: lang === 'ja' ? 'English' : '日本語' })}
      title={t('htmlExport:sa_lang_aria', { lang: lang === 'ja' ? 'English' : '日本語' })}
      onClick={() => void i18n.changeLanguage(lang === 'ja' ? 'en' : 'ja')}
    >
      {lang === 'ja' ? <FlagUk /> : <FlagJapan />}
      <span className="sav-lang-word" lang={lang === 'ja' ? 'en' : 'ja'}>
        {lang === 'ja' ? 'English' : '日本語'}
      </span>
    </button>
  )

  return (
    <div
      className={`sav${mobile ? ' sav--mobile' : ''}${phoneColumn ? ' sav--phone-col' : ''}${fullscreen.expanded ? ' sav--expanded' : ''}${dragging && openDlg === null ? ' is-dropping' : ''}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/*
        The page's own expanded view (no browser full screen here): its way
        out, always in sight, in a band of its own above the viewer, so it
        covers none of the status lines or the view (PT-9263 item 3).
      */}
      {fullscreen.expanded && (
        <div className="sav-expand-band">
          <button ref={exitRef} type="button" className="btn btn-primary sav-expand-exit" onClick={fullscreen.toggle}>
            {t('htmlExport:sa_fullscreen_exit')}
          </button>
        </div>
      )}
      {/* What fills the screen (the phone mode sizes it to the screen less the bar). */}
      <div className="sav-screen">
        {/*
          Owner 2026-11-16. A computer: the logo and the two names, then the
          small buttons in two rows — Open, Export, 詳細 and HELP above; the
          phone layout, full screen, 画像出力 and the language below (owner
          2026-11-16) — and the engine switch at the right end, as tall as
          the two rows.
          A phone: the logo and the two names, 「詳細」, the camera, the
          language and 「PC」 (owner 2026-11-16: the way back to the desktop
          layout, at the right end where it is found; HELP went to the
          表示ツール sheet in its place); the rest is in the bar at the bottom.
        */}
        <header className="sav-head">
          {ident}
          {mobile ? (
            <div className="sav-head-phone">
              {details}
              {imageOutput}
              {langButton}
              {pcButton}
            </div>
          ) : (
            <>
              <div className="sav-head-actions">
                <div className="sav-head-row">
                  <button type="button" className="btn btn-secondary" onClick={() => showOpen('replace')}>
                    {t('htmlExport:sa_open_button')}
                  </button>
                  {/* With nothing open: reachable, its reason its description, a press says it. */}
                  <button
                    type="button"
                    className="btn btn-secondary"
                    data-guide="export"
                    aria-haspopup={doc === null ? undefined : 'dialog'}
                    aria-disabled={doc === null ? true : undefined}
                    aria-describedby={doc === null ? exportWhyId : undefined}
                    onClick={exportOrSay}
                  >
                    {t('htmlExport:sa_export_button')}
                  </button>
                  {doc === null && (
                    <span id={exportWhyId} className="sr-only">
                      {t('htmlExport:sa_export_none')}
                    </span>
                  )}
                  {details}
                  {helpButton}
                </div>
                <div className="sav-head-row">
                  {/* The phone layout on a computer: that the app is made for phones, and a way out when the width guessed wrong. */}
                  {/* A switch to the other layout, said by its name: no pressed state (PT-9262 item 8). A narrow window shows its icon alone. */}
                  <button
                    type="button"
                    className="btn btn-secondary sav-phone-toggle"
                    aria-label={t('htmlExport:sa_phone_view')}
                    title={t('htmlExport:sa_phone_view')}
                    onClick={() => switchLayout(true)}
                  >
                    <PhoneIcon /> <span className="sav-btn-text">{t('htmlExport:sa_phone_view')}</span>
                  </button>
                  {fullscreenButton}
                  {/* The pictures, under a camera, between 全画面 and the language (owner 2026-11-16): the upper row ends at HELP with no gap under it. */}
                  {imageOutput}
                  {langButton}
                </div>
              </div>
              {/* The light edition has no PyMOL: no switch to it (owner 2026-11-14). At the right end, at its own size. */}
              {full && (
                <div className="sav-head-engine" data-guide="engine">
                  <EngineSwitch engine={wanted} onEngine={choose} pymolLoad={pymolLoad} variant="compact" />
                </div>
              )}
            </>
          )}
        </header>
        <NoticeBanner held={guideShown || noticeWait} afterClose={() => headingRef.current?.focus()} />
        <div role="status" aria-live="polite" className={`sav-status${statusText === '' ? ' sav-status--empty' : ''}${py.phase === 'failed' || loadError !== null ? ' is-error' : ''}`}>
          {statusText}
          {/* Retry starts PyMOL on what is open: shown only where it can act (`canRetry`). */}
          {py.phase === 'failed' && canRetry && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => choose('pymol')}>
              {t('htmlExport:sa_retry')}
            </button>
          )}
        </div>
        {/* Always mounted, so what opened, what was saved and every refusal is announced. */}
        <p role="status" className="sav-open-message">
          {message !== null && !message.error ? t(message.key, message.vars) : ''}
        </p>
        <p role="alert" className="sav-open-message is-error">
          {message?.error ? t(message.key, message.vars) : ''}
        </p>
        {embedded && config.skipped.length > 0 && <p className="sav-note">{t('htmlExport:sa_note_skipped', { names: config.skipped.join(', ') })}</p>}
        <main className="sav-stage">
          {/* PyMOL's wait, over the viewer (owner 2026-11-16; UI consult, Opus):
              a light veil and a turning ring on the stage, which takes no
              pointer, so 3Dmol.js stays usable under it. Decoration: the
              status line above and the switch's description say it. */}
          {wanted === 'pymol' && pymolLoad === 'loading' && doc !== null && gl && <PymolLoadOverlay starting={py.phase === 'booting'} />}
          {dragging && openDlg === null && (
            <div className="sav-drop" aria-hidden="true">
              {t('htmlExport:sa_drop_hint')}
            </div>
          )}
          {doc === null ? (
            <section className="sav-empty" aria-labelledby="sav-empty-title">
              <h2 id="sav-empty-title">{t('htmlExport:sa_empty_title')}</h2>
              <p>{t('htmlExport:sa_empty_body')}</p>
              <button type="button" className="btn btn-primary" onClick={() => showOpen('replace')}>
                {t('htmlExport:sa_open_button')}
              </button>
              <p className="sav-empty-formats">
                {full ? t('htmlExport:sa_open_formats_full', { limit: limitMiB, pse: pseMiB }) : t('htmlExport:sa_open_formats_light', { limit: limitMiB })}
              </p>
            </section>
          ) : !gl ? (
            <section className="sav-nogl">
              <h2>{t('htmlExport:sa_nogl_title')}</h2>
              <p>{t('htmlExport:sa_nogl_body')}</p>
              {summary !== null && (
                <ul>
                  {summary.chains.map(c => (
                    <li key={c.chain}>{t('htmlExport:sa_nogl_chain', { chain: c.chain, n: String(c.residues) })}</li>
                  ))}
                  <li>{summary.ligands.length ? t('htmlExport:sa_nogl_ligands', { list: summary.ligands.join(', ') }) : t('htmlExport:sa_nogl_no_ligands')}</li>
                </ul>
              )}
            </section>
          ) : (
            <>
              <div className={`sav-pane${shown === '3dmol' ? '' : ' is-hidden'}`}>
                {dmolFormat === null || dmolText === null ? (
                  <p className="sav-note">{t('htmlExport:sa_dmol_no_reader')}</p>
                ) : (
                  <Mol3dPane
                    // A new file is a new pane: the toolbar starts over on it.
                    key={doc.serial}
                    structure={{ text: dmolText, format: dmolFormat }}
                    mol3d={embedded ? mol3d : null}
                    pymol={embedded ? pymolLook : null}
                    pymolView={embedded ? config.pymolView : null}
                    fileStem={fileStem}
                    libReady={libReady}
                    shown={shown === '3dmol'}
                    onStatus={(key, vars) => setStatus(key === null ? null : { key, vars })}
                    onError={(key, vars) => say(key, vars, true)}
                    handleRef={dmolRef}
                    docked={mobile}
                    toolsHost={shown === '3dmol' ? toolsHost : null}
                  />
                )}
              </div>
              {bridge !== null && (
                <div className={`sav-pane${shown === 'pymol' ? '' : ' is-hidden'}`}>
                  <PymolPane
                    bridge={bridge}
                    bColumn={config.bColumn}
                    onOpenLicences={() => openHelp('licences')}
                    onOpenFile={() => showOpen('add')}
                    onExport={setExportView}
                    docked={mobile}
                    toolsHost={shown === 'pymol' ? toolsHost : null}
                    onDialog={() => setSheet(null)}
                    objectsHost={shown === 'pymol' ? objectsHost : null}
                    onObjects={() => {
                      setViewTab('objects')
                      setSheet('view')
                    }}
                    onCloseSheet={() => setSheet(null)}
                    logo={logo}
                    shown={shown === 'pymol'}
                    inkRef={pymolInkRef}
                  />
                </div>
              )}
            </>
          )}
        </main>
      </div>
      {mobile && (
        <MobileBar
          full={full}
          shown={shown}
          canExport={doc !== null}
          onOpen={() => showOpen('replace')}
          onExport={exportOrSay}
          onSheet={s => {
            // The bar's 表示ツール opens on the view's controls; the view's 「オブジェクト」 on the list.
            if (s === 'view') setViewTab('tools')
            setSheet(s)
          }}
        />
      )}
      {mobile && sheet === 'view' && (
        <ViewSheet
          engine={shown}
          zoomDisabled={zoomDisabled}
          onZoom={zoom}
          toolsRef={setToolsHost}
          onClose={() => setSheet(null)}
          objects={shown === 'pymol' ? { tab: viewTab, onTab: setViewTab, ref: setObjectsHost } : undefined}
          fullscreen={{ on: fullscreen.on, toggle: fullscreen.toggle }}
          onHelp={() => {
            setSheet(null)
            openHelp('usage')
          }}
        />
      )}
      {mobile && full && sheet === 'engine' && (
        <EngineSheet
          engine={wanted}
          onEngine={engine => {
            choose(engine)
            setSheet(null)
          }}
          pymolLoad={pymolLoad}
          failureText={failureText}
          blocker={blocker}
          onRetry={canRetry ? () => choose('pymol') : undefined}
          onClose={() => setSheet(null)}
        />
      )}
      {openDlg !== null && (
        <OpenDialog
          full={full}
          canAdd={bridge !== null && py.phase === 'ready' && doc !== null}
          initialMode={openDlg.mode}
          staged={openDlg.staged}
          pseRefusal={pseRefusal}
          onOpen={applyDoc}
          onClose={closeOpen}
        />
      )}
      {doc !== null && (
        <ExportHub
          view={exportView}
          onView={setExportView}
          full={full}
          gl={gl}
          shown={shown}
          bridge={bridge}
          py={py}
          doc={doc}
          fileStem={fileStem}
          dmol={dmolRef}
          dmolView={dmolView}
          dmolReady={dmolReady}
          dmolLoading={gl && !libReady && loadError === null}
          pymolBlocked={blocker !== null}
          onSwitchToPymol={() => choose('pymol')}
          onMessage={setMessage}
          pictures={pictures}
          config={config}
          lang={lang}
        />
      )}
      {/* A picture 「画像出力」 made waits for any open dialog to shut: one dialog at a time. */}
      {pictures.made !== null && exportView === null && openDlg === null && help === null && sheet === null && (
        // The pictures show themselves in their save step (owner 2026-11-17).
        <SaveDialog title={t('htmlExport:sa_image_button')} file={pictures.made} preview onClose={pictures.dismiss} />
      )}
      {help !== null && (
        <HelpDialog
          initialTab={help}
          runtimes={licences ?? []}
          runtimesLoad={licences !== null ? 'ready' : (licencesLoad ?? 'loading')}
          onRetryRuntimes={readLicences}
          bundled={bundledLicences}
          full={full}
          onClose={() => setHelp(null)}
          copy={helpCopy}
        />
      )}
      {guideShown && <FirstRunGuide targets={full ? GUIDE_TARGETS_FULL : GUIDE_TARGETS_LIGHT} onDismiss={dismissGuide} />}
    </div>
  )
}
