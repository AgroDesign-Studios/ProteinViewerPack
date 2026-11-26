/**
 * PyMOL's menu bar as static data.
 *
 * The generated menu (`PYMOL_MENU`) is Open-Source PyMOL's menu, its labels
 * and commands, and keeps PyMOL's licence (Copyright (C) Schrodinger, LLC;
 * full text in the runtime folder's licenses/LICENSE.pymol.txt); the rest of
 * this file is AgroDesign's own.
 *
 * GENERATED from `PyMOLDesktopGUI.get_menudata` in `pymol/_gui.py` of the
 * vendored PyMOL wheel (3.2.0a, pymol-open-source edcda80f) — 715 entries of
 * its 768 — by walking the list with a recording `cmd`: a string command is
 * kept as written; a callable is called once and the PyMOL calls it makes are
 * written down as a `/`-prefixed Python line (`/cmd.zoom('center', 4,
 * animate=-1)`); `check` and `radio` entries become a `cmd.set` line; a movie
 * program fills its start frame from `cmd.get_movie_length()` when run, as
 * PyMOL's own `mvprg` does. Left out, with why: every entry that opens a Qt
 * file or settings dialog (File > Open / Save / Export, Log File, Run Script,
 * Edit pymolrc, Setting > Edit All / Keyboard Shortcuts / Colors, Scene >
 * Scenes...), New Window, Quit and the OS file browser, Get PDB (it downloads
 * from RCSB), Help's web links and About, the recent
 * files list, Movie > Update / Remove Last Program (they need the GUI's
 * memory of the last program), and the empty Plugin menu. Saving and
 * exporting are the page's own dialogs, through the parent's save gate. The
 * page adds its own entries in `appMenu`. Regenerate on a PyMOL version bump,
 * and then put back the one call written by hand: Display › Rendering ›
 * Modernize passes PyMOL's `cmd` as `_self`, which the recording wrote as its
 * own object's repr — a line PyMOL could not parse (PT-3291 item 1;
 * `PymolMenuBar.test.tsx` refuses a `<` in any command).
 *
 * `PYMOL_MENU` stays the whole recorded tree. The entries this runtime does not have are listed by path in
 * `ABSENT_MENU_PATHS`, outside the generated section, and `appMenu` leaves
 * them out (PT-9554).
 *
 * Why static and not read from the frame: a menu entry's command is often a
 * Python callable, which cannot cross a postMessage, and the frame is
 * untrusted — a menu the frame described would be one more hostile
 * message type to validate, with nothing to gain. These strings come from
 * this repository; selecting one sends exactly its `command`, through
 * `runCommand`, and nothing else.
 *
 * `toggle` and `choice` entries show no tick: the page does not read PyMOL's
 * settings back out of the frame, so it cannot know which one is on. A
 * toggle flips the setting between the entry's two values.
 */

import type { TFunction } from 'i18next'

import type { PresetId } from './pymolPresets'

export type MenuRole = 'action' | 'toggle' | 'choice'
export type LocalAction = 'settings' | 'keys' | 'about' | 'open-agdb' | 'open-file' | 'export-mol' | 'export-pse' | 'export-html' | `preset:${PresetId}`

export type MenuNode =
  /**
   * `brand` marks the menu that is AgDB's own (創薬表示): the bar shows the
   * company logo before its label (owner request, 2026-10-17; PT-3606).
   */
  | { kind: 'menu'; label: string; items: readonly MenuNode[]; brand?: true }
  | { kind: 'sep' }
  | { kind: 'item'; label: string; command: string; role: MenuRole }
  /**
   * An entry the page handles itself (its own dialogs and presets), never a
   * command. `locked` is the reason it cannot be used here: it is shown with
   * a padlock and does nothing, never hidden (owner ruling 2026-08-02).
   */
  | { kind: 'local'; label: string; action: LocalAction; locked?: string }

/**
 * The local actions that need no PyMOL: they open a page-side dialog (the
 * keys, the PyMOL™ notice with its way to the licences). Everything else —
 * a command, the settings, a preset, an export, an open — asks PyMOL.
 */
const ENGINE_FREE_ACTIONS: ReadonlySet<LocalAction> = new Set<LocalAction>(['keys', 'about'])

/**
 * Whether a menu (or entry) needs PyMOL to be ready. A menu needs it unless
 * every entry in it does not, so a top menu of only engine-free entries
 * (Help) stays usable while PyMOL loads and after it fails (PT-9103 item 4).
 */
export function needsPymol(node: MenuNode): boolean {
  if (node.kind === 'sep') return false
  if (node.kind === 'local') return !ENGINE_FREE_ACTIONS.has(node.action)
  if (node.kind === 'item') return true
  return node.items.some(needsPymol)
}

const SEP: MenuNode = Object.freeze({ kind: 'sep' })
const menu = (label: string, items: readonly MenuNode[]): MenuNode => ({ kind: 'menu', label, items })
const act = (label: string, command: string): MenuNode => ({ kind: 'item', label, command, role: 'action' })
const tog = (label: string, command: string): MenuNode => ({ kind: 'item', label, command, role: 'toggle' })

/**
 * Display > Internal GUI: shows or hides PyMOL's object panel. The offline
 * file's bridge (`pymolBridge.ts`) knows this text, so its 「オブジェクト一覧」
 * button keeps the panel's state after the menu flips it (PT-9113 item 4).
 */
export const INTERNAL_GUI_TOGGLE = "/cmd.set('internal_gui', 0 if cmd.get_setting_tuple('internal_gui')[1][0] == 1 else 1, quiet=0)"
const pick = (label: string, command: string): MenuNode => ({ kind: 'item', label, command, role: 'choice' })

/** The 創薬表示 menu's text, and why a colouring is locked (null or absent = usable). */
export interface PresetMenuLabels {
  title: string
  items: Readonly<Record<PresetId, string>>
  bfactorLocked?: string | null
  plddtLocked: string | null
}

/**
 * The page's own entries' labels: one function, so every menu that shows
 * them shows the same data (a host turns an entry off by leaving it out).
 */
export function pageMenuLabels(t: TFunction, opts: { exportHtml: boolean; openAgdb?: boolean }) {
  return {
    settings: t('pymol:menu_settings'),
    help: t('pymol:menu_help'),
    keys: t('pymol:menu_keys'),
    about: t('pymol:menu_about'),
    ...(opts.openAgdb === false ? {} : { openAgdb: t('pymol:menu_open_agdb_v2') }),
    exportMol: t('pymol:menu_export_mol_v2'),
    exportPse: t('pymol:menu_export_pse'),
    ...(opts.exportHtml ? { exportHtml: t('htmlExport:button') } : {}),
  }
}

/**
 * PyMOL's own menu entries this runtime does not have or cannot run, by full
 * path in PyMOL's tree (`Menu > Submenu > Entry`), each with why: the ten label fonts that are not Sans
 * and the 18 entries that never work here (28 of 616; the page shows 588).
 * `appMenu` leaves them out — they are not shown at all, neither greyed nor
 * kept (owner rulings 2026-11-17, PT-9554) — on the PyMOL page and in the
 * offline HTML file alike; the About dialog names them in one short list.
 * To take out another entry, add its path here; every path must name exactly
 * one entry of `PYMOL_MENU`.
 */
const SANS_ONLY = 'the runtime ships only the label fonts 5-8 (DejaVu Sans, Sans Oblique, Sans Bold, Sans Bold Oblique); any other font id is drawn as Sans'
export const ABSENT_MENU_PATHS: ReadonlyMap<string, string> = new Map([
  ['Setting > Label > Font > Serif', SANS_ONLY],
  ['Setting > Label > Font > Serif Oblique', SANS_ONLY],
  ['Setting > Label > Font > Serif Bold', SANS_ONLY],
  ['Setting > Label > Font > Serif Bold Oblique', SANS_ONLY],
  ['Setting > Label > Font > Mono', SANS_ONLY],
  ['Setting > Label > Font > Mono Oblique', SANS_ONLY],
  ['Setting > Label > Font > Mono Bold', SANS_ONLY],
  ['Setting > Label > Font > Mono Bold Oblique', SANS_ONLY],
  ['Setting > Label > Font > Gentium Roman', SANS_ONLY],
  ['Setting > Label > Font > Gentium Italic', SANS_ONLY],
  // The 18 entries that never work in this build, each reason quoting what PyMOL prints.
  // Taking a path out of this list brings its entry back.
  ...['Representations', 'Cartoon Ribbons', 'Roving Detail', 'Roving Density', 'Transparency', 'Ray Tracing', 'Sculpting',
    'Scripted Animation', 'Electrostatics', 'Compiled Graphics Objects', 'Molscript/Raster3D Input', 'End Demonstration'].map(
    (demo): [string, string] => [`Wizard > Demo > ${demo}`, "PyMOL cannot load its demo wizard in this runtime (\"Sorry, couldn't import the 'demo' wizard.\")"],
  ),
  ['Display > Stereo Mode > Quad-Buffered Stereo', "a WebGL canvas has no quad buffer (\"no 'quadbuffer' support detected\")"],
  ['Display > Stereo Mode > OpenVR', "this build has no OpenVR (\"'openvr' stereo mode not available in this build\")"],
  ...['off', 'FXAA', 'SMAA'].map(
    (aa): [string, string] => [`Setting > Rendering > Antialias (Real Time) > ${aa}`, 'antialias_shader is not supported in Open-Source PyMOL'],
  ),
  ['Setting > Volume > Pre-integrated Rendering', 'volume_mode 1 is not supported in Open-Source PyMOL'],
])

/**
 * `nodes` without the entries (or whole submenus) whose path is in `absent`.
 * In a menu that lost something, a submenu left empty goes too, and so do
 * separators left at either end or next to each other; a menu that lost
 * nothing is returned as it was (the same object), so the rest of the tree
 * is untouched.
 */
export function withoutMenuPaths(
  nodes: readonly MenuNode[],
  absent: { has(path: string): boolean },
  parent: readonly string[] = [],
): readonly MenuNode[] {
  let removed = false
  const kept: MenuNode[] = []
  for (const node of nodes) {
    if (node.kind === 'sep') {
      kept.push(node)
      continue
    }
    const path = [...parent, node.label]
    if (absent.has(path.join(' > '))) {
      removed = true
      continue
    }
    if (node.kind !== 'menu') {
      kept.push(node)
      continue
    }
    const items = withoutMenuPaths(node.items, absent, path)
    if (items === node.items) {
      kept.push(node)
      continue
    }
    removed = true
    if (items.length > 0) kept.push({ ...node, items })
  }
  if (!removed) return nodes
  const tidy: MenuNode[] = []
  for (const node of kept) {
    if (node.kind === 'sep' && (tidy.length === 0 || tidy[tidy.length - 1].kind === 'sep')) continue
    tidy.push(node)
  }
  if (tidy.length > 0 && tidy[tidy.length - 1].kind === 'sep') tidy.pop()
  return tidy
}

/**
 * The menu as the page shows it: PyMOL's without `ABSENT_MENU_PATHS`, with the page's own settings
 * dialog at the top of Setting (where PyMOL has its Edit All...), at the top
 * of File the dialogs that add another structure (`openAgdb`) and
 * export a molecule file (`exportMol`, PT-3615) and save the session as a
 * `.pse` (`exportPse`, owner 2026-11-14) when given, the 創薬表示
 * presets (`pymolPresets.ts`) when given — the one menu marked `brand` — and
 * a Help menu holding the keyboard remapping last.
 */
