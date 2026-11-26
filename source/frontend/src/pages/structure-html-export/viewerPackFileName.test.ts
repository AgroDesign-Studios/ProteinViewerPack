/**
 * The HTMLapp file's name (owner 2026-11-16):
 * `<stem>_AgroDesign-ProteinViewerPack-v<version>_<edition>_<yyyyMMdd>.html`,
 * the same rule wherever the file is made; a typed name keeps, a pasted
 * `.html` is not doubled.
 */
import { describe, expect, it } from 'vitest'

import { APP_VERSION } from '../../../standalone/structure-viewer/appLicence'
import { FILE_STEM_MAX } from '../pymol-viewer/pymolExport'
import { typedPackFileStem, viewerPackFileStem } from './viewerPackFileName'

const at = new Date(2026, 10, 16, 23, 59)

describe('viewerPackFileStem', () => {
  it('is the stem, the product, its version, the edition and the local date', () => {
    expect(viewerPackFileStem('1CRN', 'full', at)).toBe(`1CRN_AgroDesign-ProteinViewerPack-v${APP_VERSION}_full_20261116`)
    expect(viewerPackFileStem('structure-7', 'light', new Date(2026, 0, 5, 0, 1))).toBe(
      `structure-7_AgroDesign-ProteinViewerPack-v${APP_VERSION}_light_20260105`,
    )
  })

  it('keeps the dots of the version, and no build commit is in it', () => {
    expect(viewerPackFileStem('1CRN', 'full', at, '1.0.0')).toBe('1CRN_AgroDesign-ProteinViewerPack-v1.0.0_full_20261116')
    expect(viewerPackFileStem('x', 'light', at, '12.3.45')).toContain('-v12.3.45_light_')
  })

  it('has no stem part when there is no structure', () => {
    expect(viewerPackFileStem('', 'full', at, '1.0.0')).toBe('AgroDesign-ProteinViewerPack-v1.0.0_full_20261116')
    expect(viewerPackFileStem(' .. ', 'full', at, '1.0.0')).toBe('AgroDesign-ProteinViewerPack-v1.0.0_full_20261116')
  })

  it('cuts a long stem, never the version, edition or date, and stays within the limit', () => {
    const long = 'A'.repeat(300)
    const name = viewerPackFileStem(long, 'light', at, '1.0.0')
    expect(name.length).toBeLessThanOrEqual(FILE_STEM_MAX)
    expect(name.endsWith('_AgroDesign-ProteinViewerPack-v1.0.0_light_20261116')).toBe(true)
    expect(name.startsWith('AAAA')).toBe(true)
    // A cut that ends on a dot, a space or an underscore drops them.
    const dotted = viewerPackFileStem(`${'B'.repeat(48)}._ x`, 'light', at, '1.0.0')
    expect(dotted).toMatch(/^B+_AgroDesign/)
  })

  it('cleans the stem as every saved name is', () => {
    expect(viewerPackFileStem('a/b:c', 'full', at, '1.0.0')).toBe('a_b_c_AgroDesign-ProteinViewerPack-v1.0.0_full_20261116')
  })
})

describe('typedPackFileStem', () => {
  it('drops a .html pasted on the end, once or more, so it is not doubled', () => {
    expect(typedPackFileStem('mine.html')).toBe('mine')
    expect(typedPackFileStem('mine.HTML ')).toBe('mine')
    expect(typedPackFileStem('mine.html.html')).toBe('mine')
    expect(typedPackFileStem('mine.htm')).toBe('mine.htm')
  })

  it('keeps the dots inside a name and cleans the rest', () => {
    expect(typedPackFileStem('1CRN_AgroDesign-ProteinViewerPack-v1.0.0_full_20261116')).toBe('1CRN_AgroDesign-ProteinViewerPack-v1.0.0_full_20261116')
    expect(typedPackFileStem('a/b?')).toBe('a_b_')
    expect(typedPackFileStem('CON')).toBe('CON_')
  })

  it('is empty when nothing is left, so the default is saved', () => {
    expect(typedPackFileStem('')).toBe('')
    expect(typedPackFileStem('.html')).toBe('')
    expect(typedPackFileStem('  ..  ')).toBe('')
  })
})
