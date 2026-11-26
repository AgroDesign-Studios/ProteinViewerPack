/**
 * The test setup with no network part, which the Protein Viewer Pack's
 * source runs its tests with
 * (standalone/structure-viewer/source/vitest.config.ts, PT-9911).
 *
 * - jest-dom matchers (toBeVisible, toHaveTextContent, etc.)
 * - Unmount what each test rendered, then reset the open-dialog stack,
 *   dropping the live-region lines a closed dialog is still handing on
 *   (PT-5060)
 * - Deterministic number format: pin the number-format style to 'si' per test
 * - Deterministic date and time: pin the display timezone to Asia/Tokyo per test
 * - Stubs for browser APIs jsdom doesn't implement (matchMedia,
 *   IntersectionObserver, ResizeObserver)
 * - `window.event` reads the live event, as in a browser (PT-751)
 */
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'
import { resetModalStackForTests } from '../components/modalStack'
import { setDisplayTimeZone } from '../utils/formatDate'
import { setNumberFormatStyle } from '../utils/formatSI'
import { NUMBER_FORMAT_STORAGE_KEY } from '../utils/numberFormatStyle'

// formatSI boots in 'auto', resolved from the RUNNER's locale — assertions on
// space-grouped output would silently depend on the CI box's OS locale. Pin SI
// before every test; a test exercising another style sets its own and is
// re-pinned here afterwards.
beforeEach(() => setNumberFormatStyle('si'))
// Exactly the same failure, one axis over. `formatDateTime` renders in the
// BROWSER's zone unless a user has overridden it, so an assertion on a rendered
// timestamp silently depends on the runner's TZ: one asserted "2026/08/05 08:06",
// passed on a JST machine and failed in a UTC container, where the same instant
// renders "2026/08/04 23:06". Pinning here rather than in the one test means the
// next date assertion cannot reintroduce it. Asia/Tokyo, because that is the
// zone the fixtures are written in. A test exercising another zone sets its own
// and is re-pinned here after.
beforeEach(() => setDisplayTimeZone('Asia/Tokyo'))
afterEach(() => {
  // RTL auto-cleanup is wired only when vitest's `globals: true` is set;
  // we run with globals=false so the unmount has to be explicit, otherwise
  // each render() leaks DOM into the next test (and screen.getByRole etc.
  // start finding "multiple elements" from earlier renders).
  cleanup()
  // Unmounting a dialog that is still open hands its unread live-region lines
  // on, a microtask and a settle timer later; they landed in the next test's
  // dialog (PT-5060). After `cleanup()`, so the unmount runs against the real
  // stack and whatever it hands on is dropped.
  resetModalStackForTests()
  // A test that persisted a number-format preference must not leak it forward.
  localStorage.removeItem(NUMBER_FORMAT_STORAGE_KEY)
})

// jsdom polyfills for browser APIs that React + libraries assume exist.
//
// The guards test `typeof`, NOT the `in` operator. jsdom declares
// `window.matchMedia` as an ACCESSOR whose getter returns undefined -- a
// not-implemented stub -- so `'matchMedia' in window` is true while the value
// is undefined. Under Vitest 2 that accessor was not exposed and the `in` form
// happened to work; under Vitest 4 it is, so the `in` guard skipped the
// polyfill and every `vi.spyOn(window, 'matchMedia')` failed with "can only spy
// on a function. Received undefined". IntersectionObserver and ResizeObserver
// are real functions in jsdom 25 (measured), so their guards are inert either
// way -- they use the same form so the next unimplemented API cannot slip
// through on the same trap.
/** Fresh no-reduced-motion matchMedia double. Reinstalled per test — see the
 *  beforeEach below for why once is not enough. */
function installMatchMedia(): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
}

/**
 * `window.event` as a browser defines it (PT-751): a getter for the event
 * being dispatched now, which an assignment shadows with a plain value until
 * the property is defined again ([Replaceable]).
 *
 * Without this, vitest's jsdom environment answers with an accessor of its
 * own whose setter keeps any value written for the rest of the file. React 18
 * DEV writes one on every guarded callback (each event handler, each replay of
 * a render error): `invokeGuardedCallbackDev` assigns `window.event` and then
 * puts the descriptor it found back, expecting the live value to return. With
 * vitest's accessor it never does, so the FIRST such call in a file froze
 * `window.event` -- to `click` when a handler came first, to `undefined` when a
 * render-error replay did. React picks the lane of a state update made outside
 * an event from `window.event`, so whether a promise continuation's update
 * committed in a microtask or in a later Scheduler task depended on which test
 * ran first. A test that read the screen before the update could then pass in
 * one order and race in another (PT-706). With this getter an update made after
 * the dispatch is over takes the later path in any order, as a network answer's
 * does in a browser. One difference stays: a browser runs the microtasks a
 * user's click queued while the click is still `window.event`, and a script's
 * `click()` does not.
 */
function installLiveWindowEvent(): void {
  const dom = (globalThis as { jsdom?: { window: { event?: Event } } }).jsdom
  // Not the jsdom environment (a file that opted into another one).
  if (dom === undefined) return
  const jsdomWindow = dom.window
  Object.defineProperty(globalThis, 'event', {
    configurable: true,
    enumerable: true,
    get: () => jsdomWindow.event,
    set(value: unknown) {
      Object.defineProperty(globalThis, 'event', { configurable: true, enumerable: true, writable: true, value })
    },
  })
}

if (typeof window !== 'undefined') {
  installMatchMedia()
  // Per test, not once: from Vitest 4, `vi.spyOn` on a property whose value is
  // ALREADY a vi.fn() mutates that same mock rather than wrapping it, and
  // `vi.restoreAllMocks()` does not undo that (measured: the spied return value
  // survives the restore). One shared double therefore keeps whatever the first
  // spying test set — `prefers-reduced-motion: reduce`, say, which then made
  // every later test in the file take the reduced-motion branch. Tests that need another answer still
  // spy or `vi.stubGlobal` inside the test; this only decides where they start.
  beforeEach(installMatchMedia)
  // Per test as well, so a test that assigns `window.event` and never puts the
  // property back cannot hand its value to the next test.
  installLiveWindowEvent()
  beforeEach(installLiveWindowEvent)
  if (typeof window.IntersectionObserver !== 'function') {
    class _IO {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
      takeRecords(): unknown[] { return [] }
    }
    // jsdom polyfill (type-checked since this file moved under src/, PT-9911)
    window.IntersectionObserver = _IO as unknown as typeof IntersectionObserver
  }
  if (typeof window.ResizeObserver !== 'function') {
    class _RO {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    // jsdom polyfill
    window.ResizeObserver = _RO
  }
  // CodeMirror 6 measures text with Range.getClientRects /
  // getBoundingClientRect, which jsdom leaves unimplemented (throws "Not
  // implemented"). Empty geometry is fine — CM falls back to estimated
  // metrics in tests. jsdom never implements layout, so override always.
  if (typeof Range !== 'undefined') {
    const emptyRect = {
      x: 0, y: 0, top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0,
      toJSON: () => ({}),
    } as DOMRect
    Range.prototype.getBoundingClientRect = () => emptyRect
    Range.prototype.getClientRects = () => {
      const list = [] as unknown as DOMRectList
      // jsdom polyfill — DOMRectList has no public constructor
      list.item = () => null
      return list
    }
  }
}
