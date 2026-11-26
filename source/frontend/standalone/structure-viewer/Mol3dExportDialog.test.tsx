/**
 * The forms of the offline file's 「エクスポート」 that need no PyMOL (owner
 * 2026-11-14): the structure file as it came, or 3Dmol.js's own VRML of the
 * shapes shown. Save makes the file and
 * turns the dialog to the save step (owner 2026-11-17), which saves it.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const saveTextFile = vi.fn()
vi.mock('../../src/lib/saveTextFile', () => ({ saveTextFile: (...a: unknown[]) => saveTextFile(...a) }))
const saveBlobFile = vi.fn()
vi.mock('../../src/lib/saveBlobFile', () => ({ saveBlobFile: (...a: unknown[]) => saveBlobFile(...a) }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key} ${JSON.stringify(vars)}` : key),
    i18n: { language: 'ja' },
  }),
}))

import { Mol3dExportDialog, type Mol3dExportKind, type VrmlSource } from './Mol3dExportDialog'

const CIF = 'data_1CRN\nloop_\n_atom_site.id\n'
// Not UTF-8 (a Latin-1 é): saved as it came, never decoded and encoded again.
const BYTES = new Uint8Array([...new TextEncoder().encode(CIF), 0xe9, 0x0a]).buffer as ArrayBuffer

beforeEach(() => {
  saveTextFile.mockReset()
  saveBlobFile.mockReset()
})

/** The save step's main button: the browser's default place. */
const saveDefault = async (user: ReturnType<typeof userEvent.setup>) => user.click(await screen.findByRole('button', { name: 'htmlExport:sa_save_default' }))

/** A Blob's bytes, as jsdom reads them (no Blob.arrayBuffer there). */
const bytesOf = (blob: Blob) =>
  new Promise<ArrayBuffer>(resolve => {
    const fr = new FileReader()
    fr.onload = () => resolve(fr.result as ArrayBuffer)
    fr.readAsArrayBuffer(blob)
  })

function open(kind: Mol3dExportKind, viewer: VrmlSource | null) {
  render(<Mol3dExportDialog kind={kind} structure={{ bytes: BYTES, extension: 'cif' }} viewer={() => viewer} fileStem="1CRN" onClose={vi.fn()} />)
  return userEvent.setup()
}

describe('Mol3dExportDialog', () => {
  it('saves the structure file as it came, byte for byte', async () => {
    const user = open('structure', null)
    expect(screen.getByRole('dialog', { name: 'htmlExport:sa_export_structure {"format":"mmCIF"}' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'htmlExport:sa_dmol_export_submit' }))
    // The file is shown with its format and size before anything is saved.
    expect(saveBlobFile).not.toHaveBeenCalled()
    expect(screen.getByText('1CRN.cif')).toBeInTheDocument()
    expect(screen.getByText('mmCIF (.cif)')).toBeInTheDocument()
    await saveDefault(user)
    expect(saveBlobFile).toHaveBeenCalledOnce()
    const [blob, name] = saveBlobFile.mock.calls[0] as [Blob, string]
    expect(name).toBe('1CRN.cif')
    expect(new Uint8Array(await bytesOf(blob))).toEqual(new Uint8Array(BYTES))
    expect(screen.getByRole('status')).toHaveTextContent('htmlExport:sa_save_started {"file":"1CRN.cif"}')
  })

  it('saves the shapes as 3Dmol.js’s VRML and draws the scene again after', async () => {
    const viewer = { exportVRML: vi.fn(() => '#VRML V2.0 utf8\n'), render: vi.fn() }
    const user = open('vrml', viewer)
    expect(screen.getByRole('dialog', { name: 'htmlExport:sa_export_vrml' })).toBeInTheDocument()
    expect(screen.getByText('.wrl')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'htmlExport:sa_dmol_export_submit' }))
    expect(viewer.render).toHaveBeenCalledOnce()
    await saveDefault(user)
    const [blob, name] = saveBlobFile.mock.calls[0] as [Blob, string]
    expect(name).toBe('1CRN.wrl')
    expect(blob.type).toBe('model/vrml;charset=utf-8')
    expect(new TextDecoder().decode(await bytesOf(blob))).toBe('#VRML V2.0 utf8\n')
    expect(saveTextFile).not.toHaveBeenCalled()
  })

  it('says why when there is no 3D view to export, and saves nothing', async () => {
    const user = open('vrml', null)
    await user.click(screen.getByRole('button', { name: 'htmlExport:sa_dmol_export_submit' }))
    expect(saveTextFile).not.toHaveBeenCalled()
    expect(saveBlobFile).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('htmlExport:sa_dmol_export_err')
  })

  it('cleans the name it saves under', async () => {
    const user = open('structure', null)
    const name = screen.getByRole('textbox')
    await user.clear(name)
    await user.type(name, 'a:b')
    await user.click(screen.getByRole('button', { name: 'htmlExport:sa_dmol_export_submit' }))
    await saveDefault(user)
    expect(saveBlobFile.mock.calls[0][1]).toBe('a_b.cif')
  })

  it('「設定に戻る」 brings the name back as it was', async () => {
    const user = open('structure', null)
    const name = screen.getByRole('textbox')
    await user.clear(name)
    await user.type(name, 'mine')
    await user.click(screen.getByRole('button', { name: 'htmlExport:sa_dmol_export_submit' }))
    await user.click(await screen.findByRole('button', { name: 'htmlExport:sa_save_back' }))
    expect(screen.getByRole('textbox')).toHaveValue('mine')
    expect(saveBlobFile).not.toHaveBeenCalled()
  })
})
