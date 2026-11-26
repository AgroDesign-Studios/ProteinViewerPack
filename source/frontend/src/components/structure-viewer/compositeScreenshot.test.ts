/**
 * compositeScreenshot — burning the freehand ink, and the caption that says the
 * ink predates the view (PT-366).
 *
 * jsdom has no real 2D context, so the canvas is stubbed with a recording
 * double: what these tests hold is the DRAWING CONTRACT — which calls are made,
 * in what order, with what text — not the pixels. The pixels are a Playwright
 * concern. The one thing a recording double cannot fake is the early-return
 * paths, and those are asserted on the returned data URI instead.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'

import { compositeAnnotation, noteStartFontPx } from './compositeScreenshot'
import type { InkPalette, Stroke } from './annotationModel'

const PNG = 'data:image/png;base64,ORIGINAL'
const COMPOSITED = 'data:image/png;base64,COMPOSITED'

const palette = { red: 'red', blue: 'blue', yellow: 'yellow', green: 'green', black: 'black', white: 'white' } as InkPalette
const notePalette = { bg: 'black', fg: 'white' }

/** `600 26px system-ui, sans-serif` -> 26 */
function fontSizeOf(font: string): number {
  return Number(/(\d+)px/.exec(font)?.[1] ?? 13)
}

/**
 * Total advance width in em, approximating `600 Npx system-ui`.
 *
 * Three classes, because one number per character is what made the ja caption
 * look half as wide as it is: CJK and kana are full-width, bold lowercase
 * Latin averages ~0.55em, and spaces and thin punctuation ~0.3em. Still an
 * approximation — a real browser is the Playwright job — but close enough that
 * the give-up thresholds these tests assert are the ones a browser would hit.
 */
function advanceEm(text: string): number {
  let em = 0
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0
    if ((c >= 0x3000 && c <= 0x9fff) || (c >= 0xff00 && c <= 0xff60)) em += 1
    else if (' .,:;-\'"'.includes(ch)) em += 0.3
    else em += 0.55
  }
  return em
}

const EN_NOTE = 'Note: the drawing is at its pre-view-change position'
const JA_NOTE = '\u6ce8\u8a18: \u3053\u306e\u753b\u50cf\u306e\u624b\u66f8\u304d\u306f'
  + '\u8996\u70b9\u5909\u66f4\u524d\u306e\u4f4d\u7f6e\u3067\u3059'

const stroke: Stroke = { id: 1, ink: 'red', points: [{ x: 0.1, y: 0.1 }, { x: 0.4, y: 0.4 }] }

/** A recording 2D context plus the canvas that hands it out. */
function stubCanvas(width = 800, height = 600) {
  const ctx = {
    save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
    stroke: vi.fn(), drawImage: vi.fn(), fillRect: vi.fn(), fillText: vi.fn(),
    // Per CHARACTER, not per string: a CJK glyph is about twice the advance
    // width of a Latin one, so a uniform 0.6em model made the ja caption look
    // LESS THAN HALF as wide as the en one (0.44x) when it is really ~0.83x —
    // nearly as wide. Every shrink and give-up threshold here depends on that
    // ratio, so the two strings must reach the give-up at similar widths.
    measureText: vi.fn((t: string) => ({ width: advanceEm(t) * fontSizeOf(ctx.font) })),
    globalAlpha: 1, lineCap: '', lineJoin: '', lineWidth: 0, font: '', textBaseline: '',
    fillStyle: '', strokeStyle: '',
  }
  const canvas = {
    width: 0, height: 0,
    getContext: vi.fn(() => ctx),
    toDataURL: vi.fn(() => COMPOSITED),
  }
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    if (tag === 'canvas') return canvas as unknown as HTMLCanvasElement
    return document.createElementNS('http://www.w3.org/1999/xhtml', tag) as HTMLElement
  })
  // jsdom's Image never loads a data: URI, so resolve it by hand.
  class FakeImage {
    naturalWidth = width
    naturalHeight = height
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    set src(_v: string) { queueMicrotask(() => this.onload?.()) }
  }
  vi.stubGlobal('Image', FakeImage)
  return { ctx, canvas }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('without a caption', () => {
  it('returns the capture untouched when there is no ink', async () => {
    // Nothing to misplace, so there is nothing to say either.
    const out = await compositeAnnotation(PNG, [], palette, { width: 400, height: 300 })
    expect(out).toBe(PNG)
  })

  it('burns the ink in and writes no text', async () => {
    const { ctx } = stubCanvas()
    const out = await compositeAnnotation(PNG, [stroke], palette, { width: 400, height: 300 })
    expect(out).toBe(COMPOSITED)
    expect(ctx.stroke).toHaveBeenCalled()
    expect(ctx.fillText).not.toHaveBeenCalled()
  })
})

