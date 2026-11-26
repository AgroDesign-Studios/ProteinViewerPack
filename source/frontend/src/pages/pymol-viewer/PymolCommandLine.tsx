import { useEffect, useId, useRef, useState, type ClipboardEvent, type KeyboardEvent, type Ref } from 'react'
import { useTranslation } from 'react-i18next'

import { formatSI } from '../../utils/formatSI'
import { checkCommand, CommandHistory, MAX_PASTE_LINES, splitPasted } from './pymolCommands'
import { LIMITS } from './pymolFrameProtocol'
import { commandDetailText } from './pymolCommandText'

/**
 * A paste says how far it got at most this often, and at its end: a live
 * region rewritten for each of 500 lines queues 500 announcements (PT-3291
 * item 16).
 */
export const PASTE_PROGRESS_EVERY_MS = 2_000

/**
 * A line that ended because the frame did not answer it — the user's Stop,
 * a rebuild, the page stopped, or a frame not ready yet — rather than because
 * PyMOL refused it (the controller's own texts).
 */
const FRAME_GONE = /^(?:cancelled|no frame|PyMOL is not ready|the PyMOL frame was (?:rebuilt|closed|stopped))$/

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/**
 * The PyMOL page's command line: what the Qt PyMOL window's
 * command box is, in React, under the canvas.
 *
 * Every line goes to `run` — the controller's `runCommand`, i.e. the
 * protocol's `command` message — one at a time: the next line is not handed
 * over until the previous one has finished, so this box never has more than
 * one command waiting in the controller, however fast lines are pasted or
 * entered. ↑ / ↓ walk the history; Enter during IME composition only commits
 * the composition (Japanese input); a multi-line paste runs line by line and
 * stops at the first line that fails. PyMOL's own output is drawn in the
 * canvas (its feedback lines), not here — this box reports only what the page
 * refused and requests that failed.
 *
 * The lines it holds back behind its own request are reported through
 * `onHeldChange`, for the busy bar's count. When the frame takes this box's
 * line down with it — Stop, a rebuild, the page stopped — every line still
 * held was meant for that frame: none of it is sent, and one message says how
 * many were dropped, rather than each failing on its own against the next
 * frame (PT-3291 item 6). Until PyMOL is ready the box is read-only and
 * `aria-disabled`, never `disabled`, so it keeps focus — Stop puts focus here
 * while the frame is rebuilt (PT-3291 item 5).
 */
