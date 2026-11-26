/**
 * The 創薬表示 menu (drug-discovery views): one-press looks a chemist asks
 * PyMOL for again and again — the ligand's surroundings, the pocket surface,
 * colouring by B-factor or pLDDT, publication settings — and the way back.
 * Owner ruling 2026-10-17 「推奨の方法で。」 on the dual UI consult (Fable +
 * Codex astra): a top-level menu, the target chosen inside PyMOL, never a
 * read-back of PyMOL's state.
 *
 * Each entry sends ONE command line, `_ /exec("<python>")`: the whole preset
 * runs as one Python statement in the frame, so a preset that cannot pick its
 * target changes nothing at all. Everything here is this repository's text —
 * no value from the frame or the address is ever put into it.
 *
 * The target (ligand site, pocket), in order: the user's selection `sele`
 * when it holds atoms (copied into `dd_target`, then deleted, so a
 * selection no longer shown cannot keep winning); else the previous preset's
 * target, `dd_target`, which the way back deletes (so ligand site and then
 * pocket work on one click, PT-3770); else the structure's one ligand
 * (`organic`, crystallisation additives and glycans left out). Anything else
 * — two ligands, many copies of one ligand, none — and PyMOL's own message
 * box says so and asks for a click; the colourings do the same when there is
 * nothing to colour. The page cannot know which happened (it reads nothing
 * back), so its status line states the rule instead. PyMOL draws that box in
 * its own font, which has no Japanese, hence English there.
 *
 * Every hide, show and zoom names atoms — `(all)`, not the bare `all`, which
 * also reaches the density meshes and measurements and so made them vanish for
 * good (PT-3754, measured: `hide everything` emptied an isomesh's and a
 * distance's representations, `hide everything, (all)` left both). The way
 * back shows the load's representations by name rather than through PyMOL's
 * `preset.classified`, whose preparation also deletes PyMOL's own
 * polar-contact objects and the user's per-object settings (PT-3770); it
 * deletes only the objects and selections the presets made.
 *
 * Measured on the vendored runtime (1HPV, 2026-10-17): each preset runs
 * without an exception, and two ligands stop the ligand-site preset with no
 * change.
 */
import { useCallback, useEffect, useRef } from 'react'
import type { TFunction } from 'i18next'

import type { PresetMenuLabels } from './pymolMenuData'
import { commandDetailText } from './pymolCommandText'

export const PRESET_IDS = ['ligand-site', 'pocket', 'bfactor', 'plddt', 'publication', 'reset'] as const
export type PresetId = (typeof PRESET_IDS)[number]

/**
 * What a structure's B-factor column holds, by its source: `plddt` for the
 * predicted-structure sources `bColumnOf` lists, and `bfactor` for everything
 * else. It is the rule the
 * other structure viewers use, so a different rule for one source would
 * change what every viewer says about it — the owner's call, not this menu's. The pLDDT
 * colouring itself refuses a column whose CA values all lie between 0 and 1
 * (`_agdb_plddt`): on the 0-100 scale its bands read, that is a 0-1 score or
 * no score at all, and every residue would come out "very low" (PT-3801
 * item 12).
 */
export type BColumn = 'plddt' | 'bfactor'
export function bColumnOf(source: string | null | undefined): BColumn {
  return source === 'alphafold' || source === 'boltz2' || source === 'in_house_pred' ? 'plddt' : 'bfactor'
}

