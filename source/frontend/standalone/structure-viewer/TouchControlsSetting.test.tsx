import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'ja' } }),
}))

import { resetTouchControlsForTests, setTouchOriginal, TOUCH_ORIGINAL_KEY, touchOriginal } from './touchControls'
import { TouchControlsSetting } from './TouchControlsSetting'

beforeEach(() => {
  window.localStorage.clear()
  resetTouchControlsForTests()
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('the Light viewer’s touch controls (owner 2026-11-17)', () => {
  it('two fingers move by default; the switch chooses 3Dmol.js’s own controls and is kept in this browser', async () => {
    render(<TouchControlsSetting heading />)
    const sw = screen.getByRole('switch', { name: 'htmlExport:sa_touch_original' })
    expect(sw).not.toBeChecked()
    expect(sw).toHaveAccessibleDescription('htmlExport:sa_touch_note_default')
    expect(screen.getByRole('heading', { name: 'htmlExport:sa_touch_heading' })).toBeInTheDocument()
    await userEvent.click(sw)
    expect(sw).toBeChecked()
    expect(sw).toHaveAccessibleDescription('htmlExport:sa_touch_note_original')
    expect(window.localStorage.getItem(TOUCH_ORIGINAL_KEY)).toBe('1')
    // Read again on the next visit.
    resetTouchControlsForTests()
    expect(touchOriginal()).toBe(true)
  })

  it('two switches show one choice: a change in one is the other’s', async () => {
    render(
      <>
        <TouchControlsSetting />
        <TouchControlsSetting heading />
      </>,
    )
    const [a, b] = screen.getAllByRole('switch', { name: 'htmlExport:sa_touch_original' })
    await userEvent.click(a)
    expect(b).toBeChecked()
  })

  it('storage that refuses: the choice holds for this visit and says it was not saved', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    render(<TouchControlsSetting />)
    const sw = screen.getByRole('switch', { name: 'htmlExport:sa_touch_original' })
    await userEvent.click(sw)
    expect(sw).toBeChecked()
    expect(sw).toHaveAccessibleDescription('htmlExport:sa_touch_note_original htmlExport:sa_touch_not_saved')
    setTouchOriginal(false)
  })
})
