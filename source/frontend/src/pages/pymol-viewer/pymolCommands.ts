import { LIMITS } from './pymolFrameProtocol'

/**
 * What the PyMOL page's command line sends, and what it refuses. Every
 * command reaches the frame through the controller's
 * `runCommand` — the protocol's `command` message, `cmd.do` in the worker —
 * and nothing else.
 */

/** Pasted lines run one after another; a paste longer than this is refused whole. */
export const MAX_PASTE_LINES = 500
/** Commands kept for ↑ / ↓. */
export const HISTORY_SIZE = 200

export type CommandCheck =
  | { ok: true; text: string }
  | { ok: false; reason: 'empty' | 'too-long' | 'session-load' }

// A PyMOL session file: .pse / .psw, or zipped .pze / .pzw, compressed or not.
const SESSION_FILE = /\.p[sz][ew](?:\.(?:gz|bz2))?\b/i
const LOADS = /\b(?:load|loadall|load_raw|importing)\b/i
const SESSION_FORMAT = /\bformat\s*=\s*['"]?p[sz][ew]\b/i

/**
 * One command line, checked: blank is nothing to send, over the protocol's
 * `command` cap is refused rather than cut (a cut command is a different
 * command), and a session load typed as a command (`load` of a session file
 * or format, or `set_session`) is refused (trap 49). The worker's load path
 * (`load{format:'pse'}` or `restoreSnapshot`), which strips a session's wizard
 * and movie first, is the one meant for sessions; this check is defence in
 * depth behind the restricted unpickler (PT-3291 item 9).
 */
export function checkCommand(raw: string): CommandCheck {
  const text = raw.trim()
  if (text === '') return { ok: false, reason: 'empty' }
  if (text.length > LIMITS.commandChars) return { ok: false, reason: 'too-long' }
  if (/\bset_session\b/i.test(text) || (LOADS.test(text) && (SESSION_FILE.test(text) || SESSION_FORMAT.test(text)))) {
    return { ok: false, reason: 'session-load' }
  }
  return { ok: true, text }
}

/** A line of a paste, and where it stood in the pasted text (1-based). */
export interface PastedLine {
  line: number
  text: string
}

/**
 * The lines of a multi-line paste, blank ones dropped, or null when there are
 * more than `MAX_PASTE_LINES` of them. Each keeps its number in the paste,
 * blank lines counted, so a refusal names the line the user can find
 * (PT-3291 item 16).
 */
export function splitPasted(text: string): PastedLine[] | null {
  const lines = text
    .split(/\r\n|\r|\n/)
    .map((l, i) => ({ line: i + 1, text: l.trim() }))
    .filter(l => l.text !== '')
  return lines.length > MAX_PASTE_LINES ? null : lines
}

/** ↑ / ↓ through the commands sent, as a shell does: the draft line is kept. */
export class CommandHistory {
  private entries: string[] = []
  /** Index into `entries` while browsing; `entries.length` = the draft. */
  private at = 0
  private draft = ''

  push(command: string): void {
    if (this.entries[this.entries.length - 1] !== command) this.entries.push(command)
    if (this.entries.length > HISTORY_SIZE) this.entries.shift()
    this.at = this.entries.length
    this.draft = ''
  }

  /** The older entry, or null at the oldest. `current` is kept as the draft. */
  older(current: string): string | null {
    if (this.at === 0) return null
    if (this.at === this.entries.length) this.draft = current
    this.at -= 1
    return this.entries[this.at] ?? null
  }

  /** The newer entry, the draft past the newest, or null when already there. */
  newer(): string | null {
    if (this.at >= this.entries.length) return null
    this.at += 1
    return this.at === this.entries.length ? this.draft : (this.entries[this.at] ?? null)
  }

  get size(): number {
    return this.entries.length
  }
}
