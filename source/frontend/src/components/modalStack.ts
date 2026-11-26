/**
 * modalStack — the open-dialog stack behind `Modal`'s focus lifecycle (PT-573).
 *
 * Module-level on purpose: a dialog's restore needs somewhere to fall back TO
 * when the element that opened it is gone, and the only sensible target is the
 * dialog still open underneath it. That is a question about every mounted
 * `Modal` at once, which no single instance can answer.
 *
 * Only the TOP entry traps Tab and answers Escape, so a stacked dialog (a
 * confirmation over a form dialog, a nested picker) is the one the
 * keyboard talks to, and the one below never reacts to the same keystroke.
 *
 * "Top" is the one painted on top: entries are ordered by the overlay's
 * `zIndex` first and render order second (PT-1171 item 1). A higher-zIndex
 * dialog that stays mounted keeps the top, so a lower-zIndex dialog that an
 * async completion opens under it renders LATER yet sits below it.
 *
 * The numbers compare only within one stacking context, and every
 * `.modal-overlay` is one (PT-6578 item 2). A dialog rendered inside another
 * `Modal`'s DOM, whose overlay may carry a higher number, paints above the
 * one it sits in whatever the numbers, and against anything outside that
 * one it paints where that one does; `paintsAbove` compares the two chains of
 * overlays at the first they do not share, as `Modal`'s `overlayOnTop` does.
 * A stacking context that is not an overlay is not seen.
 */

/** One stacking context a dialog paints in — see `paintPath`. */
interface Level {
  node: Element
  zIndex: number
}

interface Entry {
  dialog: HTMLElement
  /** Where focus was when this dialog rendered, i.e. what opened it. */
  opener: Element | null
  /** Render order — see `nextDialogSeq`. */
  seq: number
  /** Where it paints, outermost first, ending with its own overlay at its
   *  `zIndex`, which outranks `seq` — see the header. */
  path: Level[]
  /** The dialog's own live region — see `announceInTopDialog`. */
  announcer: HTMLElement | null
  /** `dialogEpoch()` right after this entry was pushed. */
  epoch: number
  /** What focus was sent back from while another dialog sat above this one —
   *  see `returnFocusOf`. A holder owned by the dialog, so it outlives
   *  StrictMode's simulated unmount, which takes the entry off the stack. */
  returnTo: { current: Element | null }
}

const stack: Entry[] = []
let seqCounter = 0
let pushCount = 0
// Bumped by `resetModalStackForTests`: a line still on its way to a region
// when it runs belongs to a test that has ended, and is dropped (PT-5060).
let generation = 0
const listeners = new Set<() => void>()

function notify(): void {
  listeners.forEach(listener => listener())
}

/**
 * Subscribe to "a dialog opened or closed", for `useSyncExternalStore` with
 * `anyDialogOpen` as the snapshot (PT-1228 item 1). Called from the mount
 * effect and the cleanup of `Modal`, so a subscriber re-renders in the same
 * task as the passive effects of the commit that changed the stack. That is
 * the commit's own task only for a synchronous render (a click); after an
 * `await` the effects run in a later task, so the browser may paint the
 * commit before the subscriber has caught up (PT-3928 item 3).
 */
