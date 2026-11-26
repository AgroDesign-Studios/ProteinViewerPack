import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import Modal from '../../components/Modal'
import { formatSI } from '../../utils/formatSI'
import {
  defaultFileStem,
  EXPORT_TARGETS,
  exportMolecule,
  fileStemAtPress,
  PymolExportError,
  selectionFor,
  type ExportFailure,
  type ExportTarget,
} from './pymolExport'
import type { PymolExportFrame } from './pymolExportFrame'
import { LIMITS, MiB, MOL_FORMATS, type MolFormat } from './pymolFrameProtocol'
import { clipText, DETAIL_MAX_CHARS, exportDetailText as detailText } from './pymolCommandText'

const TARGET_KEYS: Readonly<Record<ExportTarget, string>> = Object.freeze({
  sele: 'pymol:export_target_sele',
  all: 'pymol:export_target_all',
  ligand: 'pymol:export_target_ligand',
  polymer: 'pymol:export_target_polymer',
  custom: 'pymol:export_target_custom',
})

const FORMAT_KEYS: Readonly<Record<MolFormat, string>> = Object.freeze({
  pdb: 'pymol:export_format_pdb',
  cif: 'pymol:export_format_cif',
  sdf: 'pymol:export_format_sdf',
  mol2: 'pymol:export_format_mol2',
})

/**
 * Each format's name as its choice says it, for the not-a-file error: the
 * format code upper-cased would call mmCIF "CIF" (PT-9126 items 3, 8).
 * Product / format names, the same in both languages.
 */
const FORMAT_NAMES: Readonly<Record<MolFormat, string>> = Object.freeze({
  pdb: 'PDB',
  cif: 'mmCIF',
  sdf: 'SDF',
  mol2: 'MOL2',
})

/** The small-molecule formats, whose bond orders are PyMOL's as loaded (the note under them). */
const SMALL_MOLECULE: ReadonlySet<MolFormat> = new Set<MolFormat>(['sdf', 'mol2'])

/**
 * 「分子をファイルに書き出す」 — the atoms of a selection as one PDB, mmCIF,
 * SDF or MOL2 file on the user's computer (PT-3615 item 1; mmCIF and MOL2
 * since 2026-11-14). Opened from the bar and from
 * File 「分子を書き出す…」. The target is one of four fixed ones (the current
 * selection by default, everything, ligands, polymer) or a PyMOL selection the
 * user writes; an unknown or empty one is said, never replaced by another.
 * The file name starts as `<object>_<target>_<date>` and may be edited; its
 * extension is the format's. Each press is one request through the export
 * gate (`pymolExport.ts`), and nothing is uploaded. While the export itself
 * is in flight and Stop can end it (`stoppable`) the dialog does not close (×
 * and Escape wait, with the reason) and offers 「止める」 instead — the
 * controller's cancel, under the same condition as the busy bar it covers
 * (PT-3816). While the export only waits behind a load (`waiting`), which
 * cancel leaves alone, × and Escape close it (PT-3827); so they do while it
 * waits behind anything else, where Stop would end the request ahead of it —
 * rebuilding PyMOL and losing changes since the last checkpoint — and closing
 * only withdraws the export. Which of the two it is the dialog learns from
 * the request's `onSent` (`tellsSent`, PT-9232 item 1, as the session
 * dialog's PT-9219 item 2); a host that does not tell holds while anything
 * Stop can end runs. A dialog that goes before the reply saves
 * nothing, and withdraws its request from PyMOL's queue if it still waits
 * there (PT-3851 item 2), which the page then says (`onWithdrawn`); a
 * request already sent runs to its end. The
 * reason, held or waiting, is in the status line under the button, so a
 * change between the two is spoken and nothing above it moves (PT-3851).
 * An untouched file name takes the time of the press, not of the opening;
 * text from PyMOL in a failure is put on one line and cut, and a failure
 * with none says so without a dangling colon (PT-3816 items 6, 19).
 *
 * The UI review (2026-10-17) chose the fixed targets
 * plus a selection field, PDB and SDF, and a page-made file name; the owner
 * added PyMOL's mmCIF and MOL2 (2026-11-14). A whole session (`.pse`) is
 * File's own entry and dialog (`PymolPseExportDialog`), not a format here:
 * it is the scene, not a selection.
 *
 * `saveStep` (the offline HTML file's, owner 2026-11-17): given, the file
 * made is handed to it in place of the browser's download, and the dialog
 * shows what it draws — the file's name, size and where to save it — in
 * place of its form, under the same title; its `back` brings the form back,
 * its choices as they were. Without it, the dialog downloads the file.
 */
