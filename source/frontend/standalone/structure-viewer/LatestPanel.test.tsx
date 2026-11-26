/**
 * HELP's 「最新版ダウンロード」 making the latest version with this page's data
 * (owner 2026-11-17): offered only for a newer release, each step said in
 * turn (downloading, checking, moving the data, ready), Stop and Try again,
 * a copy at hand when no release can be downloaded, refused with its reason
 * when it is no form this version knows, and the save step at the end. Only a
 * file carrying the release signature is taken (owner 2026-11-17): the tests
 * sign theirs with a key of their own, handed to HELP as the release key.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { gunzipSync, gzipSync } from 'node:zlib'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key} ${JSON.stringify(vars)}` : key), i18n: { language: 'ja' } }),
}))
const saveBlobFile = vi.fn()
vi.mock('../../src/lib/saveBlobFile', () => ({ saveBlobFile: (...a: unknown[]) => saveBlobFile(...a) }))

import { resetModalStackForTests } from '../../src/components/modalStack'
import { blockElement } from '../../src/pages/structure-html-export/standaloneFormat'
import { APP_GITHUB_URL, APP_VERSION } from './appLicence'
import type { PageConfig } from './blocks'
import { HelpDialog } from './HelpDialog'
import type { LatestCheck } from './latestRelease'
import { PAGE_CSP } from './latestShell'
import type { CopySource } from './latestUpdate'
import { embeddedDoc } from './localFile'
import { releaseKeyPair, signPage } from './releaseSigning.testkit'
import { captureTemplate, resetTemplateForTests } from './selfCopy'

const enc = (s: string) => new TextEncoder().encode(s)
const block = (name: string, text: string) => blockElement(name, gzipSync(enc(text)).toString('base64'), enc(text).byteLength)

const LIGHT: PageConfig = {
  edition: 'light',
  structureId: 0,
  title: 'Crambin',
  code: '1CRN',
  exporterName: null,
  lang: 'ja',
  initialEngine: '3dmol',
  bColumn: 'bfactor',
  exportedAt: '',
  timeZone: null,
  pymolView: null,
  skipped: [],
  runtime: null,
}

/** This page: the old light app with its structure. */
function oldPage() {
  document.head.innerHTML = `<meta http-equiv="Content-Security-Policy" content="${PAGE_CSP}"><title>old</title>`
  const host = document.createElement('div')
  host.id = 'old-blocks'
  host.innerHTML = `${block('config', JSON.stringify(LIGHT))}${block('structure', 'data_1CRN\n')}${block('3dmol', '/* old */')}${block('licenses', '[]')}`
  document.body.appendChild(host)
  captureTemplate()
}

/** The latest version's light blank app, as the release carries it. */
function latestHtml(o: { version?: string | null; edition?: 'full' | 'light' } = {}) {
  const version = o.version === undefined ? '1.1.0' : o.version
  const mark = version === null ? '' : `<meta name="agdb-viewer-pack" content="${version}" data-config="1">`
  return (
    `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="${PAGE_CSP}">${mark}<meta name="agdb-viewer-pack-signature" content=""><title>new</title></head>` +
    `<body><div id="root"></div>${block('config', JSON.stringify({ v: 1, edition: o.edition ?? 'light', runtime: null }))}${block('3dmol', '/* new */')}${block('licenses', '[]')}` +
    '<script>window.__latestRan = 1</script></body></html>'
  )
}

/** The tests' release key, and the latest version signed with it. */
let KEY: Awaited<ReturnType<typeof releaseKeyPair>>
let BYTES: Uint8Array<ArrayBuffer>
let NEWER: Extract<LatestCheck, { kind: 'newer' }>
const signed = (o: Parameters<typeof latestHtml>[0] = {}) => signPage(latestHtml(o), KEY.privateKey)
beforeAll(async () => {
  KEY = await releaseKeyPair()
  BYTES = await signed()
  NEWER = {
    kind: 'newer',
    latest: '1.1.0',
    url: `${APP_GITHUB_URL}/releases/tag/v1.1.0`,
    tag: 'v1.1.0',
    assets: [{ name: 'AgroDesign-ProteinViewerPack-v1.1.0_light_20261201.html', size: BYTES.byteLength, sha256: null }],
  }
})

const copy = (): CopySource => ({ config: LIGHT, doc: embeddedDoc('data_1CRN\n', '1CRN', 'Crambin'), lang: 'ja', engine: '3dmol', dmolLook: null, pymolSession: null })

