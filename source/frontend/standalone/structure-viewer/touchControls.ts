/**
 * The Light viewer's (3Dmol.js) touch controls, a choice of this browser
 * (owner 2026-11-17): two fingers dragged together move the view — the
 * default, as in the Heavy viewer and most phone 3D viewers
 * (`twoFingerPan.ts`) — or 3Dmol.js's own controls, where two fingers only
 * zoom and three move (「元の作者の意向は尊重したい…オリジナル3Dmol.jsタイプの
 * 操作に切り替えられるように設定に」).
 *
 * Kept in localStorage, per browser, never in a saved copy of the app (a
 * person's habit, not the file's: UI consult, Opus + Codex astra). A store
 * of its own, not a pane's state: the 3Dmol.js pane is made again for each
 * opened file, and the phone's 「表示」 sheet and HELP both show the switch.
 * Storage that cannot be read gives the default; one that cannot be written
 * keeps the choice for this visit and says so (`saved`).
 */
import { useSyncExternalStore } from 'react'

export const TOUCH_ORIGINAL_KEY = 'agdb-pvp-touch-3dmol-original'

let original: boolean | null = null
let saved = true
const listeners = new Set<() => void>()

function read(): boolean {
  if (original !== null) return original
  try {
    original = window.localStorage.getItem(TOUCH_ORIGINAL_KEY) === '1'
  } catch {
    original = false
  }
  return original
}

/** Whether the Light viewer uses 3Dmol.js's own touch controls (false: two fingers move). */
export function touchOriginal(): boolean {
  return read()
}

/** Whether the last choice could be kept for later visits. */
export function touchChoiceSaved(): boolean {
  return saved
}

export function setTouchOriginal(next: boolean): void {
  original = next
  try {
    if (next) window.localStorage.setItem(TOUCH_ORIGINAL_KEY, '1')
    else window.localStorage.removeItem(TOUCH_ORIGINAL_KEY)
    saved = true
  } catch {
    // A private window or blocked storage: this visit keeps it.
    saved = false
  }
  for (const l of listeners) l()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The choice, for a component: it re-renders when either switch changes it. */
export function useTouchOriginal(): { original: boolean; saved: boolean } {
  const value = useSyncExternalStore(subscribe, () => read())
  const ok = useSyncExternalStore(subscribe, () => saved)
  return { original: value, saved: ok }
}

/** For tests: forget the choice read. */
export function resetTouchControlsForTests(): void {
  original = null
  saved = true
  listeners.clear()
}
