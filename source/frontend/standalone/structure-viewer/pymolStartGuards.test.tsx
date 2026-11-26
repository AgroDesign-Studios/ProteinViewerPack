/**
 * What the full edition's page says when PyMOL cannot run on this device
 * (the iPhone, 2026-11-15): a page that closed while PyMOL was starting says
 * so and opens on 3Dmol.js; a phone whose worker gets no WebGL cannot choose
 * PyMOL and is told why; and that failure is worded by the page, not left in
 * PyMOL's English. jsdom has no WebGL: the probes are scripted here.
 */
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key} ${JSON.stringify(vars)}` : key),
    i18n: { language: 'en', t: (key: string) => key, changeLanguage: async () => undefined },
  }),
}))
vi.mock('./noGl', async importOriginal => ({
  ...(await importOriginal<typeof import('./noGl')>()),
  pymolBlocker: vi.fn(() => null),
  workerGlAvailable: vi.fn(async () => false),
}))

import { resetModalStackForTests } from '../../src/components/modalStack'
import type { PageConfig } from './blocks'
import { workerGlAvailable } from './noGl'
import { CRASH_MARK_RENEW_MS } from './pymolCrashMark'
import { failureReason, NO_WORKER_GL } from './pymolBridge'
import { pymolFailureMessage, StandaloneApp } from './StandaloneApp'
import { setMobileOverride } from './useMobile'

const FULL: PageConfig = {
  edition: 'full',
  structureId: 0,
  title: '',
  code: null,
  exporterName: null,
  lang: 'en',
  initialEngine: 'pymol',
  bColumn: 'bfactor',
  exportedAt: '2026-11-15T00:00:00Z',
  timeZone: null,
  pymolView: null,
  skipped: [],
  runtime: { base: 'https://agdb-standalone.invalid/pymol/x/', handed: [] },
}

function app(pymolCrashed: boolean, cif: string | null = null, config: PageConfig = FULL) {
  return render(
    <StandaloneApp config={config} cif={cif} mol3d={null} pymolLook={null} pymolLookBytes={null} lookRefused={false} logo={null} bundledLicences={[]} pymolCrashed={pymolCrashed} />,
  )
}

const engineButton = () => screen.getByRole('button', { name: /htmlExport:sa_m_engine_aria/ })
/** The Retry buttons drawn, hidden behind a dialog or not. */
const retries = () => [...document.querySelectorAll('button')].filter(b => b.textContent === 'htmlExport:sa_retry')
const mark = () => window.sessionStorage.getItem('agdb-pvp-pymol-starting')
const radio = (value: string) => document.querySelector<HTMLInputElement>(`.sav-head input[type="radio"][value="${value}"]`)!

beforeEach(() => {
  // No WebGL (jsdom has no canvas): PyMOL never starts here.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})
afterEach(() => {
  cleanup()
  window.sessionStorage.clear()
  resetModalStackForTests()
  vi.restoreAllMocks()
  act(() => setMobileOverride(null))
})

describe('a page that closed while PyMOL was starting', () => {
  it('says why and opens on 3Dmol.js, though the file opens on PyMOL', async () => {
    app(true)
    // The alert region is drawn empty first, and said into a frame later (PT-9308 item 7).
    expect(document.querySelector('.sav-open-message.is-error')!.textContent).toBe('')
    await waitFor(() => expect(document.querySelector('.sav-open-message.is-error')).toHaveTextContent('htmlExport:sa_pymol_crashed'))
    expect(radio('3dmol').checked).toBe(true)
    expect(radio('pymol').checked).toBe(false)
  })

  it('takes the alert away once PyMOL is chosen again and starts (PT-9307 item 1)', async () => {
    // The probe never answers: PyMOL stays starting.
    vi.mocked(workerGlAvailable).mockReturnValueOnce(new Promise(() => undefined))
    const user = userEvent.setup()
    app(true, 'data_x\n')
    await waitFor(() => expect(document.querySelector('.sav-open-message.is-error')).toHaveTextContent('htmlExport:sa_pymol_crashed'))
    await user.click(radio('pymol'))
    await waitFor(() => expect(document.querySelector('.sav-open-message.is-error')!.textContent).toBe(''))
  })

  it('without the mark, opens on the file’s engine and says nothing', () => {
    app(false)
    expect(document.querySelector('.sav-open-message.is-error')!.textContent).toBe('')
    expect(radio('pymol').checked).toBe(true)
  })
})

describe('a phone whose worker gets no WebGL', () => {
  it('cannot choose PyMOL, and the engine choice says why', async () => {
    act(() => setMobileOverride(true))
    const user = userEvent.setup()
    app(false)
    await user.click(screen.getByRole('button', { name: /htmlExport:sa_m_engine_aria/ }))
    const dialog = screen.getByRole('dialog')
    await waitFor(() => expect(dialog.querySelector('input[value="pymol"]')).toBeDisabled())
    expect(dialog.querySelector('input[value="pymol"]')).toHaveAccessibleDescription('htmlExport:sa_m_engine_no_worker_gl')
  })
})

describe('choosing PyMOL where a worker gets no WebGL (a computer)', () => {
  it('fails at once in the page’s words, with the structure in 3Dmol.js; the crash mark is set while it starts and cleared after', async () => {
    const set = vi.spyOn(Storage.prototype, 'setItem')
    const user = userEvent.setup()
    render(
      <StandaloneApp
        config={{ ...FULL, initialEngine: '3dmol' }}
        cif={'data_x\n'}
        mol3d={null}
        pymolLook={null}
        pymolLookBytes={null}
        lookRefused={false}
        logo={null}
        bundledLicences={[]}
      />,
    )
    await user.click(radio('pymol'))
    await waitFor(() =>
      expect(document.querySelector('.sav-status')).toHaveTextContent('htmlExport:sa_status_pymol_failed {"reason":"htmlExport:sa_pymol_reason_no_worker_gl"}'),
    )
    expect(set).toHaveBeenCalledWith('agdb-pvp-pymol-starting', expect.stringContaining('"at":'))
    expect(window.sessionStorage.getItem('agdb-pvp-pymol-starting')).toBeNull()
    expect(radio('3dmol').checked).toBe(true)
  })
})

describe('the failure’s words', () => {
  it('no WebGL in a worker is said in the page’s words; any other failure as PyMOL gave it', () => {
    const t = (key: string) => `T(${key})`
    const noGl = { failure: NO_WORKER_GL, failureCode: 'no-worker-gl' } as const
    expect(failureReason(noGl, t)).toBe('T(htmlExport:sa_pymol_reason_no_worker_gl)')
    expect(failureReason({ failure: 'init: NetworkError: Load failed', failureCode: null }, t)).toBe('init: NetworkError: Load failed')
    expect(failureReason({ failure: null }, t)).toBe('')
    // Read from the code, never from the text (PT-9308 item 5).
    expect(failureReason({ failure: NO_WORKER_GL, failureCode: null }, t)).toBe(NO_WORKER_GL)
    expect(failureReason({ failure: 'trimmed', failureCode: 'no-worker-gl' }, t)).toBe('T(htmlExport:sa_pymol_reason_no_worker_gl)')
    expect(pymolFailureMessage({ mobile: true, ranBefore: false, pse: false, failure: failureReason(noGl, t) })).toEqual({
      key: 'htmlExport:sa_m_engine_failed',
      vars: { reason: 'T(htmlExport:sa_pymol_reason_no_worker_gl)' },
      error: true,
    })
  })
})

describe('the phone’s worker-WebGL probe (PT-9308 item 3, PT-9309 item 2, PT-9307 item 2)', () => {
  it('runs when the engine choice opens, not at load; a false is asked again at the next opening', async () => {
    vi.mocked(workerGlAvailable).mockClear()
    act(() => setMobileOverride(true))
    const user = userEvent.setup()
    app(false, 'data_x\n')
    await act(async () => {
      await Promise.resolve()
    })
    expect(workerGlAvailable).not.toHaveBeenCalled()
    await user.click(engineButton())
    await waitFor(() => expect(screen.getByRole('dialog').querySelector('input[value="pymol"]')).toBeDisabled())
    expect(workerGlAvailable).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'pymol:dialog_close' }))
    vi.mocked(workerGlAvailable).mockResolvedValueOnce(true)
    await user.click(engineButton())
    await waitFor(() => expect(screen.getByRole('dialog').querySelector('input[value="pymol"]')).toBeEnabled())
    expect(workerGlAvailable).toHaveBeenCalledTimes(2)
  })
})

describe('Retry, shown only where it can act (PT-9313 item 1)', () => {
  it('asks again on a computer; hidden in the status line and the engine choice while a blocker stands', async () => {
    vi.mocked(workerGlAvailable).mockClear()
    const user = userEvent.setup()
    app(false, 'data_x\n', { ...FULL, initialEngine: '3dmol' })
    await user.click(radio('pymol'))
    await waitFor(() => expect(retries()).toHaveLength(1))
    // A press probes again (the false is not kept, PT-9308 item 1).
    await user.click(retries()[0])
    await waitFor(() => expect(workerGlAvailable).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(retries()).toHaveLength(1))
    // The phone layout: its engine choice finds no WebGL in a worker, and no Retry is offered anywhere.
    act(() => setMobileOverride(true))
    await user.click(engineButton())
    await waitFor(() => expect(screen.getByRole('dialog').querySelector('input[value="pymol"]')).toBeDisabled())
    expect(screen.getByRole('dialog')).toHaveTextContent('htmlExport:sa_m_engine_failed')
    expect(retries()).toHaveLength(0)
  })
})

describe('the crash mark around the page’s life (PT-9308 item 4, PT-9309 items 1, 5)', () => {
  it('is cleared when the page is left or hidden, set again when it is back while PyMOL still starts, and cleared at unmount', async () => {
    // The probe never answers: PyMOL stays starting.
    vi.mocked(workerGlAvailable).mockReturnValueOnce(new Promise(() => undefined))
    const user = userEvent.setup()
    const { unmount } = app(false, 'data_x\n', { ...FULL, initialEngine: '3dmol' })
    await user.click(radio('pymol'))
    expect(mark()).not.toBeNull()
    act(() => {
      window.dispatchEvent(new Event('pagehide'))
    })
    expect(mark()).toBeNull()
    act(() => {
      window.dispatchEvent(new Event('pageshow'))
    })
    expect(mark()).not.toBeNull()
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(mark()).toBeNull()
    visibility.mockReturnValue('visible')
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(mark()).not.toBeNull()
    unmount()
    expect(mark()).toBeNull()
  })

  it('a page left while PyMOL is not starting is not marked back by pageshow', async () => {
    const { unmount } = app(false, 'data_x\n', { ...FULL, initialEngine: '3dmol' })
    act(() => {
      window.dispatchEvent(new Event('pageshow'))
    })
    expect(mark()).toBeNull()
    unmount()
  })

  it('renews its time while PyMOL starts, so the next page can tell a crash a moment ago from an old mark', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    try {
      let now = 1_000_000
      vi.spyOn(Date, 'now').mockImplementation(() => now)
      vi.mocked(workerGlAvailable).mockReturnValueOnce(new Promise(() => undefined))
      const user = userEvent.setup()
      app(false, 'data_x\n', { ...FULL, initialEngine: '3dmol' })
      await user.click(radio('pymol'))
      expect(JSON.parse(mark()!)).toMatchObject({ at: 1_000_000 })
      now += CRASH_MARK_RENEW_MS
      act(() => {
        vi.advanceTimersByTime(CRASH_MARK_RENEW_MS)
      })
      expect(JSON.parse(mark()!)).toMatchObject({ at: 1_000_000 + CRASH_MARK_RENEW_MS })
    } finally {
      vi.useRealTimers()
    }
  })
})
