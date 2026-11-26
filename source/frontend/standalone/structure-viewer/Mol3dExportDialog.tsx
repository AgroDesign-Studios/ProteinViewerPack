import { useId, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import Modal from '../../src/components/Modal'
import { cleanFileStem } from '../../src/pages/pymol-viewer/pymolExport'
import { formatName } from './localFile'
import { SaveStep, type PreparedFile } from './SaveStep'
import { exportVrmlKeepingScene, type VrmlSource } from './vrmlExport'

/** What is written without PyMOL: the open structure file itself, or the shapes 3Dmol.js draws. */
export type Mol3dExportKind = 'structure' | 'vrml'

export type { VrmlSource }

/**
 * The two formats of the offline file's 「エクスポート」 that need no PyMOL
 * (owner 2026-11-14: files in 3Dmol.js's and PyMOL's own formats) — the
 * form each opens once chosen in `ExportDialog`:
 *
 * - `structure`: the file that is open, as it came (the embedded mmCIF, or a
 *   file from this computer or from RCSB, in its own format), whichever
 *   engine shows it; what the toolbar changed is not in it;
 * - `vrml`: the shapes 3Dmol.js draws now, with their colours — 3Dmol.js's own
 *   `exportVRML`, for 3D viewers and 3D-printing tools; no atoms in it. Its
 *   pane may be hidden behind PyMOL: the view is there all the same.
 *
 * No PDB written from 3Dmol.js's atoms: 3Dmol.js 2.5.5 has no PDB writer
 * (`pdbData` repeats the lines of a PDB input only), and one made here would
 * drop alternate locations, long chain names and the atom-count limits while
 * looking complete (both UI consultants, 2026-11-14). The full edition's
 * PyMOL writes PDB, mmCIF, SDF and MOL2.
 *
 * Save makes the file, then the dialog turns to the save step (`SaveStep`,
 * owner 2026-11-17): where to save it, the browser's default or a place
 * chosen; 「設定に戻る」 brings the name back.
 */
export function Mol3dExportDialog(props: {
  kind: Mol3dExportKind
  /** The structure file's own bytes, unchanged (never the decoded text: PR #8239 review), and its extension. */
  structure: { bytes: ArrayBuffer; extension: string }
  viewer: () => VrmlSource | null
  fileStem: string
  onClose: () => void
}) {
  const { kind, structure, viewer, fileStem, onClose } = props
  const { t } = useTranslation(['htmlExport', 'pymol'])
  const titleId = useId()
  const nameId = useId()
  const noteId = useId()
  const [stem, setStem] = useState(fileStem)
  const [error, setError] = useState('')
  /** The file made, waiting in the save step. */
  const [prepared, setPrepared] = useState<PreparedFile | null>(null)
  const extension = kind === 'structure' ? structure.extension : 'wrl'

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setError('')
    const name = cleanFileStem(stem, fileStem)
    setStem(name)
    try {
      if (kind === 'structure') {
        setPrepared({
          blob: new Blob([structure.bytes], { type: extension === 'cif' || extension === 'mmcif' ? 'chemical/x-mmcif' : 'application/octet-stream' }),
          name: `${name}.${extension}`,
        })
      } else {
        const v = viewer()
        if (v === null) throw new Error(t('htmlExport:sa_dmol_export_no_view'))
        // The live scene is put back and drawn again, even if the export throws (vrmlExport.ts).
        const vrml = exportVrmlKeepingScene(v)
        setPrepared({ blob: new Blob([vrml], { type: 'model/vrml;charset=utf-8' }), name: `${name}.${extension}` })
      }
    } catch (err) {
      setError(t('htmlExport:sa_dmol_export_err', { detail: (err instanceof Error ? err.message : String(err)).slice(0, 200) }))
    }
  }

  return (
    <Modal maxWidth={560} labelledBy={titleId} describedBy={prepared === null ? noteId : undefined} onClose={onClose}>
      {prepared !== null ? (
        <div className="pymolv-dialog">
          <div className="pymolv-dialog-head">
            <h2 id={titleId}>{kind === 'structure' ? t('htmlExport:sa_export_structure', { format: formatName(structure.extension) }) : t('htmlExport:sa_export_vrml')}</h2>
            <button type="button" className="btn btn-secondary btn-sm" aria-label={t('pymol:dialog_close')} onClick={onClose}>
              ×
            </button>
          </div>
          <SaveStep file={prepared} onBack={() => setPrepared(null)} />
        </div>
      ) : (
        <form className="pymolv-dialog" onSubmit={submit}>
          <div className="pymolv-dialog-head">
            <h2 id={titleId}>{kind === 'structure' ? t('htmlExport:sa_export_structure', { format: formatName(structure.extension) }) : t('htmlExport:sa_export_vrml')}</h2>
            <button type="button" className="btn btn-secondary btn-sm" aria-label={t('pymol:dialog_close')} onClick={onClose}>
              ×
            </button>
          </div>
          <p id={noteId} className="pymolv-dialog-note">
            {kind === 'structure' ? t('htmlExport:sa_dmol_export_structure_note_v2') : t('htmlExport:sa_dmol_export_vrml_note')}
          </p>
          <div className="form-group">
            <label htmlFor={nameId}>{t('pymol:export_name_label')}</label>
            <div className="pymolv-name-row">
              <input id={nameId} type="text" value={stem} autoComplete="off" spellCheck={false} onChange={e => setStem(e.target.value)} />
              <code>.{extension}</code>
            </div>
          </div>
          <button type="submit" className="btn btn-primary btn-sm">
            {t('htmlExport:sa_dmol_export_submit')}
          </button>
          <p role="alert" className="pymolv-error">
            {error}
          </p>
        </form>
      )}
    </Modal>
  )
}
