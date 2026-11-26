/**
 * PyMOL's object panel as the page sees it (owner 2026-11-19): the button or
 * name a click would press, from PyMOL's own layout rules.
 */
import { describe, expect, it } from 'vitest'

import { controlTailRect, mouseBoxEstimate, mouseBoxRect, mouseBoxTabRoom, panelLayoutOf, panelSpotAt, type PanelLayout } from './panelGeometry'

/** A 1000 × 600 buffer drawn on a 500 × 300 canvas (DPR 2, display scale 2): PyMOL's defaults doubled. */
const L: PanelLayout = { bw: 1000, bh: 600, px: 440, lh: 36, tw: 34, ts: 32, cm: 4, ops: 5, rows: 3, bottom: 328 }

describe('panelLayoutOf', () => {
  it('reads a guiwidth report with geometry, and refuses one without it or with a bad count', () => {
    const m = { type: 'guiwidth', ...L }
    expect(panelLayoutOf(m)).toEqual(L)
    expect(panelLayoutOf({ type: 'guiwidth', px: 440, bw: 1000 })).toBeNull()
    expect(panelLayoutOf({ ...m, lh: 'tall' })).toBeNull()
    expect(panelLayoutOf({ ...m, rows: -1 })).toBeNull()
    expect(panelLayoutOf({ ...m, ops: 7 })).toBeNull()
    expect(panelLayoutOf({ ...m, bw: 0 })).toBeNull()
  })
})

describe('panelSpotAt', () => {
  const at = (x: number, y: number) => panelSpotAt(L, x, y, 500, 300)

  it('a click at the right edge of the first row presses C; the next button left is L, then H, S, A', () => {
    // CSS (499, 10): device (998, 20) → row (20 − 4) ÷ 36 = 0, button (1000 − 998 − 1) ÷ 34 = 0 from the right.
    expect(at(499, 10)).toEqual({ kind: 'button', button: 'C', control: null, row: 0, x: (1000 - 34) / 2, y: 0, w: 16, h: 35 / 2, panelX: (1000 - 440) / 2 })
    expect(at(499 - 17, 10)?.button).toBe('L')
    expect(at(499 - 34, 10)?.button).toBe('H')
    expect(at(499 - 51, 10)?.button).toBe('S')
    expect(at(499 - 68, 10)?.button).toBe('A')
  })

  it('the last pixel column, at any canvas scale, is the rightmost button, never one past it (PT-9924 item 3)', () => {
    // CSS 499.9 on a 2× buffer is device 999.8: PyMOL's pixel 999, button 0 from the right.
    expect(at(499.9, 10)?.button).toBe('C')
    expect(panelSpotAt({ ...L, ops: 6 }, 499.9, 10, 500, 300)?.button).toBe('M')
    // A canvas whose CSS width does not divide the buffer evenly (DPR 1.5).
    expect(panelSpotAt(L, 666.6, 10, 666.67, 300)?.button).toBe('C')
  })

  it('left of the buttons, the row’s name (a click shows or hides it), as wide as the panel leaves', () => {
    const s = at(320, 30)
    expect(s).toMatchObject({ kind: 'name', button: null, row: 1, x: (1000 - 440) / 2, w: (440 - 5 * 34) / 2 })
  })

  it('nothing left of the panel, under its last row, or where the wizard and mouse box sit', () => {
    expect(at(200, 10)).toBeNull()
    // Row 3 does not exist (3 rows: 'all' and two names).
    expect(at(499, 4 / 2 + (3 * 36) / 2 + 1)).toBeNull()
    // A long list: rows that would run into the blocks under the rows' area are none.
    const many = { ...L, rows: 100 }
    expect(panelSpotAt(many, 499, (600 - 328 - 10) / 2, 500, 300)).toBeNull()
    expect(panelSpotAt(many, 499, (600 - 328 - 40) / 2, 500, 300)?.kind).toBe('button')
  })

  it('in the 3-Button Motions mouse mode a sixth button, M, is the rightmost', () => {
    const six = { ...L, ops: 6 }
    expect(panelSpotAt(six, 499, 10, 500, 300)?.button).toBe('M')
    expect(panelSpotAt(six, 499 - 17, 10, 500, 300)?.button).toBe('C')
    expect(panelSpotAt(six, 499 - 85, 10, 500, 300)?.button).toBe('A')
  })

  it('a click 1 device px under a row’s top still counts for the row above (PyMOL’s 2 px click margin)', () => {
    // Device y 37 is drawn in row 1, and (37 − 4) ÷ 36 = 0: PyMOL presses row 0.
    expect(at(499, 37 / 2)?.row).toBe(0)
    expect(at(499, 41 / 2)?.row).toBe(1)
  })
})

