/**
 * 「HTMLappとして出力」's form: the edition and the contents, each choice not
 * offered saying why (a light file has no PyMOL to copy; a .pse needs PyMOL).
 * What the copy holds is selfCopy.test.ts's.
 */
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { gzipSync } from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key} ${JSON.stringify(vars)}` : key), i18n: { language: 'ja' } }),
}))

const saveBlobFile = vi.fn()
vi.mock('../../src/lib/saveBlobFile', () => ({ saveBlobFile: (...a: unknown[]) => saveBlobFile(...a) }))
const makeAppCopy = vi.fn(async (_req: unknown) => new Blob(['copy']))
vi.mock('./selfCopy', async importOriginal => {
  const real = await importOriginal<typeof import('./selfCopy')>()
  // The copy itself is selfCopy.test.ts's; here only its name and what it was asked for matter.
  return { ...real, makeAppCopy: (req: unknown) => makeAppCopy(req) }
})

import { resetModalStackForTests } from '../../src/components/modalStack'
import { viewerPackFileStem } from '../../src/pages/structure-html-export/viewerPackFileName'
import { blockElement } from '../../src/pages/structure-html-export/standaloneFormat'
import { AppCopyDialog } from './AppCopyDialog'
import type { PageConfig } from './blocks'
import type { StructureDoc } from './localFile'
import { captureTemplate, resetTemplateForTests, setRuntimeBlocksForTests } from './selfCopy'

const LIGHT: PageConfig = {
  edition: 'light',
  structureId: 0,
  title: '',
  code: null,
  exporterName: null,
  lang: 'ja',
  initialEngine: '3dmol',
  bColumn: 'bfactor',
  exportedAt: '',
  timeZone: null,
  pymolView: null,
  skipped: [],
  runtime: null,
}

const block = (name: string, text: string) => blockElement(name, gzipSync(Buffer.from(text)).toString('base64'), Buffer.byteLength(text))

/** A light page's template, captured from a document of its own (the test's page stays the dialog's). */
function lightPage() {
  const page = document.implementation.createHTMLDocument('t')
  page.body.innerHTML = `<div id="root"></div>${block('config', '{}')}${block('3dmol', 'x')}${block('licenses', '[]')}`
  captureTemplate(page)
}

/**
 * A page whose 3Dmol.js block is over the phone warning's size (17 MB). The
 * block's text goes in as one text node, not through the HTML parser: parsing
 * 17 MB took jsdom seconds, and the tests timed out on a busy host (PT-10483).
 */
function bigPage(): Document {
  const page = document.implementation.createHTMLDocument('t')
  page.body.innerHTML = `<div id="root"></div>${block('config', '{}')}${blockElement('3dmol', '', 1)}${block('licenses', '[]')}`
  page.getElementById('agdb-3dmol')!.appendChild(page.createTextNode('A'.repeat(17 * 1024 * 1024)))
  return page
}

afterEach(() => {
  cleanup()
  saveBlobFile.mockClear()
  makeAppCopy.mockClear()
  vi.useRealTimers()
  resetModalStackForTests()
  resetTemplateForTests()
})

const pse: StructureDoc = { name: 's.pse', stem: 's', ext: 'pse', bytes: new ArrayBuffer(8), text: null, serial: 2 }

describe('AppCopyDialog', () => {
  it('a light file offers no full edition, and says why', () => {
    lightPage()
    render(<AppCopyDialog config={LIGHT} doc={null} lang="ja" engine="3dmol" onClose={() => undefined} onSaved={() => undefined} />)
    const full = screen.getByRole('radio', { name: /sa_app_full/ })
    expect(full).toHaveAttribute('aria-disabled', 'true')
    expect(full).toHaveAccessibleDescription('htmlExport:sa_app_full_unavailable')
    expect(screen.getByRole('radio', { name: /sa_app_light/ })).toBeChecked()
    // Nothing open: blank only.
    expect(screen.getByRole('radio', { name: 'htmlExport:sa_app_with_none' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('radio', { name: 'htmlExport:sa_app_blank' })).toBeChecked()
  })

  it('a .pse cannot go into the light edition: said, and Save does nothing until blank is chosen', async () => {
    lightPage()
    const user = userEvent.setup()
    const onSaved = vi.fn()
    render(<AppCopyDialog config={LIGHT} doc={pse} lang="ja" engine="3dmol" onClose={() => undefined} onSaved={onSaved} />)
    expect(screen.getByText('htmlExport:sa_app_pse_light')).toBeInTheDocument()
    const save = screen.getByRole('button', { name: /sa_app_save/ })
    expect(save).toHaveAttribute('aria-disabled', 'true')
    // Save carries the reason, and so does the Light radio that caused it (PT-9275 items 2, 3).
    expect(save).toHaveAccessibleDescription('htmlExport:sa_app_pse_light')
    expect(screen.getByRole('radio', { name: /sa_app_light/ })).toHaveAccessibleDescription('htmlExport:sa_app_pse_light')
    await user.click(save)
    expect(onSaved).not.toHaveBeenCalled()
    // A refused press says why, in the alert region.
    expect(screen.getByRole('alert')).toHaveTextContent('htmlExport:sa_app_pse_light')
    await user.click(screen.getByRole('radio', { name: 'htmlExport:sa_app_blank' }))
    expect(screen.queryByText('htmlExport:sa_app_pse_light')).toBeNull()
    expect(screen.getByRole('button', { name: /sa_app_save/ })).not.toHaveAttribute('aria-disabled')
    expect(screen.getByRole('button', { name: /sa_app_save/ })).not.toHaveAccessibleDescription()
    // Choosing "with" again brings the refusal back, and the status region says so.
    await user.click(screen.getByRole('radio', { name: /sa_app_with/ }))
    expect(screen.getByRole('status')).toHaveTextContent('htmlExport:sa_app_pse_light')
  })

  it('warns a touch device off a large copy whatever the layout, and ties the warning to Save (PT-9275 item 4)', () => {
    captureTemplate(bigPage())
    const mm = vi.spyOn(window, 'matchMedia').mockImplementation(q => ({ matches: q === '(any-pointer: coarse)', media: q, onchange: null, addListener: () => undefined, removeListener: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false }) as MediaQueryList)
    render(<AppCopyDialog config={LIGHT} doc={null} lang="ja" engine="3dmol" onClose={() => undefined} onSaved={() => undefined} />)
    expect(screen.getByRole('button', { name: /sa_app_save/ })).toHaveAccessibleDescription(/sa_app_phone_warn/)
    mm.mockRestore()
  })

  it('warns a tablet whose main pointer is fine, and a touch screen media queries do not report (PT-9303 item 2)', () => {
    const mediaQuery = (match: (q: string) => boolean) => vi.spyOn(window, 'matchMedia').mockImplementation(q => ({ matches: match(q), media: q, onchange: null, addListener: () => undefined, removeListener: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false }) as MediaQueryList)
    const open = () => {
      captureTemplate(bigPage())
      return render(<AppCopyDialog config={LIGHT} doc={null} lang="ja" engine="3dmol" onClose={() => undefined} onSaved={() => undefined} />)
    }
    // An iPad with a trackpad: the main pointer is fine, the touch screen is still there.
    let mm = mediaQuery(q => q === '(pointer: fine)' || q === '(any-pointer: coarse)')
    let view = open()
    expect(screen.getByRole('button', { name: /sa_app_save/ })).toHaveAccessibleDescription(/sa_app_phone_warn/)
    view.unmount()
    mm.mockRestore()
    // Media queries that report no pointer at all: the touch points decide.
    mm = mediaQuery(() => false)
    // jsdom's navigator has no maxTouchPoints: an own one, removed after.
    Object.defineProperty(navigator, 'maxTouchPoints', { value: 5, configurable: true })
    try {
      view = open()
      expect(screen.getByRole('button', { name: /sa_app_save/ })).toHaveAccessibleDescription(/sa_app_phone_warn/)
      view.unmount()
    } finally {
      delete (navigator as { maxTouchPoints?: number }).maxTouchPoints
      mm.mockRestore()
    }
  })

  it('no warning on a computer, even for a large copy', () => {
    captureTemplate(bigPage())
    const mm = vi.spyOn(window, 'matchMedia').mockImplementation(q => ({ matches: false, media: q, onchange: null, addListener: () => undefined, removeListener: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false }) as MediaQueryList)
    render(<AppCopyDialog config={LIGHT} doc={null} lang="ja" engine="3dmol" onClose={() => undefined} onSaved={() => undefined} />)
    expect(screen.queryByText(/sa_app_phone_warn/)).toBeNull()
    mm.mockRestore()
  })
})

describe('AppCopyDialog file name (owner 2026-11-16)', () => {
  const pdb: StructureDoc = { name: '1crn.pdb', stem: '1crn', ext: 'pdb', bytes: new ArrayBuffer(8), text: 'ATOM', serial: 1 }
  const day = new Date(2026, 10, 16, 10, 0)
  const nameBox = () => screen.getByLabelText('pymol:export_name_label') as HTMLInputElement
  const saveBtn = () => screen.getByRole('button', { name: /sa_app_save/ })
  const openWith = (doc: StructureDoc | null) => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(day)
    lightPage()
    const onSaved = vi.fn()
    render(<AppCopyDialog config={LIGHT} doc={doc} lang="ja" engine="3dmol" onClose={() => undefined} onSaved={onSaved} />)
    return { user: userEvent.setup(), onSaved }
  }

  it('starts from the structure’s stem, the app, its version, the edition and the date; .html fixed beside it', () => {
    openWith(pdb)
    expect(nameBox().value).toBe(viewerPackFileStem('1crn', 'light', day))
    expect(nameBox().value).toMatch(/^1crn_AgroDesign-ProteinViewerPack-v\d+\.\d+\.\d+_light_20261116$/)
    expect(screen.getByText('.html')).toBeInTheDocument()
    // The phone note: the system may rename a download.
    expect(nameBox()).toHaveAccessibleDescription('htmlExport:file_phone_note')
  })

  it('an untouched name follows the contents and is saved as made at the press', async () => {
    const { user, onSaved } = openWith(pdb)
    await user.click(screen.getByRole('radio', { name: 'htmlExport:sa_app_blank' }))
    // A blank copy carries no structure: no stem in its name.
    expect(nameBox().value).toBe(viewerPackFileStem('', 'light', day))
    const later = new Date(2026, 10, 17, 9, 0)
    vi.setSystemTime(later)
    await user.click(saveBtn())
    await user.click(await screen.findByRole('button', { name: 'htmlExport:sa_save_default' }))
    await vi.waitFor(() => expect(saveBlobFile).toHaveBeenCalled())
    expect(saveBlobFile.mock.calls[0][1]).toBe(`${viewerPackFileStem('', 'light', later)}.html`)
    expect(onSaved).toHaveBeenCalledWith(`${viewerPackFileStem('', 'light', later)}.html`, 4, 'started')
  })

  it('Save makes the file first, then the same dialog shows the save step; 「設定に戻る」 brings the choices back as they were', async () => {
    const { user, onSaved } = openWith(pdb)
    const dialog = screen.getByRole('dialog')
    await user.click(screen.getByRole('radio', { name: 'htmlExport:sa_app_blank' }))
    await user.click(saveBtn())
    // The file is made before the step is shown; nothing is saved until a way is chosen.
    expect(await screen.findByRole('button', { name: 'htmlExport:sa_save_default' })).toBeInTheDocument()
    expect(makeAppCopy).toHaveBeenCalledOnce()
    expect(saveBlobFile).not.toHaveBeenCalled()
    expect(onSaved).not.toHaveBeenCalled()
    // One dialog, the same one: no second dialog over it.
    expect(screen.getAllByRole('dialog')).toEqual([dialog])
    expect(screen.getByText(`${viewerPackFileStem('', 'light', day)}.html`)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'htmlExport:sa_save_back' }))
    expect(screen.getByRole('radio', { name: 'htmlExport:sa_app_blank' })).toBeChecked()
    expect(nameBox().value).toBe(viewerPackFileStem('', 'light', day))
  })

  it('a typed name keeps through a choice, a pasted .html is not doubled', async () => {
    const { user } = openWith(pdb)
    await user.clear(nameBox())
    await user.type(nameBox(), 'my copy.html')
    await user.click(screen.getByRole('radio', { name: 'htmlExport:sa_app_blank' }))
    expect(nameBox().value).toBe('my copy.html')
    await user.click(saveBtn())
    await user.click(await screen.findByRole('button', { name: 'htmlExport:sa_save_default' }))
    await vi.waitFor(() => expect(saveBlobFile).toHaveBeenCalled())
    expect(saveBlobFile.mock.calls[0][1]).toBe('my copy.html')
  })

  it('「デフォルト名」 puts the default back, focuses the field and says so', async () => {
    const { user } = openWith(pdb)
    await user.clear(nameBox())
    await user.type(nameBox(), 'lost')
    const reset = screen.getByRole('button', { name: 'htmlExport:file_default_aria' })
    expect(reset).toHaveTextContent('htmlExport:file_default')
    await user.click(reset)
    expect(nameBox().value).toBe(viewerPackFileStem('1crn', 'light', day))
    expect(nameBox()).toHaveFocus()
    expect(screen.getByRole('status')).toHaveTextContent('htmlExport:file_default_done')
    // Untouched again: it follows the contents once more.
    await user.click(screen.getByRole('radio', { name: 'htmlExport:sa_app_blank' }))
    expect(nameBox().value).toBe(viewerPackFileStem('', 'light', day))
  })

  it('at the press the field shows the cleaned name and is shut while the copy is made; a failed press saves next under that name (PT-9472)', async () => {
    const { user } = openWith(pdb)
    let fail: (err: Error) => void = () => undefined
    makeAppCopy.mockImplementationOnce(() => new Promise<Blob>((_, reject) => (fail = reject)))
    await user.clear(nameBox())
    await user.type(nameBox(), 'a/b?.html')
    await user.click(saveBtn())
    // Being made: the field shows the name the file gets and cannot be edited.
    expect(nameBox().value).toBe('a_b_')
    expect(nameBox()).toBeDisabled()
    expect(screen.getByRole('button', { name: 'htmlExport:file_default_aria' })).toBeDisabled()
    fail(new Error('boom'))
    expect(await screen.findByRole('alert')).toHaveTextContent('htmlExport:sa_app_err')
    expect(nameBox()).toBeEnabled()
    expect(nameBox().value).toBe('a_b_')
    await user.click(saveBtn())
    await user.click(await screen.findByRole('button', { name: 'htmlExport:sa_save_default' }))
    await vi.waitFor(() => expect(saveBlobFile).toHaveBeenCalled())
    expect(saveBlobFile.mock.calls[0][1]).toBe('a_b_.html')
  })

  it('a name cleared to nothing saves under the default', async () => {
    const { user } = openWith(pdb)
    await user.clear(nameBox())
    await user.click(saveBtn())
    await user.click(await screen.findByRole('button', { name: 'htmlExport:sa_save_default' }))
    await vi.waitFor(() => expect(saveBlobFile).toHaveBeenCalled())
    expect(saveBlobFile.mock.calls[0][1]).toBe(`${viewerPackFileStem('1crn', 'light', day)}.html`)
  })
})

describe('「開いたときの表示」: the sessions the copy opens with (owner 2026-11-16)', () => {
  const FULL: PageConfig = { ...LIGHT, edition: 'full', runtime: { base: 'https://agdb-standalone.invalid/pymol/x/', handed: [] } }
  const LOOK = { v: 1 as const, view: [0, 0, 0, 0, 0, 0, 0, 1], bg: '#ffffff', atoms: 1, groups: [], surfaces: [] }
  const pdb: StructureDoc = { name: '1crn.pdb', stem: '1crn', ext: 'pdb', bytes: new ArrayBuffer(4), text: 'END\n', serial: 1 }

  /** A full page whose runtime is one worker block. */
  function fullPage() {
    const page = document.implementation.createHTMLDocument('t')
    page.body.innerHTML = `<div id="root"></div>${block('config', '{}')}${block('worker', 'w')}${block('licenses', '[]')}`
    captureTemplate(page)
    document.body.insertAdjacentHTML('beforeend', block('worker', 'w'))
    setRuntimeBlocksForTests(new Map([['worker', null]]))
  }

  it('both switches start on and the copy carries the 3Dmol.js view and PyMOL’s session', async () => {
    fullPage()
    const session = vi.fn(async () => new Uint8Array([7]).buffer as ArrayBuffer)
    render(<AppCopyDialog config={FULL} doc={pdb} lang="ja" engine="pymol" dmolLook={() => LOOK} pymolSession={session} onClose={() => undefined} onSaved={() => undefined} />)
    const dmol = screen.getByRole('switch', { name: 'htmlExport:sa_app_state_dmol' })
    const pse = screen.getByRole('switch', { name: 'htmlExport:sa_app_state_pse' })
    expect(dmol).toBeChecked()
    expect(pse).toBeChecked()
    expect(dmol).toHaveAccessibleDescription('htmlExport:sa_app_state_dmol_hint')
    expect(pse).toHaveAccessibleDescription('htmlExport:sa_app_state_pse_hint')
    await userEvent.click(screen.getByRole('button', { name: /sa_app_save/ }))
    expect(session).toHaveBeenCalledOnce()
    const req = makeAppCopy.mock.calls[0][0] as { mol3dLook: unknown; pymolSession: ArrayBuffer | null; keepMol3dSession: boolean; keepPymolSession: boolean }
    expect(req).toMatchObject({ keepMol3dSession: true, keepPymolSession: true, mol3dLook: LOOK })
    expect(new Uint8Array(req.pymolSession!)).toEqual(new Uint8Array([7]))
  })

  it('a switch turned off leaves that viewer as the structure first opened', async () => {
    fullPage()
    const session = vi.fn(async () => new ArrayBuffer(1))
    render(<AppCopyDialog config={FULL} doc={pdb} lang="ja" engine="3dmol" dmolLook={() => LOOK} pymolSession={session} onClose={() => undefined} onSaved={() => undefined} />)
    await userEvent.click(screen.getByRole('switch', { name: 'htmlExport:sa_app_state_dmol' }))
    await userEvent.click(screen.getByRole('switch', { name: 'htmlExport:sa_app_state_pse' }))
    expect(screen.getByRole('switch', { name: 'htmlExport:sa_app_state_dmol' })).not.toBeChecked()
    await userEvent.click(screen.getByRole('button', { name: /sa_app_save/ }))
    expect(session).not.toHaveBeenCalled()
    expect(makeAppCopy.mock.calls[0][0]).toMatchObject({ keepMol3dSession: false, keepPymolSession: false, mol3dLook: null, pymolSession: null })
  })

  it('says why a switch cannot be taken: PyMOL not started, the light edition, a blank app', async () => {
    fullPage()
    render(<AppCopyDialog config={FULL} doc={pdb} lang="ja" engine="3dmol" dmolLook={() => LOOK} pymolSession={null} onClose={() => undefined} onSaved={() => undefined} />)
    const pse = screen.getByRole('switch', { name: 'htmlExport:sa_app_state_pse' })
    expect(pse).toHaveAttribute('aria-disabled', 'true')
    expect(pse).not.toBeChecked()
    expect(pse).toHaveAccessibleDescription('htmlExport:sa_app_state_pse_off')
    await userEvent.click(pse)
    expect(pse).not.toBeChecked()
    // The light edition: no PyMOL switch at all.
    await userEvent.click(screen.getByRole('radio', { name: /sa_app_light/ }))
    expect(screen.queryByRole('switch', { name: 'htmlExport:sa_app_state_pse' })).toBeNull()
    // Blank: the 3Dmol.js switch says a blank app opens empty.
    await userEvent.click(screen.getByRole('radio', { name: 'htmlExport:sa_app_blank' }))
    const dmol = screen.getByRole('switch', { name: 'htmlExport:sa_app_state_dmol' })
    expect(dmol).toHaveAttribute('aria-disabled', 'true')
    expect(dmol).toHaveAccessibleDescription('htmlExport:sa_app_state_blank')
  })

  it('PyMOL not started on a file that carries a session: the switch keeps that session, and off leaves it out (PR #8717 review)', async () => {
    const page = document.implementation.createHTMLDocument('t')
    page.body.innerHTML = `<div id="root"></div>${block('config', '{}')}${block('pymol-session', 'pse')}${block('worker', 'w')}${block('licenses', '[]')}`
    captureTemplate(page)
    document.body.insertAdjacentHTML('beforeend', block('worker', 'w'))
    setRuntimeBlocksForTests(new Map([['worker', null]]))
    const own: StructureDoc = { ...pdb, serial: 0 }
    render(<AppCopyDialog config={FULL} doc={own} lang="ja" engine="3dmol" dmolLook={() => LOOK} pymolSession={null} onClose={() => undefined} onSaved={() => undefined} />)
    const pse = screen.getByRole('switch', { name: 'htmlExport:sa_app_state_pse' })
    expect(pse).not.toHaveAttribute('aria-disabled')
    expect(pse).toBeChecked()
    await userEvent.click(pse)
    await userEvent.click(screen.getByRole('button', { name: /sa_app_save/ }))
    expect(makeAppCopy.mock.calls[0][0]).toMatchObject({ keepPymolSession: false, pymolSession: null })
  })

  it('closed while PyMOL writes its session: nothing is saved', async () => {
    fullPage()
    let finish: (b: ArrayBuffer) => void = () => undefined
    const session = vi.fn(() => new Promise<ArrayBuffer>(resolve => (finish = resolve)))
    const onSaved = vi.fn()
    const { unmount } = render(<AppCopyDialog config={FULL} doc={pdb} lang="ja" engine="pymol" dmolLook={() => LOOK} pymolSession={session} onClose={() => undefined} onSaved={onSaved} />)
    await userEvent.click(screen.getByRole('button', { name: /sa_app_save/ }))
    expect(session).toHaveBeenCalledOnce()
    unmount()
    finish(new ArrayBuffer(4))
    await new Promise(r => setTimeout(r, 0))
    expect(makeAppCopy).not.toHaveBeenCalled()
    expect(saveBlobFile).not.toHaveBeenCalled()
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('a .pse open: 3Dmol.js has no view of it', () => {
    fullPage()
    render(<AppCopyDialog config={FULL} doc={pse} lang="ja" engine="pymol" dmolLook={() => LOOK} pymolSession={async () => new ArrayBuffer(1)} onClose={() => undefined} onSaved={() => undefined} />)
    expect(screen.getByRole('switch', { name: 'htmlExport:sa_app_state_dmol' })).toHaveAccessibleDescription('htmlExport:sa_app_state_dmol_none')
    expect(screen.getByRole('switch', { name: 'htmlExport:sa_app_state_pse' })).toBeChecked()
  })
})
