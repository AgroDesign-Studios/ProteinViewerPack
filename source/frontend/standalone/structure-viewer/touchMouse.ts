/**
 * Touch gestures as PyMOL mouse input (the offline file's phone mode, owner
 * 2026-11-14). PyMOL's worker takes mouse buttons only (`pymolBridge.ts`),
 * and its three-button viewing mode drags the view with them: the left
 * button rotates, the middle one moves the view, the right one zooms
 * (dragging down zooms in — measured in headless Chrome, 2026-11-14). So:
 *
 *   - one finger: the left button, pressed where the finger landed once it
 *     has moved `GESTURE_SLOP_PX`, and dragged with it — it rotates; lifted
 *     before that, it was a tap: a left click where it landed (PyMOL's
 *     pick), as a mouse click would be;
 *   - two fingers pinching: the right button, held at the fingers' centre
 *     and dragged down as they spread apart (up as they close) — it zooms;
 *   - two fingers moving together: the middle button, held at their centre
 *     and dragged with it — it moves the view.
 *
 * Fingers land in separate touch events, so the first finger's press waits
 * for it to move: a second finger that lands before then makes a two-finger
 * gesture with no click before it (a click on an atom toggles it in `sele`,
 * PT-9192 item 5). Which of the two a two-finger gesture is is decided once,
 * by what moved more (the spread or the centre) after `GESTURE_SLOP_PX`;
 * PyMOL holds one button at a time, so the gesture keeps it until the
 * fingers change. A second finger lets go of the first's rotation; one
 * finger left of two, or a finger other than the one that started the
 * rotation, does nothing until every finger is up, so the view never jumps
 * (PT-9192 item 1).
 *
 * Pure: it is fed the fingers on the view after each touch event (an empty
 * list when the last is lifted) and answers the mouse input to send, in the
 * page's (client) coordinates. `cancel` ends a gesture the browser
 * cancelled: it lets go, and never clicks.
 */

/** A finger on the glass, in client coordinates. */
export interface TouchPoint {
  id: number
  x: number
  y: number
}

export type MouseButton = 0 | 1 | 2
export type MouseOp = { kind: 'move'; x: number; y: number } | { kind: 'down' | 'up'; button: MouseButton; x: number; y: number }

/** How far the fingers move before a one-finger touch is a rotation, or a two-finger one a pinch or a move. */
export const GESTURE_SLOP_PX = 6
/** Pixels of PyMOL's zoom drag for each pixel the fingers spread apart. */
export const PINCH_GAIN = 1

const ROTATE: MouseButton = 0
const MOVE: MouseButton = 1
const ZOOM: MouseButton = 2

type Mode =
  | { kind: 'idle' }
  /** One finger, from where it landed; `pressed` once it moved past the slop (a rotation). */
  | { kind: 'one'; id: number; x0: number; y0: number; pressed: boolean }
  | { kind: 'two'; ids: [number, number]; cx: number; cy: number; spread: number; as: 'undecided' | 'zoom' | 'pan' }
  /** One finger left of a gesture: nothing until all are up. */
  | { kind: 'spent' }

const centre = (a: TouchPoint, b: TouchPoint) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
const spreadOf = (a: TouchPoint, b: TouchPoint) => Math.hypot(a.x - b.x, a.y - b.y)

export class TouchMouse {
  private mode: Mode = { kind: 'idle' }
  /** The button held and where the pointer is. */
  private held: { button: MouseButton; x: number; y: number } | null = null

  /** The fingers on the view now; the mouse input that follows from the change. */
  update(touches: readonly TouchPoint[]): MouseOp[] {
    const ops: MouseOp[] = []
    const m = this.mode
    if (touches.length === 0) {
      // A finger lifted before it moved: a tap, the left button's click where it landed.
      if (m.kind === 'one' && !m.pressed) this.press(ops, ROTATE, m.x0, m.y0)
      this.release(ops)
      this.mode = { kind: 'idle' }
      return ops
    }
    if (touches.length === 1) {
      const p = touches[0]
      if (m.kind === 'idle') this.mode = { kind: 'one', id: p.id, x0: p.x, y0: p.y, pressed: false }
      else if (m.kind === 'one' && m.id === p.id) {
        if (!m.pressed) {
          if (Math.hypot(p.x - m.x0, p.y - m.y0) < GESTURE_SLOP_PX) return ops
          this.press(ops, ROTATE, m.x0, m.y0)
          m.pressed = true
        }
        this.moveTo(ops, p.x, p.y)
      } else if (m.kind !== 'spent') {
        // Not the finger that started, or one left of two: nothing more until all are up.
        this.release(ops)
        this.mode = { kind: 'spent' }
      }
      return ops
    }
    // Two or more: the first two on the view make the gesture.
    const [a, b] = touches
    if (m.kind !== 'two' || !((m.ids[0] === a.id && m.ids[1] === b.id) || (m.ids[0] === b.id && m.ids[1] === a.id))) {
      this.release(ops)
      const c = centre(a, b)
      this.mode = { kind: 'two', ids: [a.id, b.id], cx: c.x, cy: c.y, spread: spreadOf(a, b), as: 'undecided' }
      return ops
    }
    const c = centre(a, b)
    const spreadChange = spreadOf(a, b) - m.spread
    if (m.as === 'undecided') {
      const moved = Math.hypot(c.x - m.cx, c.y - m.cy)
      if (Math.max(moved, Math.abs(spreadChange)) < GESTURE_SLOP_PX) return ops
      m.as = Math.abs(spreadChange) >= moved ? 'zoom' : 'pan'
      this.press(ops, m.as === 'zoom' ? ZOOM : MOVE, m.cx, m.cy)
    }
    if (m.as === 'zoom') this.moveTo(ops, m.cx, m.cy + PINCH_GAIN * spreadChange)
    else this.moveTo(ops, c.x, c.y)
    return ops
  }

  /** The browser cancelled the gesture: let go of what is held, and never click. */
  cancel(): MouseOp[] {
    const ops: MouseOp[] = []
    this.release(ops)
    this.mode = { kind: 'idle' }
    return ops
  }

  private press(ops: MouseOp[], button: MouseButton, x: number, y: number): void {
    ops.push({ kind: 'move', x, y }, { kind: 'down', button, x, y })
    this.held = { button, x, y }
  }

  private moveTo(ops: MouseOp[], x: number, y: number): void {
    if (this.held === null || (this.held.x === x && this.held.y === y)) return
    this.held = { ...this.held, x, y }
    ops.push({ kind: 'move', x, y })
  }

  private release(ops: MouseOp[]): void {
    if (this.held === null) return
    const { button, x, y } = this.held
    ops.push({ kind: 'up', button, x, y })
    this.held = null
  }
}