export function subscribeDialogs(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function anyDialogOpen(): boolean {
  return stack.length > 0
}

/**
 * How many dialogs have been pushed so far. A message raised at epoch `e`
 * and spoken by a dialog whose entry's `epoch` is greater was raised before
 * that dialog's live region existed — see `announceInTopDialog`.
 */
export function dialogEpoch(): number {
  return pushCount
}

/**
 * A number taken during a dialog's FIRST render, which orders the stack among
 * dialogs of equal `zIndex`.
 *
 * Effects run child-first, so ordering by when the mount effect ran would put
 * an outer dialog ABOVE an inner one that mounted in the same commit (the
 * inner one, rendered inside the outer, finishes first). Render runs
 * parent-first, so this number puts the inner one on top — and a dialog opened
 * later always renders later, so it lands on top too.
 */
export function nextDialogSeq(): number {
  seqCounter += 1
  return seqCounter
}

/** The z-index an overlay paints at; `auto` (or no layout, in jsdom) is 0. */
export function overlayZ(overlay: Element): number {
  const z = Number.parseInt(getComputedStyle(overlay).zIndex, 10)
  return Number.isNaN(z) ? 0 : z
}

/**
 * The stacking contexts `dialog` paints in, outermost first: each
 * `.modal-overlay` around its own, then its own overlay at `zIndex` (the
 * number `Modal` gave it, which jsdom's style also reports). A dialog not in
 * an overlay (a bare element in a test) is its own last level.
 */
function paintPath(dialog: HTMLElement, zIndex: number): Level[] {
  const parent = dialog.parentElement
  const own: Element = parent?.classList.contains('modal-overlay') ? parent : dialog
  const path: Level[] = [{ node: own, zIndex }]
  for (let o = own.parentElement?.closest('.modal-overlay'); o; o = o.parentElement?.closest('.modal-overlay')) {
    path.unshift({ node: o, zIndex: overlayZ(o) })
  }
  return path
}

/**
 * Whether `a` paints above `b`: compared at the first overlay their paths do
 * not share. One inside the other's overlay is above it. At equal z-index two
 * dialogs' own overlays go by render order (`seq`, as before nesting was
 * seen); two outer overlays go by document order, which is what paints.
 */
function paintsAbove(a: Pick<Entry, 'path' | 'seq'>, b: Pick<Entry, 'path' | 'seq'>): boolean {
  let i = 0
  while (i < a.path.length && i < b.path.length && a.path[i].node === b.path[i].node) i++
  if (i === b.path.length) return true // `a` is inside `b`
  if (i === a.path.length) return false // `b` is inside `a`
  if (a.path[i].zIndex !== b.path[i].zIndex) return a.path[i].zIndex > b.path[i].zIndex
  if (i === a.path.length - 1 && i === b.path.length - 1) return a.seq > b.seq
  return (b.path[i].node.compareDocumentPosition(a.path[i].node) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
}

export function pushDialog(
  dialog: HTMLElement,
  opener: Element | null,
  seq: number,
  zIndex: number,
  announcer: HTMLElement | null,
  returnTo: { current: Element | null },
): void {
  const added = { path: paintPath(dialog, zIndex), seq }
  let i = stack.length
  while (i > 0 && paintsAbove(stack[i - 1], added)) i--
  pushCount += 1
  stack.splice(i, 0, { dialog, opener, seq, path: added.path, announcer, epoch: pushCount, returnTo })
  notify()
}

/**
 * Take `dialog` off the stack. Lines still in its live region are handed on
 * (PT-1228 item 2): the region leaves the DOM with the dialog, and a polite
 * line not read yet would never be. They go to the dialog that speaks then
 * (`announceInTopDialog`), or to the fallback when none is left.
 *
 * "Then" is a microtask later (PT-3928 item 1). React runs every passive
 * cleanup of a commit before any of its mount effects, so when dialog A
 * closes and B opens in one commit, B is not on the stack yet while A's
 * cleanup runs; handing on at once would pass B over for the fallback, which
 * is outside B. A dialog pushed after this removal has a region made in that
 * same commit, so the line waits `ANNOUNCER_SETTLE_MS` as in
 * `announceInTopDialog`. A dialog that is back on the stack by then — the
 * simulated unmount of StrictMode — keeps its lines where they are.
 *
 * Only a line written less than `HANDOFF_WINDOW_MS` ago is handed on
 * (item 2): an older one has been read, and closing an inner dialog, or the
 * last one after its toast has gone, must not read it again from the next
 * region. One younger than that may be read twice — a duplicate beats a
 * silent message. The window governs this handoff only: a toast still on
 * screen when the last dialog closes is read again in Chrome by its own copy
 * being shown, whatever its age (PT-4000 item 2).
 * Its line, when younger than the window, is handed on all the same: a
 * browser that prunes for `aria-modal` does not speak that copy (PT-4083).
 *
 * With no dialog left to take it, a line reaches the fallback
 * `ANNOUNCER_SETTLE_MS` later (PT-4000 item 1): the fallback region is outside
 * every dialog, so a browser that prunes for `aria-modal` brings it back into
 * the tree in the very update that closed the last one.
 */
export function removeDialog(dialog: HTMLElement): void {
  const i = stack.findIndex(e => e.dialog === dialog)
  if (i < 0) return
  const [entry] = stack.splice(i, 1)
  notify()
  const region = entry.announcer
  const now = Date.now()
  const fresh = Array.from(region?.children ?? []).filter(
    line => now - (lineWrittenAt.get(line) ?? now) < HANDOFF_WINDOW_MS,
  )
  if (fresh.length === 0) return
  const removedAt = pushCount
  const gen = generation
  queueMicrotask(() => {
    if (gen !== generation) return
    if (region?.isConnected && stack.some(e => e.announcer === region)) return
    for (const line of fresh) {
      line.remove()
      deliver(line.textContent ?? '', lineKeys.get(line), removedAt)
    }
  })
}

export function isTopDialog(dialog: HTMLElement): boolean {
  return stack.length > 0 && stack[stack.length - 1].dialog === dialog
}

export function topDialog(): HTMLElement | null {
  return stack.length > 0 ? stack[stack.length - 1].dialog : null
}

/**
 * Where focus belongs in `dialog` when it comes to the top: the element a
 * call site focused inside it — an `autoFocus`, or a `focus()` in its own
 * effect — while another dialog sat above it, which `Modal` sent back up
 * (PT-2896 items 3 and 4). Null when there is none, or once focus has moved
 * inside `dialog` since it was the top one.
 */
export function returnFocusOf(dialog: HTMLElement): Element | null {
  return stack.find(e => e.dialog === dialog)?.returnTo.current ?? null
}

/**
 * The opener recorded by the open dialog that contains `el`, if any.
 *
 * A modal->modal handoff (a button in dialog A closes A and opens B in the
 * same commit) leaves B's own opener inside A, which is about to be removed.
 * B inherits A's opener as its next candidate, so closing B still lands on the
 * page control the user started from rather than on `<body>`.
 */
export function openerOfDialogContaining(el: Element | null): Element | null {
  if (!el) return null
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].dialog.contains(el)) return stack[i].opener
  }
  return null
}

