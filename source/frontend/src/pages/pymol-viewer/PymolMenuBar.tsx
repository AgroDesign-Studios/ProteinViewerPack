import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactElement, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { useMatchMedia } from '../../hooks/useMatchMedia'
import { menuLabel } from './pymolKeys'
import { needsPymol, type LocalAction, type MenuNode } from './pymolMenuData'

/**
 * PyMOL's menu bar above the canvas, from the static data in
 * `pymolMenuData.ts`. Every label is rendered as React text — never parsed as
 * HTML, never followed as a link — and choosing an entry hands exactly its
 * `command` to `onCommand` (the page's `runCommand`), or its local action to
 * `onLocal`. Nothing else leaves this component.
 *
 * The ARIA menubar pattern: ←/→ across the bar, ↓ / Enter / Space opens, ↑/↓
 * Home/End inside a menu, → opens a submenu, ← and Escape close one level
 * and give focus back to what opened it, Tab closes everything and moves on.
 * The bar's one Tab stop follows focus (roving tabindex), and the pointer
 * takes focus along with it while focus is in the bar, so a submenu that
 * closes under the pointer never takes the focused entry with it (PT-3291
 * item 19).
 * Menus are `position: fixed` and placed from their opener's rectangle, so a
 * long submenu is clamped to the window and never clipped by the one it came
 * from. Each open level is its panel's sibling, never inside the one it came
 * from (`aria-controls` ties the opener to it): iOS WebKit clips a fixed
 * element to an ancestor that scrolls and is a stacking context, as a long
 * panel on a phone is, and showed only the right part of Display > Grid on an
 * iPhone (PT-9673). A click into the PyMOL frame blurs this window, and a
 * press outside the bar (a pointer event too: iOS sends no mousedown for a tap
 * on plain page) closes them.
 *
 * Narrower than DESIGN.md §2.6's Mobile step (`NARROW_MENU_QUERY`, the HTML
 * app's phone layout too) the cascade becomes one panel that drills down
 * (PT-9673; both UI consultants, owner approval 2026-11-18): as wide as the
 * window but 8 px each side, on the roomier side of the bar and never over
 * it. A submenu replaces the panel's entries; its top row holds the way back (named
 * after the level it returns to), the way out (×) and the whole path, so four
 * levels down still says where it is. Escape and ← step back one level to the
 * entry they came from, ↑ / ↓ / Home / End take the two header entries in, a
 * mouse hover neither drills nor switches menus, and the menu closes when the
 * window crosses the step rather than change shape under the finger. Each top
 * menu opens again at the level it was left at, for as long as the page keeps
 * the same menu tree (the owner's "take me back where I was" at every level).
 *
 * The one menu that is AgDB's own (`brand`, 創薬表示) carries the company logo
 * before its label when the page passes one (`brandLogo`): 16 px, decorative —
 * the accessible name stays the label — and greyed with the label while the
 * bar is disabled. No logo, or an image that fails, leaves the label alone (owner request 2026-10-17; both UI
 * consultants, PT-3606).
 *
 * `disabled` (PyMOL not ready, or failed) locks only the menus that need
 * PyMOL: a menu of engine-free entries (Help — the keys, the PyMOL™ notice
 * and its way to the licences) still opens (PT-9103 item 4). A locked menu
 * stays focusable (aria-disabled, so ←/→ and Tab still reach every menu,
 * the WAI-ARIA menubar pattern) and is described by `disabledNote`; it
 * does not open.
 *
 * Hover opens and switches menus for a mouse only: after a touch, the
 * browser's compatibility mouse events (mouseover / mouseenter after a tap)
 * would otherwise open or switch menus the finger never chose — in headless
 * Chrome's touch emulation a tap on Help once showed Scene (PT-9226). The
 * last pointer is read from the pointer events, which a touch fires before
 * those mouse events; a real mouse moving makes hover work again.
 */

const pathKey = (path: readonly number[]) => path.join('.')
const isFocusable = (n: MenuNode | undefined) => n !== undefined && n.kind !== 'sep'

/** DESIGN.md §2.6's Mobile step, the HTML app's `MOBILE_QUERY`: one panel that drills down. */
export const NARROW_MENU_QUERY = '(max-width: 640px)'

