import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type FocusEvent, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react'

/** A horizontal move this long, started on the tab, is a swipe (UI consult 2026-11-15). */
export const DRAWER_SWIPE_PX = 24

/**
 * How long after a swipe the browser's own click for it may come (a mouse
 * drag sends one at once): a pointer click inside it is the swipe's, not a tap.
 */
export const DRAWER_SWIPE_CLICK_MS = 600

interface Props {
  /** PyMOL's object panel (its internal GUI) is shown now. */
  open: boolean
  /** Shows or hides the panel: a tap, a click, Enter or Space. */
  onToggle: () => void
  /**
   * A swipe: `true` pull the panel out, `false` put it back. The host sets
   * the panel to it against what it has already asked for, not against
   * `open`, which lags while PyMOL is busy (PT-9400 item 1).
   */
  onSwipe: (open: boolean) => void
  /** The tab's visible word, written top to bottom (「オブジェクト」). */
  label: string
  /** The control's accessible name (「オブジェクト一覧」); `aria-expanded` says open or closed. */
  name: string
  /** The id of what the panel is drawn in (the view's host). */
  controls?: string
  /** Why it cannot act now (PyMOL loading or stopped), or null. */
  disabledReason?: string | null
  /**
   * How wide the open panel is, in CSS px: the open tab sits just left of it
   * (its right side on the panel's left edge). Unset, the tab stays at the
   * view's right edge.
   */
  panelWidth?: number
  /**
   * The open tab is to be seen now (`useDrawerReveal`: the pointer over the
   * panel, or a touch screen). Open and not revealed it is transparent, yet
   * still there: the pointer over it, or the keyboard's focus, shows it.
   */
  revealed?: boolean
  /** Pull to zoom on the open panel (`DrawerZoom`); unset, the tab only shows and hides it. */
  zoom?: DrawerZoom
}

/**
 * Pull to zoom (owner 2026-11-20: 「オブジェクトのタグを左側に引っ張ると文字や
 * ASHLCのボタンが大きくなる」; UI consult, Opus 5.5 and Codex astra): the
 * panel's sizes, smallest first, each as wide as the panel would be (CSS px).
 * Dragging the open tab sideways picks the size whose left edge is nearest the
 * tab (a step changes only once the tab is `DRAWER_ZOOM_HYSTERESIS_PX` nearer
 * another), shown while dragging (`onPreview`) and set on release
 * (`onStep`); rightwards past the smallest by a swipe's length, the release
 * puts the panel back, as a swipe always did. Esc while dragging drops it.
 * The keyboard's ← and → step it too (WCAG 2.5.7: no drag needed).
 */
export interface DrawerZoom {
  steps: readonly { width: number; allowed: boolean }[]
  /** The size the panel has now. */
  current: number
  onStep: (index: number) => void
  /** While dragging: the size a release would choose, `'close'`, or null (none yet, or dropped). */
  onPreview?: (preview: number | 'close' | null) => void
  /** What the drag and the keys do, said with the tab's name. */
  hint?: string
}

/** How much nearer another size's edge the tab must be before the preview moves to it. */
export const DRAWER_ZOOM_HYSTERESIS_PX = 8

/** How long a mouse or pen rests on the open tab before the pull to zoom's bubble shows. */
export const DRAWER_BUBBLE_DELAY_MS = 400

/** A focus this soon after a touch on the tab is the touch's: no bubble. */
export const DRAWER_TOUCH_FOCUS_MS = 1000

/** How long the bubble stays once the pointer has left the tab and it: time to move onto it (WCAG 1.4.13, hoverable). */
export const DRAWER_BUBBLE_LEAVE_MS = 200

/** Whether the element has the keyboard's focus ring; null where the browser cannot say. */
function focusVisible(el: Element): boolean | null {
  try {
    return el.matches(':focus-visible')
  } catch {
    return null
  }
}

