import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import Modal from '../../components/Modal'
import { SCALE_CHOICES, type ScaleChoice } from './pymolDisplayScale'
import { CHROME_RESERVED_SHORTCUTS } from './pymolKeys'
import { commandDetailText } from './pymolCommandText'
import type { SettingRow } from './pymolSettingsData'

/**
 * The two dialogs that stand in for PyMOL's Qt ones on this page. Neither
 * takes anything out of the frame: the settings dialog WRITES a setting
 * through `onCommand` (the page's `runCommand`) and never reads one back, and
 * the keyboard dialog is the page's own table. Saving and exporting are the
 * page's own dialogs, behind the parent's save gate.
 */

/** A setting name as PyMOL spells them. */
const SETTING_NAME = /^[a-z][a-z0-9_]{0,63}$/
const VALUE_CHARS = 1000
/**
 * The line breaks Python's `str.splitlines` knows that JSON leaves as they
 * are (it escapes every one below U+0020 itself).
 */
const RAW_LINE_BREAKS = /[\u0085\u2028\u2029]/g

/** `s` as a Python string literal that stays on one line. */
const pyLiteral = (s: string): string =>
  JSON.stringify(s).replace(RAW_LINE_BREAKS, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)

/**
 * `set NAME, VALUE` as one Python call, the value a string literal — PyMOL's
 * `cmd.set` parses a string value exactly as the `set` command does, and a
 * literal cannot run into a second command the way `;` in a typed value
 * would. JSON's string escapes are valid in a Python literal; NEL, LS and PS,
 * which JSON leaves raw, are escaped too, so nothing that splits the command
 * text into lines can split the literal (PT-3291 item 10).
 */
export function settingCommand(name: string, value: string): string | null {
  const v = value.trim()
  if (!SETTING_NAME.test(name) || v === '' || v.length > VALUE_CHARS || /[\r\n]/.test(v)) return null
  return `/cmd.set(${pyLiteral(name)}, ${pyLiteral(v)}, quiet=0)`
}