/** The drill-down panel's two header entries, as indices after its path (never a data index). */
const BACK = -1
const CLOSE = -2

/** The labels of the menus along `path` ('' where it leaves the tree). */
function labelsAlong(menu: readonly MenuNode[], path: readonly number[]): string[] {
  let items = menu
  return path.map(i => {
    const n = items[i]
    if (n?.kind !== 'menu') {
      items = []
      return ''
    }
    items = n.items
    return n.label
  })
}

/**
 * Where each top menu was last left on a narrow screen (its index -> the open
 * path), per menu tree. The pages memoise their tree, so the place outlives
 * the bar: the HTML app unmounts it whenever its 「表示」 sheet closes. Another
 * tree (another language, another structure's presets) starts at the top.
 */
const lastPlace = new WeakMap<readonly MenuNode[], Map<number, readonly number[]>>()

export function PymolMenuBar(props: {
  menu: readonly MenuNode[]
  disabled: boolean
  /** Why a locked menu does not open (read as its description). */
  disabledNote?: string
  label: string
  /** Shown after an entry that flips a setting (no tick: its state is not read back). */
  toggleHint: string
  onCommand: (command: string) => void
  onLocal: (action: LocalAction) => void
  /** The company logo for the `brand` menu; `src` null shows the label alone. */
  brandLogo?: { src: string | null; onError: () => void }
}) {
  const { menu, disabled, disabledNote, label, toggleHint, onCommand, onLocal, brandLogo } = props
  const { t } = useTranslation('pymol')
  const noteId = useId()
  const baseId = useId()
  const panelId = (path: readonly number[]) => `${baseId}-menu-${path.join('-')}`
  /** A phone-wide window: one panel that drills down instead of the cascade. */
  const narrow = useMatchMedia(NARROW_MENU_QUERY)
  /** A top menu that cannot open now: PyMOL is not ready and the menu needs it. */
  const menuLocked = (i: number): boolean => disabled && menu[i] !== undefined && needsPymol(menu[i])
  // The open chain: [top index, submenu index, ...]; [] = closed.
  const [open, setOpen] = useState<number[]>([])
  const rootRef = useRef<HTMLDivElement | null>(null)
  const buttons = useRef(new Map<string, HTMLButtonElement>())
  /** The last pointer that pressed, moved or came over here was a touch or a pen: no hover until a mouse does. */
  const touched = useRef(false)
  const notePointer = (e: { pointerType: string }) => {
    if (e.pointerType === 'mouse') touched.current = false
    else if (e.pointerType === 'touch' || e.pointerType === 'pen') touched.current = true
  }
  // Focus to move once the menu named here has rendered.
  const [focusAfter, setFocusAfter] = useState<string | null>(null)
  // The bar button Tab reaches: the one focused last.
  const [tabStop, setTabStop] = useState(0)
  const stop = tabStop < menu.length ? tabStop : 0

  const nodeAt = (path: readonly number[]): MenuNode | undefined => {
    let items: readonly MenuNode[] = menu
    let node: MenuNode | undefined
    for (const i of path) {
      node = items[i]
      if (!node) return undefined
      items = node.kind === 'menu' ? node.items : []
    }
    return node
  }
  const itemsAt = (path: readonly number[]): readonly MenuNode[] => {
    if (path.length === 0) return menu
    const n = nodeAt(path)
    return n?.kind === 'menu' ? n.items : []
  }
  const firstFocusable = (path: readonly number[]) => itemsAt(path).findIndex(isFocusable)

  /** Where top menu `i` opens: on a narrow screen, the level it was last left at while it still exists. */
  const placeOf = (i: number): number[] => {
    const kept = narrow ? lastPlace.get(menu)?.get(i) : undefined
    if (kept === undefined || kept[0] !== i || labelsAlong(menu, kept).includes('')) return [i]
    return [...kept]
  }

  /** The drill-down panel's focus order: the way back (below the top), the way out, then its entries. */
  const drillOrder = (panel: readonly number[]): string[] => [
    ...(panel.length > 1 ? [pathKey([...panel, BACK])] : []),
    pathKey([...panel, CLOSE]),
    ...itemsAt(panel).flatMap((n, i) => (isFocusable(n) ? [pathKey([...panel, i])] : [])),
  ]

  useEffect(() => {
    if (focusAfter === null) return
    buttons.current.get(focusAfter)?.focus()
    setFocusAfter(null)
  }, [focusAfter, open])

  // Close on a press outside, and when focus leaves this window (into the frame).
  // A pointer event too: iOS fires no mousedown for a tap on plain page.
  useEffect(() => {
    if (open.length === 0) return
    const onDown = (e: Event) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen([])
    }
    const onBlur = () => setOpen([])
    document.addEventListener('mousedown', onDown)
    document.addEventListener('pointerdown', onDown)
    window.addEventListener('blur', onBlur)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('pointerdown', onDown)
      window.removeEventListener('blur', onBlur)
    }
  }, [open.length])

  // A narrow screen keeps where each top menu was left (the path that is open now).
  useEffect(() => {
    if (!narrow || open.length === 0 || labelsAlong(menu, open).includes('')) return
    let kept = lastPlace.get(menu)
    if (kept === undefined) {
      kept = new Map()
      lastPlace.set(menu, kept)
    }
    kept.set(open[0], [...open])
  }, [narrow, open, menu])

  // Crossing the step closes the menu rather than change its shape under the finger.
  const shapeWas = useRef(narrow)
  useEffect(() => {
    if (shapeWas.current === narrow) return
    shapeWas.current = narrow
    setOpen([])
  }, [narrow])

  // A menu that needs PyMOL closes when PyMOL goes; Help stays open.
  const openTop = open[0]
  const openLocked = openTop !== undefined && disabled && menu[openTop] !== undefined && needsPymol(menu[openTop])
  useEffect(() => {
    if (openLocked) setOpen([])
  }, [openLocked])

  /** Open the menu at `path` and focus its first entry. */
  const openAndEnter = (path: number[]) => {
    if (menuLocked(path[0])) {
      // Locked: the focus moves there (its reason is read), nothing opens.
      setOpen([])
      setFocusAfter(pathKey([path[0]]))
      return
    }
    const first = firstFocusable(path)
    setOpen(path)
    if (first >= 0) setFocusAfter(pathKey([...path, first]))
  }

  const choose = (node: MenuNode, top: number) => {
    // Focus goes back to the menu's own button BEFORE the entry is gone: a
    // dialog the entry opens records, as it renders, what had focus — and an
    // entry about to be removed left its close nothing to return to, so focus
    // fell to <body> (PT-3291 item 3; PT-1171 item 4).
    buttons.current.get(pathKey([top]))?.focus()
    setOpen([])
    if (node.kind === 'item') onCommand(node.command)
    else if (node.kind === 'local') onLocal(node.action)
  }

  /** The pointer on `el`: focus follows it while focus is in the bar, before the menu under it changes. */
  const pointTo = (el: HTMLButtonElement) => {
    const active = document.activeElement
    if (active !== el && active instanceof HTMLElement && rootRef.current?.contains(active)) el.focus()
  }

  const onBarKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const n = menu.length
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault()
      const j = (i + (e.key === 'ArrowRight' ? 1 : n - 1)) % n
      if (open.length > 0) openAndEnter(placeOf(j))
      else setFocusAfter(pathKey([j]))
    } else if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      openAndEnter(placeOf(i))
    } else if (e.key === 'Escape' && open.length > 0) {
      e.preventDefault()
      setOpen([])
    }
  }

  /**
   * Keys on an entry at `path`. In the drill-down panel the header's way back
   * and way out come here too, at `BACK` / `CLOSE` after the panel's path: no
   * entry of the data there, so ← / → / Escape / Tab treat them as any entry
   * that opens nothing, and ↑ / ↓ / Home / End walk `drillOrder`.
   */
  const onMenuKey = (e: KeyboardEvent<HTMLButtonElement>, path: number[]) => {
    const parent = path.slice(0, -1)
    const index = path[path.length - 1]
    const items = itemsAt(parent)
    const move = (from: number, step: number) => {
      for (let k = 1; k <= items.length; k++) {
        const j = (from + step * k + items.length * k) % items.length
        if (isFocusable(items[j])) return j
      }
      return from
    }
    const node = items[index]
    if (narrow && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End')) {
      e.preventDefault()
      const order = drillOrder(parent)
      const at = order.indexOf(pathKey(path))
      const last = order.length - 1
      const to = e.key === 'Home' ? 0 : e.key === 'End' ? last : e.key === 'ArrowDown' ? (at >= last ? 0 : at + 1) : at <= 0 ? last : at - 1
      setFocusAfter(order[to])
      return
    }
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        e.preventDefault()
        setOpen(parent)
        setFocusAfter(pathKey([...parent, move(index, e.key === 'ArrowDown' ? 1 : -1)]))
        return
      case 'Home':
      case 'End': {
        e.preventDefault()
        const j = e.key === 'Home' ? move(-1 + items.length, 1) : move(0, -1)
        // A submenu open beside the entry left closes, as ↑ / ↓ close it.
        setOpen(parent)
        setFocusAfter(pathKey([...parent, j]))
        return
      }
      case 'ArrowRight':
        e.preventDefault()
        if (node?.kind === 'menu') openAndEnter(path)
        else openAndEnter(placeOf((path[0] + 1) % menu.length))
        return
      case 'ArrowLeft':
        e.preventDefault()
        if (parent.length > 1) {
          setOpen(parent.slice(0, -1))
          setFocusAfter(pathKey(parent))
        } else openAndEnter(placeOf((path[0] + menu.length - 1) % menu.length))
        return
      case 'Escape':
        e.preventDefault()
        e.stopPropagation()
        setOpen(parent.slice(0, -1))
        setFocusAfter(pathKey(parent))
        return
      case 'Tab':
        setOpen([])
        return
      default:
        return
    }
  }

  const register = (path: readonly number[]) => (el: HTMLButtonElement | null) => {
    const k = pathKey(path)
    if (el) buttons.current.set(k, el)
    else buttons.current.delete(k)
  }

  /** The entries of the menu at `path`, in either shape. */
  const renderItems = (path: number[]): ReactElement[] =>
    itemsAt(path).map((node, i) => {
      const p = [...path, i]
      if (node.kind === 'sep') return <li key={i} role="separator" className="pymolv-menu-sep" />
      const isSub = node.kind === 'menu'
      const expanded = isSub && open.length > p.length - 1 && pathKey(open.slice(0, p.length)) === pathKey(p)
      // Locked: still focusable, so the keyboard reaches the reason too
      // (aria-disabled, not disabled); choosing it does nothing.
      const locked = node.kind === 'local' && node.locked !== undefined ? node.locked : null
      return (
        <li key={i} role="none">
          <button
            ref={register(p)}
            type="button"
            role="menuitem"
            tabIndex={-1}
            className={locked === null ? 'pymolv-menu-item' : 'pymolv-menu-item pymolv-menu-item-locked'}
            aria-haspopup={isSub ? 'menu' : undefined}
            aria-expanded={isSub ? expanded : undefined}
            aria-controls={expanded ? panelId(p) : undefined}
            aria-disabled={locked === null ? undefined : true}
            onMouseEnter={e => {
              if (touched.current) return
              pointTo(e.currentTarget)
              // The drill-down panel changes only on a choice, never on a hover.
              if (!narrow) setOpen(isSub ? p : path)
            }}
            onClick={() => (isSub ? openAndEnter(p) : locked === null ? choose(node, p[0]) : undefined)}
            onKeyDown={e => onMenuKey(e, p)}
          >
            <span className="pymolv-menu-label">{node.kind === 'item' ? menuLabel(node.label) : node.label}</span>
            {node.kind === 'item' && node.role === 'toggle' && <span className="pymolv-menu-hint">{toggleHint}</span>}
            {locked !== null && (
              <span className="pymolv-menu-hint">
                <span aria-hidden="true">🔒 </span>
                {locked}
              </span>
            )}
            {isSub && <span className="pymolv-menu-arrow" aria-hidden="true">▸</span>}
          </button>
        </li>
      )
    })

  /** One level of the cascade, placed from the entry (or bar button) that opened it. */
  const renderMenu = (path: number[]): ReactElement => {
    const owner = nodeAt(path)
    return (
      <MenuPanel
        key={pathKey(path)}
        id={panelId(path)}
        anchor={() => buttons.current.get(pathKey(path)) ?? null}
        place={path.length > 1 ? 'beside' : 'below'}
        label={owner?.kind === 'menu' ? owner.label : ''}
      >
        {renderItems(path)}
      </MenuPanel>
    )
  }

  /**
   * The narrow screen's one panel: the menu at `path` under a header row with
   * the way back (named after the level it returns to), the way out and the
   * whole path. The menu's name is that path too, so a screen reader hears
   * where a new level is.
   */
  const renderDrill = (path: number[]): ReactElement => {
    const labels = labelsAlong(menu, path)
    const here = labels[labels.length - 1]
    const up = labels[labels.length - 2]
    return (
      <MenuPanel key={pathKey(path)} id={panelId(path)} anchor={() => rootRef.current} place="drill" label={labels.join(' › ')}>
        <li role="none" className="pymolv-menu-head">
          {up !== undefined ? (
            <button
              ref={register([...path, BACK])}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className="pymolv-menu-item pymolv-menu-back"
              aria-label={t('pymol:menu_back', { name: up })}
              onMouseEnter={e => {
                if (!touched.current) pointTo(e.currentTarget)
              }}
              onClick={() => {
                setOpen(path.slice(0, -1))
                setFocusAfter(pathKey(path))
              }}
              onKeyDown={e => onMenuKey(e, [...path, BACK])}
            >
              <span aria-hidden="true">‹</span>
              <span className="pymolv-menu-label">{up}</span>
            </button>
          ) : (
            <span className="pymolv-menu-title" aria-hidden="true">
              {here}
            </span>
          )}
          <button
            ref={register([...path, CLOSE])}
            type="button"
            role="menuitem"
            tabIndex={-1}
            className="pymolv-menu-item pymolv-menu-close"
            aria-label={t('pymol:menu_close')}
            onMouseEnter={e => {
              if (!touched.current) pointTo(e.currentTarget)
            }}
            onClick={() => {
              setOpen([])
              setFocusAfter(pathKey([path[0]]))
            }}
            onKeyDown={e => onMenuKey(e, [...path, CLOSE])}
          >
            <span aria-hidden="true">×</span>
          </button>
          {up !== undefined && (
            <span className="pymolv-menu-path" aria-hidden="true">
              {labels.slice(0, -1).map((l, k) => (
                <span key={k}>{l} › </span>
              ))}
              <strong>{here}</strong>
            </span>
          )}
        </li>
        {renderItems(path)}
      </MenuPanel>
    )
  }

  /** The open path's menus: every level as siblings (the cascade), or the deepest alone (narrow). */
  const renderOpen = (): ReactElement | ReactElement[] | null => {
    const levels = open.map((_, k) => open.slice(0, k + 1)).filter(p => nodeAt(p)?.kind === 'menu')
    if (levels.length === 0) return null
    return narrow ? renderDrill(levels[levels.length - 1]) : levels.map(renderMenu)
  }

  return (
    <>
      <div
        ref={rootRef}
        role="menubar"
        aria-label={label}
        className="pymolv-menubar"
        onPointerDownCapture={notePointer}
        onPointerMoveCapture={notePointer}
        // A mouse entering a bar button straight from outside the bar: its
        // pointerover comes before the mouseenter, its first pointermove after
        // it, so that first hover counts too (PT-9237 item 3).
        onPointerOverCapture={notePointer}
      >
        {menu.map((node, i) => {
          if (node.kind !== 'menu') return null
          const expanded = open[0] === i
          const locked = menuLocked(i)
          return (
            <div key={i} className="pymolv-menubar-entry">
              <button
                ref={register([i])}
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={expanded}
                aria-controls={expanded ? panelId(narrow ? open : [i]) : undefined}
                aria-disabled={locked || undefined}
                aria-describedby={locked && disabledNote !== undefined ? noteId : undefined}
                tabIndex={i === stop ? 0 : -1}
                className="pymolv-menubar-button"
                onFocus={() => setTabStop(i)}
                onClick={() => {
                  if (locked) return
                  setOpen(expanded ? [] : placeOf(i))
                }}
                onMouseEnter={e => {
                  // Narrow, the panel lies across the bar's other buttons' way: no hover switching.
                  if (open.length > 0 && !expanded && !locked && !touched.current && !narrow) {
                    pointTo(e.currentTarget)
                    setOpen([i])
                  }
                }}
                onKeyDown={e => onBarKey(e, i)}
              >
                {node.brand && brandLogo && brandLogo.src !== null && (
                  <img className="pymolv-menubar-logo" src={brandLogo.src} alt="" aria-hidden="true" onError={brandLogo.onError} />
                )}
                {node.label}
              </button>
              {expanded && renderOpen()}
            </div>
          )
        })}
      </div>
      {/* Outside the menubar, which owns only its menu items. */}
      {disabled && disabledNote !== undefined && (
        <span id={noteId} className="sr-only">
          {disabledNote}
        </span>
      )}
    </>
  )
}

