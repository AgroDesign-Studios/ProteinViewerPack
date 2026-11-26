import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DialogBody, DialogFooterBar, DialogTitleBar } from '../../src/components/DialogBars'
import Modal from '../../src/components/Modal'
import type { ExportBlock, ExportItem, ExportItemId, TagEngine } from './exportItems'

/**
 * The engines' names on the export tags, the same in both languages: the two
 * modes' names without the word "mode" (owner 2026-11-18: "3Dmol.js" mode and
 * "Includes PyMOL™" mode; PyMOL's name only in the forms its licence allows).
 */
export const ENGINE_NAME: Readonly<Record<TagEngine, string>> = { pymol: 'Includes PyMOL™', '3dmol': '3Dmol.js' }

/**
 * One engine tag. PyMOL's phrase is too long for the tag column on one line,
 * so it takes two, its first word in smaller type (owner 2026-11-18: 入らない
 * ところは字を小さく); the text still reads as the whole phrase.
 */
export function EngineTag({ engine }: { engine: TagEngine }) {
  if (engine === '3dmol') return <span className="sav-tag sav-tag--3dmol">{ENGINE_NAME['3dmol']}</span>
  const [first, ...rest] = ENGINE_NAME.pymol.split(' ')
  return (
    <span className="sav-tag sav-tag--pymol" lang="en">
      <span className="sav-tag-small">{first}</span> <span className="sav-tag-big">{rest.join(' ')}</span>
    </span>
  )
}

/** Each entry's name and the line under it. */
const LABEL: Readonly<Record<ExportItemId, { label: string; note: string }>> = {
  structure: { label: 'htmlExport:sa_export_structure', note: 'htmlExport:sa_dmol_export_structure_note_v2' },
  mol: { label: 'htmlExport:sa_export_mol', note: 'htmlExport:sa_export_mol_note' },
  pse: { label: 'htmlExport:sa_export_pse', note: 'htmlExport:sa_export_pse_note' },
  vrml: { label: 'htmlExport:sa_export_vrml', note: 'htmlExport:sa_dmol_export_vrml_note' },
  app: { label: 'htmlExport:sa_export_app', note: 'htmlExport:sa_export_app_note' },
}

/** Why an entry cannot be used now, said as its description (this dialog's and 「画像出力」's). */
export const BLOCK: Readonly<Record<ExportBlock, string>> = {
  'no-3d': 'htmlExport:sa_export_blocked_no_3d',
  'dmol-loading': 'htmlExport:sa_export_blocked_dmol_loading',
  'no-dmol-lib': 'htmlExport:sa_export_blocked_no_dmol_lib',
  'no-dmol-view': 'htmlExport:sa_export_blocked_no_dmol',
  'no-pymol': 'htmlExport:sa_export_blocked_no_pymol',
  saving: 'htmlExport:sa_export_blocked_saving',
}

/**
 * 「エクスポート」 in the offline file's header (owner 2026-11-14): one place
 * to save from either viewer. The format comes first; each entry carries the
 * name of the engine that writes it in a small text tag (never colour
 * alone); one that either engine serves carries both names, one above the
 * other (owner 2026-11-15). An entry of the engine not on screen asks, when
 * pressed, to switch to it — nothing switches before that second press. A
 * format with settings closes this dialog and opens its own form (PyMOL's
 * dialogs, reused), so two dialogs are never stacked. An entry that cannot
 * be used now stays in the Tab order (`aria-disabled`, its reason its
 * description) and a press does nothing (PT-9230 item 6).
 *
 * The featured entry (「HTMLappとして出力」, owner 2026-11-16) is set apart by
 * a pale blue fill, a coloured left band and a 「おすすめ」 word badge — never
 * by colour alone. The structure file's label names the open file's own
 * format (it is saved unchanged), mmCIF or PDB or whichever it is.
 */
export function ExportDialog(props: {
  items: readonly ExportItem[]
  /** The open file's format by name (`formatName`), for the structure file's label. */
  structureFormat: string
  /** `switchFirst`: the person agreed to switch engines for it. */
  onPick: (id: ExportItemId, switchFirst: boolean) => void
  onClose: () => void
}) {
  const { items, structureFormat, onPick, onClose } = props
  const { t } = useTranslation(['htmlExport', 'pymol'])
  const titleId = useId()
  const introId = useId()
  const base = useId()
  const [asking, setAsking] = useState<ExportItemId | null>(null)
  const confirmRef = useRef<HTMLButtonElement | null>(null)
  // The question appears under the entry; the answer button takes focus.
  useEffect(() => {
    if (asking !== null) confirmRef.current?.focus()
  }, [asking])

  const press = (item: ExportItem) => {
    if (item.blocked !== null) return
    if (item.switchTo !== null) setAsking(cur => (cur === item.id ? null : item.id))
    else onPick(item.id, false)
  }

  return (
    <Modal maxWidth={600} flush labelledBy={titleId} describedBy={introId} onClose={onClose}>
      <DialogTitleBar
        title={<span id={titleId}>{t('htmlExport:sa_export_title')}</span>}
        background="var(--blue-text)"
        onClose={onClose}
        closeLabel={t('pymol:dialog_close')}
      />
      <DialogBody>
        <p id={introId} className="sav-export-intro">
          {t('htmlExport:sa_export_intro')}
        </p>
        <ul className="sav-export-list">
          {items.map(item => {
            const noteId = `${base}-${item.id}-note`
            const askId = `${base}-${item.id}-ask`
            return (
              <li key={item.id} className={`sav-export-row${item.featured ? ' sav-export-row--featured' : ''}`}>
                <button
                  type="button"
                  className="sav-export-item"
                  aria-disabled={item.blocked !== null ? true : undefined}
                  aria-describedby={noteId}
                  aria-expanded={item.switchTo !== null ? asking === item.id : undefined}
                  onClick={() => press(item)}
                >
                  <span className="sav-export-label">
                    {item.id === 'structure' ? t(LABEL.structure.label, { format: structureFormat }) : t(LABEL[item.id].label)}
                    {item.featured && ' '}
                    {item.featured && <span className="sav-export-badge">{t('htmlExport:sa_export_recommended')}</span>}
                  </span>
                  <span className="sav-tags">
                    {item.tags.map(e => (
                      <EngineTag key={e} engine={e} />
                    ))}
                  </span>
                </button>
                <p id={noteId} className="sav-export-note">
                  {item.blocked !== null ? t(BLOCK[item.blocked]) : t(LABEL[item.id].note)}
                </p>
                {asking === item.id && item.switchTo !== null && (
                  <div className="sav-export-ask" role="group" aria-labelledby={askId}>
                    <p id={askId}>{t('htmlExport:sa_export_switch_why')}</p>
                    <button ref={confirmRef} type="button" className="btn btn-primary btn-sm" onClick={() => onPick(item.id, true)}>
                      {t('htmlExport:sa_export_switch')}
                    </button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </DialogBody>
      <DialogFooterBar>
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          {t('htmlExport:sa_close')}
        </button>
      </DialogFooterBar>
    </Modal>
  )
}
