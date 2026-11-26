import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { INK_KEYS } from './annotationModel'
import type { CursorMode, ViewerAnnotation } from './useViewerAnnotation'

interface Props {
  annotation: ViewerAnnotation
}

const CURSOR_MODES: CursorMode[] = ['default', 'laser', 'crosshair']

/**
 * Dense chip row for the annotation + pointer tools, mounted inside either
 * viewer's existing toolbar.
 *
 * Every control is a `<button aria-pressed>` rather than a `<select>`. That is
 * not cosmetic: a page test resolves the colour scheme with
 * `getByRole('combobox')` on the assumption that the Color select is the only
 * one in the toolbar, and `getByRole` throws on multiple matches — a second
 * select here would break those tests.
 */
export default function ViewerToolChips({ annotation }: Props) {
  const { t } = useTranslation('proteindb')
  // Two chip rows can be on one page (one per engine): the reason's id is this row's own.
  const emptyId = useId()
  const nothingId = useId()
  const { tool, setTool, ink, setInk, cursorMode, setCursorMode, strokes, clearStrokes } = annotation

  // Nothing to erase: the chip stays in place and says why (locked, not
  // hidden); `aria-disabled`, not `disabled`, so it keeps focus and its reason.
  const noInk = strokes.length === 0 && tool !== 'eraser'

  return (
    <div className="sv3d-chips">
      {/*
        One choice of three: what the mouse does on the view. The first chip is
        the way back from a tool, and shows that none is armed — before it the
        only sign of an armed tool was its own pressed chip, and a view that
        took no drag or wheel read as frozen (owner 2026-11-11).
      */}
      <div role="group" aria-label={t('proteindb:viewer_tool_group')} className="sv3d-chip-group">
      <button
        type="button"
        className="sv3d-chip"
        aria-pressed={tool === 'none'}
        onClick={() => setTool('none')}
        title={t('proteindb:viewer_navigate_hint')}
      >
        {t('proteindb:viewer_navigate')}
      </button>
      <button
        type="button"
        className="sv3d-chip"
        aria-pressed={tool === 'pen'}
        onClick={() => setTool('pen')}
        title={t('proteindb:viewer_pen_hint')}
      >
        {t('proteindb:viewer_pen')}
      </button>
      <button
        type="button"
        className="sv3d-chip"
        aria-pressed={tool === 'eraser'}
        aria-disabled={noInk || undefined}
        aria-describedby={noInk ? emptyId : undefined}
        onClick={() => { if (!noInk) setTool('eraser') }}
        title={noInk ? t('proteindb:viewer_eraser_empty') : t('proteindb:viewer_eraser_paused_hint')}
      >
        {t('proteindb:viewer_eraser')}
      </button>
      {noInk && <span id={emptyId} className="sr-only">{t('proteindb:viewer_eraser_empty')}</span>}
      </div>

      {/*
        Always drawn, so the row never changes height as a tool is picked or
        the first line is drawn: a row that wraps differently resizes PyMOL's
        view under the ink (UI consult 2026-11-12). Picking a colour takes up
        the pen; 「すべて消す」 is locked while there is nothing to clear.
      */}
      {INK_KEYS.map(key => (
        <button
          key={key}
          type="button"
          className={`sv3d-swatch sv3d-swatch-${key}`}
          // Pressed only while the pen is armed: at rest no colour is "on".
          aria-pressed={tool === 'pen' && ink === key}
          aria-label={t(`proteindb:viewer_ink_${key}`)}
          title={t(`proteindb:viewer_ink_${key}`)}
          onClick={() => { setInk(key); setTool('pen') }}
        />
      ))}

      <button
        type="button"
        className="sv3d-chip"
        aria-disabled={strokes.length === 0 || undefined}
        aria-describedby={strokes.length === 0 ? nothingId : undefined}
        title={strokes.length === 0 ? t('proteindb:viewer_eraser_empty') : undefined}
        onClick={() => { if (strokes.length > 0) clearStrokes() }}
      >
        {t('proteindb:viewer_ink_clear')}
      </button>
      {strokes.length === 0 && <span id={nothingId} className="sr-only">{t('proteindb:viewer_eraser_empty')}</span>}

      <span className="sv3d-sep" aria-hidden="true" />

      <span className="sv3d-chip-label">{t('proteindb:viewer_pointer_shape')}</span>
      {CURSOR_MODES.map(mode => (
        <button
          key={mode}
          type="button"
          className="sv3d-chip"
          aria-pressed={cursorMode === mode}
          onClick={() => setCursorMode(mode)}
        >
          {mode === 'default' ? t('proteindb:viewer_pointer_arrow') : t(`proteindb:viewer_cursor_${mode}`)}
        </button>
      ))}
    </div>
  )
}
