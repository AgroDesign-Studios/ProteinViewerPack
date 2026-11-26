import { describe, expect, it, vi } from 'vitest'

import { exportVrmlKeepingScene, type VrmlSource } from './vrmlExport'

/**
 * A stand-in for 3Dmol.js 2.5.5's GLViewer around `exportVRML`
 * (`build/3Dmol.es6.js` 25009-25018): the export swaps `modelGroup` for a
 * throwaway group and renders into it, which re-points every surface's
 * `lastGL` and every shape's `renderedShapeObj` at the throwaway meshes; it
 * puts the group back only when it returns. WebGL itself is not available
 * under jsdom, so the fake does exactly those pointer moves.
 */
function fakeViewer(opts: { throws?: boolean } = {}) {
  const live = { name: 'live' }
  const liveSurface = { name: 'live surface mesh' }
  const liveShape = { name: 'live shape mesh' }
  const surface = { lastGL: liveSurface as unknown }
  const shape = { renderedShapeObj: liveShape as unknown }
  const renders: Array<Record<string, unknown> | undefined> = []
  const viewer = {
    modelGroup: live as unknown,
    surfaces: { 0: [surface] },
    shapes: [shape, null],
    renderer: { supportedExtensions: () => ({ supportsAIA: true }) },
    render: vi.fn((_cb?: unknown, exts?: Record<string, unknown>) => {
      renders.push(exts)
    }),
    exportVRML: vi.fn(() => {
      const saved = viewer.modelGroup
      viewer.modelGroup = { name: 'throwaway' }
      surface.lastGL = { name: 'throwaway surface mesh' }
      shape.renderedShapeObj = { name: 'throwaway shape mesh' }
      if (opts.throws) throw new Error('out of memory')
      viewer.modelGroup = saved
      return '#VRML V2.0 utf8\n'
    }),
  }
  return { viewer, live, liveSurface, liveShape, surface, shape, renders }
}

describe('exportVrmlKeepingScene', () => {
  it('returns the VRML, points the scene back at the live meshes, and redraws them with regen', () => {
    const f = fakeViewer()
    expect(exportVrmlKeepingScene(f.viewer as unknown as VrmlSource)).toBe('#VRML V2.0 utf8\n')
    expect(f.viewer.modelGroup).toBe(f.live)
    expect(f.surface.lastGL).toBe(f.liveSurface)
    expect(f.shape.renderedShapeObj).toBe(f.liveShape)
    expect(f.renders).toEqual([{ supportsAIA: true, regen: true }])
  })

  it('puts the live group back and redraws when the export throws, so the pane is not left blank (PT-9126 item 1)', () => {
    const f = fakeViewer({ throws: true })
    expect(() => exportVrmlKeepingScene(f.viewer as unknown as VrmlSource)).toThrow('out of memory')
    expect(f.viewer.modelGroup).toBe(f.live)
    expect(f.surface.lastGL).toBe(f.liveSurface)
    expect(f.shape.renderedShapeObj).toBe(f.liveShape)
    expect(f.renders).toHaveLength(1)
  })

  it('still exports and redraws a viewer without those internals', () => {
    const plain = { exportVRML: vi.fn(() => 'x'), render: vi.fn() }
    expect(exportVrmlKeepingScene(plain)).toBe('x')
    expect(plain.render).toHaveBeenCalledOnce()
  })
})