/** How long an announced line stays in a live region (PT-1172). */
export const ANNOUNCE_TTL_MS = 10_000

/**
 * How long a line waits before going into a live region that did not exist
 * yet when its message was raised (PT-1228 item 4), or that comes back into
 * the accessibility tree in the update that produced the line — the fallback
 * region once the last dialog closes (PT-4000 item 1). A region must be in the
 * accessibility tree before its content changes to be announced, and the
 * browser builds that tree after the commit that rendered the region, not
 * during it.
 */
export const ANNOUNCER_SETTLE_MS = 100

/**
 * How long after it was written a line still counts as unread when its
 * dialog closes (PT-3928 item 2). A polite line is spoken once the speech
 * under way ends, and `ANNOUNCE_TTL_MS` keeps it in the region far longer
 * than that, so "still in the region" alone would hand on lines read
 * seconds ago.
 */
export const HANDOFF_WINDOW_MS = 2_000

// The caller's key for a line, kept with the line when it is handed on.
const lineKeys = new WeakMap<Element, string>()
// When a line went into the region it is in now — see `removeDialog`.
const lineWrittenAt = new WeakMap<Element, number>()

/**
 * Append `message` to the live region `region` as a new child node, removed
 * again after `ANNOUNCE_TTL_MS` (a removal is not announced). A new node per
 * message, not a text swap, so the same message twice in a row is still an
 * addition the screen reader speaks. The timer is not cleared when the region
 * unmounts: removing a detached node does nothing (PT-1228 item 9).
 */
export function appendAnnouncement(region: HTMLElement, message: string, key?: string): void {
  const line = document.createElement('div')
  line.textContent = message
  if (key !== undefined) lineKeys.set(line, key)
  lineWrittenAt.set(line, Date.now())
  region.appendChild(line)
  setTimeout(() => line.remove(), ANNOUNCE_TTL_MS)
}

type Fallback = (message: string, key: string | undefined) => void
let fallback: Fallback | null = null

/**
 * Register what speaks a line handed on from a closing dialog when no other
 * dialog can take it — the owner of the one live region outside every
 * dialog. `null` unregisters; with none registered the line is dropped.
 */
