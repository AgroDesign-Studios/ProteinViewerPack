/**
 * The one place that decides whether a 3Dmol surface is REBUILT or merely
 * RESTYLED, and the one place that knows a build is still running.
 *
 * `applySceneStyles` used to do the simple thing: `removeAllSurfaces()` on every
 * restyle, then `addSurface()` if the switch was on. That is correct and it is
 * what shipped, but two costs fell out of it once the surface type became
 * selectable (PT-382 items 1 and 2), because an MS mesh is the most expensive
 * of the four and every one of them is measured in whole seconds:
 *
 *  1. **Nothing stopped a superseded build.** 3Dmol terminates a surface's
 *     workers inside `releaseMemory()`, and that only runs when the build
 *     resolves or errors (`GLViewer.ts` ~4610/4645) — `removeAllSurfaces` just
 *     drops the `surfaces[surfid]` entry (disposing the geometry of any part
 *     that has already rendered, i.e. has a `lastGL`). So a superseded build
 *     kept all four of its workers to completion and then merged its mesh into
 *     a geometry nothing would ever draw. Clicking through the four surface
 *     chips queued four of those.
 *  2. **The Opaque toggle rebuilt the mesh** to change one number, because
 *     `surfaceOpaque` sits in the restyle deps like everything else. 3Dmol has
 *     `setSurfaceMaterialStyle` for exactly this and the repo had zero uses.
 *
 * There is NO cancel in 3Dmol's surface API, so item 1 cannot be fixed by
 * aborting the running build. What this module does instead is refuse to start
 * a second one: a request that arrives mid-build is remembered, the last one
 * wins, and it is applied when the running build settles.
 *
 * ⚠️ MEASURED COSTS, so the next person reasons from numbers rather than from
 * the estimates this file used to carry (2026-08-29, 3Dmol's synchronous path
 * over real PDB entries on one CPU core):
 *
 *   8XOK, 1,500 heavy atoms,  4 extents: VDW 338 ms, MS 460 ms   (1.36x)
 *   8XOK, 9,616 heavy atoms, 16 extents: VDW 1,194 ms, MS 2,050 ms (1.72x)
 *   8JXU, 11,205 heavy atoms, 30 extents: VDW 447 ms, MS 658 ms   (1.47x)
 *   a restyle, for comparison: 1.87 / 2.06 / 2.36 ms
 *
 * So MS costs 1.4-1.7x a VDW build — NOT the "roughly four times" this
 * docstring, #1668's commit message and PT-382 item 1 all asserted from an
 * estimate. Item 2 is where the leverage actually is: a restyle is 200-1,000x
 * cheaper than the rebuild it replaces.
 *
 * ⚠️ "A burst of four chip clicks costs two builds" is the BEST case, not a
 * bound. Only a click that lands WHILE a build is running is collapsed into the
 * queue; one that lands after the previous build settled starts its own. A real
 * MS build finishes well inside a second and humans click every 0.3-0.5 s, so a
 * hand-paced burst is close to one build per click. The queue is still worth
 * having — it is what makes a burst BOUNDED — but it does not divide the cost
 * by the number of clicks.
 *
 * State lives in a `WeakMap` keyed by the viewer rather than on the viewer
 * object, so nothing of ours can collide with a 3Dmol property, and it is
 * collected with the viewer. It is deliberately NOT a React ref: every
 * page would need its own, which is the duplication `sceneStyles.ts` exists
 * to end (`vibe-coding-best-practices.md` §15.2).
 */

import { reportSurfaceFailure } from './surfaceFailure'

/** 3Dmol publishes no types; see `sceneStyles.ts` for the documented exception. */
type Viewer = any

/**
 * A built surface, reported as a FRESH OBJECT for every build.
 *
 * Deliberately not a bare id. 3Dmol recycles surface ids — `nextSurfID()`
 * returns max+1 over the REMAINING keys (`GLViewer.ts:313`), so the surface
 * that replaces one after `removeAllSurfaces` is handed the same id back — and
 * a build already in flight cannot be stopped (see the module doc above). Two
 * builds therefore report the same NUMBER, and a consumer comparing numbers
 * cannot tell "the mesh finished" from "nothing changed" — which is how a cap
 * ends up cut from a half-merged mesh with no later id change to correct it.
 *
 * A fresh object makes every completed build distinguishable by identity, so a
 * consumer re-reads the mesh on each one. A superseded build reporting late
 * then costs one extra read of the CURRENT surface rather than pinning a stale
 * one — and the live build's own report, which arrives whenever it finishes,
 * is always the last word.
 *
 * A DISOWNED build reports nothing at all: once its mesh has been removed, or
 * it has been declared dead by the watchdog, its id names whatever was built
 * next and the extra read would be of a mesh still merging. See `buildToken`.
 *
 * Defined here because this module owns every point where a handle is born or
 * its mesh dropped; consumers keep their one import site, `sceneStyles.ts`,
 * which re-exports it.
 */
export interface SurfaceHandle {
  readonly id: number
}

/** `ApplyOptions.onSurface`'s shape — threaded through to the commit that
 *  actually drops or builds a mesh, because only that commit knows which. */