// PyMOL's defaults on the vendored runtime for every setting a preset changes
// (read with cmd.get on a fresh frame), so "back" is the load's look.
// No ';' anywhere: PyMOL's parser splits a command line on it before it sees
// the leading '/'.
const PRESET_PY = String.raw`from pymol import cmd as _agdb_cmd, util as _agdb_util
_agdb_skip = 'GOL+EDO+PEG+PGE+PG4+1PE+P6G+ACT+ACY+FMT+DMS+MPD+TRS+MES+EPE+BME+CIT+IMD+NAG+NDG+MAN+BMA+FUC+GAL'
def _agdb_quiet():
    w = _agdb_cmd.get_wizard()
    if w is not None and str((w.get_prompt() or [''])[0]).startswith('Drug discovery:'):
        _agdb_cmd.wizard()
def _agdb_target():
    if 'sele' in _agdb_cmd.get_names('selections') and _agdb_cmd.count_atoms('sele') > 0:
        _agdb_cmd.select('dd_target', 'byres (sele)', enable=0)
        _agdb_cmd.delete('sele')
        return True
    if 'dd_target' in _agdb_cmd.get_names('selections') and _agdb_cmd.count_atoms('dd_target') > 0:
        return True
    found = set()
    _agdb_cmd.iterate('organic and not resn ' + _agdb_skip, 'found.add((model, segi, chain, resn, resi))', space={'found': found})
    if len(found) == 1:
        _agdb_cmd.select('dd_target', 'byres (organic and not resn ' + _agdb_skip + ')', enable=0)
        return True
    if found:
        _agdb_cmd.wizard('message', 'Drug discovery: %d ligands found, so nothing was changed.' % len(found), 'Click one atom of the ligand you want, then choose the menu item again.')
    else:
        _agdb_cmd.wizard('message', 'Drug discovery: no ligand found, so nothing was changed.', 'Click one atom of what you want to look at, then choose the menu item again.')
    return False
def _agdb_unlabel():
    if 'dd_site' in _agdb_cmd.get_names('selections'):
        _agdb_cmd.label('dd_site', '')
def _agdb_ligand_site():
    if not _agdb_target():
        return
    _agdb_quiet()
    _agdb_unlabel()
    _agdb_cmd.select('dd_site', 'byres ((polymer or solvent) within 5 of dd_target) and not dd_target', enable=0)
    _agdb_cmd.delete('dd_contacts')
    _agdb_cmd.hide('everything', '(all)')
    _agdb_cmd.show('cartoon', 'polymer')
    _agdb_cmd.set('cartoon_transparency', 0.5)
    _agdb_cmd.show('sticks', 'dd_target')
    _agdb_cmd.show('sticks', 'dd_site and polymer and (sidechain or name CA)')
    _agdb_cmd.show('nb_spheres', 'dd_site and solvent')
    _agdb_cmd.distance('dd_contacts', 'dd_target', 'dd_site', mode=2, label=0)
    _agdb_cmd.hide('labels', 'dd_contacts')
    _agdb_util.cnc('dd_target or dd_site')
    _agdb_cmd.color('yellow', 'dd_target and elem C')
    _agdb_cmd.label('dd_site and polymer and name CA', "resn + resi + (chain and ':' + chain)")
    _agdb_cmd.zoom('dd_target', 6, animate=0)
def _agdb_pocket():
    if not _agdb_target():
        return
    _agdb_quiet()
    _agdb_cmd.select('dd_pocket', 'byres (polymer within 6 of dd_target)', enable=0)
    _agdb_cmd.hide('surface', '(all)')
    _agdb_cmd.show('sticks', 'dd_target')
    _agdb_cmd.show('surface', 'dd_pocket')
    _agdb_cmd.set('transparency', 0.5)
    _agdb_util.cnc('dd_target')
    _agdb_cmd.color('yellow', 'dd_target and elem C')
    _agdb_cmd.set('two_sided_lighting', 1)
    _agdb_cmd.zoom('dd_target', 8, animate=0)
def _agdb_bfactor():
    bs = [a.b for a in _agdb_cmd.get_model('polymer and name CA').atom]
    if not bs:
        _agdb_cmd.wizard('message', 'Drug discovery: no protein CA atoms, so nothing was changed.')
        return
    if max(bs) - min(bs) < 1e-6:
        _agdb_cmd.wizard('message', 'Drug discovery: every CA atom has B-factor %.2f, so nothing was changed.' % bs[0])
        return
    _agdb_quiet()
    _agdb_cmd.spectrum('b', 'blue_white_red', 'polymer', min(bs), max(bs))
def _agdb_plddt():
    bs = [a.b for a in _agdb_cmd.get_model('polymer and name CA').atom]
    if not bs:
        _agdb_cmd.wizard('message', 'Drug discovery: no protein CA atoms, so nothing was changed.')
        return
    if max(bs) <= 1:
        _agdb_cmd.wizard('message', 'Drug discovery: every CA atom has a B value between 0 and 1, not a pLDDT on the 0-100 scale, so nothing was changed.')
        return
    _agdb_quiet()
    _agdb_cmd.set_color('dd_plddt_vh', [0.0, 0.325, 0.839])
    _agdb_cmd.set_color('dd_plddt_h', [0.396, 0.796, 0.953])
    _agdb_cmd.set_color('dd_plddt_l', [1.0, 0.859, 0.075])
    _agdb_cmd.set_color('dd_plddt_vl', [1.0, 0.49, 0.271])
    _agdb_cmd.color('dd_plddt_vl', 'polymer')
    _agdb_cmd.color('dd_plddt_l', 'polymer and not (b < 50)')
    _agdb_cmd.color('dd_plddt_h', 'polymer and not (b < 70)')
    _agdb_cmd.color('dd_plddt_vh', 'polymer and (b > 90)')
def _agdb_publication():
    _agdb_quiet()
    _agdb_cmd.bg_color('white')
    for k, v in (('ray_opaque_background', 1), ('antialias', 2), ('depth_cue', 0), ('ray_trace_fog', 0), ('ray_shadows', 0), ('cartoon_fancy_helices', 1)):
        _agdb_cmd.set(k, v)
def _agdb_reset():
    _agdb_quiet()
    _agdb_unlabel()
    for n in ('dd_contacts', 'dd_target', 'dd_site', 'dd_pocket'):
        _agdb_cmd.delete(n)
    _agdb_cmd.hide('everything', '(all)')
    _agdb_cmd.show('cartoon', 'polymer')
    _agdb_cmd.show('sticks', 'organic')
    _agdb_cmd.show('spheres', 'inorganic')
    _agdb_cmd.show('lines', 'solvent')
    _agdb_cmd.show('nonbonded', 'solvent')
    _agdb_cmd.show('nb_spheres', 'organic')
    for o in _agdb_cmd.get_object_list():
        i = _agdb_cmd.get_object_color_index(o)
        _agdb_util.cnc(o)
        if i >= 0:
            _agdb_cmd.color(str(i), o + ' and elem C')
    _agdb_cmd.bg_color('black')
    for k, v in (('ray_opaque_background', -1), ('antialias', 1), ('depth_cue', 1), ('ray_trace_fog', -1), ('ray_shadows', 1), ('cartoon_fancy_helices', 0), ('transparency', 0), ('cartoon_transparency', 0), ('two_sided_lighting', -1)):
        _agdb_cmd.set(k, v)
    _agdb_cmd.zoom('(all)', animate=0)
`

