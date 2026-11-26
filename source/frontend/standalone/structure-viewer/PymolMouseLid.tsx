import { useEffect, useRef } from 'react'

/** The tab's height (CSS px, its min-height in standalone.css). */
export const LID_TAB_H = 24

/**
 * The lid over PyMOL's mouse box (owner 2026-11-21: 「MouseMode表示…スマホ版で
 * は意味がないので完全に消す。PC版では、デフォルトでは決して、Mouse Modeの文字の
 * 上のタグを押すと上にスライドして、元の表示が出てくるようにする」, 決して read
 * as 消して: hidden by default; UI consult, Opus 5.5 and Codex astra). PyMOL draws the "Mouse Mode …" lines — and the
 * grid of buttons when `mouse_grid` is on — into its own canvas, under the
 * object panel's rows; the page cannot take them out without rebuilding
 * PyMOL, so a lid in the panel's own grey lies over them (`rect`, from the
 * worker's layout: `mouseBoxRect`) and takes the presses there.
 *
 * With `onToggle` (a computer), a tab lifts it: shut, the tab lies on the lid
 * as its label, covering nothing PyMOL draws (PT-10470 item 2); a press
 * slides the lid up and the tab rides up with it, onto the box's top edge
 * above the "Mouse Mode" line — where it stays on the lid's band instead when
 * PyMOL draws something there (`tabAbove` false: the object rows reach down
 * to the box, or a wizard's lines sit above it). PyMOL's own box then shows,
 * a press there working as before; the tab again puts the lid back. Without
 * (a phone), the lid stays and has no tab. A box lower than the tab (a
 * display scale below the screen's pixel ratio) has the shut lid's tab above
 * it where there is room, else a tab shrunk to the box, so it never reaches
 * the movie buttons under it (PT-10597 items 3, 8).
 *
 * `aside` (a PyMOL menu is up, PT-10470 item 1): the lid and its tab step out
 * of the way, so a menu PyMOL draws over the box can be seen and pressed.
 * `through` (a drag that began on the view, PT-10471 item 1): the lid stays
 * drawn but lets the moves through to the canvas. A wheel or a touch on the
 * shut lid scrolls and zooms nothing (PT-10471 items 1, 3). Decoration for
 * assistive technology: the tab is the control.
 */
export function PymolMouseLid(props: {
  rect: { x: number; y: number; w: number; h: number }
  open: boolean
  onToggle?: () => void
  /** The tab's words (PyMOL's name for the box). */
  label: string
  /** What the tab does, said on hover and to assistive technology. */
  hint: string
  /** The open box's tab may sit above it: nothing PyMOL draws is there. */
  tabAbove: boolean
  /** A PyMOL menu is up: out of its way. */
  aside: boolean
  /** A drag from the view is held: its moves pass through. */
  through: boolean
}) {
  const { rect, open, onToggle, label, hint, tabAbove, aside, through } = props
  const lid = useRef<HTMLDivElement | null>(null)
  // React's wheel handler is passive: the page's own scroll is stopped here.
  useEffect(() => {
    const el = lid.current
    if (el === null) return
    const stop = (e: WheelEvent) => e.preventDefault()
    el.addEventListener('wheel', stop, { passive: false })
    return () => el.removeEventListener('wheel', stop)
  }, [])
  const fits = rect.h >= LID_TAB_H
  const above = (open || !fits) && tabAbove
  const small = !above && !fits
  return (
    <>
      <div
        ref={lid}
        className={`sav-mouse-lid${open ? ' is-open' : ''}${aside ? ' is-aside' : ''}${through ? ' is-through' : ''}`}
        aria-hidden="true"
        style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
      />
      {onToggle !== undefined && (
        <button
          type="button"
          className={`sav-mouse-lid-tab${above ? ' is-above' : ''}${small ? ' is-small' : ''}${aside ? ' is-aside' : ''}`}
          aria-expanded={open}
          title={hint}
          style={{
            left: rect.x + 6,
            top: above || small ? rect.y : rect.y + Math.min(4, Math.max(0, (rect.h - LID_TAB_H) / 2)),
            ...(small ? { height: rect.h } : {}),
          }}
          onClick={onToggle}
        >
          {label}
          <svg viewBox="0 0 10 10" width="9" height="9" aria-hidden="true" focusable="false">
            <path d={open ? 'M1 3l4 4 4-4' : 'M1 7l4-4 4 4'} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
    </>
  )
}
