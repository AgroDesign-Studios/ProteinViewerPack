import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import Modal from '../../components/Modal'
import { saveBlobFile } from '../../lib/saveBlobFile'
import { formatSI } from '../../utils/formatSI'
import { defaultFileStem, exportFailureOf, fileStemAtPress } from './pymolExport'
import { LIMITS, MiB } from './pymolFrameProtocol'
import { exportDetailText as detailText } from './pymolCommandText'

/** Why a session's bytes are not saved (`checkPseFile`). */
export type PseCheck = { ok: true } | { ok: false; reason: 'empty' | 'too-large' }

/**
 * Whether bytes from PyMOL may be saved as a `.pse`: something, and no more
 * than the frame protocol's session cap. Not a parser: a session is PyMOL's
 * own pickle, written by PyMOL from what it holds now, and what keeps the
 * file harmless is where it comes from — the user's press, a page-made
 * name and extension, the user's own disk (see the dialog's note).
 */
export function checkPseFile(bytes: ArrayBuffer): PseCheck {
  if (bytes.byteLength === 0) return { ok: false, reason: 'empty' }
  if (bytes.byteLength > LIMITS.pseBytes) return { ok: false, reason: 'too-large' }
  return { ok: true }
}

/**
 * 「セッションを .pse で保存」 (owner 2026-11-14): everything now in PyMOL —
 * the structures, how they are shown, selections, scenes, settings — as one
 * session file desktop PyMOL opens, saved on this computer. Opened from
 * File's own entry.
 *
 * PT-3031 is why this is its own dialog with a warning. Desktop PyMOL opens a
 * `.pse` with an unrestricted unpickler, so a crafted one runs code there.
 * The bytes here are written fresh by PyMOL (`cmd.save`) from the live scene
 * — a session the frame loaded went through the restricted unpickler and lost
 * its movie and wizard first — and never a stored file handed on
 * (PT-3031 (b)). The
 * note says so, and asks the user to open received `.pse` files only from
 * people they trust.
 *
 * Both UI consultants (Opus 5.5, Codex astra; 2026-11-14) put the session in
 * File, apart from the molecule export: it is the scene, not a selection.
 *
 * Closing (PT-9125 item 5, PT-9126 items 2, 5, PT-9127 item 1, PT-9219
 * item 2): while the save itself is in flight and Stop can end it
 * (`stoppable`) the dialog holds open (× and Escape wait, with the reason)
 * and offers 「止める」. While the save still waits in PyMOL's queue, behind
 * a load or anything else, × and Escape close it: Stop would end the request
 * ahead of it — rebuilding PyMOL and losing changes since the last
 * checkpoint — where closing only withdraws the save. Which of the two it is
 * the dialog learns from `exportPse`'s `onSent` (`tellsSent`; the offline
 * file's bridge since PT-9232 item 2); a host that does not
 * tell holds while anything Stop can end runs. A dialog that goes before the
 * reply saves nothing and withdraws its request from PyMOL's queue if it
 * still waits there, which the page then says (`onWithdrawn`); a request
 * already sent runs to its end. Without `onStop` (no Stop to offer) it never
 * holds.
 * A failure of the save itself is told by its own message, never read as no
 * answer from a server (PT-9126 item 6); an over-cap session is told as one
 * (PT-9125 items 1, 2).
 *
 * `saveStep` (the offline HTML file's, owner 2026-11-17): given, the session
 * made is handed to it in place of the browser's download, and the dialog
 * shows what it draws — the file's name, size and where to save it — in
 * place of its form, under the same title; its `back` brings the form back.
 * Without it, the dialog downloads the session.
 */
