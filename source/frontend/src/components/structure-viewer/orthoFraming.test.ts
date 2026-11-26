/**
 * orthoFraming — the orthographic camera framed like the perspective one.
 *
 * These drive the INSTALLED 3Dmol's own `GLViewer.prototype.setSlabAndFog`
 * against a hand-built `this`, rather than a model of it: the defect being
 * corrected is a formula inside the library, and a re-typed copy of that formula
 * would keep passing whatever a future 3dmol did (package.json pins a caret
 * range). The first case pins the defect itself, so an upgrade that fixes or
 * moves it fails here instead of being corrected twice.
 */
import { describe, expect, it, vi } from 'vitest'

import { installOrthoFraming } from './orthoFraming'

const FOV = 20
const CAMERA_Z = 150

const tanDeg = (deg: number): number => Math.tan((Math.PI / 180) * deg)

/** The real 3Dmol bundle, which registers `window.$3Dmol`. */
async function library(): Promise<{ GLViewer: { prototype: object } }> {
  const umd = '3dmol/build/3Dmol.js' // a variable, so tsc does not look for a .d.ts
  await import(/* @vite-ignore */ umd)
  return (window as unknown as { $3Dmol: { GLViewer: { prototype: object } } }).$3Dmol
}

/**
 * A `GLViewer` carrying exactly the fields `setSlabAndFog` reads, `centre` Å from
 * its rotation centre. The camera records the extents it held each time 3Dmol
 * (or the correction) rebuilt its projection matrix.
 */
async function makeViewer({ aspect = 1, ortho = true, centre = 100 } = {}) {
  const lib = await library()
  const atUpdate: Array<{ top: number; right: number }> = []
  const camera = {
    ortho,
    fov: FOV,
    aspect,
    position: { z: CAMERA_Z },
    near: 1,
    far: 1000,
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    updateProjectionMatrix: vi.fn(() => { atUpdate.push({ top: camera.top, right: camera.right }) }),
  }
  // Through `unknown`: the prototype's `setSlabAndFog` is invisible to the type
  // system (it lives on the library's class, typed `private`).
  const viewer = Object.assign(Object.create(lib.GLViewer.prototype) as object, {
    camera,
    rotationGroup: { position: { z: CAMERA_Z - centre } },
    fov: FOV,
    ASPECT: aspect,
    slabNear: -50,
    slabFar: 50,
    fogStart: 0.4,
    fogEnd: 1,
    scene: { fog: { near: 0, far: 0 } },
    config: {},
  }) as unknown as { setSlabAndFog(): void; rotationGroup: { position: { z: number } } }
  return { viewer, camera, atUpdate }
}

describe('the installed 3Dmol, uncorrected', () => {
  it('frames orthographic on the canvas width and the full angle', async () => {
    // The defect this module exists for. Perspective is 2*centre*tan(fov/2)
    // tall at the rotation centre; 3Dmol's orthographic camera is
    // centre*tan(fov) WIDE — so on a square canvas the molecule drops to 48% of
    // its perspective size. If this fails, 3Dmol changed the formula: re-measure
    // before trusting the correction below.
    const { viewer, camera } = await makeViewer({ aspect: 1 })
    viewer.setSlabAndFog()
    expect(camera.right).toBeCloseTo(100 * tanDeg(FOV), 9)
    expect(camera.top).toBeCloseTo(camera.right / 1, 9)
    expect(camera.top / (100 * tanDeg(FOV / 2))).toBeCloseTo(tanDeg(FOV) / tanDeg(FOV / 2), 9)
  })
})

describe('installOrthoFraming', () => {
  it('frames orthographic like perspective, whatever the canvas shape', async () => {
    for (const aspect of [1, 4 / 3, 1.8, 2.5]) {
      const { viewer, camera, atUpdate } = await makeViewer({ aspect })
      expect(installOrthoFraming(viewer)).toBe(true)
      viewer.setSlabAndFog()
      const halfHeight = 100 * tanDeg(FOV / 2)
      expect(camera.top).toBeCloseTo(halfHeight, 9)
      expect(camera.bottom).toBeCloseTo(-halfHeight, 9)
      expect(camera.right).toBeCloseTo(halfHeight * aspect, 9)
      expect(camera.left).toBeCloseTo(-halfHeight * aspect, 9)
      // The matrix is rebuilt AFTER the extents are corrected — otherwise the
      // GPU would still draw 3Dmol's framing until the next call.
      expect(atUpdate[atUpdate.length - 1]).toEqual({ top: camera.top, right: camera.right })
    }
  })

  it('follows the zoom, because it keeps no state of its own', async () => {
    const { viewer, camera } = await makeViewer({ aspect: 1.5, centre: 100 })
    installOrthoFraming(viewer)
    viewer.setSlabAndFog()
    viewer.rotationGroup.position.z = CAMERA_Z - 40 // zoomed in to 40 Å
    viewer.setSlabAndFog()
    expect(camera.top).toBeCloseTo(40 * tanDeg(FOV / 2), 9)
  })

  it('applies 3Dmol’s own one-unit floor on the camera distance', async () => {
    const { viewer, camera } = await makeViewer({ centre: 0.25 })
    installOrthoFraming(viewer)
    viewer.setSlabAndFog()
    expect(camera.top).toBeCloseTo(1 * tanDeg(FOV / 2), 9)
  })

  it('leaves a perspective camera exactly as 3Dmol framed it', async () => {
    const plain = await makeViewer({ ortho: false, aspect: 1.3 })
    const framed = await makeViewer({ ortho: false, aspect: 1.3 })
    installOrthoFraming(framed.viewer)
    plain.viewer.setSlabAndFog()
    framed.viewer.setSlabAndFog()
    expect(framed.camera.top).toBe(plain.camera.top)
    expect(framed.camera.right).toBe(plain.camera.right)
    expect(framed.camera.updateProjectionMatrix).toHaveBeenCalledTimes(1)
  })

  it('wraps a viewer once, however often it is installed', async () => {
    // An effect re-run against the same instance (StrictMode) must not wrap the
    // wrapper: 3Dmol's own rebuild plus ONE correction per call.
    const { viewer, camera } = await makeViewer({ aspect: 1 })
    installOrthoFraming(viewer)
    const wrapped = viewer.setSlabAndFog
    expect(installOrthoFraming(viewer)).toBe(true)
    expect(viewer.setSlabAndFog).toBe(wrapped)
    viewer.setSlabAndFog()
    expect(camera.updateProjectionMatrix).toHaveBeenCalledTimes(2)
  })

  it('keeps 3Dmol’s extents rather than writing a NaN one', async () => {
    // A NaN extent blanks the canvas with nothing on screen to say why.
    const { viewer, camera } = await makeViewer({ aspect: Number.NaN })
    installOrthoFraming(viewer)
    viewer.setSlabAndFog()
    expect(camera.right).toBeCloseTo(100 * tanDeg(FOV), 9)
  })

  it('does nothing to a viewer without the private shape it relies on', () => {
    // A 3Dmol release that renames any of these must degrade to the shrinking
    // view, not take the viewer down.
    expect(installOrthoFraming(null)).toBe(false)
    expect(installOrthoFraming({})).toBe(false)
    const recorder = { setSlabAndFog: vi.fn(), setProjection: vi.fn(), render: vi.fn() }
    expect(installOrthoFraming(recorder)).toBe(false)
    expect(installOrthoFraming({ ...recorder, camera: {}, rotationGroup: { position: { z: 0 } } })).toBe(false)
  })
})