function readText(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsText(blob)
  })
}

/** HELP on its latest tab, the check answering `result`, the download `fetchLatest`. */
async function openLatest(result: LatestCheck, fetchLatest?: (url: string, init: RequestInit) => Promise<Response>, src: CopySource = copy()) {
  const user = userEvent.setup()
  render(
    <HelpDialog
      initialTab="latest"
      runtimes={[]}
      runtimesLoad="ready"
      onRetryRuntimes={() => undefined}
      bundled={[]}
      full={false}
      onClose={() => undefined}
      checkLatest={async () => result}
      copy={src}
      fetchLatest={fetchLatest}
      releaseKey={KEY.publicKey}
    />,
  )
  const panel = screen.getByRole('tabpanel')
  await user.click(within(panel).getByRole('button', { name: 'htmlExport:sa_latest_check' }))
  return { user, panel }
}

const stepLine = (panel: HTMLElement) => panel.querySelector('p[role="status"].sav-latest-step') as HTMLElement
const alertLine = (panel: HTMLElement) => panel.querySelector('p[role="alert"].sav-latest-step') as HTMLElement

beforeEach(() => {
  resetTemplateForTests()
  oldPage()
  delete (window as unknown as Record<string, unknown>).__latestRan
})
afterEach(() => {
  cleanup()
  saveBlobFile.mockReset()
  resetModalStackForTests()
  document.getElementById('old-blocks')?.remove()
  document.head.innerHTML = ''
})

