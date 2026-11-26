/**
 * PyMOL's object panel (its internal GUI, right of the view) as the page
 * sees it: where its rows and buttons are, so the page can mark the one under
 * the mouse (owner 2026-11-19: 「どのボタンにマウスが載っているかわかりにくい」),
 * and, under the rows, the mouse box and the row of movie buttons at its foot
 * (owner 2026-11-20: 「オブジェクトの下側のボタンにも」). A computer's only — or
 * a phone in 「オリジナル表示」, which has PyMOL's panel as v1.0.0 had it, but a
 * touch screen has no hover.
 *
 * The panel is drawn by PyMOL into the canvas, so the page knows it only from
 * PyMOL's own layout rules, which the worker reports in device px with the
 * object panel's width (`guiwidth`, `_agdb_guilayout` in the runtime's
 * `worker.js`; PyMOL's layer3/Executive.cpp, layer1/Ortho.cpp,
 * layer1/ButMode.cpp and layer1/Control.cpp): rows `lh` high from the
 * canvas's top, a click `cm` below a row's top counting for that row; `ops`
 * buttons (A S H L C, and M in the 3-Button Motions mouse mode) at the right
 * edge, each `tw` wide and `ts` drawn; the names left of them; `rows` rows
 * listed; the wizard, mouse box and movie controls `bottom` px high under the
 * rows' area. From the canvas's foot up: the movie panel (`mv`), the movie
 * buttons' row (`ct`), the mouse box (`bm`).
 */

/** The panel's geometry the worker reports, device px of a drawing buffer `bw` × `bh`. */
export interface PanelLayout {
  bw: number
  bh: number
  /** The panel's width. */
  px: number
  lh: number
  tw: number
  ts: number
  cm: number
  ops: number
  rows: number
  bottom: number
  /**
   * The blocks under the rows, from the canvas's foot up — the movie panel,
   * the movie buttons' row, the mouse box — and how many frames (or states)
   * the movie buttons step through; absent from a worker that does not say.
   */
  lower?: { mv: number; ct: number; bm: number; nf: number }
}

const FIELDS = ['bw', 'bh', 'px', 'lh', 'tw', 'ts', 'cm', 'ops', 'rows', 'bottom'] as const
const LOWER = ['mv', 'ct', 'bm', 'nf'] as const

const count = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0

/** The geometry in a worker's `guiwidth` report, or null when it carries none or a field is not a sane count. */
export function panelLayoutOf(m: Record<string, unknown>): PanelLayout | null {
  const out: Partial<Record<(typeof FIELDS)[number], number>> = {}
  for (const k of FIELDS) {
    const v = m[k]
    if (!count(v)) return null
    out[k] = v
  }
  const l = out as PanelLayout
  if (l.bw < 1 || l.bh < 1 || l.lh < 1 || l.tw < 1 || l.ops < 1 || l.ops > 6) return null
  // The lower blocks only when every field is there and they fit under the rows' area.
  if (LOWER.every(k => count(m[k]))) {
    const [mv, ct, bm, nf] = LOWER.map(k => m[k] as number)
    if (ct >= 1 && bm >= 1 && mv + ct + bm <= l.bottom) return { ...l, lower: { mv, ct, bm, nf } }
  }
  return l
}

/** PyMOL's buttons left to right (layer3/Executive.cpp draws A, S, H, L, C, then M). */
const BUTTONS = ['A', 'S', 'H', 'L', 'C', 'M'] as const
export type PanelButton = (typeof BUTTONS)[number]

/**
 * The movie buttons' row left to right (layer1/Control.cpp, `CControl::release`):
 * to the first frame, one back, stop, play, one on, to the last, the sequence
 * shown or not, rocking, and full screen.
 */
export const CONTROL_BUTTONS = ['rewind', 'back', 'stop', 'play', 'forward', 'end', 'seq', 'rock', 'full'] as const
export type ControlButton = (typeof CONTROL_BUTTONS)[number]

/** The movie buttons that step through frames: nothing to do with one (stop also stops rocking). */
export const FRAME_BUTTONS: ReadonlySet<ControlButton> = new Set(['rewind', 'back', 'play', 'forward', 'end'])