/**
 * Where a panel first renders: off-screen but visible. Never `visibility:
 * hidden` — a browser refuses focus to a hidden element, and the effect that
 * moves focus into the menu can run before a re-render would have unhidden it
 * (round 1 of #3300). The layout effect below writes the real position
 * straight onto the element, before paint and before that focus effect; this
 * object never changes, so React never writes over it.
 */
const OFF_SCREEN: CSSProperties = Object.freeze({ left: -10000, top: 0 })

/** Between the narrow screen's one panel and the window's edges. */
const DRILL_MARGIN = 8

/**
 * The narrow screen's panel: the window's width but `DRILL_MARGIN` each side,
 * on the roomier side of the bar (`bar`, its whole rectangle) and never over
 * it, as tall as that side allows. The window's own height, not `100vh`, which
 * on iOS counts the toolbars it hides.
 */
function placeDrill(el: HTMLElement, bar: DOMRect, vw: number, vh: number): void {
  const m = DRILL_MARGIN
  el.style.left = `${m}px`
  el.style.width = `${Math.max(0, vw - 2 * m)}px`
  const top = Math.max(bar.bottom, m)
  const bottom = Math.min(bar.top, vh - m)
  const below = vh - m - top
  const above = bottom - m
  if (below >= above) {
    el.style.maxHeight = `${Math.max(0, below)}px`
    el.style.top = `${top}px`
  } else {
    el.style.maxHeight = `${Math.max(0, above)}px`
    // Measured after its width and height cap are set: its bottom on the bar's top.
    el.style.top = `${Math.max(m, bottom - el.offsetHeight)}px`
  }
}

