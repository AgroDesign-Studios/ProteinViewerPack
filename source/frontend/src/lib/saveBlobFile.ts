/**
 * Trigger a browser download of `blob` under `fileName`. Blob + object URL;
 * the URL is revoked a moment after the click, not at once, so a large file
 * the browser is still reading is not cut off.
 *
 * A leaf module, as `saveTextFile.ts` is: a page that only saves one file
 * carries nothing else with it.
 */
export function saveBlobFile(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  try {
    a.click()
  } finally {
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }
}
