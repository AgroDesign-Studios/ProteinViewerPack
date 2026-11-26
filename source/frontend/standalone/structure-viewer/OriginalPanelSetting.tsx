import { useId } from 'react'
import { useTranslation } from 'react-i18next'

import { ToggleSwitch } from '../../src/components/ToggleSwitch'
import { setOriginalPanel, useOriginalPanel } from './originalPanel'

/**
 * The switch for 「オリジナル表示」 (`originalPanel.ts`, owner 2026-11-20), with
 * what it does in this layout said under it: on a computer, in PyMOL's
 * settings dialog (Setting > すべての設定…, beside the display scale the pull to
 * zoom also sets); on a phone, at the head of the 「オブジェクト」 tab, whose
 * list it replaces with PyMOL's own panel.
 */
export function OriginalPanelSetting({ phone }: { phone: boolean }) {
  const { t } = useTranslation('htmlExport')
  const noteId = useId()
  const { original, saved } = useOriginalPanel()
  return (
    <div className="sav-original-setting">
      <ToggleSwitch checked={original} onChange={setOriginalPanel} label={t('htmlExport:sa_pymol_original_label')} describedBy={noteId} />
      <p id={noteId} className="sav-original-note">
        {t(phone ? 'htmlExport:sa_pymol_original_note_phone' : 'htmlExport:sa_pymol_original_note_pc')}
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
