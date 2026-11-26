import { useCallback, useEffect, useRef } from 'react'
import type { ViewerAnnotation } from '../../components/structure-viewer/useViewerAnnotation'

/**
 * Whether the lines over the card's PyMOL still sit on their atoms, judged
 * line by line (PT-8779). Each line keeps the camera it was drawn at — PyMOL's
 * camera token as the page last heard it, or null while PyMOL was not ready
 * yet. The ink is in register only while every standing line was drawn at the
 * camera on screen.
 *
 * The layer's 0.5 s poll marks the ink when the camera moves under it, and
 * re-bases on every new line. This hook covers what the poll cannot see:
 *
 * - a line added (or erased) after a move the poll had not seen yet: the older
 *   lines are off their atoms whatever the new one says, so the ink is marked
 *   (PR #7843 review);
 * - a line drawn while the camera was unknown: a later line, at a known
 *   camera, does not vouch for it (the poll's rule: a camera that only now
 *   became known is another one too);
 * - the out-of-register lines erased, every line left drawn at this camera:
 *   the mark is lifted, rather than kept for good.
 *
 * Returns the check the picture save runs, so a picture taken after a move the
 * poll has not seen still gets its caption.
 */
export function usePymolInkRegister(annotation: ViewerAnnotation, viewToken: () => string | null): () => boolean {
  const drawnAt = useRef(new Map<number, string | null>())
  const { strokes, markStale, clearStale } = annotation
  useEffect(() => {
    const seen = drawnAt.current
    const standing = new Set(strokes.map(s => s.id))
    let erased = false
    for (const id of [...seen.keys()]) {
      if (!standing.has(id)) {
        seen.delete(id)
        erased = true
      }
    }
    if (strokes.length === 0) return
    const now = viewToken()
    let added = false
    for (const s of strokes) {
      if (!seen.has(s.id)) {
        seen.set(s.id, now)
        added = true
      }
    }
    if (!added && !erased) return
    const inRegister = [...seen.values()].every(at => at === now)
    // markStale after addStroke's own setStale(false): the later update wins.
    if (!inRegister) markStale()
    else if (!added) clearStale()
  }, [strokes, viewToken, markStale, clearStale])
  return useCallback(() => {
    const now = viewToken()
    for (const at of drawnAt.current.values()) if (at !== now) return true
    return false
  }, [viewToken])
}
