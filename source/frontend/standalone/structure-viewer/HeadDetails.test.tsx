/**
 * The header's 「詳細」 panel stays inside the header and the screen (PT-9400
 * item 2): on a phone whose short structure name leaves 「詳細」 mid-header,
 * and on a mid-width window whose long name pushes it right. jsdom lays
 * nothing out, so the boxes are given; the real widths (390 x 844 and 1024)
 * were checked in Chromium (PR body).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { HEAD_POP_GUTTER_PX, HeadDetails, popShift } from './HeadDetails'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const box = (left: number, width: number) => ({ left, right: left + width, width, top: 0, bottom: 40, height: 40, x: left, y: 0 }) as DOMRect

/** Renders 「詳細」 in a header of `headW` px, its panel at `popLeft` and `popW` px wide where CSS puts it. */
function openAt(headW: number, popLeft: number, popW: number) {
  Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: headW })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.tagName === 'HEADER') return box(0, headW)
    if (this.classList.contains('sav-details-pop')) return box(popLeft, popW)
    return box(0, 0)
  })
  const view = render(
    <header>
      <HeadDetails summary="Details">
        <p>About this file</p>
      </HeadDetails>
    </header>,
  )
  const details = view.container.querySelector('details')!
  act(() => {
    details.open = true
    fireEvent(details, new Event('toggle'))
  })
  return view.container.querySelector<HTMLElement>('.sav-details-pop')!
}

describe('HeadDetails', () => {
  it('popShift moves a box back inside, left edge first', () => {
    expect(popShift(100, 300, 12, 378)).toBe(0)
    expect(popShift(200, 500, 12, 378)).toBe(-122)
    expect(popShift(-80, 200, 12, 378)).toBe(92)
    // Wider than the room: its left edge stays in.
    expect(popShift(0, 500, 12, 378)).toBe(12)
  })

  it('a phone (390 px): a panel opened leftwards past the screen’s left edge comes back to the gutter', () => {
    const pop = openAt(390, -120, 366)
    expect(pop.style.getPropertyValue('--sav-pop-shift')).toBe(`${120 + HEAD_POP_GUTTER_PX}px`)
  })

  it('a mid-width window (1024 px): a panel past the right edge is moved left to the gutter', () => {
    const pop = openAt(1024, 700, 520)
    expect(pop.style.getPropertyValue('--sav-pop-shift')).toBe(`${1024 - HEAD_POP_GUTTER_PX - 1220}px`)
  })

  it('a panel already inside stays where it opened, and is measured again on a resize', () => {
    const pop = openAt(1280, 300, 520)
    expect(pop.style.getPropertyValue('--sav-pop-shift')).toBe('')
    Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 760 })
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })
    expect(pop.style.getPropertyValue('--sav-pop-shift')).toBe(`${760 - HEAD_POP_GUTTER_PX - 820}px`)
  })

  it('the CSS moves the panel by that shift, and on a phone the name takes the room so 「詳細」 and the language sit right', () => {
    const css = readFileSync(join(__dirname, 'standalone.css'), 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(css).toMatch(/\.sav-details-pop\s*\{[^}]*transform:\s*translateX\(var\(--sav-pop-shift, 0px\)\)/)
    expect(css).toMatch(/\.sav-ident\s*\{[^}]*flex:\s*1 1 auto/)
  })
})
