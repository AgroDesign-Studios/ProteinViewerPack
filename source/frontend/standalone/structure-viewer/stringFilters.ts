/**
 * The text the offline structure file carries, per i18n namespace
 * (vite.structure-viewer.config.ts hands this to the generic strings-only
 * plugin, vite-plugins/gantt-strings-only.ts). A whole namespace would carry
 * text no bundled component uses, and a namespace with no filter here fails
 * the build.
 *
 * Prefixes, so a new string of a bundled component needs nothing here;
 * `strings.test.ts` checks every key the entry graph names passes and exists.
 */
/** A key that starts with one of `prefixes`, or is one of `exact`. */
const keys =
  (prefixes: readonly string[], exact: readonly string[] = []) =>
  (key: string): boolean =>
    exact.includes(key) || prefixes.some(p => key.startsWith(p))

export const STRUCTURE_VIEWER_STRING_FILTERS: ReadonlyMap<string, (key: string) => boolean> = new Map([
  // Only the screen-reader note of the About dialog's link.
  ['common', (key: string) => key === 'opens_in_new_tab'],
  // This file's own words, the export button's name: `pageMenuLabels`
  // (bundled) names it, though this file asks for its menu without it; and
  // the HTMLapp name field's (PackFileNameField, shared with AgDB's dialog).
  ['htmlExport', keys(['sa_', 'file_default'], ['button', 'file_phone_note'])],
  // The 3D viewer's toolbar, chips, depth cue and engine switch.
  ['proteindb', keys(['viewer_'])],
  // The PyMOL menu bar, command line, busy bar, presets, measurement and dialogs (the session save's `pse_` too).
  // `menubar_label` and `save_png_err_export` no longer travel: no bundled
  // component names them (PT-9630).
  [
    'pymol',
    keys(['busy_', 'cmd_', 'detail_', 'export_', 'keys_', 'measure', 'menu_', 'preset_', 'pse_', 'ray_', 'settings_'], ['dialog_close']),
  ],
  ['pymolNotice', () => true],
])
