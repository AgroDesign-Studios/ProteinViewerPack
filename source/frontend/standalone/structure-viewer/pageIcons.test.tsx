/**
 * The language switch's flags (owner 2026-11-17: 英国国旗と日の丸): the app's
 * own simple drawings, decoration only, in the proportions of the flags.
 */
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { FlagJapan, FlagUk } from './pageIcons'

describe('the flags', () => {
  it('the Union Flag at 1:2 and the Hinomaru at 2:3, its disc three fifths of the height, both hidden from assistive tech', () => {
    const uk = render(<FlagUk />).container.querySelector('svg')!
    expect(uk.getAttribute('viewBox')).toBe('0 0 60 30')
    expect(uk).toHaveAttribute('aria-hidden', 'true')
    expect(Number(uk.getAttribute('width')) / Number(uk.getAttribute('height'))).toBe(2)
    // Blue field, white and red saltires, white-edged red cross.
    expect(Array.from(uk.querySelectorAll('rect, path')).map(e => e.getAttribute('fill') ?? e.getAttribute('stroke'))).toEqual(['#012169', '#fff', '#c8102e', '#fff', '#c8102e'])
    const jp = render(<FlagJapan />).container.querySelector('svg')!
    expect(jp.getAttribute('viewBox')).toBe('0 0 30 20')
    expect(jp).toHaveAttribute('aria-hidden', 'true')
    const disc = jp.querySelector('circle')!
    expect(Number(disc.getAttribute('r')) * 2).toBe(20 * (3 / 5))
    expect([disc.getAttribute('cx'), disc.getAttribute('cy')]).toEqual(['15', '10'])
    expect(disc).toHaveAttribute('fill', '#bc002d')
  })
})
