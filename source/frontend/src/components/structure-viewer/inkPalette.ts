import { INK_KEYS, type InkPalette } from './annotationModel'

/**
 * Resolve the `--sv3d-ink-*` custom properties declared in structureViewer.css
 * into real colour strings.
 *
 * Canvas needs a literal colour and DESIGN.md §1.4 forbids hex literals in
 * .tsx/.ts styling code, so the values live in the stylesheet and are read back
 * here. When a custom property does not resolve — jsdom, or before the sheet is
 * applied — the ink key itself is used: every member of INK_KEYS is also a valid
 * CSS colour keyword, so the fallback needs no hex either.
 *
 * This is the one DOM-touching helper of the annotation module; the geometry in
 * annotationModel.ts stays DOM-free so it can be unit-tested.
 */
export function resolveInkPalette(el: HTMLElement | null): InkPalette {
  const out = {} as InkPalette
  const style = el ? window.getComputedStyle(el) : null
  for (const key of INK_KEYS) {
    const v = style?.getPropertyValue(`--sv3d-ink-${key}`)?.trim()
    out[key] = v && v.length > 0 ? v : key
  }
  return out
}

/** Colours for the burned-in capture caption (`compositeScreenshot.ts`). */
export interface NotePalette {
  bg: string
  fg: string
}

/**
 * Resolve the caption band's own colours.
 *
 * Deliberately NOT the ink black/white: §6.2.1 justifies those two as PEN
 * colours that must stay visible on top of an arbitrarily coloured molecule,
 * and the black one carries a comment about reading brown over cartoon.
 * Retuning the pens for that reason should not silently restyle a text band
 * that has nothing to do with pens, so the band gets its own locals — with the
 * same fallback discipline: a CSS colour keyword, never a hex literal here.
 */
export function resolveNotePalette(el: HTMLElement | null): NotePalette {
  const style = el ? window.getComputedStyle(el) : null
  const read = (name: string, fallback: string): string => {
    const v = style?.getPropertyValue(name)?.trim()
    return v && v.length > 0 ? v : fallback
  }
  return {
    bg: read('--sv3d-note-bg', 'black'),
    fg: read('--sv3d-note-fg', 'white'),
  }
}
