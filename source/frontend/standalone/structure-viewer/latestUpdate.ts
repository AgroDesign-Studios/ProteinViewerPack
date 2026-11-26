/**
 * HELP's 「今のデータを引き継いだ最新版を別途保存」 (owner 2026-11-17: GitHub に最新版が
 * あったら、そのファイルに現在起動しているアプリの中にあるデータを乗せ換えて…
 * ダウンロードできるように): the latest version's blank app of this edition,
 * from the release (`latestFetch.ts`) or a copy the person chooses here when
 * it cannot be downloaded, its AgroDesign signature checked
 * (`releaseSignature.ts`, owner 2026-11-17), its form checked (`latestShell.ts`), and this page's data
 * put in it (`makeAppCopy` with the shell as `target`) — the same data
 * 「HTMLappとして出力」 keeps by default: the structure open, the Light
 * viewer's view as it is, the Heavy viewer's session written fresh (full
 * edition), the language and the viewer shown. The latest version's code,
 * runtime, licences and CSP are kept as they came. The file is then handed to
 * the save step. Each step is said as it starts; Stop ends the one running.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import type { Mol3dLook } from '../../src/pages/structure-html-export/mol3dLook'
import { viewerPackFileStem } from '../../src/pages/structure-html-export/viewerPackFileName'
import { APP_GITHUB_URL, APP_VERSION } from './appLicence'
import type { PageConfig } from './blocks'
import { editionAsset, fetchLatestFile, LATEST_MAX_BYTES, latestFileUrl, type FetchFailure } from './latestFetch'
import type { ReleaseAsset } from './latestRelease'
import { checkReleaseSignature, RELEASE_PUBLIC_KEY, type SignatureFailure } from './releaseSignature'
import { inspectShell, shellText, type CheckedShell, type ShellRefusal } from './latestShell'
import type { StructureDoc } from './localFile'
import type { PreparedFile } from './saveFile'
import { carriesBlock, makeAppCopy, MOL3D_SESSION_BLOCK, PYMOL_SESSION_BLOCK } from './selfCopy'

/** What this page holds that a copy takes: as `AppCopyDialog` is given it. */
export interface CopySource {
  config: PageConfig
  doc: StructureDoc | null
  lang: 'ja' | 'en'
  engine: '3dmol' | 'pymol'
  /** The Light viewer's view now, frozen; null when it shows no view of the open file. */
  dmolLook: (() => Mol3dLook | null) | null
  /** The Heavy viewer's session written fresh; null when it is not running on the open file (or this is the light edition). */
  pymolSession: ((signal: AbortSignal) => Promise<ArrayBuffer>) | null
}

/** This page's edition, as the page reads it (`StandaloneApp`'s `full`). */
export const editionOf = (config: PageConfig): 'full' | 'light' => (config.edition === 'full' && config.runtime !== null ? 'full' : 'light')

/** What goes into the latest version, and what cannot: keys of the panel's list. */
export interface Moves {
  /** The structure's name, or null for a blank app. */
  structure: string | null
  dmolView: boolean
  pymolSession: boolean
  /** Why the Heavy viewer's state stays behind (full edition, a structure open): it is not running on it. */
  pymolLeft: boolean
  /** The Light viewer's measurements, pen strokes and the picked residue: no view keeps them. */
  dmolMarks: boolean
}

/** The original structure (the one the file was made with) may keep the sessions it carries. */
const isOriginal = (d: StructureDoc | null) => d !== null && d.serial === 0

/** What `prepare` puts in the latest version, for the panel to say before the press. */
export function movesOf(src: CopySource): Moves {
  const { doc } = src
  const original = isOriginal(doc)
  const full = editionOf(src.config) === 'full'
  const dmolView = doc !== null && doc.ext !== 'pse' && (src.dmolLook !== null || (original && carriesBlock(MOL3D_SESSION_BLOCK)))
  const pymolSession = doc !== null && full && (src.pymolSession !== null || (original && carriesBlock(PYMOL_SESSION_BLOCK)))
  return {
    structure: doc === null ? null : doc.name,
    dmolView,
    pymolSession,
    pymolLeft: doc !== null && full && !pymolSession,
    dmolMarks: doc !== null && doc.ext !== 'pse',
  }
}