/** A spot of the panel in CSS px from the canvas's top-left. */
export interface PanelSpot {
  /**
   * A row's button, a row's name (a click shows or hides it), a movie button,
   * or the mouse box: its top lines (a click changes the mouse mode) or its
   * foot (a click changes what a click selects).
   */
  kind: 'button' | 'name' | 'control' | 'mouse-mode' | 'mouse-select'
  /** The row's button's letter; null otherwise. */
  button: PanelButton | null
  /** The movie button; null otherwise. */
  control: ControlButton | null
  /** The row; −1 under the rows. */
  row: number
  x: number
  y: number
  w: number
  h: number
  /** The panel's left edge: what the mark says goes left of it, over the view, covering no other button. */
  panelX: number
}

/**
 * What of the panel a click at (x, y) — CSS px from the canvas's top-left, the
 * canvas `cssW` × `cssH` — would press, with the spot as PyMOL draws it; null
 * left of the panel, under its last row, on the wizard, or in the movie
 * buttons' row off a button (its left nub, which drags the panel's width).
 * PyMOL's own hit tests: rows (CExecutive::click) row n = (y − cm) ÷ lh
 * from the top, button t = (right − x − 1) ÷ tw from the right edge; the
 * movie buttons (Control.cpp `which_button`) nine equal parts of the row
 * right of an 8-unit nub, a band 17 units high 2 under its top; the mouse
 * box (ButMode.cpp `CButMode::click`) its two 12-unit lines at the foot
 * against the rest. A unit is the display scale in device px (`tw` ÷ 17).
 */
export function panelSpotAt(l: PanelLayout, x: number, y: number, cssW: number, cssH: number): PanelSpot | null {
  if (!(cssW > 0) || !(cssH > 0)) return null
  const kx = l.bw / cssW
  const ky = l.bh / cssH
  // PyMOL hit-tests whole device pixels: the last pixel column is button 0's, never one past it (PT-9924 item 3).
  const dx = Math.floor(x * kx)
  const dy = Math.floor(y * ky)
  const left = l.bw - l.px
  if (dx < left || dx >= l.bw || dy < 0 || dy >= l.bh) return null
  const panelX = left / kx
  const lower = l.lower === undefined ? undefined : lowerSpotAt(l, l.lower, dx, dy)
  if (lower !== undefined) return lower === null ? null : { ...lower, x: lower.x / kx, y: lower.y / ky, w: lower.w / kx, h: lower.h / ky, panelX }
  const row = Math.floor((dy - l.cm) / l.lh)
  if (row < 0 || row >= l.rows) return null
  // The rows' area ends where the wizard and the mouse box begin.
  if ((row + 1) * l.lh > l.bh - l.bottom) return null
  const top = row * l.lh
  const t = Math.floor((l.bw - dx - 1) / l.tw)
  const css = (from: number, width: number) => ({ x: from / kx, y: top / ky, w: width / kx, h: (l.lh - 1) / ky, panelX })
  if (t < l.ops) {
    const i = l.ops - 1 - t
    return { kind: 'button', button: BUTTONS[i], control: null, row, ...css(l.bw - l.tw * (l.ops - i), l.ts) }
  }
  return { kind: 'name', button: null, control: null, row, ...css(left, l.bw - l.tw * l.ops - left) }
}

/**
 * The mouse box — the "Mouse Mode" lines over the movie buttons, with its
 * grid when `mouse_grid` is on — in CSS px from the canvas's top-left, on a
 * canvas `cssW` × `cssH`; null when the worker gave no lower blocks. The page
 * lays its lid over this (owner 2026-11-21: Mouse Mode hidden by default).
 */
export function mouseBoxRect(l: PanelLayout, cssW: number, cssH: number): { x: number; y: number; w: number; h: number } | null {
  const low = l.lower
  if (low === undefined || !(cssW > 0) || !(cssH > 0)) return null
  const kx = l.bw / cssW
  const ky = l.bh / cssH
  const bmTop = l.bh - low.mv - low.ct - low.bm
  return { x: (l.bw - l.px) / kx, y: bmTop / ky, w: l.px / kx, h: low.bm / ky }
}

/** The movie buttons the page draws over with its own (`PymolControlTail`, owner 2026-11-21): S, ▼ and F. */
export const TAIL_CONTROLS: ReadonlySet<ControlButton> = new Set(['seq', 'rock', 'full'])

/**
 * The last three slots of the movie buttons' row — PyMOL's S, ▼ and F — in
 * CSS px from the canvas's top-left (Control.cpp's nine equal parts right of
 * the nub, the 17-unit band 2 under the row's top, as `panelSpotAt` reads
 * them); null without the lower blocks or a canvas size.
 */
