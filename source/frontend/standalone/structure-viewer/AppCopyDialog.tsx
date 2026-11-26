import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import Modal from '../../src/components/Modal'
import { ToggleSwitch } from '../../src/components/ToggleSwitch'
import type { Mol3dLook } from '../../src/pages/structure-html-export/mol3dLook'
import { PackFileNameField } from '../../src/pages/structure-html-export/PackFileNameField'
import { typedPackFileStem, viewerPackFileStem } from '../../src/pages/structure-html-export/viewerPackFileName'
import { formatSI } from '../../src/utils/formatSI'
import type { PageConfig } from './blocks'
import type { StructureDoc } from './localFile'
import { SaveStep, type PreparedFile } from './SaveStep'
import {
  appCopyRefusal,
  carriesBlock,
  estimateAppCopy,
  makeAppCopy,
  MOL3D_SESSION_BLOCK,
  PYMOL_SESSION_BLOCK,
  type AppCopyEdition,
  type AppCopyRefusal,
} from './selfCopy'

const MiB = 1024 * 1024
const mb = (bytes: number) => formatSI(bytes / MiB, { fractionDigits: bytes < 10 * MiB ? 1 : 0 })

/** Over this, a phone may run out of memory making or opening the copy (the full edition, ~21 MB). */
export const PHONE_WARN_BYTES = 15 * MiB

/**
 * Is this a phone or a tablet? By the device, not the layout (PT-9275 item
 * 4): a phone held sideways keeps the desktop layout, and a computer shown
 * the phone layout has a computer's memory. Any coarse pointer is a finger,
 * not only the main one (PT-9303 item 2): a tablet with a trackpad or a
 * keyboard cover reports a fine main pointer and keeps a tablet's memory. A
 * touch point counts too, where media queries are missing or say nothing. A
 * touch-screen laptop is warned as well; the warning is a line of text, and
 * a phone that is not warned may lose the copy it was making.
 */
export function isTouchDevice(): boolean {
  try {
    if (typeof window.matchMedia === 'function' && window.matchMedia('(any-pointer: coarse)').matches) return true
  } catch {
    // An old engine without media queries: fall through to the touch points.
  }
  return typeof navigator !== 'undefined' && (navigator.maxTouchPoints ?? 0) > 0
}

/** The text that says why Save is not offered. */
const REFUSAL_KEY: Record<AppCopyRefusal, string> = {
  'no-template': 'htmlExport:sa_app_no_template',
  'no-runtime': 'htmlExport:sa_app_full_unavailable',
  'runtime-damaged': 'htmlExport:sa_app_runtime_damaged',
  'pse-light': 'htmlExport:sa_app_pse_light',
}

/**
 * 「HTMLappとして出力（このアプリをコピー）」 (owner 2026-11-15): the app as
 * one HTML file, the full edition (3Dmol.js and PyMOL) or the light one
 * (3Dmol.js), with the structure now open in it or blank — made by the page
 * itself (`selfCopy.ts`), offline. A choice not offered here says why
 * (`aria-disabled`, its reason its description): a light file has no PyMOL to
 * copy; a `.pse` session needs PyMOL, so the light edition cannot carry it.
 * The size of each choice is shown, and a phone is warned off a large one.
 * Save carries the reason it is not offered as its description, a refused
 * press says it in the alert region, and a choice that makes Save refused
 * says so in the status region (PT-9275 items 2, 3).
 *
 * 「開いたときの表示」 (owner 2026-11-16): two switches, one per viewer, for
 * whether the copy opens on the session as it is now or as the structure
 * first opened. On: the 3Dmol.js view frozen now (`mol3dLook`), and PyMOL's
 * whole session as a `.pse` written fresh (full edition, once PyMOL has run).
 * Each says what it keeps; one that cannot be taken says why. Both start on
 * where they can be taken (the UI consult: a copy is mostly sent to show
 * what one sees).
 *
 * Save makes the file first, then the dialog turns to the save step
 * (`SaveStep`, owner 2026-11-17): its name, format and size over the two
 * ways to save it; 「設定に戻る」 brings the choices back as they were.
 */
