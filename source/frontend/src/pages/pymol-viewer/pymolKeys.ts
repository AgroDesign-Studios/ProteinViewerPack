/**
 * PyMOL's default shortcuts that Chrome on Windows keeps for itself, and the
 * chord that reaches PyMOL instead.
 *
 * Chrome never hands a page these keydowns — new tab, close tab, switch tab,
 * DevTools — so PyMOL's own binding for them is dead in a browser. The frame's
 * `host.js` takes the same chord with Alt added and sends PyMOL the original
 * (Ctrl+Alt+T arrives as Ctrl+T). Ctrl+Alt is free in both: Chrome on Windows
 * binds nothing to it, and PyMOL's Alt shortcuts take no Ctrl.
 *
 * `host.js` keeps its own copy of the ids (it cannot import this file); the
 * two must stay equal. Ids follow PyMOL's
 * `shortcut_dict`: `CTRL-` / `CTSH-` (Ctrl+Shift) + the key.
 */

export interface ReservedShortcut {
  /** PyMOL's `shortcut_dict` key. */
  id: string
  /** What PyMOL's own docs call it. */
  chord: string
  /** What to press in this page instead. */
  remapped: string
  /** The command PyMOL binds to it (its `shortcut_dict` entry). */
  command: string
}

export const CHROME_RESERVED_SHORTCUTS: readonly ReservedShortcut[] = Object.freeze([
  { id: 'CTRL-T', chord: 'Ctrl+T', remapped: 'Ctrl+Alt+T', command: 'bond;unpick' },
  { id: 'CTSH-N', chord: 'Ctrl+Shift+N', remapped: 'Ctrl+Alt+Shift+N', command: 'replace N,4,3' },
  { id: 'CTSH-T', chord: 'Ctrl+Shift+T', remapped: 'Ctrl+Alt+Shift+T', command: 'bond;unpick' },
  { id: 'CTSH-W', chord: 'Ctrl+Shift+W', remapped: 'Ctrl+Alt+Shift+W', command: 'cycle_valence' },
  { id: 'CTSH-I', chord: 'Ctrl+Shift+I', remapped: 'Ctrl+Alt+Shift+I', command: 'replace I,1,1' },
  { id: 'CTSH-J', chord: 'Ctrl+Shift+J', remapped: 'Ctrl+Alt+Shift+J', command: 'alter pk1,formal_charge=-1.' },
  { id: 'CTSH-C', chord: 'Ctrl+Shift+C', remapped: 'Ctrl+Alt+Shift+C', command: 'replace C,4,4' },
  { id: 'CTRL-F4', chord: 'Ctrl+F4', remapped: 'Ctrl+Alt+F4', command: 'scene F4, store' },
  { id: 'CTRL-pgup', chord: 'Ctrl+PgUp', remapped: 'Ctrl+Alt+PgUp', command: 'scene new, insert_before' },
  { id: 'CTRL-pgdn', chord: 'Ctrl+PgDn', remapped: 'Ctrl+Alt+PgDn', command: 'scene new, insert_after' },
  { id: 'CTSH-pgup', chord: 'Ctrl+Shift+PgUp', remapped: 'Ctrl+Alt+Shift+PgUp', command: 'scene new, insert_before' },
  { id: 'CTSH-pgdn', chord: 'Ctrl+Shift+PgDn', remapped: 'Ctrl+Alt+Shift+PgDn', command: 'scene new, insert_after' },
])

/** `[Ctrl-Shift-N]` in a PyMOL menu label, as PyMOL's `_gui.py` spells it, per id. */
const LABEL_HINT: ReadonlyMap<string, string> = new Map(
  CHROME_RESERVED_SHORTCUTS.flatMap(s => {
    const key = s.id.slice(5)
    if (!/^[A-Z]$/.test(key)) return []
    return [[`[${s.id.startsWith('CTSH-') ? 'Ctrl-Shift-' : 'Ctrl-'}${key}]`, `[${s.remapped.replace(/\+/g, '-')}]`] as [string, string]]
  }),
)

/**
 * A PyMOL menu label with the shortcut hint it names rewritten to the chord
 * that works here: "Nitrogen [Ctrl-Shift-N]" -> "Nitrogen [Ctrl-Alt-Shift-N]".
 */
export function menuLabel(label: string): string {
  return label.replace(/\[Ctrl-(?:Shift-)?[A-Z]\]/, hint => LABEL_HINT.get(hint) ?? hint)
}