describe('②「今のデータを引き継いだ最新版を別途保存」', () => {
  it('a newer release: says what moves and what it downloads, then each step in turn, and ends in the save step with the latest version’s name', async () => {
    let release: (r: Response) => void = () => undefined
    const fetchLatest = vi.fn(() => new Promise<Response>(r => (release = r)))
    const { user, panel } = await openLatest(NEWER, fetchLatest)
    expect(panel).toHaveTextContent('htmlExport:sa_up_prepare_note')
    expect(panel).toHaveTextContent('htmlExport:sa_up_move_structure {"name":"Crambin"}')
    expect(panel).toHaveTextContent('htmlExport:sa_up_left_marks')
    // A newer release: no copy at hand asked for.
    expect(within(panel).queryByRole('button', { name: 'htmlExport:sa_up_pick' })).toBeNull()
    await user.click(within(panel).getByRole('button', { name: 'htmlExport:sa_up_prepare' }))
    expect(fetchLatest).toHaveBeenCalledOnce()
    expect(fetchLatest.mock.calls[0]).toEqual([
      'https://raw.githubusercontent.com/AgroDesign-Studios/ProteinViewerPack/v1.1.0/latest/AgroDesign-ProteinViewerPack_light.html',
      expect.objectContaining({ credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'manual' }),
    ])
    expect(stepLine(panel)).toHaveTextContent('htmlExport:sa_up_fetching {"got":"0.0","total":"0.0"}')
    // While it runs: Stop, and the prepare button does nothing.
    expect(within(panel).getByRole('button', { name: 'htmlExport:sa_up_stop' })).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: 'htmlExport:sa_up_prepare' })).toHaveAttribute('aria-disabled', 'true')
    await act(async () => release(new Response(BYTES, { status: 200 })))
    expect(await within(panel).findByRole('button', { name: 'htmlExport:sa_save_default' })).toBeInTheDocument()
    expect(stepLine(panel)).toHaveTextContent('htmlExport:sa_up_ready {"version":"1.1.0"}')
    const name = within(panel).getByText(/_AgroDesign-ProteinViewerPack-v1\.1\.0_light_\d{8}\.html$/)
    expect(name.textContent!.startsWith('1CRN_')).toBe(true)
    await user.click(within(panel).getByRole('button', { name: 'htmlExport:sa_save_default' }))
    const [blob, saved] = saveBlobFile.mock.calls[0] as [Blob, string]
    expect(saved).toBe(name.textContent)
    // The latest version's page with this page's structure in it — and the downloaded page never ran.
    const html = await readText(blob)
    expect(html).toContain('<meta name="agdb-viewer-pack" content="1.1.0" data-config="1">')
    const parsed = new DOMParser().parseFromString(html, 'text/html')
    const structure = parsed.getElementById('agdb-structure')!
    expect(gunzipSync(Buffer.from(structure.textContent!, 'base64')).toString()).toBe('data_1CRN\n')
    expect(gunzipSync(Buffer.from(parsed.getElementById('agdb-3dmol')!.textContent!, 'base64')).toString()).toBe('/* new */')
    expect((window as unknown as Record<string, unknown>).__latestRan).toBeUndefined()
  })

  it('Stop ends the download: nothing is made, and it can be asked again', async () => {
    const fetchLatest = vi.fn(
      (_u: string, init: RequestInit) =>
        new Promise<Response>((_r, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))),
    )
    const { user, panel } = await openLatest(NEWER, fetchLatest)
    await user.click(within(panel).getByRole('button', { name: 'htmlExport:sa_up_prepare' }))
    await user.click(within(panel).getByRole('button', { name: 'htmlExport:sa_up_stop' }))
    expect(stepLine(panel)).toHaveTextContent('htmlExport:sa_up_stopped')
    expect(within(panel).queryByRole('button', { name: 'htmlExport:sa_save_default' })).toBeNull()
    expect(within(panel).getByRole('button', { name: 'htmlExport:sa_up_prepare' })).not.toHaveAttribute('aria-disabled')
    expect((fetchLatest.mock.calls[0][1] as RequestInit).signal!.aborted).toBe(true)
  })

  it('a download that fails says why, leaves ② to press again (no connection) and offers a copy at hand', async () => {
    const fetchLatest = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    const { user, panel } = await openLatest(NEWER, fetchLatest)
    await user.click(within(panel).getByRole('button', { name: 'htmlExport:sa_up_prepare' }))
    expect(await within(panel).findByText('htmlExport:sa_up_err_network')).toBe(alertLine(panel))
    expect(within(panel).getByRole('button', { name: 'htmlExport:sa_up_pick' })).toBeInTheDocument()
    // ② itself is the way to try again: no second button doing the same (owner 2026-11-15).
    expect(within(panel).queryByRole('button', { name: 'htmlExport:sa_retry' })).toBeNull()
    const prepare = within(panel).getByRole('button', { name: 'htmlExport:sa_up_prepare' })
    expect(prepare).not.toHaveAttribute('aria-disabled')
    await user.click(prepare)
    expect(fetchLatest).toHaveBeenCalledTimes(2)
  })

  it('a copy this page could not make can be asked again by ② itself (PT-10123 item 1)', async () => {
    const page = await signed({ version: '1.1.0' })
    const fetchLatest = vi.fn(async () => new Response(page, { status: 200 }))
    let fails = true
    const src: CopySource = {
      ...copy(),
      dmolLook: () => {
        if (fails) throw new Error('view not read')
        return null
      },
    }
    const { user, panel } = await openLatest({ ...NEWER, assets: [] }, fetchLatest, src)
    await user.click(within(panel).getByRole('button', { name: 'htmlExport:sa_up_prepare' }))
    expect(await within(panel).findByText('htmlExport:sa_app_err {"detail":"view not read"}')).toBe(alertLine(panel))
    const prepare = within(panel).getByRole('button', { name: 'htmlExport:sa_up_prepare' })
    expect(prepare).not.toHaveAttribute('aria-disabled')
    fails = false
    await user.click(prepare)
    expect(await within(panel).findByRole('button', { name: 'htmlExport:sa_save_default' })).toBeInTheDocument()
  })

  it('the steps are a list in order, for every screen reader: ① and ② are read (PT-10124)', async () => {
    const { panel } = await openLatest(NEWER)
    const list = panel.querySelector('ol.sav-latest-steps')!
    expect(list).toHaveAttribute('role', 'list')
    const nums = [...list.querySelectorAll('.sav-latest-num')]
    expect(nums.map(n => n.textContent)).toEqual(['①', '②'])
    for (const n of nums) expect(n).not.toHaveAttribute('aria-hidden')
  })

  it('a file missing at the tag cannot be asked again: ② waits, described by the reason', async () => {
    const fetchLatest = vi.fn(async () => new Response('', { status: 404 }))
    const { user, panel } = await openLatest(NEWER, fetchLatest)
    await user.click(within(panel).getByRole('button', { name: 'htmlExport:sa_up_prepare' }))
    expect(await within(panel).findByText('htmlExport:sa_up_err_not_found')).toBe(alertLine(panel))
    const prepare = within(panel).getByRole('button', { name: 'htmlExport:sa_up_prepare' })
    expect(prepare).toHaveAttribute('aria-disabled', 'true')
    expect(prepare).toHaveAccessibleDescription('htmlExport:sa_up_err_not_found')
    await user.click(prepare)
    expect(fetchLatest).toHaveBeenCalledOnce()
  })

  it('a file at the tag that is no app this version knows is refused with the reason; nothing is offered to save', async () => {
    const page = await signed({ version: null })
    const fetchLatest = vi.fn(async () => new Response(page, { status: 200 }))
    const { user, panel } = await openLatest({ ...NEWER, assets: [] }, fetchLatest)
    await user.click(within(panel).getByRole('button', { name: 'htmlExport:sa_up_prepare' }))
    expect(await within(panel).findByText('htmlExport:sa_up_err_not_app')).toBe(alertLine(panel))
    expect(within(panel).queryByRole('button', { name: 'htmlExport:sa_save_default' })).toBeNull()
  })
})

