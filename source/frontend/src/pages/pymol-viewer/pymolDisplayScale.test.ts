import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { autoDisplayScale, readScaleChoice, scaleCommand, useDisplayScale, writeScaleChoice } from './pymolDisplayScale'

const WORKER = readFileSync(
  join(process.cwd(), 'public', 'vendor', 'pymol', '3.2.0a-edcda80f-s3-pyodide-314.0.7', 'worker.js'),
  'utf8',
)

afterEach(() => {
  window.localStorage.clear()
})

describe('the automatic display scale', () => {
  it('is the nearest integer: 125 % keeps 1, 150 % takes 2, never below 1', () => {
    expect([1, 1.25, 1.5, 1.75, 2, 2.5, 3].map(autoDisplayScale)).toEqual([1, 1, 2, 2, 2, 3, 3])
    expect([0, -1, Number.NaN, 0.5].map(autoDisplayScale)).toEqual([1, 1, 1, 1])
  })

  it('is the same rule the worker applies (desktop PyMOL’s int(DPR) is not)', () => {
    expect(WORKER).toContain('const displayScale = (dpr) => Math.max(1, Math.round(+dpr || 1));')
    expect(WORKER).not.toMatch(/Math\.floor\([^)]*[dD][pP][rR]/)
  })

  it('is set by the worker once, at boot: after that the page is its only writer (PT-3291 item 14)', () => {
    const code = WORKER.split('\n').filter(l => !/^\s*\/\//.test(l))
    // Reads (the object panel's width, `cmd.get`, the screenshot's `get_setting_int`) are not writes.
    const read = (l: string) => l.includes("cmd.get('display_scale_factor')") || l.includes("cmd.get_setting_int('display_scale_factor')")
    const sets = code.filter(l => l.includes('display_scale_factor') && !read(l))
    // The screenshot at a multiple (owner 2026-11-20, `pngScaled`) raises it for
    // one read and puts the value it read back in the same task: a loan the
    // user never sees, not a second writer.
    const loan = sets.filter(l => /\(s0 \* k\)|\+ s0 \+/.test(l))
    expect(loan).toHaveLength(2)
    const rest = sets.filter(l => !loan.includes(l))
    expect(rest).toHaveLength(1)
    expect(rest[0]).toContain('displayScale(DPR)')
  })
})

describe('the user’s choice', () => {
  it('is kept per browser, and anything unknown reads as automatic', () => {
    expect(readScaleChoice()).toBe('auto')
    writeScaleChoice(2)
    expect(readScaleChoice()).toBe(2)
    writeScaleChoice('auto')
    expect(readScaleChoice()).toBe('auto')
    window.localStorage.setItem('agdb_pymol_display_scale', '9')
    expect(readScaleChoice()).toBe('auto')
  })

  it('survives storage that throws', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    expect(readScaleChoice()).toBe('auto')
    expect(() => writeScaleChoice(3)).not.toThrow()
    get.mockRestore()
    set.mockRestore()
  })

  it('is one PyMOL command', () => {
    expect(scaleCommand(2, 1.25)).toBe('set display_scale_factor, 2')
    expect(scaleCommand('auto', 1.5)).toBe('set display_scale_factor, 2')
  })
})

describe('useDisplayScale', () => {
  it('sends nothing at the first ready while automatic, the pinned value once ready, and again after a rebuild', () => {
    const run = vi.fn((_cmd: string, _opts: { page: boolean }) => Promise.resolve())
    const { result, rerender } = renderHook(p => useDisplayScale(p), { initialProps: { ready: false, generation: 0, run } })
    rerender({ ready: true, generation: 0, run })
    expect(run).not.toHaveBeenCalled()
    act(() => result.current[1](3))
    expect(run).toHaveBeenLastCalledWith('set display_scale_factor, 3', { page: true })
    rerender({ ready: false, generation: 1, run })
    rerender({ ready: true, generation: 1, run })
    expect(run).toHaveBeenCalledTimes(2)
    // Back to automatic: the rule's value replaces the pin...
    act(() => result.current[1]('auto'))
    expect(run).toHaveBeenCalledTimes(3)
    expect(run).toHaveBeenLastCalledWith('set display_scale_factor, 1', { page: true })
    // ...and goes again after a rebuild: the snapshot it restores carries the
    // value it was taken with, the old pin included (PT-3291 item 14).
    rerender({ ready: false, generation: 2, run })
    rerender({ ready: true, generation: 2, run })
    expect(run).toHaveBeenCalledTimes(4)
    expect(run).toHaveBeenLastCalledWith('set display_scale_factor, 1', { page: true })
  })

  it('sends every value as the page’s, the one after the user’s own change too: Stop never takes the preference back (PT-3291 item 22)', () => {
    writeScaleChoice(2)
    const run = vi.fn((_cmd: string, _opts: { page: boolean }) => Promise.resolve())
    const { result, rerender } = renderHook(p => useDisplayScale(p), { initialProps: { ready: false, generation: 0, run } })
    rerender({ ready: true, generation: 0, run })
    expect(run).toHaveBeenLastCalledWith('set display_scale_factor, 2', { page: true })
    act(() => result.current[1](3))
    expect(run).toHaveBeenLastCalledWith('set display_scale_factor, 3', { page: true })
    // Choosing the value already chosen sends nothing.
    act(() => result.current[1](3))
    expect(run).toHaveBeenCalledTimes(2)
    rerender({ ready: false, generation: 1, run })
    rerender({ ready: true, generation: 1, run })
    expect(run).toHaveBeenCalledTimes(3)
    expect(run.mock.calls.every(([, o]) => o.page)).toBe(true)
  })

  it('sends the value again on a new DPR, automatic included: the worker no longer follows it by itself (PT-3291 item 14)', () => {
    const listeners: Array<() => void> = []
    const realMatchMedia = window.matchMedia
    const realDpr = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio')
    window.matchMedia = ((query: string) => ({
      media: query,
      addEventListener: (_type: string, cb: () => void) => listeners.push(cb),
      removeEventListener: () => undefined,
    })) as unknown as typeof window.matchMedia
    try {
      const run = vi.fn((_cmd: string, _opts: { page: boolean }) => Promise.resolve())
      const { rerender } = renderHook(p => useDisplayScale(p), { initialProps: { ready: false, generation: 0, run } })
      rerender({ ready: true, generation: 0, run })
      expect(run).not.toHaveBeenCalled()
      Object.defineProperty(window, 'devicePixelRatio', { value: 1.5, configurable: true })
      act(() => listeners.forEach(cb => cb()))
      expect(run).toHaveBeenLastCalledWith('set display_scale_factor, 2', { page: true })
    } finally {
      window.matchMedia = realMatchMedia
      if (realDpr) Object.defineProperty(window, 'devicePixelRatio', realDpr)
      else delete (window as { devicePixelRatio?: number }).devicePixelRatio
    }
  })
})