/**
 * The size a drag of `dx` (CSS px, leftwards negative) from size `current`
 * chooses, from `prev` (the preview so far): the allowed size whose width is
 * nearest the width the tab's place asks for, kept until another is nearer by
 * `DRAWER_ZOOM_HYSTERESIS_PX`; `'close'` rightwards past the smallest size by a
 * swipe's length; null for a move shorter than a swipe.
 */
export function zoomPreview(zoom: Pick<DrawerZoom, 'steps' | 'current'>, dx: number, prev: number | 'close' | null): number | 'close' | null {
  if (!Number.isFinite(dx) || Math.abs(dx) < DRAWER_SWIPE_PX) return null
  const steps = zoom.steps
  const at = steps[zoom.current]
  if (at === undefined) return null
  const want = at.width - dx
  const smallest = steps.findIndex(s => s.allowed)
  if (smallest === -1) return null
  if (dx > 0 && zoom.current === smallest && want < steps[smallest].width - DRAWER_SWIPE_PX) return 'close'
  let best = -1
  for (let i = 0; i < steps.length; i++) {
    if (!steps[i].allowed) continue
    if (best === -1 || Math.abs(steps[i].width - want) < Math.abs(steps[best].width - want)) best = i
  }
  if (typeof prev === 'number' && prev !== best && steps[prev]?.allowed) {
    if (Math.abs(steps[prev].width - want) - Math.abs(steps[best].width - want) < DRAWER_ZOOM_HYSTERESIS_PX) return prev
  }
  return best
}

/**
 * When the open tab is seen (owner 2026-11-16: only while the mouse is over
 * the object panel, so it never hides the structure; UI consult Opus 5.5 +
 * Codex astra): the pointer's x over the view's host at or right of
 * `right − panelWidth`, or the last pointer a touch (astra: a tab that fades
 * on a touch screen leaves no visible way to close the panel; a mouse or pen
 * moving again hands it back to the hover). Spread `handlers` on the element
 * that holds both the view and the tab; it reads pointer events as they
 * bubble and blocks none.
 */
export function useDrawerReveal(panelWidth: number): {
  revealed: boolean
  handlers: {
    onPointerMove: (e: PointerEvent<HTMLElement>) => void
    onPointerDown: (e: PointerEvent<HTMLElement>) => void
    onPointerLeave: (e: PointerEvent<HTMLElement>) => void
  }
} {
  const [near, setNear] = useState(false)
  const [touch, setTouch] = useState(false)
  const read = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      if (e.pointerType === 'touch') {
        setTouch(true)
        return
      }
      setTouch(false)
      const r = e.currentTarget.getBoundingClientRect()
      setNear(Number.isFinite(e.clientX) && e.clientX >= r.right - panelWidth && e.clientX <= r.right)
    },
    [panelWidth],
  )
  const onPointerLeave = useCallback((e: PointerEvent<HTMLElement>) => {
    if (e.pointerType !== 'touch') setNear(false)
  }, [])
  return { revealed: near || touch, handlers: { onPointerMove: read, onPointerDown: read, onPointerLeave } }
}

