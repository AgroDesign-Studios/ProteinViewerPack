import { afterEach, describe, expect, it } from 'vitest'

import {
  aspectDiffers,
  estimateRaySeconds,
  loadRayOptions,
  lockedSide,
  parseRayOptions,
  RAY_DEFAULTS,
  RAY_FIXED_SIZES,
  RAY_MAX_SIDE,
  RAY_QUALITY,
  RAY_RISKY_SECONDS,
  RAY_SLOW_SECONDS,
  rayAdjusted,
  raySettings,
  raySize,
  raySizeProblem,
  scaledSize,
  storeRayOptions,
  withQuality,
} from './pymolRayOptions'

afterEach(() => window.localStorage.clear())

describe('the ray size (owner 2026-11-16: concrete pixels, common sizes, width and height)', () => {
  const view = { w: 800, h: 600 }

  it('is a multiple of the view, a common size, or a width and height of one’s own', () => {
    expect(raySize({ ...RAY_DEFAULTS, size: 1 }, view)).toEqual({ w: 800, h: 600 })
    expect(raySize({ ...RAY_DEFAULTS, size: 3 }, view)).toEqual({ w: 2400, h: 1800 })
    expect(raySize({ ...RAY_DEFAULTS, size: 'fhd' }, view)).toEqual({ w: 1920, h: 1080 })
    expect(raySize({ ...RAY_DEFAULTS, size: 'print' }, view)).toEqual({ w: 2400, h: 1800 })
    expect(raySize({ ...RAY_DEFAULTS, size: 'uhd' }, view)).toEqual({ w: 3840, h: 2160 })
    expect(raySize({ ...RAY_DEFAULTS, size: 'custom', width: 1000, height: 300 }, view)).toEqual({ w: 1000, h: 300 })
    expect(scaledSize(2, view)).toEqual({ w: 1600, h: 1200 })
  })

  it('the common sizes are all within the limit, and named sizes need no measured view', () => {
    for (const s of Object.values(RAY_FIXED_SIZES)) expect(raySizeProblem(s)).toBeNull()
    expect(raySize({ ...RAY_DEFAULTS, size: 'uhd' }, null)).toEqual({ w: 3840, h: 2160 })
    expect(raySize({ ...RAY_DEFAULTS, size: 'custom', width: 640, height: 480 }, null)).toEqual({ w: 640, h: 480 })
  })

  it('a multiple is unknown before the view is laid out', () => {
    expect(raySize(RAY_DEFAULTS, null)).toBeNull()
    expect(raySize(RAY_DEFAULTS, { w: 0, h: 600 })).toBeNull()
    expect(scaledSize(1, null)).toBeNull()
    expect(raySizeProblem(null)).toBe('unmeasured')
  })

  it('is refused past the worker’s clamp rather than made smaller', () => {
    const big = raySize({ ...RAY_DEFAULTS, size: 3 }, { w: 1600, h: 900 })
    expect(big).toEqual({ w: 4800, h: 2700 })
    expect(raySizeProblem(big)).toBe('too-large')
    expect(raySizeProblem({ w: RAY_MAX_SIDE, h: RAY_MAX_SIDE })).toBeNull()
  })

  it('keeps the view’s aspect for one side typed, and says when a size frames another part of the scene', () => {
    expect(lockedSide(1000, 'w', view)).toBe(750)
    expect(lockedSide(750, 'h', view)).toBe(1000)
    expect(aspectDiffers({ w: 1600, h: 1200 }, view)).toBe(false)
    expect(aspectDiffers({ w: 1920, h: 1080 }, view)).toBe(true)
    expect(aspectDiffers({ w: 1920, h: 1080 }, null)).toBe(false)
  })
})

describe('the quality (owner 2026-11-16: 通常品質 / 高品質, apart from the size)', () => {
  it('sets antialiasing, shadows and dpi, and leaves the size alone', () => {
    const normal = withQuality({ ...RAY_DEFAULTS, size: 3 }, 'normal')
    expect(normal).toMatchObject({ size: 3, quality: 'normal', antialias: 0, shadows: false, dpi: 150 })
    expect(withQuality(normal, 'high')).toMatchObject({ size: 3, quality: 'high', antialias: 2, shadows: true, dpi: 300 })
    expect(RAY_DEFAULTS).toMatchObject({ quality: 'high', ...RAY_QUALITY.high })
  })

  it('says when the details no longer match the quality chosen', () => {
    expect(rayAdjusted(RAY_DEFAULTS)).toBe(false)
    expect(rayAdjusted({ ...RAY_DEFAULTS, shadows: false })).toBe(true)
    expect(rayAdjusted({ ...RAY_DEFAULTS, transparent: true })).toBe(false)
  })
})

