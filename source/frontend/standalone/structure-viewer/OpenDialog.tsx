import { useEffect, useId, useRef, useState, type DragEvent, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { DialogBody, DialogFooterBar, DialogTitleBar } from '../../src/components/DialogBars'
import Modal from '../../src/components/Modal'
import { formatSI } from '../../src/utils/formatSI'
import { isFileOnIos } from './fileOnIos'
import { EngineTag } from './ExportDialog'
import { capOf, OPEN_ACCEPT, readStructureFile, type OpenRefusal, type StructureDoc } from './localFile'
import { OutLink } from './LicenceDialog'
import { downloadPdbEntry, normalizePdbId, RCSB_DOWNLOAD_BASE, RCSB_MAX_MS, RCSB_TIMEOUT_MS, type DownloadedFile } from './rcsb'

/** What an opened file does: shows instead of what is open, or is added to PyMOL as one more object. */
export type OpenMode = 'replace' | 'add'

const MiB = 1024 * 1024
const mib = (bytes: number) => formatSI(bytes / MiB, { fractionDigits: 0 })

/**
 * A file's size for the "selected" line, as PyMOL's export dialog says one
 * (DESIGN §2.5): KiB under 1 MiB, else MiB. A file that is not empty is never
 * "0.0 KiB": at least 0.1 (PT-9230 item 3).
 */
export function sizeText(bytes: number): string {
  if (bytes === 0) return `${formatSI(0, { fractionDigits: 0 })} KiB`
  return bytes < MiB ? `${formatSI(Math.max(bytes / 1024, 0.1), { fractionDigits: 1 })} KiB` : `${formatSI(bytes / MiB, { fractionDigits: 1 })} MiB`
}

/** Has the drag files in it (not text or a link)? */
const carriesFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes('Files')

/** What the dialog is busy with: reading a file, or downloading a PDB entry. */
type Busy = { kind: 'file' } | { kind: 'pdb'; id: string }

/**
 * The refusal on screen. `pdb`: it is about the ID field (described by it,
 * marked invalid). `download`: the ID a download got no connection for —
 * the way round is offered under it (`DownloadSteps`).
 */
type DialogError = { text: string; pdb: boolean; download?: string }

/**
 * The way round a download that got no connection (PT-9781): the entry's
 * file opened in the browser by a plain link — a navigation, not this page's
 * `fetch` — then read like any file with the area above. On an iPhone this
 * worked when the page, opened from Mail, reached nothing with its own
 * `fetch` (2026-11-18). The link's words are the address itself, so a
 * browser that will not follow it still shows what to type or copy. Outside
 * the alert (which stays one sentence, UI consult) and outside `aria-busy`.
 */
function DownloadSteps({ id }: { id: string }) {
  const { t } = useTranslation('htmlExport')
  const name = `${id}.cif`
  const ref = useRef<HTMLOListElement | null>(null)
  // Brought into view (the dialog body scrolls on a phone); the focus is not moved here.
  useEffect(() => {
    ref.current?.scrollIntoView?.({ block: 'nearest' })
  }, [id])
  return (
    <ol ref={ref} className="sav-open-steps">
      <li>
        {t('htmlExport:sa_pdb_fallback_download', { name })}{' '}
        <OutLink href={RCSB_DOWNLOAD_BASE + encodeURIComponent(name)}>{`files.rcsb.org/download/${name}`}</OutLink>
      </li>
      <li>{t('htmlExport:sa_pdb_fallback_open')}</li>
    </ol>
  )
}

/**
 * 「開く」 in the offline structure file (owner 2026-11-14): one dialog for a
 * file from this computer — the drop area, a real button that opens the
 * system's file picker and takes a drop — and for an entry from the PDB,
 * downloaded from RCSB by its ID (`rcsb.ts`). While PyMOL is up, the file
 * may be added to it instead of replacing what is shown (a `.pse` opens
 * only as a replace; the light edition opens none). That choice comes
 * first, above the drop area, in "Includes PyMOL™" mode's colours with its
 * tag (owner 2026-11-20: 「ほかの項目と違うことを目立たせる」; UI consult,
 * Opus 5.5 and Codex astra): a file chosen here opens at once, so what it
 * does must be in view before, and it applies to the file and the PDB ID alike.
 *
 * A file chosen or dropped here opens at once: the choice of what it does
 * was in view. A file dropped on the page outside this dialog arrives
 * `staged` — chosen, not opened — and opens with 「開く」, because the
 * person dropping it has not seen that choice.
 *
 * Every refusal — the kind of file, the size, an empty file, a session in
 * the light edition, to add, or where PyMOL cannot run (`pseRefusal`), a
 * malformed ID, an ID RCSB does not have, no connection, no answer in time —
 * is said here (role="alert") and the dialog stays. No connection at all
 * also offers the way round it, the entry downloaded by the browser
 * (`DownloadSteps`, PT-9781); a page opened from a file on an iPhone or iPad
 * says why that is likely, and its PDB note says so before the press. While a file is read or
 * downloaded the dialog is busy and 「中止」 stops it; the progress line and
 * the alert sit outside the busy part (`aria-busy` would hold back their
 * announcements, PT-9187). A document that passed every check goes to
 * `onOpen`, which closes the dialog and says what opened in the page's own
 * live region; what it does — replace or add — is the choice shown when it
 * arrives, not when it was asked for (PT-9186 item 2) — but an add chosen
 * while PyMOL was up is refused, never made a replace, when PyMOL is no
 * longer up as the file arrives (PT-9238 item 2). Closing the dialog
 * drops a read or a download still running (PT-9186 item 1).
 *
 * The focus never falls out of the dialog: 「PDB から読み込む」 and 「開く」
 * stay focusable while busy (`aria-disabled`, a press does nothing), 「中止」
 * hands it back to what was stopped, and a failed download to the ID field
 * (PT-9188 item 5, PT-9189 item 1) — except one that got no connection,
 * whose ID was not at fault: there 「PDB から読み込む」 takes it, so a phone's
 * keyboard does not come back over the way round (PT-9781).
 */
export function OpenDialog(props: {
  /** The full edition: it opens PyMOL sessions too. */
  full: boolean
  /** PyMOL is up, so a file may be added to it. */
  canAdd: boolean
  initialMode: OpenMode
  /** A file dropped on the page, chosen but not opened yet. */
  staged: File | null
  /** Why a `.pse` cannot open here (this browser cannot run PyMOL), or null. */
  pseRefusal?: string | null
  onOpen: (doc: StructureDoc, mode: OpenMode) => void
  onClose: () => void
  /** RCSB's download (tests replace it). */
  download?: typeof downloadPdbEntry
}) {
  const { full, canAdd, initialMode, onClose, pseRefusal = null, download = downloadPdbEntry } = props
  const { t } = useTranslation(['htmlExport', 'pymol'])
  const titleId = useId()
  const formatsId = useId()
  const pdbFieldId = useId()
  const pdbNoteId = useId()
  const pdbIosNoteId = useId()
  const errorId = useId()
  const modeNoteId = useId()
  const modeScopeId = useId()
  const [mode, setMode] = useState<OpenMode>(canAdd ? initialMode : 'replace')
  const [staged, setStaged] = useState<File | null>(props.staged)
  const [busy, setBusy] = useState<Busy | null>(null)
  const [error, setError] = useState<DialogError | null>(null)
  const [notice, setNotice] = useState('')
  const [pdbInput, setPdbInput] = useState('')
  const [over, setOver] = useState(false)
  const pickerRef = useRef<HTMLInputElement | null>(null)
  const pdbRef = useRef<HTMLInputElement | null>(null)
  const loadRef = useRef<HTMLButtonElement | null>(null)
  const zoneRef = useRef<HTMLButtonElement | null>(null)
  const openStagedRef = useRef<HTMLButtonElement | null>(null)
  const stopRef = useRef<HTMLButtonElement | null>(null)
  /** The latest request: a read or a download that a newer one, 「中止」 or closing overtook is dropped. */
  const seq = useRef(0)
  const abort = useRef<AbortController | null>(null)
  /** The replace/add choice as shown now, read when a read or download finishes. */
  const effectiveRef = useRef<OpenMode>('replace')
  effectiveRef.current = canAdd ? mode : 'replace'
  /** A page opened from a file on an iPhone or iPad: its downloads may get no connection (PT-9781). */
  const fileOnIos = isFileOnIos()
  /**
   * What a read or download that lands is judged by and handed to: this
   * render's, not the one that started it (a download takes up to its
   * deadline, and the page may have changed meanwhile; PT-9230 item 7).
   */
  const latestRef = useRef({ onOpen: props.onOpen, full, pseRefusal, canAdd, mode })
  latestRef.current = { onOpen: props.onOpen, full, pseRefusal, canAdd, mode }
  /**
   * The replace/add choice was on screen at some time while the running read
   * or download ran, not only when it started (PT-9249 item 2): PyMOL may
   * come up during a download and the user pick 「追加」 then.
   */
  const addSeenRef = useRef(false)
  if (busy !== null && canAdd) addSeenRef.current = true

  const busyRef = useRef<Busy | null>(null)
  busyRef.current = busy
  // A second drop on the page while the dialog is open replaces the chosen
  // file. One dropped while a read or download runs is the newer choice: what
  // was running is dropped, and the new file waits for 「開く」, said so
  // (PT-9188 item 4) — never opened over, never lost when the old one lands.
  useEffect(() => {
    if (props.staged === null) return
    setStaged(props.staged)
    // An alert about the file this one replaces (a drop refused while busy)
    // no longer holds (PT-9228 item 6).
    setError(null)
    if (busyRef.current !== null) {
      seq.current++
      abort.current?.abort()
      setBusy(null)
      setNotice(t('htmlExport:sa_open_drop_replaced'))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a new drop only
  }, [props.staged])
  // A staged file waits for 「開く」: it takes focus once it is there.
  useEffect(() => {
    if (staged !== null) openStagedRef.current?.focus()
  }, [staged])
  // Leaving drops a read still running (it cannot be aborted) and stops a download.
  useEffect(
    () => () => {
      seq.current++
      abort.current?.abort()
    },
    [],
  )

  const refusalText = (why: OpenRefusal): string => {
    switch (why.code) {
      case 'format':
        return t('htmlExport:sa_open_err_format', { ext: why.ext })
      case 'too-large':
        return t('htmlExport:sa_open_err_too_large', { limit: formatSI(why.limitMiB, { fractionDigits: 0 }) })
      case 'empty':
        return t('htmlExport:sa_open_err_empty')
      case 'unreadable':
        return t('htmlExport:sa_open_err_unreadable', { detail: why.detail })
    }
  }

  /**
   * Ends the busy state. 「中止」 goes with it: when it had the focus, the
   * focus goes to what was busy — the ID field for a download, else the drop
   * area — so it never falls to the page (PT-9229 item 4, PT-9230 item 2).
   */
  const endBusy = (pdb: boolean) => {
    const onStop = stopRef.current !== null && document.activeElement === stopRef.current
    setBusy(null)
    if (onStop) (pdb ? pdbRef : zoneRef).current?.focus()
  }

  /**
   * Reads one file (or a downloaded entry) and hands it on, or says why not.
   * `continued`: the read of an entry fromPdb downloaded, one request with
   * the download (whether the choice was seen counts from its start).
   */
  const accept = async (file: File | DownloadedFile, pdbId: string | null, continued = false) => {
    if (!continued) addSeenRef.current = latestRef.current.canAdd
    const mine = ++seq.current
    setError(null)
    setNotice('')
    setBusy(pdbId === null ? { kind: 'file' } : { kind: 'pdb', id: pdbId })
    const read = await readStructureFile(file)
    if (mine !== seq.current) return
    endBusy(pdbId !== null)
    if (!read.ok) {
      setError({ text: refusalText(read.why), pdb: pdbId !== null })
      return
    }
    const doc: StructureDoc = pdbId === null ? read.doc : { ...read.doc, pdbId }
    const effective = effectiveRef.current
    const now = latestRef.current
    if (doc.ext === 'pse' && !now.full) {
      setError({ text: t('htmlExport:sa_open_err_pse_light'), pdb: false })
      return
    }
    if (doc.ext === 'pse' && now.pseRefusal !== null) {
      setError({ text: now.pseRefusal, pdb: false })
      return
    }
    const seen = addSeenRef.current
    // A session is never added: refused by the user's choice, not by what
    // the choice became (PT-9249 item 5: once PyMOL left, `effective` read
    // 'replace' and the not-ready text below promised an add a .pse never gets).
    if (doc.ext === 'pse' && (effective === 'add' || (seen && now.mode === 'add'))) {
      setError({ text: t('htmlExport:sa_open_err_add_pse'), pdb: false })
      return
    }
    // 「追加」 is the user's choice, but PyMOL left ready while the file
    // was read or downloaded and the choice went from view: said, never
    // turned into a replace (PT-9238 item 2).
    if (seen && now.mode === 'add' && !now.canAdd) {
      setError({ text: t('htmlExport:sa_open_err_add_not_ready', { name: doc.name }), pdb: pdbId !== null })
      return
    }
    // A file dropped while this one was read stays chosen (PT-9188 item 4).
    setStaged(cur => (cur === file ? null : cur))
    now.onOpen(doc, effective)
  }

  const fromPdb = async (e: FormEvent) => {
    e.preventDefault()
    if (busy !== null) return
    const id = normalizePdbId(pdbInput)
    if (id === null) {
      seq.current++
      setNotice('')
      setError({ text: t('htmlExport:sa_pdb_err_id'), pdb: true })
      pdbRef.current?.focus()
      return
    }
    abort.current?.abort()
    const request = new AbortController()
    abort.current = request
    const mine = ++seq.current
    addSeenRef.current = latestRef.current.canAdd
    setError(null)
    setNotice('')
    setBusy({ kind: 'pdb', id })
    const got = await download(id, request.signal)
    if (mine !== seq.current) return
    if (!got.ok) {
      endBusy(true)
      const why = got.why
      if (why.code === 'aborted') setNotice(t('htmlExport:sa_open_stopped'))
      else {
        if (why.code === 'not-found') setError({ text: t('htmlExport:sa_pdb_err_not_found', { id }), pdb: true })
        else if (why.code === 'http') setError({ text: t('htmlExport:sa_pdb_err_http', { id, status: String(why.status) }), pdb: true })
        else if (why.code === 'timeout') setError({ text: t('htmlExport:sa_pdb_err_timeout', { id, seconds: String(RCSB_TIMEOUT_MS / 1000) }), pdb: true })
        else if (why.code === 'too-slow') setError({ text: t('htmlExport:sa_pdb_err_too_slow', { id, minutes: String(RCSB_MAX_MS / 60_000) }), pdb: true })
        else {
          // No connection: the ID is not at fault, and the way round is offered (PT-9781).
          setError({ text: t(fileOnIos ? 'htmlExport:sa_pdb_err_network_file_ios' : 'htmlExport:sa_pdb_err_network'), pdb: false, download: id })
          loadRef.current?.focus()
          return
        }
        // Back to the field, which the alert describes.
        pdbRef.current?.focus()
      }
      return
    }
    await accept(got.file, id, true)
  }

  const stop = () => {
    const was = busy
    abort.current?.abort()
    seq.current++
    setBusy(null)
    setNotice(t('htmlExport:sa_open_stopped'))
    // 「中止」 goes with the busy state: the focus goes back to what was stopped.
    if (was?.kind === 'pdb') pdbRef.current?.focus()
    else zoneRef.current?.focus()
  }

  const pick = () => {
    if (busy === null) pickerRef.current?.click()
  }
  const onZoneDragOver = (e: DragEvent) => {
    if (!carriesFiles(e)) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
    setOver(true)
  }
  const onZoneDrop = (e: DragEvent) => {
    if (e.dataTransfer.files.length === 0) return
    e.preventDefault()
    // Opened here: the page's own drop handler (which stages) must not see it too.
    e.stopPropagation()
    setOver(false)
    if (busy === null) void accept(e.dataTransfer.files[0], null)
    // Never swallowed without a word (PT-9188 item 4): a refusal, beside the progress line.
    else setError({ text: t('htmlExport:sa_open_drop_busy'), pdb: false })
  }

  const busyText = busy === null ? '' : busy.kind === 'pdb' ? t('htmlExport:sa_pdb_busy', { id: busy.id }) : t('htmlExport:sa_open_busy')

  return (
    <Modal maxWidth={560} flush labelledBy={titleId} onClose={onClose}>
      <DialogTitleBar
        title={<span id={titleId}>{t('htmlExport:sa_open_title')}</span>}
        background="var(--blue-text)"
        onClose={onClose}
        closeLabel={t('pymol:dialog_close')}
      />
      <DialogBody>
        <div className="sav-open">
          <div className="sav-open-inputs" aria-busy={busy !== null}>
            {/* First, before anything that opens at once; set apart in "Includes PyMOL™" mode's colours. */}
            {canAdd && (
              <fieldset className="sav-open-mode sav-open-mode--pymol" aria-describedby={full ? `${modeScopeId} ${modeNoteId}` : modeScopeId}>
                <legend>
                  {/* The legend names the mode in words: the tag is for the eye only. */}
                  <span className="sav-open-mode-tag" aria-hidden="true">
                    <EngineTag engine="pymol" />
                  </span>
                  <span>{t('htmlExport:sa_open_mode_legend')}</span>
                </legend>
                <p id={modeScopeId} className="sav-open-note sav-open-mode-scope">
                  {t('htmlExport:sa_open_mode_scope')}
                </p>
                <label className={`pymolv-choice sav-open-choice${mode === 'replace' ? ' is-selected' : ''}`}>
                  <input type="radio" name="sav-open-mode" value="replace" checked={mode === 'replace'} onChange={() => setMode('replace')} />{' '}
                  {t('htmlExport:sa_open_mode_replace')}
                </label>
                <label className={`pymolv-choice sav-open-choice${mode === 'add' ? ' is-selected' : ''}`}>
                  <input type="radio" name="sav-open-mode" value="add" checked={mode === 'add'} onChange={() => setMode('add')} />{' '}
                  {t('htmlExport:sa_open_mode_add')}
                </label>
                {full && (
                  <p id={modeNoteId} className="sav-open-note">
                    {t('htmlExport:sa_open_mode_note')}
                  </p>
                )}
              </fieldset>
            )}
            <button
              ref={zoneRef}
              type="button"
              className={`sav-dropzone${over ? ' is-over' : ''}${staged !== null ? ' is-staged' : ''}`}
              aria-describedby={formatsId}
              onClick={pick}
              onDragEnter={onZoneDragOver}
              onDragOver={onZoneDragOver}
              onDragLeave={() => setOver(false)}
              onDrop={onZoneDrop}
            >
              <span className="sav-dropzone-title">{t('htmlExport:sa_open_drop_title')}</span>
              <span className="sav-dropzone-sub">
                {staged !== null ? t('htmlExport:sa_open_staged', { name: staged.name, size: sizeText(staged.size) }) : t('htmlExport:sa_open_drop_sub')}
              </span>
            </button>
            <input
              ref={pickerRef}
              type="file"
              accept={OPEN_ACCEPT}
              hidden
              onChange={e => {
                const f = e.target.files?.[0]
                // The same file chosen again must fire again.
                e.target.value = ''
                if (f !== undefined) void accept(f, null)
              }}
            />
            <p id={formatsId} className="sav-open-formats">
              {full
                ? t('htmlExport:sa_open_formats_full', { limit: mib(capOf('pdb')), pse: mib(capOf('pse')) })
                : t('htmlExport:sa_open_formats_light', { limit: mib(capOf('pdb')) })}
            </p>

            <form className="sav-pdb form-group" onSubmit={e => void fromPdb(e)} noValidate>
              <label htmlFor={pdbFieldId}>{t('htmlExport:sa_pdb_label')}</label>
              <div className="sav-pdb-row">
                <input
                  ref={pdbRef}
                  id={pdbFieldId}
                  type="text"
                  value={pdbInput}
                  placeholder="25HN"
                  maxLength={16}
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  aria-invalid={error?.pdb === true}
                  aria-describedby={`${pdbNoteId}${fileOnIos ? ` ${pdbIosNoteId}` : ''}${error?.pdb ? ` ${errorId}` : ''}`}
                  onChange={e => setPdbInput(e.target.value)}
                />
                {/* Focusable while busy: a disabled button would drop the focus to the page. */}
                <button ref={loadRef} type="submit" className="btn btn-secondary" aria-disabled={busy !== null}>
                  {t('htmlExport:sa_pdb_load')}
                </button>
              </div>
              <p id={pdbNoteId} className="sav-open-note">
                {t('htmlExport:sa_pdb_note')}
              </p>
              {/* Said before the press where it may fail; nothing is asked of the network to know it. */}
              {fileOnIos && (
                <p id={pdbIosNoteId} className="sav-open-note">
                  {t('htmlExport:sa_pdb_note_file_ios')}
                </p>
              )}
            </form>
          </div>

          <p role="status" className="sav-open-status">
            {busyText || notice}
          </p>
          <p id={errorId} role="alert" className="sav-open-error">
            {error?.text ?? ''}
          </p>
          {error?.download !== undefined && <DownloadSteps id={error.download} />}
        </div>
      </DialogBody>
      <DialogFooterBar>
        {busy !== null && (
          <button ref={stopRef} type="button" className="btn btn-secondary" onClick={stop}>
            {t('htmlExport:sa_open_stop')}
          </button>
        )}
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          {t('htmlExport:sa_close')}
        </button>
        {staged !== null && (
          <button
            ref={openStagedRef}
            type="button"
            className="btn btn-primary"
            aria-disabled={busy !== null}
            onClick={() => {
              if (busy === null) void accept(staged, null)
            }}
          >
            {t('htmlExport:sa_open_staged_submit')}
          </button>
        )}
      </DialogFooterBar>
    </Modal>
  )
}
