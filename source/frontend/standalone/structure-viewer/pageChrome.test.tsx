/**
 * The page's own chrome added 2026-11-15 (owner): the phone/desktop layout
 * toggle (`useMobile`), 「全画面」 (`useFullscreen`: the browser's full screen
 * on the whole page, the page's expanded view where there is none) and the
 * note the app opens with (`NoticeBanner`).
 */
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'ja' } }) }))

import { NOTICE_HIDDEN_KEY, NoticeBanner } from './NoticeBanner'
import { probe } from './probe'
import { useFullscreen } from './useFullscreen'
import { isMobileNow, setMobileOverride, useMobile, usePhoneColumn } from './useMobile'

afterEach(() => {
  cleanup()
  act(() => setMobileOverride(null))
  vi.restoreAllMocks()
  try {
    window.localStorage.removeItem(NOTICE_HIDDEN_KEY)
  } catch {
    // jsdom always has it.
  }
})

describe('useMobile with the person’s choice', () => {
  it('follows the width until the person chooses; the phone layout on a wide window is a phone-wide column', () => {
    const { result } = renderHook(() => ({ mobile: useMobile(), column: usePhoneColumn() }))
    // jsdom's window is wide (matchMedia double: no match).
    expect(result.current).toEqual({ mobile: false, column: false })
    act(() => setMobileOverride(true))
    expect(result.current).toEqual({ mobile: true, column: true })
    expect(isMobileNow()).toBe(true)
    act(() => setMobileOverride(null))
    expect(result.current).toEqual({ mobile: false, column: false })
  })
})

describe('useFullscreen', () => {
  it('asks the browser for the whole page in full screen where it offers it, and follows its exit', async () => {
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true })
    let element: Element | null = null
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => element })
    const request = vi.fn(async function (this: Element) {
      element = this
      document.dispatchEvent(new Event('fullscreenchange'))
    })
    document.documentElement.requestFullscreen = request
    document.exitFullscreen = vi.fn(async () => {
      element = null
      document.dispatchEvent(new Event('fullscreenchange'))
    })
    const { result } = renderHook(() => useFullscreen())
    await act(async () => result.current.toggle())
    expect(request).toHaveBeenCalledOnce()
    expect(request.mock.contexts[0]).toBe(document.documentElement)
    expect(result.current).toMatchObject({ on: true, expanded: false })
    await act(async () => result.current.toggle())
    expect(result.current.on).toBe(false)
  })

  it('a second press while the browser has not answered asks nothing; a late refusal never leaves both views on (PT-9262 item 5)', async () => {
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true })
    let element: Element | null = null
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => element })
    let grant: () => void = () => undefined
    const request = vi.fn(function (this: Element) {
      const el = this
      return new Promise<void>(resolve => {
        grant = () => {
          element = el
          document.dispatchEvent(new Event('fullscreenchange'))
          resolve()
        }
      })
    })
    document.documentElement.requestFullscreen = request
    const { result } = renderHook(() => useFullscreen())
    act(() => result.current.toggle())
    act(() => result.current.toggle())
    expect(request).toHaveBeenCalledOnce()
    await act(async () => grant())
    expect(result.current).toMatchObject({ on: true, expanded: false })
  })

  it('a refused exit is recorded and on follows what the browser shows (PT-9262 item 4)', async () => {
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true })
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => document.documentElement })
    document.exitFullscreen = vi.fn(async () => {
      throw new TypeError('Document not active')
    })
    const before = probe.errors.length
    const { result } = renderHook(() => useFullscreen())
    await act(async () => result.current.toggle())
    expect(probe.errors.slice(before)).toEqual(['exitFullscreen: Document not active'])
    expect(result.current.on).toBe(true)
  })

  it('where the browser has none (iPhone Safari), the page’s own expanded view, left by the button or Escape', () => {
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: false })
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => null })
    const { result } = renderHook(() => useFullscreen())
    act(() => result.current.toggle())
    expect(result.current).toMatchObject({ on: true, expanded: true })
    act(() => result.current.toggle())
    expect(result.current.on).toBe(false)
    act(() => result.current.toggle())
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(result.current.on).toBe(false)
  })
})

describe('NoticeBanner', () => {
  it('says what the app is, closes with ×, and hands the focus on', async () => {
    const user = userEvent.setup()
    const afterClose = vi.fn()
    render(<NoticeBanner afterClose={afterClose} />)
    const note = screen.getByRole('complementary', { name: 'htmlExport:sa_notice_label' })
    expect(note).toHaveTextContent('htmlExport:sa_notice_text')
    expect(note).toHaveTextContent('AgroDesign Studios')
    await user.click(screen.getByRole('button', { name: 'htmlExport:sa_notice_close' }))
    expect(screen.queryByRole('complementary')).toBeNull()
    expect(afterClose).toHaveBeenCalledOnce()
    // Closed for this visit only: a new page shows it again.
    render(<NoticeBanner />)
    expect(screen.getByRole('complementary')).toBeInTheDocument()
  })

  it('「次から表示しない」 keeps it closed in this browser', async () => {
    const user = userEvent.setup()
    render(<NoticeBanner />)
    await user.click(screen.getByRole('button', { name: 'htmlExport:sa_notice_hide' }))
    expect(window.localStorage.getItem(NOTICE_HIDDEN_KEY)).toBe('1')
    cleanup()
    render(<NoticeBanner />)
    expect(screen.queryByRole('complementary')).toBeNull()
  })

  it('shows, and closes, where the browser keeps nothing (storage refused)', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    const user = userEvent.setup()
    render(<NoticeBanner />)
    await user.click(screen.getByRole('button', { name: 'htmlExport:sa_notice_hide' }))
    expect(screen.queryByRole('complementary')).toBeNull()
  })
})
