import { Fragment, useEffect, useId, useMemo, useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { formatSI } from '../../src/utils/formatSI'
import { residueLetter, SEQ_MAX, type SeqReport } from './pymolSeq'

/** The row's height (CSS px; .sav-seq in standalone.css): the 「配列」 tag and the box hang below it. */
export const SEQ_STRIP_H = 40

/**
 * The sequence over the top of PyMOL's view, and its 「配列」 tag (owner
 * 2026-11-21: 「PyMOLの右上に『配列』タグをつけて、クリックすると、配列が展開する
 * （下のSを押したときと同じ）」; 「配列を出しているとき配列の文字をオブジェクトの
 * ボタンをマウスオーバーした時と同様に光らせる。また、マウスオーバーと対応した
 * ところの残基が一時的に目立つようにする…左上あたりに半透明にウインドウを出して、
 * どのオブジェクトの何番目のなんという残基かを表示する」; UI consult, Opus 5.5
 * and Codex astra).
 *
 * The page draws it, not PyMOL (PyMOL's own sequence says nothing on a
 * hover): one row, scrolled sideways, each chain headed by its object and
 * chain, a residue number over every tenth. The residue under the mouse — or
 * tapped, or moved to with ← → once the row has the focus — is lit as the
 * panel's buttons are under the mouse, PyMOL shows it for the moment
 * (`onHover`, the worker's `_agdb_seq_hl`), and a see-through box at the
 * top left says which: the object, the chain, the residue's number and
 * name. The mouse leaving, Esc, or the row closing takes it down. The
 * residues are drawn once a list (up to 20,000 of them); the lit one is
 * marked on its element, so a hover draws nothing again (PR #10172's
 * review). The box stays in the document while empty: a live region that
 * comes and goes is not read out.
 */
export function PymolSeqStrip(props: {
  /** The band over the view it lies in, CSS px in the stage. */
  rect: { x: number; y: number; w: number }
  report: SeqReport | undefined
  /** The residue lit (its index in `report.res`), or null. */
  lit: number | null
  onHover: (index: number | null) => void
}) {
  const { rect, report, lit, onHover } = props
  const { t } = useTranslation()
  const infoId = useId()
  const row = useRef<HTMLDivElement | null>(null)
  const res = report?.res ?? []
  // Each chain's first residue: where its heading goes.
  const heads = useMemo(() => {
    const s = new Set<number>()
    for (let i = 0; i < res.length; i++) if (i === 0 || res[i][0] !== res[i - 1][0] || res[i][1] !== res[i - 1][1]) s.add(i)
    return s
  }, [res])
  // The lit residue marked on its element, and kept in sight when the keyboard moves it.
  useEffect(() => {
    if (lit === null) return
    const el = row.current?.querySelector<HTMLElement>(`[data-i="${lit}"]`)
    if (!el) return
    el.classList.add('is-lit')
    if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    return () => el.classList.remove('is-lit')
  }, [lit, res])
  // The residues, drawn once a list.
  const cells = useMemo(
    () =>
      report === undefined
        ? null
        : res.map((r, i) => (
            <Fragment key={i}>
              {heads.has(i) && (
                <span className="sav-seq-chain" aria-hidden="true">
                  /{report.objs[r[0]]}/{r[1] === '' ? '-' : r[1]}
                </span>
              )}
              <span className="sav-seq-res" data-i={i} aria-hidden="true">
                {(heads.has(i) || /^-?\d*0$/.test(r[2])) && <span className="sav-seq-num">{r[2]}</span>}
                {residueLetter(r[3])}
              </span>
            </Fragment>
          )),
    [report, res, heads],
  )

  const indexAt = (target: EventTarget | null): number | null => {
    const el = target instanceof Element ? target.closest<HTMLElement>('[data-i]') : null
    const i = el === null ? NaN : Number(el.dataset.i)
    return Number.isInteger(i) && i >= 0 && i < res.length ? i : null
  }
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') return
    const i = indexAt(e.target)
    if (i !== null && i !== lit) onHover(i)
  }
  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    const i = indexAt(e.target)
    if (i !== null) onHover(i)
  }
  const onLeave = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'touch') onHover(null)
  }
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (res.length === 0) return
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault()
      const from = lit ?? (e.key === 'ArrowRight' ? -1 : res.length)
      onHover(Math.max(0, Math.min(res.length - 1, from + (e.key === 'ArrowRight' ? 1 : -1))))
    } else if (e.key === 'Escape' && lit !== null) {
      e.preventDefault()
      e.stopPropagation()
      onHover(null)
    }
  }
  const shown = lit !== null && lit < res.length ? res[lit] : null
  const info =
    shown === null || report === undefined
      ? ''
      : t('htmlExport:sa_pymol_seq_info', { obj: report.objs[shown[0]] ?? '', chain: shown[1] === '' ? '-' : shown[1], resi: shown[2], resn: shown[3] })
  return (
    <>
      <div className="sav-seq" style={{ left: rect.x, top: rect.y, width: rect.w, height: SEQ_STRIP_H }}>
        <div
          ref={row}
          className="sav-seq-row"
          role="group"
          tabIndex={0}
          aria-label={t('htmlExport:sa_pymol_seq_label')}
          aria-describedby={infoId}
          onPointerMove={onMove}
          onPointerDown={onDown}
          onPointerLeave={onLeave}
          onKeyDown={onKey}
          onBlur={() => onHover(null)}
        >
          {report === undefined ? (
            <span className="sav-seq-note">{t('htmlExport:sa_pymol_seq_loading')}</span>
          ) : res.length === 0 ? (
            <span className="sav-seq-note">{t('htmlExport:sa_pymol_seq_none')}</span>
          ) : (
            cells
          )}
          {report?.more === true && <span className="sav-seq-note">{t('htmlExport:sa_pymol_seq_more', { n: formatSI(SEQ_MAX) })}</span>}
        </div>
      </div>
      {/* Which residue, at the top left, see-through; said to assistive technology too. */}
      <div id={infoId} className={`sav-seq-info${info === '' ? ' is-empty' : ''}`} style={{ left: rect.x + 8, top: rect.y + SEQ_STRIP_H + 6 }} role="status">
        {info}
      </div>
    </>
  )
}
