/**
 * Modal — Shared modal wrapper component
 *
 * Design policy:
 * - Clicking outside the modal does NOT close it (only the × button inside closes it)
 * - Always render a × button inside the modal content
 * - Use maxWidth prop to override the default 500px width (e.g. maxWidth={800})
 * - Use `flush` to drop `.modal`'s 28px padding, for a dialog that paints its
 *   own coloured header bar edge to edge (an alert or a destructive confirm;
 *   PT-1315 — without it such a dialog had to hand-roll its overlay). Its
 *   children are laid out as a column, so the bars of `DialogBars` stay put
 *   and only `DialogBody` scrolls (PT-6578 item 7)
 *
 * ## What this component guarantees (review #13, `DESIGN.md §9`, PT-573)
 *
 * §9 says the dialog contract is guaranteed BY THIS COMPONENT, which is why
 * §C1 forbids hand-rolled modals. Every call site gets all of it:
 *
 * - `role` — `"dialog"` by default, `"alertdialog"` for a destructive confirm.
 * - `label` / `labelledBy` / `describedBy` — the accessible name and
 *   description. Callers render their own heading, so the component cannot
 *   derive one. The name is REQUIRED (PT-1170): give the heading an id
 *   (`useId()`) and pass it as `labelledBy`, or pass `label` when there is no
 *   heading. The type refuses a `<Modal>` with neither; what it cannot see is
 *   a `labelledBy` id that names nothing inside the dialog.
 * - `aria-modal="true"` — on by default since PT-573, because the focus
 *   lifecycle below now keeps focus inside every dialog. `modal={false}` opts
 *   out.
 * - **Opening focus.** If focus is already inside the dialog when it mounts —
 *   a call-site `autoFocus`, which React applies during commit, before any
 *   effect — it is left there. Otherwise the dialog container itself takes
 *   focus (`tabIndex={-1}`), never a button, so a key held through the open
 *   cannot activate anything. A call site that moves focus in its OWN effect
 *   still wins: it is this component's parent, and parent effects run after
 *   child effects. A dialog that is UNDER another one (lower `zIndex`) keeps
 *   none: what lands in it — an `autoFocus` during commit (PT-1333 item 1),
 *   the call site's own effect, any later `focus()` (a capture `focusin`
 *   listener, PT-2896 item 3) — goes back to the dialog on top, and the
 *   element it landed on is where focus returns when this dialog comes to the
 *   top (item 4).
 * - **Restore on close.** Outcome-first, the way #1921's withdrawn version was
 *   not (PT-573 has the per-round breakdown): try each candidate, then check
 *   `document.activeElement`, and move on if focus did not land. Candidates in
 *   order, when another dialog is still open: the element focused when this
 *   dialog RENDERED (captured before any `autoFocus` could move it) only if it
 *   sits inside that open dialog, else what was sent back from the open
 *   dialog while this one sat above it, else the open dialog itself — focus never
 *   lands in the page an open dialog declares unavailable. When no dialog is
 *   left: that same element, then the opener of the dialog it sat in (a
 *   modal->modal handoff, whose own opener died with the first dialog) — each
 *   only if no `.modal-overlay` outside the stack is painted over it: a
 *   hand-rolled dialog the close handed over to, or the next `Modal` of a
 *   same-commit handoff, before its own effect runs (PT-1171 items 3 and 5).
 *   An opener that is gone by the close — a menu item in a dropdown that
 *   closed on the pick — leaves nothing to return to, so such a menu moves
 *   focus to its own trigger when an item is picked and the dialog records the
 *   trigger (PT-1171 item 4). It
 *   only runs when focus was actually lost (`<body>`), so a call site that
 *   moved focus in its close handler is never overridden, and StrictMode's
 *   simulated unmount, which leaves focus inside the still-connected dialog,
 *   is a no-op. A call site that restores in its OWN effect cleanup
 *   (such as a row-aware restore) runs after this one — React runs a
 *   deleted child's cleanups first — so its answer is the one that stands.
 * - **Parked** (`hidden`). A dialog whose children must outlive a close — an
 *   dialog holding an iframe that must not reload —
 *   stays mounted with the `hidden` attribute on its overlay (`display: none`
 *   by index.css's `.modal-overlay[hidden]`). Parked, it is off the dialog
 *   stack: not the top dialog for Escape, no Tab trap, no rank among the
 *   others, no live region, no registered row, and it takes and moves no
 *   focus. Parking it is a close (the restore above; focus is on the control
 *   that parked it, which no longer paints, so it counts as lost — and with
 *   nowhere to go it is let go, as a browser does). Un-parking it is an open:
 *   it goes on top of the dialogs of its `zIndex`, takes the element focused
 *   at that render as where focus returns, and moves focus in; its children
 *   are the same nodes as before.
 * - **Tab trap.** The top dialog — the one painted on top: highest `zIndex`,
 *   then last rendered (`modalStack.ts`) — wraps Tab / Shift+Tab at its ends,
 *   and pulls focus back in when it has escaped (a click on the dimmed overlay
 *   drops focus on `<body>`). A capture-phase `document` listener, so a call
 *   site that stops keydown propagation cannot disable
 *   it. The wrap list is a selector approximation of native tab order that
 *   drops what native Tab skips — an explicit negative `tabindex`, an element
 *   `checkVisibility()` says is not rendered, the unchecked radios of a group
 *   with a checked one (`tabbablesIn`). Past either end native Tab may still
 *   stop on a scroll container with nothing focusable inside (Chrome 130+,
 *   Firefox; not Safari), which no selector can name: with one there, the
 *   trap lets native Tab move and pulls focus back only if it left the dialog
 *   (PT-1333 item 6). What it still misses is pulled back in by the
 *   escaped-focus branch.
 * - **Escape** calls `onClose`, only when the caller passes one, only for the
 *   top dialog, never during IME composition, never for an auto-repeat of a
 *   held key (one press closes one dialog, PT-1180 — the repeat is still
 *   `preventDefault`ed when the top dialog has an `onClose`, so a page
 *   listener that defers to `defaultPrevented` does not
 *   answer it either; PT-1328 item 3), and never when an inner
 *   control already handled the key (`defaultPrevented`). It is a bubble-phase
 *   `document` listener so an inner control can claim the key first; a call
 *   site that stops ALL keydown propagation must let Escape through
 *   (one call site does). Policy: Escape is the same
 *   act as pressing × — pass `onClose` exactly when × is enabled.
 *   Call sites that deliberately pass none: a confirm dialog (it answers
 *   only by its buttons), a dialog with no close action (nothing closes it),
 *   a one-time display (owner ruling 2026-10-03: what it shows is never shown
 *   again, so only its button closes it), and an alert whose caller gives no cancel action — it then has
 *   no × and no Cancel, so only its own button answers it.
 *   Keys typed inside an iframe never reach this listener.
 * - **Toast announcements** (PT-1172). `aria-modal` hides a page-wide toast
 *   live region, which renders outside every dialog. Each dialog carries an
 *   empty, visually hidden live region of its own, and a toast raised under
 *   a dialog is spoken from the top rendered dialog's region once
 *   the toast's commit has landed, hiding the toast's outer copy while a
 *   dialog is open — and for as long as it is on screen when the dialog
 *   closed in the toast's own commit, which the fallback speaks (PT-4000).
 *   Lines written to the region in the last `HANDOFF_WINDOW_MS` when the
 *   dialog closes are handed on to the dialog left speaking — once the
 *   commit's mount effects have run, so a dialog opened in the same commit
 *   counts (PT-3928) — or to the registered fallback when none is (PT-1228),
 *   `ANNOUNCER_SETTLE_MS` later (PT-4000). See `announceInTopDialog` in
 *   `modalStack.ts`. Only this component takes
 *   part: a hand-rolled `aria-modal` overlay hides the toast region with
 *   nothing in its place (PT-1315).
 * - **An optional row after the children.** A row component can be
 *   registered with `registerModalSuggestionRow`; when one is, every Modal
 *   draws it after its children and is given this dialog's name
 *   (`labelledBy`, else `label`) and its layout. Inside the dialog, so Tab and
 *   assistive tech reach it within the trap; after the children, so it never
 *   covers the caller's × or its actions; a fixed-height flex item under a
 *   `flush` dialog's bars, so only their body scrolls. This module imports
 *   nothing for it, so a bundle that registers no row draws none.
 *   `suggestionRow={false}` leaves it out.
 */
