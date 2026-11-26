/**
 * Retiring a 3Dmol viewer, and telling when the live one can no longer draw.
 *
 * 3Dmol has no teardown, so `retireViewer` empties a viewer's scene, detaches
 * it from its mount element and removes its canvas. A viewer drawing through
 * the shared OffscreenCanvas WebGL context is not told when that context is
 * lost, so `viewerFault` reads `getRenderer().isLost()` to tell when the live
 * viewer can no longer draw, and `healViewer` brings it back (owner report
 * 2026-11-11).
 */

/** The parts of a 3Dmol GLViewer this module touches. */
interface ViewerLike {
  clear?: () => void
  spin?: (axis: unknown) => void
  getCanvas?: () => HTMLCanvasElement | null | undefined
  getRenderer?: () => { isLost?: () => boolean } | null | undefined
  resize?: () => void
  render?: () => void
  container?: unknown
  divwatcher?: { disconnect?: () => void } | null
  intwatcher?: { disconnect?: () => void } | null
}

function loseContext(canvas: HTMLCanvasElement): void {
  for (const kind of ['webgl2', 'webgl'] as const) {
    try {
      const gl = canvas.getContext(kind) as WebGLRenderingContext | null
      const ext = gl?.getExtension('WEBGL_lose_context')
      if (ext) {
        ext.loseContext()
        return
      }
    } catch {
      // A canvas that holds the other kind of context throws or returns null.
    }
  }
}

/**
 * Takes a viewer out of use for good: empties its scene, cuts it off from the
 * mount element (so a later `resize()` finds a zero-size, canvas-less
 * container and does nothing) and removes its canvas. A context of its own is
 * freed (a grid viewer, or a browser without `OffscreenCanvas`); the shared
 * one cannot be reached from the page's canvas and is left alone. `mount` is
 * emptied too when given. Never throws.
 */
export function retireViewer(viewer: unknown, mount?: Element | null): void {
  const v = viewer as ViewerLike | null | undefined
  if (v) {
    try { v.spin?.(false) } catch {}
    try { v.clear?.() } catch {}
    try { v.divwatcher?.disconnect?.() } catch {}
    try { v.intwatcher?.disconnect?.() } catch {}
    let canvas: HTMLCanvasElement | null = null
    try { canvas = v.getCanvas?.() ?? null } catch {}
    try { v.container = document.createElement('div') } catch {}
    if (canvas) {
      try { delete (canvas as unknown as Record<string, unknown>)._3dmol_viewer } catch {}
      loseContext(canvas)
      try { canvas.remove() } catch {}
    }
  }
  if (mount) {
    try { mount.replaceChildren() } catch {}
  }
}

export type ViewerFault = 'context-lost' | 'canvas-detached' | 'canvas-replaced'

/**
 * Why the live viewer cannot draw into `mount`, or null when it can: its
 * context is lost, its canvas left the document, or another canvas sits in the
 * mount element in its place.
 */
export function viewerFault(viewer: unknown, mount: Element | null): ViewerFault | null {
  const v = viewer as ViewerLike | null | undefined
  if (!v || !mount) return null
  let canvas: HTMLCanvasElement | null = null
  try { canvas = v.getCanvas?.() ?? null } catch {}
  if (!canvas) return null
  if (!canvas.isConnected || !mount.contains(canvas)) return 'canvas-detached'
  const canvases = mount.querySelectorAll('canvas')
  if (canvases.length !== 1 || canvases[0] !== canvas) return 'canvas-replaced'
  // The renderer knows; the page's canvas holds only a bitmaprenderer when
  // 3Dmol draws through its shared OffscreenCanvas context.
  try {
    const lost = v.getRenderer?.()?.isLost?.()
    if (lost === true) return 'context-lost'
    if (lost === false) return null
  } catch {}
  for (const kind of ['webgl2', 'webgl'] as const) {
    try {
      const gl = canvas.getContext(kind) as WebGLRenderingContext | null
      if (gl) return gl.isContextLost() ? 'context-lost' : null
    } catch {}
  }
  return null
}

export type HealResult = 'ok' | 'healed' | 'rebuild'

/**
 * Brings a viewer that cannot draw back, in place when it can: a lost context
 * is what 3Dmol's own `resize()` regenerates (new context, same scene, same
 * camera), so nothing on the page has to be replayed. `rebuild` when that did
 * not help or the canvas itself is gone: the caller makes a new viewer.
 */
export function healViewer(viewer: unknown, mount: Element | null): HealResult {
  const fault = viewerFault(viewer, mount)
  if (fault === null) return 'ok'
  if (fault !== 'context-lost') return 'rebuild'
  const v = viewer as ViewerLike
  try {
    v.resize?.()
    v.render?.()
  } catch {
    return 'rebuild'
  }
  return viewerFault(viewer, mount) === null ? 'healed' : 'rebuild'
}
