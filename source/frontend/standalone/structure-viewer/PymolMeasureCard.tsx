import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { MEASURE_OFF, MEASURE_ON } from '../../src/pages/pymol-viewer/PymolMeasureChip'

/** PyMOL's Measurement wizard modes the card offers: distances, angles, dihedrals. */
export const MEASURE_MODES = ['pairs', 'angle', 'dihed'] as const
export type MeasureMode = (typeof MEASURE_MODES)[number]

const MODE_TEXT: Readonly<Record<MeasureMode, string>> = {
  pairs: 'htmlExport:sa_measure_mode_pairs',
  angle: 'htmlExport:sa_measure_mode_angle',
  dihed: 'htmlExport:sa_measure_mode_dihed',
}

/** Only while the Measurement wizard is the one up (never another wizard the user opened), not echoed into the view. */
const ifMeasuring = (call: string) => `_ /cmd.get_wizard().${call} if type(cmd.get_wizard()).__name__ == 'Measurement' else None`

/** What measures, as PyMOL's wizard panel sets it (Measurement.set_mode). */
export const measureModeCommand = (mode: MeasureMode): string => ifMeasuring(`set_mode('${mode}')`)

/** Starting and ending the Measurement wizard (PymolMeasureChip's), not echoed into a phone's view. */
export const MEASURE_ON_QUIET = `_ ${MEASURE_ON}`
export const MEASURE_OFF_QUIET = `_ ${MEASURE_OFF}`

/** The wizard panel's 「Delete Last Object」. */
export const MEASURE_DELETE_LAST = ifMeasuring('delete_last()')

/**
 * A phone measuring (owner 2026-11-19: no PyMOL object panel on a phone, so
 * not the wizard's own panel either): what it measures — distances, angles,
 * dihedrals —, 「最後を消す」 and 「終了」, by the view while the 表示ツール
 * sheet is closed and atoms are tapped. The mode shown is the last one
 * chosen here (PyMOL does not report it); a measurement starts with
 * distances, as the wizard does. Ending keeps what was measured.
 */
export function PymolMeasureCard(props: { run: (cmd: string) => Promise<void> }) {
  const { run } = props
  const { t } = useTranslation(['htmlExport'])
  const [mode, setMode] = useState<MeasureMode>('pairs')
  const [busy, setBusy] = useState(false)
  const send = (cmd: string) => {
    setBusy(true)
    void run(cmd)
      .catch(() => undefined)
      .finally(() => setBusy(false))
  }
  return (
    <div className="sav-measure-card" role="group" aria-label={t('htmlExport:sa_measure_card')} aria-busy={busy || undefined}>
      <div className="sav-measure-modes">
        {MEASURE_MODES.map(m => (
          <button
            key={m}
            type="button"
            className="btn btn-secondary"
            aria-pressed={mode === m}
            onClick={() => {
              setMode(m)
              send(measureModeCommand(m))
            }}
          >
            {t(MODE_TEXT[m])}
          </button>
        ))}
      </div>
      <div className="sav-measure-actions">
        <button type="button" className="btn btn-secondary" onClick={() => send(MEASURE_DELETE_LAST)}>
          {t('htmlExport:sa_measure_delete_last')}
        </button>
        <button type="button" className="btn btn-primary" onClick={() => send(MEASURE_OFF_QUIET)}>
          {t('htmlExport:sa_measure_end')}
        </button>
      </div>
    </div>
  )
}