export function PymolCommandLine({
  run,
  disabled,
  inputRef,
  onHeldChange,
  onMessage,
}: {
  run: (cmd: string) => Promise<void>
  disabled: boolean
  /** The box itself, for the page's Stop to give focus to. */
  inputRef?: Ref<HTMLInputElement>
  /** How many lines this box holds back, not yet handed to `run`. */
  onHeldChange?: (n: number) => void
  /**
   * What this box says, each time it changes: for a page that can take the
   * box out of the document while it goes on sending (the offline file's
   * phone sheet), whose own live region must say it then (PT-9229 item 5).
   */
  onMessage?: (text: string) => void
}) {
  const { t } = useTranslation('pymol')
  const inputId = useId()
  const [value, setValue] = useState('')
  const [message, setMessage] = useState('')
  const history = useRef(new CommandHistory())
  // The tail of everything this box has handed over; each new line waits on it.
  const chain = useRef<Promise<unknown>>(Promise.resolve())
  // Lines entered and not yet handed to `run`, and the frame they were meant
  // for: bumped when that frame goes, which drops them all.
  const held = useRef(0)
  const epoch = useRef(0)
  const onHeld = useRef(onHeldChange)
  const onSaid = useRef(onMessage)
  useEffect(() => {
    onHeld.current = onHeldChange
    onSaid.current = onMessage
  })
  useEffect(() => {
    onSaid.current?.(message)
  }, [message])
  const setHeld = (n: number) => {
    held.current = n
    onHeld.current?.(n)
  }
  // What this box held was for this page's frame: an unmount (another
  // structure) sends none of it, and leaves the busy bar no count.
  useEffect(
    () => () => {
      epoch.current += 1
      held.current = 0
      onHeld.current?.(0)
    },
    [],
  )

  const refusal = (reason: 'too-long' | 'session-load'): string =>
    reason === 'too-long' ? t('pymol:cmd_err_too_long', { limit: LIMITS.commandChars }) : t('pymol:cmd_err_session_load')

  /** What is said when the frame took this box's line down, and `dropped` held lines with it. */
  const goneText = (e: unknown, dropped: number): string => {
    if (errorText(e) === 'cancelled') {
      return dropped > 0 ? t('pymol:cmd_stopped_dropped', { count: dropped, n: formatSI(dropped) }) : t('pymol:cmd_stopped')
    }
    const detail = commandDetailText(t, e)
    return dropped > 0 ? t('pymol:cmd_gone_dropped', { count: dropped, n: formatSI(dropped), detail }) : t('pymol:cmd_failed', { detail })
  }

  /** Run `lines` in order, after anything already queued; stop at the first failure. */
  const enqueue = (lines: string[]) => {
    const mine = epoch.current
    setHeld(held.current + lines.length)
    chain.current = chain.current.then(async () => {
      let saidAt = -Infinity
      for (let i = 0; i < lines.length; i++) {
        // Dropped with the frame it was meant for: counted and said then.
        if (epoch.current !== mine) return
        setHeld(held.current - 1)
        try {
          await run(lines[i])
        } catch (e) {
          if (epoch.current !== mine) return
          if (FRAME_GONE.test(errorText(e))) {
            const dropped = held.current
            epoch.current += 1
            setHeld(0)
            setMessage(goneText(e, dropped))
            return
          }
          setHeld(held.current - (lines.length - i - 1))
          const detail = commandDetailText(t, e)
          setMessage(
            lines.length > 1
              ? t('pymol:cmd_paste_stopped', { done: i + 1, total: lines.length, detail })
              : t('pymol:cmd_failed', { detail }),
          )
          return
        }
        const now = Date.now()
        if (lines.length > 1 && (i === lines.length - 1 || now - saidAt >= PASTE_PROGRESS_EVERY_MS)) {
          saidAt = now
          setMessage(t('pymol:cmd_paste_progress', { done: i + 1, total: lines.length }))
        }
      }
    })
  }

  const submit = () => {
    const c = checkCommand(value)
    if (!c.ok) {
      if (c.reason !== 'empty') setMessage(refusal(c.reason))
      return
    }
    history.current.push(c.text)
    setValue('')
    setMessage('')
    enqueue([c.text])
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // Enter / arrows while an IME composes belong to the IME (229: Chrome's
    // keyCode for a key the IME took, for an engine without isComposing).
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    // Read-only until PyMOL is ready: no send, and no history walk either.
    if (disabled) return
    if (e.key === 'Enter') {
      e.preventDefault()
      submit()
    } else if (e.key === 'ArrowUp') {
      const prev = history.current.older(value)
      if (prev !== null) {
        e.preventDefault()
        setValue(prev)
      }
    } else if (e.key === 'ArrowDown') {
      const next = history.current.newer()
      if (next !== null) {
        e.preventDefault()
        setValue(next)
      }
    }
  }

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    if (disabled) {
      e.preventDefault()
      return
    }
    const text = e.clipboardData.getData('text')
    // A single line pastes into the box as usual, to be edited and sent.
    if (!/[\r\n]/.test(text)) return
    e.preventDefault()
    const lines = splitPasted(text)
    if (lines === null) {
      setMessage(t('pymol:cmd_err_paste_too_many', { limit: MAX_PASTE_LINES }))
      return
    }
    // One line with a line break around it — a line copied whole — goes into
    // the box like any single line, rather than running at once (PT-3291
    // item 16).
    if (lines.length <= 1) {
      const one = lines[0]?.text ?? ''
      const el = e.currentTarget
      const start = el.selectionStart ?? value.length
      const end = el.selectionEnd ?? value.length
      setValue(value.slice(0, start) + one + value.slice(end))
      return
    }
    const checked = lines.map(l => checkCommand(l.text))
    const bad = checked.findIndex(c => !c.ok)
    if (bad >= 0) {
      const c = checked[bad]
      if (!c.ok && c.reason !== 'empty') setMessage(t('pymol:cmd_paste_refused', { line: lines[bad].line, detail: refusal(c.reason) }))
      return
    }
    for (const l of lines) history.current.push(l.text)
    setMessage('')
    enqueue(lines.map(l => l.text))
  }

  return (
    <div className="pymolv-cmd">
      <label htmlFor={inputId} className="pymolv-cmd-prompt">
        <span aria-hidden="true">PyMOL&gt;</span>
        <span className="sr-only">{t('pymol:cmd_label')}</span>
      </label>
      <input
        ref={inputRef}
        id={inputId}
        className="pymolv-cmd-input"
        type="text"
        value={value}
        readOnly={disabled}
        aria-disabled={disabled || undefined}
        spellCheck={false}
        autoComplete="off"
        autoCapitalize="off"
        placeholder={t('pymol:cmd_placeholder')}
        onChange={e => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
      />
      {/* Mounted unconditionally, text changing: see PymolViewerPage. */}
      <p role="status" className="pymolv-cmd-message">
        {message}
      </p>
    </div>
  )
}
