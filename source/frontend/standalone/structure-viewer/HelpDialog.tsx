import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { DialogBody, DialogTitleBar } from '../../src/components/DialogBars'
import Modal from '../../src/components/Modal'
import { HelpChanges } from './HelpChanges'
import { LatestPanel, useLatestCheck, type LatestChecker } from './LatestPanel'
import { editionOf, movesOf, useLatestUpdate, type CopySource } from './latestUpdate'
import { AppAbout, LicenceContent, type BundledLicence, type RuntimeLicence, type RuntimeLoad } from './LicenceDialog'
import { TouchControlsSetting } from './TouchControlsSetting'

/**
 * HELP's four tabs, left to right: how to use it, its latest version, the
 * licences (with the app's name, version and maker at their head) and the
 * code changes (owner 2026-11-18: 『このアプリについて』は『ライセンス表記』に変えて
 * 一番右に; その右に『改良点』).
 */
export type HelpTab = 'usage' | 'latest' | 'licences' | 'changes'

const TABS: readonly HelpTab[] = ['usage', 'latest', 'licences', 'changes']
const TAB_LABEL: Readonly<Record<HelpTab, string>> = {
  usage: 'htmlExport:sa_help_tab_usage',
  latest: 'htmlExport:sa_help_tab_latest',
  licences: 'htmlExport:sa_help_tab_licences',
  changes: 'htmlExport:sa_help_tab_changes',
}

/** 「対応 OS とブラウザ」's lines (README § 動作環境; runbook standalone-viewer-pack-distribution §1.1 has where the numbers come from). */
const ENV_LINES: readonly string[] = ['htmlExport:sa_help_env_chrome', 'htmlExport:sa_help_env_firefox', 'htmlExport:sa_help_env_safari', 'htmlExport:sa_help_env_ios']

/**
 * 「使い方」: six short sections — opening, moving the view, the two modes,
 * saving, working offline (owner 2026-11-16; the app had no usage text) and,
 * last, the systems and browsers it runs on (owner 2026-11-18: 対応OSとブラウ
 * ザ; UI consult: a list, not a table, at a phone's width), the full edition
 * adding what "Includes PyMOL™" mode needs besides.
 * 「最新版ダウンロード」, its last section until now, is a tab of its own
 * (owner 2026-11-16). Offline's text names every connection the file makes:
 * the PDB download, the latest-version check and a link out. The light
 * edition's text names no PyMOL file and says PyMOL is the full edition's.
 * Saving names 「画像出力」 for the pictures and 「エクスポート」 for the
 * files (owner 2026-11-16). At its head the app's name, version in use,
 * maker and links, the rows the other tabs open with (`AppAbout`, owner
 * 2026-11-19).
 */
export function HelpUsage({ full }: { full: boolean }) {
  const { t } = useTranslation('htmlExport')
  const sections: readonly { title: string; body: string }[] = [
    { title: t('htmlExport:sa_help_open_title'), body: full ? t('htmlExport:sa_help_open_body_full') : t('htmlExport:sa_help_open_body_light') },
    { title: t('htmlExport:sa_help_move_title'), body: t('htmlExport:sa_help_move_body') },
    { title: t('htmlExport:sa_help_engines_title'), body: full ? t('htmlExport:sa_help_engines_body_full') : t('htmlExport:sa_help_engines_body_light') },
    { title: t('htmlExport:sa_help_save_title'), body: full ? t('htmlExport:sa_help_save_body') : t('htmlExport:sa_help_save_body_light') },
    { title: t('htmlExport:sa_help_offline_title'), body: t('htmlExport:sa_help_offline_body') },
  ]
  return (
    <div className="sav-help-usage">
      {/* The app's facts first, as the other tabs have them (owner 2026-11-19: 他のページと同じ). */}
      <AppAbout />
      {sections.map((s, i) => (
        <section key={s.title}>
          <h3>{s.title}</h3>
          <p>{s.body}</p>
          {/* The Light viewer's touch controls (owner 2026-11-17): here a touch-screen PC reaches the switch too. */}
          {i === 1 && <TouchControlsSetting heading />}
        </section>
      ))}
      <section>
        <h3>{t('htmlExport:sa_help_env_title')}</h3>
        <ul className="sav-help-env">
          {ENV_LINES.map(k => (
            <li key={k}>{t(k)}</li>
          ))}
        </ul>
        {full && <p>{t('htmlExport:sa_help_env_pymol')}</p>}
        <p className="sav-help-env-note">{t('htmlExport:sa_help_env_checked')}</p>
      </section>
    </div>
  )
}

