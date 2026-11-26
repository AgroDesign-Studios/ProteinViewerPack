import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { UiState } from './pymolFrameProtocol'
import { MEASURE_OFF, MEASURE_ON, PymolMeasureChip } from './PymolMeasureChip'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

const ui = (wizard: UiState['wizard']): UiState => ({ sel: null, atoms: null, runs: null, more: false, shown: 0, hetero: false, wizard })
const chip = () => screen.getByRole('button', { name: /pymol:measure/ })

describe('PymolMeasureChip — 「📏 測定」 for PyMOL (owner 2026-11-12)', () => {
  it('starts the Measurement wizard (never a second one) and puts the host\'s tool away', async () => {
    const run = vi.fn().mockResolvedValue(undefined)
    const onStart = vi.fn()
    render(<PymolMeasureChip ui={ui(null)} ready run={run} onStart={onStart} />)
    expect(chip()).toHaveAttribute('aria-pressed', 'false')
    await act(async () => { fireEvent.click(chip()) })
    expect(run).toHaveBeenCalledWith(MEASURE_ON)
    expect(onStart).toHaveBeenCalledTimes(1)
    expect(MEASURE_ON).toContain("!= 'Measurement'")
  })

  it('is pressed while PyMOL reports the wizard, however it was opened, and ends only that wizard', async () => {
    const run = vi.fn().mockResolvedValue(undefined)
    const onStart = vi.fn()
    render(<PymolMeasureChip ui={ui('measurement')} ready run={run} onStart={onStart} />)
    expect(chip()).toHaveAttribute('aria-pressed', 'true')
    expect(chip()).toHaveTextContent('pymol:measure_on')
    await act(async () => { fireEvent.click(chip()) })
    expect(run).toHaveBeenCalledWith(MEASURE_OFF)
    expect(onStart).not.toHaveBeenCalled()
    expect(MEASURE_OFF).toContain("== 'Measurement'")
    expect(MEASURE_OFF).not.toMatch(/set_wizard_stack/)
  })

  it('is locked, with the reason, before PyMOL is ready and while another wizard is up', () => {
    const run = vi.fn()
    const { rerender } = render(<PymolMeasureChip ui={null} ready={false} run={run} />)
    expect(chip()).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByText('pymol:measure_locked_not_ready')).toBeInTheDocument()
    fireEvent.click(chip())
    rerender(<PymolMeasureChip ui={ui('other')} ready run={run} />)
    expect(chip()).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByText('pymol:measure_locked_other_wizard')).toBeInTheDocument()
    fireEvent.click(chip())
    expect(run).not.toHaveBeenCalled()
  })

  it('is busy between a press and the reply, and takes no second press then', async () => {
    let finish: () => void = () => {}
    const run = vi.fn(() => new Promise<void>(r => { finish = r }))
    render(<PymolMeasureChip ui={ui(null)} ready run={run} />)
    fireEvent.click(chip())
    expect(chip()).toHaveAttribute('aria-busy', 'true')
    fireEvent.click(chip())
    expect(run).toHaveBeenCalledTimes(1)
    await act(async () => { finish() })
    expect(chip()).not.toHaveAttribute('aria-busy')
  })
})
