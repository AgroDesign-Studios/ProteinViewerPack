import { useId } from 'react'
import { useTranslation } from 'react-i18next'

import { ToggleSwitch } from '../../src/components/ToggleSwitch'
import { setTouchOriginal, useTouchOriginal } from './touchControls'

/**
 * The switch for the Light viewer's touch controls (owner 2026-11-17; UI
 * consult, Opus + Codex astra: in the phone's 「表示」 sheet while 3Dmol.js is
 * shown, and in HELP 「使い方」, where a touch-screen PC reaches it too). One
 * side, off by default: 「3Dmol.js オリジナルの操作を使う」. The line under
 * it says what the fingers do now, so off never reads as "no touch".
 */
export function TouchControlsSetting({ heading = false }: { heading?: boolean }) {
  const { t } = useTranslation('htmlExport')
  const noteId = useId()
  const { original, saved } = useTouchOriginal()
  return (
    <div className="sav-touch-setting">
      {heading && <h4 className="sav-touch-heading">{t('htmlExport:sa_touch_heading')}</h4>}
      <ToggleSwitch checked={original} onChange={setTouchOriginal} label={t('htmlExport:sa_touch_original')} describedBy={noteId} />
      <p id={noteId} className="sav-touch-note">
        {original ? t('htmlExport:sa_touch_note_original') : t('htmlExport:sa_touch_note_default')}
        {!saved && (
          <>
            {' '}
            {t('htmlExport:sa_touch_not_saved')}
          </>
        )}
      </p>
    </div>
  )
}
