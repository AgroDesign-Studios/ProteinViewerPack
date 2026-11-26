import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

import { PymolAboutDialog } from './PymolAboutDialog'

describe('PymolAboutDialog', () => {
  it('is a named dialog with the notice and a new-tab link to the licence page', async () => {
    const onClose = vi.fn()
    render(<PymolAboutDialog onClose={onClose} />)
    expect(screen.getByRole('dialog', { name: 'pymolNotice:about_title' })).toBeVisible()
    expect(screen.getByTestId('pymol-notice')).toHaveTextContent('pymolNotice:notice')
    const link = screen.getByRole('link', { name: /pymolNotice:about_licenses_link/ })
    expect(link).toHaveAttribute('href', '/help/third-party')
    expect(link).toHaveAttribute('target', '_blank')
    // The link says it opens a new tab (PT-9103 item 8).
    expect(link).toHaveTextContent('common:opens_in_new_tab')
    await userEvent.click(screen.getByRole('button', { name: 'pymol:dialog_close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('lists, under its own heading, the five kinds of PyMOL entry this browser build leaves out of the menus', () => {
    render(<PymolAboutDialog onClose={vi.fn()} />)
    const heading = screen.getByRole('heading', { level: 3, name: 'pymolNotice:about_absent_title' })
    const list = heading.parentElement?.querySelector('ul')
    expect(list).not.toBeNull()
    expect([...(list?.querySelectorAll('li') ?? [])].map(li => li.textContent)).toEqual([
      'pymolNotice:about_absent_demo',
      'pymolNotice:about_absent_stereo',
      'pymolNotice:about_absent_antialias',
      'pymolNotice:about_absent_volume',
      'pymolNotice:about_absent_fonts',
    ])
  })

  it('shows the same list in the offline file (onLicences given)', () => {
    render(<PymolAboutDialog onClose={vi.fn()} onLicences={vi.fn()} />)
    expect(screen.getByRole('heading', { level: 3, name: 'pymolNotice:about_absent_title' })).toBeVisible()
    expect(screen.getAllByRole('listitem')).toHaveLength(5)
  })

  it('opens the offline file\'s own licences instead of AgDB\'s page when the host has them', async () => {
    const onLicences = vi.fn()
    render(<PymolAboutDialog onClose={vi.fn()} onLicences={onLicences} />)
    expect(screen.queryByRole('link')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'pymolNotice:about_licenses_link' }))
    expect(onLicences).toHaveBeenCalledTimes(1)
  })
})