/** Why no file was made. */
export type UpdateFailure =
  | { kind: 'fetch'; failure: FetchFailure }
  | { kind: 'shell'; refusal: ShellRefusal }
  /** Not a file AgroDesign signed, or no way to check here (`releaseSignature.ts`). */
  | { kind: 'signature'; failure: SignatureFailure }
  /** The Heavy viewer could not write its session. */
  | { kind: 'session'; detail: string }
  /** The copy itself. */
  | { kind: 'make'; detail: string }
  /** The chosen file could not be read. */
  | { kind: 'read'; detail: string }

export type UpdateSource = 'release' | 'file'

/** Where the preparation is. Memory only, while HELP is open. */
export type UpdateStep =
  | { phase: 'idle' }
  /** `received` bytes so far (said in whole MB steps), of `total` when the release lists the file's size. */
  | { phase: 'fetching'; received: number; total: number | null }
  | { phase: 'verifying'; source: UpdateSource }
  | { phase: 'migrating'; source: UpdateSource }
  | { phase: 'ready'; source: UpdateSource; file: PreparedFile; version: string }
  | { phase: 'failed'; source: UpdateSource; why: UpdateFailure }
  | { phase: 'stopped' }

const detailOf = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/\s+/g, ' ').slice(0, 200)

const MiB = 1024 * 1024

/** A file chosen here, as bytes (FileReader: jsdom and old browsers lack `Blob.arrayBuffer`). */
function readFile(file: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(new Uint8Array((r.result as ArrayBuffer) ?? new ArrayBuffer(0)))
    r.onerror = () => reject(r.error ?? new Error('read failed'))
    r.readAsArrayBuffer(file)
  })
}

/** This page's data in `shell`, as the file to save: named by the rule of every HTMLapp file, with the shell's version. */
export async function migrateInto(shell: CheckedShell, src: CopySource, signal: AbortSignal, now: Date = new Date()): Promise<PreparedFile> {
  const moves = movesOf(src)
  const mol3dLook = moves.dmolView && src.dmolLook !== null ? src.dmolLook() : null
  let session: ArrayBuffer | null = null
  if (moves.pymolSession && src.pymolSession !== null) {
    try {
      session = await src.pymolSession(signal)
    } catch (e) {
      throw new MigrateError('session', detailOf(e))
    }
  }
  if (signal.aborted) throw new MigrateError('aborted', '')
  let blob: Blob
  try {
    blob = await makeAppCopy(
      {
        edition: shell.edition,
        doc: src.doc,
        config: src.config,
        lang: src.lang,
        engine: src.engine,
        now,
        keepMol3dSession: moves.dmolView,
        mol3dLook,
        keepPymolSession: moves.pymolSession,
        pymolSession: session,
      },
      document,
      shell,
    )
  } catch (e) {
    throw new MigrateError('make', detailOf(e))
  }
  return { blob, name: `${viewerPackFileStem(src.doc?.stem ?? '', shell.edition, now, shell.version)}.html` }
}

