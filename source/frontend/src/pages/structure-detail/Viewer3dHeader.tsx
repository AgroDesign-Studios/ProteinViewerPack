import { useId, useState, type MouseEvent, type ReactNode, type Ref } from 'react'
import { useTranslation } from 'react-i18next'

import { PymolContainsLabel, usePymolContainsName } from '../../components/PymolContainsLabel'

import type { ViewerEngine } from './useViewerEngine'
import './viewer3dHeader.css'

/** Product names: the same in both languages, so not translated. */
export const ENGINE_LABEL: Readonly<Record<ViewerEngine, string>> = {
  '3dmol': '3Dmol.js',
  pymol: 'PyMOL',
  coot: 'Coot',
}
/** The default header: all three engines (spec 2026-11-20 §6.2). */
const ENGINES: readonly ViewerEngine[] = ['3dmol', 'pymol', 'coot']
/** The compact header: two engines. */
const COMPACT_ENGINES: readonly ViewerEngine[] = ['3dmol', 'pymol']

/**
 * The engine as the visible 「対象：」 says it: PyMOL with its ™, as the
 * option beside it does (PT-9102 item 7). Only there: an accessible name or
 * the history list would read the mark aloud as "trademark" (UI consult
 * 2026-11-15).
 */
const TARGET_LABEL: Readonly<Record<ViewerEngine, string>> = {
  '3dmol': '3Dmol.js',
  pymol: 'PyMOL™',
  coot: 'Coot',
}

/** Where the card's PyMOL stands, said beside its option. */
export type PymolLoadState = 'idle' | 'loading' | 'ready' | 'failed'

/**
 * The 3D card's header (owner 2026-11-09, reworked 2026-11-10; UI dual consult
 * Fable + Codex astra both times): 「3D構造」, the engine as two native radios
 * styled as one segmented control (a check mark on the chosen one, not colour
 * alone), then two buttons that act on the chosen engine:
 *
 * - 『全画面表示』 paints the card's own engine over the window in this tab —
 *   the same 3Dmol or the same PyMOL, its work intact.
 * - 『専用ウインドウ起動 ↗』 opens that engine's own page in a new tab (a new
 *   session there).
 *
 * The labels are the owner's words and stay fixed; the engine they act on is
 * said beside them (「対象：PyMOL」) and in each control's accessible name.
 * Large on purpose (40 px, 14 px/600). PyMOL loads behind 3Dmol: the wait's
 * spinner turns over the viewer (owner 2026-11-16), and a failure is said
 * beside the control.
 * The PyMOL option reads "Includes PyMOL™" with PyMOL™ large (owner
 * 2026-11-16: the shortest of the PyMOL™ trademark licence's permitted forms). `extra` holds the
 * header's further controls.
 */
export function Viewer3dHeader({
  engine,
  onEngine,
  onFullscreen,
  fullscreenRef,
  dedicatedHref,
  onDedicatedClick,
  pymolLoad = 'idle',
  cootLock = null,
  extra,
}: {
  engine: ViewerEngine
  onEngine: (engine: ViewerEngine) => void
  onFullscreen: () => void
  /** Focus comes back here when the full screen closes. */
  fullscreenRef?: Ref<HTMLButtonElement>
  /** The chosen engine's own page. */
  dedicatedHref: string
  /** Read at the click, before the new tab opens. */
  onDedicatedClick?: (e: MouseEvent<HTMLAnchorElement>) => void
  pymolLoad?: PymolLoadState
  /** Why the third engine cannot run in this browser (its option is shown locked with it), or null. */
  cootLock?: string | null
  extra?: ReactNode
}) {
  const { t } = useTranslation('proteindb')
  const engineName = ENGINE_LABEL[engine]
  return (
    <div className="v3dh">
      <h2 className="v3dh-title">{t('proteindb:viewer_head_title')}</h2>
      <EngineSwitch engine={engine} onEngine={onEngine} pymolLoad={pymolLoad} cootLock={cootLock} />
      <div className="v3dh-actions">
        <span className="v3dh-target" aria-hidden="true">
          {t('proteindb:viewer_head_target', { engine: TARGET_LABEL[engine] })}
        </span>
        <button
          ref={fullscreenRef}
          type="button"
          className="btn btn-primary v3dh-btn"
          aria-label={t('proteindb:viewer_head_fullscreen_aria', { engine: engineName })}
          onClick={onFullscreen}
        >
          <span aria-hidden="true">⛶</span> {t('proteindb:viewer_head_fullscreen')}
        </button>
        <a
          href={dedicatedHref}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-secondary v3dh-btn"
          aria-label={t('proteindb:viewer_head_dedicated_aria', { engine: engineName })}
          onClick={onDedicatedClick}
        >
          {t('proteindb:viewer_head_dedicated')} <span aria-hidden="true">↗</span>
        </a>
        {extra}
      </div>
    </div>
  )
}

