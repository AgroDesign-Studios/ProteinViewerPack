import { useState, type MutableRefObject } from 'react'
import { useTranslation } from 'react-i18next'

import type { raySettings } from '../../src/pages/pymol-viewer/pymolRayOptions'
import type { PageMessage } from './ExportHub'
import type { Mol3dHandle } from './Mol3dPane'
import type { StandalonePymol } from './pymolBridge'
import type { InkNow, PymolInkHandle } from './pymolInk'
import type { PreparedFile } from './saveFile'

const pad2 = (n: number) => String(n).padStart(2, '0')
const stamp = (d: Date) => `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`

/** A ray trace's size and PyMOL settings, as the ray-trace form gives them. */
export interface RayRequest {
  w: number
  h: number
  settings: ReturnType<typeof raySettings>
}

/** The page's picture saves: 「画像出力」's two entries and the ray-trace form behind one of them. */
export interface PictureSave {
  /** PyMOL is making a picture this page asked for: no second one meanwhile (PT-9188 item 2). */
  saving: boolean
  /**
   * The engine on screen's view as a PNG, `scale` (1–4, default 1) times its
   * pixels on a side, the pen's lines in it unless `withInk` is false
   * (「スクリーンショット」's form).
   */
  screenshot: (engine: '3dmol' | 'pymol', scale?: number, withInk?: boolean) => Promise<void>
  /** The pen's lines over an engine's view now; null when that engine has no pane. */
  ink: (engine: '3dmol' | 'pymol') => InkNow | null
  /** PyMOL's ray trace at the size and settings the form chose. */
  rayTrace: (ray: RayRequest) => Promise<void>
  /** The picture made, waiting in the page's save step; null when none waits. */
  made: PreparedFile | null
  /** The save step closed: the picture it held is let go. */
  dismiss: () => void
}

/**
 * The pictures the page makes (owner 2026-11-16: 「画像出力」 beside
 * 「エクスポート」): 3Dmol.js's from its pane (`Mol3dHandle.pngFile`, the
 * pen's strokes in it), PyMOL's — plain or ray traced — from the bridge,
 * named after the file (and, PyMOL's, the time). A picture made is held in
 * `made` for the page's save step (`SaveDialog`, owner 2026-11-17), which
 * saves it where the person chooses; a failure is said through `onMessage`
 * (the page's live regions). Held by the page, which stays mounted, so the
 * making state outlives the panel and the form.
 */
export function usePictureSave(opts: {
  bridge: StandalonePymol | null
  /** The name stem saved files start with. */
  fileStem: string
  /** The 3Dmol.js pane of the open file, when 3Dmol.js reads it. */
  dmol: MutableRefObject<Mol3dHandle | null>
  /** The pen over PyMOL's view, while its pane is mounted. */
  pymolInk?: MutableRefObject<PymolInkHandle | null>
  onMessage: (message: PageMessage) => void
}): PictureSave {
  const { bridge, fileStem, dmol, pymolInk, onMessage } = opts
  const { t } = useTranslation(['htmlExport', 'pymol'])
  const [saving, setSaving] = useState(false)
  const [made, setMade] = useState<PreparedFile | null>(null)

  const pymolPng = async (ray: RayRequest | null, scale = 1, withInk = false) => {
    if (bridge === null || saving) return
    setSaving(true)
    try {
      // The pen's lines, on a screenshot asked to have them (a ray trace is a picture of its own
      // size: none), as they are when it is asked for: a line drawn or erased while PyMOL makes
      // the picture changes nothing in it. Left out, it is said, never silently (UI consult,
      // Codex astra; PR #10244's review) — the pane gone meanwhile included.
      const wanted = withInk && ray === null
      const pen = wanted ? (pymolInk?.current ?? null) : null
      const taken = pen?.take() ?? null
      const r = await bridge.exportPng(ray !== null ? { ray: true, w: ray.w, h: ray.h, settings: ray.settings } : scale > 1 ? { ray: false, scale } : { ray: false })
      let bytes = r.bytes
      if (taken !== null) {
        const out = await taken.onto(r.bytes, { w: r.w, h: r.h })
        bytes = out.png
        if (out.left !== null) onMessage({ key: 'htmlExport:sa_shot_ink_left_out', error: true })
      } else if (wanted && pen === null) onMessage({ key: 'htmlExport:sa_shot_ink_left_out', error: true })
      // A larger screenshot says its multiple in its name, as the save step says its pixels.
      const name = `${fileStem}_pymol${ray ? '_ray' : scale > 1 ? `_x${scale}` : ''}_${stamp(new Date())}.png`
      setMade({ blob: new Blob([bytes], { type: 'image/png' }), name, detail: t('htmlExport:sa_save_px', { w: String(r.w), h: String(r.h) }) })
    } catch (e) {
      onMessage({ key: 'htmlExport:sa_pymol_png_err', vars: { detail: e instanceof Error ? e.message.slice(0, 200) : String(e) }, error: true })
    } finally {
      setSaving(false)
    }
  }

  const dmolPng = async (scale: number, withInk: boolean) => {
    try {
      const handle = dmol.current
      if (handle === null) throw new Error(t('htmlExport:sa_dmol_export_no_view'))
      setMade(await handle.pngFile(scale, withInk))
    } catch (e) {
      onMessage({ key: 'htmlExport:sa_dmol_export_err', vars: { detail: (e instanceof Error ? e.message : String(e)).slice(0, 200) }, error: true })
    }
  }

  return {
    saving,
    screenshot: (engine, scale = 1, withInk = true) => (engine === 'pymol' && bridge !== null ? pymolPng(null, scale, withInk) : dmolPng(scale, withInk)),
    ink: engine => (engine === 'pymol' ? (pymolInk?.current?.ink() ?? null) : (dmol.current?.ink() ?? null)),
    rayTrace: ray => pymolPng(ray),
    made,
    dismiss: () => setMade(null),
  }
}
