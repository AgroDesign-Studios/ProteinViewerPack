import { useCallback, useEffect, useRef, useState } from 'react'

import { anyDialogOpen } from '../../src/components/modalStack'
import { probe } from './probe'

/**
 * 「全画面」 (owner 2026-11-15): the whole page, not the viewer alone — the
 * dialogs render inside the page (`Modal` has no portal), so a viewer in
 * full screen would hide them (both UI consultants). Through the browser's
 * Fullscreen API on `document.documentElement` where it is offered; where it
 * is not (iPhone Safari) the page's own 「拡大表示」: the header and footer
 * hidden and the viewer as tall as the window, left by the same button
 * (Opus's answer: the button is never disabled — a press always does
 * something). `on` follows the browser's own exit too (Esc, a swipe).
 */
export interface Fullscreen {
  /** Full screen (the browser's) or the page's expanded view is on. */
  on: boolean
  /** The browser's full screen is not offered: `on` is the page's expanded view. */
  expanded: boolean
  toggle: () => void
}

const nativeOffered = (): boolean => typeof document !== 'undefined' && document.fullscreenEnabled === true && typeof document.documentElement.requestFullscreen === 'function'

export function useFullscreen(): Fullscreen {
  const [native, setNative] = useState(() => typeof document !== 'undefined' && document.fullscreenElement != null)
  const [expanded, setExpanded] = useState(false)
  /** A request to the browser is pending: a second press waits for its answer (PT-9262 item 5). */
  const pending = useRef(false)

  useEffect(() => {
    const sync = () => {
      const on = document.fullscreenElement != null
      setNative(on)
      // The browser's full screen and the page's expanded view are never on
      // together: whichever request answered late, native wins.
      if (on) setExpanded(false)
    }
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [])

  // Esc leaves the page's expanded view, as it leaves the browser's full
  // screen — unless a dialog is open, whose own Escape comes first.
  useEffect(() => {
    if (!expanded) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || anyDialogOpen()) return
      setExpanded(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [expanded])

  const toggle = useCallback(() => {
    if (pending.current) return
    if (document.fullscreenElement != null) {
      pending.current = true
      document
        .exitFullscreen()
        .catch((e: unknown) => {
          // Refused (the document is not active, the element is another
          // document's): said in the page's error record, and `on` follows
          // what the browser now shows (PT-9262 item 4).
          probe.errors.push(`exitFullscreen: ${String(e instanceof Error ? e.message : e).slice(0, 200)}`)
          setNative(document.fullscreenElement != null)
        })
        .finally(() => {
          pending.current = false
        })
      return
    }
    if (expanded) {
      setExpanded(false)
      return
    }
    if (!nativeOffered()) {
      setExpanded(true)
      return
    }
    // A refusal (a sandboxed frame without allow-fullscreen, a browser
    // setting) falls back to the page's own expanded view.
    pending.current = true
    document.documentElement
      .requestFullscreen()
      .catch(() => {
        if (document.fullscreenElement == null) setExpanded(true)
      })
      .finally(() => {
        pending.current = false
      })
  }, [expanded])

  return { on: native || expanded, expanded, toggle }
}