/**
 * The engine choice itself — two native radios as one segmented control, the
 * PyMOL option in the licence's two tiers (`PymolContainsLabel`) — and
 * PyMOL's readiness beside it. The 3D card's header and the offline HTML
 * export's full edition draw the same control (the light edition holds no
 * PyMOL and draws none, owner 2026-11-14).
 *
 * The readiness shows beside the control, and the PyMOL radio is described by
 * it, so the state is read when the option takes focus (PT-9101 item 5). What
 * a screen reader hears on its own goes through a separate, always-mounted
 * live region (PT-9101 items 1, 4), and only what concerns the user: a
 * failure always, the loading only while PyMOL is the chosen engine, and once
 * that the wait ended — never the preload on every page visit for someone who
 * never picks PyMOL (PT-9102 item 8), nor the end again when PyMOL is chosen
 * again later (PT-9219 item 1).
 *
 * `variant="compact"` (the offline HTML export's header, owner 2026-11-16):
 * no check mark, and the PyMOL label a line per tier — Includes / PyMOL™,
 * PyMOL™ the large one — so the control is narrower at the same
 * height. The chosen option is still told by more than colour: a filled
 * background, bold text and an inner rule (viewer3dHeader.css). The default
 * variant draws every engine, with the check mark.
 */
export function EngineSwitch<E extends ViewerEngine = ViewerEngine>({
  engine,
  onEngine,
  pymolLoad = 'idle',
  cootLock = null,
  variant = 'default',
}: {
  /** The offline file's header holds two engines and passes their narrower type. */
  engine: E
  onEngine: (engine: E) => void
  pymolLoad?: PymolLoadState
  /**
   * Why the `coot` option, a third engine, cannot run in this browser, or
   * null. With a reason the option is shown greyed, with a lock and this
   * reason beside it, never hidden (owner ruling).
   */
  cootLock?: string | null
  variant?: 'default' | 'compact'
}) {
  const compact = variant === 'compact'
  // Compact draws two engines; the default, all three.
  const engines = (compact ? COMPACT_ENGINES : ENGINES) as readonly E[]
  const { t } = useTranslation('proteindb')
  const pymolName = usePymolContainsName()
  const name = useId()
  const statusId = useId()
  const cootLockId = useId()
  const failed = pymolLoad === 'failed'
  const loading = pymolLoad === 'loading'
  const chosen = engine === 'pymol'
  // "Ready" is said once, when a wait the user was told about ends, and
  // goes at the next engine change: choosing PyMOL again later empties and
  // refills the live region, which would say it again (PT-9219 item 1).
  const [prevLoad, setPrevLoad] = useState(pymolLoad)
  const [prevChosen, setPrevChosen] = useState(chosen)
  const [readyNote, setReadyNote] = useState(false)
  if (prevLoad !== pymolLoad || prevChosen !== chosen) {
    setPrevLoad(pymolLoad)
    setPrevChosen(chosen)
    setReadyNote(prevLoad === 'loading' && pymolLoad === 'ready' && prevChosen && chosen)
  }
  const announce = failed
    ? t('proteindb:viewer_head_pymol_failed')
    : loading && chosen
      ? t('proteindb:viewer_head_pymol_loading')
      : readyNote && chosen
        ? t('proteindb:viewer_head_pymol_ready')
        : null
  return (
    <div className="v3dh-engine-wrap">
      <fieldset className={`v3dh-engine${compact ? ' v3dh-engine--compact' : ''}`}>
        <legend className="sr-only">{t('proteindb:viewer_head_engine_legend')}</legend>
        {engines.map(value => {
          const selected = engine === value
          const isPymol = value === 'pymol'
          const isCoot = value === 'coot'
          const locked = isCoot && cootLock !== null
          return (
            <label
              key={value}
              className={`v3dh-option${selected ? ' is-selected' : ''}${isPymol ? ' v3dh-option--pymol' : ''}${locked ? ' is-locked' : ''}`}
              // The switch says "Coot"; the tooltip and the name give its full brand.
              title={isCoot ? t('coot:brand') : undefined}
            >
              <input
                type="radio"
                name={name}
                value={value}
                checked={selected}
                disabled={locked}
                onChange={() => onEngine(value)}
                // The full phrase is the name; the visible two tiers are decoration for it.
                aria-label={isPymol ? pymolName.text : isCoot ? t('coot:brand') : undefined}
                lang={isPymol ? pymolName.lang : undefined}
                aria-describedby={isPymol && (loading || failed) ? statusId : locked ? cootLockId : undefined}
              />
              {selected && !compact && (
                <span className="v3dh-check" aria-hidden="true">
                  ✓
                </span>
              )}
              {locked && (
                <span className="v3dh-lock" aria-hidden="true">
                  🔒
                </span>
              )}
              {isPymol ? <PymolContainsLabel size="md" stacked={compact} /> : ENGINE_LABEL[value]}
            </label>
          )
        })}
      </fieldset>
      {cootLock !== null && (engines as readonly ViewerEngine[]).includes('coot') && (
        <span id={cootLockId} className="v3dh-load v3dh-load--locked">
          {cootLock}
        </span>
      )}
      {/* Where PyMOL stands, read as the radio's description; the live region
          below speaks. A failure is seen beside the control; the wait is not:
          its spinner turns over the viewer instead (owner 2026-11-16), so here
          it is words for a screen reader only. */}
      {(loading || failed) && (
        <span id={statusId} className={failed ? 'v3dh-load v3dh-load--failed' : 'sr-only'}>
          {failed && <span aria-hidden="true">!</span>}
          {failed ? t('proteindb:viewer_head_pymol_failed') : t('proteindb:viewer_head_pymol_loading')}
        </span>
      )}
      <span role="status" className="sr-only">
        {announce !== null && (
          <>
            <span lang={pymolName.lang}>{pymolName.text}</span>: {announce}
          </>
        )}
      </span>
    </div>
  )
}
