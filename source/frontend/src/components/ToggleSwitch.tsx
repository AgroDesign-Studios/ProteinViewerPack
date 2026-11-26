import type { ReactNode, Ref } from 'react'

import './ToggleSwitch.css'

/**
 * An on/off switch: a native checkbox with `role="switch"`, drawn as a track
 * and a knob whose position carries the state, not its colour alone (DESIGN
 * §9). The label is the whole
 * row, so a press on the words switches too.
 *
 * `offLabel` puts a word for the off side before the track ("通常品質 ⇄
 * 高品質", owner 2026-11-16): `label` is then the on side, and the switch's
 * accessible name is `label` — on means `label`.
 *
 * `unavailable` keeps the switch focusable and says why through
 * `describedBy` (`aria-disabled`, a press does nothing), as the page's other
 * choices that cannot be taken do. An unavailable switch reads off, unless
 * `showValueWhenUnavailable`: then it keeps showing the real value while
 * inert (a setting the viewer may see but not change).
 *
 * `busy` marks the switch `aria-busy` while its change is being saved.
 */
export function ToggleSwitch(props: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: ReactNode
  offLabel?: ReactNode
  unavailable?: boolean
  /** With `unavailable`: show the real value, locked, instead of off. */
  showValueWhenUnavailable?: boolean
  /** The change is being saved (`aria-busy`); the caller decides whether a press meanwhile counts. */
  busy?: boolean
  describedBy?: string
  className?: string
  /** The checkbox itself, for a caller that moves the focus to it. */
  inputRef?: Ref<HTMLInputElement>
}) {
  const {
    checked,
    onChange,
    label,
    offLabel,
    unavailable = false,
    showValueWhenUnavailable = false,
    busy = false,
    describedBy,
    className,
    inputRef,
  } = props
  const on = checked && (!unavailable || showValueWhenUnavailable)
  return (
    <label className={`ui-switch-row${on ? ' is-on' : ''}${unavailable ? ' is-unavailable' : ''}${className ? ` ${className}` : ''}`}>
      {offLabel !== undefined && (
        <span className="ui-switch-side" aria-hidden="true">
          {offLabel}
        </span>
      )}
      <input
        ref={inputRef}
        type="checkbox"
        role="switch"
        className="ui-switch"
        checked={on}
        aria-disabled={unavailable ? true : undefined}
        aria-busy={busy || undefined}
        aria-describedby={describedBy}
        onChange={e => {
          if (!unavailable) onChange(e.currentTarget.checked)
        }}
      />
      <span className="ui-switch-label">{label}</span>
    </label>
  )
}
