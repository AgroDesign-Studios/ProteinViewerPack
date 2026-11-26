import { useId, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import './packFileName.css'

/**
 * The HTMLapp file's name field (owner 2026-11-16), one shape wherever the
 * file is saved: the whole name up
 * to `.html` is editable, `.html` is fixed beside it, and a small
 * 「デフォルト名」 button puts the default name back (for a name changed past
 * recognising) and moves the focus into the field. The caller keeps the
 * value and says the reset in its own status region (`onDefault`). Under it,
 * one line: a phone's system may rename the file as it saves it (the save is
 * a download; the page cannot ask for a name there).
 *
 * At a phone's width the field takes the whole row and `.html` and the
 * button wrap below it (packFileName.css).
 */
export function PackFileNameField(props: {
  label: string
  value: string
  disabled?: boolean
  onChange: (value: string) => void
  /** Put the default name back; the field takes the focus after it. */
  onDefault: () => void
}) {
  const { label, value, disabled = false, onChange, onDefault } = props
  const { t } = useTranslation('htmlExport')
  const id = useId()
  const noteId = useId()
  const input = useRef<HTMLInputElement>(null)
  return (
    <div className="form-group pack-name">
      <label htmlFor={id}>{label}</label>
      <div className="pymolv-name-row pack-name-row">
        <input
          ref={input}
          id={id}
          type="text"
          value={value}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          aria-describedby={noteId}
          onChange={e => onChange(e.target.value)}
        />
        <span className="pack-name-tail">
          <code>.html</code>
          <button
            type="button"
            className="btn btn-secondary btn-sm pack-name-default"
            aria-label={t('htmlExport:file_default_aria')}
            disabled={disabled}
            onClick={() => {
              onDefault()
              input.current?.focus()
            }}
          >
            {t('htmlExport:file_default')}
          </button>
        </span>
      </div>
      <p id={noteId} className="pymolv-dialog-note pack-name-note">
        {t('htmlExport:file_phone_note')}
      </p>
    </div>
  )
}
