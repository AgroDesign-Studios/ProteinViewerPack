import { useEffect, useId, useRef, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'

/** PyMOL's own name of the mouse mode the table describes (its `button_mode_name`). */
export const GUIDE_MODE = '3-Button Viewing'

/** Back to that mode (PyMOL's Mouse menu entry), not echoed into the view. */
export const MOUSE_MODE_RESET = "_ /cmd.mouse('three_button_viewing')"

/**
 * One row: what the user wants, how (a key name in it is `{{ctrl}}`, the
 * platform's own), and PyMOL's four-letter code from the mouse box it
 * replaces, so a long-time user can match the two.
 */
type Row = readonly [want: string, how: string, code: string]

/** PyMOL 3.2's `mode_dict['three_button_viewing']` (modules/pymol/controlling.py), in plain words. */
const VIEW: readonly Row[] = [
  ['htmlExport:sa_mouse_rotate', 'htmlExport:sa_mouse_left_drag', 'Rota'],
  ['htmlExport:sa_mouse_move', 'htmlExport:sa_mouse_middle_drag', 'Move'],
  ['htmlExport:sa_mouse_zoom', 'htmlExport:sa_mouse_right_drag', 'MovZ'],
  ['htmlExport:sa_mouse_center', 'htmlExport:sa_mouse_middle_click', 'Cent'],
]
const SELECT: readonly Row[] = [
  ['htmlExport:sa_mouse_pick', 'htmlExport:sa_mouse_left_click', '+/-'],
  ['htmlExport:sa_mouse_box_add', 'htmlExport:sa_mouse_shift_left_drag', '+Box'],
  ['htmlExport:sa_mouse_box_remove', 'htmlExport:sa_mouse_shift_middle_drag', '-Box'],
  ['htmlExport:sa_mouse_menu', 'htmlExport:sa_mouse_right_click', 'Menu'],
]
const DEPTH: readonly Row[] = [
  ['htmlExport:sa_mouse_slab', 'htmlExport:sa_mouse_wheel', 'Slab'],
  ['htmlExport:sa_mouse_slab_move', 'htmlExport:sa_mouse_shift_wheel', 'MovS'],
  ['htmlExport:sa_mouse_clip', 'htmlExport:sa_mouse_shift_right_drag', 'Clip'],
  ['htmlExport:sa_mouse_zoom', 'htmlExport:sa_mouse_ctrl_shift_wheel', 'MovZ'],
  ['htmlExport:sa_mouse_origin', 'htmlExport:sa_mouse_ctrl_shift_middle_click', 'Orig'],
]

/** A Mac names the key the page sends as Ctrl ⌘ (the bridge maps ⌘ and Ctrl alike). */
export const isMacLike = (platform: string, ua: string): boolean => /Mac|iPhone|iPad/i.test(platform) || /Macintosh/i.test(ua)

/**
 * The computer's 「🖱 マウス操作」 card (owner 2026-11-19: PyMOL's mouse box
 * goes — `mouse_grid` off — and 「もっとわかりやすい表を邪魔にならない形で」;
 * UI consult, Opus 5.5 and Codex astra): what the user wants to do, then how,
 * with PyMOL's own code for those who know the box. Not modal: it stays open
 * while the user tries on the view, and closes by ×, Escape or its button.
 * Turning, moving, zooming and picking are always in sight; depth and the
 * rest are folded. Another mouse mode than the one described is said, with
 * the way back.
 */
export function PymolMouseGuide(props: {
  /** The card's id (its button's `aria-controls`). */
  id: string
  /** PyMOL's mouse mode now (`button_mode_name`), or null before PyMOL says. */
  mode: string | null
  onClose: () => void
  /** Runs a page command (the way back to 3-Button Viewing). */
  run: (cmd: string) => void
  /** Where it sits over the view (clear of PyMOL's object panel). */
  style?: CSSProperties
  /** Whether the keyboard names Ctrl ⌘ (a Mac). */
  mac: boolean
}) {
  const { id, mode, onClose, run, style, mac } = props
  const { t } = useTranslation(['htmlExport'])
  const titleId = useId()
  const headRef = useRef<HTMLHeadingElement | null>(null)
  useEffect(() => headRef.current?.focus(), [])
  const ctrl = mac ? '⌘' : 'Ctrl'
  const table = (rows: readonly Row[], caption: string) => (
    <table className="sav-mouse-table">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">{t('htmlExport:sa_mouse_col_want')}</th>
          <th scope="col">{t('htmlExport:sa_mouse_col_how')}</th>
          <th scope="col" className="sav-mouse-code">
            {t('htmlExport:sa_mouse_col_code')}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([want, how, code]) => (
          <tr key={`${want}-${how}`}>
            <th scope="row">{t(want)}</th>
            <td>{t(how, { ctrl })}</td>
            <td className="sav-mouse-code">{code}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
  return (
    <div
      id={id}
      className="sav-mouse-guide"
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      style={style}
      onKeyDown={e => {
        if (e.key !== 'Escape') return
        e.stopPropagation()
        onClose()
      }}
    >
      <div className="sav-mouse-head">
        <h2 id={titleId} ref={headRef} tabIndex={-1}>
          <span aria-hidden="true">🖱 </span>
          {t('htmlExport:sa_mouse_title')}
        </h2>
        <button type="button" className="sav-mouse-close" aria-label={t('htmlExport:sa_mouse_close')} title={t('htmlExport:sa_mouse_close')} onClick={onClose}>
          ×
        </button>
      </div>
      {mode !== null && mode !== GUIDE_MODE && (
        <p className="sav-mouse-other">
          {t('htmlExport:sa_mouse_other', { mode })}{' '}
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => {
              run(MOUSE_MODE_RESET)
              // The button goes with the note: the focus stays in the card.
              headRef.current?.focus()
            }}
          >
            {t('htmlExport:sa_mouse_reset')}
          </button>
        </p>
      )}
      {table(VIEW, t('htmlExport:sa_mouse_g_view'))}
      {table(SELECT, t('htmlExport:sa_mouse_g_select'))}
      <details className="sav-mouse-more">
        <summary>{t('htmlExport:sa_mouse_g_depth')}</summary>
        {table(DEPTH, t('htmlExport:sa_mouse_g_depth'))}
      </details>
      <p className="sav-mouse-note">
        {t('htmlExport:sa_mouse_note_drag')} {t('htmlExport:sa_mouse_note_middle', { ctrl })}
      </p>
    </div>
  )
}
