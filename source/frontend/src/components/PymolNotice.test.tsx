import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import enNotice from '../i18n/locales/en/pymolNotice.json'
import jaNotice from '../i18n/locales/ja/pymolNotice.json'
import { PymolNotice } from './PymolNotice'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

describe('PymolNotice', () => {
  it('is one paragraph holding the notice key', () => {
    render(<PymolNotice />)
    const p = screen.getByTestId('pymol-notice')
    expect(p.tagName).toBe('P')
    expect(p).toHaveClass('lib-notice--block', 'pymol-notice')
    expect(p).toHaveTextContent('pymolNotice:notice')
  })

  it('has a compact variant', () => {
    render(<PymolNotice variant="compact" />)
    expect(screen.getByTestId('pymol-notice')).toHaveClass('lib-notice--compact', 'pymol-notice')
  })

  it('carries the owner-approved wording in both languages (owner 2026-11-15: who built it first, the trademark last)', () => {
    // Japanese verbatim as the owner wrote it; the English in the same order and sense.
    expect(jaNotice.notice).toBe(
      '本アプリは、Open-Source PyMOL のソースコードをオープンソースライセンスのもとで利用し、AgroDesign Studios が開発（変更・機能追加）したアプリです。PyMOL™ は Schrödinger, LLC の商標です。',
    )
    expect(enNotice.notice).toBe(
      'This application was developed (modified and extended) by AgroDesign Studios using the Open-Source PyMOL source code under its open-source license. PyMOL™ is a trademark of Schrödinger, LLC.',
    )
  })
})
