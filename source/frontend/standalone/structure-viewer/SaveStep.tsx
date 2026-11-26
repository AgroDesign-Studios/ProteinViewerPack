import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import Modal from '../../src/components/Modal'
import { formatSI } from '../../src/utils/formatSI'
import { formatName } from './localFile'
import { extensionOf, pickerBlock, saveFile, SaveFileError, type PickerBlock, type PreparedFile, type SaveMode } from './saveFile'

export type { PreparedFile }

const KiB = 1024
const MiB = 1024 * 1024

/** A file's size as the step shows it: kB under 1 MB, MB with one decimal from there. */
export function sizeText(bytes: number, t: (key: string, vars?: Record<string, unknown>) => string): string {
  return bytes < MiB
    ? t('htmlExport:sa_size_kb', { n: formatSI(Math.max(bytes, 1) / KiB, { fractionDigits: bytes < 10 * KiB ? 1 : 0 }) })
    : t('htmlExport:sa_size_mb', { n: formatSI(bytes / MiB, { fractionDigits: 1 }) })
}

/** The formats the app saves that are not structure files, by their extension. */
const OTHER_FORMAT: Readonly<Record<string, string>> = { html: 'HTML', png: 'PNG', wrl: 'VRML', pse: 'PSE' }

/** A file's format, its common name and its extension: 「PNG (.png)」. */
export function formatText(name: string): string {
  const ext = extensionOf(name)
  if (ext === '') return ''
  const label = Object.prototype.hasOwnProperty.call(OTHER_FORMAT, ext) ? OTHER_FORMAT[ext] : formatName(ext)
  return `${label} (.${ext})`
}

/** The preview's longest side: a larger picture is shown from a copy this size (the original is saved). */
export const PREVIEW_MAX_SIDE = 640

/** A picture's preview: the address it is drawn from and the picture's own pixels. */
export interface PicturePreview {
  url: string
  w: number
  h: number
}

/**
 * A preview of the picture `blob` (owner 2026-11-17: 画像のサムネイルも表示):
 * its pixels, and an object URL of the picture itself, or — longer than
 * `PREVIEW_MAX_SIDE` on a side — of a copy scaled down to it, so a 4K ray
 * trace is not drawn whole in a 320 px box. The decoded bitmap is closed once
 * it is drawn; the caller revokes the URL.
 */
export async function makePicturePreview(blob: Blob, maxSide = PREVIEW_MAX_SIDE): Promise<PicturePreview> {
  const bitmap = await createImageBitmap(blob)
  try {
    const { width: w, height: h } = bitmap
    if (w < 1 || h < 1) throw new Error('empty picture')
    const k = maxSide / Math.max(w, h)
    if (k >= 1) return { url: URL.createObjectURL(blob), w, h }
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(w * k))
    canvas.height = Math.max(1, Math.round(h * k))
    const ctx = canvas.getContext('2d')
    if (ctx === null) throw new Error('no 2D canvas')
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const small = await new Promise<Blob | null>(done => canvas.toBlob(done, 'image/png'))
    if (small === null) throw new Error('the copy could not be made')
    return { url: URL.createObjectURL(small), w, h }
  } finally {
    bitmap.close()
  }
}

/**
 * The preview of `blob` while `on`: null until it is made, and null for good
 * when it cannot be (the file still saves). Its URL is let go when the file
 * changes or the step closes, and one made after that is let go unseen.
 */
function usePicturePreview(blob: Blob, on: boolean): PicturePreview | null {
  const [preview, setPreview] = useState<PicturePreview | null>(null)
  useEffect(() => {
    setPreview(null)
    if (!on) return
    let live = true
    let url: string | null = null
    makePicturePreview(blob).then(
      p => {
        if (!live) {
          URL.revokeObjectURL(p.url)
          return
        }
        url = p.url
        setPreview(p)
      },
      () => undefined,
    )
    return () => {
      live = false
      if (url !== null) URL.revokeObjectURL(url)
    }
  }, [blob, on])
  return preview
}

const BLOCK_KEY: Readonly<Record<PickerBlock, string>> = {
  browser: 'htmlExport:sa_save_pick_browser',
  frame: 'htmlExport:sa_save_pick_frame',
}

/**
 * The save step (owner 2026-11-17; UI consult, Claude Opus 5.5 and Codex
 * astra): the last step of every save in the app, shown in the dialog that
 * made the file, in place of its form — never a second dialog over it. The
 * file is made before this is shown (the heavy part first); here it is named,
 * with its format and size, above two buttons:
 *
 * - 「ブラウザ既定の場所に保存」, the main one, every time: the browser's own
 *   download — said as started, not saved, since the browser finishes it;
 * - 「場所を選んで保存…」: the browser's save picker, asked in the press. Where
 *   the browser cannot (no picker: Firefox, Safari, iOS; or the page shown
 *   inside another site's page), it is drawn disabled with the reason always
 *   in sight under it, and the default one still saves.
 *
 * Closing the picker leaves everything as it was, the file kept and nothing
 * said. A refusal or a failed write is said in the alert line, and both
 * buttons stay. The choice is not remembered: the browser's default is the
 * main button the next time too. `onBack` (when given) goes back to the form,
 * its settings as they were. The step takes the focus by its first line, not
 * a button, so a key still held from the press that made the file saves
 * nothing.
 *
 * `preview` (a picture's save: the screenshot and the ray trace, owner
 * 2026-11-17; UI consult, Claude Opus 5.5 and Codex astra): the picture
 * itself above its name, centred, whole (`object-fit: contain`) in at most
 * 320 × 200 px (a phone: the step's width, 160 px high), on a faint
 * checkerboard where it is see-through — the page's, not the picture's. It
 * is made after the step shows (`makePicturePreview`): the buttons never wait
 * for it, and a picture that cannot be previewed still saves.
 */