class MigrateError extends Error {
  readonly code: 'session' | 'make' | 'aborted'
  readonly detail: string
  constructor(code: 'session' | 'make' | 'aborted', detail: string) {
    super(`${code}: ${detail}`)
    this.code = code
    this.detail = detail
  }
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>

/**
 * The preparation's state and its actions, for as long as HELP is open.
 * `fromRelease` downloads the release's blank app of this edition (`tag`,
 * `assets` as the check found them); `fromFile` uses one chosen here. One at
 * a time: a press while one runs does nothing. `stop` ends it; closing HELP
 * does too and drops what it would have made.
 */
export function useLatestUpdate(
  src: CopySource | null,
  opts: { fetchImpl?: FetchLike; repoUrl?: string; current?: string; publicKey?: string } = {},
): {
  step: UpdateStep
  fromRelease: (release: { tag: string; assets: readonly ReleaseAsset[] }) => void
  fromFile: (file: File) => void
  stop: () => void
  reset: () => void
} {
  const { fetchImpl, repoUrl = APP_GITHUB_URL, current = APP_VERSION, publicKey = RELEASE_PUBLIC_KEY } = opts
  const [step, setStep] = useState<UpdateStep>({ phase: 'idle' })
  const running = useRef<AbortController | null>(null)
  const srcRef = useRef(src)
  srcRef.current = src
  useEffect(
    () => () => {
      running.current?.abort()
      running.current = null
    },
    [],
  )

  const run = useCallback(
    async (source: UpdateSource, getBytes: (signal: AbortSignal) => Promise<{ ok: true; bytes: Uint8Array } | { ok: false; why: UpdateFailure }>, tag?: string) => {
      const from = srcRef.current
      if (from === null || running.current !== null) return
      const stop = new AbortController()
      running.current = stop
      const { signal } = stop
      const set = (next: UpdateStep) => {
        if (!signal.aborted) setStep(next)
      }
      try {
        const got = await getBytes(signal)
        if (signal.aborted) return
        if (!got.ok) return set({ phase: 'failed', source, why: got.why })
        set({ phase: 'verifying', source })
        // AgroDesign's signature first, on the bytes as they came: nothing of an unsigned file is read further.
        const unsigned = await checkReleaseSignature(got.bytes, publicKey)
        if (signal.aborted) return
        if (unsigned !== null) return set({ phase: 'failed', source, why: { kind: 'signature', failure: unsigned } })
        const html = shellText(got.bytes)
        if (html === null) return set({ phase: 'failed', source, why: { kind: 'shell', refusal: { code: 'too-large' } } })
        const checked = await inspectShell(html, { edition: editionOf(from.config), current, tag })
        if (signal.aborted) return
        if (!checked.ok) return set({ phase: 'failed', source, why: { kind: 'shell', refusal: checked.why } })
        set({ phase: 'migrating', source })
        const file = await migrateInto(checked.shell, from, signal)
        set({ phase: 'ready', source, file, version: checked.shell.version })
      } catch (e) {
        if (signal.aborted || (e instanceof MigrateError && e.code === 'aborted')) return
        set({ phase: 'failed', source, why: e instanceof MigrateError && e.code === 'session' ? { kind: 'session', detail: e.detail } : { kind: 'make', detail: e instanceof MigrateError ? e.detail : detailOf(e) } })
      } finally {
        if (running.current === stop) running.current = null
      }
    },
    [current, publicKey],
  )

  const fromRelease = useCallback(
    (release: { tag: string; assets: readonly ReleaseAsset[] }) => {
      const from = srcRef.current
      if (from === null) return
      const edition = editionOf(from.config)
      const url = latestFileUrl(repoUrl, release.tag, edition)
      const expect = editionAsset(release.assets, edition)
      void run(
        'release',
        async signal => {
          if (url === null) return { ok: false, why: { kind: 'fetch', failure: { kind: 'not-found' } } }
          setStep({ phase: 'fetching', received: 0, total: expect?.size ?? null })
          let shownMb = 0
          const got = await fetchLatestFile(url, {
            signal,
            expect,
            fetchImpl,
            onProgress: (received, total) => {
              // Said in whole MB steps: a live region spoken at every chunk is noise.
              const mb = Math.floor(received / MiB)
              if (mb === shownMb || signal.aborted) return
              shownMb = mb
              setStep({ phase: 'fetching', received, total })
            },
          })
          return got.ok ? { ok: true, bytes: got.bytes } : { ok: false, why: { kind: 'fetch', failure: got.why } }
        },
        release.tag,
      )
    },
    [fetchImpl, repoUrl, run],
  )

  const fromFile = useCallback(
    (file: File) => {
      void run('file', async () => {
        if (file.size > LATEST_MAX_BYTES) return { ok: false, why: { kind: 'shell', refusal: { code: 'too-large' } } }
        setStep({ phase: 'verifying', source: 'file' })
        let bytes: Uint8Array
        try {
          bytes = await readFile(file)
        } catch (e) {
          return { ok: false, why: { kind: 'read', detail: detailOf(e) } }
        }
        return { ok: true, bytes }
      })
    },
    [run],
  )

  const stop = useCallback(() => {
    running.current?.abort()
    running.current = null
    setStep({ phase: 'stopped' })
  }, [])

  const reset = useCallback(() => {
    if (running.current !== null) return
    setStep({ phase: 'idle' })
  }, [])

  return { step, fromRelease, fromFile, stop, reset }
}
