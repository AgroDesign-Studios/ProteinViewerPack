/**
 * DialogBars — the coloured title bar, scrolling body and button row of a
 * `flush` `Modal` (PT-6578 item 10), in one place so every `flush` dialog
 * takes them from here instead of drawing them by hand.
 *
 * Inside a `flush` `Modal`, which lays its children out as a column, the
 * title bar and the button row keep their height and the body alone scrolls
 * (PT-6578 item 7): on a short viewport — 200% zoom on a 1080p display — the
 * header stays in view and there is one scrollbar, not the dialog's and the
 * body's nested.
 */
import type { CSSProperties, ReactNode } from 'react'

interface DialogTitleBarProps {
  /** The title element, carrying the id the `Modal`'s `labelledBy` names —
   *  written by the caller, so the id sits inside the `<Modal>`. */
  title: ReactNode
  /** Bar colour; the text on it is white. */
  background: string
  /** Shown before the title (decorative; give it `aria-hidden`). */
  icon?: ReactNode
  /** The × button calls this; no × without it. */
  onClose?: () => void
  closeDisabled?: boolean
  /** Accessible name of the × — the glyph alone reads as "times". */
  closeLabel: string
}

export function DialogTitleBar({ title, background, icon, onClose, closeDisabled = false, closeLabel }: DialogTitleBarProps) {
  return (
    <div style={{ background, color: 'white', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
      {icon}
      <div style={{ fontWeight: 700, fontSize: 16, flex: 1 }}>{title}</div>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          disabled={closeDisabled}
          aria-label={closeLabel}
          title={closeLabel}
          style={{ background: 'none', border: 'none', color: 'white', cursor: closeDisabled ? 'not-allowed' : 'pointer', fontSize: 20, lineHeight: 1, padding: 0 }}
        >
          ×
        </button>
      )}
    </div>
  )
}

/** The part between the bars; the one that scrolls when the dialog is too tall. */
export function DialogBody({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ padding: '16px 20px', flex: '1 1 auto', minHeight: 0, overflowY: 'auto', ...style }}>
      {children}
    </div>
  )
}

/** The right-aligned button row under a rule. */
export function DialogFooterBar({ children }: { children: ReactNode }) {
  return (
    <div style={{ padding: '12px 20px 16px', display: 'flex', justifyContent: 'flex-end', gap: 8, borderTop: '1px solid #EDF2F7', flexShrink: 0 }}>
      {children}
    </div>
  )
}