export function AppCopyDialog(props: {
  config: PageConfig
  doc: StructureDoc | null
  lang: 'ja' | 'en'
  engine: '3dmol' | 'pymol'
  /** The 3Dmol.js view now, frozen; null when 3Dmol.js shows no view of the open file. */
  dmolLook?: (() => Mol3dLook | null) | null
  /** PyMOL's live session, written fresh; null when PyMOL is not running (or this is the light edition). */
  pymolSession?: ((signal: AbortSignal) => Promise<ArrayBuffer>) | null
  onClose: () => void
  /** Says what was saved in the page's live region: `how`, the browser's download started or the file written where chosen. */
  onSaved: (file: string, bytes: number, how: 'started' | 'saved') => void
}) {
  const { config, doc, lang, engine, dmolLook = null, pymolSession = null, onClose, onSaved } = props
  const { t } = useTranslation(['htmlExport', 'pymol'])
  const titleId = useId()
  const noteId = useId()
  const fullWhyId = useId()
  const withWhyId = useId()
  const saveWhyId = useId()
  const warnId = useId()
  const dmolNoteId = useId()
  const pseNoteId = useId()
  const fullRefusal = appCopyRefusal({ edition: 'full', doc: null, config })
  const canFull = fullRefusal === null
  const [edition, setEdition] = useState<AppCopyEdition>(canFull ? 'full' : 'light')
  const [withDoc, setWithDoc] = useState(doc !== null)
  /**
   * The name the file is saved under, `.html` aside (owner 2026-11-16):
   * `<the structure's stem>_AgroDesign-ProteinViewerPack-v<version>_<edition>_<date>`,
   * no stem in a blank copy. Untouched, it follows the choices and is made
   * again at the press (its date the press's); typed, it is the person's.
   */
  const defaultStem = (nextEdition: AppCopyEdition, nextWithDoc: boolean) =>
    viewerPackFileStem(nextWithDoc && doc !== null ? doc.stem : '', nextEdition, new Date())
  const [stem, setStem] = useState(() => defaultStem(canFull ? 'full' : 'light', doc !== null))
  const stemEdited = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  /** The file made, waiting in the save step; null while the choices are shown. */
  const [prepared, setPrepared] = useState<PreparedFile | null>(null)
  /** What the last choice changed about Save, for the status region. */
  const [said, setSaid] = useState('')
  const busyRef = useRef(false)
  /** Ends PyMOL's session write when the dialog goes. */
  const abortRef = useRef<AbortController | null>(null)
  useEffect(() => () => abortRef.current?.abort(), [])
  const put = withDoc ? doc : null
  // 「開いたときの表示」: each switch, and why it cannot be taken (a key), or
  // null. A session the file opened with (its own structure open) can be
  // kept as it is when none can be taken now (PyMOL not started).
  const original = doc !== null && doc.serial === 0
  const dmolWhy =
    !withDoc || doc === null
      ? 'htmlExport:sa_app_state_blank'
      : doc.ext === 'pse' || (dmolLook === null && !(original && carriesBlock(MOL3D_SESSION_BLOCK)))
        ? 'htmlExport:sa_app_state_dmol_none'
        : null
  const pseWhy =
    !withDoc || doc === null
      ? 'htmlExport:sa_app_state_blank'
      : edition === 'light'
        ? 'htmlExport:sa_app_state_pse_light'
        : pymolSession === null && !(original && carriesBlock(PYMOL_SESSION_BLOCK))
          ? 'htmlExport:sa_app_state_pse_off'
          : null
  const [keepDmol, setKeepDmol] = useState(true)
  const [keepPse, setKeepPse] = useState(true)
  const takeDmol = keepDmol && dmolWhy === null
  const takePse = keepPse && pseWhy === null
  const pseOpen = doc?.ext === 'pse'
  const pseLight = edition === 'light' && pseOpen && withDoc
  const refusal = appCopyRefusal({ edition, doc: put, config })
  const refusalText = refusal === null ? '' : t(REFUSAL_KEY[refusal])
  // The sizes read only what selfCopy kept at capture; each is worked out once per choice (PT-9275 item 5).
  // The sessions the switches put in count too (PT-9552 item 3): the page's own, or PyMOL's written at the press.
  const sizes = useMemo(() => {
    const sessions = {
      keepMol3dSession: takeDmol,
      keepPymolSession: takePse,
      freshMol3dSession: dmolLook !== null,
      freshPymolSession: pymolSession !== null,
    }
    return {
      full: estimateAppCopy({ edition: 'full', doc: put, config, ...sessions }),
      light: estimateAppCopy({ edition: 'light', doc: put, config, ...sessions }),
    }
  }, [put, config, takeDmol, takePse, dmolLook, pymolSession])
  const size = sizes[edition]
  const touch = useMemo(isTouchDevice, [])
  const warn = touch && size > PHONE_WARN_BYTES

  /** A choice: what it does to Save goes to the status region, said once. */
  const choose = (nextEdition: AppCopyEdition, nextWithDoc: boolean) => {
    setEdition(nextEdition)
    setWithDoc(nextWithDoc)
    setError('')
    if (!stemEdited.current) setStem(defaultStem(nextEdition, nextWithDoc))
    const next = appCopyRefusal({ edition: nextEdition, doc: nextWithDoc ? doc : null, config })
    setSaid(next === null ? '' : t(REFUSAL_KEY[next]))
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busyRef.current) return
    if (refusal !== null) {
      // Pressed while not offered (or Enter in the name): say why, as the page's other refused actions do.
      setError(refusalText)
      return
    }
    busyRef.current = true
    setBusy(true)
    setError('')
    // A typed name is cleaned and keeps; one left as it was, or typed away
    // to nothing, is the default made now. Either way the field then shows
    // the name it is saved under, and stays shut while the copy is made
    // (PT-9472), so the field and the file never differ.
    const typed = stemEdited.current ? typedPackFileStem(stem) : ''
    if (typed === '') stemEdited.current = false
    const pressedStem = typed === '' ? defaultStem(edition, withDoc) : typed
    setStem(pressedStem)
    const name = `${pressedStem}.html`
    try {
      const mol3dLook = takeDmol && dmolLook !== null ? dmolLook() : null
      let session: ArrayBuffer | null = null
      if (takePse && pymolSession !== null) {
        abortRef.current = new AbortController()
        const { signal } = abortRef.current
        try {
          session = await pymolSession(signal)
        } catch (err) {
          throw new Error(t('htmlExport:sa_app_err_session', { detail: (err instanceof Error ? err.message : String(err)).slice(0, 160) }))
        }
        // Closed while PyMOL wrote it: nothing is saved (the dialog has gone).
        if (signal.aborted) return
      }
      const blob = await makeAppCopy({
        edition,
        doc: put,
        config,
        lang,
        engine,
        now: new Date(),
        keepMol3dSession: takeDmol,
        mol3dLook,
        keepPymolSession: takePse,
        pymolSession: session,
      })
      setPrepared({ blob, name })
    } catch (err) {
      setError(t('htmlExport:sa_app_err', { detail: (err instanceof Error ? err.message : String(err)).slice(0, 200) }))
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  return (
    <Modal maxWidth={600} labelledBy={titleId} describedBy={prepared === null ? noteId : undefined} onClose={onClose}>
      {prepared !== null ? (
        <div className="pymolv-dialog sav-app">
          <div className="pymolv-dialog-head">
            <h2 id={titleId}>{t('htmlExport:sa_export_app')}</h2>
            <button type="button" className="btn btn-secondary btn-sm" aria-label={t('pymol:dialog_close')} onClick={onClose}>
              ×
            </button>
          </div>
          <SaveStep file={prepared} onBack={() => setPrepared(null)} onSaved={(how, file) => onSaved(file, prepared.blob.size, how)} />
        </div>
      ) : (
        <form className="pymolv-dialog sav-app" onSubmit={e => void submit(e)}>
          <div className="pymolv-dialog-head">
            <h2 id={titleId}>{t('htmlExport:sa_export_app')}</h2>
            <button type="button" className="btn btn-secondary btn-sm" aria-label={t('pymol:dialog_close')} onClick={onClose}>
              ×
            </button>
          </div>
          <p id={noteId} className="pymolv-dialog-note">
            {t('htmlExport:sa_export_app_note')}
          </p>
          <fieldset className="sav-app-group">
            <legend>{t('htmlExport:sa_app_edition')}</legend>
            <label className="pymolv-choice">
              <input
                type="radio"
                name="sav-app-edition"
                checked={edition === 'full'}
                aria-disabled={canFull ? undefined : true}
                aria-describedby={canFull ? undefined : fullWhyId}
                onChange={() => {
                  if (canFull) choose('full', withDoc)
                }}
              />{' '}
              {t('htmlExport:sa_app_full', { mb: mb(sizes.full) })}
            </label>
            {fullRefusal !== null && (
              <p id={fullWhyId} className="sav-app-why">
                {t(REFUSAL_KEY[fullRefusal])}
              </p>
            )}
            <label className="pymolv-choice">
              <input
                type="radio"
                name="sav-app-edition"
                checked={edition === 'light'}
                aria-describedby={pseOpen && withDoc ? withWhyId : undefined}
                onChange={() => choose('light', withDoc)}
              />{' '}
              {t('htmlExport:sa_app_light', { mb: mb(sizes.light) })}
            </label>
          </fieldset>
          <fieldset className="sav-app-group">
            <legend>{t('htmlExport:sa_app_content')}</legend>
            <label className="pymolv-choice">
              <input
                type="radio"
                name="sav-app-content"
                checked={withDoc}
                aria-disabled={doc === null ? true : undefined}
                aria-describedby={pseLight ? withWhyId : undefined}
                onChange={() => {
                  if (doc !== null) choose(edition, true)
                }}
              />{' '}
              {doc === null ? t('htmlExport:sa_app_with_none') : t('htmlExport:sa_app_with', { name: doc.name })}
            </label>
            {pseOpen && withDoc && (
              // Rendered whenever a radio names it: a .pse is in, so the light edition cannot carry it.
              <p id={withWhyId} className="sav-app-why" hidden={!pseLight}>
                {t('htmlExport:sa_app_pse_light')}
              </p>
            )}
            <label className="pymolv-choice">
              <input type="radio" name="sav-app-content" checked={!withDoc} onChange={() => choose(edition, false)} /> {t('htmlExport:sa_app_blank')}
            </label>
          </fieldset>
          <fieldset className="sav-app-group sav-app-state">
            <legend>{t('htmlExport:sa_app_state')}</legend>
            <p className="sav-app-note">{t('htmlExport:sa_app_state_note')}</p>
            <ToggleSwitch
              checked={takeDmol}
              unavailable={dmolWhy !== null}
              describedBy={dmolNoteId}
              onChange={setKeepDmol}
              label={t('htmlExport:sa_app_state_dmol')}
            />
            <p id={dmolNoteId} className="sav-app-why">
              {dmolWhy === null ? t('htmlExport:sa_app_state_dmol_hint') : t(dmolWhy)}
            </p>
            {edition === 'full' && (
              <>
                <ToggleSwitch
                  checked={takePse}
                  unavailable={pseWhy !== null}
                  describedBy={pseNoteId}
                  onChange={setKeepPse}
                  label={t('htmlExport:sa_app_state_pse')}
                />
                <p id={pseNoteId} className="sav-app-why">
                  {pseWhy === null ? t('htmlExport:sa_app_state_pse_hint') : t(pseWhy)}
                </p>
              </>
            )}
          </fieldset>
          <PackFileNameField
            label={t('pymol:export_name_label')}
            value={stem}
            disabled={busy}
            onChange={v => {
              stemEdited.current = true
              setStem(v)
            }}
            onDefault={() => {
              stemEdited.current = false
              setStem(defaultStem(edition, withDoc))
              setError('')
              setSaid(t('htmlExport:file_default_done'))
            }}
          />
          {warn && (
            <p id={warnId} className="sav-app-why">
              {t('htmlExport:sa_app_phone_warn', { mb: mb(size) })}
            </p>
          )}
          {refusal === 'no-template' && (
            <p id={saveWhyId} className="sav-app-why">
              {refusalText}
            </p>
          )}
          <button
            type="submit"
            className="btn btn-primary btn-sm"
            aria-disabled={refusal !== null || busy ? true : undefined}
            aria-describedby={[refusal === null ? '' : refusal === 'pse-light' ? withWhyId : refusal === 'no-template' ? saveWhyId : fullWhyId, warn ? warnId : ''].filter(Boolean).join(' ') || undefined}
          >
            {busy ? t('htmlExport:sa_app_saving') : t('htmlExport:sa_app_save', { mb: mb(size) })}
          </button>
          <p role="status" className="pymolv-dialog-note">
            {busy ? t('htmlExport:sa_app_saving') : said}
          </p>
          <p role="alert" className="pymolv-error">
            {error}
          </p>
        </form>
      )}
    </Modal>
  )
}