const PRESET_FN: Readonly<Record<PresetId, string>> = {
  'ligand-site': '_agdb_ligand_site',
  pocket: '_agdb_pocket',
  bfactor: '_agdb_bfactor',
  plddt: '_agdb_plddt',
  publication: '_agdb_publication',
  reset: '_agdb_reset',
}

/**
 * The one command line a preset sends: PyMOL's explicit-Python prefix `/`,
 * then `exec` of the source and the preset's call. The JSON string is a valid
 * Python string literal (the source is ASCII), and it puts the newlines the
 * function bodies need on a single physical line. The leading `_ ` is PyMOL's
 * no-echo mark: `cmd.do` (layer4 `CmdDo`) otherwise prints every line it runs
 * as `PyMOL>` + the line into the frame's own output, here 5 KB of source
 * (PT-3755 item 2); it strips the mark and parses the rest as before.
 */
export function presetCommand(id: PresetId): string {
  return `_ /exec(${JSON.stringify(`${PRESET_PY}${PRESET_FN[id]}()\n`)})`
}

/** Each preset's menu entry: also what the busy bar names while it runs. */
const PRESET_LABEL: Readonly<Record<PresetId, string>> = {
  'ligand-site': 'pymol:preset_ligand_site',
  pocket: 'pymol:preset_pocket',
  bfactor: 'pymol:preset_bfactor',
  plddt: 'pymol:preset_plddt',
  publication: 'pymol:preset_publication',
  reset: 'pymol:preset_reset',
}

/** The preset a menu action names, or null for any other action. */
export function presetOf(action: string): PresetId | null {
  if (!action.startsWith('preset:')) return null
  const id = action.slice('preset:'.length)
  return (PRESET_IDS as readonly string[]).includes(id) ? (id as PresetId) : null
}