/** Two chevrons as one drawn mark (no font's ‹‹ or «), pointing the way the panel goes. */
function DoubleChevron({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg className="pymolv-drawer-chevron" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <path
        d={dir === 'left' ? 'M8 3 3 8l5 5M13 3 8 8l5 5' : 'M3 3l5 5-5 5M8 3l5 5-5 5'}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * The pull tab of PyMOL's object panel (owner 2026-11-15; UI consult Opus
 * 5.5 + Codex astra): the panel itself stays PyMOL's internal GUI, drawn
 * inside the view. The tab lies over the view, taking no width of its own
 * (owner 2026-11-16: the view's picture reaches above and below it), so it
 * never changes the view's size — showing or hiding the panel is PyMOL's
 * own re-layout. Closed, it sits at the view's right edge, its word top to
 * bottom with « (pull out); open, just left of the panel with » (put back),
 * seen only while `revealed`, hovered or focused from the keyboard
 * (`useDrawerReveal`). A tap, a click, Enter or Space toggles it; a sideways swipe of
 * `DRAWER_SWIPE_PX` or more that starts on the tab sets it: leftwards out,
 * rightwards back. A swipe on the view is never taken — it rotates the
 * molecule, and the screen's edge is the phone's Back gesture. Not ready, it
 * stays in the Tab order with its reason (`aria-disabled`) and does nothing.
 * With pull to zoom, its hint is a bubble left of the open tab (owner
 * 2026-11-21: 「左右に引っ張って大きさが文字の変更できることを、吹き出しで示す」):
 * after `DRAWER_BUBBLE_DELAY_MS` of a mouse or pen on the tab, or on the
 * keyboard's focus (also when the keyboard opens the panel from the tab);
 * never for a touch (a focus that a touch on the tab gave included, also
 * where the browser cannot say whose focus it is), nor while a drag runs. The
 * pointer can move onto it (`DRAWER_BUBBLE_LEAVE_MS`), and Esc puts it away
 * wherever the focus is (WCAG 1.4.13; PR #10057's review, PT-10470,
 * PT-10471). Hidden, the same words still describe the tab.
 *
 * Generic: the host passes the words.
 */
export function PymolObjectDrawerTab({ open, onToggle, onSwipe, label, name, controls, disabledReason = null, panelWidth, revealed = false, zoom }: Props) {
  const reasonId = useId()
  const hintId = useId()
  const start = useRef<{ x: number; y: number; id: number } | null>(null)
  // When the last swipe ended: the pointer click the browser may send after it is not a tap.
  const swipedAt = useRef<number | null>(null)
  const locked = disabledReason !== null
  // Pull to zoom: only on the open panel, and only where the host gives sizes.
  const z: DrawerZoom | null = open && !locked && zoom !== undefined && zoom.steps.length > 0 ? zoom : null
  const zooming = z !== null
  // The drag so far (the tab follows it) and the size a release would choose.
  const [drag, setDrag] = useState<{ dx: number; preview: number | 'close' | null } | null>(null)
  const preview = useRef<number | 'close' | null>(null)
  // The host's preview handler, kept when the sizes go mid-drag (PyMOL restarting), so the
  // guides it draws are always taken down (PT-10132 item 2).
  const onPreviewRef = useRef(zoom?.onPreview)
  if (zoom?.onPreview !== undefined) onPreviewRef.current = zoom.onPreview
  // This press showed a size: the click the browser sends after it belongs to the drag,
  // whatever the release does — applied, dropped by Esc, or ended mostly up or down
  // (PT-10132 items 1, 4, 8).
  const dragged = useRef(false)
  // Esc dropped this press's drag: its release changes nothing.
  const dropped = useRef(false)
  // The pull to zoom's hint shown as a bubble, and the hover's wait for it.
  const [bubble, setBubble] = useState(false)
  const bubbleTimer = useRef<number | null>(null)
  const leaveTimer = useRef<number | null>(null)
  const tabRef = useRef<HTMLButtonElement | null>(null)
  // When a touch last pressed the tab: the focus it gives shows no bubble. A time, not a flag:
  // a tap that never focuses the tab (iOS Safari) must not hold the keyboard's bubble back
  // later (PT-10597 item 5).
  const touchedAt = useRef(-Infinity)
  const clearBubbleTimers = () => {
    for (const r of [bubbleTimer, leaveTimer]) {
      if (r.current !== null) window.clearTimeout(r.current)
      r.current = null
    }
  }
  useEffect(() => clearBubbleTimers, [])
  const hideBubble = () => {
    clearBubbleTimers()
    setBubble(false)
  }
  const showPreview = (next: number | 'close' | null) => {
    if (preview.current === next) return
    preview.current = next
    if (next !== null) dragged.current = true
    onPreviewRef.current?.(next)
  }
  const endDrag = () => {
    setDrag(null)
    showPreview(null)
  }
  // The tab gone mid-drag (the phone's layout turned): the host's guides go with it.
  useEffect(
    () => () => {
      if (preview.current === null) return
      preview.current = null
      onPreviewRef.current?.(null)
    },
    [],
  )

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === 'touch') touchedAt.current = performance.now()
    hideBubble()
    swipedAt.current = null
    dragged.current = false
    dropped.current = false
    start.current = { x: e.clientX, y: e.clientY, id: e.pointerId }
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // jsdom and an already-released pointer: the move is still read on the tab.
    }
  }
  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    const s = start.current
    if (z === null || s === null || s.id !== e.pointerId || dropped.current) return
    const dx = e.clientX - s.x
    if (!Number.isFinite(dx)) return
    const next = zoomPreview(z, dx, preview.current)
    showPreview(next)
    setDrag({ dx, preview: next })
  }
  const onPointerUp = (e: PointerEvent<HTMLButtonElement>) => {
    const s = start.current
    start.current = null
    const chosen = preview.current
    // Always: the guides go, whatever this render last saw of the drag (PT-10132 item 2).
    endDrag()
    if (dragged.current || dropped.current) swipedAt.current = Date.now()
    if (s === null || s.id !== e.pointerId || dropped.current) return
    const dx = e.clientX - s.x
    const dy = e.clientY - s.y
    // No coordinates (a synthetic event): no swipe, the click decides.
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return
    if (Math.abs(dx) < DRAWER_SWIPE_PX || Math.abs(dx) <= Math.abs(dy)) return
    swipedAt.current = Date.now()
    if (locked) return
    // The open panel with sizes: the size the drag chose, or back in past the smallest.
    if (z !== null) {
      const final = zoomPreview(z, dx, chosen)
      if (final === 'close') onSwipe(false)
      else if (final !== null && final !== z.current) z.onStep(final)
      return
    }
    // Leftwards pulls the panel out; rightwards puts it back.
    onSwipe(dx < 0)
  }
  const cancel = () => {
    start.current = null
    endDrag()
  }
  // Esc drops a drag wherever the focus is (Safari gives a pressed button none): heard
  // first, and only while one runs, so the page's and a dialog's own Esc are left alone
  // otherwise. The press stays the drag's: its release and the click after it change nothing.
  const dragging = drag !== null
  useEffect(() => {
    if (!dragging) return
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      e.preventDefault()
      dropped.current = true
      swipedAt.current = Date.now()
      setDrag(null)
      showPreview(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // showPreview reads refs only: the listener needs no newer copy.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging])
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (z === null || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return
    e.preventDefault()
    // ← makes the panel wider, as a pull leftwards does; → narrower.
    const way = e.key === 'ArrowLeft' ? 1 : -1
    for (let i = z.current + way; i >= 0 && i < z.steps.length; i += way) {
      if (z.steps[i].allowed) {
        z.onStep(i)
        return
      }
    }
  }
  const onClick = (e: MouseEvent<HTMLButtonElement>) => {
    const at = swipedAt.current
    swipedAt.current = null
    // Only a pointer's click (detail > 0) soon after the swipe is the swipe's
    // own; Enter, Space and assistive technology click with detail 0, and a
    // touch swipe sends no click at all (PT-9400 item 4).
    if (at !== null && e.detail > 0 && Date.now() - at < DRAWER_SWIPE_CLICK_MS) return
    if (!locked) onToggle()
  }

  // Open: right of the tab on the panel's left edge, the tab kept inside the view; while a
  // pull to zoom is dragged, the tab follows the pointer (the panel changes on release).
  const at: CSSProperties | undefined =
    open && panelWidth !== undefined && panelWidth > 0
      ? { right: `min(${Math.round(panelWidth)}px, calc(100% - 28px))`, ...(drag !== null ? { transform: `translateX(${Math.round(drag.dx)}px)` } : {}) }
      : undefined
  const hint = z?.hint
  const describedBy = [locked ? reasonId : null, hint !== undefined ? hintId : null].filter(Boolean).join(' ')
  // The bubble: a mouse or pen resting on the tab (and kept while it moves onto the bubble),
  // or the keyboard's focus — never a touch.
  const hoverIn = (e: PointerEvent<HTMLElement>) => {
    if (hint === undefined || e.pointerType === 'touch') return
    if (leaveTimer.current !== null) {
      window.clearTimeout(leaveTimer.current)
      leaveTimer.current = null
    }
    if (bubble || bubbleTimer.current !== null) return
    bubbleTimer.current = window.setTimeout(() => {
      bubbleTimer.current = null
      setBubble(true)
    }, DRAWER_BUBBLE_DELAY_MS)
  }
  const hoverOut = (e: PointerEvent<HTMLElement>) => {
    if (e.pointerType === 'touch') return
    if (bubbleTimer.current !== null) {
      window.clearTimeout(bubbleTimer.current)
      bubbleTimer.current = null
    }
    // The keyboard's focus on the tab holds the bubble: the mouse leaving does not take it (PT-10598).
    const el = tabRef.current
    if (leaveTimer.current !== null || (el !== null && document.activeElement === el && keyboardFocus(el))) return
    leaveTimer.current = window.setTimeout(() => {
      leaveTimer.current = null
      setBubble(false)
    }, DRAWER_BUBBLE_LEAVE_MS)
  }
  // The focus a touch on the tab just gave is never the keyboard's, whatever :focus-visible
  // says (or where the browser cannot say).
  const keyboardFocus = (el: Element) => performance.now() - touchedAt.current > DRAWER_TOUCH_FOCUS_MS && focusVisible(el) !== false
  const onFocus = (e: FocusEvent<HTMLButtonElement>) => {
    if (hint !== undefined && keyboardFocus(e.currentTarget)) setBubble(true)
  }
  const onBlur = () => hideBubble()
  // No hint (the panel closed, the tab locked): no bubble state left to swallow an Esc.
  // A hint that comes while the keyboard is on the tab (it opened the panel): the bubble.
  useEffect(() => {
    if (hint === undefined) {
      clearBubbleTimers()
      setBubble(false)
      return
    }
    const el = tabRef.current
    if (el !== null && document.activeElement === el && keyboardFocus(el)) setBubble(true)
    // The refs and the focus are read when the hint comes; nothing else re-runs it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hint])
  const bubbleShown = bubble && hint !== undefined && drag === null
  // Esc puts the bubble away wherever the focus is (WCAG 1.4.13: dismissible). It is the
  // bubble's only when the focus is on the tab or on nothing (the page's own Esc, leaving its
  // expanded view, waits for the next); a control that has the focus — a card, a menu — still
  // gets it (PT-10597 item 4).
  useEffect(() => {
    if (!bubbleShown) return
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const at = document.activeElement
      if (at === null || at === document.body || at === tabRef.current) e.stopPropagation()
      clearBubbleTimers()
      setBubble(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [bubbleShown])
  return (
    <div className="pymolv-drawer-strip" data-open={open} data-revealed={open && revealed ? true : undefined} data-zoom={zooming ? true : undefined} data-dragging={drag !== null ? true : undefined} style={at}>
      <button
        ref={tabRef}
        type="button"
        className="pymolv-drawer-tab"
        aria-label={name}
        aria-expanded={open}
        aria-controls={controls}
        aria-disabled={locked || undefined}
        aria-describedby={describedBy === '' ? undefined : describedBy}
        title={disabledReason ?? undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={cancel}
        onPointerEnter={hoverIn}
        onPointerLeave={hoverOut}
        onFocus={onFocus}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        onClick={onClick}
      >
        <DoubleChevron dir={open ? 'right' : 'left'} />
        <span className="pymolv-drawer-word" aria-hidden="true">
          {label}
        </span>
        {/* The grip: the open tab can be pulled to size the panel. */}
        {zooming && <span className="pymolv-drawer-grip" aria-hidden="true" />}
      </button>
      {locked && (
        <span id={reasonId} className="sr-only">
          {disabledReason}
        </span>
      )}
      {hint !== undefined && (
        <span id={hintId} className={bubbleShown ? 'pymolv-drawer-bubble' : 'sr-only'} onPointerEnter={hoverIn} onPointerLeave={hoverOut}>
          {hint}
        </span>
      )}
    </div>
  )
}
