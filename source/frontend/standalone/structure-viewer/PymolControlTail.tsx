import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react'
import { useTranslation } from 'react-i18next'

import type { Motion as MotionState } from './pymolBridge'

/**
 * The end of PyMOL's movie-button row, redrawn by the page (owner
 * 2026-11-21: 「下のFボタンは使わないのであれば、消す。代わりにSとなっている
 * ボタンをSeqにする」 and 「揺らすボタン（下三角ボタン）にマウスオーバーする
 * と、上にポップアップが出て、『左右に揺らす』/『回転』と速度が1倍、2倍、4倍
 * で選べるようにする」; UI consult, Opus 5.5 and Codex astra). PyMOL draws
 * its S, ▼ and F into its own canvas; this strip lies over those three
 * slots (`controlTailRect`) with two buttons half again as wide: 「Seq」 (the
 * page's sequence, as the 「配列」 tag) and ▼ (motion). F — PyMOL's full
 * screen, which does nothing in this app — is gone. At least `TAIL_MIN_H`
 * high, growing upwards, its words sized to it (a display scale below the
 * screen's pixel ratio, PT-10648 item 3).
 *
 * ▼ is a toggle: a click, Enter or Space starts or stops the motion, as
 * PyMOL's own did. Its choices open above it after `MOTION_HOVER_MS` of a
 * mouse, on a tap (a touch never starts or stops it by itself), or with ↑
 * (the focus goes into them). They close on Esc — the choices' own only when
 * the focus is on them, on ▼ or on nothing; a control elsewhere that has the
 * focus still gets its Esc — on a press or the focus anywhere else, and when
 * the mouse leaves (`MOTION_LEAVE_MS`) unless the focus is in them
 * (PR #10151's review, PT-10647). A kind chosen starts it; a speed chosen
 * applies at once when it runs. Rocking is PyMOL's own (`_agdb_rock_set`:
 * the user's sweep settings come back after it); turning is the worker's
 * steady turn (`_agdb_spin_set`), so no movie the user made is touched.
 * What runs is the worker's report (`motion`), a rock started from PyMOL's
 * Movie menu or command line included — or, for `MOTION_EXPECT_MS` after a
 * press, what that press asked for, so a quick second press toggles back
 * instead of repeating the first (PT-10647 item 4). The kind and the speed
 * last chosen outlive the strip (the panel hidden and shown again).
 */
export type Motion = 'rock' | 'turn'

export const MOTION_SPEEDS = [1, 2, 4] as const
export type MotionSpeed = (typeof MOTION_SPEEDS)[number]

/** The turn's 1×, degrees a second: a full turn in 12 s. */
export const TURN_BASE_DEG_PER_S = 30

/** How long a mouse rests on ▼ before its choices open. */
export const MOTION_HOVER_MS = 300

/** How long the choices stay once the pointer has left ▼ and them (time to cross the gap). */
export const MOTION_LEAVE_MS = 250

/** How long a press's ask stands for the worker's report (a report is at most a few frames away). */
export const MOTION_EXPECT_MS = 1500

/** The strip's least height (CSS px): grown upwards over PyMOL's band when that is lower. */
export const TAIL_MIN_H = 18

/** On a touch screen, the target size (PR #10172's review). */
export const TAIL_MIN_H_TOUCH = 24

/** The page's steady turn stopped (PyMOL's ■ stops its own rock). */
export const MOTION_SPIN_STOP = '_ /_agdb_spin_set(0)'

/** The commands that stop any motion: the turn, and the rock (the user's sweep settings back). */
export const MOTION_STOP = '_ /[_agdb_spin_set(0), _agdb_rock_set(0)]'

/** The command for a motion at a speed: one quiet Python line, not echoed (`_ /`). Starting one stops the other. */
export function motionCommand(motion: Motion, speed: MotionSpeed): string {
  if (motion === 'turn') return `_ /[_agdb_rock_set(0), _agdb_spin_set(${TURN_BASE_DEG_PER_S * speed})]`
  return `_ /[_agdb_spin_set(0), _agdb_rock_set(${speed})]`
}

/** What runs, by the worker's report: the turn, the rock, or nothing. */
export function runningOf(m: MotionState | undefined): Motion | null {
  return m === undefined ? null : m.spin !== 0 ? 'turn' : m.rock ? 'rock' : null
}

/** The speed the worker's report says the page's motion runs at, if it says. */
function reportedSpeed(m: MotionState | undefined): MotionSpeed | null {
  const n = m === undefined ? 0 : m.spin !== 0 ? Math.abs(m.spin) / TURN_BASE_DEG_PER_S : m.rock ? m.rockSpeed : 0
  return (MOTION_SPEEDS as readonly number[]).includes(n) ? (n as MotionSpeed) : null
}

// The kind and speed last chosen: the strip comes and goes with PyMOL's panel (PT-10648 item 6).
let lastKind: Motion = 'rock'
let lastSpeed: MotionSpeed = 1

/** For tests: the first choice again. */
export function resetMotionChoiceForTests(): void {
  lastKind = 'rock'
  lastSpeed = 1
}

