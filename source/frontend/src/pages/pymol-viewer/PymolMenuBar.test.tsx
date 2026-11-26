import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { checkCommand } from './pymolCommands'
import { appMenu, needsPymol, PYMOL_MENU, type MenuNode } from './pymolMenuData'
import { NARROW_MENU_QUERY, PymolMenuBar } from './PymolMenuBar'

// The key, and the name it is given, so a test can read which entry it names.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, opts?: { name?: string }) => (opts?.name === undefined ? key : `${key} ${opts.name}`) }),
}))

const LABELS = { settings: 'All settings…', help: 'Help', keys: 'Keyboard…' }

function renderBar(
  over: { menu?: readonly MenuNode[]; disabled?: boolean; disabledNote?: string; brandLogo?: { src: string | null; onError: () => void } } = {},
) {
  const onCommand = vi.fn()
  const onLocal = vi.fn()
  const { unmount } = render(
    <PymolMenuBar
      menu={over.menu ?? appMenu(LABELS)}
      disabled={over.disabled ?? false}
      disabledNote={over.disabledNote}
      label="PyMOL menu"
      toggleHint="(on/off)"
      onCommand={onCommand}
      onLocal={onLocal}
      brandLogo={over.brandLogo}
    />,
  )
  return { onCommand, onLocal, unmount }
}

/**
 * A window as narrow as a phone (the menu's `NARROW_MENU_QUERY` matches);
 * `set` turns it, as a phone turned on its side would, and tells the hook.
 */
function narrowScreen() {
  let narrow = true
  const listeners = new Set<() => void>()
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      get matches() {
        return query === NARROW_MENU_QUERY && narrow
      },
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: (_: string, f: () => void) => listeners.add(f),
      removeEventListener: (_: string, f: () => void) => listeners.delete(f),
      dispatchEvent: vi.fn(),
    }),
  })
  return {
    set(value: boolean) {
      narrow = value
      act(() => listeners.forEach(f => f()))
    },
  }
}

/** Every item of the tree, depth first. */
function items(nodes: readonly MenuNode[]): Array<Extract<MenuNode, { kind: 'item' }>> {
  return nodes.flatMap(n => (n.kind === 'menu' ? items(n.items) : n.kind === 'item' ? [n] : []))
}

describe('the menu data', () => {
  it('carries PyMOL’s menus, about 700 entries of them', () => {
    expect(PYMOL_MENU.map(n => (n.kind === 'menu' ? n.label : n.kind))).toEqual([
      'File', 'Edit', 'Build', 'Movie', 'Display', 'Setting', 'Scene', 'Mouse', 'Wizard',
    ])
    expect(items(PYMOL_MENU).length).toBeGreaterThan(600)
  })

  it('holds only commands the command line would send: none empty, none over the cap, no session load', () => {
    for (const it of items(PYMOL_MENU)) expect(checkCommand(it.command), it.label).toEqual({ ok: true, text: it.command })
  })

  it('holds no recorded object’s repr: a `<` in a command is a line PyMOL cannot parse (PT-3291 item 1)', () => {
    for (const it of items(PYMOL_MENU)) expect(it.command, it.label).not.toContain('<')
    expect(items(PYMOL_MENU).find(it => it.label === 'Modernize')?.command).toBe('/cmd.util.modernize_rendering(1, cmd)')
  })

  it('never reaches the network or the OS: no fetch, no URL, no system, no file dialog', () => {
    for (const it of items(PYMOL_MENU)) {
      expect(it.command, it.label).not.toMatch(/\bfetch\b|https?:|\bsystem\b|webbrowser|\bsave\b|\bpng\b/i)
    }
  })

  it('adds the page’s own entries without a command', () => {
    const menu = appMenu(LABELS)
    const setting = menu.find(n => n.kind === 'menu' && n.label === 'Setting')
    expect(setting?.kind === 'menu' && setting.items[0]).toEqual({ kind: 'local', label: LABELS.settings, action: 'settings' })
    expect(menu[menu.length - 1]).toEqual({ kind: 'menu', label: 'Help', items: [{ kind: 'local', label: LABELS.keys, action: 'keys' }] })
    // With an `about` label the Help menu also opens the notice dialog (PyMOL™ trademark).
    const withAbout = appMenu({ ...LABELS, about: 'About…' })
    expect(withAbout[withAbout.length - 1]).toEqual({
      kind: 'menu',
      label: 'Help',
      items: [
        { kind: 'local', label: LABELS.keys, action: 'keys' },
        { kind: 'local', label: 'About…', action: 'about' },
      ],
    })
  })

  it('puts the 創薬表示 presets just before Help, every entry a local action, pLDDT locked with its reason', () => {
    const menu = appMenu(LABELS, { ...PRESETS, plddtLocked: 'Only for predicted structures' })
    expect(menu[menu.length - 1].kind === 'menu' && menu[menu.length - 1]).toMatchObject({ label: 'Help' })
    const presets = menu[menu.length - 2]
    expect(presets.kind === 'menu' && presets.label).toBe('Drug discovery')
    const entries = presets.kind === 'menu' ? presets.items.filter(n => n.kind !== 'sep') : []
    expect(entries).toEqual([
      { kind: 'local', label: 'Ligand site', action: 'preset:ligand-site' },
      { kind: 'local', label: 'Pocket', action: 'preset:pocket' },
      { kind: 'local', label: 'B-factor', action: 'preset:bfactor' },
      { kind: 'local', label: 'pLDDT', action: 'preset:plddt', locked: 'Only for predicted structures' },
      { kind: 'local', label: 'Publication', action: 'preset:publication' },
      { kind: 'local', label: 'Default look', action: 'preset:reset' },
    ])
    // The one menu that is AgDB's own, so the bar puts the company logo on it.
    expect(menu.filter(n => n.kind === 'menu' && n.brand === true)).toEqual([presets])
    const open = appMenu(LABELS, { ...PRESETS, plddtLocked: null })[menu.length - 2]
    expect(open.kind === 'menu' && open.items.find(n => n.kind === 'local' && n.action === 'preset:plddt')).toEqual({
      kind: 'local', label: 'pLDDT', action: 'preset:plddt',
    })
  })
})

