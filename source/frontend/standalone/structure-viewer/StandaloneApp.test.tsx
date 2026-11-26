/**
 * The page itself (light edition, no WebGL, as jsdom is): what it says and
 * shows around its dialogs — a drop while another dialog is open, the drop
 * overlay after a drop on 「開く」's own drop area, and a refusal said again
 * at a second press. PyMOL and 3Dmol.js run in an automated browser test.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key} ${JSON.stringify(vars)}` : key),
    i18n: { language: 'en', t: (key: string) => key, changeLanguage: async () => undefined },
  }),
}))

import Modal from '../../src/components/Modal'
import { resetModalStackForTests } from '../../src/components/modalStack'
import type { PageConfig } from './blocks'
import { StandaloneApp } from './StandaloneApp'
import { setMobileOverride } from './useMobile'
import { APP_VERSION } from './appLicence'
import { GUIDE_SEEN_KEY } from './FirstRunGuide'
import { NOTICE_HIDDEN_KEY } from './NoticeBanner'

const CONFIG: PageConfig = {
  edition: 'light',
  structureId: 0,
  title: '',
  code: null,
  exporterName: null,
  lang: 'en',
  initialEngine: '3dmol',
  bColumn: 'bfactor',
  exportedAt: '2026-11-15T00:00:00Z',
  timeZone: null,
  pymolView: null,
  skipped: [],
  runtime: null,
}

const PDB = 'ATOM      1  N   THR A   1      17.047  14.099   3.625  1.00 13.79           N\nEND\n'

const fileOf = (name: string, text: string) => {
  const f = new File([text], name)
  const bytes = new TextEncoder().encode(text)
  Object.defineProperty(f, 'arrayBuffer', { value: async () => bytes.buffer.slice(0) })
  return f
}

const files = (...list: File[]) => ({ dataTransfer: { files: list, types: ['Files'] } })

function app(extra: React.ReactNode = null) {
  return render(
    <>
      <StandaloneApp config={CONFIG} cif={null} mol3d={null} pymolLook={null} pymolLookBytes={null} lookRefused={false} logo={null} bundledLicences={[]} />
      {extra}
    </>,
  )
}

const page = () => document.querySelector('.sav')!
const pageAlert = () => document.querySelector('.sav-open-message.is-error')!

beforeEach(() => {
  // No WebGL (jsdom has no canvas): the page shows its no-3D panel.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})
afterEach(() => {
  cleanup()
  resetModalStackForTests()
  vi.restoreAllMocks()
  act(() => setMobileOverride(null))
})

describe('StandaloneApp', () => {
  it('says the Export refusal again at a second press: the alert is emptied, then filled (PT-9230 item 4)', async () => {
    const user = userEvent.setup()
    app()
    const exp = screen.getByRole('button', { name: 'htmlExport:sa_export_button' })
    await user.click(exp)
    await waitFor(() => expect(pageAlert()).toHaveTextContent('htmlExport:sa_export_none'))
    const seen: string[] = []
    const observer = new MutationObserver(() => seen.push(pageAlert().textContent ?? ''))
    observer.observe(pageAlert(), { childList: true, characterData: true, subtree: true })
    await user.click(exp)
    await waitFor(() => expect(seen[seen.length - 1]).toBe('htmlExport:sa_export_none'))
    observer.disconnect()
    // Emptied in between: a screen reader hears the second one too.
    expect(seen).toContain('')
  })

  it('a refusal said again never overwrites a newer message set before its frame (PT-9236 item 2)', async () => {
    // Frames run only when the test says so: the open lands in the same frame as the refusal.
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => frames.push(cb))
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => {
      frames[id - 1] = () => undefined
    })
    app()
    fireEvent.click(screen.getByRole('button', { name: 'htmlExport:sa_export_button' }))
    await act(async () => {
      fireEvent.drop(page(), files(fileOf('a.pdb', PDB)))
    })
    const dialog = screen.getByRole('dialog', { name: 'htmlExport:sa_open_title' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'htmlExport:sa_open_staged_submit' }))
    await waitFor(() => expect(document.querySelector('.sav-open-message:not(.is-error)')).toHaveTextContent('htmlExport:sa_open_opened'))
    act(() => {
      for (const cb of frames.splice(0)) cb(0)
    })
    expect(document.querySelector('.sav-open-message:not(.is-error)')).toHaveTextContent('htmlExport:sa_open_opened')
    expect(pageAlert().textContent).toBe('')
  })

  it('a drop taken by 「開く」’s own drop area leaves no drop overlay once the dialog is gone (PT-9228 item 1)', async () => {
    const user = userEvent.setup()
    app()
    await user.click(screen.getAllByRole('button', { name: 'htmlExport:sa_open_button' })[0])
    const dialog = screen.getByRole('dialog', { name: 'htmlExport:sa_open_title' })
    // A file dragged over the page, then onto the drop area inside the dialog:
    // a move inside the page, whose dragleave the page ignores (PT-9133 item 5).
    fireEvent.dragOver(page(), files(fileOf('a.pdb', PDB)))
    const zone = within(dialog).getByRole('button', { name: /sa_open_drop_title/ })
    fireEvent.drop(zone, files(fileOf('a.pdb', PDB)))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(page()).not.toHaveClass('is-dropping')
    expect(document.querySelector('.sav-drop')).toBeNull()
  })

  it('a page drop while another dialog is open is refused inside that dialog, which hides the page from a screen reader (PT-9228 item 2, PT-9229 item 3)', async () => {
    // A dialog the page does not track (PyMOL's own Settings, Keys and About are the pane's).
    app(
      <Modal labelledBy="other-title" onClose={() => undefined}>
        <h2 id="other-title">Other</h2>
      </Modal>,
    )
    const other = screen.getByRole('dialog', { name: 'Other' })
    fireEvent.drop(page(), files(fileOf('a.pdb', PDB)))
    // No 「開く」 stacked over it.
    expect(screen.queryByRole('dialog', { name: 'htmlExport:sa_open_title' })).toBeNull()
    // Said in the dialog's own announcer, and in the page's alert for when it closes.
    await waitFor(() => expect(other).toHaveTextContent('htmlExport:sa_drop_blocked'))
    await waitFor(() => expect(pageAlert()).toHaveTextContent('htmlExport:sa_drop_blocked'))
  })

  it('has no footer: HELP holds what it said (owner 2026-11-16); the note stays under the header', () => {
    app()
    expect(document.querySelector('footer, .sav-foot')).toBeNull()
    expect(page()).not.toHaveTextContent('© 2026 AgroDesign Studios')
    expect(screen.getByRole('complementary', { name: 'htmlExport:sa_notice_label' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'htmlExport:sa_open_button' }).length).toBeGreaterThan(0)
  })

  it.each([false, true])('HELP opens on 「使い方」 with nothing open, and gives the focus back when closed (phone layout: %s)', async phone => {
    const user = userEvent.setup()
    if (phone) act(() => setMobileOverride(true))
    app()
    // A phone's HELP is in the 表示ツール sheet, beside 全画面 (owner 2026-11-16); the focus goes back to the bar's button that opened the sheet.
    const opener = phone
      ? screen.getByRole('button', { name: 'htmlExport:sa_m_view_aria' })
      : within(document.querySelector('header.sav-head') as HTMLElement).getByRole('button', { name: 'htmlExport:sa_help_button' })
    if (phone) await user.click(opener)
    const button = phone ? screen.getByRole('button', { name: 'htmlExport:sa_help_button' }) : opener
    expect(button).toHaveAttribute('aria-haspopup', 'dialog')
    await user.click(button)
    if (phone) expect(screen.queryByRole('dialog', { name: /sa_m_view_title/ })).toBeNull()
    const dialog = screen.getByRole('dialog', { name: 'htmlExport:sa_help_title' })
    expect(within(dialog).getByRole('tab', { name: 'htmlExport:sa_help_tab_usage' })).toHaveAttribute('aria-selected', 'true')
    // 「ライセンス表記」 is reached from there, 「このアプリ」 first, the runtimes' texts being read meanwhile (PT-9446 item 1).
    await user.click(within(dialog).getByRole('tab', { name: 'htmlExport:sa_help_tab_licences' }))
    const panel = within(dialog).getByRole('tabpanel')
    expect(within(panel).getAllByRole('heading', { level: 3 })[0]).toHaveTextContent('htmlExport:sa_lic_app')
    expect(panel).toHaveTextContent(`ver ${APP_VERSION}`)
    await user.click(within(dialog).getByRole('button', { name: 'pymol:dialog_close' }))
    expect(screen.queryByRole('dialog', { name: 'htmlExport:sa_help_title' })).toBeNull()
    await waitFor(() => expect(opener).toHaveFocus())
  })

  it('「スマホ表示」 on a computer shows the phone layout as a phone-wide column; 「PC」 at the header’s right end goes back (owner 2026-11-16)', async () => {
    const user = userEvent.setup()
    app()
    await user.click(screen.getByRole('button', { name: /sa_phone_view/ }))
    expect(page()).toHaveClass('sav--mobile', 'sav--phone-col')
    // The pressed button is gone with the desktop header: the focus goes to the structure's name (PT-9260 item 6).
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveFocus())
    await user.click(within(document.querySelector('header.sav-head') as HTMLElement).getByRole('button', { name: 'htmlExport:sa_pc_back_aria' }))
    expect(page()).not.toHaveClass('sav--mobile')
    expect(page()).not.toHaveClass('sav--phone-col')
  })

  it('the header: two names beside the logo, the small buttons in two rows, no engine switch in the light edition (owner 2026-11-16)', () => {
    app()
    const head = document.querySelector('header.sav-head')!
    // The app's name over the structure's, each with its whole text as its title.
    const names = head.querySelector(':scope > .sav-ident > .sav-names')!
    expect(Array.from(names.children).map(c => c.tagName)).toEqual(['P', 'DIV'])
    // The structure's name in its row (where a PDB ID goes before it, owner 2026-11-19).
    expect(names.children[1]).toHaveClass('sav-title-row')
    expect(Array.from(names.children[1].children).map(c => c.tagName)).toEqual(['H1'])
    expect(names.children[0]).toHaveTextContent('AgroDesign - Protein Viewer Pack (HTMLapp)')
    expect(names.children[0]).toHaveAttribute('title', 'AgroDesign - Protein Viewer Pack (HTMLapp)')
    const h1 = screen.getByRole('heading', { level: 1 })
    expect(h1).toHaveAttribute('title', h1.textContent ?? '')
    // Above, what to do; below, how it is shown.
    const rows = Array.from(head.querySelectorAll(':scope > .sav-head-actions > .sav-head-row'))
    expect(rows).toHaveLength(2)
    const named = (row: Element) =>
      Array.from(row.querySelectorAll(':scope > button, :scope > details > summary')).map(b => b.getAttribute('aria-label') ?? b.textContent)
    // 「画像出力」 between 全画面 and the language, its camera beside its name (owner 2026-11-16).
    expect(named(rows[0])).toEqual(['htmlExport:sa_open_button', 'htmlExport:sa_export_button', 'htmlExport:sa_m_details', 'htmlExport:sa_help_button'])
    const image = rows[1].querySelector('details.sav-image > summary')!
    expect(image.querySelector('svg[aria-hidden="true"]')).not.toBeNull()
    expect(image).toHaveTextContent('htmlExport:sa_image_button')
    expect(named(rows[1])).toEqual(['htmlExport:sa_phone_view', 'htmlExport:sa_fullscreen', 'htmlExport:sa_image_button', 'htmlExport:sa_lang_aria {"lang":"日本語"}'])
    // The light edition has no PyMOL: no switch at the right end.
    expect(head.querySelector('.sav-head-engine, .v3dh-engine')).toBeNull()
  })

  it('a phone’s header: the logo’s two names, then 「詳細」, the camera, the language and 「PC」 (HELP moved to the 表示 sheet); 詳細 says where it came from', () => {
    act(() => setMobileOverride(true))
    app()
    const head = document.querySelector('header.sav-head')!
    expect(head.querySelector(':scope > .sav-ident .sav-brand-name')).toHaveTextContent('AgroDesign - Protein Viewer Pack (HTMLapp)')
    expect(head.querySelector('.sav-head-row')).toBeNull()
    const right = head.querySelector(':scope > .sav-head-phone')!
    // 「画像出力」 as its camera alone, named by its label (UI consult, Claude Opus); its reason, unseen, beside it.
    expect(Array.from(right.children).map(c => c.tagName)).toEqual(['DETAILS', 'DETAILS', 'SPAN', 'BUTTON', 'BUTTON'])
    const camera = right.querySelector('details.sav-image > summary')!
    expect(camera).toHaveAttribute('aria-label', 'htmlExport:sa_image_button')
    expect(camera.textContent).toBe('')
    expect(right.querySelector('details')).toHaveTextContent('htmlExport:sa_meta_exported')
    // No line on what the file connects to (owner 2026-11-16).
    expect(right.querySelector('details')).not.toHaveTextContent('sa_footer_network')
    expect(within(right as HTMLElement).getByRole('button', { name: /sa_lang_aria/ })).toBeInTheDocument()
    // 「PC」 last, at the right end: the screen icon (decoration) and the word its name starts with.
    const pc = right.lastElementChild as HTMLElement
    expect(pc).toHaveAccessibleName('htmlExport:sa_pc_back_aria')
    expect(pc).toHaveTextContent(/^\s*htmlExport:sa_pc_button$/)
    expect(pc.querySelector('svg[aria-hidden="true"]')).not.toBeNull()
    expect(within(head as HTMLElement).queryByRole('button', { name: 'htmlExport:sa_help_button' })).toBeNull()
  })

  it('the language switch: the other language’s flag before its name (owner 2026-11-17) — decoration, the name the button’s text', () => {
    app()
    const lang = screen.getByRole('button', { name: 'htmlExport:sa_lang_aria {"lang":"日本語"}' })
    // The name is read in the screen's language: the other language's `lang` is on the word only (owner 2026-11-19; UI consult, Opus).
    expect(lang).not.toHaveAttribute('lang')
    expect(lang.querySelector('.sav-lang-word')).toHaveAttribute('lang', 'ja')
    expect(lang).toHaveTextContent(/^日本語$/)
    const flag = lang.querySelector('svg.sav-flag')!
    // Drawn by the page, not an emoji (Windows shows a flag emoji as the letters GB); hidden from assistive tech.
    expect(flag).toHaveClass('sav-flag--jp')
    expect(flag).toHaveAttribute('aria-hidden', 'true')
    expect(flag).toHaveAttribute('focusable', 'false')
    // It slices to its box: the phone's round flag is the flag's middle (owner 2026-11-21).
    expect(flag).toHaveAttribute('preserveAspectRatio', 'xMidYMid slice')
    expect(lang.querySelector('.sav-lang-word')).toHaveTextContent('日本語')
    // The flag comes first, the word after.
    expect(lang.firstElementChild).toBe(flag)
    expect(lang.textContent).not.toMatch(/\p{Regional_Indicator}/u)
  })

  it('「詳細」 closes on Escape, giving the focus back, and on a press outside it', async () => {
    const user = userEvent.setup()
    app()
    const details = document.querySelector('details.sav-details:not(.sav-image)') as HTMLDetailsElement
    const summary = details.querySelector('summary')!
    await user.click(summary)
    await waitFor(() => expect(details.open).toBe(true))
    await user.keyboard('{Escape}')
    expect(details.open).toBe(false)
    expect(summary).toHaveFocus()
    await user.click(summary)
    await waitFor(() => expect(details.open).toBe(true))
    fireEvent.pointerDown(document.querySelector('main.sav-stage')!)
    expect(details.open).toBe(false)
  })

  it.each([false, true])('「画像出力」 with nothing open stays reachable, opens nothing and says why, again at a second press (phone layout: %s)', async phone => {
    const user = userEvent.setup()
    if (phone) act(() => setMobileOverride(true))
    app()
    const image = document.querySelector('details.sav-image') as HTMLDetailsElement
    const summary = image.querySelector('summary')!
    expect(summary).toHaveAttribute('aria-disabled', 'true')
    expect(summary).toHaveAccessibleDescription('htmlExport:sa_export_none')
    await user.click(summary)
    expect(image.open).toBe(false)
    await waitFor(() => expect(pageAlert()).toHaveTextContent('htmlExport:sa_export_none'))
    summary.focus()
    await user.keyboard('{Enter}')
    expect(image.open).toBe(false)
  })

  it('the licence tab says the runtimes’ texts could not be read, and Retry reads them, one read at a time (PT-9446 item 1)', async () => {
    const user = userEvent.setup()
    app()
    await user.click(within(document.querySelector('header.sav-head') as HTMLElement).getByRole('button', { name: 'htmlExport:sa_help_button' }))
    const dialog = screen.getByRole('dialog', { name: 'htmlExport:sa_help_title' })
    await user.click(within(dialog).getByRole('tab', { name: 'htmlExport:sa_help_tab_licences' }))
    // No `licenses` block on this page: the read fails, and the tab says so.
    await waitFor(() => expect(within(dialog).getByRole('status')).toHaveTextContent('htmlExport:sa_lic_failed'))
    // The block arrives (as it would have in a page that read it): Retry reads it.
    const json = JSON.stringify([{ title: '3Dmol.js', text: '3Dmol BSD', group: '3dmol' }])
    const bytes = new TextEncoder().encode(json)
    const block = document.createElement('script')
    block.type = 'application/octet-stream'
    block.id = 'agdb-licenses'
    block.dataset.len = String(bytes.byteLength)
    block.textContent = btoa(String.fromCharCode(...bytes))
    document.body.appendChild(block)
    try {
      const retry = within(dialog).getByRole('button', { name: 'htmlExport:sa_retry' })
      await user.click(retry)
      await waitFor(() => expect(within(dialog).getByText('3Dmol.js', { selector: 'summary' })).toBeInTheDocument())
      expect(within(dialog).queryByRole('button', { name: 'htmlExport:sa_retry' })).toBeNull()
      expect(within(dialog).getByRole('status')).toHaveTextContent('')
    } finally {
      block.remove()
    }
  })

  it('a page drop with no dialog open opens 「開く」 with the file chosen', async () => {
    app()
    await act(async () => {
      fireEvent.drop(page(), files(fileOf('a.pdb', PDB)))
    })
    const dialog = screen.getByRole('dialog', { name: 'htmlExport:sa_open_title' })
    expect(within(dialog).getByRole('button', { name: /sa_open_drop_title/ })).toHaveTextContent('a.pdb')
  })
})

describe('StandaloneApp, owner 2026-11-19', () => {
  const CIF = 'data_1CRN\n#\n'
  const withStructure = (over: Partial<PageConfig>) =>
    render(<StandaloneApp config={{ ...CONFIG, ...over }} cif={CIF} mol3d={null} pymolLook={null} pymolLookBytes={null} lookRefused={false} logo={null} bundledLicences={[]} />)

  beforeEach(() => {
    window.localStorage.removeItem(GUIDE_SEEN_KEY)
    window.localStorage.removeItem(NOTICE_HIDDEN_KEY)
  })

  it('the phone layout’s language switch is the flag alone, the button still named (CSS)', () => {
    const css = readFileSync(join(__dirname, 'standalone.css'), 'utf8')
    expect(css).toMatch(/\.sav--mobile \.sav-lang-word \{\s*display: none;/)
    // The narrow-window rule that drops the flag (keeping the word) is the desktop layout's only.
    expect(css).toContain('.sav:not(.sav--mobile) .sav-lang > .sav-flag {')
    // Round, in a button 32 px wide and still 44 px high (owner 2026-11-21: 丸型、横スペースを節約).
    expect(css).toMatch(/\.sav--mobile \.sav-lang \{\s*min-width: 32px;\s*width: 32px;\s*padding: 0;/)
    expect(css).toMatch(/\.sav--mobile \.sav-lang > \.sav-flag \{\s*width: 24px;\s*height: 24px;\s*border-radius: 50%;/)
    // The phone's floating note: its × and 「詳しく」 are 44 px targets (PT-9918 item 3).
    expect(css).toMatch(/\.sav--mobile \.sav-note-float \.pymolv-note-actions \.btn \{\s*min-width: 44px;\s*min-height: 44px;/)
  })

  it('a structure from the PDB: its short ID before the name, a link to its RCSB PDB page in a new tab, outside the heading', () => {
    withStructure({ structureId: 0, code: 'pdb_00001crn', title: 'Crambin' })
    const link = screen.getByRole('link', { name: /^1CRN/ })
    expect(link).toHaveAttribute('href', 'https://www.rcsb.org/structure/1CRN')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    // The arrow is decoration; the name says where the link goes.
    expect(link).toHaveAccessibleName(/^1CRN ?htmlExport:sa_pdb_link_sr$/)
    const h1 = screen.getByRole('heading', { level: 1 })
    expect(h1).toHaveTextContent(/^Crambin$/)
    expect(h1.contains(link)).toBe(false)
    expect(link.nextElementSibling).toBe(h1)
  })

  it('no ID link when structureId is not 0 (the code may not be a PDB ID), nor with nothing open', () => {
    withStructure({ structureId: 7, code: '1CRN', title: 'Crambin' })
    expect(screen.queryByRole('link', { name: /1CRN/ })).toBeNull()
    cleanup()
    app()
    expect(document.querySelector('.sav-pdb-link')).toBeNull()
  })

  it('the first-run guide: shown with a structure on screen, the notice waiting; a press anywhere closes it for good and the notice comes once the press ends', async () => {
    withStructure({ structureId: 0, code: '1CRN' })
    const guide = screen.getByRole('note', { name: 'htmlExport:sa_guide_label' })
    // The light edition: Export alone.
    expect(guide.querySelectorAll('.sav-guide-bubble')).toHaveLength(1)
    expect(guide).toHaveTextContent('htmlExport:sa_guide_export')
    expect(document.querySelectorAll('[data-guide="export"]')).toHaveLength(1)
    expect(screen.queryByRole('complementary', { name: 'htmlExport:sa_notice_label' })).toBeNull()
    fireEvent.pointerDown(screen.getByRole('heading', { level: 1 }))
    expect(screen.queryByRole('note', { name: 'htmlExport:sa_guide_label' })).toBeNull()
    // The notice waits for the press to end: in the page's flow, it would move what is under the press (PT-9918 item 1).
    expect(screen.queryByRole('complementary', { name: 'htmlExport:sa_notice_label' })).toBeNull()
    fireEvent.pointerUp(screen.getByRole('heading', { level: 1 }))
    await waitFor(() => expect(screen.getByRole('complementary', { name: 'htmlExport:sa_notice_label' })).toBeInTheDocument())
    expect(window.localStorage.getItem(GUIDE_SEEN_KEY)).toBe('1')
    cleanup()
    withStructure({ structureId: 0, code: '1CRN' })
    expect(screen.queryByRole('note', { name: 'htmlExport:sa_guide_label' })).toBeNull()
  })

  it('no guide while nothing is open: the notice shows', () => {
    app()
    expect(screen.queryByRole('note', { name: 'htmlExport:sa_guide_label' })).toBeNull()
    expect(screen.getByRole('complementary', { name: 'htmlExport:sa_notice_label' })).toBeInTheDocument()
  })
})
