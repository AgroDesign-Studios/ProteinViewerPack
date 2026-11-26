import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    // The `pymol:` prefix is dropped so the expectations read as the bare keys.
    t: (k: string, vars?: Record<string, unknown>) => {
      const key = k.replace(/^pymol:/, '')
      return vars ? `${key} ${JSON.stringify(vars)}` : key
    },
  }),
}))

import { BUSY_SHOW_AFTER_MS, PymolBusyBar } from './PymolBusyBar'
import type { PymolBusy } from './pymolBusy'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-13T00:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

const command = (over: Partial<PymolBusy> = {}): PymolBusy => ({
  kind: 'command', label: 'show surface', startedAt: Date.now(), queued: 0, queuedCancels: 0, ...over,
})

describe('PymolBusyBar', () => {
  it('stays hidden for a request that ends quickly', () => {
    const { rerender } = render(<PymolBusyBar busy={command()} onCancel={vi.fn()} />)
    act(() => {
      vi.advanceTimersByTime(BUSY_SHOW_AFTER_MS - 100)
    })
    expect(screen.queryByRole('button')).toBeNull()
    rerender(<PymolBusyBar busy={null} onCancel={vi.fn()} />)
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('then names the command, counts the seconds and what waits, and offers the cancel', () => {
    const onCancel = vi.fn()
    render(<PymolBusyBar busy={command({ queued: 2, queuedCancels: 1 })} onCancel={onCancel} />)
    act(() => {
      vi.advanceTimersByTime(12_000)
    })
    const waiting = 'busy_queued {"count":2,"n":"2"} busy_queued_stop_hint {"stop":"busy_cancel"}'
    expect(screen.getByText(/busy_command/)).toHaveTextContent(`busy_command {"label":"show surface","seconds":12} ${waiting}`)
    const button = screen.getByRole('button', { name: 'busy_cancel' })
    // Before it is pressed, Stop says the waiting requests stop too (PT-3961), then what the rebuild does.
    expect(button).toHaveAccessibleDescription(`${waiting} busy_cancel_note`)
    fireEvent.click(button)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('counts the lines the command line holds back as waiting, and says Stop stops them (PT-3291 item 6)', () => {
    render(<PymolBusyBar busy={command({ queued: 1, queuedCancels: 0 })} held={2} onCancel={vi.fn()} />)
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    const waiting = 'busy_queued {"count":3,"n":"3"} busy_queued_stop_hint {"stop":"busy_cancel"}'
    expect(screen.getByText(/busy_command/)).toHaveTextContent(`busy_command {"label":"show surface","seconds":3} ${waiting}`)
    expect(screen.getByRole('button', { name: 'busy_cancel' })).toHaveAccessibleDescription(`${waiting} busy_cancel_note`)
  })

  it('says nothing about waiting requests when none wait (PT-3961)', () => {
    render(<PymolBusyBar busy={command()} onCancel={vi.fn()} />)
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(screen.queryByText(/busy_queued/)).toBeNull()
    expect(screen.getByRole('button', { name: 'busy_cancel' })).toHaveAccessibleDescription('busy_cancel_note')
  })

  it('counts what waits but says nothing of Stop when only a removal or the page’s own steps wait (PT-4042)', () => {
    render(<PymolBusyBar busy={command({ queued: 2, queuedCancels: 0 })} onCancel={vi.fn()} />)
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(screen.getByText(/busy_command/)).toHaveTextContent('busy_command {"label":"show surface","seconds":3} busy_queued {"count":2,"n":"2"}')
    expect(screen.queryByText(/busy_queued_stop_hint/)).toBeNull()
    expect(screen.getByRole('button', { name: 'busy_cancel' })).toHaveAccessibleDescription('busy_queued {"count":2,"n":"2"} busy_cancel_note')
  })

  it('shows an export, but never the page’s own load or restore', () => {
    const { rerender } = render(<PymolBusyBar busy={command({ kind: 'export', label: null })} onCancel={vi.fn()} />)
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(screen.getByText('busy_export {"seconds":3}')).toBeInTheDocument()
    rerender(<PymolBusyBar busy={command({ kind: 'load', label: null, startedAt: Date.now() - 60_000 })} onCancel={vi.fn()} />)
    expect(screen.queryByRole('button')).toBeNull()
  })
})
