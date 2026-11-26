/**
 * The menu's status line with 「詳しく」 and × (owner 2026-11-19: a preset's
 * long note could not be put away).
 */
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

import { PymolMenuMessage } from './PymolMenuMessage'

/** jsdom lays nothing out: a folded line "cuts" its text when its scroll height says so. */
function textHeights(scroll: number, client: number) {
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(scroll)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(client)
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('PymolMenuMessage', () => {
  it('keeps its status line in the document while empty, with no buttons', () => {
    render(<PymolMenuMessage message="" onDismiss={() => undefined} />)
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('× empties it through the runner (onDismiss)', async () => {
    const user = userEvent.setup()
    const onDismiss = vi.fn()
    render(<PymolMenuMessage message="A short note." onDismiss={onDismiss} />)
    expect(screen.getByRole('status')).toHaveTextContent('A short note.')
    // Nothing cut: no 「詳しく」.
    expect(screen.queryByRole('button', { name: 'pymol:menu_message_more' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'pymol:menu_message_close' }))
    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('a cut note offers 「詳しく」, which shows it whole in place and folds again; a new note starts folded', async () => {
    textHeights(90, 36)
    const user = userEvent.setup()
    const { rerender } = render(<PymolMenuMessage message={'A long note. '.repeat(30)} onDismiss={() => undefined} />)
    const status = screen.getByRole('status')
    const more = screen.getByRole('button', { name: 'pymol:menu_message_more' })
    expect(more).toHaveAttribute('aria-expanded', 'false')
    expect(more).toHaveAttribute('aria-controls', status.id)
    await user.click(more)
    const less = screen.getByRole('button', { name: 'pymol:menu_message_less' })
    expect(less).toHaveAttribute('aria-expanded', 'true')
    expect(status.parentElement).toHaveClass('is-expanded')
    // The whole text stays in the live line, folded or not.
    expect(status).toHaveTextContent('A long note.')
    rerender(<PymolMenuMessage message={'Another long note. '.repeat(30)} onDismiss={() => undefined} />)
    expect(status.parentElement).not.toHaveClass('is-expanded')
    expect(screen.getByRole('button', { name: 'pymol:menu_message_more' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('folds to two lines, scrolls when unfolded, and an empty line takes no room (CSS)', () => {
    const css = readFileSync(join(__dirname, 'pymolViewer.css'), 'utf8')
    expect(css).toMatch(/\.pymolv-note:not\(\.is-expanded\) > \.pymolv-menu-message:not\(:empty\) \{[^}]*-webkit-line-clamp: 2;/)
    expect(css).toMatch(/\.pymolv-note\.is-expanded > \.pymolv-menu-message \{[^}]*overflow-y: auto;/)
    expect(css).toMatch(/\.pymolv-note--empty \{\s*display: contents;/)
  })
})
