import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { MOL3D_LICENSE_TITLE } from '../../src/components/Mol3dNotice'
import { PymolNotice } from '../../src/components/PymolNotice'
import { AGROBOX_NAME, AGROBOX_URL, APP_GITHUB_URL, APP_LICENCE_NAME, APP_LICENCE_TEXT, APP_LICENCE_TITLE, COMPANY_SITE_URL, appVersionText } from './appLicence'

/** One bundled package's licence, as vite-plugins/gantt-licenses.ts writes it. */
export interface BundledLicence {
  name: string
  version: string
  license: string
  text: string
  notices: string[]
}

/** One embedded runtime's licence, as the `licenses` block carries it (`LicenceEntry` in standaloneFormat.ts). */
export interface RuntimeLicence {
  title: string
  text: string
  /**
   * The engine whose code it is; absent in a file from before 2026-11-15
   * (3Dmol.js by its title, the rest PyMOL's). `pymol-change` is a source
   * patch of the runtime's PyMOL that a file of v1.0.4 or before carries for
   * its 「改良点」 (now CODE-CHANGES.md on GitHub), never listed as a licence.
   */
  group?: '3dmol' | 'pymol' | 'pymol-change'
}

/** 3Dmol.js's own site: the toolbar's 「Includes 3Dmol.js」 link, moved here (owner 2026-11-16). */
export const MOL3D_SITE = 'https://3dmol.csb.pitt.edu/'

/** Open-source PyMOL's repository (owner 2026-11-16). */
export const PYMOL_SITE = 'https://github.com/schrodinger/pymol-open-source'

/**
 * The paper 3Dmol.js's README asks users to cite (owner 2026-11-17: 引用も書く),
 * as https://github.com/3dmol/3Dmol.js and Crossref give it. Always English.
 */
export const MOL3D_CITATION = 'Nicholas Rego and David Koes, "3Dmol.js: molecular visualization with WebGL", Bioinformatics 31(8):1322–1324 (2015).'
export const MOL3D_CITATION_DOI = 'https://doi.org/10.1093/bioinformatics/btu829'

/**
 * The version "Includes PyMOL™" mode is built from (pymol-open-source edcda80f,
 * `PYMOL_RUNTIME_VERSION` 3.2.0a; a test keeps the two in step). Shown only
 * through `PYMOL_CITATION`'s "Version 3.2": the lead-in says "Built using
 * PyMOL™", one of the licence's four forms, with no version (owner 2026-11-17).
 */
export const PYMOL_BUILT_VERSION = '3.2.0a'

/**
 * PyMOL's citation in the form pymol.org asks for (support.html#citing:
 * "Be sure to edit the version number in accordance with your usage"),
 * word for word with the version edited. A citation of Schrödinger's
 * product, not a name for this app, so it stays outside the four slogans
 * the PyMOL trademark notice allows. Always English.
 */
export const PYMOL_CITATION = 'The PyMOL Molecular Graphics System, Version 3.2, Schrödinger, LLC.'

/**
 * A group's 「引用（Citation）」: who asks for it, then the citation itself
 * (English) and, where there is one, its DOI. `lang="en"` marks the English
 * words only, not the quote, because the DOI's `OutLink` adds its 「新しいタブで
 * 開きます」 in the app's language (PT-9650).
 */
function Citation({ ask, text, doi }: { ask: string; text: string; doi?: string }) {
  const { t } = useTranslation(['htmlExport'])
  return (
    <div className="sav-lic-cite">
      <h4 className="sav-lic-sub">{t('htmlExport:sa_cite_heading')}</h4>
      <p className="sav-lic-note">{ask}</p>
      <blockquote className="sav-lic-cite-text">
        <p>
          <span lang="en">{text}</span>
          {doi !== undefined && (
            <>
              {' '}
              <OutLink href={doi}>
                <span lang="en">{doi.replace('https://doi.org/', 'doi:')}</span>
              </OutLink>
            </>
          )}
        </p>
      </blockquote>
    </div>
  )
}

/** Whether the runtimes' licences are read yet: they come from the `licenses` block, read when HELP first opens. */
export type RuntimeLoad = 'loading' | 'failed' | 'ready'

/**
 * One 「すべて開く／すべて閉じる」 over the `<details>` under `ref` that match
 * `selector`: `allOpen` follows them as they are opened one by one (their
 * `onToggle`), and those that arrive later (`arrived` changes) open too while
 * all are open (PT-9446 item 1). The licence tab and 「改良点」 share it.
 */
