import { useEffect, useRef, type ReactNode } from 'react'

/**
 * One drop-down of the one-row 3Dmol.js toolbar (`Mol3dToolbar` variant
 * `bar`; owner 2026-11-19: the menu above the view should leave the view as
 * much room as it can): a button naming a group of controls — with what it
 * is set to when that says something — and, under it, a panel laid over the
 * view, so opening or closing it never changes the view's size.
 *
 * A disclosure, not a menu: the panel holds checkboxes, chips and sliders,
 * which keep their own roles (`aria-expanded`, `aria-controls`). It closes
 * on Escape (the focus back on its button), on a press outside it, and when
 * the keyboard's focus leaves it. One open at a time is the toolbar's to
 * decide (`open`, `onOpen`).
 */
export default function ToolbarPopover(props: {
  /** The panel's id (the button's `aria-controls`). */
  id: string
  label: ReactNode
  /** What the group is set to, after the label (e.g. "Ribbon +1"); none when it says nothing. */
  summary?: string
  open: boolean
  onOpen: (open: boolean) => void
  children: ReactNode
}) {
  const { id, label, summary, open, onOpen, children } = props
  const rootRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const onOpenRef = useRef(onOpen)
  onOpenRef.current = onOpen
  // A press anywhere else closes it (the capture phase: the view's canvas stops its own events).
  useEffect(() => {
    if (!open) return
    const down = (e: PointerEvent) => {
      if (rootRef.current !== null && !rootRef.current.contains(e.target as Node)) onOpenRef.current(false)
    }
    document.addEventListener('pointerdown', down, true)
    return () => document.removeEventListener('pointerdown', down, true)
  }, [open])
  return (
    <div
      ref={rootRef}
      className={`sv3d-pop${open ? ' is-open' : ''}`}
      onKeyDown={e => {
        if (e.key !== 'Escape' || !open) return
        e.stopPropagation()
        onOpen(false)
        buttonRef.current?.focus()
      }}
      onBlur={e => {
        // Only the keyboard leaving it: a press outside is the listener above's,
        // and a press on the panel's own padding moves the focus nowhere (null).
        const next = e.relatedTarget as Node | null
        if (open && next !== null && rootRef.current !== null && !rootRef.current.contains(next)) onOpen(false)
      }}
    >
      <button ref={buttonRef} type="button" className="sv3d-pop-btn" aria-expanded={open} aria-controls={id} onClick={() => onOpen(!open)}>
        <span className="sv3d-pop-label">{label}</span>
        {summary !== undefined && summary !== '' && <span className="sv3d-pop-summary">{summary}</span>}
        <span className="sv3d-pop-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      <div id={id} className="sv3d-pop-panel" hidden={!open}>
        {children}
      </div>
    </div>
  )
}
