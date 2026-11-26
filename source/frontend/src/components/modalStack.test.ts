/**
 * modalStack's test reset (PT-5060). A dialog that closes hands its unread
 * live-region lines on a microtask and a settle timer later; a reset between
 * two tests must drop them wherever they are on that way, or they are spoken
 * in the next test's dialog. The handoff itself is pinned through `Modal`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  ANNOUNCER_SETTLE_MS,
  appendAnnouncement,
  nextDialogSeq,
  pushDialog,
  removeDialog,
  resetModalStackForTests,
} from './modalStack'

/** A dialog with its own live region, on the stack and in the document. */
function openDialog(): { dialog: HTMLElement; region: HTMLElement } {
  const dialog = document.createElement('div')
  const region = document.createElement('div')
  dialog.appendChild(region)
  document.body.appendChild(dialog)
  pushDialog(dialog, null, nextDialogSeq(), 200, region, { current: null })
  return { dialog, region }
}

function closeDialog(dialog: HTMLElement): void {
  dialog.remove()
  removeDialog(dialog)
}

const lines = (region: HTMLElement) => Array.from(region.children, line => line.textContent)

describe('resetModalStackForTests', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    document.body.replaceChildren()
  })

  it('without a reset, a closed dialog’s unread line reaches the next dialog (control)', async () => {
    const a = openDialog()
    appendAnnouncement(a.region, 'unread')
    closeDialog(a.dialog)
    await Promise.resolve()
    const b = openDialog()
    vi.advanceTimersByTime(ANNOUNCER_SETTLE_MS)
    expect(lines(b.region)).toEqual(['unread'])
  })

  it('drops a line handed on in the same task, before its microtask runs', async () => {
    const a = openDialog()
    appendAnnouncement(a.region, 'unread')
    // What the global afterEach does: cleanup() unmounts the dialog, then the reset.
    closeDialog(a.dialog)
    resetModalStackForTests()
    await Promise.resolve()
    const b = openDialog()
    vi.advanceTimersByTime(ANNOUNCER_SETTLE_MS * 2)
    expect(lines(b.region)).toEqual([])
  })

  it('drops a line already waiting on its settle timer', async () => {
    const a = openDialog()
    appendAnnouncement(a.region, 'unread')
    closeDialog(a.dialog)
    // The microtask has run: no dialog is left, so the line waits on a timer.
    await Promise.resolve()
    resetModalStackForTests()
    const b = openDialog()
    vi.advanceTimersByTime(ANNOUNCER_SETTLE_MS * 2)
    expect(lines(b.region)).toEqual([])
  })

  // Dialog b opens before the handoff's microtask runs, so b is on the stack
  // but was pushed after the removal: the line waits on its settle timer in
  // `speakIn`, not in `deliver`'s no-dialog branch (PT-5346 item 2).
  it('a line waiting for a dialog opened in the same task reaches it (control)', async () => {
    const a = openDialog()
    appendAnnouncement(a.region, 'unread')
    closeDialog(a.dialog)
    const b = openDialog()
    await Promise.resolve()
    expect(lines(b.region)).toEqual([])
    vi.advanceTimersByTime(ANNOUNCER_SETTLE_MS)
    expect(lines(b.region)).toEqual(['unread'])
  })

  it('drops a line waiting for a dialog opened in the same task', async () => {
    const a = openDialog()
    appendAnnouncement(a.region, 'unread')
    closeDialog(a.dialog)
    const b = openDialog()
    await Promise.resolve()
    resetModalStackForTests()
    // The next test's dialog: the reset emptied the stack, so only a dialog
    // opened after it could still take the line.
    const c = openDialog()
    vi.advanceTimersByTime(ANNOUNCER_SETTLE_MS * 2)
    expect(lines(b.region)).toEqual([])
    expect(lines(c.region)).toEqual([])
  })

  it('a handoff after the reset is delivered as before', async () => {
    resetModalStackForTests()
    const a = openDialog()
    appendAnnouncement(a.region, 'unread')
    closeDialog(a.dialog)
    await Promise.resolve()
    const b = openDialog()
    vi.advanceTimersByTime(ANNOUNCER_SETTLE_MS)
    expect(lines(b.region)).toEqual(['unread'])
  })
})
