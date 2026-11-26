import { useEffect, useLayoutEffect, useRef, useState, type HTMLAttributes, type ReactNode } from 'react'

/** The gap the 「詳細」 panel keeps from the header's (and the screen's) edges. */
export const HEAD_POP_GUTTER_PX = 12

/**
 * How far to move a panel sideways so it stays within `[lo, hi]`: left when it
 * runs past `hi`, right when it starts before `lo` (the left edge wins when
 * it is wider than the room, its CSS max-width keeps that from happening).
 */
export function popShift(left: number, right: number, lo: number, hi: number): number {
  let shift = right > hi ? hi - right : 0
  if (left + shift < lo) shift = lo - left
  return Math.round(shift)
}

/**
 * The header's 「詳細」 (owner 2026-11-15: the header on one line), and its
 * 「画像出力」 (owner 2026-11-16): a native disclosure whose contents open as
 * a small panel under it, over the page, so the header keeps its rows — no
 * ARIA menu, the summary the one control that opens and closes it. Escape,
 * or a press outside it, closes it; Escape gives the focus back to the
 * summary, and so does `close` (handed to `children` as a function), which a
 * button inside calls before it acts: its panel is gone, and a dialog it
 * opens gives the focus back there. Opened, the panel is moved sideways as
 * far as it takes to stay inside the header and the screen,
 * `HEAD_POP_GUTTER_PX` from either edge: a phone's short structure name, or a
 * mid-width window's long one, no longer puts it off the screen (PT-9400
 * item 2). It is measured again when the window is resized.
 *
 * `summaryProps` go on the summary: a name for one that shows only an icon,
 * or the reason it cannot open now with a click that says it (its handler
 * calls `preventDefault`, and the panel stays shut).
 */
export function HeadDetails(props: {
  summary: ReactNode
  summaryProps?: Omit<HTMLAttributes<HTMLElement>, 'children'>
  /** Another class beside `sav-details`. */
  className?: string
  /** Told when the panel opens or closes. */
  onOpenChange?: (open: boolean) => void
  children: ReactNode | ((close: () => void) => ReactNode)
}) {
  const { summary, summaryProps, className, onOpenChange, children } = props
  const ref = useRef<HTMLDetailsElement | null>(null)
  const popRef = useRef<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)
  useLayoutEffect(() => {
    const pop = popRef.current
    if (!open || pop === null) return
    const place = () => {
      // Measured where its CSS puts it, then moved by what it overruns.
      pop.style.removeProperty('--sav-pop-shift')
      const r = pop.getBoundingClientRect()
      const head = pop.closest('header')?.getBoundingClientRect()
      const screenW = document.documentElement.clientWidth || window.innerWidth
      const lo = Math.max(head?.left ?? 0, 0) + HEAD_POP_GUTTER_PX
      const hi = Math.min(head?.right ?? screenW, screenW) - HEAD_POP_GUTTER_PX
      const shift = popShift(r.left, r.right, lo, hi)
      if (shift !== 0) pop.style.setProperty('--sav-pop-shift', `${shift}px`)
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open])
  /** Shuts the panel and gives the focus back to the summary. */
  const closeAndFocus = () => {
    if (ref.current !== null) ref.current.open = false
    ref.current?.querySelector('summary')?.focus()
  }
  useEffect(() => {
    if (!open) return
    const close = () => {
      if (ref.current !== null) ref.current.open = false
    }
    const outside = (e: PointerEvent) => {
      if (e.target instanceof Node && ref.current?.contains(e.target)) return
      close()
    }
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      closeAndFocus()
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', key)
    }
  }, [open])
  return (
    <details
      ref={ref}
      className={`sav-details${className !== undefined ? ` ${className}` : ''}`}
      onToggle={e => {
        const now = e.currentTarget.open
        setOpen(now)
        onOpenChange?.(now)
      }}
    >
      <summary {...summaryProps}>{summary}</summary>
      <div ref={popRef} className="sav-details-pop">
        {typeof children === 'function' ? children(closeAndFocus) : children}
      </div>
    </details>
  )
}
