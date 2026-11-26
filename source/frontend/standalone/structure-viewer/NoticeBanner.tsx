import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { readFlag, writeFlag } from './storedFlag'

/** Where 「次から表示しない」 is kept (this browser only). */
export const NOTICE_HIDDEN_KEY = 'agroDesign.proteinViewerPack.noticeHidden'

/** Was the notice turned off in this browser? Storage may be refused (a private window, file:// in some browsers): then no. */
export function noticeHidden(): boolean {
  return readFlag(NOTICE_HIDDEN_KEY)
}

/** Not kept where storage is refused: it shows again at the next visit. */
function hideForGood(): void {
  writeFlag(NOTICE_HIDDEN_KEY)
}

/**
 * The note the app opens with (owner 2026-11-15): that the whole app is in
 * this one HTML file, and that Export makes a copy with a structure in it to
 * send by email, which opens in a phone's or a computer's browser with
 * nothing to install. A banner under the header, never a modal over the
 * view (both UI consultants): × closes it for this visit, 「次から表示しない」
 * also for later visits in this browser (kept in localStorage when the
 * browser allows it).
 */
export function NoticeBanner(props: {
  /** Where the focus goes once the banner is gone (its buttons go with it). */
  afterClose?: () => void
  /**
   * Waits, still open, while the first-run guide is up (owner 2026-11-19; UI
   * consult, Codex astra: one thing at a time for a first visit).
   */
  held?: boolean
}) {
  const { afterClose, held = false } = props
  const { t } = useTranslation(['htmlExport'])
  const [open, setOpen] = useState(() => !noticeHidden())
  const close = () => {
    setOpen(false)
    afterClose?.()
  }
  if (!open || held) return null
  return (
    <aside className="sav-notice" aria-label={t('htmlExport:sa_notice_label')}>
      <p className="sav-notice-text">
        {t('htmlExport:sa_notice_text')} <span className="sav-notice-sign">AgroDesign Studios</span>
      </p>
      <div className="sav-notice-actions">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => {
            hideForGood()
            close()
          }}
        >
          {t('htmlExport:sa_notice_hide')}
        </button>
        <button type="button" className="sav-notice-close" aria-label={t('htmlExport:sa_notice_close')} title={t('htmlExport:sa_notice_close')} onClick={close}>
          <span aria-hidden="true">×</span>
        </button>
      </div>
    </aside>
  )
}
