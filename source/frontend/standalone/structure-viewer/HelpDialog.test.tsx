/**
 * The offline file's HELP (owner 2026-11-16): one dialog, three tabs —
 * 「このアプリについて｜使い方｜最新版ダウンロード」. HELP opens it on
 * 「使い方」, PyMOL's About on 「このアプリについて」, which was the licence
 * tab 「ライセンス表示」 (renamed and moved to the left, owner 2026-11-16):
 * the contents list, then 「このアプリ」 — its name and version, maker,
 * author and GitHub, its MIT licence and the packages it uses — then 3Dmol.js
 * under its 「Includes 3Dmol.js」 link and PyMOL under its notice and
 * repository link; the folded texts are one scroll, the body's; the × at the
 * top right closes it (owner 2026-11-15). The runtimes' texts may still be
 * read, or not readable (PT-9446 item 1). 「最新版ダウンロード」 asks GitHub
 * only when its button is pressed, and says what it found.
 */
import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { resetModalStackForTests } from '../../src/components/modalStack'
import { MOL3D_LICENSE_TITLE } from '../../src/components/Mol3dNotice'
import en from '../../src/i18n/locales/en/htmlExport.json'
import ja from '../../src/i18n/locales/ja/htmlExport.json'
import { PYMOL_RUNTIME_VERSION } from '../../src/pages/pymol-viewer/pymolRuntimeManifest'
import { AGROBOX_URL, APP_GITHUB_URL, APP_LICENCE_TEXT, APP_VERSION, COMPANY_SITE_URL } from './appLicence'
import { HelpDialog, type HelpTab } from './HelpDialog'
import { LatestPanel, type LatestChecker, type LatestState } from './LatestPanel'
import type { LatestCheck } from './latestRelease'
import { MOL3D_CITATION, MOL3D_CITATION_DOI, PYMOL_BUILT_VERSION, PYMOL_CITATION, type BundledLicence, type RuntimeLicence, type RuntimeLoad } from './LicenceDialog'

/** The licence and latest tabs' version row: 「ver <APP_VERSION>」, then the short commit when a build wrote one in. */
const VERSION_ROW = new RegExp(`^ver ${APP_VERSION.replace(/\./g, '\\.')}( \\([0-9a-f]{7,12}\\))?$`)

/** The head's rows (`AppAbout`) of a panel, each term with its value's text. */
function aboutRows(panel: HTMLElement): { about: HTMLElement; rows: (string | null | undefined)[][] } {
  const about = panel.querySelector('dl.sav-lic-about') as HTMLElement
  return { about, rows: Array.from(about.querySelectorAll('dt')).map(dt => [dt.textContent, dt.nextElementSibling?.textContent]) }
}

/** The maker's two links (owner 2026-11-19): the URL shown as it is, AgroBox® named before its own. */
function expectMakerLinks(rows: (string | null | undefined)[][], about: HTMLElement, releases = false): void {
  const site = rows.find(r => r[0] === 'htmlExport:sa_lic_company_site')
  const service = rows.find(r => r[0] === 'htmlExport:sa_lic_service')
  expect(site?.[1]).toMatch(/^https:\/\/www\.agrodesign\.co\.jp ↗/)
  expect(service?.[1]).toMatch(/^AgroBox® https:\/\/www\.agrobox\.jp\/ ↗/)
  const links = within(about).getAllByRole('link')
  // 「最新版ダウンロード」 alone has the releases page under the repository (owner 2026-11-20).
  expect(links.map(l => l.getAttribute('href'))).toEqual([COMPANY_SITE_URL, APP_GITHUB_URL, ...(releases ? [`${APP_GITHUB_URL}/releases`] : []), AGROBOX_URL])
  for (const l of links) {
    expect(l).toHaveAttribute('target', '_blank')
    expect(l).toHaveAttribute('rel', 'noopener noreferrer')
  }
  expect(within(about).getByText('AgroBox®')).toHaveAttribute('lang', 'en')
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, vars?: Record<string, unknown>) => (vars === undefined ? k : `${k} ${JSON.stringify(vars)}`), i18n: { language: 'ja' } }),
}))

/** The page's context (PT-9781): opened from a file on an iPhone or iPad, or not. */
const context = vi.hoisted(() => ({ fileOnIos: false }))
vi.mock('./fileOnIos', () => ({ isFileOnIos: () => context.fileOnIos }))

const RUNTIMES = [
  { title: MOL3D_LICENSE_TITLE, text: 'BSD-3-Clause text' },
  { title: 'Open-Source PyMOL', text: 'PyMOL text' },
]

const FULL_RUNTIMES = [
  { title: MOL3D_LICENSE_TITLE, text: '3Dmol BSD', group: '3dmol' as const },
  { title: 'pako 2.1.0 (MIT AND Zlib)', text: 'pako text', group: '3dmol' as const },
  { title: 'Open-Source PyMOL', text: 'PyMOL text', group: 'pymol' as const },
  { title: 'Open-Source PyMOL: third-party code inside it', text: 'pocketfft …', group: 'pymol' as const },
]