describe('no public release to download (none published yet, or offline)', () => {
  it('② waits with the reason, nothing is said of a published version, and the releases page and a copy at hand are offered (PT-9495 item 2)', async () => {
    const { panel } = await openLatest({ kind: 'not-found' })
    const prepare = within(panel).getByRole('button', { name: 'htmlExport:sa_up_prepare' })
    expect(prepare).toHaveAttribute('aria-disabled', 'true')
    expect(prepare).toHaveAccessibleDescription('htmlExport:sa_up_none_unavailable')
    expect(panel).not.toHaveTextContent('htmlExport:sa_about_github_note')
    expect(panel).toHaveTextContent('htmlExport:sa_up_fallback')
    expect(within(panel).getByRole('button', { name: 'htmlExport:sa_up_pick' })).toHaveAccessibleDescription(/sa_up_pick_note/)
    expect(within(panel).getAllByRole('link').map(l => l.getAttribute('href'))).toContain(`${APP_GITHUB_URL}/releases`)
    // What would move is said here too.
    expect(panel).toHaveTextContent('htmlExport:sa_up_move_structure {"name":"Crambin"}')
  })

  it('a copy chosen here goes through the same checks and the same move, and ends in the save step', async () => {
    const { user, panel } = await openLatest({ kind: 'network' })
    const input = panel.querySelector('input[type="file"]') as HTMLInputElement
    expect(input).toHaveAttribute('accept', '.html,.htm,text/html')
    const file = new File([await signed({ version: APP_VERSION })], 'latest.html', { type: 'text/html' })
    fireEvent.change(input, { target: { files: [file] } })
    expect(await within(panel).findByRole('button', { name: 'htmlExport:sa_save_default' })).toBeInTheDocument()
    expect(stepLine(panel)).toHaveTextContent(`htmlExport:sa_up_ready {"version":"${APP_VERSION}"}`)
    await user.click(within(panel).getByRole('button', { name: 'htmlExport:sa_up_back' }))
    expect(within(panel).queryByRole('button', { name: 'htmlExport:sa_save_default' })).toBeNull()
    expect(within(panel).getByRole('button', { name: 'htmlExport:sa_up_pick' })).toBeInTheDocument()
  })

  it('a chosen file of another edition, or no app at all, is refused with the reason', async () => {
    const { panel } = await openLatest({ kind: 'not-found' })
    const input = panel.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File([await signed({ edition: 'full' })], 'full.html', { type: 'text/html' })] } })
    expect(await within(panel).findByText(/htmlExport:sa_up_err_edition/)).toBe(alertLine(panel))
    fireEvent.change(input, { target: { files: [new File(['<p>not the app</p>'], 'x.html', { type: 'text/html' })] } })
    expect(await within(panel).findByText('htmlExport:sa_up_err_unsigned')).toBe(alertLine(panel))
  })

  it('only a file carrying the release signature is used: an unsigned one, one changed after signing, or one signed by another key is refused and nothing is moved', async () => {
    const { panel } = await openLatest({ kind: 'not-found' })
    const input = panel.querySelector('input[type="file"]') as HTMLInputElement
    const pick = (bytes: BlobPart) => fireEvent.change(input, { target: { files: [new File([bytes], 'latest.html', { type: 'text/html' })] } })
    pick(latestHtml({ version: APP_VERSION }))
    expect(await within(panel).findByText('htmlExport:sa_up_err_unsigned')).toBe(alertLine(panel))
    const changed = await signed({ version: APP_VERSION })
    changed[changed.length - 30] ^= 1
    pick(changed)
    expect(await within(panel).findByText('htmlExport:sa_up_err_bad_signature')).toBe(alertLine(panel))
    pick(await signPage(latestHtml({ version: APP_VERSION }), (await releaseKeyPair()).privateKey))
    await vi.waitFor(() => expect(alertLine(panel)).toHaveTextContent('htmlExport:sa_up_err_bad_signature'))
    expect(within(panel).queryByRole('button', { name: 'htmlExport:sa_save_default' })).toBeNull()
    expect(panel).toHaveTextContent('htmlExport:sa_up_signed_note')
  })

  it('the same version needs nothing: ② waits, saying so, and no copy is asked for', async () => {
    const { panel } = await openLatest({ kind: 'same', latest: APP_VERSION })
    const prepare = within(panel).getByRole('button', { name: 'htmlExport:sa_up_prepare' })
    expect(prepare).toHaveAttribute('aria-disabled', 'true')
    expect(prepare).toHaveAccessibleDescription('htmlExport:sa_up_none_same')
    expect(within(panel).queryByRole('button', { name: 'htmlExport:sa_up_pick' })).toBeNull()
    expect(panel).toHaveTextContent('htmlExport:sa_about_github_note')
  })

  it('a version in use newer than the release: ② waits, saying so', async () => {
    const { panel } = await openLatest({ kind: 'ahead', latest: '0.9.0' })
    expect(within(panel).getByRole('button', { name: 'htmlExport:sa_up_prepare' })).toHaveAccessibleDescription('htmlExport:sa_up_none_ahead')
  })
})

