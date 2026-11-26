import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import { readFlag, writeFlag } from './storedFlag'

/** Where "the guide was seen" is kept (this browser only). */
export const GUIDE_SEEN_KEY = 'agroDesign.proteinViewerPack.guideSeen'

/** A control the guide points at; it carries `data-guide="<target>"` in whichever layout is shown. */
export type GuideTarget = 'engine' | 'export'

/** What the guide points at: the full edition's mode switch and Export, the light edition's Export. */
export const GUIDE_TARGETS_FULL: readonly GuideTarget[] = Object.freeze(['engine', 'export'])
export const GUIDE_TARGETS_LIGHT: readonly GuideTarget[] = Object.freeze(['export'])

/**
 * Is the first-run guide still to be shown in this browser? Once closed it
 * stays closed for this visit, and for later ones where the browser keeps
 * storage (`storedFlag.ts`); where it does not, a later visit shows it again.
 */
export function useFirstRunGuide(): { pending: boolean; dismiss: () => void } {
  const [pending, setPending] = useState(() => !readFlag(GUIDE_SEEN_KEY))
  const dismiss = useCallback(() => {
    writeFlag(GUIDE_SEEN_KEY)
    setPending(false)
  }, [])
  return { pending, dismiss }
}

/** Room kept between a bubble and the window's edge, its control, and the other bubble (CSS px). */
const EDGE = 8
const GAP = 10
/** The arrow stays this far inside the bubble's ends. */
const ARROW_INSET = 16

type Place = { left: number; top: number; side: 'below' | 'above'; arrow: number }
type Box = { left: number; top: number; width: number; height: number }

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const overlaps = (a: Box, b: Box) => a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height

/** What a keyboard reaches: the controls a bubble describes. */
const FOCUSABLE = 'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])'

/** The shown control for a target: the one of its layout that has a size. */
function anchorOf(target: GuideTarget): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(`[data-guide="${target}"]`)) {
    const r = el.getBoundingClientRect()
    if (r.width > 0 && r.height > 0) return el
  }
  return null
}

/**
 * Where each bubble goes: under its control when there is room (the
 * desktop header), else over it (the phone's bottom bar), centred on it and
 * kept inside the window. A bubble that would cover one placed before it
 * goes beside that one when the row has room (a phone: the two side by
 * side, each over its own button), else further from its control. A target
 * whose control is not shown gets no place, and its bubble stays hidden.
 */
export function placeBubbles(targets: readonly GuideTarget[], sizeOf: (t: GuideTarget) => { width: number; height: number } | null, view: { width: number; height: number }, anchorRect: (t: GuideTarget) => DOMRect | null): Map<GuideTarget, Place> {
  const placed: Box[] = []
  const places = new Map<GuideTarget, Place>()
  for (const target of targets) {
    const a = anchorRect(target)
    const size = sizeOf(target)
    if (a === null || size === null) continue
    const { width, height } = size
    // Under the control if it fits there, else over it if it fits there, else the side with
    // more room, the bubble then kept inside the window (PT-9918 item 4: a short window).
    const roomBelow = view.height - EDGE - (a.bottom + GAP)
    const roomAbove = a.top - GAP - EDGE
    const side = roomBelow >= height ? 'below' : roomAbove >= height ? 'above' : roomBelow >= roomAbove ? 'below' : 'above'
    const maxLeft = Math.max(EDGE, view.width - EDGE - width)
    const maxTop = Math.max(EDGE, view.height - EDGE - height)
    let left = clamp(a.left + a.width / 2 - width / 2, EDGE, maxLeft)
    let top = clamp(side === 'below' ? a.bottom + GAP : a.top - GAP - height, EDGE, maxTop)
    const free = (l: number, tp: number) => !placed.some(p => overlaps({ left: l, top: tp, width, height }, p))
    if (!free(left, top)) {
      // Beside the bubble in the way when the row has room (the phone's bar: side by side, each by
      // its control), else further from the control.
      const hit = placed.find(p => overlaps({ left, top, width, height }, p))!
      const beside = [hit.left - EDGE - width, hit.left + hit.width + EDGE].filter(l => l >= EDGE && l <= maxLeft && free(l, top))
      if (beside.length > 0) left = beside.reduce((x, y) => (Math.abs(y - left) < Math.abs(x - left) ? y : x))
      else
        for (let i = 0; i < placed.length * 2 && !free(left, top); i++) {
          const block = placed.find(p => overlaps({ left, top, width, height }, p))!
          top = side === 'below' ? block.top + block.height + EDGE : block.top - EDGE - height
        }
      // Inside the window above all: a short one may have to let the two touch.
      top = clamp(top, EDGE, maxTop)
    }
    placed.push({ left, top, width, height })
    places.set(target, { left, top, side, arrow: clamp(a.left + a.width / 2 - left, ARROW_INSET, width - ARROW_INSET) })
  }
  return places
}