const REPO = 'https://github.com/AgroDesign-Studios/ProteinViewerPack'

const summaries = (dialog: HTMLElement) => Array.from(dialog.querySelectorAll('summary')).map(s => s.textContent)

function helpProps(opts: {
  tab?: HelpTab
  runtimes?: readonly RuntimeLicence[]
  load?: RuntimeLoad
  onRetry?: () => void
  bundled?: readonly BundledLicence[]
  full?: boolean
  onClose?: () => void
  checkLatest?: LatestChecker
}) {
  const { tab = 'licences', runtimes = FULL_RUNTIMES, load = 'ready', onRetry = () => undefined, bundled = [], full = true, onClose = () => undefined, checkLatest } = opts
  return { initialTab: tab, runtimes, runtimesLoad: load, onRetryRuntimes: onRetry, bundled, full, onClose, checkLatest }
}

function help(opts: Parameters<typeof helpProps>[0] = {}) {
  render(<HelpDialog {...helpProps(opts)} />)
  return screen.getByRole('dialog', { name: 'htmlExport:sa_help_title' })
}

afterEach(() => {
  vi.useRealTimers()
  context.fileOnIos = false
})

describe('HelpDialog: the tabs', () => {
  it('is four tabs, 「使い方｜最新版ダウンロード｜ライセンス表記｜改良点」, the one asked for chosen and the only one in the Tab order (owner 2026-11-18)', () => {
    const dialog = help({ tab: 'usage' })
    const list = within(dialog).getByRole('tablist', { name: 'htmlExport:sa_help_tabs' })
    const tabs = within(list).getAllByRole('tab')
    expect(tabs.map(t => t.textContent)).toEqual(['htmlExport:sa_help_tab_usage', 'htmlExport:sa_help_tab_latest', 'htmlExport:sa_help_tab_licences', 'htmlExport:sa_help_tab_changes'])
    expect(tabs.map(t => t.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false', 'false'])
    expect(tabs.map(t => t.tabIndex)).toEqual([0, -1, -1, -1])
    const panel = within(dialog).getByRole('tabpanel')
    expect(panel).toHaveAccessibleName('htmlExport:sa_help_tab_usage')
    expect(tabs[0]).toHaveAttribute('aria-controls', panel.id)
    // The sections of 「使い方」, the systems and browsers last (owner 2026-11-18); 「最新版ダウンロード」 is a tab (owner 2026-11-16).
    expect(within(panel).getAllByRole('heading', { level: 3 }).map(h => h.textContent)).toEqual([
      'htmlExport:sa_help_open_title',
      'htmlExport:sa_help_move_title',
      'htmlExport:sa_help_engines_title',
      'htmlExport:sa_help_save_title',
      'htmlExport:sa_help_offline_title',
      'htmlExport:sa_help_env_title',
    ])
    // At its head the rows the other tabs open with, links included (owner 2026-11-19: 他のページと同じ).
    const { about, rows } = aboutRows(panel)
    expect(panel.firstElementChild?.firstElementChild).toBe(about)
    expect(rows.map(r => r[0])).toEqual([
      'htmlExport:sa_lic_app_name',
      'htmlExport:sa_latest_version',
      'htmlExport:sa_lic_company',
      'htmlExport:sa_lic_company_site',
      'htmlExport:sa_lic_github',
      'htmlExport:sa_lic_service',
    ])
    expect(rows[0][1]).toBe('AgroDesign Protein Viewer Pack (HTMLapp)')
    expect(rows[1][1]).toMatch(VERSION_ROW)
    expect(rows[2][1]).toBe('htmlExport:sa_lic_company_value')
    expectMakerLinks(rows, about)
    expect(panel.querySelectorAll('dl.sav-lic-about')).toHaveLength(1)
  })

  it('opens on 「ライセンス表記」 when asked (PyMOL’s About)', () => {
    const dialog = help({ tab: 'licences' })
    expect(within(dialog).getByRole('tab', { name: 'htmlExport:sa_help_tab_licences' })).toHaveAttribute('aria-selected', 'true')
    expect(within(dialog).getByRole('tabpanel')).toHaveAccessibleName('htmlExport:sa_help_tab_licences')
  })

  it('moves between the four tabs with the arrows (wrapping), Home and End, choosing as it goes, and by a click', async () => {
    const user = userEvent.setup()
    const dialog = help({ tab: 'usage' })
    const [usage, latest, licences, changes] = within(dialog).getAllByRole('tab')
    usage.focus()
    await user.keyboard('{ArrowRight}')
    expect(latest).toHaveFocus()
    expect(latest).toHaveAttribute('aria-selected', 'true')
    expect(latest.tabIndex).toBe(0)
    expect(usage.tabIndex).toBe(-1)
    await user.keyboard('{ArrowRight}')
    expect(licences).toHaveFocus()
    await user.keyboard('{End}')
    expect(changes).toHaveFocus()
    await user.keyboard('{ArrowRight}')
    expect(usage).toHaveFocus()
    await user.keyboard('{ArrowLeft}')
    expect(changes).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{Home}')
    expect(usage).toHaveFocus()
    await user.click(changes)
    expect(within(dialog).getByRole('tabpanel')).toHaveAccessibleName('htmlExport:sa_help_tab_changes')
  })

  it('keeps the tabs out of the one scroll, which starts at the top again on another tab', async () => {
    const user = userEvent.setup()
    const dialog = help({ tab: 'licences' })
    const panel = within(dialog).getByRole('tabpanel')
    const scroller = panel.parentElement!
    expect(scroller).not.toContainElement(within(dialog).getByRole('tablist'))
    scroller.scrollTop = 300
    await user.click(within(dialog).getByRole('tab', { name: 'htmlExport:sa_help_tab_usage' }))
    expect(scroller.scrollTop).toBe(0)
  })

  it('says how to open, move, choose the engine, save and work offline; the light edition names no PyMOL file', () => {
    const full = help({ tab: 'usage' })
    expect(full).toHaveTextContent('htmlExport:sa_help_open_body_full')
    expect(full).toHaveTextContent('htmlExport:sa_help_engines_body_full')
    // Saving names 「画像出力」 and the PyMOL files (owner 2026-11-16).
    expect(full).toHaveTextContent(/htmlExport:sa_help_save_body$|htmlExport:sa_help_save_bodyhtmlExport/)
    // Offline names every connection: the PDB, the latest-version check, a link out.
    expect(full).toHaveTextContent('htmlExport:sa_help_offline_body')
    cleanup()
    resetModalStackForTests()
    const light = help({ tab: 'usage', full: false })
    expect(light).toHaveTextContent('htmlExport:sa_help_open_body_light')
    expect(light).toHaveTextContent('htmlExport:sa_help_engines_body_light')
    expect(light).toHaveTextContent('htmlExport:sa_help_save_body_light')
    expect(light).not.toHaveTextContent(/_full/)
  })

  it('lists the systems and browsers last, as a list; the full edition adds what "Includes PyMOL™" mode needs (owner 2026-11-18)', () => {
    const full = within(help({ tab: 'usage' })).getByRole('tabpanel')
    const section = within(full).getByRole('heading', { name: 'htmlExport:sa_help_env_title' }).parentElement as HTMLElement
    expect(within(section).getAllByRole('listitem').map(li => li.textContent)).toEqual([
      'htmlExport:sa_help_env_chrome',
      'htmlExport:sa_help_env_firefox',
      'htmlExport:sa_help_env_safari',
      'htmlExport:sa_help_env_ios',
    ])
    expect(section).toHaveTextContent('htmlExport:sa_help_env_pymol')
    expect(section).toHaveTextContent('htmlExport:sa_help_env_checked')
    cleanup()
    resetModalStackForTests()
    const light = within(help({ tab: 'usage', full: false })).getByRole('tabpanel')
    expect(light).not.toHaveTextContent('htmlExport:sa_help_env_pymol')
    expect(light).toHaveTextContent('htmlExport:sa_help_env_chrome')
  })

  it('says the minimum versions the README’s 動作環境 says (runbook standalone-viewer-pack-distribution §1.1), in both languages', () => {
    for (const words of [en, ja] as Record<string, string>[]) {
      expect(words.sa_help_env_chrome).toMatch(/Chrome.*Edge.*111/)
      expect(words.sa_help_env_firefox).toMatch(/Firefox.*121/)
      expect(words.sa_help_env_safari).toMatch(/Safari.*16\.4/)
      expect(words.sa_help_env_ios).toMatch(/16\.4/)
      expect(words.sa_help_env_pymol).toMatch(/WebGL2.*17/)
    }
  })

  it('opening and offline both say that a file opened on an iPhone or iPad may not be able to connect, and the way round (PT-9781)', () => {
    for (const key of ['sa_help_open_body_full', 'sa_help_open_body_light'] as const) {
      expect(en[key]).toMatch(/On iPhone and iPad, a page opened directly from a file .*may not be able to use the internet/)
      expect(en[key]).toMatch(/link that downloads the entry in the browser; then open the downloaded file with Open file\/PDB\.$/)
    }
    expect(en.sa_help_offline_body).toMatch(/On iPhone and iPad, a page opened directly from a file may not be able to connect at all, even when the browser can; viewing and opening files still work\.$/)
  })
})

/** A checker that answers when told to, and counts its calls. */
function deferredChecker() {
  let finish: (r: LatestCheck) => void = () => undefined
  const signals: AbortSignal[] = []
  const checker = vi.fn<LatestChecker>(
    signal =>
      new Promise<LatestCheck>(resolve => {
        signals.push(signal)
        finish = resolve
      }),
  )
  return { checker, signals, finish: (r: LatestCheck) => act(async () => finish(r)) }
}

describe('HelpDialog: 「最新版ダウンロード」 (owner 2026-11-16)', () => {
  it('names the app, the version in use, its maker and repository, and no edition (owner 2026-11-18); then 「未確認」, what pressing sends, the button and the releases page — and asks nothing on opening', () => {
    const { checker } = deferredChecker()
    const dialog = help({ tab: 'latest', checkLatest: checker })
    const panel = within(dialog).getByRole('tabpanel')
    expect(panel).toHaveAccessibleName('htmlExport:sa_help_tab_latest')
    // The app's name, as 「ライセンス表記」 gives it (owner 2026-11-17); no edition row (owner 2026-11-18).
    const { about, rows } = aboutRows(panel)
    expect(rows.map(r => r[0])).toEqual([
      'htmlExport:sa_lic_app_name',
      'htmlExport:sa_latest_version',
      'htmlExport:sa_lic_company',
      'htmlExport:sa_lic_company_site',
      'htmlExport:sa_lic_github',
      'htmlExport:sa_lic_service',
    ])
    expect(rows[0][1]).toBe('AgroDesign Protein Viewer Pack (HTMLapp)')
    expect(rows[1][1]).toMatch(VERSION_ROW)
    expect(rows[2][1]).toBe('htmlExport:sa_lic_company_value')
    expect(rows[4][1]).toMatch(new RegExp(`^${REPO.replace(/[.]/g, '\\.')} ↗`))
    // Under the repository: where the latest version is, with the releases page (owner 2026-11-20).
    expect(rows[4][1]).toContain('htmlExport:sa_about_github_note')
    expectMakerLinks(rows, about, true)
    expect(within(panel).getAllByRole('status')[0]).toHaveTextContent('htmlExport:sa_latest_unchecked')
    expect(panel).toHaveTextContent('htmlExport:sa_latest_note')
    const button = within(panel).getByRole('button', { name: 'htmlExport:sa_latest_check' })
    // The note comes before the button it describes.
    expect(panel.textContent!.indexOf('sa_latest_note')).toBeLessThan(panel.textContent!.indexOf('sa_latest_check'))
    expect(button).toBeEnabled()
    // No link but the head's four (the maker's site, GitHub, its releases page, AgroBox®).
    const links = within(panel).getAllByRole('link')
    expect(links).toHaveLength(4)
    expect(links[2]).toHaveTextContent('↗')
    expect(within(panel).queryByText('htmlExport:sa_latest_badge')).toBeNull()
    // No question until the press: not on opening the tab, not on a timer.
    expect(checker).not.toHaveBeenCalled()
  })

  it('asks once on the press, busy meanwhile, a second press doing nothing; the same version gets the 「✓ 最新版」 badge beside it', async () => {
    const user = userEvent.setup()
    const { checker, finish } = deferredChecker()
    const dialog = help({ tab: 'latest', checkLatest: checker })
    const panel = within(dialog).getByRole('tabpanel')
    const button = within(panel).getByRole('button', { name: 'htmlExport:sa_latest_check' })
    await user.click(button)
    expect(checker).toHaveBeenCalledOnce()
    expect(within(panel).getByRole('status')).toHaveTextContent('htmlExport:sa_latest_checking')
    expect(panel.querySelector('.sav-latest')).toHaveAttribute('aria-busy', 'true')
    expect(button).toHaveAttribute('aria-disabled', 'true')
    await user.click(button)
    expect(checker).toHaveBeenCalledOnce()
    await finish({ kind: 'same', latest: APP_VERSION })
    expect(panel.querySelector('.sav-latest')).toHaveAttribute('aria-busy', 'false')
    expect(within(panel).getByRole('status')).toHaveTextContent(`htmlExport:sa_latest_same {"latest":"${APP_VERSION}"}`)
    const badge = within(panel).getByText('htmlExport:sa_latest_badge', { exact: false })
    // A mark and a word, the shared success badge, next to the version and nowhere else.
    expect(badge).toHaveClass('badge', 'badge-success')
    expect(badge).toHaveTextContent('✓ htmlExport:sa_latest_badge')
    expect(badge.parentElement).toHaveTextContent(`ver ${APP_VERSION}`)
    expect(within(dialog).getByRole('tablist')).not.toHaveTextContent('✓')
  })

  it('keeps what it found across a tab change, and asks again only on another press', async () => {
    const user = userEvent.setup()
    const { checker, finish } = deferredChecker()
    const dialog = help({ tab: 'latest', checkLatest: checker })
    await user.click(within(dialog).getByRole('button', { name: 'htmlExport:sa_latest_check' }))
    await finish({ kind: 'not-found' })
    await user.click(within(dialog).getByRole('tab', { name: 'htmlExport:sa_help_tab_usage' }))
    await user.click(within(dialog).getByRole('tab', { name: 'htmlExport:sa_help_tab_latest' }))
    expect(within(dialog).getByRole('status')).toHaveTextContent('htmlExport:sa_latest_not_found')
    expect(checker).toHaveBeenCalledOnce()
    await user.click(within(dialog).getByRole('button', { name: 'htmlExport:sa_latest_check' }))
    expect(checker).toHaveBeenCalledTimes(2)
  })

  it('closing HELP stops the question', async () => {
    const user = userEvent.setup()
    const { checker, signals } = deferredChecker()
    const { unmount } = render(<HelpDialog {...helpProps({ tab: 'latest', checkLatest: checker })} />)
    await user.click(screen.getByRole('button', { name: 'htmlExport:sa_latest_check' }))
    expect(signals[0].aborted).toBe(false)
    unmount()
    expect(signals[0].aborted).toBe(true)
  })
})

describe('LatestPanel: what each answer says', () => {
  const show = (state: LatestState) => {
    render(<LatestPanel state={state} onCheck={() => undefined} githubUrl={REPO} />)
    return screen.getByRole('status')
  }

  it.each<[LatestCheck, string]>([
    [{ kind: 'ahead', latest: '0.9.0' }, 'htmlExport:sa_latest_ahead {"latest":"0.9.0"}'],
    [{ kind: 'not-found' }, 'htmlExport:sa_latest_not_found'],
    [{ kind: 'unreadable-tag', tag: 'nightly' }, 'htmlExport:sa_latest_unreadable {"tag":"nightly"}'],
    [{ kind: 'rate-limited' }, 'htmlExport:sa_latest_rate_limited'],
    [{ kind: 'http', status: 503 }, 'htmlExport:sa_latest_http {"status":503}'],
    [{ kind: 'bad-answer' }, 'htmlExport:sa_latest_bad'],
    [{ kind: 'network' }, 'htmlExport:sa_latest_network'],
    [{ kind: 'timeout' }, 'htmlExport:sa_latest_timeout {"seconds":"8"}'],
  ])('%o → its own words, no badge', (result, words) => {
    const status = show({ phase: 'done', result })
    expect(status).toHaveTextContent(words)
    expect(screen.queryByText('htmlExport:sa_latest_badge', { exact: false })).toBeNull()
    // The failures read as failures; the comparisons do not.
    const failed = ['rate-limited', 'http', 'bad-answer', 'network', 'timeout'].includes(result.kind)
    expect(status.classList.contains('is-error')).toBe(failed)
  })

  it('no connection from a file opened on an iPhone or iPad says why that is likely and points at the releases link below, which is there (PT-9781)', () => {
    context.fileOnIos = true
    const status = show({ phase: 'done', result: { kind: 'network' } })
    expect(status).toHaveTextContent('htmlExport:sa_latest_network_file_ios')
    expect(status.classList.contains('is-error')).toBe(true)
    // The link the words point at: below the status line, not inside it.
    expect(within(status).queryByRole('link')).toBeNull()
    expect(screen.getByRole('link', { name: /^htmlExport:sa_latest_releases/ })).toHaveAttribute('href', `${REPO}/releases`)
    // Any other answer reads as before.
    cleanup()
    expect(show({ phase: 'done', result: { kind: 'timeout' } })).toHaveTextContent('htmlExport:sa_latest_timeout')
  })

  it('a newer release says 「新しいバージョン X.Y.Z があります」 with a link to that release', () => {
    const url = `${REPO}/releases/tag/v1.2.0`
    const status = show({ phase: 'done', result: { kind: 'newer', latest: '1.2.0', url } })
    expect(status).toHaveTextContent('htmlExport:sa_latest_newer {"latest":"1.2.0"}')
    const link = within(status).getByRole('link')
    expect(link).toHaveAttribute('href', url)
    expect(link).toHaveAccessibleName(/^htmlExport:sa_latest_open_release/)
    expect(screen.queryByText('htmlExport:sa_latest_badge', { exact: false })).toBeNull()
  })

  it('with no repository URL there is no button and no link to GitHub (the maker’s two links stay, owner 2026-11-19)', () => {
    render(<LatestPanel state={{ phase: 'idle' }} onCheck={() => undefined} githubUrl="" />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getAllByRole('link').map(l => l.getAttribute('href'))).toEqual([COMPANY_SITE_URL, AGROBOX_URL])
    expect(screen.getByRole('status')).toHaveTextContent('htmlExport:sa_latest_unchecked')
  })
})

describe('HelpDialog: 「ライセンス表記」 (「このアプリについて」 until 2026-11-18)', () => {
  it('opens with the app’s name, the version in use, its maker, its author and its GitHub repository, as 「最新版ダウンロード」 gives them, and no edition (owner 2026-11-18)', () => {
    const dialog = help()
    const panel = within(dialog).getByRole('tabpanel')
    const { about, rows } = aboutRows(panel)
    expect(rows.map(r => r[0])).toEqual([
      'htmlExport:sa_lic_app_name',
      'htmlExport:sa_latest_version',
      'htmlExport:sa_lic_company',
      'htmlExport:sa_lic_company_site',
      'htmlExport:sa_lic_author',
      'htmlExport:sa_lic_github',
      'htmlExport:sa_lic_service',
    ])
    expect(rows[0][1]).toBe('AgroDesign Protein Viewer Pack (HTMLapp)')
    expect(rows[1][1]).toMatch(VERSION_ROW)
    expect(rows[2][1]).toBe('htmlExport:sa_lic_company_value')
    expect(rows[4][1]).toBe('htmlExport:sa_lic_author_value')
    expect(rows[5][1]).toMatch(new RegExp(`^${REPO.replace(/[.]/g, '\\.')} ↗`))
    expectMakerLinks(rows, about)
    expect(dialog).not.toHaveTextContent('〇')
    // At the very top, before the intro and the contents; once only.
    expect(panel.querySelectorAll('dl.sav-lic-about')).toHaveLength(1)
    expect(about.nextElementSibling).toHaveClass('sav-lic-intro')
    // 「このアプリ」 keeps its licence and packages, not the rows.
    const app = within(dialog).getByRole('heading', { level: 3, name: 'htmlExport:sa_lic_app' })
    expect(app.nextElementSibling).toHaveTextContent('htmlExport:sa_lic_app_note')
    expect(dialog).not.toHaveTextContent('htmlExport:sa_latest_edition')
    expect(dialog).not.toHaveTextContent('© 2026 AgroDesign Studios · MIT License')
  })

  it('links out six times only: the maker’s site, the app’s GitHub and AgroBox® in the head (owner 2026-11-19), 「Includes 3Dmol.js」 under 3Dmol.js’s heading, its paper’s DOI, PyMOL’s repository after its notice (owner 2026-11-16, 2026-11-17)', () => {
    const dialog = help()
    const all = within(dialog).getAllByRole('link')
    expect(all.map(l => l.getAttribute('href'))).toEqual([COMPANY_SITE_URL, REPO, AGROBOX_URL, 'https://3dmol.csb.pitt.edu/', MOL3D_CITATION_DOI, 'https://github.com/schrodinger/pymol-open-source'])
    // From AgroBox® (the head's last, expectMakerLinks pins the three) on: [1] 3Dmol.js, [2] its DOI, [3] PyMOL.
    const links = all.slice(2)
    for (const link of all) {
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
      expect(link).toHaveAccessibleName(/common:opens_in_new_tab/)
    }
    expect(links[1]).toHaveAccessibleName(/^htmlExport:sa_lic_includes_3dmol/)
    expect(links[2]).toHaveAccessibleName(/^doi:10\.1093\/bioinformatics\/btu829/)
    expect(links[3]).toHaveAccessibleName(/^htmlExport:sa_lic_pymol_github/)
    const dmolHead = within(dialog).getByRole('heading', { level: 3, name: 'htmlExport:sa_lic_3dmol' })
    expect(dmolHead.nextElementSibling).toContainElement(links[1])
    const notice = screen.getByTestId('pymol-notice')
    expect(notice.nextElementSibling).toContainElement(links[3])
    cleanup()
    resetModalStackForTests()
    // The light edition has no PyMOL, and so no PyMOL link.
    const light = help({ runtimes: RUNTIMES, full: false })
    expect(within(light).getAllByRole('link').map(l => l.getAttribute('href'))).toEqual([COMPANY_SITE_URL, REPO, AGROBOX_URL, 'https://3dmol.csb.pitt.edu/', MOL3D_CITATION_DOI])
  })

  it('is the one place: this app first, with its MIT licence and the packages it uses under it, then each engine’s code (owner 2026-11-16)', async () => {
    const bundled = [{ name: 'react', version: '19.0.0', license: 'MIT', text: 'react text', notices: [] }]
    const dialog = help({ bundled })
    const groups = screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent)
    expect(groups).toEqual(['htmlExport:sa_lic_app', 'htmlExport:sa_lic_3dmol', 'htmlExport:sa_lic_pymol'])
    // The packages are a part of 「このアプリ」, each under its own licence, not the app's MIT one.
    // (Then each engine's 「引用（Citation）」.)
    const subs = screen.getAllByRole('heading', { level: 4 })
    expect(subs.map(h => h.textContent)).toEqual(['htmlExport:sa_lic_bundled', 'htmlExport:sa_cite_heading', 'htmlExport:sa_cite_heading'])
    expect(subs[0].nextElementSibling).toHaveTextContent('htmlExport:sa_lic_bundled_note')
    // Each text folds under its name; a summary holds no heading.
    const items = summaries(dialog)
    expect(items[0]).toMatch(/MIT License/)
    expect(items.slice(1)).toEqual(['react 19.0.0 (MIT)', '3Dmol.js', 'pako 2.1.0 (MIT AND Zlib)', 'Open-Source PyMOL', 'Open-Source PyMOL: third-party code inside it'])
    expect(dialog.querySelector('summary h1, summary h2, summary h3, summary h4')).toBeNull()
    expect(dialog.querySelector('pre')?.textContent).toMatch(/Copyright \(c\) 2026 AgroDesign Studios/)
    expect(APP_LICENCE_TEXT).toMatch(/^MIT License/)
    // The contents list names the three groups, and jumps to one, focused.
    const toc = screen.getByRole('navigation', { name: 'htmlExport:sa_lic_toc' })
    expect(within(toc).getAllByRole('button').map(b => b.textContent)).toEqual(['htmlExport:sa_lic_app', 'htmlExport:sa_lic_3dmol', 'htmlExport:sa_lic_pymol'])
    await userEvent.setup().click(within(toc).getByRole('button', { name: 'htmlExport:sa_lic_pymol' }))
    expect(screen.getByRole('heading', { level: 3, name: 'htmlExport:sa_lic_pymol' })).toHaveFocus()
  })

  it('while the runtimes’ texts are read, says so and still draws both groups, the PyMOL™ notice and the links (PT-9446 item 1)', () => {
    const dialog = help({ runtimes: [], load: 'loading' })
    expect(within(dialog).getByRole('heading', { level: 3, name: 'htmlExport:sa_lic_pymol' })).toBeInTheDocument()
    expect(screen.getByTestId('pymol-notice')).toBeInTheDocument()
    expect(within(dialog).getAllByRole('link')).toHaveLength(6)
    expect(within(dialog).getAllByText('htmlExport:sa_lic_loading', { selector: '.sav-lic-load' })).toHaveLength(2)
    expect(within(dialog).getByRole('status')).toHaveTextContent('htmlExport:sa_lic_loading')
  })

  it('a failed read says so with Retry, which reads again (PT-9446 item 1)', async () => {
    const onRetry = vi.fn()
    const dialog = help({ runtimes: [], load: 'failed', onRetry })
    expect(within(dialog).getByRole('status')).toHaveTextContent('htmlExport:sa_lic_failed')
    const retries = within(dialog).getAllByRole('button', { name: 'htmlExport:sa_retry' })
    expect(retries).toHaveLength(2)
    await userEvent.setup().click(retries[0])
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('texts that arrive after 「すべて開く」 open too (PT-9446 item 1)', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<HelpDialog {...helpProps({ runtimes: [], load: 'loading' })} />)
    await user.click(screen.getByRole('button', { name: 'htmlExport:sa_lic_open_all' }))
    rerender(<HelpDialog {...helpProps({ runtimes: FULL_RUNTIMES, load: 'ready' })} />)
    const details = Array.from(document.querySelectorAll('details'))
    expect(details).toHaveLength(5)
    expect(details.every(d => d.open)).toBe(true)
    expect(screen.queryByText('htmlExport:sa_lic_loading', { selector: '.sav-lic-load' })).toBeNull()
  })

  it('closes by the × in its title bar; there is no 「構造に戻る」 (owner 2026-11-15)', async () => {
    const onClose = vi.fn()
    const dialog = help({ runtimes: RUNTIMES, full: false, onClose })
    expect(within(dialog).queryByRole('button', { name: 'htmlExport:sa_lic_back' })).toBeNull()
    const close = within(dialog).getByRole('button', { name: 'pymol:dialog_close' })
    // Top right: in the title bar, beside the title.
    expect(close.parentElement).toContainElement(screen.getByRole('heading', { level: 2, name: 'htmlExport:sa_help_title' }))
    await userEvent.setup().click(close)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('starts with every text closed; a name opens its whole text, several stay open, and one toggle opens or closes them all', async () => {
    const user = userEvent.setup()
    const dialog = help()
    const details = Array.from(dialog.querySelectorAll('details'))
    expect(details.length).toBe(5)
    expect(details.every(d => !d.open)).toBe(true)
    // No text has a scroll (or a tab stop) of its own: the dialog body is the one scroll.
    for (const pre of dialog.querySelectorAll('pre')) expect(pre).not.toHaveAttribute('tabindex')
    await user.click(within(dialog).getByText('Open-Source PyMOL', { selector: 'summary' }))
    await user.click(within(dialog).getByText('3Dmol.js', { selector: 'summary' }))
    expect(details.filter(d => d.open).map(d => d.querySelector('summary')?.textContent)).toEqual(['3Dmol.js', 'Open-Source PyMOL'])
    expect(within(dialog).getByText('PyMOL text')).toBeVisible()
    await user.click(within(dialog).getByRole('button', { name: 'htmlExport:sa_lic_open_all' }))
    expect(details.every(d => d.open)).toBe(true)
    await user.click(within(dialog).getByRole('button', { name: 'htmlExport:sa_lic_close_all' }))
    expect(details.every(d => !d.open)).toBe(true)
    expect(within(dialog).getByRole('button', { name: 'htmlExport:sa_lic_open_all' })).toBeInTheDocument()
  })

  it('cites 3Dmol.js under its link and PyMOL under its repository link, each as its makers ask, in English; the light edition cites no PyMOL (owner 2026-11-17)', () => {
    const dialog = help()
    const cites = Array.from(dialog.querySelectorAll<HTMLElement>('.sav-lic-cite'))
    expect(cites).toHaveLength(2)
    const [dmol, pymol] = cites
    // 3Dmol.js: the paper its README names, its DOI a link out.
    expect(dmol.previousElementSibling).toContainElement(within(dialog).getByRole('link', { name: /^htmlExport:sa_lic_includes_3dmol/ }))
    expect(dmol).toHaveTextContent('htmlExport:sa_cite_heading')
    expect(dmol).toHaveTextContent('htmlExport:sa_cite_3dmol_ask')
    const dmolQuote = dmol.querySelector('blockquote')
    expect(dmolQuote).toHaveTextContent(MOL3D_CITATION)
    // English marks the English words, not the quote: the DOI link's
    // 「新しいタブで開きます」 is in the app's language (PT-9650).
    expect(dmol.querySelector('[lang]')?.closest('blockquote')).toBe(dmolQuote)
    expect(Array.from(dmol.querySelectorAll('[lang="en"]')).map(e => e.textContent)).toEqual([MOL3D_CITATION, 'doi:10.1093/bioinformatics/btu829'])
    const sr = dmol.querySelector('.sr-only')
    expect(sr).toHaveTextContent('common:opens_in_new_tab')
    expect(sr?.closest('[lang]')).toBeNull()
    expect(MOL3D_CITATION).toBe('Nicholas Rego and David Koes, "3Dmol.js: molecular visualization with WebGL", Bioinformatics 31(8):1322–1324 (2015).')
    expect(within(dmol).getByRole('link')).toHaveAttribute('href', 'https://doi.org/10.1093/bioinformatics/btu829')
    expect(within(dmol).getByRole('link')).toHaveTextContent('↗')
    // PyMOL: pymol.org's form, word for word but for the version, which is the one built in.
    expect(pymol.previousElementSibling).toContainElement(within(dialog).getByRole('link', { name: /^htmlExport:sa_lic_pymol_github/ }))
    // The lead-in names no version ("Built using PyMOL™", owner 2026-11-17); the citation carries it.
    expect(pymol.querySelector('.sav-lic-note')).toHaveTextContent(/^htmlExport:sa_cite_pymol_ask$/)
    expect(pymol.querySelector('blockquote')).not.toHaveAttribute('lang')
    expect(pymol.querySelector('blockquote [lang="en"]')).toHaveTextContent(PYMOL_CITATION)
    expect(PYMOL_CITATION).toBe('The PyMOL Molecular Graphics System, Version 3.2, Schrödinger, LLC.')
    expect(within(pymol).queryByRole('link')).toBeNull()
    expect(PYMOL_RUNTIME_VERSION.startsWith(`${PYMOL_BUILT_VERSION}-`)).toBe(true)
    expect(PYMOL_CITATION).toContain(`Version ${PYMOL_BUILT_VERSION.split('.').slice(0, 2).join('.')},`)
    cleanup()
    resetModalStackForTests()
    const light = help({ runtimes: RUNTIMES, full: false })
    expect(light.querySelectorAll('.sav-lic-cite')).toHaveLength(1)
    expect(light).not.toHaveTextContent('htmlExport:sa_cite_pymol_ask')
    expect(light).not.toHaveTextContent(PYMOL_CITATION)
  })

  it('keeps the PyMOL™ notice unfolded, and an entry with no text is a plain line', () => {
    const bundled = [
      { name: 'bare', version: '1.0.0', license: 'MIT', text: '', notices: [] },
      { name: 'noted', version: '2.0.0', license: '', text: '', notices: ['NOTICE text'] },
    ]
    const dialog = help({ bundled })
    expect(screen.getByTestId('pymol-notice').closest('details')).toBeNull()
    expect(within(dialog).getByText('bare 1.0.0 (MIT)').closest('details')).toBeNull()
    expect(within(dialog).getByText('noted 2.0.0', { selector: 'summary' })).toBeInTheDocument()
  })

  it('the light edition lists no PyMOL group; an entry with no group is placed by its title', () => {
    const dialog = help({ runtimes: RUNTIMES, full: false })
    expect(screen.queryByRole('heading', { level: 3, name: 'htmlExport:sa_lic_pymol' })).toBeNull()
    expect(summaries(dialog)).toContain('3Dmol.js')
  })

  it('opens at the top without a name', async () => {
    help({ runtimes: RUNTIMES, full: false })
    await new Promise(r => setTimeout(r, 30))
    expect(document.activeElement).not.toBe(screen.getByText('BSD-3-Clause text'))
  })
})
