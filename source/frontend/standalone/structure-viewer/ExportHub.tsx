import type { MutableRefObject } from 'react'

import { PymolExportDialog } from '../../src/pages/pymol-viewer/PymolExportDialog'
import type { PymolExportFrame } from '../../src/pages/pymol-viewer/pymolExportFrame'
import { PymolPseExportDialog } from '../../src/pages/pymol-viewer/PymolPseExportDialog'
import { PymolRayDialog } from '../../src/pages/pymol-viewer/PymolRayDialog'
import { loadRayOptions, raySettings, storeRayOptions } from '../../src/pages/pymol-viewer/pymolRayOptions'
import { AppCopyDialog } from './AppCopyDialog'
import type { PageConfig } from './blocks'
import { ExportDialog } from './ExportDialog'
import { exportItems, type ExportItemId } from './exportItems'
import { formatName, type StructureDoc } from './localFile'
import { Mol3dExportDialog } from './Mol3dExportDialog'
import type { Mol3dHandle } from './Mol3dPane'
import type { PictureSave } from './pictureSave'
import type { BridgeState, StandalonePymol } from './pymolBridge'
import { SHOT_MAX_SIDE, SHOT_MAX_SIDE_TOUCH, ScreenshotDialog } from './ScreenshotDialog'
import { SaveStep } from './SaveStep'

/** PyMOL's own dialogs end in the app's save step (owner 2026-11-17), its back the dialog's form. */
const pymolSaveStep = (file: { blob: Blob; name: string }, back: () => void) => <SaveStep file={file} onBack={back} />

/** What is open: the list of formats, or the form of one (the ray trace's is opened by 「画像出力」). */
export type ExportView = 'chooser' | 'shot' | 'ray' | 'mol' | 'pse' | 'structure' | 'vrml' | 'app' | null

/**
 * A sentence for the page's live regions, kept as its key and values so it
 * follows the language toggle (PT-9133 item 4). A `detail` value is the
 * engine's or the browser's own words, quoted as they came.
 */
export interface PageMessage {
  key: string
  vars?: Record<string, string>
  error: boolean
}

/**
 * The page's one 「エクスポート」 (owner 2026-11-14), both engines: the list
 * of formats (`ExportDialog`), then — for a format with settings — its form,
 * one dialog at a time: PyMOL's own molecule and session dialogs, reused as
 * they are, and the structure-file and VRML form. It also draws PyMOL's own
 * ray-trace form, which the header's 「画像出力」 opens (owner 2026-11-16:
 * the pictures moved there); the page's `pictures` saves its picture, and the
 * form waits while PyMOL saves another (PT-9188 item 2). What happened is
 * said through `onMessage` (the page's live region); each form says its own
 * result inside itself. Where this browser cannot run PyMOL, its formats say
 * so instead of opening a form that would wait for ever (PT-9192 item 3).
 * Every form ends in the save step (`SaveStep`, owner 2026-11-17), PyMOL's
 * through their `saveStep`.
 */
