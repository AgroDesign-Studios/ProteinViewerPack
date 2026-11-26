/**
 * The phone's object list (owner 2026-11-19): the worker's report read
 * field by field, and the one command an action becomes — integers and
 * listed words only, never a name.
 */
import { describe, expect, it } from 'vitest'

import { objectActionCommand, objectsOf } from './pymolObjects'

describe('objectsOf', () => {
  it('reads names, kinds and switches; an unknown kind is other, and focus and reps only when they fit', () => {
    const o = objectsOf({
      v: 3,
      items: [
        ['1abc', 'molecule', true],
        ['sele', 'selection', false],
        ['odd', 'object:alignment', true],
      ],
      more: true,
      focus: 0,
      reps: ['cartoon', 'sticks', 'dots'],
    })
    expect(o).toEqual({
      v: 3,
      items: [
        { name: '1abc', kind: 'molecule', on: true },
        { name: 'sele', kind: 'selection', on: false },
        { name: 'odd', kind: 'other', on: true },
      ],
      more: true,
      focus: 0,
      reps: ['cartoon', 'sticks'],
    })
    expect(objectsOf({ v: 1, items: [['a', 'molecule', true]], focus: -1, reps: [] })?.focus).toBe(-1)
    expect(objectsOf({ v: 1, items: [['a', 'molecule', true]], focus: 5, reps: [] })).toMatchObject({ focus: null, reps: null })
  })

  it('refuses a report that is not a list: no version, a version that is not a count, an entry without a name', () => {
    expect(objectsOf({ items: [] })).toBeNull()
    expect(objectsOf({ v: -1, items: [] })).toBeNull()
    expect(objectsOf({ v: 1.5, items: [] })).toBeNull()
    expect(objectsOf({ v: 1, items: 'a,b' })).toBeNull()
    expect(objectsOf({ v: 1, items: [['', 'molecule', true]] })).toBeNull()
    expect(objectsOf({ v: 1, items: [[1, 'molecule', true]] })).toBeNull()
  })

  it('keeps at most 300 entries and 255 characters of a name', () => {
    const items = Array.from({ length: 400 }, (_, i) => [`o${i}`, 'molecule', true])
    expect(objectsOf({ v: 1, items })?.items).toHaveLength(300)
    expect(objectsOf({ v: 1, items: [['x'.repeat(300), 'molecule', true]] })?.items[0].name).toHaveLength(255)
  })
})

describe('objectActionCommand', () => {
  it('is the worker’s _agdb_obj with the version, the index and listed words', () => {
    expect(objectActionCommand(4, 2, { op: 'on' })).toBe("_ /_agdb_obj(4, 2, 'on', '')")
    expect(objectActionCommand(4, -1, { op: 'hideall' })).toBe("_ /_agdb_obj(4, -1, 'hideall', '')")
    expect(objectActionCommand(4, 0, { op: 'show', arg: 'cartoon' })).toBe("_ /_agdb_obj(4, 0, 'show', 'cartoon')")
    expect(objectActionCommand(4, 0, { op: 'color', arg: 'chain' })).toBe("_ /_agdb_obj(4, 0, 'color', 'chain')")
    expect(objectActionCommand(4, 0, { op: 'color', arg: 'grey70' })).toBe("_ /_agdb_obj(4, 0, 'color', 'grey70')")
    expect(objectActionCommand(4, 0, { op: 'label', arg: 'residue' })).toBe("_ /_agdb_obj(4, 0, 'label', 'residue')")
  })

  it('refuses anything else: a bad index or version, a word not listed, an argument where none goes', () => {
    expect(objectActionCommand(4, -2, { op: 'on' })).toBeNull()
    expect(objectActionCommand(4, 1.5, { op: 'on' })).toBeNull()
    expect(objectActionCommand(-1, 0, { op: 'on' })).toBeNull()
    expect(objectActionCommand(4, 0, { op: 'show', arg: "sticks'); cmd.delete('all" } as never)).toBeNull()
    expect(objectActionCommand(4, 0, { op: 'color', arg: 'chartreuse' } as never)).toBeNull()
    expect(objectActionCommand(4, 0, { op: 'zoom', arg: 'x' } as never)).toBeNull()
    expect(objectActionCommand(4, 0, { op: 'reinitialize' } as never)).toBeNull()
  })
})
