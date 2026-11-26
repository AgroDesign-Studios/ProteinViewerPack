/**
 * The header's 「画像出力」 (owner 2026-11-16): a small panel under a camera
 * button, like 「詳細」 — no menu: the button opens it and the pictures are
 * buttons in it. A press shuts it first and gives the focus back to the
 * button (a dialog the ray trace opens then gives it back there too); Escape
 * does the same; a question asked to switch engines is gone the next time.
 * The page's wiring is in ExportHub.test.tsx and StandaloneApp.test.tsx.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'ja' } }),
}))

import { imageItems, type ExportContext } from './exportItems'
import { ImageOutput } from './ImageOutput'

const ctx = (over: Partial<ExportContext> = {}): ExportContext => ({ full: true, shown: '3dmol', gl: true, dmolView: true, ...over })

function open(over: Partial<ExportContext> = {}, iconOnly = false) {
  const onPick = vi.fn()
  render(
    <header>
      <ImageOutput items={imageItems(ctx(over))} noDoc={null} onNoDoc={() => undefined} iconOnly={iconOnly} onPick={onPick} />
    </header>,
  )
  const details = document.querySelector('details.sav-image') as HTMLDetailsElement
  return { onPick, details, summary: details.querySelector('summary')!, user: userEvent.setup() }
}

afterEach(cleanup)

describe('ImageOutput', () => {
  it('is a disclosure under its own name, the camera beside it; no ARIA menu', () => {
    const { summary } = open()
    expect(summary).toHaveAttribute('aria-label', 'htmlExport:sa_image_button')
    expect(summary).toHaveTextContent('htmlExport:sa_image_button')
    expect(summary.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    expect(document.querySelector('[role="menu"], [role="menuitem"]')).toBeNull()
  })

  it('on a phone shows the camera alone, its name its label', () => {
    const { summary } = open({}, true)
    expect(summary.textContent).toBe('')
    expect(summary).toHaveAccessibleName('htmlExport:sa_image_button')
  })

  it('holds the screenshot and the ray trace, the ray trace tagged Includes PyMOL™, each with its line', () => {
    open()
    const png = screen.getByRole('button', { name: 'htmlExport:sa_export_png' })
    expect(png).toHaveAccessibleDescription('htmlExport:sa_export_png_note')
    expect(png.querySelector('.sav-tag')).toBeNull()
    const ray = screen.getByRole('button', { name: /htmlExport:sa_export_ray/ })
    expect(ray.querySelector('.sav-tag')).toHaveTextContent(/^Includes PyMOL™$/)
    expect(ray).toHaveAccessibleDescription('htmlExport:sa_export_ray_note')
  })

  it('a screenshot shuts the panel, gives the focus back to its button, then saves', async () => {
    const { user, details, summary, onPick } = open()
    await user.click(summary)
    await waitFor(() => expect(details.open).toBe(true))
    await user.click(screen.getByRole('button', { name: 'htmlExport:sa_export_png' }))
    expect(details.open).toBe(false)
    expect(summary).toHaveFocus()
    expect(onPick).toHaveBeenCalledWith('png', false)
  })

  it('the ray trace while PyMOL is shown opens at once; while 3Dmol.js is shown it asks first', async () => {
    const shown = open({ shown: 'pymol' })
    await shown.user.click(shown.summary)
    await shown.user.click(screen.getByRole('button', { name: /sa_export_ray/ }))
    expect(shown.onPick).toHaveBeenCalledWith('ray', false)
    expect(shown.details.open).toBe(false)
    cleanup()
    const { user, summary, details, onPick } = open()
    await user.click(summary)
    const ray = screen.getByRole('button', { name: /sa_export_ray/ })
    await user.click(ray)
    expect(onPick).not.toHaveBeenCalled()
    expect(ray).toHaveAttribute('aria-expanded', 'true')
    const go = screen.getByRole('button', { name: 'htmlExport:sa_export_switch' })
    expect(go).toHaveFocus()
    await user.click(go)
    expect(onPick).toHaveBeenCalledWith('ray', true)
    expect(details.open).toBe(false)
    expect(summary).toHaveFocus()
  })

  it('Escape shuts it, giving the focus back; the question is gone when it opens again', async () => {
    const { user, summary, details } = open()
    await user.click(summary)
    await waitFor(() => expect(details.open).toBe(true))
    await user.click(screen.getByRole('button', { name: /sa_export_ray/ }))
    expect(screen.getByRole('button', { name: 'htmlExport:sa_export_switch' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(details.open).toBe(false)
    expect(summary).toHaveFocus()
    await waitFor(() => expect(screen.queryByRole('button', { name: 'htmlExport:sa_export_switch' })).toBeNull())
  })

  it('an entry that cannot be used stays in the Tab order with its reason, and a press does nothing', async () => {
    const { user, summary, details, onPick } = open({ pymolBlocked: true })
    await user.click(summary)
    const ray = screen.getByRole('button', { name: /sa_export_ray/ })
    expect(ray).toHaveAttribute('aria-disabled', 'true')
    expect(ray).toHaveAccessibleDescription('htmlExport:sa_export_blocked_no_pymol')
    await user.click(ray)
    expect(onPick).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'htmlExport:sa_export_switch' })).toBeNull()
    expect(details.open).toBe(true)
  })

  it('the light edition holds the screenshot alone', () => {
    open({ full: false })
    expect(screen.getAllByRole('button', { name: /sa_export_/ }).map(b => b.textContent)).toEqual(['htmlExport:sa_export_png'])
  })
})
