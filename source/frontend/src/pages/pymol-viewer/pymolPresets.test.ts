import { act, renderHook } from '@testing-library/react'
import type { TFunction } from 'i18next'
import { describe, expect, it, vi } from 'vitest'

import { checkCommand } from './pymolCommands'
import { LIMITS } from './pymolFrameProtocol'
import { bColumnOf, PRESET_IDS, presetCommand, presetMenuLabels, presetOf, usePresetRunner } from './pymolPresets'

/** The translate function as the keys it was asked for. */
const t = ((key: string, vars?: Record<string, unknown>) => (vars ? `${key} ${JSON.stringify(vars)}` : key)) as unknown as TFunction

/** The body of one Python function in the preset source. */
function bodyOf(py: string, fn: string): string {
  const at = py.indexOf(`def ${fn}():\n`)
  if (at < 0) throw new Error('no ' + fn)
  return py.slice(at).split('\ndef ')[0]
}

/** The Python a preset's command line carries, decoded the way PyMOL reads it. */
function pythonOf(command: string): string {
  const m = /^_ \/exec\((.*)\)$/s.exec(command)
  if (!m) throw new Error('not an exec line: ' + command.slice(0, 40))
  return JSON.parse(m[1]) as string
}

describe('the 創薬表示 presets', () => {
  it('are each one physical command line the command line itself would also send', () => {
    for (const id of PRESET_IDS) {
      const cmd = presetCommand(id)
      expect(cmd, id).toMatch(/^_ \/exec\(".*"\)$/s)
      expect(cmd, id).not.toMatch(/[\r\n]/)
      expect(cmd.length, id).toBeLessThanOrEqual(LIMITS.commandChars)
      expect(checkCommand(cmd), id).toEqual({ ok: true, text: cmd })
    }
  })

  it('carry PyMOL\'s no-echo mark, so the frame\'s output does not print 5 KB of source (PT-3755 item 2)', () => {
    // `CmdDo` (layer4/Cmd.cpp) echoes `PyMOL>` + the line unless it starts
    // with `_`; `_ ` is stripped and the rest parsed, the leading `/` included.
    for (const id of PRESET_IDS) expect(presetCommand(id).slice(0, 3), id).toBe('_ /')
  })

  it('carry no semicolon (PyMOL splits a line on it before it sees the leading slash) and only ASCII', () => {
    for (const id of PRESET_IDS) {
      const cmd = presetCommand(id)
      expect(cmd, id).not.toContain(';')
      expect(/^[\x20-\x7e]*$/.test(cmd), id).toBe(true)
    }
  })

  it('run the source and then exactly the chosen preset, a function the source defines', () => {
    for (const id of PRESET_IDS) {
      const py = pythonOf(presetCommand(id))
      const call = /\n(_agdb_[a-z_]+)\(\)\n$/.exec(py)
      expect(call, id).not.toBeNull()
      expect(py, id).toContain(`\ndef ${call![1]}():\n`)
      // The call is the source's last line: nothing runs after the preset.
      expect(py.trimEnd().split('\n').pop(), id).toBe(`${call![1]}()`)
    }
    expect(new Set(PRESET_IDS.map(id => pythonOf(presetCommand(id)).trimEnd().split('\n').pop())).size).toBe(PRESET_IDS.length)
  })

  it('never reach the network, the file system or the OS, and never load or save', () => {
    const py = pythonOf(presetCommand('reset'))
    expect(py).not.toMatch(/\bfetch\b|https?:|\bos\b|subprocess|webbrowser|\bopen\(|\bload\w*\(|\bsave\(|\bpng\(|__import__|\beval\(/)
    // Every import is PyMOL's own.
    for (const line of py.split('\n').filter(l => /\bimport\b/.test(l))) {
      expect(line).toBe('from pymol import cmd as _agdb_cmd, util as _agdb_util')
    }
  })

  it('change nothing when the target is not decided: the two that need one return before any change', () => {
    const py = pythonOf(presetCommand('ligand-site'))
    for (const fn of ['_agdb_ligand_site', '_agdb_pocket']) {
      const body = py.slice(py.indexOf(`def ${fn}():\n`)).split('\ndef ')[0]
      expect(body.split('\n').slice(1, 3)).toEqual(['    if not _agdb_target():', '        return'])
    }
  })
})

describe('presetOf', () => {
  it('reads a preset action and nothing else', () => {
    expect(presetOf('preset:ligand-site')).toBe('ligand-site')
    expect(presetOf('preset:reset')).toBe('reset')
    expect(presetOf('preset:')).toBeNull()
    expect(presetOf('preset:constructor')).toBeNull()
    expect(presetOf('settings')).toBeNull()
    expect(presetOf('keys')).toBeNull()
  })
})

describe('bColumnOf', () => {
  it('reads pLDDT for every predicted source, and B-factor otherwise', () => {
    for (const s of ['alphafold', 'boltz2', 'in_house_pred']) expect(bColumnOf(s), s).toBe('plddt')
    for (const s of ['rcsb_pdb', 'in_house_exp', '', null, undefined]) expect(bColumnOf(s), String(s)).toBe('bfactor')
  })
})

describe('what the presets touch and leave alone (PT-3754, PT-3770)', () => {
  const py = pythonOf(presetCommand('reset'))

  it('give every hide, show and zoom an atom selection: the bare `all` also reached meshes and measurements', () => {
    // One call per line, so a call runs to the line's end: `(all)` has a ')' of its own.
    const calls = py.match(/_agdb_cmd\.(?:hide|show|zoom)\(.*\)$/gm) ?? []
    expect(calls.length).toBeGreaterThan(15)
    for (const call of calls) {
      const args = call.slice(call.indexOf('(') + 1, -1).split(', ')
      // hide/show take (representation, selection); zoom takes the selection first.
      const selection = call.includes('.zoom(') ? args[0] : args[1]
      expect(selection, call).toMatch(/^'[^']+'$/)
      expect(selection, call).not.toBe("'all'")
    }
  })

  it('pick the target as sele, then the previous target, then the only ligand', () => {
    const target = bodyOf(py, '_agdb_target')
    const sele = target.indexOf("'byres (sele)'")
    const previous = target.indexOf("_agdb_cmd.count_atoms('dd_target') > 0:\n        return True")
    const only = target.indexOf('if len(found) == 1:')
    expect(sele).toBeGreaterThan(0)
    expect(previous).toBeGreaterThan(sele)
    expect(only).toBeGreaterThan(previous)
    // sele is used once, so one no longer shown cannot keep winning.
    expect(target).toContain("_agdb_cmd.select('dd_target', 'byres (sele)', enable=0)\n        _agdb_cmd.delete('sele')\n        return True")
  })

  it('only read PyMOL while the target is undecided: each change is followed at once by `return True` (PT-3755 item 5)', () => {
    const target = bodyOf(py, '_agdb_target')
    const lines = target.split('\n')
    const calls = lines.flatMap((line, i) => [...line.matchAll(/_agdb_cmd\.(\w+)\(/g)].map(m => ({ fn: m[1], i })))
    const changes = calls.filter(c => !['get_names', 'count_atoms', 'iterate', 'wizard'].includes(c.fn))
    // Only the two that set the target: sele copied (then deleted), or the one ligand.
    expect(changes.map(c => c.fn)).toEqual(['select', 'delete', 'select'])
    for (const c of changes) {
      const next = lines
        .slice(c.i + 1)
        .map(l => l.trim())
        .find(l => !l.startsWith('_agdb_cmd.select(') && !l.startsWith('_agdb_cmd.delete('))
      expect(next, lines[c.i]).toBe('return True')
    }
    // `iterate` only fills a local set; its expression changes no atom.
    expect(target).toContain("'found.add((model, segi, chain, resn, resi))', space={'found': found}")
    // Undecided ends in the one `return False`, after PyMOL's message.
    expect(target.match(/return False/g)).toHaveLength(1)
    expect(target.trimEnd().endsWith('return False')).toBe(true)
  })

  it('without a target or anything to colour, only ask PyMOL to say so: nothing is selected, hidden or coloured', () => {
    const target = bodyOf(py, '_agdb_target')
    const noTarget = target.slice(target.indexOf('    if found:'))
    expect(noTarget.match(/_agdb_\w+\.\w+\(/g)).toEqual(['_agdb_cmd.wizard(', '_agdb_cmd.wizard('])
    for (const fn of ['_agdb_bfactor', '_agdb_plddt']) {
      const body = bodyOf(py, fn)
      const stop = body.lastIndexOf('        return\n')
      expect(stop, fn).toBeGreaterThan(0)
      expect(body.slice(0, stop).match(/_agdb_cmd\.(?:color|spectrum|set_color|hide|show|set)\(/g), fn).toBeNull()
      expect(body.slice(0, stop), fn).toContain("_agdb_cmd.wizard('message', 'Drug discovery: ")
    }
    // A B-factor column with one value has no range to colour.
    expect(bodyOf(py, '_agdb_bfactor')).toContain('if max(bs) - min(bs) < 1e-6:')
    // A column of 0-1 values (or zeros) is no pLDDT on the 0-100 scale the
    // bands read: every residue would come out "very low" (PT-3801 item 12).
    // The check reads the CA atoms, and comes before the first colour.
    const plddt = bodyOf(py, '_agdb_plddt')
    expect(plddt).toContain("bs = [a.b for a in _agdb_cmd.get_model('polymer and name CA').atom]")
    expect(plddt.indexOf('    if max(bs) <= 1:\n')).toBeGreaterThan(0)
    expect(plddt.indexOf('    if max(bs) <= 1:\n')).toBeLessThan(plddt.indexOf('_agdb_cmd.set_color('))
  })

  it('go back without PyMOL presets, deleting only what the presets made', () => {
    expect(py).not.toMatch(/preset|classified/)
    const deleted = [...bodyOf(py, '_agdb_reset').matchAll(/_agdb_cmd\.delete\(([^)]*)\)/g)].map(m => m[1])
    expect(deleted).toEqual(['n'])
    expect(bodyOf(py, '_agdb_reset')).toContain("for n in ('dd_contacts', 'dd_target', 'dd_site', 'dd_pocket'):")
  })
})

describe('presetMenuLabels', () => {
  it('opens exactly one colouring by the B-factor column and locks the other with its reason', () => {
    const predicted = presetMenuLabels(t, 'plddt')
    expect(predicted.bfactorLocked).toBe('pymol:preset_bfactor_locked')
    expect(predicted.plddtLocked).toBeNull()
    const experimental = presetMenuLabels(t, 'bfactor')
    expect(experimental.bfactorLocked).toBeNull()
    expect(experimental.plddtLocked).toBe('pymol:preset_plddt_locked')
    expect(experimental.title).toBe('pymol:menu_presets')
    expect(experimental.items.reset).toBe('pymol:preset_reset')
  })
})

describe('usePresetRunner', () => {
  function setup(run: (cmd: string) => Promise<void>) {
    const say = vi.fn()
    const hook = renderHook(p => usePresetRunner(p), { initialProps: { run, say, t, epoch: '5:0' } })
    return { say, run, ...hook }
  }
  /** A run whose answers the test gives, in any order. */
  function deferred() {
    const finishers: Array<{ ok: () => void; fail: (e: Error) => void }> = []
    const run = vi.fn((_cmd: string) => new Promise<void>((ok, fail) => { finishers.push({ ok, fail }) }))
    return { run, finishers }
  }

  it('sends the preset and says its note once PyMOL has run it', async () => {
    const run = vi.fn((_cmd: string) => Promise.resolve())
    const { say, result } = setup(run)
    await act(async () => result.current.runPreset('pocket'))
    // Its menu name goes with it, for the busy bar (PT-3755 item 1).
    expect(run).toHaveBeenCalledWith(presetCommand('pocket'), { label: 'pymol:preset_pocket' })
    expect(say).toHaveBeenLastCalledWith('pymol:preset_note_pocket')
  })

  it('says a failed preset as a failed menu command, and nothing for a menu command that worked', async () => {
    const { say, result } = setup(() => Promise.reject(new Error('PyMOL is not ready')))
    await act(async () => result.current.runPreset('bfactor'))
    expect(say).toHaveBeenLastCalledWith('pymol:menu_failed {"detail":"pymol:detail_not_ready"}')
    const ok = setup(() => Promise.resolve())
    await act(async () => ok.result.current.runMenuCommand('zoom'))
    expect(ok.say).toHaveBeenLastCalledWith('')
  })

  it('clears the line for another structure, a rebuilt frame or a Retry, and drops a note still on its way', async () => {
    const { run, finishers } = deferred()
    const { say, result, rerender } = setup(run)
    act(() => result.current.runPreset('ligand-site'))
    rerender({ run, say, t, epoch: '6:0' })
    expect(say).toHaveBeenLastCalledWith('')
    await act(async () => finishers[0].ok())
    act(() => result.current.runPreset('pocket'))
    act(() => result.current.clear())
    expect(say).toHaveBeenLastCalledWith('')
    await act(async () => finishers[1].ok())
    expect(say).not.toHaveBeenCalledWith('pymol:preset_note_ligand_site')
    expect(say).not.toHaveBeenCalledWith('pymol:preset_note_pocket')
  })

  it('empties a note already on the line for another structure, a Retry, or anything sent (PT-3795)', async () => {
    const run = vi.fn((_cmd: string) => Promise.resolve())
    const { say, result, rerender } = setup(run)
    // Each step starts from a note on the line, so only the step itself can empty it.
    const noteThen = async (step: () => void) => {
      await act(async () => result.current.runPreset('pocket'))
      expect(say).toHaveBeenLastCalledWith('pymol:preset_note_pocket')
      act(step)
      expect(say).toHaveBeenLastCalledWith('')
    }
    await noteThen(() => rerender({ run, say, t, epoch: '6:0' }))
    await noteThen(() => result.current.clear())
    await noteThen(() => void result.current.send('hide surface, (all)'))
    expect(run).toHaveBeenLastCalledWith('hide surface, (all)')
  })

  it('lets anything sent later win over an earlier preset or menu command still running, from any path', async () => {
    const { run, finishers } = deferred()
    const { say, result } = setup(run)
    act(() => result.current.runPreset('ligand-site'))
    act(() => result.current.runPreset('reset'))
    await act(async () => {
      finishers[1].ok()
      finishers[0].ok()
    })
    expect(say).toHaveBeenLastCalledWith('pymol:preset_note_reset')
    expect(say).not.toHaveBeenCalledWith('pymol:preset_note_ligand_site')
    // The command line and the dialogs send through `send`: it passes the
    // command on unchanged and makes any earlier note or failure stale.
    act(() => result.current.runPreset('publication'))
    act(() => result.current.runMenuCommand('bad'))
    act(() => void result.current.send('hide everything, (all)'))
    expect(run).toHaveBeenLastCalledWith('hide everything, (all)')
    await act(async () => {
      finishers[2].ok()
      finishers[3].fail(new Error('late'))
      finishers[4].ok()
    })
    expect(say).not.toHaveBeenCalledWith('pymol:preset_note_publication')
    expect(say).not.toHaveBeenCalledWith('pymol:menu_failed {"detail":"late"}')
  })
})

