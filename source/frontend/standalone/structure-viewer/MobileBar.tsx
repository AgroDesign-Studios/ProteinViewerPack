import { useEffect, useId, useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { DialogBody, DialogTitleBar } from '../../src/components/DialogBars'
import Modal from '../../src/components/Modal'
import { PymolContainsLabel, usePymolContainsName } from '../../src/components/PymolContainsLabel'
import type { PymolLoadState } from '../../src/pages/structure-detail/Viewer3dHeader'
import type { PymolBlocker } from './noGl'
import { FullscreenIcon } from './pageIcons'
import { TouchControlsSetting } from './TouchControlsSetting'
import { useTouchOriginal } from './touchControls'

export type Engine = '3dmol' | 'pymol'

/**
 * The mode's short name (the bar's sub-label, the sheet's title): the two
 * modes' names without the word "mode" (owner 2026-11-18: "3Dmol.js" mode and
 * "Includes PyMOL™" mode; PyMOL's name only in the forms its licence allows;
 * was the Heavy viewer, and PyMOL™ before PT-9195 item 1). Where the engine is
 * a control's name, the licence's whole phrase is (`usePymolContainsName`).
 */
export const engineShortName = (engine: Engine) => (engine === 'pymol' ? 'Includes PyMOL™' : '3Dmol.js')

/** What the bar opens: the view's controls, or the engine choice. */
export type MobileSheet = 'view' | 'engine'

/** The 表示ツール sheet's tabs in PyMOL mode: the object list, and the view's controls. */
export type ViewTab = 'objects' | 'tools'
const VIEW_TABS: readonly ViewTab[] = ['objects', 'tools']

/** The bar's icons: decoration beside the words, 22 px, in the text's colour. */
function Icon({ children }: { children: ReactNode }) {
  return (
    <svg className="sav-mbar-icon" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </g>
    </svg>
  )
}

const ICON_OPEN = <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z" />
const ICON_EXPORT = <path d="M12 4v11m0 0-4-4m4 4 4-4M5 19h14" />
const ICON_VIEW = <path d="M4 7h10m4 0h2M4 17h4m4 0h8M14 5v4m-6 6v4" />
const ICON_ENGINE = <path d="M12 3 4 7.5v9L12 21l8-4.5v-9zm0 0v9m0 0 8-4.5M12 12 4 7.5" />

/** Where the engine's name goes in `sa_m_engine_aria`, split around (no translation contains it). */
const ENGINE_SLOT = '%%ENGINE%%'

/**
 * The phone mode's bar (owner 2026-11-14: 「4. OK」, the bottom bar): fixed
 * to the bottom of the screen, above the phone's home indicator
 * (`env(safe-area-inset-bottom)`), with 「開く」, 「エクスポート」,
 * 「表示ツール」 (the viewers' controls, a bottom sheet; 表示 over ツール,
 * owner 2026-11-15) and — full edition only —
 * 「エンジン」, which names the engine on screen. Every button is at least
 * 44 px each way (the UI consult's tap target).
 *
 * With nothing open, 「エクスポート」 stays a button a finger and a screen
 * reader can reach (`aria-disabled`, its reason as its description): a
 * press calls `onExport`, which says that reason (PT-9188 item 7).
 */
export function MobileBar(props: {
  full: boolean
  /** The engine on screen, named under 「エンジン」. */
  shown: Engine
  /** Nothing open: nothing to export. */
  canExport: boolean
  onOpen: () => void
  onExport: () => void
  onSheet: (sheet: MobileSheet) => void
}) {
  const { full, shown, canExport, onOpen, onExport, onSheet } = props
  const { t } = useTranslation(['htmlExport'])
  const pymolName = usePymolContainsName()
  const exportWhy = useId()
  const engineNameId = useId()
  // The button's name, 「エンジン: …」, with the engine's own words marked as
  // theirs: the licence phrase is English, and an aria-label can carry no
  // lang for part of its text, so a Japanese voice read it as Japanese. The
  // name comes from a hidden span whose phrase carries `lang` (PT-9230
  // item 5); the sentence around it is the translation's own.
  const [nameBefore, nameAfter = ''] = t('htmlExport:sa_m_engine_aria', { engine: ENGINE_SLOT }).split(ENGINE_SLOT)
  return (
    <nav className="sav-mbar" aria-label={t('htmlExport:sa_m_bar_label')}>
      {/*
        Named by the one sentence the desktop button says (「ファイル/PDBを開く…」,
        which holds both visible words), not by the two labels run together
        with no space between them (PT-9264 item 1).
      */}
      <button type="button" className="sav-mbar-btn" aria-haspopup="dialog" aria-label={t('htmlExport:sa_open_button')} onClick={onOpen}>
        <Icon>{ICON_OPEN}</Icon>
        {/* 「ファイル/PDBを開く」 on a phone (owner 2026-11-15): 開く, with what it opens under it. */}
        <span className="sav-mbar-label">
          {t('htmlExport:sa_m_open')}
          <span className="sav-mbar-sub">{t('htmlExport:sa_m_open_sub')}</span>
        </span>
      </button>
      <button
        type="button"
        className="sav-mbar-btn"
        data-guide="export"
        aria-haspopup={canExport ? 'dialog' : undefined}
        aria-disabled={canExport ? undefined : true}
        aria-describedby={canExport ? undefined : exportWhy}
        onClick={onExport}
      >
        <Icon>{ICON_EXPORT}</Icon>
        <span className="sav-mbar-label">{t('htmlExport:sa_m_export')}</span>
      </button>
      {!canExport && (
        <span id={exportWhy} className="sr-only">
          {t('htmlExport:sa_export_none')}
        </span>
      )}
      {/* 「表示」 over 「ツール」 (owner 2026-11-15), as 「開く」 is, named once: 「表示ツール」. */}
      <button type="button" className="sav-mbar-btn" aria-haspopup="dialog" aria-label={t('htmlExport:sa_m_view_aria')} onClick={() => onSheet('view')}>
        <Icon>{ICON_VIEW}</Icon>
        <span className="sav-mbar-label">
          {t('htmlExport:sa_m_view')}
          <span className="sav-mbar-sub">{t('htmlExport:sa_m_view_sub')}</span>
        </span>
      </button>
      {full && (
        <button
          type="button"
          className="sav-mbar-btn"
          data-guide="engine"
          aria-haspopup="dialog"
          // The licence's phrase names PyMOL in the control's name (PT-9195 item 1).
          aria-labelledby={engineNameId}
          onClick={() => onSheet('engine')}
        >
          <span id={engineNameId} className="sr-only">
            {nameBefore}
            <span lang={shown === 'pymol' ? pymolName.lang : undefined}>{shown === 'pymol' ? pymolName.text : '3Dmol.js'}</span>
            {nameAfter}
          </span>
          <Icon>{ICON_ENGINE}</Icon>
          <span className="sav-mbar-label">
            {t('htmlExport:sa_m_engine')}
            {/* PyMOL's phrase in smaller type, on one line (owner 2026-11-18: 入らないところは字を小さく). */}
            <span className={`sav-mbar-sub${shown === 'pymol' ? ' sav-mbar-sub--long' : ''}`} lang="en">
              {engineShortName(shown)}
            </span>
          </span>
        </button>
      )}
    </nav>
  )
}

/**
 * 「表示ツール」: the viewers' controls as a bottom sheet — the shared `Modal`
 * (focus kept inside, Escape and × close it, the page behind unavailable),
 * which the phone mode's CSS docks to the bottom. First the page's buttons,
 * the zoom buttons (gestures are never the only way, WCAG 2.5.1; 「全体表示」
 * for PyMOL only, owner 2026-11-16: 3Dmol.js's is gone), then the
 * controls of the engine on screen: its pane draws them into `toolsRef`
 * (3Dmol.js's toolbar, or PyMOL's 「初期表示」 and menu bar in one row, and
 * its command line). PyMOL's measurement is its own Wizard menu's (owner
 * 2026-11-15: no 「📏 測定」 of the page's).
 *
 * The engine on screen can change while the sheet is open (PyMOL became
 * ready, or failed): the other engine's controls take the slot, and a
 * control that had the focus is gone with them, so the focus goes to the
 * sheet itself rather than out of the dialog (PT-9195 item 3).
 */
export function ViewSheet(props: {
  /** The engine whose controls the sheet carries. */
  engine: Engine
  /** The view cannot zoom yet (nothing shown, PyMOL not ready). */
  zoomDisabled: boolean
  onZoom: (how: 'in' | 'out' | 'fit') => void
  /** Where the pane draws its controls; called with null when the sheet closes. */
  toolsRef: (el: HTMLDivElement | null) => void
  onClose: () => void
  /** 「全画面」: the browser's full screen, or the page's expanded view where it has none. */
  fullscreen?: { on: boolean; toggle: () => void }
  /**
   * HELP, beside 「全画面」 (owner 2026-11-16: it changed places with 「PC表示」,
   * now the header's 「PC」, so the way back to the desktop layout is in
   * sight). The page closes the sheet and opens HELP on 「使い方」.
   */
  onHelp?: () => void
  /**
   * PyMOL's sheet (owner 2026-11-19: no PyMOL object panel on a phone): two
   * tabs, 「オブジェクト」 — the pane's object list, drawn in `ref` — and
   * 「表示・操作」, everything else. Both stay in the document; the one not
   * chosen is hidden, so neither loses its state.
   */
  objects?: { tab: ViewTab; onTab: (tab: ViewTab) => void; ref: (el: HTMLDivElement | null) => void }
}) {
  const { engine, zoomDisabled, onZoom, toolsRef, onClose, fullscreen, onHelp, objects } = props
  const tabsId = useId()
  const { t } = useTranslation(['htmlExport', 'pymol'])
  const titleId = useId()
  const hintId = useId()
  const touchOriginal = useTouchOriginal().original
  const sheetRef = useRef<HTMLDivElement | null>(null)
  const shownEngine = useRef(engine)
  useEffect(() => {
    if (shownEngine.current === engine) return
    shownEngine.current = engine
    // After the panes moved their controls (their effects run in the same
    // commit): only when the focus left with them.
    const frame = requestAnimationFrame(() => {
      const el = sheetRef.current
      const active = document.activeElement
      if (el !== null && (active === null || !el.contains(active))) el.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [engine])
  return (
    <Modal maxWidth={640} flush labelledBy={titleId} onClose={onClose}>
      <div ref={sheetRef} className="sav-sheet sav-sheet--view" tabIndex={-1}>
        <DialogTitleBar
          title={<span id={titleId}>{t('htmlExport:sa_m_view_title', { engine: engineShortName(engine) })}</span>}
          background="var(--blue-text)"
          onClose={onClose}
          closeLabel={t('pymol:dialog_close')}
        />
        {objects !== undefined && (
          <div
            className="sav-sheet-tabs"
            role="tablist"
            aria-label={t('htmlExport:sa_m_view_title', { engine: engineShortName(engine) })}
            onKeyDown={e => {
              if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return
              e.preventDefault()
              const next: ViewTab = e.key === 'Home' ? 'objects' : e.key === 'End' ? 'tools' : objects.tab === 'objects' ? 'tools' : 'objects'
              objects.onTab(next)
              requestAnimationFrame(() => document.getElementById(`${tabsId}-${next}`)?.focus())
            }}
          >
            {VIEW_TABS.map(tab => (
              <button
                key={tab}
                id={`${tabsId}-${tab}`}
                type="button"
                role="tab"
                className="sav-sheet-tab"
                aria-selected={objects.tab === tab}
                aria-controls={`${tabsId}-${tab}-panel`}
                tabIndex={objects.tab === tab ? 0 : -1}
                onClick={() => objects.onTab(tab)}
              >
                {t(tab === 'objects' ? 'htmlExport:sa_objs_tab' : 'htmlExport:sa_objs_tools_tab')}
              </button>
            ))}
          </div>
        )}
        {objects !== undefined && (
          <div
            id={`${tabsId}-objects-panel`}
            role="tabpanel"
            aria-labelledby={`${tabsId}-objects`}
            className="sav-sheet-panel"
            hidden={objects.tab !== 'objects'}
          >
            <DialogBody style={{ padding: '8px 16px 12px' }}>
              <div ref={objects.ref} className="sav-sheet-objects" />
            </DialogBody>
          </div>
        )}
        <div
          id={objects !== undefined ? `${tabsId}-tools-panel` : undefined}
          role={objects !== undefined ? 'tabpanel' : undefined}
          aria-labelledby={objects !== undefined ? `${tabsId}-tools` : undefined}
          className="sav-sheet-panel"
          hidden={objects !== undefined && objects.tab !== 'tools'}
        >
          <DialogBody style={{ padding: '12px 16px' }}>
            {(fullscreen !== undefined || onHelp !== undefined) && (
              <div className="sav-sheet-page">
                {fullscreen !== undefined && (
                  <button type="button" className="btn btn-secondary" aria-pressed={fullscreen.on} onClick={fullscreen.toggle}>
                    <FullscreenIcon /> {t('htmlExport:sa_fullscreen')}
                  </button>
                )}
                {onHelp !== undefined && (
                  <button type="button" className="btn btn-secondary" aria-haspopup="dialog" onClick={onHelp}>
                    {t('htmlExport:sa_help_button')}
                  </button>
                )}
              </div>
            )}
            <div className="sav-zoom" role="group" aria-label={t('htmlExport:sa_m_zoom_group')} aria-describedby={hintId}>
              <button type="button" className="btn btn-secondary" disabled={zoomDisabled} onClick={() => onZoom('in')}>
                <span aria-hidden="true">＋</span> {t('htmlExport:sa_m_zoom_in')}
              </button>
              <button type="button" className="btn btn-secondary" disabled={zoomDisabled} onClick={() => onZoom('out')}>
                <span aria-hidden="true">－</span> {t('htmlExport:sa_m_zoom_out')}
              </button>
              {/* PyMOL's alone: 3Dmol.js has no 「全体表示」 in this app (owner 2026-11-16). */}
              {engine === 'pymol' && (
                <button type="button" className="btn btn-secondary" disabled={zoomDisabled} onClick={() => onZoom('fit')}>
                  {t('htmlExport:sa_view_fit')}
                </button>
              )}
            </div>
            <p id={hintId} className="sav-sheet-hint">
              {engine === '3dmol' && touchOriginal ? t('htmlExport:sa_m_gestures_dmol_original') : t('htmlExport:sa_m_gestures')}
            </p>
            {/* The Light viewer's touch controls (owner 2026-11-17): 3Dmol.js's own, or two fingers to move. */}
            {engine === '3dmol' && <TouchControlsSetting />}
            <div ref={toolsRef} className="sav-sheet-tools" />
          </DialogBody>
        </div>
      </div>
    </Modal>
  )
}

/**
 * 「エンジン」 (full edition): 3Dmol.js or PyMOL, as two radios with what
 * each costs. On a phone PyMOL is never the start (owner 2026-11-14): it is
 * heavy (0.5–1.5 GB of memory). A browser that cannot run it is told why and
 * cannot choose it; a failure says whether PyMOL could not start or stopped
 * after it ran, that the view went back to 3Dmol.js and — while a `.pse` is
 * open — that a session has no 3Dmol.js stand-in (the page words it,
 * `pymolFailureMessage`).
 */
export function EngineSheet(props: {
  engine: Engine
  onEngine: (engine: Engine) => void
  pymolLoad: PymolLoadState
  /** What the page says of PyMOL's failure (`pymolFailureMessage`), worded. */
  failureText: string | null
  blocker: PymolBlocker | null
  /** Starts PyMOL again; absent when there is nothing for it to load (PT-9250 item 2). */
  onRetry?: () => void
  onClose: () => void
}) {
  const { engine, onEngine, pymolLoad, failureText, blocker, onRetry, onClose } = props
  const { t } = useTranslation(['htmlExport', 'pymol', 'proteindb'])
  const titleId = useId()
  const name = useId()
  const dmolNote = useId()
  const pymolNote = useId()
  const pymolName = usePymolContainsName()
  return (
    <Modal maxWidth={560} flush labelledBy={titleId} onClose={onClose}>
      <div className="sav-sheet">
        <DialogTitleBar
          title={<span id={titleId}>{t('proteindb:viewer_head_engine_legend')}</span>}
          background="var(--blue-text)"
          onClose={onClose}
          closeLabel={t('pymol:dialog_close')}
        />
        <DialogBody>
          <fieldset className="sav-engines">
            <legend className="sr-only">{t('proteindb:viewer_head_engine_legend')}</legend>
            <label className={`sav-engine${engine === '3dmol' ? ' is-selected' : ''}`}>
              <input type="radio" name={name} value="3dmol" checked={engine === '3dmol'} onChange={() => onEngine('3dmol')} aria-label="3Dmol.js" aria-describedby={dmolNote} />
              <span className="sav-engine-text">
                <span className="sav-engine-name">3Dmol.js</span>
                <span id={dmolNote} className="sav-engine-note">
                  {t('htmlExport:sa_m_engine_dmol_note')}
                </span>
              </span>
            </label>
            <label className={`sav-engine${engine === 'pymol' ? ' is-selected' : ''}${blocker !== null ? ' is-disabled' : ''}`}>
              <input
                type="radio"
                name={name}
                value="pymol"
                checked={engine === 'pymol'}
                disabled={blocker !== null}
                onChange={() => onEngine('pymol')}
                // The licence's phrase is the name; the visible tiers are its decoration.
                aria-label={pymolName.text}
                lang={pymolName.lang}
                aria-describedby={pymolNote}
              />
              <span className="sav-engine-text">
                {/* The engine's label (PT-9102 item 4): PyMOL™ large, the rest small. */}
                <span className="sav-engine-name">
                  <PymolContainsLabel size="lg" />
                </span>
                <span id={pymolNote} className="sav-engine-note">
                  {blocker === 'no-webgl2'
                    ? t('htmlExport:sa_m_engine_no_webgl2')
                    : blocker === 'no-offscreen'
                      ? t('htmlExport:sa_m_engine_no_offscreen')
                      : blocker === 'no-worker-gl'
                        ? t('htmlExport:sa_m_engine_no_worker_gl')
                        : t('htmlExport:sa_m_engine_pymol_note')}
                </span>
              </span>
            </label>
          </fieldset>
          <p role="status" className="sav-engine-status">
            {pymolLoad === 'loading' ? t('htmlExport:sa_status_pymol_booting') : ''}
          </p>
          <div role="alert" className="sav-engine-alert">
            {pymolLoad === 'failed' && (
              <>
                <p>{failureText}</p>
                {onRetry !== undefined && (
                  <button type="button" className="btn btn-secondary" onClick={onRetry}>
                    {t('htmlExport:sa_retry')}
                  </button>
                )}
              </>
            )}
          </div>
        </DialogBody>
      </div>
    </Modal>
  )
}