/**
 * One open menu, kept inside the window: `below` its bar button, `beside` the
 * entry that opened it, or the narrow screen's one panel (`drill`, anchored
 * to the whole bar).
 */
function MenuPanel(props: { id: string; anchor: () => HTMLElement | null; place: 'below' | 'beside' | 'drill'; label: string; children: ReactNode }) {
  const { id, anchor, place, label, children } = props
  const ref = useRef<HTMLUListElement | null>(null)
  useLayoutEffect(() => {
    const a = anchor()
    const el = ref.current
    if (!a || !el) return
    const r = a.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    if (place === 'drill') {
      placeDrill(el, r, vw, vh)
      return
    }
    const nested = place === 'beside'
    const h = el.offsetHeight
    const w = el.offsetWidth
    let left = nested ? r.right : r.left
    if (nested && left + w > vw) left = Math.max(0, r.left - w)
    left = Math.max(0, Math.min(left, vw - w))
    const top = Math.max(0, Math.min(nested ? r.top : r.bottom, vh - h))
    el.style.left = `${left}px`
    el.style.top = `${top}px`
    // Placed once per opening; the anchor does not move while it is open.
  }, [])
  return (
    <ul ref={ref} id={id} role="menu" aria-label={label} className={place === 'drill' ? 'pymolv-menu pymolv-menu--drill' : 'pymolv-menu'} style={OFF_SCREEN}>
      {children}
    </ul>
  )
}