const PRESETS = {
  title: 'Drug discovery',
  items: { 'ligand-site': 'Ligand site', pocket: 'Pocket', bfactor: 'B-factor', plddt: 'pLDDT', publication: 'Publication', reset: 'Default look' },
} as const

describe('PymolMenuBar', () => {
  it('sends exactly the chosen entry’s command, and shows the chord that works in this page', async () => {
    const { onCommand, onLocal } = renderBar()
    const user = userEvent.setup()
    await user.click(screen.getByRole('menuitem', { name: 'Build' }))
    await user.click(screen.getByRole('menuitem', { name: /Fragment/ }))
    await user.click(screen.getByRole('menuitem', { name: 'Nitrogen [Ctrl-Alt-Shift-N]' }))
    expect(onCommand).toHaveBeenCalledTimes(1)
    expect(onCommand).toHaveBeenCalledWith('replace N,4,3')
    expect(onLocal).not.toHaveBeenCalled()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('renders a label as text: markup in it is never parsed, a URL never becomes a link', async () => {
    const hostile = '<img src=x onerror="alert(1)"> https://evil.example/'
    const { onCommand } = renderBar({ menu: [{ kind: 'menu', label: 'M', items: [{ kind: 'item', label: hostile, command: 'zoom', role: 'action' }] }] })
    const user = userEvent.setup()
    await user.click(screen.getByRole('menuitem', { name: 'M' }))
    const entry = screen.getByRole('menuitem', { name: hostile })
    expect(entry).toHaveTextContent(hostile)
    expect(document.querySelector('img')).toBeNull()
    expect(document.querySelector('a')).toBeNull()
    await user.click(entry)
    expect(onCommand).toHaveBeenCalledWith('zoom')
  })

  it('marks a toggle (no tick: the setting is not read back)', async () => {
    renderBar()
    const user = userEvent.setup()
    await user.click(screen.getByRole('menuitem', { name: 'Display' }))
    expect(screen.getByRole('menuitem', { name: 'Orthoscopic View (on/off)' })).toBeInTheDocument()
  })

  it('opens the page’s own dialogs through onLocal, never as a command', async () => {
    const { onCommand, onLocal } = renderBar()
    const user = userEvent.setup()
    await user.click(screen.getByRole('menuitem', { name: 'Setting' }))
    await user.click(screen.getByRole('menuitem', { name: LABELS.settings }))
    expect(onLocal).toHaveBeenCalledWith('settings')
    await user.click(screen.getByRole('menuitem', { name: 'Help' }))
    await user.click(screen.getByRole('menuitem', { name: LABELS.keys }))
    expect(onLocal).toHaveBeenLastCalledWith('keys')
    expect(onCommand).not.toHaveBeenCalled()
  })

  it('gives focus back to the menu’s button before an entry opens a dialog, so the dialog has a live element to return to (PT-3291 item 3)', async () => {
    const { onLocal } = renderBar()
    let focusedAtChoice: Element | null = null
    onLocal.mockImplementation(() => {
      focusedAtChoice = document.activeElement
    })
    const user = userEvent.setup()
    const setting = screen.getByRole('menuitem', { name: 'Setting' })
    await user.click(setting)
    await user.click(screen.getByRole('menuitem', { name: LABELS.settings }))
    expect(onLocal).toHaveBeenCalledWith('settings')
    // The entry is gone by the time a dialog would close; the button is not.
    expect(focusedAtChoice).toBe(setting)
    expect(setting).toHaveFocus()
  })

  it('closes a submenu open beside the entry Home or End leaves (PT-3291 item 19)', async () => {
    renderBar()
    const user = userEvent.setup()
    screen.getByRole('menuitem', { name: 'Build' }).focus()
    await user.keyboard('{ArrowDown}')
    const fragment = screen.getByRole('menuitem', { name: /Fragment/ })
    expect(fragment).toHaveFocus()
    // The pointer opens Fragment's submenu while focus stays on Fragment.
    await user.hover(fragment)
    expect(screen.getAllByRole('menu')).toHaveLength(2)
    await user.keyboard('{End}')
    expect(screen.getAllByRole('menu')).toHaveLength(1)
    await user.keyboard('{Home}')
    expect(fragment).toHaveFocus()
  })

  it('moves the bar’s one Tab stop with focus (roving tabindex) (PT-3291 item 19)', async () => {
    renderBar()
    const user = userEvent.setup()
    const file = screen.getByRole('menuitem', { name: 'File' })
    const edit = screen.getByRole('menuitem', { name: 'Edit' })
    expect(file).toHaveAttribute('tabindex', '0')
    expect(edit).toHaveAttribute('tabindex', '-1')
    file.focus()
    await user.keyboard('{ArrowRight}')
    expect(edit).toHaveFocus()
    expect(edit).toHaveAttribute('tabindex', '0')
    expect(file).toHaveAttribute('tabindex', '-1')
  })

  it('takes focus along with the pointer while focus is in the bar, so a submenu that closes under it never drops the focused entry (PT-3291 item 19)', async () => {
    renderBar()
    const user = userEvent.setup()
    screen.getByRole('menuitem', { name: 'Build' }).focus()
    await user.keyboard('{ArrowDown}{ArrowRight}')
    expect(screen.getByRole('menuitem', { name: 'Acetylene [Alt-J]' })).toHaveFocus()
    // The pointer onto another entry of Build: Fragment's submenu, which holds
    // the focused entry, closes.
    const other = screen.getByRole('menuitem', { name: /^Residue/ })
    await user.hover(other)
    expect(screen.queryByRole('menuitem', { name: 'Acetylene [Alt-J]' })).toBeNull()
    expect(other).toHaveFocus()
  })

  it('after a touch, the compatibility mouse events open or switch nothing; a mouse moving brings hover back (PT-9226)', () => {
    // jsdom's pointer events carry no pointerType: one is set on the event itself.
    const pointer = (el: Element, type: 'pointerdown' | 'pointermove' | 'pointerover', pointerType: string) => {
      const ev = new MouseEvent(type, { bubbles: true, cancelable: true })
      Object.defineProperty(ev, 'pointerType', { value: pointerType })
      fireEvent(el, ev)
    }
    renderBar()
    const scene = screen.getByRole('menuitem', { name: 'Scene' })
    const help = screen.getByRole('menuitem', { name: 'Help' })
    const build = screen.getByRole('menuitem', { name: 'Build' })
    // A tap on Build: the touch's pointer events, then the browser's mouse events, then the click.
    pointer(build, 'pointerdown', 'touch')
    fireEvent.mouseEnter(build)
    fireEvent.click(build)
    expect(build).toHaveAttribute('aria-expanded', 'true')
    // A stray mouseenter after a touch — onto another menu, onto a submenu entry — changes nothing.
    fireEvent.mouseEnter(scene)
    fireEvent.mouseEnter(screen.getByRole('menuitem', { name: /Fragment/ }))
    expect(build).toHaveAttribute('aria-expanded', 'true')
    expect(scene).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getAllByRole('menu')).toHaveLength(1)
    // A tap on Help opens Help, whatever the mouse events that come with it.
    pointer(help, 'pointerdown', 'touch')
    fireEvent.mouseEnter(help)
    fireEvent.mouseEnter(scene)
    fireEvent.click(help)
    expect(help).toHaveAttribute('aria-expanded', 'true')
    expect(scene).toHaveAttribute('aria-expanded', 'false')
    expect(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Keyboard…' })).toBeInTheDocument()
    // A mouse moving over the bar: hover switches menus again.
    pointer(scene, 'pointermove', 'mouse')
    fireEvent.mouseEnter(scene)
    expect(scene).toHaveAttribute('aria-expanded', 'true')
  })

  it('after a touch, a mouse entering a bar button straight from outside the bar switches menus at once (PT-9237 item 3)', () => {
    const pointer = (el: Element, type: 'pointerdown' | 'pointerover', pointerType: string) => {
      const ev = new MouseEvent(type, { bubbles: true, cancelable: true })
      Object.defineProperty(ev, 'pointerType', { value: pointerType })
      fireEvent(el, ev)
    }
    renderBar()
    const scene = screen.getByRole('menuitem', { name: 'Scene' })
    const build = screen.getByRole('menuitem', { name: 'Build' })
    pointer(build, 'pointerdown', 'touch')
    fireEvent.click(build)
    expect(build).toHaveAttribute('aria-expanded', 'true')
    // UI Events order: pointerover, then mouseenter, and only then the first pointermove.
    pointer(scene, 'pointerover', 'mouse')
    fireEvent.mouseEnter(scene)
    expect(scene).toHaveAttribute('aria-expanded', 'true')
  })

  it('runs a preset through onLocal; a locked one shows a padlock and its reason, stays reachable, and does nothing', async () => {
    const { onCommand, onLocal } = renderBar({ menu: appMenu(LABELS, { ...PRESETS, plddtLocked: 'Only for predicted structures' }) })
    const user = userEvent.setup()
    await user.click(screen.getByRole('menuitem', { name: 'Drug discovery' }))
    await user.click(screen.getByRole('menuitem', { name: 'Ligand site' }))
    expect(onLocal).toHaveBeenCalledWith('preset:ligand-site')

    await user.click(screen.getByRole('menuitem', { name: 'Drug discovery' }))
    const locked = screen.getByRole('menuitem', { name: /pLDDT/ })
    expect(locked).toHaveAttribute('aria-disabled', 'true')
    expect(locked).not.toBeDisabled()
    expect(locked).toHaveTextContent('🔒 Only for predicted structures')
    expect(locked).toHaveAccessibleName(/pLDDT.*Only for predicted structures/)
    await user.click(locked)
    await user.keyboard('{Enter}')
    expect(onLocal).toHaveBeenCalledTimes(1)
    expect(onCommand).not.toHaveBeenCalled()
    // Still open: a locked entry is not a choice that closes the menu.
    expect(screen.getByRole('menu', { name: 'Drug discovery' })).toBeInTheDocument()

    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Publication' })).toHaveFocus()
  })

  it('works from the keyboard: ↓ opens, → enters a submenu, Escape steps back out', async () => {
    const { onCommand } = renderBar()
    const user = userEvent.setup()
    const edit = screen.getByRole('menuitem', { name: 'Edit' })
    screen.getByRole('menuitem', { name: 'File' }).focus()
    await user.keyboard('{ArrowRight}')
    expect(edit).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Undo [Ctrl-Z]' })).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Redo [Ctrl-Y]' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(edit).toHaveFocus()

    await user.keyboard('{ArrowRight}{ArrowDown}')
    const build = screen.getByRole('menu', { name: 'Build' })
    expect(within(build).getByRole('menuitem', { name: /Fragment/ })).toHaveFocus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('menuitem', { name: 'Acetylene [Alt-J]' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(within(build).getByRole('menuitem', { name: /Fragment/ })).toHaveFocus()
    await user.keyboard('{ArrowRight}{Enter}')
    expect(onCommand).toHaveBeenCalledWith("editor.attach_fragment('pk1','acetylene',2,0)")
  })

  it('moves focus into a menu only once it can take focus and is placed (never while hidden or still off-screen)', async () => {
    // jsdom focuses a visibility:hidden element; Chrome and Firefox do not. So
    // record, at the moment focus() is called on an entry, whether its menu is
    // hidden then (round 1 of #3300: the panel was placed by a state round-trip
    // and still hidden when the focus effect ran) — or not yet placed, still at
    // the off-screen spot it first renders at: focus there scrolls nothing into
    // view, but a change that moved focus before the placing would put it on
    // an entry nobody can see (PT-3291 item 21).
    const hiddenAtFocus: string[] = []
    const realFocus = HTMLElement.prototype.focus
    const focus = vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement, opts?: FocusOptions) {
      const panel = this.closest('[role="menu"]') as HTMLElement | null
      if (panel && (panel.style.visibility === 'hidden' || panel.style.left === '-10000px')) hiddenAtFocus.push(this.textContent ?? '')
      realFocus.call(this, opts)
    })
    renderBar()
    const user = userEvent.setup()
    focus.mockClear()
    screen.getByRole('menuitem', { name: 'Edit' }).focus()
    await user.keyboard('{ArrowDown}')
    await user.keyboard('{ArrowRight}{ArrowDown}{ArrowRight}')
    expect(focus.mock.instances.some(el => (el as HTMLElement).closest('[role="menu"]') !== null)).toBe(true)
    expect(hiddenAtFocus).toEqual([])
    focus.mockRestore()
  })

  it('closes when focus leaves the window (a click into the PyMOL frame)', async () => {
    renderBar()
    const user = userEvent.setup()
    await user.click(screen.getByRole('menuitem', { name: 'Edit' }))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    window.dispatchEvent(new Event('blur'))
    await screen.findByRole('menubar')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('locks the menus that need PyMOL until it is ready, focusable and saying why', async () => {
    const user = userEvent.setup()
    renderBar({ disabled: true, disabledNote: 'Available once PyMOL is ready.' })
    const file = screen.getByRole('menuitem', { name: 'File' })
    expect(file).toHaveAttribute('aria-disabled', 'true')
    expect(file).not.toBeDisabled()
    expect(file).toHaveAccessibleDescription('Available once PyMOL is ready.')
    await user.click(file)
    expect(screen.queryByRole('menu')).toBeNull()
    file.focus()
    await user.keyboard('{Enter}')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('counts only the keys and the notice as needing no PyMOL', () => {
    const menu = appMenu({ ...LABELS, about: 'About…' })
    const byLabel = Object.fromEntries(menu.map(n => [n.kind === 'menu' ? n.label : '', n]))
    expect(needsPymol(byLabel.Help)).toBe(false)
    expect(needsPymol(byLabel.File)).toBe(true)
    expect(needsPymol({ kind: 'local', label: 'x', action: 'settings' })).toBe(true)
  })

  it('opens Help, whose entries need no PyMOL, while PyMOL is not ready (PT-9103 item 4)', async () => {
    const user = userEvent.setup()
    const { onLocal } = renderBar({ menu: appMenu({ ...LABELS, about: 'About…' }), disabled: true })
    const help = screen.getByRole('menuitem', { name: 'Help' })
    expect(help).not.toHaveAttribute('aria-disabled')
    await user.click(help)
    await user.click(screen.getByRole('menuitem', { name: 'About…' }))
    expect(onLocal).toHaveBeenLastCalledWith('about')
  })

  it('opens a submenu beside its parent, never inside it: a scrolling parent cannot clip it, at any width (PT-9673)', async () => {
    renderBar()
    const user = userEvent.setup()
    await user.click(screen.getByRole('menuitem', { name: 'Build' }))
    const fragment = screen.getByRole('menuitem', { name: /Fragment/ })
    await user.click(fragment)
    const [build, sub] = screen.getAllByRole('menu')
    expect(build).toHaveAccessibleName('Build')
    expect(sub).toHaveAccessibleName('Fragment')
    // iOS WebKit clips a fixed panel to an ancestor that scrolls: the parent
    // menu scrolls on a phone, so the submenu must not be its descendant.
    expect(build.contains(sub)).toBe(false)
    expect(sub.contains(build)).toBe(false)
    expect(fragment).toHaveAttribute('aria-expanded', 'true')
    expect(fragment).toHaveAttribute('aria-controls', sub.id)
    expect(sub).not.toHaveClass('pymolv-menu--drill')
  })

  it('closes on a press outside that only a pointer event reports (iOS sends no mousedown for a tap on plain page)', async () => {
    renderBar()
    const user = userEvent.setup()
    await user.click(screen.getByRole('menuitem', { name: 'Edit' }))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    act(() => {
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    })
    expect(screen.queryByRole('menu')).toBeNull()
  })
})

/**
 * A phone (owner 2026-11-17, PT-9673): on a real iPhone the third box of
 * Display > Grid > By State showed only its right part. Narrower than the
 * Mobile step, the menu is one panel that drills down, with the way back and
 * where you are at its top (both UI consultants; owner approved 2026-11-18).
 */
describe('PymolMenuBar on a narrow screen (PT-9673)', () => {
  const menus = () => screen.getAllByRole('menu')

  it('reads and chooses a three-level path in one panel: Display > Grid > By State', async () => {
    narrowScreen()
    const { onCommand } = renderBar()
    const user = userEvent.setup()
    await user.click(screen.getByRole('menuitem', { name: 'Display' }))
    expect(menus()).toHaveLength(1)
    expect(menus()[0]).toHaveAccessibleName('Display')
    expect(menus()[0]).toHaveClass('pymolv-menu', 'pymolv-menu--drill')
    // The first level has no way back, only the way out.
    expect(within(menus()[0]).queryByRole('menuitem', { name: /menu_back/ })).toBeNull()
    expect(within(menus()[0]).getByRole('menuitem', { name: 'pymol:menu_close' })).toBeInTheDocument()

    await user.click(within(menus()[0]).getByRole('menuitem', { name: 'Grid' }))
    expect(menus()).toHaveLength(1)
    const grid = menus()[0]
    expect(grid).toHaveAccessibleName('Display › Grid')
    expect(grid.querySelector('.pymolv-menu-path')).toHaveTextContent('Display › Grid')
    expect(within(grid).getByRole('menuitem', { name: 'pymol:menu_back Display' })).toHaveTextContent(/^‹\s*Display$/)
    expect(within(grid).getByRole('menuitem', { name: 'By Object' })).toHaveFocus()

    await user.click(within(grid).getByRole('menuitem', { name: 'By State' }))
    expect(onCommand).toHaveBeenCalledTimes(1)
    expect(onCommand).toHaveBeenCalledWith("/cmd.set('grid_mode', 2, quiet=0)")
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('steps back one level to the entry it came from; × closes and gives focus back to the menu’s button', async () => {
    narrowScreen()
    renderBar()
    const user = userEvent.setup()
    const display = screen.getByRole('menuitem', { name: 'Display' })
    await user.click(display)
    await user.click(screen.getByRole('menuitem', { name: 'Grid' }))
    await user.click(screen.getByRole('menuitem', { name: 'pymol:menu_back Display' }))
    expect(menus()).toHaveLength(1)
    expect(menus()[0]).toHaveAccessibleName('Display')
    expect(screen.getByRole('menuitem', { name: 'Grid' })).toHaveFocus()

    await user.click(screen.getByRole('menuitem', { name: 'pymol:menu_close' }))
    expect(screen.queryByRole('menu')).toBeNull()
    expect(display).toHaveFocus()
  })

  it('shows the whole path four levels down, and Escape climbs back one level at a time', async () => {
    narrowScreen()
    renderBar()
    const user = userEvent.setup()
    const movie = screen.getByRole('menuitem', { name: 'Movie' })
    await user.click(movie)
    for (const name of ['Program', 'Camera Loop', 'X-Rock']) await user.click(within(menus()[0]).getByRole('menuitem', { name }))
    expect(menus()).toHaveLength(1)
    expect(menus()[0]).toHaveAccessibleName('Movie › Program › Camera Loop › X-Rock')
    expect(menus()[0].querySelector('.pymolv-menu-path')).toHaveTextContent('Movie › Program › Camera Loop › X-Rock')
    expect(screen.getByRole('menuitem', { name: 'pymol:menu_back Camera Loop' })).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(menus()[0]).toHaveAccessibleName('Movie › Program › Camera Loop')
    expect(screen.getByRole('menuitem', { name: 'X-Rock' })).toHaveFocus()
    await user.keyboard('{Escape}{Escape}')
    expect(menus()[0]).toHaveAccessibleName('Movie')
    expect(screen.getByRole('menuitem', { name: 'Program' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(movie).toHaveFocus()
  })

  it('takes the way back and the way out into ↑ / ↓ / Home / End, and ← steps back', async () => {
    narrowScreen()
    renderBar()
    const user = userEvent.setup()
    screen.getByRole('menuitem', { name: 'Display' }).focus()
    await user.keyboard('{ArrowDown}')
    const first = within(menus()[0]).getAllByRole('menuitem')[1]
    expect(first).toHaveFocus()
    await user.keyboard('{ArrowUp}')
    expect(screen.getByRole('menuitem', { name: 'pymol:menu_close' })).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(first).toHaveFocus()

    const grid = screen.getByRole('menuitem', { name: 'Grid' })
    grid.focus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('menuitem', { name: 'By Object' })).toHaveFocus()
    await user.keyboard('{Home}')
    expect(screen.getByRole('menuitem', { name: 'pymol:menu_back Display' })).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'pymol:menu_close' })).toHaveFocus()
    await user.keyboard('{End}')
    expect(screen.getByRole('menuitem', { name: 'Disable' })).toHaveFocus()
    await user.keyboard('{ArrowLeft}')
    expect(menus()[0]).toHaveAccessibleName('Display')
    expect(screen.getByRole('menuitem', { name: 'Grid' })).toHaveFocus()
  })

  it('opens a menu again where it was left, while the page keeps the same menu (nav memory, owner 2026-08-22)', async () => {
    narrowScreen()
    const menu = appMenu(LABELS)
    const first = renderBar({ menu })
    const user = userEvent.setup()
    await user.click(screen.getByRole('menuitem', { name: 'Display' }))
    await user.click(screen.getByRole('menuitem', { name: 'Grid' }))
    await user.click(screen.getByRole('menuitem', { name: 'By State' }))
    await user.click(screen.getByRole('menuitem', { name: 'Display' }))
    expect(menus()[0]).toHaveAccessibleName('Display › Grid')
    // Another top menu keeps its own place.
    await user.click(screen.getByRole('menuitem', { name: 'Edit' }))
    expect(menus()[0]).toHaveAccessibleName('Edit')

    // The HTML app unmounts the bar when its 「表示」 sheet closes: the place outlives it.
    first.unmount()
    renderBar({ menu })
    await user.click(screen.getByRole('menuitem', { name: 'Display' }))
    expect(menus()[0]).toHaveAccessibleName('Display › Grid')
    // Back at the top, the top is the place kept.
    await user.click(screen.getByRole('menuitem', { name: 'pymol:menu_back Display' }))
    await user.click(screen.getByRole('menuitem', { name: 'pymol:menu_close' }))
    await user.click(screen.getByRole('menuitem', { name: 'Display' }))
    expect(menus()[0]).toHaveAccessibleName('Display')
  })

  it('opens a new menu tree (another language, another structure) at the top', async () => {
    narrowScreen()
    const first = renderBar({ menu: appMenu(LABELS) })
    const user = userEvent.setup()
    await user.click(screen.getByRole('menuitem', { name: 'Display' }))
    await user.click(screen.getByRole('menuitem', { name: 'Grid' }))
    first.unmount()

    renderBar({ menu: appMenu(LABELS) })
    await user.click(screen.getByRole('menuitem', { name: 'Display' }))
    expect(menus()[0]).toHaveAccessibleName('Display')
  })

  it('keeps no place on a wide screen: the cascade opens at the top as before', async () => {
    const screenWidth = narrowScreen()
    renderBar()
    const user = userEvent.setup()
    await user.click(screen.getByRole('menuitem', { name: 'Display' }))
    await user.click(screen.getByRole('menuitem', { name: 'Grid' }))
    screenWidth.set(false)
    await user.click(screen.getByRole('menuitem', { name: 'Display' }))
    expect(menus()).toHaveLength(1)
    expect(menus()[0]).toHaveAccessibleName('Display')
    expect(menus()[0]).not.toHaveClass('pymolv-menu--drill')
  })

  it('does not drill on a mouse hover, nor switch menus by hovering the bar', async () => {
    narrowScreen()
    renderBar()
    const user = userEvent.setup()
    const display = screen.getByRole('menuitem', { name: 'Display' })
    await user.click(display)
    await user.hover(screen.getByRole('menuitem', { name: 'Grid' }))
    expect(menus()[0]).toHaveAccessibleName('Display')
    await user.hover(screen.getByRole('menuitem', { name: 'Edit' }))
    expect(display).toHaveAttribute('aria-expanded', 'true')
    expect(menus()[0]).toHaveAccessibleName('Display')
  })

  it('closes when the window crosses the step, rather than change shape under the finger', async () => {
    const screenWidth = narrowScreen()
    renderBar()
    const user = userEvent.setup()
    await user.click(screen.getByRole('menuitem', { name: 'Display' }))
    expect(menus()).toHaveLength(1)
    screenWidth.set(false)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('keeps the menus that need PyMOL locked, and Help open, while PyMOL is not ready', async () => {
    narrowScreen()
    const user = userEvent.setup()
    const { onLocal } = renderBar({ menu: appMenu({ ...LABELS, about: 'About…' }), disabled: true })
    await user.click(screen.getByRole('menuitem', { name: 'File' }))
    expect(screen.queryByRole('menu')).toBeNull()
    await user.click(screen.getByRole('menuitem', { name: 'Help' }))
    expect(menus()[0]).toHaveClass('pymolv-menu--drill')
    await user.click(screen.getByRole('menuitem', { name: 'About…' }))
    expect(onLocal).toHaveBeenLastCalledWith('about')
  })

  describe('where the panel sits', () => {
    const place = async (bar: { top: number; bottom: number }) => {
      narrowScreen()
      const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        const r = this.getAttribute('role') === 'menubar' ? { top: bar.top, bottom: bar.bottom, left: 0, right: 390 } : { top: 0, bottom: 0, left: 0, right: 0 }
        return { ...r, x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top, toJSON: () => r } as DOMRect
      })
      const saved = { w: Object.getOwnPropertyDescriptor(window, 'innerWidth'), h: Object.getOwnPropertyDescriptor(window, 'innerHeight') }
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 })
      try {
        renderBar()
        await userEvent.setup().click(screen.getByRole('menuitem', { name: 'Display' }))
        return menus()[0].style
      } finally {
        rect.mockRestore()
        // Back as jsdom had them: its own property, or the prototype's once ours is gone.
        if (saved.w) Object.defineProperty(window, 'innerWidth', saved.w)
        else Reflect.deleteProperty(window, 'innerWidth')
        if (saved.h) Object.defineProperty(window, 'innerHeight', saved.h)
        else Reflect.deleteProperty(window, 'innerHeight')
      }
    }

    it('spans the window but 8 px each side, below a bar at the top of the page (the AgDB page)', async () => {
      const style = await place({ top: 40, bottom: 80 })
      expect(style.left).toBe('8px')
      expect(style.width).toBe('374px')
      expect(style.top).toBe('80px')
      expect(style.maxHeight).toBe('756px')
    })

    it('sits above a bar low in the window (the HTML app’s 「表示」 sheet), never over it', async () => {
      const style = await place({ top: 600, bottom: 640 })
      expect(style.left).toBe('8px')
      expect(style.width).toBe('374px')
      expect(style.maxHeight).toBe('592px')
      // jsdom lays nothing out (offsetHeight 0): the panel's bottom is the bar's top.
      expect(style.top).toBe('600px')
    })
  })
})

/**
 * The company logo before 創薬表示 (owner request 2026-10-17, PT-3606): on that
 * menu's bar button only, decorative, and never in place of the label.
 */
describe('the company logo on 創薬表示', () => {
  const MENU = appMenu(LABELS, { ...PRESETS, plddtLocked: null })
  const LOGO = 'logo.png'

  it('sits before the label of the 創薬表示 button alone, and leaves its name the label', () => {
    renderBar({ menu: MENU, brandLogo: { src: LOGO, onError: vi.fn() } })
    const presets = screen.getByRole('menuitem', { name: 'Drug discovery' })
    const logo = presets.querySelector('img')
    expect(logo).not.toBeNull()
    expect(logo).toHaveAttribute('src', LOGO)
    expect(logo).toHaveAttribute('alt', '')
    expect(logo).toHaveAttribute('aria-hidden', 'true')
    expect(logo).toHaveClass('pymolv-menubar-logo')
    expect(presets.firstChild).toBe(logo)
    expect(presets).toHaveTextContent(/^Drug discovery$/)
    expect(document.querySelectorAll('img')).toHaveLength(1)
  })

  it('stays on the locked button, which the stylesheet greys', () => {
    renderBar({ menu: MENU, disabled: true, brandLogo: { src: LOGO, onError: vi.fn() } })
    const presets = screen.getByRole('menuitem', { name: 'Drug discovery' })
    expect(presets).toHaveAttribute('aria-disabled', 'true')
    expect(presets.querySelector('img')).not.toBeNull()
  })

  it('shows the label alone with no logo uploaded, or none passed', () => {
    renderBar({ menu: MENU, brandLogo: { src: null, onError: vi.fn() } })
    expect(screen.getByRole('menuitem', { name: 'Drug discovery' })).toBeInTheDocument()
    expect(document.querySelector('img')).toBeNull()
  })

  it('hands an image that fails to load back to its owner', () => {
    const onError = vi.fn()
    renderBar({ menu: MENU, brandLogo: { src: LOGO, onError } })
    fireEvent.error(screen.getByRole('menuitem', { name: 'Drug discovery' }).querySelector('img') as HTMLImageElement)
    expect(onError).toHaveBeenCalledTimes(1)
  })
})
