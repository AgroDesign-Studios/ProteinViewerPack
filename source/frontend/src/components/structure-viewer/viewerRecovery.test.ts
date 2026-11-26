import { describe, expect, it, vi } from 'vitest'
import { healViewer, retireViewer, viewerFault } from './viewerRecovery'

function fakeCanvas(lost = false) {
  const canvas = document.createElement('canvas')
  const lose = vi.fn()
  const gl = { isContextLost: () => lost, getExtension: () => ({ loseContext: lose }) }
  ;(canvas as unknown as { getContext: unknown }).getContext = (kind: string) => (kind === 'webgl2' ? gl : null)
  return { canvas, lose }
}

function fakeViewer(canvas: HTMLCanvasElement, mount: Element) {
  return {
    clear: vi.fn(),
    spin: vi.fn(),
    getCanvas: () => canvas,
    container: mount as unknown,
    divwatcher: { disconnect: vi.fn() },
    intwatcher: { disconnect: vi.fn() },
  }
}

describe('retireViewer', () => {
  it('empties the scene, loses a context of its own canvas (only the grid path has one — 3Dmol 2.x draws through one shared OffscreenCanvas context), removes the canvas and cuts the viewer off its mount', () => {
    const mount = document.createElement('div')
    document.body.append(mount)
    const { canvas, lose } = fakeCanvas()
    ;(canvas as unknown as Record<string, unknown>)._3dmol_viewer = {}
    mount.append(canvas)
    const viewer = fakeViewer(canvas, mount)

    retireViewer(viewer, mount)

    expect(viewer.clear).toHaveBeenCalled()
    expect(viewer.spin).toHaveBeenCalledWith(false)
    expect(viewer.divwatcher.disconnect).toHaveBeenCalled()
    expect(viewer.intwatcher.disconnect).toHaveBeenCalled()
    expect(lose).toHaveBeenCalledTimes(1)
    expect(mount.querySelector('canvas')).toBeNull()
    // A later resize() of the retired viewer must not find the live canvas.
    expect(viewer.container).not.toBe(mount)
    expect((canvas as unknown as Record<string, unknown>)._3dmol_viewer).toBeUndefined()
    mount.remove()
  })

  it('empties a mount that holds a canvas no viewer owns any more, and never throws', () => {
    const mount = document.createElement('div')
    mount.append(document.createElement('canvas'))
    expect(() => retireViewer(null, mount)).not.toThrow()
    expect(mount.childElementCount).toBe(0)
    expect(() => retireViewer({ clear: () => { throw new Error('x') } }, null)).not.toThrow()
  })
})

describe('viewerFault', () => {
  it('is null for a live canvas alone in its mount', () => {
    const mount = document.createElement('div')
    document.body.append(mount)
    const { canvas } = fakeCanvas()
    mount.append(canvas)
    expect(viewerFault(fakeViewer(canvas, mount), mount)).toBeNull()
    mount.remove()
  })

  it('names a lost context', () => {
    const mount = document.createElement('div')
    document.body.append(mount)
    const { canvas } = fakeCanvas(true)
    mount.append(canvas)
    expect(viewerFault(fakeViewer(canvas, mount), mount)).toBe('context-lost')
    mount.remove()
  })

  it('names a canvas that left the mount, and a second canvas in it', () => {
    const mount = document.createElement('div')
    document.body.append(mount)
    const { canvas } = fakeCanvas()
    expect(viewerFault(fakeViewer(canvas, mount), mount)).toBe('canvas-detached')
    mount.append(document.createElement('canvas'), canvas)
    expect(viewerFault(fakeViewer(canvas, mount), mount)).toBe('canvas-replaced')
    mount.remove()
  })
})

/**
 * What a browser with OffscreenCanvas gives: the page's canvas holds only a
 * bitmaprenderer (every WebGL `getContext` on it is null), and the loss of
 * 3Dmol's shared context shows in the renderer alone.
 */
function sharedContextViewer(lost: { now: boolean }, onResize: () => void = () => {}) {
  const mount = document.createElement('div')
  document.body.append(mount)
  const canvas = document.createElement('canvas')
  ;(canvas as unknown as { getContext: unknown }).getContext = () => null
  mount.append(canvas)
  const viewer = {
    getCanvas: () => canvas,
    getRenderer: () => ({ isLost: () => lost.now }),
    resize: vi.fn(onResize),
    render: vi.fn(),
  }
  return { mount, viewer }
}

describe('a lost shared context (OffscreenCanvas)', () => {
  it('is read from the renderer, which the page canvas cannot show', () => {
    const lost = { now: true }
    const { mount, viewer } = sharedContextViewer(lost)
    expect(viewerFault(viewer, mount)).toBe('context-lost')
    lost.now = false
    expect(viewerFault(viewer, mount)).toBeNull()
    mount.remove()
  })

  it('is regenerated in place by resize(), with the scene left alone', () => {
    const lost = { now: true }
    const { mount, viewer } = sharedContextViewer(lost, () => { lost.now = false })
    expect(healViewer(viewer, mount)).toBe('healed')
    expect(viewer.resize).toHaveBeenCalledTimes(1)
    expect(viewer.render).toHaveBeenCalledTimes(1)
    expect(healViewer(viewer, mount)).toBe('ok')
    expect(viewer.resize).toHaveBeenCalledTimes(1)
    mount.remove()
  })

  it('asks for a new viewer when resize() did not bring the context back, or threw', () => {
    const still = sharedContextViewer({ now: true })
    expect(healViewer(still.viewer, still.mount)).toBe('rebuild')
    still.mount.remove()
    const throws = sharedContextViewer({ now: true }, () => { throw new Error('no context') })
    expect(healViewer(throws.viewer, throws.mount)).toBe('rebuild')
    throws.mount.remove()
  })

  it('asks for a new viewer when the canvas itself is gone', () => {
    const { mount, viewer } = sharedContextViewer({ now: false })
    viewer.getCanvas().remove()
    expect(healViewer(viewer, mount)).toBe('rebuild')
    expect(viewer.resize).not.toHaveBeenCalled()
    mount.remove()
  })
})