describe('the ray settings', () => {
  it('asks every choice, opaque unless asked, with two-sided lighting', () => {
    expect(raySettings(RAY_DEFAULTS)).toEqual({
      ray_trace_mode: 0,
      antialias: 2,
      ray_shadows: 1,
      ray_opaque_background: 1,
      two_sided_lighting: 1,
      image_dots_per_inch: 300,
    })
    expect(raySettings({ ...RAY_DEFAULTS, mode: 2, shadows: false, transparent: true, dpi: 600 })).toMatchObject({
      ray_trace_mode: 2,
      ray_shadows: 0,
      ray_opaque_background: 0,
      image_dots_per_inch: 600,
    })
  })
})

describe('the kept choice', () => {
  it('round-trips through storage', () => {
    const o = { ...withQuality(RAY_DEFAULTS, 'normal'), size: 'custom' as const, width: 2000, height: 900, lock: false }
    storeRayOptions(o)
    expect(loadRayOptions()).toEqual(o)
  })

  it('falls back field by field on anything stored that is not a choice', () => {
    expect(parseRayOptions(null)).toEqual(RAY_DEFAULTS)
    expect(parseRayOptions('{')).toEqual(RAY_DEFAULTS)
    expect(parseRayOptions('[]')).toEqual(RAY_DEFAULTS)
    expect(parseRayOptions(JSON.stringify({ size: 9, width: 99999, height: 0, dpi: 1, mode: '1', antialias: 4, shadows: 'yes', transparent: true, quality: 'x' }))).toEqual({
      ...RAY_DEFAULTS,
      transparent: true,
    })
  })

  it('reads a choice stored before 2026-11-16 as the same size, its quality the nearer one', () => {
    // The old 「プレビュー」: the view's size, no antialiasing, no shadows.
    expect(parseRayOptions(JSON.stringify({ scale: 1, width: 1600, dpi: 150, mode: 0, antialias: 0, shadows: false, transparent: false }))).toMatchObject({
      size: 1,
      quality: 'normal',
      antialias: 0,
      shadows: false,
    })
    // A width of one's own: a size of one's own whose height follows the view.
    expect(parseRayOptions(JSON.stringify({ scale: 'width', width: 2000, dpi: 300, mode: 0, antialias: 1, shadows: true, transparent: false }))).toMatchObject({
      size: 'custom',
      width: 2000,
      height: 1500,
      lock: true,
      quality: 'high',
      antialias: 1,
    })
  })
})

describe('the ray time estimate (PT-8372 item 1)', () => {
  it('matches the slow end of the measured 4096 x 4096 ray at antialias 1 with shadows', () => {
    expect(estimateRaySeconds({ antialias: 1, shadows: true }, { w: 4096, h: 4096 })).toBeCloseTo(141, -1)
  })

  it('puts the largest high-quality ray past the risky line and a view-sized one under the slow line', () => {
    const big = estimateRaySeconds({ antialias: 2, shadows: true }, { w: 4096, h: 4096 })
    expect(big).toBeGreaterThan(RAY_RISKY_SECONDS)
    expect(big).toBeLessThan(600)
    expect(estimateRaySeconds({ antialias: 2, shadows: true }, { w: 1600, h: 1200 })).toBeLessThan(RAY_SLOW_SECONDS)
  })

  it('takes less time for less antialiasing and no shadows', () => {
    const s = { w: 2000, h: 2000 }
    expect(estimateRaySeconds({ antialias: 0, shadows: true }, s)).toBeLessThan(estimateRaySeconds({ antialias: 1, shadows: true }, s))
    expect(estimateRaySeconds({ antialias: 1, shadows: false }, s)).toBeLessThan(estimateRaySeconds({ antialias: 1, shadows: true }, s))
  })
})