export function controlTailRect(l: PanelLayout, cssW: number, cssH: number): { x: number; y: number; w: number; h: number } | null {
  const low = l.lower
  if (low === undefined || !(cssW > 0) || !(cssH > 0)) return null
  const kx = l.bw / cssW
  const ky = l.bh / cssH
  const unit = l.tw / 17
  const from = l.bw - l.px + Math.round(8 * unit)
  const width = l.bw - from
  const x0 = from + Math.floor((6 * width) / CONTROL_BUTTONS.length)
  const top = l.bh - low.mv - low.ct + Math.round(2 * unit)
  return { x: x0 / kx, y: top / ky, w: (l.bw - x0) / kx, h: Math.round(17 * unit) / ky }
}

/**
 * The mouse box as PyMOL's defaults place it, before the worker has said
 * (PT-10470 item 6): no movie panel, the movie buttons' row 20 units and the
 * box 40 (124 with its grid) above the canvas's foot, as wide as the panel
 * (`panelCssW`, CSS px); a unit is `scale` device px, `dpr` device px a CSS
 * px. Null without a canvas or a panel.
 */
export function mouseBoxEstimate(cssW: number, cssH: number, panelCssW: number, scale: number, dpr: number, grid: boolean): { x: number; y: number; w: number; h: number } | null {
  if (!(cssW > 0) || !(cssH > 0) || !(panelCssW > 0) || !(scale > 0) || !(dpr > 0)) return null
  const unit = scale / dpr
  const h = (grid ? 124 : 40) * unit
  return { x: Math.max(0, cssW - panelCssW), y: cssH - 20 * unit - h, w: Math.min(cssW, panelCssW), h }
}

/**
 * Whether a tab `tabCssH` CSS px high fits above the mouse box without
 * covering what PyMOL draws there (PT-10470 item 2): no wizard's lines (they
 * sit right above the box) and the object rows PyMOL draws — those wholly
 * inside the rows' area — ending at least that high above the box.
 */
export function mouseBoxTabRoom(l: PanelLayout, cssH: number, tabCssH: number): boolean {
  const low = l.lower
  if (low === undefined || !(cssH > 0)) return false
  const ky = l.bh / cssH
  const bmTop = l.bh - low.mv - low.ct - low.bm
  if (l.bottom - low.mv - low.ct - low.bm > 0) return false
  const drawn = Math.min(l.rows, Math.max(0, Math.floor((l.bh - l.bottom) / l.lh)))
  return drawn * l.lh + tabCssH * ky <= bmTop
}

type DeviceSpot = Omit<PanelSpot, 'panelX'>

/**
 * The movie buttons' row and the mouse box at device (dx, dy): the spot in
 * device px, null in those blocks off anything a click presses, undefined
 * above them (the rows' area and the wizard).
 */
function lowerSpotAt(l: PanelLayout, low: NonNullable<PanelLayout['lower']>, dx: number, dy: number): DeviceSpot | null | undefined {
  const unit = l.tw / 17
  const ctTop = l.bh - low.mv - low.ct
  const bmTop = ctTop - low.bm
  if (dy < bmTop) return undefined
  // The movie panel (frames drawn as a strip at the very foot) is no button.
  if (dy >= l.bh - low.mv) return null
  const left = l.bw - l.px
  if (dy >= ctTop) {
    const from = left + Math.round(8 * unit)
    const bandTop = ctTop + Math.round(2 * unit)
    const bandH = Math.round(17 * unit)
    if (dx < from || dy < bandTop || dy >= bandTop + bandH) return null
    const width = l.bw - from
    const i = Math.min(CONTROL_BUTTONS.length - 1, Math.floor((CONTROL_BUTTONS.length * (dx - from)) / width))
    const x0 = from + Math.floor((i * width) / CONTROL_BUTTONS.length)
    const x1 = from + Math.floor(((i + 1) * width) / CONTROL_BUTTONS.length)
    return { kind: 'control', button: null, control: CONTROL_BUTTONS[i], row: -1, x: x0, y: bandTop, w: x1 - x0 - 1, h: bandH }
  }
  // The mouse box: its two foot lines change the selection unit, the rest the mouse mode.
  const footTop = ctTop - Math.round(24 * unit)
  if (dy >= footTop) return { kind: 'mouse-select', button: null, control: null, row: -1, x: left, y: footTop, w: l.px, h: ctTop - footTop }
  return { kind: 'mouse-mode', button: null, control: null, row: -1, x: left, y: bmTop, w: l.px, h: footTop - bmTop }
}