export type SurfacePublisher = (surface: SurfaceHandle | null) => void

/**
 * Hand a consumer its surface without letting it break the surface machinery.
 *
 * A consumer's failure is not a surface failure. Several publishes run inside
 * the build promise's callbacks, where an uncaught throw would either become
 * the stackless `UnhandledRejection` that `surfaceFailure.ts` exists to
 * prevent, or be swept into the rejection path and report a healthy mesh as
 * broken. Guarded at ALL call sites, not just the asynchronous ones, so the
 * publish contract does not change with the path that serves the request.
 */
function publish(onSurface: SurfacePublisher | null, surface: SurfaceHandle | null): void {
  if (!onSurface) return
  try {
    onSurface(surface)
  } catch (err) {
    console.error('Surface consumer failed:', err)
  }
}

/**
 * One surface, as 3Dmol's `addSurface` takes it.
 *
 * Split into geometry (`type` + `sel`) and material (`style`) because that
 * split IS the optimisation: only a material change can skip the rebuild.
 */
export interface SurfaceRequest {
  /** Argument 0 — the resolved `SurfaceType` NUMBER, never a key and never
   *  `undefined` (`surfaceType.ts` explains what an `undefined` draws). */
  type: number
  /** Argument 1 — the material. The ONLY part that may change without a
   *  rebuild. */
  style: { opacity: number; color: string }
  /** Argument 2 — which atoms the mesh is generated over. Part of the
   *  GEOMETRY, so a change here rebuilds. */
  sel: Record<string, unknown>
}

interface SurfaceState {
  /** The id 3Dmol gave the mesh we put in the scene, or null if we have none. */
  surfid: number | null
  /** The request that id was built from — what a later request is compared
   *  against. Null means "assume nothing is there". */
  built: SurfaceRequest | null
  /**
   * `mat.side` for each part of the built surface, exactly as `addSurface` left
   * it, or null when it could not be read.
   *
   * Captured at build time and put back after a restyle, because 3Dmol's
   * `setSurfaceMaterialStyle` resets `mat.side` to front faces only, which
   * would strip the back faces off a translucent surface.
   */
  sides: Array<number | undefined> | null
  /** A build is running and cannot be cancelled. */
  building: boolean
  /**
   * Which build `building` is holding the gate for, or null when none is.
   *
   * A build can now be DISOWNED before it settles — by the watchdog below, and
   * by a removal that threw its mesh away — and a disowned build's `then` still
   * fires whenever its workers happen to finish. Every handler therefore
   * compares the token it captured at issue time against this one and does
   * nothing when they differ: it must not publish a handle for a mesh that was
   * removed, must not clear a gate a LATER build is holding, and must not
   * commit that build's queued request a second time.
   *
   * PT-382 item 1 recorded that the monotonic request id its deferral note
   * predicted "turned out to be unnecessary — there is only ever one build and
   * one queued request". That was true while the ONLY exit from a build was its
   * own settle. Releasing the gate early is exactly what makes two builds
   * overlap, so the identity comes back with it — as an object rather than a
   * counter, for the same reason `SurfaceHandle` is one.
   */
  buildToken: object | null
  /**
   * The pending watchdog poll for the build `buildToken` names, or null.
   *
   * Held in state, not just in the closure that armed it, so that disowning a
   * build can stop watching it in the same breath.
   */
  watchdog: ReturnType<typeof setTimeout> | null
  /**
   * The request that arrived while a build was running, or null for none.
   *
   * Only ever a real request: switching the surface OFF is applied
   * immediately instead of being queued (see `applySurface`), so there is no
   * "queued null" to tell apart from an empty slot.
   */
  queued: SurfaceRequest | null
  /**
   * The publisher belonging to `queued`. A queued request must report through
   * ITS caller's callback, not the running build's — the two are set and
   * cleared together, always.
   */
  queuedOnSurface: SurfacePublisher | null
}

const STATES = new WeakMap<object, SurfaceState>()

function stateFor(viewer: Viewer): SurfaceState {
  let state = STATES.get(viewer as object)
  if (!state) {
    state = {
      surfid: null,
      built: null,
      sides: null,
      building: false,
      buildToken: null,
      watchdog: null,
      queued: null,
      queuedOnSurface: null,
    }
    STATES.set(viewer as object, state)
  }
  return state
}

/**
 * "Assume nothing is drawn."
 *
 * One place, because these three fields have to move together and saying so
 * three times is what let a fourth field drift out of step once already.
 */
function forget(state: SurfaceState): void {
  state.surfid = null
  state.built = null
  state.sides = null
}

