/**
 * 「分子をファイルに書き出す」 (PT-3615 item 1): the dialog with the real
 * `pymolExport.ts` behind it and a stub frame. What is checked is what the page
 * asks the frame for (format, selection), what it saves (only a file of that
 * format, under its own name) and what the dialog says.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PymolFrameError } from './pymolFrameError'

const saveTextFile = vi.fn()
vi.mock('../../lib/saveTextFile', () => ({ saveTextFile: (...a: unknown[]) => saveTextFile(...a) }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key} ${JSON.stringify(vars)}` : key),
    i18n: { language: 'ja' },
  }),
}))

import { PymolExportDialog } from './PymolExportDialog'

const enc = (s: string): ArrayBuffer => new TextEncoder().encode(s).buffer as ArrayBuffer
const PDB = 'ATOM      1  N   ALA A   1      11.104   6.134  -6.504  1.00  0.00           N\nEND\n'
const SDF = 'lig\n  PyMOL\n\n  1  0  0  0  0  0  0  0  0  0999 V2000\nM  END\n$$$$\n'

let requestExport: ReturnType<typeof vi.fn>
let cancel: ReturnType<typeof vi.fn>

beforeEach(() => {
  saveTextFile.mockReset()
  cancel = vi.fn(() => true)
  requestExport = vi.fn((_kind: string, opts: { format: string }) =>
    Promise.resolve({ kind: 'mol', bytes: enc(opts.format === 'sdf' ? SDF : PDB) }),
  )
})

/** What the page reads from the frame: a request Stop can end, a load, or nothing in flight. */
type InFlight = { stoppable: boolean; waiting: boolean }
const RUNNING: InFlight = { stoppable: true, waiting: false }
const LOADING: InFlight = { stoppable: false, waiting: true }
const NOTHING: InFlight = { stoppable: false, waiting: false }

function open(ready = true, inFlight: InFlight = RUNNING) {
  const onClose = vi.fn()
  const dialog = (f: InFlight) => (
    <PymolExportDialog frame={{ requestExport, cancel } as never} ready={ready} stoppable={f.stoppable} waiting={f.waiting} objectName="1hsg" onClose={onClose} />
  )
  const view = render(dialog(inFlight))
  return { onClose, user: userEvent.setup(), unmount: view.unmount, setInFlight: (f: InFlight) => view.rerender(dialog(f)) }
}

/** A request the test answers when it chooses. */
function holdRequest() {
  let answer: (v: unknown) => void = () => undefined
  let fail: (e: unknown) => void = () => undefined
  requestExport.mockImplementationOnce(
    () =>
      new Promise((resolve, reject) => {
        answer = resolve
        fail = reject
      }),
  )
  return { answer: (v: unknown) => answer(v), fail: (e: unknown) => fail(e) }
}

const submit = () => screen.getByRole('button', { name: 'pymol:export_submit' })

/**
 * Wait for the alert to say `text`. The dialog always renders its (empty) alert,
 * so `findByRole('alert')` resolves at once, before a failure's text lands; under
 * a loaded full-suite run that gap made the assertion read an empty alert (PT-11522).
 */
async function alertSays(text: string, options?: { normalizeWhitespace: boolean }): Promise<HTMLElement> {
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(text, options))
  return screen.getByRole('alert')
}
const HELD = 'pymol:export_why_close_busy {"stop":"pymol:busy_cancel"}'
const WAITING = 'pymol:export_waiting_note'
const nameBox = () => screen.getByLabelText('pymol:export_name_label') as HTMLInputElement

