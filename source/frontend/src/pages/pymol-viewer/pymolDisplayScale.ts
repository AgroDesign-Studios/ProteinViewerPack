import { useEffect, useRef, useState } from 'react'

/**
 * PyMOL's `display_scale_factor` on this page.
 *
 * The canvas backing store is CSS px x devicePixelRatio, and PyMOL draws its
 * text and panels in backing pixels times an INTEGER scale. Desktop PyMOL uses
 * int(DPR), which on a Windows laptop at 125 % / 150 % leaves text at 80 % /
 * 67 % of its size. The frame's worker takes the nearest integer instead, at
 * boot (`displayScale` in `worker.js`; `pymolDisplayScale.test.ts` holds the
 * two equal): 125 % -> 1 (80 %), 150 % -> 2 (133 %). A user who prefers the
 * other side of that choice pins 1, 2 or 3 in the settings dialog, kept per
 * browser — the right value depends on the screen, not on the account.
 */

export type ScaleChoice = 'auto' | 1 | 2 | 3

export const SCALE_CHOICES: readonly ScaleChoice[] = Object.freeze(['auto', 1, 2, 3] as const)

const STORAGE_KEY = 'agdb_pymol_display_scale'

/** The worker's rule: the nearest integer, never below 1. */
export function autoDisplayScale(dpr: number): number {
  return Math.max(1, Math.round(Number.isFinite(dpr) && dpr > 0 ? dpr : 1))
}

export function readScaleChoice(): ScaleChoice {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY)
    if (v === '1' || v === '2' || v === '3') return Number(v) as 1 | 2 | 3
  } catch {
    // Private mode or blocked storage: the automatic rule.
  }
  return 'auto'
}

export function writeScaleChoice(choice: ScaleChoice): void {
  try {
    if (choice === 'auto') window.localStorage.removeItem(STORAGE_KEY)
    else window.localStorage.setItem(STORAGE_KEY, String(choice))
  } catch {
    // Not kept past this page; the choice still applies now.
  }
}

/** The PyMOL command that applies `choice` on a screen of `dpr`. */
export function scaleCommand(choice: ScaleChoice, dpr: number): string {
  return `set display_scale_factor, ${choice === 'auto' ? autoDisplayScale(dpr) : choice}`
}

/** The window's devicePixelRatio, re-read when it changes (zoom, another monitor). */
function useDevicePixelRatio(): number {
  const [dpr, setDpr] = useState(() => window.devicePixelRatio || 1)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia(`(resolution: ${dpr}dppx)`)
    const onChange = () => setDpr(window.devicePixelRatio || 1)
    mq.addEventListener?.('change', onChange)
    return () => mq.removeEventListener?.('change', onChange)
  }, [dpr])
  return dpr
}

/**
 * Keeps the user's choice applied, this hook being the only writer once
 * the frame has booted: when the choice changes, after every rebuild (a
 * snapshot carries the value it was taken with — a pin the user has since
 * taken back included), and after a DPR change. The worker sets its own rule
 * at boot and no longer follows the DPR by itself: doing so raced the re-send
 * of a pinned value, and either could be the value left (PT-3291 item 14).
 * Only the first ready, still automatic at the DPR the page opened with,
 * sends nothing — the worker's boot set exactly that.
 *
 * Every send is the page's (`runCommand`'s `page`), the one after the
 * user's own change in the settings dialog too: the choice is this
 * browser's preference and is applied again after any rebuild, so Stop never
 * takes it back, and the busy bar must not say Stop stops it (PT-3291
 * item 22; the re-sends were made the page's in PT-4062 item 1).
 */
export function useDisplayScale(opts: {
  ready: boolean
  /** Changes on every rebuild. */
  generation: number
  run: (cmd: string, opts: { page: boolean }) => Promise<void>
}): [ScaleChoice, (c: ScaleChoice) => void] {
  const { ready, generation, run } = opts
  const [choice, setChoiceState] = useState<ScaleChoice>(readScaleChoice)
  const dpr = useDevicePixelRatio()
  const openedAt = useRef(dpr)
  const seenReady = useRef(false)
  const runRef = useRef(run)
  useEffect(() => {
    runRef.current = run
  })

  useEffect(() => {
    if (!ready) return
    const first = !seenReady.current
    seenReady.current = true
    if (first && generation === 0 && choice === 'auto' && dpr === openedAt.current) return
    runRef.current(scaleCommand(choice, dpr), { page: true }).catch(() => {
      // A rebuild or a cancel swallowed it; the next ready sends it again.
    })
  }, [ready, generation, choice, dpr])

  const setChoice = (c: ScaleChoice) => {
    writeScaleChoice(c)
    setChoiceState(c)
  }
  return [choice, setChoice]
}
