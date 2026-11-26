/**
 * 3Dmol.js's side of 「スクリーンショット（PNG）」 at a chosen resolution
 * (owner 2026-11-20: 「スクリーンショットでも解像度が選べるようにする」).
 *
 * 3Dmol.js draws its canvas at the browser's pixel ratio (twice the CSS size
 * at least, while it antialiases), which it reads from
 * `window.devicePixelRatio` each time the viewer is laid out. A picture
 * `scale` times as many pixels on a side is the same view laid out at that
 * ratio times `scale`: the molecule, the labels and the outline all grow
 * together, the composition stays. The ratio is shadowed for the one layout
 * (`devicePixelRatio` is a replaceable property of `window`), the view is
 * drawn and read, and the ratio and layout go back, all in one task: the
 * large canvas is never on screen.
 */

/** The canvas's size now, device px: what 「画面と同じ」 makes. */
export function dmolShotSize(viewer: any): { w: number; h: number } | null {
  const canvas: HTMLCanvasElement | null | undefined = viewer?.getCanvas?.()
  if (!canvas || canvas.width <= 0 || canvas.height <= 0) return null
  return { w: canvas.width, h: canvas.height }
}

/**
 * The view as a PNG data URI, `scale` (2–4) times the canvas's pixels on a
 * side; 1 is the canvas as it is. Throws when the browser made the canvas
 * smaller than asked (a GPU's limit): a smaller picture than the one chosen
 * is never handed back as it.
 */
export function dmolPngUri(viewer: any, scale: number, win: Window = window): string {
  if (!(scale > 1)) return viewer.pngURI()
  const canvas: HTMLCanvasElement = viewer.getCanvas()
  const cssW = parseFloat(canvas.style.width) || canvas.clientWidth || canvas.width
  const ratio = canvas.width / cssW
  const want = { w: canvas.width * scale, h: canvas.height * scale }
  const own = Object.getOwnPropertyDescriptor(win, 'devicePixelRatio')
  let uri: string
  try {
    Object.defineProperty(win, 'devicePixelRatio', { configurable: true, enumerable: true, get: () => ratio * scale })
    viewer.resize()
    viewer.render()
    // The buffer 3Dmol.js really drew: its renderer's context. 3Dmol.js 2.5 draws on a shared
    // OffscreenCanvas and only copies the bitmap to the page canvas, whose own WebGL context is
    // then null and whose width is just the number set (PT-10148 item 1; viewerRecovery.ts reads
    // the renderer the same way). A buffer this cannot see is not trusted.
    const gl = (viewer.getRenderer?.()?.getContext?.() ?? canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext | null
    if (gl === null || gl.isContextLost()) throw new Error(`${want.w} × ${want.h} px: the picture's buffer cannot be checked here`)
    const made = { w: gl.drawingBufferWidth, h: gl.drawingBufferHeight }
    if (Math.abs(made.w - want.w) > 1 || Math.abs(made.h - want.h) > 1) {
      throw new Error(`${want.w} × ${want.h} px: this device made ${made.w} × ${made.h}`)
    }
    uri = viewer.pngURI()
  } finally {
    if (own !== undefined) Object.defineProperty(win, 'devicePixelRatio', own)
    else delete (win as unknown as Record<string, unknown>).devicePixelRatio
    viewer.resize()
    viewer.render()
  }
  return uri
}