export function setAnnouncementFallback(next: Fallback | null): void {
  fallback = next
}

/**
 * The entry whose live region speaks now: the topmost one that is rendered
 * (PT-1228 item 3). A dialog inside a Suspense boundary that suspended again
 * is set to `display: none` and stays on the stack — no passive cleanup runs —
 * so the top entry alone is not enough. `checkVisibility()` answers for the
 * region's whole ancestor chain; jsdom has no such method, so there every
 * connected region counts as rendered.
 */
function speakingEntry(): Entry | null {
  for (let i = stack.length - 1; i >= 0; i--) {
    const region = stack[i].announcer
    if (!region || !region.isConnected) continue
    if (typeof region.checkVisibility === 'function' && !region.checkVisibility()) continue
    return stack[i]
  }
  return null
}

/**
 * Write `message` into `region`, the region of the entry pushed at `epoch` —
 * or, when that entry was pushed after `raisedAt`, `ANNOUNCER_SETTLE_MS`
 * later into whichever region speaks then (PT-1228 item 4).
 */
function speakIn(region: HTMLElement, epoch: number, message: string, key?: string, raisedAt?: number): void {
  if (raisedAt !== undefined && epoch > raisedAt) {
    deliverLater(message, key)
  } else {
    appendAnnouncement(region, message, key)
  }
}

// `raisedAt` is set only for a line handed on by `removeDialog`.
function deliver(message: string, key: string | undefined, raisedAt?: number): void {
  const entry = speakingEntry()
  if (entry?.announcer) speakIn(entry.announcer, entry.epoch, message, key, raisedAt)
  else if (raisedAt !== undefined) deliverLater(message, key)
  else fallback?.(message, key)
}

/** `deliver` once regions have settled, unless a test reset came first. */
function deliverLater(message: string, key: string | undefined): void {
  const gen = generation
  setTimeout(() => {
    if (gen === generation) deliver(message, key)
  }, ANNOUNCER_SETTLE_MS)
}

/**
 * Speak `message` from inside the top dialog, if one is open (PT-1172).
 *
 * `aria-modal="true"` takes everything outside the dialog out of the
 * accessibility tree in the browsers that honour it, a page-wide live
 * region included, so a message raised while a dialog is open was never read.
 * Each `Modal` therefore renders an empty live region of its own from mount —
 * a region must exist before its content changes to be announced — and the
 * message goes into the top one. (Chrome 152 does NOT prune for
 * `aria-modal`, measured 2026-10-02, so a page-wide region should also hide
 * its outer copy of such a message while a dialog is open: otherwise Chrome
 * reads it twice.) Only `Modal` dialogs are on the stack: a hand-rolled
 * `aria-modal` overlay has no region here (PT-1315).
 *
 * `raisedAt` is `dialogEpoch()` when the message was raised. A dialog pushed
 * after that — one that opened in the same commit as the toast — has a region
 * the browser may not know yet, so the line goes in `ANNOUNCER_SETTLE_MS`
 * later, to whichever dialog speaks then (PT-1228 item 4). `key` stays with
 * the line if it is handed on (`setAnnouncementFallback`).
 *
 * Returns whether a dialog took the message.
 */
export function announceInTopDialog(
  message: string,
  options: { key?: string; raisedAt?: number } = {},
): boolean {
  const entry = speakingEntry()
  if (!entry?.announcer) return false
  speakIn(entry.announcer, entry.epoch, message, options.key, options.raisedAt)
  return true
}

// `details > summary:first-of-type` is the summary that toggles its details;
// a second one is not focusable (PT-1333 item 6).
const TABBABLE =
  'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]),' +
  ' select:not([disabled]), textarea:not([disabled]), iframe, audio[controls],' +
  ' video[controls], [contenteditable]:not([contenteditable="false"]),' +
  ' details > summary:first-of-type, [tabindex]:not([tabindex="-1"])'
// What can take focus at all, a negative `tabindex` included.
const FOCUSABLE = `${TABBABLE}, [tabindex]`

/**
 * Whether the browser counts `el` for focus at all: nothing under `hidden` or
 * `inert`, nothing it does not render (`display: none`, `visibility: hidden`),
 * by `checkVisibility()`. jsdom has no layout and no such method, so there
 * every element counts as rendered.
 */
