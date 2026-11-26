/**
 * 「セッションを .pse で保存」 (owner 2026-11-14): the dialog with a stub
 * session source. What is checked: it asks PyMOL for the live session only on
 * the press, saves the bytes under the page's own name with `.pse`, warns
 * about received `.pse` files (PT-3031), and says why nothing was saved.
 */
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const saveBlobFile = vi.fn()
vi.mock('../../lib/saveBlobFile', () => ({ saveBlobFile: (...a: unknown[]) => saveBlobFile(...a) }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key} ${JSON.stringify(vars)}` : key),
    i18n: { language: 'ja' },
  }),
}))

import { LIMITS } from './pymolFrameProtocol'
import { checkPseFile, PymolPseExportDialog } from './PymolPseExportDialog'

const PICKLE = new Uint8Array([0x80, 0x04, 0x95, 0x10, 0x00]).buffer as ArrayBuffer

beforeEach(() => saveBlobFile.mockReset())

function open(exportPse: ((signal: AbortSignal) => Promise<ArrayBuffer>) | null, ready = true) {
  const onClose = vi.fn()
  render(<PymolPseExportDialog exportPse={exportPse} ready={ready} objectName="1hsg" onClose={onClose} />)
  return { onClose, user: userEvent.setup() }
}

describe('checkPseFile', () => {
  it('takes PyMOL’s bytes up to the session cap, and refuses nothing or too much', () => {
    expect(checkPseFile(PICKLE)).toEqual({ ok: true })
    expect(checkPseFile(new ArrayBuffer(0))).toEqual({ ok: false, reason: 'empty' })
    expect(checkPseFile(new ArrayBuffer(LIMITS.pseBytes + 1))).toEqual({ ok: false, reason: 'too-large' })
  })
})

describe('PymolPseExportDialog', () => {
  it('warns about .pse files and asks PyMOL for nothing until the press', () => {
    const exportPse = vi.fn(() => Promise.resolve(PICKLE))
    open(exportPse)
    expect(screen.getByText('pymol:pse_export_warn')).toBeInTheDocument()
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toMatch(/^1hsg_session_\d{8}-\d{4}$/)
    expect(exportPse).not.toHaveBeenCalled()
  })

  it('saves PyMOL’s session under the page’s own name with .pse', async () => {
    const exportPse = vi.fn(() => Promise.resolve(PICKLE))
    const { user } = open(exportPse)
    const name = screen.getByRole('textbox')
    await user.clear(name)
    await user.type(name, 'my/session.')
    await user.click(screen.getByRole('button', { name: 'pymol:pse_export_submit' }))
    expect(exportPse).toHaveBeenCalledOnce()
    expect(saveBlobFile).toHaveBeenCalledOnce()
    const [blob, file] = saveBlobFile.mock.calls[0] as [Blob, string]
    expect(file).toBe('my_session.pse')
    expect(blob.size).toBe(PICKLE.byteLength)
    expect(screen.getByRole('status')).toHaveTextContent('pymol:pse_export_done')
  })

  it('with a save step (the offline HTML file’s), hands it the session in place of the download, under the same title; its back brings the form back', async () => {
    const exportPse = vi.fn(() => Promise.resolve(PICKLE))
    const saveStep = vi.fn((file: { blob: Blob; name: string }, back: () => void) => (
      <div>
        <span>step {file.name} {file.blob.size}</span>
        <button type="button" onClick={back}>
          back
        </button>
      </div>
    ))
    render(<PymolPseExportDialog exportPse={exportPse} ready objectName="1hsg" onClose={vi.fn()} saveStep={saveStep} />)
    const user = userEvent.setup()
    const name = screen.getByRole('textbox')
    await user.clear(name)
    await user.type(name, 'mine')
    await user.click(screen.getByRole('button', { name: 'pymol:pse_export_submit' }))
    expect(await screen.findByText(`step mine.pse ${PICKLE.byteLength}`)).toBeInTheDocument()
    expect(saveBlobFile).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'pymol:pse_export_title' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'back' }))
    expect(screen.getByRole('textbox')).toHaveValue('mine')
  })

  it('saves nothing when PyMOL sends nothing, and says why', async () => {
    const { user } = open(() => Promise.resolve(new ArrayBuffer(0)))
    await user.click(screen.getByRole('button', { name: 'pymol:pse_export_submit' }))
    expect(saveBlobFile).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('pymol:pse_export_err_not_file')
  })

  it('says a stop and a failure in words, and saves nothing', async () => {
    const { user } = open(() => Promise.reject(new Error('cancelled')))
    await user.click(screen.getByRole('button', { name: 'pymol:pse_export_submit' }))
    expect(screen.getByRole('alert')).toHaveTextContent('pymol:export_err_cancelled')
    expect(saveBlobFile).not.toHaveBeenCalled()
  })

  it('keeps the button reachable but inert while PyMOL is not ready, and says why', async () => {
    const exportPse = vi.fn(() => Promise.resolve(PICKLE))
    const { user } = open(exportPse, false)
    const button = screen.getByRole('button', { name: 'pymol:pse_export_submit' })
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).toHaveAccessibleDescription('pymol:export_why_not_ready')
    await user.click(button)
    expect(exportPse).not.toHaveBeenCalled()
  })

  it('says an over-cap session as too large, not as its internal code (PT-9125 items 1, 2)', async () => {
    const { user } = open(() => Promise.reject(new Error('export-too-large')))
    await user.click(screen.getByRole('button', { name: 'pymol:pse_export_submit' }))
    expect(screen.getByRole('alert')).toHaveTextContent('pymol:pse_export_err_too_large')
    expect(screen.getByRole('alert')).not.toHaveTextContent('export_err_failed')
  })

  it('tells a failure of the save itself by its own message, not as no answer from a server (PT-9126 item 6)', async () => {
    saveBlobFile.mockImplementationOnce(() => {
      throw new TypeError('disk full')
    })
    const { user } = open(() => Promise.resolve(PICKLE))
    await user.click(screen.getByRole('button', { name: 'pymol:pse_export_submit' }))
    expect(screen.getByRole('alert')).toHaveTextContent('pymol:export_err_failed {"detail":"disk full"}')
  })

  it('holds open with Stop while a stoppable request runs, and closes freely while it only waits (PT-9126 items 2, 5)', async () => {
    let settle: (b: ArrayBuffer) => void = () => {}
    const exportPse = vi.fn(() => new Promise<ArrayBuffer>(r => { settle = r }))
    const onStop = vi.fn()
    const onClose = vi.fn()
    const user = userEvent.setup()
    const { rerender } = render(
      <PymolPseExportDialog exportPse={exportPse} ready stoppable onStop={onStop} objectName="1hsg" onClose={onClose} />,
    )
    await user.click(screen.getByRole('button', { name: 'pymol:pse_export_submit' }))
    const close = screen.getByRole('button', { name: 'pymol:dialog_close' })
    expect(close).toHaveAttribute('aria-disabled', 'true')
    await user.click(close)
    await user.keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'pymol:busy_cancel' }))
    expect(onStop).toHaveBeenCalledOnce()
    // Waiting behind a load: nothing to stop, so it may close, and says so.
    rerender(<PymolPseExportDialog exportPse={exportPse} ready waiting onStop={onStop} objectName="1hsg" onClose={onClose} />)
    expect(screen.queryByRole('button', { name: 'pymol:busy_cancel' })).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('pymol:pse_export_waiting_note')
    await user.click(screen.getByRole('button', { name: 'pymol:dialog_close' }))
    expect(onClose).toHaveBeenCalledOnce()
    settle(PICKLE)
  })

  it('withdraws a waiting request when it closes, saves nothing, and lets the page say so (PT-9127 item 1)', async () => {
    const signals: AbortSignal[] = []
    const exportPse = vi.fn(
      (signal: AbortSignal) =>
        new Promise<ArrayBuffer>((_resolve, reject) => {
          signals.push(signal)
          signal.addEventListener('abort', () => reject(new Error('withdrawn')))
        }),
    )
    const onWithdrawn = vi.fn()
    const user = userEvent.setup()
    const { unmount } = render(
      <PymolPseExportDialog exportPse={exportPse} ready waiting objectName="1hsg" onClose={vi.fn()} onWithdrawn={onWithdrawn} />,
    )
    await user.click(screen.getByRole('button', { name: 'pymol:pse_export_submit' }))
    expect(signals).toHaveLength(1)
    unmount()
    expect(signals[0].aborted).toBe(true)
    await vi.waitFor(() => expect(onWithdrawn).toHaveBeenCalledOnce())
    expect(saveBlobFile).not.toHaveBeenCalled()
  })

  it('offers Stop only once its own save is sent; queued behind another request it closes and withdraws (PT-9219 item 2)', async () => {
    let sent: () => void = () => {}
    let settle: (b: ArrayBuffer) => void = () => {}
    const signals: AbortSignal[] = []
    const exportPse = vi.fn(
      (signal: AbortSignal, onSent: () => void) =>
        new Promise<ArrayBuffer>((resolve, reject) => {
          signals.push(signal)
          sent = onSent
          settle = resolve
          signal.addEventListener('abort', () => reject(new Error('withdrawn')))
        }),
    )
    const onStop = vi.fn()
    const onClose = vi.fn()
    const user = userEvent.setup()
    // A command runs ahead of the save: Stop would act on it, not on the save.
    const dialog = (
      <PymolPseExportDialog exportPse={exportPse} tellsSent ready stoppable onStop={onStop} objectName="1hsg" onClose={onClose} />
    )
    const { rerender } = render(dialog)
    await user.click(screen.getByRole('button', { name: 'pymol:pse_export_submit' }))
    expect(screen.queryByRole('button', { name: 'pymol:busy_cancel' })).toBeNull()
    expect(screen.getByRole('button', { name: 'pymol:dialog_close' })).not.toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('status')).toHaveTextContent('pymol:pse_export_queued_note')
    expect(screen.getByRole('status')).not.toHaveTextContent('pymol:pse_export_working')
    // The save leaves the queue: now Stop acts on it, and the dialog holds.
    await act(async () => sent())
    rerender(dialog)
    expect(screen.getByRole('button', { name: 'pymol:dialog_close' })).toHaveAttribute('aria-disabled', 'true')
    await user.click(screen.getByRole('button', { name: 'pymol:busy_cancel' }))
    expect(onStop).toHaveBeenCalledOnce()
    await act(async () => settle(PICKLE))
    expect(saveBlobFile).toHaveBeenCalledOnce()
    expect(signals).toHaveLength(1)
  })

  it('holds against × and Escape pressed after the save is sent but before the dialog re-renders (PT-9244 item 6)', async () => {
    let sent = () => {}
    let settle = (_b: ArrayBuffer) => {}
    const exportPse = vi.fn(
      (_signal: AbortSignal, onSent: () => void) =>
        new Promise<ArrayBuffer>(resolve => {
          sent = onSent
          settle = resolve
        }),
    )
    const onClose = vi.fn()
    const onStop = vi.fn()
    const user = userEvent.setup()
    // Waiting behind a load: nothing Stop can end yet, so × closes until the save is sent.
    const dialog = (stoppable: boolean, waiting: boolean) => (
      <PymolPseExportDialog exportPse={exportPse} tellsSent ready stoppable={stoppable} waiting={waiting} onStop={onStop} objectName="1hsg" onClose={onClose} />
    )
    const { rerender } = render(dialog(false, true))
    await user.click(screen.getByRole('button', { name: 'pymol:pse_export_submit' }))
    const close = screen.getByRole('button', { name: 'pymol:dialog_close' })
    expect(close).not.toHaveAttribute('aria-disabled', 'true')
    // The save leaves the queue. No act(): React has not re-rendered when
    // the presses below arrive, so the handlers are the ones the last render
    // made, which still show a save that waits.
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      sent()
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      close.click()
      expect(close).not.toHaveAttribute('aria-disabled', 'true')
    } finally {
      error.mockRestore()
    }
    expect(onClose).not.toHaveBeenCalled()
    // Rendered, with the host's own state: the dialog holds, as it says.
    await act(async () => {})
    rerender(dialog(true, false))
    expect(screen.getByRole('button', { name: 'pymol:dialog_close' })).toHaveAttribute('aria-disabled', 'true')
    await act(async () => settle(PICKLE))
    expect(saveBlobFile).toHaveBeenCalledOnce()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes while queued behind another request, withdrawing the save (PT-9219 item 2)', async () => {
    const signals: AbortSignal[] = []
    const exportPse = vi.fn(
      (signal: AbortSignal) =>
        new Promise<ArrayBuffer>((_resolve, reject) => {
          signals.push(signal)
          signal.addEventListener('abort', () => reject(new Error('withdrawn')))
        }),
    )
    const onClose = vi.fn()
    const onStop = vi.fn()
    const user = userEvent.setup()
    render(<PymolPseExportDialog exportPse={exportPse} tellsSent ready stoppable onStop={onStop} objectName="1hsg" onClose={onClose} />)
    await user.click(screen.getByRole('button', { name: 'pymol:pse_export_submit' }))
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledOnce()
    expect(onStop).not.toHaveBeenCalled()
  })
})
