import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { formatSI } from '../../src/utils/formatSI'
import { isTouchDevice, PHONE_WARN_BYTES } from './AppCopyDialog'
import { APP_GITHUB_URL, APP_VERSION } from './appLicence'
import { isFileOnIos } from './fileOnIos'
import { editionAsset, LATEST_MAX_BYTES, type FetchFailure } from './latestFetch'
import { checkLatestRelease, RELEASE_TIMEOUT_MS, type LatestCheck, type ReleaseAsset } from './latestRelease'
import type { ShellRefusal } from './latestShell'
import type { Moves, UpdateFailure, UpdateStep } from './latestUpdate'
import { AppAbout, OutLink } from './LicenceDialog'
import { SaveStep } from './SaveStep'

/** Where the check is: never asked, asking, or what it found. Memory only: nothing is stored. */
export type LatestState = { phase: 'idle' } | { phase: 'checking' } | { phase: 'done'; result: LatestCheck }

/** One check: the repository's latest release against this file's version (`checkLatestRelease`). */
export type LatestChecker = (signal: AbortSignal) => Promise<LatestCheck>

const realChecker: LatestChecker = signal => checkLatestRelease(APP_GITHUB_URL, APP_VERSION, signal)

/**
 * The check's state, for as long as HELP is open (a tab change keeps it).
 * `check` asks once: a press while asking does nothing, and closing HELP
 * stops the question and drops its answer.
 */
export function useLatestCheck(checker: LatestChecker = realChecker): { state: LatestState; check: () => void } {
  const [state, setState] = useState<LatestState>({ phase: 'idle' })
  const running = useRef<AbortController | null>(null)
  useEffect(
    () => () => {
      running.current?.abort()
      running.current = null
    },
    [],
  )
  const check = useCallback(() => {
    if (running.current !== null) return
    const stop = new AbortController()
    running.current = stop
    setState({ phase: 'checking' })
    void checker(stop.signal).then(result => {
      if (stop.signal.aborted) return
      running.current = null
      setState({ phase: 'done', result })
    })
  }, [checker])
  return { state, check }
}

type T = (key: string, vars?: Record<string, unknown>) => string

/**
 * The status line's words for a state. No connection from a page opened from
 * a file on an iPhone or iPad says why that is likely and points at the
 * releases link below, which a browser opens by itself (PT-9781): telling
 * the person to check a connection they have sends them after the wrong
 * problem.
 */
function statusText(state: LatestState, t: T): string {
  if (state.phase === 'idle') return t('htmlExport:sa_latest_unchecked')
  if (state.phase === 'checking') return t('htmlExport:sa_latest_checking')
  const r = state.result
  switch (r.kind) {
    case 'same':
      return t('htmlExport:sa_latest_same', { latest: r.latest })
    case 'newer':
      return t('htmlExport:sa_latest_newer', { latest: r.latest })
    case 'ahead':
      return t('htmlExport:sa_latest_ahead', { latest: r.latest })
    case 'unreadable-tag':
      return t('htmlExport:sa_latest_unreadable', { tag: r.tag })
    case 'not-found':
      return t('htmlExport:sa_latest_not_found')
    case 'rate-limited':
      return t('htmlExport:sa_latest_rate_limited')
    case 'http':
      return t('htmlExport:sa_latest_http', { status: r.status })
    case 'bad-answer':
      return t('htmlExport:sa_latest_bad')
    case 'network':
      return t(isFileOnIos() ? 'htmlExport:sa_latest_network_file_ios' : 'htmlExport:sa_latest_network')
    case 'timeout':
      return t('htmlExport:sa_latest_timeout', { seconds: String(RELEASE_TIMEOUT_MS / 1000) })
  }
}

const FAILED: ReadonlySet<LatestCheck['kind']> = new Set(['rate-limited', 'http', 'bad-answer', 'network', 'timeout'])

/** The checks that found no release this page can download: a copy at hand is offered instead (UI consult, astra). */
const NO_RELEASE: ReadonlySet<LatestCheck['kind']> = new Set(['not-found', 'unreadable-tag', 'rate-limited', 'http', 'bad-answer', 'network', 'timeout'])

