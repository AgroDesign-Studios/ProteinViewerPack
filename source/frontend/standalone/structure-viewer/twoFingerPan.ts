/**
 * Two fingers dragged together move the Light viewer (3Dmol.js), as they move
 * the Heavy viewer (`touchMouse.ts`) and most phone 3D viewers (owner
 * 2026-11-17: 「2本指で移動にそろえてください」). 3Dmol.js 2.5 itself treats
 * two fingers as a pinch always and moves with three; that original stays one
 * setting away (`touchControls.ts`, owner: 「元の作者の意向は尊重したい」).
 *
 * How: the page listens on the viewer's element in the capture phase, before
 * 3Dmol.js's own listeners on its canvas. A two-finger gesture is decided
 * once, as `touchMouse.ts` decides it: after the fingers moved `SLOP_PX`,
 * a pinch if their spread changed more than their centre moved, else a move.
 * A pinch is left to 3Dmol.js (its touchstart, which set its pinch start,
 * was never held back). Until the decision and through a move, the page
 * holds the finger moves back from 3Dmol.js and moves the view itself, by
 * the same call 3Dmol.js makes for its own three-finger move
 * (`translateScene`, screen pixels times the canvas's pixel ratio). One and
 * three fingers are left to 3Dmol.js.
 *
 * `TwoFingerPan` is pure: fed the fingers after each touch event, it answers
 * whether 3Dmol.js may see that move, and how far to move the view.
 */

/** A finger on the glass, in client coordinates. */
export interface Finger {
  id: number
  x: number
  y: number
}

/** How far the fingers move before a two-finger gesture is a pinch or a move (as `touchMouse.ts`). */
export const SLOP_PX = 6

export type PanAnswer = { pass: true } | { pass: false; dx: number; dy: number }

type State =
  | { kind: 'idle' }
  | { kind: 'two'; ids: [number, number]; cx: number; cy: number; spread: number; as: 'undecided' | 'pinch' | 'pan' }

const centre = (a: Finger, b: Finger) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
const spreadOf = (a: Finger, b: Finger) => Math.hypot(a.x - b.x, a.y - b.y)

export class TwoFingerPan {
  private state: State = { kind: 'idle' }

  /** The fingers changed (a touchstart or touchend): a new two-finger gesture starts, or none. */
  reset(fingers: readonly Finger[]): void {
    if (fingers.length !== 2) {
      this.state = { kind: 'idle' }
      return
    }
    const [a, b] = fingers
    const c = centre(a, b)
    this.state = { kind: 'two', ids: [a.id, b.id], cx: c.x, cy: c.y, spread: spreadOf(a, b), as: 'undecided' }
  }

  /** The fingers moved: whether 3Dmol.js may see this move, and the view's move in client pixels when not. */
  move(fingers: readonly Finger[]): PanAnswer {
    const s = this.state
    if (s.kind !== 'two' || fingers.length !== 2) return { pass: true }
    const a = fingers.find(f => f.id === s.ids[0])
    const b = fingers.find(f => f.id === s.ids[1])
    if (!a || !b) return { pass: true }
    if (s.as === 'pinch') return { pass: true }
    const c = centre(a, b)
    if (s.as === 'undecided') {
      const moved = Math.hypot(c.x - s.cx, c.y - s.cy)
      const spread = Math.abs(spreadOf(a, b) - s.spread)
      if (Math.max(moved, spread) < SLOP_PX) return { pass: false, dx: 0, dy: 0 }
      if (spread > moved) {
        this.state = { ...s, as: 'pinch' }
        return { pass: true }
      }
      // A move: from where the fingers started, so the slop is not lost.
      this.state = { ...s, as: 'pan', cx: c.x, cy: c.y }
      return { pass: false, dx: c.x - s.cx, dy: c.y - s.cy }
    }
    this.state = { ...s, cx: c.x, cy: c.y }
    return { pass: false, dx: c.x - s.cx, dy: c.y - s.cy }
  }
}

/** The touches of an event as fingers. */
export function fingersOf(list: TouchList): Finger[] {
  const out: Finger[] = []
  for (let i = 0; i < list.length; i++) {
    const t = list[i]
    out.push({ id: t.identifier, x: t.clientX, y: t.clientY })
  }
  return out
}

/** The 3Dmol.js viewer as this module drives it. */
interface PanViewer {
  translateScene: (x: number, y: number) => unknown
  renderer?: { getXRatio?: () => number; getYRatio?: () => number }
}

/**
 * Listens on `el` (the viewer's element, an ancestor of 3Dmol.js's canvas)
 * and moves `viewer()` with two fingers. Returns the cleanup.
 */
export function attachTwoFingerPan(el: HTMLElement, viewer: () => PanViewer | null): () => void {
  const pan = new TwoFingerPan()
  const onChange = (e: TouchEvent) => pan.reset(fingersOf(e.targetTouches))
  const onMove = (e: TouchEvent) => {
    const answer = pan.move(fingersOf(e.targetTouches))
    if (answer.pass) return
    // Held back from 3Dmol.js's own listeners (its two fingers would zoom), and from the page's scroll.
    e.stopPropagation()
    e.preventDefault()
    const v = viewer()
    if (v === null || (answer.dx === 0 && answer.dy === 0)) return
    const rx = v.renderer?.getXRatio?.() ?? 1
    const ry = v.renderer?.getYRatio?.() ?? rx
    v.translateScene(answer.dx * rx, answer.dy * ry)
  }
  el.addEventListener('touchstart', onChange, { capture: true, passive: true })
  el.addEventListener('touchend', onChange, { capture: true, passive: true })
  el.addEventListener('touchcancel', onChange, { capture: true, passive: true })
  el.addEventListener('touchmove', onMove, { capture: true, passive: false })
  return () => {
    el.removeEventListener('touchstart', onChange, { capture: true })
    el.removeEventListener('touchend', onChange, { capture: true })
    el.removeEventListener('touchcancel', onChange, { capture: true })
    el.removeEventListener('touchmove', onMove, { capture: true })
  }
}