describe('PymolExportDialog', () => {
  it('writes the current selection as PDB by default, under <object>_sele_<date>.pdb', async () => {
    const { user } = open()
    expect(screen.getByRole('radio', { name: 'pymol:export_target_sele' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'pymol:export_format_pdb' })).toBeChecked()
    expect(nameBox().value).toMatch(/^1hsg_sele_\d{8}-\d{4}$/)
    await user.click(submit())
    expect(requestExport).toHaveBeenCalledWith('mol', { format: 'pdb', selection: 'sele', signal: expect.any(AbortSignal), onSent: expect.any(Function) })
    expect(saveTextFile).toHaveBeenCalledWith(PDB, nameBox().value, 'pdb', 'text/plain')
    expect(screen.getByRole('status')).toHaveTextContent('pymol:export_done_kib')
    expect(screen.getByRole('status')).toHaveTextContent(`${nameBox().value}.pdb`)
  })

  it('with a save step (the offline HTML file’s), hands it the file in place of the download; its back brings the form back with its choices', async () => {
    const saveStep = vi.fn((file: { blob: Blob; name: string }, back: () => void) => (
      <div>
        <span>
          step {file.name} {file.blob.type}
        </span>
        <button type="button" onClick={back}>
          back
        </button>
      </div>
    ))
    render(<PymolExportDialog frame={{ requestExport, cancel } as never} ready stoppable={false} waiting={false} objectName="1hsg" onClose={vi.fn()} saveStep={saveStep} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('radio', { name: 'pymol:export_format_sdf' }))
    const stem = nameBox().value
    await user.click(submit())
    expect(await screen.findByText(`step ${stem}.sdf text/plain;charset=utf-8`)).toBeInTheDocument()
    expect(saveTextFile).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'pymol:export_title' })).toBeInTheDocument()
    const [file] = saveStep.mock.calls[0]
    expect(await new Promise<string>(r => {
      const fr = new FileReader()
      fr.onload = () => r(String(fr.result))
      fr.readAsText(file.blob)
    })).toBe(SDF)
    await user.click(screen.getByRole('button', { name: 'back' }))
    expect(screen.getByRole('radio', { name: 'pymol:export_format_sdf' })).toBeChecked()
  })

  it('gives the size of a file of a mebibyte or more in MiB, the unit in the text (PT-3816 item 16)', async () => {
    const big = PDB + `REMARK${' '.repeat(74)}\n`.repeat(14_000)
    requestExport.mockResolvedValueOnce({ kind: 'mol', bytes: enc(big) })
    const { user } = open()
    await user.click(submit())
    expect(await screen.findByRole('status')).toHaveTextContent(`pymol:export_done_mib {"name":"${nameBox().value}.pdb","size":"1.1"}`)
  })

  it('gives a file just under a mebibyte as 1.0 MiB, the value it rounds to, not 1 024.0 KiB (PT-4164 item 8)', async () => {
    const justUnder = PDB + 'R'.repeat(1024 * 1024 - 1 - enc(PDB).byteLength)
    expect(enc(justUnder).byteLength).toBe(1024 * 1024 - 1)
    requestExport.mockResolvedValueOnce({ kind: 'mol', bytes: enc(justUnder) })
    const { user } = open()
    await user.click(submit())
    expect(await screen.findByRole('status')).toHaveTextContent(`pymol:export_done_mib {"name":"${nameBox().value}.pdb","size":"1.0"}`)
  })

  it('says what the save itself threw, not that a server gave no answer (PT-4164 item 7)', async () => {
    saveTextFile.mockImplementationOnce(() => {
      throw new TypeError('URL.createObjectURL is not a function')
    })
    const { user } = open()
    await user.click(submit())
    const alert = await alertSays('pymol:export_err_failed {"detail":"URL.createObjectURL is not a function"}')
    expect(alert).not.toHaveTextContent('pymol:detail_network')
  })

  it('names an untouched file at the time of the press, not of the opening, and shows that name (PT-3816 item 19)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date(2026, 9, 18, 9, 5))
      const { user } = open()
      expect(nameBox().value).toBe('1hsg_sele_20261018-0905')
      vi.setSystemTime(new Date(2026, 9, 18, 9, 47))
      await user.click(submit())
      expect(saveTextFile).toHaveBeenCalledWith(PDB, '1hsg_sele_20261018-0947', 'pdb', 'text/plain')
      expect(nameBox().value).toBe('1hsg_sele_20261018-0947')
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([
    ['cleared', ''],
    ['left with only dots and spaces', ' . . '],
  ])('takes a name field %s at a press as untouched again, so the next target and press name the file anew (PT-4213)', async (_how, typed) => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date(2026, 9, 18, 9, 5))
      const { user } = open()
      await user.clear(nameBox())
      if (typed !== '') await user.type(nameBox(), typed)
      vi.setSystemTime(new Date(2026, 9, 18, 9, 10))
      await user.click(submit())
      expect(saveTextFile).toHaveBeenLastCalledWith(PDB, '1hsg_sele_20261018-0910', 'pdb', 'text/plain')
      expect(nameBox().value).toBe('1hsg_sele_20261018-0910')
      vi.setSystemTime(new Date(2026, 9, 18, 9, 20))
      await user.click(screen.getByRole('radio', { name: 'pymol:export_target_all' }))
      expect(nameBox().value).toBe('1hsg_all_20261018-0920')
      vi.setSystemTime(new Date(2026, 9, 18, 9, 30))
      await user.click(submit())
      expect(saveTextFile).toHaveBeenLastCalledWith(PDB, '1hsg_all_20261018-0930', 'pdb', 'text/plain')
    } finally {
      vi.useRealTimers()
    }
  })

  it('ties the notes on the current selection and on SDF to their radios (PT-3816 item 20)', async () => {
    const { user } = open()
    expect(screen.getByRole('radio', { name: 'pymol:export_target_sele' })).toHaveAccessibleDescription('pymol:export_target_sele_note')
    const sdf = screen.getByRole('radio', { name: 'pymol:export_format_sdf' })
    expect(sdf).not.toHaveAccessibleDescription()
    await user.click(sdf)
    expect(sdf).toHaveAccessibleDescription('pymol:export_small_note')
  })

  it('writes ligands as SDF, says what SDF does not fix, and names the file after the target', async () => {
    const { user } = open()
    await user.click(screen.getByRole('radio', { name: 'pymol:export_target_ligand' }))
    await user.click(screen.getByRole('radio', { name: 'pymol:export_format_sdf' }))
    expect(screen.getByText('pymol:export_small_note')).toBeInTheDocument()
    expect(nameBox().value).toMatch(/^1hsg_ligand_/)
    await user.click(submit())
    expect(requestExport).toHaveBeenCalledWith('mol', { format: 'sdf', selection: 'organic', signal: expect.any(AbortSignal), onSent: expect.any(Function) })
    expect(saveTextFile).toHaveBeenCalledWith(SDF, expect.stringMatching(/^1hsg_ligand_/), 'sdf', 'text/plain')
  })

  it('sends a written selection trimmed, and refuses one that cannot be sent with the reason beside the button', async () => {
    const { user } = open()
    const field = screen.getByLabelText('pymol:export_custom_label')
    expect(field).toBeDisabled()
    await user.click(screen.getByRole('radio', { name: 'pymol:export_target_custom' }))
    expect(field).toBeEnabled()
    // Nothing written yet: the button stays, greyed, with why.
    expect(submit()).toHaveAttribute('aria-disabled', 'true')
    expect(submit()).toHaveAccessibleDescription('pymol:export_why_custom')
    await user.type(field, 'リガンド')
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText(/pymol:export_custom_invalid/)).toBeInTheDocument()
    // Written but unusable is said to be wrong, not missing (PT-3816 item 14).
    expect(submit()).toHaveAccessibleDescription('pymol:export_why_custom_invalid')
    await user.click(submit())
    expect(requestExport).not.toHaveBeenCalled()
    await user.clear(field)
    await user.type(field, '  resn LIG and chain A ')
    expect(submit()).toHaveAttribute('aria-disabled', 'false')
    await user.click(submit())
    expect(requestExport).toHaveBeenCalledWith('mol', { format: 'pdb', selection: 'resn LIG and chain A', signal: expect.any(AbortSignal), onSent: expect.any(Function) })
  })

  it('keeps a name the user typed when the target changes, and saves it without what Windows refuses', async () => {
    const { user } = open()
    await user.clear(nameBox())
    await user.type(nameBox(), 'HIV/プロテアーゼ:複合体')
    await user.click(screen.getByRole('radio', { name: 'pymol:export_target_all' }))
    expect(nameBox().value).toBe('HIV/プロテアーゼ:複合体')
    await user.click(submit())
    expect(requestExport).toHaveBeenCalledWith('mol', { format: 'pdb', selection: 'all', signal: expect.any(AbortSignal), onSent: expect.any(Function) })
    expect(saveTextFile).toHaveBeenCalledWith(PDB, 'HIV_プロテアーゼ_複合体', 'pdb', 'text/plain')
    // The field then shows the name the file was saved under (PT-4164 item 10).
    expect(nameBox().value).toBe('HIV_プロテアーゼ_複合体')
    await user.clear(nameBox())
    await user.type(nameBox(), 'CON')
    await user.click(submit())
    expect(saveTextFile).toHaveBeenLastCalledWith(PDB, 'CON_', 'pdb', 'text/plain')
    expect(nameBox().value).toBe('CON_')
    // A typed name that cleans to something stays typed after the press: a
    // later target leaves it alone (only one that cleans to nothing is reset, PT-4213).
    await user.click(screen.getByRole('radio', { name: 'pymol:export_target_ligand' }))
    expect(nameBox().value).toBe('CON_')
    await user.click(submit())
    expect(saveTextFile).toHaveBeenLastCalledWith(PDB, 'CON_', 'pdb', 'text/plain')
  })

  it.each([
    ['sele', 'export: invalid selection:  Error: Invalid selection name "sele".', 'pymol:export_err_no_sele'],
    ['sele', 'export: no atoms in the selection', 'pymol:export_err_empty'],
    ['sele', 'export-too-large', 'pymol:export_err_too_large'],
    ['sele', 'cancelled', 'pymol:export_err_cancelled'],
    ['polymer', 'PyMOL is not ready', 'pymol:export_err_failed'],
  ])('says why a %s export failed (%j) and saves nothing', async (target, message, key) => {
    requestExport.mockRejectedValueOnce(new PymolFrameError(message))
    const { user } = open()
    await user.click(screen.getByRole('radio', { name: `pymol:export_target_${target}` }))
    await user.click(submit())
    await alertSays(key)
    expect(screen.getByRole('status')).toHaveTextContent('')
    expect(saveTextFile).not.toHaveBeenCalled()
  })

  it.each([
    ['export: invalid selection', 'pymol:export_err_unknown_selection_bare'],
    ['', 'pymol:export_err_failed_bare'],
    [
      'Traceback (most recent call last):\n  File "<exec>", line 1\nRuntimeError: boom',
      'pymol:export_err_failed {"detail":"Traceback (most recent call last): File \\"<exec>\\", line 1 RuntimeError: boom"}',
    ],
    ['x'.repeat(300), `pymol:export_err_failed {"detail":"${'x'.repeat(200)}…"}`],
    ['PyMOL is not ready', 'pymol:export_err_failed {"detail":"pymol:detail_not_ready"}'],
    ['export-too-large', 'pymol:export_err_too_large {"limit":"32"}'],
  ])('puts text from PyMOL on one line, cut, and ends a failure with none on its own words (%j; PT-3816 items 6, 16)', async (message, text) => {
    requestExport.mockRejectedValueOnce(new PymolFrameError(message))
    const { user } = open()
    await user.click(screen.getByRole('radio', { name: 'pymol:export_target_polymer' }))
    await user.click(submit())
    await alertSays(text, { normalizeWhitespace: false })
  })

  it('says PyMOL could not read a written selection, in PyMOL’s words (PT-3816 item 17)', async () => {
    requestExport.mockRejectedValueOnce(new PymolFrameError('export: invalid selection: Selector-Error: Invalid selection name "LIG".'))
    const { user } = open()
    await user.click(screen.getByRole('radio', { name: 'pymol:export_target_custom' }))
    await user.type(screen.getByLabelText('pymol:export_custom_label'), 'LIG')
    await user.click(submit())
    await alertSays('pymol:export_err_unknown_selection {"detail":"Selector-Error: Invalid selection name \\"LIG\\"."}')
    expect(saveTextFile).not.toHaveBeenCalled()
  })

  it('answers for what was asked when the choices change while the request runs (PT-3816 item 17)', async () => {
    const first = holdRequest()
    const { user } = open()
    await user.click(submit())
    const asked = nameBox().value
    // Changed while PyMOL works: the reply is still the current selection's PDB, under the name it was asked with.
    await user.click(screen.getByRole('radio', { name: 'pymol:export_target_ligand' }))
    await user.click(screen.getByRole('radio', { name: 'pymol:export_format_sdf' }))
    expect(nameBox().value).toMatch(/^1hsg_ligand_/)
    first.answer({ kind: 'mol', bytes: enc(PDB) })
    expect(await screen.findByText(/pymol:export_done_kib/)).toBeInTheDocument()
    expect(saveTextFile).toHaveBeenCalledWith(PDB, asked, 'pdb', 'text/plain')

    // A failure is told for the target asked (no current selection), not for the one chosen since.
    const second = holdRequest()
    await user.click(screen.getByRole('radio', { name: 'pymol:export_target_sele' }))
    await user.click(submit())
    await user.click(screen.getByRole('radio', { name: 'pymol:export_target_polymer' }))
    second.fail(new PymolFrameError('export: invalid selection: Selector-Error: Invalid selection name "sele".'))
    await alertSays('pymol:export_err_no_sele')
    expect(saveTextFile).toHaveBeenCalledTimes(1)
  })

  it('saves nothing when the frame answers with something that is not a file of the format', async () => {
    requestExport.mockResolvedValueOnce({ kind: 'mol', bytes: enc(SDF) })
    const { user } = open()
    await user.click(submit())
    await alertSays('pymol:export_err_not_file {"format":"PDB"}')
    expect(saveTextFile).not.toHaveBeenCalled()
  })

  it('names mmCIF as its choice does, not as "CIF" (PT-9126 items 3, 8)', async () => {
    requestExport.mockResolvedValueOnce({ kind: 'mol', bytes: enc(SDF) })
    const { user } = open()
    await user.click(screen.getByRole('radio', { name: 'pymol:export_format_cif' }))
    await user.click(submit())
    await alertSays('pymol:export_err_not_file {"format":"mmCIF"}')
  })

  it('asks nothing while PyMOL is not ready, and says so', async () => {
    const { user } = open(false)
    expect(submit()).toHaveAttribute('aria-disabled', 'true')
    expect(submit()).toHaveAccessibleDescription('pymol:export_why_not_ready')
    await user.click(submit())
    expect(requestExport).not.toHaveBeenCalled()
  })

  it('says PyMOL is not ready, rather than doing nothing, when there is no frame to ask (PT-3816 item 12)', async () => {
    render(<PymolExportDialog frame={null} ready stoppable={false} waiting={false} objectName="1hsg" onClose={vi.fn()} />)
    expect(submit()).toHaveAttribute('aria-disabled', 'true')
    expect(submit()).toHaveAccessibleDescription('pymol:export_why_not_ready')
    await userEvent.setup().click(submit())
    expect(screen.getByRole('status')).toHaveTextContent('')
    expect(saveTextFile).not.toHaveBeenCalled()
  })

  it('makes one request for two submits before a re-render (the busyRef guard, PT-3816)', async () => {
    const held = holdRequest()
    open()
    const form = submit().closest('form') as HTMLFormElement
    // Both in one act: the second runs before React re-renders with busy, so
    // only the ref can stop it.
    act(() => {
      fireEvent.submit(form)
      fireEvent.submit(form)
    })
    expect(requestExport).toHaveBeenCalledTimes(1)
    held.answer({ kind: 'mol', bytes: enc(PDB) })
    expect(await screen.findByText(/pymol:export_done/)).toBeInTheDocument()
    expect(saveTextFile).toHaveBeenCalledTimes(1)
  })

  it('keeps the focus on the button while a request runs, and takes a second press as nothing', async () => {
    const held = holdRequest()
    const { user } = open()
    await user.click(submit())
    await user.click(submit())
    expect(requestExport).toHaveBeenCalledTimes(1)
    expect(submit()).toHaveAttribute('aria-disabled', 'true')
    expect(submit()).toHaveFocus()
    expect(screen.getByRole('status')).toHaveTextContent('pymol:export_working')
    held.answer({ kind: 'mol', bytes: enc(PDB) })
    expect(await screen.findByText(/pymol:export_done/)).toBeInTheDocument()
    expect(submit()).toHaveAttribute('aria-disabled', 'false')
  })

  it('does not close while a request runs — × and Escape are refused, the reason in the status line — and offers 止める instead (PT-3816)', async () => {
    const held = holdRequest()
    const { user, onClose } = open()
    const close = screen.getByRole('button', { name: 'pymol:dialog_close' })
    expect(screen.queryByRole('button', { name: 'pymol:busy_cancel' })).toBeNull()
    await user.click(submit())
    expect(close).toHaveAttribute('aria-disabled', 'true')
    expect(close).toHaveAccessibleDescription(HELD)
    await user.click(close)
    await user.keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()
    const stop = screen.getByRole('button', { name: 'pymol:busy_cancel' })
    expect(stop).toHaveAccessibleDescription('pymol:busy_cancel_note')
    await user.click(stop)
    expect(cancel).toHaveBeenCalledTimes(1)
    // The controller rejects the request it cancelled; the dialog can close again.
    held.fail(new PymolFrameError('cancelled'))
    await alertSays('pymol:export_err_cancelled')
    expect(close).toHaveAttribute('aria-disabled', 'false')
    expect(close).not.toHaveAccessibleDescription()
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
    await user.click(close)
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('closes with Escape and × while nothing runs (PT-3827)', async () => {
    const { user, onClose } = open()
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'pymol:dialog_close' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('lets the dialog close while the export only waits behind a load, which Stop cannot end (PT-3827)', async () => {
    holdRequest()
    const { user, onClose, setInFlight } = open(true, LOADING)
    const close = screen.getByRole('button', { name: 'pymol:dialog_close' })
    await user.click(submit())
    // It has not started, so the status line does not say 書き出し中 (PT-3853).
    expect(screen.getByRole('status')).not.toHaveTextContent('pymol:export_working')
    expect(screen.getByRole('status')).toHaveTextContent(WAITING)
    expect(screen.queryByRole('button', { name: 'pymol:busy_cancel' })).toBeNull()
    expect(close).toHaveAttribute('aria-disabled', 'false')
    expect(close).toHaveAccessibleDescription(WAITING)
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
    await user.click(close)
    expect(onClose).toHaveBeenCalledTimes(2)
    // The load ends and the export goes out: from then on Stop can end it, so
    // the dialog holds open and offers it.
    setInFlight(RUNNING)
    expect(close).toHaveAttribute('aria-disabled', 'true')
    expect(close).toHaveAccessibleDescription(HELD)
    expect(screen.getByRole('button', { name: 'pymol:busy_cancel' })).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent('pymol:export_working')
    expect(screen.getByRole('status')).not.toHaveTextContent(WAITING)
    await user.keyboard('{Escape}')
    await user.click(close)
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('says nothing about waiting when nothing is in flight — between requests, or as the reply lands (PT-3853)', async () => {
    const held = holdRequest()
    const { user, setInFlight } = open(true, RUNNING)
    const close = screen.getByRole('button', { name: 'pymol:dialog_close' })
    await user.click(submit())
    // The controller clears its busy state before it hands over the reply.
    setInFlight(NOTHING)
    expect(screen.getByRole('status')).not.toHaveTextContent(WAITING)
    expect(close).not.toHaveAccessibleDescription()
    held.answer({ kind: 'mol', bytes: enc(PDB) })
    expect(await screen.findByText(/pymol:export_done/)).toBeInTheDocument()
    expect(screen.getByRole('status')).not.toHaveTextContent(WAITING)
  })

  it('says why it may or may not close in the status line under the button, so a change is spoken and nothing above moves (PT-3851)', async () => {
    holdRequest()
    const { user, setInFlight } = open(true, LOADING)
    const status = screen.getByRole('status')
    // Only the part that changed is read out, not the whole line again.
    expect(status).toHaveAttribute('aria-atomic', 'false')
    const head = screen.getByRole('heading', { name: 'pymol:export_title' }).parentElement as HTMLElement
    const underHead = () => head.nextElementSibling
    expect(underHead()).toHaveTextContent('pymol:export_note_v2')
    await user.click(submit())
    // The live region was there before the press, and the reason is in it.
    expect(screen.getByRole('status')).toBe(status)
    expect(status).toHaveTextContent(WAITING)
    expect(underHead()).toHaveTextContent('pymol:export_note_v2')
    setInFlight(RUNNING)
    expect(status).toHaveTextContent(HELD)
    expect(underHead()).toHaveTextContent('pymol:export_note_v2')
    expect(submit().compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('hands the focus to 書き出す when Stop goes away under it (PT-3827, PT-3851)', async () => {
    const held = holdRequest()
    const { user, setInFlight } = open()
    await user.click(submit())
    // The queue moves on to a load: Stop goes while it holds the focus.
    screen.getByRole('button', { name: 'pymol:busy_cancel' }).focus()
    setInFlight(LOADING)
    expect(screen.queryByRole('button', { name: 'pymol:busy_cancel' })).toBeNull()
    expect(submit()).toHaveFocus()
    // Stop pressed: the request ends and Stop goes with it.
    setInFlight(RUNNING)
    await user.click(screen.getByRole('button', { name: 'pymol:busy_cancel' }))
    held.fail(new PymolFrameError('cancelled'))
    await alertSays('pymol:export_err_cancelled')
    expect(submit()).toHaveFocus()
  })

  it('leaves the focus where the user put it when Stop goes away (PT-3853)', async () => {
    holdRequest()
    const { user, setInFlight } = open()
    await user.click(submit())
    nameBox().focus()
    setInFlight(LOADING)
    expect(nameBox()).toHaveFocus()
    setInFlight(RUNNING)
    const close = screen.getByRole('button', { name: 'pymol:dialog_close' })
    close.focus()
    setInFlight(LOADING)
    expect(close).toHaveFocus()
  })

  // Aborts whatever the request waits behind: taking it out of the queue,
  // and leaving one already sent alone, is the frame controller's.
  it('aborts its request’s signal when it goes before the reply, and not once the request is over (PT-3851 item 2)', async () => {
    holdRequest()
    const first = open(true, LOADING)
    await first.user.click(submit())
    const waiting = (requestExport.mock.calls[0][1] as { signal: AbortSignal }).signal
    expect(waiting.aborted).toBe(false)
    first.unmount()
    expect(waiting.aborted).toBe(true)

    const second = open()
    await second.user.click(submit())
    expect(await screen.findByText(/pymol:export_done/)).toBeInTheDocument()
    const done = (requestExport.mock.calls[1][1] as { signal: AbortSignal }).signal
    second.unmount()
    expect(done.aborted).toBe(false)
  })

  it('hands a withdrawal to the page once it is gone, and says one itself while it stays (PT-4071 items 4, 8)', async () => {
    const onWithdrawn = vi.fn()
    const gone = holdRequest()
    const first = render(
      <PymolExportDialog frame={{ requestExport, cancel } as never} ready stoppable={false} waiting objectName="1hsg" onClose={vi.fn()} onWithdrawn={onWithdrawn} />,
    )
    await userEvent.setup().click(submit())
    first.unmount()
    await act(async () => {
      gone.fail(new PymolFrameError('withdrawn'))
    })
    expect(onWithdrawn).toHaveBeenCalledTimes(1)

    // Any other end after the dialog went is nobody's to hear.
    const failed = holdRequest()
    const second = render(
      <PymolExportDialog frame={{ requestExport, cancel } as never} ready stoppable={false} waiting objectName="1hsg" onClose={vi.fn()} onWithdrawn={onWithdrawn} />,
    )
    await userEvent.setup().click(submit())
    second.unmount()
    await act(async () => {
      failed.fail(new PymolFrameError('the PyMOL frame was closed'))
    })
    expect(onWithdrawn).toHaveBeenCalledTimes(1)

    // Still open (a development Fast Refresh re-runs the effects): the dialog
    // says it in words, not as a raw `withdrawn`.
    requestExport.mockRejectedValueOnce(new PymolFrameError('withdrawn'))
    const { user } = open(true, LOADING)
    await user.click(submit())
    await alertSays('pymol:export_withdrawn')
    expect(onWithdrawn).toHaveBeenCalledTimes(1)
  })

  it('with tellsSent, offers Stop only once its own export is sent; queued behind another request it closes and withdraws (PT-9232 item 1)', async () => {
    let sent: () => void = () => undefined
    let answer: (v: unknown) => void = () => undefined
    const signals: AbortSignal[] = []
    requestExport.mockImplementationOnce(
      (_kind: string, opts: { signal: AbortSignal; onSent: () => void }) =>
        new Promise((resolve, reject) => {
          signals.push(opts.signal)
          sent = opts.onSent
          answer = resolve
          opts.signal.addEventListener('abort', () => reject(new PymolFrameError('withdrawn')))
        }),
    )
    const onClose = vi.fn()
    // A command runs ahead of the export: Stop would act on it, not on the export.
    const dialog = (
      <PymolExportDialog frame={{ requestExport, cancel } as never} tellsSent ready stoppable waiting={false} objectName="1hsg" onClose={onClose} />
    )
    const { rerender } = render(dialog)
    const user = userEvent.setup()
    await user.click(submit())
    expect(screen.queryByRole('button', { name: 'pymol:busy_cancel' })).toBeNull()
    expect(screen.getByRole('button', { name: 'pymol:dialog_close' })).not.toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('status')).toHaveTextContent('pymol:export_queued_note')
    expect(screen.getByRole('status')).not.toHaveTextContent('pymol:export_working')
    // The export leaves the queue: now Stop acts on it, and the dialog holds.
    await act(async () => sent())
    rerender(dialog)
    expect(screen.getByRole('button', { name: 'pymol:dialog_close' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('status')).toHaveTextContent(HELD)
    await user.click(screen.getByRole('button', { name: 'pymol:busy_cancel' }))
    expect(cancel).toHaveBeenCalledOnce()
    await act(async () => answer({ kind: 'mol', bytes: enc(PDB) }))
    expect(saveTextFile).toHaveBeenCalledOnce()
    expect(signals).toHaveLength(1)
  })

  it('with tellsSent, Escape while queued behind another request closes it and withdraws the export, never Stop (PT-9232 item 1)', async () => {
    const signals: AbortSignal[] = []
    requestExport.mockImplementationOnce(
      (_kind: string, opts: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          signals.push(opts.signal)
          opts.signal.addEventListener('abort', () => reject(new PymolFrameError('withdrawn')))
        }),
    )
    const onClose = vi.fn()
    render(<PymolExportDialog frame={{ requestExport, cancel } as never} tellsSent ready stoppable waiting={false} objectName="1hsg" onClose={onClose} />)
    const user = userEvent.setup()
    await user.click(submit())
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledOnce()
    expect(cancel).not.toHaveBeenCalled()
  })

  it('with tellsSent, × in the moment the export is sent, before the re-render, does not close it (PT-9249 item 3)', async () => {
    let sent: () => void = () => undefined
    requestExport.mockImplementationOnce(
      (_kind: string, opts: { signal: AbortSignal; onSent: () => void }) =>
        new Promise(() => {
          sent = opts.onSent
        }),
    )
    const onClose = vi.fn()
    render(<PymolExportDialog frame={{ requestExport, cancel } as never} tellsSent ready stoppable waiting={false} objectName="1hsg" onClose={onClose} />)
    const user = userEvent.setup()
    await user.click(submit())
    const close = screen.getByRole('button', { name: 'pymol:dialog_close' })
    // The request leaves the queue and × is pressed in the same task: no render between them.
    act(() => {
      sent()
      close.click()
    })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('with tellsSent, says it waits for an earlier request only while one runs (PT-9249 item 6)', async () => {
    requestExport.mockImplementationOnce(() => new Promise(() => undefined))
    // Nothing ahead of it (stoppable false, no load): the plain working text.
    render(<PymolExportDialog frame={{ requestExport, cancel } as never} tellsSent ready stoppable={false} waiting={false} objectName="1hsg" onClose={vi.fn()} />)
    const user = userEvent.setup()
    await user.click(submit())
    expect(screen.getByRole('status')).toHaveTextContent('pymol:export_working')
    expect(screen.getByRole('status')).not.toHaveTextContent('pymol:export_queued_note')
  })

  it('saves nothing when the dialog is gone before the reply (the page moved on)', async () => {
    const held = holdRequest()
    const { user, unmount } = open()
    await user.click(submit())
    unmount()
    await act(async () => {
      held.answer({ kind: 'mol', bytes: enc(PDB) })
    })
    expect(saveTextFile).not.toHaveBeenCalled()
  })

  it('keeps the radios out of the .form-group input rule, which would stretch them (PT-3816)', () => {
    open()
    for (const radio of screen.getAllByRole('radio')) expect(radio.closest('.form-group')).toBeNull()
    expect(screen.getByLabelText('pymol:export_name_label').closest('.pymolv-name-row')).not.toBeNull()
  })

  it('gives the radio labels normal weight, leaves the radios the app-wide accent, and no rule names a .form-group radio (PT-3827 items 8, 11; PT-4086)', () => {
    open()
    const css = readFileSync(join(__dirname, 'pymolViewer.css'), 'utf-8')
    // A rule whose selector list is exactly `selector`, starting a line.
    const body = (selector: string) => new RegExp(`(?:^|\\n)${selector.replace(/[.[\]]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css)?.[1]
    for (const radio of screen.getAllByRole('radio')) {
      expect((radio.closest('label') as HTMLElement).matches('.pymolv-dialog .pymolv-choice')).toBe(true)
    }
    expect(body('.pymolv-dialog .pymolv-choice')).toMatch(/font-weight:\s*normal/)
    // The radios' colour is index.css's --blue-text;
    // a colour of their own here was --blue-dark, 2.21:1 on white (PT-4086).
    expect(css).not.toMatch(/accent-color/)
    expect(css).not.toMatch(/\.form-group input\[type="radio"\]/)
  })
})
