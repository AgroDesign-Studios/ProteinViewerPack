import { useTranslation } from 'react-i18next'

/**
 * PyMOL's wait, over the viewer (owner 2026-11-16: the spinner had turned
 * beside the engine switch; UI dual consult, the owner took Opus's layout):
 * a light veil over the stage and, in a card, a turning ring, the mode's
 * name and what it is doing. The name is the app's — `"Includes PyMOL™" mode`
 * (owner 2026-11-18; the Heavy viewer before), its phrase one of the forms
 * PyMOL's licence allows and kept in English in both languages — and the
 * state under it a short word, 「起動中…」 then 「構造を読み込み中…」.
 * The veil takes no pointer (standalone.css `.sav-pyload`), so 3Dmol.js under
 * it stays usable while PyMOL starts. Decoration (`aria-hidden`): the status
 * line and the engine switch's description already say it, once.
 */
export function PymolLoadOverlay({ starting }: { starting: boolean }) {
  const { t } = useTranslation('htmlExport')
  return (
    <div className="sav-pyload" aria-hidden="true">
      <div className="sav-pyload-card">
        <span className="sav-pyload-ring" />
        <span className="sav-pyload-name">{t('htmlExport:sa_pyload_name')}</span>
        <span className="sav-pyload-text">{starting ? t('htmlExport:sa_pyload_starting') : t('htmlExport:sa_pyload_loading')}</span>
      </div>
    </div>
  )
}