export function PymolControlTail(props: {
  /** PyMOL's S, ▼ and F, CSS px in the stage (`controlTailRect`). */
  rect: { x: number; y: number; w: number; h: number }
  ready: boolean
  /** What runs now, as the worker last said. */
  motion: MotionState | undefined
  /** Sends a page command (quiet, not echoed). */
  run: (cmd: string) => void
  /** 「Seq」: the page's sequence shown or hidden. */
  onSeq: () => void
  /** The page's sequence is shown (「Seq」 pressed). */
  seqShown?: boolean
  /** A PyMOL menu is up: out of its way. */
  aside?: boolean
  /** A drag from the view is held: its moves pass through. */
  through?: boolean
}) {
  const { rect, ready, motion, run, onSeq, seqShown = false, aside = false, through = false } = props
  const { t } = useTranslation()
  const [kind, setKindState] = useState<Motion>(lastKind)
  const [speed, setSpeedState] = useState<MotionSpeed>(lastSpeed)
  const setKind = (m: Motion) => {
    lastKind = m
    setKindState(m)
  }
  const setSpeed = (s: MotionSpeed) => {
    lastSpeed = s
    setSpeedState(s)
  }
  // What the last press asked for, until the worker's report says so (or the wait runs out).
  const [expect, setExpect] = useState<{ running: Motion | null; at: number } | null>(null)
  const reported = runningOf(motion)
  useEffect(() => {
    if (expect === null) return
    if (expect.running === reported) {
      setExpect(null)
      return
    }
    const left = MOTION_EXPECT_MS - (performance.now() - expect.at)
    const id = window.setTimeout(() => setExpect(null), Math.max(0, left))
    return () => window.clearTimeout(id)
  }, [expect, reported])
  const running = expect !== null ? expect.running : reported
  const shownSpeed = (running !== null && expect === null ? reportedSpeed(motion) : null) ?? speed
  const [open, setOpen] = useState(false)
  const popId = useId()
  const hintId = useId()
  const tail = useRef<HTMLDivElement | null>(null)
  const motionBtn = useRef<HTMLButtonElement | null>(null)
  const firstChoice = useRef<HTMLButtonElement | null>(null)
  const hoverTimer = useRef<number | null>(null)
  const leaveTimer = useRef<number | null>(null)
  // The press that opened the choices by touch: its click starts nothing.
  const touchPress = useRef(false)
  // The choices opened from the keyboard: the focus goes into them.
  const byKey = useRef(false)
  const clearTimers = () => {
    for (const r of [hoverTimer, leaveTimer]) {
      if (r.current !== null) window.clearTimeout(r.current)
      r.current = null
    }
  }
  const close = () => {
    clearTimers()
    setOpen(false)
  }
  useEffect(() => clearTimers, [])
  const focusInside = () => tail.current !== null && tail.current.contains(document.activeElement)
  // A PyMOL menu up: the choices close with the strip.
  useEffect(() => {
    if (aside) setOpen(false)
  }, [aside])
  useEffect(() => {
    if (open && byKey.current) firstChoice.current?.focus({ preventScroll: true })
    byKey.current = false
  }, [open])
  // While open: Esc closes them, taken from the page only when the focus is theirs or nobody's;
  // a press anywhere else closes them too.
  useEffect(() => {
    if (!open) return
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const at = document.activeElement
      const mine = at === null || at === document.body || focusInside()
      if (mine) e.stopPropagation()
      const back = focusInside()
      close()
      if (back) motionBtn.current?.focus()
    }
    const onPress = (e: globalThis.PointerEvent) => {
      if (tail.current !== null && e.target instanceof Node && !tail.current.contains(e.target)) close()
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('pointerdown', onPress, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('pointerdown', onPress, true)
    }
    // close and focusInside read refs only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const ask = (next: Motion | null, cmd: string) => {
    if (!ready) return
    run(cmd)
    setExpect({ running: next, at: performance.now() })
  }
  const start = (m: Motion, s: MotionSpeed) => ask(m, motionCommand(m, s))
  const toggle = () => {
    if (running !== null) ask(null, MOTION_STOP)
    else start(kind, speed)
  }
  const choose = (m: Motion) => {
    setKind(m)
    start(m, speed)
  }
  const pace = (s: MotionSpeed) => {
    setSpeed(s)
    if (running !== null) start(running, s)
  }

  const hoverIn = (e: PointerEvent<HTMLElement>) => {
    if (e.pointerType === 'touch') return
    if (leaveTimer.current !== null) {
      window.clearTimeout(leaveTimer.current)
      leaveTimer.current = null
    }
    if (open || hoverTimer.current !== null) return
    hoverTimer.current = window.setTimeout(() => {
      hoverTimer.current = null
      setOpen(true)
    }, MOTION_HOVER_MS)
  }
  const hoverOut = (e: PointerEvent<HTMLElement>) => {
    if (e.pointerType === 'touch') return
    if (hoverTimer.current !== null) {
      window.clearTimeout(hoverTimer.current)
      hoverTimer.current = null
    }
    // The keyboard in the choices keeps them (PT-10649 item 7).
    if (leaveTimer.current !== null || focusInside()) return
    leaveTimer.current = window.setTimeout(() => {
      leaveTimer.current = null
      setOpen(false)
    }, MOTION_LEAVE_MS)
  }
  // The focus moving out of the strip (the choices opened by a tap or ↑) closes them (PT-10647
  // item 2). A blur with nowhere to go is a press — Safari focuses no button it clicks — and
  // the window's press listener decides that one, after the press has landed (PR #10172's review).
  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    const to = e.relatedTarget
    if (open && to instanceof Node && !e.currentTarget.contains(to)) close()
  }
  const onMotionDown = (e: PointerEvent<HTMLButtonElement>) => {
    touchPress.current = e.pointerType === 'touch'
    if (touchPress.current) setOpen(o => !o)
  }
  const onMotionClick = (_e: MouseEvent<HTMLButtonElement>) => {
    if (touchPress.current) {
      touchPress.current = false
      return
    }
    // A mouse click, Enter or Space: start or stop, as PyMOL's own ▼.
    toggle()
  }
  const onMotionKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'ArrowUp') return
    e.preventDefault()
    byKey.current = true
    setOpen(true)
  }
  // A touch screen's at the 24 px target size: its finger has no other way to ▼'s choices. Any
  // coarse pointer, not only the primary one: a laptop's touch screen too (PR #10172's review).
  const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(any-pointer: coarse)').matches
  const h = Math.max(rect.h, coarse ? TAIL_MIN_H_TOUCH : TAIL_MIN_H)
  const font = Math.round(Math.min(11, Math.max(8, h - 6)))
  const glyph = Math.round(Math.min(12, Math.max(7, h - 6)))
  const half = Math.round(rect.w / 2)
  const shownKind = running ?? kind
  const off = ready ? undefined : true
  return (
    <div
      ref={tail}
      className={`sav-ctl-tail${aside ? ' is-aside' : ''}${through ? ' is-through' : ''}`}
      style={{ left: rect.x, top: rect.y + rect.h - h, width: rect.w, height: h, fontSize: font }}
      onBlur={onBlur}
    >
      <button type="button" className={`sav-ctl-btn${seqShown ? ' is-on' : ''}`} style={{ width: half }} title={t('htmlExport:sa_pymol_seq_hint')} aria-pressed={seqShown} aria-disabled={off} onClick={() => ready && onSeq()}>
        {t('htmlExport:sa_pymol_seq_button')}
      </button>
      <button
        ref={motionBtn}
        type="button"
        className={`sav-ctl-btn${running !== null ? ' is-on' : ''}`}
        style={{ width: rect.w - half }}
        aria-label={t('htmlExport:sa_pymol_motion_button')}
        aria-pressed={running !== null}
        aria-describedby={hintId}
        aria-disabled={off}
        title={t('htmlExport:sa_pymol_motion_hint')}
        onPointerEnter={hoverIn}
        onPointerLeave={hoverOut}
        onPointerDown={onMotionDown}
        onClick={onMotionClick}
        onKeyDown={onMotionKey}
      >
        <svg viewBox="0 0 12 12" width={glyph} height={glyph} aria-hidden="true" focusable="false">
          <path d="M1.5 3h9L6 10z" fill="currentColor" />
        </svg>
      </button>
      <span id={hintId} className="sr-only">
        {t('htmlExport:sa_pymol_motion_hint')}
      </span>
      {open && (
        <div id={popId} className="sav-motion-pop" role="group" aria-label={t('htmlExport:sa_pymol_motion_button')} onPointerEnter={hoverIn} onPointerLeave={hoverOut}>
          <div className="sav-motion-row" role="group" aria-label={t('htmlExport:sa_pymol_motion_kind')}>
            {(['rock', 'turn'] as const).map((m, i) => (
              <button key={m} ref={i === 0 ? firstChoice : undefined} type="button" className="sav-motion-choice" aria-pressed={shownKind === m} aria-disabled={off} onClick={() => choose(m)}>
                {t(m === 'rock' ? 'htmlExport:sa_pymol_motion_rock' : 'htmlExport:sa_pymol_motion_turn')}
              </button>
            ))}
          </div>
          <div className="sav-motion-row" role="group" aria-label={t('htmlExport:sa_pymol_motion_speed')}>
            {MOTION_SPEEDS.map(s => (
              <button key={s} type="button" className="sav-motion-choice" aria-pressed={shownSpeed === s} aria-disabled={off} onClick={() => pace(s)}>
                {t('htmlExport:sa_pymol_motion_times', { n: s })}
              </button>
            ))}
          </div>
          <button type="button" className="sav-motion-go" aria-disabled={off} onClick={toggle}>
            {running !== null ? t('htmlExport:sa_pymol_motion_stop') : t('htmlExport:sa_pymol_motion_start')}
          </button>
        </div>
      )}
    </div>
  )
}
