import { useId, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import Modal from '../../components/Modal'
import { ToggleSwitch } from '../../components/ToggleSwitch'
import {
  aspectDiffers,
  estimateRaySeconds,
  lockedSide,
  RAY_DPI_CHOICES,
  RAY_FIXED,
  RAY_FIXED_SIZES,
  RAY_MAX_SIDE,
  RAY_RISKY_SECONDS,
  RAY_SCALES,
  RAY_SLOW_SECONDS,
  rayAdjusted,
  raySize,
  raySizeProblem,
  scaledSize,
  withQuality,
  type RayAntialias,
  type RayDpi,
  type RayFixed,
  type RayMode,
  type RayOptions,
  type RayScale,
} from './pymolRayOptions'

const MODES: readonly RayMode[] = [0, 1, 2, 3]
const ANTIALIAS: readonly RayAntialias[] = [0, 1, 2]
// Spelled out, so every key is findable in the source.
const MODE_KEYS: Record<RayMode, string> = { 0: 'pymol:ray_mode_0', 1: 'pymol:ray_mode_1', 2: 'pymol:ray_mode_2', 3: 'pymol:ray_mode_3' }
const AA_KEYS: Record<RayAntialias, string> = { 0: 'pymol:ray_antialias_0', 1: 'pymol:ray_antialias_1', 2: 'pymol:ray_antialias_2' }
const FIXED_KEYS: Record<RayFixed, string> = { fhd: 'pymol:ray_size_fhd', print: 'pymol:ray_size_print', uhd: 'pymol:ray_size_uhd' }

/**
 * The ray-trace settings, opened by 「レイトレース画像作成」 (owner
 * 2026-11-09; UI dual consult 2026-11-09: a dialog on the press, not a side
 * bar that would narrow the view, nor a split button on a full bar). 「作成」
 * closes it and starts the ray, so the progress card and its Stop are never
 * under a dialog (PT-3298 item 8).
 *
 * Reworked 2026-11-16 (owner; UI dual consult, Opus + Codex astra, astra's
 * order): the size first — each multiple of the view with the pixels it
 * gives, three common sizes, or a width and a height of one's own (the
 * height following the view's aspect while the lock is on) — then the
 * quality as one switch, 通常品質 ⇄ 高品質, apart from the size, and the
 * details folded under 「詳細設定」 with a note when they no longer match.
 *
 * `view` is the view's size in device pixels, which the multiples are of;
 * null while it is not measured, and then the multiples above 1 are not
 * offered (the common sizes and one's own are).
 */
export function PymolRayDialog(props: {
  initial: RayOptions
  view: { w: number; h: number } | null
  /** PyMOL can take the ray now; false while it starts again or another image is saved (PT-8372 item 3). */
  ready: boolean
  onClose: () => void
  onCreate: (options: RayOptions, size: { w: number; h: number }) => void
}) {
  const { initial, view, ready, onClose, onCreate } = props
  const { t } = useTranslation('pymol')
  const titleId = useId()
  const sizeNoteId = useId()
  const createNoteId = useId()
  const widthId = useId()
  const heightId = useId()
  const dpiId = useId()
  const modeId = useId()
  const aaId = useId()
  const qualityNoteId = useId()
  const qualityRef = useRef<HTMLInputElement | null>(null)
  // A size of one's own in the view's aspect: its height made from its width
  // now the view is known (a choice stored before had a width alone).
  const [o, setO] = useState<RayOptions>(() =>
    initial.size === 'custom' && initial.lock && view !== null ? { ...initial, height: lockedSide(initial.width, 'w', view) } : initial,
  )
  const [widthText, setWidthText] = useState(String(o.width))
  const [heightText, setHeightText] = useState(String(o.height))

  const set = <K extends keyof RayOptions>(key: K, value: RayOptions[K]) => setO(prev => ({ ...prev, [key]: value }))
  /** One side typed: the other follows in the view's aspect while the lock is on. */
  const typeSide = (which: 'w' | 'h', text: string) => {
    const n = Number(text)
    const value = Number.isInteger(n) ? n : 0
    const next = which === 'w' ? { ...o, width: value } : { ...o, height: value }
    if (which === 'w') setWidthText(text)
    else setHeightText(text)
    if (o.lock && view !== null && value >= 1) {
      const other = lockedSide(value, which, view)
      if (which === 'w') {
        next.height = other
        setHeightText(String(other))
      } else {
        next.width = other
        setWidthText(String(other))
      }
    }
    setO(next)
  }
  /** A size of one's own: in the view's aspect from its width while the lock is on. */
  const chooseCustom = () => {
    if (!o.lock || view === null) {
      set('size', 'custom')
      return
    }
    const height = lockedSide(o.width, 'w', view)
    setHeightText(String(height))
    setO({ ...o, size: 'custom', height })
  }
  const setLock = (lock: boolean) => {
    if (!lock || view === null) {
      setO({ ...o, lock })
      return
    }
    const height = lockedSide(o.width, 'w', view)
    setHeightText(String(height))
    setO({ ...o, lock, height })
  }

  // Before the view is measured only its own size is offered among the
  // multiples: 0 x 0 asks the worker for its canvas's size.
  const unmeasuredSame = view === null && o.size === 1
  const size = unmeasuredSame ? { w: 0, h: 0 } : raySize(o, view)
  const problem = unmeasuredSame ? null : raySizeProblem(size)
  const sidesInvalid = o.size === 'custom' && !(o.width >= 1 && o.width <= RAY_MAX_SIDE && o.height >= 1 && o.height <= RAY_MAX_SIDE)
  const otherAspect = size !== null && !unmeasuredSame && problem === null && !sidesInvalid && aspectDiffers(size, view)
  const adjusted = rayAdjusted(o)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!ready || size === null || problem !== null || sidesInvalid) return
    onCreate(o, size)
  }
  // Only for a size the dialog would send; the plain size before the view is
  // measured is the view's own and never slow.
  const seconds = size !== null && problem === null && !sidesInvalid && !unmeasuredSame ? estimateRaySeconds(o, size) : 0
  const timeWarning =
    seconds > RAY_RISKY_SECONDS
      ? t('pymol:ray_time_risky', { min: Math.ceil(seconds / 60) })
      : seconds > RAY_SLOW_SECONDS
        ? t('pymol:ray_time_slow', { min: Math.ceil(seconds / 60) })
        : ''
  const cannotCreate = !ready || size === null || problem !== null || sidesInvalid

  const sizeText =
    problem === 'unmeasured' || unmeasuredSame
      ? t('pymol:ray_size_unmeasured')
      : problem === 'too-large' && size !== null
        ? t('pymol:ray_size_too_large', { w: size.w, h: size.h, max: RAY_MAX_SIDE })
        : size !== null
          ? t('pymol:ray_size_result', { w: size.w, h: size.h, mp: ((size.w * size.h) / 1e6).toFixed(1) })
          : ''

  /** A multiple's label: the pixels it gives, or that it passes the limit; the bare name while the view is not measured. */
  const scaleLabel = (s: RayScale) => {
    const px = scaledSize(s, view)
    if (px === null) return s === 1 ? t('pymol:ray_size_same') : t('pymol:ray_size_scale', { n: s })
    const over = raySizeProblem(px) === 'too-large'
    if (s === 1) return t('pymol:ray_size_same_px', { w: px.w, h: px.h })
    return over ? t('pymol:ray_size_scale_over', { n: s, w: px.w, h: px.h, max: RAY_MAX_SIDE }) : t('pymol:ray_size_scale_px', { n: s, w: px.w, h: px.h })
  }

  return (
    <Modal maxWidth={600} labelledBy={titleId} onClose={onClose}>
      <form className="pymolv-dialog" onSubmit={submit}>
        <div className="pymolv-dialog-head">
          <h2 id={titleId}>{t('pymol:ray_dialog_title')}</h2>
          <button type="button" className="btn btn-secondary btn-sm" aria-label={t('pymol:dialog_close')} onClick={onClose}>
            ×
          </button>
        </div>
        <p className="pymolv-dialog-note">{t('pymol:ray_dialog_note')}</p>

        <fieldset className="pymolv-choices pymolv-ray-size">
          <legend>{t('pymol:ray_size_legend')}</legend>
          <p className="pymolv-ray-subhead">{t('pymol:ray_size_group_view')}</p>
          {RAY_SCALES.map(s => {
            const px = scaledSize(s, view)
            const over = px !== null && raySizeProblem(px) === 'too-large'
            return (
              <label key={s} className="pymolv-choice">
                <input
                  type="radio"
                  name="pymol-ray-size"
                  checked={o.size === s}
                  disabled={(view === null && s !== 1) || over}
                  aria-describedby={sizeNoteId}
                  onChange={() => set('size', s)}
                />{' '}
                <span className="pymolv-ray-px">{scaleLabel(s)}</span>
              </label>
            )
          })}
          <p className="pymolv-ray-subhead">{t('pymol:ray_size_group_fixed')}</p>
          {RAY_FIXED.map(f => (
            <label key={f} className="pymolv-choice">
              <input type="radio" name="pymol-ray-size" checked={o.size === f} aria-describedby={sizeNoteId} onChange={() => set('size', f)} />{' '}
              <span className="pymolv-ray-px">{t(FIXED_KEYS[f], RAY_FIXED_SIZES[f])}</span>
            </label>
          ))}
          <label className="pymolv-choice">
            <input type="radio" name="pymol-ray-size" checked={o.size === 'custom'} aria-describedby={sizeNoteId} onChange={chooseCustom} />{' '}
            {t('pymol:ray_size_custom')}
          </label>
          <div className="pymolv-ray-sides">
            <div className="form-group">
              <label htmlFor={widthId}>{t('pymol:ray_width_label')}</label>
              <input
                id={widthId}
                type="number"
                inputMode="numeric"
                min={1}
                max={RAY_MAX_SIDE}
                step={1}
                value={widthText}
                disabled={o.size !== 'custom'}
                aria-invalid={sidesInvalid && !(o.width >= 1 && o.width <= RAY_MAX_SIDE)}
                aria-describedby={sizeNoteId}
                onChange={e => typeSide('w', e.target.value)}
              />
            </div>
            <span className="pymolv-ray-times" aria-hidden="true">
              ×
            </span>
            <div className="form-group">
              <label htmlFor={heightId}>{t('pymol:ray_height_label')}</label>
              <input
                id={heightId}
                type="number"
                inputMode="numeric"
                min={1}
                max={RAY_MAX_SIDE}
                step={1}
                value={heightText}
                disabled={o.size !== 'custom'}
                aria-invalid={sidesInvalid && !(o.height >= 1 && o.height <= RAY_MAX_SIDE)}
                aria-describedby={sizeNoteId}
                onChange={e => typeSide('h', e.target.value)}
              />
            </div>
            <label className="pymolv-choice pymolv-ray-lock">
              <input type="checkbox" checked={o.lock} disabled={o.size !== 'custom' || view === null} onChange={e => setLock(e.target.checked)} />{' '}
              {t('pymol:ray_lock_label')}
            </label>
          </div>
          <p id={sizeNoteId} className={problem === 'too-large' || sidesInvalid ? 'pymolv-error' : 'pymolv-dialog-note'} aria-live="polite">
            {sidesInvalid ? t('pymol:ray_side_invalid', { max: RAY_MAX_SIDE }) : sizeText}
            {otherAspect && (
              <>
                {' '}
                {t('pymol:ray_aspect_note')}
              </>
            )}
          </p>
        </fieldset>

        <fieldset className="pymolv-choices pymolv-ray-quality">
          <legend>{t('pymol:ray_quality_legend')}</legend>
          <ToggleSwitch
            checked={o.quality === 'high'}
            onChange={high => setO(prev => withQuality(prev, high ? 'high' : 'normal'))}
            offLabel={t('pymol:ray_quality_normal')}
            label={t('pymol:ray_quality_high')}
            describedBy={qualityNoteId}
            inputRef={qualityRef}
          />
          <p id={qualityNoteId} className="pymolv-dialog-note">
            {o.quality === 'high' ? t('pymol:ray_quality_high_note') : t('pymol:ray_quality_normal_note')}
            {adjusted && (
              <>
                {' '}
                {t('pymol:ray_quality_adjusted')}
              </>
            )}
          </p>
          {adjusted && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setO(prev => withQuality(prev, prev.quality))
                // The button goes with the change: the focus goes to the switch it set back (PT-9552 item 4).
                qualityRef.current?.focus()
              }}
            >
              {t('pymol:ray_quality_reset')}
            </button>
          )}
        </fieldset>

        <details className="pymolv-ray-details">
          <summary>{t('pymol:ray_details')}</summary>
          <div className="pymolv-ray-grid">
            <div className="form-group">
              <label htmlFor={dpiId}>{t('pymol:ray_dpi_label')}</label>
              <select id={dpiId} value={o.dpi} onChange={e => set('dpi', Number(e.target.value) as RayDpi)}>
                {RAY_DPI_CHOICES.map(d => (
                  <option key={d} value={d}>
                    {d} dpi
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label htmlFor={modeId}>{t('pymol:ray_mode_label')}</label>
              <select id={modeId} value={o.mode} onChange={e => set('mode', Number(e.target.value) as RayMode)}>
                {MODES.map(m => (
                  <option key={m} value={m}>
                    {t(MODE_KEYS[m])}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label htmlFor={aaId}>{t('pymol:ray_antialias_label')}</label>
              <select id={aaId} value={o.antialias} onChange={e => set('antialias', Number(e.target.value) as RayAntialias)}>
                {ANTIALIAS.map(a => (
                  <option key={a} value={a}>
                    {t(AA_KEYS[a])}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <label className="pymolv-choice">
            <input type="checkbox" checked={o.shadows} onChange={e => set('shadows', e.target.checked)} /> {t('pymol:ray_shadows_label')}
          </label>
          <p className="pymolv-dialog-note">{t('pymol:ray_dpi_note')}</p>
        </details>
        <label className="pymolv-choice">
          <input type="checkbox" checked={o.transparent} onChange={e => set('transparent', e.target.checked)} />{' '}
          {t('pymol:ray_transparent_label')}
        </label>
        <p className="pymolv-dialog-note">{t('pymol:ray_time_note_v2')}</p>
        {timeWarning !== '' && (
          <p className={seconds > RAY_RISKY_SECONDS ? 'pymolv-error' : 'pymolv-dialog-note'} aria-live="polite">
            {timeWarning}
          </p>
        )}

        <div className="pymolv-dialog-foot">
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
            {t('pymol:ray_cancel')}
          </button>
          <button
            type="submit"
            className="btn btn-primary btn-sm"
            disabled={cannotCreate}
            aria-describedby={!ready ? createNoteId : undefined}
          >
            {t('pymol:ray_create')}
          </button>
        </div>
        {!ready && (
          <p id={createNoteId} className="pymolv-dialog-note" role="status">
            {t('pymol:ray_create_not_ready')}
          </p>
        )}
      </form>
    </Modal>
  )
}
