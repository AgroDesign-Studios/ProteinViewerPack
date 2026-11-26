/**
 * Trigger a browser download of `text` as a UTF-8 file named
 * `${fileNameBase}.${extension}`. Blob + object URL, revoked after the click.
 *
 * `fileNameBase` falls back to `'document'` when blank, so a caller whose name
 * derivation came up empty still produces a file rather than a dotfile.
 *
 * A leaf module of its own (PT-2969 item 11), with no heavy imports, so a
 * page that only saves a text file (a plain-text export, the PyMOL molecule
 * export) carries nothing else in its chunk.
 */
export function saveTextFile(
  text: string,
  fileNameBase: string,
  extension: string,
  mimeType: string,
): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${mimeType};charset=utf-8` }))
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = `${(fileNameBase && fileNameBase.trim()) || 'document'}.${extension}`
    document.body.appendChild(a)
    a.click()
    a.remove()
  } finally {
    URL.revokeObjectURL(url)
  }
}