describe('the blocks under the rows (owner 2026-11-20: 下側のボタンにも)', () => {
  // Display scale 2: the movie buttons' row 40 high at the foot (no movie panel), the mouse box 80 over it.
  const LOW: PanelLayout = { ...L, bottom: 120, lower: { mv: 0, ct: 40, bm: 80, nf: 1 } }
  const at = (x: number, y: number) => panelSpotAt(LOW, x, y, 500, 300)

  it('reads the lower blocks only when every field is there and they fit under the rows', () => {
    const m = { type: 'guiwidth', ...L, bottom: 120, mv: 0, ct: 40, bm: 80, nf: 1 }
    expect(panelLayoutOf(m)?.lower).toEqual({ mv: 0, ct: 40, bm: 80, nf: 1 })
    expect(panelLayoutOf({ ...m, nf: undefined })?.lower).toBeUndefined()
    expect(panelLayoutOf({ ...m, bm: 200 })?.lower).toBeUndefined()
    expect(panelLayoutOf({ ...m, ct: 0 })?.lower).toBeUndefined()
  })

  it('the movie buttons: nine equal parts right of PyMOL’s 8-unit nub, in a 17-unit band 2 under the row’s top', () => {
    // Device: the row spans y 560–600, the band y 564–598; the buttons x 576–1000 (424 wide, 47.1 each).
    const y = 580 / 2
    expect(at(577 / 2, y)).toMatchObject({ kind: 'control', control: 'rewind', button: null, row: -1 })
    expect(at(625 / 2, y)?.control).toBe('back')
    expect(at(999 / 2, y)?.control).toBe('full')
    expect(at(950 / 2, y)?.control).toBe('rock')
    // The nub left of them (it drags the panel's width) and the band's margins press nothing.
    expect(at(570 / 2, y)).toBeNull()
    expect(at(800 / 2, 561 / 2)).toBeNull()
    expect(at(999 / 2, y)).toMatchObject({ y: 564 / 2, h: 34 / 2, panelX: 560 / 2 })
  })

  it('the mouse box: its two foot lines change the selection unit, the lines over them the mouse mode', () => {
    // The box spans y 480–560; its foot lines (24 units = 48 px) y 512–560.
    expect(at(700 / 2, 540 / 2)).toMatchObject({ kind: 'mouse-select', control: null, y: 512 / 2, h: 48 / 2 })
    expect(at(700 / 2, 490 / 2)).toMatchObject({ kind: 'mouse-mode', y: 480 / 2, h: 32 / 2 })
  })

  it('above the blocks the rows answer as before, and a movie panel at the very foot is no button', () => {
    expect(at(499, 10)?.button).toBe('C')
    const movie = { ...LOW, bottom: 160, lower: { mv: 40, ct: 40, bm: 80, nf: 30 } }
    expect(panelSpotAt(movie, 999 / 2, 590 / 2, 500, 300)).toBeNull()
    expect(panelSpotAt(movie, 999 / 2, 540 / 2, 500, 300)?.control).toBe('full')
  })
})

describe('mouseBoxRect (owner 2026-11-21: the Mouse Mode lines under a lid)', () => {
  it('is the mouse box in CSS px: the panel’s width, over the movie buttons and the movie panel', () => {
    const low: PanelLayout = { ...L, bottom: 160, lower: { mv: 40, ct: 40, bm: 80, nf: 30 } }
    // Buffer 1000 × 600 on a 500 × 300 canvas: the box's top is 600 − 40 − 40 − 80 = 440 device px.
    expect(mouseBoxRect(low, 500, 300)).toEqual({ x: (1000 - 440) / 2, y: 440 / 2, w: 440 / 2, h: 80 / 2 })
  })

  it('is null without the lower blocks or a canvas size', () => {
    expect(mouseBoxRect(L, 500, 300)).toBeNull()
    const low: PanelLayout = { ...L, bottom: 120, lower: { mv: 0, ct: 40, bm: 80, nf: 1 } }
    expect(mouseBoxRect(low, 0, 300)).toBeNull()
  })
})