describe('with a caption (PT-366)', () => {
  it('writes the caption text into the image', async () => {
    // The point of the whole change: the note has to travel with the artefact,
    // because the person who opens the PNG later is usually not the person who
    // took it and the on-screen banner never reaches them.
    const { ctx } = stubCanvas()
    await compositeAnnotation(PNG, [stroke], palette, { width: 400, height: 300 }, {
      staleNote: { text: EN_NOTE, palette: notePalette },
    })
    expect(ctx.fillText).toHaveBeenCalledTimes(1)
    expect(ctx.fillText.mock.calls[0][0])
      .toBe('Note: the drawing is at its pre-view-change position')
  })

  it('draws the caption AFTER the ink, so the ink cannot cover it', async () => {
    const { ctx } = stubCanvas()
    await compositeAnnotation(PNG, [stroke], palette, { width: 400, height: 300 }, {
      staleNote: { text: 'note', palette: notePalette },
    })
    const lastStroke = Math.max(...ctx.stroke.mock.invocationCallOrder)
    expect(ctx.fillText.mock.invocationCallOrder[0]).toBeGreaterThan(lastStroke)
  })

  it('keeps the band inside the image', async () => {
    // A band drawn past the bottom edge is invisible, which is the same as not
    // marking the image at all.
    const { ctx } = stubCanvas(800, 600)
    await compositeAnnotation(PNG, [stroke], palette, { width: 400, height: 300 }, {
      staleNote: { text: 'note', palette: notePalette },
    })
    const [x, y, w, h] = ctx.fillRect.mock.calls[0]
    expect(x).toBe(0)
    expect(w).toBe(800)
    expect(y).toBeGreaterThan(0)
    expect(y + h).toBe(600)
  })

  it('scales the caption with the capture, not with the stage', async () => {
    // 3Dmol renders at the device pixel ratio, so the captured image is bigger
    // than the stage; a fixed font size would be unreadably small on a 2x shot.
    const big = stubCanvas(800, 600)
    await compositeAnnotation(PNG, [stroke], palette, { width: 400, height: 300 }, { staleNote: { text: 'n', palette: notePalette } })
    const bigBand = big.ctx.fillRect.mock.calls[0][3]
    vi.restoreAllMocks()
    vi.unstubAllGlobals()

    const small = stubCanvas(400, 300)
    await compositeAnnotation(PNG, [stroke], palette, { width: 400, height: 300 }, { staleNote: { text: 'n', palette: notePalette } })
    const smallBand = small.ctx.fillRect.mock.calls[0][3]

    expect(bigBand).toBeGreaterThan(smallBand)
  })

  it('says nothing when there is no ink, even if asked to', async () => {
    // No strokes means nothing is mis-positioned; a caption would be a warning
    // about a problem the image does not have.
    const out = await compositeAnnotation(PNG, [], palette, { width: 400, height: 300 }, {
      staleNote: { text: 'note', palette: notePalette },
    })
    expect(out).toBe(PNG)
  })

  it('keeps the burned-in ink when the caption cannot be drawn', async () => {
    // The caption is optional; the ink is not. Before its own try/catch, a
    // throw here fell through to the outer catch and returned the ORIGINAL —
    // silently discarding the annotation this module exists to preserve.
    const { ctx } = stubCanvas()
    ctx.fillText = vi.fn(() => { throw new Error('font unavailable') })
    const out = await compositeAnnotation(PNG, [stroke], palette, { width: 400, height: 300 }, {
      staleNote: { text: 'note', palette: notePalette },
    })
    expect(out).toBe(COMPOSITED)
    expect(ctx.stroke).toHaveBeenCalled()
  })

  it('shrinks the caption until it fits the width', async () => {
    // The font scales with the device pixel ratio, NOT with the stage width, so
    // a long sentence on a narrow stage used to run off the right edge — and a
    // full-width band gives the reader no hint the text was cut.
    const { ctx } = stubCanvas(300, 300)
    const long = EN_NOTE
    await compositeAnnotation(PNG, [stroke], palette, { width: 300, height: 300 }, {
      staleNote: { text: long, palette: notePalette },
    })
    const drawn = fontSizeOf(ctx.font)
    // Drawn, not dropped — without this the give-up path satisfies the case
    // that is named "shrinks until it FITS".
    expect(ctx.fillText).toHaveBeenCalledTimes(1)
    expect(drawn).toBeLessThan(13)
    // Against the space the text actually gets, not the whole stage: the
    // padding on both sides is the difference between fitting and clipping.
    const avail = 300 - Math.round(drawn * 0.6) * 2
    expect(ctx.measureText(long).width).toBeLessThanOrEqual(avail)
  })

  it('says nothing rather than swallow a tiny capture', async () => {
    // A 1x1 image cannot carry a band: the old arithmetic put its top edge at a
    // negative y, so the band covered the whole picture and the text landed off
    // canvas — destroying the image AND failing to mark it.
    const { ctx } = stubCanvas(1, 1)
    const out = await compositeAnnotation(PNG, [stroke], palette, { width: 400, height: 300 }, {
      staleNote: { text: 'note', palette: notePalette },
    })
    expect(ctx.fillRect).not.toHaveBeenCalled()
    expect(ctx.fillText).not.toHaveBeenCalled()
    expect(out).toBe(COMPOSITED)
  })

  it('caps the band however inflated the scale is', async () => {
    // `scale` is a ratio of two things measured at different moments (the
    // viewer can be resized in between), so a stale stage rect can make it
    // enormous. The band must stay a caption, not become the picture.
    const { ctx } = stubCanvas(800, 600)
    await compositeAnnotation(PNG, [stroke], palette, { width: 40, height: 30 }, {
      staleNote: { text: 'note', palette: notePalette },
    })
    const bandH = ctx.fillRect.mock.calls[0][3]
    expect(bandH).toBeLessThanOrEqual(600 * 0.2)
  })

  it('never starts at a font size the image cannot hold', () => {
    // `scale` is a ratio against a stage rect measured at another moment, so a
    // sub-pixel stage width makes it enormous. The clamp changes only how many
    // times the shrink loop runs — never a pixel — so no recording canvas can
    // catch its removal, and the guarantee has to be asserted on the arithmetic
    // itself. Unclamped, a 0.001px stage means ~10.4M decrements per save.
    expect(noteStartFontPx(600, 800_000)).toBeLessThanOrEqual(Math.floor(600 * 0.2))
    expect(noteStartFontPx(600, 2)).toBe(26)
    // Never below the readable floor, however small the picture.
    expect(noteStartFontPx(1, 1)).toBe(9)
  })

  it('uses the caption palette, not the pen inks', async () => {
    // The pen black/white are justified as colours that stay visible over a
    // molecule; retuning them must not restyle a text band.
    const { ctx } = stubCanvas()
    const fills: string[] = []
    ctx.fillRect = vi.fn(() => { fills.push(ctx.fillStyle) })
    ctx.fillText = vi.fn(() => { fills.push(ctx.fillStyle) })
    await compositeAnnotation(PNG, [stroke], palette, { width: 400, height: 300 }, {
      staleNote: { text: 'note', palette: { bg: 'rebeccapurple', fg: 'gold' } },
    })
    expect(fills).toEqual(['rebeccapurple', 'gold'])
  })

  it('drops the caption rather than run it off the right edge', async () => {
    // The give-up branch used to test band HEIGHT only, so a sentence still too
    // long at the 9px floor was drawn anyway and clipped mid-word — no
    // ellipsis, no hint there had been more. A warning the reader cannot finish
    // is worse than none: it costs image area and conveys nothing.
    const { ctx } = stubCanvas(200, 300)
    const long = EN_NOTE
    const out = await compositeAnnotation(PNG, [stroke], palette, { width: 200, height: 300 }, {
      staleNote: { text: long, palette: notePalette },
    })
    expect(ctx.fillText).not.toHaveBeenCalled()
    expect(ctx.fillRect).not.toHaveBeenCalled()
    expect(out).toBe(COMPOSITED)
  })

  it('measures the text even when the band cap already hit the font floor', async () => {
    // `while (fontPx > FLOOR && tooWide)` short-circuits on the FIRST clause, so
    // a capture short enough to drive the font to 9px skipped the width check
    // entirely and drew unmeasured text. Height and width are separate limits.
    const { ctx } = stubCanvas(200, 100)
    await compositeAnnotation(PNG, [stroke], palette, { width: 200, height: 100 }, {
      staleNote: { text: EN_NOTE, palette: notePalette },
    })
    expect(ctx.measureText).toHaveBeenCalled()
  })

  it('measures the Japanese caption at nearly the width of the English one', async () => {
    // The ja sentence is 23 characters against the en one's 52, so a stub that
    // charges one advance width per character called it less than half as wide.
    // Its ~21 CJK glyphs are full-width, which puts it at ~0.85x the en string
    // — close enough that the two give up on almost the same captures. Under
    // the old model ja looked comfortably safe while en was the tight case,
    // and no test used the ja string to notice.
    const { ctx } = stubCanvas(400, 300)
    // Through the context the code measures with, at one fixed size — comparing
    // the helper against itself would assert the stub's model, not the code's
    // view of it.
    ctx.font = '600 10px system-ui, sans-serif'
    const ratio = ctx.measureText(JA_NOTE).width / ctx.measureText(EN_NOTE).width
    expect(ratio).toBeGreaterThan(0.75)
    expect(ratio).toBeLessThan(1)

    await compositeAnnotation(PNG, [stroke], palette, { width: 400, height: 300 }, {
      staleNote: { text: JA_NOTE, palette: notePalette },
    })
    expect(ctx.fillText).toHaveBeenCalledTimes(1)
    expect(ctx.fillText.mock.calls[0][0]).toBe(JA_NOTE)
  })

  it('drops the Japanese caption too when the capture is too narrow for it', async () => {
    // Same give-up rule, exercised through the string that reaches it first.
    const { ctx } = stubCanvas(180, 300)
    await compositeAnnotation(PNG, [stroke], palette, { width: 180, height: 300 }, {
      staleNote: { text: JA_NOTE, palette: notePalette },
    })
    expect(ctx.fillText).not.toHaveBeenCalled()
    expect(ctx.fillRect).not.toHaveBeenCalled()
  })

  it('leaves no bare band when the font stack fails while measuring', async () => {
    // Ordering, not luck: `fillRect` commits pixels that nothing can take back,
    // so every op that can throw on a broken font stack runs before it. Paint
    // first and the failure mode is an opaque unexplained bar across the
    // molecule WITH no text in it — the image degraded to say nothing.
    const { ctx } = stubCanvas()
    ctx.measureText = vi.fn(() => { throw new Error('font unavailable') })
    const out = await compositeAnnotation(PNG, [stroke], palette, { width: 400, height: 300 }, {
      staleNote: { text: 'note', palette: notePalette },
    })
    expect(ctx.fillRect).not.toHaveBeenCalled()
    expect(ctx.stroke).toHaveBeenCalled()
    expect(out).toBe(COMPOSITED)
  })
})
