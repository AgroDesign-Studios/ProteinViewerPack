import { useId } from 'react'
import { useTranslation } from 'react-i18next'

import Modal from '../../components/Modal'
import { PymolNotice } from '../../components/PymolNotice'

/**
 * 「このソフトについて…」 (Help menu): the PyMOL™ trademark and provenance
 * notice, with the way to the licences. Without `onLicences` that is a link to
 * the licence page, in a new tab (a same-tab move would end this tab's unsaved
 * PyMOL work), and the link says so (PT-9103 item 8); with it, the entry calls
 * `onLicences` instead. Between the two, the features this browser build does
 * not have.
 */
export function PymolAboutDialog({ onClose, onLicences }: { onClose: () => void; onLicences?: () => void }) {
  // Both namespaces it reads, so neither depends on another screen having loaded it (PT-9102 item 6).
  const { t } = useTranslation(['pymolNotice', 'pymol', 'common'])
  const titleId = useId()
  return (
    <Modal maxWidth={520} labelledBy={titleId} onClose={onClose}>
      <div className="pymolv-dialog">
        <div className="pymolv-dialog-head">
          <h2 id={titleId}>{t('pymolNotice:about_title')}</h2>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose} aria-label={t('pymol:dialog_close')}>
            ×
          </button>
        </div>
        <PymolNotice variant="compact" />
        {/* The short list of what the menus leave out (`ABSENT_MENU_PATHS` in pymolMenuData.ts), one line per
            kind, so a desktop PyMOL user knows it is missing on purpose (owner ruling 2026-11-17, PT-9554 S2). */}
        <section>
          <h3>{t('pymolNotice:about_absent_title')}</h3>
          <ul className="pymolv-dialog-list">
            <li>{t('pymolNotice:about_absent_demo')}</li>
            <li>{t('pymolNotice:about_absent_stereo')}</li>
            <li>{t('pymolNotice:about_absent_antialias')}</li>
            <li>{t('pymolNotice:about_absent_volume')}</li>
            <li>{t('pymolNotice:about_absent_fonts')}</li>
          </ul>
        </section>
        <p className="pymolv-dialog-note">
          {onLicences !== undefined ? (
            <button type="button" className="btn btn-secondary btn-sm" onClick={onLicences}>
              {t('pymolNotice:about_licenses_link')}
            </button>
          ) : (
            <a href="/help/third-party" target="_blank" rel="noopener noreferrer">
              {t('pymolNotice:about_licenses_link')} <span aria-hidden="true">↗</span>
              <span className="sr-only"> {t('common:opens_in_new_tab')}</span>
            </a>
          )}
        </p>
      </div>
    </Modal>
  )
}
