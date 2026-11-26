import { APP_VERSION } from '../../../standalone/structure-viewer/appLicence'
import { cleanFileStem, FILE_STEM_MAX } from '../pymol-viewer/pymolExport'

/** The product's name as a file name carries it, before its version. */
export const VIEWER_PACK_FILE_NAME = 'AgroDesign-ProteinViewerPack'

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * The name an HTMLapp file starts with (owner 2026-11-16), without `.html`:
 * `<stem>_AgroDesign-ProteinViewerPack-v<version>_<full|light>_<yyyyMMdd>`,
 * the date the device's own. One rule for every place that makes the file,
 * the app's own 「HTMLappとして出力」 among them. `stem` is the structure's name as each place has it
 * (the file opened, the PDB ID, `structure-<ID>`); an empty one leaves the
 * name without it. Too long a stem is cut so the whole stays within
 * `FILE_STEM_MAX`: the version, edition and date are never cut (only the
 * build's short commit is left out of the name).
 */
export function viewerPackFileStem(stem: string, edition: 'full' | 'light', now: Date, version: string = APP_VERSION): string {
  const tail = `${VIEWER_PACK_FILE_NAME}-v${version}_${edition}_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
  const room = FILE_STEM_MAX - tail.length - 1
  const head = room > 0 ? [...cleanFileStem(stem, '')].slice(0, room).join('').replace(/[.\s_]+$/, '') : ''
  return head === '' ? tail : `${head}_${tail}`
}

/**
 * A name the person typed, as it is saved: a `.html` they pasted on the end
 * goes (the field's `.html` is added once), then `cleanFileStem`. '' when
 * nothing is left — the caller saves under the default name then.
 */
export function typedPackFileStem(raw: string): string {
  return cleanFileStem(raw.replace(/(\s*\.html)+\s*$/i, ''), '')
}