const MiB = 1024 * 1024
const mbText = (bytes: number) => formatSI(bytes / MiB, { fractionDigits: bytes < 10 * MiB ? 1 : 0 })

function fetchText(f: FetchFailure, t: T): string {
  switch (f.kind) {
    case 'not-found':
      return t('htmlExport:sa_up_err_not_found')
    case 'http':
      return t('htmlExport:sa_up_err_http', { status: f.status })
    case 'network':
      return t('htmlExport:sa_up_err_network')
    case 'timeout':
      return t('htmlExport:sa_up_err_timeout')
    case 'too-slow':
      return t('htmlExport:sa_up_err_too_slow')
    case 'too-large':
      return t('htmlExport:sa_up_err_too_large', { mb: mbText(LATEST_MAX_BYTES) })
    case 'redirected':
      return t('htmlExport:sa_up_err_redirected')
    case 'size':
      return t('htmlExport:sa_up_err_size')
    case 'digest':
      return t('htmlExport:sa_up_err_digest')
    case 'aborted':
      return t('htmlExport:sa_up_stopped')
  }
}

/** The editions' names, for a latest version of the other edition (`sa_up_err_edition`). */
const EDITION_KEY = { full: 'htmlExport:sa_latest_edition_full', light: 'htmlExport:sa_latest_edition_light' } as const

/** Why a file is not AgroDesign's (`releaseSignature.ts`). */
const SIGNATURE_KEY = {
  unsigned: 'htmlExport:sa_up_err_unsigned',
  bad: 'htmlExport:sa_up_err_bad_signature',
  'no-crypto': 'htmlExport:sa_up_err_no_crypto',
} as const

function shellText(r: ShellRefusal, edition: 'full' | 'light', t: T): string {
  switch (r.code) {
    case 'too-large':
      return t('htmlExport:sa_up_err_too_large', { mb: mbText(LATEST_MAX_BYTES) })
    case 'not-app':
      return t('htmlExport:sa_up_err_not_app')
    case 'config-version':
      return t('htmlExport:sa_up_err_config', { found: r.detail })
    case 'edition':
      return t('htmlExport:sa_up_err_edition', { found: t(EDITION_KEY[r.detail]), mine: t(EDITION_KEY[edition]) })
    case 'version-mismatch':
      return t('htmlExport:sa_up_err_version', { found: r.detail })
    case 'older':
      return t('htmlExport:sa_up_err_older', { found: r.detail, current: APP_VERSION })
    case 'blocks':
      return t('htmlExport:sa_up_err_blocks', { detail: r.detail })
    case 'csp':
      return t('htmlExport:sa_up_err_csp', { detail: r.detail })
  }
}

function failureText(why: UpdateFailure, edition: 'full' | 'light', t: T): string {
  switch (why.kind) {
    case 'fetch':
      return fetchText(why.failure, t)
    case 'shell':
      return shellText(why.refusal, edition, t)
    case 'signature':
      return t(SIGNATURE_KEY[why.failure])
    case 'session':
      return t('htmlExport:sa_up_err_session', { detail: why.detail })
    case 'make':
      return t('htmlExport:sa_app_err', { detail: why.detail })
    case 'read':
      return t('htmlExport:sa_up_err_read', { detail: why.detail })
  }
}

/** The step line's words: what runs now, or how it ended. */
function stepText(step: UpdateStep, t: T): string {
  switch (step.phase) {
    case 'idle':
      return ''
    case 'fetching':
      return step.total === null
        ? t('htmlExport:sa_up_fetching_nototal', { got: mbText(step.received) })
        : t('htmlExport:sa_up_fetching', { got: mbText(step.received), total: mbText(step.total) })
    case 'verifying':
      return t(step.source === 'release' ? 'htmlExport:sa_up_verifying' : 'htmlExport:sa_up_verifying_file')
    case 'migrating':
      return t('htmlExport:sa_up_migrating')
    case 'ready':
      return t('htmlExport:sa_up_ready', { version: step.version })
    case 'failed':
      return ''
    case 'stopped':
      return t('htmlExport:sa_up_stopped')
  }
}