/**
 * How long a build may make NO progress before it is treated as dead (PT-382
 * item 5).
 *
 * The deferral note asked for "a measurement of real MS build times, not a
 * guessed constant", and refused every watchdog because a slow legitimate build
 * and a dead one look the same on a clock. That objection is answered by
 * WATCHING PROGRESS rather than elapsed time — a slow build still merges
 * extents, a dead one merges nothing — and the constant then only has to clear
 * the longest gap BETWEEN two merges, not the whole build.
 *
 * From the measurements in the module doc: the slowest structure spent 2,050 ms
 * over 16 extents, i.e. ~128 ms per extent, and the widest 658 ms over 30, i.e.
 * ~22 ms. Allow 5x for a slow client core, and 3x for the spread between a
 * small extent and a large one, and the worst honest gap is about 2 s. Four
 * polls of 5 s is 20 s, ten times that, and bounds the detection lag at 25 s. In
 * the normal case no poll ever runs — a build that finishes in under a second
 * clears the timer first.
 *
 * ⚠️ COUNTED IN POLLS, not read off a clock. `Date.now()` is a wall clock, so a
 * backward jump would suspend stall detection for the length of the jump and a
 * forward one would cut a healthy build short. Counting depends on nothing but
 * the timer itself. The one behavioural difference is under tab throttling,
 * where a clamped `setTimeout` makes four polls take LONGER than 20 s — and
 * that is the safe direction, both because a throttled tab is one of the very
 * conditions that kills the workers this watches for, and because nobody is
 * looking at a background tab.
 */
const BUILD_POLL_MS = 5_000
const BUILD_STALL_POLLS = 4

/**
 * How far a build has got.
 *
 * `mergeGeos` PUSHES one group onto `geo.geometryGroups` per merged chunk
 * (`utilities.ts:244`) and `addSurface` calls it once per split mesh per extent
 * (`GLViewer.ts` ~4575 sync / ~4632 worker), so the number of groups across a
 * surface's parts IS the build's own progress meter. 3Dmol reports nothing else
 * until the whole build resolves.
 *
 * ⚠️ Deliberately `geometryGroups.length`, NOT `geo.groups`: `mergeGeos` pushes
 * straight onto the array and never touches that counter, so `groups` sits at 0
 * for the whole build. `sectionCap.ts` walks the same array by its own length
 * for the same reason.
 */
function countGroups(parts: SurfacePart[]): number {
  // A plain loop, NOT `.reduce`/`.map`, for the species-constructor reason
  // `captureSides` documents.
  let groups = 0
  for (const part of parts) {
    const geometryGroups = part?.geo?.geometryGroups
    if (Array.isArray(geometryGroups)) groups += geometryGroups.length
  }
  return groups
}

/** Stop polling the build this state was watching, if it was watching one. */
function stopWatchdog(state: SurfaceState): void {
  if (state.watchdog === null) return
  clearTimeout(state.watchdog)
  state.watchdog = null
}

/**
 * Give up the build now in flight: the gate opens, and that build's late
 * settle must change nothing.
 *
 * The workers keep running — 3Dmol terminates them only from `releaseMemory()`,
 * which fires on resolve or error — so this is not a cancel. It is the
 * admission that whatever they finish is of no further use to us, which is
 * already true at all three call sites: the mesh has been removed from the
 * scene, it has not grown in twenty seconds, or the poll that was watching it
 * threw and there is nothing left to watch with.
 */
function disownBuild(state: SurfaceState): void {
  state.buildToken = null
  state.building = false
  stopWatchdog(state)
}

/**
 * Watch one build, and give up on it when its mesh stops growing (PT-382
 * item 5).
 *
 * A surface build whose worker dies settles neither way, so this gives up
 * on it and frees the Surface controls.
 *
 * ⚠️ PROGRESS, never elapsed time. A watchdog on the clock alone cannot tell a
 * slow legitimate build from a dead one at any constant, which is why PT-382
 * item 5 was deferred; a build that is merging extents is alive whatever it is
 * costing. `onStalled` is the same routine a normal settle runs, so the request
 * the user queued while the gate was shut is applied rather than lost — the
 * difference the user sees is their click taking effect instead of nothing.
 */
