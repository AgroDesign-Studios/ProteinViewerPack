import { useTranslation } from 'react-i18next'

import { PYMOL_RUNTIME_VERSION } from '../../src/pages/pymol-viewer/pymolRuntimeManifest'
import { APP_GITHUB_URL, APP_VERSION } from './appLicence'
import { OutLink, PYMOL_BUILT_VERSION } from './LicenceDialog'

/** The 3Dmol.js the file embeds (codeChanges.test.ts holds it to node_modules). */
export const MOL3D_VERSION = '2.5.5'

/** The document on GitHub that 「改良点」 links to: the repository's CODE-CHANGES.md (this folder's copy) at this version's tag. */
export const CODE_CHANGES_FILE = 'CODE-CHANGES.md'

/**
 * The runtime's version name split into what the intro names: its
 * pymol-open-source commit and its Pyodide version
 * (`3.2.0a-edcda80f-s3-pyodide-314.0.7`). A name of another shape gives `?`.
 */
export function runtimeParts(version: string = PYMOL_RUNTIME_VERSION): { commit: string; pyodide: string } {
  const m = /-([0-9a-f]{7,40})-(?:s\d+-)?pyodide-([\w.]+)$/.exec(version)
  return { commit: m?.[1] ?? '?', pyodide: m?.[2] ?? '?' }
}

/**
 * The document's address for this version, at the heading of the language
 * shown (its two halves are 「日本語」 and 「English」); none without a
 * repository.
 */
export function codeChangesUrl(lang: string, repo: string = APP_GITHUB_URL, version: string = APP_VERSION): string | null {
  if (repo === '') return null
  return `${repo}/blob/v${version}/${CODE_CHANGES_FILE}#${lang.startsWith('en') ? 'english' : '日本語'}`
}

/**
 * HELP's 「改良点」 tab. Until v1.0.4 it listed every change to Open-Source
 * PyMOL with its patch, and what the app adds around 3Dmol.js (owner
 * 2026-11-18, for bioinformatics researchers): about 66 KB of words in both
 * editions and 47 KB of patches in the full one. Owner 2026-11-20: 「改良点
 * タブの表示するデータが大きければ、GitHubにおく文書で代替して、そこへのリンク
 * を張ればOK」 — the list is now the repository's `CODE-CHANGES.md` (this
 * folder's copy, which the release copies there), and the tab keeps what
 * the file must say of itself: which engines it runs, that the PyMOL inside
 * is a modified build distinct from Schrödinger's products, that 3Dmol.js
 * is used as published, and the link to this version's document.
 */
export function HelpChanges(props: { full: boolean }) {
  const { full } = props
  const { t, i18n } = useTranslation(['htmlExport'])
  const { commit, pyodide } = runtimeParts()
  const url = codeChangesUrl(i18n.language ?? 'ja')
  return (
    <div className="sav-lic-body sav-chg">
      <p className="sav-lic-intro">
        {full ? t('htmlExport:sa_chg_intro', { version: PYMOL_BUILT_VERSION, commit, pyodide, mol3d: MOL3D_VERSION }) : t('htmlExport:sa_chg_intro_light', { mol3d: MOL3D_VERSION })}
      </p>
      <p className="sav-lic-intro">{t('htmlExport:sa_chg_doc', { version: APP_VERSION })}</p>
      {url !== null && (
        <p>
          <OutLink href={url}>{t('htmlExport:sa_chg_doc_link')}</OutLink>
          <span className="sav-lic-note"> {t('htmlExport:sa_chg_doc_offline')}</span>
        </p>
      )}
    </div>
  )
}
