import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import enDb from '../i18n/locales/en/proteindb.json'
import jaDb from '../i18n/locales/ja/proteindb.json'
import { MOL3D_LICENSE_HREF, Mol3dNotice } from './Mol3dNotice'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

describe('Mol3dNotice', () => {
  it('links to the full license text in a new tab (AgDB)', () => {
    render(<Mol3dNotice license={{ href: MOL3D_LICENSE_HREF }} />)
    const p = screen.getByTestId('mol3d-notice')
    expect(p).toHaveClass('lib-notice--block', 'mol3d-notice')
    expect(p).toHaveTextContent('proteindb:viewer_3dmol_notice')
    const a = screen.getByRole('link', { name: /proteindb:viewer_3dmol_license_link/ })
    expect(a).toHaveAttribute('href', '/help/third-party#lic-3dmol')
    expect(a).toHaveAttribute('target', '_blank')
    expect(a).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('opens the license dialog instead where there is no page to link (the offline file)', () => {
    const onOpen = vi.fn()
    render(<Mol3dNotice variant="compact" license={{ onOpen }} />)
    expect(screen.queryByRole('link')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'proteindb:viewer_3dmol_license_link' }))
    expect(onOpen).toHaveBeenCalledOnce()
    expect(screen.getByTestId('mol3d-notice')).toHaveClass('lib-notice--compact')
  })

  it('sits under a PymolNotice strip without a second rule', () => {
    render(<Mol3dNotice variant="follow" license={{ href: MOL3D_LICENSE_HREF }} />)
    expect(screen.getByTestId('mol3d-notice')).toHaveClass('lib-notice--block', 'lib-notice--follow')
  })

  it('brief: the full line, and a short one a phone shows instead (PT-9114 item 3)', () => {
    render(<Mol3dNotice variant="compact" brief license={{ href: MOL3D_LICENSE_HREF }} />)
    const p = screen.getByTestId('mol3d-notice')
    expect(p.querySelector('.lib-notice-full')).toHaveTextContent('proteindb:viewer_3dmol_notice')
    expect(p.querySelector('.lib-notice-brief')).toHaveTextContent('proteindb:viewer_3dmol_notice_brief')
    expect(screen.getByRole('link', { name: /proteindb:viewer_3dmol_license_link/ })).toBeInTheDocument()
  })

  it('spells license as the help page it links to does (PT-9114 item 2)', () => {
    expect(enDb.viewer_3dmol_notice).not.toMatch(/licence/i)
    expect(enDb.viewer_3dmol_license_link).toBe('Full license text')
    expect(enDb.viewer_3dmol_notice_brief).toContain('BSD-3-Clause')
  })

  it('names the copyright holder and the license in both languages, and only says the library is used', () => {
    for (const notice of [enDb.viewer_3dmol_notice, jaDb.viewer_3dmol_notice]) {
      expect(notice).toContain('3Dmol.js')
      expect(notice).toContain('Copyright (c) 2014, University of Pittsburgh and contributors')
      expect(notice).toContain('BSD-3-Clause')
    }
    // BSD-3-Clause clause 3: the authors' names never endorse AgDB.
    expect(enDb.viewer_3dmol_notice).not.toMatch(/endorse|recommend|approved|official/i)
    expect(jaDb.viewer_3dmol_notice).not.toMatch(/推奨|公認|保証/)
  })
})