function armWatchdog(
  viewer: Viewer,
  state: SurfaceState,
  token: object,
  surfid: number | null,
  onStalled: () => void,
): void {
  // No id means `addSurface` returned a thenable without stamping one, so this
  // is not a 3Dmol viewer and nothing about the build is observable. The gate
  // still protects it; it simply cannot be watched.
  if (surfid === null) return
  // ⛔ Pinned to the parts array 3Dmol registered for THIS build, not to the
  // number. `nextSurfID` is max+1 over the remaining keys, so once someone
  // else's `removeAllSurfaces` has emptied the map the same number names a
  // DIFFERENT surface — and that surface's own extents would then read as our
  // dead build's progress and re-arm the watchdog forever, defeating the one
  // mechanism this module has for the failure it exists to catch. The identity
  // comparison is the same reasoning `SurfaceHandle` is an object for.
  const watched = surfaceParts(viewer, surfid)
  if (watched === null) return
  let progress = countGroups(watched)
  let stalledPolls = 0

  const poll = (): void => {
    state.watchdog = null
    // Settled, or given up on by a removal, since the last poll.
    if (state.buildToken !== token) return
    // An unreadable or REPLACED entry can never merge another extent of ours,
    // so it counts as no progress rather than as a reason to stop watching.
    const parts = surfaceParts(viewer, surfid)
    const now = parts === watched ? countGroups(parts) : null
    if (now !== null && now !== progress) {
      progress = now
      stalledPolls = 0
    } else {
      stalledPolls += 1
    }
    if (stalledPolls < BUILD_STALL_POLLS) {
      state.watchdog = setTimeout(guarded, BUILD_POLL_MS)
      return
    }
    // The mesh stopped growing and the promise never came. Whatever partial
    // geometry reached the scene is all there will ever be, so the retention
    // goes with the gate: a later identical request must REBUILD rather than
    // restyle a half-merged mesh, which is the same reasoning the rejection
    // path uses.
    forget(state)
    disownBuild(state)
    onStalled()
  }

  // ⚠️ The WHOLE body is guarded, for the reason `settle`'s own catch gives:
  // this runs from a timer, where nothing is listening, so an escape would be a
  // stackless uncaught error AND would leave the gate shut with no timer left
  // to reopen it — the exact state this watchdog exists to prevent.
  //
  // Nothing in `poll` can throw TODAY: every `getSurface` read goes through
  // `surfaceParts`, `countGroups` only walks guarded fields, and `settle` wraps
  // its own body. It is kept anyway, and said out loud rather than left to look
  // load-bearing, because the cost of being wrong here is silent and permanent
  // while the guard costs one closure.
  const guarded = (): void => {
    try {
      poll()
    } catch (reason) {
      // ⛔ `onStalled()` too, not just the gate. This was the ONE of the four
      // ways an owning build can end that left `state.queued` populated while
      // opening the gate: the user's mid-build click vanished with no report,
      // and then the NEXT build's settle found the stale slot and committed it
      // over a newer request — the chips-describe-a-mesh-that-is-not-there
      // divergence, reached by a second route. `settle` wraps its whole body,
      // so it cannot throw back into this timer.
      forget(state)
      disownBuild(state)
      reportSurfaceFailure(reason)
      onStalled()
    }
  }
  state.watchdog = setTimeout(guarded, BUILD_POLL_MS)
}

/**
 * Drop what we believe about this viewer's surface, so the next request is a
 * full rebuild.
 *
 * For code that adds a surface straight at 3Dmol without coming through here.
 * That surface is one this module did not create and will never remove, while
 * its own mesh is still perfectly valid; the restyle path would therefore fire
 * and leave the foreign surface on screen. The rebuild this forces is what
 * clears it, which is what every restyle used to do.
 *
 * The QUEUED request goes too. A request made before the raw caller acted is
 * stale intent, and leaving it in place let a chip click from before that
 * call wipe the raw caller's surface when the running build settled — with no
 * toolbar interaction in between, which is the opposite of the documented "it
 * survives until the next toolbar change".
 *
 * A raw `removeAllSurfaces` does not need this for the RETENTION: it deletes
 * the very entry `isLive` reads, so the check below already refuses to trust
 * the id. It still needs it for the QUEUE — a raw removal's caller calls
 * this for exactly that half, or the request queued before the removal would
 * rebuild what the raw caller just cleared, publishing through a wrapper the
 * page has already invalidated.
 *
 * ⚠️ THE GATE IS DELIBERATELY LEFT SHUT. A build of ours may still be running,
 * and this does not disown it: the raw caller replaced what is on screen, but
 * our workers are real and still burning, so letting the next toolbar request
 * start a SECOND set on top of the raw caller's own is the stacking PT-382
 * item 1 exists to prevent. The next request therefore queues behind our build
 * and lands when it settles — sub-second in every measurement in the module
 * doc — and `armWatchdog` is what guarantees "when it settles" is not "never".
 *
 * ⚠️ SO THE ONE-BUILD INVARIANT IS NOT GLOBAL, and this docstring used to imply
 * it was. A raw `addSurface` is ADDITIVE and calls no
 * `removeAllSurfaces`, so a raw call arriving mid-build genuinely runs two
 * builds at once — eight workers — and nothing here can stop it, because it
 * never comes through this module. What is true is narrower and is what the
 * gate actually promises: THIS module starts at most one build at a time.
 * Closing the wider gap would mean routing that caller through `applySurface`,
 * which it deliberately does not do (its surface is a one-off render the page
 * will not speak for).
 */
export function forgetSurface(viewer: Viewer): void {
  const state = stateFor(viewer)
  forget(state)
  state.queued = null
  state.queuedOnSurface = null
}

/**
 * Drop only what we BUILT — the retention — keeping any queued request.
 *
 * For a caller whose MODEL SET changed under the mesh: the retained geometry
 * no longer matches the atoms, so the next request must rebuild rather than
 * restyle — but a request queued behind a running build is the user's current,
 * still-valid intent, and the rebuild it will get on settle is exactly what
 * the moved atom set needs. `forgetSurface` would drop that click, and a
 * caller whose only restyle passes `skipSurface` has no surface-bearing
 * restyle of its own to re-issue it.
 */
export function forgetBuiltSurface(viewer: Viewer): void {
  forget(stateFor(viewer))
}

/**
 * The surface this module built and still holds for `viewer`: its 3Dmol id and
 * the request it was built (or last restyled) from, or null when it holds none.
 *
 * Read-only. 3Dmol keeps a surface's style and selection but not its TYPE
 * (`addSurface` resolves the type into a local), so a caller that needs the
 * type of the mesh on screen asks here. A surface added outside this module (by a raw caller) is not
 * described here.
 */
