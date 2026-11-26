import { paintStrokes, type InkPalette, type StageSize, type Stroke } from './annotationModel'
import { resolveNotePalette, type NotePalette } from './inkPalette'

/** Give up waiting for the captured frame to decode rather than hang the button. */
const IMAGE_LOAD_TIMEOUT_MS = 10_000

/** Caption size at 1x; it scales with the capture, then shrinks to fit. */
const NOTE_FONT_PX = 13
/** Below this the caption is not worth drawing, so it is dropped instead. */
const NOTE_MIN_FONT_PX = 9
/** Enough to read the text, sheer enough not to hide the molecule behind it. */
const NOTE_BAND_ALPHA = 0.72
/**
 * The most of the image the band may cover. Without a cap the band is derived
 * from a font size derived from `scale`, and `scale` is a ratio of two things
 * measured at different moments — so a stale stage rect can produce a band
 * taller than the picture it is annotating.
 */
const NOTE_MAX_BAND_FRACTION = 0.2

/**
 * The caption, with everything needed to draw it.
 *
 * Text and palette are ONE object rather than two sibling options because they
 * are useless apart: as independent optionals a caller could pass the sentence
 * without the colours and the caption would silently not be drawn — no type
 * error, no runtime warning, just a capture missing the warning it was supposed
 * to carry. That is the same silent-omission shape as PT-366 itself.
 */
export interface StaleNote {
  /** Already translated — this module never calls `t()`. */
  text: string
  /**
   * Canvas needs literal colour strings and this module must not carry hex
   * (`DESIGN.md` §1.4), so the caller resolves them from CSS custom properties.
   */
  palette: NotePalette
}

export interface CompositeOptions {
  /**
   * Burn a caption into the image saying the annotation predates the view.
   *
   * The freehand ink is SCREEN space and does not follow the molecule
   * (`DESIGN.md` §6.2.3), so a capture taken after the camera moved shows the
   * drawing at coordinates that no longer mean anything. On screen the viewer
   * says so — the stale note and the dimmed overlay — but a downloaded PNG
   * carries none of that, and the person who opens it later is usually not the
   * person who took it. This is the only signal that travels with the artefact.
   *
   * Owner decision (2026-08-26, PT-366): mark the image rather than suppress
   * the ink or move the annotation into model space.
   */
  staleNote?: StaleNote
}

/**
 * Caption options for a capture, or nothing when the ink is still in register.
 *
 * Lives here, beside the option it builds, so every capture path answers the
 * question the same way.
 */
export function staleCaptureNote(isStale: boolean, stage: HTMLElement | null, text: string): CompositeOptions {
  return isStale ? { staleNote: { text, palette: resolveNotePalette(stage) } } : {}
}

/**
 * Burn the freehand annotation into a 3Dmol screenshot.
 *
 * `viewer.pngURI()` is `getCanvas().toDataURL('image/png')` on the WebGL canvas
 * alone, so the overlay — a separate stacked 2D canvas — is absent from every
 * capture path. Without
 * this step the headline workflow (annotate, then press the camera button)
 * silently produces an unannotated PNG.
 *
 * Strokes are stored normalised to 0..1, so positions need no conversion; only
 * the line width does, because 3Dmol renders its canvas at the device pixel
 * ratio and the captured image is therefore larger than the on-screen stage.
 *
 * Never throws and never rejects: on any failure the original capture is
 * returned, because losing the annotation is much better than losing the shot.
 */
export async function compositeAnnotation(
  pngDataUri: string,
  strokes: readonly Stroke[],
  palette: InkPalette,
  onScreen: StageSize,
  opts: CompositeOptions = {},
): Promise<string> {
  if (strokes.length === 0) return pngDataUri
  try {
    const img = await loadImage(pngDataUri)
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth || img.width
    canvas.height = img.naturalHeight || img.height
    if (canvas.width <= 0 || canvas.height <= 0) return pngDataUri
    const ctx = canvas.getContext('2d')
    // jsdom (and any browser that hands back a bitmaprenderer canvas) has no 2D
    // context — return the untouched capture rather than failing the save.
    if (!ctx) return pngDataUri
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    paintAnnotationOnto(ctx, { width: canvas.width, height: canvas.height }, strokes, palette, onScreen, opts)
    return canvas.toDataURL('image/png')
  } catch {
    return pngDataUri
  }
}

/**
 * The strokes and the stale caption onto a canvas that already holds the
 * capture (`canvas` its size), as `compositeAnnotation` draws them. The
 * offline app's PyMOL pictures come here from an ImageBitmap: a 4× picture is
 * past what a data: URI carries in some browsers (PR #10244's review). Throws
 * what the strokes' drawing throws; the caption's own failure is reported and
 * skipped.
 */
export function paintAnnotationOnto(
  ctx: CanvasRenderingContext2D,
  canvas: StageSize,
  strokes: readonly Stroke[],
  palette: InkPalette,
  onScreen: StageSize,
  opts: CompositeOptions = {},
): void {
  const scale = onScreen.width > 0 ? canvas.width / onScreen.width : 1
  paintStrokes(ctx, strokes, canvas, palette, { scale })
  // THIS try — here, around the call — is what saves the ink. Without it a
  // throw inside `paintStaleNote` lands in the caller's catch and returns
  // the un-composited original, costing the annotation this module exists to
  // preserve. (`paintStaleNote` has a try of its own, but only a `finally`
  // that restores ctx state; it catches nothing.) The caption is optional;
  // the ink is not.
  if (opts.staleNote) {
    try {
      paintStaleNote(ctx, canvas, opts.staleNote, scale)
    } catch (err) {
      // Reported, not silent. The burned-in caption is the ONLY stale
      // warning that travels with a downloaded PNG, so a permanently broken
      // font stack would otherwise strip it from every capture forever with
      // nothing anywhere to diagnose from.
      console.warn('stale-capture caption skipped', err)
    }
  }
}