import { ReactNode, useEffect, useLayoutEffect, useRef, useState, type ComponentType } from 'react'
import {
  hasFocusableScroller,
  isTopDialog,
  nextDialogSeq,
  openerOfDialogContaining,
  overlayZ,
  pushDialog,
  removeDialog,
  returnFocusOf,
  tabbablesIn,
  topDialog,
} from './modalStack'

/**
 * The accessible name is required (PT-1170): one of the two, or both, in
 * which case `labelledBy` wins.
 */
type ModalNameProps =
  | {
      /** id of the caller's heading element, preferred over `label`. */
      labelledBy: string
      label?: string
    }
  | {
      /** Accessible name, when the caller has no heading element to point at. */
      label: string
      labelledBy?: string
    }

type ModalProps = ModalNameProps & {
  children: ReactNode
  /** Width cap for the modal content (default: 500px) */
  maxWidth?: number | string
  /**
   * Drop `.modal`'s padding so the children reach the dialog's edges — for a
   * coloured header bar drawn edge to edge, the callers padding their own
   * body and footer (PT-1315). The rounded corners still clip the children:
   * `.modal` scrolls (`overflow-y: auto`), and any overflow but `visible`
   * clips to the border radius.
   */
  flush?: boolean
  /** z-index for the overlay (default: 200). Also decides which open dialog
   *  the keyboard talks to: the highest, then the last rendered — among
   *  dialogs in one stacking context; one inside another's DOM is above it
   *  whatever the numbers (`modalStack.ts`). */
  zIndex?: number
  /** id of the element describing the dialog, for `aria-describedby`. */
  describedBy?: string
  /**
   * ARIA role. `alertdialog` for a confirm/destructive prompt, which is what
   * a confirm dialog needs; anything else keeps `dialog`. It exists so a
   * caller never has to nest its OWN role inside this one — two nested dialog
   * roles are ambiguous to assistive tech and to `getByRole('dialog')` alike.
   */
  role?: 'dialog' | 'alertdialog'
  /**
   * `aria-modal="true"` (default). Safe for every call site because this
   * component keeps focus inside the dialog while it is open — see the header.
   */
  modal?: boolean
  /**
   * Called on Escape. Pass the same function the × button calls, and pass it
   * only while × is enabled (`onClose={busy ? undefined : onClose}`), so the
   * key never does something the button would not.
   */
  onClose?: () => void
  /**
   * Draw the registered row after the children (default true; drawn only
   * when a row is registered). `false` leaves it out.
   */
  suggestionRow?: boolean
  /**
   * Keep the dialog mounted but parked (default false): the overlay carries
   * the `hidden` attribute, the dialog is off the dialog stack and its
   * children stay mounted, so an iframe inside is never reloaded. Flipping it
   * back is an open, flipping it on a close — see "Parked" in the header.
   */
  hidden?: boolean
}