export function builtSurface(viewer: Viewer): { surfid: number; request: SurfaceRequest } | null {
  const state = STATES.get(viewer as object)
  if (!state || state.surfid === null || state.built === null) return null
  return { surfid: state.surfid, request: state.built }
}

/**
 * Draw `request`, or remove the surface when it is null.
 *
 * Safe to call on every restyle: an identical request does nothing at all.
 *
 * ⚠️ TWO CONTRACT LIMITS, both PT-423, both unreachable through today's
 * consumers and both cheaper to state than to mechanise (round-protocol rule 4:
 * a flag guarding a case nothing hits is a second mechanism):
 *
 *  1. **A publisher must not synchronously re-enter `applySurface`** (DC-4).
 *     `publish` guards throws, not re-entrancy: the null publish on the rebuild
 *     path runs BEFORE `addSurface`, with `building` still false, so a consumer
 *     that calls back in synchronously commits a second build and the outer
 *     commit then writes its `surfid`/`built`/`sides` over the inner one. Every
 *     consumer today publishes into React state, which is batched and never
 *     synchronous.
 *  2. **The chips can describe a mesh that is not on screen** (DC-3). A queued
 *     toolbar request dropped by `forgetSurface` was set in React state at click
 *     time and nothing re-asserts it, so MS -> SAS (queued) -> a raw
 *     `addSurface` leaves the chips reading SAS over the raw caller's mesh.
 *     Accepted rather than fixed: the only reconciliation available is to
 *     re-run `applySceneStyles` after the raw call, which would rebuild the
 *     toolbar's surface and so DELETE the surface the user just asked for —
 *     the call losing to its own repaint. Pre-#1668 the same gesture left
 *     both meshes stacked, so this is a different wrongness, not a new one.
 */
export function applySurface(
  viewer: Viewer,
  request: SurfaceRequest | null,
  onSurface?: SurfacePublisher,
): void {
  const state = stateFor(viewer)

  // A REMOVAL is never queued, even mid-build. It needs no build and cannot
  // race one: `removeAllSurfaces` deletes the entry, and `render()` walks
  // `viewer.surfaces` alone, so the build that cannot be cancelled goes on
  // merging into a geometry nothing draws — which is what happens anyway.
  // Deferring it bought nothing and cost the user the whole build latency with
  // the surface still painted, still GROWING (3Dmol renders per worker chunk),
  // and the chip already reading unpressed.
  if (request === null) {
    state.queued = null
    state.queuedOnSurface = null
    commit(viewer, state, null, false, onSurface ?? null)
    return
  }

  // Last writer wins. Overwriting an already-queued request is the point —
  // clicking VDW then SES then MS mid-build should build MS, not all three.
  if (state.building) {
    state.queued = request
    state.queuedOnSurface = onSurface ?? null
    return
  }
  commit(viewer, state, request, false, onSurface ?? null)
}

/**
 * A stable key for a selector, or null when the selector cannot be compared.
 *
 * `JSON.stringify` is not used: it silently drops functions, so two DIFFERENT
 * `colorfunc`-style selectors would stringify identically and we would reuse a
 * mesh built for the other one. Anything that is not a primitive returns null
 * here instead, and a null key is never equal to anything — the failure
 * direction is one unnecessary rebuild, never a wrong picture.
 *
 * `typeof` is part of each entry so `{ resi: 1 }` and `{ resi: '1' }` are not
 * mistaken for each other, and both halves are percent-encoded so a value
 * containing the separators cannot forge a different selector's key —
 * `{ 'a=string:1&b': 'x' }` and `{ a: '1', b: '=string:x' }` are the shape that
 * would otherwise collide, and a collision here is the one failure this
 * function's own invariant promises cannot happen.
 */
function selectorKey(sel: Record<string, unknown>): string | null {
  const parts: string[] = []
  for (const key of Object.keys(sel).sort()) {
    const value = sel[key]
    if (value !== null && (typeof value === 'object' || typeof value === 'function')) return null
    parts.push(`${encodeURIComponent(key)}=${typeof value}:${encodeURIComponent(String(value))}`)
  }
  return parts.join('&')
}

function sameGeometry(a: SurfaceRequest, b: SurfaceRequest): boolean {
  if (a.type !== b.type) return false
  const ka = selectorKey(a.sel)
  return ka !== null && ka === selectorKey(b.sel)
}

function sameMaterial(a: SurfaceRequest, b: SurfaceRequest): boolean {
  return a.style.opacity === b.style.opacity && a.style.color === b.style.color
}

/**
 * The parts 3Dmol keeps for one surface id — one per model, usually one.
 *
 * THE one place this module reads `getSurface`, and therefore the one place
 * that has to survive a viewer answering badly. Two ways it can: with something
 * that is not an array (everything downstream iterates the result), and by
 * throwing. Both answer null here, so every caller — `captureSides`,
 * `restoreSides`, `isLive`, the watchdog's progress read — gets the same
 * "cannot be interrogated" it already knows how to handle.
 */
interface SurfacePart {
  mat?: { side?: unknown }
  geo?: { geometryGroups?: unknown }
}

