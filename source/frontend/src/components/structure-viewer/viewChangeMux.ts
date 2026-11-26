/**
 * Fan `viewer.setViewChangeCallback` out to more than one listener.
 *
 * 3Dmol's hook is a SINGLE slot: `setViewChangeCallback` overwrites whatever
 * was there, with no way to read the previous value back (`viewChangeCallback`
 * is private). More than one listener needs that signal — the cross-section
 * cap uses it to know the cut plane has moved. Whichever registered second would
 * silently evict the first, which would go on drawing while tracking a camera
 * it no longer hears about.
 *
 * So nobody calls `setViewChangeCallback` directly any more. This module owns
 * the slot, one dispatcher per viewer, and hands out unsubscribe functions.
 *
 * The registry is a `WeakMap` keyed on the viewer, so a torn-down viewer is
 * collectable even if a caller forgets to unsubscribe.
 */

/** The one 3Dmol method this module drives. */
export interface ViewChangeCapableViewer {
  setViewChangeCallback(callback: ((view: unknown) => void) | null): void
}

/** True when this build of 3Dmol has the hook at all. */
export function hasViewChangeHook(viewer: unknown): viewer is ViewChangeCapableViewer {
  return (
    typeof viewer === 'object' &&
    viewer !== null &&
    typeof (viewer as ViewChangeCapableViewer).setViewChangeCallback === 'function'
  )
}

type Listener = (view: unknown) => void

/**
 * One entry per SUBSCRIPTION, not per function.
 *
 * A `Set<Listener>` de-duplicates by function identity, so two subscriptions
 * that pass the same function reference collapse into one and either
 * unsubscribe silently cancels both. Two components sharing a module-level
 * handler is an ordinary thing to write, and the symptom would be one of them
 * quietly ceasing to track the camera.
 */
interface Subscription {
  fn: Listener
}

const listenersByViewer = new WeakMap<object, Set<Subscription>>()

/**
 * Call `listener` whenever the viewer reports its view may have changed.
 *
 * Returns an unsubscribe function. When the last listener for a viewer goes
 * away the slot is released (`setViewChangeCallback(null)`), so a viewer that
 * nobody is watching behaves exactly as it did before this module existed.
 *
 * A build without the hook gets a no-op unsubscribe rather than a throw: the
 * feature that needed the signal degrades, the page does not fall over.
 *
 * Note the callback fires from `GLViewer.show()` AFTER the frame has been
 * rendered, so a listener that itself calls `render()` re-enters. Listeners must
 * either not render, or make the second pass a no-op (see `sectionCap.ts`,
 * which coalesces into one animation frame and rebuilds only when the plane
 * actually moved).
 */
export function subscribeViewChange(viewer: unknown, listener: Listener): () => void {
  if (!hasViewChangeHook(viewer)) return () => {}
  const key = viewer as unknown as object
  let listeners = listenersByViewer.get(key)
  if (!listeners) {
    listeners = new Set<Subscription>()
    listenersByViewer.set(key, listeners)
    const dispatch: Listener = view => {
      // Iterate a copy: a listener may unsubscribe itself from inside the call.
      // Membership is re-checked per entry so one listener unsubscribing ANOTHER
      // mid-dispatch is honoured rather than delivered from the stale copy.
      const live = listenersByViewer.get(key)
      for (const entry of [...(live ?? [])]) {
        if (!live?.has(entry)) continue
        try {
          entry.fn(view)
        } catch (err) {
          // One listener's failure must not stop the others, and must never
          // propagate into 3Dmol's render loop.
          console.error('View-change listener failed:', err)
        }
      }
    }
    viewer.setViewChangeCallback(dispatch)
  }
  const entry: Subscription = { fn: listener }
  listeners.add(entry)

  return () => {
    const current = listenersByViewer.get(key)
    if (!current) return
    current.delete(entry)
    if (current.size > 0) return
    releaseViewChange(viewer)
  }
}

/**
 * Drop every subscription for a viewer and hand its slot back.
 *
 * For a teardown path that destroys the viewer outright. Calling
 * `setViewChangeCallback(null)` directly instead would null the slot while
 * leaving this module's registry believing a dispatcher is installed — and the
 * next `subscribeViewChange` on that viewer would then add to the surviving set
 * and never re-install one, so every subscriber would stop hearing about the
 * camera with nothing on screen to explain it.
 */
export function releaseViewChange(viewer: unknown): void {
  if (!hasViewChangeHook(viewer)) return
  listenersByViewer.delete(viewer as unknown as object)
  try {
    viewer.setViewChangeCallback(null)
  } catch {
    /* the viewer is already gone; nothing to release */
  }
}
