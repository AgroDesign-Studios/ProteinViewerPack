/**
 * The phone's object list (owner 2026-11-19: no PyMOL object panel on a
 * phone): a switch and a name per entry, 「すべて」 first; a name opens what
 * can be done to the entry, by its index; a map has no representations;
 * delete asks first; the entry open follows its name through a new list.
 */
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key} ${JSON.stringify(vars)}` : key),
    i18n: { language: 'en' },
  }),
}))

import { PymolObjectSheet } from './PymolObjectSheet'
import type { PymolObjects } from './pymolObjects'

const LIST: PymolObjects = {
  v: 3,
  items: [
    { name: '1abc', kind: 'molecule', on: true },
    { name: 'map1', kind: 'map', on: false },
    { name: 'sele', kind: 'selection', on: true },
  ],
  more: false,
  focus: null,
  reps: null,
}

afterEach(cleanup)

describe('PymolObjectSheet', () => {
  it('says why there is no list while PyMOL starts, and while it reads the first one', () => {
    const { rerender } = render(<PymolObjectSheet objects={undefined} ready={false} act={vi.fn()} />)
    expect(screen.getByText('htmlExport:sa_objs_not_ready')).toBeInTheDocument()
    rerender(<PymolObjectSheet objects={undefined} ready act={vi.fn()} />)
    expect(screen.getByText('htmlExport:sa_objs_reading')).toBeInTheDocument()
  })

  it('lists 「すべて」 then each entry with a switch; a switch turns its entry on or off by index', async () => {
    const act_ = vi.fn(async () => undefined)
    const user = userEvent.setup()
    render(<PymolObjectSheet objects={LIST} ready act={act_} />)
    const list = screen.getByRole('list', { name: 'htmlExport:sa_objs_list' })
    expect(list.querySelectorAll('li')).toHaveLength(4)
    // 「すべて」 is on when every object (not selection) is: map1 is off.
    expect(screen.getByRole('button', { name: 'htmlExport:sa_objs_switch {"name":"htmlExport:sa_objs_all"}' })).toHaveAttribute('aria-pressed', 'false')
    await user.click(screen.getByRole('button', { name: 'htmlExport:sa_objs_switch {"name":"1abc"}' }))
    expect(act_).toHaveBeenLastCalledWith(0, { op: 'off' })
    await user.click(screen.getByRole('button', { name: 'htmlExport:sa_objs_switch_selection {"name":"sele"}' }))
    expect(act_).toHaveBeenLastCalledWith(2, { op: 'off' })
    await user.click(screen.getByRole('button', { name: 'htmlExport:sa_objs_switch {"name":"htmlExport:sa_objs_all"}' }))
    expect(act_).toHaveBeenLastCalledWith(-1, { op: 'on' })
  })

  it('a name opens the entry: its representations as switches from PyMOL’s report, colour, labels, view, delete after a question', async () => {
    const act_ = vi.fn(async () => undefined)
    const user = userEvent.setup()
    const { rerender } = render(<PymolObjectSheet objects={LIST} ready act={act_} />)
    await user.click(screen.getByRole('button', { name: /^1abc/ }))
    expect(act_).toHaveBeenLastCalledWith(0, { op: 'focus' })
    expect(screen.getByRole('heading', { name: /1abc/ })).toHaveFocus()
    // Until PyMOL says which are shown, the buttons claim no state.
    expect(screen.getByRole('button', { name: 'htmlExport:sa_objs_rep_cartoon' })).not.toHaveAttribute('aria-pressed')
    rerender(<PymolObjectSheet objects={{ ...LIST, focus: 0, reps: ['cartoon'] }} ready act={act_} />)
    expect(screen.getByRole('button', { name: 'htmlExport:sa_objs_rep_cartoon' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'htmlExport:sa_objs_rep_cartoon' }))
    expect(act_).toHaveBeenLastCalledWith(0, { op: 'hide', arg: 'cartoon' })
    await user.click(screen.getByRole('button', { name: 'htmlExport:sa_objs_rep_sticks' }))
    expect(act_).toHaveBeenLastCalledWith(0, { op: 'show', arg: 'sticks' })
    await user.click(screen.getByRole('button', { name: 'htmlExport:sa_objs_color_chain' }))
    expect(act_).toHaveBeenLastCalledWith(0, { op: 'color', arg: 'chain' })
    await user.click(screen.getByRole('button', { name: 'htmlExport:sa_objs_swatch_green' }))
    expect(act_).toHaveBeenLastCalledWith(0, { op: 'color', arg: 'green' })
    await user.click(screen.getByRole('button', { name: 'htmlExport:sa_objs_label_residue' }))
    expect(act_).toHaveBeenLastCalledWith(0, { op: 'label', arg: 'residue' })
    await user.click(screen.getByRole('button', { name: 'htmlExport:sa_objs_zoom' }))
    expect(act_).toHaveBeenLastCalledWith(0, { op: 'zoom' })
    // Delete asks first, the focus on 「やめる」; 「やめる」 sends nothing and goes back to 「削除」.
    await user.click(screen.getByRole('button', { name: 'htmlExport:sa_objs_delete' }))
    expect(screen.getByRole('button', { name: 'htmlExport:sa_objs_delete_no' })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'htmlExport:sa_objs_delete_no' }))
    expect(act_).not.toHaveBeenCalledWith(0, { op: 'delete' })
    expect(screen.getByRole('button', { name: 'htmlExport:sa_objs_delete' })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'htmlExport:sa_objs_delete' }))
    await user.click(screen.getByRole('button', { name: 'htmlExport:sa_objs_delete_yes' }))
    expect(act_).toHaveBeenLastCalledWith(0, { op: 'delete' })
    // The list comes back without it: back to the list, the focus on its first row.
    rerender(<PymolObjectSheet objects={{ ...LIST, v: 4, items: LIST.items.slice(1), focus: null, reps: null }} ready act={act_} />)
    expect(screen.getByRole('list', { name: 'htmlExport:sa_objs_list' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /htmlExport:sa_objs_all/ })[1]).toHaveFocus()
  })

  it('a map has no representations or labels, only colours, view and delete; 「‹ 一覧」 goes back to its row and stops the reading', async () => {
    const act_ = vi.fn(async () => undefined)
    const user = userEvent.setup()
    render(<PymolObjectSheet objects={LIST} ready act={act_} />)
    await user.click(screen.getByRole('button', { name: /^map1/ }))
    expect(screen.queryByRole('button', { name: 'htmlExport:sa_objs_rep_cartoon' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'htmlExport:sa_objs_label_residue' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'htmlExport:sa_objs_color_chain' })).toBeNull()
    expect(screen.getByRole('button', { name: 'htmlExport:sa_objs_swatch_red' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /htmlExport:sa_objs_back/ }))
    expect(act_).toHaveBeenLastCalledWith(-1, { op: 'unfocus' })
    expect(screen.getByRole('button', { name: /^map1/ })).toHaveFocus()
  })

  it('a switch pressed twice before PyMOL’s report acts on what the first press asked for (PR #9414 review)', async () => {
    const act_ = vi.fn(async () => undefined)
    const user = userEvent.setup()
    const { rerender } = render(<PymolObjectSheet objects={LIST} ready act={act_} />)
    const sw = screen.getByRole('button', { name: 'htmlExport:sa_objs_switch {"name":"1abc"}' })
    await user.click(sw)
    expect(sw).toHaveAttribute('aria-pressed', 'false')
    await user.click(sw)
    expect(act_.mock.calls.slice(-2)).toEqual([
      [0, { op: 'off' }],
      [0, { op: 'on' }],
    ])
    // PyMOL's report decides again.
    rerender(<PymolObjectSheet objects={{ ...LIST, items: [{ ...LIST.items[0], on: false }, ...LIST.items.slice(1)] }} ready act={act_} />)
    expect(sw).toHaveAttribute('aria-pressed', 'false')
  })

  it('an object named like a JavaScript object property shows its own state (PT-9937)', () => {
    const odd: PymolObjects = { ...LIST, items: ['constructor', 'toString', '__proto__'].map(name => ({ name, kind: 'molecule' as const, on: false })) }
    render(<PymolObjectSheet objects={odd} ready act={vi.fn(async () => undefined)} />)
    for (const name of ['constructor', 'toString', '__proto__'])
      expect(screen.getByRole('button', { name: `htmlExport:sa_objs_switch {"name":"${name}"}` })).toHaveAttribute('aria-pressed', 'false')
  })

  it('past the names the worker sends, 「すべて」 is mixed, and a press turns everything on', async () => {
    const act_ = vi.fn(async () => undefined)
    const user = userEvent.setup()
    render(<PymolObjectSheet objects={{ ...LIST, items: [LIST.items[0]], more: true }} ready act={act_} />)
    const all = screen.getByRole('button', { name: 'htmlExport:sa_objs_switch {"name":"htmlExport:sa_objs_all"}' })
    expect(all).toHaveAttribute('aria-pressed', 'mixed')
    await user.click(all)
    expect(act_).toHaveBeenLastCalledWith(-1, { op: 'on' })
  })

  it('closed with an entry open, it tells the worker to stop reading that entry (PR #9414 review)', async () => {
    const act_ = vi.fn(async () => undefined)
    const user = userEvent.setup()
    const { unmount } = render(<PymolObjectSheet objects={LIST} ready act={act_} />)
    await user.click(screen.getByRole('button', { name: /^map1/ }))
    expect(act_).toHaveBeenLastCalledWith(1, { op: 'focus' })
    unmount()
    expect(act_).toHaveBeenLastCalledWith(-1, { op: 'unfocus' })
  })

  it('the entry open follows its name when the list changes under it, and 「すべて」 has no delete', async () => {
    const act_ = vi.fn(async () => undefined)
    const user = userEvent.setup()
    const { rerender } = render(<PymolObjectSheet objects={LIST} ready act={act_} />)
    await user.click(screen.getByRole('button', { name: /^sele/ }))
    expect(screen.getByRole('button', { name: 'htmlExport:sa_objs_delete_selection' })).toBeInTheDocument()
    // A new selection before it: the same entry is now index 3.
    act(() => rerender(<PymolObjectSheet objects={{ ...LIST, v: 4, items: [...LIST.items.slice(0, 2), { name: 'pk1', kind: 'selection', on: true }, LIST.items[2]] }} ready act={act_} />))
    await user.click(screen.getByRole('button', { name: 'htmlExport:sa_objs_center' }))
    expect(act_).toHaveBeenLastCalledWith(3, { op: 'center' })
    await user.click(screen.getByRole('button', { name: /htmlExport:sa_objs_back/ }))
    await user.click(screen.getAllByRole('button', { name: /htmlExport:sa_objs_all/ })[1])
    expect(act_).toHaveBeenLastCalledWith(-1, { op: 'focus' })
    expect(screen.queryByRole('button', { name: /sa_objs_delete/ })).toBeNull()
  })
})