function surfaceParts(viewer: Viewer, surfid: number): SurfacePart[] | null {
  if (typeof viewer?.getSurface !== 'function') return null
  let parts: unknown
  try {
    parts = viewer.getSurface(surfid)
  } catch {
    // A `getSurface` that THROWS is not a shape this module can work with, and
    // it used to escape from whichever caller happened to read first —
    // `captureSides`, straight out of `applySceneStyles` mid-restyle. Answering
    // "unreadable" instead puts every caller on the path it already has for a
    // viewer that cannot be interrogated: rebuild rather than restyle, and do
    // not watch. There is no unguarded read left: `isLive` asks through here
    // too, so "unreadable" and "not live" are one answer.
    //
    // Deliberately silent — the read is a question, and "no" is a valid answer
    // to it. ⚠️ The price is on the watchdog: a viewer that starts throwing
    // MID-BUILD reads as no-progress, so a live build is given up on after
    // twenty seconds and costs one rebuild, with the queued click still landing
    // and nothing reported. Pinned by 'gives up on a LIVE build whose viewer
    // stops answering mid-build', which asserts the grace window and the silence
    // — without those two, the same outcome arrives via `guarded`'s catch one
    // frame up and the test cannot tell this design from no catch at all.
    return null
  }
  return Array.isArray(parts) ? parts : null
}

/** `mat.side` as `addSurface` left it. Empty when it could not be read. */
function captureSides(viewer: Viewer, surfid: number): Array<number | undefined> {
  const parts = surfaceParts(viewer, surfid)
  if (!parts) return []
  // A plain loop, NOT `.map`: `getSurface` returns 3Dmol's `Surface`, which
  // extends Array with a constructor that SPREADS its argument, so any array
  // method that species-constructs — `map`, `flatMap`, `filter`, `slice` —
  // dies on `new Surface(len)` spreading a number. Found in a real browser;
  // a jsdom double returning a plain array never reaches it, which is why the
  // fake in this module's own suite stores its parts in an Array subclass.
  // Same trap, same fix as `sectionCap.ts`. (`forEach` in `restoreSides` is
  // safe: it constructs nothing.)
  const sides: Array<number | undefined> = []
  for (const part of parts) {
    sides.push(typeof part?.mat?.side === 'number' ? part.mat.side : undefined)
  }
  return sides.some(side => side !== undefined) ? sides : []
}

/** Put back what `setSurfaceMaterialStyle` overwrote. */
function restoreSides(viewer: Viewer, surfid: number, sides: Array<number | undefined>): void {
  const parts = surfaceParts(viewer, surfid)
  if (!parts) return
  parts.forEach((part, i) => {
    const side = sides[i]
    if (side !== undefined && part?.mat) part.mat.side = side
  })
}

/**
 * Is the id we are holding still a surface this viewer knows about?
 *
 * `setSurfaceMaterialStyle` does nothing when it is handed an id that is not in
 * `viewer.surfaces` — everything after its first statement is inside
 * `if (this.surfaces[surf])` (`GLViewer.ts` ~4746; the statement that runs
 * first is `adjustVolumeStyle(style)`, a no-op for a `{ opacity, color }`
 * style) — with no throw and no warning. So an id invalidated by someone else's
 * `removeAllSurfaces` would turn the Opaque toggle into a silently dead button.
 * `getSurface` is the public read of that same map.
 *
 * A viewer with no `getSurface` at all answers false, NOT true: the restyle
 * path is the only one that can be silently wrong, so an unverifiable id must
 * fall through to a rebuild.
 *
 * This is what covers `viewer.clear()` as well — it calls `removeAllSurfaces()`
 * itself (`GLViewer.ts` ~4859), so a page clearing the scene needs no
 * `forgetSurface`, and adding one there would be a third mechanism for a case
 * already handled. A viewer REBUILD needs nothing either: the pages construct a
 * new 3Dmol instance and bump `viewerEpoch`, and a new object gets a new entry
 * in the WeakMap above.
 */
function isLive(viewer: Viewer, surfid: number): boolean {
  // Through `surfaceParts`, so this module reads `getSurface` in exactly ONE
  // guarded place. It used to read it here directly, and a viewer that answered
  // at BUILD time and broke afterwards reached this line with `state.sides`
  // already captured — `canRestyle`'s `sides.length > 0` short-circuit only
  // covers a viewer that throws from the first call. The throw then escaped
  // `commit` -> `applySurface` -> `applySceneStyles`, out of a React effect.
  //
  // A truthy NON-array answer now reads as "not live" where it used to read as
  // live. Unreachable in production, for the reason the library gives rather
  // than one inferred from this module: `getSurface` is
  // `return this.surfaces[surf]` (`GLViewer.ts` ~4793), and both writers of that
  // map store a `Surface extends Array` — `this.surfaces[surfid] = surf` in
  // `addSurface` and `= new Surface([surfobj])` in `addMesh` — so the only
  // answers are an array or `undefined`. Cited by statement rather than by an
  // exact range, as the rest of this file does, because a dependency bump moves
  // the numbers and not the statements.
  //
  // ⛔ NOT because `state.sides` bounds it. `sides` is captured ONCE, at build
  // time, so a viewer that answers well then and badly later arrives here with
  // it non-empty — which is the whole input class this fix exists for. Three
  // rounds of review each caught a comment on this line claiming a bound the
  // code does not have; do not add a fourth.
  return surfaceParts(viewer, surfid) !== null
}

