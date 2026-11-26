/**
 * 「オリジナル表示」 (owner 2026-11-20: 「本アプリ1.0.0のころと同じオブジェクト表示も
 * 選べるように」; both layouts, the owner's choice of the recommended scope):
 * "Includes PyMOL™" mode's object panel as v1.0.0 had it. On a computer the
 * mouse box under the panel keeps PyMOL's grid of buttons (the start setting
 * since v1.0.4 hides it); on a phone PyMOL's own panel, pulled in and out by
 * the tab at the view's right edge, instead of the page's object list. Kept
 * in this browser's localStorage, as 「3Dmol.js オリジナルの操作を使う」 is
 * (`touchControls.ts`), never in a saved copy.
 */
import { useSyncExternalStore } from 'react'

export const ORIGINAL_PANEL_KEY = 'agdb-pvp-pymol-original-panel'

let original: boolean | null = null
let saved = true
const listeners = new Set<() => void>()

function read(): boolean {
  if (original !== null) return original
  try {
    original = window.localStorage.getItem(ORIGINAL_PANEL_KEY) === '1'
  } catch {
    original = false
  }
  return original
}

/** Turns 「オリジナル表示」 on or off, for this visit and, where storage allows, the next. */
export function setOriginalPanel(next: boolean): void {
  original = next
  try {
    if (next) window.localStorage.setItem(ORIGINAL_PANEL_KEY, '1')
    else window.localStorage.removeItem(ORIGINAL_PANEL_KEY)
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

/** The choice, for a component: it re-renders when any switch changes it. */
export function useOriginalPanel(): { original: boolean; saved: boolean } {
  const value = useSyncExternalStore(subscribe, () => read())
  const ok = useSyncExternalStore(subscribe, () => saved)
  return { original: value, saved: ok }
}

/** For tests: forget the choice read. */
export function resetOriginalPanelForTests(): void {
  original = null
  saved = true
  listeners.clear()
}
