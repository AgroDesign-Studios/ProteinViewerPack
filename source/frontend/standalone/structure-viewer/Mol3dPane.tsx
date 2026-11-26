import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import Mol3dToolbar, { CONTROL_AVAILABLE, type VisibilityKey } from '../../src/components/structure-viewer/Mol3dToolbar'
import ViewerAnnotationLayer from '../../src/components/structure-viewer/ViewerAnnotationLayer'
import { compositeAnnotation, staleCaptureNote } from '../../src/components/structure-viewer/compositeScreenshot'
import { resolveInkPalette } from '../../src/components/structure-viewer/inkPalette'
import { safeModelText } from '../../src/components/structure-viewer/safeModelText'
import {
  VIEW_STYLES_DEFAULT,
  applyResidueHighlight,
  applySceneStyles,
  toggleViewStyle,
  type SurfaceHandle,
  type ViewStyle,
} from '../../src/components/structure-viewer/sceneStyles'
import { SURFACE_TYPE_DEFAULT, type SurfaceTypeKey } from '../../src/components/structure-viewer/surfaceType'
import { useDepthCue } from '../../src/components/structure-viewer/useDepthCue'
import { RESIDUE_HIGHLIGHT_COLOR, useResiduePicking } from '../../src/components/structure-viewer/useResiduePicking'
import { useViewerAnnotation } from '../../src/components/structure-viewer/useViewerAnnotation'
import { getColorOption, type ColorScheme } from '../../src/components/structure-viewer/viewerColorScheme'
import { healViewer, retireViewer } from '../../src/components/structure-viewer/viewerRecovery'
import type { PymolLook } from '../../src/pages/pymol-viewer/pymolLook'
import { freeze3dmolLook, type Mol3dLook } from '../../src/pages/structure-html-export/mol3dLook'
import { applyMol3dLook, applyPymolLookTo3dmol, bgOfLook, view3dFromPymol } from './exportedLook3d'
import { dmolPngUri, dmolShotSize } from './dmolShot'
import { markHetero } from './localFile'
import type { VrmlSource } from './Mol3dExportDialog'
import type { PreparedFile } from './saveFile'
import { probe } from './probe'
import { useTouchOriginal } from './touchControls'
import { attachTwoFingerPan } from './twoFingerPan'
import type { InkNow } from './pymolInk'

/* eslint-disable @typescript-eslint/no-explicit-any -- 3Dmol.js has no types here */

/** What the file opened with: the exported display, or AgDB's own scene once a toolbar control changed it. */
type SceneMode = 'exported' | 'agdb'

/** What the page's 「エクスポート」 asks of this pane (`ExportHub`). */
export interface Mol3dHandle {
  /**
   * The view as a PNG with the pen's strokes in it, and the name to save it
   * under; the save step saves it (owner 2026-11-17). `scale` (owner
   * 2026-11-20, 「スクリーンショット」's resolution): that many times the
   * canvas's pixels on a side, the same composition (`dmolShot.ts`).
   */
  pngFile: (scale?: number, withInk?: boolean) => Promise<PreparedFile>
  /** The pen's lines now (「描画した線を含める」 shows only with some). */
  ink: () => InkNow
  /** The canvas's size now, device px (「画面と同じ」); null before the viewer is built. */
  shotSize: () => { w: number; h: number } | null
  /** The viewer, for its VRML; null until it is built. */
  vrml: () => VrmlSource | null
  /** The phone's zoom buttons: closer, further, everything in view. */
  zoom: (how: 'in' | 'out' | 'fit') => void
  /**
   * The view now, frozen (orientation, background, styles, colours,
   * surfaces), for a copy of the app to open with (owner 2026-11-16); null
   * before the viewer is built or when 3Dmol.js cannot freeze it.
   */
  look: () => Mol3dLook | null
}

/** The viewer's look now, or null (no viewer yet, or 3Dmol.js not loaded). */
function frozenLook(viewer: any): Mol3dLook | null {
  if (viewer === null || viewer === undefined) return null
  try {
    return freeze3dmolLook(viewer)
  } catch {
    return null
  }
}

/** How much one press of the phone's zoom buttons scales the view. */
const ZOOM_STEP = 1.25

/**
 * Everything in view, centred. 3Dmol.js fits the structure to the view's
 * height, so in a view taller than it is wide — a phone held upright — the
 * structure ran off both sides (headless Chrome at 390 px, 2026-11-14): it
 * is zoomed out by the width-to-height ratio there.
 */
