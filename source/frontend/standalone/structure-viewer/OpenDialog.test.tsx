/**
 * 「開く」 (owner 2026-11-14): one dialog for a file from this computer and an
 * entry from the PDB. Every refusal is said inside it (role="alert") and it
 * stays; a document that passed goes to `onOpen` with what it should do.
 * The RCSB download is replaced here (`rcsb.test.ts` has its own).
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key} ${JSON.stringify(vars)}` : key),
    i18n: { language: 'ja' },
  }),
}))

/** The page's context (PT-9781): opened from a file on an iPhone or iPad, or not. */
const context = vi.hoisted(() => ({ fileOnIos: false }))
vi.mock('./fileOnIos', () => ({ isFileOnIos: () => context.fileOnIos }))

import { capOf } from './localFile'
import { OpenDialog, sizeText, type OpenMode } from './OpenDialog'
import type { downloadPdbEntry } from './rcsb'

const PDB = 'ATOM      1  N   THR A   1      17.047  14.099   3.625  1.00 13.79           N\nEND\n'

/** A File with the `arrayBuffer` jsdom's lacks; `size` may claim more than it holds. */
const fileOf = (name: string, text: string, size?: number) => {
  const f = new File([text], name)
  const bytes = new TextEncoder().encode(text)
  Object.defineProperty(f, 'arrayBuffer', { value: async () => bytes.buffer.slice(0) })
  if (size !== undefined) Object.defineProperty(f, 'size', { value: size })
  return f
}

function setup(over: Partial<Parameters<typeof OpenDialog>[0]> = {}) {
  const onOpen = vi.fn()
  const onClose = vi.fn()
  const download = vi.fn<typeof downloadPdbEntry>()
  render(<OpenDialog full canAdd={false} initialMode="replace" staged={null} onOpen={onOpen} onClose={onClose} download={download} {...over} />)
  // The picker's `accept` is the browser's hint, not a check: a refused kind must still reach the dialog.
  return { onOpen, onClose, download, user: userEvent.setup({ applyAccept: false }) }
}

const picker = () => document.querySelector<HTMLInputElement>('input[type="file"]')!

async function choose(user: ReturnType<typeof userEvent.setup>, file: File) {
  await user.upload(picker(), file)
}

afterEach(() => {
  vi.restoreAllMocks()
  context.fileOnIos = false
})