export function useOpenAll(arrived: unknown, selector = 'details') {
  const ref = useRef<HTMLDivElement | null>(null)
  // Every text open: the one toggle then closes them all.
  const [allOpen, setAllOpen] = useState(false)
  const allOpenRef = useRef(false)
  allOpenRef.current = allOpen
  const texts = () => Array.from(ref.current?.querySelectorAll<HTMLDetailsElement>(selector) ?? [])
  /** A text opened or closed (its summary, find-in-page, the toggle): the toggle's word follows. */
  const onToggle = () => {
    const all = texts()
    setAllOpen(all.length > 0 && all.every(d => d.open))
  }
  const toggleAll = () => {
    const next = !allOpen
    for (const d of texts()) d.open = next
    setAllOpen(next)
  }
  useLayoutEffect(() => {
    if (!allOpenRef.current) return
    for (const d of texts()) d.open = true
    // `texts` reads the ref at call time; `arrived` is the only change that matters.
  }, [arrived])
  return { ref, allOpen, onToggle, toggleAll }
}

const groupOf = (l: RuntimeLicence): NonNullable<RuntimeLicence['group']> => l.group ?? (l.title === MOL3D_LICENSE_TITLE ? '3dmol' : 'pymol')

/** A link out of the file, said to open in a new tab (HELP's 「最新版ダウンロード」 too). */
export function OutLink({ href, children }: { href: string; children: ReactNode }) {
  const { t } = useTranslation('common')
  return (
    <a className="sav-link" href={href} target="_blank" rel="noopener noreferrer">
      {children} <span aria-hidden="true">↗</span>
      <span className="sr-only">{t('common:opens_in_new_tab')}</span>
    </a>
  )
}

/**
 * The app's name, the version in use, its maker and repository as a list of
 * terms over their values: the head of 「最新版ダウンロード」 (owner 2026-11-17:
 * アプリ名などが記載されてない) and, the same rows, the head of 「ライセンス表記」
 * (owner 2026-11-18: 『最新版ダウンロード』に書いてあるアプリ名、使用中の版、制作会社を
 * 上の方にも). The version has a row of its own, `versionNote` beside it (the
 * 「最新版」 badge); `author` adds the author's row (the licence tab). No
 * edition row (owner 2026-11-18: エディションは不要).
 *
 * The maker's website under its name, and last, after the app's own facts,
 * its protein structure analysis service (owner 2026-11-19: 「リンク付きで適切な
 * 場所に掲示」). Each URL is shown as it is, as GitHub's is, so a reader
 * offline or looking at a screenshot still sees where it goes (the UI
 * consult: Opus and Codex astra, Opus's rows taken). The same rows head
 * 「使い方」 too (owner 2026-11-19: 他のページと同じ).
 */
export function AppAbout({
  versionNote,
  author = false,
  githubUrl = APP_GITHUB_URL,
  githubNote,
}: {
  versionNote?: ReactNode
  author?: boolean
  githubUrl?: string
  /** Said under the repository's URL (the 「最新版ダウンロード」 tab's where to get it, owner 2026-11-20); the other tabs pass none. */
  githubNote?: ReactNode
}) {
  const { t } = useTranslation(['htmlExport'])
  return (
    <dl className="sav-lic-about">
      <div>
        <dt>{t('htmlExport:sa_lic_app_name')}</dt>
        <dd>{APP_LICENCE_TITLE}</dd>
      </div>
      <div>
        <dt>{t('htmlExport:sa_latest_version')}</dt>
        <dd className="sav-latest-version">
          <strong>{appVersionText()}</strong>
          {versionNote}
        </dd>
      </div>
      <div>
        <dt>{t('htmlExport:sa_lic_company')}</dt>
        <dd>{t('htmlExport:sa_lic_company_value')}</dd>
      </div>
      <div>
        <dt>{t('htmlExport:sa_lic_company_site')}</dt>
        <dd>
          <OutLink href={COMPANY_SITE_URL}>{COMPANY_SITE_URL}</OutLink>
        </dd>
      </div>
      {author && (
        <div>
          <dt>{t('htmlExport:sa_lic_author')}</dt>
          <dd>{t('htmlExport:sa_lic_author_value')}</dd>
        </div>
      )}
      {/* The repository (owner 2026-11-16); no row where `APP_GITHUB_URL` is empty. */}
      {githubUrl !== '' && (
        <div>
          <dt>{t('htmlExport:sa_lic_github')}</dt>
          <dd>
            <OutLink href={githubUrl}>{githubUrl}</OutLink>
            {githubNote !== undefined && <span className="sav-lic-github-note">{githubNote}</span>}
          </dd>
        </div>
      )}
      <div>
        <dt>{t('htmlExport:sa_lic_service')}</dt>
        <dd>
          <OutLink href={AGROBOX_URL}>
            <span lang="en">{AGROBOX_NAME}</span> {AGROBOX_URL}
          </OutLink>
        </dd>
      </div>
    </dl>
  )
}