/** Where focus stood when the dialog was last shown, and its render order then. */
interface Shown {
  hidden: boolean
  /** The element focused, and the opener of the open dialog it sat in. */
  openers: [Element | null, Element | null]
  /** See `nextDialogSeq`. */
  seq: number
}

/**
 * Taken during the render that SHOWS the dialog — its first, or the one that
 * un-parks it — i.e. before React commits that render and applies any
 * `autoFocus` inside it: reading it in an effect would see the autofocused
 * field instead of the trigger (#1921 round 3). Render order is taken afresh
 * at each show, so an un-parked dialog goes on top of those of its `zIndex`
 * as one opened then would. A parked dialog keeps what its last show took.
 */
function shownAt(hidden: boolean, last?: Shown): Shown {
  if (hidden) return { hidden, openers: last?.openers ?? [null, null], seq: last?.seq ?? 0 }
  const active = document.activeElement
  return { hidden, openers: [active, openerOfDialogContaining(active)], seq: nextDialogSeq() }
}

/** Focus `el` and report whether focus really landed there. `<body>` never
 *  counts: it is always connected and always "accepts" focus, so it would pass
 *  every check while being exactly the lost-focus state (#1921 round 5). Any
 *  element with a `focus()` is a candidate — HTML, SVG (every recharts chart's
 *  `<svg>` carries tabIndex 0, PT-1171 item 6) and MathML (PT-1333 item 4),
 *  the three that carry it; jsdom has no MathML element class, so this asks
 *  for the method rather than naming the classes. */
function focusLanded(el: Element | null): boolean {
  if (!el || el === document.body || !el.isConnected) return false
  const focus = (el as Partial<HTMLOrSVGElement>).focus
  if (typeof focus !== 'function') return false
  focus.call(el)
  return document.activeElement === el
}

