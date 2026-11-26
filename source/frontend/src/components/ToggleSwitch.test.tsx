import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ToggleSwitch } from './ToggleSwitch'

const css = readFileSync(join(__dirname, 'ToggleSwitch.css'), 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '')

describe('ToggleSwitch (owner 2026-11-16: the save dialog’s sessions, the ray quality)', () => {
  it('is a native checkbox with role switch, named by its label, switched by a press on the words', async () => {
    const onChange = vi.fn()
    render(<ToggleSwitch checked={false} onChange={onChange} label="Keep the session" />)
    const sw = screen.getByRole('switch', { name: 'Keep the session' })
    expect(sw).toHaveAttribute('type', 'checkbox')
    expect(sw).not.toBeChecked()
    await userEvent.click(screen.getByText('Keep the session'))
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('two-sided: the off word before the track is decoration, the name is the on side', () => {
    render(<ToggleSwitch checked onChange={() => undefined} offLabel="Normal quality" label="High quality" />)
    const sw = screen.getByRole('switch', { name: 'High quality' })
    expect(sw).toBeChecked()
    expect(screen.getByText('Normal quality')).toHaveAttribute('aria-hidden', 'true')
    expect(sw.closest('label')).toHaveClass('is-on')
  })

  it('an unavailable switch stays focusable, reads off, says why, and a press does nothing', async () => {
    const onChange = vi.fn()
    render(
      <>
        <ToggleSwitch checked onChange={onChange} label="PyMOL session" unavailable describedBy="why" />
        <p id="why">Start PyMOL once.</p>
      </>,
    )
    const sw = screen.getByRole('switch', { name: 'PyMOL session' })
    expect(sw).toBeEnabled()
    expect(sw).toHaveAttribute('aria-disabled', 'true')
    expect(sw).not.toBeChecked()
    expect(sw).toHaveAccessibleDescription('Start PyMOL once.')
    await userEvent.click(sw)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('showValueWhenUnavailable: a locked switch keeps showing its real value, says why, and a press does nothing', async () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <>
        <ToggleSwitch checked onChange={onChange} label="Alert me" unavailable showValueWhenUnavailable describedBy="why" />
        <p id="why">Elevation is needed.</p>
      </>,
    )
    const sw = screen.getByRole('switch', { name: 'Alert me' })
    expect(sw).toBeChecked()
    expect(sw).toHaveAttribute('aria-disabled', 'true')
    expect(sw.closest('label')).toHaveClass('is-on')
    expect(sw).toHaveAccessibleDescription('Elevation is needed.')
    await userEvent.click(sw)
    expect(onChange).not.toHaveBeenCalled()
    expect(sw).toBeChecked()
    // The real value both ways: off stays off.
    rerender(<ToggleSwitch checked={false} onChange={onChange} label="Alert me" unavailable showValueWhenUnavailable />)
    expect(screen.getByRole('switch', { name: 'Alert me' })).not.toBeChecked()
  })

  it('busy marks the switch aria-busy, and only while set', () => {
    const { rerender } = render(<ToggleSwitch checked onChange={() => undefined} label="Alert me" busy />)
    expect(screen.getByRole('switch', { name: 'Alert me' })).toHaveAttribute('aria-busy', 'true')
    rerender(<ToggleSwitch checked onChange={() => undefined} label="Alert me" />)
    expect(screen.getByRole('switch', { name: 'Alert me' })).not.toHaveAttribute('aria-busy')
  })

  it('the knob’s place carries the state, and it stops moving where motion is reduced', () => {
    expect(css).toMatch(/\.ui-switch:checked::before\s*\{\s*transform:\s*translateX\(16px\)/)
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*\.ui-switch::before\s*\{\s*transition:\s*none/)
    expect(css).toMatch(/\.ui-switch:focus-visible\s*\{[^}]*outline:/)
  })
})