/**
 * The header's HELP (owner 2026-11-16): one dialog with four tabs,
 * 「使い方｜最新版ダウンロード｜ライセンス表記｜改良点」 (owner 2026-11-18). The
 * HELP button opens it on 「使い方」 (`initialTab`). 「最新版ダウンロード」
 * compares this file with GitHub's latest release, only when its button is
 * pressed (`LatestPanel`); what it found lives while the dialog is open, so a
 * tab change keeps it — and so does the latest version made with this page's
 * data (`copy`, owner 2026-11-17), which closing the dialog stops and drops.
 * 「ライセンス表記」 is the app's name, version in use, maker, author and
 * GitHub, then every licence (PyMOL's About opens HELP on it); 「改良点」 what
 * the engines are and the link to this version's document of how they differ
 * from upstream on GitHub (`HelpChanges`, owner 2026-11-20).
 *
 * A flush Modal with the × at the top right (Esc closes it too; the focus
 * goes back to what opened it). The tabs stay put under the title bar and
 * only the panel scrolls, one scroll, back at the top when the tab changes.
 * The tabs are the ARIA pattern: a tablist of four tabs, the chosen one
 * `aria-selected` and the only one in the Tab order; the arrow keys, Home and
 * End move between them and choose as they go.
 */
export function HelpDialog(props: {
  initialTab: HelpTab
  runtimes: readonly RuntimeLicence[]
  /** Whether the runtimes' licences are read yet (PT-9446 item 1). */
  runtimesLoad: RuntimeLoad
  /** Reads them again after a failed read. */
  onRetryRuntimes: () => void
  bundled: readonly BundledLicence[]
  full: boolean
  onClose: () => void
  /** The latest-version question: tests hand in their own, the file asks GitHub. */
  checkLatest?: LatestChecker
  /** This page's data, for the latest version made with it; none, no such offer. */
  copy?: CopySource | null
  /** The latest version's download (tests hand in their own). */
  fetchLatest?: (url: string, init: RequestInit) => Promise<Response>
  /** The release-signing public key the files are checked with (tests hand in their own). */
  releaseKey?: string
}) {
  const { initialTab, runtimes, runtimesLoad, onRetryRuntimes, bundled, full, onClose, checkLatest, copy = null, fetchLatest, releaseKey } = props
  const { t } = useTranslation(['htmlExport', 'pymol'])
  const titleId = useId()
  const base = useId()
  const [tab, setTab] = useState<HelpTab>(initialTab)
  const tabRefs = useRef<Partial<Record<HelpTab, HTMLButtonElement | null>>>({})
  const panelRef = useRef<HTMLDivElement | null>(null)
  const firstTab = useRef(true)
  const latest = useLatestCheck(checkLatest)
  const update = useLatestUpdate(copy, { fetchImpl: fetchLatest, publicKey: releaseKey })
  // Another tab starts at its top: the body is the one scroll both share.
  useEffect(() => {
    if (firstTab.current) {
      firstTab.current = false
      return
    }
    const scroller = panelRef.current?.parentElement
    if (scroller) scroller.scrollTop = 0
  }, [tab])
  const choose = (next: HelpTab) => {
    setTab(next)
    tabRefs.current[next]?.focus()
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const at = TABS.indexOf(tab)
    const to =
      e.key === 'ArrowRight' ? TABS[(at + 1) % TABS.length] : e.key === 'ArrowLeft' ? TABS[(at - 1 + TABS.length) % TABS.length] : e.key === 'Home' ? TABS[0] : e.key === 'End' ? TABS[TABS.length - 1] : null
    if (to === null) return
    e.preventDefault()
    choose(to)
  }
  const tabId = (id: HelpTab) => `${base}-tab-${id}`
  const panelId = `${base}-panel`
  return (
    <Modal maxWidth={860} flush labelledBy={titleId} onClose={onClose}>
      <div className="sav-lic sav-help">
        <DialogTitleBar
          title={<h2 id={titleId}>{t('htmlExport:sa_help_title')}</h2>}
          background="var(--blue-text)"
          onClose={onClose}
          closeLabel={t('pymol:dialog_close')}
        />
        <div role="tablist" aria-label={t('htmlExport:sa_help_tabs')} className="sav-help-tabs" onKeyDown={onKeyDown}>
          {TABS.map(id => (
            <button
              key={id}
              ref={el => {
                tabRefs.current[id] = el
              }}
              type="button"
              role="tab"
              id={tabId(id)}
              className="sav-help-tab"
              aria-selected={tab === id}
              aria-controls={panelId}
              tabIndex={tab === id ? 0 : -1}
              onClick={() => choose(id)}
            >
              {t(TAB_LABEL[id])}
            </button>
          ))}
        </div>
        <DialogBody>
          <div ref={panelRef} role="tabpanel" id={panelId} aria-labelledby={tabId(tab)} tabIndex={0} className="sav-help-panel">
            {tab === 'licences' ? (
              <LicenceContent runtimes={runtimes} runtimesLoad={runtimesLoad} onRetryRuntimes={onRetryRuntimes} bundled={bundled} full={full} />
            ) : tab === 'changes' ? (
              <HelpChanges full={full} />
            ) : tab === 'usage' ? (
              <HelpUsage full={full} />
            ) : (
              <LatestPanel
                state={latest.state}
                onCheck={latest.check}
                edition={copy !== null ? editionOf(copy.config) : full ? 'full' : 'light'}
                update={copy !== null ? update : null}
                moves={copy !== null ? movesOf(copy) : null}
              />
            )}
          </div>
        </DialogBody>
      </div>
    </Modal>
  )
}