describe('mouseBoxEstimate (PT-10470 item 6: covered before the worker says where)', () => {
  it('is PyMOL’s default box at the foot of the panel, 40 units (124 with the grid) over a 20-unit row', () => {
    // Display scale 2 on DPR 2: a unit is 1 CSS px.
    expect(mouseBoxEstimate(500, 300, 220, 2, 2, false)).toEqual({ x: 280, y: 300 - 20 - 40, w: 220, h: 40 })
    expect(mouseBoxEstimate(500, 300, 220, 2, 2, true)).toEqual({ x: 280, y: 300 - 20 - 124, w: 220, h: 124 })
    // Display scale 2 on DPR 1: two CSS px a unit.
    expect(mouseBoxEstimate(500, 300, 220, 2, 1, false)).toEqual({ x: 280, y: 300 - 40 - 80, w: 220, h: 80 })
  })

  it('is null without a canvas, a panel or a scale', () => {
    expect(mouseBoxEstimate(0, 300, 220, 2, 2, false)).toBeNull()
    expect(mouseBoxEstimate(500, 300, 0, 2, 2, false)).toBeNull()
    expect(mouseBoxEstimate(500, 300, 220, 0, 2, false)).toBeNull()
  })
})

describe('mouseBoxTabRoom (PT-10470 item 2: the tab above the box covers nothing)', () => {
  // No wizard: the rows' area ends where the box begins (bottom = ct + bm), at device y 600 − 120 = 480.
  const low: PanelLayout = { ...L, bottom: 120, lower: { mv: 0, ct: 40, bm: 80, nf: 1 } }
  it('fits when the drawn rows end a tab’s height above the box', () => {
    // 3 rows of 36 end at 108; a 24 CSS px tab is 48 device px: 108 + 48 ≤ 480.
    expect(mouseBoxTabRoom(low, 300, 24)).toBe(true)
  })

  it('does not when the rows reach down to it, or a wizard’s lines sit above it', () => {
    // 13 rows fit in 480 (13 × 36 = 468): 468 + 48 > 480.
    expect(mouseBoxTabRoom({ ...low, rows: 40 }, 300, 24)).toBe(false)
    expect(mouseBoxTabRoom({ ...low, rows: 13 }, 300, 24)).toBe(false)
    // 12 rows end at 432: the tab just fits (432 + 48 = 480).
    expect(mouseBoxTabRoom({ ...low, rows: 12 }, 300, 24)).toBe(true)
    // The measurement wizard's 5 lines (5 × 36 + 4) between the rows and the box.
    expect(mouseBoxTabRoom({ ...low, bottom: 120 + 184 }, 300, 24)).toBe(false)
    expect(mouseBoxTabRoom(L, 300, 24)).toBe(false)
  })
})

describe('controlTailRect (owner 2026-11-21: 「Seq」 and ▼ over PyMOL’s S, ▼ and F)', () => {
  it('is the movie row’s last three of nine slots, where panelSpotAt finds seq, rock and full', () => {
    const low: PanelLayout = { ...L, bottom: 120, lower: { mv: 0, ct: 40, bm: 80, nf: 1 } }
    const r = controlTailRect(low, 500, 300)!
    // Right of the 16-device-px nub from x 560: 424 px in nine parts; the seventh starts at 576 + floor(6 × 424 / 9) = 858.
    expect(r).toEqual({ x: 858 / 2, y: (600 - 40 + 4) / 2, w: (1000 - 858) / 2, h: 34 / 2 })
    expect(panelSpotAt(low, r.x + 1, r.y + 1, 500, 300)?.control).toBe('seq')
    expect(panelSpotAt(low, r.x - 1, r.y + 1, 500, 300)?.control).toBe('end')
    expect(panelSpotAt(low, r.x + r.w - 1, r.y + 1, 500, 300)?.control).toBe('full')
  })

  it('is null without the lower blocks or a canvas size', () => {
    expect(controlTailRect(L, 500, 300)).toBeNull()
    expect(controlTailRect({ ...L, bottom: 120, lower: { mv: 0, ct: 40, bm: 80, nf: 1 } }, 500, 0)).toBeNull()
  })
})