/**
 * The menu's text for a structure. Exactly one of the two colourings by the
 * B-factor column is open: a pLDDT column read with the B-factor legend comes
 * out backwards — blue (low) means LEAST confident (PT-3754) — and a real
 * B-factor column has no pLDDT. The other is locked with the reason, never
 * hidden (owner ruling 2026-08-02).
 */
export function presetMenuLabels(t: TFunction, column: BColumn): PresetMenuLabels {
  return {
    title: t('pymol:menu_presets'),
    items: {
      'ligand-site': t(PRESET_LABEL['ligand-site']),
      pocket: t(PRESET_LABEL.pocket),
      bfactor: t(PRESET_LABEL.bfactor),
      plddt: t(PRESET_LABEL.plddt),
      publication: t(PRESET_LABEL.publication),
      reset: t(PRESET_LABEL.reset),
    },
    bfactorLocked: column === 'plddt' ? t('pymol:preset_bfactor_locked') : null,
    plddtLocked: column === 'bfactor' ? t('pymol:preset_plddt_locked') : null,
  }
}

/** What the status line says once each preset has run. */
const PRESET_NOTE: Readonly<Record<PresetId, string>> = {
  'ligand-site': 'pymol:preset_note_ligand_site',
  pocket: 'pymol:preset_note_pocket',
  bfactor: 'pymol:preset_note_bfactor',
  plddt: 'pymol:preset_note_plddt',
  publication: 'pymol:preset_note_publication',
  reset: 'pymol:preset_note_reset',
}

/**
 * The menu's status line, and the commands the user sends, in one order.
 * A preset's note, or a menu command's failure, is said once PyMOL has
 * answered — and only if nothing newer came since: a preset, a menu command,
 * the command line or the settings dialog's PyMOL settings (`send`), a page
 * action that changes the picture (`clear`, such as Retry), or a change of
 * `epoch` (another structure, a rebuilt frame). Each of them also
 * empties the line at once (PT-3754, PT-3770, PT-3795).
 *
 * A note can still outlive the look it describes, because some changes never
 * reach this runner (PT-3801 item 1):
 * - edits made inside PyMOL's own window — its built-in menus and mouse
 *   editing (the frame starts PyMOL with its GUI);
 *   the page reads nothing back, so it cannot see them;
 * - anything the page adds to the picture once it has finished loading: the
 *   page empties the line when the load starts, but a preset pressed while
 *   it loads keeps its note after it is in;
 * - the display scale, also the one in the settings dialog, which changes no
 *   representation.
 * A preset goes to `run` with its menu name as `label`, for the busy bar
 * (PT-3755 item 1).
 */
export function usePresetRunner(opts: {
  run: (cmd: string, opts?: { label: string }) => Promise<void>
  say: (message: string) => void
  t: TFunction
  epoch: string
}): {
  runPreset: (id: PresetId) => void
  runMenuCommand: (cmd: string) => void
  send: (cmd: string) => Promise<void>
  clear: () => void
} {
  const { run, say, t, epoch } = opts
  const seq = useRef(0)
  useEffect(() => {
    seq.current += 1
    say('')
  }, [epoch, say])
  const clear = useCallback(() => {
    seq.current += 1
    say('')
  }, [say])
  const send = useCallback(
    (cmd: string) => {
      seq.current += 1
      say('')
      return run(cmd)
    },
    [run, say],
  )
  const report = useCallback(
    (cmd: string, note: string | null, label?: string) => {
      const mine = ++seq.current
      say('')
      const sent = label === undefined ? run(cmd) : run(cmd, { label })
      sent.then(
        () => {
          if (note !== null && mine === seq.current) say(t(note))
        },
        (e: unknown) => {
          if (mine === seq.current) say(t('pymol:menu_failed', { detail: commandDetailText(t, e) }))
        },
      )
    },
    [run, say, t],
  )
  const runPreset = useCallback((id: PresetId) => report(presetCommand(id), PRESET_NOTE[id], t(PRESET_LABEL[id])), [report, t])
  const runMenuCommand = useCallback((cmd: string) => report(cmd, null), [report])
  return { runPreset, runMenuCommand, send, clear }
}
