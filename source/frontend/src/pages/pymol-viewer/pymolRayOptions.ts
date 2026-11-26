/**
 * The ray-trace settings the 「レイトレース画像作成」 dialog offers (owner
 * 2026-11-09: 「PyMOLがレイトレースのパラメーターを変更することができるので
 * あれば…変更設定ができるように」), the size they give, the PyMOL command
 * that applies them, and the user's last choice kept in this browser.
 *
 * The size (owner 2026-11-16: 「具体的な解像度を併記…一般的な大きさの解像度
 * （絶対値）も２～３…直接入力は幅だけではなく、縦も」; UI dual consult,
 * Opus + Codex astra): a multiple of the view on screen (its aspect, so the
 * picture frames what the user sees), one of three common sizes, or a
 * width and a height of the user's own, the height following the view's
 * aspect while `lock` is on. A size of another aspect than the view's is
 * drawn by PyMOL at that size: what it frames differs from the screen. The
 * worker clamps each side to 4096 px; the page refuses anything larger
 * before it asks, so the user is told instead of getting a smaller picture
 * than they chose.
 *
 * The quality (owner 2026-11-16: 「『通常品質』『高品質』とトグルスイッチ」)
 * sets antialiasing, shadows and dpi together, apart from the size: the old
 * 「論文用」 preset also doubled the size, so a switch would have changed the
 * size too. The details stay adjustable; `rayAdjusted` says when they no
 * longer match the quality chosen.
 */

import type { RaySettings } from './pymolFrameProtocol'

export const RAY_MAX_SIDE = 4096
export const RAY_DPI_CHOICES = [72, 150, 300, 600] as const
export type RayDpi = (typeof RAY_DPI_CHOICES)[number]
/** PyMOL's `ray_trace_mode`: 0 normal, 1 normal with black outline, 2 outline only, 3 quantized colour with outline. */
export type RayMode = 0 | 1 | 2 | 3
export type RayAntialias = 0 | 1 | 2

/** The view's own size times 1, 2 or 3. */
export type RayScale = 1 | 2 | 3
/** The common sizes: Full HD, a 4:3 print size (20 x 15 cm at 300 dpi), 4K. */
export type RayFixed = 'fhd' | 'print' | 'uhd'
export type RaySizeChoice = RayScale | RayFixed | 'custom'

export const RAY_SCALES: readonly RayScale[] = [1, 2, 3]
export const RAY_FIXED: readonly RayFixed[] = ['fhd', 'print', 'uhd']
export const RAY_FIXED_SIZES: Readonly<Record<RayFixed, { w: number; h: number }>> = {
  fhd: { w: 1920, h: 1080 },
  print: { w: 2400, h: 1800 },
  uhd: { w: 3840, h: 2160 },
}

export type RayQuality = 'normal' | 'high'

export interface RayOptions {
  size: RaySizeChoice
  /** The width and height asked for when `size` is `'custom'`. */
  width: number
  height: number
  /** `'custom'`: the height follows the width (and the width the height) in the view's aspect. */
  lock: boolean
  quality: RayQuality
  dpi: RayDpi
  mode: RayMode
  antialias: RayAntialias
  shadows: boolean
  transparent: boolean
}

/** What each quality sets: normal is quick (no antialiasing, no shadows), high is for print. */
export const RAY_QUALITY: Readonly<Record<RayQuality, Pick<RayOptions, 'dpi' | 'mode' | 'antialias' | 'shadows'>>> = {
  normal: { dpi: 150, mode: 0, antialias: 0, shadows: false },
  high: { dpi: 300, mode: 0, antialias: 2, shadows: true },
}

export const RAY_DEFAULTS: RayOptions = {
  size: 1,
  width: 1600,
  height: 1200,
  lock: true,
  quality: 'high',
  ...RAY_QUALITY.high,
  transparent: false,
}

/** `o` with `quality` and the details it sets. */
export function withQuality(o: RayOptions, quality: RayQuality): RayOptions {
  return { ...o, quality, ...RAY_QUALITY[quality] }
}

/** The details no longer match the quality chosen (changed in 「詳細設定」). */
export function rayAdjusted(o: RayOptions): boolean {
  const q = RAY_QUALITY[o.quality]
  return o.dpi !== q.dpi || o.mode !== q.mode || o.antialias !== q.antialias || o.shadows !== q.shadows
}

const isScale = (s: RaySizeChoice): s is RayScale => s === 1 || s === 2 || s === 3

/**
 * The picture's size in pixels, `view` being the view's size in device
 * pixels or null while it is not measured. A multiple of the view needs it
 * (null without); the common sizes and the user's own do not. Never below
 * 1 px a side; it may be over `RAY_MAX_SIDE` (`raySizeProblem` says so).
 */
export function raySize(o: RayOptions, view: { w: number; h: number } | null): { w: number; h: number } | null {
  if (isScale(o.size)) {
    if (view === null || !(view.w >= 1) || !(view.h >= 1)) return null
    return { w: Math.max(1, Math.round(view.w * o.size)), h: Math.max(1, Math.round(view.h * o.size)) }
  }
  if (o.size === 'custom') return { w: Math.max(1, Math.round(o.width)), h: Math.max(1, Math.round(o.height)) }
  return { ...RAY_FIXED_SIZES[o.size] }
}

/** The view's size times `scale`, for the label beside each multiple; null while the view is not measured. */
export function scaledSize(scale: RayScale, view: { w: number; h: number } | null): { w: number; h: number } | null {
  return raySize({ ...RAY_DEFAULTS, size: scale }, view)
}

