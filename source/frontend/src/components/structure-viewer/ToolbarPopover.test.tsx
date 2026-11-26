/**
 * One drop-down of the one-row 3Dmol.js toolbar (owner 2026-11-19): a
 * disclosure whose panel lies over the view; Escape, a press outside and the
 * keyboard leaving close it.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import ToolbarPopover from './ToolbarPopover'

function Harness() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <ToolbarPopover id="p1" label="Style" summary="Ribbon +1" open={open} onOpen={setOpen}>
        <label>
          <input type="checkbox" /> Stick
        </label>
      </ToolbarPopover>
      <button type="button">after</button>
      <div data-testid="view" />
    </>
  )
}

afterEach(cleanup)

describe('ToolbarPopover', () => {
  it('is a button that says what it is set to and opens its panel (aria-expanded, aria-controls)', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const button = screen.getByRole('button', { name: /Style/ })
    expect(button).toHaveTextContent('StyleRibbon +1')
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(button).toHaveAttribute('aria-controls', 'p1')
    expect(screen.queryByRole('checkbox', { name: 'Stick' })).toBeNull()
    await user.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('checkbox', { name: 'Stick' })).toBeVisible()
    await user.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'false')
  })

  it('closes on Escape with the focus back on its button, on a press outside, and when Tab leaves it', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const button = screen.getByRole('button', { name: /Style/ })
    await user.click(button)
    await user.click(screen.getByRole('checkbox', { name: 'Stick' }))
    expect(button).toHaveAttribute('aria-expanded', 'true')
    await user.keyboard('{Escape}')
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(button).toHaveFocus()
    await user.click(button)
    fireEvent.pointerDown(screen.getByTestId('view'))
    expect(button).toHaveAttribute('aria-expanded', 'false')
    await user.click(button)
    await user.tab()
    expect(screen.getByRole('checkbox', { name: 'Stick' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'after' })).toHaveFocus()
    expect(button).toHaveAttribute('aria-expanded', 'false')
  })
})