export function SaveStep(props: {
  file: PreparedFile
  /** Show the picture the file is (a PNG) above its name. */
  preview?: boolean
  /** Back to the form that made the file. */
  onBack?: () => void
  /** The back button's words, where 「設定に戻る」 does not fit. */
  backLabel?: string
  /** Told of each save that went through. */
  onSaved?: (how: 'started' | 'saved', name: string) => void
  /** The window whose picker is asked (tests hand in their own). */
  win?: Window
}) {
  const { file, onBack, backLabel, onSaved, preview = false, win = window } = props
  const { t } = useTranslation('htmlExport')
  const shot = usePicturePreview(file.blob, preview)
  const readyId = useId()
  const whyId = useId()
  const readyRef = useRef<HTMLParagraphElement | null>(null)
  const [block] = useState(() => pickerBlock(win))
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const onScreen = useRef(true)
  useEffect(() => {
    onScreen.current = true
    readyRef.current?.focus()
    return () => {
      onScreen.current = false
    }
  }, [])

  const save = (mode: SaveMode) => {
    if (busyRef.current || (mode === 'pick' && block !== null)) return
    busyRef.current = true
    setBusy(true)
    setError('')
    // Called at once, in the press: the picker is asked before anything is awaited.
    const done = saveFile(file, mode, win)
    void done
      .then(out => {
        if (!onScreen.current || out.kind === 'cancelled') return
        setStatus(out.kind === 'started' ? t('htmlExport:sa_save_started', { file: out.name }) : t('htmlExport:sa_save_saved', { file: out.name }))
        onSaved?.(out.kind, out.name)
      })
      .catch((e: unknown) => {
        if (!onScreen.current) return
        setStatus('')
        const detail = e instanceof SaveFileError ? e.detail : String(e).slice(0, 200)
        setError(e instanceof SaveFileError && e.code === 'refused' ? t('htmlExport:sa_save_pick_refused', { detail }) : t('htmlExport:sa_save_write_err', { detail }))
      })
      .finally(() => {
        busyRef.current = false
        if (onScreen.current) setBusy(false)
      })
  }

  const format = formatText(file.name)
  return (
    <div className="sav-save" role="group" aria-labelledby={readyId}>
      <p id={readyId} ref={readyRef} tabIndex={-1} className="sav-save-ready">
        {t('htmlExport:sa_save_ready')}
      </p>
      {shot !== null && (
        <div className="sav-save-preview">
          <img src={shot.url} alt={t('htmlExport:sa_save_preview_alt', { w: String(shot.w), h: String(shot.h) })} />
        </div>
      )}
      <dl className="sav-save-file">
        <div>
          <dt>{t('htmlExport:sa_save_name')}</dt>
          <dd>
            <code>{file.name}</code>
          </dd>
        </div>
        {format !== '' && (
          <div>
            <dt>{t('htmlExport:sa_save_format')}</dt>
            <dd>{format}</dd>
          </div>
        )}
        <div>
          <dt>{t('htmlExport:sa_save_size')}</dt>
          <dd>
            {sizeText(file.blob.size, t)}
            {file.detail !== undefined && file.detail !== '' && <span className="sav-save-detail"> · {file.detail}</span>}
          </dd>
        </div>
      </dl>
      <div className="sav-save-actions">
        {/* aria-disabled, not disabled: a disabled button drops the focus and hides its reason. */}
        <button type="button" className="btn btn-primary sav-save-btn" aria-disabled={busy ? true : undefined} onClick={() => save('default')}>
          {t('htmlExport:sa_save_default')}
        </button>
        <button
          type="button"
          className="btn btn-secondary sav-save-btn"
          aria-disabled={block !== null || busy ? true : undefined}
          aria-describedby={block !== null ? whyId : undefined}
          onClick={() => save('pick')}
        >
          {t('htmlExport:sa_save_pick')}
        </button>
      </div>
      {block !== null && (
        <p id={whyId} className="sav-save-why">
          {t(BLOCK_KEY[block])}
        </p>
      )}
      {onBack !== undefined && (
        <button type="button" className="btn btn-secondary btn-sm sav-save-back" onClick={onBack}>
          {backLabel ?? t('htmlExport:sa_save_back')}
        </button>
      )}
      <p role="status" className="pymolv-dialog-note sav-save-status">
        {busy ? t('htmlExport:sa_save_busy') : status}
      </p>
      <p role="alert" className="pymolv-error">
        {error}
      </p>
    </div>
  )
}

/**
 * The save step in a dialog of its own, for a file no form made: the pictures
 * of 「画像出力」 (the screenshot at once, the ray trace once its form has shut).
 */
export function SaveDialog(props: { title: string; file: PreparedFile; onClose: () => void; preview?: boolean; win?: Window }) {
  const { title, file, onClose, preview, win } = props
  const { t } = useTranslation(['htmlExport', 'pymol'])
  const titleId = useId()
  return (
    <Modal maxWidth={520} labelledBy={titleId} onClose={onClose}>
      <div className="pymolv-dialog">
        <div className="pymolv-dialog-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="btn btn-secondary btn-sm" aria-label={t('pymol:dialog_close')} onClick={onClose}>
            ×
          </button>
        </div>
        <SaveStep file={file} preview={preview} win={win} />
      </div>
    </Modal>
  )
}
