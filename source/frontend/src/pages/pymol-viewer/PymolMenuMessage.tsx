import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * The menu's status line (a preset's note, a menu command's failure) with a
 * way to put it away (owner 2026-11-19: 「リガンド周辺（5 Å）」's long note
 * could not be closed). It shows its first lines (two; the phone layout one,
 * by CSS); 「詳しく」 shows the rest in place, 「たたむ」 folds it again, and ×
 * takes the line away (`onDismiss`, the runner's `clear`: a note still on its
 * way does not come back either). No timer: a long note must be readable
 * at the reader's pace (WCAG 2.2.1; UI consult, Opus and Codex astra).
 *
 * The `<p role="status">` is always in the document, empty or not, so every
 * new message is announced whole, folded or not (PT-3755 item 4); the two
 * buttons sit outside it, and 「詳しく」 only while the text is cut.
 */
export function PymolMenuMessage(props: {
  message: string
  /** × pressed: empty the line (and move the focus somewhere that stays). */
  onDismiss: () => void
}) {
  const { message, onDismiss } = props
  const { t } = useTranslation(['pymol'])
  const id = useId()
  const textRef = useRef<HTMLParagraphElement | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [cut, setCut] = useState(false)
  // A new message starts folded.
  useEffect(() => setExpanded(false), [message])
  // Folded, is anything hidden? Measured after layout, and again when the line's width changes.
  const measure = useCallback(() => {
    const el = textRef.current
    setCut(el !== null && el.scrollHeight > el.clientHeight + 1)
  }, [])
  useLayoutEffect(() => {
    if (!expanded) measure()
  }, [message, expanded, measure])
  useEffect(() => {
    const el = textRef.current
    if (el === null || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      if (!el.parentElement?.classList.contains('is-expanded')) measure()
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [measure])
  return (
    <div className={`pymolv-note${message === '' ? ' pymolv-note--empty' : ''}${expanded ? ' is-expanded' : ''}`}>
      <p ref={textRef} id={id} role="status" className="pymolv-menu-message">
        {message}
      </p>
      {message !== '' && (
        <div className="pymolv-note-actions">
          {(cut || expanded) && (
            <button type="button" className="btn btn-secondary btn-sm pymolv-note-more" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(e => !e)}>
              {expanded ? t('pymol:menu_message_less') : t('pymol:menu_message_more')}
            </button>
          )}
          <button
            type="button"
            className="btn btn-secondary btn-sm pymolv-note-close"
            aria-label={t('pymol:menu_message_close')}
            title={t('pymol:menu_message_close')}
            onClick={onDismiss}
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
      )}
    </div>
  )
}