function fitView(viewer: any, el: HTMLElement | null): void {
  viewer.zoomTo()
  fitWidth(viewer, el)
}

/**
 * In a view taller than it is wide, zooms out by the width-to-height ratio:
 * after `zoomTo`, and after a saved camera (the exported view, made on a
 * wider screen) is restored, whose orientation it keeps (PT-9193 item 2).
 * Once per camera: the view this pane keeps for Reset is taken after the fit
 * and restored without another. An exported 3Dmol.js camera holds no width
 * fit (it was fitted to the height only); a PyMOL camera saved in a
 * view taller than wide may, and is then shown smaller than it needs to be,
 * never cut off — the file does not carry the exporting view's shape, so
 * this pane cannot tell (PT-9228 item 5, kept as a limit).
 */
function fitWidth(viewer: any, el: HTMLElement | null): void {
  const r = el?.getBoundingClientRect()
  if (r !== undefined && r.width > 0 && r.height > r.width) viewer.zoom(r.width / r.height)
}

/** The data URI `pngURI()` / `compositeAnnotation` give, as a Blob (no fetch: the page's CSP has none). */
function dataUriBlob(uri: string): Blob {
  const comma = uri.indexOf(',')
  const bin = atob(uri.slice(comma + 1))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return new Blob([out], { type: 'image/png' })
}

/**
 * The file's 3Dmol.js pane: the shared toolbar (`Mol3dToolbar`, the card's
 * layout) over a local 3Dmol viewer, with the shared scene code —
 * `applySceneStyles`, the surface controller, depth cue and section, the pen
 * and eraser, measurement, colour schemes, spin and background — and nothing
 * that needs a server: the toolbar's server-only controls are left out
 * (owner 2026-11-14), and so is its 「📷 Screenshot」 (owner
 * 2026-11-16): the header's 「画像出力」 saves this pane's PNG, a local
 * download, and 「エクスポート」 (`ExportHub`) its VRML, both through
 * `handleRef`.
 *
 * The file opens on the display it was exported with (`exportedLook3d.ts`),
 * its background included; the first toolbar change that restyles the
 * structure switches to AgDB's scene, and 「初期表示」 — first on the Style
 * row, left of 「スタイル」 (owner 2026-11-15) — goes back. A look that does not fit the structure is not offered: the pane keeps AgDB's
 * scene (PT-9109 items 3, 4). A file 3Dmol.js cannot read leaves the pane
 * empty and says why on the page's alert line (`onError`), never a dead
 * page (PT-9132 item 1).
 *
 * Docked (the phone mode) the toolbar is drawn in
 * `toolsHost` — the 「表示」 sheet — while it is open, and nowhere while it
 * is not: the view keeps the screen. Their state is this pane's, so closing
 * the sheet loses none of it. 3Dmol.js's own touch handling turns, pinches
 * and moves the view.
 */
