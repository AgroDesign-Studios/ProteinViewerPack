/**
 * The save step (owner 2026-11-17; UI consult, Opus and astra): every save of
 * the offline app ends in it — the file made first, then two buttons, the
 * browser's default place the main one, a chosen place where the browser
 * can. A browser without the save picker (Firefox, Safari, iOS) or a page
 * shown in another site's frame gets the second disabled with its reason in
 * sight. Closing the picker keeps everything; a refusal or a failed write is
 * said; the choice is never remembered.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key} ${JSON.stringify(vars)}` : key), i18n: { language: 'ja' } }),
}))
const saveBlobFile = vi.fn()
vi.mock('../../src/lib/saveBlobFile', () => ({ saveBlobFile: (...a: unknown[]) => saveBlobFile(...a) }))

import { resetModalStackForTests } from '../../src/components/modalStack'
import { pickerBlock, saveFile, SaveFileError, type PreparedFile } from './saveFile'
import { formatText, makePicturePreview, SaveDialog, SaveStep } from './SaveStep'

afterEach(() => {
  cleanup()
  saveBlobFile.mockReset()
  resetModalStackForTests()
})

const FILE: PreparedFile = { blob: new Blob(['<!doctype html>x'], { type: 'text/html' }), name: '1crn_AgroDesign-ProteinViewerPack-v1.0.0_light_20261117.html' }

interface FakeWritable {
  write: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  abort: ReturnType<typeof vi.fn>
}

/** A window whose save picker is `picker` (or none), a secure context, at the top unless `framed`. */
function fakeWindow(picker: ((o: unknown) => Promise<unknown>) | null, opts: { secure?: boolean; framed?: 'same' | 'other' } = {}): Window {
  const self = {} as Record<string, unknown>
  self.isSecureContext = opts.secure ?? true
  self.self = self
  self.top =
    opts.framed === 'other'
      ? {
          get location(): Location {
            throw new DOMException('Blocked a frame with origin "null" from accessing a cross-origin frame.', 'SecurityError')
          },
        }
      : opts.framed === 'same'
        ? { location: { href: 'file:///parent.html' } }
        : self
  if (picker !== null) self.showSaveFilePicker = picker
  return self as unknown as Window
}

/** A picker that hands out a file handle named `name`, whose writable is returned for inspection. */
function pickerSaving(name = 'chosen.html', fail?: { at: 'write' | 'close'; error: unknown }) {
  const writable: FakeWritable = {
    write: vi.fn(async () => {
      if (fail?.at === 'write') throw fail.error
    }),
    close: vi.fn(async () => {
      if (fail?.at === 'close') throw fail.error
    }),
    abort: vi.fn(async () => undefined),
  }
  const picker = vi.fn(async (_o: unknown) => ({ name, createWritable: async () => writable }))
  return { picker, writable }
}

describe('pickerBlock: is 「場所を選んで保存」 offered?', () => {
  it('only where the browser has the picker, in a secure context, at the top or in a frame of the same origin', () => {
    expect(pickerBlock(fakeWindow(vi.fn()))).toBeNull()
    expect(pickerBlock(fakeWindow(vi.fn(), { framed: 'same' }))).toBeNull()
    // Firefox, Safari, iOS: no picker.
    expect(pickerBlock(fakeWindow(null))).toBe('browser')
    expect(pickerBlock(fakeWindow(vi.fn(), { secure: false }))).toBe('browser')
    // A sandboxed frame (an opaque origin): Chromium refuses the picker there.
    expect(pickerBlock(fakeWindow(vi.fn(), { framed: 'other' }))).toBe('frame')
  })
})

