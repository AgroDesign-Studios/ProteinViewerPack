/**
 * Pointer wiring of the annotation overlay.
 *
 * annotationModel.test.ts proves the geometry; this file proves the component
 * actually drives it. Without this, an inverted `armed` guard — the pen doing
 * nothing while the layer reacts to gestures meant for 3Dmol — passes the whole
 * suite, because nothing else ever dispatches a pointer event at the canvas.
 *
 * jsdom has no PointerEvent constructor and no layout, so pointer events are
 * dispatched as MouseEvents carrying the pointer type name (React dispatches by
 * event type) and the stage rect is stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useRef } from 'react'
import { act, render, screen } from '@testing-library/react'
import ViewerAnnotationLayer, { VIEW_TOKEN_POLL_MS } from './ViewerAnnotationLayer'
import { useViewerAnnotation, type ViewerAnnotation } from './useViewerAnnotation'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

const STAGE_W = 800
const STAGE_H = 600

let annotation: ViewerAnnotation

function Harness() {
  const stageRef = useRef<HTMLDivElement>(null)
  annotation = useViewerAnnotation()
  return (
    <div ref={stageRef} data-testid="stage" className="sv3d sv3d-stage">
      <ViewerAnnotationLayer stageRef={stageRef} annotation={annotation} />
    </div>
  )
}

/** Over a viewer whose camera the page reads (the offline app's PyMOL): unframed, with a view token. */
function TokenHarness({ token }: { token: () => string | null }) {
  const stageRef = useRef<HTMLDivElement>(null)
  annotation = useViewerAnnotation()
  return (
    <div ref={stageRef} data-testid="stage" className="sv3d sv3d-stage">
      <ViewerAnnotationLayer stageRef={stageRef} annotation={annotation} viewToken={token} />
    </div>
  )
}

/**
 * Dispatch a pointer event jsdom can actually construct.
 *
 * jsdom has no PointerEvent, and a MouseEvent carries no `pointerId`, so it is
 * defined onto the event explicitly — React reads it off the native event, and
 * without it every pointer looks like the same finger.
 */
function pointer(el: Element, type: string, x: number, y: number, buttons = 1, pointerId = 1) {
  act(() => {
    const evt = new MouseEvent(type, { clientX: x, clientY: y, buttons, bubbles: true })
    Object.defineProperty(evt, 'pointerId', { value: pointerId })
    el.dispatchEvent(evt)
  })
}

const ink = () => screen.getByTestId('sv3d-ink')

