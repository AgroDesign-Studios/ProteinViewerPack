/**
 * surfaceFailure.ts
 * The rejection handler every `addSurface` call site attaches.
 *
 * ITS OWN FILE, and not a function inside `surfaceType.ts`, because of what it
 * has to import. `surfaceType.ts` is a constants-and-pure-functions leaf that
 * other modules reach for a TYPE; giving it a runtime import of
 * `utils/errorCapture` would drag the error reporter behind every module that
 * touches it, and would make its unit test load it unmocked. That edge is an
 * integration boundary: the error reporter is mocked in unit tests.
 *
 * TWO THINGS HAVE TO BE TRUE AT ONCE, and the obvious one-liner gets only the
 * first. The promise MUST be handled — 3Dmol rejects it when a surface worker
 * errors, and an unhandled rejection is picked up by `errorCapture`'s global
 * listener and reported as a stackless
 * `UnhandledRejection` nobody can act on. But handling it must not make the
 * failure INVISIBLE: `errorCapture` hooks `window.error` and
 * `unhandledrejection` only and never reads the console, so a bare
 * `console.warn` would remove the only report that a surface failed.
 *
 * So the report is made deliberately, through the same explicit entry point the
 * error boundary uses, under a name of its own — strictly better than what it
 * replaces, because the report carries a real message instead of collapsing
 * every surface failure onto one stackless row.
 *
 * ⚠️ EVERY occurrence reports. Do NOT add a page-lifetime "already reported"
 * Set to spare the reporter: it may drop a send it cannot make at that moment,
 * so latching on the attempt marks a failure reported that was never sent, and
 * every later identical one is then swallowed for the life of the tab —
 * strictly worse than the volume it was meant to save. The reporter bounds the
 * volume itself, and the repeat count is the signal that separates a one-off
 * from a persistent break.
 *
 * Still missing, and NOT introduced here because it needs a control and a string
 * of its own: nothing on screen tells the user the surface they asked for never
 * arrived — the checkbox stays ticked over an empty canvas. That gap predates
 * the selectable surface type; it is not a regression from it.
 */
import { reportBoundaryError } from '../../utils/errorCapture'

export function reportSurfaceFailure(reason: unknown): void {
  // A rejected surface build hands back a DOM ErrorEvent, not an Error, so
  // there is no `.stack` and `.name` is undefined — hence the explicit name.
  const detail = (reason as { message?: string } | null)?.message || String(reason ?? 'unknown')
  const message = `3Dmol surface generation failed: ${detail}`.slice(0, 4000)
  // The console gets it too: it costs nothing and it is what a developer
  // watching the tab actually reads.
  console.warn(message)
  const err = new Error(message)
  err.name = 'SurfaceGenerationError'
  reportBoundaryError(err)
}