describe('saveFile', () => {
  it('default: the browser’s own download, said as started', async () => {
    expect(await saveFile(FILE, 'default', fakeWindow(null))).toEqual({ kind: 'started', name: FILE.name })
    expect(saveBlobFile).toHaveBeenCalledWith(FILE.blob, FILE.name)
  })

  it('pick: asks the picker with the name and its type, before anything is awaited, writes the file and says the name chosen', async () => {
    const { picker, writable } = pickerSaving('mine.html')
    const pending = saveFile(FILE, 'pick', fakeWindow(picker))
    // Asked in the same task as the press (the browser's user-activation rule).
    expect(picker).toHaveBeenCalledOnce()
    expect(picker.mock.calls[0][0]).toEqual({ suggestedName: FILE.name, types: [{ description: 'HTML', accept: { 'text/html': ['.html'] } }] })
    expect(await pending).toEqual({ kind: 'saved', name: 'mine.html' })
    expect(writable.write).toHaveBeenCalledWith(FILE.blob)
    expect(writable.close).toHaveBeenCalledOnce()
    expect(saveBlobFile).not.toHaveBeenCalled()
  })

  it('a closed picker is no failure; a type the picker refuses is asked again with the name alone', async () => {
    const closed = vi.fn(async () => {
      throw new DOMException('The user aborted a request.', 'AbortError')
    })
    expect(await saveFile(FILE, 'pick', fakeWindow(closed))).toEqual({ kind: 'cancelled' })
    const { writable } = pickerSaving()
    const typed = vi.fn(async (o: unknown) => {
      if ((o as { types?: unknown }).types !== undefined) throw new TypeError('Invalid accept type')
      return { name: 'x.html', createWritable: async () => writable }
    })
    expect(await saveFile(FILE, 'pick', fakeWindow(typed))).toEqual({ kind: 'saved', name: 'x.html' })
    expect(typed).toHaveBeenCalledTimes(2)
    expect(typed.mock.calls[1][0]).toEqual({ suggestedName: FILE.name })
  })

  it('a refusal and a failed write reject with what the browser said; a half-written file is thrown away', async () => {
    const refused = vi.fn(async () => {
      throw new DOMException('Cross origin sub frames aren’t allowed to show a file picker.', 'SecurityError')
    })
    await expect(saveFile(FILE, 'pick', fakeWindow(refused))).rejects.toMatchObject({ code: 'refused', detail: expect.stringContaining('SecurityError') })
    const { picker, writable } = pickerSaving('x.html', { at: 'write', error: new DOMException('Not enough space', 'QuotaExceededError') })
    const failed = saveFile(FILE, 'pick', fakeWindow(picker))
    await expect(failed).rejects.toBeInstanceOf(SaveFileError)
    await expect(failed).rejects.toMatchObject({ code: 'write', detail: expect.stringContaining('QuotaExceededError') })
    expect(writable.abort).toHaveBeenCalledOnce()
  })
})