/**
 * The showing `.modal-overlay` painted on top, or null when none is showing.
 * `overlays` is in document order, so a later one wins a tie. Each overlay is
 * a stacking context, and one nested inside another is drawn inside the outer
 * one's: it paints above the outer one whatever its z-index, and against
 * anything outside the outer one it paints where the outer one does — the
 * two are compared at the first overlay their chains of overlay ancestors do
 * not share (PT-2896 item 5: z 9999 inside z 100 is under a sibling z 500).
 */
function overlayOnTop(overlays: Element[]): Element | null {
  // Outermost first, `o` itself last: ancestors come first in document order.
  const chain = (o: Element) => overlays.filter(p => p.contains(o))
  const paintsOver = (o: Element, top: Element) => {
    const a = chain(o)
    const b = chain(top)
    let i = 0
    while (i < a.length && i < b.length && a[i] === b[i]) i++
    if (i === b.length) return true // `o` is inside `top`
    if (i === a.length) return false // `top` is inside `o`
    return overlayZ(a[i]) >= overlayZ(b[i])
  }
  return overlays.reduce<Element | null>((top, o) => (top === null || paintsOver(o, top) ? o : top), null)
}

/**
 * Put back focus a closing dialog lost — the restore of the header, for a
 * dialog already off the stack. `openers` are what its last show took.
 */
function restoreFocus(openers: [Element | null, Element | null]): void {
  // A dialog still open (below this one, or above it when a lower dialog
  // closes on its own) owns focus: an opener outside it sits in the page
  // that dialog declares unavailable, and landing there would walk focus
  // out of a live dialog. Only an opener INSIDE it may take focus.
  // Before the open dialog itself, the element focus was sent back from
  // while this one sat above it (PT-2896 item 4): the field an
  // `autoFocus` chose, not the form's frame.
  const open = topDialog()
  if (open) {
    if (open.contains(openers[0]) && focusLanded(openers[0])) return
    const returnTo = returnFocusOf(open)
    if (returnTo && open.contains(returnTo) && focusLanded(returnTo)) return
    focusLanded(open)
    return
  }
  // No dialog in the stack, but one outside it may be showing: a
  // hand-rolled overlay dialog (`.modal-overlay`), or the
  // next `Modal` of a same-commit handoff, whose mount effect has not run
  // yet. An opener outside it sits behind it, where Enter would press a
  // button the user cannot see and focusing scrolls the page behind
  // (PT-1171 items 3 and 5). One inside it — the button in a hand-rolled
  // dialog that raised a confirm — may take focus. "Over it" is paint
  // order: an opener in the overlay on top is uncovered even while a
  // sibling overlay below it is showing too (PT-1333 item 3).
  const onTop = overlayOnTop(Array.from(document.querySelectorAll('.modal-overlay:not([hidden])')))
  const uncovered = (el: Element | null) => onTop === null || onTop.contains(el)
  if (uncovered(openers[0]) && focusLanded(openers[0])) return
  if (uncovered(openers[1])) focusLanded(openers[1])
}

