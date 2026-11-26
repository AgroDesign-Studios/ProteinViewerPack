import { useEffect, useLayoutEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { formatSI } from '../../utils/formatSI'
import {
  CAP_COLOR_PRESETS,
  CAP_OPACITY_DEFAULT,
  CAP_OPACITY_MAX,
  CAP_OPACITY_MIN,
  CAP_OPACITY_STEP,
  CUT_MAX,
  CUT_STEP,
  DEPTH_CUE_DEFAULT,
  FOG_STRENGTH_STEP,
  THICKNESS_MAX,
  THICKNESS_MIN,
  THICKNESS_STEP,
  depthWindowA,
  isDepthCueDefault,
  orthoAfterToggle,
  orthoFor,
  sliderFill,
  type DepthCue,
} from './depthCue'
import { releaseHandlers } from './sliderRelease'

/**
 * The live cue shows a cut-face colour the committed cue does not have.
 *
 * Only the colour picker writes these two fields without committing them, so
 * a disagreement means a colour dialog emitted values it never confirmed.
 */
function pickerUnconfirmed(live: DepthCue, committed: DepthCue): boolean {
  return live.capColor !== committed.capColor
    || live.capCustomColor !== committed.capCustomColor
}

interface Props {
  value: DepthCue
  /** Live, per pointer move: the canvas has to follow the slider. */
  onChange: (next: DepthCue) => void
  /**
   * A gesture ENDED with this value. The chips call it immediately (a click is
   * its own gesture); the sliders call it on release, so a drag does not write
   * the viewer-state blob to localStorage on every pointer move.
   */
  onCommit: (next: DepthCue) => void
  /** A gesture the system aborted — drop the live value, keep the committed one. */
  onCancelGesture: () => void
  /**
   * The last COMMITTED cue — `useDepthCue`'s `persistedCue`, i.e. what the
   * viewer-state blob holds.
   *
   * The colour picker needs it: `value` is live, and while a colour dialog is
   * open it carries a colour nobody has confirmed. This is the one record every
   * writer advances (this bar's commits, the picker's confirm, a stored
   * view's restore), so "the picker's colour is unconfirmed" is read off it rather than
   * off a memory this component would have to keep in step with them.
   */
  committed: DepthCue
  /**
   * The molecule's depth in angstroms, for the readouts beside the sliders.
   * Null until the viewer exists and has been measured — the controls stay
   * usable in that window because the settings are fractions, and only the
   * angstrom captions fall back to a dash.
   */
  spanA: number | null
  /**
   * Namespace for the label/input `id` pairs. Two viewers can be open at once
   * as separate documents; this exists so a future host that mounts two bars
   * in ONE document does not silently break every `<label htmlFor>`.
   */
  idPrefix: string
  /**
   * A surface is being drawn, so there is something to cap.
   *
   * The cut face is built from the surface mesh; with the Surface switch off
   * there is no mesh and the chip would toggle a setting with no effect. Same
   * reason `SurfaceTypeChips` is gated on it (DESIGN.md §6.2.6).
   */
  capAvailable: boolean
  /**
   * A density map is on screen — the same value the page hands `useDepthCue`.
   *
   * The projection chip shows the projection actually drawn, and with no
   * override that follows the density (`DepthCue.ortho`). Without this the chip
   * would read "off" over an orthographic canvas. Omitted by a viewer that
   * shows no density — and omitting it is also what drops the
   * density sentence from the chip's hint there, so a viewer that can never
   * show a map is not told it switches on with one.
   */
  densityShown?: boolean
}

/**
 * Depth-cue and cross-section controls, mounted inside either viewer's toolbar.
 *
 * Chips rather than a `<select>`, per DESIGN.md 6.2.2 — the toolbar tests
 * resolve the colour scheme with `getByRole('combobox')` on the assumption that
 * it is the only one there.
 *
 * The cap chip is revealed only while the cross-section is on AND a surface is
 * drawn — off either of those it would toggle a setting with nothing to show
 * for it, on a row that is already the widest in the toolbar.
 *
 * Each slider is revealed only while its feature is on. That is not decoration:
 * this row shares a toolbar with the style, colour, visibility and annotation
 * controls, and three permanently-visible sliders push the whole thing onto a
 * fourth line at the widths this page is actually used at.
 */
export default function DepthCueBar(
  {
    value, onChange, onCommit, onCancelGesture, committed, spanA, idPrefix, capAvailable,
    densityShown: densityProp,
  }: Props,
) {
  const densityShown = densityProp ?? false
  const { t } = useTranslation('proteindb')

  // `depthWindowA`, not `spanA`: cut and thickness are fractions of the slab
  // WINDOW, which is about 1.026x the bounding-box diagonal. Multiplying by the
  // span alone under-reported every figure by 2.6%.
  const angstrom = (fraction: number): string =>
    t('proteindb:viewer_angstrom', {
      value: formatSI(spanA == null ? null : fraction * depthWindowA(spanA), { fractionDigits: 1 }),
    })

  /**
   * The live cue with the picker's two fields taken from the COMMITTED cue —
   * what every commit in this bar except the picker's own confirm starts from.
   *
   * Only the picker writes those two fields live, and only its native `change`
   * commits them. So wherever `value` and `committed` disagree on them, `value`
   * holds a colour no dialog confirmed, and spreading `value` would persist it:
   * on a UA where a click does not move focus (Safari/macOS), a dismissed dialog
   * is followed by no blur, and the next chip click — including the cross-section
   * and cut-face chips that unmount the picker in the same click — would write
   * the rejected colour over the preset. Taking them from `committed` closes that
   * for every control at once, whether or not the picker is still mounted.
   *
   * ⛔ Do not narrow this to "while the picker is mounted" or "while the choice
   * is `custom`": both were boundaries the earlier, memory-based guard tried to
   * enumerate, and the disagreement itself is the only exact test.
   */
  const base: DepthCue = {
    ...value,
    capColor: committed.capColor,
    capCustomColor: committed.capCustomColor,
  }

  /**
   * Release handlers for one slider, keyed by the field it moves.
   *
   * `onChange` keeps the canvas following the drag; these decide when the value
   * is COMMITTED — i.e. when it reaches the persisted viewer state. Same
   * contract other sliders use, from the same leaf module, so the two
   * cannot drift apart (`sliderRelease.ts`).
   */
  const release = (field: 'fogStrength' | 'cut' | 'thickness' | 'capOpacity') =>
    releaseHandlers(
      v => onCommit({ ...base, [field]: v }),
      onCancelGesture,
      v => onCommit({ ...base, [field]: v }),
    )

  /**
   * The colour input's gesture end.
   *
   * Same release-commit contract as the sliders (`sliderRelease.ts`): the canvas
   * follows every value the picker emits, but the viewer-state blob is written
   * only once the gesture is over. It cannot reuse `releaseHandlers` — the
   * native colour dialog is not a pointer drag on this element, so no mouseup or
   * touchend reaches it and no key moves the value. Its own `change` event is
   * the honest end-of-gesture signal, and React does not expose it separately:
   * on a colour input React maps `onChange` to the `input` event, so a React
   * `onChange` handler cannot tell the two apart.
   *
   * The commit itself is unguarded — see `commitPicked`. What keeps a dismissed
   * dialog's colour from reaching the blob is `base` above (no other commit
   * carries it) plus the two cancels below (the canvas stops showing it), not a
   * condition on the `change` listener.
   *
   * "Unconfirmed" is `pickerUnconfirmed(value, committed)` everywhere: the live
   * colour differs from the COMMITTED cue's. That needs no memory of what the
   * dialog confirmed, so it has no boundaries to keep in step — the earlier
   * guard remembered the confirmed hex until blur or unmount, and went wrong
   * whenever something else committed a colour inside that window
   * (a stored view's restore on Safari/macOS) or the window ended without a blur
   * (the input unmounting). The committed cue IS the confirm's record: the
   * dialog's `change` advances it, and so does every other writer.
   */
  const customRef = useRef<HTMLInputElement | null>(null)
  // `useLayoutEffect`, not a passive one and not a write during render. A passive
  // effect is flushed on a macrotask, while the native listener below runs in the
  // target phase of an event the browser can dispatch in the SAME task as the
  // `input` before it — so a passive-written ref can still hold the previous
  // render's cue. Writing during render would fix that but records props from a
  // render React may discard; a layout effect runs synchronously for the render
  // that is actually committed, which is the one the listener must see.
  const latest = useRef({ value, committed, onCommit, onCancelGesture })
  useLayoutEffect(() => { latest.current = { value, committed, onCommit, onCancelGesture } })
  const capColorShown = value.slab && capAvailable && value.cap
  useEffect(() => {
    const el = customRef.current
    if (!el) return
    const commitPicked = (): void => {
      const { value: cue, onCommit: commit } = latest.current
      // No "is the choice already custom?" guard: `change` on a colour input
      // fires only when the value actually changed, so it IS the user choosing
      // this colour. Guarding on the live choice would drop the pick whenever
      // something had already reverted it — a window blur mid-dialog, say.
      commit({ ...cue, capColor: 'custom', capCustomColor: el.value })
    }
    el.addEventListener('change', commitPicked)
    return () => {
      el.removeEventListener('change', commitPicked)
      // The element is going away, and removing a FOCUSED one fires no blur — so
      // the blur handler's cancel cannot run, and the canvas would keep drawing
      // a colour nobody confirmed. `base` already keeps it out of the blob; this
      // puts the picture back too. When the same click that unmounted the input
      // committed `base`, live and committed agree again and nothing is called.
      const { value: cue, committed: settled, onCancelGesture: cancel } = latest.current
      if (pickerUnconfirmed(cue, settled)) cancel()
    }
  }, [capColorShown])

  return (
    <div className="sv3d-chips">
      <span className="sv3d-chip-label">{t('proteindb:viewer_depth')}</span>

      <button
        type="button"
        className="sv3d-chip"
        aria-pressed={value.fog}
        onClick={() => onCommit({ ...base, fog: !value.fog })}
        title={t('proteindb:viewer_depth_fog_hint')}
      >
        {t('proteindb:viewer_depth_fog')}
      </button>

      {value.fog && (
        <span className="sv3d-depth-field">
          <label className="sv3d-chip-label" htmlFor={`${idPrefix}-fog-strength`}>
            {t('proteindb:viewer_depth_fog_strength')}
          </label>
          <input
            id={`${idPrefix}-fog-strength`}
            type="range"
            className="zone-slider sv3d-depth-slider"
            min={0}
            max={1}
            step={FOG_STRENGTH_STEP}
            value={value.fogStrength}
            style={{ ['--fill' as string]: `${sliderFill(value.fogStrength, 0, 1)}%` }}
            onChange={e => onChange({ ...value, fogStrength: Number(e.target.value) })}
            {...release('fogStrength')}
          />
          <span className="sv3d-depth-value">
            {t('proteindb:viewer_percent', {
              value: formatSI(value.fogStrength * 100, { fractionDigits: 0 }),
            })}
          </span>
        </span>
      )}

      <span className="sv3d-sep" aria-hidden="true" />

      <button
        type="button"
        className="sv3d-chip"
        aria-pressed={value.slab}
        onClick={() => onCommit({ ...base, slab: !value.slab })}
        title={t('proteindb:viewer_depth_slab_hint')}
      >
        {t('proteindb:viewer_depth_slab')}
      </button>

      {value.slab && capAvailable && (
        <>
          <button
            type="button"
            className="sv3d-chip"
            aria-pressed={value.cap}
            onClick={() => onCommit({ ...base, cap: !value.cap })}
            title={t('proteindb:viewer_depth_cap_hint')}
          >
            {t('proteindb:viewer_depth_cap')}
          </button>

          {/* Revealed only while there IS a cut face, on the same reasoning as
              the sliders above: with the fill off, a colour row would be seven
              more controls on the widest line of the toolbar, all of them
              changing nothing on screen. */}
          {value.cap && (
            <span className="sv3d-depth-field">
              <span className="sv3d-chip-label" id={`${idPrefix}-cap-color-label`}>
                {t('proteindb:viewer_depth_cap_color')}
              </span>
              <span role="group" aria-labelledby={`${idPrefix}-cap-color-label`}>
                {CAP_COLOR_PRESETS.map(preset => (
                  <button
                    key={preset}
                    type="button"
                    className={`sv3d-swatch sv3d-swatch-cap-${preset}`}
                    aria-pressed={value.capColor === preset}
                    aria-label={t(`proteindb:viewer_depth_cap_color_${preset}`)}
                    title={t(`proteindb:viewer_depth_cap_color_${preset}`)}
                    onClick={() => onCommit({ ...base, capColor: preset })}
                  />
                ))}
              </span>
              <label className="sv3d-chip-label" htmlFor={`${idPrefix}-cap-color-custom`}>
                {t('proteindb:viewer_depth_cap_color_custom')}
                {value.capColor === 'custom' && (
                  <span className="sr-only"> {t('proteindb:viewer_depth_cap_color_custom_active')}</span>
                )}
              </label>
              <input
                ref={customRef}
                id={`${idPrefix}-cap-color-custom`}
                type="color"
                className="sv3d-swatch-cap-custom"
                data-active={value.capColor === 'custom'}
                value={value.capCustomColor}
                title={t('proteindb:viewer_depth_cap_color_custom_hint')}
                onChange={e => onChange({ ...value, capColor: 'custom', capCustomColor: e.target.value })}
                onBlur={() => {
                  // Confirmed (or never touched): the live colour is the
                  // committed one and there is nothing to drop. Tabbing through
                  // the picker therefore costs nothing, whatever the choice is.
                  if (!pickerUnconfirmed(value, committed)) return
                  // Live but never confirmed: the dialog was dismissed. Drop what
                  // `onChange` wrote and go back to the committed cue.
                  //
                  // The opposite of `releaseHandlers`' `settle`, deliberately —
                  // a range input changed with no pointer or key events still
                  // means the user chose that value, whereas a colour dialog
                  // that emitted no `change` means they did not.
                  onCancelGesture()
                }}
              />
            </span>
          )}

          {/* The cut face's own opacity, on the same reveal rule as everything
              else in this bar: the slider exists only while it is doing
              something. Off, the chip is the whole control and the cut face
              keeps following the surface, which is what it has always done. */}
          {value.cap && (
            <span className="sv3d-depth-field">
              <button
                type="button"
                className="sv3d-chip"
                id={`${idPrefix}-cap-opacity-label`}
                aria-pressed={value.capOpacity !== null}
                onClick={() => onCommit({
                  ...base,
                  capOpacity: value.capOpacity === null ? CAP_OPACITY_DEFAULT : null,
                })}
                title={t('proteindb:viewer_depth_cap_opacity_hint')}
              >
                {t('proteindb:viewer_depth_cap_opacity')}
              </button>
              {value.capOpacity !== null && (
                <>
                  {/*
                    Named by the chip that revealed it, via `aria-labelledby`,
                    rather than by a `<label htmlFor>` of its own like the cut and
                    thickness sliders above. Those have no chip — their captions
                    ARE their names. Giving this one a second visible caption
                    would put the same four words on screen twice, and hiding that
                    caption instead would leave a control whose on-screen name and
                    accessible name come from different elements.
                  */}
                  <input
                    id={`${idPrefix}-cap-opacity`}
                    aria-labelledby={`${idPrefix}-cap-opacity-label`}
                    type="range"
                    className="zone-slider sv3d-depth-slider"
                    min={CAP_OPACITY_MIN}
                    max={CAP_OPACITY_MAX}
                    step={CAP_OPACITY_STEP}
                    value={value.capOpacity}
                    style={{
                      ['--fill' as string]:
                        `${sliderFill(value.capOpacity, CAP_OPACITY_MIN, CAP_OPACITY_MAX)}%`,
                    }}
                    onChange={e => onChange({ ...value, capOpacity: Number(e.target.value) })}
                    {...release('capOpacity')}
                  />
                  <span className="sv3d-depth-value">
                    {t('proteindb:viewer_percent', {
                      value: formatSI(value.capOpacity * 100, { fractionDigits: 0 }),
                    })}
                  </span>
                </>
              )}
            </span>
          )}
        </>
      )}

      {value.slab && (
        <>
          <span className="sv3d-depth-field">
            <label className="sv3d-chip-label" htmlFor={`${idPrefix}-cut`}>
              {t('proteindb:viewer_depth_cut')}
            </label>
            <input
              id={`${idPrefix}-cut`}
              type="range"
              className="zone-slider sv3d-depth-slider"
              min={0}
              max={CUT_MAX}
              step={CUT_STEP}
              value={value.cut}
              style={{ ['--fill' as string]: `${sliderFill(value.cut, 0, CUT_MAX)}%` }}
              onChange={e => onChange({ ...value, cut: Number(e.target.value) })}
              {...release('cut')}
            />
            <span className="sv3d-depth-value">{angstrom(value.cut)}</span>
          </span>

          <span className="sv3d-depth-field">
            <label className="sv3d-chip-label" htmlFor={`${idPrefix}-thickness`}>
              {t('proteindb:viewer_depth_thickness')}
            </label>
            <input
              id={`${idPrefix}-thickness`}
              type="range"
              className="zone-slider sv3d-depth-slider"
              min={THICKNESS_MIN}
              max={THICKNESS_MAX}
              step={THICKNESS_STEP}
              value={value.thickness}
              style={{
                ['--fill' as string]: `${sliderFill(value.thickness, THICKNESS_MIN, THICKNESS_MAX)}%`,
              }}
              onChange={e => onChange({ ...value, thickness: Number(e.target.value) })}
              {...release('thickness')}
            />
            <span className="sv3d-depth-value">{angstrom(value.thickness)}</span>
          </span>
        </>
      )}

      <button
        type="button"
        className="sv3d-chip"
        aria-pressed={orthoFor(value, densityShown)}
        onClick={() => onCommit({ ...base, ortho: orthoAfterToggle(value, densityShown) })}
        title={t(densityProp === undefined
          ? 'proteindb:viewer_depth_ortho_hint_no_density'
          : 'proteindb:viewer_depth_ortho_hint_follow')}
      >
        {t('proteindb:viewer_depth_ortho')}
      </button>

      {!isDepthCueDefault(value, densityShown) && (
        <button
          type="button"
          className="sv3d-chip"
          onClick={() => onCommit(DEPTH_CUE_DEFAULT)}
          title={t('proteindb:viewer_depth_reset_hint')}
        >
          {t('proteindb:viewer_depth_reset')}
        </button>
      )}
    </div>
  )
}