/**
 * The size the caption starts at, before either shrink loop.
 *
 * Exported because the clamp is the whole point and it is otherwise
 * unobservable: it changes only how many times the band-cap loop iterates,
 * never a pixel, so no recording canvas can catch its removal.
 *
 * `bandFor(px) >= px`, so a font taller than the entire band is already too
 * big — clamping to the cap costs nothing and bounds the loop by the IMAGE.
 * Without it the loop is as long as `scale`, which is a ratio against a stage
 * rect measured at another moment: a sub-pixel width turns a save into
 * millions of iterations.
 */
export function noteStartFontPx(stageHeight: number, scale: number): number {
  const wanted = Math.round(NOTE_FONT_PX * Math.max(scale, 1))
  return Math.max(NOTE_MIN_FONT_PX, Math.min(wanted, maxBandFor(stageHeight)))
}

/** The band's ceiling, in one place — the clamp and the give-up share it. */
function maxBandFor(stageHeight: number): number {
  return Math.floor(stageHeight * NOTE_MAX_BAND_FRACTION)
}

/**
 * A caption band across the foot of the capture.
 *
 * Three things this has to survive, because `scale` is a ratio of the captured
 * canvas to a stage rect measured at a DIFFERENT moment (the viewer can be
 * resized in between), so it is not trustworthy:
 *
 * - **The band is capped and clamped.** An inflated scale would otherwise make
 *   a band taller than the image, and a short capture would put its top edge at
 *   a negative y — covering the whole picture while drawing the text off-canvas,
 *   i.e. destroying the image and failing to mark it in the same stroke.
 * - **The text is measured and shrunk to fit.** The font scales with the device
 *   pixel ratio, not with the stage's width, so a narrow stage clips the
 *   sentence — and a full-width band gives the reader no hint it was cut.
 * - **Below a floor it is dropped rather than drawn illegibly**, since an
 *   unreadable warning is worse than none: it costs image area and says nothing.
 *   That applies to a sentence too LONG at the floor as much as to a band too
 *   tall: half a warning is not half as useful, it is a mystery.
 */
function paintStaleNote(
  ctx: CanvasRenderingContext2D,
  stage: StageSize,
  note: StaleNote,
  scale: number,
): void {
  const text = note.text
  const maxBandH = maxBandFor(stage.height)
  const font = (px: number) => `600 ${px}px system-ui, sans-serif`
  const padFor = (px: number) => Math.round(px * 0.6)
  const bandFor = (px: number) => px + padFor(px) * 2

  let fontPx = noteStartFontPx(stage.height, scale)
  while (fontPx > NOTE_MIN_FONT_PX && bandFor(fontPx) > maxBandH) fontPx -= 1
  ctx.save()
  try {
    // MEASUREMENT runs before the first paint — `ctx.font` and every
    // `measureText` here, `fillRect`/`fillText` only past the give-up check
    // below — so a font stack that fails while measuring leaves the capture
    // untouched instead of stamping a bare band across the molecule.
    //
    // ⚠️ It is measurement that is protected, not painting. `fillText` is
    // itself a font-stack op and runs AFTER the band is committed, and a
    // `fillRect` cannot be un-painted, so a throw between the two still yields
    // a bare band. Accepted rather than fixed: the two calls traverse the same
    // shaping path with the same font and string, so a fillText-only failure
    // needs the context to die mid-call — and a context that dies takes
    // `toDataURL` with it anyway. Making it total means compositing the band
    // on a scratch canvas and blitting it in one `drawImage`; that is the fix
    // if this ever proves reachable.
    ctx.font = font(fontPx)
    const avail = () => stage.width - padFor(fontPx) * 2
    // Measured unconditionally, because the band cap above can already have
    // driven the font to the floor — and the previous `while (fontPx > FLOOR
    // && tooWide)` then skipped the measurement entirely and drew the text
    // with no width check at all.
    let width = ctx.measureText(text).width
    while (width > avail() && fontPx > NOTE_MIN_FONT_PX) {
      fontPx -= 1
      ctx.font = font(fontPx)
      width = ctx.measureText(text).width
    }
    const padPx = padFor(fontPx)
    const bandH = bandFor(fontPx)
    // Still doesn't fit at the smallest readable size — too tall for this
    // picture, or too long for its width. Say nothing rather than ruin the
    // capture, or run the sentence off the right edge with no ellipsis and no
    // hint to the reader that there was more of it.
    if (bandH > maxBandH || width > avail()) return
    const y = stage.height - bandH
    ctx.textBaseline = 'middle'
    ctx.globalAlpha = NOTE_BAND_ALPHA
    ctx.fillStyle = note.palette.bg
    ctx.fillRect(0, y, stage.width, bandH)
    ctx.globalAlpha = 1
    ctx.fillStyle = note.palette.fg
    ctx.fillText(text, padPx, y + bandH / 2)
  } finally {
    ctx.restore()
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const timer = setTimeout(() => reject(new Error('screenshot image load timed out')), IMAGE_LOAD_TIMEOUT_MS)
    img.onload = () => { clearTimeout(timer); resolve(img) }
    img.onerror = () => { clearTimeout(timer); reject(new Error('screenshot image failed to load')) }
    img.src = src
  })
}