/** The preparation, as `HelpDialog` holds it (`useLatestUpdate`). */
export interface LatestUpdate {
  step: UpdateStep
  fromRelease: (release: { tag: string; assets: readonly ReleaseAsset[] }) => void
  fromFile: (file: File) => void
  stop: () => void
  reset: () => void
}

/** What goes into the latest version, and what stays behind (`movesOf`). */
function MovesList({ moves }: { moves: Moves }) {
  const { t } = useTranslation('htmlExport')
  const left = [
    ...(moves.dmolMarks ? [t('htmlExport:sa_up_left_marks')] : []),
    ...(moves.pymolLeft ? [t('htmlExport:sa_up_left_pymol')] : []),
  ]
  return (
    <>
      <p className="sav-latest-moves-title">{t('htmlExport:sa_up_moves')}</p>
      <ul className="sav-latest-moves">
        <li>{moves.structure === null ? t('htmlExport:sa_up_move_blank') : t('htmlExport:sa_up_move_structure', { name: moves.structure })}</li>
        {moves.dmolView && <li>{t('htmlExport:sa_up_move_dmol')}</li>}
        {moves.pymolSession && <li>{t('htmlExport:sa_up_move_pymol')}</li>}
        <li>{t('htmlExport:sa_up_move_lang')}</li>
      </ul>
      {left.length > 0 && (
        <>
          <p className="sav-latest-moves-title">{t('htmlExport:sa_up_left')}</p>
          <ul className="sav-latest-moves">
            {left.map(l => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </>
      )}
    </>
  )
}

/**
 * HELP's 「最新版ダウンロード」 tab (owner 2026-11-16; UI consult with Opus
 * and astra), top to bottom:
 *
 * - the app's name, the version in use (with a 「✓ 最新版」 badge beside it,
 *   and only there, once a check found the same version number), maker and
 *   repository (`AppAbout`, owner 2026-11-17: the tab named no app; no
 *   edition row since 2026-11-18: エディションは不要), the repository's row
 *   saying the latest version is published there, with the releases page
 *   (owner 2026-11-20: 「上部のGitHubの下へあたりへ」), while the check has not
 *   found that there is no public release (PT-9495 item 2).
 * - Two numbered steps, one under the other (owner 2026-11-20:
 *   『①GitHubの最新版を確認』⇓『②今のデータを引き継いだ最新版を別途保存』;
 *   UI consult, Opus 5.5 and Codex astra):
 *   - ① what pressing sends, the button, and the check's status (one
 *     `role="status"` line, always in the page; a newer release adds a link to
 *     its page). The question goes out only on the press (`useLatestCheck`).
 *     Then, between the steps, what ① found leads to: a newer release, what
 *     ② fetches, the signature and what moves and what cannot; no release
 *     that can be downloaded — the check found none or failed, or the
 *     download failed — 「手元の最新版 HTML を選ぶ」: a copy at hand goes
 *     through the same checks and the same move, so the feature works before
 *     publication and offline. Either file is used only with AgroDesign's
 *     signature on it (`releaseSignature.ts`, owner 2026-11-17), which both say.
 *   - ⇓, then ② (with `update`, owner 2026-11-17): always in the page, greyed
 *     (`aria-disabled`, the reason said under it) until ① found a newer
 *     release — 「先に①で確認」, the same version, a newer one in use, none to
 *     download. Pressed: the steps said one by one in their own status line
 *     (downloading n MB, checking, moving the data, ready) with 「中止」; a
 *     download that failed for want of a connection leaves ② to press again.
 *     Ready, the save step (`SaveStep`) under it. ① waits while ② runs.
 */
export function LatestPanel(props: {
  state: LatestState
  onCheck: () => void
  githubUrl?: string
  /** This page's edition. */
  edition?: 'full' | 'light'
  /** The preparation, where this page gives its data (`HelpDialog`). */
  update?: LatestUpdate | null
  /** What the preparation moves (`movesOf`). */
  moves?: Moves | null
}) {
  const { state, onCheck, githubUrl = APP_GITHUB_URL, edition = 'light', update = null, moves = null } = props
  const { t } = useTranslation('htmlExport')
  const fileRef = useRef<HTMLInputElement | null>(null)
  const pickId = useId()
  const whyId = useId()
  const alertId = useId()
  const result = state.phase === 'done' ? state.result : null
  const busy = state.phase === 'checking'
  const step = update?.step ?? { phase: 'idle' }
  const running = step.phase === 'fetching' || step.phase === 'verifying' || step.phase === 'migrating'
  const newer = result?.kind === 'newer' && result.tag !== undefined ? result : null
  const fetchFailed = step.phase === 'failed' && step.source === 'release' && step.why.kind === 'fetch'
  const noRelease = result !== null && NO_RELEASE.has(result.kind)
  // A copy chosen here is being read, or was: its way in stays where it was pressed.
  const fileStep = step.phase !== 'idle' && step.phase !== 'stopped' && step.phase !== 'fetching' && step.source === 'file'
  const offerFile = update !== null && githubUrl !== '' && (noRelease || fetchFailed || fileStep)
  const asset = newer === null ? null : editionAsset(newer.assets, edition)
  const ready = step.phase === 'ready' ? step : null
  const failure = step.phase === 'failed' ? failureText(step.why, edition, t) : ''
  // ② itself asks again after a release run that may go another way next time: the download
  // failed for want of a connection (not a missing file), or this page could not write its
  // PyMOL session or make the copy (PT-10123 item 1: both can be passing, as main let you retry).
  // A file refused as it is — missing, its signature, its shape — stays refused.
  const retryable =
    step.phase === 'failed' &&
    step.source === 'release' &&
    ((step.why.kind === 'fetch' && step.why.failure.kind !== 'not-found') || step.why.kind === 'session' || step.why.kind === 'make')
  const refused = step.phase === 'failed' && step.source === 'release' && !retryable
  const canPrepare = update !== null && newer !== null && ready === null && !running && !refused
  // Why ② waits, said under it; none while it can be pressed, runs, has failed (the alert says why) or is done.
  const why =
    canPrepare || running || ready !== null || refused
      ? ''
      : result === null
        ? t('htmlExport:sa_up_wait_check')
        : result.kind === 'same'
          ? t('htmlExport:sa_up_none_same')
          : result.kind === 'ahead'
            ? t('htmlExport:sa_up_none_ahead')
            : offerFile
              ? t('htmlExport:sa_up_none_unavailable')
              : ''
  const prepare = () => {
    if (canPrepare && newer !== null) update.fromRelease({ tag: newer.tag ?? '', assets: newer.assets ?? [] })
  }
  // One `role="status"` line, always in the page: in ①, or alone where there is no repository to ask.
  const statusLine = (
    <p role="status" className={`sav-latest-status${result !== null && FAILED.has(result.kind) ? ' is-error' : ''}`}>
      {statusText(state, t)}
      {result?.kind === 'newer' && (
        <>
          {' '}
          <OutLink href={result.url}>{t('htmlExport:sa_latest_open_release')}</OutLink>
        </>
      )}
    </p>
  )
  return (
    <div className="sav-latest" aria-busy={busy || running}>
      <AppAbout
        githubUrl={githubUrl}
        versionNote={
          result?.kind === 'same' ? (
            <>
              {' '}
              <span className="badge badge-success sav-latest-badge">
                <span aria-hidden="true">✓</span> {t('htmlExport:sa_latest_badge')}
              </span>
            </>
          ) : null
        }
        githubNote={
          result?.kind !== 'not-found' ? (
            <>
              {t('htmlExport:sa_about_github_note')} <OutLink href={`${githubUrl}/releases`}>{t('htmlExport:sa_latest_releases')}</OutLink>
            </>
          ) : undefined
        }
      />
      {githubUrl === '' && statusLine}
      {githubUrl !== '' && (
        // role="list": WebKit (VoiceOver, every iOS browser) drops a list's semantics with its
        // markers gone, and the order is the point here; the numbers are read too (PT-10124).
        <ol className="sav-latest-steps" role="list">
          <li className="sav-latest-stepbox">
            <span className="sav-latest-num">①</span>
            <div className="sav-latest-stepbody">
              <p className="sav-latest-note">{t('htmlExport:sa_latest_note')}</p>
              {/* Focusable while asking: a disabled button would drop the focus to the page. ① waits while ② runs. */}
              <button
                type="button"
                className={`btn ${newer !== null && update !== null ? 'btn-secondary' : 'btn-primary'} sav-latest-check`}
                aria-disabled={busy || running ? true : undefined}
                onClick={busy || running ? undefined : onCheck}
              >
                {t('htmlExport:sa_latest_check')}
              </button>
              {statusLine}
              {update !== null && newer !== null && ready === null && (
                <div className="sav-latest-update">
                  <p>
                    {asset !== null
                      ? t('htmlExport:sa_up_prepare_note', { latest: newer.latest, mb: mbText(asset.size) })
                      : t('htmlExport:sa_up_prepare_note_nosize', { latest: newer.latest })}
                  </p>
                  <p className="sav-latest-note">{t('htmlExport:sa_up_signed_note')}</p>
                  {moves !== null && <MovesList moves={moves} />}
                  {/* As 「HTMLappとして出力」 does: a phone may run out of memory on a large file. */}
                  {asset !== null && asset.size > PHONE_WARN_BYTES && isTouchDevice() && <p className="sav-app-why">{t('htmlExport:sa_app_phone_warn', { mb: mbText(asset.size) })}</p>}
                </div>
              )}
              {offerFile && ready === null && (
                <div className="sav-latest-fallback">
                  <p>{t('htmlExport:sa_up_fallback')}</p>
                  <p className="sav-latest-note">{t('htmlExport:sa_up_signed_note')}</p>
                  {newer === null && moves !== null && <MovesList moves={moves} />}
                  <div className="sav-latest-row">
                    <button
                      type="button"
                      className="btn btn-secondary"
                      aria-disabled={running ? true : undefined}
                      aria-describedby={pickId}
                      onClick={running ? undefined : () => fileRef.current?.click()}
                    >
                      {t('htmlExport:sa_up_pick')}
                    </button>
                  </div>
                  <p id={pickId} className="sav-latest-note">
                    {t('htmlExport:sa_up_pick_note')} <OutLink href={`${githubUrl}/releases`}>{t('htmlExport:sa_latest_releases')}</OutLink>
                  </p>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".html,.htm,text/html"
                    hidden
                    tabIndex={-1}
                    aria-hidden="true"
                    onChange={e => {
                      const f = e.target.files?.[0]
                      e.target.value = ''
                      if (f !== undefined) update?.fromFile(f)
                    }}
                  />
                </div>
              )}
            </div>
          </li>
          {update !== null && (
            <li className="sav-latest-stepbox">
              <span className="sav-latest-arrow" aria-hidden="true">
                ⇓
              </span>
              <span className="sav-latest-num">②</span>
              <div className="sav-latest-stepbody">
                <button
                  type="button"
                  className={`btn ${canPrepare ? 'btn-primary' : 'btn-secondary'} sav-latest-prepare`}
                  aria-disabled={canPrepare ? undefined : true}
                  aria-describedby={why !== '' ? whyId : failure !== '' ? alertId : undefined}
                  onClick={canPrepare ? prepare : undefined}
                >
                  {t('htmlExport:sa_up_prepare')}
                </button>
                {why !== '' && (
                  <p id={whyId} className="sav-latest-note sav-latest-why">
                    {why}
                  </p>
                )}
                {/* One block, so the empty lines of a step not started take no room. */}
                <div className="sav-latest-live">
                  <p role="status" className="sav-latest-step">
                    {stepText(step, t)}
                  </p>
                  {running && (
                    <button type="button" className="btn btn-secondary" onClick={update.stop}>
                      {t('htmlExport:sa_up_stop')}
                    </button>
                  )}
                  <p id={alertId} role="alert" className="sav-latest-step is-error">
                    {failure}
                  </p>
                </div>
                {ready !== null && (
                  <div className="sav-latest-update">
                    <SaveStep file={ready.file} onBack={update.reset} backLabel={t('htmlExport:sa_up_back')} />
                  </div>
                )}
              </div>
            </li>
          )}
        </ol>
      )}
    </div>
  )
}