export function PymolExportDialog(props: {
  frame: PymolExportFrame | null
  /** Whether `frame.requestExport` calls `onSent`: the dialog can then tell an export that waits from one in flight. */
  tellsSent?: boolean
  ready: boolean
  /**
   * Whether `frame.cancel()` would act now: a command or an export is in
   * flight (a command the page sent included). False while this export waits
   * behind a load, which
   * cancel leaves alone.
   */
  stoppable: boolean
  /**
   * Whether a load is in flight, which a pending export waits behind. Read
   * from the page, not inferred from `!stoppable`: between two requests, and
   * as the export's own reply lands, nothing is in flight and nothing waits.
   */
  waiting: boolean
  /** The page structure's PyMOL object, for the default file name. */
  objectName: string
  onClose: () => void
  /**
   * The dialog went while its export still waited, and the request was taken
   * out of PyMOL's queue: the dialog is no longer there to say so, the page is.
   */
  onWithdrawn?: () => void
  /** Where the made file goes instead of the browser's download (the offline file's save step). */
  saveStep?: (file: { blob: Blob; name: string }, back: () => void) => ReactNode
}) {
  const { frame, tellsSent = false, ready, stoppable, waiting, objectName, onClose, onWithdrawn, saveStep } = props
  const { t } = useTranslation(['pymol', 'common'])
  const titleId = useId()
  const customId = useId()
  const customNoteId = useId()
  const nameId = useId()
  const whyId = useId()
  const busyNoteId = useId()
  const cancelNoteId = useId()
  const seleNoteId = useId()
  const smallNoteId = useId()
  const [target, setTarget] = useState<ExportTarget>('sele')
  const [custom, setCustom] = useState('')
  const [format, setFormat] = useState<MolFormat>('pdb')
  const [stem, setStem] = useState(() => defaultFileStem(objectName, 'sele', new Date()))
  // Once the user types a name, a change of target no longer rewrites it
  // (until a press finds it cleans to nothing).
  const stemEdited = useRef(false)
  const [busy, setBusy] = useState(false)
  // Two presses before a re-render must not make two requests.
  const busyRef = useRef(false)
  // The export's own request has left the queue (`tellsSent` hosts only):
  // the state for what is shown, the ref for a close that comes before the
  // re-render does (PT-9249 item 3, as PT-9244 item 6 for the session save).
  const [sent, setSent] = useState(false)
  const sentRef = useRef(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  /** The file made, handed to `saveStep`; null while the form is shown. */
  const [prepared, setPrepared] = useState<{ blob: Blob; name: string } | null>(null)
  // Whether the dialog is on screen. A reply that arrives after it is gone is
  // not saved: nobody asked for a file they can no longer see being made. A
  // request still waiting in PyMOL's queue then is withdrawn, so PyMOL does
  // not run it.
  const onScreen = useRef(false)
  const pending = useRef<AbortController | null>(null)
  useEffect(() => {
    onScreen.current = true
    return () => {
      onScreen.current = false
      pending.current?.abort()
    }
  }, [])

  const selection = selectionFor(target, custom)
  const customInvalid = target === 'custom' && custom.trim() !== '' && selection === null
  // No frame reads as not ready: the press would ask nothing, so the button
  // says why instead of doing nothing (PT-3816 item 12). A written selection
  // that cannot be sent is said to be wrong, not missing (item 14).
  const whyNot =
    !ready || frame === null
      ? t('pymol:export_why_not_ready')
      : busy
        ? t('pymol:export_why_busy')
        : selection === null
          ? t(customInvalid ? 'pymol:export_why_custom_invalid' : 'pymol:export_why_custom')
          : null
  // Held open only while Stop can act on the export itself: a dialog that
  // may not close must offer a way out that works, and one whose export still
  // waits has one that costs nothing — closing withdraws it (PT-9232 item 1).
  const inFlight = !tellsSent || sent
  const holdOpen = busy && inFlight && stoppable && frame !== null
  // The same test at the moment × or Escape is pressed: `onSent` is told
  // while the dialog still shows an export that waits, and a close before the
  // re-render would read that. A request sent since the last render holds
  // even if `stoppable` was false then (it waited behind a load): the request
  // now in flight is the export itself; once rendered, `stoppable` decides.
  const holdsNow = (): boolean => {
    if (!busyRef.current || frame === null) return false
    if (!tellsSent) return stoppable
    return sentRef.current && (stoppable || !sent)
  }
  const close = () => {
    if (!holdsNow()) onClose()
  }
  const waitsBehindLoad = busy && !holdOpen && waiting
  // "PyMOL is still running a request made earlier" only while one runs
  // (`stoppable`: a command or an export is in flight, and it is not this
  // one); otherwise the plain working text (PT-9249 item 6).
  const waitsInQueue = busy && !holdOpen && !waiting && !inFlight && stoppable
  const busyNote = holdOpen
    ? t('pymol:export_why_close_busy', { stop: t('pymol:busy_cancel') })
    : waitsBehindLoad
      ? t('pymol:export_waiting_note')
      : waitsInQueue
        ? t('pymol:export_queued_note')
        : null

  // Stop leaves while it may hold the focus (the request ended or was
  // stopped, or the queue moved on to a load): the focus would fall to
  // <body>, out of the dialog. It goes to 書き出す instead; focus the user
  // put elsewhere stays where it is.
  const submitRef = useRef<HTMLButtonElement>(null)
  const heldBefore = useRef(false)
  useLayoutEffect(() => {
    if (heldBefore.current && !holdOpen && (document.activeElement === null || document.activeElement === document.body)) {
      submitRef.current?.focus()
    }
    heldBefore.current = holdOpen
  }, [holdOpen])

  const chooseTarget = (next: ExportTarget) => {
    setTarget(next)
    if (!stemEdited.current) setStem(defaultFileStem(objectName, next, new Date()))
  }

  // Text the page did not write, on one line and cut (`detailText`); none at
  // all ends the sentence there instead of on a colon.
  const failedText = (e: unknown): string => {
    const detail = detailText(t, e)
    return detail === '' ? t('pymol:export_err_failed_bare') : t('pymol:export_err_failed', { detail })
  }

  const failureText = (f: ExportFailure, asked: { format: MolFormat; target: ExportTarget }): string => {
    switch (f.code) {
      case 'cancelled':
        return t('pymol:export_err_cancelled')
      // Only while the dialog stays on screen, as a development Fast Refresh
      // re-runs its effects; a dialog that closed hands this to the page.
      case 'withdrawn':
        return t('pymol:export_withdrawn')
      case 'too-large':
        return t('pymol:export_err_too_large', { limit: formatSI(LIMITS.molBytes / MiB, { fractionDigits: 0 }) })
      case 'not-text':
      case 'no-atoms':
        return t('pymol:export_err_not_file', { format: FORMAT_NAMES[asked.format] })
      case 'empty-selection':
        return t('pymol:export_err_empty')
      case 'unknown-selection': {
        if (asked.target === 'sele') return t('pymol:export_err_no_sele')
        const detail = clipText(f.detail, DETAIL_MAX_CHARS)
        return detail === '' ? t('pymol:export_err_unknown_selection_bare') : t('pymol:export_err_unknown_selection', { detail })
      }
      case 'bad-selection':
        return t('pymol:export_custom_invalid', { max: LIMITS.selectionChars })
      case 'failed':
        return failedText(f.detail)
    }
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (frame === null || whyNot !== null || busyRef.current) return
    busyRef.current = true
    const asked = { format, target }
    // The field then shows the name the file is saved under (PT-4164 item 10).
    const { name, edited } = fileStemAtPress({ stem, edited: stemEdited.current, objectName, target, now: new Date() })
    stemEdited.current = edited
    setStem(name)
    const request = new AbortController()
    pending.current = request
    setBusy(true)
    sentRef.current = false
    setSent(false)
    setError('')
    setStatus(t('pymol:export_working'))
    try {
      const done = await exportMolecule({
        frame,
        format,
        selection,
        stem: name,
        // The save step takes the file in place of the download.
        save:
          saveStep === undefined
            ? undefined
            : (text, stem, extension, mime) => setPrepared({ blob: new Blob([text], { type: `${mime};charset=utf-8` }), name: `${stem}.${extension}` }),
        wanted: () => onScreen.current,
        signal: request.signal,
        onSent: () => {
          if (pending.current !== request || !onScreen.current) return
          sentRef.current = true
          setSent(true)
        },
      })
      const kib = done.bytes / 1024
      // The save step says the file's size itself.
      if (saveStep !== undefined) {
        setStatus('')
        return
      }
      // Decided on the value as shown (one decimal), so a file just under
      // 1 MiB reads "1.0 MiB", not "1 024.0 KiB" (PT-4164 item 8).
      setStatus(
        Math.round(kib * 10) >= 1024 * 10
          ? t('pymol:export_done_mib', { name: done.name, size: formatSI(done.bytes / MiB, { fractionDigits: 1 }) })
          : t('pymol:export_done_kib', { name: done.name, size: formatSI(kib, { fractionDigits: 1 }) }),
      )
    } catch (err) {
      if (!onScreen.current) {
        if (err instanceof PymolExportError && err.failure.code === 'withdrawn') onWithdrawn?.()
        return
      }
      setStatus('')
      // Anything else was thrown here (the save itself): its message, never
      // read as no answer from a server — an export talks to none (PT-4164
      // item 7, PT-4140).
      setError(err instanceof PymolExportError ? failureText(err.failure, asked) : failedText(err instanceof Error ? err.message : err))
    } finally {
      if (pending.current === request) pending.current = null
      busyRef.current = false
      sentRef.current = false
      setBusy(false)
      setSent(false)
    }
  }

  return (
    <Modal maxWidth={640} labelledBy={titleId} onClose={holdOpen ? undefined : close}>
      {prepared !== null && saveStep !== undefined ? (
        <div className="pymolv-dialog">
          <div className="pymolv-dialog-head">
            <h2 id={titleId}>{t('pymol:export_title')}</h2>
            <button type="button" className="btn btn-secondary btn-sm" aria-label={t('pymol:dialog_close')} onClick={close}>
              ×
            </button>
          </div>
          {saveStep(prepared, () => setPrepared(null))}
        </div>
      ) : (
        <form className="pymolv-dialog" onSubmit={e => void submit(e)}>
          <div className="pymolv-dialog-head">
            <h2 id={titleId}>{t('pymol:export_title')}</h2>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              aria-label={t('pymol:dialog_close')}
              aria-disabled={holdOpen}
              aria-describedby={busyNote !== null ? busyNoteId : undefined}
              onClick={close}
            >
              ×
            </button>
          </div>
          <p className="pymolv-dialog-note">{t('pymol:export_note_v2')}</p>

          <fieldset className="pymolv-choices">
            <legend>{t('pymol:export_target_legend')}</legend>
            {EXPORT_TARGETS.map(id => (
              <div key={id}>
                <label className="pymolv-choice">
                  <input
                    type="radio"
                    name="pymol-export-target"
                    value={id}
                    checked={target === id}
                    aria-describedby={id === 'sele' ? seleNoteId : undefined}
                    onChange={() => chooseTarget(id)}
                  />{' '}
                  {t(TARGET_KEYS[id])}
                </label>
                {id === 'sele' && (
                  <div id={seleNoteId} className="pymolv-dialog-note">
                    {t('pymol:export_target_sele_note')}
                  </div>
                )}
              </div>
            ))}
            <div className="form-group">
              <label htmlFor={customId}>{t('pymol:export_custom_label')}</label>
              <input
                id={customId}
                type="text"
                value={custom}
                autoComplete="off"
                spellCheck={false}
                maxLength={LIMITS.selectionChars}
                disabled={target !== 'custom'}
                aria-invalid={customInvalid}
                aria-describedby={customNoteId}
                onChange={e => setCustom(e.target.value)}
              />
              <div id={customNoteId} className={customInvalid ? 'pymolv-error' : 'pymolv-dialog-note'}>
                {customInvalid ? t('pymol:export_custom_invalid', { max: LIMITS.selectionChars }) : t('pymol:export_custom_note', { max: LIMITS.selectionChars })}
              </div>
            </div>
          </fieldset>

          <fieldset className="pymolv-choices">
            <legend>{t('pymol:export_format_legend')}</legend>
            {MOL_FORMATS.map(f => (
              <div key={f}>
                <label className="pymolv-choice">
                  <input
                    type="radio"
                    name="pymol-export-format"
                    value={f}
                    checked={format === f}
                    aria-describedby={SMALL_MOLECULE.has(f) && format === f ? smallNoteId : undefined}
                    onChange={() => setFormat(f)}
                  />{' '}
                  {t(FORMAT_KEYS[f])}
                </label>
              </div>
            ))}
            {SMALL_MOLECULE.has(format) && (
              <div id={smallNoteId} className="pymolv-dialog-note">
                {t('pymol:export_small_note')}
              </div>
            )}
          </fieldset>

          <div className="form-group">
            <label htmlFor={nameId}>{t('pymol:export_name_label')}</label>
            <div className="pymolv-name-row">
              <input
                id={nameId}
                type="text"
                value={stem}
                autoComplete="off"
                spellCheck={false}
                onChange={e => {
                  stemEdited.current = true
                  setStem(e.target.value)
                }}
              />
              <code>.{format}</code>
            </div>
          </div>

          {/* aria-disabled, not disabled: a disabled button drops the focus,
              and this one is pressed again after each export. */}
          <button
            ref={submitRef}
            type="submit"
            className="btn btn-primary btn-sm"
            aria-disabled={whyNot !== null}
            aria-describedby={whyNot !== null ? whyId : undefined}
          >
            {t('pymol:export_submit')}
          </button>
          {whyNot !== null && (
            <div id={whyId} className="pymolv-dialog-note">
              {whyNot}
            </div>
          )}
          {holdOpen && (
            <>
              <button type="button" className="btn btn-secondary btn-sm" aria-describedby={cancelNoteId} onClick={() => frame?.cancel()}>
                {t('pymol:busy_cancel')}
              </button>
              <div id={cancelNoteId} className="pymolv-dialog-note">
                {t('pymol:busy_cancel_note')}
              </div>
            </>
          )}
          {/* Mounted unconditionally, text changing: a live region that arrives
              with its content is not reliably announced. While a request is
              pending it also says whether the dialog may close, so the change
              from waiting to held (or back) is spoken — only the part that
              changed (aria-atomic false; role=status is atomic by default). An
              export that only waits has not started, so "書き出し中…" is left
              out then. */}
          <p role="status" aria-atomic="false" className="pymolv-dialog-note">
            {waitsBehindLoad || waitsInQueue ? null : status}
            {busyNote !== null && (
              <>
                {' '}
                <span id={busyNoteId}>{busyNote}</span>
              </>
            )}
          </p>
          <p role="alert" className="pymolv-error">
            {error}
          </p>
        </form>
      )}
    </Modal>
  )
}
