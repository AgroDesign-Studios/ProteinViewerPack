import { createRef } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { LIMITS } from './pymolFrameProtocol'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    // The `pymol:` prefix is dropped so the expectations read as the bare keys.
    t: (k: string, vars?: Record<string, unknown>) => {
      const key = k.replace(/^pymol:/, '')
      return vars ? `${key} ${JSON.stringify(vars)}` : key
    },
  }),
}))

import { PymolCommandLine } from './PymolCommandLine'

/** A `run` whose every call waits until the test settles it. */
function deferredRun() {
  const calls: Array<{ cmd: string; resolve: () => void; reject: (e: Error) => void }> = []
  const run = vi.fn(
    (cmd: string) =>
      new Promise<void>((resolve, reject) => {
        calls.push({ cmd, resolve, reject })
      }),
  )
  return { run, calls }
}

const flush = () => act(async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
})

describe('PymolCommandLine', () => {
  it('sends a line on Enter through run() and clears the box', async () => {
    const run = vi.fn(() => Promise.resolve())
    render(<PymolCommandLine run={run} disabled={false} />)
    const box = screen.getByRole('textbox', { name: 'cmd_label' })
    await userEvent.type(box, '  show sticks  {Enter}')
    await flush()
    expect(run).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledWith('show sticks')
    expect(box).toHaveValue('')
  })

  it('walks the history with ↑ / ↓ and gives the draft back', async () => {
    const run = vi.fn(() => Promise.resolve())
    render(<PymolCommandLine run={run} disabled={false} />)
    const box = screen.getByRole('textbox')
    await userEvent.type(box, 'hide everything{Enter}show cartoon{Enter}col')
    await userEvent.keyboard('{ArrowUp}')
    expect(box).toHaveValue('show cartoon')
    await userEvent.keyboard('{ArrowUp}')
    expect(box).toHaveValue('hide everything')
    await userEvent.keyboard('{ArrowDown}{ArrowDown}')
    expect(box).toHaveValue('col')
  })

  it('does not send while an IME is composing (Enter commits the composition only)', async () => {
    const run = vi.fn(() => Promise.resolve())
    render(<PymolCommandLine run={run} disabled={false} />)
    const box = screen.getByRole('textbox')
    fireEvent.change(box, { target: { value: 'select 炭素' } })
    fireEvent.keyDown(box, { key: 'Enter', isComposing: true })
    fireEvent.keyDown(box, { key: 'Enter', keyCode: 229 })
    fireEvent.keyDown(box, { key: 'ArrowUp', isComposing: true })
    await flush()
    expect(run).not.toHaveBeenCalled()
    expect(box).toHaveValue('select 炭素')
    fireEvent.keyDown(box, { key: 'Enter' })
    await flush()
    expect(run).toHaveBeenCalledWith('select 炭素')
  })

  it('sends nothing for a blank line', async () => {
    const run = vi.fn(() => Promise.resolve())
    render(<PymolCommandLine run={run} disabled={false} />)
    await userEvent.type(screen.getByRole('textbox'), '   {Enter}{Enter}')
    await flush()
    expect(run).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent('')
  })

  it('refuses a line over 16 KiB with a message, and keeps it in the box to shorten', async () => {
    const run = vi.fn(() => Promise.resolve())
    render(<PymolCommandLine run={run} disabled={false} />)
    const box = screen.getByRole('textbox')
    const long = 'x'.repeat(LIMITS.commandChars + 1)
    fireEvent.change(box, { target: { value: long } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await flush()
    expect(run).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent(`cmd_err_too_long {"limit":${LIMITS.commandChars}}`)
    expect(box).toHaveValue(long)
    // Exactly at the cap is sent.
    fireEvent.change(box, { target: { value: long.slice(1) } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await flush()
    expect(run).toHaveBeenCalledWith(long.slice(1))
  })

  it('refuses a session load (trap 49)', async () => {
    const run = vi.fn(() => Promise.resolve())
    render(<PymolCommandLine run={run} disabled={false} />)
    await userEvent.type(screen.getByRole('textbox'), 'load other.pse{Enter}')
    await flush()
    expect(run).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent('cmd_err_session_load')
  })

  it('hands over one line at a time: a fast typist never has two commands waiting', async () => {
    const { run, calls } = deferredRun()
    render(<PymolCommandLine run={run} disabled={false} />)
    const box = screen.getByRole('textbox')
    await userEvent.type(box, 'a{Enter}b{Enter}c{Enter}')
    await flush()
    expect(run).toHaveBeenCalledTimes(1)
    calls[0].resolve()
    await flush()
    expect(run).toHaveBeenCalledTimes(2)
    calls[1].resolve()
    await flush()
    expect(calls.map(c => c.cmd)).toEqual(['a', 'b', 'c'])
  })

  it('runs a multi-line paste line by line, in order, one waiting at most', async () => {
    const { run, calls } = deferredRun()
    render(<PymolCommandLine run={run} disabled={false} />)
    const lines = Array.from({ length: 50 }, (_, i) => `set sphere_scale, ${i}`)
    fireEvent.paste(screen.getByRole('textbox'), { clipboardData: { getData: () => lines.join('\r\n') + '\n' } })
    for (let i = 0; i < 50; i++) {
      await flush()
      expect(run).toHaveBeenCalledTimes(i + 1)
      calls[i].resolve()
    }
    await flush()
    expect(calls.map(c => c.cmd)).toEqual(lines)
    expect(screen.getByRole('status')).toHaveTextContent('cmd_paste_progress {"done":50,"total":50}')
  })

  it('stops a paste at the first line PyMOL fails, and says what PyMOL answered as PyMOL’s (PT-3291 item 11)', async () => {
    const { run, calls } = deferredRun()
    render(<PymolCommandLine run={run} disabled={false} />)
    fireEvent.paste(screen.getByRole('textbox'), { clipboardData: { getData: () => 'a\nb\nc' } })
    await flush()
    calls[0].resolve()
    await flush()
    calls[1].reject(new Error('NameError: b'))
    await flush()
    expect(run).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('status')).toHaveTextContent(
      `cmd_paste_stopped ${JSON.stringify({ done: 2, total: 3, detail: `detail_pymol_said ${JSON.stringify({ text: 'NameError: b' })}` })}`,
    )
  })

  it('drops every line it still holds when Stop takes its line down, says so once, and reports what it holds (PT-3291 item 6)', async () => {
    const { run, calls } = deferredRun()
    const held: number[] = []
    render(<PymolCommandLine run={run} disabled={false} onHeldChange={n => held.push(n)} />)
    const box = screen.getByRole('textbox')
    await userEvent.type(box, 'a{Enter}b{Enter}')
    fireEvent.paste(box, { clipboardData: { getData: () => 'c\nd\ne' } })
    await flush()
    // One line in the controller, four held back behind it.
    expect(run).toHaveBeenCalledTimes(1)
    expect(held[held.length - 1]).toBe(4)
    calls[0].reject(new Error('cancelled'))
    await flush()
    expect(run).toHaveBeenCalledTimes(1)
    expect(held[held.length - 1]).toBe(0)
    expect(screen.getByRole('status')).toHaveTextContent('cmd_stopped_dropped {"count":4,"n":"4"}')
    // A line entered afterwards is for the new frame, and goes.
    await userEvent.type(box, 'f{Enter}')
    await flush()
    expect(calls.map(c => c.cmd)).toEqual(['a', 'f'])
  })

  it('says a Stop with nothing held as stopped, and a frame rebuilt under it with why (PT-3291 item 6)', async () => {
    const { run, calls } = deferredRun()
    render(<PymolCommandLine run={run} disabled={false} />)
    const box = screen.getByRole('textbox')
    await userEvent.type(box, 'a{Enter}')
    await flush()
    calls[0].reject(new Error('cancelled'))
    await flush()
    expect(screen.getByRole('status')).toHaveTextContent(/^cmd_stopped$/)
    await userEvent.type(box, 'b{Enter}c{Enter}')
    await flush()
    calls[1].reject(new Error('the PyMOL frame was rebuilt'))
    await flush()
    expect(screen.getByRole('status')).toHaveTextContent('cmd_gone_dropped {"count":1,"n":"1","detail":"detail_frame_gone"}')
    expect(calls.map(c => c.cmd)).toEqual(['a', 'b'])
  })

  it('names a refused line of a paste as it stands in the paste, blank lines counted (PT-3291 item 16)', async () => {
    const run = vi.fn(() => Promise.resolve())
    render(<PymolCommandLine run={run} disabled={false} />)
    fireEvent.paste(screen.getByRole('textbox'), { clipboardData: { getData: () => 'zoom\n\n\nload x.pse\nzoom' } })
    await flush()
    expect(run).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent('cmd_paste_refused {"line":4')
  })

  it('puts one copied line, line break and all, into the box rather than running it (PT-3291 item 16)', async () => {
    const run = vi.fn(() => Promise.resolve())
    render(<PymolCommandLine run={run} disabled={false} />)
    const box = screen.getByRole('textbox')
    fireEvent.paste(box, { clipboardData: { getData: () => '  color red, chain A\r\n' } })
    await flush()
    expect(run).not.toHaveBeenCalled()
    expect(box).toHaveValue('color red, chain A')
  })

  it('says how far a paste got at its first line and its end, not at every line between (PT-3291 item 16)', async () => {
    const { run, calls } = deferredRun()
    render(<PymolCommandLine run={run} disabled={false} />)
    fireEvent.paste(screen.getByRole('textbox'), { clipboardData: { getData: () => 'a\nb\nc\nd\ne' } })
    await flush()
    calls[0].resolve()
    await flush()
    expect(screen.getByRole('status')).toHaveTextContent('cmd_paste_progress {"done":1,"total":5}')
    for (let i = 1; i < 4; i++) {
      calls[i].resolve()
      await flush()
    }
    // Well inside PASTE_PROGRESS_EVERY_MS: the line still says 1.
    expect(screen.getByRole('status')).toHaveTextContent('cmd_paste_progress {"done":1,"total":5}')
    calls[4].resolve()
    await flush()
    expect(screen.getByRole('status')).toHaveTextContent('cmd_paste_progress {"done":5,"total":5}')
  })

  it('refuses a whole paste that holds a session load, before running any of it', async () => {
    const run = vi.fn(() => Promise.resolve())
    render(<PymolCommandLine run={run} disabled={false} />)
    fireEvent.paste(screen.getByRole('textbox'), { clipboardData: { getData: () => 'zoom\nload x.pse\nzoom' } })
    await flush()
    expect(run).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent('cmd_paste_refused {"line":2')
  })

  it('leaves a single-line paste in the box to edit', async () => {
    const run = vi.fn(() => Promise.resolve())
    render(<PymolCommandLine run={run} disabled={false} />)
    const box = screen.getByRole('textbox')
    await userEvent.click(box)
    await userEvent.paste('color red')
    expect(box).toHaveValue('color red')
    expect(run).not.toHaveBeenCalled()
  })

  it('reports a command the frame failed', async () => {
    const run = vi.fn(() => Promise.reject(new Error('NameError: x')))
    render(<PymolCommandLine run={run} disabled={false} />)
    await userEvent.type(screen.getByRole('textbox'), 'x{Enter}')
    await flush()
    expect(screen.getByRole('status')).toHaveTextContent(
      `cmd_failed ${JSON.stringify({ detail: `detail_pymol_said ${JSON.stringify({ text: 'NameError: x' })}` })}`,
    )
  })

  it('is read-only and aria-disabled until PyMOL is ready, never disabled: it keeps focus, and sends nothing (PT-3291 item 5)', async () => {
    const run = vi.fn(() => Promise.resolve())
    const ref = createRef<HTMLInputElement>()
    render(<PymolCommandLine run={run} disabled inputRef={ref} />)
    const box = screen.getByRole('textbox')
    expect(ref.current).toBe(box)
    expect(box).toHaveAttribute('aria-disabled', 'true')
    expect(box).toHaveAttribute('readonly')
    expect(box).not.toBeDisabled()
    box.focus()
    expect(box).toHaveFocus()
    fireEvent.keyDown(box, { key: 'Enter' })
    fireEvent.paste(box, { clipboardData: { getData: () => 'zoom\norient' } })
    await flush()
    expect(run).not.toHaveBeenCalled()
  })
})