/**
 * May this request be served by changing the material in place?
 *
 * Every condition is load-bearing, and the `sides` one is why this is a
 * function rather than an inline `&&` chain: a restyle we cannot undo the
 * `FrontSide` clobber for is worse than a rebuild, so the shortcut is only
 * available when the material was readable at build time. The method check is
 * for the branch's OWN call — `isLive` proves `getSurface` exists, which is a
 * different method.
 */
function canRestyle(viewer: Viewer, state: SurfaceState, request: SurfaceRequest): boolean {
  return (
    state.built !== null
    && state.surfid !== null
    && state.sides !== null
    && state.sides.length > 0
    && typeof viewer?.setSurfaceMaterialStyle === 'function'
    && isLive(viewer, state.surfid)
    && sameGeometry(state.built, request)
  )
}

function clearAll(viewer: Viewer, state: SurfaceState): void {
  // `removeAllSurfaces`, not `removeSurface(id)`, and deliberately even when we
  // are holding no id. It preserves exactly what `applySceneStyles` step 1 did
  // before this module existed — a full restyle also clears a surface that some
  // other path (a raw caller) added — and it cannot throw, whereas
  // `removeSurface` indexes `surfaces[surf]` unguarded and dies on an id that
  // is already gone.
  viewer.removeAllSurfaces()
  forget(state)
}