export function Mol3dPane(props: {
  /**
   * The structure as text and the 3Dmol.js format it is read as (the
   * embedded mmCIF, or a file opened from this computer or from RCSB; the
   * page remounts this pane for each new one).
   */
  structure: { text: string; format: string }
  mol3d: Mol3dLook | null
  pymol: PymolLook | null
  /** The 18-number PyMOL view of the export, used when there is no 3Dmol look. */
  pymolView: number[] | null
  fileStem: string
  /** 3Dmol.js has run (its block) and the pane is laid out. */
  libReady: boolean
  /** Shown: a hidden pane keeps its size, but its viewer is resized when it shows. */
  shown: boolean
  onStatus: (key: string | null, vars?: Record<string, string>) => void
  /** A refusal said on the page's alert line (a file 3Dmol.js could not read). */
  onError: (key: string, vars: Record<string, string>) => void
  /** Filled while the pane is mounted: what the page's export asks of it. */
  handleRef: MutableRefObject<Mol3dHandle | null>
  /** The phone mode: the controls live in `toolsHost`, not above the view. */
  docked?: boolean
  /** The open 「表示」 sheet's slot for the controls, or null (closed, or the other engine's). */
  toolsHost?: HTMLElement | null
}) {
  const { structure, mol3d, pymol, pymolView, fileStem, libReady, shown, onStatus, onError, handleRef, docked = false, toolsHost = null } = props
  const { t } = useTranslation(['htmlExport', 'proteindb', 'pymol'])
  /** 3Dmol.js could not read the structure: nothing more is drawn or restyled. */
  const unreadable = useRef(false)
  /** The structure as one model, or null when 3Dmol.js throws on it (said once on the alert line). */
  const addStructure = (viewer: any): any => {
    if (unreadable.current) return null
    try {
      // The embedded structure too: an exported file reaches its readers here (PT-9131).
      const model = viewer.addModel(safeModelText(structure.text, structure.format), structure.format)
      // 3Dmol.js's MOL2 reader sets no hetflag, which the scene's styles select on.
      if (structure.format === 'mol2') markHetero(model.selectedAtoms({}))
      return model
    } catch (e) {
      unreadable.current = true
      onError('htmlExport:sa_dmol_unreadable', { detail: (e instanceof Error ? e.message : String(e)).slice(0, 200) })
      probe.errors.push(`3dmol addModel: ${String(e)}`)
      return null
    }
  }
  const models = (m: any): any[] => (m === null ? [] : [m])
  const mountRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<any>(null)
  const modelsRef = useRef<any[]>([])
  const exportedViewRef = useRef<unknown>(null)
  const [viewerEpoch, setViewerEpoch] = useState(0)
  const [mode, setMode] = useState<SceneMode>(mol3d !== null || pymol !== null ? 'exported' : 'agdb')
  /** The exported display can be drawn: false once it was found not to fit (the button goes). */
  const [lookFits, setLookFits] = useState(true)
  const hasLook = (mol3d !== null || pymol !== null) && lookFits
  /** The background the file was exported with: the toolbar starts there, not on white (PT-9109 item 4). */
  const exportedBg = bgOfLook(mol3d, pymol)
  const [viewStyles, setViewStyles] = useState<readonly ViewStyle[]>(VIEW_STYLES_DEFAULT)
  const [colorScheme, setColorScheme] = useState<ColorScheme>('spectrum')
  const [bgColor, setBgColor] = useState<string>(exportedBg)
  const [showProtein, setShowProtein] = useState(true)
  const [showLigands, setShowLigands] = useState(true)
  const [showWater, setShowWater] = useState(false)
  const [showSurface, setShowSurface] = useState(false)
  const [surfaceOpaque, setSurfaceOpaque] = useState(false)
  const [surfaceType, setSurfaceType] = useState<SurfaceTypeKey>(SURFACE_TYPE_DEFAULT)
  const [spinning, setSpinning] = useState(false)
  const [measureMode, setMeasureMode] = useState(false)
  const [surface, setSurface] = useState<SurfaceHandle | null>(null)
  const [selectedResidue, setSelectedResidue] = useState<{ chain: string; resi: number } | null>(null)
  const measurePointsRef = useRef<{ x: number; y: number; z: number }[]>([])
  const annotation = useViewerAnnotation()
  const depth = useDepthCue({ viewerInstanceRef: viewerRef, viewerEpoch, surface, surfaceOpaque, densityShown: false })

  /** AgDB's scene, from the toolbar's state (`applySceneStyles`). */
  const applyAgdbScene = useCallback(
    (viewer: any, opts: { skipSurface?: boolean } = {}) => {
      applySceneStyles(
        viewer,
        {
          viewStyles,
          colorOption: getColorOption(colorScheme, null),
          base: null,
          showProtein,
          showLigands,
          showWater,
          showSurface,
          surfaceOpaque,
          surfaceType,
        },
        { skipSurface: opts.skipSurface, onSurface: setSurface },
      )
      applyResidueHighlight(viewer, selectedResidue, RESIDUE_HIGHLIGHT_COLOR)
    },
    [viewStyles, colorScheme, showProtein, showLigands, showWater, showSurface, surfaceOpaque, surfaceType, selectedResidue],
  )

  /** The exported display, on fresh models (a PyMOL look brings its own objects). */
  const applyExported = useCallback(
    (viewer: any): 'mol3d' | 'pymol' | 'mismatch' | 'mismatch-pymol' | 'none' => {
      for (const m of modelsRef.current) viewer.removeModel(m)
      viewer.removeAllSurfaces()
      modelsRef.current = []
      setSurface(null)
      if (mol3d !== null) {
        const model = addStructure(viewer)
        modelsRef.current = models(model)
        if (model === null) return 'none'
        return applyMol3dLook(viewer, model, mol3d) ? 'mol3d' : 'mismatch'
      }
      if (pymol !== null) {
        let looks: any[] = []
        try {
          looks = applyPymolLookTo3dmol(viewer, pymol)
        } catch (e) {
          // A look object 3Dmol.js cannot read: the structure as it is, in AgDB's scene.
          probe.errors.push(`3dmol look: ${String(e)}`)
          viewer.removeAllModels()
          return 'mismatch-pymol'
        }
        if (looks.length > 0) {
          modelsRef.current = looks
          return 'pymol'
        }
      }
      modelsRef.current = models(addStructure(viewer))
      return 'none'
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `structure` is fixed for the pane's life (remounted per file)
    [mol3d, pymol],
  )

  // Build the viewer once 3Dmol.js has run.
  useEffect(() => {
    if (!libReady || !mountRef.current) return
    const $3Dmol = (window as any).$3Dmol
    const viewer = $3Dmol.createViewer(mountRef.current, { backgroundColor: 'white', defaultcolors: $3Dmol.rasmolElementColors })
    viewerRef.current = viewer
    let how: ReturnType<typeof applyExported> = 'none'
    if (hasLook) {
      how = applyExported(viewer)
      if (how === 'mismatch' || how === 'mismatch-pymol') {
        onStatus('htmlExport:sa_status_look_mismatch')
        setMode('agdb')
        setLookFits(false)
        // The structure alone, on white: the look's background goes with the look.
        if (how === 'mismatch-pymol') modelsRef.current = models(addStructure(viewer))
        setBgColor('white')
        viewer.setBackgroundColor('white')
      }
    } else {
      modelsRef.current = models(addStructure(viewer))
    }
    if (how !== 'mol3d' && how !== 'pymol') applyAgdbScene(viewer)
    fitView(viewer, mountRef.current)
    let saved: unknown = null
    if (how === 'mol3d' && mol3d !== null && mol3d.view.length >= 8) saved = mol3d.view
    else saved = view3dFromPymol(how === 'pymol' && pymol !== null ? pymol.view : pymolView)
    if (saved !== null) {
      viewer.setView(saved)
      // The saved camera replaced the fit: the phone's width again.
      fitWidth(viewer, mountRef.current)
    }
    viewer.render()
    exportedViewRef.current = viewer.getView()
    setViewerEpoch(e => e + 1)
    probe.dmol = 'shown'
    return () => {
      retireViewer(viewerRef.current, mountRef.current)
      viewerRef.current = null
      depth.onViewerCleared()
    }
    // Built once: the structure and its looks never change in this file.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libReady])

  // A lost WebGL context, looked for every 2 s and regenerated in place (`viewerRecovery.ts`).
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible' && viewerRef.current) healViewer(viewerRef.current, mountRef.current)
    }, 2000)
    return () => clearInterval(timer)
  }, [])

  // A restyle: AgDB's scene, once the toolbar has changed it.
  useEffect(() => {
    const v = viewerRef.current
    if (!v || mode !== 'agdb') return
    applyAgdbScene(v)
    v.render()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, viewStyles, colorScheme, showProtein, showLigands, showWater, showSurface, surfaceOpaque, surfaceType])
  useEffect(() => {
    const v = viewerRef.current
    if (!v || mode !== 'agdb') return
    applyAgdbScene(v, { skipSurface: true })
    v.render()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedResidue])
  useEffect(() => {
    const v = viewerRef.current
    if (!v || viewerEpoch === 0) return
    v.setBackgroundColor(bgColor)
    v.render()
  }, [bgColor, viewerEpoch])
  useEffect(() => {
    const v = viewerRef.current
    if (!v) return
    if (spinning) {
      v.spin('y')
      annotation.markStale()
    } else v.spin(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spinning])
  useEffect(() => {
    const v = viewerRef.current
    if (!v || !shown) return
    v.resize()
    v.render()
  }, [shown])

  /** A toolbar change that restyles the structure: from here on AgDB's scene draws it. */
  const restyle = (change: () => void) => {
    if (mode === 'exported') {
      const v = viewerRef.current
      if (v) {
        // The exported look's models go; the structure comes back as one model.
        for (const m of modelsRef.current) v.removeModel(m)
        v.removeAllSurfaces()
        modelsRef.current = models(addStructure(v))
      }
      setMode('agdb')
    }
    change()
  }

  const backToExported = () => {
    const v = viewerRef.current
    if (!v) return
    setSelectedResidue(null)
    // The toolbar shows what draws: the exported display is none of its
    // choices, so they go back to AgDB's defaults (the next change starts there).
    setViewStyles(VIEW_STYLES_DEFAULT)
    setColorScheme('spectrum')
    setShowProtein(true)
    setShowLigands(true)
    setShowWater(false)
    setShowSurface(false)
    setSurfaceOpaque(false)
    setSurfaceType(SURFACE_TYPE_DEFAULT)
    setBgColor(exportedBg)
    const how = applyExported(v)
    if (how === 'mol3d' || how === 'pymol') setMode('exported')
    else {
      // The look no longer fits (it was checked at the start): AgDB's scene stays (PT-9109 item 3).
      if (how === 'mismatch-pymol') modelsRef.current = models(addStructure(v))
      setLookFits(false)
      setMode('agdb')
      applyAgdbScene(v)
    }
    if (exportedViewRef.current !== null) v.setView(exportedViewRef.current)
    v.render()
    setViewerEpoch(e => e + 1)
  }

  /** Everything in view: the camera moved, so ink drawn before it no longer matches (PT-9194 item 6). */
  const fitAll = () => {
    const v = viewerRef.current
    if (!v) return
    fitView(v, mountRef.current)
    v.render()
    annotation.markStale()
  }

  const zoom = (how: 'in' | 'out' | 'fit') => {
    const v = viewerRef.current
    if (!v) return
    if (how === 'fit') {
      fitAll()
      return
    }
    v.zoom(how === 'in' ? ZOOM_STEP : 1 / ZOOM_STEP)
    v.render()
    annotation.markStale()
  }

  const handlePickResidue = useCallback((chain: string, resi: number) => {
    setSelectedResidue(prev => (prev && prev.chain === chain && prev.resi === resi ? null : { chain, resi }))
  }, [])
  const handleMeasurePick = useCallback((atom: any) => {
    const v = viewerRef.current
    if (!v) return
    const pts = measurePointsRef.current
    pts.push({ x: atom.x, y: atom.y, z: atom.z })
    if (pts.length === 2) {
      const dx = pts[1].x - pts[0].x
      const dy = pts[1].y - pts[0].y
      const dz = pts[1].z - pts[0].z
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
      const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2, z: (pts[0].z + pts[1].z) / 2 }
      v.addLabel(`${dist.toFixed(2)} Å`, { position: mid, fontSize: 12, fontColor: 'yellow', backgroundColor: 'black', backgroundOpacity: 0.6 })
      v.addCylinder({ start: pts[0], end: pts[1], radius: 0.05, color: 'yellow', dashed: true })
      v.render()
      measurePointsRef.current = []
    }
  }, [])
  useResiduePicking({
    viewerRef,
    viewerEpoch,
    modelsKey: mode,
    // A pick highlights a residue only in AgDB's scene; the exported display is left as it was.
    mode: measureMode ? 'measure' : 'residue',
    onPickResidue: mode === 'agdb' ? handlePickResidue : () => undefined,
    onPickAtom: handleMeasurePick,
  })

  const toggleMeasure = () => {
    measurePointsRef.current = []
    setMeasureMode(m => !m)
    annotation.setTool('none')
  }

  /** The view, with the pen's strokes unless `withInk` is false, as one PNG, and the name to save it under. */
  const screenshot = async (scale = 1, withInk = true): Promise<PreparedFile> => {
    const v = viewerRef.current
    if (!v) throw new Error(t('htmlExport:sa_dmol_export_no_view'))
    const stage = stageRef.current?.getBoundingClientRect()
    const composited = await compositeAnnotation(
      dmolPngUri(v, scale),
      withInk ? annotation.strokes : [],
      resolveInkPalette(stageRef.current),
      { width: stage?.width ?? 0, height: stage?.height ?? 0 },
      staleCaptureNote(withInk && annotation.stale, stageRef.current, t('proteindb:viewer_ink_stale_capture')),
    )
    return { blob: dataUriBlob(composited), name: `${fileStem}_3dmol${scale > 1 ? `_x${scale}` : ''}.png` }
  }
  // Two fingers move the view (owner 2026-11-17), unless this browser chose 3Dmol.js's own controls.
  const touchOriginal = useTouchOriginal().original
  useEffect(() => {
    const el = mountRef.current
    if (touchOriginal || el === null) return
    return attachTwoFingerPan(el, () => viewerRef.current)
  }, [touchOriginal])
  // The page's export reaches this pane's picture and VRML through the handle; the
  // latest closures each render, nothing once the pane is gone.
  useEffect(() => {
    handleRef.current = {
      pngFile: screenshot,
      ink: () => ({ lines: annotation.strokes.length, stale: annotation.stale }),
      shotSize: () => dmolShotSize(viewerRef.current),
      vrml: () => viewerRef.current,
      zoom,
      look: () => frozenLook(viewerRef.current),
    }
  })
  useEffect(
    () => () => {
      handleRef.current = null
    },
    [handleRef],
  )

  // What both layouts' toolbars show and do: the phone's sheet draws the card's rows, a computer one row.
  const shared = {
    // 「初期表示」 left of 「スタイル」 (owner 2026-11-15), in both layouts.
    leading: hasLook ? (
      <button type="button" className="btn btn-secondary btn-sm" onClick={backToExported} aria-pressed={mode === 'exported'}>
        {t('htmlExport:sa_view_exported')}
      </button>
    ) : undefined,
    // The swatches say what they set, 「背景」 (owner 2026-11-16).
    bgLabel: t('htmlExport:sa_dmol_bg_label'),
    viewStyles,
    onToggleViewStyle: (s: ViewStyle) => restyle(() => setViewStyles(cur => toggleViewStyle(cur, s))),
    colorScheme,
    onColorScheme: (c: ColorScheme) => restyle(() => setColorScheme(c)),
    visibility: { protein: showProtein, ligands: showLigands, water: showWater, spin: spinning },
    onToggleVisibility: (key: VisibilityKey) => {
      if (key === 'spin') setSpinning(s => !s)
      else if (key === 'protein') restyle(() => setShowProtein(s => !s))
      else if (key === 'ligands') restyle(() => setShowLigands(s => !s))
      else restyle(() => setShowWater(s => !s))
    },
    surface: { shown: showSurface, opaque: surfaceOpaque, opaqueSuppressed: false, type: surfaceType },
    onToggleSurface: () => restyle(() => setShowSurface(s => !s)),
    onToggleSurfaceOpaque: () => restyle(() => setSurfaceOpaque(o => !o)),
    onSurfaceType: (k: SurfaceTypeKey) => restyle(() => setSurfaceType(k)),
    annotation,
    depthCue: {
      value: depth.cue,
      onChange: depth.setCue,
      onCommit: depth.commit,
      onCancelGesture: depth.cancelGesture,
      committed: depth.persistedCue,
      spanA: depth.spanA,
      capAvailable: mode === 'agdb' && showSurface,
      densityShown: false,
    },
    measureMode,
    onToggleMeasure: toggleMeasure,
    bgColor,
    onBgColor: setBgColor,
    // The bar has no 📷 (the header saves); the card is told so by `hideScreenshot`.
    screenshot: CONTROL_AVAILABLE,
    onScreenshot: () => undefined,
  }
  const residueText =
    selectedResidue === null ? '' : t('proteindb:viewer_selected_residue', { chain: selectedResidue.chain, resi: String(selectedResidue.resi) })
  const controls = (
    <>
      {/* No 「全体表示」 above the toolbar (owner 2026-11-16), and so no row of
          its own for the residue picked: the view says it, in both layouts (below). */}
      {docked ? (
        <Mol3dToolbar
          variant="card"
          {...shared}
          // The licence tab of HELP names 3Dmol.js and links to it (owner 2026-11-16).
          includes3dmol={false}
          // The header's 「画像出力」 saves the picture (owner 2026-11-16).
          hideScreenshot
          // Never drawn (`hideScreenshot`): the header saves through `handleRef`.
          screenshot={CONTROL_AVAILABLE}
          onScreenshot={() => undefined}
          savingScreenshot={false}
          activeLigand={null}
          onResetLigandView={() => undefined}
        />
      ) : (
        // A computer: one row, the rest in drop-downs over the view (owner 2026-11-19:
        // 「分子ビューワー部分を最大限確保できるようなメニュー」).
        <Mol3dToolbar variant="bar" {...shared} />
      )}
    </>
  )

  return (
    <div className="sav-pane-body">
      {docked ? toolsHost !== null && createPortal(controls, toolsHost) : controls}
      <div ref={stageRef} className={`sv3d sv3d-stage sav-dmol-stage sv3d-cursor-${annotation.cursorMode}`}>
        <div ref={mountRef} className="sav-dmol" aria-label={t('htmlExport:sa_canvas_dmol')} role="img" />
        <ViewerAnnotationLayer stageRef={stageRef} annotation={annotation} cameraMoving={spinning} />
        {/* The residue picked, said over the view (PT-9193 item 1): on a phone
            the controls are in the closed 「表示」 sheet, and on a computer the
            row above the toolbar that said it is gone with its 「全体表示」
            (owner 2026-11-16). Always mounted: a live region announces what fills it. */}
        <p role="status" className="sav-stage-readout">
          {residueText}
        </p>
      </div>
    </div>
  )
}
