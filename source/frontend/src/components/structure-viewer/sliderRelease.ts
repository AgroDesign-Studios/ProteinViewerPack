import type { KeyboardEvent, SyntheticEvent } from 'react'

/**
 * The release contract shared by every release-committed slider on the viewer
 * stage.
 *
 * "Release-committed" means the value is applied live while the gesture runs
 * but only *committed* when the gesture ENDS. A slider needs that when its
 * commit is expensive: a recompute on the main thread (PR #1497 review, High),
 * or the depth-cue bar's write of the whole viewer-state blob to localStorage.
 * Neither belongs on a per-drag-frame path.
 *
 * It lives in a leaf module rather than in any one component because the
 * components are siblings (`vibe-coding-best-practices.md` §15.2 — the shared-helper rule:
 * component-to-component imports are the smell this avoids). One copy keeps
 * the sliders' release handling from drifting apart.
 */

// Keyboard changes to a range input fire neither mouseup nor touchend, so a
// release-committed slider has to commit on the release of the keys that move
// it (and on Enter).
export function isRangeCommitKey(k: string): boolean {
  return k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowDown'
    || k === 'Home' || k === 'End' || k === 'PageUp' || k === 'PageDown' || k === 'Enter'
}

/**
 * Handlers for the four ways a slider gesture can end.
 *
 * - `commit` — the gesture completed: mouse up, touch end, or the release of a
 *   key that moves a range input.
 * - `cancel` — the system took the touch over (`touchcancel`: a system gesture,
 *   an incoming call). The gesture was never completed, so the in-progress
 *   value is dropped and the committed one stays the truth.
 * - `settle` — focus leaves the input with a value still uncommitted. This is
 *   the one path an assistive technology takes when it changes a range without
 *   any pointer or key event (VoiceOver's swipe-adjust, voice control), and
 *   also where a pointer released outside the window ends up; both mean the
 *   user DID choose that value, so it is committed, not discarded.
 */
export function releaseHandlers(
  commit: (value: number) => void,
  cancel: () => void,
  settle: (value: number) => void,
) {
  const valueOf = (e: SyntheticEvent<HTMLInputElement>) => Number(e.currentTarget.value)
  return {
    onMouseUp: (e: SyntheticEvent<HTMLInputElement>) => commit(valueOf(e)),
    onTouchEnd: (e: SyntheticEvent<HTMLInputElement>) => commit(valueOf(e)),
    onKeyUp: (e: KeyboardEvent<HTMLInputElement>) => { if (isRangeCommitKey(e.key)) commit(valueOf(e)) },
    onTouchCancel: () => cancel(),
    onBlur: (e: SyntheticEvent<HTMLInputElement>) => settle(valueOf(e)),
  }
}