function commit(
  viewer: Viewer,
  state: SurfaceState,
  request: SurfaceRequest | null,
  deferred: boolean,
  onSurface: SurfacePublisher | null,
): void {
  if (request === null) {
    clearAll(viewer, state)
    // The mesh a running build was merging into has just been deleted from
    // `viewer.surfaces`, so that build can no longer produce anything anyone
    // will see. Holding the gate for it made Surface OFF -> ON cost MORE than
    // it did before this module existed: the ON was queued behind a build whose
    // output had already been thrown away, so the user waited out the doomed
    // build AND then a fresh one, having just been told the surface was off.
    // Releasing here restores the single build that gesture used to cost.
    //
    // The price is the one this branch already accepts a line above: the
    // abandoned workers run to completion, exactly as they did pre-#1668, and a
    // second build's workers may overlap them.
    //
    // ⚠️ AND IT IS NOT BOUNDED AT TWO. Each OFF -> ON pair opens the gate
    // again, so a user working the switch during one slow MS build starts one
    // build per ON while the earlier ones are still burning. That is the
    // pre-#1668 cost of this ONE gesture — every restyle used to remove and
    // re-add — and it is self-limiting, because each build's workers stop when
    // it completes. It is NOT the per-click stacking PT-382 item 1 exists to
    // stop: a chip click is not a removal and is still gated.
    //
    // ⛔ A bound was written and DELETED, in the same PR, on its second round of
    // review (PT-470 keeps the option open). One boolean "a disowned build is
    // still burning" produced four Medium findings in one round and not one of
    // them was in the rest of the change: the flag was cleared by whichever
    // build settled first rather than by its owner; a removal that declined to
    // disown also declined to stop the watchdog, so the watchdog then read a
    // mesh THIS module had deleted, saw no growth and declared a live build
    // dead; and on a viewer the watchdog cannot observe, the second removal
    // stopped being the thing that rescued a latched gate. Every one of those
    // is the bound reasoning about an uncancellable build it can no longer see.
    // Round-protocol rule 4: delete the mechanism rather than harden it twice.
    disownBuild(state)
    publish(onSurface, null)
    // A deferred commit runs inside a promise callback, so the caller that
    // would normally render after `applySceneStyles` is long gone. 3Dmol does
    // repaint from inside both `removeAllSurfaces` and `addSurface`, but that
    // is its own private business and not something to build on; one explicit
    // frame costs nothing and does not depend on it.
    if (deferred) viewer.render?.()
    return
  }

  // A restyle or reuse publishes NOTHING, deliberately: the mesh a handle
  // points at is untouched either way, so the handle a consumer holds stays
  // exactly as valid as it was. Silence here means "nothing you attached to
  // has moved".
  if (canRestyle(viewer, state, request)) {
    if (!sameMaterial(state.built as SurfaceRequest, request)) {
      viewer.setSurfaceMaterialStyle(state.surfid, request.style)
      restoreSides(viewer, state.surfid as number, state.sides as Array<number | undefined>)
      state.built = request
      // ALWAYS, not only when deferred. `setSurfaceMaterialStyle` sets
      // `finished = false` and returns; it is `render()` that reads that flag
      // and rebuilds the GL mesh with the new material (`GLViewer.ts` ~1874).
      // Without this the toggle is inert until something else happens to
      // render, and the synchronous callers' own `render()` is not a contract
      // this module can rely on.
      viewer.render?.()
    }
    return
  }

  clearAll(viewer, state)
  // The old mesh is gone this instant, and anything attached to it — the cut
  // face reads its geometry back by id — must hear so before the id is
  // recycled by the build below.
  publish(onSurface, null)

  let promise: { then?: unknown; surfid?: unknown } | undefined
  try {
    promise = viewer.addSurface(request.type, request.style, request.sel)
  } catch (reason) {
    // A throw here leaves nothing in the scene and, crucially, no promise to
    // settle — so the gate below is never armed and the next request is free
    // to try again.
    reportSurfaceFailure(reason)
    return
  }

  // 3Dmol stamps the id onto the promise SYNCHRONOUSLY, before returning it
  // (`GLViewer.ts` ~4716: `this.surfaces[surfid] = surf; promise.surfid = surfid`),
  // which is the only reason a restyle-instead-of-rebuild is possible at all.
  // The material is registered by the same statement, so the side it was built
  // with is readable now — long before the mesh itself exists.
  state.surfid = typeof promise?.surfid === 'number' ? promise.surfid : null
  state.built = request
  state.sides = state.surfid === null ? null : captureSides(viewer, state.surfid)
  // For the completion report below: from the promise captured at ISSUE time,
  // never from `state` — an OFF arriving mid-build has already forgotten this
  // id, and the late report is the consumer's cue to re-read (and refuse),
  // exactly the "superseded build reporting late" the handle contract prices in.
  const issuedId = state.surfid
  if (deferred) viewer.render?.()  // same reason as the removal path above

  if (typeof promise?.then !== 'function') return

  // Identity for THIS build. Everything below that runs later compares against
  // it, because a build can now be given up on before it settles.
  const token = {}

  const settle = (): void => {
    try {
      // The gate is open however we got here. `disownBuild` may already have
      // cleared these on the watchdog path; clearing them twice is cheaper
      // than asking which path this is.
      state.buildToken = null
      state.building = false
      stopWatchdog(state)
      const queued = state.queued
      const queuedOnSurface = state.queuedOnSurface
      if (!queued) return
      state.queued = null
      state.queuedOnSurface = null
      // A viewer the page has torn down holds no models — `clear()` empties them
      // and every page nulls its ref immediately after — and a surface is never
      // requested before a model is loaded, so this state means exactly "gone".
      // Building for it would spawn a fresh set of workers for a mesh nothing can
      // ever show: the cost this module exists to remove, reappearing on the
      // unmount path.
      //
      // ⚠️ The direction here is the OPPOSITE of `isLive`'s, deliberately. A
      // viewer that cannot be asked (no `getModel`) PROCEEDS, because skipping on
      // an unverifiable answer would silently drop a request the user actually
      // made — worse than one wasted build.
      if (typeof viewer?.getModel === 'function' && !viewer.getModel()) return
      commit(viewer, state, queued, true, queuedOnSurface)
    } catch (reason) {
      // The handler this replaced was `reportSurfaceFailure` alone — a pure
      // reporter that cannot throw. This one runs real viewer work — the
      // `getModel` interrogation above included, on a viewer the page may have
      // torn down — and the promise `then` returns is observed by nobody, so a
      // throw anywhere in the handler would become the stackless
      // `UnhandledRejection` that `surfaceFailure.ts` exists to prevent, on
      // top of losing the request. Hence the try covers the WHOLE body.
      // `forget` first, because a throw out of `clearAll` leaves the retention
      // behind.
      forget(state)
      reportSurfaceFailure(reason)
    }
  }
  // Armed only when there is a promise to settle it. A viewer whose
  // `addSurface` returns anything else would otherwise latch the gate for the
  // life of the viewer and never draw a surface again.
  state.buildToken = token
  state.building = true
  ;(promise.then as (ok: () => void, err: (reason: unknown) => void) => void)(
    () => {
      // ⛔ A build we gave up on must stay silent. Its id has very likely been
      // recycled by a later build — `nextSurfID` is max+1 over the REMAINING
      // keys — so publishing a handle for it would hand the consumer someone
      // else's half-merged mesh to read, and running `settle` would open a gate
      // that later build is holding and commit its queued request twice.
      if (state.buildToken !== token) return
      // A fresh handle per completed build — see `SurfaceHandle`. Before the
      // queued commit, so a consumer hears about builds in the order they
      // finished, each drop still announced by its own null.
      if (issuedId !== null) publish(onSurface, { id: issuedId })
      settle()
    },
    (reason: unknown) => {
      // Reported even for a build we disowned: a worker that died is a real
      // failure, and the reporter is the only thing that ever says so.
      reportSurfaceFailure(reason)
      if (state.buildToken !== token) return
      // The mesh never finished, so there is nothing to restyle later. Forget
      // it rather than let a subsequent Opaque press take the restyle path
      // over a half-built geometry.
      forget(state)
      settle()
    },
  )
  // ARMED LAST, after the settle handlers exist. Ordering discipline rather
  // than a live guard: every read `armWatchdog` makes now goes through
  // `surfaceParts`, which answers null instead of throwing, so there is nothing
  // left for an earlier arming to lose. A round-2 draft wrapped this in a
  // try/catch; with the read guarded at its one source, that caught nothing,
  // and a guard for a case nothing reaches is the second mechanism this
  // module's own docstrings keep arguing against.
  armWatchdog(viewer, state, token, issuedId, settle)
}
