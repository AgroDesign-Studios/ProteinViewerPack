import type { TFunction } from 'i18next'

/**
 * How a failed PyMOL command reads (the command line, the menu, the settings
 * dialog, the presets). Its own module, with no imports but i18next's type,
 * so those components can be bundled into the offline HTML export.
 */

/** The most of a detail this page did not write that a message carries. */
export const DETAIL_MAX_CHARS = 200

/** `s` on one line, cut to `max` characters (never inside a surrogate pair). */
export function clipText(s: string, max: number): string {
  const line = s.replace(/\s+/g, ' ').trim()
  const chars = Array.from(line)
  return chars.length <= max ? line : `${chars.slice(0, max).join('')}…`
}

/** The controller's own words for a frame that was not there to answer, in the user's language; null for anything else. */
export function frameGoneText(t: TFunction, raw: string): string | null {
  if (raw === 'no frame' || raw === 'PyMOL is not ready') return t('pymol:detail_not_ready')
  if (/^the PyMOL frame was (rebuilt|closed)$/.test(raw)) return t('pymol:detail_frame_gone')
  return null
}

/**
 * Why a command failed, as the command line, the menu and the settings
 * dialog say it (PT-3291 items 11, 20). The controller's own reasons read in
 * the user's language. Anything else is PyMOL's error text — up to 4,000
 * characters from the frame, which the user's own commands can write — so
 * it goes on one line, is cut to `DETAIL_MAX_CHARS` and is said to be what
 * PyMOL answered, never as this page's own words.
 */
export function commandDetailText(t: TFunction, e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e)
  if (raw === 'cancelled') return t('pymol:detail_cancelled')
  if (raw === 'the PyMOL frame was stopped') return t('pymol:detail_frame_stopped')
  return frameGoneText(t, raw) ?? t('pymol:detail_pymol_said', { text: clipText(raw, DETAIL_MAX_CHARS) })
}

/**
 * A failure's detail as the export dialog says it: the page's own failures in the user's
 * language, anything else on one line and cut to `DETAIL_MAX_CHARS`.
 */
export function exportDetailText(t: TFunction, e: unknown): string {
  // A TypeError is NOT read as "no answer" here: an export talks to no
  // server, and a client-side bug throws one too. A request that got no
  // answer is `NoAnswerError`, which `detailText` reads first (PT-4140).
  const raw = e instanceof Error ? e.message : String(e)
  const own = frameGoneText(t, raw)
  if (own !== null) return own
  // The gate refuses an answer past its deadline as well as a misshapen one;
  // a late one is not "the wrong shape", and pressing again is the remedy
  // (PT-4164 item 3).
  if (raw === 'export refused: expired') return t('pymol:detail_export_expired')
  if (raw === 'export-refused' || raw.startsWith('export refused') || raw === 'export answered with the wrong kind') {
    return t('pymol:detail_export_refused')
  }
  return clipText(raw, DETAIL_MAX_CHARS)
}
