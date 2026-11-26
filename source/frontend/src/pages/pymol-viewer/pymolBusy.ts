/**
 * What the PyMOL frame is busy with, as the busy bar shows it: its own module
 * so the bar can be bundled into the offline HTML export without a frame
 * controller.
 */

export type OpKind = 'load' | 'restore' | 'command' | 'export'

/**
 * The requests `cancel()` stops: a command or an export in flight, while
 * PyMOL is ready. The busy bar and the export dialog show Stop under this
 * same test, so Stop shows exactly when it acts (PT-3851 item 8).
 */
export function cancellableKind(kind: OpKind): boolean {
  return kind === 'command' || kind === 'export'
}

/** The request the frame is working on, for the progress line. */
export interface PymolBusy {
  kind: OpKind
  /** The command text or its given name (cut to `BUSY_LABEL_CHARS`), or null for the page's own requests. */
  label: string | null
  /** Wall time it was sent. */
  startedAt: number
  /** Requests waiting behind it. */
  queued: number
  /**
   * Of those, the user's own that Stop fails, such as a command from the
   * command line or an export. Not the page's own steps — a structure load,
   * a restore, a replay, a command the page sends (PT-4042).
   */
  queuedCancels: number
}


/**
 * Why a request whose `signal` was aborted while it still waited in the queue
 * failed: it was taken out unsent (`enqueuePublic`). The export dialog's
 * reader (`pymolExport.ts`) tells it from a real failure by this text.
 */
export const WITHDRAWN = 'withdrawn'
