import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { formatSI } from '../../utils/formatSI'
import { cancellableKind, type PymolBusy } from './pymolBusy'

/** A request that ends sooner than this never shows the bar (no flicker per command). */
export const BUSY_SHOW_AFTER_MS = 1_000

/**
 * The command or export in flight, how long it has run, and the way out of it
 * The controller's `cancel()` is the only stop there is:
 * PyMOL cannot interrupt a synchronous section, so it rebuilds the frame from
 * the last snapshot — the button says so before it is pressed. The page's own
 * requests (the structure load, a restore) show in the page's status line
 * instead, and cannot be cancelled.
 *
 * While requests wait behind it, the count follows, and the button's
 * description reads it. The count is the whole queue, the page's own steps
 * included. Only while one of the user's own requests waits
 * (`PymolBusy.queuedCancels`) is it
 * followed by a line saying Stop stops them too (PT-3961); a removal or the
 * page's own steps alone get no such line, as Stop takes nothing of the
 * user's from them (PT-4042). It says "stops", never "will not run".
 * Lines the command line holds back behind its own request (`held`) wait
 * too, and Stop drops them: they count in both (PT-3291 item 6).
 *
 * Not a live region: a running clock read out every second would drown the
 * screen reader. The command line and the page status speak for the outcome.
 */
export function PymolBusyBar({ busy, held = 0, onCancel }: { busy: PymolBusy | null; held?: number; onCancel: () => void }) {
  const { t } = useTranslation('pymol')
  const noteId = useId()
  const queuedId = useId()
  const [now, setNow] = useState(() => Date.now())
  const mine = busy !== null && cancellableKind(busy.kind)

  useEffect(() => {
    if (!mine) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(timer)
  }, [mine, busy?.startedAt])

  if (!mine || now - busy.startedAt < BUSY_SHOW_AFTER_MS) return null
  const seconds = Math.floor((now - busy.startedAt) / 1000)
  const queued = busy.queued + held
  const waiting = queued > 0
  const stopsWaiting = busy.queuedCancels + held > 0
  return (
    <div className="pymolv-busy">
      <span className="pymolv-busy-text">
        {busy.kind === 'command' ? t('pymol:busy_command', { label: busy.label ?? '', seconds }) : t('pymol:busy_export', { seconds })}
        {waiting && (
          <>
            {' '}
            <span id={queuedId}>
              {t('pymol:busy_queued', { count: queued, n: formatSI(queued) })}
              {stopsWaiting && (
                <>
                  {' '}
                  {t('pymol:busy_queued_stop_hint', { stop: t('pymol:busy_cancel') })}
                </>
              )}
            </span>
          </>
        )}
      </span>
      <button type="button" className="btn btn-secondary btn-sm" aria-describedby={waiting ? `${queuedId} ${noteId}` : noteId} onClick={onCancel}>
        {t('pymol:busy_cancel')}
      </button>
      <span id={noteId} className="pymolv-busy-note">
        {t('pymol:busy_cancel_note')}
      </span>
    </div>
  )
}
