import { ERASER_TOLERANCE_PX } from './annotationModel'

/**
 * The pointer while the pen or the eraser is armed (owner 2026-11-12): a pen
 * and an eraser instead of a crosshair and a cell, on both engines (the ink
 * canvas takes the pointer over 3Dmol and over PyMOL alike, so a CSS cursor on
 * it is all either needs). 24 px; the pen's
 * hot spot is its tip and its tip is the chosen ink, outlined black and white
 * so a white or yellow tip still shows; the eraser is a ring as wide as what
 * it hits (`ERASER_TOLERANCE_PX` each side), its hot spot the centre. Each
 * falls back to the old cursor where image cursors are not drawn.
 *
 * Colours are CSS keywords or the ink as `resolveInkPalette` read it from the
 * stylesheet (DESIGN.md §1.4: no hex literal in .ts styling code).
 */

const SIZE = 24

function svgCursor(svg: string, x: number, y: number, fallback: string): string {
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${x} ${y}, ${fallback}`
}

/** The pen, its tip at the bottom left in the ink `color`. */
export function penCursor(color: string): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${SIZE}' height='${SIZE}' viewBox='0 0 24 24'>`
    + `<path d='M3 21l1.6-5.6L16.2 3.8l4 4L8.6 19.4z' fill='white' stroke='black' stroke-width='1.4' stroke-linejoin='round'/>`
    + `<path d='M3 21l1.6-5.6 4 4z' fill='${color}' stroke='black' stroke-width='1' stroke-linejoin='round'/>`
    + `<path d='M14 6l4 4' stroke='black' stroke-width='1.2'/>`
    + `</svg>`
  return svgCursor(svg, 3, 21, 'crosshair')
}

/** The eraser: a ring the width of its reach. */
export function eraserCursor(): string {
  const r = ERASER_TOLERANCE_PX
  const c = SIZE / 2
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${SIZE}' height='${SIZE}' viewBox='0 0 24 24'>`
    + `<circle cx='${c}' cy='${c}' r='${r}' fill='white' fill-opacity='0.55' stroke='black' stroke-width='1.5'/>`
    + `<circle cx='${c}' cy='${c}' r='${r - 1.6}' fill='none' stroke='white' stroke-width='1'/>`
    + `<circle cx='${c}' cy='${c}' r='1.2' fill='black'/>`
    + `</svg>`
  return svgCursor(svg, c, c, 'cell')
}