/** The other side of a size kept in the view's aspect: the height for a width, or the width for a height. */
export function lockedSide(given: number, side: 'w' | 'h', view: { w: number; h: number }): number {
  return Math.max(1, Math.round(side === 'w' ? (given * view.h) / view.w : (given * view.w) / view.h))
}

/** `size`'s aspect differs from the view's by more than 1 %: PyMOL frames another part of the scene. */
export function aspectDiffers(size: { w: number; h: number }, view: { w: number; h: number } | null): boolean {
  if (view === null || !(view.w >= 1) || !(view.h >= 1)) return false
  return Math.abs(size.w / size.h / (view.w / view.h) - 1) > 0.01
}

/**
 * A rough guess of a ray's time in seconds, so the dialog can warn before a
 * ray that may not finish (PT-8372 item 1): the frame gives a ray 10 minutes
 * (`EXPORT_PNG_RAY_TIMEOUT_MS`), and past them it rebuilds PyMOL from its last
 * snapshot. Measured 2026-11-09 in headless Chrome with antialias 1 and
 * shadows: 1600 x 1200 took 6-18 s and 4096 x 4096 111-141 s, about 8.4 s a
 * megapixel at the slow end. Antialias 0 and 2 are taken as a quarter and
 * 2.25 times that (PyMOL draws 1x, 2x and 3x the pixels a side), and no
 * shadows as 0.7 of it. A slower computer takes longer, which is why the
 * warnings start well under the limit.
 */
export function estimateRaySeconds(o: Pick<RayOptions, 'antialias' | 'shadows'>, size: { w: number; h: number }): number {
  const aa = o.antialias === 0 ? 0.25 : o.antialias === 2 ? 2.25 : 1
  return ((size.w * size.h) / 1e6) * 8.4 * aa * (o.shadows ? 1 : 0.7)
}

/** Over this many estimated seconds the dialog says the ray takes minutes. */
export const RAY_SLOW_SECONDS = 120
/** Over this many the dialog says it may pass the 10-minute limit. */
export const RAY_RISKY_SECONDS = 300

export function raySizeProblem(size: { w: number; h: number } | null): 'unmeasured' | 'too-large' | null {
  if (size === null) return 'unmeasured'
  return size.w > RAY_MAX_SIDE || size.h > RAY_MAX_SIDE ? 'too-large' : null
}

/**
 * The PyMOL settings `o` asks of the ray. The worker sets them for the ray
 * alone and puts the scene's own values back in the same task (PT-8382), so a
 * ray changes nothing in the scene, its snapshot or a later saved session.
 * `two_sided_lighting` is on for the ray: without it the inside of a helix
 * comes out black (measured 2026-11-09).
 */
export function raySettings(o: RayOptions): RaySettings {
  return {
    ray_trace_mode: o.mode,
    antialias: o.antialias,
    ray_shadows: o.shadows ? 1 : 0,
    ray_opaque_background: o.transparent ? 0 : 1,
    two_sided_lighting: 1,
    image_dots_per_inch: o.dpi,
  }
}

const STORAGE_KEY = 'agdb.pymol.rayOptions'

const oneOf = <T>(v: unknown, choices: readonly T[]): v is T => choices.includes(v as T)
const side = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= RAY_MAX_SIDE ? v : null)

/**
 * A stored value as options, or the defaults for anything else. A choice
 * stored before 2026-11-16 (`scale` 1-3 or `'width'`, no quality) is read as
 * the same size — a width of one's own becomes a size of one's own whose
 * height follows the view — and the quality nearer its details.
 */
export function parseRayOptions(raw: string | null): RayOptions {
  if (raw === null) return RAY_DEFAULTS
  let v: unknown
  try {
    v = JSON.parse(raw)
  } catch {
    return RAY_DEFAULTS
  }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return RAY_DEFAULTS
  const o = v as Record<string, unknown>
  const width = side(o.width) ?? RAY_DEFAULTS.width
  const sizeChoices: readonly RaySizeChoice[] = [...RAY_SCALES, ...RAY_FIXED, 'custom']
  const size: RaySizeChoice = oneOf(o.size, sizeChoices) ? o.size : oneOf(o.scale, RAY_SCALES) ? o.scale : o.scale === 'width' ? 'custom' : RAY_DEFAULTS.size
  const antialias = oneOf(o.antialias, [0, 1, 2] as const) ? o.antialias : RAY_DEFAULTS.antialias
  const shadows = typeof o.shadows === 'boolean' ? o.shadows : RAY_DEFAULTS.shadows
  const quality: RayQuality = oneOf(o.quality, ['normal', 'high'] as const) ? o.quality : antialias === 0 && !shadows ? 'normal' : 'high'
  return {
    size,
    width,
    height: side(o.height) ?? Math.max(1, Math.round((width * 3) / 4)),
    lock: typeof o.lock === 'boolean' ? o.lock : true,
    quality,
    dpi: oneOf(o.dpi, RAY_DPI_CHOICES) ? o.dpi : RAY_DEFAULTS.dpi,
    mode: oneOf(o.mode, [0, 1, 2, 3] as const) ? o.mode : RAY_DEFAULTS.mode,
    antialias,
    shadows,
    transparent: typeof o.transparent === 'boolean' ? o.transparent : RAY_DEFAULTS.transparent,
  }
}

/** The user's last choice in this browser; the defaults when storage is unavailable. */
export function loadRayOptions(): RayOptions {
  try {
    return parseRayOptions(window.localStorage.getItem(STORAGE_KEY))
  } catch {
    return RAY_DEFAULTS
  }
}

export function storeRayOptions(o: RayOptions): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(o))
  } catch {
    // A private window or blocked storage: the choice is simply not kept.
  }
}