export function appMenu(
  labels: {
    settings: string
    help: string
    keys: string
    about?: string
    openAgdb?: string
    /** The offline HTML file's own: a structure file from this computer, added as an object. */
    openFile?: string
    exportMol?: string
    exportPse?: string
    exportHtml?: string
  },
  presets?: PresetMenuLabels,
): MenuNode[] {
  // An entry with no label is left out: a host gives none for an entry it
  // cannot run (owner 2026-11-14: what cannot work is not shown at all).
  const local = (label: string, action: 'open-agdb' | 'open-file' | 'export-mol' | 'export-pse' | 'export-html'): MenuNode => ({ kind: 'local', label, action })
  // PyMOL's tree first loses what this runtime lacks (paths of PyMOL's own entries), then gains the page's.
  const out = withoutMenuPaths(PYMOL_MENU, ABSENT_MENU_PATHS).map(node => {
    if (node.kind !== 'menu') return node
    if (node.label === 'Setting') return menu(node.label, [{ kind: 'local', label: labels.settings, action: 'settings' }, SEP, ...node.items])
    if (node.label === 'File') {
      const own: MenuNode[] = []
      if (labels.openAgdb !== undefined) own.push(local(labels.openAgdb, 'open-agdb'))
      if (labels.openFile !== undefined) own.push(local(labels.openFile, 'open-file'))
      if (labels.exportMol !== undefined) own.push(local(labels.exportMol, 'export-mol'))
      if (labels.exportPse !== undefined) own.push(local(labels.exportPse, 'export-pse'))
      if (labels.exportHtml !== undefined) own.push(local(labels.exportHtml, 'export-html'))
      if (own.length > 0) return menu(node.label, [...own, SEP, ...node.items])
    }
    return node
  })
  if (presets) {
    const entry = (id: PresetId, locked: string | null = null): MenuNode =>
      locked === null
        ? { kind: 'local', label: presets.items[id], action: `preset:${id}` }
        : { kind: 'local', label: presets.items[id], action: `preset:${id}`, locked }
    out.push({
      kind: 'menu',
      label: presets.title,
      items: [
        entry('ligand-site'),
        entry('pocket'),
        SEP,
        entry('bfactor', presets.bfactorLocked ?? null),
        entry('plddt', presets.plddtLocked),
        SEP,
        entry('publication'),
        SEP,
        entry('reset'),
      ],
      brand: true,
    })
  }
  // Help holds only engine-free entries (`ENGINE_FREE_ACTIONS`), so it opens before PyMOL is ready.
  const helpItems: MenuNode[] = [{ kind: 'local', label: labels.keys, action: 'keys' }]
  // The notice dialog (PyMOL(TM) trademark + provenance), last.
  if (labels.about !== undefined) helpItems.push({ kind: 'local', label: labels.about, action: 'about' })
  out.push(menu(labels.help, helpItems))
  return out
}

