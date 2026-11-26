import { describe, expect, it } from 'vitest'

import { checkCommand, CommandHistory, HISTORY_SIZE, MAX_PASTE_LINES, splitPasted } from './pymolCommands'
import { LIMITS } from './pymolFrameProtocol'

describe('checkCommand', () => {
  it('trims, and has nothing to send for a blank line', () => {
    expect(checkCommand('  show sticks  ')).toEqual({ ok: true, text: 'show sticks' })
    expect(checkCommand('')).toEqual({ ok: false, reason: 'empty' })
    expect(checkCommand(' \t ')).toEqual({ ok: false, reason: 'empty' })
  })

  it('accepts exactly the protocol cap and refuses one character more, never cutting it', () => {
    const at = 'x'.repeat(LIMITS.commandChars)
    expect(checkCommand(at)).toEqual({ ok: true, text: at })
    expect(checkCommand(at + 'x')).toEqual({ ok: false, reason: 'too-long' })
    expect(LIMITS.commandChars).toBe(16 * 1024)
  })

  it('refuses a session load in any spelling (trap 49)', () => {
    for (const c of [
      'load shared.pse',
      'LOAD /tmp/x.PSE, obj',
      'load x.pze',
      'load x.psw.gz',
      'cmd.load("x.pse")',
      'load x.dat, format=pse',
      "/cmd.load('/tmp/a.pzw')",
      'set_session foo',
      '/cmd.set_session(s)',
      '/pymol.importing.load("x.pse")',
    ]) {
      expect(checkCommand(c), c).toEqual({ ok: false, reason: 'session-load' })
    }
  })

  it('lets everything else through, structure loads and names that merely contain the letters included', () => {
    for (const c of ['load ligand.sdf', 'save x.png', 'select pse_site, resi 10', 'color red, pse', 'show surface']) {
      expect(checkCommand(c).ok, c).toBe(true)
    }
  })
})

describe('splitPasted', () => {
  it('splits on every line ending and drops blank lines', () => {
    // Each keeps its line in the paste, the blank one counted (PT-3291 item 16).
    expect(splitPasted('hide everything\r\nshow cartoon\n\n  color red  \rzoom')).toEqual([
      { line: 1, text: 'hide everything' },
      { line: 2, text: 'show cartoon' },
      { line: 4, text: 'color red' },
      { line: 5, text: 'zoom' },
    ])
  })

  it('refuses a paste over the line limit as a whole', () => {
    expect(splitPasted(Array(MAX_PASTE_LINES).fill('zoom').join('\n'))).toHaveLength(MAX_PASTE_LINES)
    expect(splitPasted(Array(MAX_PASTE_LINES + 1).fill('zoom').join('\n'))).toBeNull()
  })
})

describe('CommandHistory', () => {
  it('walks back and forward, and returns to the draft past the newest', () => {
    const h = new CommandHistory()
    h.push('a')
    h.push('b')
    expect(h.older('draft')).toBe('b')
    expect(h.older('b')).toBe('a')
    expect(h.older('a')).toBeNull()
    expect(h.newer()).toBe('b')
    expect(h.newer()).toBe('draft')
    expect(h.newer()).toBeNull()
  })

  it('drops an immediate repeat and keeps the newest HISTORY_SIZE', () => {
    const h = new CommandHistory()
    h.push('zoom')
    h.push('zoom')
    expect(h.size).toBe(1)
    for (let i = 0; i < HISTORY_SIZE + 10; i++) h.push(`c${i}`)
    expect(h.size).toBe(HISTORY_SIZE)
    expect(h.older('')).toBe(`c${HISTORY_SIZE + 9}`)
  })
})