describe('OpenDialog', () => {
  it('is a dialog whose drop area is a real button that opens the file picker', async () => {
    const { user } = setup()
    expect(screen.getByRole('dialog', { name: 'htmlExport:sa_open_title' })).toBeInTheDocument()
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined)
    const zone = screen.getByRole('button', { name: /sa_open_drop_title/ })
    expect(zone.tagName).toBe('BUTTON')
    await user.click(zone)
    expect(click).toHaveBeenCalledOnce()
    // The formats and both limits, apart: structures 32 MiB, sessions 25 MiB.
    expect(zone).toHaveAccessibleDescription(`htmlExport:sa_open_formats_full ${JSON.stringify({ limit: '32', pse: '25' })}`)
  })

  it('opens a structure file chosen in the picker at once, replacing what is shown', async () => {
    const { user, onOpen } = setup()
    await choose(user, fileOf('1crn.pdb', PDB))
    await waitFor(() => expect(onOpen).toHaveBeenCalledOnce())
    const [doc, mode] = onOpen.mock.calls[0] as [{ name: string; ext: string; text: string }, OpenMode]
    expect(doc).toMatchObject({ name: '1crn.pdb', ext: 'pdb', text: PDB })
    expect(mode).toBe('replace')
  })

  it('opens a file dropped on the drop area, and keeps the drop from the page', async () => {
    const { onOpen } = setup()
    const page = vi.fn()
    document.body.addEventListener('drop', page)
    const zone = screen.getByRole('button', { name: /sa_open_drop_title/ })
    fireEvent.drop(zone, { dataTransfer: { files: [fileOf('lig.sdf', 'x\n')], types: ['Files'] } })
    await waitFor(() => expect(onOpen).toHaveBeenCalledOnce())
    expect(page).not.toHaveBeenCalled()
    document.body.removeEventListener('drop', page)
  })

  it.each([
    ['notes.txt', 'hello', undefined, /sa_open_err_format/],
    ['big.pdb', PDB, capOf('pdb') + 1, /sa_open_err_too_large .*"limit":"32"/],
    ['big.pse', 'x', capOf('pse') + 1, /sa_open_err_too_large .*"limit":"25"/],
    ['empty.pdb', '', undefined, /sa_open_err_empty/],
  ])('refuses %s inside the dialog and stays open', async (name, text, size, said) => {
    const { user, onOpen, onClose } = setup()
    await choose(user, fileOf(name, text, size))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(said))
    expect(onOpen).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('refuses a PyMOL session in the light edition, and says only structures in its formats line', async () => {
    const { user, onOpen } = setup({ full: false })
    expect(screen.getByText(/sa_open_formats_light/)).toBeInTheDocument()
    await choose(user, fileOf('s.pse', 'x'))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('htmlExport:sa_open_err_pse_light'))
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('offers "replace" or "add to PyMOL" only while PyMOL is up', async () => {
    setup()
    expect(screen.queryByRole('radio')).toBeNull()
  })

  it('puts the choice first, before the drop area and the PDB ID it applies to, set apart and saying so (owner 2026-11-20)', async () => {
    setup({ canAdd: true, initialMode: 'replace' })
    const group = screen.getByRole('group', { name: /sa_open_mode_legend/ })
    expect(group).toHaveClass('sav-open-mode--pymol')
    // Before everything that opens at once.
    const drop = screen.getByRole('button', { name: /sa_open_drop_title/ })
    const pdb = screen.getByRole('textbox')
    expect(group.compareDocumentPosition(drop) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(group.compareDocumentPosition(pdb) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // It says it applies to both, and the mode's tag is for the eye only.
    expect(group).toHaveAccessibleDescription(/sa_open_mode_scope.*sa_open_mode_note/)
    expect(group.querySelector('legend .sav-tag--pymol')?.closest('[aria-hidden="true"]')).not.toBeNull()
    // The chosen answer's card is marked, not by colour alone (its border and weight, CSS).
    const replace = screen.getByRole('radio', { name: 'htmlExport:sa_open_mode_replace' })
    expect(replace.closest('label')).toHaveClass('is-selected')
    expect(screen.getByRole('radio', { name: 'htmlExport:sa_open_mode_add' }).closest('label')).not.toHaveClass('is-selected')
  })

  it('adds a file to PyMOL when asked, and never a session (it replaces everything)', async () => {
    const { user, onOpen } = setup({ canAdd: true, initialMode: 'add' })
    expect(screen.getByRole('radio', { name: 'htmlExport:sa_open_mode_add' })).toBeChecked()
    await choose(user, fileOf('s.pse', 'x'))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('htmlExport:sa_open_err_add_pse'))
    expect(onOpen).not.toHaveBeenCalled()
    await choose(user, fileOf('2nd.pdb', PDB))
    await waitFor(() => expect(onOpen).toHaveBeenCalledOnce())
    expect(onOpen.mock.calls[0][1]).toBe('add')
    // Back to replacing: the same session opens.
    await user.click(screen.getByRole('radio', { name: 'htmlExport:sa_open_mode_replace' }))
    await choose(user, fileOf('s.pse', 'x'))
    await waitFor(() => expect(onOpen).toHaveBeenCalledTimes(2))
    expect(onOpen.mock.calls[1][1]).toBe('replace')
  })

  it('checks the PDB ID before anything is asked of RCSB', async () => {
    const { user, download } = setup()
    const field = screen.getByRole('textbox', { name: 'htmlExport:sa_pdb_label' })
    await user.type(field, '1c/n')
    await user.click(screen.getByRole('button', { name: 'htmlExport:sa_pdb_load' }))
    expect(screen.getByRole('alert')).toHaveTextContent('htmlExport:sa_pdb_err_id')
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(field).toHaveFocus()
    expect(download).not.toHaveBeenCalled()
  })

  it('downloads a valid ID and opens it as that PDB entry', async () => {
    const { user, download, onOpen } = setup()
    download.mockResolvedValue({ ok: true, file: { name: '1CRN.cif', size: 10, arrayBuffer: async () => new TextEncoder().encode('data_1CRN\n').buffer as ArrayBuffer } })
    await user.type(screen.getByRole('textbox', { name: 'htmlExport:sa_pdb_label' }), 'pdb_00001crn{Enter}')
    await waitFor(() => expect(onOpen).toHaveBeenCalledOnce())
    expect(download.mock.calls[0][0]).toBe('1CRN')
    expect(onOpen.mock.calls[0][0]).toMatchObject({ name: '1CRN.cif', ext: 'cif', pdbId: '1CRN' })
  })

  it.each([
    [{ code: 'not-found' as const }, 'htmlExport:sa_pdb_err_not_found {"id":"9XXX"}'],
    [{ code: 'http' as const, status: 503 }, 'htmlExport:sa_pdb_err_http {"id":"9XXX","status":"503"}'],
    [{ code: 'network' as const }, 'htmlExport:sa_pdb_err_network'],
  ])('says why RCSB gave nothing (%o) and stays open', async (why, said) => {
    const { user, download, onOpen } = setup()
    download.mockResolvedValue({ ok: false, why })
    await user.type(screen.getByRole('textbox', { name: 'htmlExport:sa_pdb_label' }), '9xxx{Enter}')
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(said))
    expect(onOpen).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  describe('no connection: the way round, the entry downloaded by the browser (PT-9781)', () => {
    const steps = () => document.querySelector<HTMLOListElement>('ol.sav-open-steps')
    // jsdom has no scrollIntoView: the one these tests give HTMLElement goes with them.
    afterEach(() => {
      delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView
    })

    async function failNetwork(fileOnIos: boolean) {
      context.fileOnIos = fileOnIos
      const scroll = vi.fn()
      Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { value: scroll, configurable: true, writable: true })
      const s = setup()
      s.download.mockResolvedValue({ ok: false, why: { code: 'network' } })
      const field = screen.getByRole('textbox', { name: 'htmlExport:sa_pdb_label' })
      await s.user.type(field, 'pdb_00001crn{Enter}')
      await waitFor(() => expect(steps()).not.toBeNull())
      return { ...s, field, scroll }
    }

    it('offers a plain link to the entry, named by its address, then the area above; the alert stays one sentence', async () => {
      const { field, scroll } = await failNetwork(false)
      const alert = screen.getByRole('alert')
      expect(alert).toHaveTextContent('htmlExport:sa_pdb_err_network')
      // The steps are not in the alert, nor in the busy part.
      expect(alert.contains(steps())).toBe(false)
      expect(document.querySelector('.sav-open-inputs')!.contains(steps())).toBe(false)
      const items = within(steps()!).getAllByRole('listitem')
      expect(items).toHaveLength(2)
      expect(items[0]).toHaveTextContent('htmlExport:sa_pdb_fallback_download {"name":"1CRN.cif"}')
      const link = within(items[0]).getByRole('link')
      // A navigation, not this page's fetch: the address RCSB serves the entry at, opened in a new tab.
      expect(link).toHaveAttribute('href', 'https://files.rcsb.org/download/1CRN.cif')
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
      expect(link).toHaveTextContent('files.rcsb.org/download/1CRN.cif')
      expect(items[1]).toHaveTextContent('htmlExport:sa_pdb_fallback_open')
      expect(scroll).toHaveBeenCalled()
      // The ID was not at fault: not marked, and the focus is on 「PDB から読み込む」, not the field (a phone's keyboard would cover the steps).
      expect(field).toHaveAttribute('aria-invalid', 'false')
      expect(screen.getByRole('button', { name: 'htmlExport:sa_pdb_load' })).toHaveFocus()
    })

    it('a page opened from a file on an iPhone or iPad says why that is likely, and its note says so before the press', async () => {
      const { field } = await failNetwork(true)
      expect(screen.getByRole('alert')).toHaveTextContent('htmlExport:sa_pdb_err_network_file_ios')
      expect(field).toHaveAccessibleDescription('htmlExport:sa_pdb_note htmlExport:sa_pdb_note_file_ios')
      expect(within(steps()!).getByRole('link')).toHaveAttribute('href', 'https://files.rcsb.org/download/1CRN.cif')
    })

    it('elsewhere the note says nothing of it', () => {
      setup()
      expect(screen.getByRole('textbox', { name: 'htmlExport:sa_pdb_label' })).toHaveAccessibleDescription('htmlExport:sa_pdb_note')
    })

    it('the steps go with the next try, and are not offered for any other failure', async () => {
      const { user, download, field } = await failNetwork(false)
      let finish: (v: Awaited<ReturnType<typeof downloadPdbEntry>>) => void = () => undefined
      download.mockImplementation(() => new Promise(r => (finish = r)))
      await user.click(screen.getByRole('button', { name: 'htmlExport:sa_pdb_load' }))
      // Downloading again: no steps of the last failure.
      expect(screen.getByRole('status')).toHaveTextContent('htmlExport:sa_pdb_busy {"id":"1CRN"}')
      expect(steps()).toBeNull()
      await act(async () => finish({ ok: false, why: { code: 'timeout' } }))
      await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('htmlExport:sa_pdb_err_timeout'))
      expect(steps()).toBeNull()
      // A timeout keeps the focus rule it had: back to the field (PT-9188 item 3).
      expect(field).toHaveFocus()
    })
  })

  it('is busy while downloading, and 「中止」 aborts the download and opens nothing', async () => {
    const { user, download, onOpen } = setup()
    let signal: AbortSignal | null = null
    let finish: (v: Awaited<ReturnType<typeof downloadPdbEntry>>) => void = () => undefined
    download.mockImplementation((_id, s) => {
      signal = s
      return new Promise(resolve => {
        finish = resolve
      })
    })
    const field = screen.getByRole('textbox', { name: 'htmlExport:sa_pdb_label' })
    await user.type(field, '1crn{Enter}')
    const busyArea = document.querySelector('.sav-open-inputs')!
    expect(busyArea).toHaveAttribute('aria-busy', 'true')
    // The progress line and the alert are outside the busy part, so they are announced (PT-9187).
    expect(busyArea.contains(screen.getByRole('status'))).toBe(false)
    expect(busyArea.contains(screen.getByRole('alert'))).toBe(false)
    expect(screen.getByRole('status')).toHaveTextContent('htmlExport:sa_pdb_busy {"id":"1CRN"}')
    // Still focusable: a disabled button would drop the focus to the page (PT-9188 item 5).
    const load = screen.getByRole('button', { name: 'htmlExport:sa_pdb_load' })
    expect(load).toBeEnabled()
    expect(load).toHaveAttribute('aria-disabled', 'true')
    await user.click(load)
    expect(download).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: 'htmlExport:sa_open_stop' }))
    expect(signal!.aborted).toBe(true)
    expect(busyArea).toHaveAttribute('aria-busy', 'false')
    expect(screen.getByRole('status')).toHaveTextContent('htmlExport:sa_open_stopped')
    // 「中止」 is gone: the focus goes back to what it stopped (PT-9189 item 1).
    expect(field).toHaveFocus()
    // A reply that lands after the stop opens nothing.
    await act(async () => finish({ ok: true, file: { name: '1CRN.cif', size: 5, arrayBuffer: async () => new TextEncoder().encode('data_').buffer as ArrayBuffer } }))
    expect(onOpen).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'htmlExport:sa_open_stop' })).toBeNull()
  })

  it('closing stops a download still running', async () => {
    const { user, download, onClose } = setup()
    let signal: AbortSignal | null = null
    download.mockImplementation((_id, s) => {
      signal = s
      return new Promise(() => undefined)
    })
    await user.type(screen.getByRole('textbox', { name: 'htmlExport:sa_pdb_label' }), '1crn{Enter}')
    await user.click(screen.getByRole('button', { name: 'htmlExport:sa_close' }))
    expect(onClose).toHaveBeenCalledOnce()
    // The page takes the dialog away on close.
    cleanup()
    expect(signal!.aborted).toBe(true)
  })

  it('closing during a file read opens nothing when the read lands (PT-9186 item 1)', async () => {
    const { user, onOpen } = setup()
    let release: (b: ArrayBuffer) => void = () => undefined
    const slow = new File(['x'], 'slow.pdb')
    Object.defineProperty(slow, 'arrayBuffer', { value: () => new Promise<ArrayBuffer>(r => (release = r)) })
    await choose(user, slow)
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('htmlExport:sa_open_busy'))
    cleanup()
    await act(async () => release(new TextEncoder().encode(PDB).buffer as ArrayBuffer))
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('a download does what the replace/add choice says when it lands, not when it was asked (PT-9186 item 2)', async () => {
    const { user, download, onOpen } = setup({ canAdd: true, initialMode: 'replace' })
    let finish: (v: Awaited<ReturnType<typeof downloadPdbEntry>>) => void = () => undefined
    download.mockImplementation(() => new Promise(r => (finish = r)))
    await user.type(screen.getByRole('textbox', { name: 'htmlExport:sa_pdb_label' }), '1crn{Enter}')
    await user.click(screen.getByRole('radio', { name: 'htmlExport:sa_open_mode_add' }))
    await act(async () => finish({ ok: true, file: { name: '1CRN.cif', size: 10, arrayBuffer: async () => new TextEncoder().encode('data_1CRN\n').buffer as ArrayBuffer } }))
    await waitFor(() => expect(onOpen).toHaveBeenCalledOnce())
    expect(onOpen.mock.calls[0][1]).toBe('add')
  })

  it('a download that gets no answer in time says so, and the focus goes back to the ID (PT-9188 item 3)', async () => {
    const { user, download } = setup()
    download.mockResolvedValue({ ok: false, why: { code: 'timeout' } })
    const field = screen.getByRole('textbox', { name: 'htmlExport:sa_pdb_label' })
    await user.type(field, '1crn')
    await user.click(screen.getByRole('button', { name: 'htmlExport:sa_pdb_load' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('htmlExport:sa_pdb_err_timeout {"id":"1CRN","seconds":"30"}'))
    expect(field).toHaveFocus()
  })

  it('a file dropped on the page while another is read takes its place and waits for 「開く」 (PT-9188 item 4)', async () => {
    const onOpen = vi.fn()
    const slow = new File(['x'], 'slow.pdb')
    let release: (b: ArrayBuffer) => void = () => undefined
    Object.defineProperty(slow, 'arrayBuffer', { value: () => new Promise<ArrayBuffer>(r => (release = r)) })
    const props = { full: true, canAdd: false, initialMode: 'replace' as const, onOpen, onClose: vi.fn(), download: vi.fn<typeof downloadPdbEntry>() }
    const { rerender } = render(<OpenDialog {...props} staged={slow} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'htmlExport:sa_open_staged_submit' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('htmlExport:sa_open_busy'))
    rerender(<OpenDialog {...props} staged={fileOf('second.pdb', PDB)} />)
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('htmlExport:sa_open_drop_replaced'))
    // The first read lands: dropped, and the second file is still the one chosen.
    await act(async () => release(new TextEncoder().encode(PDB).buffer as ArrayBuffer))
    expect(onOpen).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /sa_open_drop_title/ })).toHaveTextContent('second.pdb')
    await user.click(screen.getByRole('button', { name: 'htmlExport:sa_open_staged_submit' }))
    await waitFor(() => expect(onOpen).toHaveBeenCalledOnce())
    expect(onOpen.mock.calls[0][0]).toMatchObject({ name: 'second.pdb' })
  })

  it('a drop on the drop area while busy is said, not swallowed (PT-9188 item 4)', async () => {
    const { user, download } = setup()
    download.mockImplementation(() => new Promise(() => undefined))
    await user.type(screen.getByRole('textbox', { name: 'htmlExport:sa_pdb_label' }), '1crn{Enter}')
    fireEvent.drop(screen.getByRole('button', { name: /sa_open_drop_title/ }), { dataTransfer: { files: [fileOf('x.pdb', PDB)], types: ['Files'] } })
    // The progress line still says what runs; the alert says why the drop did nothing.
    expect(screen.getByRole('status')).toHaveTextContent('htmlExport:sa_pdb_busy')
    expect(screen.getByRole('alert')).toHaveTextContent('htmlExport:sa_open_drop_busy')
    expect(download).toHaveBeenCalledOnce()
  })

  it('refuses a session where this browser cannot run PyMOL, saying why (PT-9192 items 2, 7)', async () => {
    const { user, onOpen } = setup({ pseRefusal: 'no PyMOL here' })
    await choose(user, fileOf('s.pse', 'x'))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('no PyMOL here'))
    expect(onOpen).not.toHaveBeenCalled()
    // Structures still open.
    await choose(user, fileOf('a.pdb', PDB))
    await waitFor(() => expect(onOpen).toHaveBeenCalledOnce())
  })

  it('says a staged file’s size through formatSI, an empty one as 0 KiB (PT-9189 item 4)', () => {
    setup({ staged: fileOf('empty.pdb', '') })
    expect(screen.getByRole('button', { name: /sa_open_drop_title/ })).toHaveTextContent('"size":"0 KiB"')
  })

  it('a page drop that replaces a busy read clears the alert about the old one (PT-9228 item 6)', async () => {
    const slow = new File(['x'], 'slow.pdb')
    Object.defineProperty(slow, 'arrayBuffer', { value: () => new Promise<ArrayBuffer>(() => undefined) })
    const props = { full: true, canAdd: false, initialMode: 'replace' as const, onOpen: vi.fn(), onClose: vi.fn(), download: vi.fn<typeof downloadPdbEntry>() }
    const { rerender } = render(<OpenDialog {...props} staged={slow} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'htmlExport:sa_open_staged_submit' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('htmlExport:sa_open_busy'))
    // A drop on the drop area while busy: refused, said.
    fireEvent.drop(screen.getByRole('button', { name: /sa_open_drop_title/ }), { dataTransfer: { files: [fileOf('x.pdb', PDB)], types: ['Files'] } })
    expect(screen.getByRole('alert')).toHaveTextContent('htmlExport:sa_open_drop_busy')
    // Then one on the page: it takes the busy read's place, and the refusal no longer holds.
    rerender(<OpenDialog {...props} staged={fileOf('second.pdb', PDB)} />)
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('htmlExport:sa_open_drop_replaced'))
    expect(screen.getByRole('alert')).toHaveTextContent('')
  })

  it('a read refused while 「中止」 has the focus gives it to the drop area, a downloaded entry refused to the ID field (PT-9229 item 4, PT-9230 item 2)', async () => {
    const { user, download } = setup()
    let fail: (e: Error) => void = () => undefined
    const slow = new File(['x'], 'broken.pdb')
    Object.defineProperty(slow, 'arrayBuffer', { value: () => new Promise<ArrayBuffer>((_r, rej) => (fail = rej)) })
    await choose(user, slow)
    const stop = await screen.findByRole('button', { name: 'htmlExport:sa_open_stop' })
    stop.focus()
    // The read fails: refused, and 「中止」 goes.
    await act(async () => fail(new Error('disk gone')))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('sa_open_err_unreadable'))
    expect(screen.queryByRole('button', { name: 'htmlExport:sa_open_stop' })).toBeNull()
    expect(screen.getByRole('button', { name: /sa_open_drop_title/ })).toHaveFocus()
    // A downloaded entry that is refused when read: the ID field.
    let finish: (v: Awaited<ReturnType<typeof downloadPdbEntry>>) => void = () => undefined
    download.mockImplementation(() => new Promise(r => (finish = r)))
    await user.type(screen.getByRole('textbox', { name: 'htmlExport:sa_pdb_label' }), '1crn{Enter}')
    ;(await screen.findByRole('button', { name: 'htmlExport:sa_open_stop' })).focus()
    await act(async () => finish({ ok: true, file: { name: '1CRN.cif', size: 0, arrayBuffer: async () => new ArrayBuffer(0) } }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'htmlExport:sa_open_stop' })).toBeNull())
    expect(screen.getByRole('textbox', { name: 'htmlExport:sa_pdb_label' })).toHaveFocus()
  })

  it('a download that lands hands the document to the page as it is then, not as it was when asked (PT-9230 item 7)', async () => {
    const first = vi.fn()
    const latest = vi.fn()
    const download = vi.fn<typeof downloadPdbEntry>()
    let finish: (v: Awaited<ReturnType<typeof downloadPdbEntry>>) => void = () => undefined
    download.mockImplementation(() => new Promise(r => (finish = r)))
    const props = { full: true, canAdd: false, initialMode: 'replace' as const, onClose: vi.fn(), staged: null, download }
    const { rerender } = render(<OpenDialog {...props} onOpen={first} />)
    const user = userEvent.setup()
    await user.type(screen.getByRole('textbox', { name: 'htmlExport:sa_pdb_label' }), '1crn{Enter}')
    rerender(<OpenDialog {...props} onOpen={latest} />)
    await act(async () => finish({ ok: true, file: { name: '1CRN.cif', size: 10, arrayBuffer: async () => new TextEncoder().encode('data_1CRN\n').buffer as ArrayBuffer } }))
    await waitFor(() => expect(latest).toHaveBeenCalledOnce())
    expect(first).not.toHaveBeenCalled()
  })

  it('an add chosen while PyMOL was up is refused, not made a replace, when PyMOL is no longer up as the download lands (PT-9238 item 2)', async () => {
    const onOpen = vi.fn()
    const download = vi.fn<typeof downloadPdbEntry>()
    let finish: (v: Awaited<ReturnType<typeof downloadPdbEntry>>) => void = () => undefined
    download.mockImplementation(() => new Promise(r => (finish = r)))
    const props = { full: true, initialMode: 'add' as const, onOpen, onClose: vi.fn(), staged: null, download }
    const { rerender } = render(<OpenDialog {...props} canAdd />)
    const user = userEvent.setup()
    await user.type(screen.getByRole('textbox', { name: 'htmlExport:sa_pdb_label' }), '1crn{Enter}')
    // PyMOL leaves ready (a Stop, a failure) while the entry downloads: the choice goes from view.
    rerender(<OpenDialog {...props} canAdd={false} />)
    expect(screen.queryByRole('radio')).toBeNull()
    await act(async () => finish({ ok: true, file: { name: '1CRN.cif', size: 10, arrayBuffer: async () => new TextEncoder().encode('data_1CRN\n').buffer as ArrayBuffer } }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('htmlExport:sa_open_err_add_not_ready {"name":"1CRN.cif"}'))
    expect(onOpen).not.toHaveBeenCalled()
    // Asked again with the choice out of view: it replaces, as the dialog then shows.
    await user.clear(screen.getByRole('textbox', { name: 'htmlExport:sa_pdb_label' }))
    await user.type(screen.getByRole('textbox', { name: 'htmlExport:sa_pdb_label' }), '1crn{Enter}')
    await act(async () => finish({ ok: true, file: { name: '1CRN.cif', size: 10, arrayBuffer: async () => new TextEncoder().encode('data_1CRN\n').buffer as ArrayBuffer } }))
    await waitFor(() => expect(onOpen).toHaveBeenCalledOnce())
    expect(onOpen.mock.calls[0][1]).toBe('replace')
  })

  it('an add chosen during a download that started without the choice is refused too, not made a replace (PT-9249 item 2)', async () => {
    const onOpen = vi.fn()
    const download = vi.fn<typeof downloadPdbEntry>()
    let finish: (v: Awaited<ReturnType<typeof downloadPdbEntry>>) => void = () => undefined
    download.mockImplementation(() => new Promise(r => (finish = r)))
    const props = { full: true, initialMode: 'replace' as const, onOpen, onClose: vi.fn(), staged: null, download }
    const { rerender } = render(<OpenDialog {...props} canAdd={false} />)
    const user = userEvent.setup()
    await user.type(screen.getByRole('textbox', { name: 'htmlExport:sa_pdb_label' }), '1crn{Enter}')
    // PyMOL comes up while the entry downloads; the user picks 「追加」; PyMOL then leaves.
    rerender(<OpenDialog {...props} canAdd />)
    await user.click(screen.getByRole('radio', { name: /sa_open_mode_add/ }))
    rerender(<OpenDialog {...props} canAdd={false} />)
    await act(async () => finish({ ok: true, file: { name: '1CRN.cif', size: 10, arrayBuffer: async () => new TextEncoder().encode('data_1CRN\n').buffer as ArrayBuffer } }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('htmlExport:sa_open_err_add_not_ready {"name":"1CRN.cif"}'))
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('a .pse with 「追加」 chosen is refused as a session, even once PyMOL left (never the add-not-ready text; PT-9249 item 5)', async () => {
    const onOpen = vi.fn()
    let release: () => void = () => undefined
    const gate = new Promise<void>(r => (release = r))
    const pseFile = { name: 's.pse', size: 4, arrayBuffer: async () => (await gate, new Uint8Array([1, 2, 3, 4]).buffer as ArrayBuffer) } as unknown as File
    const props = { full: true, initialMode: 'add' as const, onOpen, onClose: vi.fn(), staged: pseFile, download: vi.fn<typeof downloadPdbEntry>() }
    const { rerender } = render(<OpenDialog {...props} canAdd />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'htmlExport:sa_open_staged_submit' }))
    rerender(<OpenDialog {...props} canAdd={false} />)
    await act(async () => release())
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('htmlExport:sa_open_err_add_pse'))
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('never says a file that is not empty is 0.0 KiB (PT-9230 item 3)', () => {
    expect(sizeText(0)).toBe('0 KiB')
    expect(sizeText(10)).toBe('0.1 KiB')
    expect(sizeText(2048)).toBe('2.0 KiB')
  })

  it('shows a file dropped on the page as chosen, and opens it only on 「開く」', async () => {
    const { user, onOpen } = setup({ staged: fileOf('dropped.pdb', PDB) })
    expect(screen.getByRole('button', { name: /sa_open_drop_title/ })).toHaveTextContent('dropped.pdb')
    const open = screen.getByRole('button', { name: 'htmlExport:sa_open_staged_submit' })
    expect(open).toHaveFocus()
    expect(onOpen).not.toHaveBeenCalled()
    await user.click(open)
    await waitFor(() => expect(onOpen).toHaveBeenCalledOnce())
    expect(onOpen.mock.calls[0][0]).toMatchObject({ name: 'dropped.pdb' })
  })
})