describe('ViewerAnnotationLayer', () => {
  beforeEach(() => {
    // jsdom performs no layout: every rect is 0x0, which would collapse every
    // stroke onto the origin and make the coordinate assertions meaningless.
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: STAGE_W, height: STAGE_H,
      right: STAGE_W, bottom: STAGE_H, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect)
    // getContext('2d') is not implemented in jsdom and logs through the virtual
    // console; the component tolerates the null return.
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => vi.restoreAllMocks())

  it('records a pen drag as a stroke in stage-normalised coordinates', () => {
    render(<Harness />)
    act(() => annotation.setTool('pen'))

    pointer(ink(), 'pointerdown', 200, 300)
    pointer(ink(), 'pointermove', 600, 300)
    pointer(ink(), 'pointerup', 600, 300, 0)

    expect(annotation.strokes).toHaveLength(1)
    const points = annotation.strokes[0].points
    expect(points[0]).toEqual({ x: 0.25, y: 0.5 })
    expect(points[points.length - 1]).toEqual({ x: 0.75, y: 0.5 })
  })

  it('ignores pointer-down while no tool is armed, so 3Dmol keeps the gesture', () => {
    // The guard direction is the whole feature: at rest the overlay must be
    // inert or rotation, zoom and pan are dead.
    render(<Harness />)

    pointer(ink(), 'pointerdown', 200, 300)
    pointer(ink(), 'pointermove', 600, 300)

    expect(annotation.strokes).toHaveLength(0)
  })

  it('draws with the selected ink', () => {
    render(<Harness />)
    act(() => { annotation.setTool('pen'); annotation.setInk('green') })

    pointer(ink(), 'pointerdown', 100, 100)
    pointer(ink(), 'pointerup', 100, 100, 0)
    expect(annotation.strokes[0].ink).toBe('green')
  })

  it('keeps the in-progress stroke out of state until the pointer is released', () => {
    // The whole point of the ref: growing a stroke through state copies both
    // arrays and re-runs the full repaint on every move, which is quadratic in
    // the stroke's length.
    render(<Harness />)
    act(() => annotation.setTool('pen'))

    pointer(ink(), 'pointerdown', 200, 300)
    pointer(ink(), 'pointermove', 400, 300)
    pointer(ink(), 'pointermove', 600, 300)
    expect(annotation.strokes).toHaveLength(0)

    pointer(ink(), 'pointerup', 600, 300, 0)
    expect(annotation.strokes).toHaveLength(1)
    expect(annotation.strokes[0].points).toHaveLength(3)
  })

  it('drops sub-pixel moves instead of piling up vertices', () => {
    render(<Harness />)
    act(() => annotation.setTool('pen'))

    pointer(ink(), 'pointerdown', 200, 300)
    pointer(ink(), 'pointermove', 200.4, 300)
    pointer(ink(), 'pointermove', 200.6, 300)
    pointer(ink(), 'pointerup', 200.6, 300, 0)

    expect(annotation.strokes[0].points).toHaveLength(1)
  })

  it('commits the stroke when the button is released outside the window', () => {
    // Pointer capture can be lost; buttons===0 on a move is the only signal, and
    // the partial stroke must be kept rather than dropped.
    render(<Harness />)
    act(() => annotation.setTool('pen'))

    pointer(ink(), 'pointerdown', 200, 300)
    pointer(ink(), 'pointermove', 400, 300, 0)
    expect(annotation.strokes).toHaveLength(1)
    expect(annotation.strokes[0].points).toHaveLength(1)

    // A later move with the button down must not resurrect the finished stroke.
    pointer(ink(), 'pointermove', 600, 300, 1)
    expect(annotation.strokes[0].points).toHaveLength(1)
  })

  it('does not let a second pointer destroy the stroke in progress', () => {
    // The armed layer sets touch-action:none, so a second finger or a palm
    // fires a real pointerdown mid-stroke. Overwriting the active stroke would
    // drop its points without ever committing them.
    render(<Harness />)
    act(() => annotation.setTool('pen'))

    pointer(ink(), 'pointerdown', 200, 300)
    pointer(ink(), 'pointermove', 400, 300)
    // Second finger (a distinct pointerId) down then up — must not end or
    // replace the first stroke.
    pointer(ink(), 'pointerdown', 700, 100, 1, 2)
    pointer(ink(), 'pointerup', 700, 100, 0, 2)
    expect(annotation.strokes).toHaveLength(0)

    pointer(ink(), 'pointermove', 600, 300)
    pointer(ink(), 'pointerup', 600, 300, 0)
    expect(annotation.strokes).toHaveLength(1)
    expect(annotation.strokes[0].points).toHaveLength(3)
  })

  it('does not let a second pointer hijack an erase drag', () => {
    // Symmetric to the pen case: a palm landing mid-drag must not delete what
    // happens to be under it, nor end the drag the first pointer is doing.
    render(<Harness />)
    act(() => annotation.setTool('pen'))
    pointer(ink(), 'pointerdown', 200, 300)
    pointer(ink(), 'pointermove', 600, 300)
    pointer(ink(), 'pointerup', 600, 300, 0)
    act(() => { annotation.setTool('pen'); annotation.setTool('eraser') })

    // Finger 1 starts erasing away from the stroke, finger 2 lands on it.
    pointer(ink(), 'pointerdown', 400, 550)
    pointer(ink(), 'pointerdown', 400, 300, 1, 2)
    expect(annotation.strokes).toHaveLength(1)

    // Finger 2 lifting must not end finger 1's drag.
    pointer(ink(), 'pointerup', 400, 300, 0, 2)
    pointer(ink(), 'pointermove', 400, 300)
    expect(annotation.strokes).toHaveLength(0)
  })

  it('recovers from a gesture whose pointerup never arrived', () => {
    // Pointer capture can be unavailable or already lost, so an owning id can be
    // left set. Because pointerIds are never reused, the pointer-down guard
    // would then refuse every later gesture for the rest of the session — a
    // dead annotation layer. Pressing a tool chip must always clear it.
    render(<Harness />)
    act(() => annotation.setTool('eraser'))
    pointer(ink(), 'pointerdown', 400, 300)   // erase drag begins, never lifted

    act(() => annotation.setTool('pen'))      // switch tool = recovery
    pointer(ink(), 'pointerdown', 200, 300, 1, 9)
    pointer(ink(), 'pointermove', 600, 300, 1, 9)
    pointer(ink(), 'pointerup', 600, 300, 0, 9)

    expect(annotation.strokes).toHaveLength(1)
  })

  it('keeps a partial stroke when the tool is switched mid-draw', () => {
    render(<Harness />)
    act(() => annotation.setTool('pen'))
    pointer(ink(), 'pointerdown', 200, 300)
    pointer(ink(), 'pointermove', 400, 300)

    act(() => annotation.setTool('eraser'))
    expect(annotation.strokes).toHaveLength(1)
    expect(annotation.strokes[0].points).toHaveLength(2)
  })

  it('flags ink drawn while the model is already spinning', () => {
    // markStale fires on the spin transition, and the drag detector is off while
    // a tool is armed, so ink laid down during an ongoing spin would otherwise
    // never raise the banner.
    function SpinHarness() {
      const stageRef = useRef<HTMLDivElement>(null)
      annotation = useViewerAnnotation()
      return (
        <div ref={stageRef} data-testid="stage" className="sv3d sv3d-stage">
          <ViewerAnnotationLayer stageRef={stageRef} annotation={annotation} cameraMoving />
        </div>
      )
    }
    render(<SpinHarness />)
    act(() => annotation.setTool('pen'))
    pointer(ink(), 'pointerdown', 200, 300)
    pointer(ink(), 'pointerup', 200, 300, 0)

    expect(annotation.stale).toBe(true)
  })

  it('erases the whole stroke under the eraser', () => {
    render(<Harness />)
    act(() => annotation.setTool('pen'))
    pointer(ink(), 'pointerdown', 200, 300)
    pointer(ink(), 'pointermove', 600, 300)
    pointer(ink(), 'pointerup', 600, 300, 0)
    expect(annotation.strokes).toHaveLength(1)

    act(() => annotation.setTool('eraser'))
    pointer(ink(), 'pointerdown', 400, 300)

    expect(annotation.strokes).toHaveLength(0)
  })

  it('leaves a stroke the eraser did not reach', () => {
    render(<Harness />)
    act(() => annotation.setTool('pen'))
    pointer(ink(), 'pointerdown', 200, 300)
    pointer(ink(), 'pointermove', 600, 300)
    pointer(ink(), 'pointerup', 600, 300, 0)

    act(() => annotation.setTool('eraser'))
    pointer(ink(), 'pointerdown', 400, 500)

    expect(annotation.strokes).toHaveLength(1)
  })

  it('arms and disarms the layer with the tool', () => {
    render(<Harness />)
    expect(ink().className).not.toContain('is-armed')
    act(() => annotation.setTool('pen'))
    expect(ink().className).toContain('is-armed')
    act(() => annotation.setTool('pen'))
    expect(ink().className).not.toContain('is-armed')
  })

  it('shows the laser dot at the pointer and hides it on leave', () => {
    render(<Harness />)
    act(() => annotation.setCursorMode('laser'))

    pointer(screen.getByTestId('stage'), 'pointermove', 120, 240, 0)
    const dot = screen.getByTestId('sv3d-laser')
    expect(dot).toHaveStyle({ left: '120px', top: '240px' })

    pointer(screen.getByTestId('stage'), 'pointerleave', 0, 0, 0)
    expect(screen.queryByTestId('sv3d-laser')).not.toBeInTheDocument()
  })

  it('shows no laser dot in normal cursor mode', () => {
    render(<Harness />)
    pointer(screen.getByTestId('stage'), 'pointermove', 120, 240, 0)
    expect(screen.queryByTestId('sv3d-laser')).not.toBeInTheDocument()
  })

  it('marks the ink stale when the camera is dragged, and offers a way out', () => {
    render(<Harness />)
    act(() => annotation.setTool('pen'))
    pointer(ink(), 'pointerdown', 200, 300)
    pointer(ink(), 'pointerup', 200, 300, 0)
    act(() => annotation.setTool('pen'))  // disarm so the stage listener attaches

    expect(annotation.stale).toBe(false)
    pointer(screen.getByTestId('stage'), 'pointermove', 300, 300, 1)

    expect(annotation.stale).toBe(true)
    expect(ink().className).toContain('is-stale')
    act(() => screen.getByRole('button').click())
    expect(annotation.strokes).toHaveLength(0)
  })

  it('unframed with a view token, a drag on the stage is not a camera move; a new token is (the offline app’s PyMOL, whose panel takes drags)', () => {
    vi.useFakeTimers()
    try {
      let now = 'a'
      const token = () => now
      render(<TokenHarness token={token} />)
      act(() => annotation.setTool('pen'))
      pointer(ink(), 'pointerdown', 200, 300)
      pointer(ink(), 'pointerup', 200, 300, 0)
      act(() => annotation.setTool('pen'))
      pointer(screen.getByTestId('stage'), 'pointermove', 300, 300, 1)
      act(() => vi.advanceTimersByTime(VIEW_TOKEN_POLL_MS + 10))
      expect(annotation.stale).toBe(false)
      now = 'b'
      act(() => vi.advanceTimersByTime(VIEW_TOKEN_POLL_MS + 10))
      expect(annotation.stale).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a right or middle mouse press draws nothing, and a right click opens no browser menu while a tool is up (PR #10244 review)', () => {
    render(<Harness />)
    act(() => annotation.setTool('pen'))
    for (const button of [1, 2]) {
      act(() => {
        const evt = new MouseEvent('pointerdown', { clientX: 200, clientY: 300, buttons: 2, button, bubbles: true })
        Object.defineProperty(evt, 'pointerId', { value: 7 })
        Object.defineProperty(evt, 'pointerType', { value: 'mouse' })
        ink().dispatchEvent(evt)
      })
      pointer(ink(), 'pointermove', 260, 300, 2, 7)
      pointer(ink(), 'pointerup', 260, 300, 0, 7)
    }
    expect(annotation.strokes).toHaveLength(0)
    const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    act(() => {
      ink().dispatchEvent(menu)
    })
    expect(menu.defaultPrevented).toBe(true)
  })

  it('does not mark ink stale on a plain click, which moves no camera', () => {
    // A residue pick is a click without a drag; flagging it would nag on every
    // selection.
    render(<Harness />)
    act(() => annotation.setTool('pen'))
    pointer(ink(), 'pointerdown', 200, 300)
    pointer(ink(), 'pointerup', 200, 300, 0)
    act(() => annotation.setTool('pen'))

    pointer(screen.getByTestId('stage'), 'pointermove', 300, 300, 0)
    expect(annotation.stale).toBe(false)
  })
})