describe('① then ② (owner 2026-11-20)', () => {
  it('before ① is pressed, ② is there but greyed, says to check first, and a press asks nothing', async () => {
    const fetchLatest = vi.fn(async () => new Response(BYTES, { status: 200 }))
    const user = userEvent.setup()
    render(
      <HelpDialog
        initialTab="latest"
        runtimes={[]}
        runtimesLoad="ready"
        onRetryRuntimes={() => undefined}
        bundled={[]}
        full={false}
        onClose={() => undefined}
        checkLatest={async () => NEWER}
        copy={copy()}
        fetchLatest={fetchLatest}
        releaseKey={KEY.publicKey}
      />,
    )
    const panel = screen.getByRole('tabpanel')
    const check = within(panel).getByRole('button', { name: 'htmlExport:sa_latest_check' })
    const prepare = within(panel).getByRole('button', { name: 'htmlExport:sa_up_prepare' })
    // ① comes first, then ②, each in its own numbered item.
    expect(check.compareDocumentPosition(prepare) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(panel.querySelectorAll('ol.sav-latest-steps > li')).toHaveLength(2)
    expect(prepare).toHaveAttribute('aria-disabled', 'true')
    expect(prepare).toHaveAccessibleDescription('htmlExport:sa_up_wait_check')
    await user.click(prepare)
    expect(fetchLatest).not.toHaveBeenCalled()
    // ① found a newer release: ② is the one to press now, and what it does is said between the two.
    await user.click(check)
    expect(prepare).not.toHaveAttribute('aria-disabled')
    expect(prepare).toHaveClass('btn-primary')
    expect(check).toHaveClass('btn-secondary')
    const between = panel.querySelector('ol.sav-latest-steps > li:first-child .sav-latest-update') as HTMLElement
    expect(between).toHaveTextContent('htmlExport:sa_up_prepare_note')
  })

  it('① waits while ② runs', async () => {
    const fetchLatest = vi.fn(() => new Promise<Response>(() => undefined))
    const { user, panel } = await openLatest(NEWER, fetchLatest)
    await user.click(within(panel).getByRole('button', { name: 'htmlExport:sa_up_prepare' }))
    expect(within(panel).getByRole('button', { name: 'htmlExport:sa_latest_check' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('the repository row says where the latest version is, with its releases page', async () => {
    const { panel } = await openLatest(NEWER)
    const about = panel.querySelector('dl.sav-lic-about') as HTMLElement
    expect(about).toHaveTextContent('htmlExport:sa_about_github_note')
    expect(within(about).getByRole('link', { name: /sa_latest_releases/ })).toHaveAttribute('href', `${APP_GITHUB_URL}/releases`)
  })
})

describe('what each answer says', () => {
  it.each<[string, LatestCheck, string]>([
    ['the same version', { kind: 'same', latest: '1.0.0' }, 'htmlExport:sa_latest_same {"latest":"1.0.0"}'],
    ['a newer version', { kind: 'newer', latest: '9.0.0', url: `${APP_GITHUB_URL}/releases/tag/v9.0.0` }, 'htmlExport:sa_latest_newer {"latest":"9.0.0"}'],
    ['this file ahead of it', { kind: 'ahead', latest: '0.9.0' }, 'htmlExport:sa_latest_ahead {"latest":"0.9.0"}'],
    ['a tag that is no version', { kind: 'unreadable-tag', tag: 'nightly' }, 'htmlExport:sa_latest_unreadable {"tag":"nightly"}'],
    ['no public release', { kind: 'not-found' }, 'htmlExport:sa_latest_not_found'],
    ['the request limit used up', { kind: 'rate-limited' }, 'htmlExport:sa_latest_rate_limited'],
    ['an HTTP error', { kind: 'http', status: 502 }, 'htmlExport:sa_latest_http {"status":502}'],
    ['an answer that is no release', { kind: 'bad-answer' }, 'htmlExport:sa_latest_bad'],
    ['no connection', { kind: 'network' }, 'htmlExport:sa_latest_network'],
    ['no answer in time', { kind: 'timeout' }, 'htmlExport:sa_latest_timeout'],
  ])('the check finding %s says so', async (_name, result, text) => {
    const { panel } = await openLatest(result)
    expect(panel).toHaveTextContent(text)
  })

  /** A newer release whose download `answer` gives: refused, its reason on the alert line, nothing to save. */
  const failedDownload = async (release: Extract<LatestCheck, { kind: 'newer' }>, answer: () => Response, text: RegExp | string) => {
    const { user, panel } = await openLatest(release, vi.fn(async () => answer()))
    await user.click(within(panel).getByRole('button', { name: 'htmlExport:sa_up_prepare' }))
    expect(await within(panel).findByText(text)).toBe(alertLine(panel))
    expect(within(panel).queryByRole('button', { name: 'htmlExport:sa_save_default' })).toBeNull()
  }

  it('a download refused by the server says whether it is missing or another HTTP error', async () => {
    await failedDownload(NEWER, () => new Response('', { status: 404 }), 'htmlExport:sa_up_err_not_found')
    cleanup()
    await failedDownload(NEWER, () => new Response('', { status: 500 }), 'htmlExport:sa_up_err_http {"status":500}')
  })

  it('a download sent on to another address is refused', async () => {
    const moved = () => {
      const r = new Response(BYTES, { status: 200 })
      Object.defineProperty(r, 'redirected', { value: true })
      return r
    }
    await failedDownload(NEWER, moved, 'htmlExport:sa_up_err_redirected')
  })

  it('a download that is not the size, or not the digest, the release lists is refused', async () => {
    const [asset] = NEWER.assets!
    await failedDownload({ ...NEWER, assets: [{ ...asset, size: asset.size + 1 }] }, () => new Response(BYTES, { status: 200 }), 'htmlExport:sa_up_err_size')
    cleanup()
    await failedDownload({ ...NEWER, assets: [{ ...asset, sha256: '0'.repeat(64) }] }, () => new Response(BYTES, { status: 200 }), 'htmlExport:sa_up_err_digest')
  })

  it('a release listing a file over the cap is not downloaded', async () => {
    const [asset] = NEWER.assets!
    const fetchLatest = vi.fn(async () => new Response(BYTES, { status: 200 }))
    const { user, panel } = await openLatest({ ...NEWER, assets: [{ ...asset, size: 65 * 1024 * 1024 }] }, fetchLatest)
    await user.click(within(panel).getByRole('button', { name: 'htmlExport:sa_up_prepare' }))
    expect(await within(panel).findByText(/^htmlExport:sa_up_err_too_large /)).toBe(alertLine(panel))
  })

  it('a signed page of another version than its release’s tag is refused with the version found', async () => {
    const other = await signed({ version: '1.2.0' })
    await failedDownload({ ...NEWER, assets: [] }, () => new Response(other, { status: 200 }), 'htmlExport:sa_up_err_version {"found":"1.2.0"}')
  })

  it('a signed copy chosen here that is older than this page is refused with both versions', async () => {
    const { panel } = await openLatest({ kind: 'not-found' })
    const input = panel.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File([await signed({ version: '0.0.1' })], 'old.html', { type: 'text/html' })] } })
    expect(await within(panel).findByText(`htmlExport:sa_up_err_older {"found":"0.0.1","current":"${APP_VERSION}"}`)).toBe(alertLine(panel))
  })
})
