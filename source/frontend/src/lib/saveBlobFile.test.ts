/**
 * `saveBlobFile`: one click on a link to the blob under the given name, the
 * link gone at once, its object URL revoked only after 10 s so a large file
 * the browser is still reading is not cut off — and still removed and revoked
 * when the click throws.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { saveBlobFile } from './saveBlobFile'

// jsdom has no object URLs: each test installs its own and puts back what was there.
const { createObjectURL, revokeObjectURL } = URL

beforeEach(() => {
  vi.useFakeTimers()
  URL.createObjectURL = vi.fn(() => 'blob:agdb/1')
  URL.revokeObjectURL = vi.fn()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  URL.createObjectURL = createObjectURL
  URL.revokeObjectURL = revokeObjectURL
})

describe('saveBlobFile', () => {
  it('clicks a download link once and revokes its URL 10 s later', () => {
    const clicked: { href: string; download: string; attached: boolean }[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({ href: this.href, download: this.download, attached: this.isConnected })
    })
    const blob = new Blob(['x'], { type: 'image/png' })

    saveBlobFile(blob, '1CRN.png')

    expect(URL.createObjectURL).toHaveBeenCalledWith(blob)
    expect(clicked).toEqual([{ href: 'blob:agdb/1', download: '1CRN.png', attached: true }])
    expect(document.querySelector('a[download]')).toBeNull()
    vi.advanceTimersByTime(9_999)
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:agdb/1')
  })

  it('removes the link and revokes its URL even when the click throws', () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(() => saveBlobFile(new Blob(['x']), 'a.bin')).toThrow('blocked')
    expect(document.querySelector('a[download]')).toBeNull()
    vi.advanceTimersByTime(10_000)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:agdb/1')
  })
})
