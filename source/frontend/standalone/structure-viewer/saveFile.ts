/**
 * Every file the offline app saves (owner 2026-11-17: 「ダウンロードできる場所を
 * モーダルで自由に選べるように…デフォルトは、ブラウザデフォルト」): the HTMLapp
 * copy, the pictures, the structure file, VRML and PyMOL's files. Each is made
 * first, whole, and then saved one of two ways the person picks in the save
 * step (`SaveStep.tsx`):
 *
 * - `default`: the browser's own download (`saveBlobFile`), to its default
 *   place — the main way, every time (the choice is never remembered);
 * - `pick`: the browser's save picker (`showSaveFilePicker`), the name and
 *   type suggested, where the person chooses the folder.
 *
 * Whether the picker can be offered is read from the browser, never from the
 * OS or the page's address: the API is there, the page is a secure context
 * (a double-clicked file:// page is one in Chromium), and the page is not in
 * a frame of another origin (the app can run in a sandboxed frame, where
 * Chromium refuses it). What the browser still refuses when asked
 * (`SecurityError`, `NotAllowedError`) is told as a refusal; closing the
 * picker (`AbortError`) is no failure at all.
 *
 * The picker must be asked in the press itself (the browser's user-activation
 * rule): `saveFile` calls it before its first `await`, so a click handler that
 * calls `saveFile` at once is in time.
 */
import { saveBlobFile } from '../../src/lib/saveBlobFile'

/** A file made and waiting to be saved: its bytes and the name it is saved under. */
export interface PreparedFile {
  blob: Blob
  name: string
  /** A line about it shown with its size, the picture's pixels say. */
  detail?: string
}

export type SaveMode = 'default' | 'pick'

/** What a save did: the browser's download started, the file was written where chosen, or the picker was closed. */
export type SaveOutcome = { kind: 'started'; name: string } | { kind: 'saved'; name: string } | { kind: 'cancelled' }

/** Why choosing a place is not offered: this browser has no save picker, or the page is shown inside another site's page. */
export type PickerBlock = 'browser' | 'frame'

/** A save that went wrong: the picker was refused, or the file could not be written. `detail` is the browser's own words. */
export class SaveFileError extends Error {
  readonly code: 'refused' | 'write'
  readonly detail: string
  constructor(code: 'refused' | 'write', detail: string) {
    super(`${code}: ${detail}`)
    this.code = code
    this.detail = detail
  }
}

interface WritableLike {
  write(data: Blob): Promise<void>
  close(): Promise<void>
  abort?(reason?: unknown): Promise<void>
}
interface FileHandleLike {
  name?: unknown
  createWritable(): Promise<WritableLike>
}
interface PickerOptions {
  suggestedName?: string
  types?: { description?: string; accept: Record<string, string[]> }[]
}
type SaveWindow = Window & { showSaveFilePicker?: (options?: PickerOptions) => Promise<FileHandleLike> }

/**
 * Can this page offer 「場所を選んで保存」? null when it can; else why not.
 * A frame whose parent is of another origin (or sandboxed) cannot read the
 * parent's address: that is the test, as Chromium refuses the picker there.
 */
export function pickerBlock(win: Window = window): PickerBlock | null {
  const w = win as SaveWindow
  if (typeof w.showSaveFilePicker !== 'function' || win.isSecureContext !== true) return 'browser'
  try {
    const top = win.top
    if (top !== null && top !== win.self) void top.location.href
  } catch {
    return 'frame'
  }
  return null
}

const isAbort = (e: unknown): boolean => e instanceof DOMException && e.name === 'AbortError'

/** The browser's words for a failure, on one line and short. */
export const failureDetail = (e: unknown): string =>
  (e instanceof Error ? (e.name && e.name !== 'Error' ? `${e.name}: ${e.message}` : e.message) : String(e)).replace(/\s+/g, ' ').trim().slice(0, 200)

/** The extension after the last dot, lower case, when it is one the picker takes ('' when none). */
export function extensionOf(name: string): string {
  const m = /\.([A-Za-z0-9]{1,15})$/.exec(name)
  return m === null ? '' : m[1].toLowerCase()
}

/** A MIME type the picker takes as a key: the blob's own without its parameters, or a generic one. */
function pickerMime(blob: Blob): string {
  const base = blob.type.split(';')[0].trim().toLowerCase()
  return /^[a-z]+\/[a-z0-9.+-]+$/.test(base) ? base : 'application/octet-stream'
}

/** The picker's suggestion: the name, and its type so the dialog keeps the extension. */
function pickerOptions(file: PreparedFile, withTypes: boolean): PickerOptions {
  const ext = extensionOf(file.name)
  if (!withTypes || ext === '') return { suggestedName: file.name }
  return { suggestedName: file.name, types: [{ description: ext.toUpperCase(), accept: { [pickerMime(file.blob)]: [`.${ext}`] } }] }
}

/**
 * Saves `file` the way the person chose. `default` starts the browser's
 * download and resolves at once; `pick` opens the save picker — asked before
 * anything is awaited — writes the file where it was put, and resolves with
 * the name chosen there. A closed picker resolves `cancelled`, the file
 * untouched; a refusal or a failed write rejects with a `SaveFileError`, and
 * a half-written file is thrown away (`abort`).
 */
export async function saveFile(file: PreparedFile, mode: SaveMode, win: Window = window): Promise<SaveOutcome> {
  if (mode === 'default') {
    try {
      saveBlobFile(file.blob, file.name)
    } catch (e) {
      throw new SaveFileError('write', failureDetail(e))
    }
    return { kind: 'started', name: file.name }
  }
  const w = win as SaveWindow
  if (typeof w.showSaveFilePicker !== 'function') throw new SaveFileError('refused', 'showSaveFilePicker is not available')
  let handle: FileHandleLike
  try {
    handle = await w.showSaveFilePicker(pickerOptions(file, true))
  } catch (e) {
    if (isAbort(e)) return { kind: 'cancelled' }
    // A type the picker does not take is refused before the picker opens and
    // uses up nothing: ask once more with the name alone.
    if (!(e instanceof TypeError)) throw new SaveFileError('refused', failureDetail(e))
    try {
      handle = await w.showSaveFilePicker(pickerOptions(file, false))
    } catch (again) {
      if (isAbort(again)) return { kind: 'cancelled' }
      throw new SaveFileError('refused', failureDetail(again))
    }
  }
  let writable: WritableLike | null = null
  try {
    writable = await handle.createWritable()
    await writable.write(file.blob)
    await writable.close()
  } catch (e) {
    try {
      await writable?.abort?.()
    } catch {
      // Nothing more can be done for a file the browser would not write.
    }
    if (isAbort(e)) return { kind: 'cancelled' }
    throw new SaveFileError('write', failureDetail(e))
  }
  return { kind: 'saved', name: typeof handle.name === 'string' && handle.name !== '' ? handle.name : file.name }
}
