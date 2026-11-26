import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import Modal from '../../src/components/Modal'
import { formatSI } from '../../src/utils/formatSI'
import type { InkNow } from './pymolInk'

/** The multiples of the picture on screen a screenshot is made at: the same composition, more pixels. */
export const SHOT_SCALES = [1, 2, 3, 4] as const
export type ShotScale = (typeof SHOT_SCALES)[number]

/**
 * The largest picture a screenshot is made at, device pixels: 8192 on a
 * side (what a computer's GPU draws) and 40 million in all (the read-back
 * buffer, 4 bytes a pixel, stays near 160 MB); a phone 4096 on a side, its
 * memory being the limit there, as the ray trace's. The worker checks its
 * own GPU's limit again.
 */
export const SHOT_MAX_SIDE = 8192
export const SHOT_MAX_SIDE_TOUCH = 4096
export const SHOT_MAX_PIXELS = 40_000_000

const STORE_KEY = 'agdb-pvp-shot-scale'

/** The multiple chosen last in this browser (1 the first time, or where storage is refused). */
export function loadShotScale(): ShotScale {
  try {
    const v = Number(window.localStorage.getItem(STORE_KEY))
    return (SHOT_SCALES as readonly number[]).includes(v) ? (v as ShotScale) : 1
  } catch {
    return 1
  }
}

export function storeShotScale(s: ShotScale): void {
  try {
    window.localStorage.setItem(STORE_KEY, String(s))
  } catch {
    // Not kept: the next screenshot starts from the same size again.
  }
}

/** Whether `base` × `s` is a picture this device makes (an unmeasured view: every size is offered). */
export function shotFits(base: { w: number; h: number } | null, s: number, maxSide: number): boolean {
  if (base === null) return true
  return Math.max(base.w, base.h) * s <= maxSide && base.w * base.h * s * s <= SHOT_MAX_PIXELS
}

/**
 * 「スクリーンショット（PNG）」's form (owner 2026-11-20: 「スクリーンショットでも
 * 解像度が選べるようにする」; UI consult, Opus 5.5 and Codex astra): the picture
 * on screen, laid out as it is, made 1–4 times as many pixels on a side — the
 * same composition, sharper — each size with its pixels; a size larger than
 * this device makes stays in the list, greyed with its reason (the owner's
 * rule: never hidden). 「画像作成」 makes it and the page's save step takes
 * it, as before. In "Includes PyMOL™" mode the picture is PyMOL's whole view,
 * its object panel in it when open, so the owner's sentence is always there,
 * with whether the panel is open now and, while it is, a button that folds
 * it (its tab is under this dialog). The choice is kept in this browser.
 *
 * With lines drawn (「描画」, either engine), 「描画した線を含める」 under the
 * sizes (owner 2026-11-21: 「『描画』で書いた線をスクリーンショットに加えるか
 * どうか選べる」; UI consult): on each time the form opens; off, the picture
 * has none and the lines stay on screen. Lines drawn before the view moved
 * say so under it: they go in with the caption that says so.
 */