describe('SaveStep', () => {
  it('names the file, its format and size, then the two ways to save it — the browser’s default the main one', async () => {
    render(<SaveStep file={{ ...FILE, detail: '800 × 600 px' }} win={fakeWindow(vi.fn())} />)
    expect(screen.getByText(FILE.name)).toBeInTheDocument()
    expect(screen.getByText('HTML (.html)')).toBeInTheDocument()
    expect(screen.getByText(/htmlExport:sa_size_kb/)).toHaveTextContent('· 800 × 600 px')
    const buttons = screen.getAllByRole('button')
    expect(buttons.map(b => b.textContent)).toEqual(['htmlExport:sa_save_default', 'htmlExport:sa_save_pick'])
    expect(buttons[0]).toHaveClass('btn-primary')
    expect(buttons[1]).toHaveClass('btn-secondary')
    expect(buttons[1]).not.toHaveAttribute('aria-disabled')
    // The focus is on its first line, not a button: a key held from the press saves nothing.
    expect(screen.getByText('htmlExport:sa_save_ready')).toHaveFocus()
  })

  it('the default button starts the download and says it started, not that it saved', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn()
    render(<SaveStep file={FILE} win={fakeWindow(null)} onSaved={onSaved} />)
    await user.click(screen.getByRole('button', { name: 'htmlExport:sa_save_default' }))
    expect(saveBlobFile).toHaveBeenCalledWith(FILE.blob, FILE.name)
    expect(await screen.findByRole('status')).toHaveTextContent(`htmlExport:sa_save_started {"file":"${FILE.name}"}`)
    expect(onSaved).toHaveBeenCalledWith('started', FILE.name)
  })

  it('where the browser has no picker, 「場所を選んで保存…」 is disabled with its reason always in sight, and does nothing', async () => {
    const user = userEvent.setup()
    render(<SaveStep file={FILE} win={fakeWindow(null)} />)
    const pick = screen.getByRole('button', { name: 'htmlExport:sa_save_pick' })
    expect(pick).toHaveAttribute('aria-disabled', 'true')
    expect(pick).toHaveAccessibleDescription('htmlExport:sa_save_pick_browser')
    expect(screen.getByText('htmlExport:sa_save_pick_browser')).toBeVisible()
    await user.click(pick)
    expect(saveBlobFile).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent('')
  })

  it('inside another site’s frame the reason says so', () => {
    render(<SaveStep file={FILE} win={fakeWindow(vi.fn(), { framed: 'other' })} />)
    expect(screen.getByRole('button', { name: 'htmlExport:sa_save_pick' })).toHaveAccessibleDescription('htmlExport:sa_save_pick_frame')
  })

  it('a place chosen: written there, said as saved under the name chosen', async () => {
    const user = userEvent.setup()
    const { picker } = pickerSaving('on-the-desktop.html')
    const onSaved = vi.fn()
    render(<SaveStep file={FILE} win={fakeWindow(picker)} onSaved={onSaved} />)
    await user.click(screen.getByRole('button', { name: 'htmlExport:sa_save_pick' }))
    expect(await screen.findByText('htmlExport:sa_save_saved {"file":"on-the-desktop.html"}')).toBeInTheDocument()
    expect(onSaved).toHaveBeenCalledWith('saved', 'on-the-desktop.html')
  })

  it('closing the picker changes nothing: no message, no error, the file kept and both buttons still there', async () => {
    const user = userEvent.setup()
    const picker = vi.fn(async () => {
      throw new DOMException('The user aborted a request.', 'AbortError')
    })
    const onSaved = vi.fn()
    render(<SaveStep file={FILE} win={fakeWindow(picker)} onSaved={onSaved} />)
    await user.click(screen.getByRole('button', { name: 'htmlExport:sa_save_pick' }))
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'htmlExport:sa_save_pick' })).not.toHaveAttribute('aria-disabled'))
    expect(screen.getByRole('status')).toHaveTextContent('')
    expect(screen.getByRole('alert')).toHaveTextContent('')
    expect(onSaved).not.toHaveBeenCalled()
    expect(screen.getByText(FILE.name)).toBeInTheDocument()
    // The same file can still be saved the other way.
    await user.click(screen.getByRole('button', { name: 'htmlExport:sa_save_default' }))
    expect(saveBlobFile).toHaveBeenCalledWith(FILE.blob, FILE.name)
  })

  it('a refusal says what the browser said and points to the default; a failed write says it could not save', async () => {
    const user = userEvent.setup()
    const refused = vi.fn(async () => {
      throw new DOMException('Not allowed', 'NotAllowedError')
    })
    render(<SaveStep file={FILE} win={fakeWindow(refused)} />)
    await user.click(screen.getByRole('button', { name: 'htmlExport:sa_save_pick' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('htmlExport:sa_save_pick_refused')
    expect(screen.getByRole('alert')).toHaveTextContent('NotAllowedError')
    cleanup()
    const { picker } = pickerSaving('x.html', { at: 'close', error: new DOMException('disk', 'InvalidStateError') })
    render(<SaveStep file={FILE} win={fakeWindow(picker)} />)
    await user.click(screen.getByRole('button', { name: 'htmlExport:sa_save_pick' }))
    await vi.waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('htmlExport:sa_save_write_err'))
  })

  it('the choice is not remembered: after a place was chosen, the next save step’s main button is the browser’s default again', async () => {
    const user = userEvent.setup()
    const { picker } = pickerSaving()
    render(<SaveStep file={FILE} win={fakeWindow(picker)} />)
    await user.click(screen.getByRole('button', { name: 'htmlExport:sa_save_pick' }))
    await screen.findByText(/sa_save_saved/)
    cleanup()
    render(<SaveStep file={FILE} win={fakeWindow(picker)} />)
    expect(screen.getAllByRole('button')[0]).toHaveTextContent('htmlExport:sa_save_default')
    expect(screen.getAllByRole('button')[0]).toHaveClass('btn-primary')
  })

  it('in a dialog of its own (the pictures), titled, with a close button', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<SaveDialog title="Save image" file={{ blob: new Blob([new Uint8Array(2048)], { type: 'image/png' }), name: 'a.png' }} onClose={onClose} win={fakeWindow(null)} />)
    expect(screen.getByRole('dialog', { name: 'Save image' })).toHaveTextContent('PNG (.png)')
    await user.click(screen.getByRole('button', { name: 'pymol:dialog_close' }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})

describe('the picture’s preview (owner 2026-11-17: 画像のサムネイルも表示)', () => {
  const PNG = (): PreparedFile => ({ blob: new Blob([new Uint8Array(64)], { type: 'image/png' }), name: '1crn_pymol_ray.png' })

  /** createImageBitmap answering with a bitmap of `w` × `h`, settled when the test says; object URLs counted. */
  function stage(w: number, h: number) {
    const close = vi.fn()
    let settle: (ok: boolean) => void = () => undefined
    const decode = vi.fn(
      () =>
        new Promise((resolve, reject) => {
          settle = ok => (ok ? resolve({ width: w, height: h, close }) : reject(new Error('not an image')))
        }),
    )
    vi.stubGlobal('createImageBitmap', decode)
    let n = 0
    const made: Blob[] = []
    const create = vi.spyOn(URL, 'createObjectURL').mockImplementation(b => {
      made.push(b as Blob)
      return `blob:preview-${++n}`
    })
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    const drawImage = vi.fn()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D)
    const small = new Blob([new Uint8Array(8)], { type: 'image/png' })
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, done: BlobCallback) {
      done(small)
    })
    return { close, decode, create, revoke, drawImage, toBlob, small, made, settle: (ok: boolean) => act(async () => settle(ok)) }
  }

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('a small picture is shown as it is, above its name, with its pixels in the alt; its bitmap is closed', async () => {
    const s = stage(500, 300)
    const file = PNG()
    render(<SaveStep file={file} preview win={fakeWindow(null)} />)
    await s.settle(true)
    const img = screen.getByRole('img', { name: 'htmlExport:sa_save_preview_alt {"w":"500","h":"300"}' })
    expect(img).toHaveAttribute('src', 'blob:preview-1')
    expect(s.made).toEqual([file.blob])
    expect(s.toBlob).not.toHaveBeenCalled()
    expect(s.close).toHaveBeenCalledOnce()
    // Above the file's name, under the step's first line.
    const step = screen.getByRole('group')
    expect(step.firstElementChild).toHaveTextContent('htmlExport:sa_save_ready')
    expect(step.children[1]).toContainElement(img)
    expect(step.children[2].tagName).toBe('DL')
  })

  it('a large one is shown from a copy 640 px on its longest side; the original is what saves', async () => {
    const s = stage(3840, 2160)
    const file = PNG()
    render(<SaveStep file={file} preview win={fakeWindow(null)} />)
    await s.settle(true)
    const img = screen.getByRole('img', { name: /"w":"3840","h":"2160"/ })
    expect(s.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 640, 360)
    expect(s.made).toEqual([s.small])
    expect(img).toHaveAttribute('src', 'blob:preview-1')
    expect(s.close).toHaveBeenCalledOnce()
    await userEvent.setup().click(screen.getByRole('button', { name: 'htmlExport:sa_save_default' }))
    expect(saveBlobFile).toHaveBeenCalledWith(file.blob, file.name)
  })

  it('the buttons never wait for it: the file saves while the preview is still being made', async () => {
    const s = stage(800, 600)
    const file = PNG()
    render(<SaveStep file={file} preview win={fakeWindow(null)} />)
    expect(screen.queryByRole('img')).toBeNull()
    await userEvent.setup().click(screen.getByRole('button', { name: 'htmlExport:sa_save_default' }))
    expect(saveBlobFile).toHaveBeenCalledWith(file.blob, file.name)
    await s.settle(true)
    expect(screen.getByRole('img')).toBeInTheDocument()
  })

  it('a picture that cannot be previewed shows none and still saves', async () => {
    const s = stage(1, 1)
    const file = PNG()
    render(<SaveStep file={file} preview win={fakeWindow(null)} />)
    await s.settle(false)
    expect(screen.queryByRole('img')).toBeNull()
    expect(s.create).not.toHaveBeenCalled()
    await userEvent.setup().click(screen.getByRole('button', { name: 'htmlExport:sa_save_default' }))
    expect(saveBlobFile).toHaveBeenCalledWith(file.blob, file.name)
  })

  it('closing lets its URL go; a preview made after the step closed is let go unseen', async () => {
    const s = stage(500, 300)
    const shown = render(<SaveStep file={PNG()} preview win={fakeWindow(null)} />)
    await s.settle(true)
    expect(s.revoke).not.toHaveBeenCalled()
    shown.unmount()
    expect(s.revoke).toHaveBeenCalledWith('blob:preview-1')

    const late = render(<SaveStep file={PNG()} preview win={fakeWindow(null)} />)
    late.unmount()
    await s.settle(true)
    expect(s.create).toHaveBeenCalledTimes(2)
    expect(s.revoke).toHaveBeenLastCalledWith('blob:preview-2')
    expect(s.close).toHaveBeenCalledTimes(2)
  })

  it('a new picture in the same step lets the old preview go', async () => {
    const s = stage(500, 300)
    const view = render(<SaveStep file={PNG()} preview win={fakeWindow(null)} />)
    await s.settle(true)
    view.rerender(<SaveStep file={PNG()} preview win={fakeWindow(null)} />)
    expect(s.revoke).toHaveBeenCalledWith('blob:preview-1')
    expect(screen.queryByRole('img')).toBeNull()
    await s.settle(true)
    expect(screen.getByRole('img')).toHaveAttribute('src', 'blob:preview-2')
  })

  it('only where asked: the save steps of other files draw none and decode nothing', () => {
    const s = stage(500, 300)
    render(<SaveStep file={FILE} win={fakeWindow(null)} />)
    expect(s.decode).not.toHaveBeenCalled()
  })

  it('the pictures’ dialog asks for it', async () => {
    const s = stage(500, 300)
    render(<SaveDialog title="Save image" file={PNG()} preview onClose={() => undefined} win={fakeWindow(null)} />)
    await s.settle(true)
    expect(dialogPreview()).toBeInTheDocument()
  })

  it('makePicturePreview: the copy keeps the picture’s shape, at least 1 px a side', async () => {
    const s = stage(4000, 3)
    const p = makePicturePreview(new Blob([]))
    await s.settle(true)
    expect(await p).toEqual({ url: 'blob:preview-1', w: 4000, h: 3 })
    expect(s.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 640, 1)
  })

  it('is drawn whole in at most 320 × 200 px (a phone: the step’s width, 160 px), on a faint checkerboard', () => {
    const css = readFileSync(join(__dirname, 'standalone.css'), 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '')
    const img = css.match(/\.sav-save-preview img\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(img).toMatch(/max-width:\s*min\(100%, 320px\)/)
    expect(img).toMatch(/max-height:\s*200px/)
    expect(img).toMatch(/object-fit:\s*contain/)
    expect(img).toMatch(/background-image:\s*conic-gradient\(/)
    expect(img).toMatch(/background-size:\s*16px 16px/)
    expect(css).toMatch(/\.sav-save-preview\s*\{[^}]*justify-content:\s*center/)
    expect(css).toMatch(/@media \(max-width: 640px\)\s*\{[^@]*\.sav-save-preview img\s*\{\s*max-width:\s*100%;\s*max-height:\s*160px;/)
  })
})

/** The pictures' dialog's preview. */
const dialogPreview = () => screen.getByRole('dialog', { name: 'Save image' }).querySelector('.sav-save-preview img')

describe('formatText', () => {
  it('names each format the app saves, with its extension', () => {
    expect(formatText('a.html')).toBe('HTML (.html)')
    expect(formatText('a.png')).toBe('PNG (.png)')
    expect(formatText('a.wrl')).toBe('VRML (.wrl)')
    expect(formatText('a.pse')).toBe('PSE (.pse)')
    expect(formatText('a.cif')).toBe('mmCIF (.cif)')
    expect(formatText('a.mol2')).toBe('MOL2 (.mol2)')
    expect(formatText('noext')).toBe('')
  })
})
