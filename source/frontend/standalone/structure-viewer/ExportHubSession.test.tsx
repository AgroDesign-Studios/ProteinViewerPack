/**
 * 「HTMLappとして出力」 from the page's export: PyMOL's session is offered only
 * while PyMOL shows the page's own document (PT-9552 item 2). After PyMOL
 * refused a file 3Dmol.js still shows, its scene is another structure, and a
 * copy would pair the new structure with the old session.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { gzipSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key} ${JSON.stringify(vars)}` : key), i18n: { language: 'ja' } }),
}))

import { resetModalStackForTests } from '../../src/components/modalStack'
import { blockElement } from '../../src/pages/structure-html-export/standaloneFormat'
import type { PageConfig } from './blocks'
import { ExportHub } from './ExportHub'
import { embeddedDoc, type StructureDoc } from './localFile'
import type { PictureSave } from './pictureSave'
import type { BridgeState, StandalonePymol } from './pymolBridge'
import { captureTemplate, resetTemplateForTests, setRuntimeBlocksForTests } from './selfCopy'

const CONFIG: PageConfig = {
  edition: 'full',
  structureId: 0,
  title: 'x',
  code: null,
  exporterName: null,
  lang: 'ja',
  initialEngine: '3dmol',
  bColumn: 'bfactor',
  exportedAt: '',
  timeZone: null,
  pymolView: null,
  skipped: [],
  runtime: { base: 'https://agdb-standalone.invalid/pymol/x/', handed: [] },
}
const READY = { phase: 'ready', failure: null, busy: null, ui: null, scene: null, lookError: null, generation: 1 } as unknown as BridgeState

const block = (name: string, text: string) => blockElement(name, gzipSync(Buffer.from(text)).toString('base64'), Buffer.byteLength(text))

/** A full page whose runtime is one worker block: the full edition can be copied. */
beforeEach(() => {
  const page = document.implementation.createHTMLDocument('t')
  page.body.innerHTML = `<div id="root"></div>${block('config', '{}')}${block('worker', 'w')}${block('licenses', '[]')}`
  captureTemplate(page)
  document.body.insertAdjacentHTML('beforeend', block('worker', 'w'))
  setRuntimeBlocksForTests(new Map([['worker', null]]))
})

afterEach(() => {
  cleanup()
  resetModalStackForTests()
  resetTemplateForTests()
  document.body.innerHTML = ''
})

function open(doc: StructureDoc, sceneDoc: StructureDoc) {
  const bridge = { exportPse: vi.fn(), viewSize: () => ({ w: 800, h: 600 }), sceneDoc: () => sceneDoc } as unknown as StandalonePymol
  render(
    <ExportHub
      view="app"
      onView={() => undefined}
      full
      gl
      shown="3dmol"
      bridge={bridge}
      py={READY}
      doc={doc}
      fileStem="x"
      dmol={{ current: null }}
      dmolView
      dmolReady
      pymolBlocked={false}
      onSwitchToPymol={() => undefined}
      onMessage={() => undefined}
      pictures={{ saving: false } as unknown as PictureSave}
      config={CONFIG}
    />,
  )
}

describe('ExportHub → 「HTMLappとして出力」: PyMOL’s session (PT-9552 item 2)', () => {
  it('is offered while PyMOL shows the page’s document', () => {
    const doc = embeddedDoc('data_x\n', 'x', 'x')
    open(doc, doc)
    expect(screen.getByRole('switch', { name: 'htmlExport:sa_app_state_pse' })).toHaveAccessibleDescription('htmlExport:sa_app_state_pse_hint')
  })

  it('is not offered while PyMOL shows another structure (it refused the file 3Dmol.js shows)', () => {
    const doc: StructureDoc = { name: 'b.pdb', stem: 'b', ext: 'pdb', bytes: new ArrayBuffer(2), text: 'xx', serial: 3 }
    open(doc, embeddedDoc('data_x\n', 'x', 'x'))
    const pse = screen.getByRole('switch', { name: 'htmlExport:sa_app_state_pse' })
    expect(pse).toHaveAttribute('aria-disabled', 'true')
    expect(pse).toHaveAccessibleDescription('htmlExport:sa_app_state_pse_off')
  })
})