export const PYMOL_MENU: readonly MenuNode[] = [
  menu("File", [
    menu("Log File", [
      act("Close", "/cmd.log_close()"),
    ]),
    SEP,
    menu("Reinitialize", [
      act("Everything", "/cmd.reinitialize()"),
      act("Original Settings", "reinitialize original_settings"),
      act("Stored Settings", "reinitialize settings"),
      SEP,
      act("Store Current Settings", "reinitialize store_defaults"),
    ]),
  ]),
  menu("Edit", [
    act("Undo [Ctrl-Z]", "/cmd.undo()"),
    act("Redo [Ctrl-Y]", "/cmd.redo()"),
  ]),
  menu("Build", [
    menu("Fragment", [
      act("Acetylene [Alt-J]", "editor.attach_fragment('pk1','acetylene',2,0)"),
      act("Amide N->C [Alt-1]", "editor.attach_fragment('pk1','formamide',3,1)"),
      act("Amide C->N [Alt-2]", "editor.attach_fragment('pk1','formamide',5,0)"),
      act("Bromine [Ctrl-Shift-B]", "replace Br,1,1"),
      act("Carbon [Ctrl-Shift-C]", "replace C,4,4"),
      act("Carbonyl [Alt-0]", "editor.attach_fragment('pk1','formaldehyde',2,0)"),
      act("Chlorine [Ctrl-Shift-L]", "replace Cl,1,1"),
      act("Cyclobutyl [Alt-4]", "editor.attach_fragment('pk1','cyclobutane',4,0)"),
      act("Cyclopentyl [Alt-5]", "editor.attach_fragment('pk1','cyclopentane',5,0)"),
      act("Cyclopentadiene [Alt-8]", "editor.attach_fragment('pk1','cyclopentadiene',5,0)"),
      act("Cyclohexyl [Alt-6]", "editor.attach_fragment('pk1','cyclohexane',7,0)"),
      act("Cycloheptyl [Alt-7]", "editor.attach_fragment('pk1','cycloheptane',8,0)"),
      act("Fluorine [Ctrl-Shift-F]", "replace F,1,1"),
      act("Iodine [Ctrl-Shift-I]", "replace I,1,1"),
      act("Methane [Ctrl-Shift-M]", "editor.attach_fragment('pk1','methane',1,0)"),
      act("Nitrogen [Ctrl-Shift-N]", "replace N,4,3"),
      act("Oxygen [Ctrl-Shift-O]", "replace O,4,2"),
      act("Sulfer [Ctrl-Shift-S]", "replace S,2,2"),
      act("Sulfonyl [Alt-3]", "editor.attach_fragment('pk1','sulfone',3,1)"),
      act("Phosphorus [Ctrl-Shift-P]", "replace P,4,3"),
    ]),
    menu("Residue", [
      act("Acetyl [Alt-B]", "/cmd.editor.attach_amino_acid('pk1', 'ace')"),
      act("Alanine [Alt-A]", "/cmd.editor.attach_amino_acid('pk1', 'ala')"),
      act("Amine", "/cmd.editor.attach_amino_acid('pk1', 'nhh')"),
      act("Aspartate [Alt-D]", "/cmd.editor.attach_amino_acid('pk1', 'asp')"),
      act("Asparagine [Alt-N]", "/cmd.editor.attach_amino_acid('pk1', 'asn')"),
      act("Arginine [Alt-R]", "/cmd.editor.attach_amino_acid('pk1', 'arg')"),
      act("Cysteine [Alt-C]", "/cmd.editor.attach_amino_acid('pk1', 'cys')"),
      act("Glutamate [Alt-E]", "/cmd.editor.attach_amino_acid('pk1', 'glu')"),
      act("Glutamine [Alt-Q]", "/cmd.editor.attach_amino_acid('pk1', 'gln')"),
      act("Glycine [Alt-G]", "/cmd.editor.attach_amino_acid('pk1', 'gly')"),
      act("Histidine [Alt-H]", "/cmd.editor.attach_amino_acid('pk1', 'his')"),
      act("Isoleucine [Alt-I]", "/cmd.editor.attach_amino_acid('pk1', 'ile')"),
      act("Leucine [Alt-L]", "/cmd.editor.attach_amino_acid('pk1', 'leu')"),
      act("Lysine [Alt-K]", "/cmd.editor.attach_amino_acid('pk1', 'lys')"),
      act("Methionine [Alt-M]", "/cmd.editor.attach_amino_acid('pk1', 'met')"),
      act("N-Methyl [Alt-Z]", "/cmd.editor.attach_amino_acid('pk1', 'nme')"),
      act("Phenylalanine [Alt-F]", "/cmd.editor.attach_amino_acid('pk1', 'phe')"),
      act("Proline [Alt-P]", "/cmd.editor.attach_amino_acid('pk1', 'pro')"),
      act("Serine [Alt-S]", "/cmd.editor.attach_amino_acid('pk1', 'ser')"),
      act("Threonine [Alt-T]", "/cmd.editor.attach_amino_acid('pk1', 'thr')"),
      act("Tryptophan [Alt-W]", "/cmd.editor.attach_amino_acid('pk1', 'trp')"),
      act("Tyrosine [Alt-Y]", "/cmd.editor.attach_amino_acid('pk1', 'tyr')"),
      act("Valine [Alt-V]", "/cmd.editor.attach_amino_acid('pk1', 'val')"),
      SEP,
      pick("Helix", "/cmd.set('secondary_structure', 1, quiet=0)"),
      pick("Antiparallel Beta Sheet", "/cmd.set('secondary_structure', 2, quiet=0)"),
      pick("Parallel Beta Sheet", "/cmd.set('secondary_structure', 3, quiet=0)"),
    ]),
    SEP,
    menu("Sculpting", [
      tog("Auto-Sculpting", "/cmd.set('auto_sculpt', 0 if cmd.get_setting_tuple('auto_sculpt')[1][0] == 1 else 1, quiet=0)"),
      tog("Sculpting", "/cmd.set('sculpting', 0 if cmd.get_setting_tuple('sculpting')[1][0] == 1 else 1, quiet=0)"),
      SEP,
      act("Activate", "sculpt_activate all"),
      act("Deactivate", "sculpt_deactivate all"),
      act("Clear Memory", "/cmd.sculpt_purge()"),
      SEP,
      pick("1 Cycle per Update", "/cmd.set('sculpting_cycles', 1, quiet=0)"),
      pick("3 Cycles per Update", "/cmd.set('sculpting_cycles', 3, quiet=0)"),
      pick("10 Cycles per Update", "/cmd.set('sculpting_cycles', 10, quiet=0)"),
      pick("33 Cycles per Update", "/cmd.set('sculpting_cycles', 33, quiet=0)"),
      pick("100 Cycles per Update", "/cmd.set('sculpting_cycles', 100, quiet=0)"),
      pick("333 Cycles per Update", "/cmd.set('sculpting_cycles', 333, quiet=0)"),
      pick("1000 Cycles per Update", "/cmd.set('sculpting_cycles', 1000, quiet=0)"),
      SEP,
      pick("Bonds Only", "/cmd.set('sculpt_field_mask', 1, quiet=0)"),
      pick("Bonds and Angles Only", "/cmd.set('sculpt_field_mask', 3, quiet=0)"),
      pick("Local Geometry Only", "/cmd.set('sculpt_field_mask', 31, quiet=0)"),
      pick("All Except VDW", "/cmd.set('sculpt_field_mask', -97, quiet=0)"),
      pick("All Except 1-4 VDW and Torsions", "/cmd.set('sculpt_field_mask', -193, quiet=0)"),
      pick("All Terms", "/cmd.set('sculpt_field_mask', 255, quiet=0)"),
    ]),
    SEP,
    act("Cycle Bond Valence [Ctrl-Shift-W]", "cycle_valence"),
    act("Fill Hydrogens on (pk1) [Ctrl-Shift-R]", "h_fill"),
    act("Invert (pk2)-(pk1)-(pk3) [Ctrl-Shift-E]", "invert"),
    act("Create Bond (pk1)-(pk2) [Ctrl-Shift-T]", "bond"),
    SEP,
    act("Remove (pk1) [Ctrl-Shift-D]", "remove pk1"),
    SEP,
    act("Make (pk1) Positive [Ctrl-Shift-K]", "alter pk1, formal_charge=1"),
    act("Make (pk1) Negative [Ctrl-Shift-J]", "alter pk1, formal_charge=-1"),
    act("Make (pk1) Neutral [Ctrl-Shift-U]", "alter pk1, formal_charge=0"),
  ]),
  menu("Movie", [
    menu("Append", [
      act("0.25 second", "/cmd.movie.add_blank(0.25)"),
      act("0.5 second", "/cmd.movie.add_blank(0.5)"),
      act("1 second", "/cmd.movie.add_blank(1)"),
      act("2 second", "/cmd.movie.add_blank(2)"),
      act("3 second", "/cmd.movie.add_blank(3)"),
      act("4 second", "/cmd.movie.add_blank(4)"),
      act("6 second", "/cmd.movie.add_blank(6)"),
      act("8 second", "/cmd.movie.add_blank(8)"),
      act("12 second", "/cmd.movie.add_blank(12)"),
      act("18 second", "/cmd.movie.add_blank(18)"),
      act("24 second", "/cmd.movie.add_blank(24)"),
      act("30 second", "/cmd.movie.add_blank(30)"),
      act("48 second", "/cmd.movie.add_blank(48)"),
      act("60 second", "/cmd.movie.add_blank(60)"),
    ]),
    SEP,
    menu("Program", [
      menu("Camera Loop", [
        menu("Nutate", [
          act("15 deg. over 4 sec.", "/cmd.do('movie.add_nutate(4,15,start=%d)' % (cmd.get_movie_length() + 1))"),
          act("15 deg. over 8 sec.", "/cmd.do('movie.add_nutate(8,15,start=%d)' % (cmd.get_movie_length() + 1))"),
          act("15 deg. over 12 sec.", "/cmd.do('movie.add_nutate(12,15,start=%d)' % (cmd.get_movie_length() + 1))"),
          SEP,
          act("30 deg. over 4 sec.", "/cmd.do('movie.add_nutate(4,30,start=%d)' % (cmd.get_movie_length() + 1))"),
          act("30 deg. over 8 sec.", "/cmd.do('movie.add_nutate(8,30,start=%d)' % (cmd.get_movie_length() + 1))"),
          act("30 deg. over 12 sec.", "/cmd.do('movie.add_nutate(12,30,start=%d)' % (cmd.get_movie_length() + 1))"),
          act("30 deg. over 16 sec.", "/cmd.do('movie.add_nutate(16,30,start=%d)' % (cmd.get_movie_length() + 1))"),
          SEP,
          act("60 deg. over 8 sec.", "/cmd.do('movie.add_nutate(8,60,start=%d)' % (cmd.get_movie_length() + 1))"),
          act("60 deg. over 16 sec.", "/cmd.do('movie.add_nutate(16,60,start=%d)' % (cmd.get_movie_length() + 1))"),
          act("60 deg. over 24 sec.", "/cmd.do('movie.add_nutate(24,60,start=%d)' % (cmd.get_movie_length() + 1))"),
          act("60 deg. over 32 sec.", "/cmd.do('movie.add_nutate(32,60,start=%d)' % (cmd.get_movie_length() + 1))"),
        ]),
        SEP,
        menu("X-Rock", [
          act("30 deg. over 2 sec.", "/cmd.do(\"movie.add_rock(2,30,axis='x',start=%d)\" % (cmd.get_movie_length() + 1))"),
          act("30 deg. over 4 sec.", "/cmd.do(\"movie.add_rock(4,30,axis='x',start=%d)\" % (cmd.get_movie_length() + 1))"),
          act("30 deg. over 8 sec.", "/cmd.do(\"movie.add_rock(8,30,axis='x',start=%d)\" % (cmd.get_movie_length() + 1))"),
          SEP,
          act("60 deg. over 4 sec.", "/cmd.do(\"movie.add_rock(4,60,axis='x',start=%d)\" % (cmd.get_movie_length() + 1))"),
          act("60 deg. over 8 sec.", "/cmd.do(\"movie.add_rock(8,60,axis='x',start=%d)\" % (cmd.get_movie_length() + 1))"),
          act("60 deg. over 16 sec.", "/cmd.do(\"movie.add_rock(16,60,axis='x',start=%d)\" % (cmd.get_movie_length() + 1))"),
          SEP,
          act("90 deg. over 6 sec.", "/cmd.do(\"movie.add_rock(6,90,axis='x',start=%d)\" % (cmd.get_movie_length() + 1))"),
          act("90 deg. over 12 sec.", "/cmd.do(\"movie.add_rock(12,90,axis='x',start=%d)\" % (cmd.get_movie_length() + 1))"),
          act("90 deg. over 24 sec.", "/cmd.do(\"movie.add_rock(24,90,axis='x',start=%d)\" % (cmd.get_movie_length() + 1))"),
          SEP,
          act("120 deg. over 8 sec.", "/cmd.do(\"movie.add_rock(8,120,axis='x',start=%d)\" % (cmd.get_movie_length() + 1))"),
          act("120 deg. over 16 sec.", "/cmd.do(\"movie.add_rock(16,120,axis='x',start=%d)\" % (cmd.get_movie_length() + 1))"),
          act("120 deg. over 32 sec.", "/cmd.do(\"movie.add_rock(32,120,axis='x',start=%d)\" % (cmd.get_movie_length() + 1))"),
          SEP,
          act("180 deg. over 12 sec.", "/cmd.do(\"movie.add_rock(12,179.99,axis='x',start=%d)\" % (cmd.get_movie_length() + 1))"),
          act("180 deg. over 24 sec.", "/cmd.do(\"movie.add_rock(24,179.99,axis='x',start=%d)\" % (cmd.get_movie_length() + 1))"),
          act("180 deg. over 48 sec.", "/cmd.do(\"movie.add_rock(48,179.99,axis='x',start=%d)\" % (cmd.get_movie_length() + 1))"),
        ]),
        menu("X-Roll", [
          act("4 seconds", "/cmd.do(\"movie.add_roll(4.0,axis='x',start=%d)\" % (cmd.get_movie_length() + 1))"),
          act("8 seconds", "/cmd.do(\"movie.add_roll(8.0,axis='x',start=%d)\" % (cmd.get_movie_length() + 1))"),
          act("16 seconds", "/cmd.do(\"movie.add_roll(16.0,axis='x',start=%d)\" % (cmd.get_movie_length() + 1))"),
          act("32 seconds", "/cmd.do(\"movie.add_roll(32.0,axis='x',start=%d)\" % (cmd.get_movie_length() + 1))"),
        ]),
        SEP,
        menu("Y-Rock", [
          act("30 deg. over 2 sec.", "/cmd.do(\"movie.add_rock(2,30,axis='y',start=%d)\" % (cmd.get_movie_length() + 1))"),
          act("30 deg. over 4 sec.", "/cmd.do(\"movie.add_rock(4,30,axis='y',start=%d)\" % (cmd.get_movie_length() + 1))"),
          act("30 deg. over 8 sec.", "/cmd.do(\"movie.add_rock(8,30,axis='y',start=%d)\" % (cmd.get_movie_length() + 1))"),
          SEP,
          act("60 deg. over 4 sec.", "/cmd.do(\"movie.add_rock(4,60,axis='y',start=%d)\" % (cmd.get_movie_length() + 1))"),
          act("60 deg. over 8 sec.", "/cmd.do(\"movie.add_rock(8,60,axis='y',start=%d)\" % (cmd.get_movie_length() + 1))"),
          act("60 deg. over 16 sec.", "/cmd.do(\"movie.add_rock(16,60,axis='y',start=%d)\" % (cmd.get_movie_length() + 1))"),
          SEP,
          act("90 deg. over 6 sec.", "/cmd.do(\"movie.add_rock(6,90,axis='y',start=%d)\" % (cmd.get_movie_length() + 1))"),
          act("90 deg. over 12 sec.", "/cmd.do(\"movie.add_rock(12,90,axis='y',start=%d)\" % (cmd.get_movie_length() + 1))"),
          act("90 deg. over 24 sec.", "/cmd.do(\"movie.add_rock(24,90,axis='y',start=%d)\" % (cmd.get_movie_length() + 1))"),
          SEP,
          act("120 deg. over 8 sec.", "/cmd.do(\"movie.add_rock(8,120,axis='y',start=%d)\" % (cmd.get_movie_length() + 1))"),
          act("120 deg. over 16 sec.", "/cmd.do(\"movie.add_rock(16,120,axis='y',start=%d)\" % (cmd.get_movie_length() + 1))"),
          act("120 deg. over 32 sec.", "/cmd.do(\"movie.add_rock(32,120,axis='y',start=%d)\" % (cmd.get_movie_length() + 1))"),
          SEP,
          act("180 deg. over 12 sec.", "/cmd.do(\"movie.add_rock(12,179.99,axis='y',start=%d)\" % (cmd.get_movie_length() + 1))"),
          act("180 deg. over 24 sec.", "/cmd.do(\"movie.add_rock(24,179.99,axis='y',start=%d)\" % (cmd.get_movie_length() + 1))"),
          act("180 deg. over 48 sec.", "/cmd.do(\"movie.add_rock(48,179.99,axis='y',start=%d)\" % (cmd.get_movie_length() + 1))"),
        ]),
        menu("Y-Roll", [
          act("4 seconds", "/cmd.do(\"movie.add_roll(4.0,axis='y',start=%d)\" % (cmd.get_movie_length() + 1))"),
          act("8 seconds", "/cmd.do(\"movie.add_roll(8.0,axis='y',start=%d)\" % (cmd.get_movie_length() + 1))"),
          act("16 seconds", "/cmd.do(\"movie.add_roll(16.0,axis='y',start=%d)\" % (cmd.get_movie_length() + 1))"),
          act("32 seconds", "/cmd.do(\"movie.add_roll(32.0,axis='y',start=%d)\" % (cmd.get_movie_length() + 1))"),
        ]),
      ]),
      SEP,
      menu("Scene Loop", [
        menu("Nutate", [
          act("30 deg. over 2 sec.", "/cmd.do('set sweep_angle,30;cmd.movie.add_scenes(None, 2, rock=4, start=%d)' % (cmd.get_movie_length() + 1))"),
          act("30 deg. over 4 sec.", "/cmd.do('set sweep_angle,30;cmd.movie.add_scenes(None, 4, rock=4, start=%d)' % (cmd.get_movie_length() + 1))"),
          act("30 deg. over 8 sec.", "/cmd.do('set sweep_angle,30;cmd.movie.add_scenes(None, 8, rock=4, start=%d)' % (cmd.get_movie_length() + 1))"),
          act("60 deg. over 4 sec.", "/cmd.do('set sweep_angle,60;cmd.movie.add_scenes(None, 4, rock=4, start=%d)' % (cmd.get_movie_length() + 1))"),
          act("60 deg. over 8 sec.", "/cmd.do('set sweep_angle,60;cmd.movie.add_scenes(None, 8, rock=4, start=%d)' % (cmd.get_movie_length() + 1))"),
          act("60 deg. over 16 sec.", "/cmd.do('set sweep_angle,60;cmd.movie.add_scenes(None, 16, rock=4, start=%d)' % (cmd.get_movie_length() + 1))"),
          act("90 deg. over 6 sec.", "/cmd.do('set sweep_angle,90;cmd.movie.add_scenes(None, 6, rock=4, start=%d)' % (cmd.get_movie_length() + 1))"),
          act("90 deg. over 12 sec.", "/cmd.do('set sweep_angle,90;cmd.movie.add_scenes(None, 12, rock=4, start=%d)' % (cmd.get_movie_length() + 1))"),
          act("90 deg. over 24 sec.", "/cmd.do('set sweep_angle,90;cmd.movie.add_scenes(None, 24, rock=4, start=%d)' % (cmd.get_movie_length() + 1))"),
          act("120 deg. over 8 sec.", "/cmd.do('set sweep_angle,120;cmd.movie.add_scenes(None, 8, rock=4, start=%d)' % (cmd.get_movie_length() + 1))"),
          act("120 deg. over 16 sec.", "/cmd.do('set sweep_angle,120;cmd.movie.add_scenes(None, 16, rock=4, start=%d)' % (cmd.get_movie_length() + 1))"),
          act("120 deg. over 32 sec.", "/cmd.do('set sweep_angle,120;cmd.movie.add_scenes(None, 32, rock=4, start=%d)' % (cmd.get_movie_length() + 1))"),
        ]),
        menu("X-Rock", [
          act("30 deg. over 2 sec.", "/cmd.do('set sweep_angle,30;cmd.movie.add_scenes(None, 2, rock=2, start=%d)' % (cmd.get_movie_length() + 1))"),
          act("30 deg. over 4 sec.", "/cmd.do('set sweep_angle,30;cmd.movie.add_scenes(None, 4, rock=2, start=%d)' % (cmd.get_movie_length() + 1))"),
          act("30 deg. over 8 sec.", "/cmd.do('set sweep_angle,30;cmd.movie.add_scenes(None, 8, rock=2, start=%d)' % (cmd.get_movie_length() + 1))"),
          act("60 deg. over 4 sec.", "/cmd.do('set sweep_angle,60;cmd.movie.add_scenes(None, 4, rock=2, start=%d)' % (cmd.get_movie_length() + 1))"),
          act("60 deg. over 8 sec.", "/cmd.do('set sweep_angle,60;cmd.movie.add_scenes(None, 8, rock=2, start=%d)' % (cmd.get_movie_length() + 1))"),
          act("60 deg. over 16 sec.", "/cmd.do('set sweep_angle,60;cmd.movie.add_scenes(None, 16, rock=2, start=%d)' % (cmd.get_movie_length() + 1))"),
          act("90 deg. over 6 sec.", "/cmd.do('set sweep_angle,90;cmd.movie.add_scenes(None, 6, rock=2, start=%d)' % (cmd.get_movie_length() + 1))"),
          act("90 deg. over 12 sec.", "/cmd.do('set sweep_angle,90;cmd.movie.add_scenes(None, 12, rock=2, start=%d)' % (cmd.get_movie_length() + 1))"),
          act("90 deg. over 24 sec.", "/cmd.do('set sweep_angle,90;cmd.movie.add_scenes(None, 24, rock=2, start=%d)' % (cmd.get_movie_length() + 1))"),
          act("120 deg. over 8 sec.", "/cmd.do('set sweep_angle,120;cmd.movie.add_scenes(None, 8, rock=2, start=%d)' % (cmd.get_movie_length() + 1))"),
          act("120 deg. over 16 sec.", "/cmd.do('set sweep_angle,120;cmd.movie.add_scenes(None, 16, rock=2, start=%d)' % (cmd.get_movie_length() + 1))"),
          act("120 deg. over 32 sec.", "/cmd.do('set sweep_angle,120;cmd.movie.add_scenes(None, 32, rock=2, start=%d)' % (cmd.get_movie_length() + 1))"),
        ]),
        menu("Y-Rock", [
          act("30 deg. over 2 sec.", "/cmd.do('set sweep_angle,30;cmd.movie.add_scenes(None, 2, rock=1, start=%d)' % (cmd.get_movie_length() + 1))"),
          act("30 deg. over 4 sec.", "/cmd.do('set sweep_angle,30;cmd.movie.add_scenes(None, 4, rock=1, start=%d)' % (cmd.get_movie_length() + 1))"),
          act("30 deg. over 8 sec.", "/cmd.do('set sweep_angle,30;cmd.movie.add_scenes(None, 8, rock=1, start=%d)' % (cmd.get_movie_length() + 1))"),
          act("60 deg. over 4 sec.", "/cmd.do('set sweep_angle,60;cmd.movie.add_scenes(None, 4, rock=1, start=%d)' % (cmd.get_movie_length() + 1))"),
          act("60 deg. over 8 sec.", "/cmd.do('set sweep_angle,60;cmd.movie.add_scenes(None, 8, rock=1, start=%d)' % (cmd.get_movie_length() + 1))"),
          act("60 deg. over 16 sec.", "/cmd.do('set sweep_angle,60;cmd.movie.add_scenes(None, 16, rock=1, start=%d)' % (cmd.get_movie_length() + 1))"),
          act("90 deg. over 6 sec.", "/cmd.do('set sweep_angle,90;cmd.movie.add_scenes(None, 6, rock=1, start=%d)' % (cmd.get_movie_length() + 1))"),
          act("90 deg. over 12 sec.", "/cmd.do('set sweep_angle,90;cmd.movie.add_scenes(None, 12, rock=1, start=%d)' % (cmd.get_movie_length() + 1))"),
          act("90 deg. over 24 sec.", "/cmd.do('set sweep_angle,90;cmd.movie.add_scenes(None, 24, rock=1, start=%d)' % (cmd.get_movie_length() + 1))"),
          act("120 deg. over 8 sec.", "/cmd.do('set sweep_angle,120;cmd.movie.add_scenes(None, 8, rock=1, start=%d)' % (cmd.get_movie_length() + 1))"),
          act("120 deg. over 16 sec.", "/cmd.do('set sweep_angle,120;cmd.movie.add_scenes(None, 16, rock=1, start=%d)' % (cmd.get_movie_length() + 1))"),
          act("120 deg. over 32 sec.", "/cmd.do('set sweep_angle,120;cmd.movie.add_scenes(None, 32, rock=1, start=%d)' % (cmd.get_movie_length() + 1))"),
        ]),
        menu("Steady", [
          act("1 seconds each", "/cmd.do('movie.add_scenes(None,1.0,rock=0,start=%d)' % (cmd.get_movie_length() + 1))"),
          act("2 seconds each", "/cmd.do('movie.add_scenes(None,2.0,rock=0,start=%d)' % (cmd.get_movie_length() + 1))"),
          act("4 seconds each", "/cmd.do('movie.add_scenes(None,4.0,rock=0,start=%d)' % (cmd.get_movie_length() + 1))"),
          act("8 seconds each", "/cmd.do('movie.add_scenes(None,8.0,rock=0,start=%d)' % (cmd.get_movie_length() + 1))"),
          act("12 seconds each", "/cmd.do('movie.add_scenes(None,12.0,rock=0,start=%d)' % (cmd.get_movie_length() + 1))"),
          act("16 seconds each", "/cmd.do('movie.add_scenes(None,16.0,rock=0,start=%d)' % (cmd.get_movie_length() + 1))"),
          act("24 seconds each", "/cmd.do('movie.add_scenes(None,24.0,rock=0,start=%d)' % (cmd.get_movie_length() + 1))"),
        ]),
      ]),
      SEP,
      menu("State Loop", [
        menu("Full Speed", [
          act("no pause", "/cmd.do('movie.add_state_loop(1, 0, start=%d)' % (cmd.get_movie_length() + 1))"),
          act("1 second pause", "/cmd.do('movie.add_state_loop(1, 1, start=%d)' % (cmd.get_movie_length() + 1))"),
          act("2 second pause", "/cmd.do('movie.add_state_loop(1, 2, start=%d)' % (cmd.get_movie_length() + 1))"),
          act("4 second pause", "/cmd.do('movie.add_state_loop(1, 4, start=%d)' % (cmd.get_movie_length() + 1))"),
        ]),
        menu("1/2 Speed", [
          act("no pause", "/cmd.do('movie.add_state_loop(2, 0, start=%d)' % (cmd.get_movie_length() + 1))"),
          act("1 second pause", "/cmd.do('movie.add_state_loop(2, 1, start=%d)' % (cmd.get_movie_length() + 1))"),
          act("2 second pause", "/cmd.do('movie.add_state_loop(2, 2, start=%d)' % (cmd.get_movie_length() + 1))"),
          act("4 second pause", "/cmd.do('movie.add_state_loop(2, 4, start=%d)' % (cmd.get_movie_length() + 1))"),
        ]),
        menu("1/3 Speed", [
          act("no pause", "/cmd.do('movie.add_state_loop(3, 0, start=%d)' % (cmd.get_movie_length() + 1))"),
          act("1 second pause", "/cmd.do('movie.add_state_loop(3, 1, start=%d)' % (cmd.get_movie_length() + 1))"),
          act("2 second pause", "/cmd.do('movie.add_state_loop(3, 2, start=%d)' % (cmd.get_movie_length() + 1))"),
          act("4 second pause", "/cmd.do('movie.add_state_loop(3, 4, start=%d)' % (cmd.get_movie_length() + 1))"),
        ]),
        menu("1/4 Speed", [
          act("no pause", "/cmd.do('movie.add_state_loop(4, 0, start=%d)' % (cmd.get_movie_length() + 1))"),
          act("1 second pause", "/cmd.do('movie.add_state_loop(4, 1, start=%d)' % (cmd.get_movie_length() + 1))"),
          act("2 second pause", "/cmd.do('movie.add_state_loop(4, 2, start=%d)' % (cmd.get_movie_length() + 1))"),
          act("4 second pause", "/cmd.do('movie.add_state_loop(4, 4, start=%d)' % (cmd.get_movie_length() + 1))"),
        ]),
        menu("1/8 Speed", [
          act("no pause", "/cmd.do('movie.add_state_loop(8, 0, start=%d)' % (cmd.get_movie_length() + 1))"),
          act("1 second pause", "/cmd.do('movie.add_state_loop(8, 1, start=%d)' % (cmd.get_movie_length() + 1))"),
          act("2 second pause", "/cmd.do('movie.add_state_loop(8, 2, start=%d)' % (cmd.get_movie_length() + 1))"),
          act("4 second pause", "/cmd.do('movie.add_state_loop(8, 4, start=%d)' % (cmd.get_movie_length() + 1))"),
        ]),
        menu("1/16 Speed", [
          act("no pause", "/cmd.do('movie.add_state_loop(16, 0, start=%d)' % (cmd.get_movie_length() + 1))"),
          act("1 second pause", "/cmd.do('movie.add_state_loop(16, 1, start=%d)' % (cmd.get_movie_length() + 1))"),
          act("2 second pause", "/cmd.do('movie.add_state_loop(16, 2, start=%d)' % (cmd.get_movie_length() + 1))"),
          act("4 second pause", "/cmd.do('movie.add_state_loop(16, 4, start=%d)' % (cmd.get_movie_length() + 1))"),
        ]),
      ]),
      menu("State Sweep", [
        menu("Full Speed", [
          act("no pause", "/cmd.do('movie.add_state_sweep(1, 0, start=%d)' % (cmd.get_movie_length() + 1))"),
          act("1 second pause", "/cmd.do('movie.add_state_sweep(1, 1, start=%d)' % (cmd.get_movie_length() + 1))"),
          act("2 second pause", "/cmd.do('movie.add_state_sweep(1, 2, start=%d)' % (cmd.get_movie_length() + 1))"),
          act("4 second pause", "/cmd.do('movie.add_state_sweep(1, 4, start=%d)' % (cmd.get_movie_length() + 1))"),
        ]),
        menu("1/2 Speed", [
          act("no pause", "/cmd.do('movie.add_state_sweep(2, 0, start=%d)' % (cmd.get_movie_length() + 1))"),
          act("1 second pause", "/cmd.do('movie.add_state_sweep(2, 1, start=%d)' % (cmd.get_movie_length() + 1))"),
          act("2 second pause", "/cmd.do('movie.add_state_sweep(2, 2, start=%d)' % (cmd.get_movie_length() + 1))"),
          act("4 second pause", "/cmd.do('movie.add_state_sweep(2, 4, start=%d)' % (cmd.get_movie_length() + 1))"),
        ]),
        menu("1/3 Speed", [
          act("no pause", "/cmd.do('movie.add_state_sweep(3, 0, start=%d)' % (cmd.get_movie_length() + 1))"),
          act("1 second pause", "/cmd.do('movie.add_state_sweep(3, 1, start=%d)' % (cmd.get_movie_length() + 1))"),
          act("2 second pause", "/cmd.do('movie.add_state_sweep(3, 2, start=%d)' % (cmd.get_movie_length() + 1))"),
          act("4 second pause", "/cmd.do('movie.add_state_sweep(3, 4, start=%d)' % (cmd.get_movie_length() + 1))"),
        ]),
        menu("1/4 Speed", [
          act("no pause", "/cmd.do('movie.add_state_sweep(4, 0, start=%d)' % (cmd.get_movie_length() + 1))"),
          act("1 second pause", "/cmd.do('movie.add_state_sweep(4, 1, start=%d)' % (cmd.get_movie_length() + 1))"),
          act("2 second pause", "/cmd.do('movie.add_state_sweep(4, 2, start=%d)' % (cmd.get_movie_length() + 1))"),
          act("4 second pause", "/cmd.do('movie.add_state_sweep(4, 4, start=%d)' % (cmd.get_movie_length() + 1))"),
        ]),
        menu("1/8 Speed", [
          act("no pause", "/cmd.do('movie.add_state_sweep(8, 0, start=%d)' % (cmd.get_movie_length() + 1))"),
          act("1 second pause", "/cmd.do('movie.add_state_sweep(8, 1, start=%d)' % (cmd.get_movie_length() + 1))"),
          act("2 second pause", "/cmd.do('movie.add_state_sweep(8, 2, start=%d)' % (cmd.get_movie_length() + 1))"),
          act("4 second pause", "/cmd.do('movie.add_state_sweep(8, 4, start=%d)' % (cmd.get_movie_length() + 1))"),
        ]),
        menu("1/16 Speed", [
          act("no pause", "/cmd.do('movie.add_state_sweep(16, 0, start=%d)' % (cmd.get_movie_length() + 1))"),
          act("1 second pause", "/cmd.do('movie.add_state_sweep(16, 1, start=%d)' % (cmd.get_movie_length() + 1))"),
          act("2 second pause", "/cmd.do('movie.add_state_sweep(16, 2, start=%d)' % (cmd.get_movie_length() + 1))"),
          act("4 second pause", "/cmd.do('movie.add_state_sweep(16, 4, start=%d)' % (cmd.get_movie_length() + 1))"),
        ]),
      ]),
    ]),
    SEP,
    act("Reset", "mset;rewind"),
    SEP,
    menu("Frame Rate", [
      pick("30 FPS", "/cmd.set('movie_fps', 30.0, quiet=0)"),
      pick("15 FPS", "/cmd.set('movie_fps', 15.0, quiet=0)"),
      pick("5 FPS", "/cmd.set('movie_fps', 5.0, quiet=0)"),
      pick("1 FPS", "/cmd.set('movie_fps', 1.0, quiet=0)"),
      pick("0.3 FPS", "/cmd.set('movie_fps', 0.3, quiet=0)"),
      SEP,
      tog("Show Frame Rate", "/cmd.set('show_frame_rate', 0 if cmd.get_setting_tuple('show_frame_rate')[1][0] == 1 else 1, quiet=0)"),
      act("Reset Meter", "/cmd.meter_reset()"),
    ]),
    SEP,
    tog("Auto Interpolate", "/cmd.set('movie_auto_interpolate', 0 if cmd.get_setting_tuple('movie_auto_interpolate')[1][0] == 1 else 1, quiet=0)"),
    tog("Show Panel", "/cmd.set('movie_panel', 0 if cmd.get_setting_tuple('movie_panel')[1][0] == 1 else 1, quiet=0)"),
    tog("Loop Frames", "/cmd.set('movie_loop', 0 if cmd.get_setting_tuple('movie_loop')[1][0] == 1 else 1, quiet=0)"),
    tog("Draw Frames", "/cmd.set('draw_frames', 0 if cmd.get_setting_tuple('draw_frames')[1][0] == 1 else 1, quiet=0)"),
    tog("Ray Trace Frames", "/cmd.set('ray_trace_frames', 0 if cmd.get_setting_tuple('ray_trace_frames')[1][0] == 1 else 1, quiet=0)"),
    tog("Cache Frame Images", "/cmd.set('cache_frames', 0 if cmd.get_setting_tuple('cache_frames')[1][0] == 1 else 1, quiet=0)"),
    act("Clear Image Cache", "/cmd.mclear()"),
    SEP,
    tog("Static Singletons", "/cmd.set('static_singletons', 0 if cmd.get_setting_tuple('static_singletons')[1][0] == 1 else 1, quiet=0)"),
    tog("Show All States", "/cmd.set('all_states', 0 if cmd.get_setting_tuple('all_states')[1][0] == 1 else 1, quiet=0)"),
  ]),
  menu("Display", [
    tog("Sequence", "/cmd.set('seq_view', 0 if cmd.get_setting_tuple('seq_view')[1][0] == 1 else 1, quiet=0)"),
    menu("Sequence Mode", [
      pick("Residue Codes", "/cmd.set('seq_view_format', 0, quiet=0)"),
      pick("Residue Names", "/cmd.set('seq_view_format', 1, quiet=0)"),
      pick("Chain Identifiers", "/cmd.set('seq_view_format', 3, quiet=0)"),
      pick("Atom Names", "/cmd.set('seq_view_format', 2, quiet=0)"),
      pick("States", "/cmd.set('seq_view_format', 4, quiet=0)"),
      SEP,
      pick("All Residue Numbers", "/cmd.set('seq_view_label_mode', 2, quiet=0)"),
      pick("Top Sequence Only", "/cmd.set('seq_view_label_mode', 1, quiet=0)"),
      pick("Object Names Only", "/cmd.set('seq_view_label_mode', 0, quiet=0)"),
      pick("No Labels", "/cmd.set('seq_view_label_mode', 3, quiet=0)"),
      SEP,
      pick("No Gaps", "/cmd.set('seq_view_gap_mode', 0, quiet=0)"),
      pick("All Gaps", "/cmd.set('seq_view_gap_mode', 1, quiet=0)"),
      pick("Single Gap", "/cmd.set('seq_view_gap_mode', 2, quiet=0)"),
    ]),
    SEP,
    tog("Internal GUI", INTERNAL_GUI_TOGGLE),
    tog("Internal Prompt", "/cmd.set('internal_prompt', 0 if cmd.get_setting_tuple('internal_prompt')[1][0] == 1 else 1, quiet=0)"),
    menu("Internal Feedback", [
      pick("0", "/cmd.set('internal_feedback', 0, quiet=0)"),
      pick("1", "/cmd.set('internal_feedback', 1, quiet=0)"),
      pick("3", "/cmd.set('internal_feedback', 3, quiet=0)"),
      pick("5", "/cmd.set('internal_feedback', 5, quiet=0)"),
    ]),
    menu("Overlay", [
      pick("0", "/cmd.set('overlay', 0, quiet=0)"),
      pick("1", "/cmd.set('overlay', 1, quiet=0)"),
      pick("3", "/cmd.set('overlay', 3, quiet=0)"),
      pick("5", "/cmd.set('overlay', 5, quiet=0)"),
    ]),
    SEP,
    tog("Stereo", "/cmd.set('stereo', 0 if cmd.get_setting_tuple('stereo')[1][0] == 1 else 1, quiet=0)"),
    menu("Stereo Mode", [
      act("Anaglyph Stereo", "stereo anaglyph"),
      act("Cross-Eye Stereo", "stereo crosseye"),
      act("Wall-Eye Stereo", "stereo walleye"),
      act("Quad-Buffered Stereo", "stereo quadbuffer"),
      act("Zalman Stereo", "stereo byrow"),
      act("OpenVR", "stereo openvr"),
      SEP,
      act("Swap Sides", "stereo swap"),
      SEP,
      act("Chromadepth", "stereo chromadepth"),
      act("off", "stereo off"),
    ]),
    SEP,
    menu("Zoom", [
      act("4 Angstrom Sphere", "/cmd.zoom('center', 4, animate=-1)"),
      act("6 Angstrom Sphere", "/cmd.zoom('center', 6, animate=-1)"),
      act("8 Angstrom Sphere", "/cmd.zoom('center', 8, animate=-1)"),
      act("12 Angstrom Sphere", "/cmd.zoom('center', 12, animate=-1)"),
      act("20 Angstrom Sphere", "/cmd.zoom('center', 20, animate=-1)"),
      act("All", "zoom animate=-1"),
      act("Complete", "zoom animate=-1, complete=1"),
    ]),
    menu("Clip", [
      act("Nothing", "clip atoms, 5, all"),
      act("8 Angstrom Slab", "/cmd.clip('slab', 8)"),
      act("12 Angstrom Slab", "/cmd.clip('slab', 12)"),
      act("16 Angstrom Slab", "/cmd.clip('slab', 16)"),
      act("20 Angstrom Slab", "/cmd.clip('slab', 20)"),
      act("30 Angstrom Slab", "/cmd.clip('slab', 30)"),
    ]),
    SEP,
    menu("Background", [
      tog("Opaque", "/cmd.set('opaque_background', 0 if cmd.get_setting_tuple('opaque_background')[1][0] == 1 else 1, quiet=0)"),
      tog("Alpha Checker", "/cmd.set('show_alpha_checker', 0 if cmd.get_setting_tuple('show_alpha_checker')[1][0] == 1 else 1, quiet=0)"),
      SEP,
      pick("White", "/cmd.set('bg_rgb', 0, quiet=0)"),
      pick("Light Grey", "/cmd.set('bg_rgb', 134, quiet=0)"),
      pick("Grey", "/cmd.set('bg_rgb', 104, quiet=0)"),
      pick("Black", "/cmd.set('bg_rgb', 1, quiet=0)"),
    ]),
    menu("Color Space", [
      act("CMYK (for publications)", "space cmyk"),
      act("PyMOL (for video + web)", "space pymol"),
      act("RGB (default)", "space rgb"),
    ]),
    menu("Quality", [
      act("Maximum Performance", "util.performance(100)"),
      act("Reasonable Performance", "util.performance(66)"),
      act("Reasonable Quality", "util.performance(33)"),
      act("Maximum Quality", "util.performance(0)"),
    ]),
    menu("Grid", [
      pick("By Object", "/cmd.set('grid_mode', 1, quiet=0)"),
      pick("By State", "/cmd.set('grid_mode', 2, quiet=0)"),
      pick("By Object-State", "/cmd.set('grid_mode', 3, quiet=0)"),
      pick("Disable", "/cmd.set('grid_mode', 0, quiet=0)"),
    ]),
    SEP,
    tog("Orthoscopic View", "/cmd.set('orthoscopic', 0 if cmd.get_setting_tuple('orthoscopic')[1][0] == 1 else 1, quiet=0)"),
    tog("Show Valences", "/cmd.set('valence', 0 if cmd.get_setting_tuple('valence')[1][0] == 1 else 1, quiet=0)"),
    tog("Smooth Lines", "/cmd.set('line_smooth', 0 if cmd.get_setting_tuple('line_smooth')[1][0] == 1 else 1, quiet=0)"),
    tog("Depth Cue (Fogging)", "/cmd.set('depth_cue', 0 if cmd.get_setting_tuple('depth_cue')[1][0] == 1 else 1, quiet=0)"),
    tog("Two Sided Lighting", "/cmd.set('two_sided_lighting', 0 if cmd.get_setting_tuple('two_sided_lighting')[1][0] == 1 else 1, quiet=0)"),
    tog("Specular Reflections", "/cmd.set('specular', 0 if cmd.get_setting_tuple('specular')[1][0] == 1.0 else 1.0, quiet=0)"),
    tog("Animation", "/cmd.set('animation', 0 if cmd.get_setting_tuple('animation')[1][0] == 1 else 1, quiet=0)"),
    tog("Roving Detail", "/cmd.set('roving_detail', 0 if cmd.get_setting_tuple('roving_detail')[1][0] == 1 else 1, quiet=0)"),
  ]),
  menu("Setting", [
    menu("Label", [
      menu("Size", [
        pick("10 Point", "/cmd.set('label_size', 10, quiet=0)"),
        pick("14 Point", "/cmd.set('label_size', 14, quiet=0)"),
        pick("18 Point", "/cmd.set('label_size', 18, quiet=0)"),
        pick("24 Point", "/cmd.set('label_size', 24, quiet=0)"),
        pick("36 Point", "/cmd.set('label_size', 36, quiet=0)"),
        pick("48 Point", "/cmd.set('label_size', 48, quiet=0)"),
        pick("72 Point", "/cmd.set('label_size', 72, quiet=0)"),
        SEP,
        pick("0.3 Angstrom", "/cmd.set('label_size', -0.3, quiet=0)"),
        pick("0.5 Angstrom", "/cmd.set('label_size', -0.5, quiet=0)"),
        pick("1 Angstrom", "/cmd.set('label_size', -1, quiet=0)"),
        pick("2 Angstrom", "/cmd.set('label_size', -2, quiet=0)"),
        pick("4 Angstrom", "/cmd.set('label_size', -4, quiet=0)"),
      ]),
      menu("Font", [
        pick("Sans", "/cmd.set('label_font_id', 5, quiet=0)"),
        pick("Sans Oblique", "/cmd.set('label_font_id', 6, quiet=0)"),
        pick("Sans Bold", "/cmd.set('label_font_id', 7, quiet=0)"),
        pick("Sans Bold Oblique", "/cmd.set('label_font_id', 8, quiet=0)"),
        pick("Serif", "/cmd.set('label_font_id', 9, quiet=0)"),
        pick("Serif Oblique", "/cmd.set('label_font_id', 17, quiet=0)"),
        pick("Serif Bold", "/cmd.set('label_font_id', 10, quiet=0)"),
        pick("Serif Bold Oblique", "/cmd.set('label_font_id', 18, quiet=0)"),
        pick("Mono", "/cmd.set('label_font_id', 11, quiet=0)"),
        pick("Mono Oblique", "/cmd.set('label_font_id', 12, quiet=0)"),
        pick("Mono Bold", "/cmd.set('label_font_id', 13, quiet=0)"),
        pick("Mono Bold Oblique", "/cmd.set('label_font_id', 14, quiet=0)"),
        pick("Gentium Roman", "/cmd.set('label_font_id', 15, quiet=0)"),
        pick("Gentium Italic", "/cmd.set('label_font_id', 16, quiet=0)"),
      ]),
      menu("Color", [
        pick("Front", "/cmd.set('label_color', -6, quiet=0)"),
        pick("Back", "/cmd.set('label_color', -7, quiet=0)"),
      ]),
      tog("Show Connectors", "/cmd.set('label_connector', 0 if cmd.get_setting_tuple('label_connector')[1][0] == 1 else 1, quiet=0)"),
      menu("Background Color", [
        pick("None", "/cmd.set('label_bg_color', -1, quiet=0)"),
        pick("Back", "/cmd.set('label_bg_color', -7, quiet=0)"),
        pick("Front", "/cmd.set('label_bg_color', -6, quiet=0)"),
      ]),
    ]),
    menu("Lines & Sticks", [
      tog("Ball and Stick", "/cmd.set('stick_ball', 0 if cmd.get_setting_tuple('stick_ball')[1][0] == 1 else 1, quiet=0)"),
      menu("Ball and Stick Ratio", [
        pick("1.0", "/cmd.set('stick_ball_ratio', 1.0, quiet=0)"),
        pick("1.5", "/cmd.set('stick_ball_ratio', 1.5, quiet=0)"),
        pick("VDW", "/cmd.set('stick_ball_ratio', -1.0, quiet=0)"),
      ]),
      SEP,
      menu("Zero Order Bonds", [
        pick("Hide", "/cmd.set('valence_zero_mode', 0, quiet=0)"),
        pick("Dashed", "/cmd.set('valence_zero_mode', 1, quiet=0)"),
        pick("Solid", "/cmd.set('valence_zero_mode', 2, quiet=0)"),
      ]),
      menu("Zero Order Stick Scale", [
        pick("0.1", "/cmd.set('valence_zero_scale', 0.1, quiet=0)"),
        pick("0.2", "/cmd.set('valence_zero_scale', 0.2, quiet=0)"),
        pick("0.3", "/cmd.set('valence_zero_scale', 0.3, quiet=0)"),
        pick("1.0", "/cmd.set('valence_zero_scale', 1.0, quiet=0)"),
      ]),
      SEP,
      menu("Stick Radius", [
        pick("0.1", "/cmd.set('stick_radius', 0.1, quiet=0)"),
        pick("0.2", "/cmd.set('stick_radius', 0.2, quiet=0)"),
        pick("0.25", "/cmd.set('stick_radius', 0.25, quiet=0)"),
      ]),
      menu("Stick Hydrogen Scale", [
        pick("0.4", "/cmd.set('stick_h_scale', 0.4, quiet=0)"),
        pick("1.0", "/cmd.set('stick_h_scale', 1.0, quiet=0)"),
      ]),
      SEP,
      menu("Line Width", [
        pick("1.0", "/cmd.set('line_width', 1.0, quiet=0)"),
        pick("1.49", "/cmd.set('line_width', 1.49, quiet=0)"),
        pick("3.0", "/cmd.set('line_width', 3.0, quiet=0)"),
      ]),
      tog("Lines As Cylinders", "/cmd.set('line_as_cylinders', 0 if cmd.get_setting_tuple('line_as_cylinders')[1][0] == 1 else 1, quiet=0)"),
    ]),
    menu("Cartoon", [
      menu("Rings and Bases", [
        pick("Filled Rings (Round Edges)", "/cmd.set('cartoon_ring_mode', 1, quiet=0)"),
        pick("Filled Rings (Flat Edges)", "/cmd.set('cartoon_ring_mode', 2, quiet=0)"),
        pick("Filled Rings (with Border)", "/cmd.set('cartoon_ring_mode', 3, quiet=0)"),
        pick("Spheres", "/cmd.set('cartoon_ring_mode', 4, quiet=0)"),
        pick("Base Ladders", "/cmd.set('cartoon_ring_mode', 0, quiet=0)"),
        SEP,
        pick("Bases and Sugars", "/cmd.set('cartoon_ring_finder', 1, quiet=0)"),
        pick("Bases Only", "/cmd.set('cartoon_ring_finder', 2, quiet=0)"),
        pick("Non-protein Rings", "/cmd.set('cartoon_ring_finder', 3, quiet=0)"),
        pick("All Rings", "/cmd.set('cartoon_ring_finder', 4, quiet=0)"),
        SEP,
        pick("Transparent Rings", "/cmd.set('cartoon_ring_transparency', 0.5, quiet=0)"),
        pick("Default", "/cmd.set('cartoon_ring_transparency', -1, quiet=0)"),
      ]),
      tog("Side Chain Helper", "/cmd.set('cartoon_side_chain_helper', 0 if cmd.get_setting_tuple('cartoon_side_chain_helper')[1][0] == 1 else 1, quiet=0)"),
      tog("Round Helices", "/cmd.set('cartoon_round_helices', 0 if cmd.get_setting_tuple('cartoon_round_helices')[1][0] == 1 else 1, quiet=0)"),
      tog("Fancy Helices", "/cmd.set('cartoon_fancy_helices', 0 if cmd.get_setting_tuple('cartoon_fancy_helices')[1][0] == 1 else 1, quiet=0)"),
      tog("Cylindrical Helices", "/cmd.set('cartoon_cylindrical_helices', 0 if cmd.get_setting_tuple('cartoon_cylindrical_helices')[1][0] == 1 else 1, quiet=0)"),
      tog("Flat Sheets", "/cmd.set('cartoon_flat_sheets', 0 if cmd.get_setting_tuple('cartoon_flat_sheets')[1][0] == 1 else 1, quiet=0)"),
      tog("Fancy Sheets", "/cmd.set('cartoon_fancy_sheets', 0 if cmd.get_setting_tuple('cartoon_fancy_sheets')[1][0] == 1 else 1, quiet=0)"),
      tog("Smooth Loops", "/cmd.set('cartoon_smooth_loops', 0 if cmd.get_setting_tuple('cartoon_smooth_loops')[1][0] == 1 else 1, quiet=0)"),
      tog("Discrete Colors", "/cmd.set('cartoon_discrete_colors', 0 if cmd.get_setting_tuple('cartoon_discrete_colors')[1][0] == 1 else 1, quiet=0)"),
      tog("Highlight Color", "/cmd.set('cartoon_highlight_color', -1 if cmd.get_setting_tuple('cartoon_highlight_color')[1][0] == 104 else 104, quiet=0)"),
      menu("Sampling", [
        pick("Atom count dependent", "/cmd.set('cartoon_sampling', -1, quiet=0)"),
        pick("2", "/cmd.set('cartoon_sampling', 2, quiet=0)"),
        pick("7", "/cmd.set('cartoon_sampling', 7, quiet=0)"),
        pick("14", "/cmd.set('cartoon_sampling', 14, quiet=0)"),
      ]),
      menu("Gap Cutoff", [
        pick("0", "/cmd.set('cartoon_gap_cutoff', 0, quiet=0)"),
        pick("5", "/cmd.set('cartoon_gap_cutoff', 5, quiet=0)"),
        pick("10", "/cmd.set('cartoon_gap_cutoff', 10, quiet=0)"),
        pick("20", "/cmd.set('cartoon_gap_cutoff', 20, quiet=0)"),
      ]),
    ]),
    menu("Ribbon", [
      tog("Side Chain Helper", "/cmd.set('ribbon_side_chain_helper', 0 if cmd.get_setting_tuple('ribbon_side_chain_helper')[1][0] == 1 else 1, quiet=0)"),
      tog("Trace Atoms", "/cmd.set('ribbon_trace_atoms', 0 if cmd.get_setting_tuple('ribbon_trace_atoms')[1][0] == 1 else 1, quiet=0)"),
      SEP,
      pick("As Lines", "/cmd.set('ribbon_as_cylinders', 0, quiet=0)"),
      pick("As Cylinders", "/cmd.set('ribbon_as_cylinders', 1, quiet=0)"),
      menu("Cylinder Radius", [
        pick("Match Line Width", "/cmd.set('ribbon_radius', 0.0, quiet=0)"),
        pick("0.2 Angstrom", "/cmd.set('ribbon_radius', 0.2, quiet=0)"),
        pick("0.5 Angstrom", "/cmd.set('ribbon_radius', 0.5, quiet=0)"),
        pick("1.0 Angstrom", "/cmd.set('ribbon_radius', 1.0, quiet=0)"),
      ]),
    ]),
    menu("Surface", [
      menu("Color", [
        pick("White", "/cmd.set('surface_color', 0, quiet=0)"),
        pick("Light Gray", "/cmd.set('surface_color', 4236, quiet=0)"),
        pick("Gray", "/cmd.set('surface_color', 25, quiet=0)"),
        pick("Default (Atomic)", "/cmd.set('surface_color', -1, quiet=0)"),
      ]),
      pick("Dot", "/cmd.set('surface_type', 1, quiet=0)"),
      pick("Wireframe", "/cmd.set('surface_type', 2, quiet=0)"),
      pick("Solid", "/cmd.set('surface_type', 0, quiet=0)"),
      SEP,
      pick("Cavities and Pockets Only", "/cmd.set('surface_cavity_mode', 1, quiet=0)"),
      pick("Cavities and Pockets (Culled)", "/cmd.set('surface_cavity_mode', 2, quiet=0)"),
      menu("Cavity Detection Radius", [
        pick("7 Angstrom", "/cmd.set('surface_cavity_radius', 7, quiet=0)"),
        pick("3 Solvent Radii", "/cmd.set('surface_cavity_radius', -3, quiet=0)"),
        pick("4 Solvent Radii", "/cmd.set('surface_cavity_radius', -4, quiet=0)"),
        pick("5 Solvent Radii", "/cmd.set('surface_cavity_radius', -5, quiet=0)"),
        pick("6 Solvent Radii", "/cmd.set('surface_cavity_radius', -6, quiet=0)"),
        pick("8 Solvent Radii", "/cmd.set('surface_cavity_radius', -8, quiet=0)"),
        pick("10 Solvent Radii", "/cmd.set('surface_cavity_radius', -10, quiet=0)"),
        pick("20 Solvent Radii", "/cmd.set('surface_cavity_radius', -20, quiet=0)"),
      ]),
      menu("Cavity Detection Cutoff", [
        pick("1 Solvent Radii", "/cmd.set('surface_cavity_cutoff', -1, quiet=0)"),
        pick("2 Solvent Radii", "/cmd.set('surface_cavity_cutoff', -2, quiet=0)"),
        pick("3 Solvent Radii", "/cmd.set('surface_cavity_cutoff', -3, quiet=0)"),
        pick("4 Solvent Radii", "/cmd.set('surface_cavity_cutoff', -4, quiet=0)"),
        pick("5 Solvent Radii", "/cmd.set('surface_cavity_cutoff', -5, quiet=0)"),
      ]),
      pick("Exterior (Normal)", "/cmd.set('surface_cavity_mode', 0, quiet=0)"),
      SEP,
      tog("Solvent Accessible", "/cmd.set('surface_solvent', 0 if cmd.get_setting_tuple('surface_solvent')[1][0] == 1 else 1, quiet=0)"),
      SEP,
      tog("Smooth Edges", "/cmd.set('surface_smooth_edges', 0 if cmd.get_setting_tuple('surface_smooth_edges')[1][0] == 1 else 1, quiet=0)"),
      tog("Edge Proximity", "/cmd.set('surface_proximity', 0 if cmd.get_setting_tuple('surface_proximity')[1][0] == 1 else 1, quiet=0)"),
      SEP,
      pick("Ignore None", "/cmd.set('surface_mode', 1, quiet=0)"),
      pick("Ignore HETATMs", "/cmd.set('surface_mode', 0, quiet=0)"),
      pick("Ignore Hydrogens", "/cmd.set('surface_mode', 2, quiet=0)"),
      pick("Ignore Unsurfaced", "/cmd.set('surface_mode', 3, quiet=0)"),
    ]),
    menu("Volume", [
      tog("Pre-integrated Rendering", "/cmd.set('volume_mode', 0 if cmd.get_setting_tuple('volume_mode')[1][0] == 1 else 1, quiet=0)"),
      menu("Number of Layers", [
        pick("100", "/cmd.set('volume_layers', 100.0, quiet=0)"),
        pick("256", "/cmd.set('volume_layers', 256.0, quiet=0)"),
        pick("500", "/cmd.set('volume_layers', 500.0, quiet=0)"),
        pick("1000", "/cmd.set('volume_layers', 1000.0, quiet=0)"),
      ]),
    ]),
    menu("Transparency", [
      menu("Surface", [
        pick("Off", "/cmd.set('transparency', 0.0, quiet=0)"),
        pick("20%", "/cmd.set('transparency', 0.2, quiet=0)"),
        pick("40%", "/cmd.set('transparency', 0.4, quiet=0)"),
        pick("50%", "/cmd.set('transparency', 0.5, quiet=0)"),
        pick("60%", "/cmd.set('transparency', 0.6, quiet=0)"),
        pick("80%", "/cmd.set('transparency', 0.8, quiet=0)"),
      ]),
      menu("Sphere", [
        pick("Off", "/cmd.set('sphere_transparency', 0.0, quiet=0)"),
        pick("20%", "/cmd.set('sphere_transparency', 0.2, quiet=0)"),
        pick("40%", "/cmd.set('sphere_transparency', 0.4, quiet=0)"),
        pick("50%", "/cmd.set('sphere_transparency', 0.5, quiet=0)"),
        pick("60%", "/cmd.set('sphere_transparency', 0.6, quiet=0)"),
        pick("80%", "/cmd.set('sphere_transparency', 0.8, quiet=0)"),
      ]),
      menu("Cartoon", [
        pick("Off", "/cmd.set('cartoon_transparency', 0.0, quiet=0)"),
        pick("20%", "/cmd.set('cartoon_transparency', 0.2, quiet=0)"),
        pick("40%", "/cmd.set('cartoon_transparency', 0.4, quiet=0)"),
        pick("50%", "/cmd.set('cartoon_transparency', 0.5, quiet=0)"),
        pick("60%", "/cmd.set('cartoon_transparency', 0.6, quiet=0)"),
        pick("80%", "/cmd.set('cartoon_transparency', 0.8, quiet=0)"),
      ]),
      menu("Stick", [
        pick("Off", "/cmd.set('stick_transparency', 0.0, quiet=0)"),
        pick("20%", "/cmd.set('stick_transparency', 0.2, quiet=0)"),
        pick("40%", "/cmd.set('stick_transparency', 0.4, quiet=0)"),
        pick("50%", "/cmd.set('stick_transparency', 0.5, quiet=0)"),
        pick("60%", "/cmd.set('stick_transparency', 0.6, quiet=0)"),
        pick("80%", "/cmd.set('stick_transparency', 0.8, quiet=0)"),
      ]),
      SEP,
      act("Uni-Layer", "/cmd.set('transparency_mode', 2, quiet=0); cmd.set('backface_cull', 1, quiet=0); cmd.set('two_sided_lighting', 0, quiet=0)"),
      act("Multi-Layer", "/cmd.set('transparency_mode', 1, quiet=0); cmd.set('backface_cull', 0, quiet=0); cmd.set('two_sided_lighting', 1, quiet=0)"),
      act("Multi-Layer (Real-time OIT)", "/cmd.set('transparency_mode', 3, quiet=0); cmd.set('backface_cull', 0, quiet=0); cmd.set('two_sided_lighting', -1, quiet=0)"),
      act("Fast and Ugly", "/cmd.set('transparency_mode', 0, quiet=0); cmd.set('backface_cull', 1, quiet=0); cmd.set('two_sided_lighting', 0, quiet=0)"),
      SEP,
      tog("Angle-dependent", "/cmd.set('ray_transparency_oblique', 0 if cmd.get_setting_tuple('ray_transparency_oblique')[1][0] == 1.0 else 1.0, quiet=0)"),
    ]),
    menu("Rendering", [
      tog("OpenGL 2.0 Shaders", "/cmd.set('use_shaders', 0 if cmd.get_setting_tuple('use_shaders')[1][0] == 1 else 1, quiet=0)"),
      SEP,
      tog("Antialias (Ray Tracing)", "/cmd.set('antialias', 0 if cmd.get_setting_tuple('antialias')[1][0] == 1 else 1, quiet=0)"),
      menu("Antialias (Real Time)", [
        pick("off", "/cmd.set('antialias_shader', 0, quiet=0)"),
        pick("FXAA", "/cmd.set('antialias_shader', 1, quiet=0)"),
        pick("SMAA", "/cmd.set('antialias_shader', 2, quiet=0)"),
      ]),
      SEP,
      act("Modernize", "/cmd.util.modernize_rendering(1, cmd)"),
      SEP,
      menu("Shadows", [
        act("None", "/cmd.util.ray_shadows('none')"),
        act("Light", "/cmd.util.ray_shadows('light')"),
        act("Medium", "/cmd.util.ray_shadows('medium')"),
        act("Heavy", "/cmd.util.ray_shadows('heavy')"),
        act("Black", "/cmd.util.ray_shadows('black')"),
        SEP,
        act("Matte", "/cmd.util.ray_shadows('matte')"),
        act("Soft", "/cmd.util.ray_shadows('soft')"),
        act("Occlusion", "/cmd.util.ray_shadows('occlusion')"),
        act("Occlusion2", "/cmd.util.ray_shadows('occlusion2')"),
      ]),
      menu("Texture", [
        pick("None", "/cmd.set('ray_texture', 0, quiet=0)"),
        pick("Matte 1", "/cmd.set('ray_texture', 1, quiet=0)"),
        pick("Matte 2", "/cmd.set('ray_texture', 4, quiet=0)"),
        pick("Swirl 1", "/cmd.set('ray_texture', 2, quiet=0)"),
        pick("Swirl 2", "/cmd.set('ray_texture', 3, quiet=0)"),
        pick("Fiber", "/cmd.set('ray_texture', 5, quiet=0)"),
      ]),
      menu("Interior Texture", [
        pick("None", "/cmd.set('ray_interior_texture', 0, quiet=0)"),
        pick("Matte 1", "/cmd.set('ray_interior_texture', 1, quiet=0)"),
        pick("Matte 2", "/cmd.set('ray_interior_texture', 4, quiet=0)"),
        pick("Swirl 1", "/cmd.set('ray_interior_texture', 2, quiet=0)"),
        pick("Swirl 2", "/cmd.set('ray_interior_texture', 3, quiet=0)"),
        pick("Fiber", "/cmd.set('ray_interior_texture', 5, quiet=0)"),
      ]),
      menu("Memory", [
        pick("Use Less (slower)", "/cmd.set('hash_max', 70, quiet=0)"),
        pick("Use Standard Amount", "/cmd.set('hash_max', 100, quiet=0)"),
        pick("Use More (faster)", "/cmd.set('hash_max', 170, quiet=0)"),
        pick("Use Even More", "/cmd.set('hash_max', 230, quiet=0)"),
        pick("Use Most", "/cmd.set('hash_max', 300, quiet=0)"),
      ]),
      SEP,
      tog("Cull Backfaces", "/cmd.set('backface_cull', 0 if cmd.get_setting_tuple('backface_cull')[1][0] == 1 else 1, quiet=0)"),
      tog("Opaque Interiors", "/cmd.set('ray_interior_color', -1 if cmd.get_setting_tuple('ray_interior_color')[1][0] == 74 else 74, quiet=0)"),
    ]),
    SEP,
    menu("PDB File Loading", [
      tog("Ignore PDB Segment Identifier", "/cmd.set('ignore_pdb_segi', 0 if cmd.get_setting_tuple('ignore_pdb_segi')[1][0] == 1 else 1, quiet=0)"),
    ]),
    menu("mmCIF File Loading", [
      tog("Use \"auth\" Identifiers", "/cmd.set('cif_use_auth', 0 if cmd.get_setting_tuple('cif_use_auth')[1][0] == 1 else 1, quiet=0)"),
      tog("Load Assembly (Biological Unit)", "/cmd.set('assembly', '' if cmd.get_setting_tuple('assembly')[1][0] == '1' else '1', quiet=0)"),
      tog("Bonding by \"Chemical Component Dictionary\"", "/cmd.set('connect_mode', 0 if cmd.get_setting_tuple('connect_mode')[1][0] == 4 else 4, quiet=0)"),
    ]),
    menu("Map File Loading", [
      tog("Normalize CCP4 Maps", "/cmd.set('normalize_ccp4_maps', 0 if cmd.get_setting_tuple('normalize_ccp4_maps')[1][0] == 1 else 1, quiet=0)"),
      tog("Normalize O Maps", "/cmd.set('normalize_o_maps', 0 if cmd.get_setting_tuple('normalize_o_maps')[1][0] == 1 else 1, quiet=0)"),
    ]),
    SEP,
    menu("Auto-Show ...", [
      tog("Cartoon/Sticks/Spheres by Classification", "/cmd.set('auto_show_classified', 0 if cmd.get_setting_tuple('auto_show_classified')[1][0] == -1 else -1, quiet=0)"),
      SEP,
      tog("Auto-Show Lines", "/cmd.set('auto_show_lines', 0 if cmd.get_setting_tuple('auto_show_lines')[1][0] == 1 else 1, quiet=0)"),
      tog("Auto-Show Spheres", "/cmd.set('auto_show_spheres', 0 if cmd.get_setting_tuple('auto_show_spheres')[1][0] == 1 else 1, quiet=0)"),
      tog("Auto-Show Nonbonded", "/cmd.set('auto_show_nonbonded', 0 if cmd.get_setting_tuple('auto_show_nonbonded')[1][0] == 1 else 1, quiet=0)"),
      SEP,
      tog("Auto-Show New Selections", "/cmd.set('auto_show_selections', 0 if cmd.get_setting_tuple('auto_show_selections')[1][0] == 1 else 1, quiet=0)"),
      tog("Auto-Hide Selections", "/cmd.set('auto_hide_selections', 0 if cmd.get_setting_tuple('auto_hide_selections')[1][0] == 1 else 1, quiet=0)"),
    ]),
    tog("Auto-Zoom New Objects", "/cmd.set('auto_zoom', 0 if cmd.get_setting_tuple('auto_zoom')[1][0] == 1 else 1, quiet=0)"),
    tog("Auto-Remove Hydrogens", "/cmd.set('auto_remove_hydrogens', 0 if cmd.get_setting_tuple('auto_remove_hydrogens')[1][0] == 1 else 1, quiet=0)"),
    SEP,
    tog("Show Text (Esc)", "/cmd.set('text', 0 if cmd.get_setting_tuple('text')[1][0] == 1 else 1, quiet=0)"),
    tog("Overlay Text", "/cmd.set('overlay', 0 if cmd.get_setting_tuple('overlay')[1][0] == 1 else 1, quiet=0)"),
  ]),
  menu("Scene", [
    act("Next [PgDn]", "/cmd.scene('', 'next')"),
    act("Previous [PgUp]", "/cmd.scene('', 'previous')"),
    SEP,
    act("Append", "scene new, store"),
    menu("Append...", [
      act("Camera", "scene new, store, color=0, rep=0"),
      act("Color", "scene new, store, view=0, rep=0"),
      act("Reps", "scene new, store, view=0, color=0"),
      act("Reps + Color", "scene new, store, view=0"),
    ]),
    act("Insert Before", "/cmd.scene('', 'insert_before')"),
    act("Insert After", "/cmd.scene('', 'insert_after')"),
    act("Update", "/cmd.scene('auto', 'update')"),
    SEP,
    act("Delete", "/cmd.scene('auto', 'clear')"),
    SEP,
    menu("Recall", [
      act("F1", "/cmd.scene('F1', 'recall')"),
      act("F2", "/cmd.scene('F2', 'recall')"),
      act("F3", "/cmd.scene('F3', 'recall')"),
      act("F4", "/cmd.scene('F4', 'recall')"),
      act("F5", "/cmd.scene('F5', 'recall')"),
      act("F6", "/cmd.scene('F6', 'recall')"),
      act("F7", "/cmd.scene('F7', 'recall')"),
      act("F8", "/cmd.scene('F8', 'recall')"),
      act("F9", "/cmd.scene('F9', 'recall')"),
      act("F10", "/cmd.scene('F10', 'recall')"),
      act("F11", "/cmd.scene('F11', 'recall')"),
      act("F12", "/cmd.scene('F12', 'recall')"),
    ]),
    menu("Store", [
      act("F1", "/cmd.scene('F1', 'store')"),
      act("F2", "/cmd.scene('F2', 'store')"),
      act("F3", "/cmd.scene('F3', 'store')"),
      act("F4", "/cmd.scene('F4', 'store')"),
      act("F5", "/cmd.scene('F5', 'store')"),
      act("F6", "/cmd.scene('F6', 'store')"),
      act("F7", "/cmd.scene('F7', 'store')"),
      act("F8", "/cmd.scene('F8', 'store')"),
      act("F9", "/cmd.scene('F9', 'store')"),
      act("F10", "/cmd.scene('F10', 'store')"),
      act("F11", "/cmd.scene('F11', 'store')"),
      act("F12", "/cmd.scene('F12', 'store')"),
    ]),
    menu("Clear", [
      act("F1", "/cmd.scene('F1', 'clear')"),
      act("F2", "/cmd.scene('F2', 'clear')"),
      act("F3", "/cmd.scene('F3', 'clear')"),
      act("F4", "/cmd.scene('F4', 'clear')"),
      act("F5", "/cmd.scene('F5', 'clear')"),
      act("F6", "/cmd.scene('F6', 'clear')"),
      act("F7", "/cmd.scene('F7', 'clear')"),
      act("F8", "/cmd.scene('F8', 'clear')"),
      act("F9", "/cmd.scene('F9', 'clear')"),
      act("F10", "/cmd.scene('F10', 'clear')"),
      act("F11", "/cmd.scene('F11', 'clear')"),
      act("F12", "/cmd.scene('F12', 'clear')"),
    ]),
    SEP,
    tog("Buttons", "/cmd.set('scene_buttons', 0 if cmd.get_setting_tuple('scene_buttons')[1][0] == 1 else 1, quiet=0)"),
    menu("Cache", [
      act("Enable", "/cmd.cache('enable')"),
      act("Optimize", "/cmd.cache('optimize')"),
      act("Read Only", "/cmd.cache('read_only')"),
      act("Disable", "/cmd.cache('disable')"),
    ]),
  ]),
  menu("Mouse", [
    menu("Selection Mode", [
      pick("Atoms", "/cmd.set('mouse_selection_mode', 0, quiet=0)"),
      pick("Residues", "/cmd.set('mouse_selection_mode', 1, quiet=0)"),
      pick("Chains", "/cmd.set('mouse_selection_mode', 2, quiet=0)"),
      pick("Segments", "/cmd.set('mouse_selection_mode', 3, quiet=0)"),
      pick("Objects", "/cmd.set('mouse_selection_mode', 4, quiet=0)"),
      pick("Molecules", "/cmd.set('mouse_selection_mode', 5, quiet=0)"),
      pick("C-alphas", "/cmd.set('mouse_selection_mode', 6, quiet=0)"),
    ]),
    SEP,
    act("3 Button Motions", "/cmd.config_mouse('three_button_motions')"),
    act("3 Button Editing", "/cmd.config_mouse('three_button_editing')"),
    act("3 Button Viewing", "/cmd.mouse('three_button_viewing')"),
    act("3 Button Lights", "/cmd.mouse('three_button_lights')"),
    act("3 Button All Modes", "/cmd.config_mouse('three_button_all_modes')"),
    act("2 Button Editing", "/cmd.config_mouse('two_button_editing')"),
    act("2 Button Viewing", "/cmd.config_mouse('two_button')"),
    act("1 Button Viewing Mode", "/cmd.mouse('one_button_viewing')"),
    act("Emulate Maestro", "/cmd.mouse('three_button_maestro')"),
    SEP,
    tog("Virtual Trackball", "/cmd.set('virtual_trackball', 0 if cmd.get_setting_tuple('virtual_trackball')[1][0] == 1 else 1, quiet=0)"),
    tog("Show Mouse Grid", "/cmd.set('mouse_grid', 0 if cmd.get_setting_tuple('mouse_grid')[1][0] == 1 else 1, quiet=0)"),
    tog("Roving Origin", "/cmd.set('roving_origin', 0 if cmd.get_setting_tuple('roving_origin')[1][0] == 1 else 1, quiet=0)"),
  ]),
  menu("Wizard", [
    act("Appearance", "wizard appearance"),
    act("Measurement", "wizard measurement"),
    menu("Mutagenesis", [
      act("Protein", "wizard mutagenesis"),
      act("Nucleic Acids", "wizard nucmutagenesis"),
    ]),
    act("Pair Fitting", "wizard pair_fit"),
    SEP,
    act("Density", "wizard density"),
    act("Filter", "wizard filter"),
    act("Sculpting", "wizard sculpting"),
    SEP,
    act("Label", "wizard label"),
    act("Charge", "wizard charge"),
    SEP,
    menu("Demo", [
      act("Representations", "/cmd.wizard('demo', 'reps')"),
      act("Cartoon Ribbons", "/cmd.wizard('demo', 'cartoon')"),
      act("Roving Detail", "/cmd.wizard('demo', 'roving')"),
      act("Roving Density", "/cmd.wizard('demo', 'roving_density')"),
      act("Transparency", "/cmd.wizard('demo', 'trans')"),
      act("Ray Tracing", "/cmd.wizard('demo', 'ray')"),
      act("Sculpting", "/cmd.wizard('demo', 'sculpt')"),
      act("Scripted Animation", "/cmd.wizard('demo', 'anime')"),
      act("Electrostatics", "/cmd.wizard('demo', 'elec')"),
      act("Compiled Graphics Objects", "/cmd.wizard('demo', 'cgo')"),
      act("Molscript/Raster3D Input", "/cmd.wizard('demo', 'raster3d')"),
      SEP,
      act("End Demonstration", "/cmd.replace_wizard('demo', 'finish')"),
    ]),
  ]),
]