export default function Modal({
  children,
  maxWidth = 500,
  flush = false,
  zIndex = 200,
  label,
  labelledBy,
  describedBy,
  role = 'dialog',
  modal = true,
  onClose,
  suggestionRow = true,
  hidden = false,
}: ModalProps) {
  // Captured during the render that shows the dialog (`shownAt`): the lazy
  // initializer for the first, and for an un-park the render that sees
  // `hidden` change — state set during render, the way React keeps what an
  // earlier render saw; it renders again before committing. StrictMode's
  // second call reads the same DOM state.
  const [shown, setShown] = useState(() => shownAt(hidden))
  if (shown.hidden !== hidden) setShown(shownAt(hidden, shown))
  const { openers, seq } = shown
  const overlayRef = useRef<HTMLDivElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const announcerRef = useRef<HTMLDivElement>(null)
  // See `returnFocusOf` in modalStack.ts.
  const returnToRef = useRef<Element | null>(null)
  const onCloseRef = useRef(onClose)
  // Layout effect, not passive: a caller that withdraws `onClose` while busy
  // (`onClose={busy ? undefined : close}`) must be obeyed by the very next
  // keystroke, and a passive effect can still be pending when it arrives.
  useLayoutEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    const dialog = dialogRef.current
    // Parked: off the stack and without listeners (see the header).
    if (!dialog || hidden) return
    pushDialog(dialog, openers[0], seq, zIndex, announcerRef.current, returnToRef)

    // A dialog UNDER another — a form an async completion opens while the
    // confirm dialog (z 10000) is showing — must not hold focus: typed keys
    // would go into a form the user cannot see, and Enter could submit it
    // (PT-1333 item 1). Focus that lands in it goes back to the element it
    // came from if that sits in the top dialog, else to the element focused
    // when this dialog rendered if that does, else to the top dialog itself;
    // where it landed is kept for when this dialog comes to the top
    // (PT-2896 item 4). A nested dialog whose DOM sits inside this one is
    // the top dialog, so focus inside it is left alone.
    const giveBack = (landed: Element, from: Element | null) => {
      const top = topDialog()
      if (!top || top === dialog || top.contains(landed)) return
      returnToRef.current = landed
      for (const el of [from, openers[0]]) {
        if (el && top.contains(el) && focusLanded(el)) return
      }
      focusLanded(top)
    }

    // Only the top dialog takes focus: when an outer and an inner dialog mount
    // in the same commit, the outer one's effect runs last and must not pull
    // focus out of the inner one (portalled, so not `contains`-reachable).
    if (isTopDialog(dialog)) {
      if (!dialog.contains(document.activeElement)) dialog.focus()
    } else {
      // What a call-site `autoFocus` took during commit, before any listener
      // could see it.
      const active = document.activeElement
      if (active && dialog.contains(active)) giveBack(active, openers[0])
    }

    // Everything after: the call site's own effect, which runs after this
    // one (PT-2896 item 3), and any later `focus()` while this dialog is not
    // on top. Focus moving inside it while it IS the top one means the user
    // has moved on, so the kept element no longer applies.
    const onFocusIn = (e: FocusEvent) => {
      if (!(e.target instanceof Element) || !dialog.contains(e.target)) return
      if (isTopDialog(dialog)) {
        returnToRef.current = null
        return
      }
      giveBack(e.target, e.relatedTarget instanceof Element ? e.relatedTarget : null)
    }

    // Wrap focus round to `target`, Tab having reached an end of the list at
    // `from`. Past that end native Tab may still stop on a scroll container
    // inside the dialog (`hasFocusableScroller`, PT-1333 item 6); when there
    // is one, let it move, and pull focus back to `target` only if it left
    // the dialog instead (a browser that does not stop there).
    const wrapTo = (e: KeyboardEvent, from: Node, target: HTMLElement) => {
      const side = e.shiftKey ? Node.DOCUMENT_POSITION_PRECEDING : Node.DOCUMENT_POSITION_FOLLOWING
      if (!hasFocusableScroller(dialog, el => (from.compareDocumentPosition(el) & side) !== 0)) {
        e.preventDefault()
        target.focus()
        return
      }
      // No focus scroll for the pull-back: native Tab has already scrolled the
      // page behind to where it stopped (PT-2896 item 6). But `.modal` is a
      // scroll container too, left where native Tab took it, so bring the
      // target into view within it — 'nearest' moves no ancestor that already
      // shows it, and the fixed overlay always shows the dialog (PT-4082).
      // Optional call: jsdom has no scrollIntoView.
      setTimeout(() => {
        if (dialog.isConnected && isTopDialog(dialog) && !dialog.contains(document.activeElement)) {
          target.focus({ preventScroll: true })
          target.scrollIntoView?.({ block: 'nearest' })
        }
      }, 0)
    }

    const onKeyDownCapture = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !isTopDialog(dialog)) return
      const list = tabbablesIn(dialog)
      const active = document.activeElement
      if (list.length === 0) {
        e.preventDefault()
        dialog.focus()
        return
      }
      const first = list[0]
      const last = list[list.length - 1]
      if (!(active instanceof Node) || !dialog.contains(active)) {
        e.preventDefault()
        ;(e.shiftKey ? last : first).focus()
        return
      }
      if (list.includes(active as HTMLElement)) {
        if (!e.shiftKey && active === last) wrapTo(e, active, first)
        else if (e.shiftKey && active === first) wrapTo(e, active, last)
        return
      }
      // Focus sits on something Tab cannot reach (the container, a heading
      // with tabIndex -1). Native Tab moves to the next tabbable in document
      // order — which, past the dialog's last one, is the page behind.
      const follows = (el: HTMLElement) =>
        (active.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
      if (!e.shiftKey && !list.some(follows)) wrapTo(e, active, first)
      else if (e.shiftKey && list.every(follows)) wrapTo(e, active, last)
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      // The Escape that cancels an IME candidate is not a close. Chrome and
      // Firefox flag it with isComposing; Safari ends the composition first
      // and delivers it with the legacy keyCode 229.
      if (e.isComposing || e.keyCode === 229) return
      if (!isTopDialog(dialog)) return
      const close = onCloseRef.current
      if (!close) return
      e.preventDefault()
      // A held Escape auto-repeats: without the `repeat` check, the press
      // that closed an inner dialog would go on to close the outer one too.
      // The repeat is still claimed (preventDefault above) so that a page
      // listener behind the dialog that defers to `defaultPrevented` does not
      // take it instead (PT-1328 item 3).
      if (e.repeat) return
      close()
    }

    document.addEventListener('focusin', onFocusIn, true)
    document.addEventListener('keydown', onKeyDownCapture, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('focusin', onFocusIn, true)
      document.removeEventListener('keydown', onKeyDownCapture, true)
      document.removeEventListener('keydown', onKeyDown)
      removeDialog(dialog)
      // Parked rather than unmounted: the DOM stays, and so may focus, on the
      // control that parked it — which no longer paints, so it is lost all
      // the same. What was sent back while another dialog sat above belongs
      // to this show only. A real unmount has detached the dialog, and
      // StrictMode's simulated one leaves the overlay showing.
      const parked = dialog.isConnected && overlayRef.current?.hidden === true
      if (parked) returnToRef.current = null
      // Only when focus was LOST. This is also what keeps StrictMode's
      // simulated unmount harmless (#1921 round 4): the DOM stays in place, so
      // focus is still inside the dialog and nothing here runs.
      const active = document.activeElement
      if (active && active !== document.body && !(parked && dialog.contains(active))) return
      restoreFocus(openers)
      // Nothing took it: let go of focus left on a control that no longer
      // paints, as a browser does, so the parked dialog holds none.
      const left = document.activeElement
      if (parked && left && dialog.contains(left)) (left as HTMLElement).blur()
    }
    // At mount and at each show; cleaned up at each park and at unmount. The
    // dialog element is fixed for the life of this instance; its openers and
    // render order are those of the show (`shownAt`), and `zIndex` is read
    // at each show.
  }, [hidden])

  // Read at render, so a row registered before the first render is drawn.
  const SuggestionRow = registeredSuggestionRow
  return (
    <div
      ref={overlayRef}
      className="modal-overlay"
      style={{ zIndex }}
      hidden={hidden}
      /* Intentionally no onClick handler — modal closes only via explicit button */
    >
      <div
        ref={dialogRef}
        className="modal"
        style={flush ? { maxWidth, padding: 0, display: 'flex', flexDirection: 'column' } : { maxWidth }}
        role={role}
        tabIndex={-1}
        aria-modal={modal ? 'true' : undefined}
        aria-label={labelledBy ? undefined : label}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        onClick={e => e.stopPropagation()}
      >
        {children}
        {/* Not while parked: the row's form would be left behind a dialog nobody sees. */}
        {suggestionRow && !hidden && SuggestionRow && (
          <SuggestionRow labelledBy={labelledBy} label={label} flush={flush} />
        )}
        {/* Filled by announceInTopDialog, never by React — no React children,
            so a re-render cannot wipe a line being read. No role: a `status`
            here would collide with every caller's own `getByRole('status')`. */}
        <div ref={announcerRef} className="sr-only" aria-live="polite" data-testid="modal-announcer" />
      </div>
    </div>
  )
}

/** What the registered row is given: the dialog's own name props and its layout. */
export interface ModalSuggestionRowProps {
  labelledBy?: string
  label?: string
  flush: boolean
}

// The registered row component; null until one is registered (see the header).
let registeredSuggestionRow: ComponentType<ModalSuggestionRowProps> | null = null

/**
 * Set — or with `null` clear — the row every Modal draws after its children
 * (see the header). Register it before the first render; tests set and clear
 * it around the cases that need it.
 */
export function registerModalSuggestionRow(row: ComponentType<ModalSuggestionRowProps> | null): void {
  registeredSuggestionRow = row
}