export function ScreenshotDialog(props: {
  engine: '3dmol' | 'pymol'
  /** The picture's size on screen, device px; null while it is not measured. */
  base: { w: number; h: number } | null
  /** The longest side this device makes. */
  maxSide: number
  /** "Includes PyMOL™" mode's object panel is open now (it would be in the picture). */
  panelOpen?: boolean
  onFoldPanel?: () => void
  /** The engine can make one now (PyMOL started, no picture being made). */
  ready: boolean
  /** The pen's lines over the view now; none (or null): no choice to make. */
  ink?: InkNow | null
  onClose: () => void
  /** `withInk`: the lines go in (always false with none drawn). */
  onCreate: (scale: ShotScale, withInk: boolean) => void
}) {
  const { engine, base, maxSide, panelOpen = false, onFoldPanel, ready, ink = null, onClose, onCreate } = props
  const { t } = useTranslation(['htmlExport', 'pymol'])
  const titleId = useId()
  const panelId = useId()
  const waitId = useId()
  const inkNoteId = useId()
  const [scale, setScale] = useState<ShotScale>(loadShotScale)
  const lines = ink?.lines ?? 0
  const [withInk, setWithInk] = useState(true)
  const createRef = useRef<HTMLButtonElement>(null)
  const fits = (s: number) => shotFits(base, s, maxSide)
  // A kept size this view cannot make: the largest it can.
  useEffect(() => {
    if (!fits(scale)) setScale([...SHOT_SCALES].reverse().find(s => fits(s)) ?? 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base?.w, base?.h, maxSide])
  const label = (s: ShotScale) => {
    if (base === null) return s === 1 ? t('htmlExport:sa_shot_same') : t('htmlExport:sa_shot_scale', { n: s })
    const px = { w: base.w * s, h: base.h * s }
    // Over the side, or over the pixels in all: each says its own limit (PT-10148 item 2).
    if (!fits(s)) {
      return Math.max(px.w, px.h) > maxSide
        ? t('htmlExport:sa_shot_scale_over', { n: s, ...px, max: maxSide })
        : t('htmlExport:sa_shot_scale_over_px', { n: s, ...px, mp: SHOT_MAX_PIXELS / 1e6 })
    }
    return s === 1 ? t('htmlExport:sa_shot_same_px', px) : t('htmlExport:sa_shot_scale_px', { n: s, ...px })
  }
  const can = ready && fits(scale)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!can) return
    storeShotScale(scale)
    onCreate(scale, lines > 0 && withInk)
  }
  const described = [engine === 'pymol' ? panelId : null, ready ? null : waitId].filter(Boolean).join(' ') || undefined
  return (
    <Modal maxWidth={560} labelledBy={titleId} onClose={onClose}>
      <form className="pymolv-dialog sav-shot" onSubmit={submit}>
        <div className="pymolv-dialog-head">
          <h2 id={titleId}>{t('htmlExport:sa_shot_title')}</h2>
          <button type="button" className="btn btn-secondary btn-sm" aria-label={t('pymol:dialog_close')} onClick={onClose}>
            ×
          </button>
        </div>
        <p className="pymolv-dialog-note">{t('htmlExport:sa_shot_note')}</p>
        <fieldset className="pymolv-choices sav-shot-size">
          <legend>{t('htmlExport:sa_shot_legend')}</legend>
          {SHOT_SCALES.map(s => (
            // A size this device cannot make: in the list, its reason in its words (as the ray trace's form).
            <label key={s} className="pymolv-choice">
              <input type="radio" name="sav-shot-scale" value={s} checked={scale === s} disabled={!fits(s)} onChange={() => setScale(s)} />{' '}
              <span>{label(s)}</span>
            </label>
          ))}
        </fieldset>
        {lines > 0 && (
          <div className="sav-shot-ink">
            <label className="pymolv-choice">
              <input type="checkbox" checked={withInk} onChange={e => setWithInk(e.target.checked)} aria-describedby={ink?.stale === true ? inkNoteId : undefined} />{' '}
              <span>{t('htmlExport:sa_shot_ink', { n: formatSI(lines) })}</span>
            </label>
            {ink?.stale === true && (
              <p className="pymolv-dialog-note" id={inkNoteId}>
                {t('htmlExport:sa_shot_ink_stale')}
              </p>
            )}
          </div>
        )}
        {engine === 'pymol' && (
          <div className="sav-shot-panel" id={panelId}>
            {/* The owner's sentence (2026-11-20), as written. */}
            <p className="sav-shot-panel-note">{t('htmlExport:sa_shot_pymol_panel')}</p>
            {/* Said when it changes: the fold below changes it (PT-10148 item 3). */}
            <p className="sav-shot-panel-now" aria-live="polite">
              {panelOpen ? t('htmlExport:sa_shot_panel_open') : t('htmlExport:sa_shot_panel_closed')}
            </p>
            {panelOpen && onFoldPanel !== undefined && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  // The button goes with the open panel: the focus moves on to 「画像作成」, the next step.
                  onFoldPanel()
                  createRef.current?.focus()
                }}
              >
                {t('htmlExport:sa_shot_fold')}
              </button>
            )}
          </div>
        )}
        {!ready && (
          <p className="pymolv-dialog-note" id={waitId}>
            {t('htmlExport:sa_shot_wait')}
          </p>
        )}
        <div className="pymolv-dialog-foot">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t('htmlExport:sa_close')}
          </button>
          <button ref={createRef} type="submit" className="btn btn-primary" aria-disabled={can ? undefined : true} aria-describedby={described}>
            {t('htmlExport:sa_shot_create')}
          </button>
        </div>
      </form>
    </Modal>
  )
}
