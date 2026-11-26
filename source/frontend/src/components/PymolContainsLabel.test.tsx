import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import enNotice from '../i18n/locales/en/pymolNotice.json'
import jaNotice from '../i18n/locales/ja/pymolNotice.json'

let phrase = enNotice.contains_label
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: () => phrase }),
}))

import { PymolContainsLabel, pymolContainsLang, pymolContainsText } from './PymolContainsLabel'

const tags = (s: string) => s.match(/<\/?[a-z]+>/g) ?? []

describe('PymolContainsLabel (PT-9102 item 4, PT-9103 items 1, 7)', () => {
  it('draws the one phrase in its two tiers, PyMOL™ the large part', () => {
    const { container } = render(<PymolContainsLabel size="lg" />)
    const label = container.firstElementChild as HTMLElement
    expect(label).toHaveClass('pymol-contains', 'pymol-contains--lg')
    expect(label).toHaveAttribute('aria-hidden', 'true')
    expect(label.querySelector('.pymol-contains-small')).toHaveTextContent('Includes')
    expect(label.querySelector('.pymol-contains-line .pymol-contains-big')).toHaveTextContent('PyMOL™')
    expect(label.querySelector('.pymol-contains-line')).toHaveTextContent(/^PyMOL™$/)
    expect(label.textContent).not.toContain('<')
    expect(label).not.toHaveClass('pymol-contains--stacked')
  })

  it('stacked (owner 2026-11-16): the same phrase and tiers, marked for a line each; the ja phrase is the same', () => {
    const { container } = render(<PymolContainsLabel size="md" stacked />)
    const label = container.firstElementChild as HTMLElement
    expect(label).toHaveClass('pymol-contains', 'pymol-contains--md', 'pymol-contains--stacked')
    // Includes / PyMOL™ (owner 2026-11-16, the licence's shortest permitted form): the big part a line of its own by CSS.
    expect(label.querySelector('.pymol-contains-small')).toHaveTextContent('Includes')
    expect(label.querySelector('.pymol-contains-line > .pymol-contains-big')).toHaveTextContent('PyMOL™')
    expect(label.querySelector('.pymol-contains-line')!.textContent).toBe('PyMOL™')
    expect(jaNotice.contains_label).toBe(enNotice.contains_label)
  })

  it('reads as one plain phrase, marked English while it is English', () => {
    expect(pymolContainsText(enNotice.contains_label)).toBe('Includes PyMOL™')
    expect(pymolContainsLang(enNotice.contains_label)).toBe('en')
    expect(pymolContainsLang('<line><big>PyMOL™</big> のソースコード</line><small>を含む</small>')).toBeUndefined()
  })

  it('lets a translation reorder the tiers, and keeps the tags both languages use the same', () => {
    expect(tags(jaNotice.contains_label).sort()).toEqual(tags(enNotice.contains_label).sort())
    phrase = '<line><big>PyMOL™</big> のソースコード</line><small>を含む</small>'
    const { container } = render(<PymolContainsLabel size="md" />)
    const label = container.firstElementChild as HTMLElement
    expect(label.firstElementChild).toHaveClass('pymol-contains-line')
    expect(label).not.toHaveAttribute('lang')
    phrase = enNotice.contains_label
  })

  it('shows an unknown tag as text and closes one left open', () => {
    phrase = '<small>Contains <b>x</b>'
    const { container } = render(<PymolContainsLabel size="md" />)
    expect(container.querySelector('.pymol-contains-small')).toHaveTextContent('Contains <b>x</b>')
    phrase = enNotice.contains_label
  })
})
