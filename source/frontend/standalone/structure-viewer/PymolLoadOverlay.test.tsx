import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { PymolLoadOverlay } from './PymolLoadOverlay'

const css = readFileSync(join(__dirname, 'standalone.css'), 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '')

describe('PymolLoadOverlay (owner 2026-11-16: the PyMOL wait turns over the viewer)', () => {
  it('draws a ring, the viewer’s name and what it is doing, hidden from a screen reader (the status line says it)', () => {
    const { container, rerender } = render(<PymolLoadOverlay starting />)
    const veil = container.firstElementChild as HTMLElement
    expect(veil).toHaveClass('sav-pyload')
    expect(veil).toHaveAttribute('aria-hidden', 'true')
    // Ring, then the name, then the state, one under the other (owner 2026-11-17; UI consult, astra).
    const card = veil.querySelector('.sav-pyload-card') as HTMLElement
    expect(Array.from(card.children).map(el => el.className)).toEqual(['sav-pyload-ring', 'sav-pyload-name', 'sav-pyload-text'])
    const name = card.querySelector('.sav-pyload-name') as HTMLElement
    expect(name).toHaveTextContent('htmlExport:sa_pyload_name')
    // The mode's name is in the page's language around the licence's phrase (owner 2026-11-18): no lang of its own.
    expect(name).not.toHaveAttribute('lang')
    expect(card.querySelector('.sav-pyload-text')).toHaveTextContent(/^htmlExport:sa_pyload_starting$/)
    rerender(<PymolLoadOverlay starting={false} />)
    expect(card.querySelector('.sav-pyload-text')).toHaveTextContent(/^htmlExport:sa_pyload_loading$/)
  })

  it('names the mode only as PyMOL’s licence allows, the phrase in English in both languages (owner 2026-11-18)', () => {
    const read = (lang: string) => JSON.parse(readFileSync(join(__dirname, `../../src/i18n/locales/${lang}/htmlExport.json`), 'utf-8')) as Record<string, string>
    expect([read('en').sa_pyload_name, read('ja').sa_pyload_name]).toEqual(['"Includes PyMOL™" mode', '"Includes PyMOL™" モード'])
    expect([read('en').sa_pyload_starting, read('en').sa_pyload_loading]).toEqual(['Starting…', 'Loading structure…'])
    expect([read('ja').sa_pyload_starting, read('ja').sa_pyload_loading]).toEqual(['起動中…', '構造を読み込み中…'])
  })

  it('the veil covers the stage, half see-through, and lets the pointer through to 3Dmol.js; the ring stops where motion is reduced', () => {
    const veil = css.match(/\.sav-pyload\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(veil).toMatch(/position:\s*absolute/)
    expect(veil).toMatch(/inset:\s*0/)
    expect(veil).toMatch(/pointer-events:\s*none/)
    expect(veil).toMatch(/background:\s*rgba\(255, 255, 255, 0\.55\)/)
    expect(css).toMatch(/\.sav-pyload-ring\s*\{[^}]*animation:\s*sav-pyload-spin/)
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.sav-pyload-ring\s*\{\s*animation:\s*none;/)
    // The stage holds it: positioned.
    expect(css).toMatch(/\.sav-stage\s*\{\s*position:\s*relative;/)
  })
})