function rendered(el: Element): boolean {
  return (
    !el.closest('[hidden], [inert]') &&
    (typeof el.checkVisibility !== 'function' ||
      el.checkVisibility({ checkVisibilityCSS: true, visibilityProperty: true }))
  )
}

/**
 * The elements Tab can reach inside `root`, in document order. Re-read on
 * every keystroke by the caller, because the set changes with state (a button
 * that disables while a request is in flight drops out of it).
 *
 * The trap wraps at the two ends, so an element native Tab skips must not be
 * one. Beyond what the selector says, native Tab skips (PT-1171 item 2):
 * - an EXPLICIT negative `tabindex`. Not the IDL default: that is -1 for a
 *   contenteditable (Chrome 152 and jsdom), which Tab still reaches
 *   (PT-1180 item 6);
 * - an element under `hidden` or `inert`, or one the browser does not render
 *   (`rendered`);
 * - the unchecked radios of a group that has a checked one: the group is a
 *   single stop, on that radio. A group with nothing checked keeps all of its
 *   radios, so Tab from the first of them at an end can still step out once —
 *   the next Tab pulls focus back in. The group is HTML's — same `name`, same
 *   form owner, same tree — so its checked radio is looked for in the whole
 *   document, not only in `root`: a form-less radio in the dialog shares a
 *   group with a same-named one in the page behind (PT-1333 item 2).
 */
export function tabbablesIn(root: HTMLElement): HTMLElement[] {
  const tree = root.getRootNode() as ParentNode
  const checked = Array.from(tree.querySelectorAll<HTMLInputElement>('input[type="radio"]:checked'))
  const skippedRadio = (el: HTMLElement) =>
    el instanceof HTMLInputElement &&
    el.type === 'radio' &&
    !el.checked &&
    el.name !== '' &&
    checked.some(r => r.name === el.name && r.form === el.form)
  return Array.from(root.querySelectorAll<HTMLElement>(TABBABLE)).filter(
    el =>
      el !== root &&
      !(el.hasAttribute('tabindex') && el.tabIndex < 0) &&
      rendered(el) &&
      !skippedRadio(el),
  )
}

const SCROLLS = new Set(['auto', 'scroll', 'overlay'])

/**
 * Whether `root` holds a scroll container that native Tab may stop on
 * although no selector can name it (PT-1333 item 6): Chrome 130+ and Firefox
 * make a scroller keyboard-focusable when its content overflows and nothing
 * inside it can take focus; Safari does not. Which browser is running is not
 * knowable here, so `Modal`'s trap does not put these in its wrap list: past
 * the list's end it lets native Tab move and pulls focus back only if it left
 * the dialog. jsdom has no layout, so there every element fits its box.
 *
 * "Can take focus" means any focus, so a child with `tabindex="-1"` keeps
 * native Tab off the scroller and a child the browser does not render does
 * not; a scroller under `inert`, or not rendered, is no stop (PT-2896 item 6).
 */
export function hasFocusableScroller(root: HTMLElement, isBeyond: (el: Element) => boolean): boolean {
  const focusableChild = (el: HTMLElement) =>
    Array.from(el.querySelectorAll(FOCUSABLE)).some(child => !child.matches(':disabled') && rendered(child))
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
    const overflowsY = el.scrollHeight > el.clientHeight
    const overflowsX = el.scrollWidth > el.clientWidth
    if (!overflowsY && !overflowsX) continue
    if (!isBeyond(el) || el.hasAttribute('tabindex') || !rendered(el) || focusableChild(el)) continue
    const style = getComputedStyle(el)
    if ((overflowsY && SCROLLS.has(style.overflowY)) || (overflowsX && SCROLLS.has(style.overflowX))) return true
  }
  return false
}

/**
 * Test-only: forget every entry, and drop every line still being handed on
 * between dialogs, so one test's leak cannot steer the next or speak in its
 * dialog (PT-5060). `test/domSetup.ts` runs it after each test's `cleanup()`. A message still
 * waiting in the registered fallback is not one of these: the fallback's
 * owner clears its own timers (PT-5346).
 */
export function resetModalStackForTests(): void {
  stack.length = 0
  fallback = null
  generation += 1
}
