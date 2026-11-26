/**
 * The computer's 「🖱 マウス操作」 card (owner 2026-11-19): plain words for
 * 3-Button Viewing with PyMOL's own codes, a Mac's ⌘, another mode said with
 * the way back, and Escape or × to close.
 */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key} ${JSON.stringify(vars)}` : key),
    i18n: { language: 'en' },
  }),
}))

import { isMacLike, MOUSE_MODE_RESET, PymolMouseGuide } from './PymolMouseGuide'

afterEach(cleanup)

const guide = (over: Partial<Parameters<typeof PymolMouseGuide>[0]> = {}) => {
  const props = { id: 'g', mode: '3-Button Viewing', mac: false, run: vi.fn(), onClose: vi.fn(), ...over }
  render(<PymolMouseGuide {...props} />)
  return props
}

describe('PymolMouseGuide', () => {
  it('is a non-modal dialog that takes the focus and says what to do, then how, with PyMOL’s code', () => {
    guide()
    const dialog = screen.getByRole('dialog', { name: /sa_mouse_title/ })
    expect(dialog).toHaveAttribute('aria-modal', 'false')
    expect(screen.getByRole('heading', { name: /sa_mouse_title/ })).toHaveFocus()
    const view = screen.getByRole('table', { name: 'htmlExport:sa_mouse_g_view' })
    const rotate = within(view).getByRole('row', { name: /sa_mouse_rotate/ })
    expect(rotate).toHaveTextContent('htmlExport:sa_mouse_left_drag')
    expect(rotate).toHaveTextContent('Rota')
    expect(within(view).getByRole('row', { name: /sa_mouse_move/ })).toHaveTextContent('htmlExport:sa_mouse_middle_drag {"ctrl":"Ctrl"}')
    // Selecting in sight; depth folded.
    expect(screen.getByRole('table', { name: 'htmlExport:sa_mouse_g_select' })).toHaveTextContent('+/-')
    expect(screen.getByText('htmlExport:sa_mouse_g_depth', { selector: 'summary' })).toBeInTheDocument()
    // The mode is the one described: no note.
    expect(screen.queryByText(/sa_mouse_other/)).toBeNull()
  })

  it('a Mac names the key ⌘', () => {
    guide({ mac: true })
    expect(screen.getByRole('row', { name: /sa_mouse_move/ })).toHaveTextContent('{"ctrl":"⌘"}')
    expect(isMacLike('MacIntel', '')).toBe(true)
    expect(isMacLike('', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)')).toBe(true)
    expect(isMacLike('Win32', 'Mozilla/5.0 (Windows NT 10.0)')).toBe(false)
  })

  it('another mouse mode is said, with the way back to 3-Button Viewing', async () => {
    const user = userEvent.setup()
    const p = guide({ mode: '3-Button Editing' })
    expect(screen.getByText(/sa_mouse_other/)).toHaveTextContent('{"mode":"3-Button Editing"}')
    await user.click(screen.getByRole('button', { name: 'htmlExport:sa_mouse_reset' }))
    expect(p.run).toHaveBeenCalledWith(MOUSE_MODE_RESET)
    // The button goes with the note: the focus stays in the card, where Escape still closes it.
    expect(screen.getByRole('heading', { name: /sa_mouse_title/ })).toHaveFocus()
  })

  it('closes on Escape and on ×', async () => {
    const user = userEvent.setup()
    const p = guide()
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'htmlExport:sa_mouse_close' }))
    expect(p.onClose).toHaveBeenCalledTimes(2)
  })
})