/**
 * The file's one place for licences and trademarks (owner 2026-11-15:
 * ライセンス表記は1ヶ所にまとめて), HELP's 「ライセンス表記」 tab (owner 2026-11-18;
 * 「このアプリについて」 2026-11-16 to 18, 「ライセンス表示」 before; `HelpDialog`):
 * PyMOL's About and HELP open it. At its head the app's name, the version in
 * use, its maker, its author and — once there is one, `APP_GITHUB_URL` — its
 * public repository (`AppAbout`, owner 2026-11-18: 上の方にも), then a
 * contents list, then the texts by whose code they are, nested so a reader
 * sees why each one is there (the UI consult):
 *
 * - 「このアプリ」 first (owner 2026-11-16): its own MIT licence
 *   (`appLicence.ts`); and under it the open-source packages its program
 *   uses, each under its own licence, which the MIT one does not cover.
 * - 3Dmol.js and the packages it bundles, its site linked under the heading,
 *   then the paper its authors ask users to cite (`MOL3D_CITATION`).
 * - PyMOL, the third-party code compiled into it and its runtime (full
 *   edition), under the PyMOL™ trademark notice, never folded, then its
 *   source repository linked and its citation (`PYMOL_CITATION`). The light
 *   edition has no PyMOL group, so no PyMOL citation either.
 *
 * Those two links, the 3Dmol.js paper's DOI and the GitHub row's are the
 * tab's only ones out (each fetched only when pressed). The
 * runtimes' texts arrive when the `licenses` block is read (`runtimesLoad`):
 * until then each group says so, and if the read failed it says that with a
 * way to try again (PT-9446 item 1); both groups' headings, the PyMOL™ notice
 * and the links are drawn whatever has loaded. Every text is rendered as
 * text.
 *
 * One scroll, the dialog body's (owner 2026-11-15: a slider inside a slider
 * was hard to follow): each text is a closed `<details>` whose summary names
 * the package, its version and its licence, and opening it lays the whole
 * text out below it, unclipped. Several can be open at once, and the contents
 * row has one 「すべて開く／すべて閉じる」, which a text arriving later
 * follows. A summary holds no heading (the groups' h3 stay the contents
 * list's targets), and an entry with no text is a plain line.
 */
