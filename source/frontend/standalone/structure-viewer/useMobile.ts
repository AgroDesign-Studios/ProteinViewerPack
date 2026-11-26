import { useSyncExternalStore } from 'react'

/**
 * The offline file's phone mode (owner 2026-11-14): at DESIGN.md §2.6's
 * narrow breakpoint and below the page lays itself out for a phone held
 * upright — a fixed bar of actions at the bottom, the viewers' controls in a
 * sheet, the viewer as tall as the screen allows (`MobileBar.tsx`,
 * standalone.css `.sav--mobile`). A phone on its side (844 px) and a tablet
 * are wider and keep the desktop layout.
 *
 * The person can say otherwise (owner 2026-11-15): 「スマホ表示」 on a computer
 * shows the phone layout — that the app is made for phones, and a way out
 * when the width guessed wrong — and 「PC表示」 in the phone's 表示 sheet the
 * desktop one. The choice is kept for this visit only (a reload follows the
 * width again): one toggle, no "automatic" setting to explain (the UI
 * consult's Opus answer).
 */
export const MOBILE_QUERY = '(max-width: 640px)'

/** The one MediaQueryList: React reads the snapshot on every render (PT-9194 item 7). */
let cached: MediaQueryList | null | undefined

function query(): MediaQueryList | null {
  if (cached === undefined) cached = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(MOBILE_QUERY) : null
  return cached
}

/** The person's choice, or null: the width decides. */
let override: boolean | null = null
const listeners = new Set<() => void>()

/** Is the window phone-narrow now (by its width alone)? */
export function isNarrowNow(): boolean {
  return query()?.matches ?? false
}

/** Is the page in the phone layout now: the person's choice, else the width? */
export function isMobileNow(): boolean {
  return override ?? isNarrowNow()
}

/**
 * Sets the layout the person chose (`true` the phone's, `false` the
 * desktop's), or null to follow the width again.
 */
export function setMobileOverride(next: boolean | null): void {
  if (override === next) return
  override = next
  for (const fn of listeners) fn()
}

/** The phone layout chosen on a window wider than a phone: drawn as a phone-wide column. */
export function isPhoneColumn(): boolean {
  return override === true && !isNarrowNow()
}

function subscribe(onChange: () => void): () => void {
  const q = query()
  listeners.add(onChange)
  q?.addEventListener('change', onChange)
  return () => {
    listeners.delete(onChange)
    q?.removeEventListener('change', onChange)
  }
}

/** The phone layout, following the window as it turns or resizes and the person's choice. */
export function useMobile(): boolean {
  return useSyncExternalStore(subscribe, isMobileNow, () => false)
}

/** The phone layout chosen on a window wider than a phone (`isPhoneColumn`). */
export function usePhoneColumn(): boolean {
  return useSyncExternalStore(subscribe, isPhoneColumn, () => false)
}
