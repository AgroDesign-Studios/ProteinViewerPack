/**
 * What `ExportHub` hands each form: PyMOL's two save forms offer Stop only
 * while a command or an export runs and wait while a load runs, their Stop
 * cancels PyMOL's request and a withdrawn save is said on the page's line;
 * 「HTMLappとして出力」 says the size it saved in MB, offers 3Dmol.js's look
 * only while 3Dmol.js has a pane, and draws nothing without the page's config;
 * the light edition opens no PyMOL form. The forms are stand-ins that keep
 * the props they were given; their own tests cover them.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { resetModalStackForTests } from '../../src/components/modalStack'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'ja' } }),
}))

/** The props each stand-in form was last drawn with. */
const seen: Record<string, any> = {} // eslint-disable-line @typescript-eslint/no-explicit-any -- the forms' props, read back

vi.mock('../../src/pages/pymol-viewer/PymolExportDialog', () => ({
  PymolExportDialog: (p: unknown) => {
    seen.mol = p
    return <div role="dialog" aria-label="mol-form" />
  },
}))
vi.mock('../../src/pages/pymol-viewer/PymolPseExportDialog', () => ({
  PymolPseExportDialog: (p: unknown) => {
    seen.pse = p
    return <div role="dialog" aria-label="pse-form" />
  },
}))
vi.mock('./AppCopyDialog', () => ({
  AppCopyDialog: (p: unknown) => {
    seen.app = p
    return <div role="dialog" aria-label="app-form" />
  },
}))

import type { PymolBusy } from '../../src/pages/pymol-viewer/pymolBusy'
import type { PageConfig } from './blocks'
import { ExportHub, type ExportView } from './ExportHub'
import { embeddedDoc } from './localFile'
import type { Mol3dHandle } from './Mol3dPane'
import type { PictureSave } from './pictureSave'
import type { BridgeState, StandalonePymol } from './pymolBridge'

const READY = { phase: 'ready', failure: null, busy: null, ui: null, scene: null, lookError: null, generation: 1 } as unknown as BridgeState
const busy = (kind: PymolBusy['kind']): PymolBusy => ({ kind, label: null, startedAt: 0, queued: 0 }) as PymolBusy
const doc = embeddedDoc('data_x\n', 'x', 'x.cif')

function hub(over: { view: ExportView; py?: BridgeState; bridge?: StandalonePymol | null; config?: PageConfig; dmol?: Mol3dHandle | null; dmolView?: boolean; dmolReady?: boolean }) {
  const onMessage = vi.fn()
  const bridge =
    over.bridge === undefined ? ({ cancel: vi.fn(async () => true), exportPse: vi.fn(), requestExport: vi.fn(), viewSize: () => ({ w: 8, h: 6 }), sceneDoc: () => doc } as unknown as StandalonePymol) : over.bridge
  const view = render(
    <ExportHub
      view={over.view}
      onView={() => undefined}
      full
      gl
      shown="pymol"
      bridge={bridge}
      py={over.py ?? READY}
      doc={doc}
      fileStem="x"
      dmol={{ current: over.dmol ?? null }}
      dmolView={over.dmolView ?? true}
      dmolReady={over.dmolReady ?? true}
      pymolBlocked={false}
      onSwitchToPymol={() => undefined}
      onMessage={onMessage}
      pictures={{ saving: false } as unknown as PictureSave}
      config={over.config}
    />,
  )
  return { ...view, onMessage, bridge }
}

afterEach(() => {
  cleanup()
  resetModalStackForTests()
  for (const k of Object.keys(seen)) delete seen[k]
})

describe('ExportHub — PyMOL’s save forms', () => {
  it.each([
    ['mol', 'mol'],
    ['pse', 'pse'],
  ] as const)('the %s form offers Stop only for a command or an export, and waits for a load', (view, key) => {
    const cases: [PymolBusy | null, boolean, boolean][] = [
      [null, false, false],
      [busy('command'), true, false],
      [busy('export'), true, false],
      [busy('load'), false, true],
    ]
    for (const [b, stoppable, waiting] of cases) {
      const { unmount } = hub({ view, py: { ...READY, busy: b } })
      expect([seen[key].stoppable, seen[key].waiting]).toEqual([stoppable, waiting])
      unmount()
    }
    // Not ready: neither, whatever runs.
    hub({ view, py: { ...READY, phase: 'loading', busy: busy('command') } as BridgeState })
    expect([seen[key].ready, seen[key].stoppable, seen[key].waiting]).toEqual([false, false, false])
  })

  it('Stop cancels PyMOL’s request, and a withdrawn save is said on the page’s line', () => {
    const { bridge, onMessage, unmount } = hub({ view: 'pse' })
    seen.pse.onStop()
    expect(bridge!.cancel).toHaveBeenCalledTimes(1)
    seen.pse.onWithdrawn()
    expect(onMessage).toHaveBeenLastCalledWith({ key: 'htmlExport:sa_pymol_pse_withdrawn', error: false })
    unmount()

    const mol = hub({ view: 'mol' })
    // The molecule form stops through the bridge it is handed as its frame.
    expect(seen.mol.frame).toBe(mol.bridge)
    seen.mol.onWithdrawn()
    expect(mol.onMessage).toHaveBeenLastCalledWith({ key: 'htmlExport:sa_pymol_export_withdrawn', error: false })
  })

  it('both end in the save step, whose back returns to the form', () => {
    hub({ view: 'mol' })
    const back = vi.fn()
    render(seen.mol.saveStep({ blob: new Blob(['x']), name: 'x.cif' }, back))
    fireEvent.click(screen.getByRole('button', { name: 'htmlExport:sa_save_back' }))
    expect(back).toHaveBeenCalledTimes(1)
  })

  it('the light edition opens no PyMOL form', () => {
    for (const view of ['mol', 'pse', 'ray'] as const) {
      const { container, unmount } = hub({ view, bridge: null })
      expect(container).toBeEmptyDOMElement()
      unmount()
    }
    expect(seen.mol).toBeUndefined()
    expect(seen.pse).toBeUndefined()
  })
})

describe('ExportHub — 「HTMLappとして出力」', () => {
  const config = { edition: 'full' } as unknown as PageConfig

  it('draws nothing without the page’s config', () => {
    const { container } = hub({ view: 'app' })
    expect(container).toBeEmptyDOMElement()
    expect(seen.app).toBeUndefined()
  })

  it('says the copy it started or saved, its size in MB to one place', () => {
    const { onMessage } = hub({ view: 'app', config })
    seen.app.onSaved('x.html', 3 * 1024 * 1024 + 200 * 1024, 'started')
    expect(onMessage).toHaveBeenLastCalledWith({ key: 'htmlExport:sa_app_started', vars: { file: 'x.html', mb: '3.2' }, error: false })
    seen.app.onSaved('x.html', 512 * 1024, 'saved')
    expect(onMessage).toHaveBeenLastCalledWith({ key: 'htmlExport:sa_app_saved', vars: { file: 'x.html', mb: '0.5' }, error: false })
  })

  it('offers 3Dmol.js’s look only while 3Dmol.js has a pane for the file', () => {
    const look = { v: 1 }
    const dmol = { look: () => look } as unknown as Mol3dHandle
    const { unmount } = hub({ view: 'app', config, dmol })
    expect(seen.app.dmolLook()).toBe(look)
    unmount()
    hub({ view: 'app', config, dmol, dmolReady: false })
    expect(seen.app.dmolLook).toBeNull()
  })

  it('a look asked for once the pane is gone is none', () => {
    hub({ view: 'app', config, dmol: null })
    expect(seen.app.dmolLook()).toBeNull()
  })
})
