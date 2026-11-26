/**
 * A mark kept in this tab's sessionStorage while PyMOL starts or loads a
 * structure — the heaviest moments for memory. A phone's browser that runs
 * out of memory closes the page with no word and opens it again (iOS ends
 * the tab's process); the page that opens with the mark still set says why
 * and starts on 3Dmol.js (`StandaloneApp`), so the user is not left
 * guessing and no start runs into the same wall again by itself.
 *
 * A page left on purpose clears the mark (`pagehide`), a closed tab takes
 * its sessionStorage with it, and a browser that refuses the storage (an
 * opaque origin: the app can run in a sandboxed frame) simply has no mark.
 *
 * The mark is told only to the page that crashed, right after it crashed
 * (PT-9308 item 2, PT-9309 items 1 and 4):
 * - It holds the page's address: another exported file opened next in the
 *   same tab (file:// pages share one storage origin) does not take it.
 * - It holds the time, renewed every `CRASH_MARK_RENEW_MS` while PyMOL is
 *   busy (`StandaloneApp`). iOS reloads a process that ran out of memory at
 *   once, so a page that simply opens (no reload) is told only a mark
 *   younger than `CRASH_MARK_FRESH_MS`: a tab discarded while in the
 *   background, or a browser session restored later, finds an old mark.
 *   Chrome on a computer or Android instead shows its crash page and waits
 *   for the user's Reload, however long they take, while the renewal died
 *   with the page (PT-9376): a reload is told a mark up to
 *   `CRASH_MARK_RELOAD_MS` old. A page that is not crashing fires `pagehide`
 *   before its reload and clears the mark, so an old mark at a reload is a
 *   crash; the bound only keeps a browser that calls a session restored the
 *   next day a reload from telling it.
 * - A page hidden while busy clears the mark (`visibilitychange`; iOS does
 *   not reliably fire `pagehide` on an app switch): a tab closed by the
 *   system in the background is not told, as the system closes background
 *   tabs for other reasons too (PT-9309 item 1). The crash the user
 *   watched, in sight, keeps its mark.
 * - A page brought back from history rather than reloaded is not told: a
 *   duplicated tab copies the sessionStorage, and Chrome opens it, like a
 *   restored session, as a history navigation (`back_forward`); Chrome's
 *   reload of a tab it discarded says so (`document.wasDiscarded`). Another
 *   browser's duplicate inside the window may still be told — the cost is a
 *   paragraph and a start on 3Dmol.js, never a lost structure.
 */
const KEY = 'agdb-pvp-pymol-starting'

/** How often the mark's time is renewed while PyMOL is busy. */
export const CRASH_MARK_RENEW_MS = 5_000
/** A page that opens without a reload: a mark older than this is not a crash of this page a moment ago. */
export const CRASH_MARK_FRESH_MS = 30_000
/** A reload (the user's, from the browser's crash page): a mark older than this is not told. */
export const CRASH_MARK_RELOAD_MS = 60 * 60_000

/** The page's address, without its fragment. */
const pageOf = (): string => window.location.href.split('#')[0]

/** Sets (`true`, with the time) or clears the mark. */
export function markPymolStarting(on: boolean, now: number = Date.now()): void {
  try {
    if (on) window.sessionStorage.setItem(KEY, JSON.stringify({ at: now, page: pageOf() }))
    else window.sessionStorage.removeItem(KEY)
  } catch {
    // No storage here: no mark.
  }
}

/**
 * How the page arrived: brought back from history (a duplicated tab, a
 * restored session) or from a discard (`restored`), reloaded (`reload`), or
 * opened otherwise, including a browser that does not say (`opened`).
 */
function arrival(): 'restored' | 'reload' | 'opened' {
  if ((document as Document & { wasDiscarded?: boolean }).wasDiscarded === true) return 'restored'
  try {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
    if (nav?.type === 'back_forward') return 'restored'
    return nav?.type === 'reload' ? 'reload' : 'opened'
  } catch {
    return 'opened'
  }
}

/**
 * True when this page closed while PyMOL was starting (the mark is for this
 * page, fresh for the way the page arrived, and the page was not brought
 * back from history or a discard); clears the mark either way.
 */
export function takePymolCrashMark(now: number = Date.now()): boolean {
  try {
    const raw = window.sessionStorage.getItem(KEY)
    window.sessionStorage.removeItem(KEY)
    if (raw === null) return false
    const mark: unknown = JSON.parse(raw)
    if (typeof mark !== 'object' || mark === null) return false
    const { at, page } = mark as { at?: unknown; page?: unknown }
    if (typeof at !== 'number' || page !== pageOf()) return false
    const how = arrival()
    if (how === 'restored') return false
    const age = now - at
    return age >= 0 && age <= (how === 'reload' ? CRASH_MARK_RELOAD_MS : CRASH_MARK_FRESH_MS)
  } catch {
    return false
  }
}