export function ExportHub(props: {
  view: ExportView
  onView: (view: ExportView) => void
  full: boolean
  gl: boolean
  shown: '3dmol' | 'pymol'
  bridge: StandalonePymol | null
  /** PyMOL's state (the page's subscription to `bridge`). */
  py: BridgeState
  doc: StructureDoc
  /** The name stem saved files start with. */
  fileStem: string
  /** The 3Dmol.js pane of the open file, when 3Dmol.js reads it. */
  dmol: MutableRefObject<Mol3dHandle | null>
  /** 3Dmol.js has a pane for the open file (it reads the format). */
  dmolView: boolean
  /** 3Dmol.js itself loaded (its block ran). */
  dmolReady: boolean
  /** 3Dmol.js is still loading (no failure yet). Default false. */
  dmolLoading?: boolean
  /** This browser cannot run PyMOL (the phone mode). */
  pymolBlocked: boolean
  /** The person agreed to switch to PyMOL for a format only PyMOL writes. */
  onSwitchToPymol: () => void
  onMessage: (message: PageMessage) => void
  /** The page's picture saves (`usePictureSave`): the ray-trace form's. */
  pictures: PictureSave
  /** For 「HTMLappとして出力」: the page's config and the language shown. */
  config?: PageConfig
  lang?: 'ja' | 'en'
}) {
  const { view, onView, full, gl, shown, bridge, py, doc, fileStem, dmol, dmolView, dmolReady, dmolLoading = false, pymolBlocked, onSwitchToPymol, onMessage, pictures, config, lang = 'ja' } = props
  const ready = py.phase === 'ready'
  const busy = py.busy
  const close = () => onView(null)

  const pick = (id: ExportItemId, switchFirst: boolean) => {
    if (switchFirst) onSwitchToPymol()
    onView(id)
  }

  if (view === null) return null
  if (view === 'chooser') {
    return (
      <ExportDialog
        items={exportItems({ full, shown, gl, dmolView, dmolReady, dmolLoading, pymolBlocked })}
        structureFormat={formatName(doc.ext)}
        onPick={pick}
        onClose={close}
      />
    )
  }
  if (view === 'app') {
    if (config === undefined) return null
    return (
      <AppCopyDialog
        config={config}
        doc={doc}
        lang={lang}
        engine={shown}
        dmolLook={dmolView && dmolReady ? () => dmol.current?.look() ?? null : null}
        // PyMOL's session only while it shows this document: after PyMOL refused
        // a file 3Dmol.js still shows, its scene is another structure (PT-9552 item 2).
        pymolSession={full && bridge !== null && ready && bridge.sceneDoc() === doc ? signal => bridge.exportPse(signal) : null}
        onClose={close}
        onSaved={(file, bytes, how) =>
          onMessage({ key: how === 'started' ? 'htmlExport:sa_app_started' : 'htmlExport:sa_app_saved', vars: { file, mb: (bytes / (1024 * 1024)).toFixed(1) }, error: false })
        }
      />
    )
  }
  if (view === 'structure' || view === 'vrml') {
    return (
      <Mol3dExportDialog
        kind={view}
        structure={{ bytes: doc.bytes, extension: doc.ext }}
        viewer={() => dmol.current?.vrml() ?? null}
        fileStem={fileStem}
        onClose={close}
      />
    )
  }
  if (view === 'shot') {
    // 「スクリーンショット（PNG）」's form (owner 2026-11-20): the engine on screen's
    // picture at a chosen multiple; PyMOL's with its object panel as it is now.
    const engine = full && shown === 'pymol' && bridge !== null ? 'pymol' : '3dmol'
    const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches
    return (
      <ScreenshotDialog
        engine={engine}
        base={engine === 'pymol' ? (bridge?.viewSize() ?? null) : (dmol.current?.shotSize() ?? null)}
        maxSide={coarse ? SHOT_MAX_SIDE_TOUCH : SHOT_MAX_SIDE}
        panelOpen={engine === 'pymol' && py.objectPanel === true}
        ink={pictures.ink(engine)}
        onFoldPanel={() => void bridge?.setObjectPanel(false).catch(() => undefined)}
        ready={engine === 'pymol' ? ready && !pictures.saving : dmolView && dmolReady}
        onClose={close}
        onCreate={(scale, withInk) => {
          close()
          void pictures.screenshot(engine, scale, withInk)
        }}
      />
    )
  }
  // PyMOL's forms: the light edition never opens one.
  if (bridge === null) return null
  if (view === 'ray') {
    return (
      <PymolRayDialog
        initial={loadRayOptions()}
        view={bridge.viewSize()}
        ready={ready && !pictures.saving}
        onClose={close}
        onCreate={(options, size) => {
          storeRayOptions(options)
          close()
          void pictures.rayTrace({ w: size.w, h: size.h, settings: raySettings(options) })
        }}
      />
    )
  }
  if (view === 'pse') {
    // The same hold-open / withdraw contract as the molecule export below
    // (PT-9127 item 1): Stop only once the save's own request is posted
    // (PT-9232 item 2).
    return (
      <PymolPseExportDialog
        exportPse={bridge.exportPse}
        tellsSent
        ready={ready}
        stoppable={ready && busy !== null && (busy.kind === 'command' || busy.kind === 'export')}
        waiting={ready && busy?.kind === 'load'}
        onStop={() => void bridge.cancel()}
        objectName={fileStem}
        onClose={close}
        onWithdrawn={() => onMessage({ key: 'htmlExport:sa_pymol_pse_withdrawn', error: false })}
        saveStep={pymolSaveStep}
      />
    )
  }
  return (
    <PymolExportDialog
      frame={bridge as unknown as PymolExportFrame}
      tellsSent
      ready={ready}
      stoppable={ready && busy !== null && (busy.kind === 'command' || busy.kind === 'export')}
      waiting={ready && busy?.kind === 'load'}
      objectName={fileStem}
      onClose={close}
      onWithdrawn={() => onMessage({ key: 'htmlExport:sa_pymol_export_withdrawn', error: false })}
      saveStep={pymolSaveStep}
    />
  )
}
