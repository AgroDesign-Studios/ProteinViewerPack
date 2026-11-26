/**
 * A PyMOL dialog (Settings, Keys, About) opened from the phone's 「表示」
 * sheet closes that sheet in the same commit (`PymolPane` `onDialog`), so the
 * menu item that opened it is gone when it closes. The shared `Modal` then
 * returns the focus to the sheet's own opener — the bar's 「表示」 button —
 * never to <body> (PT-9229 item 6). The page's shape, cut to what decides it:
 * the real sheet, the item drawn into its slot through a portal, the dialog
 * drawn by the pane outside the sheet.
 */
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'ja' } }),
}))

import Modal from '../../src/components/Modal'
import { resetModalStackForTests } from '../../src/components/modalStack'
import { ViewSheet } from './MobileBar'

afterEach(() => {
  cleanup()
  resetModalStackForTests()
})

function Page() {
  const [sheet, setSheet] = useState(false)
  const [slot, setSlot] = useState<HTMLDivElement | null>(null)
  const [dialog, setDialog] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setSheet(true)}>
        View
      </button>
      {sheet && <ViewSheet engine="pymol" zoomDisabled={false} onZoom={() => undefined} toolsRef={setSlot} onClose={() => setSheet(false)} />}
      {/* The pane: its menu item in the sheet's slot, its dialog by itself. */}
      {sheet &&
        slot !== null &&
        createPortal(
          <button
            type="button"
            onClick={() => {
              setSheet(false)
              setDialog(true)
            }}
          >
            Settings…
          </button>,
          slot,
        )}
      {dialog && (
        <Modal labelledBy="dlg-title" onClose={() => setDialog(false)}>
          <h2 id="dlg-title">Settings</h2>
          <button type="button" onClick={() => setDialog(false)}>
            Close
          </button>
        </Modal>
      )}
    </>
  )
}

describe('a PyMOL dialog opened from the 「表示」 sheet', () => {
  it('gives the focus back to the 「表示」 button when it closes', async () => {
    const user = userEvent.setup()
    render(<Page />)
    await user.click(screen.getByRole('button', { name: 'View' }))
    await user.click(await screen.findByRole('button', { name: 'Settings…' }))
    expect(screen.queryByRole('button', { name: 'Settings…' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.getByRole('button', { name: 'View' })).toHaveFocus()
  })
})