export function PymolPseExportDialog(props: {
  /**
   * PyMOL's session as bytes (`requestExport('pse', { signal, onSent })`, or
   * the offline file's bridge). `signal`, aborted while the request still
   * waits, takes it out of the queue; `onSent` is called when the request
   * leaves the queue for PyMOL, by a host that says so with `tellsSent`. Null
   * while there is no PyMOL.
   */
  exportPse: ((signal: AbortSignal, onSent: () => void) => Promise<ArrayBuffer>) | null
  /** Whether `exportPse` calls `onSent`: the dialog can then tell a save that waits from one in flight. */
  tellsSent?: boolean
  ready: boolean
  /** Whether `onStop` would act now: a command or an export is in flight. */
  stoppable?: boolean
  /** Whether a load is in flight, which a pending save waits behind. */
  waiting?: boolean
  /** The controller's cancel (「止める」). */
  onStop?: () => void
  /** The page structure's PyMOL object, for the default file name. */
  objectName: string
  onClose: () => void
  /** The dialog went while its save still waited, and the request was taken out of PyMOL's queue. */
  onWithdrawn?: () => void
  /** Where the made session goes instead of the browser's download (the offline file's save step). */
  saveStep?: (file: { blob: Blob; name: string }, back: () => void) => ReactNode
}) {
  const { exportPse, tellsSent = false, ready, stoppable = false, waiting = false, onStop, objectName, onClose, onWithdrawn, saveStep } = props
  const { t } = useTranslation(['pymol'])
  const titleId = useId()
  const nameId = useId()
  const whyId = useId()
  const busyNoteId = useId()
  const cancelNoteId = useId()
  const [stem, setStem] = useState(() => defaultFileStem(objectName, 'session', new Date()))
  const stemEdited = useRef(false)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  // The save's own request has left the queue (`tellsSent` hosts only): the
  // state for what is shown, the ref for a close that comes before the
  // re-render does (PT-9244 item 6).
  const [sent, setSent] = useState(false)
  const sentRef = useRef(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  /** The session made, handed to `saveStep`; null while the form is shown. */
  const [prepared, setPrepared] = useState<{ blob: Blob; name: string } | null>(null)
  // A reply that lands after the dialog is gone is not saved, and a request
  // still waiting in PyMOL's queue then is withdrawn.
  const onScreen = useRef(false)
  const pending = useRef<AbortController | null>(null)
  useEffect(() => {
    onScreen.current = true
    return () => {
      onScreen.current = false
      pending.current?.abort()
    }
  }, [])

  const whyNot = !ready || exportPse === null ? t('pymol:export_why_not_ready') : busy ? t('pymol:export_why_busy') : null
  // Held open only while Stop can act on the save itself: a dialog that may
  // not close must offer a way out that works, and one whose save still waits
  // has one that costs nothing — closing withdraws it (PT-9219 item 2).
  const inFlight = !tellsSent || sent
  const holdOpen = busy && inFlight && stoppable && onStop !== undefined
  // The same test at the moment × or Escape is pressed. `onSent` is told
  // while the dialog still shows a save that waits, and a close before the
  // re-render would read that: the refs say what is true now. A save sent
  // since the last render holds even if `stoppable` was false then (it
  // waited behind a load): the request now in flight is the save itself,
  // which Stop ends; once rendered, `stoppable` decides again.
  const holdsNow = (): boolean => {
    if (!busyRef.current || onStop === undefined) return false
    if (!tellsSent) return stoppable
    return sentRef.current && (stoppable || !sent)
  }
  const close = () => {
    if (!holdsNow()) onClose()
  }
  const waitsBehindLoad = busy && !holdOpen && waiting
  const waitsInQueue = busy && !holdOpen && !waiting && !inFlight
  const busyNote = holdOpen
    ? t('pymol:export_why_close_busy', { stop: t('pymol:busy_cancel') })
    : waitsBehindLoad
      ? t('pymol:pse_export_waiting_note')
      : waitsInQueue
        ? t('pymol:pse_export_queued_note')
        : null

  // Stop leaves while it may hold the focus: the focus goes to 保存 instead
  // of falling to <body>, out of the dialog (as in PymolExportDialog).
  const submitRef = useRef<HTMLButtonElement>(null)
  const heldBefore = useRef(false)
  useLayoutEffect(() => {
    if (heldBefore.current && !holdOpen && (document.activeElement === null || document.activeElement === document.body)) {
      submitRef.current?.focus()
    }
    heldBefore.current = holdOpen
  }, [holdOpen])

  const failedText = (e: unknown): string => {
    const detail = detailText(t, e)
    return detail === '' ? t('pymol:export_err_failed_bare') : t('pymol:export_err_failed', { detail })
  }
  const tooLargeText = () => t('pymol:pse_export_err_too_large', { limit: formatSI(LIMITS.pseBytes / MiB, { fractionDigits: 0 }) })

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (exportPse === null || whyNot !== null || busyRef.current) return
    busyRef.current = true
    const { name, edited } = fileStemAtPress({ stem, edited: stemEdited.current, objectName, target: 'session', now: new Date() })
    stemEdited.current = edited
    setStem(name)
    const request = new AbortController()
    pending.current = request
    setBusy(true)
    sentRef.current = false
    setSent(false)
    setError('')
    setStatus(t('pymol:pse_export_working'))
    try {
      let bytes: ArrayBuffer
      try {
        bytes = await exportPse(request.signal, () => {
          if (pending.current !== request || !onScreen.current) return
          sentRef.current = true
          setSent(true)
        })
      } catch (err) {
        const failure = exportFailureOf(err)
        if (!onScreen.current) {
          if (failure.code === 'withdrawn') onWithdrawn?.()
          return
        }
        setStatus('')
        setError(
          failure.code === 'cancelled'
            ? t('pymol:export_err_cancelled')
            : // Only while the dialog stays on screen (a development Fast Refresh re-runs its effects).
              failure.code === 'withdrawn'
              ? t('pymol:pse_export_withdrawn')
              : failure.code === 'too-large'
                ? tooLargeText()
                : failedText(err),
        )
        return
      }
      if (!onScreen.current) return
      const check = checkPseFile(bytes)
      if (!check.ok) {
        setStatus('')
        setError(check.reason === 'too-large' ? tooLargeText() : t('pymol:pse_export_err_not_file'))
        return
      }
      const file = `${name}.pse`
      const blob = new Blob([bytes], { type: 'application/octet-stream' })
      if (saveStep !== undefined) {
        setStatus('')
        setPrepared({ blob, name: file })
        return
      }
      try {
        saveBlobFile(blob, file)
      } catch (err) {
        // The save's own message: a save talks to no server, so its error is
        // never read as no answer from one (PT-9126 item 6, PT-4140).
        setStatus('')
        setError(failedText(err instanceof Error ? err.message : err))
        return
      }
      setStatus(t('pymol:pse_export_done', { name: file, size: formatSI(bytes.byteLength / MiB, { fractionDigits: 1 }) }))
    } finally {
      if (pending.current === request) pending.current = null
      busyRef.current = false
      sentRef.current = false
      setBusy(false)
      setSent(false)
    }
  }

  return (
    <Modal maxWidth={560} labelledBy={titleId} onClose={holdOpen ? undefined : close}>
      {prepared !== null && saveStep !== undefined ? (
        <div className="pymolv-dialog">
          <div className="pymolv-dialog-head">
            <h2 id={titleId}>{t('pymol:pse_export_title')}</h2>
            <button type="button" className="btn btn-secondary btn-sm" aria-label={t('pymol:dialog_close')} onClick={close}>
              ×
            </button>
          </div>
          {saveStep(prepared, () => setPrepared(null))}
        </div>
      ) : (
        <form className="pymolv-dialog" onSubmit={e => void submit(e)}>
          <div className="pymolv-dialog-head">
            <h2 id={titleId}>{t('pymol:pse_export_title')}</h2>
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
          <p className="pymolv-dialog-note">{t('pymol:pse_export_note')}</p>
          <p className="pymolv-dialog-note pymolv-dialog-warn">{t('pymol:pse_export_warn')}</p>
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
              <code>.pse</code>
            </div>
          </div>
          {/* aria-disabled, not disabled: a disabled button drops the focus. */}
          <button
            ref={submitRef}
            type="submit"
            className="btn btn-primary btn-sm"
            aria-disabled={whyNot !== null}
            aria-describedby={whyNot !== null ? whyId : undefined}
          >
            {t('pymol:pse_export_submit')}
          </button>
          <p id={whyId} className="pymolv-dialog-note">
            {whyNot ?? ''}
          </p>
          {holdOpen && (
            <>
              <button type="button" className="btn btn-secondary btn-sm" aria-describedby={cancelNoteId} onClick={() => onStop?.()}>
                {t('pymol:busy_cancel')}
              </button>
              <div id={cancelNoteId} className="pymolv-dialog-note">
                {t('pymol:busy_cancel_note')}
              </div>
            </>
          )}
          {/* Mounted unconditionally, text changing; only the part that changed
              is spoken (aria-atomic false), as in PymolExportDialog. A save that
              only waits has not started, so the working text is left out then. */}
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