export function LicenceContent(props: {
  runtimes: readonly RuntimeLicence[]
  runtimesLoad: RuntimeLoad
  onRetryRuntimes: () => void
  bundled: readonly BundledLicence[]
  full: boolean
}) {
  const { runtimes, runtimesLoad, onRetryRuntimes, bundled, full } = props
  const { t } = useTranslation(['htmlExport', 'pymolNotice', 'common'])
  const base = useId()
  const { ref: bodyRef, allOpen, onToggle, toggleAll } = useOpenAll(runtimes)
  const dmol = runtimes.map((l, i) => ({ l, i })).filter(({ l }) => groupOf(l) === '3dmol')
  const pymol = runtimes.map((l, i) => ({ l, i })).filter(({ l }) => groupOf(l) === 'pymol')
  // One id per group, used by the contents list and the heading alike (PT-9262 item 7).
  const ids = { app: `${base}-app`, dmol: `${base}-3dmol`, pymol: `${base}-pymol` }
  const sections = [
    { id: ids.app, label: t('htmlExport:sa_lic_app') },
    { id: ids.dmol, label: t('htmlExport:sa_lic_3dmol') },
    ...(full ? [{ id: ids.pymol, label: t('htmlExport:sa_lic_pymol') }] : []),
  ]
  /** The contents list's jump: the group's heading, in view and focused. */
  const jump = (id: string) => {
    const el = document.getElementById(id)
    el?.scrollIntoView?.({ block: 'start' })
    el?.focus()
  }
  /** One entry: its texts folded under its name, or the name alone when it has none. */
  const entry = (key: string, label: ReactNode, bodies: readonly string[]) =>
    bodies.length === 0 ? (
      <p key={key} className="sav-lic-item sav-lic-item--bare">
        {label}
      </p>
    ) : (
      <details key={key} className="sav-lic-item" onToggle={onToggle}>
        <summary>{label}</summary>
        {bodies.map((b, k) => (
          <pre key={k}>{b}</pre>
        ))}
      </details>
    )
  const runtime = (l: RuntimeLicence, i: number) => entry(`r${i}`, l.title, l.text === '' ? [] : [l.text])
  /** Where a group's runtime texts are not read yet, or could not be. */
  const loadLine =
    runtimesLoad === 'loading' ? (
      <p className="sav-lic-load">{t('htmlExport:sa_lic_loading')}</p>
    ) : runtimesLoad === 'failed' ? (
      <p className="sav-lic-load is-error">
        {t('htmlExport:sa_lic_failed')}{' '}
        <button type="button" className="btn btn-secondary btn-sm" onClick={onRetryRuntimes}>
          {t('htmlExport:sa_retry')}
        </button>
      </p>
    ) : null
  return (
    <div ref={bodyRef} className="sav-lic-body">
      {/* Said once while the texts are read, and if the read fails. */}
      <p role="status" className="sr-only">
        {runtimesLoad === 'loading' ? t('htmlExport:sa_lic_loading') : runtimesLoad === 'failed' ? t('htmlExport:sa_lic_failed') : ''}
      </p>
      {/* Who made it and which version, at the very top (owner 2026-11-18). */}
      <AppAbout author />
      <p className="sav-lic-intro">{t('htmlExport:sa_lic_intro')}</p>
      <div className="sav-lic-contents">
        <nav aria-label={t('htmlExport:sa_lic_toc')}>
          <ul className="sav-lic-toc">
            {sections.map(s => (
              <li key={s.id}>
                <button type="button" className="sav-link" onClick={() => jump(s.id)}>
                  {s.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <button type="button" className="btn btn-secondary btn-sm sav-lic-all" onClick={toggleAll}>
          {allOpen ? t('htmlExport:sa_lic_close_all') : t('htmlExport:sa_lic_open_all')}
        </button>
      </div>
      <h3 id={ids.app} tabIndex={-1} className="sav-lic-group">
        {t('htmlExport:sa_lic_app')}
      </h3>
      <p className="sav-lic-note">{t('htmlExport:sa_lic_app_note')}</p>
      {entry('app', `${APP_LICENCE_TITLE} (${APP_LICENCE_NAME})`, [APP_LICENCE_TEXT])}
      <h4 className="sav-lic-sub">{t('htmlExport:sa_lic_bundled')}</h4>
      <p className="sav-lic-note">{t('htmlExport:sa_lic_bundled_note')}</p>
      {bundled.map((p, i) =>
        entry(`b${i}`, `${p.name} ${p.version}${p.license !== '' ? ` (${p.license})` : ''}`, [...(p.text !== '' ? [p.text] : []), ...p.notices]),
      )}
      <h3 id={ids.dmol} tabIndex={-1} className="sav-lic-group">
        {t('htmlExport:sa_lic_3dmol')}
      </h3>
      <p className="sav-lic-link">
        <OutLink href={MOL3D_SITE}>{t('htmlExport:sa_lic_includes_3dmol')}</OutLink>
      </p>
      <Citation ask={t('htmlExport:sa_cite_3dmol_ask')} text={MOL3D_CITATION} doi={MOL3D_CITATION_DOI} />
      {loadLine}
      {dmol.map(({ l, i }) => runtime(l, i))}
      {full && (
        <>
          <h3 id={ids.pymol} tabIndex={-1} className="sav-lic-group">
            {t('htmlExport:sa_lic_pymol')}
          </h3>
          {/* The trademark notice the PyMOL licence asks for, before its texts and never folded. */}
          <PymolNotice variant="compact" />
          <p className="sav-lic-link">
            <OutLink href={PYMOL_SITE}>{t('htmlExport:sa_lic_pymol_github')}</OutLink>
          </p>
          <Citation ask={t('htmlExport:sa_cite_pymol_ask')} text={PYMOL_CITATION} />
          {loadLine}
          {pymol.map(({ l, i }) => runtime(l, i))}
        </>
      )}
    </div>
  )
}
