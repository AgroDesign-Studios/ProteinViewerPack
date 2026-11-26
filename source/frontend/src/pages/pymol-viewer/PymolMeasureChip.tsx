import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import '../../components/structure-viewer/structureViewer.css'
import type { UiState } from './pymolFrameProtocol'

/**
 * Starts PyMOL's Measurement wizard unless it is already the one up: pressing
 * twice, or after the Wizard menu opened it, never stacks a second one (a
 * second `wizard measurement` pushes another instance — measured in the real
 * frame, 2026-11-12).
 */
export const MEASURE_ON = "/if type(cmd.get_wizard()).__name__ != 'Measurement': cmd.wizard('measurement')"

/**
 * Ends the Measurement wizard only while it is the one up: never another
 * wizard the user opened, and never the whole wizard stack. The distances
 * measured stay.
 */
export const MEASURE_OFF = "/if type(cmd.get_wizard()).__name__ == 'Measurement': cmd.set_wizard()"

interface Props {
  ui: UiState | null
  ready: boolean
  /** The user's runner (counted as the user's change: measurements are their work). */
  run: (cmd: string) => Promise<void>
  /** Told when a measurement starts: the host puts its pen or eraser away. */
  onStart?: () => void
  /** The pressed chip's word, where the host says more than 「測定中」 (the offline file's 「測定中・終了」). */
  onLabel?: string
}

/**
 * 「📏 測定」 for PyMOL (owner 2026-11-12, UI consult Codex astra + Opus 5.5):
 * a toggle whose pressed state is PyMOL's own — the wizard the frame reports
 * (`uistate.wizard`) — so the wizard's Done, the Wizard menu or a typed
 * command all show here. Between a press and the frame's report it is busy.
 * Locked, with the reason, while PyMOL is not ready or another wizard is up.
 */
export function PymolMeasureChip({ ui, ready, run, onStart, onLabel }: Props) {
  const { t } = useTranslation('pymol')
  const reasonId = useId()
  const [busy, setBusy] = useState(false)
  const on = ui?.wizard === 'measurement'
  const otherWizard = ui?.wizard === 'other'
  const locked = !ready || otherWizard || busy
  const reason = !ready ? t('pymol:measure_locked_not_ready') : otherWizard ? t('pymol:measure_locked_other_wizard') : null
  const press = () => {
    if (locked) return
    if (!on) onStart?.()
    setBusy(true)
    run(on ? MEASURE_OFF : MEASURE_ON).then(
      () => setBusy(false),
      () => setBusy(false),
    )
  }
  return (
    <span className="sv3d pymolv-measure">
      <button
        type="button"
        className="sv3d-chip"
        aria-pressed={on}
        aria-disabled={locked || undefined}
        aria-busy={busy || undefined}
        aria-describedby={reason !== null ? reasonId : undefined}
        title={reason ?? (on ? t('pymol:measure_on_hint') : t('pymol:measure_hint'))}
        onClick={press}
      >
        <span aria-hidden="true">📏 </span>
        {on ? (onLabel ?? t('pymol:measure_on')) : t('pymol:measure')}
      </button>
      {reason !== null && <span id={reasonId} className="sr-only">{reason}</span>}
    </span>
  )
}