/**
 * The first-run guide (owner 2026-11-19: 初心者向けガイド): speech bubbles
 * over the page pointing at the mode switch — PC the toggle at the top
 * right, a phone the bar's 「モード」 — and at Export, the way to save this
 * app with a structure in it. The light edition has no mode switch: Export
 * alone. Any press anywhere (mouse, touch or pen) or Esc closes it, and the
 * press still does what it does (owner: 画面クリックすると消える); it takes
 * no focus and blocks nothing (UI consult, Opus and Codex astra). While it
 * is up each control is described by its bubble (`aria-describedby`).
 * Its fade-in stops under reduced motion (CSS).
 */
export function FirstRunGuide(props: {
  /** `GUIDE_TARGETS_FULL` or `GUIDE_TARGETS_LIGHT`: one array for the guide's life (its layout follows it). */
  targets: readonly GuideTarget[]
  onDismiss: () => void
}) {
  const { targets, onDismiss } = props
  const { t } = useTranslation(['htmlExport'])
  const engineId = useId()
  const exportId = useId()
  const ids = useMemo(() => ({ engine: engineId, export: exportId }), [engineId, exportId])
  const bubbles = useRef(new Map<GuideTarget, HTMLDivElement>())
  const [places, setPlaces] = useState<Map<GuideTarget, Place> | null>(null)

  const layout = useCallback(() => {
    setPlaces(
      placeBubbles(
        targets,
        target => {
          const el = bubbles.current.get(target)
          return el === undefined ? null : { width: el.offsetWidth, height: el.offsetHeight }
        },
        { width: window.innerWidth, height: window.innerHeight },
        target => anchorOf(target)?.getBoundingClientRect() ?? null,
      ),
    )
  }, [targets])

  useLayoutEffect(() => {
    layout()
    window.addEventListener('resize', layout)
    window.addEventListener('scroll', layout, true)
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => layout())
    ro?.observe(document.body)
    return () => {
      window.removeEventListener('resize', layout)
      window.removeEventListener('scroll', layout, true)
      ro?.disconnect()
    }
  }, [layout])

  // Any press or Esc closes it; the press goes on to what it was for.
  useEffect(() => {
    const press = () => onDismiss()
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss()
    }
    document.addEventListener('pointerdown', press, true)
    document.addEventListener('keydown', key, true)
    return () => {
      document.removeEventListener('pointerdown', press, true)
      document.removeEventListener('keydown', key, true)
    }
  }, [onDismiss])

  // Each control is described by its bubble while the guide is up: the anchor itself when it
  // is a control, else the controls in it that a keyboard reaches (a computer's mode switch is
  // a group of radios; PT-9918 item 2).
  useEffect(() => {
    const undo: (() => void)[] = []
    for (const target of targets) {
      const anchor = anchorOf(target)
      if (anchor === null) continue
      const controls = anchor.matches(FOCUSABLE) ? [anchor] : Array.from(anchor.querySelectorAll<HTMLElement>(FOCUSABLE))
      for (const el of controls) {
        const before = el.getAttribute('aria-describedby')
        el.setAttribute('aria-describedby', before === null ? ids[target] : `${before} ${ids[target]}`)
        undo.push(() => {
          if (before === null) el.removeAttribute('aria-describedby')
          else el.setAttribute('aria-describedby', before)
        })
      }
    }
    return () => undo.forEach(u => u())
  }, [targets, ids])

  const text = (target: GuideTarget) => (target === 'engine' ? t('htmlExport:sa_guide_engine') : t('htmlExport:sa_guide_export'))
  return createPortal(
    <div className={`sav-guide${targets.length > 1 ? ' sav-guide--pair' : ''}`} role="note" aria-label={t('htmlExport:sa_guide_label')}>
      {targets.map(target => {
        const place = places?.get(target)
        const style: CSSProperties =
          place === undefined ? { visibility: 'hidden' } : ({ left: place.left, top: place.top, '--sav-guide-arrow': `${place.arrow}px` } as CSSProperties)
        return (
          <div
            key={target}
            id={ids[target]}
            ref={el => {
              if (el === null) bubbles.current.delete(target)
              else bubbles.current.set(target, el)
            }}
            className={`sav-guide-bubble sav-guide-bubble--${place?.side ?? 'below'}`}
            data-target={target}
            style={style}
          >
            <p className="sav-guide-text">{text(target)}</p>
            {/* Said once, by Export's bubble: every layout and edition has Export. */}
            {target === 'export' && <p className="sav-guide-close">{t('htmlExport:sa_guide_close')}</p>}
          </div>
        )
      })}
    </div>,
    document.body,
  )
}