export function PymolSettingsDialog(props: {
  onClose: () => void
  onCommand: (command: string) => Promise<void>
  scale: ScaleChoice
  autoScale: number
  onScale: (c: ScaleChoice) => void
  /**
   * The host's own display settings, under the display scale: the offline
   * file's 「オリジナル表示」 (owner 2026-11-20) and the note that a pull of
   * the object panel's tab sets the scale too; unset, none are shown.
   */
  extra?: ReactNode
}) {
  const { onClose, onCommand, scale, autoScale, onScale, extra } = props
  const { t } = useTranslation('pymol')
  const titleId = useId()
  const scaleId = useId()
  const nameId = useId()
  const valueId = useId()
  const listId = useId()
  const [rows, setRows] = useState<readonly SettingRow[] | null>(null)
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const [message, setMessage] = useState('')

  // The 700-row table is a chunk of its own, fetched when the dialog opens.
  useEffect(() => {
    let live = true
    void import('./pymolSettingsData').then(m => {
      if (live) setRows(m.PYMOL_SETTINGS)
    })
    return () => {
      live = false
    }
  }, [])

  const known = useMemo(() => rows?.find(r => r[0] === name.trim()) ?? null, [rows, name])
  const command = settingCommand(name.trim(), value)

  const apply = () => {
    if (command === null) return
    setMessage(t('pymol:settings_applying'))
    onCommand(command).then(
      () => setMessage(t('pymol:settings_applied', { name: name.trim() })),
      (e: unknown) => setMessage(t('pymol:cmd_failed', { detail: commandDetailText(t, e) })),
    )
  }

  return (
    <Modal maxWidth={640} labelledBy={titleId} onClose={onClose}>
      <div className="pymolv-dialog">
        <div className="pymolv-dialog-head">
          <h2 id={titleId}>{t('pymol:settings_title')}</h2>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose} aria-label={t('pymol:dialog_close')}>
            ×
          </button>
        </div>

        <section>
          <h3>{t('pymol:settings_scale_heading')}</h3>
          <p className="pymolv-dialog-note">{t('pymol:settings_scale_note')}</p>
          {/* A form group, as the inputs below: DESIGN.md §5.2's look and zone focus ring (PT-3291 item 20). */}
          <div className="form-group">
            <label htmlFor={scaleId}>{t('pymol:settings_scale_label')}</label>
            <select id={scaleId} value={String(scale)} onChange={e => onScale(e.target.value === 'auto' ? 'auto' : (Number(e.target.value) as 1 | 2 | 3))}>
              {SCALE_CHOICES.map(c => (
                <option key={c} value={String(c)}>
                  {c === 'auto' ? t('pymol:settings_scale_auto', { n: autoScale }) : t('pymol:settings_scale_fixed', { n: c })}
                </option>
              ))}
            </select>
          </div>
          {extra}
        </section>

        <section>
          <h3>{t('pymol:settings_set_heading')}</h3>
          <p className="pymolv-dialog-note">{t('pymol:settings_set_note')}</p>
          <div className="form-group">
            <label htmlFor={nameId}>{t('pymol:settings_name')}</label>
            <input
              id={nameId}
              type="text"
              list={listId}
              value={name}
              spellCheck={false}
              autoComplete="off"
              onChange={e => setName(e.target.value)}
            />
            <datalist id={listId}>
              {rows?.map(r => (
                <option key={r[0]} value={r[0]} />
              ))}
            </datalist>
          </div>
          {known && (
            <dl className="pymolv-dialog-setting">
              <dt>{t('pymol:settings_type')}</dt>
              <dd>{known[1] || '—'}</dd>
              <dt>{t('pymol:settings_default')}</dt>
              <dd>{known[2] || '—'}</dd>
              <dt>{t('pymol:settings_help')}</dt>
              <dd>{known[3]}</dd>
            </dl>
          )}
          <div className="form-group">
            <label htmlFor={valueId}>{t('pymol:settings_value')}</label>
            <input
              id={valueId}
              type="text"
              value={value}
              spellCheck={false}
              autoComplete="off"
              onChange={e => setValue(e.target.value)}
              onKeyDown={e => {
                // 229: Chrome's keyCode for a key the IME took, for an engine without isComposing.
                if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) apply()
              }}
            />
          </div>
          <button type="button" className="btn btn-primary btn-sm" disabled={command === null} onClick={apply}>
            {t('pymol:settings_apply')}
          </button>
          <p role="status" className="pymolv-dialog-note">
            {message}
          </p>
        </section>
      </div>
    </Modal>
  )
}

export function PymolKeysDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('pymol')
  const titleId = useId()
  return (
    <Modal maxWidth={640} labelledBy={titleId} onClose={onClose}>
      <div className="pymolv-dialog">
        <div className="pymolv-dialog-head">
          <h2 id={titleId}>{t('pymol:keys_title')}</h2>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose} aria-label={t('pymol:dialog_close')}>
            ×
          </button>
        </div>
        <p className="pymolv-dialog-note">{t('pymol:keys_note')}</p>
        <table className="pymolv-dialog-table">
          <thead>
            <tr>
              <th scope="col">{t('pymol:keys_col_pymol')}</th>
              <th scope="col">{t('pymol:keys_col_here')}</th>
              <th scope="col">{t('pymol:keys_col_command')}</th>
            </tr>
          </thead>
          <tbody>
            {CHROME_RESERVED_SHORTCUTS.map(s => (
              <tr key={s.id}>
                <td>
                  <kbd>{s.chord}</kbd>
                </td>
                <td>
                  <kbd>{s.remapped}</kbd>
                </td>
                <td>
                  <code>{s.command}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <ul className="pymolv-dialog-list">
          <li>{t('pymol:keys_tab')}</li>
          <li>{t('pymol:keys_escape')}</li>
          <li>{t('pymol:keys_function')}</li>
        </ul>
      </div>
    </Modal>
  )
}
